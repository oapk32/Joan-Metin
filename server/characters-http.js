import { CharacterError, validId } from './characters.js';

function reply(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}

async function readCreateBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
    throw new CharacterError('media_type');
  }
  let size = 0;
  let text = '';
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024) throw new CharacterError('too_large');
      text += chunk.toString('utf8');
    }
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        Object.keys(data).sort().join(',') !== 'class,name') {
      throw new CharacterError('invalid_input');
    }
    return { name: data.name, cls: data.class };
  } catch (error) {
    if (error instanceof CharacterError) throw error;
    throw new CharacterError('invalid_input');
  }
}

export function createCharactersHttp({ list, get, create, sessionFor, allowedOrigin }) {
  async function handle(req, res, pathname) {
    if (pathname !== '/api/characters' && !pathname.startsWith('/api/characters/')) return false;

    const account = sessionFor(req)?.account;
    if (!account) {
      reply(res, 401, { error: 'Nejdřív se přihlas' });
      return true;
    }

    const id = pathname.startsWith('/api/characters/') ? pathname.slice('/api/characters/'.length) : null;
    if (id !== null && !validId(id)) {
      reply(res, 404, { error: 'Postava neexistuje' });
      return true;
    }

    try {
      if (id !== null && req.method === 'GET') {
        const character = await get(account.id, id);
        reply(res, character ? 200 : 404, character ? { character } : { error: 'Postava neexistuje' });
      } else if (id === null && req.method === 'GET') {
        const characters = await list(account.id);
        reply(res, 200, { characters });
      } else if (id === null && req.method === 'POST') {
        if (!allowedOrigin(req)) {
          reply(res, 403, { error: 'Neplatný původ požadavku' });
          return true;
        }
        const input = await readCreateBody(req);
        const character = await create(account.id, input);
        reply(res, 201, { character });
      } else {
        // Progress writes from the browser are deliberately unsupported.
        reply(res, 405, { error: 'Tato operace není povolena' });
      }
    } catch (error) {
      if (error instanceof CharacterError) {
        const statuses = {
          invalid_input: 400, invalid_id: 400, invalid_owner: 403,
          limit: 409, duplicate_name: 409, media_type: 415, too_large: 413,
          not_found: 404
        };
        reply(res, statuses[error.code] || 400, { error: ({
          invalid_input: 'Neplatné jméno nebo povolání',
          limit: 'Maximum je 6 postav na účet',
          duplicate_name: 'Toto jméno už někdo používá',
          too_large: 'Příliš velký požadavek',
          media_type: 'Očekávám JSON'
        })[error.code] || 'Požadavek nelze provést' });
      } else {
        console.error('Character API error:', error.message);
        reply(res, 503, { error: 'Databáze postav zatím není připravená' });
      }
    }
    return true;
  }
  return { handle };
}
