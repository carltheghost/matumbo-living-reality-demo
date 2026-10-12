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
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const wrapAngle = value => {
  let angle = finite(value);
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
};

function normalizeAxes(axes, dimension, fallback = [0, 1]) {
  const result = [];
  for (const axis of Array.isArray(axes) ? axes : fallback) {
    const value = Number(axis);
    if (Number.isInteger(value) && value >= 0 && value < dimension && !result.includes(value)) result.push(value);
    if (result.length === 2) break;
  }
  for (let axis = 0; result.length < 2 && axis < dimension; axis++) if (!result.includes(axis)) result.push(axis);
  if (result.length !== 2) throw new RangeError('Transform axes must identify two selected dimensions');
  return result;
}

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

const pairTransform = (list, axes = [0, 1], pairContactIds = null) => {
  if (list.length < 2) return { rotation: 0, scale: 1 };
  const pair = pairContactIds?.length === 2
    ? pairContactIds.map(id => list.find(item => item.contactId === id)).filter(Boolean)
    : [];
  const [a, b] = pair.length === 2 ? pair : list.slice(0, 2);
  const [firstAxis, secondAxis] = axes;
  const initial = [b.anchor[firstAxis] - a.anchor[firstAxis], b.anchor[secondAxis] - a.anchor[secondAxis]];
  const current = [b.point[firstAxis] - a.point[firstAxis], b.point[secondAxis] - a.point[secondAxis]];
  const initialLength = Math.hypot(...initial), currentLength = Math.hypot(...current);
  if (initialLength <= 1e-6 || currentLength <= 1e-6) return { rotation: 0, scale: 1 };
  return {
    rotation: wrapAngle(Math.atan2(current[1], current[0]) - Math.atan2(initial[1], initial[0])),
    scale: clamp(currentLength / initialLength, 0.05, 20),
  };
};

