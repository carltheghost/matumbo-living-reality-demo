import * as THREE from "three";

const TAU = Math.PI * 2;

const LENS_MODES = new Set(["world", "population", "detail"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function presentationFor(entity) {
  return isRecord(entity?.presentation) ? entity.presentation : {};
}

function genomeFor(entity) {
  const genome = presentationFor(entity).visualGenome;
  return isRecord(genome) ? genome : {};
}

function color(value, fallback) {
  const resolved = new THREE.Color(fallback);
  if (typeof value !== "string") return resolved;
  try {
    resolved.set(value);
  } catch {
    // Invalid optional presentation data must not break the renderer.
  }
  return resolved;
}

function positionFor(entity) {
  const position = presentationFor(entity).position;
  if (
    Array.isArray(position) &&
    position.length >= 3 &&
    position.slice(0, 3).every(Number.isFinite)
  ) {
    return new THREE.Vector3(position[0], position[1], position[2]);
  }
  return new THREE.Vector3();
}

function cellTransform(genome, index, count) {
  const ratio = count <= 1 ? 0 : index / (count - 1);
  const angle = ratio * TAU * 1.55;
  const family = String(genome.shapeFamily ?? "modular-cluster");

  if (family.includes("spire")) {
    return {
      position: new THREE.Vector3(
        Math.cos(angle) * (0.3 + ratio * 0.42),
        -0.62 + ratio * 1.5,
        Math.sin(angle) * (0.3 + ratio * 0.42),
      ),
      rotation: new THREE.Euler(angle * 0.22, angle, angle * 0.1),
    };
  }

  if (family.includes("arc")) {
    const arc = -Math.PI * 0.82 + ratio * Math.PI * 1.64;
    return {
      position: new THREE.Vector3(
        Math.cos(arc) * 1.02,
        Math.sin(arc) * 0.76 + 0.05,
        Math.sin(angle * 0.7) * 0.3,
      ),
      rotation: new THREE.Euler(arc * 0.35, angle * 0.45, -arc * 0.45),
    };
  }

  if (family.includes("ring")) {
    return {
      position: new THREE.Vector3(
        Math.cos(angle) * (0.76 + (index % 3) * 0.1),
        Math.sin(angle * 1.9) * 0.28,
        Math.sin(angle) * (0.76 + (index % 3) * 0.1),
      ),
      rotation: new THREE.Euler(angle * 0.45, angle, -angle * 0.2),
    };
  }

  const column = (index % 4) - 1.5;
  const row = Math.floor(index / 4) - 1.5;
  return {
    position: new THREE.Vector3(
      column * 0.4 + Math.sin(angle) * 0.13,
      row * 0.34 + Math.cos(angle * 1.4) * 0.14,
      Math.sin(angle * 1.8) * 0.38,
    ),
    rotation: new THREE.Euler(angle * 0.18, angle * 0.6, angle * 0.27),
  };
}

function registerRaycastTarget(target, person, raycastTargets) {
  target.userData.person = person;
  raycastTargets.push(target);
}

function createPerson(entity, raycastTargets, { isMobile }) {
  const genome = genomeFor(entity);
  const primary = color(genome.primary, "#76ecff");
  const accent = color(genome.accent, "#eafcff");
  const aura = color(genome.aura, "#153c4e");
  const root = new THREE.Group();
  const homePosition = positionFor(entity);
  root.position.copy(homePosition);

  const person = {
    id: entity.id,
    entity,
    genome,
    root,
    homePosition,
    body: new THREE.Group(),
    detail: new THREE.Group(),
    cells: [],
    detailCells: [],
    halo: [],
    materials: [],
    core: null,
    consentRing: null,
  };
  root.add(person.body, person.detail);

  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color: aura,
    emissive: primary.clone().multiplyScalar(0.18),
    emissiveIntensity: 0.5,
    metalness: 0.68,
    roughness: 0.22,
    transmission: 0.16,
    transparent: true,
    opacity: 0.56,
    clearcoat: 0.72,
  });
  const primaryMaterial = new THREE.MeshPhysicalMaterial({
    color: primary,
    emissive: primary.clone().multiplyScalar(0.42),
    emissiveIntensity: 0.7,
    metalness: 0.52,
    roughness: 0.2,
    clearcoat: 0.85,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent.clone().multiplyScalar(0.28),
    emissiveIntensity: 0.95,
    metalness: 0.38,
    roughness: 0.18,
  });
  const detailMaterial = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: primary.clone().multiplyScalar(0.32),
    emissiveIntensity: 0.8,
    metalness: 0.48,
    roughness: 0.22,
  });
  person.materials.push(shellMaterial, primaryMaterial, accentMaterial, detailMaterial);

  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 1), shellMaterial);
  shell.scale.set(0.82, 1.08, 0.82);
  person.body.add(shell);
  registerRaycastTarget(shell, person, raycastTargets);

  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 1), accentMaterial);
  person.body.add(core);
  person.core = core;
  registerRaycastTarget(core, person, raycastTargets);

  const count = isMobile ? 11 : 17;
  for (let index = 0; index < count; index += 1) {
    const transform = cellTransform(genome, index, count);
    const scale = 0.18 + (index % 4) * 0.027;
    const cell = new THREE.Mesh(
      new THREE.BoxGeometry(scale * 1.05, scale * 0.82, scale),
      index % 4 === 0 ? accentMaterial : primaryMaterial,
    );
    cell.position.copy(transform.position);
    cell.rotation.copy(transform.rotation);
    cell.userData.basePosition = transform.position.clone();
    cell.userData.phase = index * 0.71;
    person.body.add(cell);
    person.cells.push(cell);
    registerRaycastTarget(cell, person, raycastTargets);

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(cell.geometry),
      new THREE.LineBasicMaterial({
        color: index % 3 === 0 ? accent : primary,
        transparent: true,
        opacity: 0.45,
      }),
    );
    cell.add(edge);
  }

  const consentGranted = entity?.consent?.displayName?.granted === true;
  const consentColor = new THREE.Color(consentGranted ? "#9cffcf" : "#ffbe70");
  const consentRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.026, 7, 54),
    new THREE.MeshBasicMaterial({
      color: consentColor,
      transparent: true,
      opacity: 0.46,
    }),
  );
  consentRing.rotation.x = Math.PI / 2;
  person.body.add(consentRing);
  person.consentRing = consentRing;
  registerRaycastTarget(consentRing, person, raycastTargets);

  for (let index = 0; index < 2; index += 1) {
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.08 + index * 0.16, 0.011, 6, 48),
      new THREE.MeshBasicMaterial({
        color: index ? accent : primary,
        transparent: true,
        opacity: index ? 0.16 : 0.24,
      }),
    );
    halo.rotation.set(Math.PI / 2 + index * 0.48, index * 0.73, 0);
    person.body.add(halo);
    person.halo.push(halo);
  }

  const semanticCells = Array.isArray(presentationFor(entity).semanticCells)
    ? presentationFor(entity).semanticCells
    : [];
  semanticCells.slice(0, 4).forEach((cell, index) => {
    const detailCell = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.14),
      detailMaterial,
    );
    detailCell.userData.phase = index * 1.4;
    detailCell.userData.semanticCell = cell;
    person.detail.add(detailCell);
    person.detailCells.push(detailCell);
    registerRaycastTarget(detailCell, person, raycastTargets);
  });
  person.detail.scale.setScalar(0.001);

  return person;
}

