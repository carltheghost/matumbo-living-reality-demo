import {
  BLOCK_TYPES,
  BLOCK_WORLD_PORTAL_ROUTE_REGISTRY,
  BLOCK_WORLD_SOURCE,
  BLOCK_WORLD_UPDATED_AT,
  createBlockWorldContribution,
  createBlockWorldDraft,
  createBlockWorldDirectManipulationDraft,
  createBlockWorldGrabDraft,
  createBlockWorldHoldDraft,
  createBlockWorldInteractionDraft,
  createBlockWorldNavigationDraft,
  createBlockWorldPlaceDraft,
  inspectBlockWorldBlock,
} from "../domains/block-world.js";
import { previewBlockMigrationSnapshot } from "../domains/block-migration.js";
import {
  MANIPULATE_MODE_LABELS,
  MANIPULATE_MODES,
  createManipulateControls,
} from "./manipulate-controls.js";

const freeze = (value) => Object.freeze(value);

export const BLOCK_WORLD_DIRECT_DRAG_THRESHOLD_PX = 18;
export const BLOCK_WORLD_PROXIMITY_RADIUS = 14;
// Proximity presentation is dormant while the viewer is still outside the
// cube field. It wakes only when the camera approaches the field's nearest
// cube, which keeps the launch view stable and makes the city/skyscraper
// scatter feel like a response to entering a district rather than a default
// layout mutation.
export const BLOCK_WORLD_PROXIMITY_APPROACH_RADIUS = 15.5;

// Openable containers use a compact cube signal rather than a bright accent
// marker. The signal is deliberately separated from the owning cube so it is
// legible at a glance without touching the shell or becoming a second
// interaction target.
export const BLOCK_WORLD_CONTAINER_SIGNAL_COLOR = 0x8f122d;
export const BLOCK_WORLD_CONTAINER_SIGNAL_EMISSIVE = 0xf02c4a;
export const BLOCK_WORLD_CONTAINER_SIGNAL_INTENSITY = 3.4;
export const BLOCK_WORLD_CONTAINER_SIGNAL_OFFSET_Y = 1.22;
export const BLOCK_WORLD_CONTAINER_SIGNAL_BOUNDARY = "Deep-red cube signal only; it is a non-interactive renderer cue and carries no separate block state.";

// A gaze lock is a renderer-only edge cue on the existing cube. It is kept
// separate from the container signal so a user can tell the difference between
// "this cube can open" and "your supported host is currently looking at this
// cube" without introducing another semantic object or raycast target.
export const BLOCK_WORLD_GAZE_LOCK_SOURCE = "gaze-hand-coupling";
export const BLOCK_WORLD_GAZE_LOCK_COLOR = 0xff3150;
export const BLOCK_WORLD_GAZE_LOCK_BOUNDARY = "Short-lived red edge cue for a fresh supported-host gaze lock; presentation only, no new block state, sensor data, persistence, network, wallet, token, settlement, or external execution.";

// Semantic depth is a reversible projection mode. W and V are derived local
// axes, never extra canonical coordinates: W reflects nested-content depth and
// V reflects linked-neighbor degree (grid adjacency plus parent/content links).
export const BLOCK_WORLD_SEMANTIC_DEPTH_MODES = Object.freeze(["3d", "4d", "5d"]);
export const BLOCK_WORLD_SEMANTIC_DEPTH_MODE = "3d";
export const BLOCK_WORLD_SEMANTIC_DEPTH_BOUNDARY = "3-D projection of semantic dimensions only: W = nested-content depth and V = linked-neighbor degree. 4-D / 5-D labels are view modes, not physical dimensions or canonical coordinates.";
export const BLOCK_WORLD_SEMANTIC_DEPTH_PROJECTION = Object.freeze({
  "3d": Object.freeze({ w: 0, v: 0 }),
  "4d": Object.freeze({ w: 0.42, v: 0 }),
  "5d": Object.freeze({ w: 0.42, v: 0.34 }),
});

/**
 * Deterministic presentation scatter used by the city/skyscraper lens. The
 * block id is hashed instead of using random state, so returning the camera to
 * the same place always returns the same cubes to the same visual offsets.
 * This is a renderer transform only; canonical coordinates never change.
 */
export function getBlockWorldProximityScatter(blockId, amount = 1) {
  const source = String(blockId ?? "block-world");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const safeAmount = Number.isFinite(Number(amount)) ? Math.max(0, Math.min(1, Number(amount))) : 0;
  const angle = (hash % 6283) / 1000;
  const vertical = (((hash >>> 8) % 2000) / 1000) - 1;
  return Object.freeze({
    x: Math.cos(angle) * safeAmount,
    y: vertical * 0.35 * safeAmount,
    z: Math.sin(angle) * safeAmount,
  });
}

export const BLOCK_WORLD_PRESENTATION_BOUNDARY = "Hover previews, nested-content focus, and city/skyscraper proximity scatter are reversible renderer presentation only; canonical coordinates, parent selection/open state, edits, persistence, network, wallet, and external execution remain unchanged.";

// Open containers expose their nested blocks on a short, deterministic
// front-facing rail.  Keeping this as a pure renderer transform means the
// canonical block draft remains the only semantic state while the contents
// visibly step beyond the shell in the Three.js layer.
export const BLOCK_WORLD_CONTAINER_PEEK_FRONT = 0.62;
export const BLOCK_WORLD_CONTAINER_PEEK_LIFT = 0.72;
export const BLOCK_WORLD_CONTAINER_PEEK_LANE = 0.34;
// Open contents fan across a shallow, viewer-facing arc. These are renderer
// values only: the canonical nested-content offset remains untouched and the
// fan never creates another block coordinate.
export const BLOCK_WORLD_CONTAINER_BLOOM_RADIUS = 0.42;
export const BLOCK_WORLD_CONTAINER_BLOOM_ANGLE = 0.46;

// Nested-content focus is a renderer-only address into the selected
// container's existing `contents` array. It deliberately does not promote a
// content entry to a canonical block, mint another ID, or add a second state
// store. The parent block remains the selected/movable/grabbable cube.
export const BLOCK_WORLD_CONTENT_NAVIGATION_SOURCE = "block-world-content-navigation";
export const BLOCK_WORLD_CONTENT_NAVIGATION_BOUNDARY = "Nested content focus reads existing container contents only; it is a local renderer selection with no new block IDs, edits, persistence, network, wallet, transfer, or execution authority.";

/**
 * Resolve one existing content entry by its canonical content id or index.
 * The returned record is immutable presentation metadata and retains the
 * owning block as the only parent/interaction target.
 */
export function resolveBlockWorldContent(block, target = null) {
  if (!block || typeof block.id !== "string") return null;
  const contents = asArray(block.contents);
  if (!contents.length) return null;
  const targetId = typeof target === "string"
    ? target
    : typeof target?.contentId === "string"
      ? target.contentId
      : typeof target?.id === "string"
        ? target.id
        : null;
  const targetIndex = Number.isInteger(target)
    ? target
    : Number.isInteger(target?.index)
      ? target.index
      : -1;
  const index = targetId
    ? contents.findIndex((content) => content?.id === targetId)
    : targetIndex >= 0 && targetIndex < contents.length
      ? targetIndex
      : -1;
  if (index < 0) return null;
  const content = contents[index];
  if (!content || typeof content.id !== "string") return null;
  return freeze({
    parentBlockId: block.id,
    parentBlock: block,
    contentId: content.id,
    content,
    index,
    count: contents.length,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    persistence: false,
    executable: false,
    boundary: BLOCK_WORLD_CONTENT_NAVIGATION_BOUNDARY,
  });
}

/** Cycle within one parent's existing content array, wrapping at either end. */
export function cycleBlockWorldContent(block, current = null, direction = "next") {
  const contents = asArray(block?.contents);
  if (!contents.length) return null;
  const step = direction === "previous" || direction === "prev" ? -1 : 1;
  const currentRecord = resolveBlockWorldContent(block, current);
  const currentIndex = currentRecord?.index ?? (step > 0 ? -1 : 0);
  const index = (currentIndex + step + contents.length) % contents.length;
  return resolveBlockWorldContent(block, index);
}

/**
 * Resolve a nested content record to its cube-only peek offset.
 *
 * The source `offset` is retained as a small influence on the rendered
 * position, while the lane/front/lift terms guarantee that content clears the
 * open shell rather than hiding inside it.  This is presentation metadata only
 * and deliberately returns no mutable or semantic world state.
 */
export function getBlockWorldContainerPeekOffset(content = {}, index = 0, count = 1) {
  const sourceOffset = Array.isArray(content?.offset) && content.offset.length === 3
    ? content.offset
    : [0, Number(index) + 1, 0];
  const offset = sourceOffset.map((value) => Number.isFinite(Number(value)) ? Number(value) : 0);
  const safeIndex = Number.isFinite(Number(index)) ? Math.max(0, Number(index)) : 0;
  const safeCount = Number.isFinite(Number(count)) ? Math.max(1, Number(count)) : 1;
  const lane = (safeIndex - (safeCount - 1) / 2) * BLOCK_WORLD_CONTAINER_PEEK_LANE;
  const centeredIndex = safeIndex - (safeCount - 1) / 2;
  const fanAngle = centeredIndex * BLOCK_WORLD_CONTAINER_BLOOM_ANGLE;
  const fanRadius = BLOCK_WORLD_CONTAINER_BLOOM_RADIUS + Math.min(4, safeCount - 1) * 0.045;
  return Object.freeze({
    // Spread contents across a shallow front-facing arc so nested cubes read
    // like petals opening from the shell instead of a static stack.
    x: Math.sin(fanAngle) * fanRadius + lane * 0.34 + offset[0] * 0.12,
    // Lift above the inset body and open lid; positive source Y keeps deeper
    // fixture content slightly higher without changing its semantic offset.
    y: BLOCK_WORLD_CONTAINER_PEEK_LIFT + Math.max(0, offset[1]) * 0.12,
    // Positive Z is the viewer-facing side of the focused cube world.
    z: BLOCK_WORLD_CONTAINER_PEEK_FRONT + Math.cos(fanAngle) * fanRadius + offset[2] * 0.12,
    bloom: Object.freeze({
      angle: Number(fanAngle.toFixed(6)),
      radius: Number(fanRadius.toFixed(6)),
      index: safeIndex,
      count: safeCount,
      presentationOnly: true,
    }),
  });
}

// A field double activation is intentionally stricter than a browser's
// default double-click gesture.  Pointer-up events are used instead of a
// native `dblclick` listener so mouse and touch can share the same bounded
// state machine without firing both paths for one gesture.
export const BLOCK_WORLD_DOUBLE_ACTIVATION_WINDOW_MS = 420;
export const BLOCK_WORLD_DOUBLE_ACTIVATION_DISTANCE_PX = 28;

/**
 * Convert a screen-space pointer/touch displacement into one deterministic
 * grid step. The focused Block World is intentionally planar for direct
 * manipulation: horizontal motion maps to X and vertical motion maps to Z.
 * Returning null below the threshold preserves ordinary click-to-select.
 */
export function mapBlockWorldDragDelta(start, end, threshold = BLOCK_WORLD_DIRECT_DRAG_THRESHOLD_PX) {
  const startX = Number(start?.clientX ?? start?.x);
  const startY = Number(start?.clientY ?? start?.y);
  const endX = Number(end?.clientX ?? end?.x);
  const endY = Number(end?.clientY ?? end?.y);
  const minDistance = Number(threshold);
  if (![startX, startY, endX, endY, minDistance].every(Number.isFinite) || minDistance < 0) return null;
  const dx = endX - startX;
  const dy = endY - startY;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < minDistance) return null;
  const horizontalStep = dx < 0 ? -1 : dx > 0 ? 1 : 0;
  const depthStep = dy < 0 ? -1 : dy > 0 ? 1 : 0;
  if (Math.abs(dx) >= Math.abs(dy)) return { dx: horizontalStep, dy: 0, dz: 0 };
  return { dx: 0, dy: 0, dz: depthStep };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function cloneSnapshot(value) {
  if (Array.isArray(value)) return freeze(value.map(cloneSnapshot));
  if (!value || typeof value !== "object") return value;
  return freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneSnapshot(entry)])));
}

function resolveBlockFromProjection(projection, target, fallback = null) {
  if (!projection || !Array.isArray(projection.blocks)) return null;
  if (typeof target === "string") {
    return projection.blocks.find((candidate) => candidate.id === target)
      ?? (projection.heldBlock?.id === target ? projection.heldBlock : null);
  }
  if (target?.id) {
    return projection.blocks.find((candidate) => candidate.id === target.id)
      ?? (projection.heldBlock?.id === target.id ? projection.heldBlock : null);
  }
  if (target && Number.isInteger(target.x) && Number.isInteger(target.y) && Number.isInteger(target.z)) {
    return projection.blocks.find((candidate) => candidate.x === target.x
      && candidate.y === target.y && candidate.z === target.z)
      ?? null;
  }
  return fallback;
}

function blockCoordinate(block) {
  if (!block || !Number.isInteger(block.x) || !Number.isInteger(block.y) || !Number.isInteger(block.z)) return null;
  return [block.x, block.y, block.z];
}

function clampUnit(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function coordinateKeyFromValues(x, y, z) {
  return `${x}:${y}:${z}`;
}

/**
 * Derive the local semantic axes used by the 4-D / 5-D presentation modes.
 * The returned W/V values are normalized renderer metadata; they never enter
 * the canonical block coordinate or draft state.
 */
export function getBlockWorldSemanticAxes(block, blocks = []) {
  const peers = asArray(blocks).filter((candidate) => candidate && typeof candidate.id === "string");
  const coordinate = blockCoordinate(block);
  const blockIdsByCoordinate = new Map(
    peers
      .map((candidate) => [blockCoordinate(candidate), candidate])
      .filter(([candidateCoordinate]) => candidateCoordinate)
      .map(([candidateCoordinate, candidate]) => [coordinateKeyFromValues(...candidateCoordinate), candidate]),
  );
  const adjacent = coordinate
    ? [
      [-1, 0, 0],
      [1, 0, 0],
      [0, -1, 0],
      [0, 1, 0],
      [0, 0, -1],
      [0, 0, 1],
    ]
      .map(([dx, dy, dz]) => blockIdsByCoordinate.get(coordinateKeyFromValues(coordinate[0] + dx, coordinate[1] + dy, coordinate[2] + dz)))
      .filter(Boolean)
    : [];
  const contents = asArray(block?.contents);
  const ownerBlockId = typeof block?.ownerBlockId === "string"
    ? block.ownerBlockId
    : typeof block?.parentBlockId === "string"
      ? block.parentBlockId
      : null;
  const nestedContentIds = contents
    .map((content) => (typeof content?.id === "string" ? content.id : null))
    .filter(Boolean);
  const nestedContentDepth = nestedContentIds.length
    ? Math.max(1, ...contents.map((content) => {
      const offsetY = Number(content?.offset?.[1]);
      return Number.isFinite(offsetY) ? Math.min(4, Math.max(1, Math.abs(offsetY))) : 1;
    }))
    : 0;
  const linkedNeighborDegree = adjacent.length + nestedContentIds.length + (ownerBlockId ? 1 : 0);
  const linkedBlockIds = [
    ...adjacent.map((candidate) => candidate.id),
    ...(ownerBlockId && blockIdsByCoordinate.size && peers.some((candidate) => candidate.id === ownerBlockId)
      ? [ownerBlockId]
      : []),
  ];
  return freeze({
    blockId: block?.id ?? null,
    coordinate,
    nestedContentDepth,
    nestedContentCount: nestedContentIds.length,
    nestedContentIds: freeze(nestedContentIds),
    linkedNeighborDegree,
    linkedBlockIds: freeze([...new Set(linkedBlockIds)]),
    parentBlockId: ownerBlockId,
    // W is content depth; V is a bounded degree over the six grid directions
    // plus parent/content links. Neither value is a world coordinate.
    w: clampUnit(nestedContentDepth / 3),
    v: clampUnit(linkedNeighborDegree / 6),
  });
}

/**
 * Build deterministic parent/content and six-way grid navigation links for a
 * block. Content entries point back to their owning block because nested
 * content is semantic metadata rather than an additional canonical block ID.
 */
export function getBlockWorldLinkedNeighbors(block, blocks = []) {
  const peers = asArray(blocks).filter((candidate) => candidate && typeof candidate.id === "string");
  const coordinate = blockCoordinate(block);
  const byCoordinate = new Map(
    peers
      .map((candidate) => [blockCoordinate(candidate), candidate])
      .filter(([candidateCoordinate]) => candidateCoordinate)
      .map(([candidateCoordinate, candidate]) => [coordinateKeyFromValues(...candidateCoordinate), candidate]),
  );
  const directionDefinitions = [
    { dx: -1, dy: 0, dz: 0, label: "left" },
    { dx: 1, dy: 0, dz: 0, label: "right" },
    { dx: 0, dy: -1, dz: 0, label: "down" },
    { dx: 0, dy: 1, dz: 0, label: "up" },
    { dx: 0, dy: 0, dz: -1, label: "forward" },
    { dx: 0, dy: 0, dz: 1, label: "back" },
  ];
  const links = [];
  if (coordinate) {
    directionDefinitions.forEach(({ dx, dy, dz, label }) => {
      const target = byCoordinate.get(coordinateKeyFromValues(coordinate[0] + dx, coordinate[1] + dy, coordinate[2] + dz));
      if (!target) return;
      links.push({
        blockId: target.id,
        coordinate: blockCoordinate(target),
        relation: "grid-adjacent",
        direction: label,
        linkedContentId: null,
      });
    });
  }
  asArray(block?.contents).forEach((content, index) => {
    links.push({
      blockId: block?.id ?? null,
      coordinate,
      relation: "parent-to-nested-content",
      direction: "inside",
      linkedContentId: typeof content?.id === "string" ? content.id : `${block?.id ?? "block"}/content:${index + 1}`,
      contentLabel: content?.label ?? `Nested cube ${index + 1}`,
    });
  });
  const ownerBlockId = typeof block?.ownerBlockId === "string"
    ? block.ownerBlockId
    : typeof block?.parentBlockId === "string"
      ? block.parentBlockId
      : null;
  if (ownerBlockId) {
    const owner = peers.find((candidate) => candidate.id === ownerBlockId);
    if (owner) {
      links.push({
        blockId: owner.id,
        coordinate: blockCoordinate(owner),
        relation: "nested-content-to-parent",
        direction: "out",
        linkedContentId: block.id ?? null,
        contentLabel: block?.label ?? "Nested cube",
      });
    }
  }
  if (!links.length) {
    // Keep navigation useful for isolated fixtures while preserving stable IDs
    // and coordinates. This fallback is still a local field link, not a new
    // canonical relationship.
    peers
      .filter((candidate) => candidate.id !== block?.id)
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, 1)
      .forEach((target) => links.push({
        blockId: target.id,
        coordinate: blockCoordinate(target),
        relation: "field-fallback",
        direction: "next",
        linkedContentId: null,
      }));
  }
  return freeze(links.map((link) => freeze({
    ...link,
    coordinate: link.coordinate ? freeze([...link.coordinate]) : null,
  })));
}

function normalizeSemanticDepthMode(mode) {
  const candidate = typeof mode === "string" ? mode.trim().toLowerCase() : "";
  return BLOCK_WORLD_SEMANTIC_DEPTH_MODES.includes(candidate)
    ? candidate
    : BLOCK_WORLD_SEMANTIC_DEPTH_MODE;
}

/** Return the reversible renderer offset for one semantic-depth mode. */
export function getBlockWorldSemanticDepthOffset(axes = {}, mode = BLOCK_WORLD_SEMANTIC_DEPTH_MODE) {
  const normalizedMode = normalizeSemanticDepthMode(mode);
  const w = clampUnit(axes?.w);
  const v = clampUnit(axes?.v);
  const projection = BLOCK_WORLD_SEMANTIC_DEPTH_PROJECTION[normalizedMode];
  return freeze({
    mode: normalizedMode,
    w,
    v,
    x: w * projection.w - v * projection.v,
    y: w * projection.w * 0.68 + v * projection.v,
    z: w * projection.w * 0.52 + v * projection.v * 0.48,
    projectionOnly: true,
    canonicalUnchanged: true,
  });
}

function migrationContinuityRecord(block, method = "selection", status = "available") {
  const coordinate = blockCoordinate(block);
  if (!block || typeof block.id !== "string" || !coordinate) return null;
  return cloneSnapshot({
    source: BLOCK_WORLD_MIGRATION_SOURCE,
    kind: "block-world-migration-continuity",
    action: "preserve-selection",
    method,
    status,
    blockId: block.id,
    coordinate,
    blockType: block.blockType ?? null,
    localOnly: true,
    simulation: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  });
}

function resolveMigrationContinuityBlock(projection, continuity) {
  if (!continuity || typeof continuity !== "object") return null;
  const blocks = asArray(projection?.blocks);
  if (!blocks.length) return null;
  if (typeof continuity.blockId === "string") {
    const byId = blocks.find((block) => block?.id === continuity.blockId);
    if (byId) return byId;
  }
  const coordinate = continuity.coordinate;
  if (!Array.isArray(coordinate) || coordinate.length !== 3 || !coordinate.every(Number.isInteger)) return null;
  return blocks.find((block) => (
    block?.x === coordinate[0]
      && block?.y === coordinate[1]
      && block?.z === coordinate[2]
  )) ?? null;
}

function contributionFrom(projection) {
  if (projection?.source === BLOCK_WORLD_SOURCE) return projection;
  return asArray(projection?.contributions).find((contribution) => contribution?.source === BLOCK_WORLD_SOURCE) ?? null;
}

