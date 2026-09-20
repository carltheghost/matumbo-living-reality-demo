/**
 * tests/photo-mascot-stubs.mjs - Reality Lens Ω
 *
 * node:module customization hooks for tests/photo-mascot-mount.test.mjs.
 *
 * - "three"                -> minimal stub module (the mount module's test-time
 *                             import graph does not need real Three.js).
 * - photo-mascot-presence.js -> instrumented fake implementing the GPT-M4
 *                             presence API { open, close, toggle, isOpen,
 *                             update, dispose } plus the setTilt hook the mount
 *                             feeds from pointermove. Created instances are
 *                             recorded on globalThis.__createdPresences.
 * - Everything else (including the real ../src/render/photo-mascot-set.js)
 *   passes through untouched, so preloadPhotos laziness is tested for real.
 */

const THREE_EXPORT_NAMES = [
  "Scene",
  "PerspectiveCamera",
  "OrthographicCamera",
  "WebGLRenderer",
  "WebGLRenderTarget",
  "Group",
  "Object3D",
  "Mesh",
  "Sprite",
  "Points",
  "Line",
  "PlaneGeometry",
  "BoxGeometry",
  "SphereGeometry",
  "CircleGeometry",
  "RingGeometry",
  "CylinderGeometry",
  "TorusGeometry",
  "BufferGeometry",
  "Float32BufferAttribute",
  "Uint16BufferAttribute",
  "MeshBasicMaterial",
  "MeshStandardMaterial",
  "MeshLambertMaterial",
  "MeshPhongMaterial",
  "ShaderMaterial",
  "SpriteMaterial",
  "PointsMaterial",
  "LineBasicMaterial",
  "TextureLoader",
  "CanvasTexture",
  "Texture",
  "DataTexture",
  "Color",
  "Vector2",
  "Vector3",
  "Vector4",
  "Quaternion",
  "Euler",
  "Matrix4",
  "Clock",
  "Raycaster",
  "AmbientLight",
  "DirectionalLight",
  "PointLight",
  "HemisphereLight",
  "SpotLight",
  "DoubleSide",
  "FrontSide",
  "BackSide",
  "AdditiveBlending",
  "NormalBlending",
  "SubtractiveBlending",
  "MultiplyBlending",
  "SRGBColorSpace",
  "LinearSRGBColorSpace",
  "NoColorSpace",
  "ACESFilmicToneMapping",
  "NoToneMapping",
  "LinearToneMapping",
  "PCFSoftShadowMap",
  "PCFShadowMap",
  "Fog",
  "FogExp2",
  "MathUtils",
  "EventDispatcher",
];

function threeStubSource() {
  const lines = [
    "// Minimal 'three' stub for the photo-mascot-mount test.",
    "const __threeDummy = new Proxy(function __threeDummy() {}, {",
    "  get(target, prop, receiver) {",
    "    if (prop === Symbol.toPrimitive) return () => 0;",
    "    if (prop === 'then') return undefined;",
    "    return receiver;",
    "  },",
    "  apply() { return __threeDummy; },",
    "  construct() { return __threeDummy; },",
    "});",
    "export default __threeDummy;",
  ];
  for (const name of THREE_EXPORT_NAMES) {
    lines.push(`export const ${name} = __threeDummy;`);
  }
  return lines.join("\n");
}

function presenceStubSource() {
  return [
    "// Instrumented fake of GPT-M4's photo-mascot-presence, for the mount test.",
    "export function createPhotoMascotPresence(args) {",
    "  if (globalThis.__photoMascotFactoryShouldThrow) {",
    "    throw new Error('stubbed presence factory failure');",
    "  }",
    "  const calls = [];",
    "  const api = {",
    "    __calls: calls,",
    "    __args: args || {},",
    "    __open: false,",
    "    __disposed: false,",
    "    isOpen() { calls.push(['isOpen']); return api.__open; },",
    "    open() { calls.push(['open']); api.__open = true; return Promise.resolve(); },",
    "    close() { calls.push(['close']); api.__open = false; },",
    "    toggle() { calls.push(['toggle']); return api.__open ? api.close() : api.open(); },",
    "    update(t, dt) { calls.push(['update', t, dt]); },",
    "    setTilt(x, y) { calls.push(['setTilt', x, y]); },",
    "    dispose() { calls.push(['dispose']); api.__disposed = true; },",
    "  };",
    "  const registry = globalThis.__createdPresences || (globalThis.__createdPresences = []);",
    "  registry.push(api);",
    "  return api;",
    "}",
  ].join("\n");
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "three") {
    return { url: "photo-mascot-test:three-stub", shortCircuit: true };
  }
  if (/(^|\/)photo-mascot-presence\.js$/.test(specifier)) {
    return { url: "photo-mascot-test:presence-stub", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === "photo-mascot-test:three-stub") {
    return { format: "module", shortCircuit: true, source: threeStubSource() };
  }
  if (url === "photo-mascot-test:presence-stub") {
    return { format: "module", shortCircuit: true, source: presenceStubSource() };
  }
  return nextLoad(url, context);
}
