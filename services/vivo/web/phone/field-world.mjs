/**
 * Phone-local field-world projection.
 *
 * This is an analytic information view over the detached local phone
 * envelope.  It never allocates a dense D-dimensional grid and never writes
 * canonical authority state.  Atlas cells are bounded samples of coordinate
 * planes; an awake object is a view decision, not a change to the envelope.
 */
import { LocalOperationIdFactory } from './local-operation.mjs';
import { informationColor } from './field-palette.mjs';
import { normalizeEntityGeometry } from './engine.mjs';

export const FIELD_WORLD_SCHEMA = 'vivo.phone.field-world/1';
export const FIELD_LAYOUTS = Object.freeze(['ring', 'row', 'gather']);
export const MAX_ATLAS_RESOLUTION = 12;

const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const wrapAngle = value => {
  let angle = finite(value);
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
};
function geometryIntent(base, next) {
  const safeBase = normalizeEntityGeometry(base, Math.max(3, Math.max(...(base?.axes || [0, 1])) + 1));
  const safeNext = normalizeEntityGeometry(next, Math.max(3, Math.max(...(next?.axes || safeBase.axes)) + 1));
  return { scale: safeNext.scale / safeBase.scale, rotation: wrapAngle(safeNext.rotation - safeBase.rotation), axes: [...safeNext.axes] };
}
function applyGeometryIntent(base, intent, dimension) {
  const safeBase = normalizeEntityGeometry(base, dimension);
  const next = intent && typeof intent === 'object' ? intent : { scale: 1, rotation: 0, axes: safeBase.axes };
  return normalizeEntityGeometry({
    scale: clamp(safeBase.scale * finite(next.scale, 1), 0.05, 20),
    rotation: wrapAngle(safeBase.rotation + finite(next.rotation)),
    axes: next.axes || safeBase.axes,
  }, dimension);
}
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - (b[index] || 0)));
const tokenize = value => String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function normalizeAxes(axes, dimension) {
  const result = [];
  for (const axis of Array.isArray(axes) ? axes : []) {
    const value = Number(axis);
    if (Number.isInteger(value) && value >= 0 && value < dimension && !result.includes(value)) result.push(value);
  }
  for (let axis = 0; result.length < Math.min(3, dimension) && axis < dimension; axis++) {
    if (!result.includes(axis)) result.push(axis);
  }
  return result;
}

function relevanceFor(entity, eyeQ, query) {
  const proximity = Math.exp(-Math.pow(distance(entity.q, eyeQ) / Math.max(0.2, 1.5 + entity.radius), 2));
  const tokens = new Set(tokenize([
    entity.id, entity.name, entity.materialProfile,
    ...(entity.fieldMembership || []), ...(entity.lineage || []),
  ].join(' ')));
  const requested = tokenize(query);
  const matches = requested.filter(token => tokens.has(token)).length;
  const information = requested.length ? matches / requested.length : 0;
  return {
    proximity,
    information,
    relevance: clamp(0.7 * proximity + 0.3 * information, 0, 1),
  };
}

