// Authoritative shared PvE sandbox. No client-driven position, HP, damage or rewards.
// All rewards are TEMPORARY for this arena and are never saved to PostgreSQL.
export const ARENA = Object.freeze({ width: 900, height: 550, playerSpeed: 180 });
export const MAX_ARENA_PLAYERS = 30;
export const ATTACK_RANGE = 82;
export const ATTACK_COOLDOWN_MS = 550;
const PLAYER_RESPAWN_MS = 4000;
const MOB_RESPAWN_MS = 6000;
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

export function createCombatWorld({ random = Math.random } = {}) {
  const players = new Map(); // character ID => mutable player state
  const dropsByPlayer = new Map(); // personal ground loot, never a shared pool
  let nextDropId = 1;
  const mobs = new Map(MOB_DEFINITIONS.map(d => [d.id, {
    ...d, maxHp: d.hp, spawnX: d.x, spawnY: d.y,
    deadUntil: 0, lastAttack: 0, contributions: new Map()
  }]));

  function join(character) {
    if (!character || typeof character.id !== 'string' || !/^[1-9][0-9]*$/.test(character.id) ||
        typeof character.name !== 'string' || players.has(character.id) || players.size >= MAX_ARENA_PLAYERS) {
      return null;
    }
    const player = {
      id: character.id, name: character.name.slice(0, 24),
      cls: ['warrior', 'ninja', 'sura', 'shaman'].includes(character.class) ? character.class : 'warrior',
      x: 115 + (players.size % 3) * 32, y: 270, hp: 100, maxHp: 100,
      inputX: 0, inputY: 0, lastAttack: -Infinity, deadUntil: 0,
      xp: 0, yang: 0, kills: 0, testInventory: []
    };
    players.set(player.id, player);
    dropsByPlayer.set(player.id, new Map());
    return player;
  }

  function leave(id) {
    players.delete(id);
    dropsByPlayer.delete(id);
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
    if (!p || !mob) return { ok: false, reason: 'invalid_target' };
    if (!Number.isFinite(nowMs)) return { ok: false, reason: 'invalid_time' };
    if (p.hp <= 0 || nowMs < p.deadUntil) return { ok: false, reason: 'dead' };
    if (mob.hp <= 0 || nowMs < mob.deadUntil) return { ok: false, reason: 'mob_dead' };
    if (nowMs - p.lastAttack < ATTACK_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
    if (distance(p, mob) > ATTACK_RANGE) return { ok: false, reason: 'out_of_range' };
    p.lastAttack = nowMs;
    const damage = p.cls === 'warrior' ? 19 : p.cls === 'ninja' ? 17 : 16;
    const dealt = Math.min(damage, mob.hp);
    mob.hp -= dealt;
    const contribution = mob.contributions.get(p.id) || { damage: 0, lastHit: 0 };
    mob.contributions.set(p.id, { damage: contribution.damage + dealt, lastHit: nowMs });
    let defeated = false;
    const awarded = [];
    if (mob.hp === 0) {
      defeated = true;
      mob.deadUntil = nowMs + MOB_RESPAWN_MS;
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
        const dropRule = TEST_DROP_TABLE[mob.kind];
        const ownerDrops = dropsByPlayer.get(id);
        if (dropRule && ownerDrops) {
          const roll = random();
          if (Number.isFinite(roll) && roll >= 0 && roll < dropRule.chance) {
            const dropId = 'drop-' + nextDropId++;
            ownerDrops.set(dropId, {
              id: dropId, itemId: dropRule.itemId, itemName: dropRule.itemName,
              x: mob.x, y: mob.y, expiresAt: nowMs + PERSONAL_LOOT_LIFETIME_MS
            });
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
    if (distance(player, item) > PICKUP_RANGE) return { ok: false, reason: 'out_of_range' };
    owned.delete(dropId);
    player.testInventory.push({ itemId: item.itemId, itemName: item.itemName });
    return { ok: true, itemId: item.itemId, itemName: item.itemName };
  }

  function step(dtSeconds, nowMs) {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0 || !Number.isFinite(nowMs)) return;
    const dt = Math.min(dtSeconds, 0.1);
    for (const drops of dropsByPlayer.values()) {
      for (const [id, item] of drops) {
        if (nowMs >= item.expiresAt) drops.delete(id);
      }
    }
    for (const p of players.values()) {
      if (p.hp === 0) {
        if (nowMs >= p.deadUntil) {
          p.hp = p.maxHp;
          p.x = 115; p.y = 270;
          p.inputX = 0; p.inputY = 0;
        }
        continue;
      }
      p.x = clamp(p.x + p.inputX * ARENA.playerSpeed * dt, 18, ARENA.width - 18);
      p.y = clamp(p.y + p.inputY * ARENA.playerSpeed * dt, 18, ARENA.height - 18);
    }
    for (const mob of mobs.values()) {
      if (mob.hp <= 0) {
        if (nowMs >= mob.deadUntil) {
          mob.hp = mob.maxHp;
          mob.x = mob.spawnX; mob.y = mob.spawnY;
          mob.lastAttack = nowMs;
          mob.contributions.clear();
        }
        continue;
      }
      let target = null;
      let nearest = 230;
      for (const p of players.values()) {
        if (p.hp <= 0) continue;
        const d = distance(p, mob);
        if (d < nearest) { nearest = d; target = p; }
      }
      if (!target) {
        const home = { x: mob.spawnX, y: mob.spawnY };
        const d = distance(mob, home);
        if (d > 2) {
          mob.x += (home.x - mob.x) / d * Math.min(d, mob.speed * dt);
          mob.y += (home.y - mob.y) / d * Math.min(d, mob.speed * dt);
        }
        continue;
      }
      if (nearest > 34) {
        const travel = Math.min(mob.speed * dt, Math.max(0, nearest - 32));
        mob.x = clamp(mob.x + (target.x - mob.x) / nearest * travel, 16, ARENA.width - 16);
        mob.y = clamp(mob.y + (target.y - mob.y) / nearest * travel, 16, ARENA.height - 16);
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

  function snapshot(viewerId = null) {
    const viewer = players.get(viewerId);
    const owned = dropsByPlayer.get(viewerId);
    return {
      type: 'combat-snapshot',
      width: ARENA.width, height: ARENA.height,
      personalDrops: owned ? [...owned.values()].map(d => ({
        id: d.id, itemId: d.itemId, itemName: d.itemName, x: d.x, y: d.y
      })) : [],
      testInventory: viewer ? viewer.testInventory.map(d => ({ ...d })) : [],
      players: [...players.values()].map(p => ({
        id: p.id, name: p.name, cls: p.cls, x: p.x, y: p.y,
        hp: p.hp, maxHp: p.maxHp, xp: p.xp, yang: p.yang, kills: p.kills
      })),
      mobs: [...mobs.values()].map(m => ({
        id: m.id, kind: m.kind, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp
      }))
    };
  }

  return { join, leave, setInput, attack, pickUp, step, snapshot, playerCount: () => players.size };
}
