/**
 * App1 - camera.js
 * ----------------------------------------------------------------------------
 * 2D camera mapping world meters to screen (CSS) pixels.
 *   screen = (world - center) * zoom + viewport / 2
 * `zoom` is pixels per meter. The renderer multiplies by devicePixelRatio.
 */
(function (App1) {
  'use strict';
  const { Vec2, MathUtil } = App1;

  class Camera {
    constructor() {
      this.x = 20;
      this.y = 11;
      this.zoom = 30;
      this.minZoom = 3;
      this.maxZoom = 300;
      this.viewportW = 800;
      this.viewportH = 600;
      // Small screen-shake offset (meters), decays over time.
      this.shake = 0;
    }

    setViewport(w, h) { this.viewportW = Math.max(1, w); this.viewportH = Math.max(1, h); }

    worldToScreen(p) {
      return new Vec2((p.x - this.x) * this.zoom + this.viewportW / 2, (p.y - this.y) * this.zoom + this.viewportH / 2);
    }

    screenToWorld(sx, sy) {
      return new Vec2((sx - this.viewportW / 2) / this.zoom + this.x, (sy - this.viewportH / 2) / this.zoom + this.y);
    }

    /** Zoom by `factor`, keeping the world point under screen (sx, sy) fixed. */
    zoomAt(sx, sy, factor) {
      const before = this.screenToWorld(sx, sy);
      this.zoom = MathUtil.clamp(this.zoom * factor, this.minZoom, this.maxZoom);
      const after = this.screenToWorld(sx, sy);
      this.x += before.x - after.x;
      this.y += before.y - after.y;
    }

    /** Zoom around the viewport centre. */
    zoomBy(factor) { this.zoomAt(this.viewportW / 2, this.viewportH / 2, factor); }

    /** Pan by a screen-space delta (pixels). */
    panBy(dx, dy) { this.x -= dx / this.zoom; this.y -= dy / this.zoom; }

    /** Fit a world rectangle into the viewport with padding (pixels). */
    fitRect(minX, minY, maxX, maxY, padding = 24) {
      const w = Math.max(maxX - minX, 0.1), h = Math.max(maxY - minY, 0.1);
      const zx = (this.viewportW - padding * 2) / w;
      const zy = (this.viewportH - padding * 2) / h;
      this.zoom = MathUtil.clamp(Math.min(zx, zy), this.minZoom, this.maxZoom);
      this.x = (minX + maxX) / 2;
      this.y = (minY + maxY) / 2;
    }

    /** Visible world rectangle. */
    getVisibleBounds() {
      const a = this.screenToWorld(0, 0), b = this.screenToWorld(this.viewportW, this.viewportH);
      return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
    }

    addShake(amount) { this.shake = Math.min(this.shake + amount, 0.6); }
    update(dt) { this.shake = Math.max(0, this.shake - dt * 1.8); }

    /** Apply world->device transform to a 2D context. */
    apply(ctx, dpr) {
      let sx = 0, sy = 0;
      if (this.shake > 0) {
        sx = (Math.random() - 0.5) * this.shake;
        sy = (Math.random() - 0.5) * this.shake;
      }
      const z = this.zoom * dpr;
      ctx.setTransform(z, 0, 0, z,
        dpr * (this.viewportW / 2) - (this.x + sx) * z,
        dpr * (this.viewportH / 2) - (this.y + sy) * z);
    }

    toJSON() { return { x: this.x, y: this.y, zoom: this.zoom }; }
    fromJSON(d) {
      if (!d) return;
      this.x = MathUtil.num(d.x, this.x);
      this.y = MathUtil.num(d.y, this.y);
      this.zoom = MathUtil.clamp(MathUtil.num(d.zoom, this.zoom), this.minZoom, this.maxZoom);
    }
  }

  App1.Camera = Camera;
})(window.App1 = window.App1 || {});
