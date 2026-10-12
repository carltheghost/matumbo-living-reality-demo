/**
 * Phone-owned material patch contract.
 *
 * This is deliberately a small internal body attached to the existing
 * `workpiece` entity. It is not the recovered phase-field solver, a shared
 * authority material protocol, or a second top-level world object. The
 * contract is kept in the phone route so it cannot be mistaken for the frozen
 * cross-authority contracts under services/vivo/contracts/.
 */

export const PHONE_MATERIAL_BODY_SCHEMA = 'vivo.phone.material-body/1';
export const PHONE_MATERIAL_TARGET_SCHEMA = 'vivo.phone.material-target/1';
export const PHONE_MATERIAL_RECEIPT_SCHEMA = 'vivo.phone.material-receipt/1';
export const PHONE_MATERIAL_INVERSE_SCHEMA = 'vivo.phone.material-inverse/1';
export const PHONE_MATERIAL_CENTROID_SCHEMA = 'vivo.phone.material-centroid/1';
export const PHONE_MATERIAL_ENTITY_ID = 'workpiece';
export const PHONE_MATERIAL_TOPOLOGY_ID = 'workpiece.patch.grid-4x3';
export const PHONE_MATERIAL_TOPOLOGY_VERSION = '1';
export const PHONE_MATERIAL_LAW_ID = 'vivo.phone.sparse-spring';
export const PHONE_MATERIAL_LAW_VERSION = '1';
export const PHONE_MATERIAL_MAX_NODES = 64;
export const PHONE_MATERIAL_MAX_EDGES = 192;
export const PHONE_MATERIAL_MAX_CONTACTS = 32;
export const PHONE_MATERIAL_MAX_RECEIPTS = 256;
export const PHONE_MATERIAL_MAX_TARGETS_PER_SOURCE = 4096;
export const PHONE_MATERIAL_MAX_FORCE = 4;
export const PHONE_MATERIAL_MAX_STIFFNESS = 8;
export const PHONE_MATERIAL_MAX_DAMPING = 8;
export const PHONE_MATERIAL_MAX_COORDINATE = 1e6;
export const PHONE_MATERIAL_MIN_DIMENSION = 3;
export const PHONE_MATERIAL_MAX_DIMENSION = 11;

const clone = value => globalThis.structuredClone
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value));

export const materialClone = clone;

export function materialError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function boundedString(value, label, { max = 256, pattern = null } = {}) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw materialError('MATERIAL_INVALID_IDENTITY', `${label} must be a bounded identity.`);
  }
  if (pattern && !pattern.test(value)) throw materialError('MATERIAL_INVALID_IDENTITY', `${label} has an invalid shape.`);
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw materialError('MATERIAL_INVALID_NUMBER', `${label} must be a non-negative integer.`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw materialError('MATERIAL_INVALID_NUMBER', `${label} must be a positive integer.`);
  return value;
}

function finiteNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) throw materialError('MATERIAL_INVALID_NUMBER', `${label} must be finite and bounded.`);
  return result;
}

export function validateDimension(value, label = 'dimension') {
  const dimension = Number(value);
  if (!Number.isInteger(dimension) || dimension < PHONE_MATERIAL_MIN_DIMENSION || dimension > PHONE_MATERIAL_MAX_DIMENSION) {
    throw materialError('MATERIAL_DIMENSION_UNSUPPORTED', `${label} must be between 3 and 11.`);
  }
  return dimension;
}

export function validateVector(value, dimension, label = 'q') {
  validateDimension(dimension);
  if (!Array.isArray(value) || value.length !== dimension) throw materialError('MATERIAL_INVALID_VECTOR', `${label} must contain the full ${dimension}D vector.`);
  return value.map((item, axis) => finiteNumber(item, `${label}[${axis}]`, { min: -PHONE_MATERIAL_MAX_COORDINATE, max: PHONE_MATERIAL_MAX_COORDINATE }));
}

