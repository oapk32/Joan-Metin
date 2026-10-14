// Online-only adaptation of the unmodified v134 game renderer.
// NO changes are committed to client/js/game.js or the offline release.
function replaceExactlyOnce(source, find, replacement) {
  const at = source.indexOf(find);
  if (at < 0 || source.indexOf(find, at + find.length) >= 0) {
    throw new Error('v134 online adaptation is incompatible with this game.js version');
  }
  return source.slice(0, at) + replacement + source.slice(at + find.length);
}

export function patchV134OnlineGame(source) {
  let js = source;
  js = replaceExactlyOnce(js,
    "  function update(dt) {\n    let out = updateV115b(dt);",
    "  function update(dt) {\n" +
    "    if (window.JoanOnline?.enabled) {\n" +
    "      if (player && world) {\n" +
    "        time += Math.max(0, dt);\n" +
    "        window.JoanOnline.frame({ player, world, keys, mouse, time });\n" +
    "      }\n" +
    "      return;\n" +
    "    }\n" +
    "    let out = updateV115b(dt);");
  js = replaceExactlyOnce(js,
    "  function attack() {\n    if (V111.swap) {",
    "  function attack() {\n" +
    "    if (window.JoanOnline?.enabled) return window.JoanOnline.attackIntent();\n" +
    "    if (V111.swap) {");
  js = replaceExactlyOnce(js,
    "    for (const peer of window.JoanMP?.getPeers() || []) list.push({ y: peer.y, k: 4.5, o: peer });",
    "    for (const peer of (window.JoanOnline?.enabled ? window.JoanOnline.getPeers() : window.JoanMP?.getPeers() || [])) list.push({ y: peer.y, k: 4.5, o: peer });");

  const originalBoot = `  window.addEventListener('beforeunload', saveGame);
  setCreation();
  loadGame();
  v130FixSavedWings();
  v134SyncHeroicLegacy();
  saveRoster();
  setupExtendedUI();
  $('btnDrops').onclick = showDropRates;
  $('btnGearGuide').onclick = showGearGuide;
  $('btnBosses').onclick = showBossGuide;
  $('btnDeadRoster').onclick = openRoster;
  openRoster();
  requestAnimationFrame(loop);`;
  const onlineBoot = `  // Online mode: preserve offline roster and disable local economy and monster simulation.
  if (window.JoanOnline?.enabled) {
    saveGame = () => false;
    saveRoster = () => false;
    setCreation();
    setupExtendedUI();
    for (const id of ['btnNew','btnSave','btnSkills','btnTown','btnDeadRoster']) {
      const el = $(id);
      if (el) el.disabled = true;
    }
    window.JoanOnline.start({
      mount: serverHero => {
        const cls = CLASSES[serverHero.cls] ? serverHero.cls : 'warrior';
        const school = Object.keys(CLASSES[cls].schools)[0];
        $('heroName').value = serverHero.name;
        createPlayer(cls, school); // Use the existing v134 character art, not local progress.
        player.id = serverHero.id;
        player.name = serverHero.name;
        enterRoom(1, false, true); // v134 area 1–2, original terrain and monster art.
        player.x = serverHero.x;
        player.y = serverHero.y;
        player.hp = serverHero.hp;
        world.mobs = [];
        world.stones = [];
        drops = [];
        effects = [];
        projectiles = [];
        combatZones = [];
        paused = false;
        $('creation').classList.add('hidden');
        refreshUI();
      },
      swing: angle => {
        if (!player) return;
        player.dir = angle;
        player.combo = ((player.combo || 0) + 1) % 3;
        player.swingStart = time;
        player.swingUntil = time + 0.30;
        player.action = {
          kind: 'basic', weapon: 'sword', angle,
          start: time, end: time + 0.30, duration: 0.30,
          hitAt: time + 0.12, rootUntil: time + 0.23,
          combo: player.combo, ranged: false
        };
      },
      setDrops: personal => { drops = personal; }
    });
    requestAnimationFrame(loop);
  } else {
` + originalBoot + `
  }`;
  js = replaceExactlyOnce(js, originalBoot, onlineBoot);
  return js;
}

export function onlineV134Html(html) {
  return replaceExactlyOnce(html,
    '<script src="js/game.js"></script>',
    '<script src="js/game-online.js"></script>');
}
