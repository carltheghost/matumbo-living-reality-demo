/**
 * Versioned boundary between the preserved Full Studio and the accepted
 * authority.  This is a projection binding, not a second physics model.
 *
 * The accepted side owns the four-dimensional projection record.  The Studio
 * owns its nine-dimensional field and may only publish this record through an
 * explicit command.  Keeping the mapping here makes the boundary testable in
 * Node and prevents UI code from accidentally copying velocities, edges,
 * laws, or material checkpoints across models.
 */

export const STUDIO_BINDING_SCHEMA = 'vivo.studio-binding/1';
export const STUDIO_BINDING_ID = 'studio.node.echo';
export const STUDIO_SOURCE_MODEL = 'matumbo-field-lab';
export const STUDIO_SOURCE_NODE = 55;
export const STUDIO_BINDING_SPACE_ID = 'root';
export const STUDIO_BINDING_ENTITY_ID = 'relic';
export const STUDIO_BINDING_DIMENSION = 4;
export const STUDIO_BINDING_CHART = 'flat';
export const STUDIO_BINDING_METADATA = Object.freeze({name: 'Echo', kind: 'RESONANCE / 02'});

/**
 * Stable projection topology for the currently accepted Full Studio slice.
 * These are deliberately root-space bindings: the canonical authority owns
 * nested-space identity and Eye navigation separately, while Studio remains a
 * rich nine-dimensional local engine.  The source-node numbers are part of
 * this versioned application contract, not an inference from mutable labels.
 */
const BINDING_DEFINITIONS = Object.freeze({
  'studio.node.echo': Object.freeze({
    bindingId: 'studio.node.echo', sourceModel: STUDIO_SOURCE_MODEL, sourceNode: 55,
    spaceId: 'root', entityId: 'relic', dimension: 4, chart: 'flat',
    metadata: STUDIO_BINDING_METADATA, initialQ: Object.freeze([-1.2, -.15, .25, 0]),
  }),
  'studio.node.workpiece': Object.freeze({
    bindingId: 'studio.node.workpiece', sourceModel: STUDIO_SOURCE_MODEL, sourceNode: 56,
    spaceId: 'root', entityId: 'workpiece', dimension: 4, chart: 'flat',
    metadata: Object.freeze({name: 'Workpiece', kind: 'PERSISTENT OBJECT'}),
    initialQ: Object.freeze([.15, .75, .25, 0]),
  }),
  'studio.node.portal': Object.freeze({
    bindingId: 'studio.node.portal', sourceModel: STUDIO_SOURCE_MODEL, sourceNode: 57,
    spaceId: 'root', entityId: 'portal', dimension: 4, chart: 'flat',
    metadata: Object.freeze({name: 'Inner world', kind: 'MAPPED ENTRANCE'}),
    initialQ: Object.freeze([1.35, -.15, .25, 0]),
  }),
});

export const STUDIO_BINDING_IDS = Object.freeze(Object.keys(BINDING_DEFINITIONS));

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const uint = value => Number.isSafeInteger(value) && value >= 0;
const copy = value => structuredClone(value);
const fail = message => { throw new TypeError(message); };

function requireKeys(value, expected) {
  if (!object(value) || Object.keys(value).length !== expected.length ||
      expected.some(key => !Object.hasOwn(value, key))) fail('Invalid Studio binding shape');
}

function checkedQ(value) {
  if (!Array.isArray(value) || value.length !== STUDIO_BINDING_DIMENSION ||
      value.some(axis => typeof axis !== 'number' || !Number.isFinite(axis) || Math.abs(axis) > 1000))
    fail('Invalid Studio binding coordinates');
  return [...value];
}

/** Return the fixed identity portion used for checkpoint topology checks. */
export function studioBindingTopology(binding) {
  validateStudioBinding(binding);
  return {
    schema: binding.schema,
    bindingId: binding.bindingId,
    sourceModel: binding.sourceModel,
    sourceNode: binding.sourceNode,
    spaceId: binding.spaceId,
    entityId: binding.entityId,
    dimension: binding.dimension,
    chart: binding.chart,
    metadata: copy(binding.metadata),
  };
}

