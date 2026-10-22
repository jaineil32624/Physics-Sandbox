/**
 * App1 - input.js
 * ----------------------------------------------------------------------------
 * Unified mouse / touch / pen input via Pointer Events.
 *
 *   - 1 pointer, primary button  -> forwarded to the active tool (down/move/up)
 *                                   in WORLD coordinates. A tool may return
 *                                   'pan' from onDown to turn the gesture into
 *                                   a camera pan (e.g. drag tool on empty space).
 *   - middle / right button      -> camera pan
 *   - 2 pointers (touch)         -> pinch-zoom + two-finger pan (cancels tool)
 *   - mouse wheel                -> zoom around the cursor
 *   - hover (mouse)              -> tool.onHover for previews
 */
(function (App1) {
  'use strict';

  class InputManager {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Camera} camera
     * @param {object} handlers { down(p, e) -> 'pan'|void, move(p, e), up(p, e), cancel(), hover(p) }
     */
    constructor(canvas, camera, handlers) {
      this.canvas = canvas;
      this.camera = camera;
      this.handlers = handlers;
      this.pointers = new Map();     // pointerId -> {x, y} (CSS px, canvas-relative)
      this.mode = 'none';            // none | tool | pan | pinch
      this.pinch = null;
      this.lastWorld = null;         // last hovered world point (for keyboard tools)
      this.bind();
    }

    /** Canvas-relative CSS pixel position of an event. */
    local(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    world(pt) { return this.camera.screenToWorld(pt.x, pt.y); }

    bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => this.onDown(e));
      c.addEventListener('pointermove', (e) => this.onMove(e));
      c.addEventListener('pointerup', (e) => this.onUp(e, false));
      c.addEventListener('pointercancel', (e) => this.onUp(e, true));
      c.addEventListener('lostpointercapture', (e) => { if (this.pointers.has(e.pointerId)) this.onUp(e, true); });
      c.addEventListener('pointerleave', () => { if (this.handlers.hover && this.mode === 'none') this.handlers.hover(null); });
      c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      c.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    onDown(e) {
      e.preventDefault();
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      const pt = this.local(e);
      this.pointers.set(e.pointerId, pt);

      if (this.pointers.size === 2) {
        // Second finger: abort any tool gesture and start pinch.
        if (this.mode === 'tool' && this.handlers.cancel) this.handlers.cancel();
        this.startPinch();
        return;
      }
      if (this.pointers.size > 2) return;

      if (e.button === 1 || e.button === 2) {
        this.mode = 'pan';
        return;
      }
      const res = this.handlers.down(this.world(pt), e);
      this.mode = res === 'pan' ? 'pan' : 'tool';
    }

    onMove(e) {
      const pt = this.local(e);
      const prev = this.pointers.get(e.pointerId);
      this.lastWorld = this.world(pt);

      if (!prev) {
        // Hover (mouse without buttons pressed).
        if (this.handlers.hover) this.handlers.hover(this.lastWorld);
        return;
      }
      this.pointers.set(e.pointerId, pt);

      if (this.mode === 'pinch') { this.updatePinch(); return; }
      if (this.mode === 'pan') { this.camera.panBy(pt.x - prev.x, pt.y - prev.y); return; }
      if (this.mode === 'tool') this.handlers.move(this.lastWorld, e);
    }

    onUp(e, cancelled) {
      if (!this.pointers.has(e.pointerId)) return;
      const pt = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);

      if (this.mode === 'pinch') {
        // One finger left: continue as a pan so the gesture feels natural.
        this.mode = this.pointers.size === 1 ? 'pan' : (this.pointers.size === 0 ? 'none' : 'pinch');
        if (this.mode === 'pinch') this.startPinch();
        return;
      }
      if (this.mode === 'tool') {
        if (cancelled && this.handlers.cancel) this.handlers.cancel();
        else this.handlers.up(this.world(this.local(e) || pt), e);
      }
      if (this.pointers.size === 0) this.mode = 'none';
    }

    startPinch() {
      const [p1, p2] = [...this.pointers.values()];
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      this.pinch = {
        startDist: Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y)),
        startZoom: this.camera.zoom,
        anchor: this.camera.screenToWorld(mid.x, mid.y) // world point under the fingers
      };
      this.mode = 'pinch';
    }

    updatePinch() {
      const pts = [...this.pointers.values()];
      if (pts.length < 2 || !this.pinch) return;
      const [p1, p2] = pts;
      const dist = Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const cam = this.camera;
      cam.zoom = Math.min(cam.maxZoom, Math.max(cam.minZoom, this.pinch.startZoom * dist / this.pinch.startDist));
      // Keep the anchor world point under the fingers' midpoint (zoom + pan).
      cam.x = this.pinch.anchor.x - (mid.x - cam.viewportW / 2) / cam.zoom;
      cam.y = this.pinch.anchor.y - (mid.y - cam.viewportH / 2) / cam.zoom;
    }

    onWheel(e) {
      e.preventDefault();
      const pt = this.local(e);
      // deltaMode 1 = lines; normalise to pixels.
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.camera.zoomAt(pt.x, pt.y, Math.exp(-dy * 0.0015));
    }
  }

  App1.InputManager = InputManager;
})(window.App1 = window.App1 || {});
