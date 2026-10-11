/**
 * Phone-local field-world projection.
 *
 * This is an analytic information view over the detached local phone
 * envelope.  It never allocates a dense D-dimensional grid and never writes
 * canonical authority state.  Atlas cells are bounded samples of coordinate
 * planes; an awake object is a view decision, not a change to the envelope.
 */
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
    const color = informationColor(entity);
    const relevance = relevanceFor(entity, eyeQ, query);
    return {
      id: entity.id,
      name: entity.name,
      q: [...entity.q],
      radius: finite(entity.radius, 0.25),
      revision: Number(entity.revision) || 0,
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
    accepted: inspectAcceptedEvents(envelope, authorityDebug),
  };
}

export class FieldWorldController {
  constructor(envelope = null, options = {}) {
    this.options = { ...options };
    this.envelope = envelope ? clone(envelope) : null;
    this.model = envelope ? buildFieldWorld(envelope, options) : null;
    this.preview = null;
  }
  refresh(envelope, options = {}) {
    this.envelope = clone(envelope);
    this.options = { ...this.options, ...options };
    this.model = buildFieldWorld(this.envelope, this.options);
    if (this.preview && !this.model.entities.some(entity => entity.id === this.preview.entityId)) this.preview = null;
    return clone(this.model);
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
    const q = [...entity.q];
    q[axis] = clamp(q[axis] + delta, -1e6, 1e6);
    this.preview = { kind: 'move', entityId, baseRevision: entity.revision, baseQ: [...entity.q], q, delta: q.map((value, index) => value - entity.q[index]), rotation: 0, mixWith: null };
    return clone(this.preview);
  }
  previewRotate(entityId, radians) {
    const entity = this.entity(entityId);
    if (!entity || !Number.isFinite(radians) || Math.abs(radians) > Math.PI * 4) throw new RangeError('Invalid field-world rotation preview');
    this.preview = { kind: 'rotate-view', entityId, baseRevision: entity.revision, baseQ: [...entity.q], q: [...entity.q], delta: Array(this.model.dimension).fill(0), rotation: radians, mixWith: null };
    return clone(this.preview);
  }
  previewMix(entityId) {
    const entity = this.entity(entityId);
    if (!entity) throw new TypeError('Unknown field-world object');
    const candidates = this.model.entities.filter(item => item.id !== entityId);
    const nearest = candidates.sort((a, b) => distance(a.q, entity.q) - distance(b.q, entity.q))[0];
    if (!nearest) throw new TypeError('No neighboring field object to mix');
    const q = entity.q.map((value, index) => (value + nearest.q[index]) / 2);
    this.preview = { kind: 'mix', entityId, baseRevision: entity.revision, baseQ: [...entity.q], q, delta: q.map((value, index) => value - entity.q[index]), rotation: 0, mixWith: nearest.id };
    return clone(this.preview);
  }
  discardPreview() {
    this.preview = null;
    return null;
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
  const columns = Math.max(1, Math.ceil(Math.sqrt(model.atlas.length)));
  const rows = Math.ceil(model.atlas.length / columns);
  const tileWidth = width / columns, tileHeight = height / rows;
  model.atlas.forEach((plane, index) => {
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
  });
  return true;
}