export function normalizeMaterialSource(source, label = 'source') {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw materialError('MATERIAL_SOURCE_REQUIRED', `${label} is required.`);
  const kind = boundedString(source.kind, `${label}.kind`, { max: 32, pattern: /^[a-z][a-z0-9-]*$/ });
  if (!['touch', 'hand', 'finger', 'agent', 'controller'].includes(kind)) throw materialError('MATERIAL_SOURCE_UNSUPPORTED', `Unsupported material source kind ${kind}.`);
  const sourceId = boundedString(source.sourceId ?? source.id, `${label}.sourceId`, { max: 160 });
  const sessionId = boundedString(source.sessionId, `${label}.sessionId`, { max: 256 });
  const generation = positiveInteger(Number(source.generation), `${label}.generation`);
  const parentSourceId = source.parentSourceId === undefined || source.parentSourceId === null
    ? null
    : boundedString(source.parentSourceId, `${label}.parentSourceId`, { max: 160 });
  const fingerId = source.fingerId === undefined || source.fingerId === null
    ? null
    : boundedString(source.fingerId, `${label}.fingerId`, { max: 32, pattern: /^(thumb|index|middle|ring|pinky)$/ });
  return { kind, sourceId, sessionId, generation, parentSourceId, fingerId };
}

export function sourceKey(source) {
  const normalized = normalizeMaterialSource(source);
  return [normalized.kind, normalized.sourceId, normalized.sessionId, normalized.generation].join(':');
}

export function sourceOwnerKey(source) {
  const normalized = normalizeMaterialSource(source);
  return [normalized.kind, normalized.sourceId].join(':');
}

export function validateMaterialIdentity(identity, label = 'identity') {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) throw materialError('MATERIAL_IDENTITY_REQUIRED', `${label} is required.`);
  const normalized = {
    worldId: boundedString(identity.worldId, `${label}.worldId`),
    authorityId: boundedString(identity.authorityId, `${label}.authorityId`),
    branchId: boundedString(identity.branchId, `${label}.branchId`),
    spaceId: boundedString(identity.spaceId, `${label}.spaceId`),
    entityId: boundedString(identity.entityId, `${label}.entityId`),
    dimension: validateDimension(identity.dimension, `${label}.dimension`),
    chart: boundedString(identity.chart, `${label}.chart`, { max: 64 }),
    topologyId: boundedString(identity.topologyId, `${label}.topologyId`, { max: 128 }),
    topologyVersion: boundedString(identity.topologyVersion, `${label}.topologyVersion`, { max: 32 }),
    topologyRevision: nonNegativeInteger(Number(identity.topologyRevision), `${label}.topologyRevision`),
    bodyRevision: nonNegativeInteger(Number(identity.bodyRevision), `${label}.bodyRevision`),
  };
  if (normalized.entityId !== PHONE_MATERIAL_ENTITY_ID) throw materialError('MATERIAL_ENTITY_UNAVAILABLE', 'The phone material patch is attached only to Workpiece.');
  if (normalized.topologyId !== PHONE_MATERIAL_TOPOLOGY_ID || normalized.topologyVersion !== PHONE_MATERIAL_TOPOLOGY_VERSION) {
    throw materialError('MATERIAL_TOPOLOGY_UNSUPPORTED', 'The requested material topology is not this bounded phone patch.');
  }
  return normalized;
}

export function normalizeActuator(actuator = {}) {
  if (!actuator || typeof actuator !== 'object' || Array.isArray(actuator)) throw materialError('MATERIAL_ACTUATOR_INVALID', 'Actuator parameters are required.');
  const normalized = {
    maxForce: finiteNumber(actuator.maxForce ?? 1.5, 'actuator.maxForce', { min: 0, max: PHONE_MATERIAL_MAX_FORCE }),
    stiffness: finiteNumber(actuator.stiffness ?? 2.4, 'actuator.stiffness', { min: 0, max: PHONE_MATERIAL_MAX_STIFFNESS }),
    damping: finiteNumber(actuator.damping ?? 0.45, 'actuator.damping', { min: 0, max: PHONE_MATERIAL_MAX_DAMPING }),
  };
  if (normalized.maxForce <= 0 || normalized.stiffness <= 0) throw materialError('MATERIAL_ACTUATOR_INVALID', 'Actuator force and stiffness must be positive.');
  return normalized;
}