const cancelledReason = reason => /cancel|lost|missing|fence|stop|hidden|ambiguous|worker|disconnect|replaced|two-hand/i.test(String(reason || ''));
const blankAggregate = (dimension, axes = [0, 1]) => ({
  translation: Array(dimension).fill(0), rotation: 0, scale: 1, axes: [...axes], pairContactIds: [],
});

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
    const bucket = this.constraints.get(constraint.objectId);
    const contacts = bucket ? [...bucket.values()] : [];
    const dimension = Math.max(3, ...contacts.map(item => item.point.length), constraint.point.length);
    const previous = this.aggregates.get(constraint.objectId) || blankAggregate(dimension);
    const allAxes = normalizeAxes(constraint.metadata?.transformAxes || previous.axes, dimension);
    const before = this._compose(constraint.objectId, contacts, dimension, allAxes);
    const remaining = contacts.filter(item => item.contactId !== id);
    const selectiveAgentCancellation = sourceKind(constraint.source) === 'agent' && cancelledReason(reason);
    this.contacts.delete(id);
    if (selectiveAgentCancellation) {
      // Agent cancellation is a source-local fence. Keep the accepted carry
      // exactly as it was and let the remaining contacts keep their own
      // point/anchor deltas. Re-composing all contacts here would fold the
      // stopped agent's provisional movement into the surviving human or
      // agent constraint, and rebasing their anchors would lose that pending
      // movement/geometry on the next frame.
      const pairContactIds = (previous.pairContactIds || [])
        .filter(pairId => remaining.some(item => item.contactId === pairId))
        .slice(0, 2);
      for (const item of remaining) {
        if (pairContactIds.length >= 2) break;
        if (!pairContactIds.includes(item.contactId)) pairContactIds.push(item.contactId);
      }
      if (remaining.length || this.aggregates.has(constraint.objectId)) {
        this.aggregates.set(constraint.objectId, {
          ...previous,
          axes: [...allAxes],
          pairContactIds,
        });
      } else {
        this.aggregates.delete(constraint.objectId);
      }
    } else if (cancelledReason(reason)) {
      // A lost/cancelled contact must never turn its provisional displacement
      // into accepted state. Remaining contacts continue from their current
      // points with only their own displacement preserved, so there is no jump.
      if (remaining.length) {
        const retained = this._compose(constraint.objectId, remaining, dimension, allAxes);
        this.aggregates.set(constraint.objectId, {
          ...retained,
          pairContactIds: remaining.slice(0, 2).map(item => item.contactId),
        });
        for (const item of remaining) item.anchor = [...item.point];
      } else {
        this.aggregates.delete(constraint.objectId);
      }
    } else {
      // Capture the complete transform before removing the ending contact.
      // Releasing either member of a pair therefore produces the same
      // accepted result; remaining contacts continue relative to this state.
      this.aggregates.set(constraint.objectId, {
        ...before,
        pairContactIds: remaining.slice(0, 2).map(item => item.contactId),
      });
      for (const item of remaining) item.anchor = [...item.point];
    }
    bucket?.delete(id);
    if (bucket?.size === 0) this.constraints.delete(constraint.objectId);
    const after = this.preview(constraint.objectId, dimension);
    return {
      contactId: id, source: constraint.source, objectId: constraint.objectId,
      reason: String(reason || 'release'), releasedAt: this.now(),
      acceptedPreview: cancelledReason(reason) ? null : clone(after),
    };
  }
  releaseSource(source, reason = 'source-release') {
    const key = sourceKey(source);
    return [...this.contacts.values()].filter(item => item.source === key).map(item => this.end(item.contactId, reason));
  }
  releaseKind(kind, reason = 'kind-release') {
    const prefix = normalizeId(String(kind), 'kind') + ':';
    return [...this.contacts.values()].filter(item => item.source.startsWith(prefix)).map(item => this.end(item.contactId, reason));
  }
  killAgent(agentId, reason = 'agent-stop') {
    const owner = 'agent:' + normalizeId(agentId, 'agentId');
    return [...this.contacts.values()].filter(item => item.source === owner).map(item => this.end(item.contactId, reason));
  }
  stopAgent(agentId, reason = 'agent-stop') { return this.killAgent(agentId, reason); }
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
   * Return a provisional transform. Translation is a full-D canonical delta;
   * scale and rotation are geometric shape metadata in the selected display
   * plane. They never become higher-dimensional coordinates.
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
    const axes = normalizeAxes(carry?.axes || list[0]?.metadata?.transformAxes, safeDimension);
    const translation = Array(safeDimension).fill(0);
    if (carry) for (let axis = 0; axis < safeDimension; axis++) translation[axis] = finite(carry.translation[axis]);
    if (list.length) for (const item of list) for (let axis = 0; axis < safeDimension; axis++) translation[axis] += (finite(item.point[axis]) - finite(item.anchor[axis])) / list.length;
    const transform = pairTransform(list, axes, carry?.pairContactIds);
    return {
      objectId, contactCount: list.length, contactIds: list.map(item => item.contactId), translation,
      axes,
      rotation: wrapAngle(finite(carry?.rotation) + transform.rotation),
      scale: clamp(finite(carry?.scale, 1) * transform.scale, 0.05, 20),
      geometry: { scale: clamp(finite(carry?.scale, 1) * transform.scale, 0.05, 20), rotation: wrapAngle(finite(carry?.rotation) + transform.rotation), axes: [...axes] },
      provisional: true,
    };
  }
  _compose(objectId, list, dimension, axes) {
    const carry = this.aggregates.get(objectId) || blankAggregate(dimension, axes);
    const translation = Array(dimension).fill(0);
    for (let axis = 0; axis < dimension; axis++) translation[axis] = finite(carry.translation[axis]);
    if (list.length) for (const item of list) for (let axis = 0; axis < dimension; axis++) translation[axis] += (finite(item.point[axis]) - finite(item.anchor[axis])) / list.length;
    const transform = pairTransform(list, axes, carry.pairContactIds);
    return {
      translation,
      rotation: wrapAngle(finite(carry.rotation) + transform.rotation),
      scale: clamp(finite(carry.scale, 1) * transform.scale, 0.05, 20),
      axes: [...axes],
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
