import * as THREE from "../../vendor/three-r179.1/build/three.module.js";
import { TopologySurfaceObject } from "../render/topology-surface-object.js";
import {
  entitySemanticContent,
  geometryFamilyForKind,
  normalizeUniversalEntity,
} from "./universal-entity.js";

const FAMILY_SHAPE = Object.freeze({
  "contract-shell": "capsule",
  "slip-capsule": "capsule",
  "person-vessel": "capsule",
  "pool-ring": "torus",
  "position-spire": "irregular",
  "proof-crystal": "irregular",
  "ledger-block": "irregular",
  "room-shell": "torus",
  "message-fold": "open",
  "bot-orb": "irregular",
  "treasury-vault": "irregular",
  "market-ring": "torus",
  "event-orb": "sphere",
  "artifact-stone": "irregular",
  "token-coin": "cylinder",
  "gateway-ring": "torus",
  "media-orb": "sphere",
  "generic-body": "irregular",
});

const DEFAULT_PALETTE = Object.freeze({
  base: "#04131d",
  base2: "#071d28",
  ink: "#dffbff",
  muted: "#7ab5c2",
  cyan: "#55e8ff",
  gold: "#d9ae60",
  grid: "rgba(107,231,255,.12)",
});

const KIND_ACCENT = Object.freeze({
  contract: "#d9ae60",
  slip: "#85e6ff",
  contractor: "#ffd08a",
  person: "#ffc978",
  pool: "#78e8b5",
  position: "#ffb45e",
  proof: "#f2e7ff",
  ledger: "#8eeaff",
  room: "#b98cff",
  message: "#ff9fe5",
  bot: "#8aa8ff",
  treasury: "#d9ae60",
  market: "#78e8b5",
  event: "#ffb45e",
  artifact: "#ffdc82",
  token: "#72edb9",
  gateway: "#77f3d0",
  media: "#ff718f",
  generic: "#68e8ff",
});

