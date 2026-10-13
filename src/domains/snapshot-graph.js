/**
 * Shared immutable snapshot-graph validator and canonical JSON writer.
 *
 * Supported snapshot values are the JSON data model only: null, finite
 * numbers, strings, booleans, ordinary/null-prototype objects, and ordinary
 * or null-prototype arrays. Accessors, symbols, functions, undefined,
 * BigInt, non-finite numbers, custom prototypes, sparse arrays, and cycles are
 * rejected before any caller compares, hashes, clones, or persists a graph.
 * The walk reads property descriptors and never invokes a getter or mutates
 * the supplied graph.
 */

function graphError(path, message) {
  return new TypeError(`${path} ${message}`);
}

/**
 * Canonical JSON for a supported graph. Key order is stable; arrays retain
 * their order. Repeated references are allowed and are serialized at each
 * occurrence, while cycles fail closed.
 */
export function stableJson(value, stack = new Set(), path = "$") {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "string" || type === "boolean") return JSON.stringify(value);
  if (type === "number") {
    if (!Number.isFinite(value)) throw graphError(path, "contains a non-finite number");
    return JSON.stringify(value);
  }
  if (type === "undefined") throw graphError(path, "contains a missing value (unsupported undefined)");
  if (type !== "object") throw graphError(path, `contains an unsupported ${type}`);
  if (stack.has(value)) throw graphError(path, "contains a cyclic value");

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  const expectedPrototype = isArray ? Array.prototype : Object.prototype;
  if (prototype !== expectedPrototype && prototype !== null) {
    throw graphError(path, "contains an unsupported prototype");
  }

  stack.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key === "symbol") throw graphError(path, "contains symbol properties");
      const descriptor = descriptors[key];
      if (!("value" in descriptor)) throw graphError(`${path}.${key}`, "is an accessor");
      // Array length is the one required non-enumerable data property. Every
      // other supported snapshot property must participate in JSON output.
      if (!descriptor.enumerable && !(isArray && key === "length")) {
        throw graphError(`${path}.${key}`, "is a non-enumerable property");
      }
    }

    if (isArray) {
      const enumerableKeys = Object.keys(descriptors).filter((key) => descriptors[key].enumerable);
      for (const key of enumerableKeys) {
        if (!/^0$|^[1-9]\d*$/.test(key) || Number(key) >= value.length) {
          throw graphError(path, "contains unsupported array properties");
        }
      }
      const entries = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor)) throw graphError(`${path}[${index}]`, "is not a data value");
        entries.push(stableJson(descriptor.value, stack, `${path}[${index}]`));
      }
      return `[${entries.join(",")}]`;
    }

    const entries = [];
    for (const key of Object.keys(descriptors).sort()) {
      entries.push(`${JSON.stringify(key)}:${stableJson(descriptors[key].value, stack, `${path}.${key}`)}`);
    }
    return `{${entries.join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

/** Validate a complete graph without mutating it; returns the original value. */
export function assertSnapshotGraph(value, path = "$") {
  stableJson(value, new Set(), path);
  return value;
}

/** Safe equality for arbitrary candidate snapshot values. */
export function sameSnapshotValue(left, right) {
  try {
    return stableJson(left) === stableJson(right);
  } catch {
    return false;
  }
}

