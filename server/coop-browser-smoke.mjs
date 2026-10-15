// Real two-browser CO-OP regression for room ownership, map 1/2, and server-clock respawn.
// Runs only with COOP_WORLD_BROWSER_TEST=1 and disposable browser profiles.
// Never use the debug hooks on a public tunnel.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = 45500 + Math.floor(Math.random() * 10000);
const code = 'disposablecooptestroom2026';
const base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, [join(root, 'coop-host.js')], {
  cwd: root,
  env: { ...process.env, COOP_PORT: String(port), COOP_ROOM_CODE: code,
    COOP_BIND_HOST: '127.0.0.1', COOP_WORLD_BROWSER_TEST: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverErrors = '';
child.stderr.on('data', chunk => { serverErrors += chunk; });
let browser;
const errors = [];
const activePages = [];
async function until(fn, label, ms = 16000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (await fn()) return; } catch {}
    await sleep(100);
  }
  const diagnostics = [];
  for (const page of activePages) {
    try { diagnostics.push(await page.evaluate(() => ({
      world: window.__coopWorldTest?.get(),
      net: window.JoanMP?.getCoopDebug(),
      hud: document.body?.innerText?.slice(-400)
    }))); } catch (e) { diagnostics.push(String(e)); }
  }
  throw Error('Timed out ' + label + '\n' + JSON.stringify(diagnostics) +
    '\n' + serverErrors + '\n' + errors.join('\n'));
}
async function world(page) {
  return page.evaluate(() => window.__coopWorldTest?.get() || null);
}
async function player(index) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  activePages.push(page);
  page.on('pageerror', e => errors.push('player ' + index + ': ' + (e.stack || e.message)));
  await page.goto(base + '/coop/?code=' + code + '&test=1', { waitUntil: 'domcontentloaded' });
  await until(() => page.locator('#btnStart').isVisible(), 'creation ' + index);
  await page.locator('#heroName').fill('CoopTester' + index);
  await page.locator('#btnStart').click();
  await until(async () => (await world(page))?.room === 0, 'player at city ' + index);
  return { page, context };
}
async function enterBoth(a, b, room) {
  await a.page.evaluate(room => window.__coopWorldTest.room(room), room);
  await b.page.evaluate(room => window.__coopWorldTest.room(room), room);
  await until(async () => (await world(a.page))?.room === room &&
    (await world(b.page))?.room === room, 'both entered room ' + room);
  // Wait for actual CO-OP ownership; coincidentally equal local mob IDs are NOT enough.
  await until(async () => {
    const x = await a.page.evaluate(() => window.JoanMP?.getCoopDebug());
    const y = await b.page.evaluate(() => window.JoanMP?.getCoopDebug());
    return x?.lastRoom === room && y?.lastRoom === room &&
      !!x.worldOwnerId && x.worldOwnerId === y.worldOwnerId &&
      (x.worldOwnerId === x.myId ? y.hasWorldSnapshot && y.worldUpdatedAt > 0 :
        x.hasWorldSnapshot && x.worldUpdatedAt > 0);
  }, 'both browsers connected to shared room ' + room, 20000);
  // Position equality proves actual network snapshots rather than equal local spawn counters.
  await until(async () => {
    const x = await world(a.page), y = await world(b.page);
    return x?.mobs?.length > 0 && x.mobs.length === y?.mobs?.length &&
      JSON.stringify(x.mobs.map(m => [m.id, m.hp, m.dead]).sort((p,q) => p[0]-q[0])) ===
      JSON.stringify(y.mobs.map(m => [m.id, m.hp, m.dead]).sort((p,q) => p[0]-q[0]));
  }, 'shared monsters room ' + room, 20000);
}

try {
  await until(async () => (await fetch(base + '/health')).ok, 'COOP server start');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const a = await player('A');
  const b = await player('B');
  await enterBoth(a, b, 1);
  await enterBoth(a, b, 2);
  const aNet = await a.page.evaluate(() => window.JoanMP.getCoopDebug());
  const owner = aNet.worldOwnerId === aNet.myId ? a : b;
  const follower = owner === a ? b : a;
  const before = await world(owner.page);
  assert.ok(before.mobs.length > 0, 'second map has monsters');
  await owner.page.evaluate(() => window.__coopWorldTest.clear());
  await until(async () => (await world(follower.page))?.mobs?.every(m => m.dead),
    'second-map kill synchronizes', 20000);
  await until(async () => {
    const x = await world(owner.page), y = await world(follower.page);
    return x?.cycle > before.cycle && y?.cycle === x.cycle &&
      x.mobs.length > 0 && x.mobs.some(m => !m.dead) &&
      y.mobs.length === x.mobs.length;
  }, 'server-clock respawn both clients', 20000);
  // Sample routes across the original continents and other continents,
  // not just the first two monster zones.
  for (const sampleRoom of [3, 8, 14, 29]) {
    await enterBoth(a, b, sampleRoom);
  }
  assert.deepEqual(errors, [], 'no uncaught errors in two actual v134 browsers');
  console.log('COOP two-browser shared map 1/2 and respawn checks passed');
  await a.context.close();
  await b.context.close();
} finally {
  await browser?.close().catch(() => {});
  child.kill('SIGTERM');
}
