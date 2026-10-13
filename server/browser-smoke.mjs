// Real headless Chromium smoke test, run with:
//   JOAN_TEST_DATABASE_URL=postgresql://... node browser-smoke.mjs
// The CI runner uses a disposable PostgreSQL container and never connects to Oracle.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dbUrl = process.env.JOAN_TEST_DATABASE_URL;
if (!dbUrl) throw new Error('JOAN_TEST_DATABASE_URL is required');
const db = new URL(dbUrl);
const root = dirname(fileURLToPath(import.meta.url));
const port = 45000 + Math.floor(Math.random() * 12000);
const base = 'http://127.0.0.1:' + port;
const server = spawn(process.execPath, [join(root, 'index.js')], {
  cwd: root,
  env: {
    ...process.env, PORT: String(port), JOAN_AUTH_ENABLED: '1',
    JOAN_BIND_HOST: '127.0.0.1',
    PGHOST: db.hostname, PGPORT: db.port || '5432',
    PGDATABASE: decodeURIComponent(db.pathname.slice(1)),
    PGUSER: decodeURIComponent(db.username),
    PGPASSWORD: decodeURIComponent(db.password)
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let stderr = '';
server.stderr.on('data', chunk => { stderr += chunk; });
let browser;

async function until(predicate, label, maxMs = 14000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    if (await predicate()) return;
    await delay(90);
  }
  throw new Error('Timed out: ' + label);
}

async function createBrowserPlayer(index) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/account/', { waitUntil: 'domcontentloaded' });
  await page.locator('#registerMode').click();
  const username = 'browser' + randomBytes(5).toString('hex') + index;
  await page.locator('#username').fill(username);
  await page.locator('#password').fill('random-ci-Only-Long-Passphrase-2026');
  await Promise.all([
    page.waitForURL('**/joan/', { timeout: 15000 }),
    page.locator('#submit').click()
  ]);
  await page.locator('#game').waitFor({ state: 'attached' });
  await until(async () => page.evaluate(() => !!window.__AUDIO_ASSETS__?.music), 'audio manifest evaluated');
  const music = await page.evaluate(() => window.__AUDIO_ASSETS__.music);
  assert.equal(music, '/joan/audio/music');
  const response = await page.request.get(base + music, { headers: { range: 'bytes=0-63' } });
  assert.equal(response.status(), 206, 'sound streams 64-byte range');
  assert.equal((await response.body()).length, 64);

  await page.goto(base + '/account/', { waitUntil: 'domcontentloaded' });
  await until(() => page.locator('#loggedName').textContent().then(name => name === username),
    'account details in Chromium');
  const name = 'Postava' + randomBytes(5).toString('hex') + index;
  await page.locator('#characterName').fill(name);
  await page.locator('#characterClass').selectOption('warrior');
  await page.locator('#createCharacterBtn').click();
  await page.getByText(name, { exact: false }).waitFor();
  const link = page.getByRole('link', { name: 'Vyzkoušet společný boj' }).first();
  const href = await link.getAttribute('href');
  assert.match(href, /^\/arena\/\?character=[1-9]\d*$/);

  // Observe only the game's WebSocket frames. This is installed before the
  // arena initializes and tests a real Chromium WebSocket connection.
  await page.addInitScript(() => {
    window.__combatFrames = [];
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(...args) {
        super(...args);
        if (String(args[0]).includes('/combat-ws')) {
          this.addEventListener('message', evt => {
            try {
              window.__combatFrames.push(JSON.parse(evt.data));
              if (window.__combatFrames.length > 600) window.__combatFrames.shift();
            } catch {}
          });
        }
      }
    };
  });
  await page.goto(base + href, { waitUntil: 'domcontentloaded' });
  await until(() => page.locator('#status').textContent().then(s => s.includes('Připojeno do společné arény')),
    'arena authenticated WebSocket');
  assert.equal(await page.locator('canvas#arena').count(), 1);
  assert.deepEqual(errors, [], 'page has no uncaught JavaScript errors');
  return { context, page, errors, username, name };
}

try {
  await until(async () => {
    if (server.exitCode !== null) throw new Error('Test server exited: ' + stderr);
    try { return (await fetch(base + '/account/')).status === 200; }
    catch { return false; }
  }, 'Node login server startup');

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const a = await createBrowserPlayer('a');
  const b = await createBrowserPlayer('b');

  await until(() => a.page.locator('#stats').textContent().then(s => s.includes('hráčů v okolí: 2')),
    'both real Chromium browser players see each other');
  await until(() => b.page.locator('#stats').textContent().then(s => s.includes('hráčů v okolí: 2')),
    'second player sees first player');

  const initialMobs = await a.page.evaluate(() =>
    window.__combatFrames.find(m => m.type === 'combat-snapshot' && m.mobs?.length)?.mobs);
  assert.ok(initialMobs.some(m => m.id === 'wolf-1'), 'wolf is visible in shared arena');
  assert.equal(initialMobs.some(m => m.id === 'orc-1'), false, 'far-away orc is not streamed');

  // A real keyboard movement in Chromium; the browser sends only directional
  // input and the server decides the character's position.
  await a.page.keyboard.down('d');
  await delay(1600);
  await a.page.keyboard.up('d');
  await a.page.keyboard.down('w');
  await delay(540);
  await a.page.keyboard.up('w');

  // Combat validation: the actual UI event must reach the authoritative
  // server. If an enemy has moved, allow further WASD adjustments below.
  for (let attempt = 0; attempt < 6; attempt++) {
    await a.page.keyboard.press('Space');
    const hit = await a.page.evaluate(() => window.__combatFrames
      .some(m => m.type === 'combat-hit' && m.ok));
    if (hit) break;
    await delay(200);
  }
  await until(() => a.page.evaluate(() =>
    window.__combatFrames.some(m => m.type === 'combat-hit' && m.ok)),
  'real player hits server-owned monster via Space', 5000);
  await until(() => b.page.evaluate(() =>
    window.__combatFrames.some(m => m.type === 'combat-delta' &&
      m.mobsChanged?.some(mob => mob.id === 'wolf-1' && mob.hp < 70))),
  'second browser sees changed shared mob HP');

  assert.deepEqual(a.errors, [], 'first arena browser has no uncaught errors');
  assert.deepEqual(b.errors, [], 'second arena browser has no uncaught errors');
  console.log('BROWSER PASS: registration, v134 page, on-demand music, 2 players, keyboard PvE, shared HP, sectors and account UI');
  await a.context.close();
  await b.context.close();
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
