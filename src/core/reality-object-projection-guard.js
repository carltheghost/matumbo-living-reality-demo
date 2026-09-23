JavaScript
export function createProjectionGuard() {
  const dormant = new Set();
  const projected = new Set();

  function assertId(id) {
    if (typeof id !== 'string') {
      throw new TypeError('Reality Object id must be a string');
    }
  }

  const guard = {
    markDormant(id) {
      assertId(id);
      dormant.add(id);
    },

    markProjected(id) {
      assertId(id);

      if (dormant.has(id)) {
        throw new Error(`Dormant Reality Object cannot be projected: ${id}`);
      }

      projected.add(id);
    },

    undormant(id) {
      assertId(id);
      dormant.delete(id);
    },

    isDormant(id) {
      assertId(id);
      return dormant.has(id);
    },

    isProjected(id) {
      assertId(id);
      return projected.has(id);
    },

    projectedIds() {
      return Array.from(projected);
    },

    assertClean() {
      for (const id of dormant) {
        if (projected.has(id)) {
          throw new Error(`Projection guard violation: ${id} is dormant and projected`);
        }
      }
    },

    reset() {
      dormant.clear();
      projected.clear();
    }
  };

  return Object.freeze(guard);
}