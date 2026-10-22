/**
 * App1 - constraints.js
 * ----------------------------------------------------------------------------
 * Joints and force elements. Every constraint connects bodyA to either bodyB
 * or a fixed WORLD anchor (bodyB === null, localB is then a world point).
 *
 *   DistanceConstraint - rigid rod keeping two anchors at a fixed distance
 *                        (pendulums, Newton's cradle).
 *   PinConstraint      - revolute joint making two anchors coincide, with an
 *                        optional relative-angle limit (chains, ragdolls).
 *   SpringConstraint   - Hooke spring with damping, applied as a force.
 *   MouseConstraint    - soft spring-damper used for dragging (not saved).
 *
 * Lifecycle per world step:
 *   applyForces(dt)            (springs only)
 *   preStep(invDt, settings)   compute effective masses + warm start
 *   solveVelocity()            repeated `iterations` times
 *   solvePosition(settings)    rigid joints only, repeated `positionIterations`
 *                              times after integration to remove drift
 *
 * Rigid joints keep the velocity solve free of position bias (a Baumgarte
 * bias combined with warm starting pumps energy into long chains) and fix
 * drift with non-linear Gauss-Seidel position projection instead, like Box2D.
 * To add a constraint type: subclass Constraint, implement the hooks, give it
 * a unique `type`, implement toJSON/fromJSON and add it to `registry`.
 */
