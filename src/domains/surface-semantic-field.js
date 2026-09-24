/**
 * Surface Semantic Field (SSF) core.
 * Pure, deterministic geometry/content rules. No DOM or Three.js dependency.
 * The rendered object's own skin is the information medium.
 */

export const SSF_VERSION = 1;
export const SSF_SHAPES = Object.freeze(['sphere','cylinder','capsule','torus','cube','irregular','open','disconnected']);

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const round6 = v => Math.round(v * 1e6) / 1e6;

export function stableHash(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function hashUnit(value) {
  return stableHash(value) / 0xffffffff;
}

function normalizeRect(rect) {
  const x = clamp(Number(rect?.x ?? 0));
  const y = clamp(Number(rect?.y ?? 0));
  const w = clamp(Number(rect?.w ?? 1), 0.001, 1 - x);
  const h = clamp(Number(rect?.h ?? 1), 0.001, 1 - y);
  return { x: round6(x), y: round6(y), w: round6(w), h: round6(h) };
}

function safeBandForShape(shape) {
  switch (shape) {
    case 'sphere': return { x: 0.08, y: 0.17, w: 0.84, h: 0.66 };
    case 'cylinder':
    case 'capsule': return { x: 0.05, y: 0.11, w: 0.90, h: 0.78 };
    case 'torus': return { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
    case 'open': return { x: 0.07, y: 0.09, w: 0.86, h: 0.82 };
    default: return { x: 0.04, y: 0.04, w: 0.92, h: 0.92 };
  }
}

function bestGrid(count, aspect = 1.4) {
  let best = { cols: count, rows: 1, error: Infinity };
  for (let rows = 1; rows <= Math.ceil(Math.sqrt(count)) + 2; rows++) {
    const cols = Math.ceil(count / rows);
    const ratio = cols / rows;
    const error = Math.abs(Math.log((ratio || 1) / aspect)) + (cols * rows - count) * 0.08;
    if (error < best.error) best = { cols, rows, error };
  }
  return best;
}

function regionFromContent(content, index, rect, surfaceSlot = 0) {
  const id = String(content?.id ?? `region-${index + 1}`);
  return Object.freeze({
    id,
    label: String(content?.label ?? content?.title ?? `Region ${index + 1}`),
    value: content?.value ?? content?.text ?? '',
    action: content?.action ?? 'inspect',
    priority: clamp(Number(content?.priority ?? 0.5)),
    kind: content?.kind ?? 'data',
    state: content?.state ?? 'idle',
    rect: Object.freeze(normalizeRect(rect)),
    surfaceSlot,
    interactive: content?.interactive !== false,
    provenance: Object.freeze([...(content?.provenance ?? [])]),
  });
}

/**
 * Deterministic fallback partitioning. Authored regions win. For cubes, six
 * material slots can receive distinct walls. For hostile meshes the same
 * normalized semantic chart can be projected by the renderer.
 */
export function createSemanticRegions({ shape = 'irregular', content = [], authored = null, surfaceSlots = 1 } = {}) {
  const resolvedShape = SSF_SHAPES.includes(shape) ? shape : 'irregular';
  const slots = Math.max(1, Math.floor(surfaceSlots));
  if (Array.isArray(authored) && authored.length) {
    return authored.map((r, i) => Object.freeze({
      ...regionFromContent({ ...content[i], ...r }, i, r.rect ?? r, clamp(Math.floor(r.surfaceSlot ?? 0), 0, slots - 1)),
      rect: Object.freeze(normalizeRect(r.rect ?? r)),
    }));
  }

  const items = content.length ? content : [
    { id: 'identity', label: 'IDENTITY', value: 'semantic skin', priority: 1 },
    { id: 'state', label: 'STATE', value: 'ready', priority: 0.9 },
    { id: 'signal', label: 'SIGNAL', value: 'surface-native', priority: 0.8 },
  ];

  if (resolvedShape === 'cube' && slots >= 2) {
    return items.map((item, i) => regionFromContent(item, i, { x: 0.08, y: 0.1, w: 0.84, h: 0.8 }, i % Math.min(6, slots)));
  }

  const band = safeBandForShape(resolvedShape);
  const { cols, rows } = bestGrid(items.length, resolvedShape === 'cylinder' || resolvedShape === 'capsule' ? 1.2 : 1.45);
  const gutter = 0.018;
  const cellW = band.w / cols;
  const cellH = band.h / rows;
  return items.map((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const rect = {
      x: band.x + col * cellW + gutter,
      y: band.y + row * cellH + gutter,
      w: Math.max(0.02, cellW - gutter * 2),
      h: Math.max(0.02, cellH - gutter * 2),
    };
    return regionFromContent(item, i, rect, 0);
  });
}

export function resolveRegionAtUv(regions, uv, surfaceSlot = 0) {
  if (!uv || !Number.isFinite(uv.x) || !Number.isFinite(uv.y)) return null;
  const u = uv.x - Math.floor(uv.x);
  const v = uv.y - Math.floor(uv.y);
  let best = null;
  for (const region of regions ?? []) {
    if ((region.surfaceSlot ?? 0) !== surfaceSlot) continue;
    const r = region.rect;
    if (u < r.x || u > r.x + r.w || v < r.y || v > r.y + r.h) continue;
    if (!best || (region.priority ?? 0) > (best.priority ?? 0)) best = region;
  }
  return best;
}

/** Surface-region fitness used by automatic placement/search. */
export function scoreSurfaceRegion({
  area = 0.5,
  curvature = 0.25,
  viewCosine = 1,
  occlusion = 0,
  salience = 0.5,
  distance = 4,
  priority = 0.5,
  interaction = 0,
  interior = false,
} = {}) {
  const areaScore = clamp(area);
  const flatness = 1 - clamp(curvature);
  const facing = clamp((viewCosine + 0.15) / 1.15);
  const visible = 1 - clamp(occlusion);
  const distanceScore = 1 / (1 + Math.max(0, distance - 1) * 0.14);
  const interiorPenalty = interior ? 0.78 : 1;
  return round6(clamp((
    areaScore * 0.22 +
    flatness * 0.17 +
    facing * 0.22 +
    visible * 0.15 +
    clamp(salience) * 0.08 +
    clamp(priority) * 0.10 +
    clamp(interaction) * 0.06
  ) * distanceScore * interiorPenalty));
}

/**
 * Semantic LOD. Level 0 = pulse only; 1 = symbol/value; 2 = label+value;
 * 3 = full region text/actions.
 */
export function semanticLod({ projectedPixels = 0, viewCosine = 1, focused = false, priority = 0.5, budget = 1 } = {}) {
  const px = Math.max(0, projectedPixels);
  const facing = clamp((viewCosine + 0.1) / 1.1);
  const score = px * facing * (0.7 + clamp(priority) * 0.6) * clamp(budget, 0.15, 1.5) * (focused ? 1.35 : 1);
  if (score < 34) return 0;
  if (score < 90) return 1;
  if (score < 190) return 2;
  return 3;
}

export function barycentricCoordinates(point, a, b, c) {
  const v0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const v2 = [point[0] - a[0], point[1] - a[1], point[2] - a[2]];
  const d00 = v0[0] * v0[0] + v0[1] * v0[1] + v0[2] * v0[2];
  const d01 = v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2];
  const d11 = v1[0] * v1[0] + v1[1] * v1[1] + v1[2] * v1[2];
  const d20 = v2[0] * v0[0] + v2[1] * v0[1] + v2[2] * v0[2];
  const d21 = v2[0] * v1[0] + v2[1] * v1[1] + v2[2] * v1[2];
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) return [1, 0, 0];
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  return [1 - v - w, v, w];
}

