/**
 * App1 - ui.js
 * ----------------------------------------------------------------------------
 * DOM side panel, HUD buttons, stats panel, save slots and keyboard shortcuts.
 * Most controls are generated from data (tools, materials, presets, slider
 * definitions) so adding a tool/material/preset shows up here automatically.
 */
(function (App1) {
  'use strict';
  const { Materials, Presets, Storage } = App1;

  const $ = (sel, root = document) => root.querySelector(sel);

  /** Escape text for safe insertion into HTML. */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  }

  const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-');
  function fmtEnergy(j) {
    if (!Number.isFinite(j)) return '-';
    if (j >= 1e6) return (j / 1e6).toFixed(2) + ' MJ';
    if (j >= 1e3) return (j / 1e3).toFixed(2) + ' kJ';
    return j.toFixed(1) + ' J';
  }

  /** CSS swatch backgrounds approximating each painter style. */
  const swatchStyles = {
    grain: (c) => `repeating-linear-gradient(100deg, ${c.base} 0 6px, ${c.dark} 6px 7px, ${c.light} 7px 10px)`,
    brushed: (c) => `linear-gradient(135deg, ${c.light}, ${c.base} 35%, ${c.dark} 65%, ${c.base})`,
    matte: (c) => `radial-gradient(circle at 30% 30%, ${c.light}, ${c.base} 55%, ${c.dark})`,
    glass: (c) => `linear-gradient(135deg, rgba(255,255,255,0.8), ${c.base} 45%, ${c.dark})`,
    static: (c) => c.base
  };

  const SHAPES = [
    { id: 'circle', name: 'Circle', key: 'Q', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>' },
    { id: 'square', name: 'Square', key: 'W', icon: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14"/></svg>' },
    { id: 'triangle', name: 'Triangle', key: 'E', icon: '<svg viewBox="0 0 24 24"><path d="M12 4 L20 19 L4 19 Z"/></svg>' }
  ];

  const TOOL_ICONS = {
    spawn: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    drag: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>',
    explode: '<svg viewBox="0 0 24 24"><path d="M12 2l2 6 6-3-3 6 6 2-6 2 3 6-6-3-2 6-2-6-6 3 3-6-6-2 6-2-3-6 6 3z"/></svg>',
    spring: '<svg viewBox="0 0 24 24"><path d="M3 12h3l2-5 3 10 3-10 3 10 2-5h2"/></svg>',
    delete: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>'
  };

  class UI {
    constructor(app) {
      this.app = app;
      this.lastStats = -Infinity;
      this.toastTimer = 0;
      this.narrow = window.matchMedia('(max-width: 760px)');

      this.buildTools();
      this.buildShapes();
      this.buildMaterials();
      this.buildSliders();
      this.buildToggles();
      this.buildPresets();
      this.bindButtons();
      this.renderSlots();
      this.bindKeyboard();
      this.buildShortcutTable();

      app.tools.onChange = () => this.syncTools();
      this.syncTools();
      this.syncShape();
      this.syncMaterial();

      // Panel starts closed on phones so the canvas is visible.
      if (this.narrow.matches) this.setPanelOpen(false);
      if (this.narrow.matches) this.setStatsCollapsed(true);
    }

    // --- Builders ---------------------------------------------------------------
    buildTools() {
      const wrap = $('#tool-buttons');
      wrap.innerHTML = '';
      for (const t of this.app.tools.tools) {
        wrap.appendChild(el('button', {
          class: 'tool-btn', 'data-tool': t.id, title: `${t.name} (${t.key})`,
          'aria-pressed': 'false',
          onclick: () => this.app.tools.setTool(t.id),
          html: `${TOOL_ICONS[t.id] || ''}<span>${esc(t.name)}</span><kbd>${esc(t.key)}</kbd>`
        }));
      }
    }

    buildShapes() {
      const wrap = $('#shape-buttons');
      wrap.innerHTML = '';
      for (const s of SHAPES) {
        wrap.appendChild(el('button', {
          class: 'shape-btn', 'data-shape': s.id, title: `${s.name} (${s.key})`, 'aria-pressed': 'false',
          onclick: () => this.setShape(s.id),
          html: `${s.icon}<span>${esc(s.name)}</span>`
        }));
      }
    }

    buildMaterials() {
      const wrap = $('#material-buttons');
      wrap.innerHTML = '';
      for (const m of Materials.list()) {
        const sw = el('span', { class: 'swatch' });
        sw.style.background = (swatchStyles[m.style] || swatchStyles.static)(m.colors);
        wrap.appendChild(el('button', {
          class: 'material-btn', 'data-material': m.key, title: m.description, 'aria-pressed': 'false',
          onclick: () => this.setMaterial(m.key)
        }, [sw, el('span', { text: m.name })]));
      }
    }

    /** Slider definitions: easy to extend with new parameters. */
    sliderDefs() {
      const app = this.app, w = app.world, st = app.state;
      return [
        { id: 'size', target: '#shape-size', label: 'Size', min: 0.3, max: 2.5, step: 0.05, get: () => st.size, set: (v) => { st.size = v; }, fmt: (v) => v.toFixed(2) + ' m' },
        { id: 'gravity', label: 'Gravity', min: -20, max: 30, step: 0.1, get: () => w.gravity.y, set: (v) => w.setGravity(0, v), fmt: (v) => v.toFixed(1) + ' m/s²', reset: 9.81 },
        { id: 'wind', label: 'Wind', min: -40, max: 40, step: 0.5, get: () => w.wind, set: (v) => w.setWind(v), fmt: (v) => (v === 0 ? 'calm' : (v < 0 ? '← ' : '→ ') + Math.abs(v).toFixed(1) + ' m/s'), reset: 0 },
        { id: 'timescale', label: 'Time scale', min: 0.1, max: 2, step: 0.05, get: () => st.timeScale, set: (v) => { st.timeScale = v; }, fmt: (v) => v.toFixed(2) + '×', reset: 1 },
        { id: 'blast', label: 'Blast power', min: 100, max: 5000, step: 50, get: () => st.explosionPower, set: (v) => { st.explosionPower = v; }, fmt: (v) => v.toFixed(0) + ' N·s' },
        { id: 'radius', label: 'Blast radius', min: 1, max: 10, step: 0.5, get: () => st.explosionRadius, set: (v) => { st.explosionRadius = v; }, fmt: (v) => v.toFixed(1) + ' m' },
        { id: 'springf', label: 'Spring stiffness', min: 0.3, max: 6, step: 0.1, get: () => st.springFrequency, set: (v) => { st.springFrequency = v; }, fmt: (v) => v.toFixed(1) + ' Hz' },
        { id: 'springd', label: 'Spring damping', min: 0, max: 1, step: 0.05, get: () => st.springDamping, set: (v) => { st.springDamping = v; }, fmt: (v) => v.toFixed(2) },
        { id: 'iterations', label: 'Solver iterations', min: 2, max: 30, step: 1, get: () => w.settings.iterations, set: (v) => { w.settings.iterations = Math.round(v); }, fmt: (v) => String(Math.round(v)) }
      ];
    }

    buildSliders() {
      const env = $('#env-sliders');
      env.innerHTML = '';
      this.sliders = {};
      for (const d of this.sliderDefs()) {
        const input = el('input', { type: 'range', id: 'sl-' + d.id, min: d.min, max: d.max, step: d.step });
        const out = el('output', { for: 'sl-' + d.id });
        const label = el('label', { class: 'slider', for: 'sl-' + d.id }, [el('span', { class: 'slider-label', text: d.label }), out]);
        const row = el('div', { class: 'slider-row' }, [label, input]);
        if (d.reset !== undefined) {
          label.appendChild(el('button', { class: 'mini', type: 'button', title: 'Reset to default', text: '↺', onclick: (e) => { e.preventDefault(); d.set(d.reset); this.syncSliders(); } }));
        }
        input.addEventListener('input', () => { d.set(parseFloat(input.value)); out.textContent = d.fmt(parseFloat(input.value)); });
        (d.target ? $(d.target) : env).appendChild(row);
        this.sliders[d.id] = { def: d, input, out };
      }
      this.syncSliders();
    }

    /** Push model values into all slider widgets (after load/reset/shortcut). */
    syncSliders() {
      for (const { def, input, out } of Object.values(this.sliders)) {
        const v = def.get();
        input.value = v;
        out.textContent = def.fmt(parseFloat(input.value));
      }
    }

    buildToggles() {
      const app = this.app;
      const defs = [
        { id: 'sleeping', label: 'Allow sleeping', get: () => app.world.settings.sleeping, set: (v) => { app.world.settings.sleeping = v; if (!v) app.world.wakeAll(); } },
        { id: 'particles', label: 'Particles', get: () => app.particles.enabled, set: (v) => { app.particles.enabled = v; if (!v) app.particles.clear(); } },
        { id: 'contacts', label: 'Show contacts', get: () => app.debug.contacts, set: (v) => { app.debug.contacts = v; } },
        { id: 'aabbs', label: 'Show AABBs', get: () => app.debug.aabbs, set: (v) => { app.debug.aabbs = v; } },
        { id: 'showsleep', label: 'Shade sleeping bodies', get: () => app.debug.sleeping, set: (v) => { app.debug.sleeping = v; } }
      ];
      const wrap = $('#toggles');
      wrap.innerHTML = '';
      for (const d of defs) {
        const input = el('input', { type: 'checkbox', id: 'tg-' + d.id });
        input.checked = d.get();
        input.addEventListener('change', () => d.set(input.checked));
        wrap.appendChild(el('label', { class: 'check' }, [input, el('span', { text: d.label })]));
      }
    }

    buildPresets() {
      const wrap = $('#preset-buttons');
      wrap.innerHTML = '';
      for (const p of Presets.list) {
        wrap.appendChild(el('button', {
          class: 'preset-btn', title: p.description,
          onclick: () => this.app.loadPreset(p.id, $('#preset-keep').checked)
        }, [el('span', { text: p.name })]));
      }
    }

    buildShortcutTable() {
      const rows = [
        ['Space', 'Pause / resume'], ['.', 'Step one frame (paused)'], ['R', 'Reset scene'], ['C', 'Clear objects'],
        ['1 – 5', 'Spawn / Drag / Explode / Spring / Delete'], ['Q W E', 'Circle / Square / Triangle'],
        ['M', 'Next material (Shift: previous)'], ['[ ]', 'Smaller / bigger shapes'], ['G', 'Flip gravity'],
        ['Del', 'Delete selected object'], ['Esc', 'Cancel / deselect'], ['+ / −', 'Zoom'], ['Arrows', 'Pan camera'],
        ['F', 'Fit world in view'], ['H', 'Toggle side panel'], ['Ctrl+S', 'Quick-save to slot 1'],
        ['Wheel / pinch', 'Zoom'], ['Right / middle drag, 2 fingers', 'Pan']
      ];
      $('#shortcut-table').innerHTML = rows.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join('');
    }

    bindButtons() {
      const app = this.app;
      const on = (sel, fn) => { const e = $(sel); if (e) e.addEventListener('click', fn); };
      on('#btn-pause', () => app.togglePause());
      on('#btn-step', () => app.stepOnce());
      on('#btn-reset', () => app.reset());
      on('#btn-zoom-in', () => app.camera.zoomBy(1.25));
      on('#btn-zoom-out', () => app.camera.zoomBy(0.8));
      on('#btn-fit', () => app.fitView());
      on('#btn-panel', () => this.setPanelOpen(!this.isPanelOpen()));
      on('#btn-panel-close', () => this.setPanelOpen(false));
      on('#btn-stats-toggle', () => this.setStatsCollapsed(!$('#stats').classList.contains('collapsed')));
      on('#btn-sim-pause', () => app.togglePause());
      on('#btn-sim-reset', () => app.reset());
      on('#btn-sim-clear', () => app.clear());
      on('#btn-sim-wake', () => { app.world.wakeAll(); this.toast('All bodies woken.'); });
      on('#btn-export', () => app.exportJSON());
      on('#btn-import', () => $('#import-file').click());
      $('#import-file').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (f) app.importJSON(f);
      });
    }

    // --- Panel / stats visibility ----------------------------------------------
    isPanelOpen() { return !document.body.classList.contains('panel-closed'); }
    setPanelOpen(open) {
      document.body.classList.toggle('panel-closed', !open);
      $('#btn-panel').setAttribute('aria-expanded', String(open));
      // The stage size changes on desktop; main.js observes and resizes.
    }
    setStatsCollapsed(c) {
      $('#stats').classList.toggle('collapsed', c);
      $('#btn-stats-toggle').textContent = c ? '+' : '–';
      $('#btn-stats-toggle').setAttribute('aria-expanded', String(!c));
    }

    // --- Selections -------------------------------------------------------------
    setShape(id) { this.app.state.shape = id; this.syncShape(); }
    setMaterial(key) { this.app.state.material = key; this.syncMaterial(); }

    syncTools() {
      const cur = this.app.tools.current;
      document.querySelectorAll('.tool-btn').forEach((b) => {
        const on = b.dataset.tool === cur.id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      $('#tool-hint').textContent = cur.hint;
      document.body.dataset.tool = cur.id;
    }

    syncShape() {
      document.querySelectorAll('.shape-btn').forEach((b) => {
        const on = b.dataset.shape === this.app.state.shape;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    }

    syncMaterial() {
      const key = this.app.state.material;
      document.querySelectorAll('.material-btn').forEach((b) => {
        const on = b.dataset.material === key;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      const m = Materials.get(key);
      $('#material-info').innerHTML =
        `<b>${esc(m.name)}</b>: ${esc(m.description)}<br>` +
        `density ${m.density} kg/m² · friction ${m.friction} · restitution ${m.restitution}`;
    }

    syncPause() {
      const p = this.app.paused;
      $('#btn-pause').textContent = p ? 'Play' : 'Pause';
      $('#btn-pause').classList.toggle('active', p);
      $('#btn-sim-pause').textContent = p ? 'Resume' : 'Pause';
      $('#paused-badge').hidden = !p;
    }

    // --- Save slots ---------------------------------------------------------------
    renderSlots() {
      const wrap = $('#slots');
      wrap.innerHTML = '';
      if (!Storage.storageAvailable()) {
        wrap.appendChild(el('p', { class: 'muted', text: 'localStorage is unavailable in this browser context. Use Export/Import instead.' }));
        return;
      }
      for (const s of Storage.Slots.list()) {
        const info = s.empty ? 'Empty' : `${new Date(s.savedAt).toLocaleString()} · ${s.bodies} bodies`;
        wrap.appendChild(el('div', { class: 'slot' }, [
          el('div', { class: 'slot-info' }, [el('b', { text: `Slot ${s.index}` }), el('small', { text: info })]),
          el('div', { class: 'slot-actions' }, [
            el('button', { text: 'Save', onclick: () => this.app.saveSlot(s.index) }),
            el('button', { text: 'Load', disabled: s.empty, onclick: () => this.app.loadSlot(s.index) }),
            el('button', { class: 'danger', text: '×', title: 'Delete slot', disabled: s.empty, onclick: () => this.app.deleteSlot(s.index) })
          ])
        ]));
      }
    }

    // --- Stats --------------------------------------------------------------------
    updateStats(now) {
      if (now - this.lastStats < 250) return;
      this.lastStats = now;
      const app = this.app, w = app.world;
      const dynamic = w.bodies.filter((b) => !b.isStatic).length;
      const rows = [
        ['FPS', app.fps.toFixed(0)],
        ['Physics', `${w.stats.stepMs.toFixed(2)} ms/step`],
        ['Bodies', `${dynamic} (${w.stats.awake} awake)`],
        ['Contacts', `${w.stats.contacts} pts / ${w.stats.manifolds} pairs`],
        ['Constraints', String(w.constraints.length)],
        ['Particles', String(app.particles.count)],
        ['Kinetic energy', fmtEnergy(w.totalKineticEnergy())],
        ['Sim time', w.time.toFixed(1) + ' s'],
        ['Zoom', app.camera.zoom.toFixed(0) + ' px/m']
      ];
      $('#stats-body').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');

      const b = app.selected;
      const sel = $('#selected-stats');
      if (!b) { sel.innerHTML = '<p class="muted">Tap an object to inspect it.</p>'; return; }
      const sp = b.velocity.length();
      const srows = [
        ['Object', `${b.material.name} ${b.label || b.kind} #${b.id}`],
        ['Mass', fmt(b.mass, 2) + ' kg'],
        ['Velocity', `(${fmt(b.velocity.x)}, ${fmt(b.velocity.y)}) m/s`],
        ['Speed', fmt(sp) + ' m/s'],
        ['Angular vel.', fmt(b.angularVelocity) + ' rad/s'],
        ['Position', `(${fmt(b.position.x)}, ${fmt(b.position.y)})`],
        ['Angle', fmt(((b.angle * 180 / Math.PI) % 360 + 360) % 360, 0) + '°'],
        ['Kinetic energy', fmtEnergy(b.kineticEnergy())],
        ['Friction / bounce', `${fmt(b.friction)} / ${fmt(b.restitution)}`],
        ['State', b.sleeping ? 'sleeping' : 'awake']
      ];
      sel.innerHTML = '<h4>Selected</h4><dl>' + srows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>';
    }

    toast(msg, kind = 'info') {
      const t = $('#toast');
      t.textContent = msg;
      t.className = 'show ' + kind;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { t.className = ''; }, 2200);
    }

    // --- Keyboard -------------------------------------------------------------------
    bindKeyboard() {
      const app = this.app;
      window.addEventListener('keydown', (e) => {
        const t = e.target;
        const tag = t && t.tagName;
        if (tag === 'TEXTAREA' || (tag === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox') || tag === 'SELECT') return;
        const isRange = tag === 'INPUT' && t.type === 'range';
        const k = e.key;

        if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'S')) { e.preventDefault(); app.saveSlot(1); return; }
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        // Arrow keys belong to a focused slider.
        if (isRange && k.startsWith('Arrow')) return;

        let handled = true;
        switch (k) {
          case ' ': case 'Spacebar': app.togglePause(); break;
          case '.': app.stepOnce(); break;
          case 'r': case 'R': app.reset(); break;
          case 'c': case 'C': app.clear(); break;
          case 'f': case 'F': app.fitView(); break;
          case 'h': case 'H': this.setPanelOpen(!this.isPanelOpen()); break;
          case 'g': case 'G': app.world.setGravity(0, -app.world.gravity.y); this.syncSliders(); this.toast('Gravity flipped.'); break;
          case 'q': case 'Q': this.setShape('circle'); break;
          case 'w': case 'W': this.setShape('square'); break;
          case 'e': case 'E': this.setShape('triangle'); break;
          case 'm': case 'M': {
            const keys = Materials.keys();
            const i = keys.indexOf(app.state.material);
            this.setMaterial(keys[(i + (e.shiftKey ? keys.length - 1 : 1)) % keys.length]);
            this.toast('Material: ' + Materials.get(app.state.material).name);
            break;
          }
          case '[': app.state.size = Math.max(0.3, app.state.size - 0.1); this.syncSliders(); break;
          case ']': app.state.size = Math.min(2.5, app.state.size + 0.1); this.syncSliders(); break;
          case '+': case '=': app.camera.zoomBy(1.2); break;
          case '-': case '_': app.camera.zoomBy(1 / 1.2); break;
          case 'ArrowLeft': app.camera.panBy(60, 0); break;
          case 'ArrowRight': app.camera.panBy(-60, 0); break;
          case 'ArrowUp': app.camera.panBy(0, 60); break;
          case 'ArrowDown': app.camera.panBy(0, -60); break;
          case 'Delete': case 'Backspace':
            if (app.selected) {
              const b = app.selected;
              app.particles.poof(b.position.x, b.position.y, b.shape.boundingRadius, b.material.particles.colors[0]);
              app.world.removeBody(b);
            }
            break;
          case 'Escape': app.tools.cancel(); app.select(null); break;
          default: {
            const tool = app.tools.tools.find((tl) => tl.key === k);
            if (tool) app.tools.setTool(tool.id); else handled = false;
          }
        }
        if (handled) {
          e.preventDefault();
          // Keep buttons from re-triggering on Space after a click.
          if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
        }
      });
    }
  }

  App1.UI = UI;
})(window.App1 = window.App1 || {});
