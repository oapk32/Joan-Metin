import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

async function getPort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  return port;
}
async function waitForHealth(base) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/health')).ok) return; } catch {}
    await sleep(100);
  }
  throw Error('CO-OP host did not start');
}
function nextMessage(ws, type, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { done(); reject(Error('Timed out waiting for ' + type)); }, timeout);
    function done() { clearTimeout(timer); ws.off('message', onMessage); ws.off('error', onError); }
    function onError(error) { done(); reject(error); }
    function onMessage(bytes) {
      let value;
      try { value = JSON.parse(String(bytes)); } catch { return; }
      if (value.type !== type) return;
      done();
      resolve(value);
    }
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}
function connect(url, origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Origin: origin } });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

test('local CO-OP serves offline client, isolates host room and syncs visible peers', { timeout: 25000 }, async () => {
  const port = await getPort();
  const code = 'previewcooptesttoken1234567890';
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['coop-host.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, COOP_PORT: String(port), COOP_ROOM_CODE: code, COOP_BIND_HOST: '127.0.0.1' },
    stdio: 'ignore'
  });
  let host, guest;
  try {
    await waitForHealth(base);
    const page = await (await fetch(base + '/coop/?code=' + code)).text();
    assert.match(page, /js\/coop-bridge\.js/);
    assert.doesNotMatch(page, /src="js\/mp-bridge\.js"/);
    assert.equal((await fetch(base + '/coop/js/coop-bridge.js')).status, 200);
    assert.equal((await fetch(base + '/etc/passwd')).status, 404);
    const script = await (await fetch(base + '/coop/js/game.js')).text();
    assert.match(script, /want = clamp\(\(\(r.width \|\| W\) \* dpr\) \/ W, 1, 1\);/);

    const wsPath = 'ws://127.0.0.1:' + port + '/coop-ws?code=';
    await assert.rejects(connect(wsPath + 'wrong-token', base));

    host = await connect(wsPath + code, base);
    guest = await connect(wsPath + code, base);
    const msg = {
      type: 'state', active: true, room: 1, x: 320, y: 330, dir: 0,
      cls: 'sura', name: 'Tester', level: 85
    };
    host.send(JSON.stringify({ ...msg, name: 'Host' }));
    guest.send(JSON.stringify(msg));
    const updated = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { host.off('message', onMessage); reject(Error('No shared peer state')); }, 4000);
      function onMessage(bytes) {
        let m;
        try { m = JSON.parse(String(bytes)); } catch { return; }
        if (m.type === 'peers' && m.players?.some(p => p.name === 'Tester')) {
          clearTimeout(timer); host.off('message', onMessage); resolve(m);
        }
      }
      host.on('message', onMessage);
    });
    assert.equal(updated.players[0].cls, 'sura');
    assert.equal(updated.players[0].level, 85);
    await sleep(100);
    guest.send(JSON.stringify({ ...msg, room: 2 }));
    await sleep(250);
    const empty = await nextMessage(host, 'peers');
    assert.equal(empty.players.length, 0);
  } finally {
    host?.close();
    guest?.close();
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), sleep(2000)]);
  }
});