export function interpolateUv(bary, uvA, uvB, uvC) {
  return {
    x: bary[0] * uvA[0] + bary[1] * uvB[0] + bary[2] * uvC[0],
    y: bary[0] * uvA[1] + bary[1] * uvB[1] + bary[2] * uvC[1],
  };
}

/** Global fallback chart for a mesh that has no UVs. */
export function generatePlanarUv(positions) {
  if (!positions || positions.length < 9 || positions.length % 3 !== 0) throw Error('positions must be xyz triples');
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const ranges = [maxX - minX, maxY - minY, maxZ - minZ];
  // Drop the smallest extent so the two broadest object axes become the chart.
  const drop = ranges.indexOf(Math.min(...ranges));
  const axes = drop === 0 ? [1, 2] : drop === 1 ? [0, 2] : [0, 1];
  const mins = [minX, minY, minZ], maxs = [maxX, maxY, maxZ];
  const result = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    const vals = [positions[i], positions[i + 1], positions[i + 2]];
    const du = Math.max(1e-9, maxs[axes[0]] - mins[axes[0]]);
    const dv = Math.max(1e-9, maxs[axes[1]] - mins[axes[1]]);
    result[j] = clamp((vals[axes[0]] - mins[axes[0]]) / du);
    result[j + 1] = clamp((vals[axes[1]] - mins[axes[1]]) / dv);
  }
  return { uv: result, projectionAxes: axes, fallback: 'global-planar-chart' };
}