/** Return a detached stable definition so callers cannot mutate the contract. */
export function studioBindingDefinition(bindingId = STUDIO_BINDING_ID) {
  const definition = BINDING_DEFINITIONS[bindingId];
  if (!definition) fail('Unknown Studio binding');
  return copy(definition);
}

export function studioBindingSeed(q, {
  bindingId = STUDIO_BINDING_ID,
  bindingRevision = 0,
  acceptedSequence = 0,
  metadata,
} = {}) {
  if (!uint(bindingRevision) || !uint(acceptedSequence)) fail('Invalid Studio binding revision');
  const definition = studioBindingDefinition(bindingId);
  return validateStudioBinding({
    schema: STUDIO_BINDING_SCHEMA,
    bindingId: definition.bindingId,
    sourceModel: definition.sourceModel,
    sourceNode: definition.sourceNode,
    spaceId: definition.spaceId,
    entityId: definition.entityId,
    dimension: definition.dimension,
    chart: definition.chart,
    q: checkedQ(q === undefined ? definition.initialQ : q),
    metadata: copy(metadata ?? definition.metadata),
    bindingRevision,
    acceptedSequence,
  });
}

/** Build the complete accepted registry without sharing mutable input state. */
export function studioBindingRegistrySeed(overrides = {}) {
  if (!object(overrides)) fail('Invalid Studio binding registry');
  for (const bindingId of Object.keys(overrides)) {
    if (!BINDING_DEFINITIONS[bindingId]) fail('Unknown Studio binding');
  }
  return Object.fromEntries(STUDIO_BINDING_IDS.map(bindingId => {
    const override = overrides[bindingId];
    if (override === undefined) {
      const definition = studioBindingDefinition(bindingId);
      return [bindingId, studioBindingSeed(definition.initialQ, {bindingId})];
    }
    return [bindingId, validateStudioBinding(copy(override))];
  }));
}

export function validateStudioBinding(binding) {
  requireKeys(binding, ['schema', 'bindingId', 'sourceModel', 'sourceNode', 'spaceId', 'entityId',
    'dimension', 'chart', 'q', 'metadata', 'bindingRevision', 'acceptedSequence']);
  const definition = BINDING_DEFINITIONS[binding.bindingId];
  if (binding.schema !== STUDIO_BINDING_SCHEMA || !definition ||
      binding.sourceModel !== definition.sourceModel || binding.sourceNode !== definition.sourceNode ||
      binding.spaceId !== definition.spaceId || binding.entityId !== definition.entityId ||
      binding.dimension !== definition.dimension || binding.chart !== definition.chart ||
      !uint(binding.bindingRevision) || !uint(binding.acceptedSequence)) fail('Invalid Studio binding identity');
  checkedQ(binding.q);
  requireKeys(binding.metadata, ['name', 'kind']);
  if (binding.metadata.name !== definition.metadata.name || binding.metadata.kind !== definition.metadata.kind)
    fail('Invalid Studio binding metadata');
  return binding;
}

/**
 * Map a Full Studio snapshot's selected nine-dimensional node to the accepted
 * four-dimensional projection.  The order deliberately matches the old
 * reviewed chart convention: x1, x3, x2, x4.  No other engine data crosses.
 */
export function mapStudioNodeToCanonical(studioSnapshot, node = STUDIO_SOURCE_NODE) {
  if (!object(studioSnapshot) || !object(studioSnapshot.engine) || !Array.isArray(studioSnapshot.engine.q) ||
      !Number.isInteger(node) || node < 0) fail('Invalid Studio snapshot');
  const offset = node * 9;
  if (studioSnapshot.engine.q.length < offset + 4) fail('Studio node is unavailable');
  const q = [studioSnapshot.engine.q[offset], studioSnapshot.engine.q[offset + 2],
    studioSnapshot.engine.q[offset + 1], studioSnapshot.engine.q[offset + 3]];
  return checkedQ(q);
}

