import { validId } from './characters.js';
import { createCombatWorld } from './combat-world.js';
import { createSectorIndex, diffVisible, fullVisible } from './combat-interest.js';
import { WebSocket } from 'ws';

const TICK_MS = 50;
const BROADCAST_MS = 125;
const MAX_MESSAGE_BYTES = 256;

// Shared, single-instance test arena. Lifetime of rewards = Node.js process.
// No character economics are modified in PostgreSQL in this prototype.
export function startCombatArena({
  loadCharacter, clock = () => Date.now(), world = createCombatWorld(),
  socketPath = '/combat-ws',
  // Optional server-wide reservation shared by multiple map handlers.
  claimCharacter = () => true, releaseCharacter = () => {}
}) {
  const clients = new Map(); // WebSocket => bound character ID
  const sentLootRevisions = new Map(); // send personal items only when they change
  const previouslyVisible = new Map(); // WebSocket -> player's last AOI-visible entities
  let lastStep = clock();

  const tick = setInterval(() => {
    const now = clock();
    world.step(Math.max(0, (now - lastStep) / 1000), now);
    lastStep = now;
  }, TICK_MS);
  function sendLootIfChanged(socket, playerId) {
    const revision = world.lootVersion(playerId);
    if (sentLootRevisions.get(socket) !== revision && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(world.personalLootState(playerId)));
      sentLootRevisions.set(socket, revision);
    }
  }
  function sendFullVisible(socket, playerId, publicWorld, index) {
    const visible = index.select(playerId);
    socket.send(JSON.stringify(fullVisible(publicWorld, visible)));
    previouslyVisible.set(socket, visible);
    sendLootIfChanged(socket, playerId);
  }
  // Adding a player is a rare event; send a complete local-sector snapshot
  // rather than forcing everyone to wait for the next delta.
  function sendJoinSnapshots() {
    const publicWorld = world.snapshotWorld();
    const index = createSectorIndex(publicWorld);
    for (const [socket, playerId] of clients) {
      if (socket.readyState === WebSocket.OPEN) {
        sendFullVisible(socket, playerId, publicWorld, index);
      }
    }
  }
  const broadcast = setInterval(() => {
    if (!clients.size) return;
    const publicWorld = world.snapshotWorld();
    const index = createSectorIndex(publicWorld); // build ONCE for all viewers
    for (const [socket, playerId] of clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const visible = index.select(playerId);
      const delta = diffVisible(previouslyVisible.get(socket), visible);
      if (delta) socket.send(JSON.stringify(delta));
      previouslyVisible.set(socket, visible);
      sendLootIfChanged(socket, playerId);
    }
  }, BROADCAST_MS);

  async function connect(socket, request, session) {
    let characterId;
    try {
      const address = new URL(request.url, 'http://localhost');
      characterId = address.searchParams.get('character');
      if (address.pathname !== socketPath || !validId(characterId) ||
          address.searchParams.getAll('character').length !== 1) {
        socket.close(1008, 'Invalid character');
        return;
      }
    } catch {
      socket.close(1008, 'Invalid request');
      return;
    }
    if (!session?.account?.id) {
      socket.close(1008, 'Login required');
      return;
    }
    // Character is looked up with account ID coming from the authenticated
    // HTTP session. Clients cannot choose another account's character.
    let character;
    try {
      character = await loadCharacter(session.account.id, characterId);
    } catch (error) {
      console.error('Combat arena character lookup:', error.message);
      socket.close(1011, 'Database unavailable');
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!character) {
      socket.close(1008, 'Character not owned');
      return;
    }
    if (!claimCharacter(character.id, socket)) {
      socket.close(1008, 'Character already playing or server full');
      return;
    }
    const player = world.join(character);
    if (!player) {
      releaseCharacter(character.id, socket);
      socket.close(1008, 'Character already playing or arena full');
      return;
    }
    clients.set(socket, character.id);
    socket.send(JSON.stringify({
      type: 'combat-welcome', id: player.id,
      note: 'Private shared PvE beta. Rewards do not persist.'
    }));
    sendJoinSnapshots();

    let lastInput = 0;
    socket.on('message', bytes => {
      if (bytes.length > MAX_MESSAGE_BYTES) return;
      let msg;
      try { msg = JSON.parse(String(bytes)); } catch { return; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      if (msg.type === 'combat-input') {
        const now = clock();
        if (now - lastInput < 35) return;
        lastInput = now;
        world.setInput(player.id, msg);
      } else if (msg.type === 'combat-attack') {
        const result = world.attack(player.id, msg.mobId, clock());
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'combat-hit', ...result }));
        }
      } else if (msg.type === 'combat-pickup') {
        const result = world.pickUp(player.id, msg.dropId, clock());
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'combat-pickup-result', ...result }));
          if (result.ok) sendLootIfChanged(socket, player.id);
        }
      }
    });
    socket.on('close', () => {
      // The player may have been disconnected after a newer connection attempt.
      if (clients.get(socket) === character.id) {
        clients.delete(socket);
        sentLootRevisions.delete(socket);
        previouslyVisible.delete(socket);
        world.leave(character.id);
        releaseCharacter(character.id, socket);
      }
    });
  }

  function stop() {
    clearInterval(tick);
    clearInterval(broadcast);
    for (const [socket, playerId] of clients) {
      socket.close(1001, 'Server stopping');
      world.leave(playerId);
      releaseCharacter(playerId, socket);
    }
    clients.clear();
    sentLootRevisions.clear();
    previouslyVisible.clear();
  }
  return { connect, stop, world };
}
