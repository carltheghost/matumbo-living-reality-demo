/**
 * Deterministic semantic block-world projection.
 *
 * This is the local, Minecraft-like layer for the Living Reality demo. A block
 * is a presentation entity with a stable coordinate and provenance. Editing is
 * intentionally a draft operation: it returns a new frozen snapshot and does
 * not write a file, contact a provider, mint an asset, or mutate the canonical
 * projection.
 */

export const BLOCK_WORLD_SCHEMA_VERSION = 1;
export const BLOCK_WORLD_SOURCE = "semantic-block-fabric";
export const BLOCK_WORLD_UPDATED_AT = "2025-01-01T00:00:00.000Z";
export const BLOCK_WORLD_ID = "block-world:living-reality";
export const BLOCK_WORLD_WIDTH = 9;
export const BLOCK_WORLD_DEPTH = 9;
export const BLOCK_WORLD_MAX_HEIGHT = 5;
export const BLOCK_WORLD_INTERACTION_ACTIONS = Object.freeze([
  "open",
  "close",
  "toggle",
  "move",
  "inspect",
  "grab",
  "hold",
  "place",
]);
export const BLOCK_WORLD_MAX_MOVE_STEP = 1;
export const BLOCK_WORLD_GRAB_PLACE_ACTIONS = Object.freeze(["grab", "hold", "place"]);

export const BLOCK_TYPES = Object.freeze({
  grass: Object.freeze({ id: "grass", label: "Grass", color: 0x55c58a, accent: 0x9cf5b6 }),
  stone: Object.freeze({ id: "stone", label: "Stone", color: 0x718a9b, accent: 0xc5d9df }),
  water: Object.freeze({ id: "water", label: "Water", color: 0x3f9de8, accent: 0x9ce9ff }),
  crystal: Object.freeze({ id: "crystal", label: "Crystal", color: 0xa879ff, accent: 0xe1cfff }),
  wood: Object.freeze({ id: "wood", label: "Wood", color: 0xb9814c, accent: 0xf1c07e }),
  portal: Object.freeze({ id: "portal", label: "Portal", color: 0x37d9d0, accent: 0xb1fff7 }),
});

/**
 * The only destinations a portal cube may open are these twenty local feature
 * surfaces.  Keep this registry finite and explicit: a portal route is a
 * renderer hand-off, not a URL, provider endpoint, command, or persisted
 * navigation state.  Each entry is deeply frozen so callers cannot add a
 * target at runtime.
 */
const PORTAL_ROUTE_DEFINITIONS = [
  {
    id: "rooms",
    featureId: "rooms",
    label: "Rooms + Messaging",
    surface: "room-console",
    description: "Enter the local membership-scoped room projection.",
  },
  {
    id: "migration",
    featureId: "migration",
    label: "Migration Bridge",
    surface: "block-migration-console",
    description: "Review the fixed legacy-to-block mapping rehearsal.",
  },
  {
    id: "social-explorer",
    featureId: "social-explorer",
    label: "Social Explorer / Re-market",
    surface: "social-explorer-console",
    description: "Browse the local discover-to-reuse rehearsal.",
  },
  {
    id: "launch-distribution",
    featureId: "launch-distribution",
    label: "Launch Distribution",
    surface: "launch-console",
    description: "Inspect the aggregate TUMBO-SIM launch preview.",
  },
  {
    id: "asset-token",
    featureId: "asset-token",
    label: "TUMBO Asset Token",
    surface: "asset-launch",
    description: "View the fixed local asset-token allocation preview.",
  },
  {
    id: "asset-market",
    featureId: "asset-market",
    label: "Asset Market Evidence",
    surface: "asset-market-console",
    description: "Refresh a bounded public market snapshot for comparison assets.",
  },
  {
    id: "arena",
    featureId: "arena",
    label: "ARENA / Game Lab",
    surface: "arena-console",
    description: "Open the deterministic local game rehearsal.",
  },
  {
    id: "contracts",
    featureId: "contracts",
    label: "Contracts + Pools",
    surface: "contracts-markets-console",
    description: "Inspect the fictional covenant, pool, collateral, and risk rehearsal.",
  },
  {
    id: "paycore",
    featureId: "paycore",
    label: "PAYCORE Asset-token Balances",
    surface: "paycore-console",
    description: "Inspect the local asset-token balance and flow preview.",
  },
  {
    id: "t402",
    featureId: "t402",
    label: "T402 Value Routing",
    surface: "t402-console",
    description: "Walk the fictional offer, route, and hold rehearsal.",
  },
  {
    id: "neural-mesh",
    featureId: "neural-mesh",
    label: "Neural Mesh / Agents",
    surface: "neural-mesh-console",
    description: "Inspect the advisory Control Tower and Oracle graph.",
  },
  {
    id: "picture-matter",
    featureId: "picture-matter",
    label: "Picture Matter",
    surface: "picture-matter-console",
    description: "Inspect the local word-to-statement provenance rehearsal.",
  },
  {
    id: "ledger",
    featureId: "ledger",
    label: "Prime Ledger + EchoProof",
    surface: "ledger-proof-console",
    description: "Inspect the balanced local journal and declared proof ancestry.",
  },
  {
    id: "gateway",
    featureId: "gateway",
    label: "World Gateway / Evidence",
    surface: "world-events-console",
    description: "Refresh public-source observations and inspect uncertainty locally.",
  },
  {
    id: "world-events",
    featureId: "world-events",
    label: "World Events / Evidence",
    surface: "world-events-console",
    description: "Refresh documented public event sources and inspect returned evidence.",
  },
  {id: "web-ai",
    featureId: "web-ai",
    label: "Web + AI",
    surface: "web-ai-console",
    description: "Browse the open web in a sandboxed frame and hand tasks to AI assistants.",
  },
  {
    id: "reality-lens",
    id: "projections",
    featureId: "projections",
    label: "Phone / PC / XR",
    surface: "device-projection-console",
    description: "Inspect local device presentation and fallback metadata.",
  },
  {
    id: "sports-events",
    featureId: "sports-events",
    label: "Tennis Evidence / ATP · WTA",
    surface: "sports-events-console",
    description: "Refresh public tennis records, rankings, and provider-reported set scores.",
  },
  {
    id: "multi-sport-events",
    featureId: "multi-sport-events",
    label: "Multi-Sport Scoreboards",
    surface: "multi-sport-events-console",
    description: "Refresh public soccer, NBA, and NFL scoreboard observations.",
  },
  {
    id: "reality-lens",
    featureId: "reality-lens",
    label: "Reality Lens Ω",
    surface: "reality-lens",
    description: "Return to the whole Living Reality projection.",
  },
];

