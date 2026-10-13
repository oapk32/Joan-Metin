import { validId } from './characters.js';
import { createCombatWorld } from './combat-world.js';
import { WebSocket } from 'ws';

const TICK_MS = 50;
const BROADCAST_MS = 125;
const MAX_MESSAGE_BYTES = 256;

// Shared, single-instance test arena. Lifetime of rewards = Node.js process.
// No character economics are modified in PostgreSQL in this prototype.
export function startCombatArena({ loadCharacter, clock = () => Date.now() }) {
  const world = createCombatWorld();
  const clients = new Map(); // WebSocket => bound character ID
  let lastStep = clock();

  const tick = setInterval(() => {
    const now = clock();
    world.step(Math.max(0, (now - lastStep) / 1000), now);
    lastStep = now;
  }, TICK_MS);
  const broadcast = setInterval(() => {
    if (!clients.size) return;
    const message = JSON.stringify(world.snapshot());
    for (const socket of clients.keys()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  }, BROADCAST_MS);

  async function connect(socket, request, session) {
    let characterId;
    try {
      const address = new URL(request.url, 'http://localhost');
      characterId = address.searchParams.get('character');
      if (address.pathname !== '/combat-ws' || !validId(characterId) ||
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
    const player = world.join(character);
    if (!player) {
      socket.close(1008, 'Character already playing or arena full');
      return;
    }
    clients.set(socket, character.id);
    socket.send(JSON.stringify({
      type: 'combat-welcome', id: player.id,
      note: 'Arena demo only. Rewards do not persist.'
    }));
    socket.send(JSON.stringify(world.snapshot()));

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
      }
    });
    socket.on('close', () => {
      // The player may have been disconnected after a newer connection attempt.
      if (clients.get(socket) === character.id) {
        clients.delete(socket);
        world.leave(character.id);
      }
    });
  }

  function stop() {
    clearInterval(tick);
    clearInterval(broadcast);
    for (const socket of clients.keys()) socket.close(1001, 'Server stopping');
    clients.clear();
  }
  return { connect, stop, world };
}
