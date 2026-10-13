import test from 'node:test';
import assert from 'node:assert/strict';
import { validUsername, validPassword, hashPassword, verifyPassword, registerAccount, authenticateAccount } from '../auth.js';

test('username and password input validation', () => {
  assert.equal(validUsername('Joan_123'), true);
  assert.equal(validUsername('a'), false);
  assert.equal(validUsername('bad name'), false);
  assert.equal(validPassword('twelveletters'), true);
  assert.equal(validPassword('short'), false);
});

test('passwords are salted and verified with scrypt', async () => {
  const one = await hashPassword('strong_password_123');
  const two = await hashPassword('strong_password_123');
  assert.notEqual(one, two);
  assert.equal(await verifyPassword('strong_password_123', one), true);
  assert.equal(await verifyPassword('wrong_password_123', one), false);
  assert.equal(await verifyPassword('anything', 'malformed'), false);
});

test('registration uses SQL parameters and never returns password hash', async () => {
  const statements = [];
  const pool = { query: async (sql, params) => {
    statements.push({ sql, params });
    return { rows: [{ id: '1', username: 'Joan_123' }] };
  } };
  const value = await registerAccount(pool, 'Joan_123', 'strong_password_123');
  assert.deepEqual(value, { id: '1', username: 'Joan_123' });
  assert.match(statements[0].sql, /VALUES \(\$1, \$2\)/);
  assert.match(statements[0].params[1], /^scrypt\$/);
});

test('login verifies password without returning password hash', async () => {
  const encoded = await hashPassword('strong_password_123');
  const pool = { query: async () => ({ rows: [{ id: '1', username: 'Joan_123', password_hash: encoded }] }) };
  assert.deepEqual(await authenticateAccount(pool, 'Joan_123', 'strong_password_123'), { id: '1', username: 'Joan_123' });
  assert.equal(await authenticateAccount(pool, 'Joan_123', 'bad_password_456'), null);
});