function freezePortalRoute(route) {
  return Object.freeze({
    ...route,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  });
}

export const BLOCK_WORLD_PORTAL_ROUTE_REGISTRY = Object.freeze(
  PORTAL_ROUTE_DEFINITIONS.map(freezePortalRoute),
);

// Readable aliases keep the contract discoverable to hosts that call the
// collection either a registry or a route list. All aliases point to the same
// immutable entries; there is still one finite source of truth.
export const BLOCK_WORLD_PORTAL_ROUTES = BLOCK_WORLD_PORTAL_ROUTE_REGISTRY;
export const PORTAL_ROUTE_REGISTRY = BLOCK_WORLD_PORTAL_ROUTE_REGISTRY;
export const PORTAL_ROUTES = BLOCK_WORLD_PORTAL_ROUTE_REGISTRY;
export const BLOCK_WORLD_PORTAL_ROUTE_MAP = Object.freeze(
  Object.fromEntries(BLOCK_WORLD_PORTAL_ROUTE_REGISTRY.map((route) => [route.id, route])),
);

export const BLOCK_WORLD_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "block-world.inspect",
    label: "Inspect projected blocks",
    enabled: true,
    mode: "local-projection",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  Object.freeze({
    id: "block-world.edit-draft",
    label: "Edit a renderer-only local draft",
    enabled: true,
    mode: "local-draft",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  Object.freeze({
    id: "block-world.open-contents",
    label: "Open and inspect nested cube contents",
    enabled: true,
    mode: "local-draft",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  Object.freeze({
    id: "block-world.move-draft",
    label: "Move a selected cube one bounded grid step",
    enabled: true,
    mode: "local-draft",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  Object.freeze({
    id: "block-world.grab-place-draft",
    label: "Pick up, hold, and place a selected cube in the bounded grid",
    enabled: true,
    mode: "local-draft",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  Object.freeze({
    id: "block-world.external-build",
    label: "Publish or synchronize a block world externally",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "The demo has no persistence, network, identity, or provider authority.",
  }),
]);

function freeze(value) {
  return Object.freeze(value);
}

function requireInteger(value, field, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) throw new TypeError(`${field} must be an integer >= ${minimum}`);
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function blockKey(x, y, z) {
  return `${x}:${y}:${z}`;
}

export function getBlockKey(x, y, z) {
  requireInteger(x, "x");
  requireInteger(y, "y");
  requireInteger(z, "z");
  return blockKey(x, y, z);
}

function isDefaultContainer(x, y, z, type) {
  // Containers are deliberately sparse so the grid still reads as a voxel
  // field while offering obvious places to open and inspect.
  return type === "portal"
    || (type === "crystal" && y === 0)
    || (type === "wood" && (x + z) % 2 === 0);
}

function defaultContentsFor({ id, x, y, z, type }) {
  const templates = type === "portal"
    ? [
      { contentType: "portal-core", label: "Portal core", blockType: "portal", offset: [0, 1, 0] },
      { contentType: "route-seed", label: "Route seed", blockType: "crystal", offset: [1, 1, 0] },
    ]
    : type === "crystal"
      ? [{ contentType: "echo-shard", label: "Echo shard", blockType: "crystal", offset: [0, 1, 0] }]
      : [{ contentType: "room-seed", label: "Room seed", blockType: "wood", offset: [0, 1, 0] }];
  return templates.map((template, index) => ({
    ...template,
    id: `${id}/content:${index + 1}`,
    ownerBlockId: id,
    kind: "semantic-block-content",
    coordinate: [x, y, z],
    source: "fixture",
  }));
}

function normalizeContents(contents, { id, x, y, z, type, source, container }) {
  const entries = contents === undefined
    ? (container ? defaultContentsFor({ id, x, y, z, type }) : [])
    : contents;
  if (!Array.isArray(entries)) throw new TypeError("block.contents must be an array");
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`block.contents[${index}] must be an object`);
    }
    const offset = entry.offset ?? [0, 1 + index, 0];
    if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(Number.isInteger)) {
      throw new TypeError(`block.contents[${index}].offset must be an integer [x, y, z]`);
    }
    return freeze({
      id: `${id}/content:${index + 1}`,
      ownerBlockId: id,
      kind: "semantic-block-content",
      contentType: requireString(entry.contentType ?? entry.type ?? "block-content", `block.contents[${index}].contentType`),
      label: requireString(entry.label ?? entry.contentType ?? entry.type ?? `Content ${index + 1}`, `block.contents[${index}].label`),
      blockType: Object.prototype.hasOwnProperty.call(BLOCK_TYPES, entry.blockType) ? entry.blockType : type,
      coordinate: freeze([x, y, z]),
      offset: freeze([...offset]),
      source: entry.source ?? source,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
  });
}

function blockRecord({ x, y, z, type, source = "fixture", container, open = false, contents }) {
  requireInteger(x, "x");
  requireInteger(y, "y");
  requireInteger(z, "z");
  const definition = BLOCK_TYPES[type];
  if (!definition) throw new TypeError(`Unknown block type: ${type}`);
  const inferredContainer = container === undefined
    ? (contents === undefined ? isDefaultContainer(x, y, z, type) : contents.length > 0)
    : Boolean(container);
  const normalizedContents = normalizeContents(contents, {
    id: `block:${blockKey(x, y, z)}`,
    x,
    y,
    z,
    type: definition.id,
    source,
    container: inferredContainer,
  });
  return freeze({
    id: `block:${blockKey(x, y, z)}`,
    kind: "semantic-block",
    blockType: definition.id,
    label: definition.label,
    color: definition.color,
    accent: definition.accent,
    x,
    y,
    z,
    coordinate: freeze([x, y, z]),
    source,
    container: inferredContainer,
    open: Boolean(open) && inferredContainer,
    contentCount: normalizedContents.length,
    contents: freeze(normalizedContents),
    interactive: true,
    canOpen: inferredContainer && normalizedContents.length > 0,
    canMove: true,
    aggregate: true,
    fictional: true,
    simulation: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  });
}

function heightAt(x, z) {
  // A tiny integer height map: deterministic, legible, and cheap on mobile.
  const ridge = ((x * 17 + z * 31 + x * z * 7) % 3 + 3) % 3;
  const basin = (Math.abs(x - 4) + Math.abs(z - 4)) % 4 === 0 ? 0 : 1;
  return Math.min(BLOCK_WORLD_MAX_HEIGHT - 1, 1 + ridge - basin);
}

function typeAt(x, y, z) {
  if (x === 4 && z === 4 && y === 0) return "portal";
  if ((x === 2 || x === 6) && z === 4 && y === 0) return "crystal";
  if ((x + z) % 7 === 0 && y === 0) return "water";
  if (y === heightAt(x, z) - 1 && (x + z) % 4 === 0) return "wood";
  return y === heightAt(x, z) - 1 ? "grass" : "stone";
}

function makeDefaultBlocks(width, depth) {
  const blocks = [];
  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      const height = heightAt(x, z);
      for (let y = 0; y < height; y += 1) blocks.push(blockRecord({ x, y, z, type: typeAt(x, y, z) }));
    }
  }
  return blocks;
}

function normalizeBlocks(blocks, width, depth) {
  if (!Array.isArray(blocks)) throw new TypeError("blocks must be an array");
  const seen = new Set();
  const normalized = blocks.map((block, index) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) throw new TypeError(`blocks[${index}] must be an object`);
    const x = requireInteger(block.x, `blocks[${index}].x`);
    const y = requireInteger(block.y, `blocks[${index}].y`);
    const z = requireInteger(block.z, `blocks[${index}].z`);
    if (x >= width || z >= depth || y >= BLOCK_WORLD_MAX_HEIGHT) throw new RangeError(`blocks[${index}] is outside the block-world bounds`);
    const key = blockKey(x, y, z);
    if (seen.has(key)) throw new TypeError(`duplicate block coordinate: ${key}`);
    seen.add(key);
    return blockRecord({
      x,
      y,
      z,
      type: requireString(block.blockType ?? block.type, `blocks[${index}].blockType`),
      source: block.source ?? "fixture",
      container: block.container,
      open: block.open === true,
      contents: Object.prototype.hasOwnProperty.call(block, "contents") ? block.contents : undefined,
    });
  });
  return normalized.sort((a, b) => a.id.localeCompare(b.id));
}

