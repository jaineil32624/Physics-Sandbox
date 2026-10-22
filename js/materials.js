/**
 * App1 - materials.js
 * ----------------------------------------------------------------------------
 * Material definitions. A material bundles PHYSICAL properties (density,
 * friction, restitution) with VISUAL properties (palette + painter style) and
 * the look of the particles emitted on hard impacts.
 *
 * Units:
 *   density      kg / m^2 (2D "areal" density; mass = area * density)
 *   friction     Coulomb coefficient, mixed per contact with sqrt(a * b)
 *   restitution  bounciness 0..1, mixed per contact with max(a, b)
 *
 * To add a material, call App1.Materials.register({...}) (or add an entry
 * below). `style` must name a painter registered in renderer.js
 * (grain | brushed | matte | glass | static) or a painter you add yourself.
 */
(function (App1) {
  'use strict';

  /** @type {Object<string, object>} */
  const registry = {};
  /** Keys a user may pick in the UI, in display order. */
  const selectable = [];

  function register(def, { userSelectable = true } = {}) {
    if (!def || !def.key) throw new Error('Material needs a key');
    const material = Object.freeze({
      key: def.key,
      name: def.name || def.key,
      density: def.density,
      friction: def.friction,
      restitution: def.restitution,
      style: def.style || 'matte',
      colors: Object.freeze(Object.assign({ base: '#888', light: '#aaa', dark: '#555', stroke: '#333' }, def.colors)),
      particles: Object.freeze(Object.assign({ kind: 'debris', colors: ['#999'] }, def.particles)),
      description: def.description || ''
    });
    registry[material.key] = material;
    if (userSelectable && !selectable.includes(material.key)) selectable.push(material.key);
    return material;
  }

  register({
    key: 'wood', name: 'Wood',
    density: 50, friction: 0.55, restitution: 0.2,
    style: 'grain',
    colors: { base: '#b9834c', light: '#d8a96f', dark: '#80542a', stroke: '#5a3817' },
    particles: { kind: 'debris', colors: ['#c8935a', '#9a6634', '#e0b27a'] },
    description: 'Light, grippy, low bounce.'
  });

  register({
    key: 'metal', name: 'Metal',
    density: 200, friction: 0.35, restitution: 0.25,
    style: 'brushed',
    colors: { base: '#8e99a6', light: '#dfe6ee', dark: '#4f5964', stroke: '#2f363e' },
    particles: { kind: 'spark', colors: ['#fff6c2', '#ffd36b', '#ff9c3b'] },
    description: 'Very heavy, sparks on impact.'
  });

  register({
    key: 'rubber', name: 'Rubber',
    density: 90, friction: 0.95, restitution: 0.82,
    style: 'matte',
    colors: { base: '#e0465a', light: '#f27486', dark: '#9c2232', stroke: '#4a0f18' },
    particles: { kind: 'debris', colors: ['#e0465a', '#5a1d26', '#ff8a99'] },
    description: 'Bouncy with high grip.'
  });

  register({
    key: 'ice', name: 'Ice',
    density: 75, friction: 0.02, restitution: 0.08,
    style: 'glass',
    colors: { base: 'rgba(170, 225, 255, 0.55)', light: '#ffffff', dark: '#5fb4e6', stroke: '#d9f3ff' },
    particles: { kind: 'shard', colors: ['#e6f7ff', '#a8dcff', '#ffffff'] },
    description: 'Almost frictionless, shatters into shards.'
  });

  // Material used for the ground and walls; not offered in the UI.
  register({
    key: 'static', name: 'Ground',
    density: 0, friction: 0.6, restitution: 0.1,
    style: 'static',
    colors: { base: '#2b3446', light: '#3b475e', dark: '#1d2432', stroke: '#56637d' },
    particles: { kind: 'debris', colors: ['#56637d', '#7b88a3'] }
  }, { userSelectable: false });

  App1.Materials = {
    register,
    /** Get a material by key (falls back to wood for unknown keys). */
    get(key) { return registry[key] || registry.wood; },
    has(key) { return Object.prototype.hasOwnProperty.call(registry, key); },
    /** Materials the user may choose, in display order. */
    list() { return selectable.map((k) => registry[k]); },
    keys() { return selectable.slice(); },
    /** Combine two friction coefficients (geometric mean, like Box2D). */
    mixFriction(a, b) { return Math.sqrt(a * b); },
    /** Combine two restitution coefficients (the bouncier one wins). */
    mixRestitution(a, b) { return Math.max(a, b); }
  };
})(window.App1 = window.App1 || {});
