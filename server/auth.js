import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const HASH_BYTES = 64;
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export function validUsername(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_]{3,32}$/.test(value);
}
export function validPassword(value) {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 12 &&
    Buffer.byteLength(value, 'utf8') <= 256;
}

export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error('Password must be 12–256 UTF-8 bytes');
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 32 * 1024 * 1024 });
  return ['scrypt', String(N), String(R), String(P), salt.toString('hex'), hash.toString('hex')].join('$');
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' ||
      parts[1] !== String(N) || parts[2] !== String(R) || parts[3] !== String(P) ||
      !/^[0-9a-f]{32}$/.test(parts[4]) || !/^[0-9a-f]{128}$/.test(parts[5])) return false;
  if (Buffer.byteLength(password, 'utf8') > 256) return false;
  const actual = await scrypt(password, Buffer.from(parts[4], 'hex'), HASH_BYTES, { N, r: R, p: P, maxmem: 32 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(parts[5], 'hex'));
}

// This module provides DB functions only; these must not be exposed via HTTP
// until session tokens, TLS, origin checks and rate limiting are implemented.
export async function registerAccount(pool, username, password) {
  if (!validUsername(username)) throw new Error('Invalid username: use 3-32 ASCII letters, numbers or underscore');
  const passwordHash = await hashPassword(password);
  try {
    const { rows } = await pool.query(
      'INSERT INTO accounts (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, passwordHash]
    );
    return rows[0];
  } catch (error) {
    if (error.code === '23505') throw new Error('Username already taken');
    throw error;
  }
}

export async function authenticateAccount(pool, username, password) {
  if (!validUsername(username) || !validPassword(password)) return null;
  const { rows } = await pool.query(
    'SELECT id, username, password_hash FROM accounts WHERE username = $1',
    [username]
  );
  if (rows.length === 0) return null;
  return (await verifyPassword(password, rows[0].password_hash))
    ? { id: rows[0].id, username: rows[0].username }
    : null;
}
