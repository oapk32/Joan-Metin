/* Joan v134: optional LAN multiplayer presence. Gameplay state is local, not authoritative. */
(() => {
  'use strict';
  if (!/^\/joan(?:\/|$)/.test(location.pathname)) return;

  const indicator = document.createElement('div');
  indicator.setAttribute('role', 'status');
  indicator.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:4000;padding:7px 11px;border:1px solid #6e9377;background:#10251fed;color:#fff;font:13px system-ui;border-radius:7px;pointer-events:none';
  indicator.textContent = 'Online: připojování…';
  document.body.append(indicator);

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(protocol + '//' + location.host + '/joan-ws');
  const peers = new Map();
  const classes = new Set(['warrior', 'ninja', 'sura', 'shaman', 'lycan']);
  let connected = false;
  let lastSent = 0;
  let visibleCount = 0;

  socket.addEventListener('open', () => {
    connected = true;
    indicator.textContent = 'Joan Online: připojeno';
  });
  socket.addEventListener('close', () => {
    connected = false;
    peers.clear();
    indicator.textContent = 'Joan Online: odpojeno (obnov stránku)';
  });
  socket.addEventListener('error', () => {
    indicator.textContent = 'Joan Online: chyba připojení';
  });
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type !== 'joan-peers' || !Array.isArray(message.players)) return;
    const now = performance.now();
    const ids = new Set();
    for (const peer of message.players.slice(0, 29)) {
      if (typeof peer.id !== 'string' || !Number.isFinite(peer.x) || !Number.isFinite(peer.y)) continue;
      ids.add(peer.id);
      const old = peers.get(peer.id);
      const x = Math.max(0, Math.min(1100, peer.x));
      const y = Math.max(0, Math.min(660, peer.y));
      if (old) {
        // Teleports / map transfers should not slide through the world.
        if (Math.hypot(x - old.x, y - old.y) > 220) {
          old.x = x;
          old.y = y;
        }
        old.tx = x;
        old.ty = y;
        old.dir = Number.isFinite(peer.dir) ? peer.dir : old.dir;
        old.cls = classes.has(peer.cls) ? peer.cls : 'warrior';
        old.name = String(peer.name || 'Hráč').slice(0, 24);
        old.updatedAt = now;
      } else {
        peers.set(peer.id, {
          id: peer.id, x, y, tx: x, ty: y, dir: Number.isFinite(peer.dir) ? peer.dir : 0,
          cls: classes.has(peer.cls) ? peer.cls : 'warrior',
          name: String(peer.name || 'Hráč').slice(0, 24),
          walk: 0, moving: 0, updatedAt: now, sampledAt: now
        });
      }
    }
    for (const id of peers.keys()) if (!ids.has(id)) peers.delete(id);
    visibleCount = Math.max(0, Number(message.count) || 0);
    indicator.textContent = 'Joan Online: hráčů v oblasti ' + visibleCount;
  });

  function tick(hero, room, now) {
    if (!connected || socket.readyState !== WebSocket.OPEN || now - lastSent < 100) return;
    lastSent = now;
    const active = !!hero && Number.isFinite(hero.x) && Number.isFinite(hero.y);
    socket.send(JSON.stringify({
      type: 'joan-state',
      active,
      room: Number.isInteger(room) ? room : 0,
      x: active ? hero.x : 0,
      y: active ? hero.y : 0,
      dir: active && Number.isFinite(hero.dir) ? hero.dir : 0,
      cls: active && classes.has(hero.cls) ? hero.cls : 'warrior',
      name: active ? String(hero.name || 'Hráč').slice(0, 24) : ''
    }));
  }

  function getPeers() {
    const now = performance.now();
    const result = [];
    for (const peer of peers.values()) {
      const dt = Math.min(0.06, Math.max(0, (now - peer.sampledAt) / 1000));
      peer.sampledAt = now;
      const dx = peer.tx - peer.x;
      const dy = peer.ty - peer.y;
      const alpha = 1 - Math.exp(-dt / 0.085);
      peer.x += dx * alpha;
      peer.y += dy * alpha;
      const moving = Math.hypot(dx, dy) > 0.8 && now - peer.updatedAt < 550;
      peer.moving += ((moving ? 1 : 0) - peer.moving) * Math.min(1, dt * 12);
      peer.walk += dt * 10.5 * peer.moving;
      result.push(peer);
    }
    return result;
  }

  window.JoanMP = { tick, getPeers };
})();
