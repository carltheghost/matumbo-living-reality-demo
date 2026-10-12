/**
 * Phone-local agent control.
 *
 * A registered session is the only source of agent authority.  The caller
 * receives an opaque session id and generation; world edits never trust an
 * agentId supplied inside an edit payload.  Stop fences the session queue and
 * releases only the exact `agent:<sourceId>` fabric owner.  This is an
 * in-app/local control boundary, not Android permission management.
 */
import { LocalEditQueue } from './local-edit-queue.mjs';
import { normalizeEntityGeometry } from './engine.mjs';

export const AGENT_CONTROL_SCHEMA = 'vivo.phone.agent-control/1';
export const AGENT_CAPABILITIES = Object.freeze(['world.read', 'world.edit', 'world.eye']);
export const MAX_REGISTERED_AGENTS = 16;
export const MAX_AGENT_OPERATIONS = 128;
export const MAX_AGENT_SOURCE_ID_LENGTH = 154;

const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const newId = prefix => globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const boundedId = (value, label, maxLength = 256) => {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) throw controlError('AGENT_INVALID_IDENTITY', `${label} must be a bounded identity.`);
  return value;
};
const controlError = (code, message) => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
};
const operationId = value => boundedId(value, 'operationId');
// SpatialInteractionFabric prefixes agent sources with `agent:` and caps the
// complete source key at 160 characters. Keep the registered source bounded
// before any state is created so contact release cannot fail later.
const sourceId = value => boundedId(value, 'sourceId', MAX_AGENT_SOURCE_ID_LENGTH);
const finiteNumber = (value, label) => {
  if (!Number.isFinite(Number(value))) throw controlError('AGENT_INVALID_EDIT', `${label} must be finite.`);
  return Number(value);
};
const editFingerprint = value => JSON.stringify({
  worldId: value.worldId,
  branchId: value.branchId,
  eyeId: value.eyeId,
  spaceId: value.spaceId,
  entityId: value.entityId,
  baseRevision: value.baseRevision,
  delta: value.delta,
  geometry: value.geometry ?? null,
});

function snapshotOf(envelope) {
  if (!envelope?.snapshot || typeof envelope.snapshot !== 'object') throw controlError('AGENT_LOCAL_UNAVAILABLE', 'The local phone snapshot is unavailable.');
  return envelope;
}

function scopeFor(envelope) {
  const eye = envelope.eyes?.[envelope.currentEyeId];
  const spaceId = eye?.spaceId;
  const entity = envelope.snapshot?.spaces?.[spaceId]?.entities;
  return { eye, spaceId, entity };
}

function priorOperation(envelope, id) {
  return (envelope.snapshot?.localOperationResults || []).find(item => item?.operationId === id) || null;
}

/**
 * Validate the full local acceptance envelope before an agent edit is queued.
 * The optional `allowIdempotentReplay` path still requires the current world,
 * branch, Eye, space and entity scope to match; only the entity CAS revision
 * may differ when the operation record already exists.  An omitted geometry
 * is represented by `null` in the canonical request.  It must not be filled
 * from the entity's mutable geometry because that would make a replay's
 * fingerprint change after an unrelated geometry-only acceptance.
 */
