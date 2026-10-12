/**
 * Bounded phone-local Workpiece material authority.
 *
 * The body is a 4x3 sparse patch in whatever 3D..11D space owns Workpiece.
 * `stepSparseSpace` supplies the existing bounded spring integration through a
 * small internal solver view; this module does not import or advertise the
 * recovered phase-field solver. Contacts are memory-only, while accepted body
 * checkpoints, input cursors, and idempotent receipts live in the phone
 * envelope.
 */

import { stepSparseSpace } from './engine.mjs';
import {
  PHONE_MATERIAL_BODY_SCHEMA,
  PHONE_MATERIAL_CENTROID_SCHEMA,
  PHONE_MATERIAL_ENTITY_ID,
  PHONE_MATERIAL_LAW_ID,
  PHONE_MATERIAL_LAW_VERSION,
  PHONE_MATERIAL_MAX_CONTACTS,
  PHONE_MATERIAL_MAX_RECEIPTS,
  PHONE_MATERIAL_MAX_TARGETS_PER_SOURCE,
  PHONE_MATERIAL_RECEIPT_SCHEMA,
  PHONE_MATERIAL_TARGET_SCHEMA,
  PHONE_MATERIAL_TOPOLOGY_ID,
  PHONE_MATERIAL_TOPOLOGY_VERSION,
  materialClone,
  materialError,
  materialIdentityFromEnvelope,
  normalizeActuator,
  normalizeAttachment,
  normalizeInverseMapping,
  normalizeMaterialSource,
  normalizeMaterialTarget,
  normalizeOperationId,
  normalizeOperationTimes,
  sourceKey,
  sourceOwnerKey,
  stableFingerprint,
  validateDimension,
  validateMaterialBody,
  validateMaterialIdentity,
  validateVector,
} from './material-contract.mjs';

const EPSILON = 1e-9;
const DEFAULT_DT = 1 / 30;
const GRID_COLUMNS = 4;
const GRID_ROWS = 3;
const PATCH_SPACING_X = 0.3;
const PATCH_SPACING_Z = 0.25;
const PATCH_FIXED_COLUMN = 0;

const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const vectorEqual = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, axis) => Math.abs(Number(value) - Number(b[axis])) <= EPSILON);
const zero = dimension => Array(dimension).fill(0);
const boundedDt = value => {
  const dt = Number(value ?? DEFAULT_DT);
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw materialError('MATERIAL_STEP_INVALID', 'Material step must be between 0 and 100 ms.');
  return dt;
};

function nodeId(row, column) {
  return `workpiece.patch.v1.r${row}c${column}`;
}

function edgeId(a, b) {
  return `workpiece.patch.v1.edge.${a.split('.').at(-1)}-${b.split('.').at(-1)}`;
}

function patchIdentity(identity, bodyRevision = 0, topologyRevision = 0) {
  return validateMaterialIdentity({
    ...identity,
    topologyId: identity.topologyId || PHONE_MATERIAL_TOPOLOGY_ID,
    topologyVersion: identity.topologyVersion || PHONE_MATERIAL_TOPOLOGY_VERSION,
    bodyRevision,
    topologyRevision,
  }, 'patch.identity');
}

function bodyCentroid(body) {
  const nodes = Object.values(body.nodes);
  const dimension = body.identity.dimension;
  const q = zero(dimension), v = zero(dimension);
  for (const node of nodes) for (let axis = 0; axis < dimension; axis++) {
    q[axis] += node.q[axis];
    v[axis] += node.v[axis];
  }
  for (let axis = 0; axis < dimension; axis++) {
    q[axis] /= nodes.length;
    v[axis] /= nodes.length;
  }
  return { q, v };
}

function updateBodyIdentity(body) {
  body.identity = patchIdentity(body.identity, body.bodyRevision, body.topologyRevision);
  return body.identity;
}

