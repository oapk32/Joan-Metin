/* Deferred 7 MB legacy audio bundle for Joan v134.
 * game.js snapshots window.__AUDIO_ASSETS__ at startup. Keep that SAME object
 * while audio-data.js asynchronously assigns its data URL collection.
 * Original game code, offline saves and audio settings remain untouched.
 */
(() => {
  'use strict';
  const assets = {};
  let started = false;
  let completed = false;
  let schedulingDone = false;

  // audio-data.js contains a single assignment:
  // window.__AUDIO_ASSETS__ = { music: "data:audio/...", ... };
  // Merge into the stable object that game.js retains by reference.
  Object.defineProperty(window, '__AUDIO_ASSETS__', {
    configurable: true,
    enumerable: true,
    get: () => assets,
    set(next) {
      if (!next || typeof next !== 'object') return;
      Object.assign(assets, next);
      completed = true;
      window.dispatchEvent(new Event('joan-audio-ready'));
    }
  });

  function loadAudio() {
    if (started) return;
    started = true;
    const script = document.createElement('script');
    script.src = 'js/audio-data.js';
    script.async = true;
    script.onerror = () => {
      // A failed request must not block the game; audio stays optional.
      started = false;
      script.remove();
    };
    document.head.append(script);
  }

  function scheduleWhenReady() {
    if (schedulingDone) return;
    schedulingDone = true;
    const later = () => {
      if (completed || started) return;
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(loadAudio, { timeout: 1800 });
      } else {
        setTimeout(loadAudio, 700);
      }
    };
    // Let UI and the main game script finish their first render first.
    if ('requestAnimationFrame' in window) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(later));
    } else {
      later();
    }
  }

  if (document.readyState === 'complete') scheduleWhenReady();
  else window.addEventListener('load', scheduleWhenReady, { once: true });

  // Start earlier if the player is already interacting. Pointer movement
  // commonly happens before the first click, reducing missing first sounds.
  for (const name of ['pointermove', 'pointerdown', 'touchstart', 'keydown']) {
    window.addEventListener(name, loadAudio, { once: true, passive: true });
  }
})();
