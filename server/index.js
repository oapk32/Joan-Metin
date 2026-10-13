import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { createDatabasePool } from './db.js';
import { registerAccount, authenticateAccount } from './auth.js';
import { createAuthHttp } from './auth-http.js';
import { listCharacters, getCharacter, createCharacter } from './characters.js';
import { createCharactersHttp } from './characters-http.js';
import { startCombatArena } from './combat-ws.js';

const HOST = process.env.JOAN_BIND_HOST || '127.0.0.1'; // bind to Tailscale IP only when explicitly requested
const PORT = Number(process.env.PORT || 3000);
const AUTH_ENABLED = process.env.JOAN_AUTH_ENABLED === '1';
// This login prototype only works on localhost, reached through an SSH tunnel.
if (AUTH_ENABLED && !['127.0.0.1', 'localhost'].includes(HOST)) {
  throw new Error('Account test mode requires JOAN_BIND_HOST=127.0.0.1 and an SSH tunnel, not a public interface.');
}
const pool = AUTH_ENABLED ? createDatabasePool() : null;
const authHttp = AUTH_ENABLED ? createAuthHttp({
  port: PORT,
  register: (username, password) => registerAccount(pool, username, password),
  authenticate: (username, password) => authenticateAccount(pool, username, password)
}) : null;
const charactersHttp = authHttp ? createCharactersHttp({
  sessionFor: authHttp.sessionFor,
  allowedOrigin: authHttp.allowedOrigin,
  list: accountId => listCharacters(pool, accountId),
  get: (accountId, id) => getCharacter(pool, accountId, id),
  create: (accountId, input) => createCharacter(pool, accountId, input)
}) : null;
const combatArena = authHttp ? startCombatArena({
  loadCharacter: (accountId, characterId) => getCharacter(pool, accountId, characterId)
}) : null;
const ROOT = dirname(fileURLToPath(import.meta.url));
const WIDTH = 900;
const HEIGHT = 550;
const SPEED = 225; // authoritative units per second
const MAX_PLAYERS = 30;
const players = new Map();
let nextId = 1;

const ASSETS = new Map([
  ['/', [join(ROOT, 'public', 'index.html'), 'text/html; charset=utf-8']],
  ['/index.html', [join(ROOT, 'public', 'index.html'), 'text/html; charset=utf-8']],
  ['/joan/', [join(ROOT, '..', 'client', 'index.html'), 'text/html; charset=utf-8']],
  ['/joan/index.html', [join(ROOT, '..', 'client', 'index.html'), 'text/html; charset=utf-8']],
  ['/joan/css/game.css', [join(ROOT, '..', 'client', 'css', 'game.css'), 'text/css; charset=utf-8']],
  ['/joan/js/audio-data.js', [join(ROOT, '..', 'client', 'js', 'audio-data.js'), 'text/javascript; charset=utf-8']],
  ['/joan/js/game.js', [join(ROOT, '..', 'client', 'js', 'game.js'), 'text/javascript; charset=utf-8']],
  ['/joan/js/mp-bridge.js', [join(ROOT, '..', 'client', 'js', 'mp-bridge.js'), 'text/javascript; charset=utf-8']],
  ['/account/', [join(ROOT, 'public', 'account.html'), 'text/html; charset=utf-8']],
  ['/account/style.css', [join(ROOT, 'public', 'account.css'), 'text/css; charset=utf-8']],
  ['/account/app.js', [join(ROOT, 'public', 'account.js'), 'text/javascript; charset=utf-8']],
  ['/arena/', [join(ROOT, 'public', 'arena.html'), 'text/html; charset=utf-8']],
  ['/arena/style.css', [join(ROOT, 'public', 'arena.css'), 'text/css; charset=utf-8']],
  ['/arena/app.js', [join(ROOT, 'public', 'arena.js'), 'text/javascript; charset=utf-8']]
]);