export function summarizeBlockWorld(projection) {
  const contribution = contributionFrom(projection) ?? createBlockWorldContribution();
  const blocks = asArray(contribution.blocks ?? contribution.entities);
  const counts = blocks.reduce((result, block) => {
    result[block.blockType] = (result[block.blockType] ?? 0) + 1;
    return result;
  }, {});
  const containers = blocks.filter((block) => block.container === true);
  return cloneSnapshot({
    source: BLOCK_WORLD_SOURCE,
    schemaVersion: contribution.schemaVersion ?? 1,
    kind: contribution.kind ?? "semantic-block-world-projection",
    worldId: contribution.worldId ?? "block-world:living-reality",
    updatedAt: contribution.updatedAt ?? BLOCK_WORLD_UPDATED_AT,
    deterministic: contribution.deterministic !== false,
    dimensions: contribution.dimensions ?? { width: 9, depth: 9, height: 5 },
    blocks,
    blockCount: blocks.length,
    containerCount: containers.length,
    openContainerCount: containers.filter((block) => block.open === true).length,
    nestedContentCount: blocks.reduce((count, block) => count + (Number.isInteger(block.contentCount) ? block.contentCount : asArray(block.contents).length), 0),
    interactive: true,
    localDraft: contribution.localDraft === true,
    editCount: Number.isSafeInteger(contribution.editCount) ? contribution.editCount : 0,
    lastEdit: contribution.lastEdit ?? null,
    provenance: contribution.provenance ?? {
      source: BLOCK_WORLD_SOURCE,
      version: 1,
      basis: "semantic-block-fabric local fixture",
      deterministicKey: `${BLOCK_WORLD_SOURCE}:${contribution.worldId ?? "block-world:living-reality"}:v1`,
    },
    typeCounts: counts,
    evidence: asArray(contribution.evidence),
    capabilities: asArray(contribution.capabilities),
    boundary: "Block edits, open/close, movement, and inspection are local drafts or reads only. No filesystem import, network sync, wallet, asset transfer, persistence, or external execution is active.",
  });
}

export const BLOCK_WORLD_MIGRATION_SOURCE = "block-world-migration-bridge";
export const BLOCK_MIGRATION_TRACE_SOURCE = BLOCK_WORLD_MIGRATION_SOURCE;

function finiteInteger(value) {
  return Number.isFinite(value) && Number.isInteger(value);
}

function textOrNull(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function migrationEntries(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== "object") {
    throw new TypeError("migration edits must be an array or an object containing safe patches");
  }
  // A full block-migration preview carries both `mappings` (including
  // deferred rows) and `draftPatches` (safe rows only). Prefer the former so
  // the bridge can make the deferred boundary visible in its returned trace.
  if (input.source === "block-migration-preview" && Array.isArray(input.mappings)) {
    return input.mappings;
  }
  const candidates = [input.draftPatches, input.edits, input.blockEdits, input.mappings, input.entries];
  const nested = input.draft && typeof input.draft === "object"
    ? [input.draft.blockEdits, input.draft.patches, input.draft.edits]
    : [];
  const found = [...candidates, ...nested].find(Array.isArray);
  if (!found) throw new TypeError("migration edits must contain a patch array");
  return found;
}

function migrationMappingId(patch, index) {
  return textOrNull(
    patch?.mappingId
      ?? patch?.sourceId
      ?? patch?.legacyId
      ?? patch?.id,
  ) ?? `migration-edit-${index + 1}`;
}

function migrationDeferred(patch) {
  return patch?.safeToApply === false
    || patch?.status === "deferred"
    || patch?.mappingStatus === "deferred"
    || patch?.action === "defer"
    || patch?.block === null;
}

function migrationCoordinate(patch, index) {
  const coordinate = patch?.coordinate
    ?? patch?.block?.coordinate
    ?? patch?.draftPatch?.coordinate
    ?? patch?.draftPatch?.block?.coordinate
    ?? [patch?.x, patch?.y, patch?.z];
  if (!Array.isArray(coordinate) || coordinate.length !== 3 || !coordinate.every(finiteInteger)) {
    throw new TypeError(`migration patch ${index + 1} needs a finite integer [x, y, z] coordinate`);
  }
  return [...coordinate];
}

function migrationType(patch, index) {
  const type = textOrNull(
    patch?.blockType
      ?? patch?.type
      ?? patch?.block?.blockType
      ?? patch?.draftPatch?.blockType
      ?? patch?.draftPatch?.type
      ?? patch?.draftPatch?.block?.blockType,
  );
  if (!type || !Object.prototype.hasOwnProperty.call(BLOCK_TYPES, type)) {
    throw new TypeError(`migration patch ${index + 1} has an unsupported block type`);
  }
  return type;
}

function inBounds(coordinate, dimensions) {
  const [x, y, z] = coordinate;
  return x >= 0 && x < dimensions.width
    && y >= 0 && y < dimensions.height
    && z >= 0 && z < dimensions.depth;
}

function migrationSnapshot(value) {
  return cloneSnapshot({
    ...value,
    source: value?.source ?? BLOCK_MIGRATION_TRACE_SOURCE,
    localOnly: true,
    simulation: true,
    externalImport: false,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  });
}

function makeText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

/**
 * Mount the small voxel/block layer and its local edit console. The adapter
 * intentionally keeps draft state separate from SIMFABRIC's canonical source.
 */
