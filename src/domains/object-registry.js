export function createRegistry({ lifecycle }) {
  if (
    !lifecycle ||
    typeof lifecycle.getState !== "function" ||
    typeof lifecycle.summon !== "function" ||
    typeof lifecycle.dismiss !== "function"
  ) {
    throw new TypeError("Registry requires a compatible lifecycle");
  }

  const definitions = new Map();

  function register(def) {
    if (!def || typeof def !== "object") {
      throw new TypeError("Object definition must be an object");
    }

    const { id, kind, factory } = def;

    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("Object definition requires a non-empty id");
    }

    if (typeof kind !== "string" || kind.length === 0) {
      throw new TypeError(`Object "${id}" requires a non-empty kind`);
    }

    if (typeof factory !== "function") {
      throw new TypeError(`Object "${id}" requires a factory function`);
    }

    if (definitions.has(id)) {
      throw new Error(`Object "${id}" is already registered`);
    }

    const normalized = Object.freeze({
      ...def,
      id,
      kind,
      factory,
    });

    definitions.set(id, normalized);
    return normalized;
  }

  function get(id) {
    return definitions.get(id);
  }

  function requireDefinition(id) {
    const definition = definitions.get(id);

    if (!definition) {
      throw new Error(`Unknown reality object "${id}"`);
    }

    return definition;
  }

  function findByKind(kind) {
    return [...definitions.values()].filter(
      (definition) => definition.kind === kind,
    );
  }

  function findByCapability(cap) {
    return [...definitions.values()].filter((definition) => {
      const capabilities = definition.capabilities ?? [];
      return Array.isArray(capabilities) && capabilities.includes(cap);
    });
  }

  function summon(id, context) {
    const definition = requireDefinition(id);

    lifecycle.summon(id, context);

    return definition.factory(context);
  }

  function dismiss(id, reason) {
    requireDefinition(id);
    return lifecycle.dismiss(id, reason);
  }

  function activeIds() {
    return [...definitions.keys()].filter((id) => {
      const state = lifecycle.getState(id);
      return state === "materializing" ||
        state === "live" ||
        state === "dismissing";
    });
  }

  return Object.freeze({
    register,
    get,
    findByKind,
    findByCapability,
    summon,
    dismiss,
    activeIds,
  });
}