export function validateAgentEditPayload(payload, envelope, { allowIdempotentReplay = true } = {}) {
  snapshotOf(envelope);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw controlError('AGENT_INVALID_EDIT', 'A local agent edit payload is required.');
  if ('agentId' in payload || 'sourceId' in payload || 'sessionId' in payload || 'generation' in payload) {
    throw controlError('AGENT_IDENTITY_NOT_IN_PAYLOAD', 'Agent identity comes from the registered session, not the edit payload.');
  }
  const required = ['worldId', 'branchId', 'eyeId', 'spaceId', 'entityId', 'baseRevision', 'operationId', 'delta'];
  for (const key of required) if (payload[key] === undefined || payload[key] === null) throw controlError('AGENT_INCOMPLETE_EDIT', `Local edit field ${key} is required.`);
  const expected = {
    worldId: boundedId(payload.worldId, 'worldId'),
    branchId: boundedId(payload.branchId, 'branchId'),
    eyeId: boundedId(payload.eyeId, 'eyeId'),
    spaceId: boundedId(payload.spaceId, 'spaceId'),
    entityId: boundedId(payload.entityId, 'entityId'),
    baseRevision: Number(payload.baseRevision),
    operationId: operationId(payload.operationId),
  };
  if (!Number.isInteger(expected.baseRevision) || expected.baseRevision < 0) throw controlError('AGENT_INVALID_EDIT', 'baseRevision must be a non-negative integer.');
  const currentScope = scopeFor(envelope);
  const entity = currentScope.entity?.[expected.entityId];
  const current = {
    worldId: envelope.snapshot.worldId,
    branchId: envelope.branchId || null,
    eyeId: envelope.currentEyeId,
    spaceId: currentScope.spaceId,
  };
  for (const key of ['worldId', 'branchId', 'eyeId', 'spaceId']) if (expected[key] !== current[key]) throw controlError('AGENT_SCOPE_CHANGED', `Local ${key} no longer matches the registered edit scope.`);
  if (!currentScope.eye || !entity || entity.spaceId !== expected.spaceId) throw controlError('AGENT_ENTITY_UNAVAILABLE', 'The local edit entity is not in the active Eye space.');
  const dimension = Number(envelope.snapshot.spaces[expected.spaceId]?.dimension);
  if (!Number.isInteger(dimension) || dimension < 3 || dimension > 11) throw controlError('AGENT_INVALID_EDIT', 'The local edit space dimension is unsupported.');
  if (!Array.isArray(payload.delta) || payload.delta.length !== dimension) throw controlError('AGENT_INVALID_EDIT', `delta must contain the full ${dimension}D vector.`);
  const delta = payload.delta.map((value, axis) => {
    const result = finiteNumber(value, `delta[${axis}]`);
    if (Math.abs(result) > 5) throw controlError('AGENT_INVALID_EDIT', 'Each local edit delta is bounded to five units.');
    return Math.abs(result) < 1e-12 ? 0 : result;
  });
  const prior = priorOperation(envelope, expected.operationId);
  if (expected.baseRevision !== Number(entity.revision) && !(allowIdempotentReplay && prior)) throw controlError('AGENT_CAS_STALE', 'The local entity revision changed before this edit was accepted.');
  const geometry = payload.geometry === undefined || payload.geometry === null
    ? null
    : normalizeEntityGeometry(payload.geometry, dimension);
  return {
    ...expected,
    delta,
    geometry,
    dimension,
    prior: prior ? clone(prior) : null,
  };
}

function normalizeCapabilities(value) {
  const requested = Array.isArray(value) ? value : AGENT_CAPABILITIES;
  return new Set(requested.filter(item => AGENT_CAPABILITIES.includes(item)));
}

export class LocalAgentController {
  constructor({
    fabric = null,
    snapshot = null,
    applyTransform = null,
    setEye = null,
    now = () => Date.now(),
    maxAgents = MAX_REGISTERED_AGENTS,
    maxOperations = MAX_AGENT_OPERATIONS,
    onChange = () => {},
  } = {}) {
    this.fabric = fabric;
    this.readSnapshot = snapshot;
    this.applyTransform = applyTransform;
    this.setEye = setEye;
    this.now = now;
    this.maxAgents = maxAgents;
    this.maxOperations = maxOperations;
    this.onChange = onChange;
    this.grantedCapabilities = new Set();
    this.records = new Map();
    this.sessions = new Map();
  }

  setFabric(fabric) { this.fabric = fabric || null; }

  setGrantedCapabilities(names) {
    const next = new Set(Array.isArray(names) ? names.filter(name => AGENT_CAPABILITIES.includes(name)) : []);
    const removed = [...this.grantedCapabilities].filter(name => !next.has(name));
    this.grantedCapabilities = next;
    const stopping = [];
    for (const record of this.records.values()) {
      if (record.status !== 'active' || !removed.some(name => record.capabilities.has(name))) continue;
      stopping.push(this.stop(record.sessionId, 'grant-revoked'));
    }
    this._emit('grants-updated', { removed });
    return Promise.all(stopping);
  }

