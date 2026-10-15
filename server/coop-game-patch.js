// Runtime adapter only for /coop/js/game.js. Original singleplayer game.js remains untouched.
// Fail closed when v134 render/update anchors change instead of silently serving a broken CO-OP.
const EDITS = [
  {
    needle: 'window.JoanMP?.tick(player, current, now);',
    value: `window.JoanMP?.tick(player, current, now, time, effects, projectiles,
      () => player ? v38HeroSpec() : null, world, {
        receiveHit: (id, damage, kind) => {
          const m = [...(world?.mobs || []), ...(world?.stones || [])].find(m => m.id === id && !m.dead);
          if (m) hit(m, damage, kind);
        },
        rewardDeath: m => {
          if (!m.dead && m.hp > 0) hit(m, Math.max(1, m.hp * 8), 'coopReward');
        },
        respawn: () => {
          if (world && world.respawnAt != null) {
            world.respawnAt = time;
            advanceRespawn();
          }
        }
      });`
  },
  {
    needle: 'if (!F.noFx) v38DrawEffectsTop();',
    value: `if (!F.noFx) {
      v38DrawEffectsTop();
      // Render replicated cosmetic visuals through the existing v134 effect/projectile pipeline.
      // Swap render lists only while drawing: remote shots never enter collision or damage logic.
      const remoteVisuals = window.JoanMP?.getRemoteVisuals(current);
      if (remoteVisuals && (remoteVisuals.effects.length || remoteVisuals.shots.length)) {
        const localEffects = effects, localProjectiles = projectiles;
        try {
          effects = remoteVisuals.effects;
          projectiles = remoteVisuals.shots;
          v38DrawEffectsTop();
        } catch (error) {
          // An unsupported cosmetic never breaks the singleplayer render loop.
          console.warn('CO-OP remote visual skipped:', error);
        } finally {
          effects = localEffects;
          projectiles = localProjectiles;
        }
      }
    }`
  },
  {
    needle: 'active: false, swing: 0, draw: 0, casting: false',
    value: `active: !!peer.action, swing: peer.action?.kind === 'basic' ? Math.sin((peer.action.progress || 0) * Math.PI) * 0.9 : 0,
       draw: peer.action?.weapon === 'bow' ? Math.sin((peer.action?.progress || 0) * Math.PI) : 0,
       casting: peer.action?.kind === 'skill', castP: peer.action?.progress || 0,
       lean: peer.action ? Math.sin((peer.action.progress || 0) * Math.PI) * 1.5 : 0`
  },
  {
    needle: 'const spec = {\n      scale: 1.25, skin: look.skin, hair: look.hair, hairStyle: look.hairStyle,',
    value: 'const spec = peer.look?.body && peer.look?.weapon ? peer.look : {\n      scale: 1.25, skin: look.skin, hair: look.hair, hairStyle: look.hairStyle,'
  },
  {
    needle: 'for (let m of [...world.mobs]) {',
    value: 'for (let m of (window.JoanMP?.isWorldFollower(current) ? [] : [...world.mobs])) {'
  },
  {
    needle: "  function hit(m, damage, kind = 'basic') {\\n    let egg =",
    value: "  function hit(m, damage, kind = 'basic') {\\n    if (window.JoanMP?.routeHit(current, m, damage, kind)) return 0;\\n    let egg ="
  },
  {
    needle: '  function advanceRespawn() {\\n    if (current === 35',
    value: '  function advanceRespawn() {\\n    if (window.JoanMP?.isWorldFollower(current)) return;\\n    if (current === 35'
  }
];
export function patchCoopGame(source) {
  let result = source;
  for (const { needle, value } of EDITS) {
    if (result.split(needle).length !== 2) throw new Error('CO-OP v134 anchor missing/duplicated: ' + needle);
    result = result.replace(needle, value);
  }
  const needle = 'want = clamp(((r.width || W) * dpr) / W, 1, 2);';
  if (result.split(needle).length !== 2) throw new Error('CO-OP renderer scaling anchor missing');
  return result.replace(needle, 'want = clamp(((r.width || W) * dpr) / W, 1, 1);');
}
