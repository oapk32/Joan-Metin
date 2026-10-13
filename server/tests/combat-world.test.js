import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatWorld, ARENA, ATTACK_RANGE, PERSONAL_LOOT_LIFETIME_MS, ACTIVE_TARGET_SCAN_MS, IDLE_TARGET_SCAN_MS } from '../combat-world.js';

const hero = (id, name, cls = 'warrior') => ({ id, name, class: cls });

test('Arena holds one shared population and limits duplicate characters to one connection', () => {
  const world = createCombatWorld();
  const a = world.join(hero('1', 'Válečník'));
  const b = world.join(hero('2', 'Ninja', 'ninja'));
  assert.ok(a);
  assert.ok(b);
  assert.equal(world.join(hero('1', 'Duplicate')), null);
  assert.equal(world.snapshot().players.length, 2);
  assert.equal(world.snapshot().mobs.length, 3);
  world.leave('1');
  assert.equal(world.snapshot().players.length, 1);
  assert.ok(world.join(hero('1', 'Zpátky')));
});

test('Server movement accepts only normalized inputs, not claimed coordinates or speed', () => {
  const world = createCombatWorld();
  const p = world.join(hero('1', 'Alice'));
  const original = p.x;
  assert.equal(world.setInput('1', { x: 10000, y: 0 }), false);
  assert.equal(world.setInput('1', { x: NaN, y: 0 }), false);
  assert.equal(world.setInput('1', { x: 1, y: 0, teleportTo: 899, speed: 100000 }), true);
  world.step(0.05, 1000);
  assert.equal(p.x, original + ARENA.playerSpeed * 0.05);
  assert.equal(world.setInput('1', { x: 1, y: 1 }), true);
  world.step(0.05, 1050);
  assert.ok(p.x < original + ARENA.playerSpeed * 0.1);
  world.step(1000, 1100); // capped elapsed time: cannot teleport after a lag spike
  assert.ok(p.x < original + ARENA.playerSpeed * 0.2);
});

test('Only in-range server-timed attacks change shared monster HP', () => {
  const world = createCombatWorld();
  const p1 = world.join(hero('1', 'Alice'));
  const p2 = world.join(hero('2', 'Bob', 'ninja'));
  const initial = world.snapshot().mobs.find(m => m.id === 'wolf-1');
  assert.equal(world.attack('1', 'wolf-1', 1000).reason, 'out_of_range');
  assert.equal(world.attack('1', 'missing', 1000).reason, 'invalid_target');
  assert.equal(world.snapshot().mobs.find(m => m.id === 'wolf-1').hp, initial.hp);
  p1.x = initial.x; p1.y = initial.y;
  p2.x = initial.x; p2.y = initial.y;

  const hit = world.attack('1', 'wolf-1', 2000);
  assert.equal(hit.ok, true);
  assert.equal(hit.damage, 19);
  assert.equal(world.snapshot().mobs.find(m => m.id === 'wolf-1').hp, initial.hp - 19);
  assert.equal(world.attack('1', 'wolf-1', 2001).reason, 'cooldown');
  assert.equal(world.attack('2', 'wolf-1', 2010).damage, 17);
  const next = world.snapshot().mobs.find(m => m.id === 'wolf-1');
  assert.equal(next.hp, initial.hp - 19 - 17);
  assert.ok(Math.hypot(p1.x - p2.x, p1.y - p2.y) <= ATTACK_RANGE);
});

test('Shared PvE kill distributes temporary rewards to recent contributors and respawns', () => {
  const world = createCombatWorld();
  const a = world.join(hero('1', 'Alice'));
  const b = world.join(hero('2', 'Bob'));
  a.x = 440; a.y = 160;
  b.x = 440; b.y = 160;
  assert.equal(world.attack('1', 'wolf-1', 1000).ok, true);
  assert.equal(world.attack('2', 'wolf-1', 1000).ok, true);
  assert.equal(world.attack('1', 'wolf-1', 1550).ok, true);
  const kill = world.attack('2', 'wolf-1', 1550);
  assert.equal(kill.defeated, true);
  assert.deepEqual(kill.awarded.sort(), ['1', '2']);
  assert.equal(a.xp, 14);
  assert.equal(b.yang, 8);
  assert.equal(a.kills, 1);
  assert.equal(world.attack('1', 'wolf-1', 2100).reason, 'mob_dead');
  world.step(0.05, 7549);
  assert.equal(world.snapshot().mobs.find(m => m.id === 'wolf-1').hp, 0);
  world.step(0.05, 7550);
  assert.equal(world.snapshot().mobs.find(m => m.id === 'wolf-1').hp, 70);
});

