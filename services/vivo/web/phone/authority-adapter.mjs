/**
 * Explicit phone -> canonical authority adapter.
 *
 * The phone engine remains a local authority.  This adapter only reads a
 * detached local envelope, previews a detached mapping, or submits the two
 * existing Studio commands after an explicit user action.  It never applies
 * accepted canonical state back into the phone engine and never sends while an
 * explicit offline branch is active.
 */

import { mapPhoneEnvelopeToCanonical } from './authority-mapping.mjs';

const loadLocalTransport = () => import('../application/transport.mjs').then(module => module.LocalTransport);
const loadStudioCommands = async () => {
  try {
    return await import('../../contracts/studio-binding.mjs');
  } catch (firstError) {
    if (typeof window === 'undefined') throw firstError;
    return import('/services/vivo/contracts/studio-binding.mjs');
  }
};

const copy = value => value === undefined ? undefined : structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sameQ = (left, right) => Array.isArray(left) && Array.isArray(right) && same(left, right);
const randomId = prefix => `${prefix}.${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`}`;

const REJECTION_REASONS = Object.freeze({
  AUTHORITY_NOT_CONNECTED: 'Connect to the canonical authority explicitly before sending a command.',
  AUTHORITY_UNAVAILABLE: 'The canonical authority is unavailable. The phone world remains local and unchanged.',
  PHONE_OFFLINE_BRANCH_NO_SEND: 'This explicit offline branch is local-only; no authority command was sent.',
  STUDIO_PERMISSION_DENIED: 'The current authority session is read-only and cannot publish or commit canonical state.',
  STUDIO_PROJECTION_UNAVAILABLE: 'The authority did not advertise the projection command; this action is fail-closed.',
  STUDIO_COMMIT_UNAVAILABLE: 'The authority did not advertise canonical commit; this action is fail-closed.',
  STUDIO_MATERIAL_BOUNDARY: 'Material-owned bindings remain driver-authoritative; canonical commit is unavailable.',
  JOURNAL_BACKPRESSURE: 'Accepted history is read-only at its cleanup reserve; authority writes are unavailable.',
  STUDIO_CONFLICT: 'Accepted canonical state changed while this phone had a local edit. Review it and repeat the same explicit action to replace it, or keep the local edit.',
  STALE_WORLD: 'The authority advanced before this command was accepted. Accepted state was refreshed; repeat the explicit action only after reviewing it.',
  STALE_STUDIO_BINDING: 'The selected binding revision is stale. Accepted state was refreshed; review before retrying.',
  STALE_ENTITY: 'The selected canonical entity revision is stale. Accepted state was refreshed; review before retrying.',
  STUDIO_ENTITY_HELD: 'The canonical entity is currently held by another authority session; no change was accepted.',
  STUDIO_BINDING_UNAVAILABLE: 'The selected phone object is not present in the canonical binding registry.',
  STUDIO_BINDING_IDENTITY: 'The canonical binding identity did not match the reviewed phone mapping.',
});

const reasonFor = (code, fallback) => REJECTION_REASONS[code] || fallback || `Authority rejected this action with ${code}.`;
const statusOf = transport => Boolean(transport && !transport.closed);

function currentState(transport) {
  return transport?.current ? copy(transport.current) : null;
}

function currentBinding(state, bindingId) {
  return state?.snapshot?.studioBindings?.[bindingId] || null;
}

function writePermission(transport) {
  if (!transport || transport.closed) return {allowed: false, code: 'AUTHORITY_NOT_CONNECTED'};
  if (transport.session?.readOnly || (Array.isArray(transport.session?.capabilities) && !transport.session.capabilities.includes('grab'))) {
    return {allowed: false, code: 'STUDIO_PERMISSION_DENIED'};
  }
  return {allowed: true};
}

export class PhoneAuthorityAdapter {
  constructor({
    engine = null,
    snapshot = null,
    transport = null,
    transportFactory = null,
    base = '',
    fetch: fetcher = globalThis.fetch,
    seat = 'one',
    onState = () => {},
  } = {}) {
    if (!engine && typeof snapshot !== 'function') throw new TypeError('Phone authority adapter needs a local snapshot provider');
    this.engine = engine;
    this.snapshotProvider = snapshot || (() => this.engine.snapshot());
    this.transportFactory = transportFactory;
    this.transport = transport;
    this.transportOptions = {base, fetch: fetcher};
    this.seat = seat === 'two' ? 'two' : 'one';
    this.onState = onState;
    this.state = currentState(transport);
    this.localEnvelope = null;
    this.selectedEntityId = 'relic';
    this.acceptedBinding = null;
    this.conflict = null;
    this.conflictOverrideArmed = false;
    this.lastResult = null;
    this.message = 'Canonical authority is disconnected. The phone world remains local.';
    if (transport) this._wireTransport(transport);
  }

  _wireTransport(transport) {
    if (!transport) return;
    const prior = transport.onState;
    transport.onState = state => {
      try { prior?.(state); } catch {}
      this.receive(state);
    };
  }

  _emit(reason = 'state') {
    const detail = {reason, state: this.debug()};
    try { this.onState(detail); } catch {}
    return detail.state;
  }

  async syncLocal(envelope = null) {
    this.localEnvelope = copy(envelope || await this.snapshotProvider());
    const local = mapPhoneEnvelopeToCanonical(this.localEnvelope, this.selectedEntityId);
    if (this.conflict && local.status === 'available' && !sameQ(local.q, this.conflict.localQ)) {
      this.conflict = {...this.conflict, localQ: [...local.q]};
      this.conflictOverrideArmed = false;
    }
    this._emit('local');
    return this.debug();
  }

  async selectEntity(entityId) {
    if (typeof entityId !== 'string' || !entityId.length) throw new TypeError('PHONE_OBJECT_UNAVAILABLE');
    this.selectedEntityId = entityId;
    this.conflict = null;
    this.conflictOverrideArmed = false;
    const mapping = this._mapping();
    this.acceptedBinding = mapping.binding ? currentBinding(this.state, mapping.binding.bindingId) : null;
    await this.syncLocal();
    return this.debug();
  }

  receive(state) {
    if (!state?.snapshot) return this.debug();
    const next = copy(state);
    const binding = currentBinding(next, this._bindingId());
    const prior = this.acceptedBinding;
    const local = this.localEnvelope ? mapPhoneEnvelopeToCanonical(this.localEnvelope, this.selectedEntityId) : null;
    if (prior && binding && !sameQ(prior.q, binding.q)) {
      if (local?.status === 'available' && !sameQ(local.q, prior.q) && !sameQ(local.q, binding.q)) {
        this._rememberConflict(binding, local.q, 'STUDIO_CONFLICT');
      } else if (this.conflict && sameQ(local?.q, binding.q)) {
        this.conflict = null;
        this.conflictOverrideArmed = false;
      }
    }
    this.state = next;
    if (binding) this.acceptedBinding = copy(binding);
    this._emit('authority');
    return this.debug();
  }

  _bindingId() {
    return mapPhoneEnvelopeToCanonical(this.localEnvelope || {}, this.selectedEntityId).binding?.bindingId ||
      ({relic: 'studio.node.echo', workpiece: 'studio.node.workpiece', portal: 'studio.node.portal'}[this.selectedEntityId] || 'studio.node.echo');
  }

  _rememberConflict(binding, localQ, code = 'STUDIO_CONFLICT') {
    this.conflict = {code, localQ: localQ ? [...localQ] : null, acceptedBinding: copy(binding), acceptedSequence: this.state?.snapshot?.acceptedSequence ?? null};
    this.conflictOverrideArmed = false;
    return this.conflict;
  }

  _mapping(local = null) {
    return local || mapPhoneEnvelopeToCanonical(this.localEnvelope || {}, this.selectedEntityId);
  }

  async connect({seat = this.seat, resumeToken} = {}) {
    if (statusOf(this.transport)) return this.debug();
    this.seat = seat === 'two' ? 'two' : 'one';
    const options = {...this.transportOptions, onState: state => this.receive(state)};
    const client = this.transportFactory
      ? await this.transportFactory(options)
      : new (await loadLocalTransport())(options);
    this.transport = client;
    try {
      const result = await client.admit(this.seat, resumeToken);
      this.receive(result.state || currentState(client));
      this.message = `Connected to canonical seat ${this.seat}. Local phone state was not replaced.`;
      await this.syncLocal();
      return this._emit('connected');
    } catch (error) {
      this.transport = null;
      this.message = reasonFor(error?.code || 'AUTHORITY_UNAVAILABLE', error?.message);
      this.lastResult = this._rejection('connect', error?.code || 'AUTHORITY_UNAVAILABLE', this.message, false);
      this._emit('connect-failed');
      throw error;
    }
  }

  async read() {
    if (!statusOf(this.transport)) return this._rejection('read', 'AUTHORITY_NOT_CONNECTED', reasonFor('AUTHORITY_NOT_CONNECTED'), false);
    try {
      // Capture a local edit before the remote refresh so a concurrent
      // accepted change cannot be mistaken for an unchanged phone object.
      await this.syncLocal();
      await this.transport.refresh();
      await this.syncLocal();
      this.message = 'Accepted canonical state refreshed. The local phone object and Eye were not changed.';
      return this._emit('read');
    } catch (error) {
      const code = error?.code || 'AUTHORITY_UNAVAILABLE';
      this.message = reasonFor(code, error?.message);
      return this._rejection('read', code, this.message, false);
    }
  }

  async preview({entityId = this.selectedEntityId} = {}) {
    this.selectedEntityId = entityId;
    const local = await this.syncLocal();
    const mapping = this._mapping();
    const accepted = mapping.binding ? currentBinding(this.state, mapping.binding.bindingId) : null;
    const result = {
      status: mapping.status === 'available' ? 'preview' : 'unavailable',
      code: mapping.status === 'available' ? 'PHONE_PREVIEW_ONLY' : mapping.code,
      reason: mapping.status === 'available' ? 'Detached local projection preview; no authority request was sent.' : mapping.reason,
      local: mapping.local || null,
      binding: mapping.binding ? copy(mapping.binding) : null,
      q: mapping.q ? [...mapping.q] : null,
      acceptedBinding: accepted ? copy(accepted) : null,
      connected: statusOf(this.transport),
    };
    this.lastResult = copy(result);
    this.message = result.reason;
    this._emit('preview');
    return result;
  }

  _capability(action, mapping) {
    if (mapping.status !== 'available') return {allowed: false, code: mapping.code, reason: mapping.reason};
    if (mapping.local?.mode === 'offline-branch') return {allowed: false, code: 'PHONE_OFFLINE_BRANCH_NO_SEND', reason: reasonFor('PHONE_OFFLINE_BRANCH_NO_SEND')};
    const permission = writePermission(this.transport);
    if (!permission.allowed) return {allowed: false, code: permission.code, reason: reasonFor(permission.code)};
    const journal = this.state?.journal;
    if (journal?.readOnly || journal?.backpressure) return {allowed: false, code: journal.fault || 'JOURNAL_BACKPRESSURE', reason: reasonFor(journal.fault || 'JOURNAL_BACKPRESSURE')};
    const binding = currentBinding(this.state, mapping.binding.bindingId);
    if (!binding) return {allowed: false, code: 'STUDIO_BINDING_UNAVAILABLE', reason: reasonFor('STUDIO_BINDING_UNAVAILABLE')};
    const advertised = action === 'commit'
      ? this.state?.capabilities?.studio?.canonicalCommit
      : this.state?.capabilities?.studio?.projection;
    if (action === 'commit') {
      if (!advertised?.allowed) return {allowed: false, code: advertised?.rejectionCode || 'STUDIO_COMMIT_UNAVAILABLE', reason: advertised?.reason || reasonFor(advertised?.rejectionCode || 'STUDIO_COMMIT_UNAVAILABLE'), durable: advertised?.durable === true};
    } else if (advertised !== true && advertised?.allowed !== true) {
      return {allowed: false, code: advertised?.rejectionCode || 'STUDIO_PROJECTION_UNAVAILABLE', reason: advertised?.reason || reasonFor(advertised?.rejectionCode || 'STUDIO_PROJECTION_UNAVAILABLE')};
    }
    if (binding.entityId !== mapping.binding.entityId || binding.spaceId !== mapping.binding.spaceId || binding.dimension !== mapping.binding.dimension || binding.chart !== mapping.binding.chart) {
      return {allowed: false, code: 'STUDIO_BINDING_IDENTITY', reason: reasonFor('STUDIO_BINDING_IDENTITY')};
    }
    return {allowed: true, durable: action === 'commit' ? advertised.durable === true : this.state?.capabilities?.persistenceMode !== 'session-only'};
  }

  _rejection(action, code, reason, refresh = true, extra = {}) {
    const result = {status: 'rejected', action, code, reason: reasonFor(code, reason), acceptedSequence: this.state?.snapshot?.acceptedSequence ?? null, ...extra};
    this.lastResult = copy(result);
    this.message = result.reason;
    this._emit(`${action}-rejected`);
    return result;
  }

  async _reconcile(action, code, reason) {
    if (statusOf(this.transport)) {
      try { await this.transport.refresh(); } catch {}
    }
    const binding = currentBinding(this.state, this._bindingId());
    const local = this._mapping();
    if (binding && local.status === 'available' && code.startsWith('STALE')) this._rememberConflict(binding, local.q, code);
    return this._rejection(action, code, reason, false, {conflict: Boolean(this.conflict), acceptedBinding: binding ? copy(binding) : null});
  }

  _conflictGate(action, mapping) {
    if (!this.conflict) return null;
    if (mapping.status !== 'available' || !sameQ(mapping.q, this.conflict.localQ)) {
      this.conflict = mapping.status === 'available' ? {...this.conflict, localQ: [...mapping.q]} : this.conflict;
      this.conflictOverrideArmed = false;
      return this._rejection(action, 'STUDIO_CONFLICT', reasonFor('STUDIO_CONFLICT'), false, {conflict: true});
    }
    if (!this.conflictOverrideArmed) {
      this.conflictOverrideArmed = true;
      return this._rejection(action, 'STUDIO_CONFLICT', 'Accepted canonical state changed. Repeat the same explicit action once to replace it, or leave the local phone edit untouched.', false, {conflict: true, retryArmed: true});
    }
    return null;
  }

  async _write(action) {
    await this.syncLocal();
    const mapping = this._mapping();
    const capability = this._capability(action, mapping);
    if (!capability.allowed) return this._rejection(action, capability.code, capability.reason, false, {durable: capability.durable ?? null});
    const blocked = this._conflictGate(action, mapping);
    if (blocked) return blocked;
    const readResult = await this.read();
    if (readResult?.status === 'rejected') return readResult;
    const fresh = await this.syncLocal();
    const freshMapping = this._mapping();
    const freshCapability = this._capability(action, freshMapping);
    if (!freshCapability.allowed) return this._rejection(action, freshCapability.code, freshCapability.reason, false, {durable: freshCapability.durable ?? null});
    const afterReadBlocked = this._conflictGate(action, freshMapping);
    if (afterReadBlocked) return afterReadBlocked;
    const snapshot = this.transport.getSnapshot();
    const binding = currentBinding(this.state, freshMapping.binding.bindingId);
    const entity = snapshot.spaces?.[binding.spaceId]?.entities?.[binding.entityId];
    if (!binding || !entity) return this._rejection(action, 'STUDIO_BINDING_TARGET', 'The canonical binding target is unavailable; the local phone state was not changed.', false);
    const {studioCommitCommand, studioTransformCommand} = await loadStudioCommands();
    const command = action === 'commit'
      ? studioCommitCommand(snapshot, freshMapping.q, {
        bindingId: binding.bindingId,
        metadata: binding.metadata,
        expectedRevision: snapshot.acceptedSequence,
        expectedBindingRevision: binding.bindingRevision,
        expectedEntityRevision: entity.revision,
        commandId: randomId('phone.studio.commit'),
      })
      : studioTransformCommand(snapshot, freshMapping.q, {
        bindingId: binding.bindingId,
        metadata: binding.metadata,
        expectedRevision: snapshot.acceptedSequence,
        commandId: randomId('phone.studio.transform'),
      });
    let receipt;
    try {
      receipt = await this.transport.submit(command);
    } catch (error) {
      return this._reconcile(action, error?.code || 'AUTHORITY_UNAVAILABLE', error?.message);
    }
    if (!receipt || receipt.status !== 'accepted') {
      return this._reconcile(action, receipt?.code || 'AUTHORITY_REJECTED', receipt?.code ? reasonFor(receipt.code) : 'Authority rejected the command; accepted state was refreshed and local state was unchanged.');
    }
    await this.syncLocal();
    this.conflict = null;
    this.conflictOverrideArmed = false;
    this.acceptedBinding = currentBinding(this.state, freshMapping.binding.bindingId) || copy(receipt.result?.binding);
    const result = {...copy(receipt), status: 'accepted', action, canonical: action === 'commit', projectionOnly: action === 'publish'};
    this.lastResult = copy(result);
    this.message = action === 'commit'
      ? 'Canonical commit accepted. The phone local object remains independently owned; no state was copied back.'
      : 'Projection publish accepted. Canonical entity state was not committed.';
    this._emit(`${action}-accepted`);
    return result;
  }

  publish() { return this._write('publish'); }
  commit() { return this._write('commit'); }

  async close() {
    if (statusOf(this.transport)) {
      try { await this.transport.close(); } finally { this.transport = null; }
    }
    this.state = null;
    this.acceptedBinding = null;
    this.conflict = null;
    this.conflictOverrideArmed = false;
    this.message = 'Canonical authority disconnected. The phone world remains local.';
    return this._emit('closed');
  }

  debug() {
    const mapping = this._mapping();
    const capability = {
      projection: this.state?.capabilities?.studio?.projection === true || this.state?.capabilities?.studio?.projection?.allowed === true,
      canonicalCommit: copy(this.state?.capabilities?.studio?.canonicalCommit || {allowed: false, rejectionCode: 'STUDIO_COMMIT_UNAVAILABLE', reason: reasonFor('STUDIO_COMMIT_UNAVAILABLE')}),
    };
    return {
      schema: 'vivo.phone-authority-adapter/1',
      connected: statusOf(this.transport),
      seat: this.seat,
      selectedEntityId: this.selectedEntityId,
      mapping: copy(mapping),
      local: this.localEnvelope ? {worldId: this.localEnvelope.snapshot?.worldId, branchId: this.localEnvelope.branchId ?? null, mode: this.localEnvelope.mode ?? 'local', persistence: copy(this.localEnvelope.persistence)} : null,
      acceptedSequence: this.state?.snapshot?.acceptedSequence ?? null,
      acceptedBinding: this.acceptedBinding ? copy(this.acceptedBinding) : null,
      acceptedEntity: mapping.binding ? copy(this.state?.snapshot?.spaces?.[mapping.binding.spaceId]?.entities?.[mapping.binding.entityId] || null) : null,
      capabilities: capability,
      authorityPersistence: this.state?.capabilities ? {mode: this.state.capabilities.persistenceMode || null, durable: this.state.capabilities.persistenceMode !== 'session-only', journal: copy(this.state.journal || null)} : null,
      conflict: this.conflict ? copy(this.conflict) : null,
      conflictOverrideArmed: this.conflictOverrideArmed,
      lastResult: this.lastResult ? copy(this.lastResult) : null,
      message: this.message,
    };
  }
}

export { mapPhoneEnvelopeToCanonical };

