import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabasePool } from '../db.js';

test('Database connection rejects missing password', () => {
  assert.throws(() => createDatabasePool({ PGHOST: '127.0.0.1' }), /Missing PGPASSWORD/);
});

test('Database connection only allows loopback', () => {
  assert.throws(() => createDatabasePool({ PGHOST: '203.0.113.2', PGPASSWORD: 'example' }), /Remote PostgreSQL/);
});

test('Database connection uses restricted local pool', async () => {
  const pool = createDatabasePool({ PGHOST: '127.0.0.1', PGUSER: 'joan_app', PGDATABASE: 'joan_metiny', PGPASSWORD: 'example' });
  try {
    assert.equal(pool.options.host, '127.0.0.1');
    assert.equal(pool.options.max, 5);
    assert.equal(pool.options.ssl, false);
  } finally {
    await pool.end();
  }
});
