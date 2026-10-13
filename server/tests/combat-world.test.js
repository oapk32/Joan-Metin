import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatWorld, ARENA, ATTACK_RANGE } from '../combat-world.js';

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
