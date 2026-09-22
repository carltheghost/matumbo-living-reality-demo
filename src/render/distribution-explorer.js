import * as THREE from "three";

const TAU = Math.PI * 2;
const TOTAL_BASIS_POINTS = 10_000;
const DEFAULT_TOTAL_SUPPLY = 1_000_000_000;
const MAX_ALLOCATION_NODES = 12;
const DESKTOP_ARC_SEGMENTS = 10;
const MOBILE_ARC_SEGMENTS = 6;
const DISTRIBUTION_SOURCE = "tumbo-distribution-explorer";

const CLASS_LABELS = Object.freeze({
  "public-social-experiment": "Public social-experiment participants",
  "county-community": "County and community cohorts",
  organizations: "Participating organisations",
  "international-public-good-funds": "International public-good funds",
  "ecosystem-grants": "Ecosystem grants",
  "treasury-reserve": "Treasury reserve",
  operations: "Demo operations",
  "insurance-risk-reserve": "Insurance and risk reserve",
});

const KNOWN_ALLOCATION_IDS = new Set([
  "allocation-public-social-experiment",
  "allocation-county-community",
  "allocation-organizations",
  "allocation-international-public-good",
  "allocation-ecosystem-grants",
  "allocation-treasury-reserve",
  "allocation-operations",
  "allocation-insurance-risk-reserve",
]);

const PALETTE = Object.freeze([
  "#76ecff",
  "#b99cff",
  "#ffbe70",
  "#9cffcf",
  "#f486d5",
  "#83a7ff",
  "#f3df83",
  "#8df0e1",
  "#d39cff",
  "#ffc68a",
  "#a3e7ff",
  "#b9f08b",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function freeze(value) {
  return Object.freeze(value);
}

function freezeSnapshot(value) {
  if (Array.isArray(value)) return freeze(value.map((entry) => freezeSnapshot(entry)));
  if (!isRecord(value)) return value;
  return freeze(
    Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeSnapshot(entry)])),
  );
}

