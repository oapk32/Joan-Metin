import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchV134OnlineGame, onlineV134Html } from '../v134-online-patch.js';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const read = path => readFileSync(join(root, path), 'utf8');

test('Original v134 game and offline saves remain byte-for-byte untouched', () => {
  const original = read('client/js/game.js');
  const hash = createHash('sha256').update(original).digest('hex');
  const online = patchV134OnlineGame(original);
  assert.notEqual(online, original);
  assert.equal(createHash('sha256').update(read('client/js/game.js')).digest('hex'), hash);
  assert.match(original, /window\.JoanMP\?\.tick\(player, current, now\)/);
  assert.doesNotMatch(original, /JOAN_ONLINE_BOOT|window\.JoanOnline\.frame/);
  assert.match(online, /window\.JoanOnline\.frame/);
  assert.match(online, /window\.JoanOnline\.attackIntent/);
  assert.match(online, /saveGame = \(\) => false;/);
  assert.match(online, /saveRoster = \(\) => false;/);
  assert.match(online, /\/\/ Online mode: preserve offline roster/);
  assert.doesNotThrow(() => new Script(online, { filename: 'game-online.js' }));
});

test('Online HTML changes only game script; original HTML still loads singleplayer', () => {
  const html = read('client/index.html');
  const online = onlineV134Html(html);
  assert.match(html, /<script src="js\/game\.js"><\/script>/);
  assert.doesNotMatch(html, /game-online\.js/);
  assert.match(online, /<script src="js\/game-online\.js"><\/script>/);
  assert.match(online, /<script src="js\/v134-online\.js"><\/script>/);
  assert.match(online, /<script src="js\/mp-bridge\.js"><\/script>/);
  assert.throws(() => onlineV134Html(online), /incompatible/);
});

test('Patch explicitly rejects mismatched v134 source instead of silently falling back to local combat', () => {
  assert.throws(() => patchV134OnlineGame('console.log("not v134")'), /incompatible/);
});
