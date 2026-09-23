const STATES = Object.freeze({
  DORMANT: 'dormant',
  MATERIALIZING: 'materializing',
  LIVE: 'live',
  DISMISSING: 'dismissing',
});

const TRANSITIONS = Object.freeze({
  dormant: Object.freeze({
    summon: 'materializing',
  }),
  materializing: Object.freeze({
    ready: 'live',
  }),
  live: Object.freeze({
    dismiss: 'dismissing',
  }),
  dismissing: Object.freeze({
    rest: 'dormant',
  }),
});

function assertId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('Object id must be a non-empty string');
  }
}

export function createEngine() {
  const states = new Map();
  const history = [];

  function getState(id) {
    assertId(id);
    return states.get(id) ?? STATES.DORMANT;
  }

  function transition(id, action) {
    assertId(id);

    const from = getState(id);
    const to = TRANSITIONS[from]?.[action];

    if (!to) {
      throw new Error(
        `Illegal materialization transition for "${id}": ${action} cannot move ${from} -> ${action}`,
      );
    }

    const entry = Object.freeze({
      seq: history.length,
      id,
      action,
      from,
      to,
    });

    states.set(id, to);
    history.push(entry);

    return to;
  }

  function summon(id) {
    return transition(id, 'summon');
  }

  function ready(id) {
    return transition(id, 'ready');
  }

  function dismiss(id) {
    return transition(id, 'dismiss');
  }

  function rest(id) {
    return transition(id, 'rest');
  }

  function journal() {
    return history.slice();
  }

  return Object.freeze({
    summon,
    ready,
    dismiss,
    rest,
    getState,
    journal,
  });
}
