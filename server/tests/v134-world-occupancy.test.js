import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { startCombatArena } from '../combat-ws.js';
import { createJoanEdgeWorld } from '../v134-first-map.js';

test('one owned character cannot simultaneously occupy the arena and original map', async t => {
  const reservations = new Map();
  const claimCharacter = (id, socket) => {
    if (reservations.has(id) || reservations.size >= 30) return false;
    reservations.set(id, socket);
    return true;
  };
  const releaseCharacter = (id, socket) => {
    if (reservations.get(id) === socket) reservations.delete(id);
  };
  const settings = {
    claimCharacter, releaseCharacter,
    loadCharacter: async (owner,id) => owner === '10' && id === '1'
      ? { id, name:'Alice', class:'warrior' } : null
  };
  const edge = startCombatArena({
    ...settings, world:createJoanEdgeWorld(), socketPath:'/v134-ws'
  });
  const arena = startCombatArena(settings);
  t.after(() => { edge.stop(); arena.stop(); });
  const server = createServer((_req,res) => res.writeHead(404).end());
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket, request) => {
    const handler = request.url.startsWith('/v134-ws') ? edge : arena;
    void handler.connect(socket, request, { account:{ id:'10' } });
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(() => { wss.close(); server.close(); });
  const base = 'ws://127.0.0.1:' + server.address().port;
  const first = new WebSocket(base+'/v134-ws?character=1');
  const firstEvents = [];
  first.on('message', data => firstEvents.push(JSON.parse(String(data))));
  t.after(() => first.terminate());
  await once(first,'open');
  const start = Date.now();
  while (!firstEvents.some(m => m.type === 'combat-welcome')) {
    if (Date.now() - start > 2000) throw new Error('First owned character never joined');
    await new Promise(resolve => setTimeout(resolve,25));
  }
  assert.equal(reservations.size,1);

  const duplicate = new WebSocket(base+'/combat-ws?character=1');
  t.after(() => duplicate.terminate());
  await once(duplicate,'open');
  assert.equal((await once(duplicate,'close'))[0],1008);
  assert.equal(reservations.size,1);

  first.close();
  await once(first,'close');
  assert.equal(reservations.size,0);

  const accepted = new WebSocket(base+'/combat-ws?character=1');
  const received = [];
  accepted.on('message', data => received.push(JSON.parse(String(data))));
  t.after(() => accepted.terminate());
  await once(accepted,'open');
  const started = Date.now();
  while (!received.some(m => m.type === 'combat-welcome')) {
    if (Date.now() - started > 2000) throw new Error('Character cannot switch after disconnect');
    await new Promise(resolve => setTimeout(resolve,25));
  }
  assert.equal(reservations.size,1);
  assert.equal(arena.world.snapshotWorld().players[0].mapId,'arena');
});