function hexToNumber(value, fallback = 0x55e8ff) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace("#", "");
  const parsed = Number.parseInt(text, 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function deterministicWarp(geometry, amount = .08) {
  const position = geometry.getAttribute("position");
  if (!position) return geometry;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const wave = Math.sin(x * 2.31 + y * 1.77 + z * 2.09) * amount;
    const scale = 1 + wave;
    position.setXYZ(index, x * scale, y * (1 + wave * .72), z * scale);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function foldedMessageGeometry() {
  const geometry = new THREE.PlaneGeometry(2.35, 1.5, 28, 18);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const fold = Math.tanh(x * 2.4) * .15 + Math.sin(y * 2.8) * .05;
    const edgeLift = Math.pow(Math.min(1, Math.abs(x) / 1.175), 2) * .11;
    position.setZ(index, fold + edgeLift);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export function createGeometryForFamily(family) {
  switch (family) {
    case "contract-shell": {
      const geometry = new THREE.CapsuleGeometry(.82, 1.22, 12, 32);
      geometry.rotateZ(Math.PI / 2);
      geometry.scale(1.34, 1, .62);
      return geometry;
    }
    case "slip-capsule": {
      const geometry = new THREE.CapsuleGeometry(.44, .84, 8, 24);
      geometry.rotateZ(Math.PI / 2);
      geometry.scale(1.2, .86, .55);
      return geometry;
    }
    case "person-vessel":
      return new THREE.CapsuleGeometry(.68, 1.2, 12, 28);
    case "pool-ring":
      return new THREE.TorusGeometry(1.2, .34, 32, 96);
    case "position-spire":
      return new THREE.ConeGeometry(.9, 1.95, 36, 12, false);
    case "proof-crystal":
      return deterministicWarp(new THREE.OctahedronGeometry(1.08, 3), .045);
    case "ledger-block":
      return new THREE.BoxGeometry(1.8, 1.8, 1.8, 10, 10, 10);
    case "room-shell": {
      const geometry = new THREE.TorusGeometry(1.28, .22, 28, 96);
      geometry.rotateX(Math.PI / 2);
      return geometry;
    }
    case "message-fold":
      return foldedMessageGeometry();
    case "bot-orb":
      return deterministicWarp(new THREE.IcosahedronGeometry(1.06, 3), .055);
    case "treasury-vault":
      return deterministicWarp(new THREE.DodecahedronGeometry(1.08, 2), .04);
    case "market-ring":
      return new THREE.TorusGeometry(1.22, .3, 30, 104);
    case "event-orb":
      return new THREE.SphereGeometry(1.08, 48, 32);
    case "artifact-stone":
      return deterministicWarp(new THREE.IcosahedronGeometry(1.12, 3), .095);
    case "token-coin": {
      const geometry = new THREE.CylinderGeometry(1.0, 1.0, .38, 48, 8, false);
      geometry.rotateZ(Math.PI / 2);
      return geometry;
    }
    case "gateway-ring": {
      const geometry = new THREE.TorusGeometry(1.25, .16, 26, 110);
      geometry.rotateY(Math.PI / 2);
      return geometry;
    }
    case "media-orb":
      return new THREE.SphereGeometry(1.08, 48, 30);
    case "generic-body":
    default:
      return deterministicWarp(new THREE.IcosahedronGeometry(1.04, 2), .065);
  }
}

export function shapeForGeometryFamily(family) {
  return FAMILY_SHAPE[family] ?? "irregular";
}

function paletteForEntity(entity, basePalette = DEFAULT_PALETTE) {
  const accent = entity.accent ?? KIND_ACCENT[entity.kind] ?? KIND_ACCENT.generic;
  const accentNumber = hexToNumber(accent);
  const accentColor = new THREE.Color(accentNumber);
  const gold = new THREE.Color(0xd9ae60).lerp(accentColor, .24);
  const base = new THREE.Color(0x04131d).lerp(accentColor, .055);
  const base2 = new THREE.Color(0x071d28).lerp(accentColor, .09);
  return {
    ...basePalette,
    base: `#${base.getHexString()}`,
    base2: `#${base2.getHexString()}`,
    cyan: `#${accentColor.getHexString()}`,
    gold: `#${gold.getHexString()}`,
  };
}

export class UniversalRenderedEntity {
  constructor({
    entity,
    atlasSize = 768,
    topologyOptions = {},
    palette = DEFAULT_PALETTE,
    enableDisplacement = true,
  } = {}) {
    this.entity = normalizeUniversalEntity(entity);
    this.geometryFamily = this.entity.geometryFamily || geometryFamilyForKind(this.entity.kind);
    this.geometry = createGeometryForFamily(this.geometryFamily);
    this.placeholderMaterial = new THREE.MeshBasicMaterial({ color: 0x07131d });
    this.mesh = new THREE.Mesh(this.geometry, this.placeholderMaterial);
    this.mesh.name = `universal:${this.entity.id}`;
    this.mesh.userData.universalEntityId = this.entity.id;
    this.mesh.userData.universalKind = this.entity.kind;
    this.mesh.userData.geometryFamily = this.geometryFamily;

    this.surface = new TopologySurfaceObject({
      id: this.entity.id,
      mesh: this.mesh,
      shape: shapeForGeometryFamily(this.geometryFamily),
      content: entitySemanticContent(this.entity),
      palette: paletteForEntity(this.entity, palette),
      atlasSize,
      enableDisplacement,
      topologyOptions: {
        seamAngle: Math.PI / 7,
        curvatureThreshold: .02,
        ...topologyOptions,
      },
    });
    this.placeholderMaterial.dispose();

    this.mesh.userData.universalSurface = this.surface;
    this.mesh.userData.topologySummary = this.surface.topologySummary;
    this.disposed = false;
  }

  update(entityInput) {
    if (this.disposed) return false;
    const next = normalizeUniversalEntity(entityInput);
    const nextFamily = next.geometryFamily || geometryFamilyForKind(next.kind);
    if (nextFamily !== this.geometryFamily) return false;

    this.entity = next;
    this.mesh.userData.universalEntityId = next.id;
    this.mesh.userData.universalKind = next.kind;
    const blocks = entitySemanticContent(next);
    const byId = new Map(blocks.map(block => [block.id, block]));
    for (const region of this.surface.regions) {
      const block = byId.get(region.id);
      if (!block) continue;
      this.surface.updateContent(region.id, {
        label: block.label,
        value: block.value,
        action: block.action,
        priority: block.priority,
        state: block.state,
        kind: block.kind,
      });
    }
    return true;
  }

  focus(regionId = null) {
    this.surface.focus(regionId);
  }

  updateFrame({ camera = null, viewportHeight = 900, time = 0, budget = 1 } = {}) {
    if (this.disposed) return;
    if (camera) this.surface.updateLod({
      camera,
      viewportHeight,
      focused: Boolean(this.surface.focusedRegionId),
      budget,
    });
    this.surface.update(time);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.surface.dispose();
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}

export class UniversalObjectRenderer {
  constructor({
    atlasSize = 768,
    topologyOptions = {},
    palette = DEFAULT_PALETTE,
    enableDisplacement = true,
  } = {}) {
    this.atlasSize = atlasSize;
    this.topologyOptions = { ...topologyOptions };
    this.palette = { ...palette };
    this.enableDisplacement = enableDisplacement;
    this.objects = new Map();
  }

  create(entityInput) {
    const entity = normalizeUniversalEntity(entityInput);
    const existing = this.objects.get(entity.id);
    if (existing) return existing;

    const rendered = new UniversalRenderedEntity({
      entity,
      atlasSize: this.atlasSize,
      topologyOptions: this.topologyOptions,
      palette: this.palette,
      enableDisplacement: this.enableDisplacement,
    });
    this.objects.set(entity.id, rendered);
    return rendered;
  }

  upsert(entityInput) {
    const entity = normalizeUniversalEntity(entityInput);
    const existing = this.objects.get(entity.id);
    if (!existing) return this.create(entity);
    if (existing.update(entity)) return existing;
    existing.dispose();
    this.objects.delete(entity.id);
    return this.create(entity);
  }

  get(id) {
    return this.objects.get(String(id)) ?? null;
  }

  remove(id) {
    const key = String(id);
    const rendered = this.objects.get(key);
    if (!rendered) return false;
    rendered.dispose();
    this.objects.delete(key);
    return true;
  }

  tick({ camera = null, viewportHeight = 900, time = 0, budget = 1 } = {}) {
    for (const rendered of this.objects.values()) {
      rendered.updateFrame({ camera, viewportHeight, time, budget });
    }
  }

  dispose() {
    for (const rendered of this.objects.values()) rendered.dispose();
    this.objects.clear();
  }
}

export function createUniversalObjectRenderer(options = {}) {
  return new UniversalObjectRenderer(options);
}
