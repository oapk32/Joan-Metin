// Authoritative shared PvE sandbox. No client-driven position, HP, damage or rewards.
// All rewards are TEMPORARY for this arena and are never saved to PostgreSQL.
export const ARENA = Object.freeze({ width: 900, height: 550, playerSpeed: 180 });
export const MAX_ARENA_PLAYERS = 30;
export const ATTACK_RANGE = 82;
export const ATTACK_COOLDOWN_MS = 550;
const PLAYER_RESPAWN_MS = 4000;
const MOB_RESPAWN_MS = 6000;
export const ACTIVE_TARGET_SCAN_MS = 1000;
export const IDLE_TARGET_SCAN_MS = 1000;
const MONSTER_AGGRO_RADIUS_SQUARED = 230 * 230;
export const PERSONAL_LOOT_LIFETIME_MS = 120000;
const PICKUP_RANGE = 65;
// Prototype-only drops. These are NOT the canonical v134 loot tables.
const TEST_DROP_TABLE = Object.freeze({
  'Vlk': { itemId: 'test-wolf-pelt', itemName: 'Zkušební vlčí kožešina', chance: 0.5 },
  'Ork': { itemId: 'test-orc-token', itemName: 'Zkušební orčí trofej', chance: 0.6 }
});
const MOB_DEFINITIONS = [
  { id: 'wolf-1', kind: 'Vlk', x: 440, y: 160, hp: 70, speed: 62, attack: 7, xp: 14, yang: 8 },
  { id: 'wolf-2', kind: 'Vlk', x: 520, y: 390, hp: 70, speed: 62, attack: 7, xp: 14, yang: 8 },
  { id: 'orc-1', kind: 'Ork', x: 740, y: 275, hp: 135, speed: 45, attack: 12, xp: 28, yang: 17 }
];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const distanceSquared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function createCombatWorld({
  random = Math.random, mobDefinitions = MOB_DEFINITIONS,
  defaultMapId = 'arena', mapWidth = ARENA.width, mapHeight = ARENA.height,
  spawnX = 115, spawnY = 270
} = {}) {
  if (!Number.isFinite(mapWidth) || mapWidth < 100 || mapWidth > 10000 ||
      !Number.isFinite(mapHeight) || mapHeight < 100 || mapHeight > 10000 ||
      !Number.isFinite(spawnX) || !Number.isFinite(spawnY)) {
    throw new Error('Invalid authoritative world dimensions');
  }
  const players = new Map(); // character ID => mutable player state
  const dropsByPlayer = new Map(); // personal ground loot, never a shared pool
  const lootRevision = new Map(); // per-player change counter; no loot in frequent world packets
  let lastLootCleanupMs = -Infinity;
  let fullTargetScans = 0;
  let nextDropId = 1;
  const validMaps = new Set(['arena', defaultMapId, ...mobDefinitions.map(m => m.mapId || 'arena')]);
  if (typeof defaultMapId !== 'string' || !validMaps.has(defaultMapId)) {
    throw new Error('Invalid spawn map');
  }
  const mobs = new Map(mobDefinitions.map(d => [d.id, {
    ...d, mapId: d.mapId || 'arena', maxHp: d.hp, spawnX: d.x, spawnY: d.y,
    deadUntil: 0, lastAttack: 0, targetId: null, nextTargetScanAt: 0,
    contributions: new Map()
  }]));

  function join(character) {
    if (!character || typeof character.id !== 'string' || !/^[1-9][0-9]*$/.test(character.id) ||
        typeof character.name !== 'string' || players.has(character.id) || players.size >= MAX_ARENA_PLAYERS) {
      return null;
    }
    const player = {
      id: character.id, name: character.name.slice(0, 24), mapId: defaultMapId,
      cls: ['warrior', 'ninja', 'sura', 'shaman'].includes(character.class) ? character.class : 'warrior',
      x: spawnX + (players.size % 3) * 32, y: spawnY, hp: 100, maxHp: 100,
      inputX: 0, inputY: 0, lastAttack: -Infinity, deadUntil: 0,
      xp: 0, yang: 0, kills: 0, testInventory: []
    };
    players.set(player.id, player);
    dropsByPlayer.set(player.id, new Map());
    lootRevision.set(player.id, 0);
    return player;
  }

  // Server-side map transitions only; never wire to arbitrary client input.
  function transferPlayerMap(id, mapId, x = spawnX, y = spawnY) {
    const player = players.get(id);
    if (!player || !validMaps.has(mapId) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    player.mapId = mapId;
    player.x = clamp(x, 18, mapWidth - 18);
    player.y = clamp(y, 18, mapHeight - 18);
    player.inputX = 0; player.inputY = 0;
    for (const mob of mobs.values()) {
      mob.contributions.delete(id);
      if (mob.targetId === id) {
        mob.targetId = null;
        mob.nextTargetScanAt = 0;
      }
    }
    return true;
  }

  function leave(id) {
    players.delete(id);
    dropsByPlayer.delete(id);
    lootRevision.delete(id);
    for (const mob of mobs.values()) mob.contributions.delete(id);
  }

  // Client controls are clamped to direction only; x/y coordinates are ignored.
  function setInput(id, message) {
    const p = players.get(id);
    if (!p || !message || !Number.isFinite(message.x) || !Number.isFinite(message.y)) return false;
    if (Math.abs(message.x) > 1 || Math.abs(message.y) > 1) return false;
    const length = Math.hypot(message.x, message.y);
    p.inputX = length ? message.x / Math.max(1, length) : 0;
    p.inputY = length ? message.y / Math.max(1, length) : 0;
    return true;
  }

  // Only trusted local server code calls attack(). Damage, range, cooldown and
  // payout are entirely calculated here, never taken from a WebSocket payload.
  function attack(playerId, mobId, nowMs) {
    const p = players.get(playerId);
    const mob = typeof mobId === 'string' ? mobs.get(mobId) : null;
    if (!p || !mob || p.mapId !== mob.mapId) return { ok: false, reason: 'invalid_target' };
    if (!Number.isFinite(nowMs)) return { ok: false, reason: 'invalid_time' };
    if (p.hp <= 0 || nowMs < p.deadUntil) return { ok: false, reason: 'dead' };
    if (mob.hp <= 0 || nowMs < mob.deadUntil) return { ok: false, reason: 'mob_dead' };
    if (nowMs - p.lastAttack < ATTACK_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
    if (distance(p, mob) > ATTACK_RANGE) return { ok: false, reason: 'out_of_range' };
    p.lastAttack = nowMs;
    const damage = p.cls === 'warrior' ? 19 : p.cls === 'ninja' ? 17 : 16;
    const dealt = Math.min(damage, mob.hp);
    mob.hp -= dealt;
    // Being hit wakes a sleeping monster immediately without a full
    // scan through all players. Subsequent retargeting remains 1 Hz.
    if (mob.hp > 0) {
      mob.targetId = p.id;
      mob.nextTargetScanAt = Math.max(mob.nextTargetScanAt, nowMs + ACTIVE_TARGET_SCAN_MS);
    }
    const contribution = mob.contributions.get(p.id) || { damage: 0, lastHit: 0 };
    mob.contributions.set(p.id, { damage: contribution.damage + dealt, lastHit: nowMs });
    let defeated = false;
    const awarded = [];
    if (mob.hp === 0) {
      defeated = true;
      // Only trusted server definitions may override the monster timer.
      const respawnMs = Number.isFinite(mob.respawnMs) && mob.respawnMs >= MOB_RESPAWN_MS && mob.respawnMs <= 600000
        ? mob.respawnMs : MOB_RESPAWN_MS;
      mob.deadUntil = nowMs + respawnMs;
      // Rewards go to recent contributors only, not all nearby/online players.
      for (const [id, contribution] of mob.contributions) {
        const beneficiary = players.get(id);
        if (!beneficiary || nowMs - contribution.lastHit > 10000) continue;
        beneficiary.xp += mob.xp;
        beneficiary.yang += mob.yang;
        beneficiary.kills += 1;
        awarded.push(id);
        // Independent roll PER eligible character. No shared winner or
        // first-to-pick race. Only that owner sees/can pick up this item.
        const dropRule = TEST_DROP_TABLE[mob.kind]; // temporary beta drop, NOT original v134 loot
        const ownerDrops = dropsByPlayer.get(id);
        if (dropRule && ownerDrops) {
          const roll = random();
          if (Number.isFinite(roll) && roll >= 0 && roll < dropRule.chance) {
            const dropId = 'drop-' + nextDropId++;
            ownerDrops.set(dropId, {
              id: dropId, itemId: dropRule.itemId, itemName: dropRule.itemName,
              x: mob.x, y: mob.y, mapId: mob.mapId, expiresAt: nowMs + PERSONAL_LOOT_LIFETIME_MS
            });
            lootRevision.set(id, (lootRevision.get(id) || 0) + 1);
          }
        }
      }
      mob.contributions.clear();
    }
    return { ok: true, mobId, damage: dealt, defeated, awarded };
  }

  function pickUp(playerId, dropId, nowMs) {
    const player = players.get(playerId);
    const owned = dropsByPlayer.get(playerId);
    if (!player || !owned || typeof dropId !== 'string' ||
        !/^drop-[1-9][0-9]*$/.test(dropId) || !Number.isFinite(nowMs)) {
      return { ok: false, reason: 'invalid_drop' };
    }
    const item = owned.get(dropId);
    if (!item || nowMs >= item.expiresAt) return { ok: false, reason: 'not_owned_or_expired' };
    if (player.hp <= 0) return { ok: false, reason: 'dead' };
    if (item.mapId !== player.mapId) return { ok: false, reason: 'out_of_range' };
    if (distance(player, item) > PICKUP_RANGE) return { ok: false, reason: 'out_of_range' };
    owned.delete(dropId);
    player.testInventory.push({ itemId: item.itemId, itemName: item.itemName });
    lootRevision.set(playerId, (lootRevision.get(playerId) || 0) + 1);
    return { ok: true, itemId: item.itemId, itemName: item.itemName };
  }

  function step(dtSeconds, nowMs) {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0 || !Number.isFinite(nowMs)) return;
    const dt = Math.min(dtSeconds, 0.1);
    // Ground items do not need their expiration checked 20 times per second.
    // Pickup independently checks exact expiry before granting an item.
    if (nowMs - lastLootCleanupMs >= 1000) {
      lastLootCleanupMs = nowMs;
      for (const [playerId, drops] of dropsByPlayer) {
        for (const [id, item] of drops) {
          if (nowMs >= item.expiresAt) {
            drops.delete(id);
            lootRevision.set(playerId, (lootRevision.get(playerId) || 0) + 1);
          }
        }
      }
    }
    for (const p of players.values()) {
      if (p.hp === 0) {
        if (nowMs >= p.deadUntil) {
          p.hp = p.maxHp;
          p.x = spawnX; p.y = spawnY;
          p.inputX = 0; p.inputY = 0;
        }
        continue;
      }
      p.x = clamp(p.x + p.inputX * ARENA.playerSpeed * dt, 18, mapWidth - 18);
      p.y = clamp(p.y + p.inputY * ARENA.playerSpeed * dt, 18, mapHeight - 18);
    }
    // A fully empty arena has no player-facing simulation to update.
    // Dead monsters still respawn on the next step after a player rejoins.
    if (players.size === 0) return;
    const occupiedMaps = new Set([...players.values()].map(p => p.mapId));
    for (const mob of mobs.values()) {
      // Empty maps keep shared HP, boss state and absolute respawn timers.
      // They resume at the next tick after a player enters, without a reset.
      if (!occupiedMaps.has(mob.mapId)) continue;
      if (mob.hp <= 0) {
        if (nowMs >= mob.deadUntil) {
          mob.hp = mob.maxHp;
          mob.x = mob.spawnX; mob.y = mob.spawnY;
          mob.lastAttack = nowMs;
          mob.targetId = null;
          mob.nextTargetScanAt = 0;
          mob.contributions.clear();
        }
        continue;
      }
      // Stationary metins cannot chase, aggro or attack players.
      if (mob.passive) continue;
      // Movement and attacks remain on the 20 Hz game tick.
      // Full nearest-player scans run once per second, even during combat.
      // A sleeping monster at its spawn skips the rest of this tick entirely.
      if (mob.targetId === null && nowMs < mob.nextTargetScanAt &&
          mob.x === mob.spawnX && mob.y === mob.spawnY) continue;
      // The cached target's validity/range is checked each active tick.
      let target = mob.targetId === null ? null : players.get(mob.targetId);
      if (target && target.mapId !== mob.mapId) target = null;
      let nearestSquared = target?.hp > 0 ? distanceSquared(target, mob) : Infinity;
      if (mob.targetId !== null && nearestSquared >= MONSTER_AGGRO_RADIUS_SQUARED) {
        target = null;
        mob.targetId = null;
        // Wait for the scheduled 1 Hz scan instead of scanning immediately.
      }
      if (nowMs >= mob.nextTargetScanAt) {
        fullTargetScans += 1;
        target = null;
        nearestSquared = MONSTER_AGGRO_RADIUS_SQUARED;
        for (const candidate of players.values()) {
          if (candidate.hp <= 0 || candidate.mapId !== mob.mapId) continue;
          const d = distanceSquared(candidate, mob);
          if (d < nearestSquared) {
            nearestSquared = d;
            target = candidate;
          }
        }
        mob.targetId = target?.id ?? null;
        mob.nextTargetScanAt = nowMs +
          (target ? ACTIVE_TARGET_SCAN_MS : IDLE_TARGET_SCAN_MS);
      }
      // No nearby player = no pathfinding or attacks. At home the
      // monster sleeps until the next 1 Hz target scan.
      if (!target && mob.x === mob.spawnX && mob.y === mob.spawnY) continue;
      if (!target) {
        const home = { x: mob.spawnX, y: mob.spawnY };
        const d = distance(mob, home);
        if (d > 2) {
          mob.x += (home.x - mob.x) / d * Math.min(d, mob.speed * dt);
          mob.y += (home.y - mob.y) / d * Math.min(d, mob.speed * dt);
        }
        continue;
      }
      const nearest = Math.sqrt(nearestSquared);
      if (nearest > 34) {
        const travel = Math.min(mob.speed * dt, Math.max(0, nearest - 32));
        mob.x = clamp(mob.x + (target.x - mob.x) / nearest * travel, 16, mapWidth - 16);
        mob.y = clamp(mob.y + (target.y - mob.y) / nearest * travel, 16, mapHeight - 16);
      } else if (nowMs - mob.lastAttack >= 1250) {
        mob.lastAttack = nowMs;
        target.hp = Math.max(0, target.hp - mob.attack);
        if (target.hp === 0) {
          target.deadUntil = nowMs + PLAYER_RESPAWN_MS;
          target.inputX = 0; target.inputY = 0;
        }
      }
    }
  }

  // Shared movement/monster state goes to every player frequently.
  // Personal loot and collected items go ONLY to the owner, and only on change.
  function snapshotWorld() {
    return {
      type: 'combat-snapshot',
      width: mapWidth, height: mapHeight,
      players: [...players.values()].map(p => ({
        id: p.id, name: p.name, cls: p.cls, mapId: p.mapId, x: p.x, y: p.y,
        hp: p.hp, maxHp: p.maxHp, xp: p.xp, yang: p.yang, kills: p.kills
      })),
      mobs: [...mobs.values()].map(m => ({
        id: m.id, kind: m.kind, type: m.type || null, mapId: m.mapId, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp
      }))
    };
  }

  function personalLootState(viewerId) {
    const viewer = players.get(viewerId);
    const owned = dropsByPlayer.get(viewerId);
    return {
      type: 'combat-loot',
      revision: lootRevision.get(viewerId) || 0,
      personalDrops: owned ? [...owned.values()].map(d => ({
        id: d.id, itemId: d.itemId, itemName: d.itemName, x: d.x, y: d.y
      })) : [],
      testInventory: viewer ? viewer.testInventory.map(d => ({ ...d })) : []
    };
  }

  // Preserve the simple combined state for tests/tools; never send it to all
  // WebSocket clients, because another player's private items must stay private.
  function snapshot(viewerId = null) {
    return { ...snapshotWorld(), ...personalLootState(viewerId), type: 'combat-snapshot' };
  }

  return {
    join, leave, transferPlayerMap, setInput, attack, pickUp, step,
    snapshot, snapshotWorld, personalLootState,
    lootVersion: id => lootRevision.get(id) || 0,
    playerCount: () => players.size,
    diagnostics: () => ({
      fullTargetScans,
      mobCount: mobs.size,
      sleepingMaps: [...validMaps].filter(mapId => ![...players.values()]
        .some(player => player.mapId === mapId)).length,
      sleepingMobs: [...mobs.values()].filter(m =>
        m.hp > 0 && m.targetId === null &&
        m.x === m.spawnX && m.y === m.spawnY).length
    })
  };
}