function createGridBody({ identity, entity, fixedColumn = PATCH_FIXED_COLUMN } = {}) {
  const dimension = validateDimension(identity.dimension);
  const baseQ = validateVector(entity?.q, dimension, 'Workpiece q');
  const nodes = {};
  const restCoordinates = {};
  const fixedNodeIds = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let column = 0; column < GRID_COLUMNS; column++) {
      const id = nodeId(row, column);
      const restQ = [...baseQ];
      restQ[0] += (column - (GRID_COLUMNS - 1) / 2) * PATCH_SPACING_X;
      const visibleAxis = dimension > 2 ? 2 : 1;
      restQ[visibleAxis] += (row - (GRID_ROWS - 1) / 2) * PATCH_SPACING_Z;
      nodes[id] = { id, restQ: [...restQ], q: [...restQ], v: zero(dimension), revision: 0 };
      restCoordinates[id] = [...restQ];
      if (column === fixedColumn) fixedNodeIds.push(id);
    }
  }
  const edges = [];
  const addEdge = (a, b, stiffness = 2.2) => edges.push({ id: edgeId(a, b), a, b, restLength: distance(nodes[a].restQ, nodes[b].restQ), stiffness });
  for (let row = 0; row < GRID_ROWS; row++) for (let column = 0; column < GRID_COLUMNS; column++) {
    const current = nodeId(row, column);
    if (column + 1 < GRID_COLUMNS) addEdge(current, nodeId(row, column + 1));
    if (row + 1 < GRID_ROWS) addEdge(current, nodeId(row + 1, column));
    // A small diagonal brace makes the patch visibly propagate shear without
    // turning it into a dense lattice.
    if (row + 1 < GRID_ROWS && column + 1 < GRID_COLUMNS) addEdge(current, nodeId(row + 1, column + 1), 1.55);
  }
  const centroid = bodyCentroid({ nodes, identity: { dimension } });
  const body = {
    schema: PHONE_MATERIAL_BODY_SCHEMA,
    identity: patchIdentity(identity, 0, 0),
    topologyId: PHONE_MATERIAL_TOPOLOGY_ID,
    topologyVersion: PHONE_MATERIAL_TOPOLOGY_VERSION,
    topologyRevision: 0,
    bodyRevision: 0,
    entityRevision: Number(entity.revision) || 0,
    physicsTick: 0,
    simulationTime: 0,
    acceptedSequence: 0,
    law: { id: PHONE_MATERIAL_LAW_ID, version: PHONE_MATERIAL_LAW_VERSION },
    solver: { adapter: 'stepSparseSpace/phone-view', enabled: true },
    centroidCoupling: {
      schema: PHONE_MATERIAL_CENTROID_SCHEMA,
      mode: 'entity-is-uniform-node-centroid',
      entityId: identity.entityId,
      weights: 'uniform',
      rigidGeometryOwner: 'entity',
      integration: 'material-body-only',
      note: 'The entity q/v mirrors the mean internal node q/v after each accepted body checkpoint; the rigid geometry scale/rotation remains entity-owned and is never integrated by this patch.',
    },
    fixedNodeIds,
    nodes,
    restCoordinates,
    edges,
    inputCursor: {},
    receipts: [],
    centroid,
  };
  validateMaterialBody(body);
  return body;
}

function compareScope(left, right) {
  return left?.worldId === right?.worldId && left?.authorityId === right?.authorityId &&
    left?.branchId === right?.branchId && left?.spaceId === right?.spaceId &&
    left?.entityId === right?.entityId && left?.dimension === right?.dimension &&
    left?.chart === right?.chart && left?.topologyId === right?.topologyId &&
    left?.topologyVersion === right?.topologyVersion && left?.topologyRevision === right?.topologyRevision;
}

function staticScope(identity) {
  const { bodyRevision: _bodyRevision, ...scope } = identity;
  return scope;
}

function matchingReceipt(body, operationId) {
  return body.receipts.find(item => item.operationId === operationId) || null;
}

function pushReceipt(body, receipt) {
  body.receipts.push(materialClone(receipt));
  while (body.receipts.length > PHONE_MATERIAL_MAX_RECEIPTS) body.receipts.shift();
}

function receiptFingerprint(value) {
  return stableFingerprint(value);
}

function normalizeBodySourceCursor(body, source, targetSeq, observedAt, receivedAt) {
  const key = sourceKey(source);
  const prior = body.inputCursor[key];
  if (prior && targetSeq <= Number(prior.lastTargetSeq)) {
    if (targetSeq === Number(prior.lastTargetSeq)) throw materialError('MATERIAL_TARGET_REPLAY', 'The target sequence was already accepted for this source generation.');
    throw materialError('MATERIAL_TARGET_STALE', 'The target sequence is older than the accepted source cursor.');
  }
  if (targetSeq > PHONE_MATERIAL_MAX_TARGETS_PER_SOURCE) throw materialError('MATERIAL_TARGET_LIMIT', 'The source target sequence is outside the phone bound.');
  body.inputCursor[key] = {
    source: materialClone(source), lastTargetSeq: targetSeq,
    observedAt, receivedAt,
  };
  return key;
}

function forceForContact(contact, node) {
  const dimension = node.q.length;
  const force = zero(dimension);
  if (!contact.lastTarget) return force;
  for (let axis = 0; axis < dimension; axis++) {
    force[axis] = contact.actuator.stiffness * (contact.lastTarget.q[axis] - node.q[axis]) - contact.actuator.damping * node.v[axis];
  }
  const length = Math.hypot(...force);
  if (length > contact.actuator.maxForce && length > EPSILON) {
    const scale = contact.actuator.maxForce / length;
    for (let axis = 0; axis < dimension; axis++) force[axis] *= scale;
  }
  return force;
}

function anyVelocity(body) {
  return Object.values(body.nodes).some(node => node.v.some(value => Math.abs(value) > 1e-5));
}

function activeSourceOwner(contact, source) {
  const requested = normalizeMaterialSource(source);
  if (contact.source.kind === requested.kind && contact.source.sourceId === requested.sourceId) return true;
  return requested.kind === 'hand' && contact.source.parentSourceId === requested.sourceId;
}

