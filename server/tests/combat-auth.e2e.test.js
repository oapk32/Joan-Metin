import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import WebSocket from 'ws';

async function waitFor(predicate, limit = 9000) {
  const start = Date.now();
  while (Date.now() - start < limit) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 55));
  }
  throw new Error('Timed out waiting for private combat integration');
}

test('PostgreSQL/private auth: owned characters join one shared combat arena', {
  skip: !process.env.JOAN_TEST_DATABASE_URL
}, async t => {
  const url = new URL(process.env.JOAN_TEST_DATABASE_URL);
  const port = 39000 + Math.floor(Math.random() * 14000);
  const base = 'http://127.0.0.1:' + port;
  const wsBase = 'ws://127.0.0.1:' + port;
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const server = spawn(process.execPath, [join(root, 'index.js')], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      JOAN_AUTH_ENABLED: '1',
      JOAN_BIND_HOST: '127.0.0.1',
      PGHOST: '127.0.0.1',
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.slice(1)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  server.stderr.on('data', data => { stderr += String(data); });
  t.after(() => { server.kill(); });
  await waitFor(async () => {
    if (server.exitCode !== null) throw new Error('Node server exited: ' + stderr);
    try { return (await fetch(base + '/account/')).status === 200; }
    catch { return false; }
  });

  async function createAccount(suffix) {
    const username = 'arena_' + randomBytes(5).toString('hex') + suffix;
    const password = 'very_private_test_password_only';
    const response = await fetch(base + '/api/register', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    assert.equal(response.status, 201);
    return response.headers.get('set-cookie').split(';')[0];
  }

  async function character(cookie, suffix) {
    const name = 'Hrdina' + randomBytes(5).toString('hex') + suffix;
    const response = await fetch(base + '/api/characters', {
      method: 'POST',
      headers: { origin: base, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name, class: 'warrior' })
    });
    assert.equal(response.status, 201);
    return (await response.json()).character.id;
  }

  const cookieA = await createAccount('a');
  const cookieB = await createAccount('b');
  const idA = await character(cookieA, 'A');
  const idB = await character(cookieB, 'B');

  const denied = await fetch(base + '/arena/', { redirect: 'manual' });
  assert.equal(denied.status, 302);
  const admitted = await fetch(base + '/arena/', { headers: { cookie: cookieA } });
  assert.equal(admitted.status, 200);

  function connect(id, cookie) {
    const socket = new WebSocket(wsBase + '/combat-ws?character=' + id, {
      headers: { Cookie: cookie, Origin: base }
    });
    return socket;
  }

  const alice = connect(idA, cookieA);
  const bob = connect(idB, cookieB);
  t.after(() => { alice.terminate(); bob.terminate(); });
  const receivedA = [], receivedB = [];
  alice.on('message', data => receivedA.push(JSON.parse(String(data))));
  bob.on('message', data => receivedB.push(JSON.parse(String(data))));
  await Promise.all([once(alice, 'open'), once(bob, 'open')]);
  await waitFor(() => receivedA.some(m => m.type === 'combat-snapshot' && m.players.length === 2) &&
                     receivedB.some(m => m.type === 'combat-snapshot' && m.players.length === 2));
  const shared = receivedA.find(m => m.type === 'combat-snapshot' && m.players.length === 2);
  assert.ok(shared.players.some(p => p.id === idA));
  assert.ok(shared.players.some(p => p.id === idB));
  assert.equal(shared.mobs.length, 3);

  alice.send(JSON.stringify({ type: 'combat-attack', mobId: 'wolf-1', damage: 9999999 }));
  await waitFor(() => receivedA.some(m => m.type === 'combat-hit'));
  assert.equal(receivedA.find(m => m.type === 'combat-hit').reason, 'out_of_range');

  const stolen = connect(idA, cookieB);
  t.after(() => stolen.terminate());
  await once(stolen, 'open');
  const [code] = await once(stolen, 'close');
  assert.equal(code, 1008);
});