function safeString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function slugFor(value, fallback) {
  const source = safeString(value);
  if (!source) return fallback;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function finiteSafeInteger(value) {
  return Number.isSafeInteger(value) ? value : null;
}

function basisPointsFor(value) {
  const candidate = finiteSafeInteger(value);
  if (candidate === null || candidate < 0 || candidate > TOTAL_BASIS_POINTS) return null;
  return candidate;
}

function percentageFor(basisPoints) {
  return basisPoints / 100;
}

function labelFor(recipientClass, ordinal) {
  if (CLASS_LABELS[recipientClass]) return CLASS_LABELS[recipientClass];
  return `Aggregate fictional cohort ${ordinal}`;
}

function unitsFor(source, basisPoints, totalSupply) {
  const explicit = finiteSafeInteger(source?.tokenUnits ?? source?.units);
  if (!Number.isSafeInteger(totalSupply) || totalSupply < 0) return null;
  const derived = (totalSupply * basisPoints) / TOTAL_BASIS_POINTS;
  if (!Number.isSafeInteger(derived) || derived < 0) return null;
  if (explicit !== null) return explicit === derived ? explicit : null;
  return derived;
}

function allocationsFrom(projection, totalSupply) {
  const source = Array.isArray(projection?.allocations)
    ? projection.allocations
    : Array.isArray(projection?.entities)
      ? projection.entities.filter(
          (entity) => entity?.type === "asset-token-allocation" || entity?.kind === "allocation",
        )
      : [];

  const seen = new Set();
  const normalized = [];
  source.slice(0, MAX_ALLOCATION_NODES * 2).forEach((candidate, index) => {
    if (!isRecord(candidate)) return;
    const id = slugFor(candidate.id, `allocation-${index + 1}`);
    const recipientClass = slugFor(candidate.recipientClass, `aggregate-${index + 1}`);
    const basisPoints = basisPointsFor(candidate.basisPoints);
    if (basisPoints === null || seen.has(id)) return;
    const tokenUnits = unitsFor(candidate, basisPoints, totalSupply);
    if (tokenUnits === null) return;
    seen.add(id);
    const ordinal = Number.isSafeInteger(candidate.ordinal) && candidate.ordinal > 0
      ? candidate.ordinal
      : index + 1;
  normalized.push({
      id: KNOWN_ALLOCATION_IDS.has(id) && CLASS_LABELS[recipientClass]
        ? id
        : `allocation-${index + 1}`,
      recipientClass: CLASS_LABELS[recipientClass] ? recipientClass : `aggregate-cohort-${index + 1}`,
      label: labelFor(recipientClass, ordinal),
      purpose: `Fictional aggregate ${labelFor(recipientClass, ordinal).toLowerCase()} in the local demo projection.`,
      ordinal,
      basisPoints,
      percentage: percentageFor(basisPoints),
      tokenUnits,
      units: tokenUnits,
      simulation: true,
      executable: false,
      externalTransfer: false,
    });
  });

  normalized.sort((left, right) => {
    if (left.ordinal !== right.ordinal) return left.ordinal - right.ordinal;
    return left.id.localeCompare(right.id);
  });
  return normalized.slice(0, MAX_ALLOCATION_NODES);
}

function totalSupplyFor(projection) {
  const value = finiteSafeInteger(projection?.totalSupply ?? projection?.assetToken?.totalSupply);
  return value !== null && value >= 0 ? value : DEFAULT_TOTAL_SUPPLY;
}

function launchStateFor(candidate) {
  const source = typeof candidate === "string" ? { status: candidate } : isRecord(candidate) ? candidate : {};
  const requestedStatus = safeString(source.status);
  const status = new Set(["idle", "simulated", "previewed", "launched"]).has(requestedStatus)
    ? requestedStatus
    : "simulated";
  const launched = source.launched === true || status === "launched" || status === "previewed";
  return freeze({
    status,
    launched,
    simulation: true,
    executable: false,
    externalTransfer: false,
    externalDistribution: false,
    walletConnection: false,
    signing: false,
    settlement: false,
    transferCount: 0,
    boundary:
      "Simulated launch state only; no issuance, wallet, signing, settlement, or external transfer occurs.",
  });
}

function colorFor(index) {
  return new THREE.Color(PALETTE[index % PALETTE.length]);
}

function targetPositionFor(index, count, isMobile) {
  const safeCount = Math.max(count, 1);
  const angle = -Math.PI / 2 + (index * TAU) / safeCount;
  const radius = isMobile ? 1.72 : 2.28;
  const y = ((index % 3) - 1) * (isMobile ? 0.11 : 0.16);
  return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
}

function disposeMaterial(material) {
  if (Array.isArray(material)) material.forEach((entry) => entry?.dispose?.());
  else material?.dispose?.();
}

/**
 * Renderer-only Distribution Explorer for the local TUMBO asset-token
 * projection. Nodes represent aggregate fictional cohorts. Mesh metadata is
 * intentionally non-executable and can only be used by the host renderer to
 * produce local inspection intents.
 */
export function createDistributionExplorer({ parent, raycastTargets = [], isMobile = false } = {}) {
  const targets = Array.isArray(raycastTargets) ? raycastTargets : [];
  const host = parent && typeof parent.add === "function" ? parent : null;
  const layer = new THREE.Group();
  layer.name = "Distribution Explorer — TUMBO Asset Token simulation";
  host?.add(layer);

  const anchor = new THREE.Group();
  anchor.name = "simulated-launch-anchor";
  layer.add(anchor);
  const anchorMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#b99cff"),
    emissive: new THREE.Color("#4c347b"),
    emissiveIntensity: 0.72,
    metalness: 0.5,
    roughness: 0.26,
  });
  // The allocation surface is intentionally cube-native. Keep the anchor and
  // its cue square so a viewer never falls back to the old round-node visual
  // language when this layer is exposed.
  const anchorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(isMobile ? 0.3 : 0.38, isMobile ? 0.3 : 0.38, isMobile ? 0.3 : 0.38),
    anchorMaterial,
  );
  anchorMesh.userData.distributionAnchor = true;
  anchorMesh.userData.distributionGeometry = "cube";
  anchor.add(anchorMesh);
  const anchorRing = new THREE.Mesh(
    new THREE.BoxGeometry(isMobile ? 0.68 : 0.84, 0.028, isMobile ? 0.68 : 0.84),
    new THREE.MeshBasicMaterial({ color: "#d9ccff", transparent: true, opacity: 0.55, wireframe: true }),
  );
  anchorRing.userData.distributionAnchorCue = true;
  anchorRing.userData.distributionGeometry = "cube-frame";
  anchor.add(anchorRing);

  const nodes = new Map();
  let allocations = [];
  let totalSupply = DEFAULT_TOTAL_SUPPLY;
  let unit = "TUMBO-SIM";
  let selectedId = null;
  let hoveredId = null;
  let launchState = launchStateFor();
  let elapsed = 0;
  let projectionMetadata = {
    schemaVersion: 1,
    source: DISTRIBUTION_SOURCE,
    simulation: true,
    executable: false,
    externalTransfer: false,
  };

  function removeNode(node) {
    node.root.traverse((object) => {
      const targetIndex = targets.indexOf(object);
      if (targetIndex >= 0) targets.splice(targetIndex, 1);
      if (object.geometry) object.geometry.dispose?.();
      if (object.material) disposeMaterial(object.material);
    });
    const arcTargetIndex = targets.indexOf(node.arc);
    if (arcTargetIndex >= 0) targets.splice(arcTargetIndex, 1);
    node.arc.geometry?.dispose?.();
    disposeMaterial(node.arc.material);
    node.arc.removeFromParent();
    node.root.removeFromParent();
  }

  function createNode(allocation, index, count) {
    const root = new THREE.Group();
    root.name = `distribution-class-${allocation.id}`;
    root.position.copy(targetPositionFor(index, count, isMobile));
    root.userData.distributionAllocationId = allocation.id;
    root.userData.simulation = true;
    root.userData.executable = false;
    root.userData.externalTransfer = false;

    const tint = colorFor(index);
    const material = new THREE.MeshStandardMaterial({
      color: tint,
      emissive: tint.clone().multiplyScalar(0.26),
      emissiveIntensity: 0.7,
      metalness: 0.42,
      roughness: 0.28,
    });
    const nodeSize = isMobile ? 0.3 : 0.38;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(nodeSize, nodeSize, nodeSize), material);
    mesh.userData.distributionAllocationId = allocation.id;
    mesh.userData.distributionAllocation = allocation;
    mesh.userData.simulation = true;
    mesh.userData.executable = false;
    mesh.userData.externalTransfer = false;
    mesh.userData.distributionGeometry = "cube";
    root.add(mesh);
    targets.push(mesh);

    const ring = new THREE.Mesh(
      new THREE.BoxGeometry(isMobile ? 0.5 : 0.62, 0.022, isMobile ? 0.5 : 0.62),
      new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.52, wireframe: true }),
    );
    ring.userData.distributionAllocationId = allocation.id;
    ring.userData.distributionAllocation = allocation;
    ring.userData.distributionSelectionCue = true;
    ring.userData.distributionGeometry = "cube-frame";
    root.add(ring);
    targets.push(ring);

    const arcMaterial = new THREE.LineBasicMaterial({
      color: tint,
      transparent: true,
      opacity: launchState.launched ? 0.54 : 0.23,
    });
    const midpoint = root.position.clone().multiplyScalar(0.48);
    midpoint.y += isMobile ? 0.46 : 0.7;
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), midpoint, root.position.clone());
    const arcGeometry = new THREE.BufferGeometry().setFromPoints(
      curve.getPoints(isMobile ? MOBILE_ARC_SEGMENTS : DESKTOP_ARC_SEGMENTS),
    );
    const arc = new THREE.Line(arcGeometry, arcMaterial);
    arc.name = `distribution-arc-${allocation.id}`;
    arc.userData.distributionAllocationId = allocation.id;
    arc.userData.simulation = true;
    arc.userData.executable = false;
    arc.userData.externalTransfer = false;
    layer.add(arc);

    return {
      id: allocation.id,
      allocation,
      root,
      mesh,
      ring,
      arc,
      arcMaterial,
      targetPosition: root.position.clone(),
      baseScale: 1,
    };
  }

  function syncProjection(projection) {
    const nextTotalSupply = totalSupplyFor(projection);
    const nextAllocations = allocationsFrom(projection, nextTotalSupply);
    const activeIds = new Set(nextAllocations.map(({ id }) => id));
    nodes.forEach((node, id) => {
      if (!activeIds.has(id)) {
        removeNode(node);
        nodes.delete(id);
      }
    });

    nextAllocations.forEach((allocation, index) => {
      const existing = nodes.get(allocation.id);
      if (existing) {
        existing.allocation = allocation;
        existing.targetPosition.copy(targetPositionFor(index, nextAllocations.length, isMobile));
        existing.root.userData.distributionAllocation = allocation;
        existing.arcMaterial.opacity = launchState.launched ? 0.54 : 0.23;
        return;
      }
      const node = createNode(allocation, index, nextAllocations.length);
      layer.add(node.root);
      nodes.set(node.id, node);
    });

    allocations = nextAllocations;
    totalSupply = nextTotalSupply;
    unit = safeString(projection?.unit ?? projection?.assetToken?.unit) ?? "TUMBO-SIM";
    if (!selectedId || !nodes.has(selectedId)) selectedId = allocations[0]?.id ?? null;
    const candidateLaunch = projection?.launchDistribution ?? projection?.launch ?? null;
    if (candidateLaunch) launchState = launchStateFor(candidateLaunch);
    projectionMetadata = {
      schemaVersion: Number.isSafeInteger(projection?.schemaVersion) ? projection.schemaVersion : 1,
      source: DISTRIBUTION_SOURCE,
      simulation: true,
      executable: false,
      externalTransfer: false,
      sourceProjection: safeString(projection?.source) ?? "local-asset-token-projection",
    };
    nodes.forEach((node) => {
      node.arcMaterial.opacity = launchState.launched ? 0.54 : 0.23;
    });
    return getSnapshot();
  }

  function setLaunchState(next) {
    launchState = launchStateFor(next);
    nodes.forEach((node) => {
      node.arcMaterial.opacity = launchState.launched ? 0.54 : 0.23;
    });
    return getSnapshot();
  }

  function selectAllocation(id) {
    if (id === null || id === undefined || id === "") {
      selectedId = null;
      return getSnapshot();
    }
    const normalized = slugFor(id, "");
    if (!nodes.has(normalized)) return getSnapshot();
    selectedId = normalized;
    return getSnapshot();
  }

  function resolveTarget(object) {
    let cursor = object;
    while (cursor) {
      const id = slugFor(cursor.userData?.distributionAllocationId, "");
      if (id && nodes.has(id)) {
        const node = nodes.get(id);
        return freeze({
          id,
          allocation: freeze({ ...node.allocation }),
          simulation: true,
          executable: false,
          externalTransfer: false,
        });
      }
      cursor = cursor.parent;
    }
    return null;
  }

  function getSnapshot() {
    const selected = allocations.find(({ id }) => id === selectedId) ?? null;
    return freezeSnapshot({
      ...projectionMetadata,
      kind: "distribution-explorer-projection",
      // This is a renderer-only facet of the local launch console. Keep its
      // capability flags explicit so the composed projection cannot mistake
      // the visual layer for a networked distribution authority.
      localOnly: true,
      externalNetwork: false,
      persistence: false,
      totalSupply,
      unit,
      allocationCount: allocations.length,
      selectedAllocationId: selectedId,
      hoveredAllocationId: hoveredId,
      selectedAllocation: selected
        ? {
            ...selected,
            simulation: true,
            executable: false,
            externalTransfer: false,
          }
        : null,
      allocations: allocations.map((allocation) => ({
        ...allocation,
        simulation: true,
        executable: false,
        externalTransfer: false,
      })),
      launchState,
      boundary:
        "Distribution Explorer is a local visual projection of aggregate fictional cohorts; no external transfer is possible.",
      deterministic: true,
    });
  }

  function update(dt = 0.016, time = null, options = {}) {
    const delta = Number.isFinite(dt) && dt >= 0 ? Math.min(dt, 0.2) : 0.016;
    elapsed = Number.isFinite(time) ? time : elapsed + delta;
    if (typeof options.selectedId === "string") selectedId = slugFor(options.selectedId, selectedId ?? "");
    if (typeof options.hoveredId === "string") hoveredId = slugFor(options.hoveredId, "");
    if (options.hoveredId === null) hoveredId = null;
    const reducedMotion = options.reducedMotion === true;
    const selected = selectedId;
    anchor.rotation.y += reducedMotion ? 0 : delta * 0.24;
    anchorRing.rotation.z += reducedMotion ? 0 : delta * 0.18;
    nodes.forEach((node, id) => {
      const isSelected = id === selected;
      const isHovered = id === hoveredId;
      const emphasis = isSelected ? 1.24 : isHovered ? 1.1 : 1;
      const targetScale = node.baseScale * emphasis;
      const currentScale = node.root.scale.x;
      node.root.scale.setScalar(THREE.MathUtils.damp(currentScale, targetScale, 8, delta));
      node.root.position.lerp(node.targetPosition, 1 - Math.pow(0.001, delta * 8));
      node.ring.material.opacity = isSelected ? 0.9 : isHovered ? 0.76 : 0.5;
      node.arcMaterial.opacity = isSelected
        ? launchState.launched
          ? 0.88
          : 0.5
        : launchState.launched
          ? 0.54
          : 0.23;
      if (!reducedMotion) {
        node.root.rotation.y += delta * (isSelected ? 0.38 : 0.2);
        node.mesh.rotation.x += delta * 0.11;
      }
    });
  }

  function destroy() {
    nodes.forEach((node) => removeNode(node));
    nodes.clear();
    anchor.traverse((object) => {
      if (object.geometry) object.geometry.dispose?.();
      if (object.material) disposeMaterial(object.material);
    });
    layer.removeFromParent();
    allocations = [];
    selectedId = null;
    hoveredId = null;
  }

  return Object.freeze({
    layer,
    syncProjection,
    setLaunchState,
    selectAllocation,
    resolveTarget,
    getSnapshot,
    update,
    destroy,
    get count() {
      return nodes.size;
    },
  });
}

export default createDistributionExplorer;
