import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Emits a versioned, transactional psql program to stdout; it does NOT connect
// to PostgreSQL or apply migrations itself. Pipe to admin psql with pipefail.
const directory = dirname(fileURLToPath(import.meta.url));
export function listMigrations() {
  const files = readdirSync(directory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const versions = new Set();
  return files.map(name => {
    const version = Number(name.slice(0, 3));
    if (versions.has(version)) throw new Error('Duplicate migration number: ' + version);
    versions.add(version);
    const sql = readFileSync(join(directory, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (!sql.trim() || /\\(?:i|include|copy|!)/i.test(sql)) {
      throw new Error('Unsafe or empty migration: ' + name);
    }
    return { version, name, checksum, sql };
  });
}

export function migrationProgram() {
  const migrations = listMigrations();
  const chunks = [
    '-- Generated SQL for psql. Apply using the postgres admin role.',
    '\\set ON_ERROR_STOP on'
  ];
  for (const migration of migrations) {
    const { version, name, checksum, sql } = migration;
    chunks.push(
      'BEGIN;',
      'SELECT pg_advisory_xact_lock(602026013);',
      'CREATE TABLE IF NOT EXISTS public.schema_migrations (' +
        ' version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum CHAR(64) NOT NULL,' +
        ' applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());',
      'DO $migration_check$ BEGIN',
      '  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = ' + version +
        " AND (name <> '" + name + "' OR checksum <> '" + checksum + "')) THEN",
      "    RAISE EXCEPTION 'Migration " + name + " was edited after application; aborting';",
      '  END IF;',
      'END $migration_check$;',
      "SELECT CASE WHEN EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = " +
        version + ") THEN 'false' ELSE 'true' END AS should_apply \\gset",
      '\\if :should_apply',
      '-- begin ' + name,
      sql.trim(),
      '-- end ' + name,
      'INSERT INTO public.schema_migrations (version, name, checksum) VALUES (' +
        version + ", '" + name + "', '" + checksum + "');",
      '\\echo Applied ' + name,
      '\\else',
      '\\echo Already applied ' + name,
      '\\endif',
      'COMMIT;'
    );
  }
  return chunks.join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === join(process.cwd(), process.argv[1].replace(/^\.\//, ''))) {
  process.stdout.write(migrationProgram());
}
