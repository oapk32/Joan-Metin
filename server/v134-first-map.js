// First authoritative region of Joan v134 (ROOM[1], "Okraj Joanu", map 1–2).
// Source of monster types/counts: client/js/game.js ROOM[1], TYPES, BALANCE.
// Temporary deterministic spawn coordinates for the private beta; original
// client randomly places monsters and has not yet been integrated into this map.
import { createCombatWorld } from './combat-world.js';

export const JOAN_EDGE = Object.freeze({
  mapId: 'joan-1-2', roomIndex: 1, title: 'Okraj Joanu',
  width: 1100, height: 660, spawnX: 140, spawnY: 330
});
const positions = Object.freeze({
  dog: [[330,155],[430,255],[360,430],[655,175],[800,435]],
  wolf: [[510,145],[710,285],[555,475],[875,230],[930,440]]
});
export const JOAN_EDGE_MOBS = Object.freeze([
  ...positions.dog.map(([x,y],i) => Object.freeze({
    id: 'joan-dog-'+(i+1), kind:'Toulavý pes', type:'dog',
    mapId:JOAN_EDGE.mapId,x,y,
    hp:57, speed:105, attack:11, xp:26, yang:5
  })),
  ...positions.wolf.map(([x,y],i) => Object.freeze({
    id: 'joan-wolf-'+(i+1), kind:'Vlk', type:'wolf',
    mapId:JOAN_EDGE.mapId,x,y,
    hp:90, speed:125, attack:16, xp:36, yang:7
  })),
  // One shared v134 Metin smutku. Static and non-attacking, with its own
  // 30-second server-owned respawn. Drops remain test-only for now.
  Object.freeze({
    id:'joan-metin-5', kind:'Metin smutku', type:'stone',
    mapId:JOAN_EDGE.mapId, x:390, y:560,
    hp:590, speed:0, attack:0, xp:80, yang:30,
    passive:true, respawnMs:30000
  })
]);

export function createJoanEdgeWorld(options = {}) {
  return createCombatWorld({
    ...options,
    mobDefinitions: JOAN_EDGE_MOBS,
    defaultMapId: JOAN_EDGE.mapId,
    mapWidth: JOAN_EDGE.width,
    mapHeight: JOAN_EDGE.height,
    spawnX: JOAN_EDGE.spawnX,
    spawnY: JOAN_EDGE.spawnY
  });
}
