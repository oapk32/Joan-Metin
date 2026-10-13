import { randomBytes, createHash } from 'node:crypto';

const SESSION_MS = 12 * 60 * 60 * 1000;
const LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LIMIT_REQUESTS = 12;
const COOKIE = 'joan_session';

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}
const fail = (res, status, message) => json(res, status, { error: message });

function cookieKey(req) {
  const match = String(req.headers.cookie || '').match(/(?:^|;\s*)joan_session=([A-Za-z0-9_-]{43})(?:;|$)/);
  return match && createHash('sha256').update(match[1]).digest('hex');
}

async function parseCredentials(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
    return { error: 'Očekávám JSON', status: 415 };
  }
  let text = '';
  let bytes = 0;
  try {
    for await (const part of req) {
      bytes += part.length;
      if (bytes > 2048) return { error: 'Požadavek je příliš velký', status: 413 };
      text += part.toString('utf8');
    }
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== 'object' ||
        typeof value.username !== 'string' || typeof value.password !== 'string') {
      return { error: 'Zadej uživatelské jméno a heslo', status: 400 };
    }
    return { username: value.username, password: value.password };
  } catch {
    return { error: 'Neplatný JSON', status: 400 };
  }
}

export function createAuthHttp({ register, authenticate, port }) {
  const sessions = new Map(); // token SHA-256 => account and expiry; in memory only
  const attempts = new Map(); // remote IP => attempt times
  const allowedHosts = new Set(['127.0.0.1:' + port, 'localhost:' + port]);

  function allowedHost(req) { return allowedHosts.has(req.headers.host); }
  function allowedOrigin(req) {
    return typeof req.headers.origin === 'string' &&
      req.headers.origin === 'http://' + req.headers.host;
  }

  function sessionFor(req) {
    const key = cookieKey(req);
    if (!key) return null;
    const session = sessions.get(key);
    if (!session) return null;
    if (session.expires <= Date.now()) {
      sessions.delete(key);
      return null;
    }
    return { key, account: session.account };
  }

  function sessionValid(key) {
    if (!key) return false;
    const session = sessions.get(key);
    if (session && session.expires > Date.now()) return true;
    sessions.delete(key);
    return false;
  }

  function revoke(req) {
    const session = sessionFor(req);
    if (session) sessions.delete(session.key);
  }

  function createSession(req, res, account) {
    revoke(req);
    if (sessions.size >= 200) {
      const oldest = sessions.keys().next().value;
      if (oldest) sessions.delete(oldest);
    }
    const token = randomBytes(32).toString('base64url');
    const key = createHash('sha256').update(token).digest('hex');
    sessions.set(key, { account: { id: account.id, username: account.username }, expires: Date.now() + SESSION_MS });
    res.setHeader('set-cookie', COOKIE + '=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200');
    return account;
  }

  function rateAllowed(req) {
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (attempts.get(ip) || []).filter(time => now - time < LIMIT_WINDOW_MS);
    if (recent.length >= LIMIT_REQUESTS) { attempts.set(ip, recent); return false; }
    recent.push(now);
    attempts.set(ip, recent);
    if (attempts.size > 300) {
      for (const [address, times] of attempts) {
        if (times[times.length - 1] < now - LIMIT_WINDOW_MS) attempts.delete(address);
      }
    }
    return true;
  }

  async function handle(req, res, pathname) {
    if (!pathname.startsWith('/api/')) return false;
    if (!allowedHost(req)) { fail(res, 403, 'Zakázaný host'); return true; }
    if (pathname === '/api/me' && req.method === 'GET') {
      const session = sessionFor(req);
      json(res, 200, session ? { authenticated: true, username: session.account.username } : { authenticated: false });
      return true;
    }
    if (!['/api/register', '/api/login', '/api/logout'].includes(pathname)) {
      fail(res, 404, 'Nenalezeno');
      return true;
    }
    if (req.method !== 'POST') { fail(res, 405, 'Metoda není povolena'); return true; }
    if (!allowedOrigin(req)) { fail(res, 403, 'Neplatný původ požadavku'); return true; }
    if (pathname === '/api/logout') {
      revoke(req);
      json(res, 200, { ok: true }, { 'set-cookie': COOKIE + '=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      return true;
    }
    if (!rateAllowed(req)) { fail(res, 429, 'Příliš mnoho pokusů, zkus to za 10 minut'); return true; }
    const credentials = await parseCredentials(req);
    if (credentials.error) { fail(res, credentials.status, credentials.error); return true; }
    try {
      if (pathname === '/api/register') {
        const account = await register(credentials.username, credentials.password);
        createSession(req, res, account);
        json(res, 201, { ok: true, username: account.username });
      } else {
        const account = await authenticate(credentials.username, credentials.password);
        if (!account) { fail(res, 401, 'Nesprávné jméno nebo heslo'); return true; }
        createSession(req, res, account);
        json(res, 200, { ok: true, username: account.username });
      }
    } catch (error) {
      if (error.message === 'Username already taken') {
        fail(res, 409, 'Uživatelské jméno je obsazené');
      } else if (/^Invalid username|^Password must/.test(error.message)) {
        fail(res, 400, 'Jméno: 3–32 znaků A-Z, 0-9, _. Heslo: 12–256 bajtů.');
      } else {
        console.error('Database account request failed:', error.message);
        fail(res, 503, 'Databáze účtů je dočasně nedostupná');
      }
    }
    return true;
  }

  return { handle, allowedHost, allowedOrigin, sessionFor, sessionValid };
}
