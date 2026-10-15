// Local-only CO-OP host. This preview shares characters' presence, not saves or combat.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createAudioAssets } from './audio-assets.js';
import { patchCoopGame } from './coop-game-patch.js';
import { createCoopWorldSync } from './coop-world-sync.js';

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'client');
const audioAssets = createAudioAssets();
const PORT = Number(process.env.COOP_PORT || 3784);
const BIND = process.env.COOP_BIND_HOST || '127.0.0.1';
const CODE = process.env.COOP_ROOM_CODE || randomBytes(18).toString('base64url');
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw Error('Invalid port');
if (!/^[a-zA-Z0-9_-]{16,128}$/.test(CODE)) throw Error('Invalid room code');
const ASSETS = new Map([
  ['/coop/css/game.css', 'css/game.css'],
  ['/coop/js/audio-data.js', 'js/audio-data.js'],
  ['/coop/js/game.js', 'js/game.js'],
  ['/coop/js/coop-bridge.js', 'js/coop-bridge.js'],
  ['/coop/js/v134-online.js', 'js/v134-online.js']
]);
const MIME = { css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };
const peers = new Map();
const worldSync = createCoopWorldSync();
let nextId = 1, hostId = null;
const wss = new WebSocketServer({ noServer: true, maxPayload: 131072 });
const server = http.createServer((req, res) => {
  (async () => {
    const path = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405).end();
    if (path === '/health') return res.writeHead(200).end('ok');
    // Reuse v134 lazy-audio manifest instead of transferring 7MB per player.
    if (path === '/coop/js/audio-data.js') {
      audioAssets.serve(req, res, '/joan/js/audio-data.js');
      return;
    }
    if (path.startsWith('/joan/audio/')) {
      audioAssets.serve(req, res, path);
      return;
    }
    if (path === '/') return res.writeHead(302, { location: '/coop/' }).end();
    if (path === '/coop/' || path === '/coop/index.html') {
      const text = await readFile(join(CLIENT, 'index.html'), 'utf8');
      const needle = '<script src="js/mp-bridge.js"></script>';
      if (text.split(needle).length !== 2) throw Error('Unsupported game index');
      const html = text.replace(needle, '<script src="js/coop-bridge.js"></script>');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      return res.end(req.method === 'HEAD' ? '' : html);
    }
    const rel = ASSETS.get(path);
    if (!rel) return res.writeHead(404).end('Not found');
    const file = resolve(CLIENT, rel);
    if (!file.startsWith(CLIENT + sep)) return res.writeHead(403).end();
    // Never cache CO-OP bridge or the dynamically patched game script across restarts.
    const headers = { 'content-type': MIME[rel.split('.').pop()], 'cache-control':
      (path === '/coop/js/game.js' || path === '/coop/js/coop-bridge.js') ? 'no-store' : 'private, max-age=600' };
    if (path === '/coop/js/game.js') {
      const src = await readFile(file, 'utf8');
      // Optimize only this CO-OP endpoint; singleplayer asset remains untouched.
      const body = patchCoopGame(src, { worldBrowserTest: process.env.COOP_WORLD_BROWSER_TEST === '1' });
      res.writeHead(200, headers);
      return res.end(req.method === 'HEAD' ? '' : body);
    }
    const info = await stat(file);
    res.writeHead(200, { ...headers, 'content-length': info.size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  })().catch(error => {
    console.error('CO-OP HTTP error:', error.message);
    if (!res.headersSent) res.writeHead(500).end('Server error');
    else res.destroy();
  });
});
function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536) ws.send(JSON.stringify(message));
}
function broadcast(message) { for (const socket of peers.keys()) send(socket, message); }
function closeRoom() {
  hostId = null;
  for (const socket of peers.keys()) socket.close(1001, 'Host left');
  peers.clear();
}
server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const origin = req.headers.origin;
    if (url.pathname !== '/coop-ws' || url.searchParams.getAll('code').length !== 1 ||
        url.searchParams.get('code') !== CODE || !req.headers.host ||
        !['http://', 'https://'].some(prefix => origin === prefix + req.headers.host) ||
        peers.size >= 4) return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  } catch { socket.destroy(); }
});

