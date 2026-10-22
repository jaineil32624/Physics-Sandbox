/**
 * App1 - main.js
 * ----------------------------------------------------------------------------
 * Application bootstrap + game loop.
 *
 * The loop uses a fixed physics timestep with an accumulator ("fix your
 * timestep"): real elapsed time (scaled by the time-scale slider) is consumed
 * in FIXED_DT chunks, and rendering interpolates between the last two physics
 * states using the leftover fraction. A cap on steps per frame prevents the
 * "spiral of death" when the tab was inactive or the device is slow.
 */
(function (App1) {
  'use strict';
  const { World, Camera, Renderer, ParticleSystem, InputManager, Tools, UI, Presets, Storage } = App1;

  const FIXED_DT = 1 / 60;
  const MAX_STEPS_PER_FRAME = 5;
  const WORLD_HEIGHT = 22;

  class App {
    constructor() {
      this.stage = document.getElementById('stage');
      this.canvas = document.getElementById('sim-canvas');

      this.world = new World();
      this.camera = new Camera();
      this.renderer = new Renderer(this.canvas);
      this.particles = new ParticleSystem();

      /** User-adjustable tool/spawn state (bound to the UI). */
      this.state = {
        shape: 'square',
        material: 'wood',
        size: 1,
        explosionPower: 700,
        explosionRadius: 4,
        springFrequency: 2,
        springDamping: 0.15,
        timeScale: 1
      };
      this.debug = { contacts: false, aabbs: false, sleeping: false };
      this.paused = false;
      this.selected = null;
      this.fps = 60;
      this.accumulator = 0;
      this.lastTime = 0;
      this.time = 0;

      this.tools = new Tools.ToolManager(this);
      this.input = new InputManager(this.canvas, this.camera, this.tools);
      this.world.onBodyRemoved = (b) => this.onBodyRemoved(b);

      this.resize();
      this.ui = new UI(this);
      this.observeResize();
      this.reset(true);

      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    // --- Sizing -------------------------------------------------------------------
    resize() {
      const r = this.stage.getBoundingClientRect();
      const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
      if (w === this.renderer.width && h === this.renderer.height) return;
      this.renderer.resize(w, h);
      this.camera.setViewport(w, h);
    }

    observeResize() {
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => this.resize()).observe(this.stage);
      }
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('orientationchange', () => setTimeout(() => { this.resize(); this.fitView(); }, 250));
    }

    /** World width adapts to the screen aspect ratio (narrower on phones). */
    computeWorldWidth() {
      const aspect = this.camera.viewportW / Math.max(1, this.camera.viewportH);
      return Math.round(Math.min(48, Math.max(14, WORLD_HEIGHT * aspect * 1.05)));
    }

    fitView() {
      const { width, height } = this.world.bounds;
      this.camera.fitRect(-0.6, -1, width + 0.6, height + 1.2, 16);
    }

    // --- Scene management ---------------------------------------------------------
    /** Rebuild the default scene (ground + walls + demo objects). */
    reset(initial = false) {
      this.tools.cancel();
      this.world.clear(false);
      this.particles.clear();
      this.world.time = 0;
      this.world.createBoundaries(this.computeWorldWidth(), WORLD_HEIGHT);
      Presets.build(this.world, 'default', true);
      this.select(null);
      this.fitView();
      this.accumulator = 0;
      if (!initial) this.toast('Scene reset.');
    }

    clear() {
      this.tools.cancel();
      this.world.clear(true);
      this.particles.clear();
      this.select(null);
      this.toast('Cleared all objects.');
    }

    loadPreset(id, keepExisting) {
      this.tools.cancel();
      if (!keepExisting) {
        // Rebuild boundaries too, in case the screen shape changed since the last reset.
        this.world.clear(false);
        this.world.createBoundaries(this.computeWorldWidth(), WORLD_HEIGHT);
        this.particles.clear();
        this.select(null);
      }
      Presets.build(this.world, id, true);
      if (!keepExisting) this.fitView();
      const p = Presets.get(id);
      this.toast(`Loaded preset: ${p ? p.name : id}`);
    }

    select(body) { this.selected = body || null; }

    onBodyRemoved(b) {
      if (this.selected === b) this.selected = null;
      const spring = this.tools.get('spring');
      if (spring && spring.pending && spring.pending.body === b) spring.pending = null;
    }

    // --- Simulation control ---------------------------------------------------------
    setPaused(p) {
      this.paused = p;
      this.accumulator = 0;
      if (this.ui) this.ui.syncPause();
    }
    togglePause() { this.setPaused(!this.paused); }

    /** Advance exactly one physics step (useful while paused). */
    stepOnce() {
      if (!this.paused) this.setPaused(true);
      this.physicsStep(FIXED_DT);
    }

    physicsStep(dt) {
      this.world.step(dt);
      this.handleImpacts();
    }

    /** Turn the world's impact events into particle bursts. */
    handleImpacts() {
      const impacts = this.world.impacts;
      const n = Math.min(impacts.length, 10);
      for (let i = 0; i < n; i++) {
        const im = impacts[i];
        let mat;
        if (im.a.materialKey === 'metal' || im.b.materialKey === 'metal') mat = App1.Materials.get('metal');
        else mat = (im.b.isStatic ? im.a : im.b).material;
        this.particles.impact(im.x, im.y, im.nx, im.ny, im.speed, mat);
        if (im.speed > 18) this.camera.addShake(0.08);
      }
    }

    loop(now) {
      requestAnimationFrame(this.loop);
      if (!this.lastTime) this.lastTime = now;
      const frameDt = Math.min((now - this.lastTime) / 1000, 0.25);
      this.lastTime = now;
      if (frameDt > 0) this.fps = this.fps * 0.92 + (1 / frameDt) * 0.08;

      let alpha = 1;
      if (!this.paused) {
        const scaled = frameDt * this.state.timeScale;
        this.accumulator += scaled;
        let steps = 0;
        while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
          this.physicsStep(FIXED_DT);
          this.accumulator -= FIXED_DT;
          steps++;
        }
        if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // drop backlog
        alpha = this.accumulator / FIXED_DT;
        this.particles.update(scaled, this.world.gravity);
        this.time += scaled;
      }
      this.camera.update(frameDt);
      this.renderer.draw(this, alpha);
      this.ui.updateStats(now);
    }

    // --- Persistence ------------------------------------------------------------------
    snapshot() { return Storage.serialize(this.world, this.camera); }

    applySnapshot(data, label) {
      this.tools.cancel();
      const res = Storage.deserialize(data, this.world, this.camera);
      this.particles.clear();
      this.select(null);
      this.accumulator = 0;
      this.ui.syncSliders();
      this.toast(`${label}: ${res.bodies} bodies, ${res.constraints} constraints` + (res.skipped ? ` (${res.skipped} invalid entries skipped)` : ''));
    }

    saveSlot(i) {
      try {
        Storage.Slots.save(i, this.snapshot());
        this.ui.renderSlots();
        this.toast(`Saved to slot ${i}.`, 'ok');
      } catch (err) {
        this.toast('Save failed: ' + err.message, 'error');
      }
    }

    loadSlot(i) {
      try {
        this.applySnapshot(Storage.Slots.load(i), `Loaded slot ${i}`);
      } catch (err) {
        this.toast('Load failed: ' + err.message, 'error');
      }
    }

    deleteSlot(i) {
      try {
        Storage.Slots.remove(i);
        this.ui.renderSlots();
        this.toast(`Slot ${i} deleted.`);
      } catch (err) {
        this.toast('Delete failed: ' + err.message, 'error');
      }
    }

    exportJSON() {
      try {
        Storage.exportFile(this.snapshot());
        this.toast('Exported simulation JSON.', 'ok');
      } catch (err) {
        this.toast('Export failed: ' + err.message, 'error');
      }
    }

    importJSON(file) {
      Storage.importFile(file)
        .then((data) => this.applySnapshot(data, 'Imported'))
        .catch((err) => this.toast('Import failed: ' + err.message, 'error'));
    }

    toast(msg, kind) { if (this.ui) this.ui.toast(msg, kind); }
  }

  App1.App = App;

  function boot() {
    try {
      App1.app = new App();
    } catch (err) {
      console.error(err);
      const box = document.getElementById('fatal');
      if (box) { box.hidden = false; box.textContent = 'App1 failed to start: ' + err.message; }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.App1 = window.App1 || {});