export function normalizeInverseMapping(mapping, dimension) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw materialError('MATERIAL_INVERSE_REQUIRED', 'The captured inverse mapping is required.');
  const axes = Array.isArray(mapping.axes) ? mapping.axes.map(Number) : [];
  if (axes.length !== 3 || new Set(axes).size !== 3 || axes.some(axis => !Number.isInteger(axis) || axis < 0 || axis >= dimension)) {
    throw materialError('MATERIAL_INVERSE_INVALID', 'The inverse mapping axes must identify three distinct dimensions.');
  }
  const devicePoint = Array.isArray(mapping.devicePoint) && mapping.devicePoint.length === 2
    ? mapping.devicePoint.map((value, index) => finiteNumber(value, `inverse.devicePoint[${index}]`, { min: -1e6, max: 1e6 }))
    : null;
  const viewport = mapping.viewport && typeof mapping.viewport === 'object'
    ? {
      left: finiteNumber(mapping.viewport.left, 'inverse.viewport.left', { min: -1e6, max: 1e6 }),
      top: finiteNumber(mapping.viewport.top, 'inverse.viewport.top', { min: -1e6, max: 1e6 }),
      width: finiteNumber(mapping.viewport.width, 'inverse.viewport.width', { min: 0.01, max: 1e6 }),
      height: finiteNumber(mapping.viewport.height, 'inverse.viewport.height', { min: 0.01, max: 1e6 }),
    }
    : null;
  const renderer = mapping.renderer && typeof mapping.renderer === 'object'
    ? {
      w: finiteNumber(mapping.renderer.w, 'inverse.renderer.w', { min: 0.01, max: 1e6 }),
      h: finiteNumber(mapping.renderer.h, 'inverse.renderer.h', { min: 0.01, max: 1e6 }),
      yaw: finiteNumber(mapping.renderer.yaw, 'inverse.renderer.yaw', { min: -1e6, max: 1e6 }),
      pitch: finiteNumber(mapping.renderer.pitch, 'inverse.renderer.pitch', { min: -1e6, max: 1e6 }),
      distance: finiteNumber(mapping.renderer.distance, 'inverse.renderer.distance', { min: 0.15, max: 1e6 }),
      origin: validateVector(mapping.renderer.origin || [0, 0, 0], 3, 'inverse.renderer.origin'),
    }
    : null;
  const depth = finiteNumber(mapping.depth, 'inverse.depth', { min: 0.15, max: 1e6 });
  const canonicalQ = validateVector(mapping.canonicalQ, dimension, 'inverse.canonicalQ');
  if (!devicePoint || !viewport || !renderer) throw materialError('MATERIAL_INVERSE_INVALID', 'The inverse mapping must retain screen, viewport, renderer, depth, and canonical coordinates.');
  return {
    schema: PHONE_MATERIAL_INVERSE_SCHEMA,
    axes, devicePoint, viewport, renderer, depth, canonicalQ,
  };
}

export function normalizeAttachment(attachment, dimension) {
  if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) throw materialError('MATERIAL_ATTACHMENT_REQUIRED', 'A captured node attachment is required.');
  const nodeId = boundedString(attachment.nodeId, 'attachment.nodeId', { max: 128 });
  const capturedAt = finiteNumber(attachment.capturedAt, 'attachment.capturedAt', { min: 0, max: 1e15 });
  return {
    nodeId,
    capturedCanonicalPoint: validateVector(attachment.capturedCanonicalPoint, dimension, 'attachment.capturedCanonicalPoint'),
    capturedAt,
    inverseMapping: normalizeInverseMapping(attachment.inverseMapping, dimension),
  };
}

export function normalizeOperationId(value) {
  return boundedString(value, 'operationId', { max: 256 });
}

export function normalizeOperationTimes({ observedAt, receivedAt }) {
  const observed = finiteNumber(observedAt, 'observedAt', { min: 0, max: 1e15 });
  const received = finiteNumber(receivedAt, 'receivedAt', { min: 0, max: 1e15 });
  return { observedAt: observed, receivedAt: received };
}

