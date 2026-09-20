/** glass-style.js — Packet 233 "one block system": the canonical glass-block
 * visual language shared by every 3-D scene.
 *
 * Recipe (matches reality-assembly-scene.js):
 *   - translucent blue glass: MeshStandardMaterial, color ~#153954,
 *     transparent, opacity ~0.5, depthWrite false, roughness ~0.15,
 *     metalness ~0.1
 *   - glowing edge lines: EdgesGeometry + LineBasicMaterial, opacity ~0.8
 *   - connection lines between cubes: #36a6d3, opacity ~0.34
 *   - bounded deterministic starfield: Points, ~360 pts, golden-angle spiral
 *   - hemisphere + directional lighting
 *
 * Builder functions take THREE as a parameter (like the other scene modules).
 * The pure parts (RNG, starfield math, material param objects, color mixing)
 * never touch THREE or the DOM, so they stay Node-importable for unit tests.
 */

export const GLASS_BASE_HEX = "#153954";
export const GLASS_OPACITY = 0.5;
export const GLASS_ROUGHNESS = 0.15;
export const GLASS_METALNESS = 0.1;
export const GLASS_EDGE_COLOR = "#7fd4ff";
export const GLASS_EDGE_OPACITY = 0.8;
export const CONNECTION_LINE_COLOR = "#36a6d3";
export const CONNECTION_LINE_OPACITY = 0.34;
export const STARFIELD_COUNT = 360;
export const STARFIELD_COLOR = "#92adc7";
export const STARFIELD_SIZE = 0.06;
export const STARFIELD_OPACITY = 0.7;
export const STARFIELD_RADIUS_BASE = 52;

/** FNV-1a string hash → unsigned 32-bit. Pure. */
export function hashString(value) {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic seeded PRNG (mulberry-style). Same seed → same stream. */
export function traitRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const value = String(hex ?? "").replace("#", "");
  const padded = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const int = parseInt(padded, 16);
  if (!Number.isFinite(int)) return { r: 0, g: 0, b: 0 };
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbToHex({ r, g, b }) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const int = (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
  return `#${int.toString(16).padStart(6, "0")}`;
}

/** Blend two hex colors. amount 0 → a, 1 → b. Pure. */
export function mixGlassTint(a, b, amount = 0.5) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const t = Math.max(0, Math.min(1, Number(amount) || 0));
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

/** Tint the canonical glass base toward a semantic accent while keeping the
 * blue-glass identity (Packet 233 design law: one cube style everywhere). */
export function glassTintFor(accentHex, amount = 0.45) {
  return mixGlassTint(GLASS_BASE_HEX, accentHex, amount);
}

/** Plain param object for the canonical glass cube material. Pure — no THREE. */
export function glassCubeMaterialParams(tint = GLASS_BASE_HEX, overrides = {}) {
  return {
    color: tint,
    metalness: GLASS_METALNESS,
    roughness: GLASS_ROUGHNESS,
    transparent: true,
    opacity: GLASS_OPACITY,
    depthWrite: false,
    ...(overrides || {}),
  };
}

/** Plain param object for the glowing edge-line frame. Pure — no THREE. */
export function glassEdgeMaterialParams(overrides = {}) {
  return {
    color: GLASS_EDGE_COLOR,
    transparent: true,
    opacity: GLASS_EDGE_OPACITY,
    depthWrite: false,
    ...(overrides || {}),
  };
}

/** Plain param object for cube-to-cube connection lines. Pure — no THREE. */
export function connectionLineMaterialParams(overrides = {}) {
  return {
    color: CONNECTION_LINE_COLOR,
    transparent: true,
    opacity: CONNECTION_LINE_OPACITY,
    depthWrite: false,
    ...(overrides || {}),
  };
}

/** Deterministic starfield positions on the golden-angle spiral used by the
 * reality lens. Pure — returns a Float32Array of count*3 xyz triples. */
export function starfieldPositions(count = STARFIELD_COUNT) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  const out = new Float32Array(total * 3);
  for (let i = 0; i < total; i++) {
    const a = i * 2.399963;
    const b = (((i * 37) % 181) / 180) * Math.PI;
    const r = STARFIELD_RADIUS_BASE + (i % 7);
    out[i * 3] = Math.cos(a) * Math.sin(b) * r;
    out[i * 3 + 1] = Math.cos(b) * r;
    out[i * 3 + 2] = Math.sin(a) * Math.sin(b) * r;
  }
  return out;
}

