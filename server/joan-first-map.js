// Joan v134, region 1–2 "Okraj Joanu" (ROOM[1]): five dogs and five wolves.
// This is an initial shared-PvE test map, not yet the full v134 world/loot balance.
// Server owns every monster. Stable IDs/positions are shared by all characters.
// Original v134 source: ROOM[1] enemies dog:5, wolf:5; TYPES dog/wolf.
export const JOAN_FIRST_MAP_ID = 'joan-1';
export const JOAN_FIRST_MAP_MOBS = Object.freeze([
  ...[
    [420, 155], [630, 155], [810, 290], [490, 470], [755, 500]
  ].map(([x, y], n) => ({
    id: 'joan-1-dog-' + (n + 1),
    mapId: JOAN_FIRST_MAP_ID, kind: 'Toulavý pes', x, y,
    hp: 57, speed: 105, attack: 7, xp: 29, yang: 5
  })),
  ...[
    [340, 250], [560, 320], [865, 170], [920, 420], [650, 510]
  ].map(([x, y], n) => ({
    id: 'joan-1-wolf-' + (n + 1),
    mapId: JOAN_FIRST_MAP_ID, kind: 'Vlk', x, y,
    hp: 90, speed: 125, attack: 10, xp: 41, yang: 8
  }))
]);
