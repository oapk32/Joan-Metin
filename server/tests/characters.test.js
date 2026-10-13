import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validCharacterName, validClass, validId, validateServerProgress,
  listCharacters, getCharacter, createCharacter, saveServerProgress, CharacterError
} from '../characters.js';

const basic = {
  level: 1, exp: 0, yang: 0, mapId: 'village', x: 40, y: 60,
  state: { inventory: [], equipment: {}, skills: {}, quests: {} }
};

test('Character input has bounded names, allowed classes and positive bigint IDs', () => {
  assert.equal(validCharacterName('Jana_česká'), true);
  assert.equal(validCharacterName(' Karel '), false);
  assert.equal(validCharacterName('A'), false);
  assert.equal(validCharacterName('a'.repeat(25)), false);
  assert.equal(validClass('warrior'), true);
  assert.equal(validClass('god'), false);
  assert.equal(validId('9223372036854775807'), true);
  assert.equal(validId('9223372036854775808'), false);
  assert.equal(validId('01'), false);
});

test('Account-scoped list/get always filters on account_id', async () => {
  const queries = [];
  const pool = { query: async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [] };
  } };
  assert.deepEqual(await listCharacters(pool, '2'), []);
  assert.equal(await getCharacter(pool, '2', '91'), null);
  assert.match(queries[0].sql, /account_id = \$1/);
  assert.deepEqual(queries[0].params, ['2']);
  assert.match(queries[1].sql, /account_id = \$1 AND c\.id = \$2/);
  assert.deepEqual(queries[1].params, ['2', '91']);
});

test('Creation locks owner row and commits only valid owned character', async () => {
  const queries = [];
  let released = false;
  const db = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT id FROM accounts')) return { rowCount: 1, rows: [{ id: '3' }] };
      if (sql.startsWith('SELECT COUNT')) return { rows: [{ count: 0 }] };
      if (sql.startsWith('INSERT INTO characters')) {
        return { rows: [{ id: '7', name: 'Hrdina', class: 'warrior', level: 1 }] };
      }
      return {};
    },
    release() { released = true; }
  };
  const character = await createCharacter({ connect: async () => db }, '3', { name: 'Hrdina', cls: 'warrior' });
  assert.equal(character.id, '7');
  assert.deepEqual(queries.map(entry => entry.sql.split(' ')[0]), ['BEGIN', 'SELECT', 'SELECT', 'INSERT', 'COMMIT']);
  assert.match(queries[1].sql, /FOR UPDATE/);
  assert.deepEqual(queries[3].params, ['3', 'Hrdina', 'warrior']);
  assert.equal(released, true);
});

test('Creation rolls back on exhausted slots and releases connection', async () => {
  let rolledBack = false;
  let released = false;
  const db = { query: async sql => {
    if (sql.startsWith('SELECT id')) return { rowCount: 1 };
    if (sql.startsWith('SELECT COUNT')) return { rows: [{ count: 6 }] };
    if (sql === 'ROLLBACK') rolledBack = true;
    return {};
  }, release() { released = true; } };
  await assert.rejects(
    createCharacter({ connect: async () => db }, '3', { name: 'Hrdina', cls: 'warrior' }),
    error => error instanceof CharacterError && error.code === 'limit'
  );
  assert.equal(rolledBack, true);
  assert.equal(released, true);
});

test('Server progress rejects arbitrary fields, overlarge state and illegal values', () => {
  assert.equal(validateServerProgress(basic).level, 1);
  assert.throws(() => validateServerProgress({ ...basic, yang: -1 }), /invalid_progress/);
  assert.throws(() => validateServerProgress({ ...basic, arbitrary: 123 }), /invalid_progress/);
  assert.throws(() => validateServerProgress({ ...basic, state: { data: 'x'.repeat(262145) } }), /invalid_progress/);
  assert.throws(() => validateServerProgress({ ...basic, state: JSON.parse('{"__proto__":{"isAdmin":true}}') }), /invalid_progress/);
});

test('Server-only atomic save uses ownership, expected revision and updates snapshot', async () => {
  const queries = [];
  let released = false;
  const db = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT revision')) return { rowCount: 1, rows: [{ revision: '2' }] };
      if (sql.startsWith('UPDATE characters')) return { rows: [{ revision: '3' }] };
      return {};
    },
    release() { released = true; }
  };
  const outcome = await saveServerProgress({ connect: async () => db }, {
    accountId: '4', characterId: '10', expectedRevision: 2,
    progress: { ...basic, level: 2, exp: 100 }
  });
  assert.deepEqual(outcome, { revision: '3' });
  assert.deepEqual(queries[1].params, ['4', '10']);
  assert.match(queries[1].sql, /account_id = \$1 AND id = \$2 FOR UPDATE/);
  assert.match(queries[2].sql, /WHERE account_id = \$1 AND id = \$2/);
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.equal(released, true);
});

test('Stale saves roll back without touching inventory or economy', async () => {
  const queries = [];
  let released = false;
  const db = {
    query: async sql => {
      queries.push(sql);
      if (sql.startsWith('SELECT revision')) return { rowCount: 1, rows: [{ revision: '8' }] };
      return {};
    },
    release() { released = true; }
  };
  await assert.rejects(
    saveServerProgress({ connect: async () => db }, {
      accountId: '4', characterId: '10', expectedRevision: 7, progress: basic
    }),
    error => error instanceof CharacterError && error.code === 'conflict'
  );
  assert.deepEqual(queries, ['BEGIN', queries[1], 'ROLLBACK']);
  assert.equal(released, true);
});