function applyExternalForces(body, contacts, dt) {
  for (const contact of contacts.values()) {
    const node = body.nodes[contact.attachment.nodeId];
    if (!node) continue;
    const force = forceForContact(contact, node);
    for (let axis = 0; axis < node.v.length; axis++) node.v[axis] += force[axis] * dt;
  }
}

function advanceBody(body, contacts, { dt = DEFAULT_DT, solver = stepSparseSpace } = {}) {
  const safeDt = boundedDt(dt);
  if (!body.solver.enabled) return { changed: false, solverEnabled: false, centroid: materialClone(body.centroid), moving: false };
  const hasWork = [...contacts.values()].some(contact => contact.lastTarget) || anyVelocity(body);
  if (!hasWork) return { changed: false, solverEnabled: true, centroid: materialClone(body.centroid), moving: false };
  applyExternalForces(body, contacts, safeDt);
  const view = {
    dimension: body.identity.dimension,
    entities: body.nodes,
    field: { nodes: Object.keys(body.nodes), edges: body.edges },
  };
  if (typeof solver !== 'function') throw materialError('MATERIAL_SOLVER_UNAVAILABLE', 'The bounded phone spring solver is unavailable.');
  const moving = solver(view, safeDt, new Set(Object.keys(body.nodes)));
  for (const id of body.fixedNodeIds || []) {
    const node = body.nodes[id];
    if (!node) continue;
    node.q = [...node.restQ];
    node.v = zero(body.identity.dimension);
    node.revision++;
  }
  body.centroid = bodyCentroid(body);
  body.bodyRevision++;
  body.physicsTick++;
  body.simulationTime += safeDt;
  updateBodyIdentity(body);
  return { changed: true, solverEnabled: true, centroid: materialClone(body.centroid), moving: Boolean(moving || anyVelocity(body)), dt: safeDt };
}

function shiftBodyToCentroid(body, fromQ, toQ) {
  if (!Array.isArray(fromQ) || !Array.isArray(toQ) || vectorEqual(fromQ, toQ)) return false;
  const delta = toQ.map((value, axis) => value - fromQ[axis]);
  for (const node of Object.values(body.nodes)) {
    node.q = node.q.map((value, axis) => value + delta[axis]);
    node.restQ = node.restQ.map((value, axis) => value + delta[axis]);
    node.revision++;
  }
  for (const [nodeId, q] of Object.entries(body.restCoordinates)) body.restCoordinates[nodeId] = q.map((value, axis) => value + delta[axis]);
  body.centroid.q = [...toQ];
  return true;
}

function renderVertices(body, project, { provisional = false } = {}) {
  if (!body || typeof project !== 'function') return null;
  const vertices = Object.values(body.nodes).map(node => {
    const point = project(node.q, node);
    return { id: node.id, q: [...node.q], v: [...node.v], revision: node.revision, ...point, provisional };
  });
  const byId = new Map(vertices.map(vertex => [vertex.id, vertex]));
  const edges = body.edges.map(edge => ({
    id: edge.id, a: edge.a, b: edge.b,
    from: byId.get(edge.a), to: byId.get(edge.b),
    restLength: edge.restLength,
    length: byId.has(edge.a) && byId.has(edge.b) ? distance(byId.get(edge.a).q, byId.get(edge.b).q) : null,
    provisional,
  }));
  return {
    schema: 'vivo.phone.material-render/1',
    entityId: body.identity.entityId,
    topologyId: body.topologyId,
    topologyVersion: body.topologyVersion,
    bodyRevision: body.bodyRevision,
    physicsTick: body.physicsTick,
    vertices,
    edges,
    centroid: materialClone(body.centroid),
    provisional,
  };
}

export function projectMaterialBody(body, { project } = {}, options = {}) {
  validateMaterialBody(body);
  return renderVertices(body, project, options);
}

