import { createDatabasePool, checkDatabase } from './db.js';

let pool;
try {
  pool = createDatabasePool();
  const result = await checkDatabase(pool);
  console.log('PostgreSQL connection OK:', result.current_user, result.current_database, result.server_version);
} catch (error) {
  console.error('PostgreSQL connection failed:', error.message);
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
