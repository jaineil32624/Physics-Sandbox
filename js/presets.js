/**
 * App1 - presets.js
 * ----------------------------------------------------------------------------
 * Demo scene builders. Every preset is { id, name, description, build(world) }
 * and positions itself relative to world.bounds (ground surface at y = height),
 * so presets adapt to the narrower worlds used on portrait/mobile screens.
 *
 * Reusable builders (createRagdoll, createChain, ...) are exported too so other
 * code (or future tools) can spawn them anywhere.
 *
 * To add a preset: push { id, name, description, build(world) } to `list`.
 */
(function (App1) {
  'use strict';
  const { Vec2, Body, Shapes, Constraints } = App1;
  const { DistanceConstraint, PinConstraint, SpringConstraint } = Constraints;

  function addBox(world, x, y, w, h, opts = {}) {
    return world.addBody(new Body(Shapes.box(w, h), Object.assign({ x, y }, opts)));
  }
  function addCircle(world, x, y, r, opts = {}) {
    return world.addBody(new Body(Shapes.circle(r), Object.assign({ x, y }, opts)));
  }

  // ---------------------------------------------------------------------------
  // Reusable builders
  // ---------------------------------------------------------------------------

  /** Pyramid of boxes resting on surfaceY, centred at cx. */
  function createPyramid(world, cx, surfaceY, rows, size, material = 'wood') {
    const gap = 0.01;
    for (let row = 0; row < rows; row++) {
      const count = rows - row;
      const y = surfaceY - size / 2 - row * (size + 0.002) - 0.001;
      const startX = cx - ((count - 1) * (size + gap)) / 2;
      for (let i = 0; i < count; i++) addBox(world, startX + i * (size + gap), y, size, size, { material });
    }
  }

  /** Vertical tower of boxes cycling through materials. */
  function createTower(world, cx, surfaceY, levels, size, materials) {
    for (let i = 0; i < levels; i++) {
      addBox(world, cx, surfaceY - size / 2 - i * (size + 0.002) - 0.001, size, size, { material: materials[i % materials.length] });
    }
  }

  /**
   * Crash-test-dummy ragdoll. (x, y) is the torso centre.
   * Parts share a collision group so overlapping limbs do not fight each other.
   */
  function createRagdoll(world, x, y, opts = {}) {
    const s = opts.scale || 1;
    const group = world.allocateGroup();
    const yellow = opts.tint || '#f2c230', dark = opts.limbTint || '#d9a21c';
    const base = { material: 'wood', group, density: 60 };
    const part = (px, py, w, h, tint, label) => addBox(world, x + px * s, y + py * s, w * s, h * s, Object.assign({ tint, label }, base));

    const torso = part(0, 0, 0.5, 0.9, yellow, 'torso');
    const head = addCircle(world, x, y - 0.72 * s, 0.24 * s, Object.assign({ tint: yellow, label: 'head' }, base));
    const uArmL = part(-0.34, -0.17, 0.17, 0.5, dark, 'upper arm');
    const uArmR = part(0.34, -0.17, 0.17, 0.5, dark, 'upper arm');
    const lArmL = part(-0.34, 0.31, 0.15, 0.48, yellow, 'forearm');
    const lArmR = part(0.34, 0.31, 0.15, 0.48, yellow, 'forearm');
    const thighL = part(-0.13, 0.73, 0.22, 0.56, dark, 'thigh');
    const thighR = part(0.13, 0.73, 0.22, 0.56, dark, 'thigh');
    const shinL = part(-0.13, 1.27, 0.2, 0.54, yellow, 'shin');
    const shinR = part(0.13, 1.27, 0.2, 0.54, yellow, 'shin');

    const joint = (A, B, jx, jy, lower, upper) => {
      const c = PinConstraint.atWorldPoint(A, B, new Vec2(x + jx * s, y + jy * s), { enableLimit: true, lower, upper });
      c.visible = !!opts.showJoints;
      world.addConstraint(c);
      return c;
    };
    joint(torso, head, 0, -0.48, -0.5, 0.5);
    joint(torso, uArmL, -0.34, -0.4, -2.6, 2.6);
    joint(torso, uArmR, 0.34, -0.4, -2.6, 2.6);
    joint(uArmL, lArmL, -0.34, 0.07, -2.3, 0.05);
    joint(uArmR, lArmR, 0.34, 0.07, -0.05, 2.3);
    joint(torso, thighL, -0.13, 0.43, -1.6, 1.0);
    joint(torso, thighR, 0.13, 0.43, -1.6, 1.0);
    joint(thighL, shinL, -0.13, 1.0, -0.05, 2.3);
    joint(thighR, shinR, 0.13, 1.0, -0.05, 2.3);

    const parts = [torso, head, uArmL, uArmR, lArmL, lArmR, thighL, thighR, shinL, shinR];
    if (opts.velocity) for (const p of parts) p.velocity.copy(opts.velocity);
    return parts;
  }

  /**
   * Chain of box links pinned end-to-end through the given points.
   * points: Vec2[] (n+1 joint positions). Ends optionally pinned to the world.
   */
  function createChain(world, points, opts = {}) {
    const group = world.allocateGroup();
    const thickness = opts.thickness || 0.18;
    const material = opts.material || 'metal';
    const links = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const len = a.distance(b);
      const mid = Vec2.lerp(a, b, 0.5);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const link = new Body(Shapes.box(len + thickness * 0.5, thickness), { x: mid.x, y: mid.y, angle, material, group, label: 'link' });
      world.addBody(link);
      links.push(link);
    }
    for (let i = 0; i < links.length - 1; i++) {
      world.addConstraint(PinConstraint.atWorldPoint(links[i], links[i + 1], points[i + 1]));
    }
    if (opts.pinStart) world.addConstraint(PinConstraint.atWorldPoint(links[0], null, points[0]));
    if (opts.pinEnd) world.addConstraint(PinConstraint.atWorldPoint(links[links.length - 1], null, points[points.length - 1]));
    return links;
  }

  /** Simple pendulum: a body hanging from a fixed pivot by a rigid rod. */
  function createPendulum(world, pivot, length, angle, bodyFactory) {
    const pos = new Vec2(pivot.x + Math.sin(angle) * length, pivot.y + Math.cos(angle) * length);
    const bob = bodyFactory(pos);
    world.addConstraint(new DistanceConstraint(bob, new Vec2(0, 0), null, pivot.clone(), length));
    return bob;
  }

  // ---------------------------------------------------------------------------
  // Presets
  // ---------------------------------------------------------------------------
  const list = [
    {
      id: 'pyramid',
      name: 'Pyramid',
      description: 'A wooden pyramid plus a mixed-material tower.',
      build(world) {
        const { width: W, height: H } = world.bounds;
        const rows = W >= 28 ? 10 : 7;
        createPyramid(world, W / 2, H, rows, 0.9, 'wood');
        const tx = W >= 28 ? W * 0.82 : W * 0.88;
        createTower(world, tx, H, W >= 28 ? 9 : 6, 0.8, ['metal', 'ice', 'rubber', 'wood']);
        if (W >= 28) createTower(world, W * 0.18, H, 7, 0.9, ['wood', 'metal']);
      }
    },
    {
      id: 'pendulum',
      name: 'Pendulums',
      description: "Newton's cradle, a double pendulum and a box pendulum.",
      build(world) {
        const { width: W, height: H } = world.bounds;
        const cx = W / 2;
        // Newton's cradle: near-elastic, frictionless metal balls.
        const r = 0.45, L = 5, n = 5, pivotY = H - 10;
        const startX = cx - ((n - 1) * 2 * r) / 2;
        for (let i = 0; i < n; i++) {
          const pivot = new Vec2(startX + i * (2 * r + 0.002), pivotY);
          const angle = i === 0 ? -0.9 : 0;
          createPendulum(world, pivot, L, angle, (p) => addCircle(world, p.x, p.y, r, { material: 'metal', restitution: 0.98, friction: 0, linearDamping: 0, angularDamping: 0, canSleep: false }));
        }
        // Double pendulum.
        const dx = W >= 26 ? W * 0.17 : cx;
        const dy = W >= 26 ? H - 15 : H - 19;
        const pivot = new Vec2(dx, dy);
        const b1 = addCircle(world, dx + 2.2, dy, 0.3, { material: 'rubber', linearDamping: 0, angularDamping: 0 });
        const b2 = addCircle(world, dx + 4.2, dy, 0.3, { material: 'rubber', linearDamping: 0, angularDamping: 0 });
        world.addConstraint(new DistanceConstraint(b1, new Vec2(0, 0), null, pivot, 2.2));
        world.addConstraint(new DistanceConstraint(b1, new Vec2(0, 0), b2, new Vec2(0, 0), 2.0));
        // Box pendulum swinging from its corner.
        if (W >= 26) {
          const p2 = new Vec2(W * 0.83, H - 14);
          const box = addBox(world, W * 0.83 + 3, H - 14 + 1, 1.2, 1.2, { material: 'wood' });
          world.addConstraint(new DistanceConstraint(box, new Vec2(-0.6, -0.6), null, p2));
        }
      }
    },
    {
      id: 'chain',
      name: 'Chains',
      description: 'A sagging rope bridge and a swinging wrecking ball.',
      build(world) {
        const { width: W, height: H } = world.bounds;
        const cx = W / 2;
        const span = Math.min(W * 0.6, 16);
        const deckY = H - 4;
        const left = new Vec2(cx - span / 2, deckY), right = new Vec2(cx + span / 2, deckY);
        // Posts.
        addBox(world, left.x - 0.6, deckY + 2, 0.8, 4, { isStatic: true, material: 'static', label: 'post' });
        addBox(world, right.x + 0.6, deckY + 2, 0.8, 4, { isStatic: true, material: 'static', label: 'post' });
        // Bridge links along a parabola for natural sag.
        const n = 16, sag = 1.0, pts = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          pts.push(new Vec2(left.x + span * t, deckY + 4 * sag * t * (1 - t)));
        }
        createChain(world, pts, { material: 'wood', thickness: 0.22, pinStart: true, pinEnd: true });
        // Crates on the bridge.
        createTower(world, cx, deckY + sag - 0.12, 3, 0.7, ['wood', 'ice', 'wood']);
        // Wrecking ball on a metal chain, released from the side.
        const anchor = new Vec2(cx, H - 12.5);
        const links = 14, linkLen = 0.5, angle = W >= 26 ? -1.1 : -0.7;
        const cpts = [];
        for (let i = 0; i <= links; i++) cpts.push(new Vec2(anchor.x + Math.sin(angle) * linkLen * i, anchor.y + Math.cos(angle) * linkLen * i));
        const chain = createChain(world, cpts, { material: 'metal', thickness: 0.12, pinStart: true });
        const end = cpts[cpts.length - 1];
        const ballR = 0.65;
        const bc = new Vec2(end.x + Math.sin(angle) * ballR, end.y + Math.cos(angle) * ballR);
        const ball = addCircle(world, bc.x, bc.y, ballR, { material: 'metal', group: chain[0].group });
        world.addConstraint(PinConstraint.atWorldPoint(chain[chain.length - 1], ball, end));
      }
    },
    {
      id: 'ragdoll',
      name: 'Ragdoll',
      description: 'A crash-test dummy tumbling down a staircase.',
      build(world) {
        const { width: W, height: H } = world.bounds;
        const steps = 6, stepW = Math.min(1.5, (W * 0.7) / steps), stepH = 0.75;
        const x0 = W / 2 - (steps * stepW) / 2;
        for (let i = 0; i < steps; i++) {
          const h = (steps - i) * stepH;
          addBox(world, x0 + i * stepW + stepW / 2, H - h / 2, stepW, h, { isStatic: true, material: 'static', label: 'stairs' });
        }
        const topY = H - steps * stepH;
        createRagdoll(world, x0 + stepW * 0.5, topY - 1.75, { velocity: new Vec2(2.5, 0) });
        // A second dummy dropped from the sky, if there is room.
        if (W >= 26) createRagdoll(world, W * 0.8, H - 12);
        // Something to land on.
        createTower(world, Math.min(W - 1.5, x0 + steps * stepW + 2), H, 3, 0.8, ['rubber', 'wood', 'ice']);
      }
    },
    {
      id: 'springs',
      name: 'Springs',
      description: 'A spring-suspended platform, a bouncing dumbbell and a spring chain.',
      build(world) {
        const { width: W, height: H } = world.bounds;
        const cx = W / 2;
        // Platform hanging on two springs.
        const plank = addBox(world, cx, H - 7, 4.5, 0.3, { material: 'wood' });
        world.addConstraint(new SpringConstraint(plank, new Vec2(-2, 0), null, new Vec2(cx - 2.6, H - 13), { frequency: 1.6, dampingRatio: 0.1, restLength: 5.8 }));
        world.addConstraint(new SpringConstraint(plank, new Vec2(2, 0), null, new Vec2(cx + 2.6, H - 13), { frequency: 1.6, dampingRatio: 0.1, restLength: 5.8 }));
        for (let i = 0; i < 3; i++) addBox(world, cx - 1 + i, H - 9 - i * 1.2, 0.7, 0.7, { material: ['metal', 'rubber', 'ice'][i] });
        // Dumbbell: two rubber balls joined by a spring, thrown sideways.
        const a = addCircle(world, cx - 4, H - 3, 0.4, { material: 'rubber', vx: 6, vy: -6 });
        const b = addCircle(world, cx - 2.5, H - 3, 0.4, { material: 'rubber', vx: 6, vy: -4 });
        world.addConstraint(new SpringConstraint(a, new Vec2(0, 0), b, new Vec2(0, 0), { frequency: 3, dampingRatio: 0.05 }));
        // Spring chain hanging from an anchor.
        if (W >= 26) {
          let prev = null;
          const ax = W * 0.18;
          for (let i = 0; i < 4; i++) {
            const box = addBox(world, ax, H - 18 + i * 1.6, 0.6, 0.6, { material: i % 2 ? 'metal' : 'wood' });
            world.addConstraint(prev
              ? new SpringConstraint(prev, new Vec2(0, 0.3), box, new Vec2(0, -0.3), { frequency: 2.5, dampingRatio: 0.08, restLength: 1.0 })
              : new SpringConstraint(box, new Vec2(0, -0.3), null, new Vec2(ax, H - 20), { frequency: 2.5, dampingRatio: 0.08, restLength: 1.0 }));
            prev = box;
          }
          prev.velocity.set(5, 0);
        }
      }
    }
  ];

  /** Default scene shown on start / reset. */
  function buildDefault(world) {
    const { width: W, height: H } = world.bounds;
    const wide = W >= 28;
    createPyramid(world, W / 2, H, wide ? 7 : 5, 0.9, 'wood');
    const mats = ['wood', 'metal', 'rubber', 'ice'];
    const count = wide ? 8 : 4;
    for (let i = 0; i < count; i++) {
      const x = W * (0.15 + 0.7 * (i / Math.max(1, count - 1)));
      const m = mats[i % 4];
      if (i % 2) addCircle(world, x, H - 12 - (i % 3), 0.45, { material: m });
      else world.addBody(new Body(Shapes.triangle(1.0), { x, y: H - 13 - (i % 3), material: m, angle: 0.3 }));
    }
  }

  const Presets = {
    list,
    get(id) { return list.find((p) => p.id === id) || null; },
    /**
     * Build a preset. Unless keepExisting is true the scene is cleared first
     * (ground and walls are kept).
     */
    build(world, id, keepExisting = false) {
      const preset = id === 'default' ? { build: buildDefault } : Presets.get(id);
      if (!preset) return false;
      if (!keepExisting) world.clear(true);
      preset.build(world);
      return true;
    },
    createPyramid, createTower, createRagdoll, createChain, createPendulum
  };

  App1.Presets = Presets;
})(window.App1 = window.App1 || {});
