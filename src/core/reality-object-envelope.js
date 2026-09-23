function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

export function wrap(schema, version, data, meta) {
  if (typeof schema !== "string" || schema.length === 0) {
    throw new TypeError("Envelope schema must be a non-empty string");
  }

  if (version === undefined || version === null) {
    throw new TypeError("Envelope version is required");
  }

  if (!isPlainObject(meta ?? {})) {
    throw new TypeError("Envelope meta must be an object");
  }

  const envelope = {
    schema,
    version,
    data,
  };

  if (Object.prototype.hasOwnProperty.call(meta ?? {}, "createdAt")) {
    envelope.createdAt = meta.createdAt;
  }

  if (Object.prototype.hasOwnProperty.call(meta ?? {}, "updatedAt")) {
    envelope.updatedAt = meta.updatedAt;
  }

  return envelope;
}

export function validate(envelope) {
  if (!isPlainObject(envelope)) {
    throw new TypeError("Envelope must be an object");
  }

  if (typeof envelope.schema !== "string" || envelope.schema.length === 0) {
    throw new TypeError("Envelope schema must be a non-empty string");
  }

  if (
    envelope.version === undefined ||
    envelope.version === null ||
    (typeof envelope.version !== "string" &&
      typeof envelope.version !== "number")
  ) {
    throw new TypeError("Envelope version must be a string or number");
  }

  if (!Object.prototype.hasOwnProperty.call(envelope, "data")) {
    throw new TypeError("Envelope data is required");
  }

  if (
    Object.prototype.hasOwnProperty.call(envelope, "createdAt") &&
    envelope.createdAt !== undefined &&
    typeof envelope.createdAt !== "string" &&
    typeof envelope.createdAt !== "number"
  ) {
    throw new TypeError("Envelope createdAt must be a string or number");
  }

  if (
    Object.prototype.hasOwnProperty.call(envelope, "updatedAt") &&
    envelope.updatedAt !== undefined &&
    typeof envelope.updatedAt !== "string" &&
    typeof envelope.updatedAt !== "number"
  ) {
    throw new TypeError("Envelope updatedAt must be a string or number");
  }

  return true;
}

export function migrate(envelope, migrations) {
  validate(envelope);

  if (!isPlainObject(migrations)) {
    throw new TypeError("Migrations must be an object keyed by version");
  }

  let current = envelope;
  const visited = new Set();

  while (true) {
    validate(current);

    const versionKey = String(current.version);

    if (visited.has(versionKey)) {
      throw new Error(`Migration cycle detected at version "${versionKey}"`);
    }

    visited.add(versionKey);

    const migration = migrations[versionKey];

    if (migration === undefined) {
      return current;
    }

    if (typeof migration !== "function") {
      throw new TypeError(
        `Migration for version "${versionKey}" must be a function`,
      );
    }

    const next = migration(current);

    if (!isPlainObject(next)) {
      throw new TypeError(
        `Migration for version "${versionKey}" must return an envelope`,
      );
    }

    validate(next);

    if (String(next.version) === versionKey) {
      throw new Error(
        `Migration for version "${versionKey}" did not advance the version`,
      );
    }

    current = next;
  }
}