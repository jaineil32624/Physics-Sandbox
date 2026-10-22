/**
 * App1 - particles.js
 * ----------------------------------------------------------------------------
 * Lightweight, purely visual particle system (particles never affect bodies).
 * Particles live in world space (meters) and use a fixed-size pool so that
 * spamming explosions cannot grow memory without bound.
 *
 * Kinds (drawn by renderer.js):
 *   spark  - bright streak aligned with velocity (metal)
 *   debris - small tumbling square chip (wood, rubber)
 *   shard  - thin triangle (ice)
 *   smoke  - large soft circle that grows and fades
 *   fire   - additive glowing blob
 *   ring   - expanding shockwave ring (explosions)
 */
(function (App1) {
  'use strict';
  const { MathUtil } = App1;
  const rand = MathUtil.randRange;

  class ParticleSystem {
    constructor(maxParticles = 1800) {
      this.max = maxParticles;
      this.particles = [];
      this.enabled = true;
    }

    get count() { return this.particles.length; }
    clear() { this.particles.length = 0; }

    /** Add one particle; oldest particles are recycled when the pool is full. */
    emit(p) {
      if (!this.enabled) return;
      if (this.particles.length >= this.max) this.particles.shift();
      this.particles.push(Object.assign({
        x: 0, y: 0, vx: 0, vy: 0,
        life: 1, maxLife: 1,
        size: 0.06, grow: 0,
        angle: 0, spin: 0,
        gravity: 1, drag: 0.5,
        color: '#fff', kind: 'debris'
      }, p));
    }

    /**
     * Impact burst. `strength` is the impact speed (m/s); `material` decides
     * the look (see materials.js `particles`).
     */
    impact(x, y, nx, ny, strength, material) {
      const cfg = material ? material.particles : { kind: 'debris', colors: ['#bbb'] };
      const n = Math.min(4 + Math.floor(strength * 1.5), 30);
      for (let i = 0; i < n; i++) {
        // Spray roughly along +/- normal with lots of spread.
        const side = Math.random() < 0.5 ? 1 : -1;
        const ang = Math.atan2(ny * side, nx * side) + rand(-1.2, 1.2);
        const sp = rand(0.2, 0.6) * strength;
        const life = cfg.kind === 'spark' ? rand(0.2, 0.5) : rand(0.4, 0.9);
        this.emit({
          x, y,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - rand(0, 1.5),
          life, maxLife: life,
          size: cfg.kind === 'spark' ? rand(0.02, 0.04) : rand(0.04, 0.1),
          angle: rand(0, Math.PI * 2), spin: rand(-15, 15),
          gravity: cfg.kind === 'spark' ? 0.6 : 1,
          drag: cfg.kind === 'spark' ? 1.5 : 0.8,
          color: cfg.colors[(Math.random() * cfg.colors.length) | 0],
          kind: cfg.kind
        });
      }
      // A puff of dust for very hard hits.
      if (strength > 9) {
        for (let i = 0; i < 4; i++) {
          const life = rand(0.5, 1.0);
          this.emit({ x, y, vx: rand(-1, 1), vy: rand(-1.5, 0), life, maxLife: life, size: rand(0.15, 0.3), grow: 0.8, gravity: -0.05, drag: 2, color: 'rgba(200,200,210,1)', kind: 'smoke' });
        }
      }
    }

    /** Explosion: shockwave ring, fireball, sparks and smoke. */
    explosion(x, y, radius) {
      this.emit({ x, y, life: 0.45, maxLife: 0.45, size: 0.2, grow: radius * 2.6, gravity: 0, drag: 0, color: '#ffe3a3', kind: 'ring' });
      for (let i = 0; i < 26; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(1, 5) * radius / 3;
        const life = rand(0.25, 0.6);
        this.emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, maxLife: life, size: rand(0.2, 0.5) * radius / 3, grow: 0.6, gravity: -0.2, drag: 3, color: ['#fff3b0', '#ffb347', '#ff6a2b'][i % 3], kind: 'fire' });
      }
      for (let i = 0; i < 40; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(6, 18) * radius / 3;
        const life = rand(0.3, 0.8);
        this.emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, maxLife: life, size: rand(0.02, 0.05), gravity: 0.7, drag: 1.2, color: ['#fff6c2', '#ffd36b', '#ff9c3b'][i % 3], kind: 'spark' });
      }
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(0.5, 2.5);
        const life = rand(0.9, 1.8);
        this.emit({ x: x + rand(-0.3, 0.3), y: y + rand(-0.3, 0.3), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.6, life, maxLife: life, size: rand(0.3, 0.6) * radius / 3, grow: 1.2, gravity: -0.08, drag: 1.5, color: 'rgba(90,90,100,1)', kind: 'smoke' });
      }
    }

    /** Small "poof" used when a body is deleted. */
    poof(x, y, size, color) {
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(1, 4);
        const life = rand(0.3, 0.7);
        this.emit({ x: x + Math.cos(a) * size * 0.3, y: y + Math.sin(a) * size * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, maxLife: life, size: rand(0.05, 0.12), spin: rand(-10, 10), gravity: 0.3, drag: 2, color, kind: 'debris' });
      }
    }

    /** Advance particles. `gravity` is the world gravity vector. */
    update(dt, gravity) {
      const ps = this.particles;
      let w = 0;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        p.life -= dt;
        if (p.life <= 0) continue;
        const damp = 1 / (1 + p.drag * dt);
        p.vx = (p.vx + gravity.x * p.gravity * dt) * damp;
        p.vy = (p.vy + gravity.y * p.gravity * dt) * damp;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.angle += p.spin * dt;
        p.size += p.grow * dt;
        ps[w++] = p;
      }
      ps.length = w;
    }
  }

  App1.ParticleSystem = ParticleSystem;
})(window.App1 = window.App1 || {});