/** Build an explicit authority command; callers supply the current global CAS revision. */
export function studioTransformCommand(snapshot, q, {
  commandId = 'studio.transform.' + (globalThis.crypto?.randomUUID?.() ?? ''),
  expectedRevision = snapshot?.acceptedSequence,
  bindingId = STUDIO_BINDING_ID,
  metadata = STUDIO_BINDING_METADATA,
} = {}) {
  if (!object(snapshot) || !id(snapshot.worldId) || !uint(expectedRevision) || !id(commandId))
    fail('Invalid Studio transform command context');
  const binding = studioBindingSeed(q, {bindingId, metadata: copy(metadata)});
  return {
    schema: 'vivo.command/1',
    id: commandId,
    worldId: snapshot.worldId,
    spaceId: binding.spaceId,
    kind: 'studio.transform',
    expectedRevision,
    payload: {
      bindingId: binding.bindingId,
      sourceModel: binding.sourceModel,
      sourceNode: binding.sourceNode,
      entityId: binding.entityId,
      dimension: binding.dimension,
      chart: binding.chart,
      q: binding.q,
      metadata: binding.metadata,
    },
  };
}

/**
 * Build the explicit canonical-commit command.  Unlike studio.transform, this
 * command carries both selected-record CAS values so the authority can decide
 * whether a Studio projection is allowed to advance the unbound entity too.
 * The caller must opt into this stronger operation; no revision is inferred.
 */
export function studioCommitCommand(snapshot, q, {
  commandId = 'studio.commit.' + (globalThis.crypto?.randomUUID?.() ?? ''),
  expectedRevision = snapshot?.acceptedSequence,
  expectedBindingRevision,
  expectedEntityRevision,
  bindingId = STUDIO_BINDING_ID,
  metadata = STUDIO_BINDING_METADATA,
} = {}) {
  if (!object(snapshot) || !id(snapshot.worldId) || !uint(expectedRevision) || !id(commandId) ||
      !uint(expectedBindingRevision) || !uint(expectedEntityRevision))
    fail('Invalid Studio commit command context');
  const binding = studioBindingSeed(q, {bindingId, metadata: copy(metadata)});
  return {
    schema: 'vivo.command/1',
    id: commandId,
    worldId: snapshot.worldId,
    spaceId: binding.spaceId,
    kind: 'studio.commit',
    expectedRevision,
    payload: {
      bindingId: binding.bindingId,
      sourceModel: binding.sourceModel,
      sourceNode: binding.sourceNode,
      entityId: binding.entityId,
      dimension: binding.dimension,
      chart: binding.chart,
      q: binding.q,
      metadata: binding.metadata,
      expectedBindingRevision,
      expectedEntityRevision,
    },
  };
}

/**
 * Apply only the accepted projection to a cloned Full Studio snapshot.  The
 * result is paused so the local physics clock cannot silently diverge after a
 * remote accepted update.  Engine topology, velocity, memory, edges, laws,
 * camera and landmarks are preserved byte-for-byte apart from the four mapped
 * coordinates and the explicit pause state.
 */
export function applyCanonicalBindingToStudioSnapshot(studioSnapshot, binding) {
  validateStudioBinding(binding);
  if (!object(studioSnapshot) || !object(studioSnapshot.engine) || !Array.isArray(studioSnapshot.engine.q))
    fail('Invalid Studio snapshot');
  const next = copy(studioSnapshot);
  const offset = binding.sourceNode * 9;
  if (next.engine.q.length < offset + 4) fail('Studio node is unavailable');
  next.engine.q[offset] = binding.q[0];
  next.engine.q[offset + 2] = binding.q[1];
  next.engine.q[offset + 1] = binding.q[2];
  next.engine.q[offset + 3] = binding.q[3];
  if (!object(next.view)) fail('Invalid Studio view');
  next.view.paused = true;
  return next;
}