export function normalizeMaterialTarget(target, { identity, contact = null, receivedAt = null } = {}) {
  const expectedIdentity = validateMaterialIdentity(identity, 'target.identity');
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw materialError('MATERIAL_TARGET_REQUIRED', 'A material target is required.');
  if (target.schema !== PHONE_MATERIAL_TARGET_SCHEMA) throw materialError('MATERIAL_TARGET_SCHEMA', 'Unsupported phone material target schema.');
  const source = normalizeMaterialSource(target.source, 'target.source');
  if (contact) {
    if (contact.sourceKey !== sourceKey(source)) throw materialError('MATERIAL_SOURCE_MISMATCH', 'The target source is not the captured contact owner.');
    if (contact.generation !== source.generation) throw materialError('MATERIAL_GENERATION_STALE', 'The target source generation is stale.');
    if (target.contactId !== contact.contactId) throw materialError('MATERIAL_CONTACT_MISMATCH', 'The target contact identity is stale.');
    if (target.attachment?.nodeId !== contact.attachment.nodeId) throw materialError('MATERIAL_NODE_MISMATCH', 'A contact cannot retarget a different captured node.');
  }
  const targetIdentity = validateMaterialIdentity({
    ...expectedIdentity,
    bodyRevision: Number(target.identity?.bodyRevision),
    topologyRevision: Number(target.identity?.topologyRevision),
  }, 'target.identity');
  if (targetIdentity.worldId !== expectedIdentity.worldId || targetIdentity.authorityId !== expectedIdentity.authorityId ||
      targetIdentity.branchId !== expectedIdentity.branchId || targetIdentity.spaceId !== expectedIdentity.spaceId ||
      targetIdentity.entityId !== expectedIdentity.entityId || targetIdentity.dimension !== expectedIdentity.dimension ||
      targetIdentity.chart !== expectedIdentity.chart || targetIdentity.topologyId !== expectedIdentity.topologyId ||
      targetIdentity.topologyVersion !== expectedIdentity.topologyVersion || targetIdentity.topologyRevision !== expectedIdentity.topologyRevision) {
    throw materialError('MATERIAL_SCOPE_CHANGED', 'The target no longer belongs to the current world, branch, space, entity, or topology.');
  }
  const operationId = normalizeOperationId(target.operationId);
  const targetSeq = positiveInteger(Number(target.targetSeq), 'targetSeq');
  const dimension = expectedIdentity.dimension;
  const q = validateVector(target.q, dimension, 'target.q');
  const attachment = normalizeAttachment(target.attachment, dimension);
  const actuator = normalizeActuator(target.actuator);
  const times = normalizeOperationTimes({ observedAt: target.observedAt, receivedAt: receivedAt ?? target.receivedAt });
  return {
    schema: PHONE_MATERIAL_TARGET_SCHEMA,
    operationId, contactId: boundedString(target.contactId, 'contactId', { max: 160 }),
    identity: targetIdentity, source, targetSeq, q, attachment, actuator,
    observedAt: times.observedAt, receivedAt: times.receivedAt,
  };
}

export function validateMaterialReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || receipt.schema !== PHONE_MATERIAL_RECEIPT_SCHEMA) throw materialError('MATERIAL_RECEIPT_INVALID', 'Invalid material operation receipt.');
  normalizeOperationId(receipt.operationId);
  if (!['accepted', 'rejected', 'accepted-in-memory'].includes(receipt.status)) throw materialError('MATERIAL_RECEIPT_INVALID', 'Invalid material receipt status.');
  validateMaterialIdentity(receipt.identity, 'receipt.identity');
  nonNegativeInteger(Number(receipt.acceptedSequence), 'receipt.acceptedSequence');
  nonNegativeInteger(Number(receipt.bodyRevision), 'receipt.bodyRevision');
  nonNegativeInteger(Number(receipt.topologyRevision), 'receipt.topologyRevision');
  finiteNumber(receipt.observedAt, 'receipt.observedAt', { min: 0, max: 1e15 });
  finiteNumber(receipt.receivedAt, 'receipt.receivedAt', { min: 0, max: 1e15 });
  boundedString(receipt.code, 'receipt.code', { max: 96 });
  if (receipt.fingerprint !== undefined) boundedString(receipt.fingerprint, 'receipt.fingerprint', { max: 10000 });
  return receipt;
}

