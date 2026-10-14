/* Optional v134 online first-map preview; original singleplayer stays unchanged. */
(() => {
  'use strict';
  const query = new URLSearchParams(location.search);
  const characterId = query.get('character');
  const enabled = query.get('online') === '1' && /^[1-9][0-9]{0,18}$/.test(characterId || '');
  if (!enabled) { window.JoanOnline = { enabled: false }; return; }

  const mobTypes = new Set(['dog', 'wolf', 'stone']);
  const keysHeld = new Set();
  const publicPlayers = new Map();
  const publicMobs = new Map();
  const mobDrawCache = new Map();
  const movingPeers = new Map();
  let personalDrops = [], testInventory = [];
  let myId = null, self = null, mounted = false, socket = null;
  let lastInput = 0, lastAttack = 0, lastPickup = 0, lastUi = 0;
  let notice, game;

  function status(message) {
    if (notice) notice.textContent = message;
  }
  function normalizeKey(e) {
    const codes = {
      KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
      ArrowUp: 'w', ArrowLeft: 'a', ArrowDown: 's', ArrowRight: 'd',
      Space: 'attack', KeyE: 'pickup'
    };
    return codes[e.code] || null;
  }
  // Capture normal game input before the legacy handler. It must never
  // execute local damage, skill payouts, teleports, inventory or saves online.
  window.addEventListener('keydown', e => {
    const k = normalizeKey(e);
    if (!k) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    keysHeld.add(k);
    if (k === 'attack' && !e.repeat) attackIntent();
    if (k === 'pickup' && !e.repeat) pickUp();
  }, true);
  window.addEventListener('keyup', e => {
    const k = normalizeKey(e);
    if (!k) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    keysHeld.delete(k);
  }, true);
  window.addEventListener('blur', () => { keysHeld.clear(); sendInput(0, 0); });

  function send(type, values) {
    if (socket?.readyState !== WebSocket.OPEN || !mounted) return false;
    socket.send(JSON.stringify({ type, ...values }));
    return true;
  }
  function sendInput(x, y) {
    send('combat-input', { x, y });
  }
  function nearestMob(range) {
    if (!self) return null;
    let best = null, distance = range;
    for (const mob of publicMobs.values()) {
      if (!(mob.hp > 0) || !mobTypes.has(mob.type)) continue;
      const d = Math.hypot(mob.x - self.x, mob.y - self.y);
      if (d < distance) { distance = d; best = mob; }
    }
    return best;
  }
  function attackIntent() {
    const now = performance.now();
    if (!mounted || !self || self.hp <= 0 || now - lastAttack < 540) return false;
    const mob = nearestMob(100);
    if (!mob) return false;
    lastAttack = now;
    const angle = Math.atan2(mob.y - self.y, mob.x - self.x);
    game?.swing(angle);
    return send('combat-attack', { mobId: mob.id });
  }
  function pickUp() {
    const now = performance.now();
    if (!self || now - lastPickup < 220) return;
    lastPickup = now;
    const item = personalDrops.find(d => Math.hypot(d.x - self.x, d.y - self.y) < 65);
    if (item) send('combat-pickup', { dropId: item.id });
  }
  function merge(delta) {
    for (const [name, source] of [['players', publicPlayers], ['mobs', publicMobs]]) {
      for (const id of delta[name + 'Removed'] || []) source.delete(id);
      for (const item of [...(delta[name + 'Added'] || []), ...(delta[name + 'Changed'] || [])]) {
        if (item && typeof item.id === 'string') source.set(item.id, item);
      }
    }
  }
  function refresh() {
    self = publicPlayers.get(myId) || null;
    if (!mounted && self) {
      mounted = true;
      game.mount(self);
      status('Online 1–2 Okraj Joanu · zkušební PvE · postup se neukládá');
    }
  }
  function start(callbacks) {
    game = callbacks;
    notice = document.createElement('div');
    notice.id = 'joanOnlineStatus';
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:5000;' +
      'background:#10251ff2;border:1px solid #8d764a;padding:9px 14px;border-radius:6px;' +
      'font:600 13px system-ui;color:#ffe8b5;text-align:center;pointer-events:none;max-width:90vw';
    document.body.append(notice);
    status('Připojuji online postavu…');
    socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') +
      location.host + '/v134-ws?character=' + encodeURIComponent(characterId));
    socket.addEventListener('open', () => status('Ověřuji online postavu…'));
    socket.addEventListener('error', () => status('Chyba připojení k první online mapě.'));
    socket.addEventListener('close', e => {
      mounted = false;
      keysHeld.clear();
      status('Odpojeno (' + e.code + '). Vrať se na stránku účtu nebo obnov stránku.');
    });
    socket.addEventListener('message', event => {
      let m;
      try { m = JSON.parse(event.data); } catch { return; }
      if (m.type === 'combat-welcome') {
        myId = m.id;
      } else if (m.type === 'combat-snapshot' && Array.isArray(m.players) && Array.isArray(m.mobs)) {
        publicPlayers.clear(); publicMobs.clear();
        for (const player of m.players) if (typeof player.id === 'string') publicPlayers.set(player.id, player);
        for (const mob of m.mobs) if (typeof mob.id === 'string') publicMobs.set(mob.id, mob);
        refresh();
      } else if (m.type === 'combat-delta') {
        merge(m);
        refresh();
      } else if (m.type === 'combat-loot') {
        personalDrops = Array.isArray(m.personalDrops) ? m.personalDrops : [];
        testInventory = Array.isArray(m.testInventory) ? m.testInventory : [];
      } else if (m.type === 'combat-hit' && !m.ok && m.reason !== 'cooldown') {
        status('Online boj: ' + (m.reason === 'out_of_range' ? 'Přibliž se k monstru.' : 'Útok nebyl přijat (' + m.reason + ').'));
      } else if (m.type === 'combat-pickup-result') {
        if (m.ok) status('Sebráno: ' + m.itemName + ' · pouze testovací kořist.');
      }
    });
  }

  // Invoked only from the explicit online branch of game.js. All gameplay
  // values displayed here originate from server snapshots, not local combat.
  function frame({ player, world, keys, mouse, time }) {
    if (!mounted || !self || !player || !world) return;
    for (const k of ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ']) keys[k] = false;
    for (const k of ['w', 'a', 's', 'd']) keys[k] = keysHeld.has(k);
    const dx = Number(keysHeld.has('d')) - Number(keysHeld.has('a'));
    const dy = Number(keysHeld.has('s')) - Number(keysHeld.has('w'));
    const now = performance.now();
    if (now - lastInput >= 100) {
      lastInput = now;
      sendInput(dx, dy);
    }
    if (keysHeld.has('attack') || mouse.down) attackIntent();

    player.x = self.x; player.y = self.y; player.hp = self.hp;
    player.name = self.name; player.gold = self.yang; player.xp = self.xp;
    // v134's isDead() checks deathState, not HP. Derive a display-only
    // death marker from the SERVER snapshot so defeated heroes disappear
    // until their server-owned respawn; do not apply local EXP/Yang penalties.
    if (self.hp <= 0 && !player.deathState) {
      player.deathState = { reviveAt: Date.now() + 4000, town: 0,
        lossPercent: 0, lostXp: 0, lostYang: 0 };
      player.action = null;
      status('Postava padla · čekej na serverové oživení.');
    } else if (self.hp > 0 && player.deathState) {
      player.deathState = null;
      status('Postava oživena · online 1–2 Okraj Joanu.');
    }
    if ((dx || dy) && (!player.action || time >= player.action.end)) {
      player.dir = Math.atan2(dy, dx);
    }
    if (player.action && time >= player.action.end) player.action = null;

    const activeMobs = [];
    const activeStones = [];
    for (const mob of publicMobs.values()) {
      if (!mobTypes.has(mob.type)) continue;
      let draw = mobDrawCache.get(mob.id);
      if (!draw) {
        let hash = 17;
        for (const ch of mob.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
        draw = { id: hash || 1, serverId: mob.id, type: mob.type,
          stoneLvl: mob.type === 'stone' ? 5 : undefined,
          r: mob.type === 'stone' ? 39 : mob.type === 'wolf' ? 19 : 15,
          dir: 0, stun: 0, poison: 0, attack: 1, flash: 0 };
        mobDrawCache.set(mob.id, draw);
      }
      const movedX = mob.x - (draw.x ?? mob.x);
      const movedY = mob.y - (draw.y ?? mob.y);
      if (movedX || movedY) draw.dir = Math.atan2(movedY, movedX);
      if (draw.hp !== undefined && mob.hp < draw.hp) draw.flash = 0.16;
      else draw.flash = Math.max(0, draw.flash - 0.016);
      Object.assign(draw, { x: mob.x, y: mob.y, hp: mob.hp, maxHp: mob.maxHp, dead: mob.hp <= 0 });
      if (mob.type === 'stone') activeStones.push(draw);
      else activeMobs.push(draw);
    }
    for (const id of mobDrawCache.keys()) if (!publicMobs.has(id)) mobDrawCache.delete(id);
    world.mobs = activeMobs;
    world.stones = activeStones; // Reuse original v134 stone art and HP bar.
    world.total = 10;
    world.kills = activeMobs.filter(m => m.dead).length;
    world.clear = false;

    // Existing v134 pickup art is reused but never calls local loot logic.
    game.setDrops(personalDrops.map((d, i) => ({
      id: d.id, x: d.x, y: d.y, type: 'item',
      value: { name: d.itemName, rarity: 0 }, life: 1, bob: i, used: false
    })));

    if (now - lastUi > 250) {
      lastUi = now;
      const hp = document.getElementById('hudHp');
      const hpBar = document.getElementById('hpBar');
      const gold = document.getElementById('statGold');
      const xp = document.getElementById('hudXp');
      if (hp) hp.textContent = self.hp + ' / ' + self.maxHp + ' (server)';
      if (hpBar) hpBar.style.width = Math.max(0, self.hp / self.maxHp * 100) + '%';
      if (gold) gold.textContent = 'test ' + self.yang;
      if (xp) xp.textContent = 'test ' + self.xp;
      notice.title = 'Sebrané testovací předměty: ' + testInventory.length;
    }
  }
  function getPeers() {
    const result = [];
    for (const player of publicPlayers.values()) {
      if (player.id === myId) continue;
      const old = movingPeers.get(player.id);
      const moving = old ? Math.hypot(old.x - player.x, old.y - player.y) > .5 : false;
      const peer = old || { walk: 0, moving: 0 };
      peer.walk += moving ? .25 : 0;
      peer.moving = moving ? 1 : Math.max(0, peer.moving - .15);
      Object.assign(peer, player);
      movingPeers.set(player.id, peer);
      result.push(peer);
    }
    for (const id of movingPeers.keys()) if (!publicPlayers.has(id)) movingPeers.delete(id);
    return result;
  }
  window.JoanOnline = { enabled, start, frame, getPeers, attackIntent,
    testState: () => ({ connected: mounted, myId, players: [...publicPlayers.values()],
      mobs: [...publicMobs.values()], personalDrops: personalDrops.length, inventory: testInventory.length })
  };
})();