function baseProjection({
  updatedAt = BLOCK_WORLD_UPDATED_AT,
  worldId = BLOCK_WORLD_ID,
  width = BLOCK_WORLD_WIDTH,
  depth = BLOCK_WORLD_DEPTH,
  blocks = makeDefaultBlocks(width, depth),
} = {}) {
  requireString(updatedAt, "updatedAt");
  requireString(worldId, "worldId");
  requireInteger(width, "width", 1);
  requireInteger(depth, "depth", 1);
  const normalized = normalizeBlocks(blocks, width, depth);
  const entityCount = normalized.length;
  const containerCount = normalized.filter((block) => block.container).length;
  const openContainerCount = normalized.filter((block) => block.container && block.open).length;
  const nestedContentCount = normalized.reduce((count, block) => count + block.contentCount, 0);
  return {
    schemaVersion: BLOCK_WORLD_SCHEMA_VERSION,
    source: BLOCK_WORLD_SOURCE,
    simulation: true,
    updatedAt,
    worldId,
    kind: "semantic-block-world-projection",
    dimensions: freeze({ width, depth, height: BLOCK_WORLD_MAX_HEIGHT }),
    blocks: freeze(normalized),
    entities: freeze(normalized),
    interactive: true,
    containerCount,
    openContainerCount,
    nestedContentCount,
    evidence: freeze([
      freeze({
        id: `block-world-layout:${worldId}`,
        kind: "deterministic-layout",
        status: "declared",
        blockCount: entityCount,
        dimensions: freeze({ width, depth, height: BLOCK_WORLD_MAX_HEIGHT }),
        simulation: true,
        deterministic: true,
        note: "The block grid is a fictional local fixture for spatial exploration.",
      }),
      freeze({
        id: `block-world-boundary:${worldId}`,
        kind: "simulation-boundary",
        status: "enforced",
        localDraft: true,
        persistence: false,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
        note: "Draft edits never publish or mutate an external world.",
      }),
    ]),
    capabilities: BLOCK_WORLD_CAPABILITIES,
    provenance: freeze({
      source: BLOCK_WORLD_SOURCE,
      version: BLOCK_WORLD_SCHEMA_VERSION,
      basis: "semantic-block-fabric local fixture",
      deterministicKey: `${BLOCK_WORLD_SOURCE}:${worldId}:v1`,
    }),
    localDraft: false,
    editCount: 0,
  };
}

