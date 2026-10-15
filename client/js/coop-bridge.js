/* Joan CO-OP preview: local singleplayer characters + live peer presence.
 * Each browser runs its own offline save. Combat, mobs, loot and XP are NOT shared.
 * Local movement stays instant: never apply remote position to the local player.
 */
(() => {
  'use strict';
  if (location.pathname !== '/coop/' && location.pathname !== '/coop/index.html') return;
  const indicator = document.createElement('div');
  indicator.setAttribute('role', 'status');
  indicator.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:5000;background:#13251ff0;color:#e8f8f2;border:1px solid #698b74;border-radius:7px;padding:8px 11px;font:12px system-ui;pointer-events:none';
  document.body.append(indicator);
  const code = new URLSearchParams(location.search).get('code');
  const players = new Map();
  let socket, count = 0, host = false, connected = false, samples = 0, sampleAt = performance.now();
  let fps = 0, rtt = null, lastInput = 0, lastStatus = 0, lastPing = 0;
  const classes = new Set(['warrior', 'ninja', 'sura', 'shaman']);
  const FX_TYPES = new Set(['castStart', 'ring', 'whirl', 'whirlCut', 'spectralDaggers',
    'dragonWhirl36', 'dragonWhirlImpact', 'slash', 'thrust', 'frontalBurst',
    'ambushPunch', 'variantImpact', 'fireArrowBlast', 'poisonArrowImpact',
    'arrowRain', 'lightning', 'suraFlames', 'dragonBreath', 'dispelRelease',
    'dispelImpact', 'fingerImpact', 'fingerClawHit', 'fearBloom', 'chainArc',
    'perfectLink', 'bowRelease', 'v38Release', 'spellBloom', 'weaponArc']);
  const fxKeys = ['x', 'y', 'life', 'max', 'a', 'radius', 'range', 'half', 'width',
    'turns', 'count', 'r', 'dragonSize', 'fxScale', 'clawHalfWidth', 'spellIndex',
    'col', 'rankColor', 'spellStage', 'spellClass', 'spellType', 'shape', 'owner', 'variant'];
  let lastRoom = null;
  let knownEffects = new WeakSet();
  let visualEvents = [];
  let lastVisual = 0;
  const status = message => { indicator.textContent = message; };
  status(code ? 'CO-OP: připojuji...' : 'CO-OP: chybí kód místnosti v odkazu');
  function receive(event) {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'welcome') {
      host = msg.host === true;
      connected = true;
    } else if (msg.type === 'count') {
      count = Number(msg.count) || 0;
    } else if (msg.type === 'pong') {
      rtt = Math.max(0, Date.now() - msg.t);
    } else if (msg.type === 'peers' && Array.isArray(msg.players)) {
      count = Number(msg.count) || 0;
      const seen = new Set();
      const now = performance.now();
      for (const p of msg.players.slice(0, 3)) {
        if (typeof p.id !== 'string' || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
            !classes.has(p.cls) || typeof p.name !== 'string') continue;
        seen.add(p.id);
        const old = players.get(p.id);
        const x = Math.max(0, Math.min(1100, p.x));
        const y = Math.max(0, Math.min(660, p.y));
        if (!old) {
          players.set(p.id, { x, y, tx: x, ty: y, dir: p.dir, name: p.name,
            cls: p.cls, action: p.action || null, shots: Array.isArray(p.shots) ? p.shots : [],
            walk: 0, moving: 0, sampledAt: now, updatedAt: now });
        } else {
          if (Math.hypot(x - old.x, y - old.y) > 260) {
            old.x = x; old.y = y;
          }
          old.tx = x; old.ty = y;
          old.dir = Number.isFinite(p.dir) ? p.dir : old.dir;
          old.cls = p.cls;
          old.name = p.name.slice(0, 24);
          old.action = p.action || null;
          old.shots = Array.isArray(p.shots) ? p.shots : [];
          old.updatedAt = now;
        }
      }
      for (const key of players.keys()) if (!seen.has(key)) players.delete(key);
    } else if (msg.type === 'visual' && Array.isArray(msg.effects) &&
        msg.room === lastRoom && players.has(msg.from)) {
      const created = performance.now();
      for (const e of msg.effects.slice(0, 12)) {
        if (e && FX_TYPES.has(e.type) && Number.isFinite(e.life) && e.life > 0 &&
            Number.isFinite(e.max) && e.max > 0) {
          visualEvents.push({ from: msg.from, created, effect: { ...e } });
        }
      }
      if (visualEvents.length > 150) visualEvents = visualEvents.slice(-150);
    }
  }
  if (code && /^[a-zA-Z0-9_-]{16,128}$/.test(code)) {
    socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') +
      location.host + '/coop-ws?code=' + encodeURIComponent(code));
    socket.addEventListener('open', () => status('CO-OP: spojeno, vyber postavu'));
    socket.addEventListener('message', receive);
    socket.addEventListener('error', () => status('CO-OP: chyba spojení; zkontroluj odkaz'));
    socket.addEventListener('close', () => {
      connected = false;
      players.clear();
      visualEvents = [];
      status('CO-OP: odpojeno, obnov stránku / zkontroluj hostitele');
    });
  }

  function actionPayload(a, gameTime) {
    if (!a || !['basic', 'skill'].includes(a.kind) || !Number.isFinite(a.duration) ||
        a.duration <= 0 || !Number.isFinite(gameTime) || gameTime > a.end) return null;
    return { kind: a.kind, progress: Math.max(0, Math.min(1, (gameTime - a.start) / a.duration)),
      angle: Number.isFinite(a.angle) ? a.angle : 0, weapon: String(a.weapon || '').slice(0, 20) };
  }
  function projectilePayload(projectiles) {
    if (!Array.isArray(projectiles)) return [];
    const result = [];
    for (const p of projectiles) {
      if (p?.owner !== 'player' || !(p.life > 0) || result.length >= 10) continue;
      const o = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: p.life };
      for (const key of ['scale', 'fxScale', 'clawHalfWidth', 'spellIndex'])
        if (Number.isFinite(p[key])) o[key] = p[key];
      for (const key of ['style', 'variant', 'spellClass', 'spellType', 'spellStage', 'col', 'rankColor'])
        if (typeof p[key] === 'string') o[key] = p[key].slice(0, 31);
      for (const key of ['skill', 'chainLightning'])
        if (typeof p[key] === 'boolean') o[key] = p[key];
      result.push(o);
    }
    return result;
  }
  function effectPayload(e) {
    if (!FX_TYPES.has(e.type) || !Number.isFinite(e.x) || !Number.isFinite(e.y) ||
        !Number.isFinite(e.life) || !Number.isFinite(e.max) || e.life <= 0 || e.max <= 0) return null;
    const result = { type: e.type };
    for (const key of fxKeys) {
      if (Number.isFinite(e[key])) result[key] = e[key];
      else if (typeof e[key] === 'string') result[key] = e[key].slice(0, 32);
    }
    return result;
  }

  function tick(player, room, now, gameTime, effects = [], projectiles = []) {
    samples++;
    if (now - sampleAt >= 1000) {
      fps = Math.round(samples * 1000 / (now - sampleAt));
      samples = 0;
      sampleAt = now;
    }
    if (room !== lastRoom) {
      lastRoom = room;
      visualEvents = [];
      knownEffects = new WeakSet();
    }
    if (!socket || socket.readyState !== WebSocket.OPEN || !connected) return;
    if (now - lastInput >= 50 && socket.bufferedAmount < 32768) {
      lastInput = now;
      const active = !!player && Number.isFinite(player.x) && Number.isFinite(player.y);
      socket.send(JSON.stringify({
        type: 'state', active,
        room: Number.isInteger(room) ? room : 0,
        x: active ? Math.max(0, Math.min(1100, player.x)) : 0,
        y: active ? Math.max(0, Math.min(660, player.y)) : 0,
        dir: active && Number.isFinite(player.dir) ? Math.max(-7, Math.min(7, player.dir)) : 0,
        cls: active && classes.has(player.cls) ? player.cls : 'warrior',
        level: active && Number.isInteger(player.level) ? Math.max(1, Math.min(200, player.level)) : 1,
        name: active ? String(player.name || 'Hráč').slice(0, 24) : '',
        action: active ? actionPayload(player.action, gameTime) : null,
        shots: active ? projectilePayload(projectiles) : []
      }));
    }
    // Fire-and-forget cosmetic events. No network event may deal damage or award loot.
    const newEffects = [];
    if (Array.isArray(effects)) for (const e of effects) {
      if (!e || typeof e !== 'object' || knownEffects.has(e)) continue;
      knownEffects.add(e);
      const copy = effectPayload(e);
      if (copy && newEffects.length < 12 && player) newEffects.push(copy);
    }
    if (newEffects.length && now - lastVisual >= 35 && socket.bufferedAmount < 32768) {
      lastVisual = now;
      socket.send(JSON.stringify({ type: 'visual', effects: newEffects }));
    }
    if (now - lastPing >= 2500 && socket.bufferedAmount < 32768) {
      lastPing = now;
      socket.send(JSON.stringify({ type: 'ping', t: Date.now() }));
    }
    if (now - lastStatus >= 1000) {
      lastStatus = now;
      status('CO-OP ' + (host ? 'HOST' : 'HOSTŮV HOST') + ' · hráči ' + count + '/4 · FPS ' +
        fps + ' · síť ' + (rtt == null ? '...' : rtt + ' ms') +
        ' · souboje zatím lokální');
    }
  }
  function getPeers() {
    const now = performance.now();
    const visible = [];
    for (const peer of players.values()) {
      const dt = Math.min(.06, Math.max(0, (now - peer.sampledAt) / 1000));
      peer.sampledAt = now;
      const distance = Math.hypot(peer.tx - peer.x, peer.ty - peer.y);
      const a = 1 - Math.exp(-dt / .09);
      peer.x += (peer.tx - peer.x) * a;
      peer.y += (peer.ty - peer.y) * a;
      const active = distance > .5 && now - peer.updatedAt < 500;
      peer.moving += ((active ? 1 : 0) - peer.moving) * Math.min(1, dt * 11);
      peer.walk += dt * 10 * peer.moving;
      visible.push(peer);
    }
    return visible;
  }
  function getRemoteVisuals(room) {
    if (room !== lastRoom) return { effects: [], shots: [] };
    const now = performance.now();
    const effects = [];
    const retained = [];
    for (const v of visualEvents) {
      if (!players.has(v.from)) continue;
      const remaining = v.effect.life - (now - v.created) / 1000;
      if (remaining <= 0) continue;
      v.effect.life = Math.min(v.effect.max, remaining);
      // Resetting the timestamp avoids subtracting the entire age again next frame.
      v.created = now;
      retained.push(v);
      effects.push(v.effect);
    }
    visualEvents = retained;
    const shots = [];
    for (const peer of players.values()) {
      for (const p of peer.shots.slice(0, 10)) {
        if (p && p.life > 0) shots.push(p);
      }
    }
    return { effects, shots };
  }
  window.JoanMP = { tick, getPeers, getRemoteVisuals };
})();