export class PhoneMaterialAuthority {
  constructor({ solver = stepSparseSpace, now = () => Date.now(), sessionId = null, maxContacts = PHONE_MATERIAL_MAX_CONTACTS } = {}) {
    this.solver = solver;
    this.now = now;
    this.sessionId = sessionId || `phone-material-session:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
    this.maxContacts = maxContacts;
    this.body = null;
    this.entityId = PHONE_MATERIAL_ENTITY_ID;
    this.contacts = new Map();
    this.sourceFences = new Map();
    this.activeSpaceId = null;
    this.available = false;
  }

  open({ envelope, entityId = PHONE_MATERIAL_ENTITY_ID } = {}) {
    this.entityId = entityId;
    const snapshot = envelope?.snapshot || envelope;
    if (!snapshot?.materialBodies) snapshot.materialBodies = {};
    const existing = snapshot.materialBodies[entityId];
    const spaceId = envelope?.eyes?.[envelope.currentEyeId]?.spaceId || snapshot.rootSpaceId;
    const space = snapshot.spaces?.[spaceId];
    const entity = space?.entities?.[entityId];
    if (!space || !entity || spaceId !== snapshot.rootSpaceId) {
      this.available = false;
      this.contacts.clear();
      return { available: false, created: false, contactsRevived: false, reason: 'Workpiece is outside the active phone root space.' };
    }
    const identity = materialIdentityFromEnvelope(envelope, entityId, existing);
    let created = false;
    if (existing) {
      validateMaterialBody(existing);
      if (existing.identity.dimension !== identity.dimension) throw materialError('MATERIAL_TOPOLOGY_CHANGED', 'The persisted Workpiece patch dimension changed.');
      this.body = existing;
    } else {
      this.body = createGridBody({ identity, entity });
      this.body.acceptedSequence = Number(snapshot.acceptedSequence) || 0;
      this.body.identity = patchIdentity(identity, this.body.bodyRevision, this.body.topologyRevision);
      snapshot.materialBodies[entityId] = this.body;
      created = true;
    }
    this.contacts.clear();
    this.available = true;
    this.activeSpaceId = spaceId;
    this.syncEnvelope(envelope, { invalidateContacts: false });
    return { available: true, created, contactsRevived: false, body: materialClone(this.body) };
  }

  _rootEnvelopeScope(envelope) {
    const snapshot = envelope?.snapshot || envelope;
    const eyes = envelope?.eyes || {};
    const eye = envelope?.currentEyeId ? eyes[envelope.currentEyeId] : null;
    const activeSpaceId = eye?.spaceId || snapshot?.rootSpaceId;
    const spaceId = this.body?.identity?.spaceId || snapshot?.rootSpaceId;
    const space = snapshot?.spaces?.[spaceId];
    const entity = space?.entities?.[this.entityId];
    if (!snapshot || !space || !entity) throw materialError('MATERIAL_SCOPE_CHANGED', 'The accepted Workpiece body is no longer present.');
    return {
      snapshot, activeSpaceId, available: activeSpaceId === spaceId,
      identity: patchIdentity({
        worldId: snapshot.worldId, authorityId: snapshot.authorityId, branchId: envelope.branchId,
        spaceId, entityId: this.entityId, dimension: space.dimension, chart: entity.chart || 'flat',
        topologyId: this.body.topologyId, topologyVersion: this.body.topologyVersion,
        topologyRevision: this.body.topologyRevision, bodyRevision: this.body.bodyRevision,
      }, this.body.bodyRevision, this.body.topologyRevision),
      entity,
    };
  }

  syncEnvelope(envelope, { invalidateContacts = true } = {}) {
    if (!this.body) return { changed: false, available: false };
    const scope = this._rootEnvelopeScope(envelope);
    const priorIdentity = this.body.identity;
    const scopeChanged = !compareScope(staticScope(priorIdentity), staticScope(scope.identity)) || this.activeSpaceId !== scope.activeSpaceId;
    if (scopeChanged && invalidateContacts && this.contacts.size) {
      // A live contact cannot be carried across a branch/space/world scope
      // change. Fence it before rejecting the stale operation; the caller
      // must reopen/reconcile the new scope before starting fresh contacts.
      this.contacts.clear();
      throw materialError('MATERIAL_SCOPE_CHANGED', 'The accepted material scope changed while contacts were live.');
    }
    if (scopeChanged && invalidateContacts) this.contacts.clear();
    this.activeSpaceId = scope.activeSpaceId;
    this.body.identity = patchIdentity(scope.identity, this.body.bodyRevision, this.body.topologyRevision);
    const changed = shiftBodyToCentroid(this.body, this.body.centroid.q, scope.entity.q);
    this.body.entityRevision = Number(scope.entity.revision) || this.body.entityRevision;
    this.body.centroid.v = validateVector(scope.entity.v || zero(this.body.identity.dimension), this.body.identity.dimension, 'Workpiece v');
    this.available = scope.available;
    return { changed: scopeChanged || changed, available: scope.available, scopeChanged, body: materialClone(this.body) };
  }

  _requireAvailable(envelope) {
    if (!this.body) throw materialError('MATERIAL_BODY_UNAVAILABLE', 'The phone Workpiece material body is not open.');
    const synced = this.syncEnvelope(envelope);
    if (!synced.available) throw materialError('MATERIAL_SCOPE_CHANGED', 'Material contacts are invalid outside the Workpiece root space.');
    return synced;
  }

  _identity(envelope) {
    const scope = this._requireAvailable(envelope);
    return patchIdentity(this.body.identity, this.body.bodyRevision, this.body.topologyRevision);
  }

  _sequence(nextSequence) {
    const sequence = typeof nextSequence === 'function' ? Number(nextSequence()) : this.body.acceptedSequence + 1;
    if (!Number.isSafeInteger(sequence) || sequence <= this.body.acceptedSequence) throw materialError('MATERIAL_SEQUENCE_INVALID', 'Accepted material sequence did not advance monotonically.');
    this.body.acceptedSequence = sequence;
    return sequence;
  }

  _receipt({ operationId, kind, fingerprint, identity, source = null, attachment = null, observedAt, receivedAt, nextSequence, code = 'MATERIAL_ACCEPTED', result = null }) {
    const acceptedSequence = this._sequence(nextSequence);
    const receipt = {
      schema: PHONE_MATERIAL_RECEIPT_SCHEMA,
      operationId,
      kind,
      status: 'accepted',
      code,
      identity: patchIdentity(identity, this.body.bodyRevision, this.body.topologyRevision),
      source: source ? materialClone(source) : null,
      attachment: attachment ? materialClone(attachment) : null,
      targetSeq: result?.targetSeq ?? null,
      acceptedSequence,
      bodyRevision: this.body.bodyRevision,
      topologyRevision: this.body.topologyRevision,
      observedAt,
      receivedAt,
      fingerprint,
      result: result ? materialClone(result) : null,
    };
    pushReceipt(this.body, receipt);
    return receipt;
  }

  _replayOrMismatch(operationId, fingerprint) {
    const prior = matchingReceipt(this.body, operationId);
    if (!prior) return null;
    if (prior.fingerprint !== fingerprint) throw materialError('MATERIAL_OPERATION_REPLAY_MISMATCH', 'The operation identity was already used for a different material request.');
    return {
      status: prior.status || 'accepted',
      receipt: materialClone(prior),
      result: prior.result ? materialClone(prior.result) : null,
      replayed: true,
    };
  }

  _validateContactPayload(payload, kind) {
    const identity = this._identity(payload.envelope);
    const operationId = normalizeOperationId(payload.operationId);
    const receivedAt = finite(payload.receivedAt, this.now());
    const observedAt = finite(payload.observedAt, receivedAt);
    if (observedAt < 0 || receivedAt < 0) throw materialError('MATERIAL_TIME_INVALID', 'Material timestamps must be non-negative.');
    if (payload.identity?.worldId !== identity.worldId || payload.identity?.authorityId !== identity.authorityId || payload.identity?.branchId !== identity.branchId ||
        payload.identity?.spaceId !== identity.spaceId || payload.identity?.entityId !== identity.entityId || Number(payload.identity?.dimension) !== identity.dimension ||
        payload.identity?.chart !== identity.chart || payload.identity?.topologyId !== identity.topologyId || payload.identity?.topologyVersion !== identity.topologyVersion ||
        Number(payload.identity?.topologyRevision) !== identity.topologyRevision) {
      throw materialError('MATERIAL_SCOPE_CHANGED', 'The material operation belongs to a stale world, authority, branch, space, entity, or topology.');
    }
    if (kind !== 'begin' && Number(payload.identity?.bodyRevision) > this.body.bodyRevision) throw materialError('MATERIAL_BODY_AHEAD', 'The target body revision is newer than accepted phone state.');
    return { identity, operationId, observedAt, receivedAt };
  }

  begin(payload = {}) {
    const prepared = this._validateContactPayload({ ...payload, envelope: payload.envelope }, 'begin');
    const source = normalizeMaterialSource(payload.source, 'begin.source');
    const attachment = normalizeAttachment(payload.attachment, prepared.identity.dimension);
    const actuator = normalizeActuator(payload.actuator);
    const fingerprint = receiptFingerprint({ kind: 'begin', identity: staticScope(prepared.identity), source, contactId: payload.contactId, attachment, actuator });
    const replay = this._replayOrMismatch(prepared.operationId, fingerprint);
    if (replay) return replay;
    if (this.contacts.size >= this.maxContacts) throw materialError('MATERIAL_CONTACT_LIMIT', 'Phone material contact limit exceeded.');
    const contactId = typeof payload.contactId === 'string' && payload.contactId.length ? payload.contactId : null;
    if (!contactId || contactId.length > 160 || /[\u0000-\u001f\u007f]/.test(contactId)) throw materialError('MATERIAL_CONTACT_INVALID', 'Contact identity is invalid.');
    const node = this.body.nodes[attachment.nodeId];
    if (!node) throw materialError('MATERIAL_NODE_OWNERSHIP', 'The captured material node is not owned by this Workpiece topology.');
    const fence = this.sourceFences.get(sourceOwnerKey(source));
    if (fence && source.generation <= fence) throw materialError('MATERIAL_SOURCE_STOPPED', 'The source generation was stopped; explicitly create a fresh generation.');
    if (this.contacts.has(contactId)) throw materialError('MATERIAL_CONTACT_REPLAY', 'The contact identity is already active.');
    const contact = {
      contactId, source, sourceKey: sourceKey(source), generation: source.generation,
      attachment, actuator, lastTarget: null, begunAt: prepared.receivedAt,
      operationId: prepared.operationId,
    };
    this.contacts.set(contactId, contact);
    const receipt = this._receipt({
      operationId: prepared.operationId, kind: 'begin', fingerprint, identity: prepared.identity,
      source, attachment, observedAt: prepared.observedAt, receivedAt: prepared.receivedAt,
      nextSequence: payload.nextSequence,
      result: { contactId, nodeId: attachment.nodeId },
    });
    return { status: 'accepted', receipt: materialClone(receipt), contact: materialClone(contact), replayed: false };
  }

  target(payload = {}) {
    const identity = this._identity(payload.envelope);
    const operationId = normalizeOperationId(payload.operationId);
    const receivedAt = finite(payload.receivedAt, this.now());
    const target = normalizeMaterialTarget({ ...payload, schema: payload.schema || PHONE_MATERIAL_TARGET_SCHEMA, receivedAt }, { identity });
    const contact = this.contacts.get(target.contactId);
    if (!contact) throw materialError('MATERIAL_CONTACT_UNKNOWN', 'The material contact is not live on this phone session.');
    if (target.sourceKey === undefined) target.sourceKey = sourceKey(target.source);
    if (target.sourceKey !== contact.sourceKey || target.source.generation !== contact.generation) throw materialError('MATERIAL_GENERATION_STALE', 'The material contact generation is stale.');
    if (target.identity.topologyRevision !== this.body.topologyRevision) throw materialError('MATERIAL_TOPOLOGY_STALE', 'The contact topology revision is stale.');
    if (target.attachment.nodeId !== contact.attachment.nodeId) throw materialError('MATERIAL_NODE_MISMATCH', 'A contact cannot retarget a different captured node.');
    if (!this.body.nodes[contact.attachment.nodeId]) throw materialError('MATERIAL_NODE_OWNERSHIP', 'The target node is not owned by the captured contact topology.');
    const fingerprint = receiptFingerprint({
      kind: 'target', identity: staticScope(target.identity), source: target.source, contactId: target.contactId,
      targetSeq: target.targetSeq, q: target.q, attachment: target.attachment, actuator: target.actuator, observedAt: target.observedAt,
    });
    const replay = this._replayOrMismatch(operationId, fingerprint);
    if (replay) return replay;
    const cursorKey = sourceKey(target.source);
    const cursor = this.body.inputCursor[cursorKey];
    if (cursor && target.targetSeq <= Number(cursor.lastTargetSeq)) {
      if (target.targetSeq === Number(cursor.lastTargetSeq) && contact.lastTarget?.operationId === operationId) {
        const prior = matchingReceipt(this.body, operationId);
        if (prior) return { status: prior.status || 'accepted', receipt: materialClone(prior), result: prior.result ? materialClone(prior.result) : null, replayed: true };
      }
      throw materialError('MATERIAL_TARGET_STALE', 'The material target sequence is older than the accepted source cursor.');
    }
    normalizeBodySourceCursor(this.body, target.source, target.targetSeq, target.observedAt, target.receivedAt);
    contact.lastTarget = materialClone(target);
    const receipt = this._receipt({
      operationId, kind: 'target', fingerprint, identity: target.identity, source: target.source,
      attachment: target.attachment, observedAt: target.observedAt, receivedAt: target.receivedAt,
      nextSequence: payload.nextSequence,
      result: { contactId: target.contactId, nodeId: target.attachment.nodeId, targetSeq: target.targetSeq },
    });
    return { status: 'accepted', receipt: materialClone(receipt), contact: materialClone(contact), target: materialClone(target), replayed: false };
  }

  _stepWithEnvelope(envelope, { dt = DEFAULT_DT, nextSequence = null } = {}) {
    this._requireAvailable(envelope);
    const previousRevision = this.body.bodyRevision;
    const result = advanceBody(this.body, this.contacts, { dt, solver: this.solver });
    if (!result.changed) return { ...result, acceptedSequence: this.body.acceptedSequence, entityRevision: this.body.entityRevision };
    this._sequence(nextSequence);
    this.body.entityRevision = Number(this.body.entityRevision) + 1;
    return { ...result, acceptedSequence: this.body.acceptedSequence, entityRevision: this.body.entityRevision, previousBodyRevision: previousRevision };
  }

  step({ envelope, dt = DEFAULT_DT, nextSequence = null } = {}) {
    const result = this._stepWithEnvelope(envelope, { dt, nextSequence });
    return {
      status: result.changed ? 'accepted' : 'unchanged',
      ...result,
      body: materialClone(this.body),
      entity: result.changed ? { q: [...this.body.centroid.q], v: [...this.body.centroid.v], revision: this.body.entityRevision } : null,
    };
  }

  end(payload = {}) {
    const prepared = this._validateContactPayload({ ...payload, envelope: payload.envelope }, 'end');
    const contactId = String(payload.contactId || '');
    const contact = this.contacts.get(contactId);
    if (!contact) {
      const replay = this._replayOrMismatch(prepared.operationId, receiptFingerprint({ kind: 'end', identity: staticScope(prepared.identity), contactId }));
      if (replay) return replay;
      throw materialError('MATERIAL_CONTACT_UNKNOWN', 'The material contact is no longer live; reconcile accepted history before retrying.');
    }
    const fingerprint = receiptFingerprint({ kind: 'end', identity: staticScope(prepared.identity), contactId, source: contact.source, reason: String(payload.reason || 'release') });
    const replay = this._replayOrMismatch(prepared.operationId, fingerprint);
    if (replay) return replay;
    const flush = this._stepWithEnvelope(payload.envelope, { dt: payload.dt ?? DEFAULT_DT, nextSequence: payload.nextSequence });
    this.contacts.delete(contactId);
    const receipt = this._receipt({
      operationId: prepared.operationId, kind: 'end', fingerprint, identity: prepared.identity, source: contact.source,
      attachment: contact.attachment, observedAt: prepared.observedAt, receivedAt: prepared.receivedAt,
      nextSequence: payload.nextSequence,
      result: { contactId, reason: String(payload.reason || 'release'), flushed: Boolean(flush.changed), solverEnabled: flush.solverEnabled },
    });
    return { status: 'accepted', receipt: materialClone(receipt), flush, released: materialClone(contact), replayed: false };
  }

  cancel(payload = {}) {
    const prepared = this._validateContactPayload({ ...payload, envelope: payload.envelope }, 'cancel');
    const contactId = String(payload.contactId || '');
    const contact = this.contacts.get(contactId);
    const fingerprint = receiptFingerprint({ kind: 'cancel', identity: staticScope(prepared.identity), contactId, reason: String(payload.reason || 'cancel') });
    const replay = this._replayOrMismatch(prepared.operationId, fingerprint);
    if (replay) return replay;
    if (!contact) throw materialError('MATERIAL_CONTACT_UNKNOWN', 'The material contact is no longer live; accepted history remains unchanged.');
    this.contacts.delete(contactId);
    const receipt = this._receipt({
      operationId: prepared.operationId, kind: 'cancel', fingerprint, identity: prepared.identity, source: contact.source,
      attachment: contact.attachment, observedAt: prepared.observedAt, receivedAt: prepared.receivedAt,
      nextSequence: payload.nextSequence,
      result: { contactId, reason: String(payload.reason || 'cancel'), acceptedHistoryPreserved: true },
    });
    return {
      status: 'accepted', receipt: materialClone(receipt),
      released: { ...materialClone(contact), acceptedHistoryPreserved: true }, replayed: false,
    };
  }

  stopSource(payload = {}) {
    const prepared = this._validateContactPayload({ ...payload, envelope: payload.envelope }, 'stop');
    const source = normalizeMaterialSource(payload.source, 'stop.source');
    const owner = sourceOwnerKey(source);
    const priorFence = this.sourceFences.get(owner) || 0;
    this.sourceFences.set(owner, Math.max(priorFence, source.generation));
    const released = [];
    for (const [contactId, contact] of this.contacts) {
      if (!activeSourceOwner(contact, source)) continue;
      this.contacts.delete(contactId);
      released.push({ contactId, source: materialClone(contact.source), nodeId: contact.attachment.nodeId, acceptedHistoryPreserved: true });
    }
    const fingerprint = receiptFingerprint({ kind: 'stop', identity: staticScope(prepared.identity), source, reason: String(payload.reason || 'source-stop') });
    const replay = this._replayOrMismatch(prepared.operationId, fingerprint);
    if (replay) return replay;
    const receipt = this._receipt({
      operationId: prepared.operationId, kind: 'stop', fingerprint, identity: prepared.identity, source,
      observedAt: prepared.observedAt, receivedAt: prepared.receivedAt, nextSequence: payload.nextSequence,
      result: { owner, generation: source.generation, releasedCount: released.length, acceptedHistoryPreserved: true },
    });
    return { status: 'accepted', receipt: materialClone(receipt), released, replayed: false };
  }

  preview({ envelope, target, project = null, dt = DEFAULT_DT } = {}) {
    this._requireAvailable(envelope);
    if (!target) return project ? projectMaterialBody(this.body, { project }) : { body: materialClone(this.body), provisional: false };
    const contact = this.contacts.get(target.contactId);
    if (!contact) throw materialError('MATERIAL_CONTACT_UNKNOWN', 'A provisional target requires a live material contact.');
    const identity = this._identity(envelope);
    const normalized = normalizeMaterialTarget({ ...target, schema: target.schema || PHONE_MATERIAL_TARGET_SCHEMA, identity, receivedAt: target.receivedAt ?? this.now() }, { identity, contact });
    const detachedBody = materialClone(this.body);
    const detachedContact = materialClone(contact);
    detachedContact.lastTarget = normalized;
    const detachedContacts = new Map([[detachedContact.contactId, detachedContact]]);
    const result = advanceBody(detachedBody, detachedContacts, { dt, solver: this.solver });
    const render = project ? projectMaterialBody(detachedBody, { project }, { provisional: true }) : null;
    return {
      status: 'preview', provisional: true, changed: result.changed,
      acceptedBodyRevision: this.body.bodyRevision, bodyRevision: detachedBody.bodyRevision,
      acceptedSequence: this.body.acceptedSequence, nodes: materialClone(detachedBody.nodes), edges: materialClone(detachedBody.edges),
      centroid: materialClone(detachedBody.centroid), render,
    };
  }

  reconcile({ envelope, targets = [] } = {}) {
    this._requireAvailable(envelope);
    const newerTargets = [];
    for (const candidate of Array.isArray(targets) ? targets : []) {
      try {
        const source = normalizeMaterialSource(candidate.source, 'reconcile.source');
        const cursor = this.body.inputCursor[sourceKey(source)];
        if (cursor && Number(candidate.targetSeq) <= Number(cursor.lastTargetSeq)) continue;
        if (!this.contacts.has(candidate.contactId)) continue;
        newerTargets.push(materialClone(candidate));
      } catch {
        // Reconciliation is fail-closed for malformed/unowned queued input.
      }
    }
    return {
      status: 'reconciled',
      body: materialClone(this.body),
      newerTargets,
      replayedMesh: false,
      contactsRevived: false,
      note: 'Reconciliation returned the latest accepted body plus newer absolute targets; it never reapplied a stale mesh as relative edits.',
    };
  }

  reconcileOperation(operationId) {
    const id = normalizeOperationId(operationId);
    const receipt = matchingReceipt(this.body, id);
    return receipt ? { status: 'known', receipt: materialClone(receipt), safeToRetry: false } : { status: 'unknown', operationId: id, safeToRetry: false };
  }

  snapshot() {
    return {
      body: this.body ? materialClone(this.body) : null,
      activeContacts: [...this.contacts.values()].map(contact => ({
        contactId: contact.contactId, source: materialClone(contact.source), nodeId: contact.attachment.nodeId,
        targetSeq: contact.lastTarget?.targetSeq ?? null,
      })),
      contactsPersisted: false,
      sessionId: this.sessionId,
    };
  }
}

/**
 * One in-flight target plus the newest unsent target. Normal release drains
 * that newest target before removing only its actuator; cancellation fences
 * unsent work and leaves accepted body history untouched.
 */
export class MaterialContactQueue {
  constructor({ submit, release, cancel, reconcile = null } = {}) {
    if (typeof submit !== 'function' || typeof release !== 'function' || typeof cancel !== 'function') throw new TypeError('Material contact queue needs submit, release, and cancel functions.');
    this.submit = submit; this.releaseOperation = release; this.cancelOperation = cancel; this.reconcileOperation = reconcile;
    this.tail = Promise.resolve(); this.inFlight = null; this.unsent = null; this.stopped = false; this.ended = false; this.releasing = false;
  }

  offer(target) {
    if (this.stopped || this.ended || this.releasing) return Promise.resolve({ status: 'fenced', submitted: false });
    if (this.inFlight) {
      this.unsent = target;
      return Promise.resolve({ status: 'queued', submitted: false, targetSeq: target.targetSeq });
    }
    const run = (async () => {
      let current = target;
      let result = null;
      while (current) {
        result = await this.submit(current);
        if (this.stopped) return { status: 'submitted-requires-reconciliation', submitted: true, result };
        if (this.unsent) {
          current = this.unsent;
          this.unsent = null;
        } else current = null;
      }
      return { status: 'accepted', submitted: true, result };
    })().catch(error => { this.unsent = null; throw error; });
    this.inFlight = run;
    this.tail = run.finally(() => { this.inFlight = null; });
    return this.tail;
  }

  async release(reason = 'release') {
    if (this.ended) return { status: 'already-ended' };
    this.releasing = true;
    const submitted = await this.tail.catch(error => ({ status: 'submitted-error', error }));
    this.releasing = false; this.ended = true;
    if (submitted?.status === 'submitted-error') {
      const reconciliation = typeof this.reconcileOperation === 'function' ? await this.reconcileOperation(submitted.error) : null;
      return { status: 'submitted-requires-reconciliation', submitted: true, reconciliation };
    }
    return this.releaseOperation(reason);
  }

  async cancel(reason = 'cancel') {
    if (this.ended) return { status: 'already-ended' };
    this.ended = true; this.stopped = true; this.unsent = null;
    const submitted = await this.tail.catch(error => ({ status: 'submitted-error', error }));
    if (submitted?.status === 'submitted-error') {
      const reconciliation = typeof this.reconcileOperation === 'function' ? await this.reconcileOperation(submitted.error) : null;
      return { status: 'submitted-requires-reconciliation', submitted: true, reconciliation };
    }
    return this.cancelOperation(reason);
  }

  async stop(reason = 'source-stop') {
    if (this.stopped) return { status: 'already-stopped' };
    this.stopped = true; this.unsent = null;
    const submitted = await this.tail.catch(error => ({ status: 'submitted-error', error }));
    if (submitted?.status === 'submitted-error') {
      const reconciliation = typeof this.reconcileOperation === 'function' ? await this.reconcileOperation(submitted.error) : null;
      return { status: 'submitted-requires-reconciliation', submitted: true, reconciliation };
    }
    return this.cancelOperation(reason);
  }
}

export function capturedInverseMapping({ devicePoint, viewport, renderer, axes, depth, canonicalQ } = {}) {
  const dimension = Array.isArray(canonicalQ) ? canonicalQ.length : 0;
  return normalizeInverseMapping({
    schema: 'vivo.phone.material-inverse/1', devicePoint, viewport, renderer, axes, depth, canonicalQ,
  }, dimension);
}