export function createBlockWorldContribution(options = {}) {
  const projection = baseProjection(options);
  return freeze({ ...projection });
}

export function createBlockWorldDraft(base, edit) {
  if (!base || typeof base !== "object" || !Array.isArray(base.blocks)) throw new TypeError("base must be a block-world projection");
  if (!edit || typeof edit !== "object") throw new TypeError("edit must be an object");
  if (base.holding === true || base.heldBlock) throw new TypeError("finish placing the held block before editing the grid");
  const action = edit.action ?? "add";
  if (!["add", "remove", "replace"].includes(action)) throw new TypeError(`Unknown block edit action: ${action}`);
  const x = requireInteger(edit.x, "edit.x");
  const y = requireInteger(edit.y, "edit.y");
  const z = requireInteger(edit.z, "edit.z");
  const width = base.dimensions?.width ?? BLOCK_WORLD_WIDTH;
  const depth = base.dimensions?.depth ?? BLOCK_WORLD_DEPTH;
  if (x >= width || z >= depth || y >= BLOCK_WORLD_MAX_HEIGHT) throw new RangeError("edit is outside the block-world bounds");
  const key = blockKey(x, y, z);
  const blocks = base.blocks.filter((block) => blockKey(block.x, block.y, block.z) !== key);
  if (action !== "remove") {
    blocks.push(blockRecord({ x, y, z, type: edit.blockType ?? edit.type ?? "crystal", source: "local-draft" }));
  }
  const next = baseProjection({
    updatedAt: base.updatedAt,
    worldId: base.worldId,
    width,
    depth,
    blocks,
  });
  return freeze({
    ...next,
    localDraft: true,
    editCount: (Number.isInteger(base.editCount) ? base.editCount : 0) + 1,
    lastEdit: freeze({
      action,
      x,
      y,
      z,
      blockType: action === "remove" ? null : edit.blockType ?? edit.type ?? "crystal",
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      executable: false,
    }),
  });
}

function requireBlockProjection(base) {
  if (!base || typeof base !== "object" || !Array.isArray(base.blocks)) {
    throw new TypeError("base must be a block-world projection");
  }
  return base;
}

function resolveBlock(base, target) {
  requireBlockProjection(base);
  let block = null;
  if (typeof target === "string") {
    block = base.blocks.find((candidate) => candidate.id === target) ?? null;
  } else if (target && typeof target === "object") {
    const targetId = target.blockId ?? target.id;
    if (typeof targetId === "string") block = base.blocks.find((candidate) => candidate.id === targetId) ?? null;
    if (!block && Number.isInteger(target.x) && Number.isInteger(target.y) && Number.isInteger(target.z)) {
      block = base.blocks.find((candidate) => candidate.x === target.x && candidate.y === target.y && candidate.z === target.z) ?? null;
    }
  }
  if (!block) throw new RangeError("target block was not found in the projection");
  return block;
}

function portalRouteId(target) {
  if (typeof target === "string") return target.trim();
  if (!target || typeof target !== "object" || Array.isArray(target)) return "";
  return String(
    target.routeId
      ?? target.targetFeature
      ?? target.featureId
      ?? target.target
      ?? target.id
      ?? "",
  ).trim();
}

function resolvePortalRoute(target) {
  const id = portalRouteId(target);
  const route = BLOCK_WORLD_PORTAL_ROUTE_MAP[id];
  if (!route) throw new RangeError(`unknown portal route target: ${id || "(empty)"}`);
  return route;
}

/** Return a frozen registry entry, or null for a target that is not registered. */
export function getBlockWorldPortalRoute(target) {
  const id = portalRouteId(target);
  return BLOCK_WORLD_PORTAL_ROUTE_MAP[id] ?? null;
}

function draftFromBlocks(base, blocks, lastEdit) {
  const width = base.dimensions?.width ?? BLOCK_WORLD_WIDTH;
  const depth = base.dimensions?.depth ?? BLOCK_WORLD_DEPTH;
  const next = baseProjection({
    updatedAt: base.updatedAt,
    worldId: base.worldId,
    width,
    depth,
    blocks,
  });
  return freeze({
    ...next,
    localDraft: true,
    editCount: (Number.isInteger(base.editCount) ? base.editCount : 0) + 1,
    lastEdit: freeze({
      ...lastEdit,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }),
  });
}

function interactionRecord(action, details = {}) {
  return freeze({
    ...details,
    action,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  });
}

/**
 * Create an immutable local hand-off from a portal cube to one known feature.
 *
 * This helper intentionally does not call a router, mutate the projection, or
 * write a URL. It validates both sides first and then returns a navigation
 * record that a renderer may pass to the existing Feature Navigator. The
 * overloaded object form (`{ blockId, targetFeature }`) is accepted so DOM
 * adapters can forward a single event payload without weakening validation.
 */
