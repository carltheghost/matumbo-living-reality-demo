/**
 * Viva's local phone authority. Spatial state is a bounded sparse graph: each
 * entity stores only its active 3D..11D coordinates and its explicit neighbors.
 * Eye state is kept beside the world, never folded into an object's coordinates.
 */
export const PHONE_SCHEMA = 'vivo.phone.snapshot/1';
export const MIN_DIMENSION = 3;
export const MAX_DIMENSION = 11;
export const MAX_EYES = 64;
export const MAX_ENTITIES_PER_SPACE = 4096;
export const MAX_EDGES_PER_SPACE = 32768;
const MAX_COORDINATE = 1e6;
const MAX_SPEED = 20;
const FIXED_STEP = 1 / 30;
const BRANCH_MODES = new Set(['local', 'offline-branch']);

const clone = value => structuredClone(value);
export const MIN_SHAPE_SCALE = 0.05;
export const MAX_SHAPE_SCALE = 20;
const wrapAngle = value => {
  let angle = Number(value) || 0;
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
};
export function normalizeEntityGeometry(value, dimension) {
  const source = value && typeof value === 'object' ? value : {};
  const scale = Number(source.scale ?? 1);
  const rotation = Number(source.rotation ?? 0);
  const axes = Array.isArray(source.axes) ? source.axes.map(Number).filter(Number.isInteger) : [0, 1];
  if (!Number.isFinite(scale) || scale < MIN_SHAPE_SCALE || scale > MAX_SHAPE_SCALE) throw new RangeError('Entity shape scale is outside the local bounds');
  if (!Number.isFinite(rotation) || rotation < -1e6 || rotation > 1e6) throw new RangeError('Entity shape rotation is outside the local bounds');
  const selected = [];
  for (const axis of axes) {
    if (axis >= 0 && axis < dimension && !selected.includes(axis)) selected.push(axis);
    if (selected.length === 2) break;
  }
  for (let axis = 0; selected.length < 2 && axis < dimension; axis++) if (!selected.includes(axis)) selected.push(axis);
  if (selected.length !== 2) throw new RangeError('Entity shape axes must select two dimensions');
  return { scale, rotation: wrapAngle(rotation), axes: selected };
}
const finiteVector = (value, dimension, label) => {
  if (!Array.isArray(value) || value.length !== dimension || value.some(n => !Number.isFinite(n) || Math.abs(n) > MAX_COORDINATE)) {
    throw new TypeError(`${label} must contain ${dimension} finite bounded coordinates`);
  }
  return value;
};
const uuid = () => globalThis.crypto?.randomUUID?.() || `vivo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const identity = d => Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => Number(i === j)));
const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));

export function createPhoneSnapshot({ worldId = uuid(), now = Date.now(), rootDimension = 4 } = {}) {
  if (!Number.isInteger(rootDimension) || rootDimension < MIN_DIMENSION || rootDimension > MAX_DIMENSION) throw new RangeError('Root dimension must be 3 through 11');
  const rootQ = (x, y) => [x, y, 0.25, ...Array(rootDimension - 3).fill(0)];
  const entity = (id, name, dimension, q, radius, innerSpaceId = null) => ({
    id, spaceId: null, dimension, chart: 'flat', q: [...q], v: Array(dimension).fill(0),
    revision: 0, name, radius, materialProfile: 'local-sparse', fieldMembership: [],
    lineage: [], innerSpaceId, geometry: normalizeEntityGeometry(null, dimension),
  });
  const makeSpace = (id, dimension, entities, edges) => {
    for (const item of Object.values(entities)) item.spaceId = id;
    const nodes = Object.values(entities).map(item => item.id);
    return {
      id, dimension, intrinsicDimension: dimension, atlasId: 'flat', metricId: 'euclidean',
      topologyId: 'open', law: { id: 'vivo.phone.sparse-spring', version: '1' },
      field: { codec: 'vivo.phone.sparse-graph/1', nodes, edges }, entities,
    };
  };
  const root = {
    relic: entity('relic', 'Relic', rootDimension, rootQ(-1.15, -0.1), 0.28),
    workpiece: entity('workpiece', 'Workpiece', rootDimension, rootQ(0.1, 0.72), 0.3),
    portal: entity('portal', 'Inner world', rootDimension, rootQ(1.3, -0.1), 0.34, 'inner'),
  };
  const rootEdges = [['relic', 'workpiece'], ['workpiece', 'portal']].map(([a, b]) => ({
    a, b, restLength: distance(root[a].q, root[b].q), stiffness: 0.18,
  }));
  const inner = { innerRelic: entity('innerRelic', 'Inner relic', 11, [0, 0, 0.25, ...Array(8).fill(0)], 0.3) };
  return {
    schema: PHONE_SCHEMA, worldId, authorityId: `local:${worldId}`,
    acceptedSequence: 0, simulationTime: 0, savedAt: now, rootSpaceId: 'root', localOperationResults: [],
    spaces: {
      root: makeSpace('root', rootDimension, root, rootEdges),
      inner: makeSpace('inner', 11, inner, []),
    },
  };
}

export function createEye({ id = uuid(), label = 'Phone Eye', spaceId = 'root', dimension = 4 } = {}) {
  if (!Number.isInteger(dimension) || dimension < MIN_DIMENSION || dimension > MAX_DIMENSION) throw new RangeError('Eye dimension must be 3 through 11');
  return {
    id, label, spaceId, q: Array(dimension).fill(0), basis: identity(dimension),
    slice: Object.fromEntries(Array.from({ length: Math.max(0, dimension - 3) }, (_, i) => [`x${i + 4}`, 0])),
    returnStack: [], projection: { mode: 'slice', scale: 10.5, rotation: 0.55, tilt: 0.68 }, revision: 0,
  };
}

export function validatePhoneSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== PHONE_SCHEMA || typeof snapshot.worldId !== 'string' || !snapshot.spaces || typeof snapshot.spaces !== 'object') throw new TypeError('Unsupported Vivo phone snapshot');
  const spaceIds = Object.keys(snapshot.spaces);
  if (!spaceIds.length || spaceIds.length > 256 || spaceIds.length > 1 && !snapshot.rootSpaceId) throw new RangeError('Invalid space count');
  let entityCount = 0;
  for (const [spaceId, space] of Object.entries(snapshot.spaces)) {
    if (space.id !== spaceId || !Number.isInteger(space.dimension) || space.dimension < MIN_DIMENSION || space.dimension > MAX_DIMENSION) throw new RangeError(`Invalid space ${spaceId}`);
    const entities = Object.values(space.entities || {});
    entityCount += entities.length;
    if (entities.length > MAX_ENTITIES_PER_SPACE) throw new RangeError('Entity limit exceeded');
    for (const e of entities) {
      if (e.spaceId !== spaceId || !Number.isFinite(e.radius) || e.radius <= 0 || e.radius > 1000) throw new TypeError('Invalid entity metadata');
      finiteVector(e.q, space.dimension, 'q'); finiteVector(e.v, space.dimension, 'v');
      e.geometry = normalizeEntityGeometry(e.geometry, space.dimension);
    }
    const edges = space.field?.edges || [];
    if (!Array.isArray(edges) || edges.length > MAX_EDGES_PER_SPACE) throw new RangeError('Sparse edge limit exceeded');
    const neighbors = new Map(entities.map(e => [e.id, 0]));
    for (const edge of edges) {
      if (!neighbors.has(edge.a) || !neighbors.has(edge.b) || edge.a === edge.b || !Number.isFinite(edge.restLength) || edge.restLength < 0 || !Number.isFinite(edge.stiffness) || edge.stiffness < 0 || edge.stiffness > 10) throw new TypeError('Invalid sparse material edge');
      neighbors.set(edge.a, neighbors.get(edge.a) + 1); neighbors.set(edge.b, neighbors.get(edge.b) + 1);
      if (neighbors.get(edge.a) > 12 || neighbors.get(edge.b) > 12) throw new RangeError('Sparse neighbor limit exceeded');
    }
  }
  if (entityCount > 16384) throw new RangeError('World entity limit exceeded');
  if (!spaceIds.includes(snapshot.rootSpaceId)) throw new TypeError('Root space is missing');
  if (snapshot.localOperationResults !== undefined && (!Array.isArray(snapshot.localOperationResults) || snapshot.localOperationResults.length > 128)) throw new RangeError('Local operation result limit exceeded');
  return snapshot;
}

export function validateEyes(eyes, snapshot) {
  if (!eyes || typeof eyes !== 'object' || Object.keys(eyes).length > MAX_EYES) throw new RangeError('Invalid Eye collection');
  for (const eye of Object.values(eyes)) {
    const space = snapshot.spaces[eye.spaceId];
    if (!space) throw new TypeError('Eye refers to a missing space');
    finiteVector(eye.q, space.dimension, 'Eye q');
    if (!Array.isArray(eye.basis) || eye.basis.length !== space.dimension || eye.basis.some(row => !Array.isArray(row) || row.length !== space.dimension || row.some(n => !Number.isFinite(n)))) throw new TypeError('Eye basis does not match its space');
    if (!Array.isArray(eye.returnStack) || eye.returnStack.length > 64) throw new RangeError('Eye return stack limit exceeded');
  }
  return eyes;
}

const validBranchId = value => typeof value === 'string' && value.length >= 1 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const validOperationId = value => typeof value === 'string' && value.length >= 1 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const operationError = (code, message) => { const error = new Error(`${code}: ${message}`); error.code = code; return error; };
const operationFingerprint = ({ worldId, branchId, eyeId, spaceId, entityId, baseRevision, delta, geometry = null }) => JSON.stringify({ worldId, branchId, eyeId, spaceId, entityId, baseRevision, delta, geometry });
const operationScope = ({ worldId, branchId, eyeId, spaceId, entityId }) => JSON.stringify({ worldId, branchId, eyeId, spaceId, entityId });
function restoreBranchMetadata(envelope) {
  if (envelope.branchId !== undefined && !validBranchId(envelope.branchId)) throw new TypeError('Invalid phone branch identity');
  if (envelope.mode !== undefined && !BRANCH_MODES.has(envelope.mode)) throw new TypeError('Invalid phone branch mode');
  if (envelope.mode === 'offline-branch' && !envelope.branchId) throw new TypeError('Offline branch identity is missing');
  if (envelope.parentBranchId !== undefined && envelope.parentBranchId !== null && !validBranchId(envelope.parentBranchId)) throw new TypeError('Invalid phone parent branch identity');
  if (envelope.mode === 'offline-branch' && envelope.parentBranchId !== undefined && envelope.parentBranchId !== null && envelope.parentBranchId === envelope.branchId) throw new TypeError('Offline branch cannot parent itself');
  if (envelope.branchLabel !== undefined && envelope.branchLabel !== null && typeof envelope.branchLabel !== 'string') throw new TypeError('Invalid phone branch label');
  const forkedAt = envelope.forkedAt === undefined || envelope.forkedAt === null ? null : Number(envelope.forkedAt);
  if (forkedAt !== null && !Number.isFinite(forkedAt)) throw new TypeError('Invalid phone branch timestamp');
  return {
    branchId: envelope.branchId || uuid(),
    mode: envelope.mode || 'local',
    parentBranchId: envelope.parentBranchId || null,
    branchLabel: envelope.branchLabel === undefined || envelope.branchLabel === null ? null : envelope.branchLabel.slice(0, 256),
    forkedAt,
  };
}

/** Fixed-step, local-neighborhood simulation. Nothing allocates by D^dimension. */
export function stepSparseSpace(space, dt = FIXED_STEP, activeIds = null) {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw new RangeError('Simulation step must be between 0 and 100 ms');
  const entities = space.entities, edges = space.field.edges || [], forces = new Map();
  const active = activeIds ? new Set(activeIds) : new Set(Object.keys(entities));
  if (!active.size) return false;
  for (const edge of edges) if (active.has(edge.a) || active.has(edge.b)) { active.add(edge.a); active.add(edge.b); }
  for (const id of active) {
    if (!entities[id]) throw new TypeError('Active material node is missing');
    forces.set(id, Array(space.dimension).fill(0));
  }
  for (const edge of edges) {
    if (!active.has(edge.a) && !active.has(edge.b)) continue;
    const a = entities[edge.a], b = entities[edge.b], delta = b.q.map((v, i) => v - a.q[i]);
    const length = Math.hypot(...delta);
    if (length < 1e-8) continue;
    const magnitude = edge.stiffness * (length - edge.restLength);
    const fa = forces.get(edge.a), fb = forces.get(edge.b);
    for (let i = 0; i < space.dimension; i++) {
      const f = magnitude * delta[i] / length;
      if (fa) fa[i] += f;
      if (fb) fb[i] -= f;
    }
  }
  let moving = false;
  for (const id of active) {
    const entity = entities[id], force = forces.get(id) || Array(space.dimension).fill(0);
    for (let axis = 0; axis < space.dimension; axis++) {
      entity.v[axis] = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, (entity.v[axis] + force[axis] * dt) * 0.985));
      entity.q[axis] += entity.v[axis] * dt;
      if (Math.abs(entity.v[axis]) < 1e-5) entity.v[axis] = 0;
      else moving = true;
    }
    entity.revision++;
  }
  return moving;
}

export class LocalVivoEngine {
  constructor({ storage, onChange = () => {}, now = () => Date.now() } = {}) {
    this.storage = storage || null; this.onChange = onChange; this.now = now;
    this.snapshotState = null; this.eyes = {}; this.currentEyeId = null; this.activeIds = new Set(); this.appliedOperations = new Map();
    this.activeSpaceId = null; this._tail = Promise.resolve(); this.lastPersistence = Promise.resolve({ persistent: false });
    this.persistence = { state: 'unpersisted', error: null }; this.branchId = uuid(); this.mode = 'local';
    this.parentBranchId = null; this.branchLabel = null; this.forkedAt = null;
  }
  async open(worldId, rootDimension = 4) {
    const stored = await this.storage?.load?.(worldId);
    if (stored) {
      validatePhoneSnapshot(stored.snapshot); validateEyes(stored.eyes, stored.snapshot);
      this.snapshotState = clone(stored.snapshot); this.eyes = clone(stored.eyes);
      this.currentEyeId = stored.currentEyeId;
      Object.assign(this, restoreBranchMetadata(stored));
      this.appliedOperations = new Map((this.snapshotState.localOperationResults || []).filter(item => validOperationId(item?.operationId)).map(item => [item.operationId, clone(item)]));
      this.persistence = { state: 'saved', error: null };
    } else {
      this.snapshotState = createPhoneSnapshot({ worldId, now: this.now(), rootDimension });
      const eye = createEye({ dimension: this.snapshotState.spaces.root.dimension });
      this.eyes = { [eye.id]: eye }; this.currentEyeId = eye.id;
      this.branchId = uuid(); this.mode = 'local'; this.parentBranchId = null; this.branchLabel = null; this.forkedAt = null;
      this.appliedOperations = new Map();
      await this.persist();
    }
    if (!this.eyes[this.currentEyeId]) this.currentEyeId = Object.keys(this.eyes)[0];
    this.emit('opened'); return this.snapshot();
  }
  get world() { if (!this.snapshotState) throw new Error('Open the local world first'); return this.snapshotState; }
  get eye() { const eye = this.eyes[this.currentEyeId]; if (!eye) throw new Error('The active Eye is missing'); return eye; }
  snapshot() {
    return {
      snapshot: clone(this.world), eyes: clone(this.eyes), currentEyeId: this.currentEyeId,
      branchId: this.branchId, mode: this.mode, parentBranchId: this.parentBranchId,
      branchLabel: this.branchLabel, forkedAt: this.forkedAt, persistence: clone(this.persistence),
    };
  }
  async persist() {
    if (!this.snapshotState) return;
    const envelope = this.snapshot(), savedAt = this.now();
    envelope.snapshot.savedAt = savedAt; delete envelope.persistence;
    this.persistence = { state: 'saving', error: null };
    try {
      if (!this.storage?.save) {
        this.persistence = { state: 'memory-only', error: null };
        return { persistent: false };
      }
      const result = await this.storage?.save?.(this.world.worldId, envelope);
      this.snapshotState.savedAt = savedAt;
      this.persistence = { state: result?.persistent === false ? 'memory-only' : 'saved', error: null };
      return result;
    } catch (error) {
      this.persistence = { state: 'unsaved', error: error?.message || String(error) };
      this.emit('persistence-failed');
      throw error;
    }
  }
  queuePersist() {
    this.persistence = { state: 'saving', error: null };
    const operation = this._tail.then(() => this.persist());
    operation.catch(() => {});
    this._tail = operation.catch(() => {});
    this.lastPersistence = operation;
    return operation;
  }
  emit(reason) { this.onChange({ reason, state: this.snapshot() }); }
  createEye(label = 'New Eye') {
    if (Object.keys(this.eyes).length >= MAX_EYES) throw new RangeError(`The phone Eye limit is ${MAX_EYES}`);
    const space = this.world.spaces[this.eye.spaceId];
    const next = createEye({ label, spaceId: space.id, dimension: space.dimension });
    next.q = [...this.eye.q]; next.slice = clone(this.eye.slice); next.projection = clone(this.eye.projection);
    this.eyes[next.id] = next; this.currentEyeId = next.id; this.lastPersistence = this.queuePersist(); this.emit('eye-created'); return clone(next);
  }
  selectEye(id) {
    if (!this.eyes[id]) throw new TypeError('Unknown Eye');
    if (this.currentEyeId !== id) { this.activeIds.clear(); this.activeSpaceId = null; }
    this.currentEyeId = id; const write = this.queuePersist(); this.emit('eye-selected'); return write;
  }
  setEye(patch) {
    const eye = this.eye;
    if (patch.q) eye.q = finiteVector(patch.q, this.world.spaces[eye.spaceId].dimension, 'Eye q').slice();
    if (patch.slice) eye.slice = clone(patch.slice);
    if (patch.projection) eye.projection = { ...eye.projection, ...patch.projection };
    eye.revision++; const write = this.queuePersist(); this.emit('eye-updated'); return write;
  }
  translate(entityId, axis, delta) {
    const space = this.world.spaces[this.eye.spaceId], entity = space?.entities[entityId];
    if (!entity) throw new TypeError('Object is not in the active space');
    if (!Number.isInteger(axis) || axis < 0 || axis >= space.dimension || !Number.isFinite(delta) || Math.abs(delta) > 5) throw new RangeError('Invalid local material movement');
    if (this.activeSpaceId && this.activeSpaceId !== space.id) { this.activeIds.clear(); this.activeSpaceId = null; }
    entity.q[axis] = Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, entity.q[axis] + delta));
    entity.v[axis] = 0; entity.revision++; this.activeIds.add(entity.id);
    for (const edge of space.field.edges) if (edge.a === entity.id) this.activeIds.add(edge.b); else if (edge.b === entity.id) this.activeIds.add(edge.a);
    this.activeSpaceId = space.id;
    this.world.acceptedSequence++; const write = this.queuePersist(); this.emit('object-provisional'); return write;
  }
  applyLocalEdit(entityId, delta, expected = null) {
    return this._applyLocalEdit(entityId, delta, expected, false);
  }
  applyLocalTransform(entityId, delta, geometry, expected = null) {
    const request = expected && typeof expected === 'object' ? { ...expected, geometry } : { geometry };
    return this._applyLocalEdit(entityId, delta, request, true);
  }
  _applyLocalEdit(entityId, delta, expected = null, includeTransformResult = false) {
    const space = this.world.spaces[this.eye.spaceId], entity = space?.entities[entityId];
    if (!entity || !Array.isArray(delta) || delta.length !== space.dimension || delta.some(value => !Number.isFinite(value) || Math.abs(value) > 5)) {
      throw new TypeError('Invalid local field-world edit');
    }
    const request = expected && typeof expected === 'object' ? expected : null;
    const operationId = request?.operationId;
    if (operationId !== undefined && !validOperationId(operationId)) throw new TypeError('Invalid local operation identity');
    const requestedGeometry = request?.geometry === undefined || request?.geometry === null
      ? null
      : normalizeEntityGeometry(request.geometry, space.dimension);
    // Pair centroids can leave sub-picometer floating residue after a pure
    // scale/rotation gesture. Treat that residue as zero so geometry-only
    // acceptance does not accidentally wake the sparse material solver.
    const normalizedDelta = delta.map(value => Math.abs(Number(value)) < 1e-12 ? 0 : Number(value));
    const scope = { worldId: this.world.worldId, branchId: this.branchId, eyeId: this.currentEyeId, spaceId: space.id, entityId: entity.id };
    const baseRevision = request?.baseRevision === undefined ? entity.revision : request.baseRevision;
    const fingerprint = operationFingerprint({ ...scope, baseRevision, delta: normalizedDelta, geometry: requestedGeometry });
    const legacyFingerprint = JSON.stringify({ ...scope, baseRevision, delta: normalizedDelta });
    const prior = operationId ? this.appliedOperations.get(operationId) : null;
    if (prior) {
      const fingerprintMatches = prior.fingerprint === fingerprint || requestedGeometry === null && prior.fingerprint === legacyFingerprint;
      if (!fingerprintMatches || prior.scope !== operationScope(scope)) throw operationError('LOCAL_OPERATION_REPLAY_MISMATCH', 'The operation identity belongs to a different local preview.');
      return Promise.resolve({ ...clone(prior.result), replayed: true });
    }
    if (request) {
      const checks = [
        ['worldId', this.world.worldId], ['branchId', this.branchId], ['eyeId', this.currentEyeId],
        ['spaceId', space.id], ['entityId', entity.id], ['baseRevision', entity.revision],
      ];
      for (const [key, current] of checks) if (request[key] !== undefined && request[key] !== current) {
        throw operationError('STALE_LOCAL_PREVIEW', `Local ${key} changed before the preview could be applied.`);
      }
    }
    if (this.activeSpaceId && this.activeSpaceId !== space.id) { this.activeIds.clear(); this.activeSpaceId = null; }
    const nextQ = entity.q.map((value, axis) => Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, value + normalizedDelta[axis])));
    const geometryChanged = requestedGeometry && JSON.stringify(requestedGeometry) !== JSON.stringify(entity.geometry);
    const moved = nextQ.some((value, axis) => value !== entity.q[axis]);
    const changed = moved || Boolean(geometryChanged);
    if (!changed) {
      const unchanged = { changed: false, revision: entity.revision };
      if (includeTransformResult) { unchanged.identity = { ...scope, baseRevision, revision: entity.revision }; unchanged.geometry = clone(entity.geometry); }
      if (operationId) {
        const record = { operationId, scope: operationScope(scope), fingerprint, result: clone(unchanged), identity: { ...scope, baseRevision, revision: entity.revision }, geometry: clone(entity.geometry) };
        this.appliedOperations.set(operationId, record);
        this.world.localOperationResults = [...this.appliedOperations.values()].slice(-128).map(item => clone(item));
        return this.queuePersist().then(() => unchanged);
      }
      return Promise.resolve(unchanged);
    }
    entity.q = nextQ;
    entity.v = entity.v.map(() => 0);
    if (requestedGeometry) entity.geometry = requestedGeometry;
    entity.revision++;
    if (moved) {
      this.activeIds.add(entity.id);
      for (const edge of space.field.edges) {
        if (edge.a === entity.id) this.activeIds.add(edge.b);
        else if (edge.b === entity.id) this.activeIds.add(edge.a);
      }
      this.activeSpaceId = space.id;
    }
    this.world.acceptedSequence++;
    const result = { changed: true, revision: entity.revision };
    if (includeTransformResult) {
      result.identity = { ...scope, baseRevision, revision: entity.revision };
      result.geometry = clone(entity.geometry);
    }
    if (operationId) {
      const record = { operationId, scope: operationScope(scope), fingerprint, result, identity: { ...scope, baseRevision, revision: entity.revision }, geometry: clone(entity.geometry) };
      this.appliedOperations.set(operationId, record);
      this.world.localOperationResults = [...this.appliedOperations.values()].slice(-128).map(item => clone(item));
    }
    const write = this.queuePersist();
    this.emit(includeTransformResult ? 'object-transform-accepted' : 'object-provisional');
    return write.then(() => result);
  }
  async step(dt = FIXED_STEP) {
    const space = this.world.spaces[this.eye.spaceId];
    if (this.activeSpaceId && this.activeSpaceId !== space.id) { this.activeIds.clear(); this.activeSpaceId = null; }
    if (!this.activeIds.size) return false;
    const moving = stepSparseSpace(space, dt, this.activeIds);
    if (!moving) { this.activeIds.clear(); this.activeSpaceId = null; }
    this.world.simulationTime += dt; this.world.acceptedSequence++;
    this.emit('material-step'); await this.persist(); return moving;
  }
  enterNested(entityId) {
    const entity = this.world.spaces[this.eye.spaceId].entities[entityId];
    if (!entity?.innerSpaceId || !this.world.spaces[entity.innerSpaceId]) throw new TypeError('Object has no nested world');
    this.activeIds.clear(); this.activeSpaceId = null;
    const prior = { spaceId: this.eye.spaceId, q: [...this.eye.q], basis: clone(this.eye.basis), slice: clone(this.eye.slice) };
    this.eye.returnStack.push(prior);
    this.eye.spaceId = entity.innerSpaceId;
    this.eye.q = Array(this.world.spaces[entity.innerSpaceId].dimension).fill(0);
    this.eye.basis = identity(this.world.spaces[entity.innerSpaceId].dimension);
    this.eye.slice = Object.fromEntries(Array.from({ length: Math.max(0, this.eye.q.length - 3) }, (_, i) => [`x${i + 4}`, 0]));
    this.eye.revision++; this.lastPersistence = this.queuePersist(); this.emit('nested-enter');
  }
  exitNested() {
    const prior = this.eye.returnStack.pop(); if (!prior) { this.activeIds.clear(); this.activeSpaceId = null; return false; }
    this.activeIds.clear(); this.activeSpaceId = null;
    Object.assign(this.eye, prior); this.eye.revision++; this.lastPersistence = this.queuePersist(); this.emit('nested-exit'); return true;
  }
  forkOffline(label = 'Offline branch') {
    const parentBranchId = this.branchId;
    this.branchId = uuid(); this.mode = 'offline-branch'; this.parentBranchId = parentBranchId;
    this.branchLabel = String(label).slice(0, 256); this.forkedAt = this.now();
    this.appliedOperations = new Map(); this.world.localOperationResults = [];
    this.lastPersistence = this.queuePersist();
    const branch = this.snapshot();
    this.emit('offline-fork'); return clone(branch);
  }
  async close() { await this._tail; await this.persist(); this.activeIds.clear(); }
}

/** Renderer adapter: only the current Eye's space is projected. */
export function projectForRenderer(engine) {
  const envelope = typeof engine.snapshot === 'function' ? engine.snapshot() : engine;
  const snapshot = envelope.snapshot || envelope;
  const eye = envelope.eyes ? envelope.eyes[envelope.currentEyeId] : engine.eye;
  const space = snapshot.spaces[eye.spaceId];
  const shape = [7, 7], coords = [], positions = [], faces = [], edges = [];
  const scale = 0.42;
  for (let y = 0; y < shape[1]; y++) for (let x = 0; x < shape[0]; x++) {
    const q = Array(space.dimension).fill(0); q[0] = (x - 3) * scale; q[1] = (y - 3) * scale; q[2] = 0;
    coords.push(q); positions.push([q[0], q[2], q[1]]);
    const i = y * shape[0] + x;
    if (x < shape[0] - 1) edges.push([i, i + 1]);
    if (y < shape[1] - 1) edges.push([i, i + shape[0]]);
    if (x < shape[0] - 1 && y < shape[1] - 1) { faces.push([i, i + 1, i + shape[0] + 1], [i, i + shape[0] + 1, i + shape[0]]); }
  }
  return {
    state: {
      schema: 'viva.phone.render/1', worldId: snapshot.worldId, geometry: { kind: 'flat', dimension: space.dimension },
      entities: clone(space.entities), participants: [{ id: eye.id, name: eye.label, observer: clone(eye) }],
      guide: { activity: coords.map(() => 0), blocked: [], potential: coords.map(() => null), goal: -1 },
      simulationTime: snapshot.simulationTime, acceptedSequence: snapshot.acceptedSequence,
    },
    grid: { shape, coords, positions, faces, edges },
    eye: clone(eye),
  };
}

export async function detectPhoneCapabilities(scope = globalThis) {
  let gpu = false;
  try { gpu = !!(await scope.navigator?.gpu?.requestAdapter?.()); } catch { gpu = false; }
  let storagePersisted = false;
  try { storagePersisted = !!(await scope.navigator?.storage?.persisted?.()); } catch { storagePersisted = false; }
  return {
    worker: typeof scope.Worker === 'function', webgpu: gpu,
    webgl2: !!scope.document?.createElement?.('canvas')?.getContext?.('webgl2'),
    wasm: typeof scope.WebAssembly === 'object', indexedDb: typeof scope.indexedDB !== 'undefined',
    storagePersisted, presentation: !!scope.navigator?.presentation,
    camera: !!scope.navigator?.mediaDevices?.getUserMedia,
    deviceMemoryGiB: Number(scope.navigator?.deviceMemory) || null,
    online: scope.navigator?.onLine !== false,
  };
}
