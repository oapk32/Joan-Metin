(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let mode = 'login';
  const status = $('status');
  const form = $('authForm');

  function setMode(next) {
    mode = next;
    $('loginMode').setAttribute('aria-pressed', String(mode === 'login'));
    $('registerMode').setAttribute('aria-pressed', String(mode === 'register'));
    $('password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    $('submit').textContent = mode === 'register' ? 'Vytvořit účet' : 'Přihlásit se';
    status.textContent = '';
  }
  $('loginMode').addEventListener('click', () => setMode('login'));
  $('registerMode').addEventListener('click', () => setMode('register'));

  async function request(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Požadavek se nezdařil');
    return result;
  }
  async function showCharacters() {
    const list = $('onlineCharacters');
    list.replaceChildren();
    $('characterStatus').textContent = 'Načítám postavy…';
    try {
      const response = await request('/api/characters');
      if (!Array.isArray(response.characters)) throw new Error('Neplatná odpověď');
      for (const character of response.characters) {
        const item = document.createElement('li');
        item.textContent = character.name + ' · ' + character.class +
          ' · Lv. ' + character.level + ' · uložená revize ' + character.revision + ' · ';
        const link = document.createElement('a');
        link.href = '/arena/?character=' + encodeURIComponent(character.id);
        link.textContent = 'Vyzkoušet společný boj';
        item.append(link);
        list.append(item);
      }
      $('characterStatus').textContent = response.characters.length
        ? 'Online postav: ' + response.characters.length + ' / 6'
        : 'Zatím nemáš žádnou online postavu.';
    } catch (error) {
      $('characterStatus').textContent = 'Seznam není dostupný: ' + error.message;
    }
  }

  $('createCharacter').addEventListener('submit', async event => {
    event.preventDefault();
    $('createCharacterBtn').disabled = true;
    try {
      await request('/api/characters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: $('characterName').value,
          class: $('characterClass').value
        })
      });
      $('characterName').value = '';
      await showCharacters();
    } catch (error) {
      $('characterStatus').textContent = error.message;
    } finally {
      $('createCharacterBtn').disabled = false;
    }
  });

  async function refresh() {
    try {
      const me = await request('/api/me');
      $('loggedIn').hidden = !me.authenticated;
      $('loggedOut').hidden = !!me.authenticated;
      if (me.authenticated) {
        $('loggedName').textContent = me.username;
        await showCharacters();
      } else {
        $('onlineCharacters').replaceChildren();
      }
      status.textContent = '';
    } catch {
      status.textContent = 'Nelze ověřit přihlášení. Zkontroluj spojení se serverem.';
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    $('submit').disabled = true;
    status.textContent = 'Zpracovávám…';
    try {
      await request(mode === 'register' ? '/api/register' : '/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: $('username').value, password: $('password').value })
      });
      $('password').value = '';
      window.location.assign('/joan/');
    } catch (error) {
      status.textContent = error.message;
      $('password').value = '';
    } finally {
      $('submit').disabled = false;
    }
  });
  $('logout').addEventListener('click', async () => {
    try {
      await request('/api/logout', { method: 'POST' });
      await refresh();
    } catch (error) {
      status.textContent = error.message;
    }
  });
  refresh();
})();