export function createBlockWorldNavigationDraft(base, sourceTarget, targetFeature, method = "button") {
  requireBlockProjection(base);

  let source = sourceTarget;
  let target = targetFeature;
  if (target === undefined && sourceTarget && typeof sourceTarget === "object" && !Array.isArray(sourceTarget)) {
    target = sourceTarget.targetFeature
      ?? sourceTarget.featureId
      ?? sourceTarget.routeId
      ?? sourceTarget.target;
    source = sourceTarget.sourceBlock
      ?? sourceTarget.sourceBlockId
      ?? sourceTarget.blockId
      ?? sourceTarget.block
      ?? sourceTarget;
  }

  const block = resolveBlock(base, source);
  if (block.blockType !== "portal") {
    throw new TypeError("portal navigation requires a portal source block");
  }
  const route = resolvePortalRoute(target);
  const safeMethod = typeof method === "string" && method.trim() !== "" ? method.trim() : "button";
  const transition = freeze({
    type: "portal",
    action: "enter",
    sourceBlockId: block.id,
    sourceCoordinate: block.coordinate,
    targetFeature: route.featureId,
    routeId: route.id,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  });

  return freeze({
    source: BLOCK_WORLD_SOURCE,
    kind: "semantic-block-world-navigation-draft",
    action: "portal-navigate",
    method: safeMethod,
    sourceBlock: block,
    sourceBlockId: block.id,
    sourceCoordinate: block.coordinate,
    targetFeature: route.featureId,
    featureId: route.featureId,
    target: route.featureId,
    routeId: route.id,
    route,
    transition: "portal",
    portalTransition: transition,
    navigationDraft: true,
    localDraft: true,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  });
}

// Alias names make the bounded seam easy to discover without introducing a
// second implementation or a second route registry.
export const createBlockWorldPortalNavigationDraft = createBlockWorldNavigationDraft;
export const createBlockWorldPortalRouteDraft = createBlockWorldNavigationDraft;

function blockDimensions(base) {
  const dimensions = base?.dimensions ?? {};
  const width = Number.isInteger(dimensions.width) ? dimensions.width : BLOCK_WORLD_WIDTH;
  const depth = Number.isInteger(dimensions.depth) ? dimensions.depth : BLOCK_WORLD_DEPTH;
  const height = Number.isInteger(dimensions.height) ? dimensions.height : BLOCK_WORLD_MAX_HEIGHT;
  if (width < 1 || depth < 1 || height < 1) throw new RangeError("block-world dimensions must be positive integers");
  return { width, depth, height };
}

function normalizeCoordinate(value, base, field = "coordinate") {
  const coordinate = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value.x, value.y, value.z]
      : null;
  if (!coordinate || coordinate.length !== 3 || !coordinate.every((entry) => Number.isInteger(entry))) {
    throw new TypeError(`${field} must be an integer [x, y, z] coordinate`);
  }
  const [x, y, z] = coordinate;
  const { width, depth, height } = blockDimensions(base);
  if (x < 0 || x >= width || y < 0 || y >= height || z < 0 || z >= depth) {
    throw new RangeError(`${field} is outside the block-world bounds`);
  }
  return freeze([x, y, z]);
}

function coordinateKey(coordinate) {
  return blockKey(coordinate[0], coordinate[1], coordinate[2]);
}

function heldProjection(base) {
  if (base?.holding !== true || !base?.heldBlock || typeof base.heldBlock !== "object") {
    throw new TypeError("no block is currently held; grab a block first");
  }
  const held = base.heldBlock;
  const coordinate = normalizeCoordinate(held.coordinate ?? held, base, "heldBlock.coordinate");
  const heldId = typeof held.id === "string" && held.id.trim() !== "" ? held.id : null;
  if (!heldId) throw new TypeError("heldBlock.id must be a non-empty string");
  return { held, coordinate, heldId };
}

function blockAtCoordinate(base, coordinate) {
  const key = coordinateKey(coordinate);
  return base.blocks.find((block) => blockKey(block.x, block.y, block.z) === key) ?? null;
}

function heldBlockRecord(block, coordinate, originCoordinate = coordinate) {
  const [x, y, z] = coordinate;
  const normalized = blockRecord({
    x,
    y,
    z,
    type: block.blockType,
    source: "local-draft",
    container: block.container,
    open: block.open,
    contents: block.contents,
  });
  return freeze({
    ...normalized,
    // A carried cube keeps its source identity while it is detached from the
    // grid. A new coordinate-derived id is assigned when it is placed.
    id: block.id,
    grabbedBlockId: block.id,
    originCoordinate: freeze([...originCoordinate]),
    held: true,
    holding: true,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  });
}

function draftWithHeldState(base, blocks, heldBlock, lastEdit) {
  const width = base.dimensions?.width ?? BLOCK_WORLD_WIDTH;
  const depth = base.dimensions?.depth ?? BLOCK_WORLD_DEPTH;
  const next = baseProjection({
    updatedAt: base.updatedAt,
    worldId: base.worldId,
    width,
    depth,
    blocks,
  });
  const interaction = interactionRecord(lastEdit.action, lastEdit);
  const held = heldBlock ? heldBlockRecord(heldBlock, heldBlock.coordinate, heldBlock.originCoordinate ?? heldBlock.coordinate) : null;
  return freeze({
    ...next,
    localDraft: true,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
    editCount: (Number.isInteger(base.editCount) ? base.editCount : 0) + 1,
    lastEdit: interaction,
    holding: Boolean(held),
    heldBlock: held,
    held: held,
    heldBlockId: held?.id ?? null,
    heldCoordinate: held ? freeze([...held.coordinate]) : null,
  });
}

function ensureHeldTarget(target, heldId) {
  if (target === undefined || target === null || target === "") return;
  const explicitId = typeof target === "string"
    ? target
    : target && typeof target === "object"
      ? target.blockId ?? target.heldBlockId ?? (target.id && !Number.isInteger(target.x) ? target.id : undefined)
      : undefined;
  if (explicitId !== undefined && explicitId !== heldId) throw new RangeError("target block is not the currently held block");
}

