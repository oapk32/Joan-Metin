import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = 33500 + Math.floor(Math.random() * 12000);
const base = 'http://127.0.0.1:' + port;
const wsBase = 'ws://127.0.0.1:' + port;

async function waitFor(predicate, limit = 6000) {
  const started = Date.now();
  while (Date.now() - started < limit) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 55));
  }
  throw new Error('Timed out waiting for server state');
}

test('Joan multiplayer: serves original client and broadcasts player class, location and room', async t => {
  const server = spawn(process.execPath, [join(root, 'index.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), JOAN_BIND_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let errors = '';
  server.stderr.on('data', chunk => { errors += String(chunk); });
  t.after(() => { server.kill(); });
  await waitFor(async () => {
    if (server.exitCode !== null) throw new Error('Server terminated: ' + errors);
    try {
      const r = await fetch(base + '/joan/');
      return r.status === 200;
    } catch { return false; }
  });

  const client = await fetch(base + '/joan/js/mp-bridge.js');
  assert.equal(client.status, 200);
  assert.match(await client.text(), /JoanMP/);

  const a = new WebSocket(wsBase + '/joan-ws');
  const b = new WebSocket(wsBase + '/joan-ws');
  t.after(() => { a.terminate(); b.terminate(); });
  const receivedA = [];
  const receivedB = [];
  a.on('message', b => { try { receivedA.push(JSON.parse(String(b))); } catch {} });
  b.on('message', b => { try { receivedB.push(JSON.parse(String(b))); } catch {} });
  await Promise.all([once(a, 'open'), once(b, 'open')]);
  a.send(JSON.stringify({ type: 'joan-state', active: true, room: 0, x: 220, y: 330, cls: 'warrior', dir: 0.7, name: 'Kovár' }));
  b.send(JSON.stringify({ type: 'joan-state', active: true, room: 0, x: 300, y: 330, cls: 'ninja', dir: 1.1, name: 'Ninja' }));
  await waitFor(() => receivedA.some(m => m.type === 'joan-peers' && m.players.some(p => p.name === 'Ninja' && p.cls === 'ninja' && p.x === 300)));
  await waitFor(() => receivedB.some(m => m.type === 'joan-peers' && m.players.some(p => p.name === 'Kovár' && p.cls === 'warrior')));
  await new Promise(resolve => setTimeout(resolve, 70));
  b.send(JSON.stringify({ type: 'joan-state', active: true, room: 1, x: 300, y: 330, cls: 'ninja', dir: 1.1, name: 'Ninja' }));
  receivedA.length = 0;
  await waitFor(() => receivedA.some(m => m.type === 'joan-peers' && m.players.length === 0 && m.count === 1));
});