const server = http.createServer(async (req, res) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch { res.writeHead(400).end('Bad request'); return; }
  if (authHttp) {
    if (!authHttp.allowedHost(req)) { res.writeHead(403).end('Invalid host'); return; }
    if (await charactersHttp.handle(req, res, pathname)) return;
    if (await authHttp.handle(req, res, pathname)) return;
    if (pathname === '/account') { res.writeHead(308, { location: '/account/' }).end(); return; }
    if (pathname === '/arena') { res.writeHead(308, { location: '/arena/' }).end(); return; }
    if ((pathname === '/joan' || pathname.startsWith('/joan/') ||
         pathname === '/arena' || pathname.startsWith('/arena/')) && !authHttp.sessionFor(req)) {
      res.writeHead(302, { location: '/account/', 'cache-control': 'no-store' }).end(); return;
    }
  } else if (pathname.startsWith('/account') || pathname.startsWith('/arena') || pathname.startsWith('/api/')) {
    res.writeHead(404).end('Not found'); return;
  }
  if (req.method !== 'GET') { res.writeHead(405).end('Method not allowed'); return; }
  if (pathname === '/joan') { res.writeHead(308, { location: '/joan/' }).end(); return; }
  const resource = ASSETS.get(pathname);
  if (!resource) { res.writeHead(404).end('Not found'); return; }
  try {
    const bytes = await readFile(resource[0]);
    res.writeHead(200, {
      'content-type': resource[1],
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(authHttp && (pathname === '/account/' || pathname === '/arena/') ? {
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
      } : {})
    });
    res.end(bytes);
  } catch (error) {
    console.error('File response error:', pathname, error.message);
    res.writeHead(500).end('Server error');
  }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
server.on('upgrade', (request, socket, head) => {
  if (authHttp && (!authHttp.allowedHost(request) || !authHttp.allowedOrigin(request) ||
      !authHttp.sessionFor(request))) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
});
if (authHttp) {
  setInterval(() => {
    for (const client of wss.clients) {
      if (client.authKey && !authHttp.sessionValid(client.authKey)) client.close(1008, 'Session expired');
    }
  }, 5000);
}

const joanPlayers = new Map();
function connectJoan(socket) {
  if (joanPlayers.size >= MAX_PLAYERS) { socket.close(1013, 'Server full'); return; }
  const player = {
    id: 'j' + nextId++, name: 'Hráč', x: 0, y: 0, room: 0, dir: 0, cls: 'warrior',
    active: false, lastUpdate: 0
  };
  joanPlayers.set(socket, player);
  socket.send(JSON.stringify({ type: 'joan-welcome', id: player.id }));
  socket.on('message', bytes => {
    let message;
    try { message = JSON.parse(String(bytes)); } catch { return; }
    if (message?.type !== 'joan-state') return;
    const now = Date.now();
    if (now - player.lastUpdate < 45) return;
    player.lastUpdate = now;
    if (!Number.isInteger(message.room) || message.room < 0 || message.room > 1000) return;
    if (message.active === true &&
      (!Number.isFinite(message.x) || !Number.isFinite(message.y) ||
       message.x < 0 || message.x > 1100 || message.y < 0 || message.y > 660)) return;
    player.room = message.room;
    player.active = message.active === true;
    if (player.active) { player.x = message.x; player.y = message.y; }
    player.name = String(message.name || 'Hráč').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 24);
    player.dir = Number.isFinite(message.dir) && Math.abs(message.dir) < 100 ? message.dir : 0;
    player.cls = ['warrior', 'ninja', 'sura', 'shaman', 'lycan'].includes(message.cls) ? message.cls : 'warrior';
  });
  socket.on('close', () => joanPlayers.delete(socket));
}

// This prototype exchanges visual presence only. Do not treat client coordinates as secure combat state.
setInterval(() => {
  if (!joanPlayers.size) return;
  const all = [...joanPlayers.entries()];
  for (const [socket, viewer] of all) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    const sameRoom = all
      .filter(([, other]) => other.active && other.room === viewer.room)
      .map(([, other]) => ({ id: other.id, name: other.name, x: other.x, y: other.y, dir: other.dir, cls: other.cls }));
    socket.send(JSON.stringify({
      type: 'joan-peers',
      count: viewer.active ? sameRoom.length : 0,
      players: sameRoom.filter(p => p.id !== viewer.id)
    }));
  }
}, 125);

function broadcast(payload) {
  const text = JSON.stringify(payload);
  for (const client of players.keys()) if (client.readyState === WebSocket.OPEN) client.send(text);
}
const clamp = (value, max) => Math.max(0, Math.min(max, value));
wss.on('connection', (socket, request) => {
  if (authHttp) socket.authKey = authHttp.sessionFor(request)?.key;
  if (request.url?.startsWith('/combat-ws')) {
    if (!combatArena) { socket.close(1008, 'Private arena only'); return; }
    void combatArena.connect(socket, request, authHttp.sessionFor(request));
    return;
  }
  if (request.url === '/joan-ws') { connectJoan(socket); return; }
  if (request.url !== '/') { socket.close(1008, 'Unknown WebSocket path'); return; }
  if (players.size >= MAX_PLAYERS) {
    socket.close(1013, 'Server full');
    return;
  }
  const id = String(nextId++);
  const player = { id, x: 90 + ((Number(id) - 1) % 8) * 75, y: 120, input: { x: 0, y: 0 } };
  players.set(socket, player);
  socket.send(JSON.stringify({ type: 'welcome', id, world: { width: WIDTH, height: HEIGHT } }));
  broadcast({ type: 'snapshot', players: [...players.values()].map(({id, x, y}) => ({id, x, y})) });
  socket.on('message', data => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg?.type !== 'input' || !Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
    const length = Math.hypot(msg.x, msg.y);
    player.input = length > 0 ? { x: msg.x / Math.max(1, length), y: msg.y / Math.max(1, length) } : {x:0,y:0};
  });
  socket.on('close', () => {
    players.delete(socket);
    broadcast({ type: 'snapshot', players: [...players.values()].map(({id, x, y}) => ({id, x, y})) });
  });
});
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!players.size) return;
  for (const player of players.values()) {
    player.x = clamp(player.x + player.input.x * SPEED * dt, WIDTH);
    player.y = clamp(player.y + player.input.y * SPEED * dt, HEIGHT);
  }
  broadcast({ type: 'snapshot', players: [...players.values()].map(({id, x, y}) => ({id, x, y})) });
}, 50);
server.listen(PORT, HOST, () => {
  console.log('Joan multiplayer prototype: http://' + HOST + ':' + PORT + '/joan/');
  if (AUTH_ENABLED) console.log('Private account test: http://' + HOST + ':' + PORT + '/account/');
});