function normalizeHoldRequest(targetOrDelta, delta) {
  // `(base, heldId, delta)` and `(base, { blockId, delta })` are accepted in
  // addition to the compact `(base, delta)` form used by the renderer.
  if (typeof targetOrDelta === "string") {
    return { target: targetOrDelta, request: delta ?? null };
  }
  if (targetOrDelta === undefined || targetOrDelta === null) return { target: undefined, request: null };
  if (Array.isArray(targetOrDelta)) return { target: undefined, request: targetOrDelta };
  if (typeof targetOrDelta !== "object") throw new TypeError("hold request must be a delta or coordinate object");
  const target = targetOrDelta.blockId ?? targetOrDelta.heldBlockId ?? (
    targetOrDelta.id && !Number.isInteger(targetOrDelta.x) ? targetOrDelta.id : undefined
  );
  if (delta !== undefined) return { target, request: delta };
  if (Object.prototype.hasOwnProperty.call(targetOrDelta, "delta")) return { target, request: targetOrDelta.delta };
  if (Object.prototype.hasOwnProperty.call(targetOrDelta, "coordinate")) return { target, request: { coordinate: targetOrDelta.coordinate } };
  if (Object.prototype.hasOwnProperty.call(targetOrDelta, "position")) return { target, request: { coordinate: targetOrDelta.position } };
  if (Object.prototype.hasOwnProperty.call(targetOrDelta, "target") && targetOrDelta.target !== target) {
    return { target, request: { coordinate: targetOrDelta.target } };
  }
  if (["x", "y", "z"].every((key) => Object.prototype.hasOwnProperty.call(targetOrDelta, key))) {
    return { target, request: { coordinate: targetOrDelta } };
  }
  if (["dx", "dy", "dz"].some((key) => Object.prototype.hasOwnProperty.call(targetOrDelta, key))) {
    return { target, request: targetOrDelta };
  }
  return { target, request: null };
}

function normalizeHoldDelta(value) {
  const delta = Array.isArray(value)
    ? { dx: value[0], dy: value[1], dz: value[2] }
    : value && typeof value === "object"
      ? { dx: value.dx, dy: value.dy, dz: value.dz }
      : null;
  if (!delta || ![delta.dx, delta.dy, delta.dz].every((entry) => Number.isInteger(entry))) {
    throw new TypeError("hold delta must be integer [dx, dy, dz]");
  }
  if ([delta.dx, delta.dy, delta.dz].some((entry) => Math.abs(entry) > BLOCK_WORLD_MAX_MOVE_STEP)) {
    throw new RangeError(`hold delta must be between -${BLOCK_WORLD_MAX_MOVE_STEP} and ${BLOCK_WORLD_MAX_MOVE_STEP}`);
  }
  if (delta.dx === 0 && delta.dy === 0 && delta.dz === 0) return { dx: 0, dy: 0, dz: 0 };
  return delta;
}

function holdDestination(base, currentCoordinate, request) {
  if (request === null || request === undefined) return { coordinate: currentCoordinate, delta: [0, 0, 0] };
  if (request && typeof request === "object" && !Array.isArray(request)
    && Object.prototype.hasOwnProperty.call(request, "coordinate")) {
    const coordinate = normalizeCoordinate(request.coordinate, base, "hold coordinate");
    return {
      coordinate,
      delta: [coordinate[0] - currentCoordinate[0], coordinate[1] - currentCoordinate[1], coordinate[2] - currentCoordinate[2]],
    };
  }
  const delta = normalizeHoldDelta(request);
  const coordinate = normalizeCoordinate([
    currentCoordinate[0] + delta.dx,
    currentCoordinate[1] + delta.dy,
    currentCoordinate[2] + delta.dz,
  ], base, "hold destination");
  return { coordinate, delta: [delta.dx, delta.dy, delta.dz] };
}

function placeCoordinate(base, target, heldCoordinate, heldId) {
  if (target === undefined || target === null || target === "") return heldCoordinate;
  if (typeof target === "string") {
    ensureHeldTarget(target, heldId);
    return heldCoordinate;
  }
  let value = target;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    ensureHeldTarget(value, heldId);
    value = value.coordinate ?? value.position ?? value.target ?? (
      ["x", "y", "z"].every((key) => Object.prototype.hasOwnProperty.call(value, key)) ? value : undefined
    );
  }
  return normalizeCoordinate(value, base, "place coordinate");
}

/** Pick up a selected cube into an immutable local carried state. */
export function createBlockWorldGrabDraft(base, target) {
  requireBlockProjection(base);
  if (base.holding === true || base.heldBlock) throw new TypeError("a block is already held; place it before grabbing another");
  const block = resolveBlock(base, target);
  const origin = freeze([block.x, block.y, block.z]);
  const held = heldBlockRecord(block, origin, origin);
  const blocks = base.blocks.filter((candidate) => candidate.id !== block.id);
  return draftWithHeldState(base, blocks, held, {
    action: "grab",
    blockId: block.id,
    from: origin,
    coordinate: origin,
  });
}

/** Update the carried cube's proposed coordinate by a bounded local delta. */
export function createBlockWorldHoldDraft(base, targetOrDelta = undefined, delta = undefined) {
  requireBlockProjection(base);
  const { held, coordinate: currentCoordinate, heldId } = heldProjection(base);
  const request = normalizeHoldRequest(targetOrDelta, delta);
  ensureHeldTarget(request.target, heldId);
  const destination = holdDestination(base, currentCoordinate, request.request);
  const occupied = blockAtCoordinate(base, destination.coordinate);
  if (occupied) throw new RangeError("hold destination is occupied by another block");
  const nextHeld = heldBlockRecord(held, destination.coordinate, held.originCoordinate ?? currentCoordinate);
  return draftWithHeldState(base, base.blocks, nextHeld, {
    action: "hold",
    blockId: heldId,
    from: currentCoordinate,
    to: destination.coordinate,
    delta: destination.delta,
    holding: true,
  });
}

