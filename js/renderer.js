/**
 * App1 - renderer.js
 * ----------------------------------------------------------------------------
 * Canvas 2D renderer. Everything is drawn in WORLD space (meters) using the
 * camera transform, so line widths are expressed as `px / zoom`.
 *
 * Body transforms are interpolated between the previous and current physics
 * step (alpha in [0,1]) for smooth motion on any refresh rate.
 *
 * Material looks are produced by "painters" keyed by material.style. Add a
 * new look with App1.Renderer.painters.myStyle = (ctx, body, info) => {...}.
 * A painter is called with the context already translated/rotated into the
 * body's local frame and the shape path already built (see buildPath).
 */
(function (App1) {
  'use strict';
  const { MathUtil } = App1;

  /** Build the body's outline path in local coordinates. */
  function buildPath(ctx, shape) {
    ctx.beginPath();
    if (shape.type === 'circle') {
      ctx.arc(0, 0, shape.radius, 0, Math.PI * 2);
    } else {
      const v = shape.vertices;
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      ctx.closePath();
    }
  }

  /** Local-space bounding extent (for textures). */
  function extent(shape) { return shape.boundingRadius; }

  /** Draw a "this circle is rotating" marker line. */
  function circleMarker(ctx, shape, color, px) {
    if (shape.type !== 'circle') return;
    ctx.beginPath();
    ctx.moveTo(shape.radius * 0.25, 0);
    ctx.lineTo(shape.radius * 0.9, 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * px;
    ctx.stroke();
  }

  // ---------------------------------------------------------------------------
  // Material painters
  // ---------------------------------------------------------------------------
  const painters = {
    /** Wood: warm fill + procedural grain lines, clipped to the shape. */
    grain(ctx, body, { px, colors }) {
      const r = extent(body.shape);
      ctx.fillStyle = body.tint || colors.base;
      ctx.fill();
      ctx.save();
      ctx.clip();
      const seed = body.id * 7.13;
      ctx.strokeStyle = body.tint ? 'rgba(0,0,0,0.18)' : colors.dark;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = Math.max(1.2 * px, r * 0.04);
      const lines = 5;
      for (let i = 0; i < lines; i++) {
        const y = -r + ((i + 0.5 + (MathUtil.hash01(seed + i) - 0.5) * 0.6) / lines) * 2 * r;
        const amp = r * 0.08 * (0.5 + MathUtil.hash01(seed + i * 3));
        ctx.beginPath();
        ctx.moveTo(-r, y);
        ctx.bezierCurveTo(-r * 0.3, y + amp, r * 0.3, y - amp, r, y + amp * 0.5);
        ctx.stroke();
      }
      // A knot.
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.ellipse((MathUtil.hash01(seed + 11) - 0.5) * r, (MathUtil.hash01(seed + 13) - 0.5) * r, r * 0.12, r * 0.06, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      buildPath(ctx, body.shape);
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = 2 * px;
      ctx.stroke();
      circleMarker(ctx, body.shape, colors.stroke, px);
    },

    /** Metal: diagonal brushed gradient, specular streak and rivets. */
    brushed(ctx, body, { px, colors }) {
      const r = extent(body.shape);
      const g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, colors.light);
      g.addColorStop(0.35, body.tint || colors.base);
      g.addColorStop(0.6, colors.dark);
      g.addColorStop(1, colors.base);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.save();
      ctx.clip();
      // Brushed lines.
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = px;
      for (let i = -6; i <= 6; i++) {
        const y = (i / 6) * r;
        ctx.beginPath(); ctx.moveTo(-r, y); ctx.lineTo(r, y + r * 0.1); ctx.stroke();
      }
      // Specular streak.
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = r * 0.18;
      ctx.beginPath(); ctx.moveTo(-r, r * 0.2); ctx.lineTo(r * 0.2, -r); ctx.stroke();
      ctx.restore();
      // Rivets.
      ctx.fillStyle = colors.dark;
      const rr = Math.max(r * 0.07, 1.5 * px);
      if (body.shape.type === 'circle') {
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.65, Math.sin(a) * r * 0.65, rr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.beginPath(); ctx.arc(0, 0, rr * 1.6, 0, Math.PI * 2); ctx.fill();
      } else {
        for (const v of body.shape.vertices) {
          ctx.beginPath(); ctx.arc(v.x * 0.72, v.y * 0.72, rr, 0, Math.PI * 2); ctx.fill();
        }
      }
      buildPath(ctx, body.shape);
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = 2 * px;
      ctx.stroke();
      circleMarker(ctx, body.shape, colors.light, px);
    },

    /** Rubber: matte radial gradient, thick dark rim and an inner inset line. */
    matte(ctx, body, { px, colors }) {
      const r = extent(body.shape);
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.1);
      g.addColorStop(0, colors.light);
      g.addColorStop(0.6, body.tint || colors.base);
      g.addColorStop(1, colors.dark);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = Math.max(3 * px, r * 0.1);
      ctx.lineJoin = 'round';
      ctx.stroke();
      // Inner inset outline.
      ctx.save();
      ctx.scale(0.72, 0.72);
      buildPath(ctx, body.shape);
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      circleMarker(ctx, body.shape, 'rgba(0,0,0,0.45)', px);
    },

    /** Ice: translucent fill, frosty rim, highlight streak and a crack. */
    glass(ctx, body, { px, colors }) {
      const r = extent(body.shape);
      ctx.fillStyle = body.tint || colors.base;
      ctx.fill();
      ctx.save();
      ctx.clip();
      const g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(95,180,230,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(-r, -r, 2 * r, 2 * r);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = r * 0.1;
      ctx.beginPath(); ctx.moveTo(-r * 0.7, r * 0.1); ctx.lineTo(-r * 0.1, -r * 0.6); ctx.stroke();
      ctx.lineWidth = r * 0.04;
      ctx.beginPath(); ctx.moveTo(-r * 0.45, r * 0.35); ctx.lineTo(r * 0.05, -r * 0.2); ctx.stroke();
      // Crack.
      const s = body.id * 3.7;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = px;
      ctx.beginPath();
      ctx.moveTo(r * 0.5, r * 0.6);
      ctx.lineTo(r * (0.2 + MathUtil.hash01(s) * 0.2), r * 0.15);
      ctx.lineTo(r * 0.45, -r * (0.1 + MathUtil.hash01(s + 1) * 0.3));
      ctx.stroke();
      ctx.restore();
      buildPath(ctx, body.shape);
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      circleMarker(ctx, body.shape, 'rgba(255,255,255,0.7)', px);
    },

    /** Static ground/walls: dark slab with hatching. */
    static(ctx, body, { px, colors }) {
      ctx.fillStyle = colors.base;
      ctx.fill();
      ctx.save();
      ctx.clip();
      const bb = body.shape.type === 'circle'
        ? { w: body.shape.radius, h: body.shape.radius }
        : body.shape.vertices.reduce((a, v) => ({ w: Math.max(a.w, Math.abs(v.x)), h: Math.max(a.h, Math.abs(v.y)) }), { w: 0, h: 0 });
      ctx.strokeStyle = colors.light;
      ctx.lineWidth = 2 * px;
      const step = 0.5;
      for (let x = -bb.w - bb.h; x < bb.w + bb.h; x += step) {
        ctx.beginPath(); ctx.moveTo(x, -bb.h); ctx.lineTo(x + 2 * bb.h, bb.h); ctx.stroke();
      }
      ctx.restore();
      buildPath(ctx, body.shape);
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    }
  };

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1;
      this.width = 1;
      this.height = 1;
      this.theme = {
        background: '#0f1522',
        gridMinor: 'rgba(255,255,255,0.035)',
        gridMajor: 'rgba(255,255,255,0.08)',
        rod: '#cfd8e6',
        pivot: '#e7edf6',
        selection: '#ffd84d',
        joint: 'rgba(255,255,255,0.75)'
      };
    }

    /** Match the backing store to the element size * devicePixelRatio. */
    resize(cssW, cssH) {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      this.width = cssW;
      this.height = cssH;
      this.canvas.width = Math.max(1, Math.round(cssW * this.dpr));
      this.canvas.height = Math.max(1, Math.round(cssH * this.dpr));
    }

    /** Compute interpolated transforms for all bodies (stored on the body). */
    interpolate(bodies, alpha) {
      for (const b of bodies) {
        if (b.isStatic || b.sleeping) {
          b._rx = b.position.x; b._ry = b.position.y; b._ra = b.angle;
        } else {
          b._rx = b.prevPosition.x + (b.position.x - b.prevPosition.x) * alpha;
          b._ry = b.prevPosition.y + (b.position.y - b.prevPosition.y) * alpha;
          b._ra = b.prevAngle + (b.angle - b.prevAngle) * alpha;
        }
      }
    }

    /** Interpolated world position of a body-local point. */
    renderPoint(body, local) {
      const c = Math.cos(body._ra), s = Math.sin(body._ra);
      return { x: body._rx + c * local.x - s * local.y, y: body._ry + s * local.x + c * local.y };
    }

    /** Interpolated anchor positions of a constraint. */
    constraintPoints(c) {
      const a = this.renderPoint(c.bodyA, c.localA);
      let b;
      if (c.type === 'mouse') b = { x: c.target.x, y: c.target.y };
      else b = c.bodyB ? this.renderPoint(c.bodyB, c.localB) : { x: c.localB.x, y: c.localB.y };
      return { a, b };
    }

    /**
     * Draw a full frame.
     * @param {object} app  { world, camera, particles, tools, selected, debug }
     * @param {number} alpha interpolation factor
     */
    draw(app, alpha) {
      const { ctx, dpr } = this;
      const { world, camera } = app;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = this.theme.background;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      camera.apply(ctx, dpr);
      const px = 1 / camera.zoom;
      this.interpolate(world.bodies, alpha);

      this.drawGrid(camera, px);
      this.drawWindIndicator(world, camera, px, app.time || 0);

      // Bodies: statics first, then dynamic.
      const vis = camera.getVisibleBounds();
      for (const b of world.bodies) if (b.isStatic) this.drawBody(b, px, app, vis);
      for (const b of world.bodies) if (!b.isStatic) this.drawBody(b, px, app, vis);

      for (const c of world.constraints) this.drawConstraint(c, px);

      this.drawParticles(app.particles, px);

      if (app.debug.contacts) this.drawContacts(world, px);
      if (app.debug.aabbs) this.drawAABBs(world, px);

      if (app.tools && app.tools.current && app.tools.current.drawOverlay) {
        app.tools.current.drawOverlay(ctx, px, this);
      }
    }

    drawGrid(camera, px) {
      const ctx = this.ctx;
      const vb = camera.getVisibleBounds();
      const drawLines = (step, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = px;
        ctx.beginPath();
        for (let x = Math.floor(vb.minX / step) * step; x <= vb.maxX; x += step) { ctx.moveTo(x, vb.minY); ctx.lineTo(x, vb.maxY); }
        for (let y = Math.floor(vb.minY / step) * step; y <= vb.maxY; y += step) { ctx.moveTo(vb.minX, y); ctx.lineTo(vb.maxX, y); }
        ctx.stroke();
      };
      if (camera.zoom > 12) drawLines(1, this.theme.gridMinor);
      drawLines(5, this.theme.gridMajor);
    }

    /** Animated streaks showing wind direction/strength. */
    drawWindIndicator(world, camera, px, time) {
      const w = world.wind;
      if (Math.abs(w) < 0.5) return;
      const ctx = this.ctx;
      const vb = camera.getVisibleBounds();
      const W = vb.maxX - vb.minX, H = vb.maxY - vb.minY;
      const n = Math.min(40, Math.floor(Math.abs(w) * 1.5));
      ctx.strokeStyle = 'rgba(180,210,255,0.18)';
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const h1 = MathUtil.hash01(i * 1.7), h2 = MathUtil.hash01(i * 3.1 + 5);
        let x = ((h1 * W + time * w * 1.5) % W + W) % W + vb.minX;
        const y = vb.minY + h2 * H;
        const len = Math.min(Math.abs(w) * 0.12, 3) * Math.sign(w);
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y);
      }
      ctx.stroke();
    }

    drawBody(b, px, app, vis) {
      const bb = b.aabb, m = 1;
      if (bb.maxX < vis.minX - m || bb.minX > vis.maxX + m || bb.maxY < vis.minY - m || bb.minY > vis.maxY + m) return;
      const ctx = this.ctx;
      const mat = b.material;
      ctx.save();
      ctx.translate(b._rx, b._ry);
      ctx.rotate(b._ra);
      buildPath(ctx, b.shape);
      const painter = painters[mat.style] || painters.matte;
      painter(ctx, b, { px, colors: mat.colors });

      if (b.sleeping && app.debug.sleeping) {
        buildPath(ctx, b.shape);
        ctx.fillStyle = 'rgba(20,30,60,0.45)';
        ctx.fill();
      }
      if (app.selected === b) {
        buildPath(ctx, b.shape);
        ctx.strokeStyle = this.theme.selection;
        ctx.lineWidth = 3 * px;
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    drawPivot(x, y, px) {
      const ctx = this.ctx;
      const s = Math.max(0.12, 6 * px);
      ctx.fillStyle = '#3b475e';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - s, y - s * 1.4);
      ctx.lineTo(x + s, y - s * 1.4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = this.theme.pivot;
      ctx.beginPath(); ctx.arc(x, y, s * 0.45, 0, Math.PI * 2); ctx.fill();
    }

    drawConstraint(c, px) {
      if (!c.visible) return;
      const ctx = this.ctx;
      const { a, b } = this.constraintPoints(c);
      switch (c.type) {
        case 'distance': {
          ctx.strokeStyle = this.theme.rod;
          ctx.lineWidth = 2.5 * px;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.fillStyle = this.theme.joint;
          ctx.beginPath(); ctx.arc(a.x, a.y, 3 * px, 0, Math.PI * 2); ctx.fill();
          if (!c.bodyB) this.drawPivot(b.x, b.y, px);
          else { ctx.beginPath(); ctx.arc(b.x, b.y, 3 * px, 0, Math.PI * 2); ctx.fill(); }
          break;
        }
        case 'pin': {
          if (!c.bodyB) {
            ctx.strokeStyle = this.theme.rod;
            ctx.lineWidth = 2 * px;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            this.drawPivot(b.x, b.y, px);
          }
          ctx.fillStyle = this.theme.joint;
          ctx.beginPath(); ctx.arc(a.x, a.y, Math.max(2.5 * px, 0.04), 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'spring': this.drawSpring(c, a, b, px); break;
        case 'mouse': {
          ctx.strokeStyle = 'rgba(255,216,77,0.9)';
          ctx.lineWidth = 2 * px;
          ctx.setLineDash([5 * px, 4 * px]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(255,216,77,0.9)';
          ctx.beginPath(); ctx.arc(a.x, a.y, 4 * px, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(b.x, b.y, 6 * px, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        default: {
          ctx.strokeStyle = '#f0f';
          ctx.lineWidth = 2 * px;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }

    /** Zig-zag coil coloured by strain (green relaxed -> red stretched, blue compressed). */
    drawSpring(c, a, b, px) {
      const ctx = this.ctx;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) return;
      const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
      const coils = 12;
      const width = Math.min(0.18, Math.max(0.08, c.restLength * 0.06));
      const strain = MathUtil.clamp(c.strain, -1, 1);
      let color;
      if (strain >= 0) color = `rgb(${Math.round(90 + 165 * strain)},${Math.round(220 - 140 * strain)},110)`;
      else color = `rgb(90,${Math.round(220 + 20 * strain)},${Math.round(110 - 140 * strain)})`;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * px;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const lead = Math.min(0.15, len * 0.1);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + ux * lead, a.y + uy * lead);
      const body = len - 2 * lead;
      for (let i = 1; i < coils * 2; i++) {
        const t = lead + (i / (coils * 2)) * body;
        const side = i % 2 === 0 ? -1 : 1;
        ctx.lineTo(a.x + ux * t + nx * width * side, a.y + uy * t + ny * width * side);
      }
      ctx.lineTo(b.x - ux * lead, b.y - uy * lead);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(a.x, a.y, 3 * px, 0, Math.PI * 2); ctx.fill();
      if (!c.bodyB) this.drawPivot(b.x, b.y, px);
      else { ctx.beginPath(); ctx.arc(b.x, b.y, 3 * px, 0, Math.PI * 2); ctx.fill(); }
    }

    drawParticles(ps, px) {
      if (!ps || !ps.particles.length) return;
      const ctx = this.ctx;
      ctx.save();
      for (const p of ps.particles) {
        const t = p.life / p.maxLife; // 1 -> 0
        switch (p.kind) {
          case 'spark': {
            ctx.globalAlpha = t;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = Math.max(p.size, 1.5 * px);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
            ctx.stroke();
            break;
          }
          case 'shard': {
            ctx.globalAlpha = t;
            ctx.fillStyle = p.color;
            ctx.save();
            ctx.translate(p.x, p.y); ctx.rotate(p.angle);
            ctx.beginPath(); ctx.moveTo(-p.size, 0); ctx.lineTo(p.size, -p.size * 0.3); ctx.lineTo(p.size * 0.6, p.size * 0.4); ctx.closePath(); ctx.fill();
            ctx.restore();
            break;
          }
          case 'smoke': {
            ctx.globalAlpha = 0.35 * t;
            ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
            break;
          }
          case 'fire': {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.6 * t;
            ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            break;
          }
          case 'ring': {
            ctx.globalAlpha = t * 0.8;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = Math.max(4 * px * t, px);
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.stroke();
            break;
          }
          default: { // debris
            ctx.globalAlpha = Math.min(1, t * 1.5);
            ctx.fillStyle = p.color;
            ctx.save();
            ctx.translate(p.x, p.y); ctx.rotate(p.angle);
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            ctx.restore();
          }
        }
      }
      ctx.restore();
    }

    drawContacts(world, px) {
      const ctx = this.ctx;
      ctx.strokeStyle = '#ff5c7a';
      ctx.fillStyle = '#ff5c7a';
      ctx.lineWidth = 1.5 * px;
      for (const m of world.manifolds) {
        for (const c of m.contacts) {
          ctx.beginPath(); ctx.arc(c.x, c.y, 3 * px, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + m.normal.x * 0.3, c.y + m.normal.y * 0.3); ctx.stroke();
        }
      }
    }

    drawAABBs(world, px) {
      const ctx = this.ctx;
      ctx.lineWidth = px;
      for (const b of world.bodies) {
        ctx.strokeStyle = b.sleeping ? 'rgba(120,160,255,0.5)' : 'rgba(80,255,160,0.5)';
        const bb = b.aabb;
        ctx.strokeRect(bb.minX, bb.minY, bb.maxX - bb.minX, bb.maxY - bb.minY);
      }
    }
  }

  Renderer.painters = painters;
  Renderer.buildPath = buildPath;
  App1.Renderer = Renderer;
})(window.App1 = window.App1 || {});
