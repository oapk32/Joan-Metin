import test from 'node:test';
import assert from 'node:assert/strict';
import { listMigrations, migrationProgram } from '../migrations/migrate.js';

test('Migrations are versioned, additive and checksummed', () => {
  const files = listMigrations();
  assert.deepEqual(files.map(f => f.version), [1, 2, 3]);
  for (const file of files) {
    assert.match(file.checksum, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(file.sql, /\b(DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i);
  }
  const script = migrationProgram();
  assert.match(script, /pg_advisory_xact_lock/);
  assert.match(script, /schema_migrations/);
  assert.match(script, /\\if :should_apply/);
  assert.match(script, /COMMIT;/);
  assert.match(script, /character_saves/);
});