/** Place the carried cube at an empty, bounded coordinate and release it. */
export function createBlockWorldPlaceDraft(base, target = undefined, coordinate = undefined) {
  requireBlockProjection(base);
  const { held, coordinate: heldCoordinate, heldId } = heldProjection(base);
  const request = coordinate === undefined ? target : { blockId: target, coordinate };
  const destination = placeCoordinate(base, request, heldCoordinate, heldId);
  const occupied = blockAtCoordinate(base, destination);
  if (occupied) throw new RangeError("place destination is occupied by another block");
  const placed = blockRecord({
    x: destination[0],
    y: destination[1],
    z: destination[2],
    type: held.blockType,
    source: "local-draft",
    container: held.container,
    open: held.open,
    contents: held.contents,
  });
  const placedRecord = freeze({
    ...placed,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  });
  const next = draftWithHeldState(base, [...base.blocks, placed], null, {
    action: "place",
    blockId: heldId,
    from: heldCoordinate,
    to: destination,
    placedBlockId: placed.id,
    holding: false,
  });
  return freeze({
    ...next,
    placedBlock: placedRecord,
    releasedBlock: held,
  });
}

function normalizeMoveDelta(interaction) {
  const delta = interaction.delta ?? interaction;
  const values = Array.isArray(delta)
    ? { dx: delta[0], dy: delta[1], dz: delta[2] }
    : { dx: delta?.dx, dy: delta?.dy, dz: delta?.dz };
  const normalized = {
    dx: values.dx ?? 0,
    dy: values.dy ?? 0,
    dz: values.dz ?? 0,
  };
  Object.entries(normalized).forEach(([field, value]) => {
    if (!Number.isInteger(value) || Math.abs(value) > BLOCK_WORLD_MAX_MOVE_STEP) {
      throw new RangeError(`${field} must be an integer between -${BLOCK_WORLD_MAX_MOVE_STEP} and ${BLOCK_WORLD_MAX_MOVE_STEP}`);
    }
  });
  if (normalized.dx === 0 && normalized.dy === 0 && normalized.dz === 0) {
    throw new RangeError("move delta must change at least one coordinate");
  }
  return normalized;
}

function normalizeDirectDragDelta(value) {
  const normalized = normalizeMoveDelta({ delta: value });
  const vector = [normalized.dx, normalized.dy, normalized.dz];
  // A pointer/touch drag is deliberately a single-grid-axis gesture. This
  // keeps the result deterministic across viewport sizes and avoids a
  // diagonal move accidentally bypassing an occupied cell.
  if (vector.filter((entry) => entry !== 0).length !== 1) {
    throw new RangeError("direct drag must move exactly one grid axis");
  }
  return freeze(vector);
}

/**
 * Apply one completed pointer/touch drag as an atomic local transition.
 *
 * The returned draft records the semantic Grab -> Hold -> Place stages while
 * validating the destination before constructing any intermediate state. A
 * rejected collision or out-of-bounds destination therefore leaves the input
 * projection untouched and cannot strand a block in carry mode.
 */
export function createBlockWorldDirectManipulationDraft(base, target, delta) {
  requireBlockProjection(base);
  if (base.holding === true || base.heldBlock) {
    throw new TypeError("finish placing the held block before a direct drag");
  }
  const block = resolveBlock(base, target);
  const vector = normalizeDirectDragDelta(delta);
  const origin = freeze([block.x, block.y, block.z]);
  const destination = freeze([
    origin[0] + vector[0],
    origin[1] + vector[1],
    origin[2] + vector[2],
  ]);
  const { width, depth, height } = blockDimensions(base);
  if (destination[0] < 0 || destination[0] >= width
    || destination[1] < 0 || destination[1] >= height
    || destination[2] < 0 || destination[2] >= depth) {
    throw new RangeError("direct drag would leave the block-world bounds");
  }
  if (blockAtCoordinate(base, destination)) {
    throw new RangeError("direct drag destination is occupied by another block");
  }

  const placed = blockRecord({
    x: destination[0],
    y: destination[1],
    z: destination[2],
    type: block.blockType,
    source: "local-draft",
    container: block.container,
    open: block.open,
    contents: block.contents,
  });
  const placedRecord = freeze({
    ...placed,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  });
  const releasedRecord = heldBlockRecord(block, origin, origin);
  const steps = freeze([
    interactionRecord("grab", {
      blockId: block.id,
      coordinate: origin,
      from: origin,
      holding: true,
    }),
    interactionRecord("hold", {
      blockId: block.id,
      coordinate: destination,
      from: origin,
      to: destination,
      delta: vector,
      holding: true,
    }),
    interactionRecord("place", {
      blockId: block.id,
      from: origin,
      to: destination,
      coordinate: destination,
      placedBlockId: placed.id,
      holding: false,
    }),
  ]);
  const direct = interactionRecord("direct-drag", {
    blockId: block.id,
    from: origin,
    to: destination,
    delta: vector,
    placedBlockId: placed.id,
    transition: "grab>hold>place",
    stages: steps,
    input: "pointer-or-touch",
  });
  const blocks = base.blocks.map((candidate) => candidate.id === block.id ? placed : candidate);
  const next = draftFromBlocks(base, blocks, direct);
  return freeze({
    ...next,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
    lastEdit: direct,
    directManipulation: direct,
    interactionSteps: steps,
    holding: false,
    held: null,
    heldBlock: null,
    heldBlockId: null,
    heldCoordinate: null,
    placedBlock: placedRecord,
    releasedBlock: releasedRecord,
  });
}

