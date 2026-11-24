/* CrazyGames SDK v3 integration with standalone browser support. */
(function (root) {
  'use strict';

  const SAVE_KEY = 'yoobird_save_v1';
  const MIGRATION_KEY = 'yoobird_sdk_save_migrated';
  const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
  const STARTUP_LIMIT_MS = 1500;
  const GAMEPLAY_COOLDOWN_MS = 1050;
  let sdk = null;
  let initialization = null;
  let connection = null;
  let connecting = false;
  let offlineSelected = false;
  let cloudStorage;
  let saveHasLoaded = false;
  let accountChanging = false;
  let playing = false;
  let reportedPlaying = false;
  let gameplayTimer;
  const gameplaySentAt = { gameplayStart: -Infinity, gameplayStop: -Infinity };
  let loadingFinished = false;
  let adPending = false;
  let adsDisabled = false;
  let videoConfirmed = false;

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

  function syncGameplay() {
    root.clearTimeout(gameplayTimer);
    if (!sdk || reportedPlaying === playing) return;
    const name = playing ? 'gameplayStart' : 'gameplayStop';
    const now = root.performance.now();
    const remaining = gameplaySentAt[name] + GAMEPLAY_COOLDOWN_MS - now;
    if (remaining > 0) {
      // The SDK drops repeated calls within one second.
      gameplayTimer = root.setTimeout(syncGameplay, Math.ceil(remaining));
      return;
    }
    reportedPlaying = playing;
    gameplaySentAt[name] = now;
    reportGameEvent(name);
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
    onAdStateChange: null,
    get canRequestAd() { return !!sdk?.ad?.requestAd && !adsDisabled && !offlineSelected; },
    get canRequestRewarded() {
      // Confirm availability through a genuine natural-break video, not a test ad.
      // Basic Launch never exposes a rewarded button that cannot work.
      return this.canRequestAd && videoConfirmed;
    },
    get adPending() { return adPending; },

    requestAd(type) {
      if (!['midgame', 'rewarded'].includes(type) || !this.canRequestAd || (type === 'rewarded' && !this.canRequestRewarded) || adPending) {
        return Promise.resolve({ finished: false, code: 'unavailable' });
      }
      adPending = true;
      return new Promise((resolve) => {
        let settled = false, started = false;
        const finish = (finished, code) => {
          if (settled) return;
          settled = true;
          if (finished && started) videoConfirmed = true;
          if (code === 'adsDisabled' || code === 'adsDisabledBasicLaunch' || code === 'adblock') adsDisabled = true;
          adPending = false;
          this.onAdStateChange?.('idle', started);
          resolve({ finished, code });
        };
        // SDK owns the request lifecycle: do not unlock UI before its terminal callback.
        this.onAdStateChange?.('requesting', false);
        try {
          sdk.ad.requestAd(type, {
            adStarted: () => {
              if (settled || started) return;
              started = true;
              adPending = true;
              this.onAdStateChange?.('playing', true);
            },
            adFinished: () => finish(true),
            adError: (error) => finish(false, error?.code || 'other'),
          });
        } catch (error) { finish(false, error?.code || 'other'); }
      });
    },
    get waitingForSave() { return connecting && !offlineSelected; },
    waitForSave() { return connection; },
    chooseOffline() { offlineSelected = true; },

    init() {
      if (initialization) return initialization;
      connecting = true;
      let deadline;
      const timeout = new Promise((resolve) => {
        deadline = root.setTimeout(() => resolve(null), STARTUP_LIMIT_MS);
      });
      connection = initializeSdk()
        .then((instance) => {
          if (!instance) return;
          sdk = instance;
          if (!loadingFinished) reportGameEvent('loadingStart');
          syncGameplay();
          const updateAudio = (settings) => {
            const muted = settings?.muteAudio === true;
            if (muted === this.muteAudio) return;
            this.muteAudio = muted;
            this.onMuteAudioChange?.(muted);
          };
          updateAudio(sdk.game?.settings);
          sdk.game?.addSettingsChangeListener?.(updateAudio);
        })
        .catch(() => {})
        .finally(() => { connecting = false; });
      // After the soft deadline the loader can offer a separate offline game.
      // The deadline itself does not select storage.
      initialization = Promise.race([connection, timeout])
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
      syncGameplay();
    },

    gameplayStop() {
      if (!playing) return;
      playing = false;
      syncGameplay();
    },

    load() {
      if (this.waitingForSave) throw new Error('The save backend is still connecting.');
      if (offlineSelected) return readSave(localValue(SAVE_KEY));
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
          if (!saveHasLoaded && sdk.environment === 'crazygames') {
            try {
              sdk.user?.addAuthListener?.(() => {
                // The SDK can already have switched stores when this fires.
                // Never write the old in-memory save into the new store.
                accountChanging = true;
                root.location.reload();
              });
            } catch (_) {
              // The User module may be disabled. The portal still reloads on login.
            }
          }
          saveHasLoaded = true;
          return cloudSave || legacy;
        }
      } catch (_) {
        // The submission can leave the Data module disabled for Basic Launch.
      }
      cloudStorage = null;
      return readSave(localValue(SAVE_KEY));
    },

    save(data) {
      if (accountChanging || this.waitingForSave) return;
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