test('Monsters deal server-calculated damage and dead players respawn after a delay', () => {
  const world = createCombatWorld();
  const p = world.join(hero('1', 'Alice'));
  p.x = 440; p.y = 160; p.hp = 7;
  world.step(0.05, 1300);
  assert.equal(p.hp, 0);
  assert.equal(world.attack('1', 'wolf-1', 1400).reason, 'dead');
  world.step(0.05, 5299);
  assert.equal(p.hp, 0);
  world.step(0.05, 5300);
  assert.equal(p.hp, 100);
  assert.equal(p.x, 115);
});

test('Rewards never come from a client-supplied payload', () => {
  const world = createCombatWorld();
  const p = world.join(hero('1', 'Alice'));
  assert.equal(world.setInput('1', { x: 0, y: 0, xp: 100000, yang: 100000, hp: 999 }), true);
  world.step(0.05, 2000);
  assert.equal(p.xp, 0);
  assert.equal(p.yang, 0);
  assert.equal(p.hp, 100);
});


test('Shared kill rolls loot independently and hides private drops from other players', () => {
  const rolls = [0.10, 0.90]; // Alice wins her roll; Bob does not
  const world = createCombatWorld({ random: () => rolls.shift() });
  const alice = world.join(hero('1', 'Alice'));
  const bob = world.join(hero('2', 'Bob'));
  alice.x = bob.x = 440;
  alice.y = bob.y = 160;
  world.attack('1', 'wolf-1', 1000);
  world.attack('2', 'wolf-1', 1000);
  world.attack('1', 'wolf-1', 1550);
  const kill = world.attack('2', 'wolf-1', 1550);
  assert.deepEqual(kill.awarded.sort(), ['1','2']);
  assert.equal(world.snapshot('1').personalDrops.length, 1);
  assert.equal(world.snapshot('2').personalDrops.length, 0);
  assert.equal(world.snapshot().personalDrops.length, 0);
  assert.equal(world.snapshot('2').testInventory.length, 0);
  const drop = world.snapshot('1').personalDrops[0];
  assert.equal(world.pickUp('2', drop.id, 1600).reason, 'not_owned_or_expired');
  assert.equal(world.snapshot('1').personalDrops.length, 1);
  assert.equal(world.pickUp('1', drop.id, 1600).ok, true);
  assert.equal(world.snapshot('1').personalDrops.length, 0);
  assert.equal(world.snapshot('1').testInventory[0].itemId, 'test-wolf-pelt');
  assert.equal(world.snapshot('2').testInventory.length, 0);
  assert.equal(world.pickUp('1', drop.id, 1601).ok, false);
});

test('Both contributors may independently receive the same private drop', () => {
  const world = createCombatWorld({ random: () => 0.05 });
  const alice = world.join(hero('1', 'Alice'));
  const bob = world.join(hero('2', 'Bob'));
  alice.x = bob.x = 440;
  alice.y = bob.y = 160;
  world.attack('1', 'wolf-1', 1000);
  world.attack('2', 'wolf-1', 1000);
  world.attack('1', 'wolf-1', 1550);
  world.attack('2', 'wolf-1', 1550);
  const aDrop = world.snapshot('1').personalDrops[0];
  const bDrop = world.snapshot('2').personalDrops[0];
  assert.ok(aDrop && bDrop);
  assert.notEqual(aDrop.id, bDrop.id);
  assert.equal(aDrop.itemId, bDrop.itemId);
  assert.equal(world.pickUp('1', bDrop.id, 1600).reason, 'not_owned_or_expired');
  assert.equal(world.pickUp('2', aDrop.id, 1600).reason, 'not_owned_or_expired');
  assert.equal(world.pickUp('1', aDrop.id, 1600).ok, true);
  assert.equal(world.pickUp('2', bDrop.id, 1600).ok, true);
  assert.equal(world.snapshot('1').testInventory.length, 1);
  assert.equal(world.snapshot('2').testInventory.length, 1);
});

