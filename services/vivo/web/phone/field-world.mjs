/**
 * Phone-local field-world projection.
 *
 * This is an analytic information view over the detached local phone
 * envelope.  It never allocates a dense D-dimensional grid and never writes
 * canonical authority state.  Atlas cells are bounded samples of coordinate
 * planes; an awake object is a view decision, not a change to the envelope.
 */
import { LocalOperationIdFactory } from './local-operation.mjs';

export const FIELD_WORLD_SCHEMA = 'vivo.phone.field-world/1';
export const FIELD_LAYOUTS = Object.freeze(['ring', 'row', 'gather']);
export const MAX_ATLAS_RESOLUTION = 12;

const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - (b[index] || 0)));
const tokenize = value => String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function informationColor(entity) {
  const seed = hashText([
    entity.id, entity.name, entity.materialProfile,
    ...(entity.fieldMembership || []), ...(entity.lineage || []),
  ].join('|'));
  const hue = seed % 360;
  const saturation = 62 + (seed % 18);
  const lightness = 48 + ((seed >>> 8) % 14);
  return {
    hue,
    saturation,
    lightness,
    css: 'hsl(' + hue + ' ' + saturation + '% ' + lightness + '%)',
    rgb: [
      0.5 + 0.5 * Math.cos(hue * Math.PI / 180),
      0.5 + 0.5 * Math.cos((hue + 120) * Math.PI / 180),
      0.5 + 0.5 * Math.cos((hue + 240) * Math.PI / 180),
    ],
  };
}

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
  const scale = Math.max(width, radius * 2.5);
  return Math.exp(-Math.pow(distance(point, entity.q) / scale, 2));
}