  register({ sourceId: rawSourceId, label = null, capabilities = null } = {}) {
    const owner = sourceId(rawSourceId);
    const existing = this.records.get(owner);
    if (existing?.status === 'active') return this._public(existing);
    if (!existing && this.records.size >= this.maxAgents) throw controlError('AGENT_CAPACITY', `At most ${this.maxAgents} local agents may be registered.`);
    if (existing) {
      existing.capabilities = normalizeCapabilities(capabilities || [...existing.capabilities]);
      return this._activate(existing);
    }
    const record = {
      sourceId: owner,
      label: typeof label === 'string' && label.length ? label.slice(0, 160) : owner,
      capabilities: normalizeCapabilities(capabilities),
      generation: 1,
      sessionId: newId('agent-session'),
      status: 'active',
      stopReason: null,
      stoppedAt: null,
      queue: new LocalEditQueue(),
      operations: new Map(),
      contacts: new Map(),
      createdAt: this.now(),
    };
    this.records.set(owner, record);
    this.sessions.set(record.sessionId, { record, generation: record.generation });
    this._emit('agent-registered', { sourceId: owner });
    return this._public(record);
  }

  _activate(record) {
    record.generation += 1;
    record.sessionId = newId('agent-session');
    record.status = 'active'; record.stopReason = null; record.stoppedAt = null;
    // Keep operation fingerprints across generations. The queue and contacts
    // are generation-scoped; an operation identity is not.
    record.queue = new LocalEditQueue(); record.contacts = new Map();
    this.sessions.set(record.sessionId, { record, generation: record.generation });
    this._emit('agent-reenabled', { sourceId: record.sourceId });
    return this._public(record);
  }

  _public(record) {
    return {
      schema: AGENT_CONTROL_SCHEMA,
      sourceId: record.sourceId,
      label: record.label,
      status: record.status,
      generation: record.generation,
      sessionId: record.sessionId,
      capabilities: [...record.capabilities],
      activeOperations: [...record.operations.values()].filter(item => !['accepted', 'rejected', 'cancelled-before-submission', 'submitted-requires-reconciliation'].includes(item.state)).length,
      activeContacts: record.contacts.size,
      stopReason: record.stopReason,
      stoppedAt: record.stoppedAt,
    };
  }

  agents() { return [...this.records.values()].map(record => this._public(record)); }

  assertActive(ref) { return this._public(this._recordFor(ref)); }

  sessionCapabilities(ref) { return [...this._recordFor(ref).capabilities]; }

  sessionSource(ref) { return this._recordFor(ref, { allowStopped: true }).sourceId; }

  _recordFor(ref, { allowStopped = false } = {}) {
    if (typeof ref === 'string') {
      const session = this.sessions.get(ref);
      if (!session) throw controlError('AGENT_SESSION_UNKNOWN', 'The registered agent session is unknown.');
      const record = session.record;
      if (record.sessionId !== ref || record.generation !== session.generation) throw controlError('AGENT_GENERATION_STALE', 'The registered agent session generation is stale.');
      if (!allowStopped && record.status !== 'active') throw controlError('AGENT_STOPPED', 'This local agent is stopped. Explicitly re-enable it to create a fresh generation.');
      return record;
    }
    if (!ref || typeof ref !== 'object' || !ref.sessionId) throw controlError('AGENT_SESSION_REQUIRED', 'A registered local agent session is required.');
    const suppliedGeneration = ref.generation === undefined ? null : Number(ref.generation);
    const record = this._recordFor(ref.sessionId, { allowStopped });
    if (suppliedGeneration !== null && suppliedGeneration !== record.generation) throw controlError('AGENT_GENERATION_STALE', 'The registered agent session generation is stale.');
    return record;
  }

  _assertCapability(record, capability) {
    if (!record.capabilities.has(capability)) throw controlError('AGENT_CAPABILITY_NOT_REGISTERED', `The session did not register ${capability}.`);
    if (!this.grantedCapabilities.has(capability)) throw controlError('AGENT_CAPABILITY_REVOKED', `The local ${capability} grant is currently revoked.`);
  }

  async _snapshot() {
    if (typeof this.readSnapshot !== 'function') throw controlError('AGENT_LOCAL_UNAVAILABLE', 'The local Vivo engine is not open.');
    return snapshotOf(await this.readSnapshot());
  }

