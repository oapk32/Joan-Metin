import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createCharactersHttp } from '../characters-http.js';
import { CharacterError } from '../characters.js';

test('Character HTTP rejects anonymous, cross-account and browser progress writes', async t => {
  const rows = new Map([
    ['11', { id: '11', accountId: '1', name: 'JoanWarrior' }],
    ['22', { id: '22', accountId: '2', name: 'OtherNinja' }]
  ]);
  const records = [];
  let api;
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (await api.handle(req, res, pathname)) return;
    res.writeHead(404).end('Not found');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const origin = 'http://127.0.0.1:' + server.address().port;
  const headers = { cookie: 'test=A', origin, 'content-type': 'application/json' };
  api = createCharactersHttp({
    sessionFor: req => req.headers.cookie === 'test=A' ? { account: { id: '1' } } : null,
    allowedOrigin: req => req.headers.origin === origin,
    async list(accountId) {
      records.push({ method: 'list', accountId });
      return [...rows.values()].filter(row => row.accountId === accountId);
    },
    async get(accountId, id) {
      records.push({ method: 'get', accountId, id });
      const row = rows.get(id);
      return row && row.accountId === accountId ? row : null;
    },
    async create(accountId, payload) {
      records.push({ method: 'create', accountId, payload });
      if (payload.name === 'JoanWarrior') throw new CharacterError('duplicate_name');
      const row = { id: '33', accountId, name: payload.name, class: payload.cls };
      rows.set(row.id, row);
      return row;
    }
  });

  const request = (path, options = {}) => fetch(origin + path, { redirect: 'manual', ...options });

  const anonymous = await request('/api/characters');
  assert.equal(anonymous.status, 401);
  const listing = await request('/api/characters', { headers });
  assert.equal(listing.status, 200);
  assert.deepEqual((await listing.json()).characters.map(row => row.id), ['11']);

  const forbidden = await request('/api/characters/22', { headers });
  assert.equal(forbidden.status, 404);
  const own = await request('/api/characters/11', { headers });
  assert.equal(own.status, 200);

  const blockedSave = await request('/api/characters/11', {
    method: 'PATCH', headers, body: JSON.stringify({ yang: 9999999 })
  });
  assert.equal(blockedSave.status, 405);
  const blockedPut = await request('/api/characters/11', {
    method: 'PUT', headers, body: JSON.stringify({ level: 120 })
  });
  assert.equal(blockedPut.status, 405);

  const wrongOrigin = await request('/api/characters', {
    method: 'POST', headers: { ...headers, origin: 'http://evil.example' },
    body: JSON.stringify({ name: 'NewHero', class: 'warrior' })
  });
  assert.equal(wrongOrigin.status, 403);
  const badBody = await request('/api/characters', {
    method: 'POST', headers, body: JSON.stringify({ name: 'NewHero', class: 'warrior', yang: 1000 })
  });
  assert.equal(badBody.status, 400);
  const created = await request('/api/characters', {
    method: 'POST', headers, body: JSON.stringify({ name: 'NewHero', class: 'warrior' })
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).character.id, '33');
  assert.ok(records.every(call => call.accountId === '1'));
  assert.equal(records.some(call => call.method === 'get' && call.id === '22'), true);
});