export function contactStrength({ distance, radiusA = 1, radiusB = 1, range = 1.2 } = {}) {
  const surfaceDistance = Math.max(0, Number(distance) - Math.max(0, radiusA) - Math.max(0, radiusB));
  return round6(clamp(1 - surfaceDistance / Math.max(1e-6, range)));
}

/** Deterministic trait mixing with provenance. */
export function breedTraits(a = {}, b = {}, { seed = 'ssf', bias = 0.5 } = {}) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const traits = {}, provenance = {};
  for (const key of keys) {
    const av = a[key], bv = b[key];
    if (av === undefined) { traits[key] = bv; provenance[key] = ['b']; continue; }
    if (bv === undefined) { traits[key] = av; provenance[key] = ['a']; continue; }
    const t = clamp(bias * 0.7 + hashUnit(`${seed}:${key}`) * 0.3);
    if (typeof av === 'number' && typeof bv === 'number') {
      traits[key] = round6(av * (1 - t) + bv * t);
      provenance[key] = ['a', 'b', `mix:${round6(t)}`];
    } else if (Array.isArray(av) && Array.isArray(bv)) {
      traits[key] = [...new Set([...av, ...bv].map(String))].sort();
      provenance[key] = ['a', 'b', 'union'];
    } else if (av && bv && typeof av === 'object' && typeof bv === 'object') {
      const nested = breedTraits(av, bv, { seed: `${seed}:${key}`, bias: t });
      traits[key] = nested.traits;
      provenance[key] = nested.provenance;
    } else {
      const pickB = hashUnit(`${seed}:${key}:pick`) >= (1 - bias);
      traits[key] = pickB ? bv : av;
      provenance[key] = [pickB ? 'b' : 'a'];
    }
  }
  return Object.freeze({ traits: Object.freeze(traits), provenance: Object.freeze(provenance), seed: String(seed) });
}

export function serializeSemanticSkin({ id, shape, regions, traits = {}, state = {} } = {}) {
  return JSON.stringify({
    schema: 'matumbo.ssf',
    version: SSF_VERSION,
    id: String(id ?? 'surface-object'),
    shape: SSF_SHAPES.includes(shape) ? shape : 'irregular',
    regions: (regions ?? []).map(r => ({ ...r, rect: { ...r.rect }, provenance: [...(r.provenance ?? [])] })),
    traits,
    state,
  });
}

export function parseSemanticSkin(serialized) {
  const value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  if (!value || value.schema !== 'matumbo.ssf') throw Error('Not an SSF payload');
  if (value.version !== SSF_VERSION) throw Error(`Unsupported SSF version ${value.version}`);
  return Object.freeze({
    ...value,
    regions: Object.freeze((value.regions ?? []).map(r => Object.freeze({ ...r, rect: Object.freeze(normalizeRect(r.rect)) }))),
  });
}

export function createSemanticSkin({ id = 'surface-object', shape = 'irregular', content = [], authored = null, surfaceSlots = 1, traits = {} } = {}) {
  const regions = createSemanticRegions({ shape, content, authored, surfaceSlots });
  return Object.freeze({
    schema: 'matumbo.ssf', version: SSF_VERSION, id, shape,
    regions,
    traits: Object.freeze({ ...traits }),
    state: Object.freeze({ focusedRegionId: null, contact: 0, lod: 2 }),
  });
}
