// Area of interest: a shared map stays authoritative on the server, but each
// player receives only entities in nearby spatial sectors. No private instances.
export const SECTOR_SIZE = 220;
export const VISIBILITY_RADIUS = 440;
const fields = Object.freeze({
  players: ['x', 'y', 'hp', 'maxHp', 'xp', 'yang', 'kills', 'name', 'cls', 'mapId'],
  mobs: ['x', 'y', 'hp', 'maxHp', 'kind', 'mapId']
});
const cellKey = (mapId, x, y) =>
  mapId + ':' + Math.floor(x / SECTOR_SIZE) + ':' + Math.floor(y / SECTOR_SIZE);
const sqDistance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function createSectorIndex(world) {
  const sectors = new Map();
  function add(type, entity) {
    const key = cellKey(entity.mapId || 'arena', entity.x, entity.y);
    if (!sectors.has(key)) sectors.set(key, { players: [], mobs: [] });
    sectors.get(key)[type].push(entity);
  }
  for (const p of world.players) add('players', p);
  for (const m of world.mobs) add('mobs', m);
  return {
    select(playerId) {
      const viewer = world.players.find(p => p.id === playerId);
      if (!viewer) return { players: [], mobs: [] };
      const col = Math.floor(viewer.x / SECTOR_SIZE);
      const row = Math.floor(viewer.y / SECTOR_SIZE);
      const span = Math.ceil(VISIBILITY_RADIUS / SECTOR_SIZE);
      const result = { players: [], mobs: [] };
      const r2 = VISIBILITY_RADIUS * VISIBILITY_RADIUS;
      for (let dx = -span; dx <= span; dx++) {
        for (let dy = -span; dy <= span; dy++) {
          const cell = sectors.get((viewer.mapId || 'arena') + ':' + (col + dx) + ':' + (row + dy));
          if (!cell) continue;
          for (const type of ['players', 'mobs']) {
            for (const entity of cell[type]) {
              if (entity.id === playerId && type === 'players' ||
                  sqDistance(entity, viewer) <= r2) result[type].push(entity);
            }
          }
        }
      }
      // Unique IDs, deterministic order; stable diffs independent of map order.
      result.players.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
      result.mobs.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
      return result;
    }
  };
}

function changed(a, b, type) {
  return fields[type].some(field => a[field] !== b[field]);
}
export function diffVisible(previous, current) {
  const delta = { type: 'combat-delta', playersAdded: [], playersChanged: [],
    playersRemoved: [], mobsAdded: [], mobsChanged: [], mobsRemoved: [] };
  for (const type of ['players', 'mobs']) {
    const old = new Map((previous?.[type] || []).map(p => [p.id, p]));
    const present = new Set();
    for (const entity of current[type]) {
      present.add(entity.id);
      if (!old.has(entity.id)) delta[type + 'Added'].push(entity);
      else if (changed(old.get(entity.id), entity, type)) delta[type + 'Changed'].push(entity);
    }
    for (const id of old.keys()) if (!present.has(id)) delta[type + 'Removed'].push(id);
  }
  const hasChanges = ['players', 'mobs'].some(type => ['Added', 'Changed', 'Removed']
    .some(operation => delta[type + operation].length));
  return hasChanges ? delta : null;
}

export function fullVisible(world, visible) {
  return { type: 'combat-snapshot', width: world.width, height: world.height,
    players: visible.players, mobs: visible.mobs };
}
