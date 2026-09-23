JavaScript
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }

  seen.add(value);

  for (const key of Object.keys(value)) {
    deepFreeze(value[key], seen);
  }

  return Object.freeze(value);
}

export function fnv1a(input) {
  const text = String(input);
  let hash = FNV_OFFSET_BASIS;

  for (let i = 0; i < text.length; i += 1) {
    const codePoint = text.codePointAt(i);

    if (codePoint > 0xffff) {
      i += 1;
    }

    const bytes = codePoint <= 0x7f
      ? [codePoint]
      : codePoint <= 0x7ff
        ? [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)]
        : codePoint <= 0xffff
          ? [
              0xe0 | (codePoint >> 12),
              0x80 | ((codePoint >> 6) & 0x3f),
              0x80 | (codePoint & 0x3f),
            ]
          : [
              0xf0 | (codePoint >> 18),
              0x80 | ((codePoint >> 12) & 0x3f),
              0x80 | ((codePoint >> 6) & 0x3f),
              0x80 | (codePoint & 0x3f),
            ];

    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
  }

  return hash.toString(16).padStart(8, '0');
}

function canonicalEntryFields({ seq, prevHash, type, objectId, payload, at }) {
  return canonicalize({
    at,
    objectId,
    payload,
    prevHash,
    seq,
    type,
  });
}

function calculateHash(fields) {
  return fnv1a(
    `${fields.prevHash}${canonicalEntryFields(fields)}`,
  );
}

function validatePayload(payload) {
  if (payload === null || typeof payload !== 'object') {
    throw new TypeError('Entry payload must be an object or array');
  }

  if (payload instanceof Date) {
    throw new TypeError('Entry payload must be JSON-compatible');
  }
}

function validateEntryShape(entry, expectedSeq) {
  if (!isPlainObject(entry)) {
    throw new Error('Invalid log entry shape');
  }

  const requiredKeys = [
    'seq',
    'prevHash',
    'hash',
    'type',
    'objectId',
    'payload',
    'at',
  ];

  if (
    Object.keys(entry).length !== requiredKeys.length ||
    requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(entry, key))
  ) {
    throw new Error('Invalid log entry shape');
  }

  if (!Number.isSafeInteger(entry.seq) || entry.seq !== expectedSeq) {
    throw new Error('Invalid log sequence');
  }

  if (typeof entry.prevHash !== 'string' || !/^[0-9a-f]{8}$/.test(entry.prevHash)) {
    throw new Error('Invalid previous hash');
  }

  if (typeof entry.hash !== 'string' || !/^[0-9a-f]{8}$/.test(entry.hash)) {
    throw new Error('Invalid hash');
  }

  if (typeof entry.type !== 'string' || entry.type.length === 0) {
    throw new Error('Invalid entry type');
  }

  if (typeof entry.objectId !== 'string' || entry.objectId.length === 0) {
    throw new Error('Invalid object id');
  }

  validatePayload(entry.payload);

  if (!Number.isSafeInteger(entry.at)) {
    throw new Error('Invalid entry time');
  }

  const expectedHash = calculateHash(entry);

  if (entry.hash !== expectedHash) {
    throw new Error(`Broken hash at sequence ${entry.seq}`);
  }
}

function cloneForImport(value) {
  if (Array.isArray(value)) {
    return value.map(cloneForImport);
  }

  if (isPlainObject(value)) {
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = cloneForImport(value[key]);
    }
    return result;
  }

  return value;
}

export function createSpacetimeLog() {
  const history = [];

  const append = ({ type, objectId, payload }) => {
    if (typeof type !== 'string' || type.length === 0) {
      throw new TypeError('type must be a non-empty string');
    }

    if (typeof objectId !== 'string' || objectId.length === 0) {
      throw new TypeError('objectId must be a non-empty string');
    }

    validatePayload(payload);

    const seq = history.length;
    const prevHash = seq === 0 ? '00000000' : history[seq - 1].hash;
    const at = seq;

    const fields = {
      seq,
      prevHash,
      hash: '',
      type,
      objectId,
      payload: cloneForImport(payload),
      at,
    };

    fields.hash = calculateHash(fields);

    const entry = deepFreeze(fields);
    history.push(entry);

    return entry;
  };

  const entries = ({ type, objectId, sinceSeq } = {}) => {
    const startSeq = sinceSeq === undefined ? 0 : sinceSeq;

    if (!Number.isSafeInteger(startSeq) || startSeq < 0) {
      throw new TypeError('sinceSeq must be a non-negative safe integer');
    }

    return history.filter((entry) => (
      entry.seq >= startSeq &&
      (type === undefined || entry.type === type) &&
      (objectId === undefined || entry.objectId === objectId)
    ));
  };

  const exportLog = () => JSON.stringify(history);

  return Object.freeze({
    append,
    entries,
    exportLog,
    get size() {
      return history.length;
    },
  });
}

export function importLog(json) {
  if (typeof json !== 'string') {
    throw new TypeError('Log must be a JSON string');
  }

  let parsed;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid log JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Imported log must be an array');
  }

  const log = createSpacetimeLog();

  let previousHash = '00000000';

  for (let index = 0; index < parsed.length; index += 1) {
    const source = parsed[index];

    validateEntryShape(source, index);

    if (source.prevHash !== previousHash) {
      throw new Error(`Broken chain at sequence ${source.seq}`);
    }

    const expectedHash = calculateHash(source);

    if (source.hash !== expectedHash) {
      throw new Error(`Broken hash at sequence ${source.seq}`);
    }

    const entry = log.append({
      type: source.type,
      objectId: source.objectId,
      payload: source.payload,
    });

    if (
      entry.seq !== source.seq ||
      entry.prevHash !== source.prevHash ||
      entry.hash !== source.hash ||
      entry.at !== source.at
    ) {
      throw new Error(`Imported entry mismatch at sequence ${source.seq}`);
    }

    previousHash = source.hash;
  }

  return log;
}

export function replay(log, handlers) {
  if (!log || typeof log.entries !== 'function') {
    throw new TypeError('Invalid spacetime log');
  }

  if (!handlers || typeof handlers !== 'object') {
    throw new TypeError('Handlers must be an object');
  }

  let count = 0;

  for (const entry of log.entries()) {
    const handler = handlers[entry.type];

    if (typeof handler !== 'function') {
      throw new Error(`Missing replay handler for type: ${entry.type}`);
    }

    handler(entry);
    count += 1;
  }

  return count;
}