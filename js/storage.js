/**
 * App1 - storage.js
 * ----------------------------------------------------------------------------
 * Simulation (de)serialisation, localStorage save slots and JSON file
 * export/import.
 *
 * Snapshot format (version 1):
 * {
 *   format: 'app1-simulation', version: 1, savedAt: ISO string,
 *   settings: { gravity: {x,y}, wind },
 *   bounds: { width, height },
 *   camera: { x, y, zoom },
 *   nextGroup,
 *   bodies: [Body.toJSON()...],
 *   constraints: [Constraint.toJSON()...]   (bodies referenced by id)
 * }
 */
(function (App1) {
  'use strict';
  const { Body, Constraints, MathUtil } = App1;

  const FORMAT = 'app1-simulation';
  const VERSION = 1;
  const SLOT_PREFIX = 'app1.slot.';
  const SLOT_COUNT = 3;

  /** Build a plain-object snapshot of the world (and camera). */
  function serialize(world, camera) {
    return {
      format: FORMAT,
      version: VERSION,
      savedAt: new Date().toISOString(),
      settings: { gravity: world.gravity.toJSON(), wind: world.wind },
      bounds: Object.assign({}, world.bounds),
      camera: camera ? camera.toJSON() : null,
      nextGroup: world.nextGroup,
      bodies: world.bodies.map((b) => b.toJSON()),
      constraints: world.constraints.map((c) => c.toJSON()).filter(Boolean)
    };
  }

  /** Throw a readable error if `data` is not a valid snapshot. */
  function validate(data) {
    if (!data || typeof data !== 'object') throw new Error('File is not a JSON object.');
    if (data.format !== FORMAT) throw new Error('Not an App1 simulation file.');
    if (!Number.isInteger(data.version) || data.version > VERSION) throw new Error('Unsupported file version: ' + data.version);
    if (!Array.isArray(data.bodies)) throw new Error('Snapshot has no bodies array.');
  }

  /**
   * Replace the world's contents with a snapshot. Bodies are rebuilt first so
   * constraints can resolve their body ids. Invalid entries are skipped.
   * @returns {{bodies:number, constraints:number, skipped:number}}
   */
  function deserialize(data, world, camera) {
    validate(data);
    // Build everything first so a bad file cannot leave the world half-loaded.
    Body.resetIds(1);
    const bodies = [];
    const byId = new Map();
    let skipped = 0;
    for (const bd of data.bodies) {
      try {
        const b = Body.fromJSON(bd);
        if (byId.has(b.id)) { skipped++; continue; } // duplicate id
        bodies.push(b);
        byId.set(b.id, b);
      } catch (err) {
        skipped++;
      }
    }
    const constraints = [];
    for (const cd of Array.isArray(data.constraints) ? data.constraints : []) {
      try {
        const c = Constraints.fromJSON(cd, byId);
        if (c) constraints.push(c); else skipped++;
      } catch (err) {
        skipped++;
      }
    }

    world.clear(false);
    let maxId = 0;
    for (const b of bodies) { world.addBody(b); maxId = Math.max(maxId, b.id); }
    Body.resetIds(maxId + 1);
    world.constraints = constraints;
    if (data.bounds) {
      world.bounds = {
        width: MathUtil.num(data.bounds.width, world.bounds.width),
        height: MathUtil.num(data.bounds.height, world.bounds.height)
      };
    }
    world.nextGroup = Number.isInteger(data.nextGroup) ? data.nextGroup
      : bodies.reduce((m, b) => Math.max(m, b.group + 1), 1);
    if (data.settings) {
      if (data.settings.gravity) world.gravity.set(MathUtil.num(data.settings.gravity.x), MathUtil.num(data.settings.gravity.y, 9.81));
      world.wind = MathUtil.num(data.settings.wind, 0);
    }
    if (camera && data.camera) camera.fromJSON(data.camera);
    return { bodies: bodies.length, constraints: constraints.length, skipped };
  }

  // ---------------------------------------------------------------------------
  // localStorage slots (wrapped: storage may be unavailable, e.g. privacy mode)
  // ---------------------------------------------------------------------------
  function storageAvailable() {
    try {
      const k = '__app1_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (_) {
      return false;
    }
  }

  const Slots = {
    count: SLOT_COUNT,

    /** Metadata for every slot: { index, empty, savedAt, bodies } */
    list() {
      const out = [];
      for (let i = 1; i <= SLOT_COUNT; i++) {
        let meta = { index: i, empty: true };
        try {
          const raw = window.localStorage.getItem(SLOT_PREFIX + i);
          if (raw) {
            const d = JSON.parse(raw);
            meta = { index: i, empty: false, savedAt: d.savedAt, bodies: Array.isArray(d.bodies) ? d.bodies.length : 0 };
          }
        } catch (_) { /* treat unreadable slot as empty */ }
        out.push(meta);
      }
      return out;
    },

    save(index, snapshot) {
      window.localStorage.setItem(SLOT_PREFIX + index, JSON.stringify(snapshot));
    },

    load(index) {
      const raw = window.localStorage.getItem(SLOT_PREFIX + index);
      if (!raw) throw new Error('Slot ' + index + ' is empty.');
      return JSON.parse(raw);
    },

    remove(index) { window.localStorage.removeItem(SLOT_PREFIX + index); }
  };

  // ---------------------------------------------------------------------------
  // File export / import
  // ---------------------------------------------------------------------------
  function exportFile(snapshot, filename) {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `app1-simulation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Read a File object and resolve with the parsed JSON. */
  function importFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error('No file selected.')); return; }
      if (file.size > 20 * 1024 * 1024) { reject(new Error('File is too large.')); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(reader.result)); }
        catch (err) { reject(new Error('File is not valid JSON.')); }
      };
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsText(file);
    });
  }

  App1.Storage = { FORMAT, VERSION, serialize, deserialize, validate, storageAvailable, Slots, exportFile, importFile };
})(window.App1 = window.App1 || {});
