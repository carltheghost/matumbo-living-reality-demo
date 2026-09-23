const STATES = Object.freeze({
  DORMANT: "dormant",
  MATERIALIZING: "materializing",
  LIVE: "live",
  DISMISSING: "dismissing",
});

const TRANSITIONS = Object.freeze({
  dormant: Object.freeze({
    summon: "materializing",
  }),
  materializing: Object.freeze({
    markMaterialized: "live",
  }),
  live: Object.freeze({
    dismiss: "dismissing",
  }),
  dismissing: Object.freeze({
    markDisposed: "dormant",
  }),
});

export function createLifecycle() {
  const states = new Map();
  const contexts = new Map();
  const listeners = new Set();

  const getState = (id) => states.get(id) ?? STATES.DORMANT;

  const transition = (id, action, event, context) => {
    const current = getState(id);
    const next = TRANSITIONS[current]?.[action];

    if (!next) {
      throw new Error(
        `Illegal lifecycle transition for "${id}": ${current} -> ${action}`,
      );
    }

    states.set(id, next);

    if (action === "summon") {
      contexts.set(id, context);
    } else if (action === "markDisposed") {
      contexts.delete(id);
    }

    const payload = Object.freeze({
      type: event,
      id,
      state: next,
      ...(context === undefined ? {} : { context }),
    });

    for (const listener of listeners) {
      listener(payload);
    }

    return next;
  };

  return Object.freeze({
    getState,

    summon(id, ctx) {
      return transition(id, "summon", "summoned", ctx);
    },

    markMaterialized(id) {
      return transition(id, "markMaterialized", "materialized");
    },

    dismiss(id, reason) {
      return transition(id, "dismiss", "dismissing", reason);
    },

    markDisposed(id) {
      return transition(id, "markDisposed", "dismissed");
    },

    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Lifecycle subscriber must be a function");
      }

      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  });
}

export { STATES };