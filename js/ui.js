/* YooBird — интерфейс, экраны, достижения, наряды и запуск игры. */
(function (root) {
  'use strict';
  const { Game, LEVELS, CAMPAIGN_COUNT, I18n, Audio: A, Platform: P, Render: R } = root.YB;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const MAIN = ['loading', 'menu', 'levels'];
  const MODALS = ['pause', 'win', 'lose', 'settings', 'ach', 'wardrobe', 'intro', 'controls'];
  const LOCK_SVG = '<svg class="lock" viewBox="0 0 24 24"><path d="M6 10V8a6 6 0 1 1 12 0v2h1v12H5V10zm2 0h8V8a4 4 0 1 0-8 0z"/></svg>';
  const fmt = (v) => v.toLocaleString(I18n.lang);

  // Достижения: названия и описания — в i18n (ach_<id>, ach_<id>_d)
  const ACH = ['first', 'oneshot', 'combo3', 'combo5', 'clean', 'king', 'citadel', 'iceking', 'final', 'windTrials', 'nuke', 'slam2', 'boomer', 'puff3', 'tnt10', 'kills100', 'stars15', 'stars30', 'stars60', 'stars45'];
  // Наряды птенцов: сколько звёзд нужно, чтобы открыть
  const SKINS = [{ id: 'none', need: 0 }, { id: 'cap', need: 5 }, { id: 'glasses', need: 10 }, { id: 'bandana', need: 18 }, { id: 'tophat', need: 28 }, { id: 'crown', need: 40 }, { id: 'scarf', need: 52 }, { id: 'pilot', need: 66 }];
  // Карточки знакомства: показываются один раз, когда элемент впервые встречается на уровне
  const fakeBlock = (m, shape, w) => ({ position: { x: 0, y: 0 }, angle: 0, game: { m, shape, w, h: w, seed: 3, hp: 1, maxHp: 1 } });
  const INTROS = [
    { key: 'boss', has: (d) => d.items.some((i) => i.t === 'boss'), draw: (c) => R.dude(c, 0, 12, 60, 0, 'boss', { look: Math.PI * 0.9, time: 0 }) },
    { key: 'boulder', has: (d) => d.items.some((i) => i.shape === 'circle'), draw: (c) => R.block(c, fakeBlock('stone', 'circle', 104)) },
    { key: 'tnt', has: (d) => d.items.some((i) => i.m === 'tnt'), draw: (c) => R.block(c, fakeBlock('tnt', 'rect', 96)) },
  ];
  const THEME_CLASS = { noon: 'w-noon', sunset: 'w-sunset', dusk: 'w-dusk', night: 'w-night', winter: 'w-winter', volcano: 'w-volcano' };

  const UI = {
    save: null, screen: 'loading', activeModal: null, round: 0,
    introQueue: [], achQueue: [], achBusy: false,

    show(name) {
      this.screen = name;
      MAIN.forEach((n) => $('#screen-' + n).classList.toggle('hidden', n !== name));
      ['#hud', '#boosters'].forEach((sel) => $(sel).classList.toggle('hidden', name !== 'game'));
      if (name !== 'game') {
        $('#level-banner').classList.add('hidden');
        $('#nuke-btn').classList.add('hidden');
      }
      this.refreshControls();
      this.refreshObjectives();
      this.refreshAbility();
      if (name === 'menu' || name === 'levels') {
        this.refreshStars();
        if (name === 'levels') $('#level-grid button:not(.locked)')?.focus({ preventScroll: true });
        else if (this.userStarted) $('[data-action="play"]').focus({ preventScroll: true });
      }
    },

    modal(name, on) {
      const dialog = $('#screen-' + name);
      if (on && !this.activeModal) this.modalTrigger = document.activeElement;
      dialog.classList.toggle('hidden', !on);
      if (!on && this.activeModal !== name) return;
      this.activeModal = on ? name : null;
      for (const el of $$('#app > canvas, #app > #hud, #app > #boosters, #app > #nuke-btn, #app > #ability-dock, #app > section')) {
        el.inert = on && el !== dialog;
      }
      if (on) {
        const first = dialog.querySelector('[data-primary]:not(.hidden)') || dialog.querySelector('.panel button:not(.hidden)');
        (first || dialog).focus({ preventScroll: true });
      } else if (this.modalTrigger?.isConnected && !this.modalTrigger.closest('.hidden')) {
        this.modalTrigger.focus({ preventScroll: true });
      }
      this.refreshControls();
      this.refreshObjectives();
      this.refreshAbility();
    },
    closeModals() { if (this.activeModal) this.modal(this.activeModal, false); },

    refreshControls() {
      const hint = $('#game-controls');
      const visible = this.screen === 'game' && Game.state === 'play' && Game.levelIdx === 0 && Game.shots === 0 && !Game.ending && !this.activeModal;
      hint.classList.toggle('hidden', !visible);
      if (!visible) return;
      const touch = root.matchMedia('(pointer: coarse)').matches;
      const text = I18n.t(touch ? 'firstShotTouch' : 'firstShot');
      const instruction = hint.querySelector('span');
      if (instruction.textContent !== text) instruction.textContent = text;
    },

    refreshAbility() {
      const button = $('#ability-dock');
      const bird = this.screen === 'game' && !this.activeModal ? Game.abilityBird?.() : null;
      button.classList.toggle('hidden', !bird);
      if (!bird) {
        if (document.activeElement === button && Game.running()) Game.canvas.focus({ preventScroll: true });
        return;
      }
      const text = I18n.t('ability_' + bird), label = button.querySelector('.ability-label');
      if (label.textContent !== text) label.textContent = text;
    },

    trialGoals() {
      if (!Game.def?.trial || !Game.sim) return [];
      const rings = Game.sim.windRings;
      const defenders = Game.def.items.filter((item) => item.k === 'enemy').length;
      return [
        ['goalRings', rings.filter((ring) => ring.used).length, rings.length],
        ['goalDefenders', defenders - Game.sim.enemies.filter((enemy) => !enemy.game.dead).length, defenders],
      ];
    },

    fillGoals(list, goals, className = '') {
      const signature = JSON.stringify([I18n.lang, goals]);
      if (list.dataset.progress === signature) return;
      list.dataset.progress = signature;
      list.replaceChildren(...goals.map(([key, current, total]) => {
        const chip = document.createElement('li');
        chip.className = className;
        chip.classList.toggle('is-complete', current === total);
        const label = document.createElement('span'), count = document.createElement('b');
        label.textContent = I18n.t(key);
        count.textContent = `${current}/${total}`;
        chip.append(label, count);
        return chip;
      }));
    },

    refreshObjectives() {
      const list = $('#level-objective');
      const inTrial = this.screen === 'game' && Boolean(Game.def?.trial);
      $('#app').classList.toggle('trial-active', inTrial);
      list.classList.toggle('hidden', !inTrial || Boolean(this.activeModal));
      if (inTrial) this.fillGoals(list, this.trialGoals(), 'objective-chip');
    },

    markPlayable() {
      if (Game.running() && !Game.ending && ['ready', 'flying'].includes(Game.phase) && this.screen === 'game' && !this.activeModal) P.gameplayStart();
    },

    totalStars() { return this.save.stars.reduce((a, b) => a + (b || 0), 0); },
    refreshStars() {
      const total = `${this.totalStars()} / ${LEVELS.length * 3}`;
      $$('.ts-val').forEach((el) => { el.textContent = total; });
      $('#play-label').dataset.i18n = this.save.unlocked > 1 ? 'continueGame' : 'play';
      $('#play-label').textContent = I18n.t($('#play-label').dataset.i18n);
      $('.menu-trials').classList.toggle('hidden', !this.canEnterLevel(CAMPAIGN_COUNT));
    },
    tip() { const tips = I18n.t('tips').split('|'); return tips[(Math.random() * tips.length) | 0]; },

    // ---------- Вызовы из игры ----------
    setScore(v) {
      $('#hud-score').textContent = fmt(v);
      const st = Game.def && Game.def.stars;
      if (!st) return;
      $('#star-fill').style.width = Math.min(100, (v / st[2]) * 100) + '%';
      $('#star-t1').style.left = (st[1] / st[2]) * 100 + '%';
      $('#star-t1').classList.toggle('on', v >= st[1]);
      $('#star-t2').classList.toggle('on', v >= st[2]);
    },
    setEnemies(n) {
      const el = $('#hud-enemies');
      if (el.textContent !== String(n)) { el.textContent = n; el.parentNode.classList.remove('bump'); void el.offsetWidth; el.parentNode.classList.add('bump'); }
      this.refreshObjectives();
    },
    hideToast() { clearTimeout(this._toastT); $('#toast').classList.add('hidden'); },
    toast(message, localized = false) {
      const el = $('#toast');
      el.textContent = localized ? message : I18n.t(message);
      el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => el.classList.add('hidden'), 3200);
    },
    togglePause() {
      if (this.activeModal === 'pause') this.act('resume');
      else if (!this.activeModal) this.act('pause');
    },
    persist() { P.save(this.save); },

    // Заставка уровня: номер и название
    banner(i) {
      const el = $('#level-banner');
      el.querySelector('b').textContent = this.levelLabel(i);
      el.querySelector('span').textContent = I18n.t(LEVELS[i].nameKey);
      el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      clearTimeout(this._bannerT);
      this._bannerT = setTimeout(() => el.classList.add('hidden'), 2300);
    },

    // ---------- Достижения ----------
    unlock(id) {
      if (!this.save || this.save.ach[id]) return;
      this.save.ach[id] = 1; this.persist();
      this.achQueue.push(id);
      if (!this.achBusy) this.nextAch();
    },
    nextAch() {
      const id = this.achQueue.shift();
      if (!id) { this.achBusy = false; return; }
      this.achBusy = true;
      const el = $('#ach-toast');
      el.querySelector('b').textContent = I18n.t('ach_' + id);
      el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      A.play('ach', { gap: 0 });
      setTimeout(() => { el.classList.add('hidden'); setTimeout(() => this.nextAch(), 250); }, 2600);
    },
    checkProgressAch() {
      const t = this.totalStars(), st = this.save.stats;
      if (t >= 15) this.unlock('stars15');
      if (t >= 30) this.unlock('stars30');
      if (t >= 60) this.unlock('stars60');
      if (this.save.stars.slice(0, CAMPAIGN_COUNT).reduce((sum, stars) => sum + (stars || 0), 0) >= CAMPAIGN_COUNT * 3) this.unlock('stars45');
      if (LEVELS.slice(CAMPAIGN_COUNT).every((def) => this.save.stars[def.id - 1] > 0)) this.unlock('windTrials');
      if ((st.kills || 0) >= 100) this.unlock('kills100');
      if ((st.tnt || 0) >= 10) this.unlock('tnt10');
    },
    buildAch() {
      const list = $('#ach-list'); list.innerHTML = '';
      const got = ACH.filter((id) => this.save.ach[id]).length;
      ACH.forEach((id) => {
        const on = !!this.save.ach[id];
        const d = document.createElement('div');
        d.className = 'ach' + (on ? ' on' : '');
        d.innerHTML = `<i></i><div><b>${I18n.t('ach_' + id)}</b><small>${I18n.t('ach_' + id + '_d')}</small></div>`;
        list.appendChild(d);
      });
      $('#screen-ach .title').textContent = `${I18n.t('achTitle')} ${got}/${ACH.length}`;
    },

    // ---------- Наряды ----------
    buildSkins() {
      const list = $('#skin-list'); list.innerHTML = '';
      const total = this.totalStars();
      SKINS.forEach((sk) => {
        const open = total >= sk.need, cur = (this.save.skin || 'none') === sk.id;
        const b = document.createElement('button');
        b.className = 'skin' + (open ? '' : ' locked') + (cur ? ' current' : '');
        b.dataset.action = 'skin'; b.dataset.skin = sk.id;
        const cv = document.createElement('canvas'); cv.width = 192; cv.height = 208;
        const c = cv.getContext('2d'); c.scale(2, 2); c.translate(46, 66);
        if (!open) c.globalAlpha = 0.45;
        R.chick(c, 0, 0, 28, 0, 'normal', { skin: sk.id, time: 0 });
        b.appendChild(cv);
        const lab = document.createElement('span');
        lab.innerHTML = open ? (cur ? I18n.t('skinOn') : I18n.t('skin_' + sk.id)) : `<i></i>${sk.need}`;
        b.appendChild(lab);
        list.appendChild(b);
      });
    },

    // ---------- Карточки знакомства ----------
    checkIntro(i) {
      const def = LEVELS[i];
      const intro = i > 0 && !def.trial && INTROS.find((it) => !this.save.seen[it.key] && it.has(def));
      this.introQueue = intro ? [intro] : [];
      if (this.introQueue.length) { Game.extPause.add('intro'); this.nextIntro(i); } else if (i > 0) this.banner(i);
    },
    nextIntro(i) {
      const it = this.introQueue.shift();
      if (!it) { this.modal('intro', false); Game.extPause.delete('intro'); this.persist(); this.banner(i); Game.canvas.focus({ preventScroll: true }); this.markPlayable(); return; }
      this.save.seen[it.key] = 1; this.persist();
      $('#intro-title').textContent = I18n.t('intro_' + it.key);
      $('#intro-text').textContent = I18n.t('intro_' + it.key + '_d');
      const cv = $('#intro-canvas'), c = cv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
      c.setTransform(2, 0, 0, 2, cv.width / 2, cv.height / 2);
      const g = c.createRadialGradient(0, 0, 10, 0, 0, 95);
      g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, 'rgba(255,224,102,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, 95, 0, 6.3); c.fill();
      it.draw(c);
      this._introLevel = i;
      this.modal('intro', true); A.play('whoosh');
    },

    showWin(r) {
      const round = this.round;
      this.refreshControls();
      const trial = Game.def.trial;
      // достижения за победу
      this.unlock('first');
      if (!trial && r.shots === 1 && r.level >= 1) this.unlock('oneshot');
      if (!trial && r.level >= 6 && !r.used.booster && !r.used.nuke) this.unlock('clean');
      if (r.level === 14) this.unlock('citadel');
      if (r.level === 19) this.unlock('iceking');
      if (r.level === CAMPAIGN_COUNT - 1) this.unlock('final');
      this.checkProgressAch();

      $('#win-score').textContent = '0';
      $('#win-best').textContent = fmt(r.best);
      $('#win-record').classList.toggle('hidden', !r.newRecord);
      $('#btn-next').classList.toggle('hidden', !r.hasNext);
      $('#btn-trials').classList.toggle('hidden', r.level !== 0 || Boolean(this.save.stars[CAMPAIGN_COUNT]));
      $('#win-alldone').classList.toggle('hidden', r.hasNext);
      const nextTrial = trial && LEVELS[r.level + 1];
      $('#win-alldone').textContent = trial ? (nextTrial ? this.trialUnlockLabel(nextTrial) : I18n.t('trialsDone')) : I18n.t('allDone');
      this.fillGoals($('#win-goals'), this.trialGoals());
      $('#win-stats').innerHTML = `<span>${I18n.t('statShots')}: <b>${r.shots}</b></span><span>${I18n.t('statLeft')}: <b>${r.left}</b></span>`
        + (r.combo >= 2 ? `<span>${I18n.t('statCombo')}: <b>x${r.combo}</b></span>` : '');
      $('#win-next').textContent = r.need > 0 ? `${I18n.t('needMore')}: ${fmt(r.need)}` : '';
      $('#win-nuke').classList.toggle('hidden', !r.nukeEarned);
      const stars = $$('#screen-win .stars i');
      stars.forEach((s) => s.classList.remove('on'));
      setTimeout(() => {
        if (round !== this.round) return;
        this.modal('win', true);
        // счётчик очков «набегает»
        const t0 = performance.now(), el = $('#win-score'); let lastTick = 0;
        const step = (now) => {
          if (round !== this.round) return;
          const k = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - k, 3);
          el.textContent = fmt(Math.round(r.score * e));
          if (now - lastTick > 70 && k < 1) { lastTick = now; A.play('tick', { v: e, gap: 0 }); }
          if (k < 1 && !$('#screen-win').classList.contains('hidden')) requestAnimationFrame(step); else el.textContent = fmt(r.score);
        };
        requestAnimationFrame(step);
      }, 500);
      for (let i = 0; i < r.stars; i++) {
        setTimeout(() => {
          if (round !== this.round) return;
          stars[i].classList.add('on');
          A.play('star', { i, gap: 0 });
        }, 540 + i * 160);
      }
    },
    showLose(r) {
      this.checkProgressAch();
      const round = this.round;
      this.refreshControls();
      $('#screen-lose .title').textContent = I18n.t(Game.def.trial ? 'trialIncomplete' : 'loseTitle');
      $('#lose-left').classList.toggle('hidden', Boolean(Game.def.trial));
      $('#lose-left').textContent = `${I18n.t('enemiesLeft')}: ${r.left}`;
      $('#lose-tip').textContent = Game.def.trial ? I18n.t('trialTip') : this.tip();
      this.fillGoals($('#lose-goals'), this.trialGoals());
      setTimeout(() => { if (round === this.round) this.modal('lose', true); }, 460);
    },

    // Состояние кнопок бустеров и грозового заряда
    refreshBoosters() {
      const G = Game;
      ['sight', 'power', 'quake'].forEach((b) => {
        const el = $('#b-' + b), n = G.boosters[b];
        el.classList.toggle('hidden', Boolean(G.def?.trial) && b !== 'sight');
        el.querySelector('i').textContent = n;
        el.classList.toggle('used', n <= 0 && !G.active[b]);
        el.classList.toggle('active', !!G.active[b]);
        el.classList.toggle('na', n > 0 && !G.active[b] && (b === 'sight' || b === 'power') && !G.ready);
      });
      this.refreshNukeBtn();
      this.refreshControls();
      this.refreshAbility();
      this.markPlayable();
    },

    refreshNukeBtn() {
      const n = this.save.nukes || 0, button = $('#nuke-btn');
      button.classList.toggle('hidden', this.screen !== 'game' || n === 0 || Boolean(Game.def?.trial));
      button.classList.toggle('used', Game.nuke.used);
      button.classList.toggle('stock', n > 0);
      button.setAttribute('aria-disabled', String(Game.state !== 'play' || !Game.canNuke()));
      $('#nuke-stock').textContent = n > 0 ? String(n) : '';
    },

    // ---------- Экран уровней ----------
    // Миры: страницы на экране уровней
    WORLDS: [
      { key: 'world1', from: 0, to: 15, cols: 8 },
      { key: 'world2', from: 15, to: CAMPAIGN_COUNT, cols: 5 },
      { key: 'world3', from: CAMPAIGN_COUNT, to: LEVELS.length, cols: 3 },
    ],
    canEnterLevel(i) {
      const def = LEVELS[i];
      if (!def) return false;
      if (!def.trial) return i < this.save.unlocked;
      const campaignDone = this.save.stars[def.after - 1] > 0 || this.save.unlocked > def.after;
      return campaignDone && (def.trial === 1 || this.save.stars[i - 1] > 0);
    },
    levelLabel(i) {
      const def = LEVELS[i];
      return def.trial ? `${I18n.t('trial')} ${def.trial}` : `${I18n.t('level')} ${i + 1}`;
    },
    trialUnlockLabel(def) {
      return I18n.t(def.trial === 1 ? 'trialUnlockFirst' : 'trialUnlockLater').replace('{level}', def.after);
    },
    openLevels(page) {
      if (this.screen === 'game') this.toMenu();
      this.buildLevels(page);
      this.show('levels');
    },
    buildLevels(page) {
      const W = this.WORLDS;
      if (page == null) {   // открываем мир, где сейчас продолжается игра
        const cur = Math.min(CAMPAIGN_COUNT, this.save.unlocked) - 1;
        page = Math.max(0, W.findIndex((w) => cur >= w.from && cur < w.to));
      }
      page = Math.max(0, Math.min(W.length - 1, page)); this.levelPage = page;
      const w = W[page];
      $('#world-name').textContent = I18n.t(w.key);
      $('#world-prev').classList.toggle('hidden', page === 0);
      $('#world-next').classList.toggle('hidden', page === W.length - 1);
      $$('.world-dots i').forEach((d, k) => d.classList.toggle('on', k === page));
      const help = $('#world-help'), trials = page === W.length - 1;
      help.classList.toggle('hidden', !trials);
      if (trials) help.textContent = this.canEnterLevel(CAMPAIGN_COUNT) ? I18n.t('trialRules') : this.trialUnlockLabel(LEVELS[CAMPAIGN_COUNT]);
      const grid = $('#level-grid'); grid.innerHTML = '';
      grid.style.setProperty('--level-columns', w.cols);
      LEVELS.forEach((lv, i) => {
        if (i < w.from || i >= w.to) return;
        const locked = !this.canEnterLevel(i);
        const st = this.save.stars[i] || 0;
        const b = document.createElement('button');
        b.className = `level-card ${THEME_CLASS[lv.theme] || 'w-noon'}` + (locked ? ' locked' : '') + (!locked && !st ? ' current' : '') + (st === 3 ? ' gold' : '');
        b.dataset.action = 'level'; b.dataset.level = i;
        b.innerHTML = `<span class="num">${lv.trial || i + 1}</span>${locked ? LOCK_SVG : ''}<span class="name">${I18n.t(lv.nameKey)}</span>`
          + `<span class="mini-stars">${[0, 1, 2].map((k) => `<i class="${k < st ? 'on' : ''}"></i>`).join('')}</span>`;
        grid.appendChild(b);
      });
    },

    refreshSettings() {
      const s = this.save.settings;
      $('#tg-music').classList.toggle('on', s.music);
      $('#tg-sfx').classList.toggle('on', s.sfx);
      $('#tg-vib').classList.toggle('on', s.vib !== false);
      $('#pz-music').classList.toggle('off', !s.music);
      $('#pz-sfx').classList.toggle('off', !s.sfx);
      $('#tg-music').setAttribute('aria-checked', String(s.music));
      $('#tg-sfx').setAttribute('aria-checked', String(s.sfx));
      $('#tg-vib').setAttribute('aria-checked', String(s.vib !== false));
      $('#pz-music').setAttribute('aria-pressed', String(s.music));
      $('#pz-sfx').setAttribute('aria-pressed', String(s.sfx));
      $$('[data-action="lang"]').forEach((b) => b.classList.toggle('active', b.dataset.lang === I18n.lang));
      this._resetArmed = false; $('#btn-reset span').textContent = I18n.t('reset');
    },

    hudTitle() { if (Game.def) $('#hud-level').textContent = `${this.levelLabel(Game.levelIdx)} · ${I18n.t(Game.def.nameKey)}`; },

    startLevel(i) {
      this.round++;
      this.userStarted = true;
      P.gameplayStop();
      this.closeModals();
      Game.extPause.delete('intro');
      this.hideToast();
      $('#level-banner').classList.add('hidden');
      this.show('game');
      Game.startLevel(i);
      this.hudTitle();
      this.refreshObjectives();
      Game.canvas.focus({ preventScroll: true });
      this.checkIntro(i);
      this.refreshControls();
    },

    toMenu() {
      this.round++;
      this.closeModals();
      Game.extPause.delete('intro');
      Game.cancelAim();
      Game.state = 'menu'; Game.sim = null; Game.parts = []; R.setTheme('noon'); A.setMood('day');
      P.gameplayStop();
      this.hideToast();
      this.show('menu');
    },

    // ---------- Обработка кнопок ----------
    async act(a, el) {
      const s = this.save;
      switch (a) {
        case 'play': this.startLevel(Math.min(CAMPAIGN_COUNT, s.unlocked) - 1); break;
        case 'levels': this.openLevels(); break;
        case 'trials': this.openLevels(this.WORLDS.length - 1); break;
        case 'world-prev': this.buildLevels(this.levelPage - 1); A.play('click'); break;
        case 'world-next': this.buildLevels(this.levelPage + 1); A.play('click'); break;
        case 'controls': this.modal('controls', true); break;
        case 'close-controls': this.modal('controls', false); break;
        case 'settings': this.refreshSettings(); this.modal('settings', true); break;
        case 'ach': this.buildAch(); this.modal('ach', true); break;
        case 'close-ach': this.modal('ach', false); break;
        case 'wardrobe': this.buildSkins(); this.modal('wardrobe', true); break;
        case 'close-wardrobe': this.modal('wardrobe', false); break;
        case 'skin': {
          const sk = SKINS.find((x) => x.id === el.dataset.skin);
          if (this.totalStars() < sk.need) { this.toast('skinLocked'); return; }
          s.skin = sk.id; R.setSkin(sk.id); this.persist(); this.buildSkins(); break;
        }
        case 'intro-ok': this.nextIntro(this._introLevel); break;
        case 'back':
          if (!$('#screen-settings').classList.contains('hidden')) this.modal('settings', false);
          else this.show('menu');
          break;
        case 'level': {
          const i = +el.dataset.level;
          if (!this.canEnterLevel(i)) {
            if (LEVELS[i].trial) this.toast(this.trialUnlockLabel(LEVELS[i]), true);
            else this.toast('locked');
            return;
          }
          this.startLevel(i); break;
        }
        case 'toggle-music': s.settings.music = !s.settings.music; A.setMusic(s.settings.music); this.refreshSettings(); this.persist(); break;
        case 'toggle-sfx': s.settings.sfx = !s.settings.sfx; A.setSfx(s.settings.sfx); this.refreshSettings(); this.persist(); break;
        case 'toggle-vib': s.settings.vib = s.settings.vib === false; this.refreshSettings(); this.persist(); if (s.settings.vib) P.haptic('medium'); break;
        case 'reset':
          // сброс в два нажатия: сначала спрашиваем, потом сбрасываем
          if (!this._resetArmed) { this._resetArmed = true; $('#btn-reset span').textContent = I18n.t('resetSure'); return; }
          s.unlocked = 1; s.stars = []; s.best = []; s.ach = {}; s.seen = {}; s.stats = {}; s.skin = 'none'; s.nukes = 0;
          R.setSkin('none'); this.persist(); this.refreshSettings(); this.refreshStars(); this.toast('resetDone');
          break;
        case 'lang':
          s.settings.lang = el.dataset.lang; I18n.set(s.settings.lang); this.refreshSettings(); this.persist(); this.hudTitle();
          break;
        case 'pause':
          if (Game.state !== 'play' || this.activeModal) return;
          Game.paused = true; Game.cancelAim(); P.gameplayStop(); this.refreshSettings();
          $('#pause-tip').textContent = this.tip();
          this.modal('pause', true); break;
        case 'resume':
          this.modal('pause', false);
          Game.paused = false;
          Game.canvas.focus({ preventScroll: true });
          this.markPlayable();
          this.refreshNukeBtn();
          this.refreshAbility();
          break;
        case 'restart': this.startLevel(Game.levelIdx); break;
        case 'retry': this.startLevel(Game.levelIdx); break;
        case 'menu': this.toMenu(); break;
        case 'next':
          if (Game.levelIdx !== CAMPAIGN_COUNT - 1 && this.canEnterLevel(Game.levelIdx + 1)) this.startLevel(Game.levelIdx + 1);
          break;
        case 'ability':
          if (Game.useAbility()) Game.canvas.focus({ preventScroll: true });
          break;
        case 'booster':
          if (!Game.useBooster(el.dataset.b)) this.toast('boosterNA');
          Game.canvas.focus({ preventScroll: true });
          break;
        case 'nuke':
          if ((s.nukes || 0) > 0 && Game.canNuke()) {
            s.nukes--;
            this.persist();
            Game.grantNuke();
            Game.canvas.focus({ preventScroll: true });
          }
          break;
      }
    },

    visibility() {
      const hidden = document.hidden;
      const alreadyPaused = Game.extPause.has('hidden');
      if (hidden && !alreadyPaused) {
        Game.extPause.add('hidden');
        Game.cancelAim();
        P.gameplayStop();
        A.pushPause();
      } else if (!hidden && alreadyPaused) {
        Game.extPause.delete('hidden');
        A.popPause();
        this.markPlayable();
      }
      this.refreshAbility();
    },

    async boot() {
      const bar = $('.loader span');
      bar.style.width = '30%';
      await P.init();
      bar.style.width = '65%';
      const loaded = await P.load();
      this.save = Object.assign({ unlocked: 1, stars: [], best: [], settings: {}, ach: {}, seen: {}, stats: {}, skin: 'none' }, loaded || {});
      this.save.unlocked = Math.max(1, Math.min(CAMPAIGN_COUNT, Number(this.save.unlocked) || 1));
      for (const key of ['stars', 'best']) if (!Array.isArray(this.save[key])) this.save[key] = [];
      this.save.settings = Object.assign({ music: true, sfx: true, vib: true, lang: null }, this.save.settings);
      ['ach', 'seen', 'stats'].forEach((k) => { if (!this.save[k] || typeof this.save[k] !== 'object') this.save[k] = {}; });
      Game.save = this.save;
      R.setSkin(this.save.skin);

      I18n.set(this.save.settings.lang || P.lang());
      A.musicOn = this.save.settings.music; A.sfxOn = this.save.settings.sfx;
      for (const name of MODALS) {
        const dialog = $('#screen-' + name), heading = dialog.querySelector('h2');
        if (!heading.id) heading.id = name + '-title';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', heading.id);
        dialog.tabIndex = -1;
      }

      P.onMuteAudioChange = (mute) => { if (mute) A.pushPause(); else A.popPause(); };
      if (P.muteAudio) A.pushPause();
      document.addEventListener('visibilitychange', () => this.visibility());

      // A touch right after launching can deliver pointer events without a click.
      $('#ability-dock').addEventListener('pointerup', (e) => {
        if (e.isPrimary && e.pointerType === 'touch') this.act('ability');
      });
      document.addEventListener('click', (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button || button.closest('[inert], .hidden')) return;
        A.unlock(); A.play('click');
        this.act(button.dataset.action, button);
      });
      const unlock = () => { A.unlock(); A.startMusic(); };
      root.addEventListener('pointerdown', unlock, { passive: true });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && this.activeModal) {
          const dialog = $('#screen-' + this.activeModal);
          const controls = Array.from(dialog.querySelectorAll('button:not(:disabled):not(.hidden)'));
          const first = controls[0], last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        } else if (!e.ctrlKey && !e.metaKey && !e.altKey) unlock();
      });
      $('#game').addEventListener('contextmenu', (e) => e.preventDefault());

      Game.init($('#game'), this);
      bar.style.width = '100%';
      this.visibility();
      this.show('menu');
      P.loadingReady();
    },
  };

  root.YB.UI = UI;
  root.addEventListener('load', () => UI.boot());
})(window);