export function createBlockWorldLayer({
  documentRoot = globalThis.document,
  three = globalThis.THREE,
  parent = null,
  raycastTargets = [],
  projection = null,
  isMobile = false,
  reducedMotion = false,
  onSelect = null,
  onEdit = null,
  onReplay = null,
  onOpen = null,
  onMove = null,
  onInspect = null,
  onContentSelect = null,
  onGrab = null,
  onHold = null,
  onPlace = null,
  onDirectManipulation = null,
  onNavigate = null,
  onPortalNavigate = null,
  onRoute = null,
  onFeatureNavigate = null,
  onDistributionNavigate = null,
  onMigrationOpen = null,
  // Free 3D gizmo manipulation (additive, 2026-09-18). The TransformControls
  // class is injected by the host so this module stays Node-testable; when it
  // is absent the manipulator degrades to blocked no-op snapshots.
  TransformControlsClass = null,
  camera = null,
  domElement = null,
  onManipulatorDraggingChange = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Block world needs a document-like owner");
  const panel = documentRoot.getElementById("block-world-console");
  const closeButton = documentRoot.getElementById("block-world-close");
  const replayButton = documentRoot.getElementById("block-world-replay");
  const addButton = documentRoot.getElementById("block-world-add");
  const removeButton = documentRoot.getElementById("block-world-remove");
  const replaceButton = documentRoot.getElementById("block-world-replace");
  const openButton = documentRoot.getElementById("block-world-open");
  const inspectButton = documentRoot.getElementById("block-world-inspect");
  const moveLeftButton = documentRoot.getElementById("block-world-move-left");
  const moveRightButton = documentRoot.getElementById("block-world-move-right");
  const moveForwardButton = documentRoot.getElementById("block-world-move-forward");
  const moveBackButton = documentRoot.getElementById("block-world-move-back");
  const moveUpButton = documentRoot.getElementById("block-world-move-up");
  const moveDownButton = documentRoot.getElementById("block-world-move-down");
  const grabButton = documentRoot.getElementById("block-world-grab");
  const holdLeftButton = documentRoot.getElementById("block-world-hold-left");
  const holdRightButton = documentRoot.getElementById("block-world-hold-right");
  const holdForwardButton = documentRoot.getElementById("block-world-hold-forward");
  const holdBackButton = documentRoot.getElementById("block-world-hold-back");
  const holdUpButton = documentRoot.getElementById("block-world-hold-up");
  const holdDownButton = documentRoot.getElementById("block-world-hold-down");
  const placeButton = documentRoot.getElementById("block-world-place");
  const migrationButton = documentRoot.getElementById("block-world-migration-open");
  const migrationStatusEl = documentRoot.getElementById("block-world-migration-status");
  const routeListEl = documentRoot.getElementById("block-world-routes");
  const navigationStatusEl = documentRoot.getElementById("block-world-navigation-status");
  const navigationTraceEl = documentRoot.getElementById("block-world-navigation-trace");
  const statusEl = documentRoot.getElementById("block-world-status");
  const countEl = documentRoot.getElementById("block-world-count");
  const draftEl = documentRoot.getElementById("block-world-draft-count");
  const containerCountEl = documentRoot.getElementById("block-world-container-count");
  const contentCountEl = documentRoot.getElementById("block-world-content-count");
  const selectionEl = documentRoot.getElementById("block-world-selection");
  const listEl = documentRoot.getElementById("block-world-list");
  const paletteEl = documentRoot.getElementById("block-world-palette");
  const traceEl = documentRoot.getElementById("block-world-trace");
  const boundaryEl = documentRoot.getElementById("block-world-boundary");
  const proximityStatusEl = documentRoot.getElementById("block-world-proximity-status");
  const depthStatusEl = documentRoot.getElementById("block-world-depth-status");
  const depthBoundaryEl = documentRoot.getElementById("block-world-depth-boundary");
  const depthModeButtons = new Map(
    ["3d", "4d", "5d"]
      .map((mode) => [mode, documentRoot.getElementById(`block-world-depth-${mode}`)])
      .filter(([, button]) => button),
  );
  const linkedPreviousButton = documentRoot.getElementById("block-world-linked-previous");
  const linkedNextButton = documentRoot.getElementById("block-world-linked-next");
  const linkedNavigationStatusEl = documentRoot.getElementById("block-world-linked-navigation-status");
  const linkedNavigationTraceEl = documentRoot.getElementById("block-world-linked-navigation-trace");
  const inspectionEl = documentRoot.getElementById("block-world-inspection");
  const containerHintEl = documentRoot.getElementById("block-world-container-hint");
  let featureRailEl = documentRoot.getElementById("block-world-feature-rail");
  const contentsEl = documentRoot.getElementById("block-world-contents");
  const contentFocusEl = documentRoot.getElementById("block-world-content-focus");
  const contentPreviousButton = documentRoot.getElementById("block-world-content-previous");
  const contentNextButton = documentRoot.getElementById("block-world-content-next");
  const contentNavigationStatusEl = documentRoot.getElementById("block-world-content-navigation-status");
  if (!panel || !closeButton || !replayButton || !addButton || !removeButton || !replaceButton || !statusEl || !listEl || !paletteEl || !traceEl) {
    throw new Error("Block world console mount points are missing");
  }

  // The cube layer is deliberately useful even when the host cannot create a
  // Three.js scene (for example, a browser with WebGL disabled).  Keep that
  // state explicit so a static DOM control surface is never mistaken for a
  // rendered 3-D world.
  const renderMode = three && parent ? "webgl-cubes" : "static-controls";
  const staticFallback = renderMode === "static-controls";
  panel.dataset ??= {};
  panel.dataset.renderMode = renderMode;
  panel.dataset.staticFallback = String(staticFallback);

  // The three option names are compatibility aliases for hosts that adopted
  // the portal seam at different times. Pick one callback so a single click
  // can never emit the same hand-off three times.
  const navigateCallback = onNavigate ?? onPortalNavigate ?? onRoute;

  let currentProjection = summarizeBlockWorld(projection);
  let featureInventory = [];
  let distributionCohorts = [];
  let hoveredFeatureId = null;
  let canonicalProjection = currentProjection;
  let selectedId = currentProjection.blocks[Math.floor(currentProjection.blocks.length / 2)]?.id ?? null;
  let hoveredId = null;
  // `contentFocus` is an address into the selected parent block's immutable
  // contents. It never replaces selectedId, so parent movement/open/close and
  // carry operations keep their existing ownership and guards.
  let contentFocus = null;
  let hoveredContent = null;
  let opened = panel.hidden !== true;
  let trace = [];
  let navigationTrace = [];
  let lastNavigation = null;
  let migrationTrace = [];
  let migrationBridgeOpen = false;
  // The migration bridge keeps one renderer-only selection handoff so a
  // return or replay can re-anchor by stable id first and coordinate second.
  // This is deliberately separate from canonical/local block data.
  let migrationContinuity = null;
  let migrationContinuityStatus = "none";
  let selectedPalette = "crystal";
  let directManipulation = null;
  // Free 3D gizmo manipulation (additive, 2026-09-18). `manipulateMode` arms
  // the TransformControls gizmo; the manipulator instance owns attach/detach
  // and reports release transforms back for projection-record write-back.
  let manipulateMode = null;
  let hoverPreview = null;
  let semanticDepthMode = BLOCK_WORLD_SEMANTIC_DEPTH_MODE;
  let semanticDepthAxes = new Map();
  let semanticDepthOffsets = new Map();
  let lastLinkedNavigation = null;
  let linkedNavigationTrace = [];
  let gazeLockedId = null;
  let gazeLockAction = "idle";
  let gazeLockPoint = null;
  let gazeLockExpiresAt = null;
  let gazeLockReason = "none";
  let proximityState = {
    enabled: false,
    mode: "city-skyscraper",
    radius: BLOCK_WORLD_PROXIMITY_RADIUS,
    cameraPosition: null,
    nearCount: 0,
    farCount: 0,
    scatteredCount: 0,
    culledCount: 0,
  };
  // Pointer-up taps are tracked only long enough to recognize an intentional
  // double activation. The candidate is discarded for drags, pointer
  // cancellation, different cubes, different pointer types, and stale taps.
  let lastFieldTap = null;
  let blockMeshes = new Map();
  let selectionCues = new Map();
  let gazeLockCues = new Map();
  let containerCues = new Map();
  let interactiveMeshes = new Set();
  let contentMeshes = [];
  let hoverPreviewMeshes = new Map();
  // A direct-drag preview is a transient renderer mesh only. It mirrors the
  // selected block while the existing begin/update/complete callbacks decide
  // whether the atomic domain move can be committed.
  let dragPreviewMesh = null;
  const pendingKeyboardActivations = new WeakSet();
  const layer = three && parent ? new three.Group() : null;
  if (layer) {
    layer.name = "semantic-block-world";
    layer.position.set(-3.8, -0.75, -3.2);
    parent.add(layer);
  }
  // The gizmo helper mounts into the same offset layer as the block meshes so
  // its world-space drags stay consistent with the cube field.
  const manipulator = createManipulateControls({
    TransformControlsClass,
    scene: layer,
    camera,
    domElement,
    isTouch: isMobile === true,
    onTransformEnd: (blockId, transform, context) => writeManipulatorTransform(blockId, transform, context),
    onDraggingChange: (isDragging, attachment) => {
      const object = attachment?.object ?? null;
      if (object && typeof object === "object" && object.userData) {
        object.userData.blockWorldGizmoDragging = isDragging === true;
      }
      onManipulatorDraggingChange?.(isDragging, attachment);
    },
  });
  // Gesture Lens external pointer source (additive, 2026-09-18). A pinch
  // "grab" raycasts the cube field at the normalized hand-proxy pose and
  // attaches the same gizmo that touch input uses; proxy moves, stretch,
  // twist, and fist-release then drive the attached object through the
  // identical write-back path. The camera preview (when enabled) is never
  // consulted — only the rehearsal proxy pose.
  function pickBlockAtGesturePose(pose = {}) {
    if (!three || typeof three.Raycaster !== "function" || !camera) return null;
    const x = Number(pose?.x);
    const y = Number(pose?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    try {
      const raycaster = new three.Raycaster();
      raycaster.setFromCamera({ x: x * 2 - 1, y: -(y * 2 - 1) }, camera);
      const targets = [...interactiveMeshes].filter((mesh) => mesh && mesh.visible !== false);
      if (!targets.length) return null;
      const hits = raycaster.intersectObjects(targets, false);
      const hit = hits?.[0]?.object ?? null;
      const blockId = hit?.userData?.blockWorldId ?? null;
      if (!hit || blockId == null || blockId === "") return null;
      return { object: blockMeshes.get(blockId) ?? hit, blockId };
    } catch {
      return null;
    }
  }
  manipulator.setExternalIntentSource({ pick: pickBlockAtGesturePose });

  /**
   * Route a gesture-lens intent event into the manipulation host. Every
   * external action is tagged in the manipulator trace; grabs resolve to a
   * cube only through the local raycast above.
   */
  function noteGestureIntent(event = {}) {
    const record = manipulator.applyExternalIntent(event);
    render();
    return record;
  }
  const geometry = three ? new three.BoxGeometry(0.78, 0.78, 0.78) : null;
  // Openable cubes get a slightly larger shell and a small floating cube
  // marker. Both are ordinary box geometry: the marker is deliberately not a
  // raycast target, so pointer selection and direct drag still resolve to the
  // stable body id below.
  const containerGeometry = three ? new three.BoxGeometry(0.9, 0.9, 0.9) : null;
  const containerCueGeometry = three ? new three.BoxGeometry(0.18, 0.18, 0.18) : null;
  const openGeometry = three ? new three.BoxGeometry(0.64, 0.64, 0.64) : null;
  const contentGeometry = three ? new three.BoxGeometry(0.28, 0.28, 0.28) : null;
  const lidGeometry = three ? new three.BoxGeometry(0.68, 0.14, 0.68) : null;
  // Selection is a field-level affordance, not a new semantic object. Keep
  // the cue cube-only by reusing edge geometry derived from each body shape;
  // it is a child of the owning mesh and never enters the raycast target set.
  const selectionEdges = {
    solid: three && typeof three.EdgesGeometry === "function" && geometry
      ? new three.EdgesGeometry(geometry)
      : null,
    container: three && typeof three.EdgesGeometry === "function" && containerGeometry
      ? new three.EdgesGeometry(containerGeometry)
      : null,
    open: three && typeof three.EdgesGeometry === "function" && openGeometry
      ? new three.EdgesGeometry(openGeometry)
      : null,
  };
  const selectionMaterial = three && typeof three.LineBasicMaterial === "function"
    ? new three.LineBasicMaterial({
      color: 0xffe39a,
      transparent: true,
      opacity: 0.94,
      depthTest: false,
      depthWrite: false,
    })
    : null;
  const gazeLockMaterial = three && typeof three.LineBasicMaterial === "function"
    ? new three.LineBasicMaterial({
      color: BLOCK_WORLD_GAZE_LOCK_COLOR,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    })
    : null;
  const materials = new Map();
  const contentMaterials = new Map();
  const dragPreviewMaterials = new Map();

  function setMigrationAffordance(isOpen) {
    const active = Boolean(isOpen);
    migrationBridgeOpen = active;
    migrationButton?.setAttribute?.("aria-expanded", String(active));
    if (migrationStatusEl) {
      migrationStatusEl.textContent = active
        ? "MIGRATION BRIDGE OPEN · LOCAL ONLY"
        : "MAP EARLIER IDEAS → CUBES · LOCAL ONLY";
    }
  }

  function rememberMigrationContinuity(block, method = "selection", status = "available") {
    const next = migrationContinuityRecord(block, method, status);
    if (!next) return null;
    migrationContinuity = next;
    migrationContinuityStatus = status;
    return next;
  }

  function continuitySnapshot(action, method, block = null, reason = null) {
    return cloneSnapshot({
      source: BLOCK_WORLD_MIGRATION_SOURCE,
      kind: "block-world-migration-continuity",
      action,
      method,
      status: migrationContinuityStatus,
      handoff: migrationContinuity,
      block: block ?? null,
      blockId: block?.id ?? migrationContinuity?.blockId ?? null,
      coordinate: blockCoordinate(block) ?? migrationContinuity?.coordinate ?? null,
      reason,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
  }

  function restoreMigrationContinuity(method = "return") {
    if (!migrationContinuity) {
      migrationContinuityStatus = "none";
      return continuitySnapshot("restore-selection", method, null, "no-handoff");
    }
    const block = resolveMigrationContinuityBlock(currentProjection, migrationContinuity);
    if (!block) {
      migrationContinuityStatus = "missing";
      migrationContinuity = cloneSnapshot({ ...migrationContinuity, status: "missing" });
      selectedId = null;
      if (manipulateMode) manipulator.detach("selection-cleared");
      render();
      return continuitySnapshot("restore-selection-blocked", method, null, "cube-not-found-in-current-draft");
    }
    selectedId = block.id;
    migrationContinuityStatus = "restored";
    migrationContinuity = migrationContinuityRecord(block, method, "restored");
    if (manipulateMode) syncManipulatorForSelection("restore-selection");
    render();
    return continuitySnapshot("restore-selection", method, block, null);
  }

  function acceptMigrationHandback(handoff, method = "migration-handback") {
    if (!handoff || typeof handoff !== "object") {
      migrationContinuityStatus = "missing";
      return continuitySnapshot("accept-handback-blocked", method, null, "invalid-handoff");
    }
    if (handoff.reason === "deferred-mapping" || handoff.coordinate === null) {
      migrationContinuityStatus = "deferred";
      migrationContinuity = cloneSnapshot({
        source: BLOCK_WORLD_MIGRATION_SOURCE,
        kind: "block-world-migration-continuity",
        action: "accept-handback-blocked",
        method,
        status: "deferred",
        blockId: handoff.blockId ?? null,
        coordinate: null,
        mappingId: handoff.mappingId ?? null,
        reason: handoff.reason ?? "deferred-mapping",
        localOnly: true,
        simulation: true,
        externalImport: false,
        importedCodeExecution: false,
        persistence: false,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
      });
      render();
      return continuitySnapshot("accept-handback-blocked", method, null, handoff.reason ?? "deferred-mapping");
    }
    const block = resolveMigrationContinuityBlock(currentProjection, {
      blockId: handoff.blockId,
      coordinate: handoff.coordinate,
    });
    if (!block) {
      migrationContinuityStatus = "missing";
      migrationContinuity = cloneSnapshot({
        source: BLOCK_WORLD_MIGRATION_SOURCE,
        kind: "block-world-migration-continuity",
        action: "accept-handback-blocked",
        method,
        status: "missing",
        blockId: handoff.blockId ?? null,
        coordinate: Array.isArray(handoff.coordinate) ? [...handoff.coordinate] : null,
        mappingId: handoff.mappingId ?? null,
        reason: "cube-not-found-in-current-draft",
        localOnly: true,
        simulation: true,
        externalImport: false,
        importedCodeExecution: false,
        persistence: false,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
      });
      render();
      return continuitySnapshot("accept-handback-blocked", method, null, "cube-not-found-in-current-draft");
    }
    selectedId = block.id;
    migrationContinuityStatus = "restored";
    migrationContinuity = migrationContinuityRecord(block, method, "restored");
    if (manipulateMode) syncManipulatorForSelection("accept-handback");
    render();
    return continuitySnapshot("accept-handback", method, block, null);
  }

  /**
   * Validate and preview a caller-supplied legacy snapshot without letting it
   * become renderer state. The domain adapter owns strict JSON/data checks and
   * fixed manifest coordinates; this layer only exposes the mapped/deferred
   * rows and a visible local status for the current cube field.
   */
  function previewLegacySnapshot(input, method = "user-snapshot") {
    const preview = previewBlockMigrationSnapshot(input);
    const valid = preview.valid === true;
    if (statusEl) {
      statusEl.textContent = valid
        ? `LEGACY SNAPSHOT PREVIEW · ${preview.mappedRows.length} MAPPED · ${preview.deferredRows.length} DEFERRED · LOCAL ONLY`
        : `LEGACY SNAPSHOT BLOCKED · ${preview.validation.errors.length} VALIDATION ERROR${preview.validation.errors.length === 1 ? "" : "S"} · NO IMPORT`;
    }
    return cloneSnapshot({
      source: BLOCK_WORLD_MIGRATION_SOURCE,
      kind: "block-world-legacy-snapshot-preview",
      action: valid ? "preview-legacy-snapshot" : "preview-legacy-snapshot-blocked",
      method,
      valid,
      snapshot: preview.snapshot,
      validation: preview.validation,
      rows: preview.rows,
      mappings: preview.mappings,
      mappedRows: preview.mappedRows,
      deferredRows: preview.deferredRows,
      mappedCount: preview.mappedCount,
      preservedCount: preview.preservedCount,
      deferredCount: preview.deferredCount,
      applyCount: preview.applyCount,
      draftPatches: preview.draftPatches,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
      boundary: preview.boundary,
    });
  }

  function openMigrationBridge(method = "button") {
    const sourceBlock = selectedBlock() ?? heldBlock();
    if (sourceBlock) rememberMigrationContinuity(sourceBlock, "migration-bridge-open", "available");
    const snapshot = cloneSnapshot({
      source: BLOCK_WORLD_MIGRATION_SOURCE,
      action: "open-migration-bridge",
      method,
      sourceFeature: "block-world",
      targetFeature: "migration",
      sourceBlockId: sourceBlock?.id ?? migrationContinuity?.blockId ?? null,
      sourceCoordinate: blockCoordinate(sourceBlock) ?? migrationContinuity?.coordinate ?? null,
      continuity: migrationContinuity,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    setMigrationAffordance(true);
    onMigrationOpen?.(snapshot, method);
    return snapshot;
  }

  function materialFor(type, role = "solid") {
    if (!three) return null;
    const key = `${role}:${type}`;
    if (!materials.has(key)) {
      const definition = BLOCK_TYPES[type] ?? BLOCK_TYPES.stone;
      const isContainer = role === "container" || role === "container-open";
      const isOpen = role === "container-open";
      materials.set(key, new three.MeshStandardMaterial({
        // Accent color and stronger emission make openable shells legible at
        // a glance without changing the semantic block type.
        color: isContainer ? definition.accent : definition.color,
        emissive: definition.color,
        emissiveIntensity: isContainer
          ? (isOpen ? 1.15 : 1.35)
          : (type === "portal" || type === "crystal" ? 0.95 : 0.18),
        metalness: isContainer ? 0.42 : 0.2,
        roughness: isContainer ? 0.42 : (type === "water" ? 0.12 : 0.68),
        transparent: !isContainer && type === "water",
        opacity: !isContainer && type === "water" ? 0.72 : 1,
      }));
    }
    return materials.get(key);
  }

  function containerCueMaterialFor(type, open = false) {
    if (!three) return null;
    const key = `container-cue:${type}:${open ? "open" : "closed"}`;
    if (!materials.has(key)) {
      materials.set(key, new three.MeshStandardMaterial({
        color: BLOCK_WORLD_CONTAINER_SIGNAL_COLOR,
        emissive: BLOCK_WORLD_CONTAINER_SIGNAL_EMISSIVE,
        emissiveIntensity: BLOCK_WORLD_CONTAINER_SIGNAL_INTENSITY,
        metalness: 0.34,
        roughness: 0.3,
      }));
    }
    return materials.get(key);
  }

  function contentMaterialFor(type) {
    if (!three) return null;
    const key = `content:${type}`;
    if (!contentMaterials.has(key)) {
      const definition = BLOCK_TYPES[type] ?? BLOCK_TYPES.crystal;
      contentMaterials.set(key, new three.MeshStandardMaterial({
        color: definition.accent,
        emissive: definition.color,
        emissiveIntensity: 0.65,
        metalness: 0.35,
        roughness: 0.36,
      }));
    }
    return contentMaterials.get(key);
  }

  function dragPreviewMaterialFor(type) {
    if (!three) return null;
    const key = `drag-preview:${type}`;
    if (!dragPreviewMaterials.has(key)) {
      const definition = BLOCK_TYPES[type] ?? BLOCK_TYPES.crystal;
      dragPreviewMaterials.set(key, new three.MeshStandardMaterial({
        color: definition.accent,
        emissive: definition.accent,
        emissiveIntensity: 1.25,
        metalness: 0.28,
        roughness: 0.32,
        transparent: true,
        opacity: 0.48,
        depthTest: false,
        depthWrite: false,
      }));
    }
    return dragPreviewMaterials.get(key);
  }

  function addSelectionCue(mesh, blockId, kind = "solid") {
    if (!mesh || !three || typeof three.LineSegments !== "function" || !selectionMaterial || typeof mesh.add !== "function") return;
    const edgeGeometry = selectionEdges[kind] ?? selectionEdges.solid;
    if (!edgeGeometry) return;
    const cue = new three.LineSegments(edgeGeometry, selectionMaterial);
    cue.name = "block-world-selection-cue";
    cue.scale.setScalar(1.08);
    cue.renderOrder = 20;
    cue.visible = blockId === selectedId;
    cue.userData.blockWorldId = blockId;
    cue.userData.blockWorldSelectionCue = true;
    mesh.add(cue);
    selectionCues.set(blockId, cue);
  }

  function addGazeLockCue(mesh, blockId, kind = "solid") {
    if (!mesh || !three || typeof three.LineSegments !== "function" || !gazeLockMaterial || typeof mesh.add !== "function") return;
    const edgeGeometry = selectionEdges[kind] ?? selectionEdges.solid;
    if (!edgeGeometry) return;
    const cue = new three.LineSegments(edgeGeometry, gazeLockMaterial);
    cue.name = "block-world-gaze-lock-cue";
    cue.scale.setScalar(1.16);
    cue.renderOrder = 21;
    cue.visible = blockId === gazeLockedId;
    cue.userData.blockWorldId = blockId;
    cue.userData.blockWorldGazeLockCue = true;
    cue.userData.blockWorldGazeLockSource = BLOCK_WORLD_GAZE_LOCK_SOURCE;
    cue.userData.blockWorldGazeLockColor = BLOCK_WORLD_GAZE_LOCK_COLOR;
    cue.userData.blockWorldGazeLockBoundary = BLOCK_WORLD_GAZE_LOCK_BOUNDARY;
    mesh.add(cue);
    gazeLockCues.set(blockId, cue);
  }

  function updateSelectionCues() {
    selectionCues.forEach((cue, blockId) => {
      cue.visible = blockId === selectedId;
    });
  }

  function updateGazeLockCues(time = 0, motionReduced = false) {
    gazeLockCues.forEach((cue, blockId) => {
      const active = blockId === gazeLockedId;
      cue.visible = active;
      cue.userData.blockWorldGazeLockActive = active;
      if (!active || !cue?.scale?.setScalar) return;
      const pulse = motionReduced ? 1.16 : 1.16 + Math.sin(Number(time) * 4.2) * 0.035;
      cue.scale.setScalar(pulse);
      cue.userData.blockWorldGazeLockAction = gazeLockAction;
    });
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList.toggle("visible", opened);
    panel.setAttribute("aria-hidden", String(!opened));
    if (!opened) {
      setMigrationAffordance(false);
      clearContentFocus("close");
      render();
    }
    if (opened && method === "open") replayButton.focus({ preventScroll: true });
  }

  function selectedBlock() {
    return currentProjection.blocks.find((block) => block.id === selectedId) ?? null;
  }

  function heldBlock() {
    return currentProjection.holding === true && currentProjection.heldBlock
      ? currentProjection.heldBlock
      : null;
  }

  function displayBlock() {
    return selectedBlock() ?? heldBlock();
  }

  function hoveredBlock() {
    return currentProjection.blocks.find((block) => block.id === hoveredId) ?? null;
  }

  function contentParent(parentBlockId) {
    if (typeof parentBlockId !== "string") return null;
    return currentProjection.blocks.find((block) => block.id === parentBlockId) ?? null;
  }

  function contentFocusSnapshot(record, method = "content-row", action = "select-content") {
    if (!record?.parentBlock || !record?.content) return null;
    const parent = record.parentBlock;
    const content = record.content;
    return cloneSnapshot({
      source: BLOCK_WORLD_CONTENT_NAVIGATION_SOURCE,
      kind: "block-world-content-focus",
      action,
      method,
      parentBlockId: parent.id,
      parentLabel: parent.label ?? null,
      parentCoordinate: blockCoordinate(parent),
      parentBlockType: parent.blockType ?? null,
      contentId: content.id,
      contentLabel: content.label ?? "Nested cube",
      contentType: content.contentType ?? content.type ?? "block-content",
      contentBlockType: content.blockType ?? parent.blockType ?? null,
      contentIndex: record.index,
      contentCount: record.count,
      content: cloneSnapshot(content),
      parent: cloneSnapshot(parent),
      previewOnly: false,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      persistence: false,
      executable: false,
      boundary: BLOCK_WORLD_CONTENT_NAVIGATION_BOUNDARY,
    });
  }

  function clearContentFocus(reason = "clear") {
    contentFocus = null;
    if (reason === "parent-change" || reason === "close" || reason === "reset" || reason === "sync") {
      hoveredContent = null;
    }
    return null;
  }

  function focusedContentRecord() {
    if (!contentFocus) return null;
    const parent = contentParent(contentFocus.parentBlockId);
    if (!parent || selectedId !== parent.id) return null;
    return resolveBlockWorldContent(parent, contentFocus.contentId);
  }

  function hoveredContentRecord() {
    if (!hoveredContent) return null;
    const parent = contentParent(hoveredContent.parentBlockId);
    return parent ? resolveBlockWorldContent(parent, hoveredContent.contentId) : null;
  }

  function selectContent(parentBlockId, contentIdOrIndex, method = "content-row") {
    const parent = contentParent(parentBlockId);
    const record = resolveBlockWorldContent(parent, contentIdOrIndex);
    if (!parent || !record) {
      contentFocus = null;
      if (contentNavigationStatusEl) contentNavigationStatusEl.textContent = "INSIDE NAVIGATION BLOCKED · CONTENT NOT FOUND · LOCAL ONLY";
      render();
      return null;
    }
    if (lastFieldTap && lastFieldTap.blockId !== parent.id) clearFieldTap();
    selectedId = parent.id;
    if (!String(method).startsWith("linked-")) lastLinkedNavigation = null;
    rememberMigrationContinuity(parent, `content:${method}`, "available");
    hoveredContent = null;
    contentFocus = contentFocusSnapshot(record, method);
    render();
    const snapshot = contentFocusSnapshot(record, method);
    onContentSelect?.(snapshot);
    return snapshot;
  }

  function navigateContent(direction = "next", method = "button") {
    const parent = selectedBlock();
    const normalizedDirection = direction === "previous" || direction === "prev" ? "previous" : "next";
    if (!parent?.container) {
      if (contentNavigationStatusEl) contentNavigationStatusEl.textContent = "INSIDE NAVIGATION BLOCKED · SELECT A CONTAINER · LOCAL ONLY";
      return null;
    }
    if (heldBlock() || directManipulation) {
      if (contentNavigationStatusEl) contentNavigationStatusEl.textContent = "INSIDE NAVIGATION PAUSED · FINISH CARRY / DRAG FIRST · LOCAL ONLY";
      return null;
    }
    const current = contentFocus?.parentBlockId === parent.id ? contentFocus.contentId : null;
    const record = cycleBlockWorldContent(parent, current, normalizedDirection);
    if (!record) {
      if (contentNavigationStatusEl) contentNavigationStatusEl.textContent = "INSIDE NAVIGATION · THIS CONTAINER IS EMPTY · LOCAL ONLY";
      return null;
    }
    const previousContentId = current;
    const selected = selectContent(parent.id, record.contentId, `content-${normalizedDirection}`);
    if (!selected) return null;
    const snapshot = cloneSnapshot({
      ...selected,
      action: `content-${normalizedDirection}`,
      direction: normalizedDirection,
      previousContentId,
      wrapped: previousContentId
        ? (normalizedDirection === "next" ? record.index === 0 : record.index === record.count - 1)
        : false,
      method,
    });
    contentFocus = cloneSnapshot({ ...selected, action: snapshot.action, method });
    render();
    return snapshot;
  }

  function renderContentNavigation(block = selectedBlock()) {
    const contents = asArray(block?.contents);
    const focus = focusedContentRecord();
    const locked = Boolean(heldBlock() || directManipulation);
    if (contentNavigationStatusEl) {
      if (!block) contentNavigationStatusEl.textContent = "INSIDE NAVIGATION · SELECT A CONTAINER · LOCAL ONLY";
      else if (!block.container || !contents.length) contentNavigationStatusEl.textContent = "INSIDE NAVIGATION · THIS CUBE HAS NO NESTED CONTENT · LOCAL ONLY";
      else if (focus) contentNavigationStatusEl.textContent = `INSIDE ${focus.index + 1}/${focus.count} · ${focus.content.label.toUpperCase()} · PARENT ${block.id} · LOCAL ONLY`;
      else contentNavigationStatusEl.textContent = `${contents.length} NESTED CUBE${contents.length === 1 ? "" : "S"} · SELECT A CONTENT ROW · PREVIOUS / NEXT · LOCAL ONLY`;
    }
    if (contentPreviousButton) {
      contentPreviousButton.disabled = locked || !block?.container || contents.length === 0;
      contentPreviousButton.setAttribute?.("aria-label", block
        ? `Inspect previous nested content inside ${block.label}`
        : "Inspect previous nested content");
    }
    if (contentNextButton) {
      contentNextButton.disabled = locked || !block?.container || contents.length === 0;
      contentNextButton.setAttribute?.("aria-label", block
        ? `Inspect next nested content inside ${block.label}`
        : "Inspect next nested content");
    }
  }

  function makeHoverPreview(block) {
    if (!block?.container) return null;
    const contents = asArray(block.contents).map((content) => ({
      id: content?.id ?? null,
      label: content?.label ?? "Nested cube",
      contentType: content?.contentType ?? null,
      blockType: content?.blockType ?? null,
    }));
    return cloneSnapshot({
      blockId: block.id,
      label: block.label,
      blockType: block.blockType,
      canonicalOpen: block.open === true,
      previewOpen: true,
      contentCount: Number.isInteger(block.contentCount) ? block.contentCount : contents.length,
      contents,
      presentationOnly: true,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      persistence: false,
      executable: false,
      boundary: BLOCK_WORLD_PRESENTATION_BOUNDARY,
    });
  }

  function syncHoverPreview() {
    const block = hoveredBlock();
    hoverPreview = makeHoverPreview(block);
    return hoverPreview;
  }

  function syncSemanticDepthProjection() {
    const axes = new Map();
    const offsets = new Map();
    currentProjection.blocks.forEach((block) => {
      const blockAxes = getBlockWorldSemanticAxes(block, currentProjection.blocks);
      axes.set(block.id, blockAxes);
      offsets.set(block.id, getBlockWorldSemanticDepthOffset(blockAxes, semanticDepthMode));
    });
    semanticDepthAxes = axes;
    semanticDepthOffsets = offsets;
  }

  function semanticDepthFor(blockId) {
    return semanticDepthOffsets.get(blockId)
      ?? getBlockWorldSemanticDepthOffset(semanticDepthAxes.get(blockId), semanticDepthMode);
  }

  function renderSemanticDepthControls() {
    depthModeButtons.forEach((button, mode) => {
      button.setAttribute?.("aria-pressed", String(mode === semanticDepthMode));
      button.dataset.active = String(mode === semanticDepthMode);
    });
    if (depthStatusEl) {
      const axes = semanticDepthAxes.get(selectedId) ?? semanticDepthAxes.get(hoveredId);
      const w = axes?.nestedContentDepth ?? 0;
      const v = axes?.linkedNeighborDegree ?? 0;
      depthStatusEl.textContent = `${semanticDepthMode.toUpperCase()} PROJECTION · W ${w} · V ${v} · REVERSIBLE LOCAL VIEW`;
    }
    if (depthBoundaryEl) depthBoundaryEl.textContent = BLOCK_WORLD_SEMANTIC_DEPTH_BOUNDARY;
  }

  function addLinkedNavigationTrace(entry) {
    linkedNavigationTrace = [cloneSnapshot(entry), ...linkedNavigationTrace].slice(0, 12);
  }

  function renderLinkedNavigation() {
    const block = selectedBlock() ?? hoveredBlock();
    const links = block ? getBlockWorldLinkedNeighbors(block, currentProjection.blocks) : [];
    const locked = Boolean(heldBlock() || directManipulation);
    if (linkedNavigationStatusEl) {
      if (!block) linkedNavigationStatusEl.textContent = "LINKED NAVIGATION · SELECT A CUBE · LOCAL ONLY";
      else if (locked) linkedNavigationStatusEl.textContent = "LINKED NAVIGATION PAUSED · FINISH CARRY / DRAG FIRST · LOCAL ONLY";
      else if (lastLinkedNavigation?.targetBlockId === block.id) {
        linkedNavigationStatusEl.textContent = `LINKED ${String(lastLinkedNavigation.direction).toUpperCase()} · ${String(lastLinkedNavigation.relation).toUpperCase()} · ${lastLinkedNavigation.targetBlockId} · LOCAL ONLY`;
      } else {
        linkedNavigationStatusEl.textContent = `${links.length} LINK${links.length === 1 ? "" : "S"} · GRID + PARENT / CONTENT · PREVIOUS / NEXT · LOCAL ONLY`;
      }
    }
    if (linkedPreviousButton) {
      linkedPreviousButton.disabled = locked || links.length === 0;
      linkedPreviousButton.setAttribute?.("aria-label", block
        ? `Navigate to previous linked block from ${block.label}`
        : "Navigate to previous linked block");
    }
    if (linkedNextButton) {
      linkedNextButton.disabled = locked || links.length === 0;
      linkedNextButton.setAttribute?.("aria-label", block
        ? `Navigate to next linked block from ${block.label}`
        : "Navigate to next linked block");
    }
    if (!linkedNavigationTraceEl) return;
    linkedNavigationTraceEl.replaceChildren();
    if (!linkedNavigationTrace.length) {
      linkedNavigationTraceEl.appendChild(makeText(documentRoot, "div", "block-world-empty", "No linked navigation yet."));
      return;
    }
    linkedNavigationTrace.forEach((entry, index) => {
      const relation = String(entry.relation ?? "linked").replaceAll("-", " ");
      linkedNavigationTraceEl.appendChild(makeText(
        documentRoot,
        "div",
        "block-world-linked-navigation-trace-row",
        `${index + 1} · ${String(entry.direction).toUpperCase()} · ${relation.toUpperCase()} · ${entry.targetBlockId ?? "—"}${entry.linkedContentId ? ` · ${entry.linkedContentId}` : ""} · LOCAL ONLY`,
      ));
    });
  }

  function containerSignalMetadata() {
    return currentProjection.blocks
      .filter((block) => block.container === true)
      .map((block) => cloneSnapshot({
        blockId: block.id,
        coordinate: blockCoordinate(block),
        geometry: "BoxGeometry",
        color: BLOCK_WORLD_CONTAINER_SIGNAL_COLOR,
        emissive: BLOCK_WORLD_CONTAINER_SIGNAL_EMISSIVE,
        intensity: BLOCK_WORLD_CONTAINER_SIGNAL_INTENSITY,
        offset: { x: 0, y: BLOCK_WORLD_CONTAINER_SIGNAL_OFFSET_Y, z: 0 },
        interactive: false,
        raycastTarget: false,
        localOnly: true,
        simulation: true,
        presentationOnly: true,
        canonicalUnchanged: true,
        boundary: BLOCK_WORLD_CONTAINER_SIGNAL_BOUNDARY,
      }));
  }

  function setSemanticDepthMode(mode, method = "button") {
    const nextMode = normalizeSemanticDepthMode(mode);
    const previousMode = semanticDepthMode;
    semanticDepthMode = nextMode;
    syncSemanticDepthProjection();
    renderSemanticDepthControls();
    render();
    return cloneSnapshot({
      action: "semantic-depth-mode",
      method,
      previousMode,
      mode: semanticDepthMode,
      semanticDepth: {
        mode: semanticDepthMode,
        axes: [...semanticDepthAxes.values()],
        projectionOnly: true,
        canonicalUnchanged: true,
        localOnly: true,
        simulation: true,
        boundary: BLOCK_WORLD_SEMANTIC_DEPTH_BOUNDARY,
      },
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      persistence: false,
      executable: false,
    });
  }

  function navigateLinkedBlock(direction = "next", method = "button") {
    const normalizedDirection = direction === "previous" || direction === "prev" ? "previous" : "next";
    const source = selectedBlock() ?? hoveredBlock();
    if (!source) {
      if (linkedNavigationStatusEl) linkedNavigationStatusEl.textContent = "LINKED NAVIGATION BLOCKED · SELECT A CUBE · LOCAL ONLY";
      return null;
    }
    const links = getBlockWorldLinkedNeighbors(source, currentProjection.blocks);
    if (!links.length) {
      if (linkedNavigationStatusEl) linkedNavigationStatusEl.textContent = "LINKED NAVIGATION BLOCKED · NO LOCAL LINK · LOCAL ONLY";
      return null;
    }
    const previousIndex = lastLinkedNavigation?.sourceBlockId === source.id
      ? links.findIndex((link) => link.blockId === lastLinkedNavigation.targetBlockId
        && link.relation === lastLinkedNavigation.relation
        && link.linkedContentId === (lastLinkedNavigation.linkedContentId ?? null))
      : -1;
    const step = normalizedDirection === "previous" ? -1 : 1;
    const startingIndex = previousIndex >= 0 ? previousIndex : (step > 0 ? -1 : 0);
    const nextIndex = (startingIndex + step + links.length) % links.length;
    const link = links[nextIndex];
    const target = currentProjection.blocks.find((candidate) => candidate.id === link.blockId)
      ?? (heldBlock()?.id === link.blockId ? heldBlock() : null);
    if (!target) return null;
    const selected = selectBlock(target.id, `linked-${normalizedDirection}`);
    if (!selected) return null;
    // A parent → nested-content link points at the owning cube while exposing
    // the transient hover preview. No nested content is promoted to canonical
    // block state or a new interaction target.
    if (link.relation === "parent-to-nested-content") {
      hoveredId = target.id;
      syncHoverPreview();
      syncHoverPreviewMeshes();
    }
    const snapshot = cloneSnapshot({
      action: `linked-${normalizedDirection}`,
      method,
      direction: normalizedDirection,
      sourceBlockId: source.id,
      sourceCoordinate: blockCoordinate(source),
      targetBlockId: target.id,
      targetCoordinate: blockCoordinate(target),
      relation: link.relation,
      linkedContentId: link.linkedContentId ?? null,
      contentLabel: link.contentLabel ?? null,
      links,
      semanticDepthMode,
      canonicalUnchanged: true,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      persistence: false,
      executable: false,
      boundary: "Linked navigation follows canonical grid adjacency and parent/content metadata; it only selects/focuses a local renderer target.",
    });
    lastLinkedNavigation = snapshot;
    addLinkedNavigationTrace(snapshot);
    render();
    return snapshot;
  }

  function clearHoverPreviewMeshes() {
    hoverPreviewMeshes.forEach((meshes) => meshes.forEach((mesh) => {
      layer?.remove(mesh);
      interactiveMeshes.delete(mesh);
      const index = contentMeshes.indexOf(mesh);
      if (index >= 0) contentMeshes.splice(index, 1);
    }));
    hoverPreviewMeshes = new Map();
  }

  function syncHoverPreviewMeshes() {
    clearHoverPreviewMeshes();
    const block = hoveredBlock();
    if (!layer || !three || !contentGeometry || !block?.container || block.open === true) return;
    const meshes = [];
    asArray(block.contents).forEach((content, contentIndex) => {
      const peekOffset = getBlockWorldContainerPeekOffset(content, contentIndex, block.contents.length);
      const contentMesh = new three.Mesh(contentGeometry, contentMaterialFor(content.blockType));
      setBasePosition(contentMesh, {
        x: block.x - (currentProjection.dimensions.width - 1) / 2 + peekOffset.x,
        y: block.y * 0.82 - 0.25 + peekOffset.y,
        z: block.z - (currentProjection.dimensions.depth - 1) / 2 + peekOffset.z,
      });
      setBaseScale(contentMesh, 1);
      contentMesh.userData.blockWorld = cloneSnapshot(block);
      contentMesh.userData.blockWorldId = block.id;
      contentMesh.userData.blockWorldContent = cloneSnapshot(content);
      contentMesh.userData.blockWorldOpen = false;
      contentMesh.userData.blockWorldHoverPreview = true;
      contentMesh.userData.blockWorldPeek = true;
      contentMesh.userData.blockWorldContentSelectable = true;
      contentMesh.userData.blockWorldContentParentId = block.id;
      contentMesh.userData.blockWorldPeekIndex = contentIndex;
      contentMesh.userData.blockWorldPeekOffset = peekOffset;
      contentMesh.userData.blockWorldBloom = peekOffset.bloom;
      contentMesh.userData.blockWorldPeekAction = "HOVER PREVIEW · CLICK TO INSPECT CONTENT · DOUBLE-ACTIVATE THE PARENT TO OPEN";
      layer.add(contentMesh);
      // Hover peeks are transient but still first-class cube targets: a click
      // is intercepted by the host and routed to selectContent, while normal
      // parent drag/open semantics remain untouched.
      raycastTargets.push(contentMesh);
      interactiveMeshes.add(contentMesh);
      contentMeshes.push(contentMesh);
      meshes.push(contentMesh);
    });
    if (meshes.length) hoverPreviewMeshes.set(block.id, meshes);
  }

  function dampValue(current, target, lambda, dt, snap = false) {
    if (snap || reducedMotion || dt <= 0) return target;
    const alpha = 1 - Math.exp(-Math.max(0, lambda) * dt);
    return current + (target - current) * alpha;
  }

  function setBasePosition(mesh, position) {
    if (!mesh?.position || !position) return;
    mesh.position.set(position.x, position.y, position.z);
    mesh.userData.blockWorldBasePosition = Object.freeze({
      x: Number(position.x) || 0,
      y: Number(position.y) || 0,
      z: Number(position.z) || 0,
    });
  }

  function setBaseScale(mesh, scale = 1) {
    if (!mesh) return;
    mesh.userData.blockWorldBaseScale = Number.isFinite(Number(scale)) ? Number(scale) : 1;
    mesh.scale.setScalar(mesh.userData.blockWorldBaseScale);
  }

  function cameraVector(input) {
    const candidate = input?.cameraPosition ?? input?.camera?.position ?? input;
    if (!candidate || typeof candidate !== "object") return null;
    const x = Number(candidate.x);
    const y = Number(candidate.y);
    const z = Number(candidate.z);
    return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
  }

  function meshWorldBasePosition(mesh) {
    const base = mesh?.userData?.blockWorldBasePosition;
    if (!base) return null;
    return {
      x: base.x + Number(layer?.position?.x || 0),
      y: base.y + Number(layer?.position?.y || 0),
      z: base.z + Number(layer?.position?.z || 0),
    };
  }

  function updateProximity(options = {}) {
    const camera = cameraVector(options);
    const radiusValue = Number(options?.proximityRadius ?? options?.proximity?.radius ?? BLOCK_WORLD_PROXIMITY_RADIUS);
    const radius = Number.isFinite(radiusValue)
      ? Math.max(4, Math.min(80, radiusValue))
      : BLOCK_WORLD_PROXIMITY_RADIUS;
    const scatterById = new Map();
    let nearCount = 0;
    let farCount = 0;
    let scatteredCount = 0;
    let culledCount = 0;
    const protectedIds = new Set([
      selectedId,
      hoveredId,
      heldBlock()?.id,
      directManipulation?.blockId,
    ].filter((id) => typeof id === "string" && id));
    const approachRadiusValue = Number(options?.proximityApproachRadius ?? BLOCK_WORLD_PROXIMITY_APPROACH_RADIUS);
    const approachRadius = Number.isFinite(approachRadiusValue)
      ? Math.max(4, Math.min(120, approachRadiusValue))
      : BLOCK_WORLD_PROXIMITY_APPROACH_RADIUS;
    const basePositions = camera
      ? [...blockMeshes.values()]
        .map((mesh) => meshWorldBasePosition(mesh))
        .filter(Boolean)
      : [];
    const nearestDistance = camera && basePositions.length
      ? Math.min(...basePositions.map((position) => Math.hypot(
        position.x - camera.x,
        position.y - camera.y,
        position.z - camera.z,
      )))
      : null;
    const explicitlyEnabled = Object.prototype.hasOwnProperty.call(options, "proximityActive")
      ? options.proximityActive === true
      : null;
    const active = camera && (explicitlyEnabled === true || (explicitlyEnabled !== false
      && Number.isFinite(nearestDistance)
      && nearestDistance <= approachRadius));
    if (active) {
      blockMeshes.forEach((mesh, id) => {
        const position = meshWorldBasePosition(mesh);
        if (!position) return;
        const distance = Math.hypot(position.x - camera.x, position.y - camera.y, position.z - camera.z);
        const farFactor = Math.max(0, Math.min(1, (distance - radius) / Math.max(radius, 1)));
        const block = currentProjection.blocks.find((candidate) => candidate.id === id);
        const highSalience = id === selectedId
          || id === hoveredId
          || block?.container === true
          || block?.blockType === "portal";
        const culled = distance > radius * 2
          && !highSalience
          && !protectedIds.has(id);
        // Salient cubes remain easy to find even when the camera is far away;
        // low-salience city cubes receive the full deterministic scatter.
        const amount = farFactor * (highSalience ? 0.16 : 1);
        const offset = getBlockWorldProximityScatter(id, amount);
        scatterById.set(id, { ...offset, distance, farFactor, highSalience, culled });
        if (distance <= radius) nearCount += 1;
        else farCount += 1;
        if (amount > 0.01) scatteredCount += 1;
        if (culled) culledCount += 1;
      });
    }
    proximityState = {
      enabled: Boolean(active),
      mode: "city-skyscraper",
      radius,
      approachRadius,
      cameraPosition: camera ? { ...camera } : null,
      nearestDistance: Number.isFinite(nearestDistance) ? Number(nearestDistance.toFixed(4)) : null,
      nearCount,
      farCount,
      scatteredCount,
      culledCount,
      localOnly: true,
      simulation: true,
      presentationOnly: true,
      canonicalUnchanged: true,
    };
    return scatterById;
  }

  function applyPresentation(mesh, id, scatterById, depthById, dt, motionReduced) {
    if (!mesh?.position || !mesh.userData?.blockWorldBasePosition) return;
    // While the gizmo owns a drag the TransformControls instance writes the
    // mesh transform directly; damping here would fight it frame by frame.
    if (mesh.userData.blockWorldGizmoDragging === true) return;
    const base = mesh.userData.blockWorldBasePosition;
    const scatter = scatterById.get(id) ?? { x: 0, y: 0, z: 0 };
    const depth = depthById.get(id) ?? { x: 0, y: 0, z: 0 };
    // A gizmo-placed arrangement pins the cube where Tumbo left it: the stored
    // absolute transform replaces the grid/scatter/depth rest targets.
    const manipulated = mesh.userData.blockWorldManipulatedTransform ?? null;
    const isHovered = id === hoveredId;
    const isSelected = id === selectedId;
    const isGazeLocked = id === gazeLockedId;
    const isPreviewContent = mesh.userData.blockWorldHoverPreview === true;
    const culled = scatter.culled === true;
    mesh.visible = !culled && (isPreviewContent ? isHovered || mesh.userData.blockWorldOpen === true : true);
    const active = isHovered || isSelected;
    const hoverLift = !motionReduced && isHovered ? (isPreviewContent ? 0.08 : 0.16) : 0;
    const targetScale = mesh.userData.blockWorldBaseScale
      * (motionReduced
        ? (isGazeLocked ? 1.045 : 1)
        : isHovered ? 1.1 : isSelected ? 1.025 : isGazeLocked ? 1.055 : 1);
    const bloomAngle = Number(mesh.userData?.blockWorldBloom?.angle);
    const bloomRotation = !motionReduced && Number.isFinite(bloomAngle)
      ? Math.max(-0.18, Math.min(0.18, bloomAngle * 0.22))
      : 0;
    // Bloom petals keep their deterministic fan orientation while hover adds
    // a small eased lift/tilt. Both are presentation transforms only.
    const targetRotationY = manipulated
      ? manipulated.rotation[1]
      : bloomRotation + (!motionReduced && isHovered ? 0.075 : 0);
    const targetRotationX = manipulated
      ? manipulated.rotation[0]
      : !motionReduced && isHovered ? -0.035 : 0;
    const targetRotationZ = manipulated ? manipulated.rotation[2] : 0;
    const snap = motionReduced || dt <= 0;
    mesh.position.x = dampValue(mesh.position.x, manipulated ? manipulated.position[0] : base.x + scatter.x + depth.x, 11, dt, snap);
    mesh.position.y = dampValue(mesh.position.y, (manipulated ? manipulated.position[1] : base.y + scatter.y + depth.y) + hoverLift, 11, dt, snap);
    mesh.position.z = dampValue(mesh.position.z, manipulated ? manipulated.position[2] : base.z + scatter.z + depth.z, 11, dt, snap);
    const currentScale = Number.isFinite(Number(mesh.scale.x))
      ? Number(mesh.scale.x)
      : Number.isFinite(Number(mesh.scale.value))
        ? Number(mesh.scale.value)
        : mesh.userData.blockWorldBaseScale;
    if (manipulated) {
      // A stretched cube keeps its per-axis gizmo scale; the selection/hover
      // multiplier still applies on top so focus feedback keeps working.
      const selectionScaleMult = motionReduced
        ? (isGazeLocked ? 1.045 : 1)
        : isHovered ? 1.1 : isSelected ? 1.025 : isGazeLocked ? 1.055 : 1;
      mesh.scale.set(
        dampValue(mesh.scale.x, manipulated.scale[0] * selectionScaleMult, 12, dt, snap),
        dampValue(mesh.scale.y, manipulated.scale[1] * selectionScaleMult, 12, dt, snap),
        dampValue(mesh.scale.z, manipulated.scale[2] * selectionScaleMult, 12, dt, snap),
      );
    } else {
      mesh.scale.setScalar(dampValue(currentScale, targetScale, 12, dt, snap));
    }
    if (mesh.rotation) {
      mesh.rotation.y = dampValue(mesh.rotation.y ?? 0, targetRotationY, 10, dt, snap);
      if ("x" in mesh.rotation || typeof mesh.rotation.x === "number") mesh.rotation.x = dampValue(mesh.rotation.x ?? 0, targetRotationX, 10, dt, snap);
      if (manipulated && ("z" in mesh.rotation || typeof mesh.rotation.z === "number")) mesh.rotation.z = dampValue(mesh.rotation.z ?? 0, targetRotationZ, 10, dt, snap);
    }
    mesh.userData.blockWorldHoverActive = active;
    mesh.userData.blockWorldGazeLockActive = isGazeLocked;
    mesh.userData.blockWorldProximityScatter = Object.freeze({
      x: Number(scatter.x) || 0,
      y: Number(scatter.y) || 0,
      z: Number(scatter.z) || 0,
      distance: Number.isFinite(scatter.distance) ? Number(scatter.distance.toFixed(4)) : null,
      farFactor: Number.isFinite(scatter.farFactor) ? Number(scatter.farFactor.toFixed(4)) : 0,
      highSalience: scatter.highSalience === true,
      culled,
    });
    mesh.userData.blockWorldSemanticDepthOffset = Object.freeze({
      mode: depth.mode ?? semanticDepthMode,
      w: Number(depth.w) || 0,
      v: Number(depth.v) || 0,
      x: Number(depth.x) || 0,
      y: Number(depth.y) || 0,
      z: Number(depth.z) || 0,
    });
    if (Number.isFinite(bloomAngle)) {
      mesh.userData.blockWorldBloomTransform = Object.freeze({
        angle: Number(bloomAngle.toFixed(6)),
        rotationY: Number(bloomRotation.toFixed(6)),
        presentationOnly: true,
      });
    }
  }

  function blockMeshPosition(block, delta = [0, 0, 0]) {
    const width = currentProjection.dimensions.width;
    const depth = currentProjection.dimensions.depth;
    const [dx, dy, dz] = Array.isArray(delta) ? delta : [0, 0, 0];
    return {
      x: block.x + Number(dx || 0) - (width - 1) / 2,
      y: block.y * 0.82 - 0.25 + Number(dy || 0) * 0.82,
      z: block.z + Number(dz || 0) - (depth - 1) / 2,
    };
  }

  // The direct-input state machine stores deltas as `{ dx, dy, dz }` objects,
  // while the Three placement helper is easiest to reason about as a compact
  // vector. Normalize both shapes here so the transient preview follows the
  // same one-step move the domain will validate on release.
  function directDeltaVector(delta) {
    if (Array.isArray(delta)) {
      return [0, 1, 2].map((index) => Number.isFinite(Number(delta[index])) ? Number(delta[index]) : 0);
    }
    if (delta && typeof delta === "object") {
      return [delta.dx, delta.dy, delta.dz].map((value) => Number.isFinite(Number(value)) ? Number(value) : 0);
    }
    return [0, 0, 0];
  }

  function hasDirectDelta(delta) {
    return directDeltaVector(delta).some((value) => value !== 0);
  }

  function directInputPoint(input = {}) {
    const clientX = Number(input.clientX ?? input.x);
    const clientY = Number(input.clientY ?? input.y);
    return Number.isFinite(clientX) && Number.isFinite(clientY)
      ? { clientX, clientY }
      : null;
  }

  function directInputSnapshot(value = {}) {
    return cloneSnapshot({
      ...value,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    });
  }

  function addTrace(action, block) {
    trace = [{ action, blockId: block?.id ?? null, localOnly: true }, ...trace].slice(0, 8).map(cloneSnapshot);
  }

  function addMigrationTrace(entries) {
    const next = asArray(entries).map((entry) => migrationSnapshot(entry));
    migrationTrace = [...next, ...migrationTrace].slice(0, 24).map(cloneSnapshot);
    // Keep one visible trace stream for the console while retaining the
    // structured migration records separately for hosts that need mapping IDs.
    trace = [...next, ...trace].slice(0, 24).map(cloneSnapshot);
  }

  function addNavigationTrace(entry) {
    const snapshot = cloneSnapshot(entry);
    navigationTrace = [snapshot, ...navigationTrace].slice(0, 12).map(cloneSnapshot);
    // Keep the existing all-actions stream useful to hosts that only inspect
    // `trace`; route records remain visibly local there as well as in the
    // dedicated navigation section.
    trace = [snapshot, ...trace].slice(0, 24).map(cloneSnapshot);
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(makeText(documentRoot, "div", "block-world-empty", "No local block edits yet."));
      return;
    }
    trace.forEach((entry, index) => {
      const target = entry.targetFeature ? ` → ${entry.targetFeature}` : "";
      const row = makeText(documentRoot, "div", "block-world-trace-row", `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.blockId ?? entry.sourceBlockId ?? "draft"}${target} · LOCAL ONLY`);
      traceEl.appendChild(row);
    });
  }

  function renderNavigationTrace() {
    if (!navigationTraceEl) return;
    navigationTraceEl.replaceChildren();
    if (!navigationTrace.length) {
      navigationTraceEl.appendChild(makeText(documentRoot, "div", "block-world-empty", "No portal navigation yet."));
      return;
    }
    navigationTrace.forEach((entry, index) => {
      navigationTraceEl.appendChild(makeText(
        documentRoot,
        "div",
        "block-world-navigation-trace-row",
        `${index + 1} · ${entry.sourceBlockId ?? "portal"} → ${entry.targetFeature ?? "unknown"} · PORTAL · LOCAL ONLY`,
      ));
    });
  }

  /**
   * Native buttons already expose Enter/Space activation in a browser. The
   * small listener below also makes synthetic keyboard events (used by static
   * hosts and regression tests) deterministic, while leaving trusted native
   * activation to the browser so it cannot emit a duplicate hand-off.
   */
  function bindKeyboardActivation(button, callback) {
    if (!button) return;
    button.tabIndex = 0;
    button.setAttribute?.("aria-keyshortcuts", "Enter Space");
    button.addEventListener?.("keydown", (event) => {
      const key = event?.key;
      if (event?.repeat || !["Enter", " ", "Spacebar"].includes(key)) return;
      // A trusted key event on a native button will produce the normal click;
      // handling it here as well would emit the portal route twice.
      if (event?.isTrusted === true) return;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      pendingKeyboardActivations.add(button);
      callback();
    });
  }

  function renderPortalRoutes(block = selectedBlock()) {
    if (!routeListEl) return;
    routeListEl.replaceChildren();
    const isPortal = block?.blockType === "portal";
    if (!isPortal) {
      routeListEl.appendChild(makeText(documentRoot, "div", "block-world-empty", "Select a portal cube to open a local feature route."));
      const portal = currentProjection.blocks.find((candidate) => candidate.blockType === "portal");
      if (portal) {
        const picker = documentRoot.createElement("button");
        picker.type = "button";
        picker.className = "block-world-route-button block-world-route-picker";
        picker.setAttribute("aria-label", `Select portal cube at ${portal.x},${portal.y},${portal.z}`);
        picker.setAttribute("aria-keyshortcuts", "Enter Space");
        picker.append(
          makeText(documentRoot, "strong", "block-world-route-title", "Select portal cube"),
          makeText(documentRoot, "span", "block-world-route-meta", `${portal.x},${portal.y},${portal.z} · SHOW ROUTES`),
        );
        picker.addEventListener("click", (event) => {
          // Synthetic keyboard events may be followed by a synthetic click in
          // a host harness. Native trusted events use the browser click path,
          // so suppress only that duplicate activation shape.
          if (pendingKeyboardActivations.has(picker)
            && (event?.detail === undefined || event?.detail === 0)) {
            pendingKeyboardActivations.delete(picker);
            return;
          }
          pendingKeyboardActivations.delete(picker);
          selectBlock(portal.id, event?.detail === 0 ? "keyboard" : "portal-picker");
        });
        bindKeyboardActivation(picker, () => selectBlock(portal.id, "keyboard"));
        routeListEl.appendChild(picker);
      }
      if (navigationStatusEl) navigationStatusEl.textContent = "PORTAL ROUTES · SELECT A PORTAL CUBE · LOCAL ONLY";
      return;
    }
    const disabled = Boolean(heldBlock() || directManipulation);
    if (navigationStatusEl) {
      navigationStatusEl.textContent = disabled
        ? "PORTAL ROUTES PAUSED · FINISH CARRY / DRAG FIRST · LOCAL ONLY"
        : "PORTAL ROUTES · CHOOSE A LOCAL FEATURE · NO RELOAD";
    }
    BLOCK_WORLD_PORTAL_ROUTE_REGISTRY.forEach((route) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.className = "block-world-route-button";
      button.dataset.routeId = route.id;
      button.dataset.featureId = route.featureId;
      button.setAttribute("aria-pressed", String(lastNavigation?.routeId === route.id && lastNavigation?.sourceBlockId === block.id));
      button.setAttribute("aria-label", `Open ${route.label} from selected portal cube`);
      button.setAttribute("aria-keyshortcuts", "Enter Space");
      button.title = route.description;
      button.disabled = disabled;
      button.append(
        makeText(documentRoot, "strong", "block-world-route-title", route.label),
        makeText(documentRoot, "span", "block-world-route-meta", `${route.featureId} · LOCAL SURFACE`),
      );
      button.addEventListener("click", (event) => {
        if (pendingKeyboardActivations.has(button)
          && (event?.detail === undefined || event?.detail === 0)) {
          pendingKeyboardActivations.delete(button);
          return;
        }
        pendingKeyboardActivations.delete(button);
        navigatePortal(route.id, event?.detail === 0 ? "keyboard" : "button");
      });
      bindKeyboardActivation(button, () => navigatePortal(route.id, "keyboard"));
      routeListEl.appendChild(button);
    });
  }

  /**
   * Resolve and emit a portal hand-off without changing the block projection.
   * The returned record is a frozen local navigation draft; the host may pass
   * its feature id to Feature Navigator, but no URL, provider, wallet, or
   * persistence path is touched here.
   */
  function navigatePortal(target, method = "button") {
    const block = selectedBlock();
    if (!block) {
      if (navigationStatusEl) navigationStatusEl.textContent = "PORTAL ROUTES BLOCKED · SELECT A PORTAL CUBE · LOCAL ONLY";
      statusEl.textContent = "PORTAL ROUTE BLOCKED · SELECT A PORTAL CUBE FIRST · LOCAL ONLY";
      return null;
    }
    if (block.blockType !== "portal") {
      if (navigationStatusEl) navigationStatusEl.textContent = "PORTAL ROUTES BLOCKED · SELECT A PORTAL CUBE · LOCAL ONLY";
      statusEl.textContent = "PORTAL ROUTE BLOCKED · SELECTED CUBE IS NOT A PORTAL · LOCAL ONLY";
      return null;
    }
    if (heldBlock() || directManipulation) {
      if (navigationStatusEl) navigationStatusEl.textContent = "PORTAL ROUTES PAUSED · FINISH CARRY / DRAG FIRST · LOCAL ONLY";
      statusEl.textContent = "PORTAL ROUTE BLOCKED · FINISH CARRY / DRAG FIRST · LOCAL ONLY";
      return null;
    }

    let draft;
    try {
      draft = createBlockWorldNavigationDraft(draftBase(currentProjection), block.id, target, method);
    } catch (error) {
      if (navigationStatusEl) navigationStatusEl.textContent = `PORTAL ROUTE BLOCKED · ${error.message} · LOCAL ONLY`;
      statusEl.textContent = `PORTAL ROUTE BLOCKED · ${error.message} · LOCAL ONLY`;
      return null;
    }

    // Preserve the domain hand-off exactly while recording the presentation
    // context used to reach it. This makes keyboard/touch and reduced-motion
    // audits inspectable without adding a second route or authority layer.
    const navigation = cloneSnapshot({
      ...draft,
      accessibility: {
        input: method === "keyboard" ? "keyboard" : "button-or-touch",
        motion: reducedMotion ? "reduced" : "full",
      },
      renderMode,
      staticFallback,
    });
    lastNavigation = navigation;
    addNavigationTrace(navigation);
    render();
    if (navigationStatusEl) {
      navigationStatusEl.textContent = `PORTAL OPEN · ${navigation.route.label.toUpperCase()} · NO RELOAD · ${staticFallback ? "STATIC CONTROLS" : "LOCAL SURFACE"} · LOCAL ONLY`;
    }
    statusEl.textContent = `PORTAL OPEN · ${navigation.route.label.toUpperCase()} · ${navigation.targetFeature} · ${staticFallback ? "STATIC CONTROLS" : "LOCAL SURFACE"} · LOCAL ONLY`;
    navigateCallback?.(navigation, method);
    return navigation;
  }

  function renderList() {
    listEl.replaceChildren();
    const carried = heldBlock();
    if (carried) {
      const heldRow = makeText(
        documentRoot,
        "div",
        "block-world-held-row",
        `HELD · ${carried.label} · ${carried.id} · ${carried.x},${carried.y},${carried.z} · PLACE OR HOLD-STEP · LOCAL ONLY`,
      );
      // Keep the held cube addressable by the same stable ID convention as
      // ordinary directory rows, even though it is temporarily detached
      // from `currentProjection.blocks` while the carry draft is active.
      heldRow.dataset.blockId = carried.id;
      heldRow.dataset.held = "true";
      heldRow.setAttribute?.("aria-label", `Held ${carried.label} cube ${carried.id} at ${carried.x},${carried.y},${carried.z}`);
      listEl.appendChild(heldRow);
    }
    const blocks = currentProjection.blocks.slice().sort((a, b) => a.id.localeCompare(b.id));
    // Keep the directory bounded for dense worlds, but never hide the active
    // interaction targets behind the cap.  The selected/hovered cube may be
    // far beyond the first 18 lexical IDs (the default selected fixture is),
    // and a held cube already has its own explicit HELD row above.  Appending
    // these existing records preserves one canonical draft and makes every
    // current target addressable without expanding the whole list.
    const visibleBlocks = blocks.slice(0, 18);
    const visibleIds = new Set(visibleBlocks.map((block) => block.id));
    [selectedId, hoveredId].forEach((targetId) => {
      if (typeof targetId !== "string" || visibleIds.has(targetId)) return;
      const target = blocks.find((block) => block.id === targetId);
      if (!target) return;
      visibleBlocks.push(target);
      visibleIds.add(target.id);
    });
    visibleBlocks.forEach((block) => {
      const item = documentRoot.createElement("button");
      item.type = "button";
      item.className = "block-world-row";
      item.dataset.blockId = block.id;
      item.dataset.hovered = String(block.id === hoveredId);
      item.setAttribute("aria-pressed", String(block.id === selectedId));
      item.setAttribute("aria-current", block.id === hoveredId ? "true" : "false");
      const containerState = block.container
        ? `${block.open ? "OPEN" : "CLOSED"} · ${block.contentCount} inside`
        : "SOLID · MOVEABLE";
      const actionHint = block.container
        ? block.open
          ? "SELECT · INSPECT INSIDE · CLOSE · MOVE / GRAB"
          : "SELECT · OPEN · INSPECT · MOVE / GRAB"
        : "SELECT · INSPECT · MOVE / GRAB";
      item.setAttribute(
        "aria-label",
        `${block.label} cube at ${block.x},${block.y},${block.z} · ${actionHint}`,
      );
      item.append(
        makeText(documentRoot, "strong", "block-world-row-title", `${block.label} · ${block.x},${block.y},${block.z}`),
        makeText(documentRoot, "span", "block-world-row-meta", `${block.blockType} · ${containerState}`),
        makeText(documentRoot, "span", "block-world-row-actions", actionHint),
      );
      item.addEventListener("click", () => selectBlock(block.id, "row"));
      listEl.appendChild(item);
    });
    if (blocks.length > visibleBlocks.length) listEl.appendChild(makeText(documentRoot, "div", "block-world-more", `+ ${blocks.length - visibleBlocks.length} more projected blocks`));
  }

  function renderPalette() {
    paletteEl.replaceChildren();
    Object.values(BLOCK_TYPES).forEach((definition) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.className = "block-world-palette-button";
      button.dataset.blockType = definition.id;
      button.setAttribute("aria-pressed", String(definition.id === selectedPalette));
      button.textContent = definition.label;
      button.addEventListener("click", () => {
        selectedPalette = definition.id;
        renderPalette();
      });
      paletteEl.appendChild(button);
    });
  }

  function renderInspection(block = displayBlock(), preview = hoverPreview) {
    const previewBlock = preview?.blockId
      ? currentProjection.blocks.find((candidate) => candidate.id === preview.blockId)
      : null;
    // Once a nested content is explicitly selected, keep its parent readout
    // stable even if the pointer subsequently brushes another cube. Hover
    // remains a preview-only path until a row/peek cube is clicked.
    const focusedParent = contentFocus?.parentBlockId
      ? currentProjection.blocks.find((candidate) => candidate.id === contentFocus.parentBlockId)
      : null;
    const inspectedBlock = focusedParent ?? previewBlock ?? block;
    const contents = focusedParent ? asArray(focusedParent.contents) : preview?.contents ?? asArray(inspectedBlock?.contents);
    const contentCount = Number.isInteger(preview?.contentCount)
      && !focusedParent
        ? preview.contentCount
      : Number.isInteger(inspectedBlock?.contentCount)
        ? inspectedBlock.contentCount
        : contents.length;
    const hoverOnly = Boolean(previewBlock) && !focusedParent;
    if (inspectionEl) {
      const openCue = inspectedBlock?.container && (inspectedBlock?.open || hoverOnly) && contentCount
        ? ` · PEEK ACTIVE · HOLD → PLACE`
        : "";
      inspectionEl.textContent = inspectedBlock
        ? `${hoverOnly ? "HOVER PREVIEW" : "SELECTED"} · ${inspectedBlock.label} · ${inspectedBlock.blockType} · ${inspectedBlock.held ? "HELD FOR PLACEMENT" : inspectedBlock.container ? `${inspectedBlock.open ? "OPENED / INSIDE" : hoverOnly ? "CLOSED · PREVIEW ONLY" : "CLOSED"} · ${contentCount} nested item${contentCount === 1 ? "" : "s"}${openCue}` : "SOLID CUBE"}`
        : "Select a cube to inspect.";
    }
    if (contentFocusEl) {
      const selectedContent = focusedContentRecord();
      const hoveredNested = hoveredContentRecord();
      const record = selectedContent ?? hoveredNested;
      if (record) {
        const parent = record.parentBlock;
        const content = record.content;
        contentFocusEl.textContent = `${selectedContent ? "CONTENT SELECTED" : "HOVER PREVIEW"} · ${content.label} · ${content.contentType ?? "block-content"} · ID ${content.id} · PARENT ${parent.label} (${parent.id}) · ${record.index + 1}/${record.count} · ${selectedContent ? "CLICK / PREVIOUS / NEXT TO INSPECT" : "CLICK TO SELECT"} · LOCAL ONLY`;
      } else if (inspectedBlock?.container && contentCount) {
        contentFocusEl.textContent = `${hoverOnly ? "HOVER PREVIEW" : "NO CONTENT FOCUS"} · ${contentCount} NESTED CUBE${contentCount === 1 ? "" : "S"} · SELECT A ROW OR PEEK CUBE · LOCAL ONLY`;
      } else {
        contentFocusEl.textContent = "NO NESTED CONTENT FOCUS · SELECT A CONTAINER · LOCAL ONLY";
      }
    }
    if (!contentsEl) return;
    contentsEl.replaceChildren();
    if (!inspectedBlock) {
      contentsEl.appendChild(makeText(documentRoot, "div", "block-world-empty", "Nothing selected."));
      return;
    }
    if (!inspectedBlock.container || !contentCount) {
      contentsEl.appendChild(makeText(documentRoot, "div", "block-world-empty", "This cube is solid; there are no nested contents."));
      return;
    }
    contents.forEach((content, index) => {
      const row = documentRoot.createElement("button");
      row.type = "button";
      row.className = "block-world-content-row";
      row.dataset.contentId = content?.id ?? "";
      row.dataset.parentBlockId = inspectedBlock.id;
      const selected = contentFocus?.parentBlockId === inspectedBlock.id && contentFocus.contentId === content?.id;
      const previewOnlyRow = hoverOnly && !selected;
      row.dataset.previewOnly = String(previewOnlyRow);
      row.setAttribute("aria-pressed", String(selected));
      if (contentFocusEl) row.setAttribute("aria-describedby", "block-world-content-focus");
      row.setAttribute("aria-label", `Inspect ${content?.label ?? `nested content ${index + 1}`} ${content?.contentType ?? "block-content"} ${content?.id ?? ""} inside ${inspectedBlock.label}`);
      row.title = `Inspect ${content?.label ?? "nested content"} · ${content?.id ?? "existing content"}`;
      // Keep a plain-text fallback for static hosts that do not calculate a
      // button's aggregate textContent from child nodes.
      row.textContent = `${hoverOnly ? "HOVER PREVIEW · " : ""}${index + 1} · ${content?.label ?? "Nested cube"} · ${content?.contentType ?? "block-content"} · ${content?.id ?? "NO ID"} · ${selected ? "SELECTED" : "CLICK TO INSPECT"}`;
      row.append(
        makeText(documentRoot, "strong", "block-world-content-row-title", `${hoverOnly ? "HOVER PREVIEW · " : ""}${index + 1} · ${content?.label ?? "Nested cube"}`),
        makeText(documentRoot, "span", "block-world-content-row-meta", `${content?.contentType ?? "block-content"} · ${content?.id ?? "NO ID"} · ${selected ? "SELECTED" : "CLICK TO INSPECT"}`),
      );
      row.addEventListener("click", (event) => selectContent(inspectedBlock.id, content?.id ?? index, event?.detail === 0 ? "keyboard" : "content-row"));
      bindKeyboardActivation(row, () => selectContent(inspectedBlock.id, content?.id ?? index, "keyboard"));
      if (previewOnlyRow) {
        row.addEventListener("focus", () => {
          if (contentFocusEl) contentFocusEl.textContent = `HOVER PREVIEW FOCUS · ${content?.label ?? "Nested cube"} · ${content?.contentType ?? "block-content"} · ID ${content?.id ?? "NO ID"} · PARENT ${inspectedBlock.label} (${inspectedBlock.id}) · ${index + 1}/${contents.length} · PRESS ENTER TO SELECT · LOCAL ONLY`;
        });
      }
      contentsEl.appendChild(row);
    });
  }

  function clearDragPreview() {
    if (!dragPreviewMesh) return;
    layer?.remove(dragPreviewMesh);
    dragPreviewMesh = null;
  }

  function syncDragPreview() {
    if (!layer || !three || !geometry || !directManipulation) {
      clearDragPreview();
      return;
    }
    const block = currentProjection.blocks.find((candidate) => candidate.id === directManipulation.blockId);
    if (!block) {
      clearDragPreview();
      return;
    }
    if (!dragPreviewMesh) {
      dragPreviewMesh = new three.Mesh(geometry, dragPreviewMaterialFor(block.blockType));
      dragPreviewMesh.name = "block-world-direct-drag-preview";
      dragPreviewMesh.renderOrder = 18;
      dragPreviewMesh.userData.blockWorldDragPreview = true;
      dragPreviewMesh.userData.blockWorldId = block.id;
      layer.add(dragPreviewMesh);
    }
    const previewDelta = directDeltaVector(directManipulation.previewDelta);
    const position = blockMeshPosition(block, previewDelta);
    dragPreviewMesh.position.set(position.x, position.y, position.z);
    dragPreviewMesh.visible = true;
    dragPreviewMesh.userData.blockWorld = cloneSnapshot(block);
    dragPreviewMesh.userData.blockWorldId = block.id;
    dragPreviewMesh.userData.blockWorldDragPreview = true;
    dragPreviewMesh.userData.blockWorldPreviewDelta = cloneSnapshot(previewDelta);
    dragPreviewMesh.userData.blockWorldPreviewState = hasDirectDelta(previewDelta)
      ? "DRAG PREVIEW ACTIVE · RELEASE TO PLACE"
      : "DRAG READY · MOVE TO PREVIEW · RELEASE TO PLACE";
    dragPreviewMesh.scale.setScalar(hasDirectDelta(previewDelta) ? 1.08 : 1.04);
  }

  function render() {
    renderFeatureInventory();
    // Counts and readouts are optional mount points so a compact/static host
    // can keep the actionable controls mounted even when it omits decorative
    // metrics. The core status/list/palette/trace nodes remain required above.
    if (countEl) countEl.textContent = text(currentProjection.blockCount, "0");
    if (draftEl) draftEl.textContent = text(currentProjection.editCount ?? 0, "0");
    if (containerCountEl) containerCountEl.textContent = text(currentProjection.containerCount ?? 0, "0");
    if (contentCountEl) contentCountEl.textContent = text(currentProjection.nestedContentCount ?? 0, "0");
    const block = selectedBlock();
    const held = heldBlock();
    const visibleBlock = block ?? held;
    const direct = directManipulation;
    syncDragPreview();
    updateSelectionCues();
    if (selectionEl) {
      const containerHint = visibleBlock?.container && !visibleBlock.open && !held
        ? " · DOUBLE-ACTIVATE TO OPEN"
        : "";
      const dragHint = visibleBlock?.canMove ? " · DRAG TO MOVE" : "";
      const previewHint = direct
        ? ` · ${hasDirectDelta(direct.previewDelta)
          ? "DRAG PREVIEW ACTIVE · RELEASE TO PLACE"
          : "DRAG PREVIEW READY"}`
        : "";
      selectionEl.textContent = visibleBlock
        ? `${direct ? "DRAGGING" : held ? "HELD" : "SELECTED"} · ${visibleBlock.label.toUpperCase()} · ${visibleBlock.x},${visibleBlock.y},${visibleBlock.z} · ${visibleBlock.held ? "CARRY MODE" : visibleBlock.container ? `${visibleBlock.open ? "OPENED / INSIDE" : "CLOSED"} · ${Number.isInteger(visibleBlock.contentCount) ? visibleBlock.contentCount : asArray(visibleBlock.contents).length} INSIDE` : "SOLID CUBE"}${containerHint}${dragHint}${previewHint} · ${currentProjection.localDraft ? "DRAFT" : "CANONICAL FIXTURE"}`
         : "SELECT A BLOCK CUBE OR ADD A LOCAL DRAFT";
    }
    if (proximityStatusEl) {
      proximityStatusEl.textContent = proximityState.enabled
        ? `CITY / SKYSCRAPER LENS · ${proximityState.nearCount} NEAR · ${proximityState.scatteredCount} FAR SCATTERED · ${proximityState.culledCount} CULLED · LOCAL PRESENTATION`
        : "CITY / SKYSCRAPER LENS · VIEWPOINT PROXIMITY READY · LOCAL PRESENTATION";
    }
    renderSemanticDepthControls();
    if (containerHintEl) {
      const hoveredContainer = hoveredBlock();
      const hoverOnlyContainer = hoveredContainer?.container && hoveredContainer.id !== visibleBlock?.id;
      const hintBlock = hoverOnlyContainer ? hoveredContainer : visibleBlock;
      const isOpenable = hintBlock?.container && hintBlock?.canOpen;
      const carryingContainer = Boolean(held?.container);
      containerHintEl.hidden = !(isOpenable || carryingContainer);
      if (carryingContainer) {
        containerHintEl.textContent = `CARRY ACTIVE · ${held.label.toUpperCase()} HELD · HOLD → PLACE OR PLACE CUBE · LOCAL ONLY`;
      } else if (isOpenable) {
        const nestedCount = Number.isInteger(hintBlock.contentCount)
          ? hintBlock.contentCount
          : asArray(hintBlock.contents).length;
        containerHintEl.textContent = hoverOnlyContainer
          ? `HOVER PREVIEW · ${nestedCount} NESTED CUBE${nestedCount === 1 ? "" : "S"} INSIDE · CLICK TO SELECT · DOUBLE-ACTIVATE TO OPEN · LOCAL ONLY`
          : hintBlock.open
          ? `OPEN CONTAINER · ${nestedCount} NESTED CUBE${nestedCount === 1 ? "" : "S"} VISIBLE · PEEK ACTIVE · HOLD → PLACE`
          : `CONTAINER READY · ${nestedCount} NESTED CUBE${nestedCount === 1 ? "" : "S"} INSIDE · OPEN CUBE OR DOUBLE-ACTIVATE`;
      }
    }
    const presentation = staticFallback ? "STATIC CONTROLS" : "3-D CUBES";
    const motion = reducedMotion ? " · REDUCED MOTION" : "";
    const nestedCount = Number.isInteger(visibleBlock?.contentCount)
      ? visibleBlock.contentCount
      : asArray(visibleBlock?.contents).length;
    const peekActive = Boolean(visibleBlock?.container && visibleBlock?.open && nestedCount > 0);
    statusEl.textContent = direct
      ? `DIRECT DRAG · ${visibleBlock?.label?.toUpperCase() ?? "CUBE"} · ${hasDirectDelta(direct.previewDelta) ? "PREVIEW ACTIVE · RELEASE TO PLACE" : "MOVE TO PREVIEW"} · ${direct.pointerType?.toUpperCase() ?? "POINTER"} · ${presentation} · LOCAL ONLY`
      : held
      ? `CARRY MODE · ${held.label.toUpperCase()} · ${held.x},${held.y},${held.z} · PLACE IT OR HOLD-STEP IT · ${presentation} · LOCAL ONLY`
      : peekActive
        ? `PEEK ACTIVE · ${nestedCount} NESTED CUBE${nestedCount === 1 ? "" : "S"} STEPPED OUT · HOLD → PLACE · ${presentation} · LOCAL ONLY`
      : currentProjection.localDraft
        ? `DRAFT ACTIVE · ${currentProjection.editCount} LOCAL EDIT${currentProjection.editCount === 1 ? "" : "S"} · ${currentProjection.openContainerCount ?? 0} OPEN · ${presentation}${motion} · NO SYNC`
      : `READY · ${currentProjection.containerCount ?? 0} CUBES CAN OPEN · CLICK TO SELECT · DOUBLE-ACTIVATE A CONTAINER TO OPEN · ${presentation}${motion} · NO SYNC`;
    if (migrationContinuityStatus === "restored") {
      statusEl.textContent += " · MIGRATION HANDOFF RESTORED";
    } else if (migrationContinuityStatus === "missing") {
      statusEl.textContent += " · MIGRATION HANDOFF MISSING · NO CUBE";
    } else if (migrationContinuityStatus === "deferred") {
      statusEl.textContent += " · MIGRATION HANDOFF DEFERRED";
    }
    if (boundaryEl) boundaryEl.textContent = currentProjection.boundary;
    const carrying = Boolean(held);
    const editingLocked = carrying || Boolean(direct);
    addButton.disabled = !block || editingLocked;
    removeButton.disabled = !block || editingLocked;
    replaceButton.disabled = !block || editingLocked;
    if (openButton) {
      openButton.disabled = !block?.canOpen || editingLocked;
      openButton.textContent = block?.open ? "Close cube" : "Open cube";
      openButton.setAttribute("aria-label", block?.open ? "Close selected cube" : "Open selected cube");
    }
    if (inspectButton) inspectButton.disabled = !block || editingLocked;
    [moveLeftButton, moveRightButton, moveForwardButton, moveBackButton, moveUpButton, moveDownButton]
      .filter(Boolean)
      .forEach((button) => { button.disabled = !block?.canMove || editingLocked; });
    if (grabButton) grabButton.disabled = !block || carrying || Boolean(direct);
    [holdLeftButton, holdRightButton, holdForwardButton, holdBackButton, holdUpButton, holdDownButton]
      .filter(Boolean)
      .forEach((button) => { button.disabled = !carrying; });
    if (placeButton) placeButton.disabled = !carrying;
    renderInspection(visibleBlock, hoverPreview);
    renderContentNavigation(block);
    renderList();
    renderPalette();
    renderTrace();
    renderPortalRoutes(block);
    renderNavigationTrace();
    renderLinkedNavigation();
  }

  function renderFeatureInventory() {
    if (!featureRailEl) {
      featureRailEl = documentRoot.createElement("section");
      featureRailEl.id = "block-world-feature-rail";
      featureRailEl.className = "block-world-feature-rail";
      featureRailEl.setAttribute("aria-label", "Feature blocks");
      if (featureRailEl.style) { featureRailEl.style.maxWidth = "100%"; featureRailEl.style.overflowX = "auto"; featureRailEl.style.touchAction = "pan-y"; featureRailEl.style.scrollBehavior = (documentRoot.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) ? "auto" : "smooth"; }
      panel.appendChild(featureRailEl);
    }
    featureRailEl.replaceChildren();
    const heading = documentRoot.createElement("div");
    heading.className = "block-world-feature-heading";
    heading.textContent = `FEATURE BLOCKS · ${featureInventory.length} ENABLED · HOVER TO INSPECT · CLICK TO OPEN`;
    featureRailEl.appendChild(heading);
    const groups = [
      ["WORLD", ["reality-lens", "person", "wardrobe-atelier", "rooms", "block-world", "runtime-sync", "migration", "social-explorer", "projections"]],
      ["VALUE", ["asset-token", "asset-market", "launch-distribution", "paycore", "contracts", "contract-atelier", "ledger", "t402"]],
      ["EVIDENCE", ["gateway", "world-events", "sports-events", "multi-sport-events", "picture-matter", "nft-atelier", "white-paper"]],
      ["AGENTS + PLAY", ["neural-mesh", "arena", "academy", "luna-companion", "gesture-lens"]],
    ];
    groups.forEach(([groupName, ids]) => {
      const members = featureInventory.filter((feature) => ids.includes(feature.id));
      if (!members.length) return;
      const cluster = documentRoot.createElement("section");
      cluster.className = "block-world-feature-cluster";
      cluster.dataset.featureCluster = groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const clusterButton = documentRoot.createElement("button");
      clusterButton.type = "button";
      clusterButton.className = "block-world-feature-cluster-toggle";
      clusterButton.textContent = `${groupName} CLUSTER · ${members.length} FEATURES · OPEN`;
      clusterButton.title = `Show ${members.map((feature) => feature.label).join(", ")}`;
      clusterButton.setAttribute("aria-expanded", "true");
      const grid = documentRoot.createElement("div");
      grid.className = "block-world-feature-grid";
      if (grid.style) {
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(min(15rem, 100%), 1fr))";
        grid.style.gap = "0.6rem";
      }
      const announceCluster = (mode = "HOVER") => {
        statusEl.textContent = `CLUSTER ${mode} · ${groupName} · ${members.length} FEATURE ROUTES · LOCAL ONLY`;
      };
      clusterButton.addEventListener("pointerenter", () => announceCluster());
      clusterButton.addEventListener("focus", () => announceCluster("FOCUS"));
      clusterButton.addEventListener("click", () => {
        const expanded = grid.hidden === true;
        grid.hidden = !expanded;
        clusterButton.setAttribute("aria-expanded", String(expanded));
        clusterButton.textContent = `${groupName} CLUSTER · ${members.length} FEATURES · ${expanded ? "OPEN" : "CLOSED"}`;
      });
      cluster.append(clusterButton, grid);
      featureRailEl.appendChild(cluster);
      members.forEach((feature) => {
      const block = documentRoot.createElement("button");
      block.type = "button";
      block.className = "block-world-feature-block";
      if (block.style) { block.style.minHeight = "3.25rem"; block.style.touchAction = "manipulation"; }
      block.dataset.featureId = feature.id;
      block.dataset.featureBlock = "true";
      block.title = feature.description;
      block.setAttribute("aria-label", `${feature.label}: ${feature.description}`);
      block.append(
        Object.assign(documentRoot.createElement("strong"), { textContent: feature.label }),
        Object.assign(documentRoot.createElement("span"), { textContent: feature.description }),
      );
      const announceFeature = (mode = "HOVER") => {
        statusEl.textContent = `FEATURE ${mode} · ${feature.label.toUpperCase()} · ${feature.description} · LOCAL ONLY`;
      };
      block.addEventListener("pointerenter", () => {
        hoveredFeatureId = feature.id;
        block.dataset.hovered = "true";
        announceFeature();
      });
      block.addEventListener("focus", () => announceFeature("FOCUS"));
      block.addEventListener("pointerleave", () => {
        if (hoveredFeatureId === feature.id) hoveredFeatureId = null;
        delete block.dataset.hovered;
      });
      block.addEventListener("click", () => {
        onFeatureNavigate?.(feature.id, "feature-block");
      });
      grid.appendChild(block);
      });
    });
    if (distributionCohorts.length) {
      const cluster = documentRoot.createElement("section");
      cluster.className = "block-world-feature-cluster block-world-distribution-cluster";
      cluster.dataset.featureCluster = "distribution";
      const toggle = documentRoot.createElement("button"); toggle.type = "button"; toggle.className = "block-world-feature-cluster-toggle";
      toggle.textContent = `DISTRIBUTION COHORTS · ${distributionCohorts.length} · OPEN`; toggle.setAttribute("aria-expanded", "true");
      const grid = documentRoot.createElement("div"); grid.className = "block-world-feature-grid"; if (grid.style) { grid.style.display = "grid"; grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(min(15rem, 100%), 1fr))"; grid.style.gap = "0.6rem"; }
      const announceDistributionCluster = (mode = "HOVER") => { statusEl.textContent = `CLUSTER ${mode} · DISTRIBUTION · ${distributionCohorts.length} CANONICAL COHORTS · LOCAL ONLY`; };
      toggle.addEventListener("pointerenter", () => announceDistributionCluster());
      toggle.addEventListener("focus", () => announceDistributionCluster("FOCUS"));
      toggle.addEventListener("click", () => { const open = grid.hidden === true; grid.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); toggle.textContent = `DISTRIBUTION COHORTS · ${distributionCohorts.length} · ${open ? "OPEN" : "CLOSED"}`; });
      cluster.append(toggle, grid); featureRailEl.appendChild(cluster);
      distributionCohorts.forEach((cohort) => { const block=documentRoot.createElement("button"); block.type="button"; block.className="block-world-feature-block block-world-distribution-block"; if (block.style) { block.style.minHeight="3.25rem"; block.style.touchAction="manipulation"; } block.dataset.cohortId=cohort.id; block.dataset.distributionBlock="true"; block.tabIndex=0; block.title=cohort.detail; block.setAttribute("aria-label",`${cohort.label}: ${cohort.detail}`); block.append(Object.assign(documentRoot.createElement("strong"),{textContent:cohort.label}),Object.assign(documentRoot.createElement("span"),{textContent:cohort.detail})); const announce=()=>{statusEl.textContent=`COHORT FOCUS · ${cohort.label.toUpperCase()} · ${cohort.detail} · LOCAL ONLY`}; block.addEventListener("pointerenter",announce); block.addEventListener("focus",announce); block.addEventListener("click",()=>{statusEl.textContent=`COHORT OPEN · ${cohort.label.toUpperCase()} · ${cohort.detail} · LOCAL ONLY`; onDistributionNavigate?.(cohort.id,"distribution-block")}); grid.appendChild(block); });
    }
  }

  function setFeatureInventory(features = []) {
    featureInventory = Array.isArray(features)
      ? features.filter((feature) => feature && typeof feature.id === "string" && feature.id.trim()
        && typeof feature.label === "string" && feature.label.trim()
        && typeof feature.description === "string" && feature.description.trim())
        .map((feature) => Object.freeze({ id: feature.id, label: feature.label, description: feature.description }))
      : [];
    renderFeatureInventory();
    return getSnapshot().featureInventory;
  }

  function setDistributionCohorts(records = []) {
    distributionCohorts = Array.isArray(records) ? records.filter((record) => typeof record?.id === "string" && record.id.startsWith("cohort:") && typeof record.label === "string").map((record) => { const percentage = record.percentage ?? (Number(record.shareBasisPoints) / 100); const basisPoints = record.basisPoints ?? record.shareBasisPoints ?? 0; const units = record.tokenUnits ?? "unavailable"; const recipientClass = record.recipientClass ?? record.class ?? "aggregate cohort"; const provenance = record.provenance?.source ?? record.source ?? "tumbo-distribution-registry"; const detail = `${percentage}% · ${basisPoints} BP · ${units} TUMBO-SIM · ${recipientClass} · ${record.coverage ?? "canonical aggregate cohort"} · PROVENANCE ${provenance}`; return Object.freeze({ id: record.id, label: record.label, coverage: record.coverage ?? "canonical aggregate cohort", percentage, basisPoints, tokenUnits: units, recipientClass, provenance, detail }); }) : [];
    renderFeatureInventory();
    return getSnapshot().distributionCohorts;
  }

  function focusDistributionCohort(cohortId) {
    const id = String(cohortId ?? "");
    if (!id.startsWith("cohort:")) return false;
    const escape = globalThis.CSS?.escape ?? ((value) => value.replace(/(["\\])/g, "\\$1"));
    const target = featureRailEl?.querySelector?.(`[data-distribution-block="true"][data-cohort-id="${escape(id)}"]`);
    if (!target || typeof target.focus !== "function") return false;
    target.focus();
    return true;
  }

  function rebuild() {
    if (hoveredId && !currentProjection.blocks.some((block) => block.id === hoveredId)) hoveredId = null;
    if (gazeLockedId
      && !currentProjection.blocks.some((block) => block.id === gazeLockedId)
      && heldBlock()?.id !== gazeLockedId) {
      gazeLockedId = null;
      gazeLockAction = "idle";
      gazeLockPoint = null;
      gazeLockExpiresAt = null;
      gazeLockReason = "target-missing";
    }
    if (contentFocus) {
      const parent = contentParent(contentFocus.parentBlockId);
      if (!parent || selectedId !== parent.id || !resolveBlockWorldContent(parent, contentFocus.contentId)) clearContentFocus("parent-change");
    }
    syncSemanticDepthProjection();
    syncHoverPreview();
    clearHoverPreviewMeshes();
    if (!layer || !three || !geometry) return;
    clearDragPreview();
    containerCues.forEach((cue) => layer.remove(cue));
    blockMeshes.forEach((mesh) => {
      layer.remove(mesh);
      const index = raycastTargets.indexOf(mesh);
      if (index >= 0) raycastTargets.splice(index, 1);
    });
    contentMeshes.forEach((mesh) => {
      layer.remove(mesh);
      const index = raycastTargets.indexOf(mesh);
      if (index >= 0) raycastTargets.splice(index, 1);
    });
    blockMeshes = new Map();
    selectionCues = new Map();
    gazeLockCues = new Map();
    containerCues = new Map();
    contentMeshes = [];
    interactiveMeshes = new Set();
    const width = currentProjection.dimensions.width;
    const depth = currentProjection.dimensions.depth;
    currentProjection.blocks.forEach((block) => {
      const open = block.container === true && block.open === true;
      // Closed containers use the slightly larger shell so their affordance
      // reads in the field; opening swaps to the inset body and lifted cap.
      // Both paths remain ordinary box geometry and keep the owning block ID.
      const bodyGeometry = open ? openGeometry : block.container ? containerGeometry : geometry;
      const bodyRole = block.container ? (open ? "container-open" : "container") : "solid";
      const mesh = new three.Mesh(bodyGeometry, materialFor(block.blockType, bodyRole));
      const baseY = block.y * 0.82 - 0.25;
      setBasePosition(mesh, {
        x: block.x - (width - 1) / 2,
        y: baseY,
        z: block.z - (depth - 1) / 2,
      });
      setBaseScale(mesh, 1);
      // Re-apply a gizmo-built arrangement so snapshots and replay preserve
      // the free transform Tumbo placed (additive, 2026-09-18).
      applyStoredBlockTransform(mesh, block);
      mesh.userData.blockWorld = cloneSnapshot(block);
      mesh.userData.blockWorldId = block.id;
      mesh.userData.blockWorldContainer = block.container === true;
      mesh.userData.blockWorldOpenable = block.canOpen === true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      addSelectionCue(mesh, block.id, open ? "open" : block.container ? "container" : "solid");
      addGazeLockCue(mesh, block.id, open ? "open" : block.container ? "container" : "solid");
      layer.add(mesh);
      raycastTargets.push(mesh);
      interactiveMeshes.add(mesh);
      blockMeshes.set(block.id, mesh);

      if (block.container) {
        // A small deep-red cube signal sits well above every openable body. It
        // is intentionally outside `raycastTargets`: clicks, double
        // activation, and direct drag continue to resolve against the owning
        // body/lid and stable block id.
        const cue = new three.Mesh(containerCueGeometry, containerCueMaterialFor(block.blockType, open));
        // Keep the historical object name for host selectors; the explicit
        // signal metadata below carries the new deep-red affordance contract.
        cue.name = "block-world-container-cue";
        setBasePosition(cue, { x: mesh.position.x, y: baseY + BLOCK_WORLD_CONTAINER_SIGNAL_OFFSET_Y, z: mesh.position.z });
        setBaseScale(cue, open ? 1.15 : 1);
        cue.userData.blockWorldId = block.id;
        cue.userData.blockWorldContainerCue = true;
        cue.userData.blockWorldContainerSignal = true;
        cue.userData.blockWorldSignalGeometry = "BoxGeometry";
        cue.userData.blockWorldSignalColor = BLOCK_WORLD_CONTAINER_SIGNAL_COLOR;
        cue.userData.blockWorldSignalEmissive = BLOCK_WORLD_CONTAINER_SIGNAL_EMISSIVE;
        cue.userData.blockWorldSignalIntensity = BLOCK_WORLD_CONTAINER_SIGNAL_INTENSITY;
        cue.userData.blockWorldSignalOffset = Object.freeze({ x: 0, y: BLOCK_WORLD_CONTAINER_SIGNAL_OFFSET_Y, z: 0 });
        cue.userData.blockWorldOpenable = block.canOpen === true;
        cue.userData.blockWorldOpen = open;
        layer.add(cue);
        containerCues.set(block.id, cue);

        // Every container gets a bright cubic cap, including when it is
        // closed. This makes an openable cube legible in the field before the
        // user discovers it through the directory, while keeping the visual
        // language strictly box-shaped (no rings, spheres, or round markers).
        const lid = new three.Mesh(lidGeometry, contentMaterialFor(block.blockType));
        setBasePosition(lid, { x: mesh.position.x, y: baseY + (open ? 0.48 : 0.43), z: mesh.position.z });
        setBaseScale(lid, 1);
        lid.userData.blockWorld = cloneSnapshot(block);
        lid.userData.blockWorldId = block.id;
        lid.userData.blockWorldLid = true;
        lid.userData.blockWorldOpenable = block.canOpen === true;
        lid.userData.blockWorldContainerCap = !open;
        layer.add(lid);
        raycastTargets.push(lid);
        interactiveMeshes.add(lid);
        contentMeshes.push(lid);
      }

      if (open) {
        // Nested contents are also cubes and sit just above the rim so they
        // visibly step out from the shell without introducing decorative
        // spheres or other round geometry. The same cube-only transform is
        // reused by the transient hover preview. Hover peeks are raycastable
        // cubes too; the host routes their click to content selection rather
        // than direct parent manipulation.
        block.contents.forEach((content, contentIndex) => {
          const peekOffset = getBlockWorldContainerPeekOffset(content, contentIndex, block.contents.length);
          const contentMesh = new three.Mesh(contentGeometry, contentMaterialFor(content.blockType));
          setBasePosition(contentMesh, {
            x: mesh.position.x + peekOffset.x,
            y: baseY + peekOffset.y,
            z: mesh.position.z + peekOffset.z,
          });
          setBaseScale(contentMesh, 1);
          contentMesh.userData.blockWorld = cloneSnapshot(block);
          contentMesh.userData.blockWorldId = block.id;
          contentMesh.userData.blockWorldContent = cloneSnapshot(content);
          contentMesh.userData.blockWorldOpen = open;
          contentMesh.userData.blockWorldPeek = true;
          contentMesh.userData.blockWorldContentSelectable = true;
          contentMesh.userData.blockWorldContentParentId = block.id;
          contentMesh.userData.blockWorldPeekIndex = contentIndex;
          contentMesh.userData.blockWorldPeekOffset = peekOffset;
          contentMesh.userData.blockWorldBloom = peekOffset.bloom;
          contentMesh.userData.blockWorldPeekAction = "OPEN → PEEK → HOLD → PLACE";
          contentMesh.userData.blockWorldContentAction = "CLICK TO INSPECT CONTENT · HOLD PARENT → PLACE";
          layer.add(contentMesh);
          raycastTargets.push(contentMesh);
          interactiveMeshes.add(contentMesh);
          contentMeshes.push(contentMesh);
        });
      }
    });
    const carried = heldBlock();
    if (carried) {
      // A carried cube remains a cube, but floats slightly above its grid cell
      // so the local carry state is obvious in the 3-D view.
      const mesh = new three.Mesh(geometry, materialFor(carried.blockType));
      const baseY = carried.y * 0.82 + 0.44;
      setBasePosition(mesh, {
        x: carried.x - (width - 1) / 2,
        y: baseY,
        z: carried.z - (depth - 1) / 2,
      });
      setBaseScale(mesh, 1);
      mesh.userData.blockWorld = cloneSnapshot(carried);
      mesh.userData.blockWorldId = carried.id;
      mesh.userData.blockWorldHeld = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      addSelectionCue(mesh, carried.id, "solid");
      addGazeLockCue(mesh, carried.id, "solid");
      layer.add(mesh);
      raycastTargets.push(mesh);
      interactiveMeshes.add(mesh);
      blockMeshes.set(carried.id, mesh);
    }
    syncHoverPreviewMeshes();
    // Meshes were recreated above: re-glue the gizmo to the selected cube when
    // a manipulate mode is armed (additive, 2026-09-18).
    if (manipulateMode) syncManipulatorForSelection("rebuild");
  }

  function asNumberTriple(value, fallback = [0, 0, 0]) {
    if (!Array.isArray(value)) return [...fallback];
    return [0, 1, 2].map((index) => {
      const number = Number(value[index]);
      return Number.isFinite(number) ? number : fallback[index];
    });
  }

  /**
   * Re-apply a stored free transform to a freshly built mesh so snapshots and
   * replay preserve the arrangement Tumbo built with the gizmo.
   */
  function applyStoredBlockTransform(mesh, block) {
    const stored = block?.transform;
    if (!mesh || !stored || typeof stored !== "object") return false;
    const position = asNumberTriple(stored.position, null);
    const rotation = asNumberTriple(stored.rotation, null);
    const scale = asNumberTriple(stored.scale, null);
    if (!position || !rotation || !scale) return false;
    mesh.position.set(position[0], position[1], position[2]);
    if (mesh.rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.userData.blockWorldManipulatedTransform = cloneSnapshot({ position, rotation, scale });
    return true;
  }

  function attachManipulatorToBlock(block, reason = "select") {
    if (!block || !manipulateMode) return null;
    const mesh = blockMeshes.get(block.id);
    if (!mesh) return null;
    const record = manipulator.attach(mesh, block.id, reason);
    if (record?.action === "attach" || record?.action === "attach-noop") {
      statusEl.textContent = `MANIPULATE ${MANIPULATE_MODE_LABELS[manipulateMode]} · ${block.id} · DRAG THE GIZMO · DEPTH INCLUDED · LOCAL ONLY`;
    } else {
      statusEl.textContent = `MANIPULATE ATTACH BLOCKED · ${String(record?.reason ?? "unavailable").toUpperCase()} · LOCAL ONLY`;
    }
    return record;
  }

  /**
   * Keep the gizmo glued to selection: selecting a cube while a manipulate
   * mode is armed attaches the gizmo; clearing the selection detaches it.
   */
  function syncManipulatorForSelection(reason = "selection") {
    if (!manipulateMode) return null;
    const block = selectedBlock();
    if (block) return attachManipulatorToBlock(block, reason);
    manipulator.detach("selection-cleared");
    return null;
  }

  /**
   * Arm or disarm free 3D manipulation. Arming with a selected cube attaches
   * the gizmo immediately; arming with no selection waits for the next
   * selection. Passing null detaches and disarms.
   */
  function setManipulateMode(mode = null) {
    const normalized = mode == null ? null : String(mode).trim().toLowerCase();
    if (normalized !== null && !MANIPULATE_MODES.includes(normalized)) {
      statusEl.textContent = "MANIPULATE MODE BLOCKED · UNKNOWN MODE · LOCAL ONLY";
      return manipulator.getSnapshot();
    }
    manipulateMode = normalized;
    manipulator.setMode(normalized);
    if (normalized === null) {
      statusEl.textContent = "MANIPULATE OFF · LOCAL ONLY";
    } else if (!manipulator.isAvailable()) {
      statusEl.textContent = `MANIPULATE ${MANIPULATE_MODE_LABELS[normalized]} UNAVAILABLE · 3D SURFACE NOT READY · LOCAL ONLY`;
    } else {
      const block = selectedBlock();
      if (block) attachManipulatorToBlock(block, "mode");
      else statusEl.textContent = `MANIPULATE ${MANIPULATE_MODE_LABELS[normalized]} ARMED · SELECT A CUBE · LOCAL ONLY`;
    }
    render();
    return getSnapshot();
  }

  /**
   * Gizmo release write-back: the canonical position/rotation/scale land in
   * the block's projection record as plain frozen arrays, so snapshots and
   * replay preserve the arrangement. Presentation-only; never authority.
   */
  function writeManipulatorTransform(blockId, transform, context = {}) {
    const block = currentProjection.blocks.find((candidate) => candidate.id === blockId) ?? null;
    if (!block || !transform) return null;
    const frozenTransform = cloneSnapshot({
      position: asNumberTriple(transform.position),
      rotation: asNumberTriple(transform.rotation),
      scale: asNumberTriple(transform.scale, [1, 1, 1]),
    });
    const nextBlocks = currentProjection.blocks.map((candidate) => (
      candidate.id === blockId ? { ...candidate, transform: frozenTransform } : candidate
    ));
    currentProjection = cloneSnapshot({
      ...currentProjection,
      blocks: nextBlocks,
      localDraft: true,
      editCount: (currentProjection.editCount ?? 0) + 1,
      lastEdit: {
        action: "manipulate-transform",
        blockId,
        transform: frozenTransform,
        mode: context?.mode ?? manipulateMode,
        method: "gizmo-release",
      },
    });
    const mesh = blockMeshes.get(blockId);
    if (mesh?.userData) {
      mesh.userData.blockWorldManipulatedTransform = frozenTransform;
    }
    addTrace("manipulate-transform", block);
    render();
    const modeLabel = MANIPULATE_MODE_LABELS[context?.mode ?? manipulateMode] ?? "MANIPULATE";
    statusEl.textContent = `CUBE RESHAPED · ${modeLabel} · ARRANGEMENT SAVED · LOCAL ONLY`;
    const snapshot = cloneSnapshot({
      action: "manipulate-transform",
      blockId,
      block: blockId,
      transform: frozenTransform,
      mode: context?.mode ?? manipulateMode,
      method: "gizmo-release",
      draft: currentProjection,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    });
    onEdit?.(snapshot);
    return snapshot;
  }

  function selectBlock(id, method = "row") {
    const block = currentProjection.blocks.find((candidate) => candidate.id === id) ?? (heldBlock()?.id === id ? heldBlock() : null);
    if (!block) return null;
    if (lastFieldTap && lastFieldTap.blockId !== block.id) clearFieldTap();
    if (contentFocus && (contentFocus.parentBlockId !== block.id || !String(method).startsWith("content-"))) {
      clearContentFocus("parent-change");
    }
    hoveredContent = null;
    selectedId = id;
    // Route the existing selection into the gizmo when a manipulate mode is armed.
    syncManipulatorForSelection(`select:${method}`);
    if (!String(method).startsWith("linked-")) lastLinkedNavigation = null;
    rememberMigrationContinuity(block, method, "available");
    render();
    const snapshot = cloneSnapshot({
      ...block,
      method,
      migrationContinuity,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onSelect?.(snapshot, method);
    return snapshot;
  }

  function applyInteraction(action, extra = {}) {
    const block = selectedBlock();
    if (!block) return null;
    let next;
    try {
      next = createBlockWorldInteractionDraft(draftBase(currentProjection), {
        action,
        blockId: block.id,
        ...extra,
      });
    } catch (error) {
      statusEl.textContent = `BLOCK ACTION BLOCKED · ${error.message} · LOCAL ONLY`;
      return null;
    }
    currentProjection = cloneSnapshot({
      ...summarizeBlockWorld(next),
      localDraft: true,
      editCount: next.editCount,
      lastEdit: next.lastEdit,
    });
    const nextBlock = currentProjection.blocks.find((candidate) => (
      candidate.x === next.lastEdit?.to?.[0]
        && candidate.y === next.lastEdit?.to?.[1]
        && candidate.z === next.lastEdit?.to?.[2]
    )) ?? currentProjection.blocks.find((candidate) => candidate.x === block.x && candidate.y === block.y && candidate.z === block.z);
    selectedId = nextBlock?.id ?? selectedId;
    if (action === "close" || (contentFocus && contentFocus.parentBlockId !== selectedId)) clearContentFocus(action === "close" ? "close" : "parent-change");
    if (nextBlock) rememberMigrationContinuity(nextBlock, `interaction:${action}`, "available");
    addTrace(next.lastEdit?.action ?? action, nextBlock ?? block);
    rebuild();
    render();
    const snapshot = cloneSnapshot({
      action: next.lastEdit?.action ?? action,
      block: nextBlock ?? block,
      previousBlock: block,
      draft: currentProjection,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    if (["open", "close"].includes(snapshot.action)) onOpen?.(snapshot, snapshot.action);
    if (snapshot.action === "move") onMove?.(snapshot, snapshot.action);
    onEdit?.(snapshot);
    return snapshot;
  }

  function applyCarryInteraction(action, request = undefined) {
    const block = selectedBlock();
    if (action === "grab" && !block) return null;
    const source = draftBase(currentProjection);
    let next;
    try {
      if (action === "grab") next = createBlockWorldGrabDraft(source, block.id);
      else if (action === "hold") next = createBlockWorldHoldDraft(source, request);
      else if (action === "place") next = createBlockWorldPlaceDraft(source, request);
      else throw new TypeError(`Unsupported carry action: ${action}`);
    } catch (error) {
      statusEl.textContent = `CARRY ACTION BLOCKED · ${error.message} · LOCAL ONLY`;
      return null;
    }

    currentProjection = cloneSnapshot({
      ...summarizeBlockWorld(next),
      localDraft: true,
      editCount: next.editCount,
      lastEdit: next.lastEdit,
      holding: next.holding === true,
      held: next.held ?? null,
      heldBlock: next.heldBlock ?? null,
      heldBlockId: next.heldBlockId ?? null,
      heldCoordinate: next.heldCoordinate ?? null,
      placedBlock: next.placedBlock ?? null,
      releasedBlock: next.releasedBlock ?? null,
    });
    if (action === "grab" || action === "hold") selectedId = next.heldBlock?.id ?? selectedId;
    if (action === "place") selectedId = next.placedBlock?.id ?? selectedId;
    const traceBlock = next.heldBlock ?? next.placedBlock ?? next.releasedBlock ?? block;
    if (traceBlock) rememberMigrationContinuity(traceBlock, `carry:${action}`, "available");
    addTrace(action, traceBlock);
    rebuild();
    render();
    const snapshot = cloneSnapshot({
      action,
      block: traceBlock ?? null,
      heldBlock: next.heldBlock ?? null,
      placedBlock: next.placedBlock ?? null,
      releasedBlock: next.releasedBlock ?? null,
      draft: currentProjection,
      holding: next.holding === true,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    });
    if (action === "grab") onGrab?.(snapshot, action);
    if (action === "hold") onHold?.(snapshot, action);
    if (action === "place") onPlace?.(snapshot, action);
    onEdit?.(snapshot);
    return snapshot;
  }

  function grabSelected() {
    return applyCarryInteraction("grab");
  }

  function holdSelected(deltaOrCoordinate) {
    return applyCarryInteraction("hold", deltaOrCoordinate);
  }

  function placeHeld(coordinate) {
    return applyCarryInteraction("place", coordinate);
  }

  function beginDirectManipulation(target, input = {}) {
    if (currentProjection.holding === true || currentProjection.heldBlock) {
      statusEl.textContent = "CARRY MODE ACTIVE · PLACE THE HELD CUBE BEFORE A DIRECT DRAG · LOCAL ONLY";
      return null;
    }
    const block = resolveBlockFromProjection(currentProjection, target, selectedBlock());
    if (!block) return null;
    const start = directInputPoint(input);
    if (!start) {
      statusEl.textContent = "DIRECT DRAG NEEDS A POINTER POSITION · USE THE HOLD BUTTONS INSTEAD · LOCAL ONLY";
      return null;
    }
    selectedId = block.id;
    rememberMigrationContinuity(block, "direct-drag-start", "available");
    directManipulation = {
      blockId: block.id,
      pointerId: Number.isInteger(input.pointerId) ? input.pointerId : null,
      pointerType: typeof input.pointerType === "string" && input.pointerType.trim() !== ""
        ? input.pointerType
        : "pointer",
      start,
      current: start,
      previewDelta: null,
      thresholdPx: BLOCK_WORLD_DIRECT_DRAG_THRESHOLD_PX,
    };
    render();
    return directInputSnapshot({
      action: "direct-drag-start",
      block,
      blockId: block.id,
      pointerId: directManipulation.pointerId,
      pointerType: directManipulation.pointerType,
      start,
      thresholdPx: BLOCK_WORLD_DIRECT_DRAG_THRESHOLD_PX,
    });
  }

  function updateDirectManipulation(input = {}) {
    if (!directManipulation) return null;
    const point = directInputPoint(input);
    if (!point) return null;
    if (Number.isInteger(directManipulation.pointerId)
      && Number.isInteger(input.pointerId)
      && input.pointerId !== directManipulation.pointerId) return null;
    directManipulation = {
      ...directManipulation,
      current: point,
      previewDelta: mapBlockWorldDragDelta(directManipulation.start, point),
    };
    render();
    return directInputSnapshot({
      action: "direct-drag-update",
      blockId: directManipulation.blockId,
      pointerId: directManipulation.pointerId,
      pointerType: directManipulation.pointerType,
      start: directManipulation.start,
      current: point,
      previewDelta: directManipulation.previewDelta,
      thresholdPx: directManipulation.thresholdPx,
    });
  }

  function completeDirectManipulation(input = {}) {
    if (!directManipulation) return null;
    const gesture = directManipulation;
    const point = directInputPoint(input) ?? gesture.current;
    if (Number.isInteger(gesture.pointerId)
      && Number.isInteger(input.pointerId)
      && input.pointerId !== gesture.pointerId) return null;
    const block = currentProjection.blocks.find((candidate) => candidate.id === gesture.blockId) ?? null;
    directManipulation = null;
    const delta = mapBlockWorldDragDelta(gesture.start, point, gesture.thresholdPx);
    if (!delta) {
      render();
      return directInputSnapshot({
        action: "direct-drag-cancel",
        reason: "below-threshold",
        blockId: gesture.blockId,
        block,
        pointerId: gesture.pointerId,
        pointerType: gesture.pointerType,
        start: gesture.start,
        current: point,
      });
    }

    let next;
    try {
      next = createBlockWorldDirectManipulationDraft(draftBase(currentProjection), gesture.blockId, delta);
    } catch (error) {
      // The atomic domain helper validates bounds and collisions before
      // constructing a draft. Keep the current draft and canonical projection
      // untouched when a drag cannot land.
      render();
      clearFieldTap();
      statusEl.textContent = `DIRECT DRAG BLOCKED · ${error.message} · LOCAL ONLY`;
      return directInputSnapshot({
        action: "direct-drag-rejected",
        reason: error.message,
        blockId: gesture.blockId,
        block,
        delta,
        pointerId: gesture.pointerId,
        pointerType: gesture.pointerType,
        start: gesture.start,
        current: point,
        draft: currentProjection,
      });
    }
    currentProjection = cloneSnapshot({
      ...summarizeBlockWorld(next),
      localDraft: true,
      editCount: next.editCount,
      lastEdit: next.lastEdit,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      holding: false,
      held: null,
      heldBlock: null,
      heldBlockId: null,
      heldCoordinate: null,
      placedBlock: next.placedBlock ?? null,
      releasedBlock: next.releasedBlock ?? null,
      directManipulation: next.directManipulation ?? null,
      interactionSteps: next.interactionSteps ?? [],
    });
    const placed = next.placedBlock ?? currentProjection.blocks.find((candidate) => candidate.id === next.lastEdit?.placedBlockId) ?? null;
    selectedId = placed?.id ?? selectedId;
    if (placed) rememberMigrationContinuity(placed, "direct-drag", "available");
    clearFieldTap();
    addTrace("direct-drag", placed ?? block);
    rebuild();
    render();
    const snapshot = directInputSnapshot({
      action: "direct-drag",
      method: "pointer-or-touch",
      block: placed,
      previousBlock: block,
      placedBlock: placed,
      releasedBlock: next.releasedBlock ?? null,
      delta,
      from: next.lastEdit?.from ?? null,
      to: next.lastEdit?.to ?? null,
      transition: next.lastEdit?.transition ?? "grab>hold>place",
      stages: next.interactionSteps ?? next.lastEdit?.stages ?? [],
      directManipulation: next.directManipulation ?? next.lastEdit ?? null,
      pointerId: gesture.pointerId,
      pointerType: gesture.pointerType,
      start: gesture.start,
      current: point,
      draft: currentProjection,
    });
    onDirectManipulation?.(snapshot, "direct-drag");
    onEdit?.(snapshot);
    return snapshot;
  }

  function cancelDirectManipulation(reason = "cancelled") {
    if (!directManipulation) return null;
    const gesture = directManipulation;
    directManipulation = null;
    clearFieldTap();
    render();
    return directInputSnapshot({
      action: "direct-drag-cancel",
      reason,
      blockId: gesture.blockId,
      pointerId: gesture.pointerId,
      pointerType: gesture.pointerType,
      start: gesture.start,
      current: gesture.current,
    });
  }

  function toggleSelectedBlock() {
    const block = selectedBlock();
    if (!block?.canOpen) {
      if (block) statusEl.textContent = "SOLID CUBE · INSPECT OR MOVE IT · NO NESTED CONTENTS";
      return null;
    }
    return applyInteraction(block.open ? "close" : "open");
  }

  function tapTimestamp(input = {}) {
    const candidate = [input.timeStamp, input.timestamp, input.time, input.now]
      .map(Number)
      .find(Number.isFinite);
    return candidate ?? Date.now();
  }

  function tapDistance(first, second) {
    if (!first || !second) return 0;
    const dx = Number(second.clientX) - Number(first.clientX);
    const dy = Number(second.clientY) - Number(first.clientY);
    return Number.isFinite(dx) && Number.isFinite(dy) ? Math.hypot(dx, dy) : 0;
  }

  /**
   * Toggle a selected container from a deliberate field double activation.
   * This deliberately routes through the same local interaction contract as
   * the button/keyboard control, so the main bridge observes one `open` or
   * `close` event and solid/malformed cubes remain inert.
   */
  function activateFieldDouble(target = selectedId, method = "double-click") {
    const block = resolveBlockFromProjection(currentProjection, target, selectedBlock());
    lastFieldTap = null;
    if (!block) return null;
    selectedId = block.id;
    if (!block.canOpen) {
      render();
      statusEl.textContent = "SOLID CUBE · DOUBLE ACTIVATION NEEDS A CONTAINER · LOCAL ONLY";
      return null;
    }
    const interaction = toggleSelectedBlock();
    return interaction
      ? cloneSnapshot({
        ...interaction,
        method,
        gesture: method === "double-tap" ? "double-tap" : "double-click",
        fieldActivation: true,
      })
      : null;
  }

  /**
   * Record one pointer-up tap and recognize a same-cube, same-pointer-type
   * second tap inside the deterministic time and distance bounds. The first
   * tap only selects (the pointer-down seam owns that selection); it never
   * opens a cube. This method is intentionally renderer-local and contains no
   * native `dblclick` listener, avoiding duplicate mouse click paths.
   */
  function registerFieldTap(target, input = {}) {
    const block = resolveBlockFromProjection(currentProjection, target, selectedBlock());
    if (!block) {
      lastFieldTap = null;
      return null;
    }
    if (selectedId !== block.id) {
      selectedId = block.id;
      render();
    }
    const pointerType = typeof input.pointerType === "string" && input.pointerType.trim() !== ""
      ? input.pointerType
      : "pointer";
    const timestamp = tapTimestamp(input);
    const point = directInputPoint(input);
    const previous = lastFieldTap;
    const elapsed = previous ? timestamp - previous.timestamp : Infinity;
    const sameTarget = previous?.blockId === block.id && previous.pointerType === pointerType;
    const sameGesture = sameTarget
      && elapsed >= 0
      && elapsed <= BLOCK_WORLD_DOUBLE_ACTIVATION_WINDOW_MS
      && tapDistance(previous.point, point) <= BLOCK_WORLD_DOUBLE_ACTIVATION_DISTANCE_PX;
    if (sameGesture) {
      lastFieldTap = null;
      return activateFieldDouble(block.id, pointerType === "touch" ? "double-tap" : "double-click");
    }
    lastFieldTap = { blockId: block.id, pointerType, timestamp, point };
    return null;
  }

  function clearFieldTap() {
    lastFieldTap = null;
  }

  function moveSelected(delta) {
    return applyInteraction("move", { delta });
  }

  function inspectSelected() {
    const block = selectedBlock();
    if (!block) return null;
    const snapshot = inspectBlockWorldBlock(currentProjection, block.id);
    addTrace("inspect", block);
    renderInspection(block);
    const contentCount = Number.isInteger(block.contentCount) ? block.contentCount : asArray(block.contents).length;
    statusEl.textContent = block.container
      ? `INSPECTED · ${contentCount} NESTED ITEM${contentCount === 1 ? "" : "S"} · ${block.open ? "OPEN" : "OPEN THE CUBE TO REVEAL THEM"} · LOCAL ONLY`
      : "INSPECTED · SOLID CUBE · NO NESTED CONTENTS · LOCAL ONLY";
    renderTrace();
    onInspect?.(snapshot);
    return snapshot;
  }

  function edit(action) {
    if (currentProjection.holding === true || currentProjection.heldBlock) {
      statusEl.textContent = "CARRY MODE ACTIVE · PLACE THE HELD CUBE BEFORE EDITING THE GRID · LOCAL ONLY";
      return null;
    }
    const block = selectedBlock();
    if (!block) return null;
    const editAt = action === "add"
      ? { x: block.x, y: Math.min(block.y + 1, currentProjection.dimensions.height - 1), z: block.z, blockType: selectedPalette }
      : { x: block.x, y: block.y, z: block.z, blockType: action === "replace" ? selectedPalette : undefined };
    const next = createBlockWorldDraft(currentProjection, { action, ...editAt });
    currentProjection = summarizeBlockWorld(next);
    currentProjection = cloneSnapshot({ ...currentProjection, localDraft: true, editCount: next.editCount, lastEdit: next.lastEdit });
    selectedId = action === "add"
      ? currentProjection.blocks.find((candidate) => candidate.x === editAt.x && candidate.y === editAt.y && candidate.z === editAt.z)?.id ?? selectedId
      : currentProjection.blocks.find((candidate) => candidate.x === block.x && candidate.y === block.y && candidate.z === block.z)?.id ?? currentProjection.blocks[0]?.id ?? null;
    addTrace(action, block);
    rebuild();
    render();
    const snapshot = cloneSnapshot({ action, block: block.id, draft: currentProjection, localOnly: true, simulation: true, externalNetwork: false, externalTransfer: false, executable: false });
    onEdit?.(snapshot);
    return snapshot;
  }

  function draftBase(projection) {
    // `summarizeBlockWorld` is renderer state, while the domain draft expects
    // the same immutable projection fields as its canonical input. Keep the
    // bridge explicit so a migration can never accidentally edit the source
    // object that was handed to `syncProjection`.
    return {
      ...projection,
      updatedAt: projection.updatedAt ?? canonicalProjection.updatedAt ?? BLOCK_WORLD_UPDATED_AT,
      worldId: projection.worldId ?? canonicalProjection.worldId,
      dimensions: projection.dimensions ?? canonicalProjection.dimensions,
      blocks: projection.blocks,
    };
  }

  /**
   * Apply an in-memory migration patch list to the local block draft.
   *
   * The method accepts `previewBlockMigration(...).draftPatches`, a mapping
   * list, or a plain `{ edits: [...] }` object. Only rows explicitly marked
   * safe (or without a deferred marker) are considered. Every safe row is
   * validated before the first edit and then passed through
   * `createBlockWorldDraft` in input order. The canonical projection remains
   * untouched and deferred rows are recorded as skipped trace entries.
   */
  function applyMigrationDraft(edits, method = "migration") {
    const entries = migrationEntries(edits);
    const safePatches = [];
    const deferredPatches = [];

    entries.forEach((patch, index) => {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw new TypeError(`migration patch ${index + 1} must be an object`);
      }
      const mappingId = migrationMappingId(patch, index);
      if (migrationDeferred(patch)) {
        deferredPatches.push({
          mappingId,
          status: "deferred",
          applied: false,
          coordinate: null,
          localOnly: true,
          simulation: true,
          executable: false,
        });
        return;
      }
      const coordinate = migrationCoordinate(patch, index);
      if (!inBounds(coordinate, currentProjection.dimensions)) {
        throw new RangeError(`migration patch ${index + 1} is outside the block-world bounds`);
      }
      const blockType = migrationType(patch, index);
      safePatches.push({
        mappingId,
        coordinate,
        blockType,
        status: textOrNull(patch.status) ?? "mapped",
      });
    });

    let nextProjection = currentProjection;
    const applied = [];
    safePatches.forEach((patch, index) => {
      const [x, y, z] = patch.coordinate;
      const next = createBlockWorldDraft(draftBase(nextProjection), {
        action: "replace",
        x,
        y,
        z,
        blockType: patch.blockType,
      });
      nextProjection = cloneSnapshot({
        ...summarizeBlockWorld(next),
        localDraft: true,
        editCount: next.editCount,
        lastEdit: next.lastEdit,
      });
      const block = nextProjection.blocks.find((candidate) => (
        candidate.x === x && candidate.y === y && candidate.z === z
      ));
      applied.push({
        mappingId: patch.mappingId,
        status: patch.status,
        action: "apply-migration",
        applied: true,
        ordinal: index + 1,
        coordinate: patch.coordinate,
        blockType: patch.blockType,
        blockId: block?.id ?? null,
        editCount: nextProjection.editCount,
        localOnly: true,
        simulation: true,
        executable: false,
      });
    });

    currentProjection = nextProjection;
    const allTraceEntries = [
      ...applied,
      ...deferredPatches.map((entry) => ({
        ...entry,
        action: "skip-deferred",
        reason: "deferred mapping is never applied to a local block draft",
      })),
    ];
    addMigrationTrace(allTraceEntries);
    selectedId = applied.at(-1)?.blockId ?? selectedId;
    const appliedBlock = currentProjection.blocks.find((candidate) => candidate.id === selectedId);
    if (appliedBlock) rememberMigrationContinuity(appliedBlock, "migration-apply", "available");
    rebuild();
    render();

    const result = migrationSnapshot({
      source: BLOCK_MIGRATION_TRACE_SOURCE,
      kind: "block-world-migration-draft",
      action: "apply-migration-draft",
      method,
      canonicalProjection,
      draft: currentProjection,
      localDraft: currentProjection.localDraft === true,
      editCount: currentProjection.editCount ?? 0,
      appliedMappingIds: applied.map(({ mappingId }) => mappingId),
      appliedCoordinates: applied.map(({ mappingId, coordinate, blockType }) => ({
        mappingId,
        coordinate,
        blockType,
      })),
      deferredMappingIds: deferredPatches.map(({ mappingId }) => mappingId),
      migrationTrace: allTraceEntries,
      trace: migrationTrace,
      boundary: currentProjection.boundary,
    });
    onEdit?.(result, method);
    return result;
  }

  function replay(method = "button") {
    const continuityBefore = migrationContinuity;
    directManipulation = null;
    clearFieldTap();
    clearContentFocus("reset");
    currentProjection = canonicalProjection;
    const restoredBlock = resolveMigrationContinuityBlock(currentProjection, continuityBefore);
    selectedId = restoredBlock?.id
      ?? currentProjection.blocks[Math.floor(currentProjection.blocks.length / 2)]?.id
      ?? null;
    if (continuityBefore) {
      migrationContinuityStatus = restoredBlock ? "restored" : "missing";
      migrationContinuity = restoredBlock
        ? migrationContinuityRecord(restoredBlock, "replay", "restored")
        : cloneSnapshot({ ...continuityBefore, status: "missing" });
    } else {
      migrationContinuityStatus = "none";
    }
    trace = [];
    navigationTrace = [];
    lastNavigation = null;
    linkedNavigationTrace = [];
    lastLinkedNavigation = null;
    migrationTrace = [];
    rebuild();
    render();
    const snapshot = cloneSnapshot({
      worldId: currentProjection.worldId,
      status: "replayed",
      method,
      selectedId,
      selectedBlock: restoredBlock,
      continuity: migrationContinuity,
      continuityStatus: migrationContinuityStatus,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onReplay?.(snapshot);
    return snapshot;
  }

  /**
   * Replace the visible local draft with a previously validated projection
   * (for example a Block World snapshot import). The canonical contribution
   * remains untouched; this is intentionally separate from syncProjection.
   */
  function applyProjectionDraft(nextProjection, method = "snapshot-import") {
    const continuityBefore = migrationContinuity;
    directManipulation = null;
    clearFieldTap();
    clearContentFocus("reset");
    navigationTrace = [];
    lastNavigation = null;
    linkedNavigationTrace = [];
    lastLinkedNavigation = null;
    const previous = selectedBlock();
    const next = summarizeBlockWorld(nextProjection);
    currentProjection = cloneSnapshot({
      ...next,
      localDraft: true,
      editCount: Number.isInteger(nextProjection?.editCount)
        ? nextProjection.editCount
        : (Number.isInteger(currentProjection.editCount) ? currentProjection.editCount : 0) + 1,
      lastEdit: nextProjection?.lastEdit ?? {
        action: "import-snapshot",
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
      },
    });
    const continuityBlock = resolveMigrationContinuityBlock(currentProjection, continuityBefore);
    const previousCoordinate = previous?.coordinate;
    selectedId = continuityBlock?.id
      ?? currentProjection.blocks.find((candidate) => candidate.id === previous?.id)?.id
      ?? currentProjection.blocks.find((candidate) => Array.isArray(previousCoordinate)
        && candidate.x === previousCoordinate[0]
        && candidate.y === previousCoordinate[1]
        && candidate.z === previousCoordinate[2])?.id
      ?? currentProjection.blocks[Math.floor(currentProjection.blocks.length / 2)]?.id
      ?? null;
    if (continuityBefore) {
      migrationContinuityStatus = continuityBlock ? "restored" : "missing";
      migrationContinuity = continuityBlock
        ? migrationContinuityRecord(continuityBlock, method, "restored")
        : cloneSnapshot({ ...continuityBefore, status: "missing" });
    } else {
      const selected = selectedBlock();
      if (selected) rememberMigrationContinuity(selected, `draft:${method}`, "available");
    }
    addTrace(currentProjection.lastEdit?.action ?? "import-snapshot", selectedBlock());
    rebuild();
    render();
    const snapshot = cloneSnapshot({
      action: currentProjection.lastEdit?.action ?? "import-snapshot",
      method,
      block: selectedBlock()?.id ?? null,
      selectedBlock: selectedBlock(),
      continuity: migrationContinuity,
      continuityStatus: migrationContinuityStatus,
      draft: currentProjection,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onEdit?.(snapshot, method);
    return snapshot;
  }

  function syncProjection(nextProjection) {
    const continuityBefore = migrationContinuity;
    directManipulation = null;
    clearFieldTap();
    clearContentFocus("sync");
    navigationTrace = [];
    lastNavigation = null;
    linkedNavigationTrace = [];
    lastLinkedNavigation = null;
    const next = summarizeBlockWorld(nextProjection);
    canonicalProjection = next;
    if (!currentProjection.localDraft) currentProjection = next;
    if (continuityBefore) {
      const restoredBlock = resolveMigrationContinuityBlock(currentProjection, continuityBefore);
      migrationContinuityStatus = restoredBlock ? "restored" : "missing";
      migrationContinuity = restoredBlock
        ? migrationContinuityRecord(restoredBlock, "sync", "restored")
        : cloneSnapshot({ ...continuityBefore, status: "missing" });
      selectedId = restoredBlock?.id ?? selectedId;
    }
    rebuild();
    render();
    return getSnapshot();
  }

  function resolveTarget(object) {
    const id = object?.userData?.blockWorldId ?? object?.userData?.blockWorld?.id;
    return id
      ? currentProjection.blocks.find((block) => block.id === id) ?? (heldBlock()?.id === id ? heldBlock() : null)
      : null;
  }

  /**
   * Resolve a rendered nested cube to its existing parent/content record.
   * Callers must route this target to selectContent; it is intentionally not
   * accepted by direct manipulation, grab, place, or canonical block edits.
   */
  function resolveContentTarget(object) {
    if (!object?.userData?.blockWorldContentSelectable) return null;
    const parentId = object.userData.blockWorldContentParentId
      ?? object.userData.blockWorldId
      ?? object.userData.blockWorldContent?.ownerBlockId;
    const parent = contentParent(parentId);
    const target = object.userData.blockWorldContent?.id
      ?? object.userData.blockWorldContentId
      ?? null;
    const record = resolveBlockWorldContent(parent, target);
    if (!record) return null;
    return cloneSnapshot({
      source: BLOCK_WORLD_CONTENT_NAVIGATION_SOURCE,
      kind: "block-world-content-target",
      parentBlockId: record.parentBlockId,
      contentId: record.contentId,
      contentIndex: record.index,
      contentCount: record.count,
      content: record.content,
      parent: record.parentBlock,
      previewOnly: object.userData.blockWorldHoverPreview === true,
      opened: object.userData.blockWorldOpen === true,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      persistence: false,
      executable: false,
      boundary: BLOCK_WORLD_CONTENT_NAVIGATION_BOUNDARY,
    });
  }

  function getFocusTarget(blockOrId = null) {
    if (!three) return null;
    const block = typeof blockOrId === "string"
      ? currentProjection.blocks.find((candidate) => candidate.id === blockOrId) ?? (heldBlock()?.id === blockOrId ? heldBlock() : null)
      : blockOrId || selectedBlock() || heldBlock();
    const width = currentProjection.dimensions.width;
    const depth = currentProjection.dimensions.depth;
    return new three.Vector3(
      (block?.x ?? (width - 1) / 2) - (width - 1) / 2 - 3.8,
      (block?.y ?? 1) * 0.82 - 0.75,
      (block?.z ?? (depth - 1) / 2) - (depth - 1) / 2 - 3.2,
    );
  }

  function setGazeLockedBlock(id = null, metadata = {}) {
    const candidate = typeof id === "string" ? id.trim() : "";
    const nextId = candidate && (currentProjection.blocks.some((block) => block.id === candidate)
      || heldBlock()?.id === candidate)
      ? candidate
      : null;
    const rawPoint = metadata?.normalized ?? metadata?.point;
    const pointX = Number(rawPoint?.x);
    const pointY = Number(rawPoint?.y);
    const nextPoint = Number.isFinite(pointX) && Number.isFinite(pointY)
      ? {
        x: Math.max(-1, Math.min(1, pointX)),
        y: Math.max(-1, Math.min(1, pointY)),
      }
      : null;
    const expiry = Number(metadata?.expiresAt);
    gazeLockedId = nextId;
    gazeLockAction = nextId
      ? String(metadata?.action ?? "gaze-lock").trim().slice(0, 48) || "gaze-lock"
      : "idle";
    gazeLockPoint = nextPoint;
    gazeLockExpiresAt = nextId && Number.isFinite(expiry) ? expiry : null;
    gazeLockReason = nextId
      ? String(metadata?.reason ?? "fresh-gaze").trim().slice(0, 64) || "fresh-gaze"
      : String(metadata?.reason ?? "cleared").trim().slice(0, 64) || "cleared";
    updateGazeLockCues(0, true);
    render();
    return getSnapshot();
  }

  function setHoveredBlock(id) {
    const nextId = currentProjection.blocks.some((block) => block.id === id) ? id : null;
    if (nextId === hoveredId) return getSnapshot();
    hoveredId = nextId;
    if (!nextId || (hoveredContent && hoveredContent.parentBlockId !== nextId)) hoveredContent = null;
    syncHoverPreview();
    syncHoverPreviewMeshes();
    // Hover is a presentation/readout action only. It intentionally does not
    // call selectBlock or touch the canonical/open draft state.
    render();
    return getSnapshot();
  }

  function setHoveredContent(parentBlockId = null, contentId = null) {
    const parent = contentParent(parentBlockId);
    const record = resolveBlockWorldContent(parent, contentId);
    const next = record
      ? cloneSnapshot({
        source: BLOCK_WORLD_CONTENT_NAVIGATION_SOURCE,
        kind: "block-world-content-hover",
        parentBlockId: record.parentBlockId,
        contentId: record.contentId,
        contentIndex: record.index,
        contentCount: record.count,
        content: record.content,
        parent: record.parentBlock,
        previewOnly: true,
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        persistence: false,
        executable: false,
        boundary: BLOCK_WORLD_CONTENT_NAVIGATION_BOUNDARY,
      })
      : null;
    const same = next?.parentBlockId === hoveredContent?.parentBlockId
      && next?.contentId === hoveredContent?.contentId;
    if (same) return getSnapshot();
    hoveredContent = next;
    render();
    return getSnapshot();
  }

  function update(dt = 0, time = 0, options = {}) {
    const updateOptions = options && typeof options === "object" ? options : {};
    if (Object.prototype.hasOwnProperty.call(updateOptions, "hoveredId")) {
      const nextHovered = updateOptions.hoveredId;
      const nextId = currentProjection.blocks.some((block) => block.id === nextHovered) ? nextHovered : null;
      if (nextId !== hoveredId) {
        hoveredId = nextId;
        syncHoverPreview();
        syncHoverPreviewMeshes();
        render();
      }
    }
    const motionReduced = reducedMotion || updateOptions.reducedMotion === true;
    const scatterById = updateProximity(updateOptions);
    updateSelectionCues();
    const presentationMeshes = new Set([
      ...blockMeshes.values(),
      ...containerCues.values(),
      ...interactiveMeshes,
    ]);
    presentationMeshes.forEach((mesh) => {
      applyPresentation(mesh, mesh.userData?.blockWorldId, scatterById, semanticDepthOffsets, dt, motionReduced);
    });
    // updateProximity runs after the general readout render above; refresh the
    // small status node here so a direct host update exposes the current
    // culling count immediately instead of waiting for the next frame.
    if (proximityStatusEl) {
      proximityStatusEl.textContent = proximityState.enabled
        ? `CITY / SKYSCRAPER LENS · ${proximityState.nearCount} NEAR · ${proximityState.scatteredCount} FAR SCATTERED · ${proximityState.culledCount} CULLED · LOCAL PRESENTATION`
        : "CITY / SKYSCRAPER LENS · VIEWPOINT PROXIMITY READY · LOCAL PRESENTATION";
    }
    updateGazeLockCues(time, motionReduced);
    return getSnapshot();
  }

  closeButton.addEventListener("click", () => setOpen(false, "close"));
  replayButton.addEventListener("click", () => replay("button"));
  addButton.addEventListener("click", () => edit("add"));
  removeButton.addEventListener("click", () => edit("remove"));
  replaceButton.addEventListener("click", () => edit("replace"));
  openButton?.addEventListener("click", () => toggleSelectedBlock());
  inspectButton?.addEventListener("click", () => inspectSelected());
  moveLeftButton?.addEventListener("click", () => moveSelected({ dx: -1, dy: 0, dz: 0 }));
  moveRightButton?.addEventListener("click", () => moveSelected({ dx: 1, dy: 0, dz: 0 }));
  moveForwardButton?.addEventListener("click", () => moveSelected({ dx: 0, dy: 0, dz: -1 }));
  moveBackButton?.addEventListener("click", () => moveSelected({ dx: 0, dy: 0, dz: 1 }));
  moveUpButton?.addEventListener("click", () => moveSelected({ dx: 0, dy: 1, dz: 0 }));
  moveDownButton?.addEventListener("click", () => moveSelected({ dx: 0, dy: -1, dz: 0 }));
  grabButton?.addEventListener("click", () => grabSelected());
  holdLeftButton?.addEventListener("click", () => holdSelected({ dx: -1, dy: 0, dz: 0 }));
  holdRightButton?.addEventListener("click", () => holdSelected({ dx: 1, dy: 0, dz: 0 }));
  holdForwardButton?.addEventListener("click", () => holdSelected({ dx: 0, dy: 0, dz: -1 }));
  holdBackButton?.addEventListener("click", () => holdSelected({ dx: 0, dy: 0, dz: 1 }));
  holdUpButton?.addEventListener("click", () => holdSelected({ dx: 0, dy: 1, dz: 0 }));
  holdDownButton?.addEventListener("click", () => holdSelected({ dx: 0, dy: -1, dz: 0 }));
  placeButton?.addEventListener("click", () => placeHeld());
  depthModeButtons.forEach((button, mode) => {
    button.addEventListener("click", (event) => setSemanticDepthMode(mode, event?.detail === 0 ? "keyboard" : "button"));
    bindKeyboardActivation(button, () => setSemanticDepthMode(mode, "keyboard"));
  });
  linkedPreviousButton?.addEventListener("click", (event) => navigateLinkedBlock("previous", event?.detail === 0 ? "keyboard" : "button"));
  linkedNextButton?.addEventListener("click", (event) => navigateLinkedBlock("next", event?.detail === 0 ? "keyboard" : "button"));
  bindKeyboardActivation(linkedPreviousButton, () => navigateLinkedBlock("previous", "keyboard"));
  bindKeyboardActivation(linkedNextButton, () => navigateLinkedBlock("next", "keyboard"));
  contentPreviousButton?.addEventListener("click", (event) => navigateContent("previous", event?.detail === 0 ? "keyboard" : "button"));
  contentNextButton?.addEventListener("click", (event) => navigateContent("next", event?.detail === 0 ? "keyboard" : "button"));
  bindKeyboardActivation(contentPreviousButton, () => navigateContent("previous", "keyboard"));
  bindKeyboardActivation(contentNextButton, () => navigateContent("next", "keyboard"));
  migrationButton?.addEventListener("click", (event) => {
    if (pendingKeyboardActivations.has(migrationButton)
      && (event?.detail === undefined || event?.detail === 0)) {
      pendingKeyboardActivations.delete(migrationButton);
      return;
    }
    pendingKeyboardActivations.delete(migrationButton);
    openMigrationBridge(event?.detail === 0 ? "keyboard" : "button");
  });
  bindKeyboardActivation(migrationButton, () => openMigrationBridge("keyboard"));
  documentRoot.addEventListener?.("keydown", (event) => {
    if (event?.key !== "Escape" || !opened) return;
    event?.preventDefault?.();
    setOpen(false, "escape");
  });
  renderPalette();
  setMigrationAffordance(false);
  syncProjection(projection);

  function getSnapshot() {
    return cloneSnapshot({
      source: BLOCK_WORLD_SOURCE,
      worldId: currentProjection.worldId,
      renderMode,
      staticFallback,
      reducedMotion: Boolean(reducedMotion),
      accessibility: {
        keyboardRoutes: true,
        touchRoutes: true,
        reducedMotion: Boolean(reducedMotion),
      },
      canonicalProjection,
      draft: currentProjection,
      blockCount: currentProjection.blockCount,
      localDraft: Boolean(currentProjection.localDraft),
      editCount: currentProjection.editCount ?? 0,
      selectedId,
      hoveredId,
      hoveredFeatureId,
      featureInventory,
      manipulateMode,
      manipulator: manipulator.getSnapshot(),
      distributionCohorts,
      hoverPreview,
      contentFocus,
      hoveredContent,
      contentNavigation: {
        selected: focusedContentRecord(),
        hovered: hoveredContentRecord(),
        source: BLOCK_WORLD_CONTENT_NAVIGATION_SOURCE,
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        persistence: false,
        executable: false,
        boundary: BLOCK_WORLD_CONTENT_NAVIGATION_BOUNDARY,
      },
      opened,
      holding: currentProjection.holding === true,
      heldBlock: currentProjection.heldBlock ?? null,
      heldCoordinate: currentProjection.heldCoordinate ?? null,
      directManipulation: currentProjection.directManipulation ?? null,
      interactionSteps: currentProjection.interactionSteps ?? [],
      directInput: directManipulation
        ? {
          blockId: directManipulation.blockId,
          pointerId: directManipulation.pointerId,
          pointerType: directManipulation.pointerType,
          start: directManipulation.start,
          current: directManipulation.current,
          previewDelta: directManipulation.previewDelta,
          thresholdPx: directManipulation.thresholdPx,
        }
        : null,
      fieldTapCandidate: lastFieldTap
        ? {
          blockId: lastFieldTap.blockId,
          pointerType: lastFieldTap.pointerType,
          timestamp: lastFieldTap.timestamp,
          point: lastFieldTap.point,
          windowMs: BLOCK_WORLD_DOUBLE_ACTIVATION_WINDOW_MS,
          distancePx: BLOCK_WORLD_DOUBLE_ACTIVATION_DISTANCE_PX,
        }
        : null,
      trace,
      navigation: lastNavigation,
      lastNavigation,
      navigationTrace,
      migrationTrace,
      migrationBridgeOpen,
      migrationContinuity,
      migrationContinuityStatus,
      semanticDepth: {
        mode: semanticDepthMode,
        modes: BLOCK_WORLD_SEMANTIC_DEPTH_MODES,
        axes: [...semanticDepthAxes.values()],
        offsets: [...semanticDepthOffsets.entries()].map(([blockId, offset]) => ({ blockId, ...offset })),
        projectionOnly: true,
        canonicalUnchanged: true,
        localOnly: true,
        simulation: true,
        boundary: BLOCK_WORLD_SEMANTIC_DEPTH_BOUNDARY,
      },
      gazeLock: {
        source: BLOCK_WORLD_GAZE_LOCK_SOURCE,
        active: Boolean(gazeLockedId),
        blockId: gazeLockedId,
        action: gazeLockAction,
        normalized: gazeLockPoint,
        expiresAt: gazeLockExpiresAt,
        reason: gazeLockReason,
        cue: Boolean(gazeLockedId && gazeLockCues.get(gazeLockedId)?.visible),
        cueColor: BLOCK_WORLD_GAZE_LOCK_COLOR,
        localOnly: true,
        simulation: true,
        presentationOnly: true,
        externalNetwork: false,
        persistence: false,
        executable: false,
        boundary: BLOCK_WORLD_GAZE_LOCK_BOUNDARY,
      },
      containerSignals: containerSignalMetadata(),
      linkedNavigation: lastLinkedNavigation,
      linkedNavigationTrace,
      proximity: proximityState,
      proximityNearCount: proximityState.nearCount,
      proximityFarCount: proximityState.farCount,
      proximityScatterCount: proximityState.scatteredCount,
      proximityCulledCount: proximityState.culledCount,
      boundary: currentProjection.boundary,
      presentationBoundary: BLOCK_WORLD_PRESENTATION_BOUNDARY,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    });
  }

  return Object.freeze({
    layer,
    open: () => setOpen(true, "open"),
    close: () => setOpen(false, "api"),
    syncProjection,
    setFeatureInventory,
    setDistributionCohorts,
    focusDistributionCohort,
    selectBlock,
    resolveTarget,
    resolveContentTarget,
    getFocusTarget,
    setGazeLockedBlock,
    setHoveredBlock,
    setHoveredContent,
    setSemanticDepthMode,
    setDepthMode: setSemanticDepthMode,
    getSemanticDepthMode: () => semanticDepthMode,
    getSemanticDepthAxes: () => [...semanticDepthAxes.values()],
    getLinkedNeighbors: (target = selectedBlock() ?? hoveredBlock()) => getBlockWorldLinkedNeighbors(target, currentProjection.blocks),
    navigateLinkedBlock,
    navigatePreviousLinkedBlock: (method = "button") => navigateLinkedBlock("previous", method),
    navigateNextLinkedBlock: (method = "button") => navigateLinkedBlock("next", method),
    selectContent,
    inspectContent: selectContent,
    navigateContent,
    navigatePreviousContent: (method = "button") => navigateContent("previous", method),
    navigateNextContent: (method = "button") => navigateContent("next", method),
    clearContentFocus,
    edit,
    openBlock: (open = true) => applyInteraction(open ? "open" : "close"),
    toggleBlock: toggleSelectedBlock,
    activateFieldDouble,
    doubleActivateField: activateFieldDouble,
    registerFieldTap,
    noteFieldTap: registerFieldTap,
    clearFieldTap,
    moveSelected,
    inspectBlock: inspectSelected,
    // Free 3D gizmo manipulation (additive, 2026-09-18).
    setManipulateMode,
    getManipulateMode: () => manipulateMode,
    getManipulatorSnapshot: () => manipulator.getSnapshot(),
    getManipulatorTrace: () => manipulator.getTrace(),
    noteGestureIntent,
    detachManipulator: (reason = "api") => {
      const record = manipulator.detach(reason);
      render();
      return record;
    },
    isManipulatorDragging: () => manipulator.isDragging(),
    grabSelected,
    pickupSelected: grabSelected,
    holdSelected,
    placeHeld,
    dropHeld: placeHeld,
    beginDirectManipulation,
    startDirectManipulation: beginDirectManipulation,
    updateDirectManipulation,
    completeDirectManipulation,
    finishDirectManipulation: completeDirectManipulation,
    cancelDirectManipulation,
    isDirectManipulating: () => Boolean(directManipulation),
    navigatePortal,
    navigateFeature: navigatePortal,
    navigatePortalRoute: navigatePortal,
    getPortalRoutes: () => BLOCK_WORLD_PORTAL_ROUTE_REGISTRY,
    openMigrationBridge,
    previewLegacySnapshot,
    previewUserLegacySnapshot: previewLegacySnapshot,
    previewMigrationSnapshot: previewLegacySnapshot,
    restoreMigrationContinuity,
    acceptMigrationHandback,
    getMigrationContinuity: () => continuitySnapshot("read", "api"),
    applyMigrationDraft,
    applyDraftEdits: applyMigrationDraft,
    applyProjectionDraft,
    applySnapshotDraft: applyProjectionDraft,
    importSnapshot: applyProjectionDraft,
    replay,
    update,
    getSnapshot,
    destroy: () => {
      try {
        manipulator.destroy("layer-destroy");
      } catch {
        // Gizmo disposal is best-effort in degraded hosts.
      }
      blockMeshes.forEach((mesh) => {
        const index = raycastTargets.indexOf(mesh);
        if (index >= 0) raycastTargets.splice(index, 1);
      });
      contentMeshes.forEach((mesh) => {
        const index = raycastTargets.indexOf(mesh);
        if (index >= 0) raycastTargets.splice(index, 1);
      });
      containerCues.forEach((cue) => layer?.remove(cue));
      clearDragPreview();
      if (layer) parent?.remove(layer);
      geometry?.dispose?.();
      containerGeometry?.dispose?.();
      containerCueGeometry?.dispose?.();
      openGeometry?.dispose?.();
      contentGeometry?.dispose?.();
      lidGeometry?.dispose?.();
      Object.values(selectionEdges).forEach((edgeGeometry) => edgeGeometry?.dispose?.());
      selectionMaterial?.dispose?.();
      Object.values(selectionEdges).forEach((edgeGeometry) => edgeGeometry?.dispose?.());
      selectionMaterial?.dispose?.();
      materials.forEach((material) => material.dispose?.());
      contentMaterials.forEach((material) => material.dispose?.());
      dragPreviewMaterials.forEach((material) => material.dispose?.());
    },
  });
}

export default createBlockWorldLayer;
