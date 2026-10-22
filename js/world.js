/**
 * App1 - world.js
 * ----------------------------------------------------------------------------
 * The World owns bodies + constraints and advances the simulation with a
 * FIXED timestep (the caller, main.js, accumulates real time).
 *
 * Step pipeline:
 *   1. snapshot previous transforms (render interpolation), refresh geometry
 *   2. propagate "awake" state through constraints
 *   3. broadphase (spatial hash) + narrowphase -> contact manifolds,
 *      waking sleeping bodies that are hit, warm-start matching
 *   4. external forces: springs, wind, gravity -> integrate velocities
 *   5. preStep contacts/joints, then N velocity iterations (sequential impulse)
 *   6. integrate positions, positional correction of contacts
 *   7. sleep bookkeeping, cull bodies that fell out of the world
 */
(function (App1) {
  'use strict';
  const { Vec2, Collision, Body, Shapes } = App1;

  const DEFAULT_SETTINGS = {
    iterations: 10,              // velocity iterations per step
    warmStarting: true,
    sleeping: true,
    slop: 0.01,                  // allowed penetration (m)
    correctionPercent: 0.4,      // fraction of penetration removed per step
    restitutionThreshold: 1.0,   // m/s; slower impacts do not bounce
    jointBeta: 0.2,              // fraction of joint error removed per position pass
    positionIterations: 4,       // joint position-correction passes per step
    maxJointCorrection: 0.2,     // m; per-pass cap so violent errors stay stable
    sleepLinear: 0.06,           // m/s
    sleepAngular: 0.06,          // rad/s
    timeToSleep: 0.5,            // s of stillness before sleeping
    impactThreshold: 4.5,        // m/s normal speed that triggers impact events
    windCoefficient: 0.9,        // quadratic drag factor (N per (m/s)^2 per m)
    killDistance: 60             // bodies farther than this outside bounds are removed
  };

  class World {
    constructor() {
      this.bodies = [];
      this.constraints = [];
      this.manifolds = [];
      this.contactCache = new Map();
      this.hash = new Collision.SpatialHash(2);
      this.gravity = new Vec2(0, 9.81);
      this.wind = 0;               // horizontal wind speed (m/s), +right
      this.settings = Object.assign({}, DEFAULT_SETTINGS);
      this.bounds = { width: 40, height: 22 };
      this.time = 0;
      this.stepCount = 0;
      this.nextGroup = 1;
      /** Impact events emitted by the last step: {x, y, nx, ny, speed, a, b} */
      this.impacts = [];
      this.stats = { contacts: 0, manifolds: 0, awake: 0, stepMs: 0, pairs: 0 };
      /** Listeners for body removal (tools clear selection etc.). */
      this.onBodyRemoved = null;
    }

    // --- Membership -------------------------------------------------------------
    addBody(body) { this.bodies.push(body); return body; }

    /** Allocate a collision group id (bodies in the same group never collide). */
    allocateGroup() { return this.nextGroup++; }

    removeBody(body) {
      const i = this.bodies.indexOf(body);
      if (i < 0) return false;
      this.bodies.splice(i, 1);
      this.constraints = this.constraints.filter((c) => !c.involves(body));
      this.wakeRegion(body.aabb, 0.6);
      for (const [k, m] of this.contactCache) if (m.a === body || m.b === body) this.contactCache.delete(k);
      this.manifolds = this.manifolds.filter((m) => m.a !== body && m.b !== body);
      if (this.onBodyRemoved) this.onBodyRemoved(body);
      return true;
    }

    addConstraint(c) {
      this.constraints.push(c);
      if (c.bodyA) c.bodyA.wake();
      if (c.bodyB) c.bodyB.wake();
      return c;
    }

    removeConstraint(c) {
      const i = this.constraints.indexOf(c);
      if (i < 0) return false;
      this.constraints.splice(i, 1);
      if (c.bodyA) c.bodyA.wake();
      if (c.bodyB) c.bodyB.wake();
      return true;
    }

    /** True for the ground/walls created by createBoundaries(). */
    static isBoundary(b) { return b.isStatic && (b.label === 'ground' || b.label === 'wall'); }

    /** Remove everything, or everything except the ground/walls when keepBoundaries is true. */
    clear(keepBoundaries = false) {
      if (keepBoundaries) {
        const removed = new Set(this.bodies.filter((b) => !World.isBoundary(b)));
        this.bodies = this.bodies.filter((b) => World.isBoundary(b));
        this.constraints = this.constraints.filter((c) => !removed.has(c.bodyA) && !removed.has(c.bodyB));
        if (this.onBodyRemoved) removed.forEach((b) => this.onBodyRemoved(b));
      } else {
        if (this.onBodyRemoved) this.bodies.forEach((b) => this.onBodyRemoved(b));
        this.bodies = [];
        this.constraints = [];
        this.nextGroup = 1;
        Body.resetIds(1);
      }
      this.manifolds = [];
      this.contactCache.clear();
      this.impacts = [];
    }

    /** Create ground, side walls (and nothing above, so things can be thrown). */
    createBoundaries(width, height) {
      this.bounds = { width, height };
      const t = 1; // wall thickness
      const ground = new Body(Shapes.box(width + 2 * t, t), { x: width / 2, y: height + t / 2, isStatic: true, material: 'static', label: 'ground' });
      const wallH = height * 2;
      const left = new Body(Shapes.box(t, wallH), { x: -t / 2, y: height - wallH / 2, isStatic: true, material: 'static', label: 'wall' });
      const right = new Body(Shapes.box(t, wallH), { x: width + t / 2, y: height - wallH / 2, isStatic: true, material: 'static', label: 'wall' });
      this.addBody(ground); this.addBody(left); this.addBody(right);
    }

    // --- Sleeping helpers -------------------------------------------------------
    wakeAll() { for (const b of this.bodies) b.wake(); }

    wakeRegion(bb, margin = 0) {
      for (const b of this.bodies) {
        if (b.isStatic || !b.sleeping) continue;
        const o = b.aabb;
        if (o.minX <= bb.maxX + margin && o.maxX >= bb.minX - margin && o.minY <= bb.maxY + margin && o.maxY >= bb.minY - margin) b.wake();
      }
    }

    setGravity(x, y) { this.gravity.set(x, y); this.wakeAll(); }
    setWind(speed) { this.wind = speed; this.wakeAll(); }

    // --- Simulation -------------------------------------------------------------
    step(dt) {
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const s = this.settings;
      const invDt = 1 / dt;
      const bodies = this.bodies;
      this.impacts = [];

      // 1. Snapshot + refresh geometry.
      for (const b of bodies) {
        b.prevPosition.x = b.position.x; b.prevPosition.y = b.position.y;
        b.prevAngle = b.angle;
        b.updateWorldShape();
      }

      // 2. Constraints keep their bodies awake together; collect non-colliding pairs.
      const noCollide = new Set();
      for (const c of this.constraints) {
        const A = c.bodyA, B = c.bodyB;
        if ((A && A.isAwakeDynamic) || (B && B.isAwakeDynamic) || c.type === 'mouse') {
          if (A) A.wake();
          if (B) B.wake();
        }
        if (!c.collideConnected && A && B) noCollide.add(Collision.pairKey(A, B));
      }

      // 3. Collision detection.
      this.detectCollisions(noCollide);

      // 4. Forces + velocity integration.
      for (const c of this.constraints) if (c.isActive()) c.applyForces(dt);
      const gx = this.gravity.x, gy = this.gravity.y;
      const wind = this.wind, windK = s.windCoefficient;
      for (const b of bodies) {
        if (!b.isAwakeDynamic) continue;
        if (wind !== 0) {
          // Quadratic drag towards the wind velocity, scaled by the body's
          // vertical cross-section (its AABB height).
          const rel = wind - b.velocity.x;
          const area = b.aabb.maxY - b.aabb.minY;
          b.force.x += windK * rel * Math.abs(rel) * area;
          // A little lift/turbulence torque so things tumble in strong wind.
          b.torque += windK * rel * Math.abs(rel) * area * 0.02 * Math.sin(this.time * 3 + b.id);
        }
        b.velocity.x += (gx + b.force.x * b.invMass) * dt;
        b.velocity.y += (gy + b.force.y * b.invMass) * dt;
        b.angularVelocity += b.torque * b.invInertia * dt;
        // Mild damping (implicit form, unconditionally stable).
        b.velocity.scaleSelf(1 / (1 + dt * b.linearDamping));
        b.angularVelocity *= 1 / (1 + dt * b.angularDamping);
      }

      // 5. Solve velocity constraints.
      const manifolds = this.manifolds;
      const active = this.constraints.filter((c) => c.isActive());
      for (const m of manifolds) m.preStep(s, dt);
      for (const c of active) c.preStep(invDt, s);
      if (s.warmStarting) for (const m of manifolds) m.warmStart();
      for (let it = 0; it < s.iterations; it++) {
        for (const c of active) c.solveVelocity();
        for (const m of manifolds) m.solveVelocity();
      }

      // Impact events: brand-new contacts that hit hard.
      for (const m of manifolds) {
        for (const c of m.contacts) {
          if (!c.persisted && -c.vn0 > s.impactThreshold) {
            this.impacts.push({ x: c.x, y: c.y, nx: m.normal.x, ny: m.normal.y, speed: -c.vn0, a: m.a, b: m.b });
            break;
          }
        }
      }

      // 6. Integrate positions, then remove residual penetration.
      for (const b of bodies) {
        if (!b.isAwakeDynamic) continue;
        // Clamp absurd speeds so a bad configuration cannot tunnel to infinity.
        const v2 = b.velocity.lengthSq();
        if (v2 > 10000) b.velocity.scaleSelf(100 / Math.sqrt(v2));
        if (b.angularVelocity > 80) b.angularVelocity = 80; else if (b.angularVelocity < -80) b.angularVelocity = -80;
        b.position.x += b.velocity.x * dt;
        b.position.y += b.velocity.y * dt;
        b.angle += b.angularVelocity * dt;
      }
      for (const m of manifolds) m.correctPositions(s);
      for (let it = 0; it < s.positionIterations; it++) {
        for (const c of active) if (c.solvePosition) c.solvePosition(s);
      }

      // 7. Sleep + cleanup.
      let awake = 0;
      const killD = s.killDistance, W = this.bounds.width, H = this.bounds.height;
      const toRemove = [];
      for (const b of bodies) {
        b.clearForces();
        if (b.isStatic) continue;
        if (b.position.y > H + killD || b.position.x < -killD || b.position.x > W + killD || b.position.y < -killD * 4) {
          toRemove.push(b);
          continue;
        }
        if (b.sleeping) continue;
        awake++;
        if (s.sleeping && b.canSleep) {
          if (b.velocity.lengthSq() < s.sleepLinear * s.sleepLinear &&
              b.angularVelocity * b.angularVelocity < s.sleepAngular * s.sleepAngular) {
            b.sleepTime += dt;
            if (b.sleepTime >= s.timeToSleep) b.sleep();
          } else {
            b.sleepTime = 0;
          }
        }
        b.updateWorldShape();
      }
      for (const b of toRemove) this.removeBody(b);

      this.time += dt;
      this.stepCount++;
      let contactCount = 0;
      for (const m of manifolds) contactCount += m.contacts.length;
      this.stats.contacts = contactCount;
      this.stats.manifolds = manifolds.length;
      this.stats.awake = awake;
      const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      this.stats.stepMs = this.stats.stepMs * 0.9 + (t1 - t0) * 0.1;
    }

    /** Broadphase + narrowphase. Fills this.manifolds and the warm-start cache. */
    detectCollisions(noCollide) {
      const hash = this.hash;
      hash.clear();
      const statics = [];
      const oversize = [];
      for (const b of this.bodies) {
        if (b.isStatic) statics.push(b);
        else if (!hash.insert(b)) oversize.push(b);
      }

      const newManifolds = [];
      const newCache = new Map();
      const cache = this.contactCache;
      const wakeSpeedSq = 0.25;
      let pairs = 0;

      const test = (a, b) => {
        const aActive = a.isAwakeDynamic, bActive = b.isAwakeDynamic;
        if (!aActive && !bActive) return;
        if (a.group !== 0 && a.group === b.group) return;
        if (!Collision.aabbOverlap(a.aabb, b.aabb)) return;
        const key = Collision.pairKey(a, b);
        if (noCollide.has(key)) return;
        pairs++;
        const m = Collision.collide(a, b);
        if (!m) return;
        // An awake, moving body hitting a sleeping one wakes it up.
        if (a.sleeping && bActive && (b.velocity.lengthSq() > wakeSpeedSq || b.angularVelocity * b.angularVelocity > wakeSpeedSq)) a.wake();
        if (b.sleeping && aActive && (a.velocity.lengthSq() > wakeSpeedSq || a.angularVelocity * a.angularVelocity > wakeSpeedSq)) b.wake();
        m.matchPrevious(cache.get(key));
        newManifolds.push(m);
        newCache.set(key, m);
      };

      hash.forEachPair(test);
      const dyn = this.bodies.filter((b) => !b.isStatic);
      for (const s of statics) for (const b of dyn) test(s, b);
      for (const o of oversize) for (const b of dyn) if (b !== o) test(o, b);

      this.manifolds = newManifolds;
      this.contactCache = newCache;
      this.stats.pairs = pairs;
    }

    // --- Interaction ------------------------------------------------------------
    /** Topmost dynamic body containing the point (or null). */
    queryPoint(p, includeStatic = false) {
      for (let i = this.bodies.length - 1; i >= 0; i--) {
        const b = this.bodies[i];
        if (b.isStatic && !includeStatic) continue;
        if (b.containsPoint(p)) return b;
      }
      return null;
    }

    /** Nearest visible constraint whose segment passes within `tol` of p. */
    findConstraintNear(p, tol) {
      let best = null, bestD = tol * tol;
      for (const c of this.constraints) {
        if (c.type === 'mouse' || !c.visible) continue;
        const a = c.worldA(), b = c.worldB();
        const abx = b.x - a.x, aby = b.y - a.y;
        const l2 = abx * abx + aby * aby;
        let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    }

    /**
     * Radial impulse explosion.
     * @param {Vec2} center @param {number} radius (m) @param {number} power (N*s per m of body size)
     * @returns {number} number of bodies affected
     */
    explode(center, radius, power) {
      let count = 0;
      for (const b of this.bodies) {
        if (b.isStatic) continue;
        const dx = b.position.x - center.x, dy = b.position.y - center.y;
        const dist = Math.hypot(dx, dy);
        const reach = radius + b.shape.boundingRadius;
        if (dist > reach) continue;
        const falloff = 1 - Math.min(dist / reach, 1);
        let nx, ny;
        if (dist > 1e-4) { nx = dx / dist; ny = dy / dist; } else { const a = Math.random() * Math.PI * 2; nx = Math.cos(a); ny = Math.sin(a); }
        const size = Math.min(2 * b.shape.boundingRadius, 3);
        const j = power * falloff * size;
        b.wake();
        b.applyImpulse(new Vec2(nx * j, ny * j), null);
        b.angularVelocity += (Math.random() - 0.5) * 12 * falloff;
        count++;
      }
      return count;
    }

    totalKineticEnergy() {
      let e = 0;
      for (const b of this.bodies) e += b.kineticEnergy();
      return e;
    }

    getBodyById(id) { return this.bodies.find((b) => b.id === id) || null; }
  }

  World.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  App1.World = World;
})(window.App1 = window.App1 || {});
