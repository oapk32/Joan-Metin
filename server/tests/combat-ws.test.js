import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { startCombatArena } from '../combat-ws.js';
import { createCombatWorld } from '../combat-world.js';

async function waitFor(predicate, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Timed out waiting for combat arena state');
}

test('Shared WebSocket arena verifies character ownership and ignores arbitrary client economy', async t => {
  const lookups = [];
  const arena = startCombatArena({
    loadCharacter: async (accountId, id) => {
      lookups.push([accountId, id]);
      if (accountId !== '10') return null;
      if (id === '1') return { id, name: 'Alice', class: 'warrior' };
      if (id === '2') return { id, name: 'Bob', class: 'ninja' };
      return null;
    }
  });
  t.after(() => arena.stop());

  const server = createServer((req, res) => res.writeHead(404).end());
  const wss = new WebSocketServer({ server, maxPayload: 1024 });
  wss.on('connection', (socket, req) => { void arena.connect(socket, req, { account: { id: '10' } }); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { wss.close(); server.close(); });
  const base = 'ws://127.0.0.1:' + server.address().port;

  const alice = new WebSocket(base + '/combat-ws?character=1');
  const bob = new WebSocket(base + '/combat-ws?character=2');
  t.after(() => { alice.terminate(); bob.terminate(); });
  const messagesA = [], messagesB = [];
  alice.on('message', bytes => { messagesA.push(JSON.parse(String(bytes))); });
  bob.on('message', bytes => { messagesB.push(JSON.parse(String(bytes))); });
  await Promise.all([once(alice, 'open'), once(bob, 'open')]);
  await waitFor(() => messagesA.some(x => x.type === 'combat-welcome') &&
                      messagesB.some(x => x.type === 'combat-welcome'));
  await waitFor(() => messagesA.some(x => x.type === 'combat-snapshot' && x.players.length === 2));
  assert.deepEqual(lookups.sort(), [['10', '1'], ['10', '2']]);
  const first = messagesA.find(x => x.type === 'combat-snapshot' && x.players.length === 2);
  assert.equal(first.mobs.length, 2); // remote orc is hidden by spatial interest filtering
  assert.equal(first.mobs.some(m => m.id === 'orc-1'), false);
  // Moving players are transmitted as deltas, not full monster snapshots.
  alice.send(JSON.stringify({ type: 'combat-input', x: 1, y: 0 }));
  await waitFor(() => messagesA.some(m => m.type === 'combat-delta' &&
    m.playersChanged.some(p => p.id === '1' && p.x > 115)));
  alice.send(JSON.stringify({ type: 'combat-input', x: 0, y: 0 }));
  assert.ok(messagesA.filter(m => m.type === 'combat-delta')
    .every(m => !Object.hasOwn(m, 'personalDrops')));

  alice.send(JSON.stringify({ type: 'combat-input', x: 1, y: 0, teleport: [900, 500], yang: 999999 }));
  alice.send(JSON.stringify({ type: 'combat-attack', mobId: 'wolf-1', damage: 999999, xp: 999999 }));
  await waitFor(() => messagesA.some(x => x.type === 'combat-hit'));
  assert.equal(messagesA.find(x => x.type === 'combat-hit').reason, 'out_of_range');
  const next = arena.world.snapshot();
  assert.equal(next.players.find(x => x.id === '1').yang, 0);
  assert.equal(next.mobs.find(x => x.id === 'wolf-1').hp, 70);

  const third = new WebSocket(base + '/combat-ws?character=1');
  t.after(() => third.terminate());
  await once(third, 'open');
  const [code] = await once(third, 'close');
  assert.equal(code, 1008); // duplicate character is denied

  const stolen = new WebSocket(base + '/combat-ws?character=999');
  t.after(() => stolen.terminate());
  await once(stolen, 'open');
  const [stolenCode] = await once(stolen, 'close');
  assert.equal(stolenCode, 1008);
});


test('Private drop data is never broadcast to another WebSocket viewer', async t => {
  const world = createCombatWorld({ random: () => 0.01 });
  const originalJoin = world.join;
  world.join = character => {
    const player = originalJoin(character);
    if (player) { player.x = 440; player.y = 160; }
    return player;
  };
  const arena = startCombatArena({
    world,
    loadCharacter: async (_owner, id) =>
      ({ id, name: 'Hero' + id, class: 'warrior' })
  });
  t.after(() => arena.stop());

  const server = createServer((req, res) => res.writeHead(404).end());
  const wss = new WebSocketServer({ server, maxPayload: 1024 });
  wss.on('connection', (socket, req) =>
    void arena.connect(socket, req, { account: { id: '10' } }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { wss.close(); server.close(); });
  const url = 'ws://127.0.0.1:' + server.address().port;
  const a = new WebSocket(url + '/combat-ws?character=1');
  const b = new WebSocket(url + '/combat-ws?character=2');
  t.after(() => { a.terminate(); b.terminate(); });
  const incomingA = [], incomingB = [];
  a.on('message', data => incomingA.push(JSON.parse(String(data))));
  b.on('message', data => incomingB.push(JSON.parse(String(data))));
  await Promise.all([once(a, 'open'), once(b, 'open')]);
  await waitFor(() => incomingA.some(m => m.type === 'combat-snapshot' && m.players.length === 2));

  // Use epoch time: the live arena's periodic clock also uses Date.now().
  const now = Date.now();
  world.attack('1', 'wolf-1', now);
  world.attack('2', 'wolf-1', now);
  world.attack('1', 'wolf-1', now + 550);
  world.attack('2', 'wolf-1', now + 550);
  const aliceDrop = world.snapshot('1').personalDrops[0];
  const bobDrop = world.snapshot('2').personalDrops[0];
  assert.ok(aliceDrop && bobDrop);
  assert.notEqual(aliceDrop.id, bobDrop.id);

  await waitFor(() => incomingA.some(m => m.type === 'combat-loot' &&
    m.personalDrops?.some(d => d.id === aliceDrop.id)) &&
    incomingB.some(m => m.type === 'combat-loot' &&
    m.personalDrops?.some(d => d.id === bobDrop.id)));
  assert.ok(incomingA.every(m => !m.personalDrops?.some(d => d.id === bobDrop.id)));
  assert.ok(incomingB.every(m => !m.personalDrops?.some(d => d.id === aliceDrop.id)));
  assert.ok(incomingA.filter(m => m.type === 'combat-snapshot')
    .every(m => !Object.hasOwn(m, 'personalDrops') && !Object.hasOwn(m, 'testInventory')));
  const sentLootCount = incomingA.filter(m => m.type === 'combat-loot').length;
  await new Promise(resolve => setTimeout(resolve, 280));
  assert.equal(incomingA.filter(m => m.type === 'combat-loot').length, sentLootCount,
    'Unchanged item lists must not be re-sent on every movement tick');

  b.send(JSON.stringify({ type: 'combat-pickup', dropId: aliceDrop.id }));
  await waitFor(() => incomingB.some(m => m.type === 'combat-pickup-result'));
  assert.equal(incomingB.find(m => m.type === 'combat-pickup-result').reason, 'not_owned_or_expired');
  a.send(JSON.stringify({ type: 'combat-pickup', dropId: aliceDrop.id }));
  await waitFor(() => incomingA.some(m => m.type === 'combat-pickup-result' && m.ok));
  assert.equal(world.snapshot('1').testInventory.length, 1);
  assert.equal(world.snapshot('2').testInventory.length, 0);
});
