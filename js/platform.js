/* CrazyGames SDK v3 integration with standalone browser support. */
(function (root) {
  'use strict';

  const SAVE_KEY = 'yoobird_save_v1';
  const MIGRATION_KEY = 'yoobird_sdk_save_migrated';
  const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
  const STARTUP_LIMIT_MS = 1500;
  let sdk = null;
  let initialization = null;
  let cloudStorage;
  let playing = false;
  let loadingFinished = false;

  async function initializeSdk() {
    if (!root.CrazyGames?.SDK) {
      if (!/^https?:$/.test(root.location.protocol)) return null;
      await new Promise((resolve, reject) => {
        const script = root.document.createElement('script');
        script.src = SDK_URL;
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        root.document.head.append(script);
      });
    }

    const instance = root.CrazyGames?.SDK;
    if (!instance) return null;
    await instance.init();
    return ['crazygames', 'local'].includes(instance.environment) ? instance : null;
  }

  function reportGameEvent(name) {
    try { sdk?.game?.[name]?.(); } catch (_) {
      // Platform telemetry should never block the game.
    }
  }

  function readSave(value) {
    try {
      const data = JSON.parse(value);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      if (!Array.isArray(data.stars)) data.stars = [];
      if (!Array.isArray(data.best)) data.best = [];
      return data;
    } catch (_) {
      return null;
    }
  }

  function localValue(key) {
    try { return root.localStorage.getItem(key); } catch (_) { return null; }
  }

  function writeLocalValue(key, value) {
    try { root.localStorage.setItem(key, value); } catch (_) {
      // Storage is unavailable in some browser profiles.
    }
  }

  const platform = {
    muteAudio: false,
    onMuteAudioChange: null,

    init() {
      if (initialization) return initialization;
      let deadline;
      const timeout = new Promise((resolve) => {
        deadline = root.setTimeout(() => resolve(null), STARTUP_LIMIT_MS);
      });
      const connect = initializeSdk()
        .then((instance) => {
          if (!instance) return;
          sdk = instance;
          if (!loadingFinished) reportGameEvent('loadingStart');
          if (playing) reportGameEvent('gameplayStart');
          const updateAudio = (settings) => {
            const muted = settings?.muteAudio === true;
            if (muted === this.muteAudio) return;
            this.muteAudio = muted;
            this.onMuteAudioChange?.(muted);
          };
          updateAudio(sdk.game?.settings);
          sdk.game?.addSettingsChangeListener?.(updateAudio);
        })
        .catch(() => {});
      // A delayed network request must not block the player. A late SDK can
      // still report active play, but storage stays with the backend boot chose.
      initialization = Promise.race([connect, timeout])
        .finally(() => root.clearTimeout(deadline));
      return initialization;
    },

    lang() {
      try {
        const locale = sdk?.user?.systemInfo?.locale;
        if (typeof locale === 'string') return locale.toLowerCase().split('-')[0];
      } catch (_) {
        // Locale is unavailable outside the SDK or if its User module is disabled.
      }
      return 'en';
    },

    loadingReady() {
      if (loadingFinished) return;
      loadingFinished = true;
      reportGameEvent('loadingStop');
    },

    gameplayStart() {
      if (playing) return;
      this.loadingReady();
      playing = true;
      reportGameEvent('gameplayStart');
    },

    gameplayStop() {
      if (!playing) return;
      playing = false;
      reportGameEvent('gameplayStop');
    },

    load() {
      // On CrazyGames the Data module owns guest and signed-in save selection.
      // Mark the one-time legacy import on this origin, across account changes.
      try {
        const data = cloudStorage === undefined ? sdk?.data : cloudStorage;
        if (data) {
          const cloudSave = readSave(data.getItem(SAVE_KEY));
          const legacy = !cloudSave && !localValue(MIGRATION_KEY) ? readSave(localValue(SAVE_KEY)) : null;
          if (legacy) data.setItem(SAVE_KEY, JSON.stringify(legacy));
          writeLocalValue(MIGRATION_KEY, '1');
          cloudStorage = data;
          return cloudSave || legacy;
        }
      } catch (_) {
        // The submission can leave the Data module disabled for Basic Launch.
      }
      cloudStorage = null;
      return readSave(localValue(SAVE_KEY));
    },

    save(data) {
      const value = JSON.stringify(data);
      if (cloudStorage) {
        try {
          cloudStorage.setItem(SAVE_KEY, value);
          return;
        } catch (_) {
          // Keep the current session playable if its save backend is unavailable.
          cloudStorage = null;
        }
      }
      writeLocalValue(SAVE_KEY, value);
    },

    haptic(style) {
      try {
        const device = root.navigator;
        if (!device.vibrate || (device.userActivation && !device.userActivation.hasBeenActive)
            || !root.matchMedia('(pointer: coarse)').matches) return;
        const durations = { light: 10, medium: 22, heavy: 40 };
        device.vibrate(durations[style] || durations.light);
      } catch (_) {
        // Vibration is optional.
      }
    },
  };

  root.YB = Object.assign(root.YB || {}, { Platform: platform });
})(window);
