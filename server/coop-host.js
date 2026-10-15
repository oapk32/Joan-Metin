// Local-only CO-OP host. This preview shares characters' presence, not saves or combat.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createAudioAssets } from './audio-assets.js';

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
let nextId = 1, hostId = null;
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
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
    if (!file.startsWith(CLIENT + '/')) return res.writeHead(403).end();
    const headers = { 'content-type': MIME[rel.split('.').pop()], 'cache-control': 'private, max-age=600' };
    if (path === '/coop/js/game.js') {
      const src = await readFile(file, 'utf8');
      // Optimize only this CO-OP endpoint; singleplayer asset remains untouched.
      const needle = 'want = clamp(((r.width || W) * dpr) / W, 1, 2);';
      if (src.split(needle).length !== 2) throw Error('Renderer patch no longer matches game.js');
      const body = src.replace(needle, 'want = clamp(((r.width || W) * dpr) / W, 1, 1);');
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
wss.on('connection', socket => {
  const id = String(nextId++);
  const isHost = hostId === null;
  if (isHost) hostId = id;
  const state = { id, active: false, room: 0, x: 0, y: 0, dir: 0, name: '', cls: 'warrior', level: 1, last: 0 };
  peers.set(socket, state);
  send(socket, { type: 'welcome', id, host: isHost, max: 4 });
  broadcast({ type: 'count', count: peers.size });
  socket.on('message', bytes => {
    if (bytes.length > 1024) return;
    let msg;
    try { msg = JSON.parse(String(bytes)); } catch { return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    if (msg.type === 'ping' && Number.isSafeInteger(msg.t)) return send(socket, { type: 'pong', t: msg.t });
    if (msg.type !== 'state' || Date.now() - state.last < 40) return;
    if (typeof msg.active !== 'boolean' ||
        !Number.isInteger(msg.room) || msg.room < 0 || msg.room > 120 ||
        !Number.isFinite(msg.x) || msg.x < 0 || msg.x > 1100 ||
        !Number.isFinite(msg.y) || msg.y < 0 || msg.y > 660 ||
        !Number.isFinite(msg.dir) || Math.abs(msg.dir) > 7 ||
        !['warrior', 'ninja', 'sura', 'shaman'].includes(msg.cls) ||
        !Number.isInteger(msg.level) || msg.level < 1 || msg.level > 200 ||
        typeof msg.name !== 'string' || msg.name.length > 24) return;
    state.last = Date.now();
    Object.assign(state, { active: msg.active, room: msg.room, x: msg.x, y: msg.y,
      dir: msg.dir, cls: msg.cls, level: msg.level,
      name: msg.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 24) });
  });
  socket.on('close', () => {
    peers.delete(socket);
    if (id === hostId) closeRoom();
    else broadcast({ type: 'count', count: peers.size });
  });
});
const timer = setInterval(() => {
  for (const [socket, viewer] of peers) {
    const players = [];
    for (const other of peers.values()) if (other.id !== viewer.id &&
        other.active && other.room === viewer.room) {
      players.push({ id: other.id, x: other.x, y: other.y, dir: other.dir,
        name: other.name, cls: other.cls, level: other.level });
    }
    send(socket, { type: 'peers', players, count: peers.size });
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
