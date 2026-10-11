/**
 * Explicit boundary between the phone-owned local envelope and the canonical
 * Studio binding registry.  This file is intentionally small: it names the
 * reviewed identities, validates the local topology, and never writes either
 * local or canonical state.
 */

const copy = value => value === undefined ? undefined : structuredClone(value);

export const PHONE_ROOT_DIMENSION = 4;
export const PHONE_LOCAL_DIMENSIONS = Object.freeze([3, 4, 5, 6, 7, 8, 9, 10, 11]);

// This is a frozen, phone-owned mirror of the reviewed registry identities.
// Command construction still loads the shared studio-binding contract lazily;
// keeping this small identity table local means the offline phone shell does
// not need to fetch authority modules merely to open its local world.
const ENTITY_TO_BINDING_ID = Object.freeze({
  relic: 'studio.node.echo',
  workpiece: 'studio.node.workpiece',
  portal: 'studio.node.portal',
});

const DEFINITIONS = Object.freeze({
  relic: Object.freeze({bindingId: 'studio.node.echo', sourceModel: 'matumbo-field-lab', sourceNode: 55,
    spaceId: 'root', entityId: 'relic', dimension: 4, chart: 'flat', metadata: Object.freeze({name: 'Echo', kind: 'RESONANCE / 02'})}),
  workpiece: Object.freeze({bindingId: 'studio.node.workpiece', sourceModel: 'matumbo-field-lab', sourceNode: 56,
    spaceId: 'root', entityId: 'workpiece', dimension: 4, chart: 'flat', metadata: Object.freeze({name: 'Workpiece', kind: 'PERSISTENT OBJECT'})}),
  portal: Object.freeze({bindingId: 'studio.node.portal', sourceModel: 'matumbo-field-lab', sourceNode: 57,
    spaceId: 'root', entityId: 'portal', dimension: 4, chart: 'flat', metadata: Object.freeze({name: 'Inner world', kind: 'MAPPED ENTRANCE'})}),
});

export const PHONE_CANONICAL_BINDINGS = Object.freeze(Object.fromEntries(
  Object.entries(ENTITY_TO_BINDING_ID).map(([entityId]) => [entityId, DEFINITIONS[entityId]]),
));

const unavailable = (code, reason, extra = {}) => ({status: 'unavailable', code, reason, ...extra});

/** Return the reviewed canonical identity for a phone root object, if any. */
export function phoneBindingForEntity(entityId) {
  const binding = PHONE_CANONICAL_BINDINGS[entityId];
  return binding ? copy(binding) : null;
}

/**
 * Convert one local phone object into a detached canonical projection.
 *
 * Root 4D objects map exactly.  The phone may run 3D..11D locally, but a
 * non-4D root cannot be truncated into the canonical 4D registry.  The nested
 * 11D object has no registry binding and remains phone-local.
 */
export function mapPhoneEnvelopeToCanonical(envelope, entityId = 'relic') {
  const snapshot = envelope?.snapshot;
  const eye = envelope?.eyes?.[envelope?.currentEyeId];
  if (!snapshot || !eye || !snapshot.spaces?.[eye.spaceId]) {
    return unavailable('PHONE_LOCAL_STATE_UNAVAILABLE', 'Open the local phone world before previewing a canonical object.');
  }
  const space = snapshot.spaces[eye.spaceId];
  const entity = space.entities?.[entityId];
  const identity = phoneBindingForEntity(entityId);
  if (!identity || eye.spaceId !== 'root' || space.id !== 'root') {
    return unavailable('PHONE_OBJECT_UNBOUND', 'This phone object has no canonical binding; nested and inner-world objects stay local.', {
      local: {worldId: snapshot.worldId, branchId: envelope.branchId ?? null, mode: envelope.mode ?? 'local', spaceId: eye.spaceId, entityId},
    });
  }
  if (!entity || entity.spaceId !== 'root') {
    return unavailable('PHONE_OBJECT_UNAVAILABLE', 'The selected phone object is not present in the active root space.', {
      local: {worldId: snapshot.worldId, branchId: envelope.branchId ?? null, mode: envelope.mode ?? 'local', spaceId: eye.spaceId, entityId},
    });
  }
  if (space.dimension !== PHONE_ROOT_DIMENSION || entity.dimension !== PHONE_ROOT_DIMENSION ||
      !Array.isArray(entity.q) || entity.q.length !== PHONE_ROOT_DIMENSION ||
      entity.chart !== identity.chart) {
    return unavailable('PHONE_DIMENSION_UNSUPPORTED', 'Canonical bindings accept the phone root only in its reviewed 4D flat form; keep this local dimension on the phone.', {
      local: {worldId: snapshot.worldId, branchId: envelope.branchId ?? null, mode: envelope.mode ?? 'local', spaceId: eye.spaceId, entityId, dimension: space.dimension},
      expectedDimension: PHONE_ROOT_DIMENSION,
    });
  }
  if (entity.q.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1000)) {
    return unavailable('PHONE_COORDINATE_INVALID', 'The local object has non-finite or unbounded coordinates; nothing was sent to authority.');
  }
  return {
    status: 'available',
    binding: identity,
    q: [...entity.q],
    local: {
      worldId: snapshot.worldId,
      branchId: envelope.branchId ?? null,
      mode: envelope.mode ?? 'local',
      spaceId: eye.spaceId,
      entityId,
      dimension: space.dimension,
      entityRevision: Number.isSafeInteger(entity.revision) ? entity.revision : null,
    },
  };
}