  async invokeTool(ref, name, args = {}) {
    const record = this._recordFor(ref);
    if (name === 'vivo.world.read') {
      this._assertCapability(record, 'world.read');
      const submittedSessionId = record.sessionId;
      const submittedGeneration = record.generation;
      const result = await this._snapshot();
      if (record.sessionId !== submittedSessionId || record.generation !== submittedGeneration) throw controlError('AGENT_GENERATION_STALE', 'The registered agent session changed before this world read completed.');
      if (record.status !== 'active') throw controlError('AGENT_STOPPED', 'This local agent was stopped before the world read completed.');
      return result;
    }
    if (name === 'vivo.world.edit') {
      this._assertCapability(record, 'world.edit');
      return this.submitTransform(ref, args);
    }
    if (name === 'vivo.eye.control') {
      this._assertCapability(record, 'world.eye');
      if ('agentId' in (args || {})) throw controlError('AGENT_IDENTITY_NOT_IN_PAYLOAD', 'Agent identity comes from the registered session.');
      if (typeof this.setEye !== 'function') throw controlError('AGENT_LOCAL_UNAVAILABLE', 'The local Eye controller is unavailable.');
      const submittedSessionId = record.sessionId;
      const submittedGeneration = record.generation;
      const current = await this._snapshot();
      if (record.sessionId !== submittedSessionId || record.generation !== submittedGeneration) throw controlError('AGENT_GENERATION_STALE', 'The registered agent session changed before this Eye edit was accepted.');
      if (record.status !== 'active') throw controlError('AGENT_STOPPED', 'This local agent is stopped. Explicitly re-enable it to create a fresh generation.');
      if (args?.eyeId !== undefined && args.eyeId !== current.currentEyeId) throw controlError('AGENT_EYE_SCOPE_CHANGED', 'The requested Eye is no longer active.');
      const patch = args?.patch && typeof args.patch === 'object' ? args.patch : args;
      return this.setEye(clone(patch));
    }
    throw controlError('AGENT_TOOL_UNSUPPORTED', `Unsupported local agent tool ${String(name)}.`);
  }

