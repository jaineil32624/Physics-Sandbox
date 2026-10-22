/**
 * App1 - body.js
 * ----------------------------------------------------------------------------
 * Rigid body: shape + material + kinematic state.
 *
 * State is integrated by the World with semi-implicit Euler:
 *     v += (gravity + F/m) * dt ;  x += v * dt
 * The body also caches its world-space geometry (vertices, normals, AABB)
 * which collision detection reads; call updateWorldShape() after moving it.
 */
(function (App1) {
  'use strict';
  const { Vec2, Materials, Shapes } = App1;

  let nextId = 1;

  class Body {
    /**
     * @param {Circle|Polygon} shape
     * @param {object} [opts]
     * @param {number} [opts.x] @param {number} [opts.y] @param {number} [opts.angle]
     * @param {string} [opts.material='wood']
     * @param {boolean} [opts.isStatic=false]
     * @param {number} [opts.group=0]  bodies sharing a non-zero group never collide
     * @param {string} [opts.tint]     optional fill colour override
     * @param {number} [opts.friction] @param {number} [opts.restitution] @param {number} [opts.density]
     */
    constructor(shape, opts = {}) {
      if (Number.isInteger(opts.id) && opts.id > 0) {
        this.id = opts.id;
        if (opts.id >= nextId) nextId = opts.id + 1;
      } else {
        this.id = nextId++;
      }

      this.shape = shape;
      this.position = new Vec2(opts.x || 0, opts.y || 0);
      this.angle = opts.angle || 0;
      // Previous-step transform, used to interpolate rendering between steps.
      this.prevPosition = this.position.clone();
      this.prevAngle = this.angle;

      this.velocity = new Vec2(opts.vx || 0, opts.vy || 0);
      this.angularVelocity = opts.angularVelocity || 0;
      this.force = new Vec2(0, 0);
      this.torque = 0;

      this.isStatic = !!opts.isStatic;
      this.materialKey = Materials.has(opts.material) ? opts.material : (this.isStatic ? 'static' : 'wood');
      const mat = Materials.get(this.materialKey);
      // Physical coefficients are copied per body so presets can tweak them.
      this.density = Number.isFinite(opts.density) ? opts.density : mat.density;
      this.friction = Number.isFinite(opts.friction) ? opts.friction : mat.friction;
      this.restitution = Number.isFinite(opts.restitution) ? opts.restitution : mat.restitution;

      this.group = opts.group || 0;
      this.tint = opts.tint || null;
      this.label = opts.label || '';
      this.linearDamping = Number.isFinite(opts.linearDamping) ? opts.linearDamping : 0.02;
      this.angularDamping = Number.isFinite(opts.angularDamping) ? opts.angularDamping : 0.05;

      // Sleeping (performance + stable resting stacks).
      this.sleeping = false;
      this.sleepTime = 0;
      this.canSleep = opts.canSleep !== false;

      // Cached world-space geometry.
      this.worldVertices = [];
      this.worldNormals = [];
      if (shape.type === 'polygon') {
        for (let i = 0; i < shape.vertices.length; i++) {
          this.worldVertices.push(new Vec2());
          this.worldNormals.push(new Vec2());
        }
      }
      this.aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

      this.computeMass();
      this.updateWorldShape();
    }

    get material() { return Materials.get(this.materialKey); }

    /** Recompute mass/inertia from shape + density (static bodies get infinite mass). */
    computeMass() {
      if (this.isStatic) {
        this.mass = 0; this.invMass = 0; this.inertia = 0; this.invInertia = 0;
        this.area = this.shape.computeMass(1).area;
        return;
      }
      const { mass, inertia, area } = this.shape.computeMass(this.density);
      this.area = area;
      this.mass = mass;
      this.invMass = mass > 0 ? 1 / mass : 0;
      this.inertia = inertia;
      this.invInertia = inertia > 0 ? 1 / inertia : 0;
    }

    /** True when the body takes part in integration this step. */
    get isAwakeDynamic() { return !this.isStatic && !this.sleeping; }

    /** Update world vertices/normals/AABB from position + angle. */
    updateWorldShape() {
      const px = this.position.x, py = this.position.y;
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      const bb = this.aabb;
      if (this.shape.type === 'circle') {
        const r = this.shape.radius;
        bb.minX = px - r; bb.maxX = px + r; bb.minY = py - r; bb.maxY = py + r;
        return;
      }
      const lv = this.shape.vertices, ln = this.shape.normals;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < lv.length; i++) {
        const v = lv[i], wv = this.worldVertices[i];
        wv.x = px + c * v.x - s * v.y;
        wv.y = py + s * v.x + c * v.y;
        const n = ln[i], wn = this.worldNormals[i];
        wn.x = c * n.x - s * n.y;
        wn.y = s * n.x + c * n.y;
        if (wv.x < minX) minX = wv.x;
        if (wv.x > maxX) maxX = wv.x;
        if (wv.y < minY) minY = wv.y;
        if (wv.y > maxY) maxY = wv.y;
      }
      bb.minX = minX; bb.minY = minY; bb.maxX = maxX; bb.maxY = maxY;
    }

    /** Teleport the body (also resets interpolation so it does not "streak"). */
    setPosition(x, y, angle = this.angle) {
      this.position.set(x, y);
      this.prevPosition.set(x, y);
      this.angle = angle;
      this.prevAngle = angle;
      this.updateWorldShape();
    }

    // --- Space conversions ------------------------------------------------------
    /** Rotate a local vector into world orientation (no translation). */
    rotateToWorld(v) {
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      return new Vec2(c * v.x - s * v.y, s * v.x + c * v.y);
    }
    localToWorld(p) {
      const r = this.rotateToWorld(p);
      return r.addSelf(this.position);
    }
    worldToLocal(p) {
      const dx = p.x - this.position.x, dy = p.y - this.position.y;
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      return new Vec2(c * dx + s * dy, -s * dx + c * dy);
    }

    /** Velocity of a world point attached to this body: v + w x r. */
    velocityAt(worldPoint) {
      const rx = worldPoint.x - this.position.x, ry = worldPoint.y - this.position.y;
      return new Vec2(this.velocity.x - this.angularVelocity * ry, this.velocity.y + this.angularVelocity * rx);
    }

    // --- Dynamics ---------------------------------------------------------------
    /** Apply an impulse at offset r (from the centre of mass, world orientation). */
    applyImpulse(impulse, r) {
      if (this.isStatic) return;
      this.velocity.x += impulse.x * this.invMass;
      this.velocity.y += impulse.y * this.invMass;
      if (r) this.angularVelocity += this.invInertia * (r.x * impulse.y - r.y * impulse.x);
    }

    /** Accumulate a force (optionally at a world point, which adds torque). */
    applyForce(force, worldPoint) {
      if (this.isStatic) return;
      this.force.x += force.x;
      this.force.y += force.y;
      if (worldPoint) {
        const rx = worldPoint.x - this.position.x, ry = worldPoint.y - this.position.y;
        this.torque += rx * force.y - ry * force.x;
      }
    }

    clearForces() { this.force.set(0, 0); this.torque = 0; }

    wake() {
      if (this.isStatic) return;
      this.sleeping = false;
      this.sleepTime = 0;
    }

    sleep() {
      this.sleeping = true;
      this.velocity.set(0, 0);
      this.angularVelocity = 0;
    }

    // --- Queries ----------------------------------------------------------------
    containsPoint(p) {
      if (p.x < this.aabb.minX || p.x > this.aabb.maxX || p.y < this.aabb.minY || p.y > this.aabb.maxY) return false;
      if (this.shape.type === 'circle') return this.position.distanceSq(p) <= this.shape.radius * this.shape.radius;
      for (let i = 0; i < this.worldVertices.length; i++) {
        const v = this.worldVertices[i], n = this.worldNormals[i];
        if ((p.x - v.x) * n.x + (p.y - v.y) * n.y > 0) return false;
      }
      return true;
    }

    kineticEnergy() {
      if (this.isStatic) return 0;
      return 0.5 * this.mass * this.velocity.lengthSq() + 0.5 * this.inertia * this.angularVelocity * this.angularVelocity;
    }

    /** Human-readable shape kind (for stats). */
    get kind() {
      if (this.shape.type === 'circle') return 'Circle';
      const n = this.shape.vertices.length;
      return n === 3 ? 'Triangle' : n === 4 ? 'Box' : `${n}-gon`;
    }

    // --- Serialisation ----------------------------------------------------------
    toJSON() {
      return {
        id: this.id,
        shape: this.shape.toJSON(),
        x: this.position.x, y: this.position.y, angle: this.angle,
        vx: this.velocity.x, vy: this.velocity.y, angularVelocity: this.angularVelocity,
        material: this.materialKey,
        isStatic: this.isStatic,
        density: this.density, friction: this.friction, restitution: this.restitution,
        group: this.group, tint: this.tint, label: this.label,
        sleeping: this.sleeping, canSleep: this.canSleep
      };
    }

    static fromJSON(d) {
      const num = App1.MathUtil.num;
      const body = new Body(Shapes.fromJSON(d.shape), {
        id: d.id,
        x: num(d.x), y: num(d.y), angle: num(d.angle),
        vx: num(d.vx), vy: num(d.vy), angularVelocity: num(d.angularVelocity),
        material: d.material, isStatic: !!d.isStatic,
        density: d.density, friction: d.friction, restitution: d.restitution,
        group: Number.isInteger(d.group) ? d.group : 0,
        tint: typeof d.tint === 'string' ? d.tint : null,
        label: typeof d.label === 'string' ? d.label : '',
        canSleep: d.canSleep !== false
      });
      if (d.sleeping && !body.isStatic) body.sleep();
      return body;
    }

    /** Reset the id counter (used when a scene is cleared). */
    static resetIds(next = 1) { nextId = next; }
    static peekNextId() { return nextId; }
  }

  App1.Body = Body;
})(window.App1 = window.App1 || {});
