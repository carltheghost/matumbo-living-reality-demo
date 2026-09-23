const TYPES = new Set(['select', 'summon', 'dismiss', 'move', 'zoom', 'navigate', 'voice-command']);
const SOURCES = new Set(['hand', 'pinch', 'gaze', 'touch', 'voice', 'xr']);

export function createIntentStream() {
  let nextId = 1;
  let dropped = 0;
  const listeners = new Set();

  function emit(raw) {
    const source = raw?.source;
    if (!SOURCES.has(source)) {
      dropped += 1;
      return null;
    }

    let type = null;
    let payload = raw?.payload;

    if (source === 'gaze' && Number(raw?.dwellMs) >= 800) {
      type = 'select';
    } else if (source === 'pinch') {
      type = 'select';
    } else if (source === 'hand' && raw?.gesture === 'grab') {
      type = 'move';
    } else if (raw?.gesture === 'swipe') {
      type = 'navigate';
    } else if (source === 'voice' && typeof raw?.transcript === 'string' && raw.transcript.length > 0) {
      type = 'voice-command';
      payload = { transcript: raw.transcript };
    } else if (source === 'touch' && (raw?.gesture === 'tap' || raw?.gesture === 'touch')) {
      type = 'select';
    } else if (source === 'xr' && raw?.gesture === 'select') {
      type = 'select';
    }

    if (!TYPES.has(type)) {
      dropped += 1;
      return null;
    }

    const intent = Object.freeze({
      schemaVersion: 1,
      id: `li${nextId++}`,
      type,
      source,
      targetId: raw?.targetId,
      coordinates: {
        x: raw?.x,
        y: raw?.y
      },
      timestamp: raw?.timestamp,
      confidence: raw?.confidence,
      localOnly: true,
      payload
    });

    for (const listener of listeners) listener(intent);
    return intent;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({ emit, subscribe, getDroppedCount: () => dropped });
}
