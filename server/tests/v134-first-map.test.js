import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { JOAN_EDGE, JOAN_EDGE_MOBS, createJoanEdgeWorld } from '../v134-first-map.js';
import { createSectorIndex } from '../combat-interest.js';
import { startCombatArena } from '../combat-ws.js';

const hero = (id, name) => ({ id, name, class: 'warrior' });
const byId = (world, id) => world.snapshot().mobs.find(m => m.id === id);

test('v134 Joan 1–2 defines five dogs and five wolves, one shared world', () => {
  assert.equal(JOAN_EDGE.roomIndex, 1);
  assert.equal(JOAN_EDGE_MOBS.length, 10);
  assert.equal(JOAN_EDGE_MOBS.filter(m => m.type === 'dog').length, 5);
  assert.equal(JOAN_EDGE_MOBS.filter(m => m.type === 'wolf').length, 5);
  assert.equal(new Set(JOAN_EDGE_MOBS.map(m => m.id)).size, 10);
  const world = createJoanEdgeWorld();
  const a = world.join(hero('1','Alice'));
  const b = world.join(hero('2','Bob'));
  assert.equal(a.mapId, JOAN_EDGE.mapId);
  assert.equal(b.mapId, JOAN_EDGE.mapId);
  assert.equal(a.x, 140);
  assert.equal(a.y, 330);
  const state = world.snapshotWorld();
  assert.deepEqual([state.width, state.height], [1100,660]);
  assert.equal(state.mobs.length, 10);
  assert.ok(state.mobs.every(m => m.mapId === JOAN_EDGE.mapId));
  assert.ok(state.mobs.some(m => m.type === 'wolf'));
  const visible = createSectorIndex(state).select(a.id);
  assert.ok(visible.mobs.length > 0 && visible.mobs.length < 10,
    'AOI does not broadcast the whole v134 region to each player');
  assert.equal(world.join(hero('1','duplicate')), null);
});

test('Joan first-map shared damage, anti-teleport, respawn and private ground loot', () => {
  const world = createJoanEdgeWorld({ random: () => 0.01 });
  const alice = world.join(hero('1','Alice'));
  const bob = world.join(hero('2','Bob'));
  const mob = byId(world, 'joan-wolf-1');
  assert.equal(mob.maxHp, 90);
  alice.x = mob.x; alice.y = mob.y;
  bob.x = mob.x; bob.y = mob.y;
  assert.equal(world.setInput('1', { x: 9000, y: 0 }), false);
  assert.equal(world.attack('1', mob.id, 1000).ok, true);
  assert.equal(world.attack('2', mob.id, 1000).ok, true);
  assert.equal(byId(world, mob.id).hp, 52);
  assert.equal(world.attack('2', mob.id, 1001).reason, 'cooldown');
  assert.equal(world.attack('1', mob.id, 1550).ok, true);
  assert.equal(world.attack('2', mob.id, 1550).ok, true);
  assert.equal(world.attack('1', mob.id, 2100).ok, true);
  const kill = world.attack('2', mob.id, 2100);
  assert.equal(kill.defeated, true);
  assert.deepEqual(kill.awarded.sort(), ['1','2']);
  assert.equal(byId(world, mob.id).hp, 0);
  const lootA = world.personalLootState('1');
  const lootB = world.personalLootState('2');
  assert.equal(lootA.personalDrops.length, 1);
  assert.equal(lootB.personalDrops.length, 1);
  assert.notEqual(lootA.personalDrops[0].id, lootB.personalDrops[0].id);
  assert.equal(world.pickUp('2', lootA.personalDrops[0].id, 2200).reason, 'not_owned_or_expired');
  assert.equal(world.pickUp('1', lootA.personalDrops[0].id, 2200).ok, true);
  assert.equal(world.personalLootState('1').testInventory.length, 1);
  world.step(.05, 8101);
  assert.equal(byId(world, mob.id).hp, 90, 'shared wolf respawns once');
  world.step(.05, 122101);
  assert.equal(world.personalLootState('2').personalDrops.length, 0, 'private loot expires after 120 s');
  assert.ok(world.transferPlayerMap('1', 'other-map') === false);
  world.setInput('1', { x: 1, y: 1, mapId: 'other-map', teleportX: 99999 });
  world.step(.05, 122151);
  assert.equal(alice.mapId, JOAN_EDGE.mapId);
  assert.ok(alice.x <= JOAN_EDGE.width && alice.y <= JOAN_EDGE.height);
});

async function waitFor(fn, timeout = 4000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for first-map WebSocket');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test('v134 first-map WebSocket requires owned character, uses shared HP and rejects wrong path', async t => {
  const world = createJoanEdgeWorld();
  const zone = startCombatArena({
    socketPath: '/v134-ws', world,
    loadCharacter: async (accountId,id) => accountId === '10' && ['1','2'].includes(id)
      ? hero(id, 'Hero'+id) : null
  });
  t.after(() => zone.stop());
  const server = createServer((_req,res) => res.writeHead(404).end());
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket, request) => {
    void zone.connect(socket, request, { account: { id:'10' } });
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(() => { wss.close(); server.close(); });
  const base = 'ws://127.0.0.1:' + server.address().port;
  const a = new WebSocket(base+'/v134-ws?character=1');
  const b = new WebSocket(base+'/v134-ws?character=2');
  const receivedA = [], receivedB = [];
  a.on('message', m => receivedA.push(JSON.parse(String(m))));
  b.on('message', m => receivedB.push(JSON.parse(String(m))));
  t.after(() => { a.terminate(); b.terminate(); });
  await Promise.all([once(a,'open'),once(b,'open')]);
  await waitFor(() => receivedA.some(m => m.type === 'combat-snapshot' && m.players.length === 2));
  const initial = receivedA.find(m => m.type === 'combat-snapshot' && m.players.length === 2);
  assert.equal(initial.width, 1100);
  assert.equal(initial.height, 660);
  assert.ok(initial.mobs.every(m => ['dog','wolf'].includes(m.type)));
  assert.equal(initial.players[0].mapId, JOAN_EDGE.mapId);
  const refused = new WebSocket(base+'/v134-ws?character=999');
  t.after(() => refused.terminate());
  await once(refused,'open');
  assert.equal((await once(refused,'close'))[0], 1008);
  const wrong = new WebSocket(base+'/combat-ws?character=1');
  t.after(() => wrong.terminate());
  await once(wrong,'open');
  assert.equal((await once(wrong,'close'))[0], 1008);
  // A real shared mutation is reported to both viewers through their AOI.
  const wolf = initial.mobs.find(m => m.id === 'joan-wolf-1');
  const selfA = world.snapshotWorld().players.find(p => p.id === '1');
  assert.ok(selfA);
  world.transferPlayerMap('1', JOAN_EDGE.mapId, wolf.x, wolf.y);
  await waitFor(() => receivedA.some(m => m.type === 'combat-delta' &&
    [...m.mobsAdded,...m.mobsChanged].some(x => x.id === wolf.id)));
  const before = byId(world, wolf.id).hp;
  assert.equal(world.attack('1',wolf.id,Date.now()).ok,true);
  await waitFor(() => receivedB.some(m => m.type === 'combat-delta' &&
    m.mobsChanged.some(x => x.id === wolf.id && x.hp < before)));
  assert.ok(receivedA.every(m => !Object.hasOwn(m,'personalDrops')) ||
    receivedA.some(m => m.type === 'combat-loot'), 'personal loot only uses dedicated message');
});
