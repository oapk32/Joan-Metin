import pg from 'pg';

const { Pool } = pg;

// Credentials are provided through the process environment, never committed to Git.
export function createDatabasePool(env = process.env) {
  const host = env.PGHOST || '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('Remote PostgreSQL connections are disabled for this prototype.');
  }
  if (!env.PGPASSWORD) {
    throw new Error('Missing PGPASSWORD environment variable. Do not put passwords in source files.');
  }
  return new Pool({
    host,
    port: Number(env.PGPORT || 5432),
    database: env.PGDATABASE || 'joan_metiny',
    user: env.PGUSER || 'joan_app',
    password: env.PGPASSWORD,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    ssl: false
  });
}

export async function checkDatabase(pool) {
  const result = await pool.query('SELECT current_user, current_database(), current_setting(\'server_version\') AS server_version');
  return result.rows[0];
}
