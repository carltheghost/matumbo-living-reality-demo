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

export function studioBindingSeed(q, {bindingRevision = 0, acceptedSequence = 0} = {}) {
  if (!uint(bindingRevision) || !uint(acceptedSequence)) fail('Invalid Studio binding revision');
  return validateStudioBinding({
    schema: STUDIO_BINDING_SCHEMA,
    bindingId: STUDIO_BINDING_ID,
    sourceModel: STUDIO_SOURCE_MODEL,
    sourceNode: STUDIO_SOURCE_NODE,
    spaceId: STUDIO_BINDING_SPACE_ID,
    entityId: STUDIO_BINDING_ENTITY_ID,
    dimension: STUDIO_BINDING_DIMENSION,
    chart: STUDIO_BINDING_CHART,
    q: checkedQ(q),
    metadata: copy(STUDIO_BINDING_METADATA),
    bindingRevision,
    acceptedSequence,
  });
}

export function validateStudioBinding(binding) {
  requireKeys(binding, ['schema', 'bindingId', 'sourceModel', 'sourceNode', 'spaceId', 'entityId',
    'dimension', 'chart', 'q', 'metadata', 'bindingRevision', 'acceptedSequence']);
  if (binding.schema !== STUDIO_BINDING_SCHEMA || binding.bindingId !== STUDIO_BINDING_ID ||
      binding.sourceModel !== STUDIO_SOURCE_MODEL || binding.sourceNode !== STUDIO_SOURCE_NODE ||
      binding.spaceId !== STUDIO_BINDING_SPACE_ID || binding.entityId !== STUDIO_BINDING_ENTITY_ID ||
      binding.dimension !== STUDIO_BINDING_DIMENSION || binding.chart !== STUDIO_BINDING_CHART ||
      !uint(binding.bindingRevision) || !uint(binding.acceptedSequence)) fail('Invalid Studio binding identity');
  checkedQ(binding.q);
  requireKeys(binding.metadata, ['name', 'kind']);
  if (binding.metadata.name !== STUDIO_BINDING_METADATA.name || binding.metadata.kind !== STUDIO_BINDING_METADATA.kind)
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
  const binding = validateStudioBinding({...studioBindingSeed(q), bindingId, metadata: copy(metadata)});
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
  const offset = STUDIO_SOURCE_NODE * 9;
  if (next.engine.q.length < offset + 4) fail('Studio node is unavailable');
  next.engine.q[offset] = binding.q[0];
  next.engine.q[offset + 2] = binding.q[1];
  next.engine.q[offset + 1] = binding.q[2];
  next.engine.q[offset + 3] = binding.q[3];
  if (!object(next.view)) fail('Invalid Studio view');
  next.view.paused = true;
  return next;
}
