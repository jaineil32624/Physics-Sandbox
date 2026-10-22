/**
 * App1 - collision.js
 * ----------------------------------------------------------------------------
 * Collision pipeline:
 *
 *   1. Broadphase  - SpatialHash buckets dynamic-body AABBs into a uniform grid
 *                    and reports candidate pairs (static bodies are tested
 *                    separately because they are few and often huge).
 *   2. Narrowphase - exact tests producing a contact Manifold:
 *                      circle-circle, polygon-circle, polygon-polygon (SAT +
 *                      reference/incident face clipping, up to 2 points).
 *   3. Solver      - Manifold.preStep / solveVelocity implement sequential
 *                    impulses with accumulated-impulse clamping, Coulomb
 *                    friction, restitution and warm starting; correctPositions
 *                    does linear projection to remove residual penetration.
 *
 * All manifold normals point FROM body A TO body B.
 */
(function (App1) {
  'use strict';
  const { Vec2, Materials } = App1;

  // ---------------------------------------------------------------------------
  // Broadphase
  // ---------------------------------------------------------------------------
  class SpatialHash {
    /** @param {number} cellSize  grid cell size in meters */
    constructor(cellSize = 2) {
      this.cellSize = cellSize;
      this.cells = new Map();
    }

    clear() { this.cells.clear(); }

    static key(cx, cy) { return (cx + 32768) * 65536 + (cy + 32768); }

    insert(body) {
      const inv = 1 / this.cellSize, bb = body.aabb;
      const x0 = Math.floor(bb.minX * inv), x1 = Math.floor(bb.maxX * inv);
      const y0 = Math.floor(bb.minY * inv), y1 = Math.floor(bb.maxY * inv);
      // Guard against pathological sizes (should not happen for dynamic bodies).
      if ((x1 - x0) * (y1 - y0) > 4096) return false;
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const k = SpatialHash.key(cx, cy);
          let list = this.cells.get(k);
          if (!list) { list = []; this.cells.set(k, list); }
          list.push(body);
        }
      }
      return true;
    }

    /** Invoke cb(a, b) once for every pair sharing at least one cell. */
    forEachPair(cb) {
      const seen = new Set();
      for (const list of this.cells.values()) {
        const n = list.length;
        if (n < 2) continue;
        for (let i = 0; i < n; i++) {
          const a = list[i];
          for (let j = i + 1; j < n; j++) {
            const b = list[j];
            const k = pairKey(a, b);
            if (seen.has(k)) continue;
            seen.add(k);
            cb(a, b);
          }
        }
      }
    }
  }

  /** Unique numeric key for an unordered body pair. */
  function pairKey(a, b) {
    return a.id < b.id ? a.id * 2097152 + b.id : b.id * 2097152 + a.id;
  }

  function aabbOverlap(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }

  /** Separation (m) within which polygon contact points are kept speculatively. */
  const SPECULATIVE_MARGIN = 0.02;

  // ---------------------------------------------------------------------------
  // Narrowphase. Each test returns { nx, ny, points: [{x, y, pen}] } or null,
  // with the normal pointing from the FIRST argument to the SECOND.
  // ---------------------------------------------------------------------------
  function circleCircle(a, b) {
    const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
    const r = a.shape.radius + b.shape.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2);
    let nx = 0, ny = 1;
    if (d > 1e-9) { nx = dx / d; ny = dy / d; }
    const pen = r - d;
    const k = a.shape.radius - pen * 0.5;
    return { nx, ny, points: [{ x: a.position.x + nx * k, y: a.position.y + ny * k, pen }] };
  }

  /** Polygon (first) vs circle (second). Normal points polygon -> circle. */
  function polygonCircle(poly, circle) {
    const cx = circle.position.x, cy = circle.position.y, r = circle.shape.radius;
    const verts = poly.worldVertices, norms = poly.worldNormals, n = verts.length;

    // Face of maximum separation.
    let sep = -Infinity, face = 0;
    for (let i = 0; i < n; i++) {
      const s = norms[i].x * (cx - verts[i].x) + norms[i].y * (cy - verts[i].y);
      if (s > r) return null;
      if (s > sep) { sep = s; face = i; }
    }
    const v1 = verts[face], v2 = verts[(face + 1) % n], fn = norms[face];

    // Centre inside polygon: push out along the face normal.
    if (sep < 1e-9) {
      return { nx: fn.x, ny: fn.y, points: [{ x: cx - fn.x * sep, y: cy - fn.y * sep, pen: r - sep }] };
    }

    // Voronoi regions of the face's two vertices.
    const d1 = (cx - v1.x) * (v2.x - v1.x) + (cy - v1.y) * (v2.y - v1.y);
    const d2 = (cx - v2.x) * (v1.x - v2.x) + (cy - v2.y) * (v1.y - v2.y);
    if (d1 <= 0 || d2 <= 0) {
      const v = d1 <= 0 ? v1 : v2;
      const dx = cx - v.x, dy = cy - v.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > r * r) return null;
      const dist = Math.sqrt(dist2);
      if (dist < 1e-9) return { nx: fn.x, ny: fn.y, points: [{ x: v.x, y: v.y, pen: r }] };
      return { nx: dx / dist, ny: dy / dist, points: [{ x: v.x, y: v.y, pen: r - dist }] };
    }
    // Face region.
    return { nx: fn.x, ny: fn.y, points: [{ x: cx - fn.x * sep, y: cy - fn.y * sep, pen: r - sep }] };
  }

  /**
   * Find the face of A along which A and B are separated the most.
   * Returns { sep, index }. sep > 0 means a separating axis exists.
   */
  function findMaxSeparation(A, B) {
    const va = A.worldVertices, na = A.worldNormals, vb = B.worldVertices;
    let best = -Infinity, bestIndex = 0;
    for (let i = 0; i < va.length; i++) {
      const n = na[i], v = va[i];
      // Deepest point of B along -n.
      let min = Infinity;
      for (let j = 0; j < vb.length; j++) {
        const d = n.x * (vb[j].x - v.x) + n.y * (vb[j].y - v.y);
        if (d < min) min = d;
      }
      if (min > best) { best = min; bestIndex = i; }
    }
    return { sep: best, index: bestIndex };
  }

  /**
   * Keep the part of a segment (1 or 2 points) where dot(n, p) <= offset.
   * Returns 0, 1 or 2 points.
   */
  function clipSegment(pts, nx, ny, offset) {
    const out = [];
    if (pts.length === 1) {
      if (nx * pts[0].x + ny * pts[0].y - offset <= 0) out.push(pts[0]);
      return out;
    }
    const p0 = pts[0], p1 = pts[1];
    const d0 = nx * p0.x + ny * p0.y - offset;
    const d1 = nx * p1.x + ny * p1.y - offset;
    if (d0 <= 0) out.push(p0);
    if (d1 <= 0) out.push(p1);
    if ((d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0)) {
      const t = d0 / (d0 - d1);
      out.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
    }
    return out;
  }

  function polygonPolygon(A, B) {
    const sa = findMaxSeparation(A, B);
    if (sa.sep > 0) return null;
    const sb = findMaxSeparation(B, A);
    if (sb.sep > 0) return null;

    // Choose the reference polygon, biased towards A for frame coherence.
    let ref, inc, refIndex, flip;
    if (sb.sep > sa.sep * 0.95 + 0.002) { ref = B; inc = A; refIndex = sb.index; flip = true; }
    else { ref = A; inc = B; refIndex = sa.index; flip = false; }

    const rv = ref.worldVertices, rn = ref.worldNormals[refIndex];
    const r1 = rv[refIndex], r2 = rv[(refIndex + 1) % rv.length];

    // Incident face: the face of `inc` most anti-parallel to the reference normal.
    const iv = inc.worldVertices, inn = inc.worldNormals;
    let incIndex = 0, minDot = Infinity;
    for (let i = 0; i < inn.length; i++) {
      const d = inn[i].x * rn.x + inn[i].y * rn.y;
      if (d < minDot) { minDot = d; incIndex = i; }
    }
    const i1 = iv[incIndex], i2 = iv[(incIndex + 1) % iv.length];

    // Clip the incident edge against the side planes of the reference face.
    let tx = r2.x - r1.x, ty = r2.y - r1.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    let pts = clipSegment([i1, i2], -tx, -ty, -(tx * r1.x + ty * r1.y));
    if (!pts.length) return null;
    pts = clipSegment(pts, tx, ty, tx * r2.x + ty * r2.y);
    if (!pts.length) return null;

    // Keep points behind the reference face, plus "speculative" points that
    // are within SPECULATIVE_MARGIN in front of it. Keeping nearly-touching
    // corners stops resting boxes from rocking between 1 and 2 contacts.
    const refOffset = rn.x * r1.x + rn.y * r1.y;
    const points = [];
    for (const p of pts) {
      const s = rn.x * p.x + rn.y * p.y - refOffset;
      if (s <= SPECULATIVE_MARGIN) points.push({ x: p.x, y: p.y, pen: -s });
    }
    if (!points.length) return null;
    return { nx: flip ? -rn.x : rn.x, ny: flip ? -rn.y : rn.y, points };
  }

  /** Dispatch on shape types. Returns a raw result with normal A -> B. */
  function collideShapes(a, b) {
    const ta = a.shape.type, tb = b.shape.type;
    if (ta === 'circle' && tb === 'circle') return circleCircle(a, b);
    if (ta === 'polygon' && tb === 'circle') return polygonCircle(a, b);
    if (ta === 'circle' && tb === 'polygon') {
      const r = polygonCircle(b, a);
      if (r) { r.nx = -r.nx; r.ny = -r.ny; }
      return r;
    }
    return polygonPolygon(a, b);
  }

  // ---------------------------------------------------------------------------
  // Contact manifold + sequential impulse solver
  // ---------------------------------------------------------------------------
  class Manifold {
    constructor(a, b, result) {
      this.a = a;
      this.b = b;
      this.normal = new Vec2(result.nx, result.ny);
      this.contacts = result.points.map((p) => ({
        x: p.x, y: p.y, pen: p.pen,
        rAx: 0, rAy: 0, rBx: 0, rBy: 0,
        Pn: 0, Pt: 0,            // accumulated normal / tangent impulses
        normalMass: 0, tangentMass: 0,
        bias: 0, vn0: 0, persisted: false
      }));
      this.friction = Materials.mixFriction(a.friction, b.friction);
      this.restitution = Materials.mixRestitution(a.restitution, b.restitution);
      this.key = pairKey(a, b);
    }

    /** Max penetration across contact points. */
    get penetration() {
      let p = 0;
      for (const c of this.contacts) if (c.pen > p) p = c.pen;
      return p;
    }

    /** Copy accumulated impulses from last step's manifold (warm starting). */
    matchPrevious(prev) {
      if (!prev) return;
      if (prev.normal.x * this.normal.x + prev.normal.y * this.normal.y < 0.95) return;
      for (const c of this.contacts) {
        let best = null, bestD = 0.0036; // 6 cm match radius
        for (const o of prev.contacts) {
          const dx = o.x - c.x, dy = o.y - c.y;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = o; }
        }
        if (best) { c.Pn = best.Pn; c.Pt = best.Pt; c.persisted = true; }
      }
    }

    /**
     * Precompute effective masses + velocity bias (warm starting is applied
     * separately by warmStart()). Sleeping bodies are treated as immovable.
     * Bias: for penetrating points it is the restitution target velocity; for
     * speculative (separated) points it allows closing the gap within one
     * step - unless the bodies would actually collide this step, in which case
     * the restitution target is used so bounces are not lost.
     */
    preStep(settings, dt) {
      const a = this.a, b = this.b;
      const imA = a.isAwakeDynamic ? a.invMass : 0, iiA = a.isAwakeDynamic ? a.invInertia : 0;
      const imB = b.isAwakeDynamic ? b.invMass : 0, iiB = b.isAwakeDynamic ? b.invInertia : 0;
      this.imA = imA; this.iiA = iiA; this.imB = imB; this.iiB = iiB;
      const nx = this.normal.x, ny = this.normal.y;
      const tx = -ny, ty = nx;

      for (const c of this.contacts) {
        c.rAx = c.x - a.position.x; c.rAy = c.y - a.position.y;
        c.rBx = c.x - b.position.x; c.rBy = c.y - b.position.y;

        const rnA = c.rAx * ny - c.rAy * nx, rnB = c.rBx * ny - c.rBy * nx;
        const kN = imA + imB + iiA * rnA * rnA + iiB * rnB * rnB;
        c.normalMass = kN > 0 ? 1 / kN : 0;

        const rtA = c.rAx * ty - c.rAy * tx, rtB = c.rBx * ty - c.rBy * tx;
        const kT = imA + imB + iiA * rtA * rtA + iiB * rtB * rtB;
        c.tangentMass = kT > 0 ? 1 / kT : 0;

        // Relative velocity at the contact (B relative to A).
        const dvx = b.velocity.x - b.angularVelocity * c.rBy - a.velocity.x + a.angularVelocity * c.rAy;
        const dvy = b.velocity.y + b.angularVelocity * c.rBx - a.velocity.y - a.angularVelocity * c.rAx;
        const vn = dvx * nx + dvy * ny;
        c.vn0 = vn;
        const sep = -c.pen;
        const bounce = vn < -settings.restitutionThreshold ? -this.restitution * vn : 0;
        if (sep > 0) {
          c.bias = (vn * dt + sep < 0) ? bounce : -sep / dt;
          if (vn * dt + sep >= 0) c.vn0 = 0; // will not touch this step: no impact event
        } else {
          c.bias = bounce;
        }

        if (!(settings.warmStarting && c.persisted)) { c.Pn = 0; c.Pt = 0; }
      }
    }

    /**
     * Apply last step's accumulated impulses (warm starting). Must run after
     * preStep has been called on ALL manifolds, otherwise restitution biases
     * would be computed from velocities already altered by warm starting.
     */
    warmStart() {
      const a = this.a, b = this.b;
      const imA = this.imA, iiA = this.iiA, imB = this.imB, iiB = this.iiB;
      const nx = this.normal.x, ny = this.normal.y;
      const tx = -ny, ty = nx;
      for (const c of this.contacts) {
        if (c.Pn === 0 && c.Pt === 0) continue;
        const Px = c.Pn * nx + c.Pt * tx, Py = c.Pn * ny + c.Pt * ty;
        a.velocity.x -= Px * imA; a.velocity.y -= Py * imA;
        a.angularVelocity -= iiA * (c.rAx * Py - c.rAy * Px);
        b.velocity.x += Px * imB; b.velocity.y += Py * imB;
        b.angularVelocity += iiB * (c.rBx * Py - c.rBy * Px);
      }
    }

    /**
     * One Gauss-Seidel iteration over this manifold's contact points.
     * Friction is solved first and non-penetration last (as in Box2D), so
     * the normal constraint - the more important one - has the final say.
     */
    solveVelocity() {
      const a = this.a, b = this.b;
      const imA = this.imA, iiA = this.iiA, imB = this.imB, iiB = this.iiB;
      const nx = this.normal.x, ny = this.normal.y;
      const tx = -ny, ty = nx;
      const va = a.velocity, vb = b.velocity;
      const contacts = this.contacts;

      // --- Friction impulses (Coulomb cone clamped by the normal impulse) ---
      for (let i = 0; i < contacts.length; i++) {
        const c = contacts[i];
        const dvx = vb.x - b.angularVelocity * c.rBy - va.x + a.angularVelocity * c.rAy;
        const dvy = vb.y + b.angularVelocity * c.rBx - va.y - a.angularVelocity * c.rAx;
        const vt = dvx * tx + dvy * ty;
        const maxPt = this.friction * c.Pn;
        const Pt0 = c.Pt;
        c.Pt = Math.max(-maxPt, Math.min(Pt0 - c.tangentMass * vt, maxPt));
        const dPt = c.Pt - Pt0;
        const Px = dPt * tx, Py = dPt * ty;
        va.x -= Px * imA; va.y -= Py * imA;
        a.angularVelocity -= iiA * (c.rAx * Py - c.rAy * Px);
        vb.x += Px * imB; vb.y += Py * imB;
        b.angularVelocity += iiB * (c.rBx * Py - c.rBy * Px);
      }

      // --- Normal impulses (non-penetration + restitution) ---
      for (let i = 0; i < contacts.length; i++) {
        const c = contacts[i];
        const dvx = vb.x - b.angularVelocity * c.rBy - va.x + a.angularVelocity * c.rAy;
        const dvy = vb.y + b.angularVelocity * c.rBx - va.y - a.angularVelocity * c.rAx;
        const vn = dvx * nx + dvy * ny;
        const Pn0 = c.Pn;
        c.Pn = Math.max(Pn0 + c.normalMass * (-vn + c.bias), 0);
        const dPn = c.Pn - Pn0;
        const Px = dPn * nx, Py = dPn * ny;
        va.x -= Px * imA; va.y -= Py * imA;
        a.angularVelocity -= iiA * (c.rAx * Py - c.rAy * Px);
        vb.x += Px * imB; vb.y += Py * imB;
        b.angularVelocity += iiB * (c.rBx * Py - c.rBy * Px);
      }
    }

    /** Linear projection to remove penetration beyond the allowed slop. */
    correctPositions(settings) {
      const imSum = this.imA + this.imB;
      if (imSum <= 0) return;
      const pen = this.penetration;
      const corr = Math.max(pen - settings.slop, 0) / imSum * settings.correctionPercent;
      if (corr <= 0) return;
      const n = this.normal;
      this.a.position.x -= n.x * corr * this.imA;
      this.a.position.y -= n.y * corr * this.imA;
      this.b.position.x += n.x * corr * this.imB;
      this.b.position.y += n.y * corr * this.imB;
    }
  }

  /** Full narrowphase: returns a Manifold or null. */
  function collide(a, b) {
    const r = collideShapes(a, b);
    return r ? new Manifold(a, b, r) : null;
  }

  App1.Collision = {
    SpatialHash,
    Manifold,
    pairKey,
    aabbOverlap,
    collide,
    // Exposed for tests / extension.
    circleCircle, polygonCircle, polygonPolygon
  };
})(window.App1 = window.App1 || {});