// Only finite, tightly bounded cosmetic data may cross players' browsers.
const FX_TYPES = new Set(['castStart', 'ring', 'whirl', 'whirlCut', 'spectralDaggers',
  'dragonWhirl36', 'dragonWhirlImpact', 'slash', 'thrust', 'frontalBurst',
  'ambushPunch', 'variantImpact', 'fireArrowBlast', 'poisonArrowImpact',
  'arrowRain', 'lightning', 'suraFlames', 'dragonBreath', 'dispelRelease',
  'dispelImpact', 'fingerImpact', 'fingerClawHit', 'fearBloom', 'chainArc',
  'perfectLink', 'bowRelease', 'v38Release', 'spellBloom', 'weaponArc']);
const FX_NUMBERS = ['x', 'y', 'life', 'max', 'a', 'radius', 'range', 'half', 'width',
  'turns', 'count', 'r', 'dragonSize', 'fxScale', 'clawHalfWidth', 'spellIndex'];
const FX_STRINGS = ['col', 'rankColor', 'spellStage', 'spellClass', 'spellType',
  'shape', 'owner', 'variant'];
function cleanEffect(raw) {
  if (!raw || typeof raw !== 'object' || !FX_TYPES.has(raw.type) ||
      !Number.isFinite(raw.x) || raw.x < -150 || raw.x > 1250 ||
      !Number.isFinite(raw.y) || raw.y < -150 || raw.y > 800 ||
      !Number.isFinite(raw.life) || raw.life <= 0 || raw.life > 8 ||
      !Number.isFinite(raw.max) || raw.max <= 0 || raw.max > 8) return null;
  const e = { type: raw.type };
  for (const key of FX_NUMBERS) if (Number.isFinite(raw[key]) && Math.abs(raw[key]) < 10000) e[key] = raw[key];
  for (const key of FX_STRINGS) if (typeof raw[key] === 'string' && raw[key].length <= 32 &&
      /^[a-zA-Z0-9#_-]+$/.test(raw[key])) e[key] = raw[key];
  return e;
}
function cleanAction(a) {
  if (!a || !['basic', 'skill'].includes(a.kind) ||
      !Number.isFinite(a.progress) || a.progress < 0 || a.progress > 1 ||
      !Number.isFinite(a.angle) || Math.abs(a.angle) > 7) return null;
  return { kind: a.kind, progress: a.progress, angle: a.angle,
    weapon: typeof a.weapon === 'string' ? a.weapon.slice(0, 20) : '' };
}
function cleanShots(raw) {
  if (!Array.isArray(raw)) return [];
  const shots = [];
  for (const p of raw.slice(0, 10)) {
    if (!p || !Number.isFinite(p.x) || p.x < -80 || p.x > 1180 ||
        !Number.isFinite(p.y) || p.y < -80 || p.y > 740 ||
        !Number.isFinite(p.vx) || Math.abs(p.vx) > 1800 ||
        !Number.isFinite(p.vy) || Math.abs(p.vy) > 1800 ||
        !Number.isFinite(p.life) || p.life <= 0 || p.life > 12) continue;
    const o = { owner: 'player', x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: p.life };
    for (const k of ['scale', 'fxScale', 'clawHalfWidth', 'spellIndex'])
      if (Number.isFinite(p[k]) && Math.abs(p[k]) < 250) o[k] = p[k];
    for (const k of ['style', 'variant', 'spellClass', 'spellType', 'spellStage', 'col', 'rankColor'])
      if (typeof p[k] === 'string' && p[k].length < 32 && /^[a-zA-Z0-9#_-]+$/.test(p[k])) o[k] = p[k];
    for (const k of ['skill', 'chainLightning']) if (typeof p[k] === 'boolean') o[k] = p[k];
    shots.push(o);
  }
  return shots;
}

// Public appearance is deliberately a rendering recipe, not equipment or save data.
const LOOK_KEYS = new Set(['scale', 'skin', 'hair', 'hairStyle', 'legs', 'boots', 'bootTrim',
  'body', 'sleeve', 'mask', 'plusGlow', 'build', 'look', 'stance', 'agile', 'darkHand',
  'helmet', 'weapon', 'offhand', 'wings', 'v95Robe', 'shape', 'light', 'dark', 'trim',
  'tier', 'pauldron', 'spikes', 'cape', 'collar', 'skirt', 'cls', 'armor', 'p9',
  'gold', 'hood', 'hoodCol', 'type', 'plus9', 'kind', 'metal', 'glow', 'hero',
  'fire', 'demon', 'hell', 'v123Aura', 'fade', 'col']);
function cleanLook(input, depth = 0) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || depth > 4) return null;
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (!LOOK_KEYS.has(key)) continue;
    if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100) out[key] = value;
    else if (typeof value === 'string' && /^[a-zA-Z0-9#_-]{1,32}$/.test(value)) out[key] = value;
    else if (value && typeof value === 'object') {
      const nested = cleanLook(value, depth + 1);
      if (nested) out[key] = nested;
    }
  }
  return out;
}

wss.on('connection', socket => {
  const id = String(nextId++);
  const isHost = hostId === null;
  if (isHost) hostId = id;
  const state = { id, active: false, room: 0, x: 0, y: 0, dir: 0, name: '', cls: 'warrior', level: 1, action: null, shots: [], look: null, last: 0, lastFx: 0, lastLook: 0, lastWorld: 0, lastHit: 0,
    worldBootstrapRoom: -1, worldBootstrapOwner: null };
  peers.set(socket, state);
  send(socket, { type: 'welcome', id, host: isHost, max: 4 });
  broadcast({ type: 'count', count: peers.size });
  socket.on('message', bytes => {
    if (bytes.length > 16384) return;
    let msg;
    try { msg = JSON.parse(String(bytes)); } catch { return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    if (msg.type === 'ping' && Number.isSafeInteger(msg.t)) return send(socket, { type: 'pong', t: msg.t });
    if (msg.type === 'look') {
      if (Date.now() - state.lastLook < 600) return;
      state.lastLook = Date.now();
      if (JSON.stringify(msg.look || '').length > 3000) return;
      const look = cleanLook(msg.look);
      if (look && look.body && look.weapon && look.look) state.look = look;
      return;
    }
    if (msg.type === 'world') {
      const now = Date.now();
      if (!state.active || !Number.isInteger(msg.room) || msg.room !== state.room ||
          now - state.lastWorld < 220 || socket.bufferedAmount > 262144) return;
      const updated = worldSync.publish(state.room, id, msg.world, peers);
      if (!updated) return;
      state.lastWorld = now;
      for (const [otherSocket, other] of peers) if (otherSocket !== socket &&
          other.active && other.room === state.room) {
        send(otherSocket, { type: 'world', ...updated });
      }
      return;
    }
    if (msg.type === 'mobHit') {
      const now = Date.now();
      if (!state.active || now - state.lastHit < 60 || !Number.isSafeInteger(msg.id) ||
          !Number.isFinite(msg.damage) || msg.damage <= 0 ||
          typeof msg.kind !== 'string' || msg.kind.length > 32) return;
      state.lastHit = now;
      const room = worldSync.get(state.room);
      if (!room?.world || room.ownerId === id) return;
      const m = [...room.world.mobs, ...room.world.stones].find(m => m.id === msg.id && !m.dead && m.hp > 0);
      if (!m || msg.damage > Math.max(100, m.maxHp * 4) || Math.hypot(m.x - state.x, m.y - state.y) > 900) return;
      for (const [ownerSocket, ownerState] of peers) if (ownerState.id === room.ownerId) {
        send(ownerSocket, { type: 'mobHit', room: state.room, id: m.id,
          damage: msg.damage, kind: msg.kind.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) });
        break;
      }
      return;
    }
    if (msg.type === 'visual') {
      const now = Date.now();
      if (!state.active || now - state.lastFx < 35 || !Array.isArray(msg.effects) || msg.effects.length > 12) return;
      state.lastFx = now;
      const effects = msg.effects.map(cleanEffect).filter(Boolean);
      if (!effects.length) return;
      for (const [otherSocket, otherState] of peers) {
        if (otherSocket !== socket && otherState.active && otherState.room === state.room)
          send(otherSocket, { type: 'visual', from: id, room: state.room, effects });
      }
      return;
    }
    if (msg.type !== 'state' || Date.now() - state.last < 40) return;
    if (typeof msg.active !== 'boolean' ||
        !Number.isInteger(msg.room) || msg.room < 0 || msg.room > 120 ||
        !Number.isFinite(msg.x) || msg.x < 0 || msg.x > 1100 ||
        !Number.isFinite(msg.y) || msg.y < 0 || msg.y > 660 ||
        !Number.isFinite(msg.dir) || Math.abs(msg.dir) > 7 ||
        !['warrior', 'ninja', 'sura', 'shaman', 'lycan'].includes(msg.cls) ||
        !Number.isInteger(msg.level) || msg.level < 1 || msg.level > 200 ||
        typeof msg.name !== 'string' || msg.name.length > 24) return;
    state.last = Date.now();
    if (state.room !== msg.room) { state.worldBootstrapRoom = -1; state.worldBootstrapOwner = null; }
    Object.assign(state, { active: msg.active, room: msg.room, x: msg.x, y: msg.y,
      dir: msg.dir, cls: msg.cls, level: msg.level, action: cleanAction(msg.action), shots: cleanShots(msg.shots),
      name: msg.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 24) });
  });
  socket.on('close', () => {
    peers.delete(socket);
    if (id === hostId) closeRoom();
    else broadcast({ type: 'count', count: peers.size });
  });
});
const timer = setInterval(() => {
  worldSync.refresh(peers);
  for (const [socket, viewer] of peers) {
    const room = worldSync.get(viewer.room);
    const players = [];
    for (const other of peers.values()) if (other.id !== viewer.id &&
        other.active && other.room === viewer.room) {
      players.push({ id: other.id, x: other.x, y: other.y, dir: other.dir,
        name: other.name, cls: other.cls, level: other.level, look: other.look,
        action: other.action, shots: other.shots });
    }
    send(socket, { type: 'peers', players, count: peers.size,
      worldOwnerId: room?.ownerId || null, hasWorldSnapshot: !!room?.world });
    if (viewer.active && room?.world &&
        (viewer.worldBootstrapRoom !== viewer.room || viewer.worldBootstrapOwner !== room.ownerId)) {
      viewer.worldBootstrapRoom = viewer.room;
      viewer.worldBootstrapOwner = room.ownerId;
      send(socket, { type: 'world', ...room, bootstrap: true });
    }
    if (viewer.active && room?.respawnDue && room.ownerId === viewer.id)
      send(socket, { type: 'worldRespawn', room: viewer.room, cycle: room.world?.cycle });
  }
}, 65);
server.listen(PORT, BIND, () => {
  console.log('JOAN CO-OP PREVIEW (presence only; NOT shared combat)');
  console.log('Host: http://127.0.0.1:' + PORT + '/coop/?code=' + CODE);
  console.log('To invite friends, replace 127.0.0.1:' + PORT + ' with your tunnel address.');
  console.log('Never share character save files or secrets to join.');
  console.log('Ctrl+C ends the session.');
});
function stop() { clearInterval(timer); closeRoom(); wss.close(); server.close(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
