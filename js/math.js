/**
 * App1 - math.js
 * ----------------------------------------------------------------------------
 * Small 2D vector library and numeric helpers used by every other module.
 *
 * Conventions used throughout App1:
 *   - World units are meters; the world is Y-DOWN (like the canvas), so a
 *     positive gravity value pulls objects towards the bottom of the screen.
 *   - Angles are in radians. With Y pointing down, a positive angle appears
 *     as a clockwise rotation on screen.
 *   - Vec2 methods without a "Self" suffix return NEW vectors; methods ending
 *     in "Self" mutate the receiver and return it (useful in hot loops).
 */
(function (App1) {
  'use strict';

  class Vec2 {
    /**
     * @param {number} [x=0]
     * @param {number} [y=0]
     */
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }

    /** Create a Vec2 from any {x, y}-like object. */
    static from(o) {
      return new Vec2(o && Number.isFinite(o.x) ? o.x : 0, o && Number.isFinite(o.y) ? o.y : 0);
    }

    /** Unit vector pointing at `angle` radians. */
    static fromAngle(angle, length = 1) {
      return new Vec2(Math.cos(angle) * length, Math.sin(angle) * length);
    }

    clone() { return new Vec2(this.x, this.y); }
    set(x, y) { this.x = x; this.y = y; return this; }
    copy(v) { this.x = v.x; this.y = v.y; return this; }

    // --- Immutable operations -------------------------------------------------
    add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
    sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
    scale(s) { return new Vec2(this.x * s, this.y * s); }
    addScaled(v, s) { return new Vec2(this.x + v.x * s, this.y + v.y * s); }
    negate() { return new Vec2(-this.x, -this.y); }
    /** Perpendicular vector (rotated +90 degrees in math orientation). */
    perp() { return new Vec2(-this.y, this.x); }

    normalize() {
      const len = Math.hypot(this.x, this.y);
      return len > 1e-12 ? new Vec2(this.x / len, this.y / len) : new Vec2(0, 0);
    }

    rotate(angle) {
      const c = Math.cos(angle), s = Math.sin(angle);
      return new Vec2(c * this.x - s * this.y, s * this.x + c * this.y);
    }

    // --- Mutating operations --------------------------------------------------
    addSelf(v) { this.x += v.x; this.y += v.y; return this; }
    subSelf(v) { this.x -= v.x; this.y -= v.y; return this; }
    scaleSelf(s) { this.x *= s; this.y *= s; return this; }
    addScaledSelf(v, s) { this.x += v.x * s; this.y += v.y * s; return this; }

    // --- Scalar queries ---------------------------------------------------------
    dot(v) { return this.x * v.x + this.y * v.y; }
    /** 2D cross product (z component of the 3D cross product). */
    cross(v) { return this.x * v.y - this.y * v.x; }
    length() { return Math.hypot(this.x, this.y); }
    lengthSq() { return this.x * this.x + this.y * this.y; }
    distance(v) { return Math.hypot(this.x - v.x, this.y - v.y); }
    distanceSq(v) { const dx = this.x - v.x, dy = this.y - v.y; return dx * dx + dy * dy; }
    angle() { return Math.atan2(this.y, this.x); }

    // --- Static helpers -------------------------------------------------------
    /** scalar x vector: (s cross v) = (-s * v.y, s * v.x) */
    static crossSV(s, v) { return new Vec2(-s * v.y, s * v.x); }
    /** vector x scalar: (v cross s) = (s * v.y, -s * v.x) */
    static crossVS(v, s) { return new Vec2(s * v.y, -s * v.x); }
    static lerp(a, b, t) { return new Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }

    toJSON() { return { x: this.x, y: this.y }; }
    toString() { return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`; }
  }

  /** Numeric helpers. */
  const MathUtil = {
    TAU: Math.PI * 2,
    EPSILON: 1e-9,
    clamp(v, min, max) { return v < min ? min : v > max ? max : v; },
    lerp(a, b, t) { return a + (b - a) * t; },
    randRange(min, max) { return min + Math.random() * (max - min); },
    randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); },
    /** Deterministic pseudo-random in [0,1) from an integer seed (for visuals). */
    hash01(seed) {
      const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
      return s - Math.floor(s);
    },
    /** Normalise an angle to (-PI, PI]. */
    wrapAngle(a) {
      a = (a + Math.PI) % (Math.PI * 2);
      if (a < 0) a += Math.PI * 2;
      return a - Math.PI;
    },
    /** Safe finite number with fallback (used when loading untrusted JSON). */
    num(v, fallback = 0) { return Number.isFinite(v) ? v : fallback; }
  };

  App1.Vec2 = Vec2;
  App1.MathUtil = MathUtil;
})(window.App1 = window.App1 || {});