  async submitTransform(ref, payload) {
    const record = this._recordFor(ref);
    this._assertCapability(record, 'world.edit');
    const submittedSessionId = record.sessionId;
    const submittedGeneration = record.generation;
    const submittedQueue = record.queue;
    const current = await this._snapshot();
    if (record.sessionId !== submittedSessionId || record.generation !== submittedGeneration) throw controlError('AGENT_GENERATION_STALE', 'The registered agent session changed before this edit was queued.');
    if (record.status !== 'active') return { status: 'cancelled-before-submission', submitted: false, code: 'AGENT_STOPPED' };
    const validated = validateAgentEditPayload(payload, current);
    const requestFingerprint = editFingerprint(validated);
    const existing = record.operations.get(validated.operationId);
    if (existing) {
      const originalFingerprint = existing.requestFingerprint || editFingerprint(existing.validated);
      if (originalFingerprint !== requestFingerprint) throw controlError('AGENT_OPERATION_REPLAY_MISMATCH', 'The operation identity was already used for a different local edit.');
      return existing.completion;
    }
    if (validated.prior?.fingerprint && validated.prior.fingerprint !== requestFingerprint) throw controlError('AGENT_OPERATION_REPLAY_MISMATCH', 'The operation identity was already used for a different local edit.');
    const foreign = [...this.records.values()].flatMap(item => [...item.operations.values()]).find(item => item.operationId === validated.operationId && item.record !== record);
    if (foreign) throw controlError('AGENT_OPERATION_OWNER_MISMATCH', 'The operation identity is already bound to another registered agent.');
    if (record.operations.size >= this.maxOperations) {
      const oldest = record.operations.keys().next().value;
      record.operations.delete(oldest);
    }
    const op = {
      operationId: validated.operationId,
      record,
      generation: record.generation,
      payload: clone(payload),
      validated,
      requestFingerprint,
      state: 'queued',
      submitted: false,
      completion: null,
      createdAt: this.now(),
    };
    record.operations.set(op.operationId, op);
    const queued = submittedQueue.enqueue({
      submit: async () => {
        if (record.status !== 'active' || record.generation !== op.generation || record.sessionId !== submittedSessionId) return { status: 'cancelled-before-submission', submitted: false, code: 'AGENT_STOPPED' };
        const latest = await this._snapshot();
        if (record.status !== 'active' || record.generation !== op.generation || record.sessionId !== submittedSessionId) return { status: 'cancelled-before-submission', submitted: false, code: 'AGENT_STOPPED' };
        const latestValidated = validateAgentEditPayload(payload, latest);
        if (record.status !== 'active' || record.generation !== op.generation || record.sessionId !== submittedSessionId) return { status: 'cancelled-before-submission', submitted: false, code: 'AGENT_STOPPED' };
        if (typeof this.applyTransform !== 'function') throw controlError('AGENT_LOCAL_UNAVAILABLE', 'The local transform acceptance path is unavailable.');
        op.submitted = true;
        op.state = 'submitted';
        const result = await this.applyTransform(latestValidated.entityId, latestValidated.delta, latestValidated.geometry, {
          worldId: latestValidated.worldId,
          branchId: latestValidated.branchId,
          eyeId: latestValidated.eyeId,
          spaceId: latestValidated.spaceId,
          entityId: latestValidated.entityId,
          baseRevision: latestValidated.baseRevision,
          operationId: latestValidated.operationId,
          geometry: latestValidated.geometry,
        });
        return { status: 'submitted', submitted: true, result };
      },
    });
    op.completion = queued.then(async value => {
      if (!value.submitted || value.result?.submitted === false) {
        op.state = 'cancelled-before-submission';
        this._emit('agent-operation-settled', { sourceId: record.sourceId, operationId: op.operationId, status: op.state });
        return { status: 'cancelled-before-submission', submitted: false, operationId: op.operationId, code: value.result?.code || 'AGENT_STOPPED' };
      }
      const result = value.result?.result ?? value.result;
      if (value.status === 'submitted-fenced' || record.status !== 'active' || record.generation !== op.generation) {
        op.state = 'submitted-requires-reconciliation';
        this._emit('agent-operation-settled', { sourceId: record.sourceId, operationId: op.operationId, status: op.state });
        const reconciliation = await this.reconcile(op);
        return { status: 'submitted-requires-reconciliation', submitted: true, operationId: op.operationId, result: clone(result), reconciliation };
      }
      op.state = 'accepted';
      this._emit('agent-operation-settled', { sourceId: record.sourceId, operationId: op.operationId, status: op.state });
      return { status: 'accepted', submitted: true, operationId: op.operationId, result: clone(result), replayed: Boolean(result?.replayed) };
    }).catch(error => {
      op.state = 'rejected';
      this._emit('agent-operation-settled', { sourceId: record.sourceId, operationId: op.operationId, status: op.state, code: error?.code || null });
      throw error;
    });
    this._emit('agent-operation-queued', { sourceId: record.sourceId, operationId: op.operationId });
    return op.completion;
  }

  async reconcile(op) {
    const envelope = await this._snapshot();
    const receipt = priorOperation(envelope, op.operationId);
    const scope = scopeFor(envelope);
    return {
      operationId: op.operationId,
      state: receipt ? 'accepted' : 'unknown',
      worldId: envelope.snapshot.worldId,
      branchId: envelope.branchId || null,
      eyeId: envelope.currentEyeId,
      spaceId: scope.spaceId,
      entityId: op.validated.entityId,
      revision: scope.entity?.[op.validated.entityId]?.revision ?? null,
      receipt: receipt ? clone(receipt) : null,
    };
  }

  beginContact(ref, { contactId, objectId, canonicalPoint, gesture = 'grab', metadata = null } = {}) {
    const record = this._recordFor(ref);
    this._assertCapability(record, 'world.edit');
    const publicContactId = boundedId(contactId, 'contactId');
    const object = boundedId(objectId, 'objectId');
    if (!Array.isArray(canonicalPoint) || canonicalPoint.length < 3 || canonicalPoint.length > 11 || canonicalPoint.some(value => !Number.isFinite(Number(value)))) throw controlError('AGENT_INVALID_CONTACT', 'canonicalPoint must be a finite 3D..11D point.');
    if (record.contacts.has(publicContactId)) this.endContact(ref, publicContactId, 'replaced');
    const fabricContactId = `agent-contact:${record.sessionId}:${publicContactId}`;
    const constraint = this.fabric?.begin({
      contactId: fabricContactId,
      source: { kind: 'agent', id: record.sourceId },
      objectId: object,
      gesture,
      canonicalPoint: canonicalPoint.map(Number),
      metadata,
    });
    record.contacts.set(publicContactId, { publicContactId, fabricContactId, objectId: object });
    this._emit('agent-contact-began', { sourceId: record.sourceId, objectId: object });
    return { ...clone(constraint || {}), contactId: publicContactId, sourceId: record.sourceId, sessionId: record.sessionId, generation: record.generation };
  }

