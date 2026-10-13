import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const DEFAULT_AUDIO_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'js', 'audio-data.js');

// Dynamic replacement for /joan/js/audio-data.js when Joan runs on Node.
// The original 7MB file is unchanged on disk and works when v134 is opened
// offline. Online clients only receive a tiny URL manifest. Each sound is
// served by name on demand, supporting browser byte-range requests.
export function createAudioAssets({ filename = DEFAULT_AUDIO_FILE } = {}) {
  const raw = readFileSync(filename, 'utf8');
  const separator = 'window.__AUDIO_ASSETS__=';
  if (!raw.startsWith(separator)) throw new Error('Unexpected v134 audio bundle format');
  const json = raw.slice(separator.length).trim().replace(/;\s*$/, '');
  const source = JSON.parse(json);
  if (!source || Array.isArray(source) || typeof source !== 'object') {
    throw new Error('Invalid v134 audio bundle object');
  }
  const assets = new Map();
  for (const [name, dataUrl] of Object.entries(source)) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(name) || typeof dataUrl !== 'string') {
      throw new Error('Invalid audio asset name or value');
    }
    const match = /^data:(audio\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
    if (!match) throw new Error('Invalid base64 sound: ' + name);
    assets.set(name, { mime: match[1], encoded: match[2], bytes: null });
  }
  const manifest = Buffer.from('window.__AUDIO_ASSETS__=' + JSON.stringify(
    Object.fromEntries([...assets.keys()].map(key => [key, '/joan/audio/' + key]))
  ) + ';\n', 'utf8');
  const version = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  function common(headers = {}) {
    return {
      'cache-control': 'private, max-age=0, must-revalidate',
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'bytes',
      ...headers
    };
  }
  function serve(req, res, pathname) {
    if (pathname !== '/joan/js/audio-data.js' && !pathname.startsWith('/joan/audio/')) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' }).end();
      return true;
    }
    if (pathname === '/joan/js/audio-data.js') {
      const etag = '"joan-audio-manifest-' + version + '"';
      const headers = common({
        'content-type': 'text/javascript; charset=utf-8',
        'content-length': manifest.length,
        etag
      });
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers).end(); return true;
      }
      res.writeHead(200, headers).end(req.method === 'HEAD' ? undefined : manifest);
      return true;
    }
    const name = pathname.slice('/joan/audio/'.length);
    const asset = assets.get(name);
    if (!asset) {
      res.writeHead(404, { 'cache-control': 'no-store' }).end('Not found');
      return true;
    }
    if (asset.bytes === null) asset.bytes = Buffer.from(asset.encoded, 'base64');
    const bytes = asset.bytes;
    const etag = '"joan-audio-' + version + '-' + name + '"';
    const headers = common({ 'content-type': asset.mime, etag });
    if (req.headers['if-none-match'] === etag && !req.headers.range) {
      res.writeHead(304, headers).end(); return true;
    }

    let from = 0, to = bytes.length - 1;
    let status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) {
        res.writeHead(416, common({ 'content-range': 'bytes */' + bytes.length })).end();
        return true;
      }
      if (match[1]) {
        from = Number(match[1]);
        to = match[2] ? Number(match[2]) : to;
      } else {
        const suffix = Number(match[2]);
        from = Math.max(0, bytes.length - suffix);
      }
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
          from >= bytes.length || from > to || from < 0 || to < 0) {
        res.writeHead(416, common({ 'content-range': 'bytes */' + bytes.length })).end();
        return true;
      }
      to = Math.min(to, bytes.length - 1);
      status = 206;
      headers['content-range'] = 'bytes ' + from + '-' + to + '/' + bytes.length;
    }
    headers['content-length'] = Math.max(0, to - from + 1);
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : bytes.subarray(from, to + 1));
    return true;
  }
  return { serve, assetCount: assets.size, manifestSize: manifest.length };
}
