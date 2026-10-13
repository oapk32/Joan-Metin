import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { listCharacters, getCharacter, createCharacter, saveServerProgress } from '../characters.js';

test('PostgreSQL 16: account isolation, character creation, optimistic transactional saves', {
  skip: !process.env.JOAN_TEST_DATABASE_URL
}, async t => {
  const pool = new Pool({ connectionString: process.env.JOAN_TEST_DATABASE_URL, max: 2 });
  t.after(() => pool.end());
  const key = randomBytes(5).toString('hex');
  const account = async suffix => {
    const result = await pool.query(
      'INSERT INTO accounts (username, password_hash) VALUES ($1, $2) RETURNING id::text AS id',
      ['test_' + key + suffix, 'test-fixture-not-a-real-password-hash']
    );
    return result.rows[0].id;
  };
  const alice = await account('a');
  const bob = await account('b');
  await assert.rejects(
    pool.query('UPDATE accounts SET username = $2 WHERE id = $1', [alice, 'tampered_account']),
    error => error.code === '42501'
  );

  const hero = await createCharacter(pool, alice, { name: 'A' + key, cls: 'warrior' });
  assert.equal(hero.level, 1);
  assert.equal(hero.revision, '0');
  assert.equal((await listCharacters(pool, alice)).length, 1);
  assert.equal((await listCharacters(pool, bob)).length, 0);
  assert.equal(await getCharacter(pool, bob, hero.id), null);
  assert.equal((await getCharacter(pool, alice, hero.id)).name, hero.name);

  await assert.rejects(
    saveServerProgress(pool, {
      accountId: bob, characterId: hero.id, expectedRevision: 0,
      progress: { level: 120, exp: 1000, yang: 99999, mapId: 'village', x: 1, y: 1, state: {} }
    }),
    /not_found/
  );
  const progress = {
    level: 2, exp: 220, yang: 55, mapId: 'village',
    x: 120, y: 210, state: {
      inventory: [{ id: 'sword_1', qty: 1 }],
      equipment: { weapon: 'sword_1' },
      skills: { skill_1: 1 },
      quests: {}
    }
  };
  assert.deepEqual(await saveServerProgress(pool, {
    accountId: alice, characterId: hero.id, expectedRevision: 0, progress
  }), { revision: '1' });
  const saved = await getCharacter(pool, alice, hero.id);
  assert.equal(saved.level, 2);
  assert.equal(saved.exp, '220');
  assert.equal(saved.yang, '55');
  assert.equal(saved.revision, '1');
  assert.deepEqual(saved.state, progress.state);
  await assert.rejects(
    saveServerProgress(pool, { accountId: alice, characterId: hero.id, expectedRevision: 0, progress }),
    /conflict/
  );
  assert.equal((await getCharacter(pool, alice, hero.id)).revision, '1');

  const migration = await pool.query(
    'SELECT version FROM schema_migrations ORDER BY version'
  ).catch(() => null);
  // Migrations are administrator-owned; the restricted app role must not get
  // automatic read access to the history table.
  assert.equal(migration, null);
});
