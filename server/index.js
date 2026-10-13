import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

const HOST = '127.0.0.1'; // local-only proof of concept
const PORT = Number(process.env.PORT || 3000);
const ROOT = dirname(fileURLToPath(import.meta.url));
const WIDTH = 900;
const HEIGHT = 550;
const SPEED = 225; // authoritative units per second
const MAX_PLAYERS = 30;
const players = new Map();
let nextId = 1;

const server = http.createServer(async (req, res) => {
  if (req.url !== '/' && req.url !== '/index.html') {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const html = await readFile(join(ROOT, 'public', 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  } catch {
    res.writeHead(500).end('Server error');
  }
});
const wss = new WebSocketServer({ server, maxPayload: 1024 });
function broadcast(payload) {
  const text = JSON.stringify(payload);
  for (const client of players.keys()) if (client.readyState === WebSocket.OPEN) client.send(text);
}
const clamp = (value, max) => Math.max(0, Math.min(max, value));
wss.on('connection', socket => {
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
server.listen(PORT, HOST, () => console.log('Joan multiplayer prototype: http://' + HOST + ':' + PORT));