/** Flatten point pairs into a vertex array for LineSegments. Pure. */
export function connectionLineVertices(pointPairs) {
  const pairs = Array.isArray(pointPairs) ? pointPairs : [];
  const out = new Float32Array(pairs.length * 6);
  pairs.forEach((pair, index) => {
    const [a, b] = pair ?? [];
    out[index * 6] = Number(a?.x ?? 0);
    out[index * 6 + 1] = Number(a?.y ?? 0);
    out[index * 6 + 2] = Number(a?.z ?? 0);
    out[index * 6 + 3] = Number(b?.x ?? 0);
    out[index * 6 + 4] = Number(b?.y ?? 0);
    out[index * 6 + 5] = Number(b?.z ?? 0);
  });
  return out;
}

/** Canonical glass cube material. Translucent from the first frame — no fade. */
export function makeGlassCubeMaterial(THREE, tint = GLASS_BASE_HEX, overrides = {}) {
  return new THREE.MeshStandardMaterial(glassCubeMaterialParams(tint, overrides));
}

/** Glowing edge-line frame (glow marker) sized to a cube of `size`. */
export function makeGlowMarker(THREE, { size = 1, color = GLASS_EDGE_COLOR, opacity = GLASS_EDGE_OPACITY } = {}) {
  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size));
  const material = new THREE.LineBasicMaterial(glassEdgeMaterialParams({ color, opacity }));
  const marker = new THREE.LineSegments(geometry, material);
  marker.name = "glass-style/glow-marker";
  marker.renderOrder = 4;
  return marker;
}

/** One glass cube: translucent body + glowing edge frame, grouped together.
 * `tint` may be a hex string or number. */
export function makeGlassCube(THREE, { size = 1, tint = GLASS_BASE_HEX, name = "glass-style/cube" } = {}) {
  const group = new THREE.Group();
  group.name = name;
  const body = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), makeGlassCubeMaterial(THREE, tint));
  body.name = `${name}/body`;
  group.add(body);
  group.add(makeGlowMarker(THREE, { size }));
  return group;
}

/** Connection lines between cubes from [[a,b],[c,d],...] point pairs. */
export function makeConnectionLines(THREE, pointPairs, overrides = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(Array.from(connectionLineVertices(pointPairs)), 3),
  );
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial(connectionLineMaterialParams(overrides)),
  );
  lines.name = "glass-style/connection-lines";
  return lines;
}

/** Bounded deterministic starfield, matching the reality-lens recipe. */
export function makeStarfield(THREE, count = STARFIELD_COUNT) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(Array.from(starfieldPositions(count)), 3),
  );
  const material = new THREE.PointsMaterial({
    color: STARFIELD_COLOR,
    size: STARFIELD_SIZE,
    transparent: true,
    opacity: STARFIELD_OPACITY,
    sizeAttenuation: true,
  });
  const stars = new THREE.Points(geometry, material);
  stars.name = "glass-style/starfield";
  return stars;
}

/** Hemisphere + directional lighting from the canonical recipe. */
export function addGlassLighting(THREE, parent) {
  const hemisphere = new THREE.HemisphereLight("#a8cfff", "#08101a", 1.1);
  hemisphere.name = "glass-style/hemisphere";
  parent.add(hemisphere);
  const warm = new THREE.DirectionalLight("#fce2b6", 2.4);
  warm.position.set(-7, 14, 10);
  warm.name = "glass-style/directional";
  parent.add(warm);
  return { hemisphere, warm };
}
