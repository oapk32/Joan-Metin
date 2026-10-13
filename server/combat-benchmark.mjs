// Reproducible CPU/network simulation (not a measurement of Oracle hardware).
// Runs locally or in CI without account secrets or a remote server.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createCombatWorld } from './combat-world.js';
import { createSectorIndex, diffVisible } from './combat-interest.js';

const MOB_COUNT = 600;
const PLAYER_COUNT = 30;
const TICKS = 400;  // 20 Hz, simulated 20 seconds
const maps = ['arena', 'forest', 'tower', 'dungeon'];
const mobDefinitions = Array.from({ length: MOB_COUNT }, (_, index) => ({
  id: 'test-mob-' + index,
  mapId: maps[index % maps.length],
  kind: 'Vlk',
  x: 25 + ((index * 67) % 850),
  y: 25 + ((index * 127) % 500),
  hp: 85, attack: 2, speed: 50, xp: 0, yang: 0
}));
const world = createCombatWorld({ random: () => 1, mobDefinitions });
for (let id = 1; id <= PLAYER_COUNT; id++) {
  assert.ok(world.join({ id: String(id), name: 'Benchmark_' + id, class: 'warrior' }));
}
let bytes = 0;
let messages = 0;
const previous = new Map();
const timings = [];
for (let tick = 0; tick < TICKS; tick++) {
  const begin = performance.now();
  const at = tick * 50 + 1000;
  world.step(.05, at);
  if (tick % 3 === 0) {
    const index = createSectorIndex(world.snapshotWorld());
    for (let id = 1; id <= PLAYER_COUNT; id++) {
      const viewer = String(id);
      const visible = index.select(viewer);
      const delta = diffVisible(previous.get(viewer), visible);
      if (delta) {
        bytes += Buffer.byteLength(JSON.stringify(delta));
        messages++;
      }
      previous.set(viewer, visible);
    }
  }
  timings.push(performance.now() - begin);
}
timings.sort((a, b) => a - b);
const stats = world.diagnostics();
assert.equal(stats.mobCount, MOB_COUNT);
assert.equal(world.playerCount(), PLAYER_COUNT);
assert.equal(stats.sleepingMaps, 3);
assert.ok(stats.fullTargetScans < (MOB_COUNT / maps.length) * (TICKS / 20 + 2),
  'monster searches should not run on every 20Hz simulation tick');
assert.ok(bytes > 0 && messages > 0);
console.log(JSON.stringify({
  environment: 'GitHub Actions runner (NOT Oracle)',
  players: PLAYER_COUNT, monsters: MOB_COUNT, maps: maps.length,
  elapsedGameSeconds: TICKS / 20, worldTicks: TICKS,
  targetScans: stats.fullTargetScans,
  emptyMapsAsleep: stats.sleepingMaps,
  transmittedDeltaMessages: messages,
  totalSimulatedDeltaBytes: bytes,
  simulationTickP50ms: Number(timings[Math.floor(TICKS * .50)].toFixed(3)),
  simulationTickP95ms: Number(timings[Math.floor(TICKS * .95)].toFixed(3)),
  simulationTickP99ms: Number(timings[Math.floor(TICKS * .99)].toFixed(3))
}, null, 2));