function disposePerson(person, raycastTargets) {
  person.root.traverse((node) => {
    const index = raycastTargets.indexOf(node);
    if (index >= 0) raycastTargets.splice(index, 1);
    if (node.isMesh) {
      node.geometry?.dispose?.();
      if (!person.materials.includes(node.material)) node.material?.dispose?.();
    }
    if (node.isLineSegments) {
      node.geometry?.dispose?.();
      node.material?.dispose?.();
    }
  });
  person.materials.forEach((material) => material.dispose());
  person.root.removeFromParent();
}

function modeFor(value) {
  return LENS_MODES.has(value) ? value : "world";
}

/**
 * A renderer-only adapter for projected `person-profile` entities. Every mesh
 * derives from SIMFABRIC's local simulation envelope; clicking or hovering it
 * can only produce a local intent in the host renderer.
 */
export function createPersonOrganisms({ parent, raycastTargets, isMobile = false }) {
  const layer = new THREE.Group();
  layer.name = "Person Ω — projected visual genomes";
  parent.add(layer);
  const people = new Map();
  const populationCenter = new THREE.Vector3(0, 0.25, 1.0);

  function syncProjection(projection) {
    const entities = Array.isArray(projection?.entities) ? projection.entities : [];
    const profiles = entities.filter(
      (entity) =>
        entity?.type === "person-profile" &&
        presentationFor(entity).kind === "person-organism",
    );
    const activeIds = new Set(profiles.map(({ id }) => id));

    people.forEach((person, id) => {
      if (!activeIds.has(id)) {
        disposePerson(person, raycastTargets);
        people.delete(id);
      }
    });

    profiles.forEach((entity) => {
      const existing = people.get(entity.id);
      if (existing) {
        existing.entity = entity;
        existing.homePosition.copy(positionFor(entity));
        return;
      }
      const person = createPerson(entity, raycastTargets, { isMobile });
      layer.add(person.root);
      people.set(person.id, person);
    });
  }

  function resolvePerson(object) {
    return object?.userData?.person ?? null;
  }

  function defaultPersonId() {
    return people.keys().next().value ?? null;
  }

  function getFocusTarget(mode, personId) {
    const normalizedMode = modeFor(mode);
    const selected = people.get(personId) ?? people.get(defaultPersonId());
    if (normalizedMode === "detail" && selected) {
      // Match the detail-mode destination rather than the outgoing compact
      // population position, so a lens transition travels with the meaning.
      return layer.localToWorld(new THREE.Vector3(0, 0.76, 0.55));
    }
    if (normalizedMode === "population") {
      const target = new THREE.Vector3();
      layer.getWorldPosition(target);
      return target.add(populationCenter);
    }
    return new THREE.Vector3(0, 1.0, 0);
  }

  function update(dt, elapsed, { mode, selectedId, hoveredId, reducedMotion = false } = {}) {
    const normalizedMode = modeFor(mode);
    const selected = selectedId ?? defaultPersonId();
    const rate = reducedMotion ? 9 : 4.8;

    people.forEach((person) => {
      const isSelected = person.id === selected;
      const isHovered = person.id === hoveredId;
      const targetPosition = person.homePosition.clone();
      let targetScale = 1;

      if (normalizedMode === "world") {
        targetPosition.multiplyScalar(0.32).add(populationCenter);
        targetScale = isHovered ? 0.56 : 0.38;
      } else if (normalizedMode === "population") {
        targetPosition.multiplyScalar(1.16);
        targetScale = isHovered ? 1.12 : 0.9;
      } else if (isSelected) {
        targetPosition.set(0, 0.76, 0.55);
        targetScale = 1.55;
      } else {
        targetPosition.multiplyScalar(0.42).add(new THREE.Vector3(0, -0.05, 1.65));
        targetScale = 0.24;
      }

      if (isHovered) targetScale *= 1.08;
      person.root.position.lerp(targetPosition, 1 - Math.pow(0.001, dt * rate));
      const currentScale = person.root.scale.x;
      const nextScale = THREE.MathUtils.damp(currentScale, targetScale, rate, dt);
      person.root.scale.setScalar(nextScale);

      const movement = reducedMotion ? 0 : Math.sin(elapsed * 1.6 + person.id.length) * 0.035;
      person.body.position.y = movement + (isSelected && normalizedMode === "detail" ? 0.12 : 0);
      person.body.rotation.y += dt * (reducedMotion ? 0 : 0.15 + (person.id.length % 3) * 0.03);
      person.core.rotation.y -= dt * (reducedMotion ? 0 : 0.65);
      person.core.scale.setScalar(1 + (reducedMotion ? 0 : Math.sin(elapsed * 2.4) * 0.08));
      person.cells.forEach((cell, index) => {
        const base = cell.userData.basePosition;
        const phase = cell.userData.phase;
        cell.position.copy(base);
        if (!reducedMotion) {
          cell.position.y += Math.sin(elapsed * 1.35 + phase) * 0.045;
          cell.rotation.x += dt * (0.11 + (index % 3) * 0.04);
          cell.rotation.y += dt * (0.16 + (index % 4) * 0.035);
        }
        cell.scale.setScalar(1 + (isSelected && normalizedMode === "detail" ? 0.13 : 0));
      });
      person.consentRing.rotation.z += dt * (reducedMotion ? 0 : 0.3);
      person.consentRing.material.opacity = isSelected && normalizedMode === "detail" ? 0.92 : 0.42;
      person.halo.forEach((halo, index) => {
        halo.rotation.z += dt * (reducedMotion ? 0 : (index ? -0.14 : 0.18));
        halo.material.opacity = (isHovered ? 0.32 : 0.16) + (isSelected && normalizedMode === "detail" ? 0.18 : 0);
      });

      const detailAmount = normalizedMode === "detail" && isSelected ? 1 : isHovered ? 0.18 : 0;
      const currentDetailScale = person.detail.scale.x;
      person.detail.scale.setScalar(
        THREE.MathUtils.damp(currentDetailScale, Math.max(0.001, detailAmount), 8, dt),
      );
      person.detailCells.forEach((cell, index) => {
        const angle = index * (TAU / Math.max(person.detailCells.length, 1)) + elapsed * 0.22;
        const distance = 1.42 + index * 0.18;
        cell.position.set(
          Math.cos(angle) * distance,
          (index - (person.detailCells.length - 1) / 2) * 0.36,
          Math.sin(angle) * distance,
        );
        cell.rotation.y += dt * (reducedMotion ? 0 : 0.45);
      });
    });
  }

  function destroy() {
    people.forEach((person) => disposePerson(person, raycastTargets));
    people.clear();
    layer.removeFromParent();
  }

  return Object.freeze({
    syncProjection,
    update,
    resolvePerson,
    defaultPersonId,
    getFocusTarget,
    destroy,
    getPerson: (id) => people.get(id) ?? null,
    get count() {
      return people.size;
    },
  });
}