// Readable aliases for hosts that call the gesture a drag rather than direct
// manipulation. They intentionally point at the same atomic, local helper.
export const createBlockWorldDirectDragDraft = createBlockWorldDirectManipulationDraft;
export const createBlockWorldPointerDragDraft = createBlockWorldDirectManipulationDraft;
export const createBlockWorldPickupDraft = createBlockWorldGrabDraft;
export const createBlockWorldPickUpDraft = createBlockWorldGrabDraft;
export const createBlockWorldDropDraft = createBlockWorldPlaceDraft;

/**
 * Apply a local interaction to a block. Open/close and movement are immutable
 * draft operations; they never update the canonical source or contact a
 * provider. Movement is intentionally one grid step at a time.
 */
export function createBlockWorldInteractionDraft(base, interaction = {}) {
  requireBlockProjection(base);
  if (!interaction || typeof interaction !== "object") throw new TypeError("interaction must be an object");
  const action = interaction.action ?? "toggle";
  if (!BLOCK_WORLD_INTERACTION_ACTIONS.includes(action)) {
    throw new TypeError(`Unsupported block interaction action: ${action}`);
  }
  if (action === "grab") {
    return createBlockWorldGrabDraft(base, interaction.blockId ?? interaction.id ?? interaction.target ?? interaction);
  }
  if (action === "hold") return createBlockWorldHoldDraft(base, interaction);
  if (action === "place") return createBlockWorldPlaceDraft(base, interaction);
  if (base.holding === true || base.heldBlock) {
    throw new TypeError("finish placing the held block before another grid interaction");
  }
  const target = interaction.blockId ?? interaction.id ?? interaction.target ?? interaction;
  if (action === "inspect") return inspectBlockWorldBlock(base, target);
  const block = resolveBlock(base, target);
  if (["open", "close", "toggle"].includes(action)) {
    if (!block.container || block.contentCount < 1) throw new TypeError("selected block has no contents to open");
    const nextOpen = action === "open" ? true : action === "close" ? false : !block.open;
    const blocks = base.blocks.map((candidate) => candidate.id === block.id
      ? blockRecord({
        x: candidate.x,
        y: candidate.y,
        z: candidate.z,
        type: candidate.blockType,
        source: "local-draft",
        container: candidate.container,
        open: nextOpen,
        contents: candidate.contents,
      })
      : candidate);
    return draftFromBlocks(base, blocks, {
      action: nextOpen ? "open" : "close",
      blockId: block.id,
      x: block.x,
      y: block.y,
      z: block.z,
      open: nextOpen,
    });
  }

  const delta = normalizeMoveDelta(interaction);
  const width = base.dimensions?.width ?? BLOCK_WORLD_WIDTH;
  const depth = base.dimensions?.depth ?? BLOCK_WORLD_DEPTH;
  const nextCoordinate = {
    x: block.x + delta.dx,
    y: block.y + delta.dy,
    z: block.z + delta.dz,
  };
  if (nextCoordinate.x < 0 || nextCoordinate.x >= width
    || nextCoordinate.y < 0 || nextCoordinate.y >= BLOCK_WORLD_MAX_HEIGHT
    || nextCoordinate.z < 0 || nextCoordinate.z >= depth) {
    throw new RangeError("move would leave the block-world bounds");
  }
  const occupied = base.blocks.some((candidate) => candidate.id !== block.id
    && candidate.x === nextCoordinate.x
    && candidate.y === nextCoordinate.y
    && candidate.z === nextCoordinate.z);
  if (occupied) throw new RangeError("move destination is occupied by another block");
  const moved = blockRecord({
    x: nextCoordinate.x,
    y: nextCoordinate.y,
    z: nextCoordinate.z,
    type: block.blockType,
    source: "local-draft",
    container: block.container,
    open: block.open,
    contents: block.contents,
  });
  const blocks = base.blocks.map((candidate) => candidate.id === block.id ? moved : candidate);
  return draftFromBlocks(base, blocks, {
    action: "move",
    blockId: block.id,
    from: [block.x, block.y, block.z],
    to: [nextCoordinate.x, nextCoordinate.y, nextCoordinate.z],
    delta: [delta.dx, delta.dy, delta.dz],
  });
}

export function createBlockWorldOpenDraft(base, target, open = true) {
  return createBlockWorldInteractionDraft(base, {
    action: open ? "open" : "close",
    blockId: typeof target === "string" ? target : undefined,
    ...(typeof target === "object" ? target : {}),
  });
}

export function createBlockWorldMoveDraft(base, target, delta) {
  return createBlockWorldInteractionDraft(base, {
    action: "move",
    blockId: typeof target === "string" ? target : undefined,
    ...(typeof target === "object" ? target : {}),
    delta,
  });
}

/** Return the selected block and its nested contents without mutating state. */
export function inspectBlockWorldBlock(base, target) {
  const block = resolveBlock(base, target);
  const contents = Array.isArray(block.contents) ? block.contents : [];
  const contentCount = Number.isInteger(block.contentCount) ? block.contentCount : contents.length;
  return freeze({
    action: "inspect",
    blockId: block.id,
    block,
    container: block.container,
    opened: block.open,
    contentCount,
    contents: freeze(contents),
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: "Inspection reads local projected data only; it does not reveal a wallet, provider, identity, or external world.",
  });
}

export const DEFAULT_BLOCK_WORLD = createBlockWorldContribution();

export default DEFAULT_BLOCK_WORLD;
