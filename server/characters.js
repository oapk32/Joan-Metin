// Private character repository for the multiplayer beta.
// Every read/write is scoped by authenticated account ID. Economic progress may
// ONLY be updated through saveServerProgress(), never from a browser request.
export const CLASSES = Object.freeze(['warrior', 'ninja', 'sura', 'shaman']);
export const MAX_CHARACTERS = 6;
const MAX_ID = 9223372036854775807n;

export function validId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value)) return false;
  return BigInt(value) <= MAX_ID;
}

export function validCharacterName(value) {
  return typeof value === 'string' &&
    value === value.normalize('NFC') &&
    [...value].length >= 2 && [...value].length <= 24 &&
    /^[\p{L}\p{N}][\p{L}\p{N} _-]*[\p{L}\p{N}]$/u.test(value);
}

export function validClass(value) { return CLASSES.includes(value); }

export class CharacterError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const FIELDS =
  'c.id::text AS id, c.name, c.class, c.level, c.exp::text AS exp, ' +
  'c.yang::text AS yang, c.map_id AS "mapId", c.pos_x AS x, c.pos_y AS y, ' +
  'c.revision::text AS revision, c.created_at AS "createdAt", c.updated_at AS "updatedAt"';

export async function listCharacters(pool, accountId) {
  if (!validId(accountId)) throw new CharacterError('invalid_owner');
  const { rows } = await pool.query(
    'SELECT ' + FIELDS + ' FROM characters c WHERE c.account_id = $1 ORDER BY c.id ASC',
    [accountId]
  );
  return rows;
}

export async function getCharacter(pool, accountId, characterId) {
  if (!validId(accountId) || !validId(characterId)) throw new CharacterError('invalid_id');
  const { rows } = await pool.query(
    'SELECT ' + FIELDS + ', COALESCE(s.state, \'{}\'::jsonb) AS "state", ' +
    'COALESCE(s.schema_version, 1) AS "schemaVersion" ' +
    'FROM characters c LEFT JOIN character_saves s ON s.character_id = c.id ' +
    'WHERE c.account_id = $1 AND c.id = $2',
    [accountId, characterId]
  );
  return rows[0] || null;
}

export async function createCharacter(pool, accountId, { name, cls }) {
  if (!validId(accountId)) throw new CharacterError('invalid_owner');
  if (!validCharacterName(name) || !validClass(cls)) throw new CharacterError('invalid_input');
  const db = await pool.connect();
  let began = false;
  try {
    await db.query('BEGIN');
    began = true;
    // Lock account to serialize character creations (including slot limit).
    const owner = await db.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
    if (!owner.rowCount) throw new CharacterError('invalid_owner');
    const count = await db.query('SELECT COUNT(*)::integer AS count FROM characters WHERE account_id = $1', [accountId]);
    if (count.rows[0].count >= MAX_CHARACTERS) throw new CharacterError('limit');
    const result = await db.query(
      'INSERT INTO characters (account_id, name, class) VALUES ($1, $2, $3) ' +
      'RETURNING id::text AS id, name, class, level, exp::text AS exp, yang::text AS yang, ' +
      'map_id AS "mapId", pos_x AS x, pos_y AS y, revision::text AS revision',
      [accountId, name, cls]
    );
    await db.query('COMMIT');
    began = false;
    return result.rows[0];
  } catch (error) {
    if (began) await db.query('ROLLBACK');
    if (error.code === '23505') throw new CharacterError('duplicate_name');
    throw error;
  } finally {
    db.release();
  }
}

export function validateServerProgress(progress) {
  if (progress === null || typeof progress !== 'object' || Array.isArray(progress)) {
    throw new CharacterError('invalid_progress');
  }
  const keys = ['level', 'exp', 'yang', 'mapId', 'x', 'y', 'state'];
  if (Object.keys(progress).length !== keys.length || keys.some(key => !Object.hasOwn(progress, key))) {
    throw new CharacterError('invalid_progress');
  }
  const { level, exp, yang, mapId, x, y, state } = progress;
  if (!Number.isInteger(level) || level < 1 || level > 120 ||
      !Number.isSafeInteger(exp) || exp < 0 ||
      !Number.isSafeInteger(yang) || yang < 0 ||
      typeof mapId !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(mapId) ||
      !Number.isFinite(x) || x < 0 || x > 1100 ||
      !Number.isFinite(y) || y < 0 || y > 660 ||
      state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new CharacterError('invalid_progress');
  }
  let json;
  try { json = JSON.stringify(state); }
  catch { throw new CharacterError('invalid_progress'); }
  if (!json || Buffer.byteLength(json, 'utf8') > 262144 ||
      /"(__proto__|constructor|prototype)"\s*:/.test(json)) {
    throw new CharacterError('invalid_progress');
  }
  return { level, exp, yang, mapId, x, y, json };
}

// Internal server-only transactional snapshot writer. Never expose this function
// to arbitrary client JSON. The future authoritative simulation must calculate
// items, EXP, Yang and all state changes BEFORE calling this function.
export async function saveServerProgress(pool, { accountId, characterId, expectedRevision, progress }) {
  if (!validId(accountId) || !validId(characterId) ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new CharacterError('invalid_id');
  }
  const state = validateServerProgress(progress);
  const db = await pool.connect();
  let began = false;
  try {
    await db.query('BEGIN');
    began = true;
    const check = await db.query(
      'SELECT revision::text AS revision FROM characters WHERE account_id = $1 AND id = $2 FOR UPDATE',
      [accountId, characterId]
    );
    if (!check.rowCount) throw new CharacterError('not_found');
    if (BigInt(check.rows[0].revision) !== BigInt(expectedRevision)) {
      throw new CharacterError('conflict');
    }
    const update = await db.query(
      'UPDATE characters SET level = $3, exp = $4, yang = $5, map_id = $6, ' +
      'pos_x = $7, pos_y = $8, revision = revision + 1, updated_at = NOW() ' +
      'WHERE account_id = $1 AND id = $2 RETURNING revision::text AS revision',
      [accountId, characterId, state.level, state.exp, state.yang, state.mapId, state.x, state.y]
    );
    const revision = update.rows[0].revision;
    await db.query(
      'INSERT INTO character_saves (character_id, schema_version, revision, state, saved_at) ' +
      'VALUES ($1, 1, $2, $3::jsonb, NOW()) ON CONFLICT (character_id) DO UPDATE ' +
      'SET schema_version = EXCLUDED.schema_version, revision = EXCLUDED.revision, ' +
      'state = EXCLUDED.state, saved_at = NOW()',
      [characterId, revision, state.json]
    );
    await db.query('COMMIT');
    began = false;
    return { revision };
  } catch (error) {
    if (began) await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