test('Private loot cannot be picked up from far away, after expiry, or by disconnected owner', () => {
  const world = createCombatWorld({ random: () => 0.05 });
  const alice = world.join(hero('1', 'Alice'));
  alice.x = 440; alice.y = 160;
  for (const time of [1000,1550,2100,2650]) world.attack('1','wolf-1',time);
  const drop = world.snapshot('1').personalDrops[0];
  assert.ok(drop);
  alice.x = 100; alice.y = 200;
  assert.equal(world.pickUp('1', drop.id, 2700).reason, 'out_of_range');
  alice.x = 440; alice.y = 160;
  assert.equal(PERSONAL_LOOT_LIFETIME_MS, 120000);
  // The last hit created the drop at 2650 ms.
  world.step(0.05, 122649);
  assert.equal(world.snapshot('1').personalDrops.length, 1);
  assert.equal(world.pickUp('1', drop.id, 122650).reason, 'not_owned_or_expired');
  // Cleanup scans at 1 Hz; expiration is always enforced at pickup time.
  world.step(0.05, 123650);
  assert.equal(world.snapshot('1').personalDrops.length, 0);
  world.leave('1');
  assert.equal(world.pickUp('1', drop.id, 123651).reason, 'invalid_drop');
});


test('No arbitrary cap on ground drops or test inventory', () => {
  const manyMobs = Array.from({ length: 40 }, (_, index) => ({
    id: 'tiny-' + index, kind: 'Vlk',
    x: 115, y: 270, hp: 1, speed: 0, attack: 0, xp: 0, yang: 0
  }));
  const world = createCombatWorld({ random: () => 0, mobDefinitions: manyMobs });
  world.join(hero('1', 'Alice'));
  for (let index = 0; index < 40; index++) {
    assert.equal(world.attack('1', 'tiny-' + index, 1000 + 550 * index).ok, true);
  }
  const drops = world.snapshot('1').personalDrops;
  assert.equal(drops.length, 40);
  assert.equal(world.personalLootState('1').revision, 40);
  for (const drop of drops) {
    assert.equal(world.pickUp('1', drop.id, 23000).ok, true);
  }
  assert.equal(world.snapshot('1').personalDrops.length, 0);
  assert.equal(world.snapshot('1').testInventory.length, 40);
  assert.equal(world.personalLootState('1').revision, 80);
});

test('Idle monsters scan less frequently, then wake when a player approaches', () => {
  assert.equal(ACTIVE_TARGET_SCAN_MS, 1000);
  assert.equal(IDLE_TARGET_SCAN_MS, 1000);
  const world = createCombatWorld();
  const player = world.join(hero('1', 'Alice'));
  world.step(0.05, 1000); // player starts far away from wolf-1
  const wolf = world.snapshot().mobs.find(m => m.id === 'wolf-1');
  assert.equal(wolf.hp, 70);
  player.x = wolf.x; player.y = wolf.y;
  world.step(0.05, 1999); // an idle monster remains sleeping between scans
  assert.equal(player.hp, 100);
  world.step(0.05, 2000); // wakes on the next one-second scan
  assert.equal(player.hp, 93);
});

test('Public world snapshots omit private loot, while the owner sees item changes', () => {
  const world = createCombatWorld({
    random: () => 0,
    mobDefinitions: [{ id: 'weak-wolf', kind: 'Vlk', x: 115, y: 270,
      hp: 1, speed: 0, attack: 0, xp: 0, yang: 0 }]
  });
  world.join(hero('1', 'Alice'));
  assert.equal(world.lootVersion('1'), 0);
  assert.equal(world.attack('1', 'weak-wolf', 1000).ok, true);
  assert.equal(world.lootVersion('1'), 1);
  assert.equal(Object.hasOwn(world.snapshotWorld(), 'personalDrops'), false);
  assert.equal(Object.hasOwn(world.snapshotWorld(), 'testInventory'), false);
  assert.equal(world.personalLootState('1').personalDrops.length, 1);
  assert.equal(world.personalLootState('not-an-owner').personalDrops.length, 0);
});

test('Dormant monsters wake on valid incoming damage without scanning every player', () => {
  const world = createCombatWorld();
  const player = world.join(hero('1', 'Alice'));
  world.step(0.05, 1000);
  player.x = 440; player.y = 160;
  const hit = world.attack('1', 'wolf-1', 1100);
  assert.equal(hit.ok, true);
  world.step(0.05, 1150);
  assert.equal(player.hp, 93, 'a player hit wakes the target immediately');
});

test('Shared monsters can remain idle while there are no players', () => {
  const world = createCombatWorld();
  world.step(0.05, 1000);
  assert.equal(world.snapshotWorld().mobs.length, 3);
  const player = world.join(hero('1', 'Alice'));
  player.x = 440; player.y = 160;
  world.step(0.05, 2000);
  assert.equal(player.hp, 93);
});
