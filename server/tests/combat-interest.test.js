import test from 'node:test';
import assert from 'node:assert/strict';
import { createSectorIndex, diffVisible, fullVisible, SECTOR_SIZE } from '../combat-interest.js';
import { createCombatWorld } from '../combat-world.js';

test('Sector index keeps one shared map but excludes remote areas and other maps', () => {
  const world = {
    width: 900, height: 550,
    players: [
      { id: '1', x: 100, y: 100, mapId: 'arena', hp: 100 },
      { id: '2', x: 200, y: 200, mapId: 'arena', hp: 100 },
      { id: '3', x: 800, y: 540, mapId: 'arena', hp: 100 },
      { id: '4', x: 100, y: 100, mapId: 'forest', hp: 100 }
    ],
    mobs: [
      { id: 'wolf', x: 210, y: 210, mapId: 'arena', hp: 50 },
      { id: 'orc', x: 890, y: 530, mapId: 'arena', hp: 100 },
      { id: 'forest-boss', x: 100, y: 100, mapId: 'forest', hp: 9999 }
    ]
  };
  assert.equal(SECTOR_SIZE, 220);
  const index = createSectorIndex(world);
  const nearby = index.select('1');
  assert.deepEqual(nearby.players.map(x => x.id), ['1','2']);
  assert.deepEqual(nearby.mobs.map(x => x.id), ['wolf']);
  assert.deepEqual(index.select('4').mobs.map(x => x.id), ['forest-boss']);
  assert.deepEqual(index.select('missing').mobs, []);
  assert.deepEqual(fullVisible(world, nearby).mobs.map(x => x.id), ['wolf']);
});

test('Sectors send add/change/remove deltas and skip unchanged monster positions', () => {
  const before = { players: [{ id: '1', x: 40, y: 50, mapId: 'arena', hp: 10 }],
    mobs: [{ id: 'wolf', x: 60, y: 50, mapId: 'arena', hp: 20, maxHp: 50 }] };
  const after = { players: [{ id: '1', x: 45, y: 50, mapId: 'arena', hp: 10 },
    { id: '2', x: 41, y: 52, mapId: 'arena', hp: 30 }],
    mobs: [{ id: 'orc', x: 90, y: 100, mapId: 'arena', hp: 70 }] };
  const d = diffVisible(before, after);
  assert.deepEqual(d.playersAdded.map(x => x.id), ['2']);
  assert.deepEqual(d.playersChanged.map(x => x.id), ['1']);
  assert.deepEqual(d.mobsRemoved, ['wolf']);
  assert.deepEqual(d.mobsAdded.map(x => x.id), ['orc']);
  assert.equal(diffVisible(after, structuredClone(after)), null);
});

test('Empty maps sleep without duplicating monsters, resetting HP or losing respawn deadlines', () => {
  const world = createCombatWorld({ random: () => 1, mobDefinitions: [
    { id: 'wolf', mapId: 'arena', x: 115, y: 270, kind: 'Vlk',
      hp: 30, attack: 0, speed: 0, xp: 0, yang: 0 },
    { id: 'forest-boss', mapId: 'forest', x: 115, y: 270, kind: 'Ork',
      hp: 30, attack: 0, speed: 0, xp: 0, yang: 0 }
  ] });
  const hero = world.join({ id: '1', name: 'Alice', class: 'warrior' });
  world.step(.05, 1000);
  assert.equal(world.diagnostics().sleepingMaps, 1);
  assert.equal(world.attack('1', 'forest-boss', 1000).reason, 'invalid_target');
  assert.equal(world.transferPlayerMap('1', 'forest'), true);
  assert.equal(world.attack('1', 'forest-boss', 1100).ok, true); // boss now HP 11
  assert.equal(world.snapshotWorld().mobs.find(m => m.id === 'forest-boss').hp, 11);
  assert.equal(world.transferPlayerMap('1', 'arena'), true);
  for (let now = 1200; now < 11000; now += 50) world.step(.05, now);
  assert.equal(world.snapshotWorld().mobs.find(m => m.id === 'forest-boss').hp, 11);
  assert.equal(world.transferPlayerMap('1', 'forest'), true);
  world.step(.05, 11100);
  assert.equal(world.snapshotWorld().mobs.find(m => m.id === 'forest-boss').hp, 11);
  assert.equal(world.attack('1', 'forest-boss', 12000).ok, true);
  assert.equal(world.snapshotWorld().mobs.find(m => m.id === 'forest-boss').hp, 0);
  world.transferPlayerMap('1', 'arena');
  for (let now = 12050; now < 19000; now += 50) world.step(.05, now);
  assert.equal(world.snapshotWorld().mobs.find(m => m.id === 'forest-boss').hp, 0);
  world.transferPlayerMap('1', 'forest');
  world.step(.05, 19000);
  assert.equal(world.snapshotWorld().mobs.find(m => m.id === 'forest-boss').hp, 30);
  assert.equal(world.transferPlayerMap('1', 'unknown-zone'), false);
  assert.equal(hero.mapId, 'forest');
});
