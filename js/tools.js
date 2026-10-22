/**
 * App1 - tools.js
 * ----------------------------------------------------------------------------
 * Interaction tools. Each tool receives pointer events in WORLD coordinates
 * from InputManager (via ToolManager) and may draw a preview overlay.
 *
 * Tool interface:
 *   id, name, key (shortcut), hint
 *   activate() / deactivate()
 *   onDown(p, e) -> 'pan' | undefined   (returning 'pan' turns the gesture into a camera pan)
 *   onMove(p, e) / onUp(p, e) / onCancel() / onHover(p)
 *   drawOverlay(ctx, px, renderer)      (world space; px = one screen pixel in meters)
 *
 * To add a tool: subclass Tool and push an instance in ToolManager's constructor.
 */
(function (App1) {
  'use strict';
  const { Vec2, Body, Shapes, Constraints } = App1;

  class Tool {
    constructor(app, id, name, key, hint) {
      this.app = app;
      this.id = id;
      this.name = name;
      this.key = key;
      this.hint = hint;
      this.hover = null;
    }
    activate() {}
    deactivate() { this.onCancel(); }
    onDown() {}
    onMove() {}
    onUp() {}
    onCancel() {}
    onHover(p) { this.hover = p; }
    drawOverlay() {}
  }

  /** Shared mouse-joint drag behaviour used by several tools. */
  class Dragger {
    constructor(app) { this.app = app; this.joint = null; }
    get active() { return !!this.joint; }
    start(body, p) {
      this.end();
      body.wake();
      this.joint = new Constraints.MouseConstraint(body, p, { frequency: 5, dampingRatio: 0.85 });
      this.app.world.addConstraint(this.joint);
      this.app.select(body);
    }
    move(p) { if (this.joint) this.joint.setTarget(p); }
    end() {
      if (this.joint) {
        this.app.world.removeConstraint(this.joint);
        this.joint = null;
      }
    }
  }

  // ---------------------------------------------------------------------------
  class SpawnTool extends Tool {
    constructor(app) {
      super(app, 'spawn', 'Spawn', '1', 'Tap empty space to spawn (drag to paint). Tap an object to drag it.');
      this.dragger = new Dragger(app);
      this.painting = false;
      this.lastSpawn = null;
    }

    spawnAt(p) {
      const app = this.app, st = app.state;
      // Do not spawn inside static geometry.
      const hit = app.world.queryPoint(p, true);
      if (hit && hit.isStatic) return null;
      const shape = Shapes.fromKind(st.shape, st.size);
      const body = new Body(shape, { x: p.x, y: p.y, material: st.material });
      app.world.addBody(body);
      app.select(body);
      this.lastSpawn = p.clone();
      return body;
    }

    onDown(p) {
      const body = this.app.world.queryPoint(p);
      if (body) { this.dragger.start(body, p); return undefined; }
      this.painting = true;
      this.spawnAt(p);
      return undefined;
    }

    onMove(p) {
      this.hover = p;
      if (this.dragger.active) { this.dragger.move(p); return; }
      if (this.painting && this.lastSpawn && p.distance(this.lastSpawn) > this.app.state.size * 1.15) this.spawnAt(p);
    }

    onUp() { this.painting = false; this.dragger.end(); }
    onCancel() { this.painting = false; this.dragger.end(); }

    drawOverlay(ctx, px) {
      if (!this.hover || this.dragger.active || this.painting) return;
      const st = this.app.state;
      const shape = Shapes.fromKind(st.shape, st.size);
      ctx.save();
      ctx.translate(this.hover.x, this.hover.y);
      App1.Renderer.buildPath(ctx, shape);
      ctx.setLineDash([4 * px, 4 * px]);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------
  class DragTool extends Tool {
    constructor(app) {
      super(app, 'drag', 'Drag', '2', 'Drag objects (throw them!). Drag empty space to pan.');
      this.dragger = new Dragger(app);
    }
    onDown(p) {
      const body = this.app.world.queryPoint(p);
      if (!body) { this.app.select(null); return 'pan'; }
      this.dragger.start(body, p);
      return undefined;
    }
    onMove(p) { this.hover = p; this.dragger.move(p); }
    onUp() { this.dragger.end(); }
    onCancel() { this.dragger.end(); }
  }

  // ---------------------------------------------------------------------------
  class ExplodeTool extends Tool {
    constructor(app) {
      super(app, 'explode', 'Explode', '3', 'Tap to detonate a radial blast.');
    }
    onDown(p) {
      const app = this.app, st = app.state;
      app.world.explode(p, st.explosionRadius, st.explosionPower);
      app.particles.explosion(p.x, p.y, st.explosionRadius);
      app.camera.addShake(0.25 + st.explosionPower / 6000);
      this.hover = p;
      return undefined;
    }
    drawOverlay(ctx, px) {
      if (!this.hover) return;
      ctx.strokeStyle = 'rgba(255,140,60,0.6)';
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([6 * px, 5 * px]);
      ctx.beginPath(); ctx.arc(this.hover.x, this.hover.y, this.app.state.explosionRadius, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,140,60,0.8)';
      ctx.beginPath(); ctx.arc(this.hover.x, this.hover.y, 4 * px, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------------------------------------------------------------------------
  class SpringTool extends Tool {
    constructor(app) {
      super(app, 'spring', 'Spring', '4', 'Tap an object, then tap another object or the background/ground to anchor a spring.');
      this.pending = null; // { body|null, local }
    }

    pick(p) {
      const hit = this.app.world.queryPoint(p, true);
      if (hit && !hit.isStatic) return { body: hit, local: hit.worldToLocal(p) };
      return { body: null, local: p.clone() }; // world anchor
    }

    pendingWorld() {
      const pd = this.pending;
      return pd.body ? pd.body.localToWorld(pd.local) : pd.local;
    }

    onDown(p) {
      const pick = this.pick(p);
      if (!this.pending) {
        this.pending = pick;
        if (pick.body) this.app.select(pick.body);
        return undefined;
      }
      let a = this.pending, b = pick;
      this.pending = null;
      if (!a.body && !b.body) { this.app.toast('A spring needs at least one object.'); return undefined; }
      if (a.body && a.body === b.body) { this.app.toast('Pick two different objects.'); return undefined; }
      if (!a.body) { const t = a; a = b; b = t; }
      const spring = new Constraints.SpringConstraint(a.body, a.local, b.body, b.local, {
        frequency: this.app.state.springFrequency,
        dampingRatio: this.app.state.springDamping
      });
      this.app.world.addConstraint(spring);
      this.app.toast('Spring created.');
      return undefined;
    }

    onCancel() { this.pending = null; }

    drawOverlay(ctx, px) {
      if (!this.pending) return;
      const a = this.pendingWorld();
      ctx.fillStyle = '#7dffb0';
      ctx.beginPath(); ctx.arc(a.x, a.y, 5 * px, 0, Math.PI * 2); ctx.fill();
      if (this.hover) {
        ctx.strokeStyle = 'rgba(125,255,176,0.7)';
        ctx.lineWidth = 2 * px;
        ctx.setLineDash([5 * px, 4 * px]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(this.hover.x, this.hover.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // ---------------------------------------------------------------------------
  class DeleteTool extends Tool {
    constructor(app) {
      super(app, 'delete', 'Delete', '5', 'Tap an object, spring or rod to delete it.');
    }
    onDown(p) {
      const app = this.app;
      const body = app.world.queryPoint(p);
      if (body) {
        app.particles.poof(body.position.x, body.position.y, body.shape.boundingRadius, body.material.particles.colors[0]);
        app.world.removeBody(body);
        return undefined;
      }
      const c = app.world.findConstraintNear(p, 12 / app.camera.zoom);
      if (c) app.world.removeConstraint(c);
      return undefined;
    }
    drawOverlay(ctx, px) {
      if (!this.hover) return;
      const body = this.app.world.queryPoint(this.hover);
      if (!body) return;
      ctx.save();
      ctx.translate(body._rx, body._ry);
      ctx.rotate(body._ra);
      App1.Renderer.buildPath(ctx, body.shape);
      ctx.fillStyle = 'rgba(255,60,80,0.35)';
      ctx.fill();
      ctx.strokeStyle = '#ff3c50';
      ctx.lineWidth = 2 * px;
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------
  class ToolManager {
    constructor(app) {
      this.app = app;
      this.tools = [new SpawnTool(app), new DragTool(app), new ExplodeTool(app), new SpringTool(app), new DeleteTool(app)];
      this.current = this.tools[0];
      this.onChange = null;
    }

    get(id) { return this.tools.find((t) => t.id === id) || null; }

    setTool(id) {
      const t = this.get(id);
      if (!t || t === this.current) return;
      this.current.deactivate();
      this.current = t;
      t.activate();
      if (this.onChange) this.onChange(t);
    }

    // Input handler adapters.
    down(p, e) { return this.current.onDown(p, e); }
    move(p, e) { this.current.hover = p; this.current.onMove(p, e); }
    up(p, e) { this.current.onUp(p, e); }
    cancel() { this.current.onCancel(); }
    hover(p) { this.current.onHover(p); }
  }

  App1.Tools = { Tool, Dragger, SpawnTool, DragTool, ExplodeTool, SpringTool, DeleteTool, ToolManager };
})(window.App1 = window.App1 || {});