(function (App1) {
  'use strict';
  const { Vec2 } = App1;

  /** Inverse mass helpers that treat sleeping/static/missing bodies as immovable. */
  function im(b) { return b && b.isAwakeDynamic ? b.invMass : 0; }
  function ii(b) { return b && b.isAwakeDynamic ? b.invInertia : 0; }

  /** Rotate a local anchor to world orientation; for a null body returns 0-vector. */
  function anchorOffset(body, local) {
    if (!body) return new Vec2(0, 0);
    return body.rotateToWorld(local);
  }

  /** Apply an impulse P at offset r to a body (skip if immovable). */
  function impulse(body, Px, Py, rx, ry, sign, imv, iiv) {
    if (!body || imv === 0 && iiv === 0) return;
    body.velocity.x += sign * Px * imv;
    body.velocity.y += sign * Py * imv;
    body.angularVelocity += sign * iiv * (rx * Py - ry * Px);
  }

  class Constraint {
    constructor(type, bodyA, localA, bodyB, localB) {
      this.type = type;
      this.bodyA = bodyA;
      this.localA = Vec2.from(localA);
      this.bodyB = bodyB || null;
      this.localB = Vec2.from(localB); // local to bodyB, or a world point if bodyB is null
      this.collideConnected = false;
      this.visible = true;
    }

    /** World position of anchor A. */
    worldA() { return this.bodyA.localToWorld(this.localA); }
    /** World position of anchor B (body point or fixed world anchor). */
    worldB() { return this.bodyB ? this.bodyB.localToWorld(this.localB) : this.localB.clone(); }

    involves(body) { return this.bodyA === body || this.bodyB === body; }

    /** Hooks (overridden by subclasses). */
    applyForces(/* dt */) {}
    preStep(/* invDt, settings */) {}
    solveVelocity() {}

    /** Should the solver run this step (at least one awake dynamic body)? */
    isActive() {
      return (this.bodyA && this.bodyA.isAwakeDynamic) || (this.bodyB && this.bodyB.isAwakeDynamic);
    }

    baseJSON() {
      return {
        type: this.type,
        bodyA: this.bodyA.id,
        localA: this.localA.toJSON(),
        bodyB: this.bodyB ? this.bodyB.id : null,
        localB: this.localB.toJSON(),
        collideConnected: this.collideConnected,
        visible: this.visible
      };
    }
  }

  // ---------------------------------------------------------------------------
  class DistanceConstraint extends Constraint {
    /**
     * @param {Body} bodyA @param {Vec2} localA
     * @param {Body|null} bodyB @param {Vec2} localB  (world point if bodyB null)
     * @param {number} [length] defaults to the current distance
     */
    constructor(bodyA, localA, bodyB, localB, length) {
      super('distance', bodyA, localA, bodyB, localB);
      this.length = Number.isFinite(length) ? length : this.worldA().distance(this.worldB());
      this.accumulated = 0;
    }

    /** Unit axis A->B, its length and the anchor offsets for the current pose. */
    geometry() {
      const A = this.bodyA, B = this.bodyB;
      const rA = anchorOffset(A, this.localA), rB = anchorOffset(B, this.localB);
      const pBx = B ? B.position.x + rB.x : this.localB.x;
      const pBy = B ? B.position.y + rB.y : this.localB.y;
      let dx = pBx - (A.position.x + rA.x), dy = pBy - (A.position.y + rA.y);
      const len = Math.hypot(dx, dy);
      if (len > 1e-9) { dx /= len; dy /= len; } else { dx = 1; dy = 0; }
      return { rA, rB, nx: dx, ny: dy, len };
    }

    effectiveMass(g) {
      const crA = g.rA.x * g.ny - g.rA.y * g.nx, crB = g.rB.x * g.ny - g.rB.y * g.nx;
      const k = this.imA + this.imB + this.iiA * crA * crA + this.iiB * crB * crB;
      return k > 0 ? 1 / k : 0;
    }

    preStep(invDt, settings) {
      const A = this.bodyA, B = this.bodyB;
      this.imA = im(A); this.iiA = ii(A); this.imB = im(B); this.iiB = ii(B);
      const g = this.geometry();
      this.rA = g.rA; this.rB = g.rB;
      this.n = new Vec2(g.nx, g.ny);
      this.mass = this.effectiveMass(g);

      if (settings.warmStarting) {
        const Px = this.n.x * this.accumulated, Py = this.n.y * this.accumulated;
        impulse(A, Px, Py, this.rA.x, this.rA.y, -1, this.imA, this.iiA);
        impulse(B, Px, Py, this.rB.x, this.rB.y, 1, this.imB, this.iiB);
      } else {
        this.accumulated = 0;
      }
    }

    /** Velocity constraint: no relative velocity along the rod. */
    solveVelocity() {
      const A = this.bodyA, B = this.bodyB, rA = this.rA, rB = this.rB;
      let dvx = -A.velocity.x + A.angularVelocity * rA.y;
      let dvy = -A.velocity.y - A.angularVelocity * rA.x;
      if (B) {
        dvx += B.velocity.x - B.angularVelocity * rB.y;
        dvy += B.velocity.y + B.angularVelocity * rB.x;
      }
      const Cdot = dvx * this.n.x + dvy * this.n.y;
      const lambda = -this.mass * Cdot;
      this.accumulated += lambda;
      const Px = this.n.x * lambda, Py = this.n.y * lambda;
      impulse(A, Px, Py, rA.x, rA.y, -1, this.imA, this.iiA);
      impulse(B, Px, Py, rB.x, rB.y, 1, this.imB, this.iiB);
    }

    /**
     * Position correction (non-linear Gauss-Seidel): move the bodies directly
     * so the rod length error shrinks. Unlike a Baumgarte velocity bias this
     * adds no kinetic energy. Returns the remaining absolute error.
     */
    solvePosition(settings) {
      const g = this.geometry();
      let C = g.len - this.length;
      const err = Math.abs(C);
      C = Math.max(-settings.maxJointCorrection, Math.min(C, settings.maxJointCorrection));
      const lambda = -this.effectiveMass(g) * C * settings.jointBeta;
      applyPositional(this.bodyA, this.bodyB, g.nx * lambda, g.ny * lambda, g.rA, g.rB, this);
      return err;
    }

    toJSON() { return Object.assign(this.baseJSON(), { length: this.length }); }
    static fromJSON(d, A, B) {
      return new DistanceConstraint(A, d.localA, B, d.localB, d.length);
    }
  }

  /** Apply a positional "impulse" P (+B, -A) at offsets rA/rB using c's cached inverse masses. */
  function applyPositional(A, B, Px, Py, rA, rB, c) {
    if (c.imA || c.iiA) {
      A.position.x -= Px * c.imA; A.position.y -= Py * c.imA;
      A.angle -= c.iiA * (rA.x * Py - rA.y * Px);
    }
    if (B && (c.imB || c.iiB)) {
      B.position.x += Px * c.imB; B.position.y += Py * c.imB;
      B.angle += c.iiB * (rB.x * Py - rB.y * Px);
    }
  }

  // ---------------------------------------------------------------------------
  class PinConstraint extends Constraint {
    /**
     * Revolute joint. Optional limits restrict (angleB - angleA - referenceAngle)
     * to [lower, upper]; limits require bodyB.
     */
    constructor(bodyA, localA, bodyB, localB, opts = {}) {
      super('pin', bodyA, localA, bodyB, localB);
      this.referenceAngle = Number.isFinite(opts.referenceAngle)
        ? opts.referenceAngle
        : (bodyB ? bodyB.angle - bodyA.angle : 0);
      this.enableLimit = !!opts.enableLimit && !!bodyB;
      this.lower = Number.isFinite(opts.lower) ? opts.lower : -Math.PI / 4;
      this.upper = Number.isFinite(opts.upper) ? opts.upper : Math.PI / 4;
      this.accX = 0; this.accY = 0; this.accLimit = 0;
      this.limitState = 0; // -1 at lower, +1 at upper, 0 free
    }

    /** Pin a body point to a world point, keeping the current configuration. */
    static atWorldPoint(bodyA, bodyB, worldPoint, opts) {
      const lA = bodyA.worldToLocal(worldPoint);
      const lB = bodyB ? bodyB.worldToLocal(worldPoint) : worldPoint.clone();
      return new PinConstraint(bodyA, lA, bodyB, lB, opts);
    }

    /** Inverse of the 2x2 point-constraint effective-mass matrix K. */
    invK(rA, rB) {
      const mA = this.imA, iA = this.iiA, mB = this.imB, iB = this.iiB;
      const k11 = mA + mB + iA * rA.y * rA.y + iB * rB.y * rB.y;
      const k12 = -iA * rA.x * rA.y - iB * rB.x * rB.y;
      const k22 = mA + mB + iA * rA.x * rA.x + iB * rB.x * rB.x;
      let det = k11 * k22 - k12 * k12;
      det = Math.abs(det) > 1e-12 ? 1 / det : 0;
      return { m11: det * k22, m12: -det * k12, m22: det * k11 };
    }

    relativeAngle() { return this.bodyB.angle - this.bodyA.angle - this.referenceAngle; }

    preStep(invDt, settings) {
      const A = this.bodyA, B = this.bodyB;
      const rA = this.rA = anchorOffset(A, this.localA);
      const rB = this.rB = anchorOffset(B, this.localB);
      const mA = this.imA = im(A), iA = this.iiA = ii(A);
      const mB = this.imB = im(B), iB = this.iiB = ii(B);
      const M = this.invK(rA, rB);
      this.m11 = M.m11; this.m12 = M.m12; this.m22 = M.m22;

      // The angle limit becomes active slightly before it is reached.
      this.limitState = 0;
      if (this.enableLimit && B) {
        const angle = this.relativeAngle();
        const kA = iA + iB;
        this.angMass = kA > 0 ? 1 / kA : 0;
        const margin = 0.02;
        if (angle <= this.lower + margin) this.limitState = -1;
        else if (angle >= this.upper - margin) this.limitState = 1;
      }
      if (this.limitState === 0) this.accLimit = 0;

      if (settings.warmStarting) {
        impulse(A, this.accX, this.accY, rA.x, rA.y, -1, mA, iA);
        impulse(B, this.accX, this.accY, rB.x, rB.y, 1, mB, iB);
        if (this.limitState !== 0) {
          A.angularVelocity -= iA * this.accLimit;
          if (B) B.angularVelocity += iB * this.accLimit;
        }
      } else {
        this.accX = 0; this.accY = 0; this.accLimit = 0;
      }
    }

    solveVelocity() {
      const A = this.bodyA, B = this.bodyB, rA = this.rA, rB = this.rB;

      // Angular limit (one-sided: may only push away from the limit).
      if (this.limitState !== 0) {
        const Cdot = (B ? B.angularVelocity : 0) - A.angularVelocity;
        let lambda = -this.angMass * Cdot;
        const old = this.accLimit;
        this.accLimit = this.limitState < 0 ? Math.max(old + lambda, 0) : Math.min(old + lambda, 0);
        lambda = this.accLimit - old;
        A.angularVelocity -= this.iiA * lambda;
        if (B) B.angularVelocity += this.iiB * lambda;
      }

      // Point-to-point: the two anchors must move together.
      let dvx = -A.velocity.x + A.angularVelocity * rA.y;
      let dvy = -A.velocity.y - A.angularVelocity * rA.x;
      if (B) {
        dvx += B.velocity.x - B.angularVelocity * rB.y;
        dvy += B.velocity.y + B.angularVelocity * rB.x;
      }
      const Px = -(this.m11 * dvx + this.m12 * dvy);
      const Py = -(this.m12 * dvx + this.m22 * dvy);
      this.accX += Px; this.accY += Py;
      impulse(A, Px, Py, rA.x, rA.y, -1, this.imA, this.iiA);
      impulse(B, Px, Py, rB.x, rB.y, 1, this.imB, this.iiB);
    }

    /** NGS position correction for the anchor gap and the angle limit. */
    solvePosition(settings) {
      const A = this.bodyA, B = this.bodyB;
      // Angle limit.
      if (this.enableLimit && B && (this.iiA + this.iiB) > 0) {
        const angle = this.relativeAngle();
        let C = 0;
        if (angle < this.lower) C = angle - this.lower;
        else if (angle > this.upper) C = angle - this.upper;
        if (C !== 0) {
          C = Math.max(-0.25, Math.min(C, 0.25));
          const L = -C / (this.iiA + this.iiB) * settings.jointBeta;
          A.angle -= this.iiA * L;
          B.angle += this.iiB * L;
        }
      }
      // Point-to-point.
      const rA = anchorOffset(A, this.localA), rB = anchorOffset(B, this.localB);
      const pBx = B ? B.position.x + rB.x : this.localB.x;
      const pBy = B ? B.position.y + rB.y : this.localB.y;
      let cx = pBx - (A.position.x + rA.x), cy = pBy - (A.position.y + rA.y);
      const err = Math.hypot(cx, cy);
      const maxC = settings.maxJointCorrection;
      if (err > maxC) { cx *= maxC / err; cy *= maxC / err; }
      const M = this.invK(rA, rB);
      const Px = -(M.m11 * cx + M.m12 * cy) * settings.jointBeta;
      const Py = -(M.m12 * cx + M.m22 * cy) * settings.jointBeta;
      applyPositional(A, B, Px, Py, rA, rB, this);
      return err;
    }

    toJSON() {
      return Object.assign(this.baseJSON(), {
        referenceAngle: this.referenceAngle, enableLimit: this.enableLimit, lower: this.lower, upper: this.upper
      });
    }
    static fromJSON(d, A, B) {
      return new PinConstraint(A, d.localA, B, d.localB, {
        referenceAngle: d.referenceAngle, enableLimit: d.enableLimit, lower: d.lower, upper: d.upper
      });
    }
  }

  // ---------------------------------------------------------------------------
  class SpringConstraint extends Constraint {
    /**
     * Damped Hooke spring: F = k (len - rest) + c * (relative velocity along axis)
     * @param {object} [opts] { restLength, stiffness (N/m), damping (N*s/m) }
     *   or { frequency (Hz), dampingRatio } to derive k/c from the bodies' masses.
     */
    constructor(bodyA, localA, bodyB, localB, opts = {}) {
      super('spring', bodyA, localA, bodyB, localB);
      this.collideConnected = true;
      this.restLength = Number.isFinite(opts.restLength) ? opts.restLength : this.worldA().distance(this.worldB());
      if (Number.isFinite(opts.stiffness)) {
        this.stiffness = opts.stiffness;
        this.damping = Number.isFinite(opts.damping) ? opts.damping : 0;
      } else {
        // Derive from frequency using the reduced mass of the pair.
        const mA = bodyA.isStatic ? Infinity : bodyA.mass;
        const mB = !bodyB || bodyB.isStatic ? Infinity : bodyB.mass;
        const mEff = isFinite(mA) && isFinite(mB) ? (mA * mB) / (mA + mB) : Math.min(mA, mB);
        const w = 2 * Math.PI * (opts.frequency || 2);
        this.stiffness = mEff * w * w;
        this.damping = 2 * mEff * (Number.isFinite(opts.dampingRatio) ? opts.dampingRatio : 0.15) * w;
      }
      this.currentLength = this.restLength;
    }

    applyForces() {
      const A = this.bodyA, B = this.bodyB;
      const pA = this.worldA(), pB = this.worldB();
      let dx = pB.x - pA.x, dy = pB.y - pA.y;
      const len = Math.hypot(dx, dy);
      this.currentLength = len;
      if (len < 1e-6) return;
      dx /= len; dy /= len;
      const vA = A.velocityAt(pA);
      const vB = B ? B.velocityAt(pB) : new Vec2(0, 0);
      const relVel = (vB.x - vA.x) * dx + (vB.y - vA.y) * dy;
      const f = this.stiffness * (len - this.restLength) + this.damping * relVel;
      const F = new Vec2(dx * f, dy * f);
      // Pull A towards B and B towards A when stretched.
      if (A.isAwakeDynamic) A.applyForce(F, pA);
      if (B && B.isAwakeDynamic) B.applyForce(F.negate(), pB);
    }

    /** Strain = (len - rest) / rest; used by the renderer for colouring. */
    get strain() { return this.restLength > 1e-6 ? (this.currentLength - this.restLength) / this.restLength : 0; }

    toJSON() {
      return Object.assign(this.baseJSON(), { restLength: this.restLength, stiffness: this.stiffness, damping: this.damping });
    }
    static fromJSON(d, A, B) {
      const s = new SpringConstraint(A, d.localA, B, d.localB, {
        restLength: d.restLength, stiffness: d.stiffness, damping: d.damping
      });
      s.collideConnected = d.collideConnected !== false;
      return s;
    }
  }

  // ---------------------------------------------------------------------------
  class MouseConstraint extends Constraint {
    /**
     * Soft constraint pulling a body point towards `target` (Box2D-style mouse
     * joint): a critically-damped spring with a force cap proportional to mass.
     */
    constructor(body, worldPoint, opts = {}) {
      super('mouse', body, body.worldToLocal(worldPoint), null, worldPoint);
      this.target = worldPoint.clone();
      this.frequency = opts.frequency || 5;
      this.dampingRatio = opts.dampingRatio || 0.9;
      this.maxForceScale = opts.maxForceScale || 1200; // N per kg
      this.accX = 0; this.accY = 0;
      this.collideConnected = true;
    }

    setTarget(p) { this.target.set(p.x, p.y); this.bodyA.wake(); }
    worldB() { return this.target.clone(); }
    isActive() { return true; }

    preStep(invDt, settings) {
      const A = this.bodyA, dt = 1 / invDt;
      A.wake();
      const mass = A.mass;
      const omega = 2 * Math.PI * this.frequency;
      const d = 2 * mass * this.dampingRatio * omega;
      const k = mass * omega * omega;
      let gamma = dt * (d + dt * k);
      gamma = gamma > 0 ? 1 / gamma : 0;
      this.gamma = gamma;
      const beta = dt * k * gamma;

      const rA = this.rA = A.rotateToWorld(this.localA);
      const mA = A.invMass, iA = A.invInertia;
      const k11 = mA + iA * rA.y * rA.y + gamma;
      const k12 = -iA * rA.x * rA.y;
      const k22 = mA + iA * rA.x * rA.x + gamma;
      let det = k11 * k22 - k12 * k12;
      det = det !== 0 ? 1 / det : 0;
      this.m11 = det * k22; this.m12 = -det * k12; this.m22 = det * k11;

      const cx = A.position.x + rA.x - this.target.x, cy = A.position.y + rA.y - this.target.y;
      this.biasX = cx * beta; this.biasY = cy * beta;
      this.maxImpulse = this.maxForceScale * mass * dt;

      // Extra angular damping makes dragged bodies easier to control.
      A.angularVelocity *= 0.98;

      if (settings.warmStarting) {
        impulse(A, this.accX, this.accY, rA.x, rA.y, 1, mA, iA);
      } else { this.accX = 0; this.accY = 0; }
    }

    solveVelocity() {
      const A = this.bodyA, rA = this.rA;
      const vx = A.velocity.x - A.angularVelocity * rA.y;
      const vy = A.velocity.y + A.angularVelocity * rA.x;
      const bx = vx + this.biasX + this.gamma * this.accX;
      const by = vy + this.biasY + this.gamma * this.accY;
      let Px = -(this.m11 * bx + this.m12 * by);
      let Py = -(this.m12 * bx + this.m22 * by);
      const oldX = this.accX, oldY = this.accY;
      this.accX += Px; this.accY += Py;
      const len = Math.hypot(this.accX, this.accY);
      if (len > this.maxImpulse) {
        this.accX *= this.maxImpulse / len;
        this.accY *= this.maxImpulse / len;
      }
      Px = this.accX - oldX; Py = this.accY - oldY;
      impulse(A, Px, Py, rA.x, rA.y, 1, A.invMass, A.invInertia);
    }

    toJSON() { return null; } // transient, never saved
  }

  /** type -> class with static fromJSON(data, bodyA, bodyB). */
  const registry = {
    distance: DistanceConstraint,
    pin: PinConstraint,
    spring: SpringConstraint
  };

  /** Rebuild a constraint from JSON; bodyById maps saved ids to bodies. */
  function fromJSON(d, bodyById) {
    const Cls = registry[d && d.type];
    if (!Cls) return null;
    const A = bodyById.get(d.bodyA);
    const B = d.bodyB == null ? null : bodyById.get(d.bodyB);
    if (!A || (d.bodyB != null && !B)) return null;
    const c = Cls.fromJSON(d, A, B);
    if (typeof d.collideConnected === 'boolean') c.collideConnected = d.collideConnected;
    if (typeof d.visible === 'boolean') c.visible = d.visible;
    return c;
  }

  App1.Constraints = {
    Constraint,
    DistanceConstraint,
    PinConstraint,
    SpringConstraint,
    MouseConstraint,
    registry,
    fromJSON
  };
})(window.App1 = window.App1 || {});
