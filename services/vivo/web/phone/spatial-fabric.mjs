/**
 * Bounded spatial interaction fabric for the phone surface.
 *
 * Every contact owns its identity and constraint.  No global active pointer
 * exists here: a lost finger/hand/agent releases only its own constraints.
 * Inputs arrive after the sensor/device/renderer layer has mapped them into
 * device coordinates; callers must supply the inverse projection used to
 * produce canonical coordinates before beginning a constraint.
 */
export const CONTACT_KINDS = Object.freeze(['touch', 'hand', 'finger', 'gaze', 'controller', 'agent']);
export const GESTURES = Object.freeze(['hover', 'point', 'touch', 'press', 'pinch', 'grab', 'drag', 'pull', 'push', 'twist', 'rotate', 'scale', 'stretch', 'bend', 'poke', 'throw', 'hold', 'release']);

const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeId = (value, label) => {
  if (typeof value !== 'string' || !value || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(label + ' must be a bounded identity');
  return value;
};
const normalizePoint = (value, label = 'canonicalPoint') => {
  if (!Array.isArray(value) || value.length < 3 || value.length > 11 || value.some(item => !Number.isFinite(Number(item)) || Math.abs(Number(item)) > 1e6)) throw new TypeError(label + ' must be a bounded 3D..11D canonical point');
  return value.map(Number);
};
const sourceKey = source => {
  if (typeof source === 'string') return normalizeId(source, 'source');
  if (!source || typeof source !== 'object') throw new TypeError('source is required');
  return normalizeId(String(source.kind || 'contact') + ':' + String(source.id || ''), 'source');
};
const sourceKind = source => String(source || '').split(':', 1)[0];

/**
 * Convert a device-space point through a supplied projection inverse.  The
 * default inverse is deliberately only a normalized device-plane mapping;
 * production renderers may supply a metric/chart-aware inverse.
 */
export function mapDevicePointToCanonical({ devicePoint, viewport, eye, axes = [0, 1], scale = 1, inverseProjection = null } = {}) {
  if (!devicePoint || !viewport || !eye) throw new TypeError('device point, viewport and Eye are required');
  const width = finite(viewport.width), height = finite(viewport.height);
  if (width <= 0 || height <= 0) throw new RangeError('Viewport must be positive');
  const normalized = {
    x: clamp((finite(devicePoint.x) - finite(viewport.left)) / width * 2 - 1, -1, 1),
    y: clamp(1 - (finite(devicePoint.y) - finite(viewport.top)) / height * 2, -1, 1),
  };
  const inverse = typeof inverseProjection === 'function'
    ? inverseProjection({ normalized, eye: clone(eye) })
    : normalized;
  if (!inverse || !Number.isFinite(Number(inverse.x)) || !Number.isFinite(Number(inverse.y))) throw new TypeError('Projection inverse did not return finite device coordinates');
  const q = normalizePoint(Array.isArray(eye.q) ? eye.q : [], 'Eye q');
  const first = Number(axes[0]), second = Number(axes[1]);
  if (!Number.isInteger(first) || !Number.isInteger(second) || first === second || first < 0 || second < 0 || first >= q.length || second >= q.length) throw new RangeError('Projection axes are outside the Eye');
  const factor = finite(scale, 1);
  q[first] += Number(inverse.x) * factor;
  q[second] += Number(inverse.y) * factor;
  return q;
}

/** Invert the actual Canvas renderer camera instead of treating the screen as an identity plane. */
export function mapRendererPointToCanonical({ devicePoint, viewport, eye, renderer, axes = [0, 1, 2], depth = null } = {}) {
  if (!devicePoint || !viewport || !eye || !renderer) throw new TypeError('device point, viewport, Eye and renderer are required');
  const width = finite(renderer.w, finite(viewport.width)), height = finite(renderer.h, finite(viewport.height));
  if (width <= 0 || height <= 0) throw new RangeError('Renderer viewport must be positive');
  const q = normalizePoint(Array.isArray(eye.q) ? eye.q : [], 'Eye q');
  const targetAxes = axes.map(Number);
  if (targetAxes.length !== 3 || new Set(targetAxes).size !== 3 || targetAxes.some(axis => !Number.isInteger(axis) || axis < 0 || axis >= q.length)) throw new RangeError('Renderer axes are outside the Eye');
  const yaw = finite(renderer.yaw), pitch = finite(renderer.pitch), distance = Math.max(0.15, finite(renderer.distance, 10.5));
  const viewDepth = Math.max(0.15, finite(depth, distance));
  const sx = finite(devicePoint.x) - finite(viewport.left), sy = finite(devicePoint.y) - finite(viewport.top);
  const k = Math.min(width, height) * 1.18 / viewDepth;
  const xx = (sx - width / 2) / k;
  const yy = (height * 0.52 - sy) / k;
  const sp = Math.sin(pitch), cp = Math.cos(pitch), ca = Math.cos(yaw), sa = Math.sin(yaw);
  const cameraDepth = distance - viewDepth;
  const y = sp * cameraDepth + cp * yy;
  const zRotated = cp * cameraDepth - sp * yy;
  const x = ca * xx + sa * zRotated;
  const z = -sa * xx + ca * zRotated;
  const origin = Array.isArray(renderer.origin) ? renderer.origin : [0, 0, 0];
  q[targetAxes[0]] = x + finite(origin[0]); q[targetAxes[1]] = y + finite(origin[1]); q[targetAxes[2]] = z + finite(origin[2]);
  return q;
}

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const pairTransform = list => {
  if (list.length < 2) return { rotation: 0, scale: 1 };
  const [a, b] = list;
  const initial = [b.anchor[0] - a.anchor[0], b.anchor[1] - a.anchor[1]];
  const current = [b.point[0] - a.point[0], b.point[1] - a.point[1]];
  const initialLength = Math.hypot(...initial), currentLength = Math.hypot(...current);
  if (initialLength <= 1e-6 || currentLength <= 1e-6) return { rotation: 0, scale: 1 };
  return {
    rotation: Math.atan2(current[1], current[0]) - Math.atan2(initial[1], initial[0]),
    scale: clamp(currentLength / initialLength, 0.05, 20),
  };
};

export class SpatialInteractionFabric {
  constructor({ now = () => globalThis.performance?.now?.() ?? Date.now(), maxContacts = 64, maxConstraintsPerObject = 16 } = {}) {
    this.now = now;
    this.maxContacts = maxContacts;
    this.maxConstraintsPerObject = maxConstraintsPerObject;
    this.contacts = new Map();
    this.constraints = new Map();
    this.aggregates = new Map();
    this.sequence = 0;
  }
  begin({ contactId, source, objectId, gesture = 'grab', canonicalPoint, timestamp = this.now(), metadata = null } = {}) {
    const id = normalizeId(contactId, 'contactId');
    const object = normalizeId(objectId, 'objectId');
    const point = normalizePoint(canonicalPoint);
    if (!GESTURES.includes(gesture)) throw new TypeError('Unsupported interaction gesture');
    if (this.contacts.has(id)) this.end(id, 'replaced');
    if (this.contacts.size >= this.maxContacts) throw new RangeError('Interaction contact limit exceeded');
    const key = sourceKey(source || id);
    const bucket = this.constraints.get(object) || new Map();
    if (!this.constraints.has(object)) this.aggregates.delete(object);
    if (bucket.size >= this.maxConstraintsPerObject) throw new RangeError('Object interaction constraint limit exceeded');
    const constraint = {
      contactId: id, source: key, objectId: object, gesture,
      anchor: [...point], point: [...point], startedAt: finite(timestamp), updatedAt: finite(timestamp),
      sequence: ++this.sequence, metadata: metadata ? clone(metadata) : null,
    };
    this.contacts.set(id, constraint);
    bucket.set(id, constraint);
    this.constraints.set(object, bucket);
    return clone(constraint);
  }
  update(contactId, { canonicalPoint, gesture = null, timestamp = this.now(), metadata = null } = {}) {
    const id = normalizeId(contactId, 'contactId');
    const constraint = this.contacts.get(id);
    if (!constraint) return null;
    const point = normalizePoint(canonicalPoint);
    if (gesture !== null && !GESTURES.includes(gesture)) throw new TypeError('Unsupported interaction gesture');
    constraint.point = [...point];
    if (gesture) constraint.gesture = gesture;
    constraint.updatedAt = finite(timestamp);
    constraint.sequence = ++this.sequence;
    if (metadata !== null) constraint.metadata = clone(metadata);
    return clone(constraint);
  }
  /** Rebase an accepted source movement without discarding its live point. */
  rebase(contactId, canonicalPoint = null) {
    const id = normalizeId(contactId, 'contactId');
    const constraint = this.contacts.get(id);
    if (!constraint) return null;
    const point = canonicalPoint === null ? constraint.point : normalizePoint(canonicalPoint);
    constraint.anchor = [...point];
    constraint.updatedAt = this.now();
    constraint.sequence = ++this.sequence;
    return clone(constraint);
  }
  end(contactId, reason = 'release') {
    const id = normalizeId(contactId, 'contactId');
    const constraint = this.contacts.get(id);
    if (!constraint) return null;
    this.contacts.delete(id);
    const bucket = this.constraints.get(constraint.objectId);
    const preserve = sourceKind(constraint.source) === 'touch' && (reason === 'touch-release' || reason === 'release');
    if (preserve) {
      const touchContacts = [...bucket.values()].filter(item => sourceKind(item.source) === 'touch');
      const dimension = Math.max(3, ...touchContacts.map(item => item.point.length), constraint.point.length);
      const prior = this.aggregates.get(constraint.objectId) || { translation: [], rotation: 0, scale: 1 };
      const translation = Array(dimension).fill(0);
      for (let axis = 0; axis < dimension; axis++) translation[axis] = finite(prior.translation[axis]);
      for (const item of touchContacts) {
        for (let axis = 0; axis < dimension; axis++) translation[axis] += (finite(item.point[axis]) - finite(item.anchor[axis])) / touchContacts.length;
      }
      const transform = pairTransform(touchContacts);
      this.aggregates.set(constraint.objectId, {
        translation,
        rotation: finite(prior.rotation) + transform.rotation,
        scale: finite(prior.scale, 1) * transform.scale,
      });
      for (const item of touchContacts) {
        if (item.contactId !== id) item.anchor = [...item.point];
      }
    }
    bucket?.delete(id);
    if (bucket?.size === 0) this.constraints.delete(constraint.objectId);
    return { contactId: id, source: constraint.source, objectId: constraint.objectId, reason: String(reason || 'release'), releasedAt: this.now() };
  }
  releaseSource(source, reason = 'source-release') {
    const key = sourceKey(source);
    return [...this.contacts.values()].filter(item => item.source === key).map(item => this.end(item.contactId, reason));
  }
  releaseKind(kind, reason = 'kind-release') {
    const prefix = normalizeId(String(kind), 'kind') + ':';
    return [...this.contacts.values()].filter(item => item.source.startsWith(prefix)).map(item => this.end(item.contactId, reason));
  }
  killAgent(agentId, reason = 'agent-kill-switch') {
    const owner = 'agent:' + normalizeId(agentId, 'agentId');
    return [...this.contacts.values()].filter(item => item.source === owner).map(item => this.end(item.contactId, reason));
  }
  emergencyStop(reason = 'emergency-stop') {
    const released = [...this.contacts.keys()].map(id => this.end(id, reason));
    this.aggregates.clear();
    return released;
  }
  clearObjectAggregate(objectId) {
    this.aggregates.delete(normalizeId(objectId, 'objectId'));
  }
  forObject(objectId) {
    const bucket = this.constraints.get(normalizeId(objectId, 'objectId'));
    return bucket ? [...bucket.values()].map(clone) : [];
  }
  /**
   * Return a provisional transform. Translation, rotation and scale are
   * preview metadata; the phone engine's accepted local-edit command currently
   * commits translation only. Callers must not treat this result as accepted
   * entity orientation/scale or canonical authority state.
   */
  preview(objectId, dimension, { sourceKinds = null } = {}) {
    const allowedKinds = sourceKinds === null
      ? null
      : new Set((Array.isArray(sourceKinds) ? sourceKinds : [sourceKinds]).map(kind => normalizeId(String(kind), 'source kind')));
    const list = this.forObject(objectId).filter(item => !allowedKinds || allowedKinds.has(sourceKind(item.source)));
    const carry = this.aggregates.get(objectId);
    if (!list.length && !carry) return null;
    const safeDimension = Number(dimension);
    if (!Number.isInteger(safeDimension) || safeDimension < 3 || safeDimension > 11) throw new RangeError('Preview dimension must be 3 through 11');
    const translation = Array(safeDimension).fill(0);
    if (carry) for (let axis = 0; axis < safeDimension; axis++) translation[axis] = finite(carry.translation[axis]);
    if (list.length) for (const item of list) for (let axis = 0; axis < safeDimension; axis++) translation[axis] += (finite(item.point[axis]) - finite(item.anchor[axis])) / list.length;
    const transform = pairTransform(list);
    return {
      objectId, contactCount: list.length, contactIds: list.map(item => item.contactId), translation,
      rotation: finite(carry?.rotation) + transform.rotation,
      scale: finite(carry?.scale, 1) * transform.scale,
      provisional: true,
    };
  }
  snapshot() {
    return {
      schema: 'vivo.spatial-interaction-fabric/1',
      contacts: [...this.contacts.values()].map(clone),
      constraints: [...this.constraints.entries()].map(([objectId, bucket]) => [objectId, [...bucket.keys()]]),
      aggregates: [...this.aggregates.entries()].map(([objectId, value]) => [objectId, clone(value)]),
      sequence: this.sequence,
    };
  }
}
