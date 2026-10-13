/* Online movement preview for Joan v134. No combat/account/inventory synchronization. */
(() => {
  'use strict';
  // Keep the standalone/singleplayer client unchanged when run outside this Node server.
  if (!/^\/joan(?:\/|$)/.test(location.pathname)) return;
  const indicator = document.createElement('div');
  indicator.setAttribute('role', 'status');
  indicator.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:4000;padding:7px 11px;border:1px solid #6e9377;background:#10251fed;color:#fff;font:13px system-ui;border-radius:7px;pointer-events:none';
  indicator.textContent = 'Online: připojování…';
  document.body.append(indicator);

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(protocol + '//' + location.host + '/joan-ws');
  let peers = [];
  let lastSent = 0;
  let connected = false;

  socket.addEventListener('open', () => {
    connected = true;
    indicator.textContent = 'Joan Online: připojeno';
  });
  socket.addEventListener('close', () => {
    connected = false;
    peers = [];
    indicator.textContent = 'Joan Online: odpojeno (obnov stránku)';
  });
  socket.addEventListener('error', () => {
    indicator.textContent = 'Joan Online: chyba připojení';
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'joan-peers' && Array.isArray(message.players)) {
      peers = message.players;
      indicator.textContent = 'Joan Online: hráčů v oblasti ' + message.count;
    }
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
      name: active ? String(hero.name || 'Hráč').slice(0, 24) : ''
    }));
  }

  function draw(ctx, hero, _room, scale) {
    if (!hero || !peers.length) return;
    ctx.save();
    ctx.setTransform(scale || 1, 0, 0, scale || 1, 0, 0);
    ctx.globalAlpha = 0.83;
    ctx.textAlign = 'center';
    for (const peer of peers) {
      if (!Number.isFinite(peer.x) || !Number.isFinite(peer.y)) continue;
      const x = peer.x, y = peer.y;
      ctx.fillStyle = '#72b8f2';
      ctx.strokeStyle = '#b3e0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y - 10, 11, 18, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#203f69';
      ctx.beginPath(); ctx.arc(x, y - 26, 7, 0, Math.PI * 2); ctx.fill();
      ctx.font = 'bold 13px system-ui';
      ctx.fillStyle = '#f2f8ff';
      ctx.strokeStyle = '#182c3c';
      ctx.lineWidth = 3;
      const label = String(peer.name || 'Hráč').slice(0, 24);
      ctx.strokeText(label, x, y - 41);
      ctx.fillText(label, x, y - 41);
    }
    ctx.restore();
  }

  window.JoanMP = { tick, draw };
})();
