// Experimental private-CO-OP map coordinator. Do not enable for public/untrusted rooms.
// One browser owns AI for each occupied room; the server owns the map clock/respawn deadline.
// This deliberately is NOT a server-authoritative PvE/economy implementation.
export const COOP_MAX_ROOM = 120;
const MAX_MOBS = 140, MAX_STONES = 28;
const MAX_WORLD_BYTES = 95000;
const RETAIN_MS = 5 * 60 * 1000;
const SAFE_KEYS = new Set([
  'id','type','stoneLvl','x','y','homeX','homeY','vx','vy','r','hp','maxHp','dead',
  'dir','attack','flash','stun','poison','poisonBy','poisonPower','fromStone',
  'wander','wave','abilityAt','cast','phase','summons','threshold','v115Thr',
  'v89','v89Guard','v77Guard','abilityCount','abilityPhase','slowUntil',
  'weakenUntil','frozen','burn','v86Slow','v86SlowUntil','v132Heroic',
  'rageAdds','v40Fire','v117','v115','v117Elite','v115Init','shield',
  'invincible','v109','v111','v113','v114','v122','v123','v130','v131',
  'hitT','lastHurt','stoneBalanceVersion','v89Stage','v89B2','v77Guard',
  'v115Dragon','v117Guard','v89Guard','v89Mark','v89Seal','v89Shell',
  'v89Next','v89Phase','v89Left','v89Left2','v89Gates','v89Orbs'
]);
function scrubNested(raw, depth = 0) {
  if (raw === null || typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) && Math.abs(raw) < 1e14 ? raw : null;
  if (typeof raw === 'string') return raw.length <= 48 && /^[a-zA-Z0-9_#-]+$/.test(raw) ? raw : null;
  if (depth >= 3 || !raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw)) return raw.slice(0, 16).map(x => scrubNested(x, depth + 1));
  const out = {};
  for (const [k, value] of Object.entries(raw).slice(0, 32)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(k) || ['constructor','prototype','__proto__','inventory','player','account','password','token'].includes(k)) continue;
    const clean = scrubNested(value, depth + 1);
    if (clean !== null) out[k] = clean;
  }
  return out;
}
function cleanMob(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(raw.id) || raw.id < 0 || raw.id > 100000000 ||
      typeof raw.type !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(raw.type) ||
      !Number.isFinite(raw.x) || raw.x < -200 || raw.x > 1300 ||
      !Number.isFinite(raw.y) || raw.y < -200 || raw.y > 900 ||
      !Number.isFinite(raw.hp) || raw.hp < 0 || raw.hp > 1e14 ||
      !Number.isFinite(raw.maxHp) || raw.maxHp <= 0 || raw.maxHp > 1e14 ||
      typeof raw.dead !== 'boolean') return null;
  const o = {};
  for (const key of SAFE_KEYS) {
    if (!Object.hasOwn(raw, key)) continue;
    const val = scrubNested(raw[key]);
    if (val !== null) o[key] = val;
  }
  return o;
}
export function cleanCoopWorld(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      !Array.isArray(raw.mobs) || !Array.isArray(raw.stones) ||
      raw.mobs.length > MAX_MOBS || raw.stones.length > MAX_STONES ||
      !Number.isInteger(raw.cycle) || raw.cycle < 0 || raw.cycle > 1000000 ||
      !Number.isFinite(raw.remaining) || raw.remaining < 0 || raw.remaining > 3600) return null;
  const mobs = raw.mobs.map(cleanMob), stones = raw.stones.map(cleanMob);
  if (mobs.includes(null) || stones.includes(null)) return null;
  const idSet = new Set([...mobs, ...stones].map(m => m.id));
  if (idSet.size !== mobs.length + stones.length) return null;
  const value = { cycle: raw.cycle, clear: !!raw.clear, mobs, stones, remaining: raw.remaining };
  if (JSON.stringify(value).length > MAX_WORLD_BYTES) return null;
  return value;
}

export function createCoopWorldSync(clock = () => Date.now()) {
  const rooms = new Map();
  function refresh(peers) {
    const activeByRoom = new Map();
    for (const [, peer] of peers) {
      if (!peer.active || !Number.isInteger(peer.room) || peer.room < 0 || peer.room > COOP_MAX_ROOM) continue;
      if (!activeByRoom.has(peer.room)) activeByRoom.set(peer.room, []);
      activeByRoom.get(peer.room).push(peer.id);
    }
    for (const [room, ids] of activeByRoom) {
      let state = rooms.get(room);
      if (!state) {
        state = { ownerId: ids[0], cycle: -1, snapshot: null, revision: 0, respawnAt: null, expireAt: clock() + RETAIN_MS };
        rooms.set(room, state);
      }
      if (!ids.includes(state.ownerId)) state.ownerId = ids[0];
      state.expireAt = clock() + RETAIN_MS;
    }
    for (const [room, state] of rooms) {
      if (!activeByRoom.has(room) && state.expireAt <= clock()) rooms.delete(room);
    }
  }
  function publish(room, peerId, raw, peers) {
    refresh(peers);
    const state = rooms.get(room);
    if (!state || state.ownerId !== peerId) return null;
    const clean = cleanCoopWorld(raw);
    if (!clean || clean.cycle < state.cycle) return null;
    if (clean.cycle > state.cycle) {
      state.respawnAt = null;
      state.cycle = clean.cycle;
    }
    const allDead = [...clean.mobs, ...clean.stones].every(m => m.dead || m.hp <= 0);
    if (state.respawnAt === null && allDead && (clean.mobs.length || clean.stones.length)) {
      // Use the owner's original game timer only for the initial duration.
      state.respawnAt = clock() + Math.round(Math.max(0, clean.remaining) * 1000);
    }
    if (!allDead && clean.remaining === 0) state.respawnAt = null;
    state.snapshot = { cycle: clean.cycle, clear: clean.clear, mobs: clean.mobs, stones: clean.stones };
    state.revision++;
    return get(room);
  }
  function get(room) {
    const s = rooms.get(room);
    if (!s) return null;
    return { room, ownerId: s.ownerId, revision: s.revision,
      respawnRemaining: s.respawnAt === null ? null : Math.max(0, (s.respawnAt - clock()) / 1000),
      respawnDue: s.respawnAt !== null && s.respawnAt <= clock(),
      world: s.snapshot };
  }
  function owner(room, peers) { refresh(peers); return rooms.get(room)?.ownerId || null; }
  return { rooms, refresh, publish, get, owner };
}