function axisRange(entities, eyeQ, axis) {
  const values = [finite(eyeQ[axis])];
  for (const entity of entities) values.push(finite(entity.q[axis]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const pad = Math.max(0.75, span * 0.28);
  return [min - pad, max + pad];
}

function gaussian(point, entity, width = 1.25) {
  const radius = Math.max(0.16, finite(entity.radius, 0.25));
  const scale = Math.max(width, radius * 2.5) * Math.max(0.05, finite(entity.geometry?.scale, 1));
  return Math.exp(-Math.pow(distance(point, entity.q) / scale, 2));
}

function sampleField(point, entities) {
  let total = 0;
  const mix = [0, 0, 0];
  for (const entity of entities) {
    const queryWeight = entity.queryActive ? 0.3 + 0.7 * clamp(finite(entity.information), 0, 1) : 1;
    const weight = gaussian(point, entity) * queryWeight;
    total += weight;
    for (let channel = 0; channel < 3; channel++) mix[channel] += weight * entity.color.rgb[channel];
  }
  const brightness = clamp(total / Math.max(1, entities.length * 0.72), 0, 1);
  const rgb = total > 1e-9 ? mix.map(value => clamp(value / total, 0, 1)) : [0.04, 0.1, 0.14];
  return {
    value: total,
    brightness,
    rgb,
    css: 'rgb(' + rgb.map(value => Math.round(value * 255)).join(' ') + ' / ' + brightness.toFixed(3) + ')',
  };
}

function buildAtlas(space, entities, eyeQ, resolution) {
  const dimension = space.dimension;
  const pairs = [];
  for (let first = 0; first < dimension - 1; first++) {
    for (let second = first + 1; second < dimension; second++) {
      const ranges = [axisRange(entities, eyeQ, first), axisRange(entities, eyeQ, second)];
      const cells = [];
      for (let row = 0; row < resolution; row++) {
        for (let column = 0; column < resolution; column++) {
          const point = eyeQ.slice();
          point[first] = ranges[0][0] + (ranges[0][1] - ranges[0][0]) * (column + 0.5) / resolution;
          point[second] = ranges[1][0] + (ranges[1][1] - ranges[1][0]) * (row + 0.5) / resolution;
          const sample = sampleField(point, entities);
          cells.push({ row, column, value: sample.value, brightness: sample.brightness, rgb: sample.rgb });
        }
      }
      pairs.push({
        id: 'x' + (first + 1) + '-x' + (second + 1),
        axes: [first, second],
        labels: ['x' + (first + 1), 'x' + (second + 1)],
        ranges,
        resolution,
        cells,
      });
    }
  }
  return pairs;
}

function layoutEntities(entities, mode) {
  const layout = FIELD_LAYOUTS.includes(mode) ? mode : 'gather';
  const count = Math.max(1, entities.length);
  const result = {};
  entities.forEach((entity, index) => {
    if (layout === 'ring') {
      const angle = index * Math.PI * 2 / count - Math.PI / 2;
      result[entity.id] = { x: Math.cos(angle) * 0.82, y: Math.sin(angle) * 0.82 };
    } else if (layout === 'row') {
      result[entity.id] = { x: count === 1 ? 0 : -0.9 + 1.8 * index / (count - 1), y: 0 };
    } else {
      result[entity.id] = { x: clamp(finite(entity.q[0]) / 2.5, -1, 1), y: clamp(finite(entity.q[1]) / 2.5, -1, 1) };
    }
  });
  return { mode: layout, positions: result };
}

export function inspectAcceptedEvents(envelope, authorityDebug = null) {
  const snapshot = envelope?.snapshot || envelope;
  const entities = Object.values(snapshot?.spaces?.[envelope?.eyes?.[envelope.currentEyeId]?.spaceId || snapshot?.rootSpaceId]?.entities || {});
  return {
    source: authorityDebug?.connected ? 'canonical-readback-plus-phone-local' : 'phone-local',
    branchId: envelope?.branchId || null,
    mode: envelope?.mode || 'local',
    acceptedSequence: Number(snapshot?.acceptedSequence) || 0,
    events: entities.map(entity => ({ id: entity.id, revision: entity.revision, q: [...entity.q], geometry: entity.geometry ? clone(entity.geometry) : null })),
    authorityAcceptedSequence: authorityDebug?.acceptedSequence ?? null,
  };
}

export function buildFieldWorld(envelope, {
  query = '',
  relevanceThreshold = 0.2,
  eyeAxes = null,
  layout = 'gather',
  atlasResolution = 8,
  selectedId = null,
  authorityDebug = null,
  preview = null,
  previews = null,
} = {}) {
  const snapshot = envelope?.snapshot || envelope;
  if (!snapshot?.spaces || typeof snapshot.spaces !== 'object') throw new TypeError('A phone snapshot is required');
  const eyes = envelope?.eyes || {};
  const eye = envelope?.currentEyeId ? eyes[envelope.currentEyeId] : null;
  const spaceId = eye?.spaceId || snapshot.rootSpaceId;
  const space = snapshot.spaces[spaceId];
  if (!space) throw new TypeError('The field-world Eye refers to a missing space');
  const dimension = Number(space.dimension);
  const safeResolution = clamp(Math.trunc(finite(atlasResolution, 8)), 4, MAX_ATLAS_RESOLUTION);
  const eyeQ = Array.from({ length: dimension }, (_, axis) => finite(eye?.q?.[axis]));
  const axes = normalizeAxes(eyeAxes || [0, 1, 2], dimension);
  const queryActive = tokenize(query).length > 0;
  const previewMap = new Map();
  if (Array.isArray(previews)) for (const item of previews) if (item?.entityId) previewMap.set(item.entityId, item);
  if (preview?.entityId) previewMap.set(preview.entityId, preview);
  const entities = Object.values(space.entities || {}).map(entity => {
    const entityPreview = previewMap.get(entity.id) || null;
    const isPreview = Boolean(entityPreview);
    const previewQ = isPreview && Array.isArray(entityPreview.q) && entityPreview.q.length === dimension ? entityPreview.q : entity.q;
    const baseGeometry = normalizeEntityGeometry(entity.geometry, dimension);
    const previewGeometry = isPreview && entityPreview.geometry ? normalizeEntityGeometry(entityPreview.geometry, dimension) : baseGeometry;
    const color = informationColor(entity);
    const relevance = relevanceFor({ ...entity, q: previewQ }, eyeQ, query);
    return {
      id: entity.id,
      name: entity.name,
      q: [...previewQ],
      baseQ: [...entity.q],
      radius: finite(entity.radius, 0.25),
      geometry: previewGeometry,
      baseGeometry,
      revision: Number(entity.revision) || 0,
      preview: isPreview ? { kind: entityPreview.kind, operationId: entityPreview.operationId } : null,
      color,
      ...relevance,
      queryActive,
      awake: relevance.relevance >= clamp(finite(relevanceThreshold, 0.2), 0, 1) || entity.id === selectedId,
      information: {
        materialProfile: entity.materialProfile || null,
        fieldMembership: [...(entity.fieldMembership || [])],
        lineage: [...(entity.lineage || [])],
      },
    };
  });
  const atlas = buildAtlas(space, entities, eyeQ, safeResolution);
  return {
    schema: FIELD_WORLD_SCHEMA,
    worldId: snapshot.worldId,
    spaceId,
    dimension,
    eye: {
      id: eye?.id || null,
      label: eye?.label || 'Phone Eye',
      axes,
      q: eyeQ,
    },
    query: String(query || ''),
    relevanceThreshold: clamp(finite(relevanceThreshold, 0.2), 0, 1),
    entities,
    awakeIds: entities.filter(entity => entity.awake).map(entity => entity.id),
    field: {
      kind: 'analytic-information-mixture',
      materialAuthority: 'phone-local-view-only',
      formula: 'bounded Gaussian information mixture; not a physics solver',
    },
    atlas,
    layout: layoutEntities(entities.filter(entity => entity.awake), layout),
    viewRotation: preview?.kind === 'rotate-view' ? finite(preview?.rotation) : 0,
    preview: preview ? {
      kind: preview.kind,
      entityId: preview.entityId,
      operationId: preview.operationId,
      baseRevision: preview.baseRevision,
      delta: [...preview.delta],
      intentDelta: [...(preview.intentDelta || preview.delta)],
      geometry: preview.geometry ? clone(preview.geometry) : null,
      geometryIntent: preview.geometryIntent ? clone(preview.geometryIntent) : null,
    } : null,
    previews: [...previewMap.values()].map(item => ({
      kind: item.kind, entityId: item.entityId, operationId: item.operationId,
      baseRevision: item.baseRevision, delta: [...item.delta], intentDelta: [...(item.intentDelta || item.delta)],
      geometry: item.geometry ? clone(item.geometry) : null, geometryIntent: item.geometryIntent ? clone(item.geometryIntent) : null,
    })),
    accepted: inspectAcceptedEvents(envelope, authorityDebug),
  };
}

export class FieldWorldController {
  constructor(envelope = null, options = {}) {
    this.options = { ...options };
    this.envelope = envelope ? clone(envelope) : null;
    this.previewGeneration = 0;
    this.previewIds = new LocalOperationIdFactory('field-preview');
    this.preview = null;
    this.previews = new Map();
    this.discardedPreviewIds = new Set();
    this.model = envelope ? buildFieldWorld(envelope, { ...options, preview: this.preview }) : null;
  }
  _selectedPreview() {
    const selectedId = this.options?.selectedId;
    return selectedId ? this.previews.get(selectedId) || null : this.preview;
  }
  _buildModel() {
    this.model = this.envelope ? buildFieldWorld(this.envelope, { ...this.options, preview: this._selectedPreview(), previews: [...this.previews.values()] }) : null;
    return this.model;
  }
  _identity(entity) {
    return {
      worldId: this.model?.worldId || null,
      branchId: this.envelope?.branchId || null,
      eyeId: this.model?.eye?.id || null,
      spaceId: this.model?.spaceId || null,
      entityId: entity?.id || null,
      baseRevision: Number(entity?.revision) || 0,
    };
  }
  _entityAt(envelope, candidate) {
    const eye = envelope?.eyes?.[envelope?.currentEyeId];
    const spaceId = eye?.spaceId;
    const entity = envelope?.snapshot?.spaces?.[spaceId]?.entities?.[candidate?.entityId];
    if (!eye || !spaceId || !entity || envelope.snapshot.worldId !== candidate?.worldId
      || (envelope.branchId || null) !== candidate?.branchId
      || envelope.currentEyeId !== candidate?.eyeId || spaceId !== candidate?.spaceId) return null;
    return { eye, spaceId, entity };
  }
  _newPreview(entity, values) {
    this.previewGeneration++;
    const identity = this._identity(entity);
    const prior = this.previews.get(identity.entityId) && this.previews.get(identity.entityId).worldId === identity.worldId
      && this.previews.get(identity.entityId).branchId === identity.branchId && this.previews.get(identity.entityId).eyeId === identity.eyeId
      && this.previews.get(identity.entityId).spaceId === identity.spaceId ? this.previews.get(identity.entityId) : null;
    const baseQ = Array.isArray(values.baseQ) ? values.baseQ.slice() : [...entity.q];
    const baseGeometry = values.baseGeometry ? clone(values.baseGeometry) : clone(entity.baseGeometry || entity.geometry);
    const geometry = values.geometry ? normalizeEntityGeometry(values.geometry, this.model.dimension) : normalizeEntityGeometry(entity.geometry, this.model.dimension);
    const intent = values.geometryIntent ? clone(values.geometryIntent) : geometryIntent(baseGeometry, geometry);
    const referenceQ = prior?.q || baseQ;
    // Transform previews carry the complete object gesture from the shared
    // interaction fabric. Preserve that full-D intent across a solver rebase;
    // subtracting a prior preview here would turn a release-time candidate
    // into zero movement when the accepted entity already includes the same
    // provisional frame. Legacy move previews still use the prior delta so a
    // newer same-object preview remains an explicit supersession.
    const intentDelta = values.kind === 'transform' && Array.isArray(values.delta)
      ? values.delta.slice()
      : values.q.map((value, index) => Number(value) - Number(referenceQ[index] ?? value));
    const carryRebase = prior?.rebaseAfterApply === true;
    this.preview = {
      ...identity,
      ...values,
      baseQ,
      baseGeometry,
      geometry,
      geometryIntent: intent,
      intentDelta,
      generation: this.previewGeneration,
      operationId: this.previewIds.next('preview'),
      ...(prior ? { parentOperationId: prior.operationId } : {}),
      ...(carryRebase ? { rebaseAfterApply: true } : {}),
    };
    this.previews.set(identity.entityId, this.preview);
    this._buildModel();
    return clone(this.preview);
  }
  rebaseCandidate(candidate, envelope) {
    const target = this._entityAt(envelope, candidate);
    if (!target) return null;
    const rebased = this._rebasePreview(candidate, target.entity);
    if (this._replaceTrackedPreview(candidate, rebased)) {
      this._buildModel();
      return clone(this.previews.get(candidate.entityId));
    }
    return clone(rebased);
  }
  _rebasePreview(candidate, entity) {
    const baseQ = Array.isArray(entity?.q) ? entity.q.slice() : [];
    const relative = Array.isArray(candidate.intentDelta)
      ? candidate.intentDelta.slice()
      : candidate.q.map((value, index) => Number(value) - Number(candidate.baseQ?.[index] ?? value));
    const baseGeometry = normalizeEntityGeometry(entity?.geometry, baseQ.length);
    const intent = candidate.geometryIntent || (candidate.geometry ? geometryIntent(candidate.baseGeometry || baseGeometry, candidate.geometry) : null);
    return {
      ...candidate,
      baseRevision: Number(entity?.revision),
      baseQ,
      q: baseQ.map((value, index) => clamp(value + Number(relative[index] || 0), -1e6, 1e6)),
      delta: relative,
      baseGeometry,
      geometry: intent ? applyGeometryIntent(baseGeometry, intent, baseQ.length) : baseGeometry,
      ...(intent ? { geometryIntent: intent } : {}),
      rebaseAfterApply: true,
    };
  }
  _replaceTrackedPreview(candidate, nextCandidate) {
    const tracked = candidate?.entityId ? this.previews.get(candidate.entityId) : null;
    if (!tracked || tracked.operationId !== candidate.operationId || tracked.generation !== candidate.generation) return false;
    this.previews.set(candidate.entityId, nextCandidate);
    if (this.preview?.entityId === candidate.entityId
      && this.preview.operationId === candidate.operationId
      && this.preview.generation === candidate.generation) this.preview = nextCandidate;
    return true;
  }
  refresh(envelope, options = {}) {
    const nextEnvelope = clone(envelope);
    const nextEye = nextEnvelope?.eyes?.[nextEnvelope?.currentEyeId];
    const nextSpace = nextEye?.spaceId || nextEnvelope?.snapshot?.rootSpaceId;
    const nextEntities = nextEnvelope?.snapshot?.spaces?.[nextSpace]?.entities || {};
    const sameScope = candidate => Boolean(candidate && nextEnvelope?.snapshot
      && nextEnvelope.snapshot.worldId === candidate.worldId
      && (nextEnvelope.branchId || null) === candidate.branchId
      && nextEnvelope.currentEyeId === candidate.eyeId
      && nextSpace === candidate.spaceId);
    const pendingApplies = Array.isArray(options.pendingApplies) ? options.pendingApplies : [];
    const completedApply = options.completedApply;
    const completedCandidate = completedApply?.candidate || null;
    const candidates = [...this.previews.values()];
    const discardCandidate = candidate => {
      if (candidate?.operationId) {
        this.discardedPreviewIds.add(candidate.operationId);
        while (this.discardedPreviewIds.size > 128) this.discardedPreviewIds.delete(this.discardedPreviewIds.values().next().value);
      }
      if (candidate?.entityId && this.previews.get(candidate.entityId)?.operationId === candidate.operationId) this.previews.delete(candidate.entityId);
    };
    for (const candidate of candidates) {
      const tracked = this.previews.get(candidate.entityId);
      if (!tracked || tracked.operationId !== candidate.operationId) continue;
      const nextEntity = nextEntities[candidate.entityId];
      const scoped = sameScope(candidate);
      const pendingForCandidate = pendingApplies.filter(item => {
        const pendingCandidate = item?.candidate || item;
        return !item?.cancelled && pendingCandidate?.entityId === candidate.entityId && sameScope(pendingCandidate);
      });
      const pendingCurrentTransaction = pendingForCandidate.some(item => {
        const pendingCandidate = item?.candidate || item;
        return pendingCandidate?.operationId === candidate.operationId
          && (item?.phase === 'queued' || item?.phase === 'running');
      });
      const pendingOtherPreview = pendingForCandidate.some(item => {
        const pendingCandidate = item?.candidate || item;
        return pendingCandidate?.operationId !== candidate.operationId;
      });
      const pendingOverlap = pendingCurrentTransaction || pendingOtherPreview;
      let current = tracked;
      let rebased = false;
      if (nextEntity && scoped && completedCandidate?.entityId === candidate.entityId
        && completedCandidate.operationId !== candidate.operationId
        && completedApply?.result?.changed === true
        && Number(nextEntity.revision) >= Number(completedApply.result.revision)) {
        if (completedCandidate.baseRevision === candidate.baseRevision) {
          current = this._rebasePreview(candidate, nextEntity);
          rebased = true;
        } else if (!candidate.rebaseAfterApply) {
          current = { ...candidate, rebaseAfterApply: true };
          rebased = true;
        }
      }
      if (nextEntity && scoped && !rebased && current.rebaseAfterApply
        && Number(nextEntity.revision) > Number(current.baseRevision)) {
        current = this._rebasePreview(current, nextEntity);
        rebased = true;
      }
      if (nextEntity && scoped && !rebased && !pendingOverlap
        && Number(nextEntity.revision) !== Number(current.baseRevision)
        && current.rebaseOnRevision === true) {
        current = this._rebasePreview(current, nextEntity);
        rebased = true;
      }
      if (current !== tracked) {
        this.previews.set(candidate.entityId, current);
        if (this.preview?.entityId === candidate.entityId && this.preview.operationId === candidate.operationId) this.preview = current;
      }
      const invalid = !nextEnvelope?.snapshot || !scoped || !nextEntity
        || Number(nextEntity?.revision) !== Number(current.baseRevision);
      if (invalid && !pendingOverlap && !rebased) discardCandidate(current);
    }
    this.envelope = nextEnvelope;
    this.options = { ...this.options, ...options };
    if (!this.preview || !this.previews.has(this.preview.entityId)
      || this.previews.get(this.preview.entityId)?.operationId !== this.preview.operationId) {
      this.preview = [...this.previews.values()].at(-1) || null;
    }
    return clone(this._buildModel());
  }
  setOptions(options = {}) {
    this.options = { ...this.options, ...options };
    if (!this.envelope) return null;
    return this.refresh(this.envelope);
  }
  entity(entityId) {
    return this.model?.entities.find(item => item.id === entityId) || null;
  }
  previewFor(entityId) {
    return entityId ? clone(this.previews.get(entityId) || null) : null;
  }
  previewMove(entityId, axis, delta, { rebaseOnRevision = false } = {}) {
    const entity = this.entity(entityId);
    if (!entity || !Number.isInteger(axis) || axis < 0 || axis >= this.model.dimension || !Number.isFinite(delta) || Math.abs(delta) > 5) throw new RangeError('Invalid field-world move preview');
    const baseQ = [...(entity.baseQ || entity.q)];
    const q = [...entity.q];
    q[axis] = clamp(q[axis] + delta, -1e6, 1e6);
    return this._newPreview(entity, { kind: 'move', baseQ, q, delta: q.map((value, index) => value - baseQ[index]), geometry: entity.geometry, rotation: 0, mixWith: null, ...(rebaseOnRevision ? { rebaseOnRevision: true } : {}) });
  }
  previewRotate(entityId, radians) {
    const entity = this.entity(entityId);
    if (!entity || !Number.isFinite(radians) || Math.abs(radians) > Math.PI * 4) throw new RangeError('Invalid field-world rotation preview');
    return this._newPreview(entity, { kind: 'rotate-view', baseQ: [...(entity.baseQ || entity.q)], q: [...entity.q], delta: Array(this.model.dimension).fill(0), geometry: entity.geometry, rotation: radians, mixWith: null });
  }
  previewTransform(entityId, { translation = null, scale = 1, rotation = 0, axes = null } = {}) {
    const entity = this.entity(entityId);
    if (!entity || !Array.isArray(translation) || translation.length !== this.model.dimension || translation.some(value => !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 5)) {
      throw new RangeError('Invalid field-world transform preview');
    }
    if (!Number.isFinite(Number(scale)) || Number(scale) < 0.05 || Number(scale) > 20 || !Number.isFinite(Number(rotation)) || Math.abs(Number(rotation)) > Math.PI * 32) {
      throw new RangeError('Invalid field-world geometric transform preview');
    }
    const baseQ = [...(entity.baseQ || entity.q)];
    const delta = translation.map(Number);
    const q = baseQ.map((value, index) => clamp(value + delta[index], -1e6, 1e6));
    const geometryIntent = { scale: Number(scale), rotation: wrapAngle(rotation), axes: axes || entity.baseGeometry?.axes || entity.geometry?.axes };
    const baseGeometry = clone(entity.baseGeometry || entity.geometry);
    const geometry = applyGeometryIntent(baseGeometry, geometryIntent, this.model.dimension);
    return this._newPreview(entity, {
      kind: 'transform', baseQ, q, delta, geometry, baseGeometry, geometryIntent,
      rebaseOnRevision: true,
      rotation: 0, mixWith: null,
    });
  }
  previewMix(entityId, { rebaseOnRevision = false } = {}) {
    const entity = this.entity(entityId);
    if (!entity) throw new TypeError('Unknown field-world object');
    const candidates = this.model.entities.filter(item => item.id !== entityId);
    const nearest = candidates.sort((a, b) => distance(a.q, entity.q) - distance(b.q, entity.q))[0];
    if (!nearest) throw new TypeError('No neighboring field object to mix');
    const q = entity.q.map((value, index) => (value + nearest.q[index]) / 2);
    const baseQ = [...(entity.baseQ || entity.q)];
    return this._newPreview(entity, { kind: 'mix', baseQ, q, delta: q.map((value, index) => value - baseQ[index]), geometry: entity.geometry, rotation: 0, mixWith: nearest.id, ...(rebaseOnRevision ? { rebaseOnRevision: true } : {}) });
  }
  discardPreview({ mark = true, entityId = null } = {}) {
    const target = entityId ? this.previews.get(entityId) : (this._selectedPreview() || this.preview);
    if (mark && target?.operationId) {
      this.discardedPreviewIds.add(target.operationId);
      if (this.discardedPreviewIds.size > 128) this.discardedPreviewIds.delete(this.discardedPreviewIds.values().next().value);
    }
    if (target?.entityId) this.previews.delete(target.entityId);
    this.previewGeneration++;
    this.preview = [...this.previews.values()].at(-1) || null;
    this._buildModel();
    return null;
  }
  clearAppliedPreview(candidate) {
    if (!candidate || this.previews.get(candidate.entityId)?.operationId !== candidate.operationId) return false;
    this.previews.delete(candidate.entityId);
    this.previewGeneration++;
    this.preview = [...this.previews.values()].at(-1) || null;
    this._buildModel();
    return true;
  }
  discardPreviewsExcept(entityIds = []) {
    const keep = new Set(entityIds);
    const discarded = [];
    for (const [entityId, candidate] of this.previews) {
      if (keep.has(entityId)) continue;
      if (candidate?.operationId) this.discardedPreviewIds.add(candidate.operationId);
      discarded.push(entityId);
      this.previews.delete(entityId);
    }
    while (this.discardedPreviewIds.size > 128) this.discardedPreviewIds.delete(this.discardedPreviewIds.values().next().value);
    if (discarded.length) {
      this.previewGeneration++;
      this.preview = [...this.previews.values()].at(-1) || null;
      this._buildModel();
    }
    return discarded;
  }
  isDiscarded(candidate) {
    return Boolean(candidate?.operationId && this.discardedPreviewIds.has(candidate.operationId));
  }
  isCurrent(candidate) {
    const tracked = candidate?.entityId ? this.previews.get(candidate.entityId) : null;
    return Boolean(candidate && tracked && candidate.operationId === tracked.operationId && candidate.generation === tracked.generation && candidate.entityId === tracked.entityId);
  }
  commitCandidate() {
    const candidate = this._selectedPreview();
    return candidate ? clone(candidate) : null;
  }
}

export function drawFieldAtlas(canvas, model) {
  const context = canvas?.getContext?.('2d');
  if (!context || !model?.atlas?.length) return false;
  const width = canvas.width || 320, height = canvas.height || 180;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#07121d';
  context.fillRect(0, 0, width, height);
  const selectedAxes = model.eye?.axes?.slice(0, 2) || [];
  const score = plane => selectedAxes.length === 2 && plane.axes.includes(selectedAxes[0]) && plane.axes.includes(selectedAxes[1]) ? 0 : 1;
  const planes = [...model.atlas].sort((a, b) => score(a) - score(b));
  const columns = Math.max(1, Math.ceil(Math.sqrt(planes.length)));
  const rows = Math.ceil(planes.length / columns);
  const tileWidth = width / columns, tileHeight = height / rows;
  context.save?.();
  if (model.viewRotation) {
    context.translate(width / 2, height / 2);
    context.rotate(model.viewRotation);
    context.translate(-width / 2, -height / 2);
  }
  planes.forEach((plane, index) => {
    const x0 = (index % columns) * tileWidth, y0 = Math.floor(index / columns) * tileHeight;
    const cellWidth = tileWidth / plane.resolution, cellHeight = tileHeight / plane.resolution;
    plane.cells.forEach(cell => {
      context.fillStyle = 'rgb(' + cell.rgb.map(value => Math.round(value * 255)).join(' ') + ')';
      context.globalAlpha = clamp(cell.brightness + 0.12, 0.12, 1);
      context.fillRect(x0 + cell.column * cellWidth, y0 + cell.row * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
    });
    context.globalAlpha = 1;
    context.fillStyle = '#d8e8f7';
    context.font = '600 10px ui-monospace, monospace';
    context.fillText(plane.labels.join(' · '), x0 + 6, y0 + 13);
    context.strokeStyle = score(plane) === 0 ? '#7fb4ff' : 'rgba(142, 181, 220, .32)';
    context.lineWidth = score(plane) === 0 ? 2 : 1;
    context.strokeRect(x0 + 1, y0 + 1, tileWidth - 2, tileHeight - 2);
    for (const entity of model.entities.filter(item => item.awake)) {
      const xRange = plane.ranges[0], yRange = plane.ranges[1];
      const x = x0 + clamp((entity.q[plane.axes[0]] - xRange[0]) / Math.max(1e-9, xRange[1] - xRange[0]), 0, 1) * tileWidth;
      const y = y0 + (1 - clamp((entity.q[plane.axes[1]] - yRange[0]) / Math.max(1e-9, yRange[1] - yRange[0]), 0, 1)) * tileHeight;
      const selected = entity.id === model.preview?.entityId;
      const scale = Math.max(0.05, finite(entity.geometry?.scale, 1));
      const radius = (selected ? 5 : 3) * Math.min(2.4, Math.max(0.55, scale));
      const samePlane = entity.geometry?.axes?.[0] === plane.axes[0] && entity.geometry?.axes?.[1] === plane.axes[1];
      context.fillStyle = entity.color.css; context.globalAlpha = selected ? 1 : 0.8;
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
      if (selected) {
        context.strokeStyle = '#fff0bd'; context.lineWidth = 1.5; context.beginPath();
        const angle = samePlane ? -finite(entity.geometry?.rotation) : 0;
        context.moveTo(x - Math.cos(angle) * radius * 1.8, y - Math.sin(angle) * radius * 1.8);
        context.lineTo(x + Math.cos(angle) * radius * 1.8, y + Math.sin(angle) * radius * 1.8); context.stroke();
      }
    }
  });
  context.restore?.();
  const mapSize = Math.min(72, Math.max(48, height * 0.34));
  context.fillStyle = 'rgba(4, 15, 26, .9)'; context.fillRect(4, 4, mapSize, mapSize);
  context.strokeStyle = '#6f9ccc'; context.lineWidth = 1; context.strokeRect(4, 4, mapSize, mapSize);
  context.fillStyle = '#d8e8f7'; context.font = '600 9px ui-monospace, monospace'; context.fillText(String(model.layout?.mode || 'gather').toUpperCase(), 8, 15);
  for (const entity of model.entities.filter(item => item.awake)) {
    const position = model.layout?.positions?.[entity.id]; if (!position) continue;
    const x = 4 + mapSize / 2 + clamp(position.x, -1, 1) * (mapSize - 12) / 2;
    const y = 4 + mapSize / 2 + clamp(position.y, -1, 1) * (mapSize - 18) / 2;
    const selected = entity.id === model.preview?.entityId;
    const radius = (selected ? 4 : 2.5) * Math.min(2.4, Math.max(0.55, finite(entity.geometry?.scale, 1)));
    context.fillStyle = entity.color.css; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
    if (selected) { context.strokeStyle = '#fff0bd'; context.lineWidth = 1.2; context.beginPath(); const angle = -finite(entity.geometry?.rotation); context.moveTo(x - Math.cos(angle) * radius * 1.8, y - Math.sin(angle) * radius * 1.8); context.lineTo(x + Math.cos(angle) * radius * 1.8, y + Math.sin(angle) * radius * 1.8); context.stroke(); }
  }
  return true;
}
