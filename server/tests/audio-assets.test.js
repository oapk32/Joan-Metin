import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAudioAssets } from '../audio-assets.js';

test('Original v134 offline script order remains intact', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const html = readFileSync(join(root, 'client/index.html'), 'utf8');
  assert.match(html, /<script src="js\/audio-data\.js"><\/script>/);
  assert.doesNotMatch(html, /audio-loader\.js/);
});

test('Legacy sound bundle becomes tiny URL manifest; audio is fetched by range on demand', async t => {
  const source = createAudioAssets();
  assert.ok(source.assetCount >= 2);
  assert.ok(source.manifestSize < 3000, 'Audio manifest should be small compared with 7MB original');
  const server = createServer((req, res) => {
    if (!source.serve(req, res, new URL(req.url, 'http://localhost').pathname))
      res.writeHead(404).end('Not found');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const manifestResponse = await fetch(base + '/joan/js/audio-data.js');
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const manifest = await manifestResponse.text();
  assert.match(manifest, /window\.__AUDIO_ASSETS__=/);
  assert.match(manifest, /"music":"\/joan\/audio\/music"/);
  assert.doesNotMatch(manifest, /base64/);
  const etag = manifestResponse.headers.get('etag');
  const notModified = await fetch(base + '/joan/js/audio-data.js', {
    headers: { 'if-none-match': etag }
  });
  assert.equal(notModified.status, 304);

  const sound = await fetch(base + '/joan/audio/music', {
    headers: { range: 'bytes=0-99' }
  });
  assert.equal(sound.status, 206);
  assert.match(sound.headers.get('content-type'), /^audio\//);
  assert.match(sound.headers.get('content-range'), /^bytes 0-99\/\d+$/);
  assert.equal((await sound.arrayBuffer()).byteLength, 100);
  const head = await fetch(base + '/joan/audio/music', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers.get('content-length')) > 100);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const missing = await fetch(base + '/joan/audio/not-here');
  assert.equal(missing.status, 404);
  const illegal = await fetch(base + '/joan/audio/music', {
    headers: { range: 'bytes=999999999999-999999999999' }
  });
  assert.equal(illegal.status, 416);
});