export function validateMaterialNode(node, dimension, nodeId = null) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw materialError('MATERIAL_NODE_INVALID', 'Invalid internal material node.');
  const id = boundedString(node.id ?? nodeId, 'node.id', { max: 128 });
  if (nodeId !== null && id !== nodeId) throw materialError('MATERIAL_NODE_INVALID', 'Node map key does not match node identity.');
  const revision = nonNegativeInteger(Number(node.revision), `node[${id}].revision`);
  return {
    id,
    restQ: validateVector(node.restQ, dimension, `node[${id}].restQ`),
    q: validateVector(node.q, dimension, `node[${id}].q`),
    v: validateVector(node.v, dimension, `node[${id}].v`),
    revision,
  };
}

export function validateMaterialBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw materialError('MATERIAL_BODY_INVALID', 'A material body is required.');
  if (body.schema !== PHONE_MATERIAL_BODY_SCHEMA) throw materialError('MATERIAL_BODY_SCHEMA', 'Unsupported phone material body schema.');
  const identity = validateMaterialIdentity({
    ...body.identity,
    topologyId: body.topologyId,
    topologyVersion: body.topologyVersion,
    topologyRevision: body.topologyRevision,
    bodyRevision: body.bodyRevision,
  }, 'body.identity');
  const dimension = identity.dimension;
  if (body.law?.id !== PHONE_MATERIAL_LAW_ID || body.law?.version !== PHONE_MATERIAL_LAW_VERSION) throw materialError('MATERIAL_LAW_UNSUPPORTED', 'Unsupported phone sparse-spring law.');
  if (body.centroidCoupling?.schema !== PHONE_MATERIAL_CENTROID_SCHEMA || body.centroidCoupling.entityId !== identity.entityId || body.centroidCoupling.mode !== 'entity-is-uniform-node-centroid') {
    throw materialError('MATERIAL_CENTROID_COUPLING', 'The Workpiece centroid coupling contract is invalid.');
  }
  const nodeEntries = Object.entries(body.nodes || {});
  if (!nodeEntries.length || nodeEntries.length > PHONE_MATERIAL_MAX_NODES) throw materialError('MATERIAL_NODE_LIMIT', 'Material node count is outside the phone bound.');
  const nodes = new Map();
  for (const [nodeId, node] of nodeEntries) nodes.set(nodeId, validateMaterialNode(node, dimension, nodeId));
  if (!body.restCoordinates || typeof body.restCoordinates !== 'object') throw materialError('MATERIAL_REST_COORDINATES', 'Rest coordinates are required.');
  for (const nodeId of nodes.keys()) {
    const rest = validateVector(body.restCoordinates[nodeId], dimension, `restCoordinates[${nodeId}]`);
    if (JSON.stringify(rest) !== JSON.stringify(nodes.get(nodeId).restQ)) throw materialError('MATERIAL_REST_COORDINATES', 'Rest coordinate and node restQ differ.');
  }
  if (!Array.isArray(body.edges) || body.edges.length > PHONE_MATERIAL_MAX_EDGES) throw materialError('MATERIAL_EDGE_LIMIT', 'Material edge count is outside the phone bound.');
  const edgeIds = new Set();
  const neighborCounts = new Map([...nodes.keys()].map(id => [id, 0]));
  for (const edge of body.edges) {
    const id = boundedString(edge?.id, 'edge.id', { max: 128 });
    if (edgeIds.has(id)) throw materialError('MATERIAL_EDGE_INVALID', 'Material edge IDs must be unique.');
    edgeIds.add(id);
    const a = boundedString(edge?.a, 'edge.a', { max: 128 });
    const b = boundedString(edge?.b, 'edge.b', { max: 128 });
    if (a === b || !nodes.has(a) || !nodes.has(b)) throw materialError('MATERIAL_EDGE_INVALID', 'Material edges must own two different internal nodes.');
    finiteNumber(edge.restLength, 'edge.restLength', { min: 0, max: PHONE_MATERIAL_MAX_COORDINATE });
    finiteNumber(edge.stiffness, 'edge.stiffness', { min: 0, max: 10 });
    neighborCounts.set(a, neighborCounts.get(a) + 1); neighborCounts.set(b, neighborCounts.get(b) + 1);
    if (neighborCounts.get(a) > 12 || neighborCounts.get(b) > 12) throw materialError('MATERIAL_NEIGHBOR_LIMIT', 'Internal material node has too many neighbors.');
  }
  for (const [nodeId, value] of Object.entries(body.restCoordinates)) if (!nodes.has(nodeId)) throw materialError('MATERIAL_REST_COORDINATES', 'Rest coordinates contain an unknown node.');
  if (!Number.isInteger(body.physicsTick) || body.physicsTick < 0) throw materialError('MATERIAL_PHYSICS_TICK', 'Invalid material physics tick.');
  if (!Number.isFinite(Number(body.simulationTime)) || Number(body.simulationTime) < 0) throw materialError('MATERIAL_SIMULATION_TIME', 'Invalid material simulation time.');
  if (body.solver?.adapter !== 'stepSparseSpace/phone-view' || typeof body.solver.enabled !== 'boolean') throw materialError('MATERIAL_SOLVER_VIEW', 'The internal solver view is invalid.');
  const receiptEntries = Array.isArray(body.receipts) ? body.receipts : [];
  if (receiptEntries.length > PHONE_MATERIAL_MAX_RECEIPTS) throw materialError('MATERIAL_RECEIPT_LIMIT', 'Material receipt history is outside the phone bound.');
  for (const receipt of receiptEntries) validateMaterialReceipt(receipt);
  if (!body.inputCursor || typeof body.inputCursor !== 'object' || Array.isArray(body.inputCursor)) throw materialError('MATERIAL_INPUT_CURSOR', 'Material input cursor is required.');
  for (const [key, cursor] of Object.entries(body.inputCursor)) {
    boundedString(key, 'inputCursor key', { max: 512 });
    normalizeMaterialSource(cursor.source, 'inputCursor.source');
    positiveInteger(Number(cursor.lastTargetSeq), 'inputCursor.lastTargetSeq');
    normalizeOperationTimes(cursor);
  }
  nonNegativeInteger(Number(body.acceptedSequence), 'body.acceptedSequence');
  nonNegativeInteger(Number(body.bodyRevision), 'body.bodyRevision');
  nonNegativeInteger(Number(body.topologyRevision), 'body.topologyRevision');
  return body;
}