  updateContact(ref, contactId, values = {}) {
    const record = this._recordFor(ref);
    const contact = record.contacts.get(boundedId(contactId, 'contactId'));
    if (!contact) throw controlError('AGENT_CONTACT_UNKNOWN', 'The local agent contact is unknown.');
    return this.fabric?.update(contact.fabricContactId, values) || null;
  }

  endContact(ref, contactId, reason = 'agent-release') {
    const record = this._recordFor(ref, { allowStopped: true });
    const id = boundedId(contactId, 'contactId');
    const contact = record.contacts.get(id);
    if (!contact) return null;
    record.contacts.delete(id);
    const result = this.fabric?.end(contact.fabricContactId, reason);
    this._emit('agent-contact-ended', { sourceId: record.sourceId, objectId: contact.objectId });
    return result;
  }

  async stop(ref, reason = 'agent-stop') {
    const record = this._recordFor(ref, { allowStopped: true });
    if (record.status === 'stopped') return { ...this._public(record), alreadyStopped: true, released: [] };
    record.status = 'stopped'; record.stopReason = String(reason || 'agent-stop'); record.stoppedAt = this.now();
    record.queue.stop();
    const released = this._releaseContacts(record, 'agent-stop');
    this._emit('agent-stopped', { sourceId: record.sourceId, released: released.length });
    const operations = [...record.operations.values()].filter(item => item.completion).map(item => item.completion);
    const settled = await Promise.allSettled(operations);
    return { ...this._public(record), released, operations: settled.map(item => item.status === 'fulfilled' ? item.value : { status: 'rejected', error: String(item.reason?.message || item.reason) }) };
  }

  async stopSource(rawSourceId, reason = 'agent-stop') {
    const record = this.records.get(sourceId(rawSourceId));
    if (!record) throw controlError('AGENT_SOURCE_UNKNOWN', 'The registered agent source is unknown.');
    return this.stop(record.sessionId, reason);
  }

  async reenable(ref) {
    const owner = typeof ref === 'string' && this.records.has(ref) ? ref : this._recordFor(ref, { allowStopped: true }).sourceId;
    const record = this.records.get(owner);
    if (!record) throw controlError('AGENT_SOURCE_UNKNOWN', 'The registered agent source is unknown.');
    if (record.status === 'active') return this._public(record);
    // This is an exact source fence, not a global emergency stop. It also
    // protects against a late callback from the prior generation restoring a
    // stale constraint before the new session is explicitly enabled.
    this._releaseContacts(record, 'agent-reenable-fence');
    return this._activate(record);
  }

  _releaseContacts(record, reason) {
    const contacts = [...record.contacts.values()];
    let released = [];
    try {
      released = this.fabric?.releaseSource({ kind: 'agent', id: record.sourceId }, reason) || [];
    } catch {
      // A legacy or externally restored record must not leave the controller
      // half-stopped. Release each known contact by its bounded contact ID if
      // the aggregate source key cannot be reconstructed safely.
      released = [];
      for (const contact of contacts) {
        try {
          const result = this.fabric?.end(contact.fabricContactId, reason);
          if (result) released.push(result);
        } catch {}
      }
    }
    record.contacts.clear();
    return released;
  }

  async stopAll(reason = 'grant-revoked') {
    return Promise.all([...this.records.values()].filter(record => record.status === 'active').map(record => this.stop(record.sessionId, reason)));
  }

  async waitForIdle() {
    const tasks = [...this.records.values()].flatMap(record => [...record.operations.values()].map(operation => operation.completion).filter(Boolean));
    return Promise.allSettled(tasks);
  }

  _emit(reason, detail = {}) {
    try { this.onChange({ schema: AGENT_CONTROL_SCHEMA, reason, at: this.now(), agents: this.agents(), ...detail }); } catch {}
  }
}
