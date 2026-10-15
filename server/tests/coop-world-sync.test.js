import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCoopWorldSync, cleanCoopWorld } from '../coop-world-sync.js';

function mob(id, hp = 12, dead = false) {
  return { id, type: 'dog', x: 300, y: 270, hp, maxHp: 12,
    dead, inventory: [{ id: 'PRIVATE' }], homeX: 300, homeY: 270 };
}
function world(id, cycle = 1, hp = 12, remaining = 0) {
  return { cycle, clear: hp <= 0, remaining,
    mobs: [mob(id, hp, hp <= 0)], stones: [] };
}
function peers(rows) {
  return new Map(rows.map(([id, room]) => [id, { id, room, active: true }]));
}
test('every world map has its own owner, mob state and timer', () => {
  let now = 100000;
  const state = createCoopWorldSync(() => now);
  const players = peers([['a', 1], ['b', 1], ['c', 2]]);
  assert.equal(state.owner(1, players), 'a');
  assert.equal(state.owner(2, players), 'c');
  assert.equal(state.publish(1, 'b', world(7), players), null, 'follower cannot publish');
  assert.equal(state.publish(1, 'a', world(7), players).world.mobs[0].id, 7);
  state.publish(2, 'c', world(12), players);
  assert.equal(state.get(2).world.mobs[0].id, 12);
  state.publish(1, 'a', world(7, 1, 0, 25), players);
  assert.equal(state.get(1).respawnRemaining, 25);
  now += 26000;
  assert.equal(state.get(1).respawnDue, true);
  assert.equal(state.get(2).respawnDue, false);
  state.publish(1, 'a', world(99, 2), players);
  assert.equal(state.get(1).respawnDue, false);
  assert.equal(state.get(1).respawnRemaining, null);
});
test('owner transfer after departure retains the room snapshot', () => {
  const state = createCoopWorldSync(() => 5000);
  const both = peers([['a', 5], ['b', 5]]);
  state.publish(5, 'a', world(80), both);
  const guestOnly = peers([['b', 5]]);
  assert.equal(state.owner(5, guestOnly), 'b');
  assert.equal(state.get(5).world.mobs[0].id, 80);
  state.publish(5, 'b', world(80, 1, 4), guestOnly);
  assert.equal(state.get(5).world.mobs[0].hp, 4);
});
test('scrubbing rejects invalid and oversized snapshots and leaks no inventory', () => {
  assert.equal(cleanCoopWorld({ ...world(1), mobs: [{ ...mob(1), hp: Infinity }] }), null);
  assert.equal(cleanCoopWorld({ ...world(1), mobs: Array.from({ length: 150 }, (_, i) => mob(i)) }), null);
  assert.equal(cleanCoopWorld({ ...world(1), mobs: [mob(1), mob(1)] }), null);
  const state = cleanCoopWorld(world(1));
  assert.equal(state.mobs[0].type, 'dog');
  assert.ok(!JSON.stringify(state).includes('PRIVATE'));
  assert.ok(!Object.hasOwn(state.mobs[0], 'inventory'));
});
