/**
 * App1.music — optional procedural background music (Web Audio API, no files).
 *
 * A short chord progression is played as soft pads + bass + an arpeggio, with
 * a sparse random pentatonic melody fed through an echo, so it never loops
 * exactly. Everything is generated with oscillators.
 *
 * - Off/on and volume are remembered in localStorage (best-effort).
 * - Browsers block audio until a user gesture, so playback begins on the
 *   first pointerdown/keydown after the page loads (if enabled).
 * - Fades out while the tab is hidden and resumes when it returns.
 *
 * Public API:
 *   App1.music.init()            wire gesture/visibility listeners (call once)
 *   App1.music.setEnabled(bool)  App1.music.isEnabled()
 *   App1.music.setVolume(0..1)   App1.music.volume()
 *   App1.music.mountControl(el)  render a toggle button + volume slider into el
 */
(function (NS) {
  'use strict';

  // ---- Style: tweak these to change the mood --------------------------------
  var STYLE = {
    bpm: 100,
    // I–vi–IV–V in C, bright and playful. MIDI numbers.
    chords: [
      { bass: 36, pad: [60, 64, 67, 72] },   // C
      { bass: 33, pad: [57, 60, 64, 69] },   // Am
      { bass: 41, pad: [57, 60, 65, 69] },   // F
      { bass: 43, pad: [59, 62, 67, 71] }    // G
    ],
    melody: [72, 74, 76, 79, 81, 84, 86, 88],  // C major pentatonic
    melodyChance: 0.28,      // per eighth note
    arpeggio: true,          // plucky 8th-note arpeggio of the chord
    padLevel: 0.035,
    bassLevel: 0.14,
    echo: 0.28,
    maxGain: 0.12
  };
  var STORAGE_KEY = 'app1.music';

  var BEAT = 60 / STYLE.bpm;
  var BAR = BEAT * 4;
  var LOOKAHEAD = 0.6, TICK_MS = 100, FADE = 1.0;

  var prefs = load();
  var ctx = null, bus = null, echo = null;
  var timer = null, playing = false, nextBar = 0, bar = 0, mel = 3;
  var controls = [];   // mounted UIs to keep in sync

  function load() {
    var d = { enabled: true, volume: 0.5 };
    try {
      var s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (s && typeof s === 'object') {
        if (typeof s.enabled === 'boolean') d.enabled = s.enabled;
        if (typeof s.volume === 'number') d.volume = Math.max(0, Math.min(1, s.volume));
      }
    } catch (e) { /* storage unavailable: use defaults */ }
    return d;
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }

  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function ensureGraph() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      bus = ctx.createGain();
      bus.gain.value = 0.0001;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      bus.connect(lp);
      lp.connect(ctx.destination);
      echo = ctx.createDelay(2);
      echo.delayTime.value = BEAT * 0.75;
      var fb = ctx.createGain(); fb.gain.value = STYLE.echo;
      var wet = ctx.createGain(); wet.gain.value = 0.35;
      echo.connect(fb); fb.connect(echo); echo.connect(wet); wet.connect(lp);
      return true;
    } catch (e) { ctx = null; return false; }
  }

  function voice(f, t, dur, type, level, attack, detune) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + dur + 0.05);
    return g;
  }

  function scheduleBar(t) {
    var c = STYLE.chords[bar % STYLE.chords.length];
    c.pad.forEach(function (n) {
      voice(hz(n), t, BAR + 0.5, 'sine', STYLE.padLevel, 0.6, -4);
      voice(hz(n), t, BAR + 0.5, 'triangle', STYLE.padLevel * 0.5, 0.8, 5);
    });
    voice(hz(c.bass), t, BEAT * 1.8, 'sine', STYLE.bassLevel, 0.03);
    voice(hz(c.bass + 12), t + BEAT * 2, BEAT * 1.5, 'sine', STYLE.bassLevel * 0.7, 0.03);
    for (var i = 0; i < 8; i++) {
      var tt = t + i * BEAT / 2;
      if (STYLE.arpeggio) {
        var n = c.pad[[0, 1, 2, 3, 2, 1, 2, 3][i] % c.pad.length] + 12;
        voice(hz(n), tt, BEAT * 0.45, 'triangle', 0.022, 0.006);
      }
      if (Math.random() < STYLE.melodyChance) {
        mel = Math.max(0, Math.min(STYLE.melody.length - 1, mel + Math.floor(Math.random() * 5) - 2));
        voice(hz(STYLE.melody[mel]), tt + Math.random() * 0.02, BEAT * 1.2, 'sine', 0.05, 0.012).connect(echo);
      }
    }
  }

  function tick() {
    while (nextBar < ctx.currentTime + LOOKAHEAD) { scheduleBar(nextBar); nextBar += BAR; bar++; }
  }

  function fadeTo(v) {
    var now = ctx.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
    bus.gain.exponentialRampToValueAtTime(Math.max(0.0001, v), now + FADE);
  }

  function shouldPlay() { return prefs.enabled && prefs.volume > 0 && !document.hidden; }

  function start() {
    if (!shouldPlay() || !ensureGraph()) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
    fadeTo(STYLE.maxGain * prefs.volume);
    if (playing) return;
    playing = true;
    nextBar = ctx.currentTime + 0.1;
    tick();
    timer = setInterval(tick, TICK_MS);
  }

  function stop() {
    if (!playing) return;
    playing = false;
    clearInterval(timer); timer = null;
    fadeTo(0.0001);
  }

  function sync() {
    if (shouldPlay()) start(); else stop();
    controls.forEach(function (fn) { fn(); });
  }

  var Music = {
    init: function () {
      var unlock = function () {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
        sync();
      };
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
      document.addEventListener('visibilitychange', function () { if (ctx) sync(); });
    },
    isEnabled: function () { return prefs.enabled; },
    volume: function () { return prefs.volume; },
    setEnabled: function (on) { prefs.enabled = !!on; persist(); sync(); },
    setVolume: function (v) { prefs.volume = Math.max(0, Math.min(1, v)); persist(); sync(); },
    toggle: function () { Music.setEnabled(!prefs.enabled); },

    /** Renders "🎵 Music: On/Off" + a volume slider into `el` (class names prefixed music-). */
    mountControl: function (el) {
      var wrap = document.createElement('div');
      wrap.className = 'music-control';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'music-toggle';
      var range = document.createElement('input');
      range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '5';
      range.className = 'music-volume';
      range.setAttribute('aria-label', 'Music volume');
      btn.addEventListener('click', Music.toggle);
      range.addEventListener('input', function () { Music.setVolume(Number(range.value) / 100); });
      var render = function () {
        btn.textContent = prefs.enabled ? '🎵 Music: On' : '🔇 Music: Off';
        btn.setAttribute('aria-pressed', String(prefs.enabled));
        btn.title = prefs.enabled ? 'Turn background music off' : 'Turn background music on';
        range.value = String(Math.round(prefs.volume * 100));
        range.disabled = !prefs.enabled;
      };
      controls.push(render);
      render();
      wrap.appendChild(btn);
      wrap.appendChild(range);
      el.appendChild(wrap);
      return wrap;
    }
  };

  NS.music = Music;
})(window.App1 = window.App1 || {});
