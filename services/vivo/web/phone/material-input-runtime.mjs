import { mapRendererPointToCanonical } from './spatial-fabric.mjs';
import { MaterialContactQueue, capturedInverseMapping } from './material-patch.mjs';
import {
  PHONE_MATERIAL_ENTITY_ID,
  PHONE_MATERIAL_TARGET_SCHEMA,
  materialIdentityFromEnvelope,
} from './material-contract.mjs';

const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function boundedId(value, label) {
  const result = String(value ?? '');
  if (!result || result.length > 160 || /[\u0000-\u001f\u007f]/.test(result)) throw new TypeError(`${label} must be a bounded identity.`);
  return result;
}

/**
 * Phone-owned material contact adapter. It captures one Workpiece node at
 * begin time and sends absolute full-D targets for that same node. It never
 * feeds material contacts through SpatialInteractionFabric's rigid aggregate.
 */
export class PhoneMaterialInputRuntime {
  constructor({ engine, renderer, getEnvelope, getViewport, now = () => Date.now(), onPreview = () => {}, onState = () => {} } = {}) {
    if (!engine || !renderer || typeof getEnvelope !== 'function') throw new TypeError('Material input runtime needs engine, renderer, and envelope access.');
    this.engine = engine;
    this.renderer = renderer;
    this.getEnvelope = getEnvelope;
    this.getViewport = getViewport || (() => ({ left: 0, top: 0, width: renderer.w || 1, height: renderer.h || 1 }));
    this.now = now;
    this.onPreview = onPreview;
    this.onState = onState;
    this.contacts = new Map();
    this.generations = new Map();
    this.operationSequence = 0;
    this.sessionId = `phone-input:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
  }

  nextOperation(kind, contactId) {
    this.operationSequence++;
    return `material:${kind}:${contactId}:${this.operationSequence}`;
  }

  nextGeneration(source) {
    const owner = `${source.kind}:${source.sourceId}`;
    const current = this.generations.get(owner) || 0;
    const generation = Math.max(current + 1, Number(source.generation) || 0);
    this.generations.set(owner, generation);
    return generation;
  }

  viewport() {
    const value = this.getViewport() || {};
    return {
      left: finite(value.left), top: finite(value.top),
      width: Math.max(0.01, finite(value.width, this.renderer.w || 1)),
      height: Math.max(0.01, finite(value.height, this.renderer.h || 1)),
    };
  }

  capturedMapping(point, nodeQ, dimension) {
    const viewport = this.viewport();
    const renderer = {
      w: Math.max(0.01, finite(this.renderer.w, viewport.width)),
      h: Math.max(0.01, finite(this.renderer.h, viewport.height)),
      yaw: finite(this.renderer.yaw, 0.55), pitch: finite(this.renderer.pitch, 0.68),
      distance: Math.max(0.15, finite(this.renderer.distance, 10.5)),
      origin: Array.isArray(this.renderer.origin) ? [...this.renderer.origin] : [0, 0, 0],
    };
    const axes = [0, 2, 1].filter(axis => axis < dimension);
    while (axes.length < 3) for (let axis = 0; axes.length < 3 && axis < dimension; axis++) if (!axes.includes(axis)) axes.push(axis);
    return capturedInverseMapping({
      devicePoint: [Number(point[0]), Number(point[1])], viewport, renderer,
      axes, depth: renderer.distance, canonicalQ: nodeQ,
    });
  }

  canonicalPoint(record, point) {
    const mapping = record.attachment.inverseMapping;
    const eye = { q: [...record.attachment.capturedCanonicalPoint] };
    const renderer = mapping.renderer;
    const base = mapRendererPointToCanonical({
      devicePoint: { x: mapping.devicePoint[0], y: mapping.devicePoint[1] },
      viewport: mapping.viewport, eye, renderer, axes: mapping.axes, depth: mapping.depth,
    });
    const current = mapRendererPointToCanonical({
      devicePoint: { x: Number(point[0]), y: Number(point[1]) },
      viewport: mapping.viewport, eye, renderer, axes: mapping.axes, depth: mapping.depth,
    });
    return record.attachment.capturedCanonicalPoint.map((value, axis) => value + (current[axis] - base[axis]));
  }

  async envelope() {
    return this.getEnvelope();
  }

  async begin({ contactId, source, point, nodeId = null, actuator = null, gesture = 'touch' } = {}) {
    const id = boundedId(contactId, 'contactId');
    if (this.contacts.has(id)) return this.contacts.get(id).ready;
    const inputSource = {
      ...source,
      sessionId: source?.sessionId || this.sessionId,
      generation: Number(source?.generation) || this.nextGeneration(source),
    };
    const ready = (async () => {
      const envelope = await this.envelope();
      const body = envelope?.snapshot?.materialBodies?.[PHONE_MATERIAL_ENTITY_ID];
      if (!body) throw new Error('The phone Workpiece material patch is not available in this envelope.');
      const identity = materialIdentityFromEnvelope(envelope, PHONE_MATERIAL_ENTITY_ID, body);
      const hit = nodeId ? { nodeId } : this.renderer.atMaterialNode?.(point[0], point[1]);
      if (!hit?.nodeId || !body.nodes[hit.nodeId]) throw new Error('Touch/hand point did not hit an accepted Workpiece material node.');
      const node = body.nodes[hit.nodeId];
      const attachment = {
        nodeId: hit.nodeId,
        capturedCanonicalPoint: [...node.q],
        capturedAt: this.now(),
        inverseMapping: this.capturedMapping(point, node.q, identity.dimension),
      };
      const result = await this.engine.materialBegin({
        operationId: this.nextOperation('begin', id), contactId: id, source: inputSource,
        identity, attachment, actuator: actuator || { maxForce: 2, stiffness: 3, damping: 0.4 },
        observedAt: this.now(), receivedAt: this.now(), gesture,
      });
      const record = {
        contactId: id, source: inputSource, nodeId: hit.nodeId, identity,
        attachment, actuator: actuator || { maxForce: 2, stiffness: 3, damping: 0.4 },
        targetSeq: 0, latestPoint: [...point], ended: false, ready: Promise.resolve(result),
      };
      record.queue = new MaterialContactQueue({
        submit: target => this.engine.materialTarget(target),
        release: reason => this.engine.materialEnd({
          operationId: this.nextOperation('end', id), contactId: id, source: inputSource,
          identity: { ...identity, bodyRevision: Number(identity.bodyRevision) },
          observedAt: this.now(), receivedAt: this.now(), reason,
        }),
        cancel: reason => this.engine.materialCancel({
          operationId: this.nextOperation('cancel', id), contactId: id, source: inputSource,
          identity: { ...identity, bodyRevision: Number(identity.bodyRevision) },
          observedAt: this.now(), receivedAt: this.now(), reason,
        }),
        reconcile: error => this.engine.materialReconcileOperation(String(error?.operationId || id)),
      });
      this.contacts.set(id, record);
      this.onState({ type: 'material-begin', contactId: id, nodeId: hit.nodeId, source: clone(inputSource), result });
      if (record.latestPoint) await this.update(id, record.latestPoint, { queueOnly: true });
      return result;
    })();
    // Keep the source identity visible while the worker begin is in flight;
    // callers can distinguish a queued contact from an absent contact without
    // observing an undefined/null source record.
    const pending = { contactId: id, source: clone(inputSource), nodeId: nodeId || null, ready, latestPoint: [...point] };
    this.contacts.set(id, pending);
    try { return await ready; } catch (error) { if (this.contacts.get(id) === pending) this.contacts.delete(id); throw error; }
  }

  makeTarget(record, point) {
    record.targetSeq++;
    return {
      schema: PHONE_MATERIAL_TARGET_SCHEMA,
      operationId: this.nextOperation('target', record.contactId), contactId: record.contactId,
      identity: { ...record.identity, bodyRevision: Number(record.identity.bodyRevision) },
      source: clone(record.source), targetSeq: record.targetSeq,
      q: this.canonicalPoint(record, point), attachment: clone(record.attachment), actuator: clone(record.actuator),
      observedAt: this.now(), receivedAt: this.now(),
    };
  }

  async update(contactId, point, { queueOnly = false } = {}) {
    const record = this.contacts.get(contactId);
    if (!record) return { status: 'unknown-contact' };
    record.latestPoint = [...point];
    if (record.ready && !(record.nodeId && record.queue)) {
      await record.ready;
      return this.update(contactId, point, { queueOnly });
    }
    if (!record.queue) return record.ready.then(() => this.update(contactId, point, { queueOnly }));
    const target = this.makeTarget(record, point);
    const submitted = record.queue.offer(target);
    if (!queueOnly) {
      try {
        const preview = await this.engine.materialPreview({ target });
        this.onPreview(preview, record);
      } catch (error) {
        this.onState({ type: 'material-preview-error', contactId, error });
      }
    }
    return submitted;
  }

  async preview(contactId, point) {
    const record = this.contacts.get(contactId);
    if (!record) return { status: 'unknown-contact' };
    if (!record.queue) await record.ready;
    if (!record.queue) return { status: 'begin-failed' };
    const target = this.makeTarget(record, point);
    const result = await this.engine.materialPreview({ target });
    this.onPreview(result, record);
    return result;
  }

  async end(contactId, reason = 'release', { cancel = false } = {}) {
    const record = this.contacts.get(contactId);
    if (!record) return { status: 'unknown-contact' };
    if (!record.queue) await record.ready;
    if (!record.queue) return { status: 'begin-failed' };
    record.ended = true;
    const result = cancel ? await record.queue.cancel(reason) : await record.queue.release(reason);
    this.contacts.delete(contactId);
    this.onPreview(null, record);
    this.onState({ type: cancel ? 'material-cancel' : 'material-end', contactId, result });
    return result;
  }

  async stopSource(source, reason = 'source-stop') {
    const sourceId = boundedId(source?.sourceId, 'source.sourceId');
    const owner = source.kind === 'hand' ? sourceId : `${source.kind}:${sourceId}`;
    const matching = [...this.contacts.values()].filter(record => {
      if (!record.source) return false;
      return record.source.sourceId === sourceId || record.source.parentSourceId === sourceId || `${record.source.kind}:${record.source.sourceId}` === owner;
    });
    for (const record of matching) await this.end(record.contactId, reason, { cancel: true });
    return this.engine.materialStopSource({
      operationId: this.nextOperation('stop', owner), source,
      identity: matching[0]?.identity || (await this.envelope()).snapshot.materialBodies?.[PHONE_MATERIAL_ENTITY_ID]?.identity,
      observedAt: this.now(), receivedAt: this.now(), reason,
    });
  }

  snapshot() {
    return [...this.contacts.values()].map(record => ({ contactId: record.contactId, nodeId: record.nodeId, source: clone(record.source) }));
  }
}