function sampleField(point, entities) {
  let total = 0;
  const mix = [0, 0, 0];
  for (const entity of entities) {
    const weight = gaussian(point, entity);
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
    events: entities.map(entity => ({ id: entity.id, revision: entity.revision, q: [...entity.q] })),
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
  const entities = Object.values(space.entities || {}).map(entity => {
    const previewQ = preview?.entityId === entity.id && Array.isArray(preview.q) && preview.q.length === dimension ? preview.q : entity.q;
    const color = informationColor(entity);
    const relevance = relevanceFor({ ...entity, q: previewQ }, eyeQ, query);
    return {
      id: entity.id,
      name: entity.name,
      q: [...previewQ],
      baseQ: [...entity.q],
      radius: finite(entity.radius, 0.25),
      revision: Number(entity.revision) || 0,
      preview: preview?.entityId === entity.id ? { kind: preview.kind, operationId: preview.operationId } : null,
      color,
      ...relevance,
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
    viewRotation: finite(preview?.rotation),
    preview: preview ? { kind: preview.kind, entityId: preview.entityId, operationId: preview.operationId } : null,
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
    this.model = envelope ? buildFieldWorld(envelope, { ...options, preview: this.preview }) : null;
  }
  _buildModel() {
    this.model = this.envelope ? buildFieldWorld(this.envelope, { ...this.options, preview: this.preview }) : null;
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
  _newPreview(entity, values) {
    this.previewGeneration++;
    const identity = this._identity(entity);
    this.preview = {
      ...identity,
      ...values,
      generation: this.previewGeneration,
      operationId: this.previewIds.next('preview'),
    };
    this._buildModel();
    return clone(this.preview);
  }
  refresh(envelope, options = {}) {
    const nextEnvelope = clone(envelope);
    const nextEye = nextEnvelope?.eyes?.[nextEnvelope?.currentEyeId];
    const nextSpace = nextEye?.spaceId || nextEnvelope?.snapshot?.rootSpaceId;
    const nextEntity = nextEnvelope?.snapshot?.spaces?.[nextSpace]?.entities?.[this.preview?.entityId];
    if (this.preview && (!nextEnvelope?.snapshot || nextEnvelope.snapshot.worldId !== this.preview.worldId || (nextEnvelope.branchId || null) !== this.preview.branchId || nextEnvelope.currentEyeId !== this.preview.eyeId || nextSpace !== this.preview.spaceId || !nextEntity || Number(nextEntity.revision) !== this.preview.baseRevision)) this.discardPreview();
    this.envelope = nextEnvelope;
    this.options = { ...this.options, ...options };
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
  previewMove(entityId, axis, delta) {
    const entity = this.entity(entityId);
    if (!entity || !Number.isInteger(axis) || axis < 0 || axis >= this.model.dimension || !Number.isFinite(delta) || Math.abs(delta) > 5) throw new RangeError('Invalid field-world move preview');
    const baseQ = [...(entity.baseQ || entity.q)];
    const q = [...entity.q];
    q[axis] = clamp(q[axis] + delta, -1e6, 1e6);
    return this._newPreview(entity, { kind: 'move', baseQ, q, delta: q.map((value, index) => value - baseQ[index]), rotation: 0, mixWith: null });
  }
  previewRotate(entityId, radians) {
    const entity = this.entity(entityId);
    if (!entity || !Number.isFinite(radians) || Math.abs(radians) > Math.PI * 4) throw new RangeError('Invalid field-world rotation preview');
    return this._newPreview(entity, { kind: 'rotate-view', baseQ: [...(entity.baseQ || entity.q)], q: [...entity.q], delta: Array(this.model.dimension).fill(0), rotation: radians, mixWith: null });
  }
  previewMix(entityId) {
    const entity = this.entity(entityId);
    if (!entity) throw new TypeError('Unknown field-world object');
    const candidates = this.model.entities.filter(item => item.id !== entityId);
    const nearest = candidates.sort((a, b) => distance(a.q, entity.q) - distance(b.q, entity.q))[0];
    if (!nearest) throw new TypeError('No neighboring field object to mix');
    const q = entity.q.map((value, index) => (value + nearest.q[index]) / 2);
    const baseQ = [...(entity.baseQ || entity.q)];
    return this._newPreview(entity, { kind: 'mix', baseQ, q, delta: q.map((value, index) => value - baseQ[index]), rotation: 0, mixWith: nearest.id });
  }
  discardPreview() {
    this.previewGeneration++;
    this.preview = null;
    this._buildModel();
    return null;
  }
  isCurrent(candidate) {
    return Boolean(candidate && this.preview && candidate.operationId === this.preview.operationId && candidate.generation === this.previewGeneration && candidate.entityId === this.preview.entityId);
  }
  commitCandidate() {
    return this.preview ? clone(this.preview) : null;
  }
}

export function drawFieldAtlas(canvas, model) {
  const context = canvas?.getContext?.('2d');
  if (!context || !model?.atlas?.length) return false;
  const width = canvas.width || 320, height = canvas.height || 180;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#061117';
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
    context.fillStyle = '#d9f6ff';
    context.font = '10px ui-monospace, monospace';
    context.fillText(plane.labels.join(' / '), x0 + 4, y0 + 12);
    if (score(plane) === 0) { context.strokeStyle = '#f4d38a'; context.lineWidth = 2; context.strokeRect(x0 + 1, y0 + 1, tileWidth - 2, tileHeight - 2); }
    for (const entity of model.entities.filter(item => item.awake)) {
      const xRange = plane.ranges[0], yRange = plane.ranges[1];
      const x = x0 + clamp((entity.q[plane.axes[0]] - xRange[0]) / Math.max(1e-9, xRange[1] - xRange[0]), 0, 1) * tileWidth;
      const y = y0 + (1 - clamp((entity.q[plane.axes[1]] - yRange[0]) / Math.max(1e-9, yRange[1] - yRange[0]), 0, 1)) * tileHeight;
      context.fillStyle = entity.color.css; context.globalAlpha = entity.id === model.preview?.entityId ? 1 : 0.8;
      context.beginPath(); context.arc(x, y, entity.id === model.preview?.entityId ? 4 : 2.5, 0, Math.PI * 2); context.fill();
    }
  });
  context.restore?.();
  const mapSize = Math.min(58, Math.max(36, height * 0.32));
  context.fillStyle = 'rgba(3, 12, 18, .86)'; context.fillRect(4, 4, mapSize, mapSize);
  context.strokeStyle = '#8eb9b2'; context.lineWidth = 1; context.strokeRect(4, 4, mapSize, mapSize);
  context.fillStyle = '#d9f6ff'; context.font = '9px ui-monospace, monospace'; context.fillText(String(model.layout?.mode || 'gather').toUpperCase(), 8, 14);
  for (const entity of model.entities.filter(item => item.awake)) {
    const position = model.layout?.positions?.[entity.id]; if (!position) continue;
    const x = 4 + mapSize / 2 + clamp(position.x, -1, 1) * (mapSize - 12) / 2;
    const y = 4 + mapSize / 2 + clamp(position.y, -1, 1) * (mapSize - 18) / 2;
    context.fillStyle = entity.color.css; context.beginPath(); context.arc(x, y, entity.id === model.preview?.entityId ? 4 : 2.5, 0, Math.PI * 2); context.fill();
  }
  return true;
}
