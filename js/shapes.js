/**
 * App1 - shapes.js
 * ----------------------------------------------------------------------------
 * Collision shapes in BODY-LOCAL space. Shapes are immutable geometric
 * descriptions; the world-space copies (rotated/translated vertices) are kept
 * on the Body (see body.js) so a single shape could be shared.
 *
 *   Circle  { type: 'circle', radius }
 *   Polygon { type: 'polygon', vertices[], normals[] }  (convex, centroid at 0,0)
 *
 * Polygons are always stored counter-clockwise in math orientation (positive
 * signed area) so the outward normal of edge (v[i] -> v[i+1]) is (e.y, -e.x).
 */
(function (App1) {
  'use strict';
  const { Vec2 } = App1;

  class Circle {
    constructor(radius) {
      this.type = 'circle';
      this.radius = Math.max(0.01, radius);
    }

    /** Mass properties for a given density. Inertia is about the centroid. */
    computeMass(density) {
      const mass = Math.PI * this.radius * this.radius * density;
      return { mass, inertia: 0.5 * mass * this.radius * this.radius, area: Math.PI * this.radius * this.radius };
    }

    get boundingRadius() { return this.radius; }
    clone() { return new Circle(this.radius); }
    toJSON() { return { type: 'circle', radius: this.radius }; }
  }

  /**
   * Andrew's monotone chain convex hull. Returns CCW (positive area) hull.
   * Guarantees that any polygon we simulate is convex, even from bad JSON.
   */
  function convexHull(points) {
    const pts = points.map((p) => new Vec2(p.x, p.y)).sort((a, b) => (a.x - b.x) || (a.y - b.y));
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }

  class Polygon {
    /**
     * @param {Array<{x:number,y:number}>} vertices  any convex point set; it is
     *        hulled, wound CCW and re-centred so the centroid is the origin.
     */
    constructor(vertices) {
      this.type = 'polygon';
      let verts = convexHull(vertices);
      if (verts.length < 3) {
        // Degenerate input: fall back to a tiny square so the engine never breaks.
        verts = [new Vec2(-0.1, -0.1), new Vec2(0.1, -0.1), new Vec2(0.1, 0.1), new Vec2(-0.1, 0.1)];
      }
      // Re-centre on the centroid so the body's position is its centre of mass.
      const c = Polygon.centroid(verts);
      this.vertices = verts.map((v) => new Vec2(v.x - c.x, v.y - c.y));
      this.normals = [];
      const n = this.vertices.length;
      for (let i = 0; i < n; i++) {
        const a = this.vertices[i], b = this.vertices[(i + 1) % n];
        this.normals.push(new Vec2(b.y - a.y, -(b.x - a.x)).normalize());
      }
      let r = 0;
      for (const v of this.vertices) r = Math.max(r, v.length());
      this._boundingRadius = r;
    }

    static centroid(verts) {
      let area = 0, cx = 0, cy = 0;
      const n = verts.length;
      for (let i = 0; i < n; i++) {
        const a = verts[i], b = verts[(i + 1) % n];
        const cr = a.x * b.y - a.y * b.x;
        area += cr;
        cx += (a.x + b.x) * cr;
        cy += (a.y + b.y) * cr;
      }
      area *= 0.5;
      if (Math.abs(area) < 1e-12) return new Vec2(0, 0);
      return new Vec2(cx / (6 * area), cy / (6 * area));
    }

    computeMass(density) {
      // Sum of triangles (origin, v1, v2); vertices are centred on the centroid.
      let area = 0, inertia = 0;
      const n = this.vertices.length;
      for (let i = 0; i < n; i++) {
        const a = this.vertices[i], b = this.vertices[(i + 1) % n];
        const D = a.x * b.y - a.y * b.x;
        area += 0.5 * D;
        inertia += (D / 12) * (a.x * a.x + a.x * b.x + b.x * b.x + a.y * a.y + a.y * b.y + b.y * b.y);
      }
      return { mass: area * density, inertia: inertia * density, area };
    }

    get boundingRadius() { return this._boundingRadius; }
    clone() { return new Polygon(this.vertices); }
    toJSON() { return { type: 'polygon', vertices: this.vertices.map((v) => ({ x: v.x, y: v.y })) }; }
  }

  /** Factory helpers + (de)serialisation. */
  const Shapes = {
    Circle,
    Polygon,
    convexHull,

    circle(radius) { return new Circle(radius); },

    box(width, height = width) {
      const hw = width / 2, hh = height / 2;
      return new Polygon([new Vec2(-hw, -hh), new Vec2(hw, -hh), new Vec2(hw, hh), new Vec2(-hw, hh)]);
    },

    /** Regular n-gon with circumradius `radius`. */
    regular(sides, radius, rotation = 0) {
      const verts = [];
      for (let i = 0; i < sides; i++) {
        const a = rotation + (i / sides) * Math.PI * 2;
        verts.push(new Vec2(Math.cos(a) * radius, Math.sin(a) * radius));
      }
      return new Polygon(verts);
    },

    /** Equilateral triangle with the given side length, pointing up (-y). */
    triangle(side) {
      const r = side / Math.sqrt(3);
      return Shapes.regular(3, r, -Math.PI / 2);
    },

    /** Build a shape from the user-facing kind used by the UI. */
    fromKind(kind, size) {
      switch (kind) {
        case 'circle': return new Circle(size / 2);
        case 'triangle': return Shapes.triangle(size * 1.15);
        case 'square':
        default: return Shapes.box(size, size);
      }
    },

    fromJSON(data) {
      if (!data || typeof data !== 'object') throw new Error('Invalid shape');
      if (data.type === 'circle') return new Circle(Number(data.radius) || 0.5);
      if (data.type === 'polygon' && Array.isArray(data.vertices)) {
        return new Polygon(data.vertices.map((v) => Vec2.from(v)));
      }
      throw new Error('Unknown shape type: ' + data.type);
    }
  };

  App1.Shapes = Shapes;
})(window.App1 = window.App1 || {});
