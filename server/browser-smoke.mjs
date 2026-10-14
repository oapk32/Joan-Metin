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
  page.on('pageerror', error => errors.push(error.stack || error.message));
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
        if (String(args[0]).includes('/combat-ws') || String(args[0]).includes('/v134-ws')) {
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

  // Two real Chromium contexts enter one server-owned v134 region.
  await Promise.all([
    a.page.goto(base + '/account/', { waitUntil:'domcontentloaded' }),
    b.page.goto(base + '/account/', { waitUntil:'domcontentloaded' })
  ]);
  await until(async () => (await a.page.getByRole('link', {
    name:'Test mapy 1–2 (zatím bez grafiky v134)'
  }).count()) > 0, 'Joan first-map entry link');
  const edgeA = await a.page.getByRole('link', {
    name:'Test mapy 1–2 (zatím bez grafiky v134)'
  }).first().getAttribute('href');
  const edgeB = await b.page.getByRole('link', {
    name:'Test mapy 1–2 (zatím bez grafiky v134)'
  }).first().getAttribute('href');
  assert.match(edgeA, /^\/arena\/\?character=[1-9]\d*&region=joan-1-2$/);
  await delay(200); // previous arena socket closes and releases its character
  await Promise.all([
    a.page.goto(base + edgeA, { waitUntil:'domcontentloaded' }),
    b.page.goto(base + edgeB, { waitUntil:'domcontentloaded' })
  ]);
  await until(async () => (await a.page.locator('#status').textContent() || '')
    .includes('Okraje Joanu 1–2'), 'first map WebSocket browser A');
  await until(async () => (await b.page.locator('#status').textContent() || '')
    .includes('Okraje Joanu 1–2'), 'first map WebSocket browser B');
  await until(async () => (await a.page.locator('#stats').textContent() || '')
    .includes('hráčů v okolí: 2'), 'two players sharing first original Joan region');
  assert.deepEqual(await a.page.locator('#arena').evaluate(c => [c.width,c.height]),
    [1100,660]);
  const firstMapMobs = await a.page.evaluate(() => window.__combatFrames
    .filter(m => m.type === 'combat-snapshot' && m.mobs?.length).at(-1)?.mobs || []);
  assert.ok(firstMapMobs.some(m => m.type === 'dog'), 'original region has dogs');
  assert.ok(firstMapMobs.some(m => m.type === 'wolf'), 'original region has wolves');
  assert.deepEqual(a.errors, [], 'no errors in first-map Chromium browser A');
  assert.deepEqual(b.errors, [], 'no errors in first-map Chromium browser B');
  // Original v134 renderer with new authoritative server-owned monsters.
  // This is a distinct online mode; do not load or overwrite offline saves.
  await Promise.all([
    a.page.goto(base + '/account/', { waitUntil: 'domcontentloaded' }),
    b.page.goto(base + '/account/', { waitUntil: 'domcontentloaded' })
  ]);
  const onlineLabel = 'Online v původní grafice 1–2 (test)';
  await until(async () => (await a.page.getByRole('link', { name: onlineLabel }).count()) > 0,
    'native v134 online link available');
  const onlineA = await a.page.getByRole('link', { name: onlineLabel }).first().getAttribute('href');
  const onlineB = await b.page.getByRole('link', { name: onlineLabel }).first().getAttribute('href');
  assert.match(onlineA, /^\/joan\/\?online=1&character=[1-9]\d*$/);
  await delay(300);
  await Promise.all([
    a.page.goto(base + onlineA, { waitUntil: 'domcontentloaded' }),
    b.page.goto(base + onlineB, { waitUntil: 'domcontentloaded' })
  ]);
  await until(() => a.page.evaluate(() => window.JoanOnline?.testState?.().connected === true),
    'first original v134 canvas connected to Oracle-authoritative mobs', 18000);
  await until(() => b.page.evaluate(() => window.JoanOnline?.testState?.().connected === true),
    'second original v134 canvas connected', 18000);
  const nativeA = await a.page.evaluate(() => window.JoanOnline.testState());
  const nativeB = await b.page.evaluate(() => window.JoanOnline.testState());
  assert.equal(nativeA.players.length, 2, 'native map AOI includes two live characters');
  assert.equal(nativeB.players.length, 2, 'both receive server-owned nearby characters');
  assert.ok(nativeA.mobs.some(m => m.type === 'dog'), 'server dogs in original v134 graphics');
  assert.ok(nativeA.mobs.some(m => m.type === 'wolf'), 'server wolves in original v134 graphics');
  assert.equal(await a.page.locator('canvas#game').count(), 1, 'original game canvas preserved');
  assert.equal(await a.page.locator('#creation').evaluate(el => el.classList.contains('hidden')),
    true, 'offline roster overlay never appears online');
  await a.page.keyboard.down('d');
  await delay(320);
  await a.page.keyboard.up('d');
  await until(() => a.page.evaluate(() => {
    const frames = window.__combatFrames || [];
    return frames.some(m => m.type === 'combat-delta' && m.playersChanged?.some(p => p.id === window.JoanOnline.testState().myId));
  }), 'native WASD sends authoritative movement');
  await delay(150);
  assert.deepEqual(a.errors, [], 'native first-map renderer has no uncaught JavaScript errors');
  assert.deepEqual(b.errors, [], 'second native first-map renderer has no uncaught JavaScript errors');
  // Attack one real first-map dog from v134 canvas, with keyboard movement
  // and a server-owned hit/HP delta observed by the other browser.
  let firstMob = null;
  let closeEnough = false;
  for (let step = 0; step < 40; step++) {
    const s = await a.page.evaluate(() => window.JoanOnline.testState());
    const me = s.players.find(p => p.id === s.myId);
    firstMob = s.mobs.find(m => m.id === 'joan-dog-1' && m.hp > 0);
    assert.ok(me && firstMob, 'first region enemy and controlled hero are visible');
    const x = firstMob.x - me.x, y = firstMob.y - me.y;
    if (Math.hypot(x, y) < 54) { closeEnough = true; break; }
    const movement = [];
    if (Math.abs(x) > 12) movement.push(x > 0 ? 'd' : 'a');
    if (Math.abs(y) > 12) movement.push(y > 0 ? 's' : 'w');
    for (const key of movement) await a.page.keyboard.down(key);
    await delay(150);
    for (const key of movement) await a.page.keyboard.up(key);
    await delay(40);
  }
  assert.ok(closeEnough, 'keyboard moves original v134 hero within real server combat range');
  const initialHp = firstMob.hp;
  for (let attempt = 0; attempt < 5; attempt++) {
    await a.page.keyboard.press('Space');
    await delay(580);
    const accepted = await a.page.evaluate(() => window.__combatFrames
      .some(m => m.type === 'combat-hit' && m.ok && m.mobId === 'joan-dog-1'));
    if (accepted) break;
  }
  await until(() => a.page.evaluate(() => window.__combatFrames.some(m =>
    m.type === 'combat-hit' && m.ok && m.mobId === 'joan-dog-1')),
    'Space attacks server-owned v134 dog', 3000);
  await until(() => b.page.evaluate(({ id, initialHp }) => window.__combatFrames
    .some(m => m.type === 'combat-delta' && m.mobsChanged?.some(
      mob => mob.id === id && mob.hp < initialHp
    )), { id: 'joan-dog-1', initialHp }), 'second v134 canvas sees same real HP loss', 6000);
  assert.deepEqual(a.errors, [], 'native v134 attacker has no page errors after combat');
  assert.deepEqual(b.errors, [], 'native v134 observer has no page errors after combat');
  console.log('BROWSER PASS: native v134 real keyboard PvE attack, shared server HP in two original canvases');
  await a.context.close();
  await b.context.close();
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
