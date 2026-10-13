import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createAuthHttp } from '../auth-http.js';
import { hashPassword, verifyPassword } from '../auth.js';

test('private auth endpoints: origin, registration, login, sessions, logout', async t => {
  const accounts = new Map();
  let authHttp;
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (await authHttp.handle(req, res, pathname)) return;
    if (pathname === '/joan/' && !authHttp.sessionFor(req)) {
      res.writeHead(302, { location: '/account/' }).end(); return;
    }
    res.writeHead(200).end('OK');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const port = server.address().port;
  const origin = 'http://127.0.0.1:' + port;
  authHttp = createAuthHttp({
    port,
    async register(username, password) {
      if (accounts.has(username)) throw new Error('Username already taken');
      const account = { id: String(accounts.size + 1), username, hashed: await hashPassword(password) };
      accounts.set(username, account);
      return { id: account.id, username: account.username };
    },
    async authenticate(username, password) {
      const account = accounts.get(username);
      if (!account || !(await verifyPassword(password, account.hashed))) return null;
      return { id: account.id, username: account.username };
    }
  });
  const post = (path, body, cookie, requestOrigin = origin) => fetch(origin + path, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      origin: requestOrigin,
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
  const credentials = { username: 'Account_1', password: 'valid_password_123' };

  const anonymous = await fetch(origin + '/api/me');
  assert.deepEqual(await anonymous.json(), { authenticated: false });
  assert.equal((await fetch(origin + '/joan/', { redirect: 'manual' })).status, 302);

  const badOrigin = await post('/api/register', credentials, null, 'http://evil.example');
  assert.equal(badOrigin.status, 403);
  const registration = await post('/api/register', credentials);
  assert.equal(registration.status, 201);
  const cookieHeader = registration.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);
  assert.ok(!cookieHeader.includes(credentials.password));
  const cookie = cookieHeader.split(';')[0];
  assert.equal((await fetch(origin + '/api/me', { headers: { cookie } })).status, 200);
  assert.deepEqual(await (await fetch(origin + '/api/me', { headers: { cookie } })).json(), {
    authenticated: true, username: 'Account_1'
  });
  assert.equal((await fetch(origin + '/joan/', { headers: { cookie }, redirect: 'manual' })).status, 200);

  const duplicate = await post('/api/register', credentials);
  assert.equal(duplicate.status, 409);
  const badLogin = await post('/api/login', { ...credentials, password: 'wrong_password_123' });
  assert.equal(badLogin.status, 401);
  const login = await post('/api/login', credentials);
  assert.equal(login.status, 200);
  const secondCookie = login.headers.get('set-cookie').split(';')[0];

  const logout = await post('/api/logout', {}, secondCookie);
  assert.equal(logout.status, 200);
  assert.deepEqual(await (await fetch(origin + '/api/me', { headers: { cookie: secondCookie } })).json(), {
    authenticated: false
  });
  assert.equal((await post('/api/login', credentials, undefined, 'null')).status, 403);
  assert.equal((await fetch(origin + '/api/me', { headers: { host: 'evil.example' } })).status, 403);
});
