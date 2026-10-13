/**
 * TUMBO-SIM coin presentation primitives.
 *
 * This module owns only the visual language of the coin. It deliberately
 * reads the existing policy/facade instead of creating a second supply
 * source, mint path, balance, or ledger. The returned meshes are ordinary
 * Three.js geometry so callers can place them in the Reality Lens, the
 * universal renderer, or the legacy hero organ without a texture asset.
 */

import { getTumboSupplyPolicy } from "../domains/token-supply-policy.js";

export const TUMBO_COIN_VISUAL_SOURCE = "tumbo-sim-coin-visual";

const DEFAULTS = Object.freeze({
  radius: 0.68,
  thickness: 0.22,
  frontZ: 0.4599,
});

const PALETTE = Object.freeze({
  edge: "#edc86d",
  edgeDeep: "#5b3a18",
  face: "#0b3045",
  faceDeep: "#082337",
  emblem: "#ffe7a1",
  emblemShadow: "#c58a38",
  signal: "#78f1e8",
  signalQuiet: "#6496a0",
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function groupDecimal(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function simulationFacade(scope) {
  const candidate = scope?.TumboToken ?? scope?.window?.TumboToken;
  if (!candidate || typeof candidate !== "object") return null;
  return candidate;
}

function readReceiptCount(scope) {
  try {
    const ledger = simulationFacade(scope)?.ledger;
    if (!ledger || typeof ledger.history !== "function") return 0;
    const history = ledger.history({ limit: 200 });
    return Array.isArray(history) ? history.length : 0;
  } catch {
    // The coin is a presentation surface. A temporarily unavailable facade
    // must not break the Living Reality scene or invent a fallback balance.
    return 0;
  }
}

/**
 * Read-only details for the visible coin. Exact values stay as strings so the
 * 42-trillion policy value never passes through Number or changes token math.
 */
export function readTumboCoinState(scope = globalThis) {
  const policy = getTumboSupplyPolicy();
  const receiptCount = readReceiptCount(scope);
  const currentIssued = groupDecimal(policy.currentIssued.wholeTumbo);
  const intendedMaximum = groupDecimal(policy.intendedMaximum.wholeTumbo);
  const fluffPerTumbo = groupDecimal(policy.fluffPerTumbo);
  const ledgerLabel = receiptCount === 0
    ? "no local ledger rows observed"
    : `${receiptCount} local ledger ${receiptCount === 1 ? "row" : "rows"} observed`;
  return Object.freeze({
    source: TUMBO_COIN_VISUAL_SOURCE,
    asset: policy.asset,
    simulation: policy.simulation,
    unit: policy.unit,
    fluffPerTumbo: policy.fluffPerTumbo,
    currentIssued: Object.freeze({ ...policy.currentIssued }),
    intendedMaximum: Object.freeze({ ...policy.intendedMaximum }),
    receiptCount,
    ledgerLabel,
    currentIssuedLabel: `${currentIssued} ${policy.asset}`,
    intendedMaximumLabel: `${intendedMaximum} ${policy.asset}`,
    accessibilityLabel: `${policy.asset} simulation coin. ${currentIssued} issued in the local simulation; policy maximum ${intendedMaximum}; ${fluffPerTumbo} fluff per TUMBO. ${ledgerLabel}. Policy metadata only; this visual does not mint or transfer tokens.`,
  });
}

function makeMaterial(THREE, options) {
  return new THREE.MeshStandardMaterial({
    metalness: 0.72,
    roughness: 0.24,
    ...options,
  });
}

function createEmblemGeometry(THREE, size, depth) {
  const half = size / 2;
  const stem = size * 0.2;
  const top = size * 0.18;
  const shape = new THREE.Shape();
  shape.moveTo(-half, half);
  shape.lineTo(half, half);
  shape.lineTo(half, half - top);
  shape.lineTo(stem / 2, half - top);
  shape.lineTo(stem / 2, -half);
  shape.lineTo(-stem / 2, -half);
  shape.lineTo(-stem / 2, half - top);
  shape.lineTo(-half, half - top);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: Math.min(size * 0.035, 0.014),
    bevelThickness: Math.min(depth * 0.32, 0.008),
    curveSegments: 2,
  });
}

function setPartUserData(part, role) {
  part.userData.tumboCoinPart = role;
  part.userData.tumboCoinVisualSource = TUMBO_COIN_VISUAL_SOURCE;
  return part;
}

function normalizeOptions(options = {}) {
  const radius = Number.isFinite(options.radius) && options.radius > 0 ? options.radius : DEFAULTS.radius;
  const thickness = Number.isFinite(options.thickness) && options.thickness > 0 ? options.thickness : DEFAULTS.thickness;
  const frontZ = Number.isFinite(options.frontZ) ? options.frontZ : DEFAULTS.frontZ;
  return {
    radius,
    thickness,
    frontZ,
    faceRadius: radius * 0.84,
    stateRadius: radius * 0.69,
    emblemSize: radius * 0.68,
    emblemDepth: Math.max(0.014, Math.min(0.032, thickness * 0.2)),
  };
}

/** Create the physical coin blank, axis-aligned with its face toward +Z. */
export function createTumboCoinGeometry(THREE, options = {}) {
  const { radius, thickness } = normalizeOptions(options);
  const geometry = new THREE.CylinderGeometry(radius, radius, thickness, 64, 4, false);
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Build the raised face, rim, emblem, and simulation-state pips. The body is
 * intentionally separate so renderers can keep their existing topology/LOD
 * material on the physical mesh while adding these bounded details.
 */
export function createTumboCoinDetails(THREE, options = {}) {
  const resolved = normalizeOptions(options);
  const {
    radius,
    thickness,
    frontZ,
    faceRadius,
    stateRadius,
    emblemSize,
    emblemDepth,
  } = resolved;
  const root = new THREE.Group();
  root.name = "tumbo-sim-coin/details";
  const parts = [root];
  const materials = [];
  const geometries = [];

  const trackMaterial = (material) => {
    if (material && !materials.includes(material)) materials.push(material);
    return material;
  };
  const trackGeometry = (geometry) => {
    geometries.push(geometry);
    return geometry;
  };
  const addMesh = (geometry, material, role, z = frontZ) => {
    const mesh = setPartUserData(new THREE.Mesh(trackGeometry(geometry), trackMaterial(material)), role);
    mesh.position.z = z;
    root.add(mesh);
    parts.push(mesh);
    return mesh;
  };

  const faceThickness = Math.max(0.028, Math.min(0.05, thickness * 0.2));
  const faceMaterial = trackMaterial(makeMaterial(THREE, {
    color: PALETTE.face,
    emissive: PALETTE.faceDeep,
    emissiveIntensity: 0.82,
    metalness: 0.48,
    roughness: 0.3,
  }));
  const faceGeometry = new THREE.CylinderGeometry(faceRadius, faceRadius, faceThickness, 64, 2, false);
  faceGeometry.rotateX(Math.PI / 2);
  const face = addMesh(faceGeometry, faceMaterial, "face", frontZ - faceThickness * 0.18);

  const edgeMaterial = trackMaterial(makeMaterial(THREE, {
    color: PALETTE.edge,
    emissive: "#b97827",
    emissiveIntensity: 0.24,
    metalness: 0.94,
    roughness: 0.16,
  }));
  const innerEdge = addMesh(
    new THREE.TorusGeometry(faceRadius * 0.98, Math.max(0.018, radius * 0.026), 8, 64),
    edgeMaterial,
    "face-rim",
    frontZ + 0.018,
  );
  const outerEdge = addMesh(
    new THREE.TorusGeometry(radius * 0.965, Math.max(0.022, radius * 0.034), 8, 64),
    edgeMaterial,
    "outer-rim",
    frontZ - thickness * 0.38,
  );

  const emblemMaterial = trackMaterial(makeMaterial(THREE, {
    color: PALETTE.emblem,
    emissive: PALETTE.emblemShadow,
    emissiveIntensity: 0.78,
    metalness: 0.76,
    roughness: 0.2,
  }));
  const emblem = addMesh(
    createEmblemGeometry(THREE, emblemSize, emblemDepth),
    emblemMaterial,
    "tumbo-emblem",
    frontZ + 0.043,
  );
  // ShapeGeometry is XY-facing by construction; ExtrudeGeometry's front is
  // already +Z, so only a tiny lift is needed for a crisp, shadow-catching T.
  emblem.castShadow = false;
  emblem.receiveShadow = false;

  const signalMaterial = trackMaterial(makeMaterial(THREE, {
    color: PALETTE.signal,
    emissive: PALETTE.signal,
    emissiveIntensity: 0.5,
    metalness: 0.5,
    roughness: 0.2,
  }));
  const quietMaterial = trackMaterial(makeMaterial(THREE, {
    color: PALETTE.signalQuiet,
    emissive: "#2c6471",
    emissiveIntensity: 0.34,
    metalness: 0.28,
    roughness: 0.32,
  }));
  const pips = [];
  const pipGeometry = trackGeometry(new THREE.SphereGeometry(Math.max(0.022, radius * 0.04), 10, 8));
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2 + Math.PI / 8;
    const pip = setPartUserData(new THREE.Mesh(pipGeometry, quietMaterial), "ledger-state-pip");
    pip.position.set(Math.cos(angle) * stateRadius, Math.sin(angle) * stateRadius, frontZ + 0.052);
    root.add(pip);
    parts.push(pip);
    pips.push(pip);
  }

  const signalRing = addMesh(
    new THREE.TorusGeometry(stateRadius * 0.87, Math.max(0.009, radius * 0.012), 6, 48),
    quietMaterial,
    "ledger-state-ring",
    frontZ + 0.036,
  );

  let currentState = null;
  let currentFingerprint = "";
  let motionAngle = 0;
  const updateState = (state = readTumboCoinState(), { selected = false, hovered = false } = {}) => {
    const safeState = state?.source === TUMBO_COIN_VISUAL_SOURCE ? state : readTumboCoinState();
    const fingerprint = `${safeState.receiptCount}:${selected ? 1 : 0}:${hovered ? 1 : 0}`;
    if (fingerprint === currentFingerprint) return safeState;
    currentFingerprint = fingerprint;
    currentState = safeState;
    const activePips = clamp(safeState.receiptCount, 0, pips.length);
    pips.forEach((pip, index) => { pip.material = index < activePips ? signalMaterial : quietMaterial; });
    signalRing.material = activePips > 0 ? signalMaterial : quietMaterial;
    signalRing.material.emissiveIntensity = activePips > 0
      ? (selected ? 1.0 : hovered ? 0.78 : 0.58)
      : (selected ? 0.3 : hovered ? 0.24 : 0.2);
    faceMaterial.emissiveIntensity = selected ? 0.98 : hovered ? 0.9 : 0.82;
    emblemMaterial.emissiveIntensity = selected ? 0.92 : hovered ? 0.84 : 0.78;
    edgeMaterial.emissiveIntensity = selected ? 0.38 : hovered ? 0.3 : 0.24;
    signalRing.scale.setScalar(selected ? 1.035 : hovered ? 1.018 : 1);
    root.userData.tumboCoinState = safeState;
    root.userData.accessibleLabel = safeState.accessibilityLabel;
    return safeState;
  };
  const animate = ({ time = 0, reducedMotion = false } = {}) => {
    // The identity mark is almost still at rest. This slight, deterministic
    // movement gives selected close-ups a material response without turning
    // the coin into a distracting spinner.
    motionAngle = reducedMotion ? 0 : time * 0.018;
    innerEdge.rotation.z = motionAngle;
    signalRing.rotation.z = reducedMotion ? 0 : -motionAngle * 1.4;
  };
  updateState();

  return {
    root,
    parts,
    geometries,
    materials,
    bodyOptions: resolved,
    face,
    edgeMaterial,
    signalRing,
    pips,
    get state() { return currentState; },
    surfaceDepth(_x = 0, _y = 0, extra = 0.012) { return frontZ + extra; },
    update: updateState,
    animate,
  };
}

/** Build a complete coin for renderers that own both the body and details. */
export function createTumboCoinVisual(THREE, options = {}) {
  const resolved = normalizeOptions(options);
  const root = new THREE.Group();
  root.name = "tumbo-sim-coin";
  const bodyMaterial = makeMaterial(THREE, {
    color: PALETTE.edgeDeep,
    emissive: "#2a1b0b",
    emissiveIntensity: 0.22,
    metalness: 0.92,
    roughness: 0.2,
  });
  const body = setPartUserData(new THREE.Mesh(createTumboCoinGeometry(THREE, resolved), bodyMaterial), "body");
  body.position.z = resolved.frontZ - resolved.thickness * 0.5;
  root.add(body);
  const details = createTumboCoinDetails(THREE, resolved);
  root.add(details.root);
  const parts = [root, body, ...details.parts.filter((part) => part !== details.root)];
  const update = (state, interaction) => details.update(state, interaction);
  const animate = (frame) => details.animate(frame);
  update();
  root.userData.tumboCoinVisualSource = TUMBO_COIN_VISUAL_SOURCE;
  root.userData.accessibleLabel = details.state.accessibilityLabel;
  return {
    root,
    body,
    parts,
    details,
    bodyMaterial,
    update,
    animate,
    surfaceDepth: details.surfaceDepth,
    state: details.state,
  };
}

