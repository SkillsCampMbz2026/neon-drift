// NEON DRIFT — a 2D neon space-dodger with particle FX, screen shake, and a
// localStorage-backed leaderboard. Single-file game engine, no dependencies.
(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Canvas & DPI setup
  // ---------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------------
  // Leaderboard (localStorage)
  // ---------------------------------------------------------------------
  const LB_KEY = 'neonDrift.leaderboard.v1';
  const LB_MAX = 10;

  function loadLeaderboard() {
    try {
      const raw = localStorage.getItem(LB_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveLeaderboard(list) {
    try {
      localStorage.setItem(LB_KEY, JSON.stringify(list));
    } catch (e) { /* storage unavailable — fail silently */ }
  }

  function qualifiesForLeaderboard(score) {
    // Any positive run can be saved — addScore() only ever keeps a player's
    // personal best, so there's no need to gate this on the top-10 cutoff.
    return score > 0;
  }

  // One row per player (matched case-insensitively by name). A run only
  // overwrites that player's row when it beats their existing best score —
  // it never adds a second row for the same name.
  function addScore(name, score) {
    const list = loadLeaderboard();
    const cleanName = (name || 'ANON').slice(0, 12);
    const key = cleanName.trim().toLowerCase();
    const rounded = Math.floor(score);
    const idx = list.findIndex(e => e.name.trim().toLowerCase() === key);
    let isNewBest = false;
    if (idx === -1) {
      list.push({ name: cleanName, score: rounded, date: Date.now() });
      isNewBest = true;
    } else if (rounded > list[idx].score) {
      list[idx] = { name: cleanName, score: rounded, date: Date.now() };
      isNewBest = true;
    }
    list.sort((a, b) => b.score - a.score);
    const trimmed = list.slice(0, LB_MAX);
    saveLeaderboard(trimmed);
    return { list: trimmed, isNewBest, name: cleanName };
  }

  function renderLeaderboard(highlightName) {
    const list = loadLeaderboard();
    const el = document.getElementById('lb-list');
    el.innerHTML = '';
    if (list.length === 0) {
      const li = document.createElement('li');
      li.className = 'lb-empty';
      li.textContent = 'No runs yet — be the first Drifter.';
      el.appendChild(li);
      return;
    }
    const highlightKey = highlightName ? highlightName.trim().toLowerCase() : null;
    list.forEach((entry, i) => {
      const li = document.createElement('li');
      li.className = 'lb-row' + (i === 0 ? ' top1' : i === 1 ? ' top2' : i === 2 ? ' top3' : '');
      if (highlightKey && entry.name.trim().toLowerCase() === highlightKey) {
        li.classList.add('me');
      }
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = '#' + (i + 1);
      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = entry.name;
      const score = document.createElement('span');
      score.className = 'lb-score';
      score.textContent = Math.floor(entry.score);
      li.append(rank, name, score);
      el.appendChild(li);
    });
  }

  // ---------------------------------------------------------------------
  // Sound effects — synthesized via Web Audio API, no audio files needed
  // ---------------------------------------------------------------------
  const SFX = (() => {
    const MUTE_KEY = 'neonDrift.muted';
    let ctx = null;
    let master = null;
    let muted = false;
    try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* ignore */ }

    function ensureCtx() {
      if (ctx) return ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      return ctx;
    }

    function unlock() {
      const c = ensureCtx();
      if (c && c.state === 'suspended') c.resume();
    }

    function isMuted() { return muted; }

    function setMuted(m) {
      muted = m;
      try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (e) { /* ignore */ }
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.05);
    }

    function tone(freq, dur, opts = {}) {
      const c = ensureCtx();
      if (!c) return;
      const t0 = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + dur);
      const peak = opts.gain !== undefined ? opts.gain : 0.3;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack || 0.012));
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    function noiseBurst(dur, opts = {}) {
      const c = ensureCtx();
      if (!c) return;
      const t0 = c.currentTime;
      const bufferSize = Math.max(1, Math.floor(c.sampleRate * dur));
      const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      const src = c.createBufferSource();
      src.buffer = buffer;
      const filter = c.createBiquadFilter();
      filter.type = opts.filterType || 'lowpass';
      filter.frequency.value = opts.filterFreq || 1200;
      const gain = c.createGain();
      gain.gain.setValueAtTime(opts.gain !== undefined ? opts.gain : 0.4, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(t0);
    }

    // ---- Background music: procedural loop, scheduled with a lookahead
    // timer (standard Web Audio technique) so timing stays sample-accurate
    // regardless of setInterval jitter. ----
    const BPM = 92;
    const STEP_DUR = 60 / BPM / 4; // one 16th note, in seconds
    const SCHEDULE_AHEAD_SEC = 0.2;
    const LOOKAHEAD_MS = 25;

    // Am - F - C - G, a moody four-chord loop. Bass root per chord plus the
    // triad played softly on top as a sustained pad.
    const PROGRESSION = [
      { bass: 55.00, pad: [110.00, 130.81, 164.81] }, // Am
      { bass: 43.65, pad: [87.31, 110.00, 130.81] },  // F
      { bass: 65.41, pad: [130.81, 164.81, 196.00] }, // C
      { bass: 49.00, pad: [98.00, 123.47, 146.83] },  // G
    ];

    let musicGain = null;
    let musicOn = false;
    let schedulerId = null;
    let nextStepTime = 0;
    let stepIndex = 0;

    function playPadChord(freqs, t, dur) {
      const c = ensureCtx();
      freqs.forEach((f, i) => {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t);
        osc.detune.value = (i - 1) * 4;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g);
        g.connect(musicGain);
        osc.start(t);
        osc.stop(t + dur + 0.05);
      });
    }

    function playBassNote(freq, t, dur, peak) {
      const c = ensureCtx();
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak || 0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(musicGain);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }

    function playHat(t) {
      const c = ensureCtx();
      const bufferSize = Math.floor(c.sampleRate * 0.04);
      const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      const src = c.createBufferSource();
      src.buffer = buffer;
      const filter = c.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 6000;
      const g = c.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      src.connect(filter);
      filter.connect(g);
      g.connect(musicGain);
      src.start(t);
    }

    function scheduleStep(idx, t) {
      const chord = PROGRESSION[Math.floor(idx / 16) % PROGRESSION.length];
      const s = idx % 16;
      if (s === 0) {
        playPadChord(chord.pad, t, STEP_DUR * 16 * 1.05);
        playBassNote(chord.bass, t, STEP_DUR * 3.5);
      } else if (s === 8) {
        playBassNote(chord.bass * 1.5, t, STEP_DUR * 3.5);
      } else if (s === 4 || s === 12) {
        playBassNote(chord.bass * 2, t, STEP_DUR * 1.8, 0.1);
      }
      if (s % 4 === 2) playHat(t);
    }

    function schedulerTick() {
      const c = ensureCtx();
      if (!c) return;
      while (nextStepTime < c.currentTime + SCHEDULE_AHEAD_SEC) {
        scheduleStep(stepIndex, nextStepTime);
        nextStepTime += STEP_DUR;
        stepIndex++;
      }
    }

    function startMusic() {
      const c = ensureCtx();
      if (!c || musicOn) return;
      if (!musicGain) {
        musicGain = c.createGain();
        musicGain.gain.value = 1;
        musicGain.connect(master);
      }
      musicOn = true;
      stepIndex = 0;
      nextStepTime = c.currentTime + 0.1;
      schedulerId = setInterval(schedulerTick, LOOKAHEAD_MS);
    }

    function stopMusic() {
      musicOn = false;
      if (schedulerId) { clearInterval(schedulerId); schedulerId = null; }
    }

    return {
      unlock,
      isMuted,
      setMuted,
      startMusic,
      stopMusic,
      click() {
        tone(720, 0.08, { type: 'triangle', gain: 0.16, slideTo: 900 });
      },
      orb(comboLevel) {
        const base = 520 + clamp((comboLevel - 1) * 60, 0, 260);
        tone(base, 0.16, { type: 'square', gain: 0.2, slideTo: base * 1.7, attack: 0.005 });
      },
      hit() {
        noiseBurst(0.22, { gain: 0.45, filterFreq: 900 });
        tone(140, 0.25, { type: 'sawtooth', gain: 0.28, slideTo: 50 });
      },
      gameOver() {
        tone(420, 0.6, { type: 'sawtooth', gain: 0.26, slideTo: 60, attack: 0.02 });
        noiseBurst(0.5, { gain: 0.22, filterFreq: 500 });
      },
      newBest() {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          setTimeout(() => tone(f, 0.28, { type: 'triangle', gain: 0.24, attack: 0.01 }), i * 90);
        });
      },
      start() {
        tone(220, 0.3, { type: 'sine', gain: 0.2, slideTo: 660, attack: 0.01 });
      },
    };
  })();

  window.addEventListener('pointerdown', () => { SFX.unlock(); SFX.startMusic(); }, { passive: true });
  window.addEventListener('keydown', () => { SFX.unlock(); SFX.startMusic(); });
  document.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('.btn')) {
      SFX.unlock();
      SFX.startMusic();
      SFX.click();
    }
  }, { capture: true });

  // ---------------------------------------------------------------------
  // Background: parallax starfield + drifting nebula blobs
  // ---------------------------------------------------------------------
  const STAR_LAYERS = [
    { count: 90, speed: 12, size: [0.6, 1.4], alpha: 0.5 },
    { count: 60, speed: 28, size: [1.0, 2.0], alpha: 0.75 },
    { count: 30, speed: 50, size: [1.5, 2.8], alpha: 1.0 },
  ];
  let stars = [];
  let nebulae = [];

  function initBackground() {
    stars = [];
    STAR_LAYERS.forEach((layer, li) => {
      for (let i = 0; i < layer.count; i++) {
        stars.push({
          x: rand(0, W), y: rand(0, H),
          size: rand(layer.size[0], layer.size[1]),
          speed: layer.speed,
          alpha: layer.alpha,
          twinkleSeed: rand(0, TAU),
          layer: li,
        });
      }
    });
    nebulae = [];
    const colors = ['rgba(140,92,255,0.16)', 'rgba(255,62,201,0.13)', 'rgba(75,255,232,0.10)'];
    for (let i = 0; i < 4; i++) {
      nebulae.push({
        x: rand(0, W), y: rand(0, H),
        r: rand(180, 380),
        color: colors[i % colors.length],
        vx: rand(-6, 6), vy: rand(-4, 8),
      });
    }
  }
  initBackground();
  window.addEventListener('resize', () => initBackground());

  function updateBackground(dt) {
    stars.forEach(s => {
      s.y += s.speed * dt;
      if (s.y > H + 4) { s.y = -4; s.x = rand(0, W); }
    });
    nebulae.forEach(n => {
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      if (n.x < -n.r) n.x = W + n.r;
      if (n.x > W + n.r) n.x = -n.r;
      if (n.y < -n.r) n.y = H + n.r;
      if (n.y > H + n.r) n.y = -n.r;
    });
  }

  function drawBackground(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0620');
    g.addColorStop(1, '#05030c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    nebulae.forEach(n => {
      const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      grad.addColorStop(0, n.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, TAU);
      ctx.fill();
    });

    stars.forEach(s => {
      const twinkle = 0.6 + 0.4 * Math.sin(t * 2 + s.twinkleSeed);
      ctx.globalAlpha = s.alpha * twinkle;
      ctx.fillStyle = '#eaf6ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, TAU);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------
  // Particle system
  // ---------------------------------------------------------------------
  let particles = [];

  function emit(x, y, count, opts) {
    for (let i = 0; i < count; i++) {
      const angle = opts.angle !== undefined ? opts.angle + rand(-opts.spread, opts.spread) : rand(0, TAU);
      const speed = rand(opts.speedMin, opts.speedMax);
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: rand(opts.lifeMin, opts.lifeMax),
        size: rand(opts.sizeMin, opts.sizeMax),
        color: Array.isArray(opts.color) ? opts.color[randInt(0, opts.color.length - 1)] : opts.color,
        gravity: opts.gravity || 0,
        drag: opts.drag !== undefined ? opts.drag : 0.98,
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function drawParticles() {
    particles.forEach(p => {
      const t = p.life / p.maxLife;
      const alpha = 1 - t;
      const size = p.size * (1 - t * 0.5);
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.1, size), 0, TAU);
      ctx.fill();
    });
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------
  // Screen shake
  // ---------------------------------------------------------------------
  let shakeTime = 0, shakeMag = 0;
  function addShake(mag, time) {
    shakeMag = Math.max(shakeMag, mag);
    shakeTime = Math.max(shakeTime, time);
  }
  function updateShake(dt) {
    if (shakeTime > 0) {
      shakeTime -= dt;
      if (shakeTime <= 0) { shakeTime = 0; shakeMag = 0; }
    }
  }
  function currentShakeOffset() {
    if (shakeTime <= 0) return { x: 0, y: 0 };
    const m = shakeMag * (shakeTime > 0.001 ? 1 : 0);
    return { x: rand(-m, m), y: rand(-m, m) };
  }

  // ---------------------------------------------------------------------
  // Player
  // ---------------------------------------------------------------------
  const player = {
    x: 0, y: 0, vx: 0, vy: 0,
    radius: 14,
    angle: -Math.PI / 2,
    invuln: 0,
    maxSpeed: 420,
    accel: 2200,
    friction: 0.90,
  };

  function resetPlayer() {
    player.x = W / 2;
    player.y = H * 0.75;
    player.vx = 0; player.vy = 0;
    player.angle = -Math.PI / 2;
    player.invuln = 2.0;
  }

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------
  const keys = new Set();
  window.addEventListener('keydown', e => {
    keys.add(e.key.toLowerCase());
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
  }, { passive: false });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

  let pointerActive = false;
  let pointerX = 0, pointerY = 0;
  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }
  canvas.addEventListener('mousedown', e => { pointerActive = true; const p = pointerPos(e); pointerX = p.x; pointerY = p.y; });
  window.addEventListener('mouseup', () => pointerActive = false);
  window.addEventListener('mousemove', e => { if (pointerActive) { const p = pointerPos(e); pointerX = p.x; pointerY = p.y; } });
  canvas.addEventListener('touchstart', e => { pointerActive = true; const p = pointerPos(e); pointerX = p.x; pointerY = p.y; }, { passive: true });
  canvas.addEventListener('touchmove', e => { if (pointerActive) { const p = pointerPos(e); pointerX = p.x; pointerY = p.y; } }, { passive: true });
  window.addEventListener('touchend', () => pointerActive = false);

  function updatePlayer(dt) {
    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);

    let ax = 0, ay = 0;
    const usingKeys = keys.has('arrowup') || keys.has('arrowdown') || keys.has('arrowleft') || keys.has('arrowright') ||
      keys.has('w') || keys.has('a') || keys.has('s') || keys.has('d');

    if (usingKeys) {
      if (keys.has('arrowleft') || keys.has('a')) ax -= 1;
      if (keys.has('arrowright') || keys.has('d')) ax += 1;
      if (keys.has('arrowup') || keys.has('w')) ay -= 1;
      if (keys.has('arrowdown') || keys.has('s')) ay += 1;
      const len = Math.hypot(ax, ay) || 1;
      player.vx += (ax / len) * player.accel * dt;
      player.vy += (ay / len) * player.accel * dt;
    } else if (pointerActive) {
      const dx = pointerX - player.x, dy = pointerY - player.y;
      const d = Math.hypot(dx, dy);
      if (d > 4) {
        player.vx += (dx / d) * player.accel * dt;
        player.vy += (dy / d) * player.accel * dt;
      }
    }

    player.vx *= Math.pow(player.friction, dt * 60);
    player.vy *= Math.pow(player.friction, dt * 60);
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > player.maxSpeed) {
      player.vx = (player.vx / speed) * player.maxSpeed;
      player.vy = (player.vy / speed) * player.maxSpeed;
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.x = clamp(player.x, player.radius, W - player.radius);
    player.y = clamp(player.y, player.radius, H - player.radius);

    if (speed > 20) {
      const targetAngle = Math.atan2(player.vy, player.vx);
      let diff = targetAngle - player.angle;
      while (diff > Math.PI) diff -= TAU;
      while (diff < -Math.PI) diff += TAU;
      player.angle += diff * clamp(dt * 10, 0, 1);
    }

    if (speed > 30 && Math.random() < 0.6) {
      emit(player.x - Math.cos(player.angle) * player.radius, player.y - Math.sin(player.angle) * player.radius, 1, {
        angle: player.angle + Math.PI, spread: 0.4, speedMin: 20, speedMax: 60,
        lifeMin: 0.25, lifeMax: 0.5, sizeMin: 1.5, sizeMax: 3.5,
        color: ['#4bffe8', '#8c5cff'], drag: 0.9,
      });
    }
  }

  function drawPlayer() {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle + Math.PI / 2);

    const blinking = player.invuln > 0 && Math.floor(player.invuln * 10) % 2 === 0;
    ctx.globalAlpha = blinking ? 0.4 : 1;

    ctx.shadowColor = '#4bffe8';
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#0d1a2b';
    ctx.strokeStyle = '#4bffe8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -player.radius * 1.3);
    ctx.lineTo(player.radius * 0.9, player.radius * 0.9);
    ctx.lineTo(0, player.radius * 0.4);
    ctx.lineTo(-player.radius * 0.9, player.radius * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 10;
    ctx.fillStyle = '#eafffb';
    ctx.beginPath();
    ctx.arc(0, -player.radius * 0.1, 3.2, 0, TAU);
    ctx.fill();

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  // ---------------------------------------------------------------------
  // Obstacles ("shards") & Collectibles ("orbs")
  // ---------------------------------------------------------------------
  let obstacles = [];
  let orbs = [];
  let obstacleTimer = 0;
  let orbTimer = 0;
  let elapsed = 0;

  function difficultyFactor() {
    return clamp(elapsed / 45, 0, 1);
  }

  function spawnObstacle() {
    const r = rand(14, 34);
    const speed = lerp(90, 230, difficultyFactor()) * rand(0.8, 1.3);
    obstacles.push({
      x: rand(r, W - r), y: -r - 10,
      vx: rand(-30, 30), vy: speed,
      radius: r,
      rotation: rand(0, TAU),
      rotSpeed: rand(-2, 2),
      spikes: randInt(5, 8),
    });
  }

  function spawnOrb() {
    const r = 9;
    orbs.push({
      x: rand(r + 10, W - r - 10), y: -r - 10,
      vy: lerp(70, 140, difficultyFactor()),
      radius: r,
      pulse: rand(0, TAU),
    });
  }

  function updateObstaclesAndOrbs(dt) {
    elapsed += dt;
    const df = difficultyFactor();
    obstacleTimer -= dt;
    if (obstacleTimer <= 0) {
      spawnObstacle();
      obstacleTimer = lerp(1.1, 0.35, df) * rand(0.85, 1.15);
    }
    orbTimer -= dt;
    if (orbTimer <= 0) {
      spawnOrb();
      orbTimer = lerp(1.6, 0.9, df) * rand(0.8, 1.3);
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.rotation += o.rotSpeed * dt;
      if (o.y - o.radius > H + 20) { obstacles.splice(i, 1); continue; }
      if (o.x < o.radius) { o.x = o.radius; o.vx *= -1; }
      if (o.x > W - o.radius) { o.x = W - o.radius; o.vx *= -1; }
    }

    for (let i = orbs.length - 1; i >= 0; i--) {
      const orb = orbs[i];
      orb.y += orb.vy * dt;
      orb.pulse += dt * 4;
      if (orb.y - orb.radius > H + 20) { orbs.splice(i, 1); continue; }
    }
  }

  function drawObstacles() {
    obstacles.forEach(o => {
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(o.rotation);
      ctx.shadowColor = '#ff3ec9';
      ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(255,62,201,0.18)';
      ctx.strokeStyle = '#ff3ec9';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const spikes = o.spikes;
      for (let i = 0; i < spikes * 2; i++) {
        const ang = (Math.PI / spikes) * i;
        const rad = i % 2 === 0 ? o.radius : o.radius * 0.5;
        const px = Math.cos(ang) * rad, py = Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
    ctx.shadowBlur = 0;
  }

  function drawOrbs() {
    orbs.forEach(orb => {
      const pulse = 1 + 0.25 * Math.sin(orb.pulse);
      ctx.save();
      ctx.translate(orb.x, orb.y);
      ctx.shadowColor = '#ffe14b';
      ctx.shadowBlur = 20;
      ctx.fillStyle = 'rgba(255,225,75,0.25)';
      ctx.beginPath();
      ctx.arc(0, 0, orb.radius * pulse, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#fff6d0';
      ctx.beginPath();
      ctx.arc(0, 0, orb.radius * 0.45, 0, TAU);
      ctx.fill();
      ctx.restore();
    });
    ctx.shadowBlur = 0;
  }

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------
  const STATE = { MENU: 'menu', PLAYING: 'playing', GAMEOVER: 'gameover', LEADERBOARD: 'leaderboard' };
  let state = STATE.MENU;
  let score = 0;
  let combo = 1;
  let lives = 3;

  const hud = document.getElementById('hud');
  const hudScore = document.getElementById('hud-score');
  const hudCombo = document.getElementById('hud-combo');
  const hudLives = document.getElementById('hud-lives');
  const screens = {
    start: document.getElementById('start-screen'),
    gameover: document.getElementById('gameover-screen'),
    leaderboard: document.getElementById('leaderboard-screen'),
  };

  function refreshLivesHud() {
    hudLives.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'life-icon' + (i < lives ? '' : ' lost');
      hudLives.appendChild(d);
    }
  }

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    if (name && screens[name]) screens[name].classList.remove('hidden');
  }

  function startGame() {
    SFX.unlock();
    SFX.startMusic();
    SFX.start();
    score = 0; combo = 1; lives = 3;
    obstacles = []; orbs = []; particles = [];
    obstacleTimer = 0.6; orbTimer = 1.0; elapsed = 0;
    resetPlayer();
    state = STATE.PLAYING;
    hud.classList.remove('hidden');
    showScreen(null);
    refreshLivesHud();
  }

  function endGame() {
    state = STATE.GAMEOVER;
    SFX.gameOver();
    hud.classList.add('hidden');
    document.getElementById('final-score').textContent = Math.floor(score);
    const qualifies = qualifiesForLeaderboard(score) && score > 0;
    document.getElementById('new-record').classList.toggle('hidden', !qualifies);
    document.getElementById('name-entry').classList.toggle('hidden', !qualifies);
    if (qualifies) {
      const input = document.getElementById('player-name');
      input.value = '';
      setTimeout(() => input.focus(), 50);
    }
    showScreen('gameover');
  }

  function updateGameplay(dt) {
    updatePlayer(dt);
    updateObstaclesAndOrbs(dt);

    for (let i = orbs.length - 1; i >= 0; i--) {
      const orb = orbs[i];
      if (dist2(player.x, player.y, orb.x, orb.y) < (player.radius + orb.radius) ** 2) {
        orbs.splice(i, 1);
        combo = Math.min(5, combo + 0.15);
        score += 10 * combo;
        SFX.orb(combo);
        emit(orb.x, orb.y, 16, {
          spread: TAU, speedMin: 60, speedMax: 180, lifeMin: 0.3, lifeMax: 0.7,
          sizeMin: 1.5, sizeMax: 3.5, color: ['#ffe14b', '#fff6d0'], drag: 0.92,
        });
      }
    }

    if (player.invuln <= 0) {
      for (let i = obstacles.length - 1; i >= 0; i--) {
        const o = obstacles[i];
        if (dist2(player.x, player.y, o.x, o.y) < (player.radius * 0.8 + o.radius * 0.75) ** 2) {
          obstacles.splice(i, 1);
          lives -= 1;
          combo = 1;
          player.invuln = 1.6;
          addShake(14, 0.4);
          SFX.hit();
          emit(player.x, player.y, 26, {
            spread: TAU, speedMin: 80, speedMax: 260, lifeMin: 0.3, lifeMax: 0.8,
            sizeMin: 2, sizeMax: 4.5, color: ['#ff3ec9', '#8c5cff', '#fff'], drag: 0.9,
          });
          refreshLivesHud();
          if (lives <= 0) { endGame(); return; }
          break;
        }
      }
    }

    score += dt * combo * 3;
    hudScore.textContent = Math.floor(score);
    hudCombo.textContent = 'x' + combo.toFixed(1);
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  let lastTime = performance.now();
  let simTime = 0;

  function frame(now) {
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    dt = clamp(dt, 0, 1 / 30);
    simTime += dt;

    updateBackground(dt);
    updateShake(dt);
    updateParticles(dt);
    if (state === STATE.PLAYING) updateGameplay(dt);

    ctx.clearRect(0, 0, W, H);
    const shake = currentShakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);
    drawBackground(simTime);
    drawParticles();
    if (state === STATE.PLAYING || state === STATE.GAMEOVER) {
      drawOrbs();
      drawObstacles();
      if (state === STATE.PLAYING) drawPlayer();
    }
    ctx.restore();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------------
  // UI wiring
  // ---------------------------------------------------------------------
  document.getElementById('btn-play').addEventListener('click', startGame);
  document.getElementById('btn-retry').addEventListener('click', startGame);
  document.getElementById('btn-menu').addEventListener('click', () => { state = STATE.MENU; showScreen('start'); });
  document.getElementById('btn-back-menu').addEventListener('click', () => { state = STATE.MENU; showScreen('start'); });

  let lastSavedName = null;

  document.getElementById('btn-leaderboard').addEventListener('click', () => {
    state = STATE.LEADERBOARD;
    renderLeaderboard(null);
    showScreen('leaderboard');
  });
  document.getElementById('btn-view-leaderboard').addEventListener('click', () => {
    state = STATE.LEADERBOARD;
    renderLeaderboard(lastSavedName);
    showScreen('leaderboard');
  });

  document.getElementById('btn-clear-scores').addEventListener('click', () => {
    if (confirm('Clear all leaderboard scores? This cannot be undone.')) {
      saveLeaderboard([]);
      lastSavedName = null;
      renderLeaderboard(null);
    }
  });

  function submitScore() {
    const input = document.getElementById('player-name');
    const name = input.value.trim() || 'ANON';
    const result = addScore(name, score);
    lastSavedName = result.name;
    if (result.isNewBest) SFX.newBest();
    document.getElementById('name-entry').classList.add('hidden');
  }
  document.getElementById('btn-submit-score').addEventListener('click', submitScore);
  document.getElementById('player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitScore();
  });

  const muteBtn = document.getElementById('btn-mute');
  function refreshMuteBtn() {
    muteBtn.textContent = SFX.isMuted() ? 'SOUND: OFF' : 'SOUND: ON';
    muteBtn.classList.toggle('muted', SFX.isMuted());
  }
  muteBtn.addEventListener('click', () => {
    SFX.setMuted(!SFX.isMuted());
    refreshMuteBtn();
  });
  refreshMuteBtn();

  showScreen('start');
})();