export function materialIdentityFromEnvelope(envelope, entityId = PHONE_MATERIAL_ENTITY_ID, body = null) {
  const snapshot = envelope?.snapshot || envelope;
  const eyes = envelope?.eyes || {};
  const eye = envelope?.currentEyeId ? eyes[envelope.currentEyeId] : null;
  const spaceId = eye?.spaceId || snapshot?.rootSpaceId;
  const space = snapshot?.spaces?.[spaceId];
  const entity = space?.entities?.[entityId];
  if (!snapshot?.worldId || !snapshot?.authorityId || !envelope?.branchId || !space || !entity) throw materialError('MATERIAL_SCOPE_CHANGED', 'The Workpiece is not present in the current phone scope.');
  const patch = body || snapshot?.materialBodies?.[entityId];
  return {
    worldId: snapshot.worldId,
    authorityId: snapshot.authorityId,
    branchId: envelope.branchId,
    spaceId,
    entityId,
    dimension: space.dimension,
    chart: entity.chart || 'flat',
    topologyId: patch?.topologyId || PHONE_MATERIAL_TOPOLOGY_ID,
    topologyVersion: patch?.topologyVersion || PHONE_MATERIAL_TOPOLOGY_VERSION,
    topologyRevision: Number(patch?.topologyRevision ?? 0),
    bodyRevision: Number(patch?.bodyRevision ?? 0),
  };
}

export function stableFingerprint(value) {
  const normalize = input => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') return Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize(input[key])]));
    return input;
  };
  return JSON.stringify(normalize(value));
}
