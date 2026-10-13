(() => {
  'use strict';
  const canvas = document.getElementById('arena');
  const ctx = canvas.getContext('2d');
  const status = document.getElementById('status');
  const stats = document.getElementById('stats');
  const message = document.getElementById('combatMessage');
  const character = new URL(location.href).searchParams.get('character');
  if (!/^[1-9][0-9]{0,18}$/.test(character || '')) {
    status.textContent = 'Nejdřív si vyber online postavu na stránce účtu.';
    return;
  }
  const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') +
    location.host + '/combat-ws?character=' + encodeURIComponent(character));
  const keys = new Set();
  let myId = null;
  let snapshot = { players: [], mobs: [], personalDrops: [], testInventory: [] };
  const keySet = new Set(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright']);

  socket.addEventListener('open', () => { status.textContent = 'Ověřuji postavu…'; });
  socket.addEventListener('close', event => {
    status.textContent = 'Odpojeno (' + event.code + '). Ověř přihlášení nebo obnov stránku.';
  });
  socket.addEventListener('error', () => { status.textContent = 'Nepodařilo se připojit.'; });
  socket.addEventListener('message', event => {
    let value;
    try { value = JSON.parse(event.data); } catch { return; }
    if (value.type === 'combat-welcome') {
      myId = value.id;
      status.textContent = 'Připojeno do společné arény';
    } else if (value.type === 'combat-snapshot' && Array.isArray(value.players) && Array.isArray(value.mobs)) {
      snapshot = value;
      const me = snapshot.players.find(p => p.id === myId);
      if (me) {
        stats.textContent = me.name + ' · HP ' + me.hp + '/' + me.maxHp +
          ' · test EXP ' + me.xp + ' · test Yang ' + me.yang +
          ' · zabití ' + me.kills + ' · test batoh: ' +
          (snapshot.testInventory?.length || 0) + ' · hráčů: ' + snapshot.players.length;
      }
    } else if (value.type === 'combat-hit') {
      const reason = { out_of_range: 'Monstrum je příliš daleko.',
        cooldown: 'Útok se obnovuje.', dead: 'Počkej na oživení.',
        mob_dead: 'Monstrum je poražené – počkej na respawn.',
        invalid_target: 'Neplatný cíl.' };
      message.textContent = value.ok
        ? 'Zásah za ' + value.damage + ' HP' + (value.defeated ? ' · Monstrum poraženo!' : '')
        : (reason[value.reason] || 'Útok nebyl přijat.');
    } else if (value.type === 'combat-pickup-result') {
      const reason = {
        out_of_range: 'Kořist je příliš daleko.',
        not_owned_or_expired: 'Tato kořist ti nepatří, nebo už zmizela.',
        dead: 'Mrtvá postava nesbírá kořist.',
        inventory_full: 'Testovací batoh je plný.'
      };
      message.textContent = value.ok
        ? 'Sebráno: ' + value.itemName + ' (jen test, neukládá se)'
        : (reason[value.reason] || 'Kořist nelze sebrat.');
    }
  });

  const keyDirection = { arrowup:'w',arrowdown:'s',arrowleft:'a',arrowright:'d' };
  function normalKey(key) { return keyDirection[key] || key; }
  addEventListener('keydown', e => {
    const key = e.key.toLowerCase();
    if (key === ' ' && e.target.tagName !== 'INPUT') {
      e.preventDefault(); attackNearest(); return;
    }
    if (key === 'e') {
      e.preventDefault(); pickUpNearest(); return;
    }
    if (keySet.has(key)) { e.preventDefault(); keys.add(normalKey(key)); }
  });
  addEventListener('keyup', e => {
    const key = e.key.toLowerCase();
    if (keySet.has(key)) { e.preventDefault(); keys.delete(normalKey(key)); }
  });
  addEventListener('blur', () => keys.clear());
  for (const button of document.querySelectorAll('[data-key]')) {
    const key = button.dataset.key;
    button.addEventListener('pointerdown', e => { e.preventDefault(); keys.add(key); button.setPointerCapture(e.pointerId); });
    for (const kind of ['pointerup','pointercancel','lostpointercapture']) {
      button.addEventListener(kind, () => keys.delete(key));
    }
  }
  document.getElementById('attack').addEventListener('click', attackNearest);

  function sendAttack(id) {
    if (socket.readyState === WebSocket.OPEN && myId && id) {
      socket.send(JSON.stringify({ type: 'combat-attack', mobId: id }));
    }
  }
  function pickUpNearest() {
    const me = snapshot.players.find(p => p.id === myId);
    if (!me) return;
    const drops = [...(snapshot.personalDrops || [])];
    drops.sort((a,b) => Math.hypot(me.x-a.x,me.y-a.y) - Math.hypot(me.x-b.x,me.y-b.y));
    if (drops[0] && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'combat-pickup', dropId: drops[0].id }));
    }
  }
  function attackNearest() {
    const me = snapshot.players.find(p => p.id === myId);
    if (!me) return;
    const alive = snapshot.mobs.filter(m => m.hp > 0);
    alive.sort((a,b) => Math.hypot(me.x-a.x,me.y-a.y) - Math.hypot(me.x-b.x,me.y-b.y));
    if (alive[0]) sendAttack(alive[0].id);
  }
  canvas.addEventListener('click', event => {
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * canvas.width;
    const y = (event.clientY - bounds.top) / bounds.height * canvas.height;
    const drop = (snapshot.personalDrops || []).find(d => Math.hypot(d.x-x,d.y-y) <= 28);
    if (drop && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'combat-pickup', dropId: drop.id }));
      return;
    }
    const target = snapshot.mobs.find(m => m.hp > 0 && Math.hypot(m.x-x,m.y-y) <= 30);
    if (target) sendAttack(target.id);
  });
  setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN || !myId) return;
    const x = Number(keys.has('d')) - Number(keys.has('a'));
    const y = Number(keys.has('s')) - Number(keys.has('w'));
    socket.send(JSON.stringify({ type: 'combat-input', x, y }));
  }, 60);

  function healthBar(x, y, width, amount, maximum) {
    ctx.fillStyle = '#210e0d'; ctx.fillRect(x-width/2,y,width,6);
    ctx.fillStyle = amount > 0 ? '#80c16f' : '#7b4242';
    ctx.fillRect(x-width/2,y,width*Math.max(0,amount)/maximum,6);
  }
  function frame() {
    const { width, height } = canvas;
    ctx.fillStyle = '#254d31'; ctx.fillRect(0,0,width,height);
    ctx.strokeStyle = '#3b6045'; ctx.lineWidth = 1;
    for(let x=0;x<width;x+=45){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
    for(let y=0;y<height;y+=45){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
    ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
    for (const mob of snapshot.mobs) {
      if (mob.hp === 0) continue;
      ctx.fillStyle = mob.kind === 'Ork' ? '#b05a4b' : '#a0a7b1';
      ctx.beginPath();ctx.arc(mob.x,mob.y,17,0,Math.PI*2);ctx.fill();
      ctx.fillStyle = '#f8e8c8';ctx.fillText(mob.kind,mob.x,mob.y-31);
      healthBar(mob.x,mob.y-27,42,mob.hp,mob.maxHp);
    }
    // Drops are already filtered for this player's account by the server.
    for (const drop of (snapshot.personalDrops || [])) {
      ctx.fillStyle = '#f6e29d';
      ctx.beginPath(); ctx.moveTo(drop.x,drop.y-9); ctx.lineTo(drop.x+9,drop.y);
      ctx.lineTo(drop.x,drop.y+9); ctx.lineTo(drop.x-9,drop.y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff0b4'; ctx.font = '11px system-ui';
      ctx.fillText(drop.itemName,drop.x,drop.y-20);
    }
    ctx.font = 'bold 13px system-ui';
    for (const p of snapshot.players) {
      ctx.fillStyle = p.hp <= 0 ? '#5a6b67' : p.id === myId ? '#f1c96f' : '#66b2e2';
      ctx.beginPath();ctx.arc(p.x,p.y,14,0,Math.PI*2);ctx.fill();
      ctx.fillStyle = '#fff';ctx.fillText(p.name,p.x,p.y-29);
      healthBar(p.x,p.y-25,44,p.hp,p.maxHp);
    }
    requestAnimationFrame(frame);
  }
  frame();
})();
