// cube-dive.js — Cube Dive Transport (domain logic, no DOM/THREE/network).
//
// A quick second tap on the same portal cube TRANSPORTS the camera inside
// the cube instead of toggling it open: field -> diving -> inside, with
// inside-to-inside hops resolved through FEATURE_HANDOFF_LINKS so one
// interaction always pushes into the next cube/reality. Dead ends resolve
// back to the field.
//
// Pure logic only. Camera choreography lives in ../render/cube-dive.js.
// Local-only: every snapshot carries the standard local-simulation flags
// and this module never touches storage, network, or authority APIs.

import { BLOCK_WORLD_PORTAL_ROUTE_REGISTRY } from "./block-world.js?v=20260922-cache2";

export const CUBE_DIVE_DOUBLE_TAP_WINDOW_MS = 350;
export const CUBE_DIVE_DOUBLE_TAP_DISTANCE_PX = 28;
export const CUBE_DIVE_DURATION_MS = 1200;
export const CUBE_DIVE_EXIT_DURATION_MS = 900;
export const CUBE_DIVE_HOP_DURATION_MS = 1400;

export const CUBE_DIVE_BOUNDARY =
  "Local cube-dive transport: a simulated camera flight only. No wallet, no custody, no mainnet, no network call, no real execution.";

export const CUBE_DIVE_STATES = ["field", "diving", "inside", "exiting"];

const LOCAL_FLAGS = Object.freeze({
  simulation: true,
  externalTransfer: false,
  localOnly: true,
});

function freezeFrame(frame) {
  return Object.freeze({ ...LOCAL_FLAGS, ...frame });
}

/**
 * Create a fresh transport state. `stack` holds arrived interior frames
 * (deepest last) so deeper dives can unwind one level at a time.
 */
export function createCubeDiveState() {
  return { state: "field", stack: [], active: null, startedAt: 0 };
}

/**
 * Bind a portal cube to its feature. Presentation-only and deterministic:
 * portal cubes (blockType 'portal') map round-robin onto the 19 curated
 * portal routes; canonical block data is never mutated.
 */
export function resolveDiveBinding({ blocks = [], blockId = null } = {}) {
  const list = Array.isArray(blocks) ? blocks : [];
  const block = list.find((b) => b && b.id === blockId) ?? null;
  if (!block || block.blockType !== "portal") {
    return { ok: false, reason: "not-a-portal-cube", blockId };
  }
  const portals = list.filter((b) => b && b.blockType === "portal");
  const portalIndex = portals.findIndex((b) => b.id === blockId);
  const routes = BLOCK_WORLD_PORTAL_ROUTE_REGISTRY;
  const route = routes.length
    ? routes[((portalIndex % routes.length) + routes.length) % routes.length]
    : null;
  if (!route) return { ok: false, reason: "no-portal-route", blockId };
  return {
    ok: true,
    blockId,
    featureId: route.featureId,
    routeId: route.id,
    label: route.label,
    portalIndex,
  };
}

/**
 * Resolve the next feature from the frozen handoff graph. Returns null on a
 * dead end so the caller can route back to the field.
 */
export function resolveHandoffHop({ featureId = null, handoffLinks = {} } = {}) {
  const edges = handoffLinks?.[featureId];
  if (!Array.isArray(edges) || edges.length === 0) return null;
  const next = edges[0];
  return typeof next === "string" && next.length ? next : null;
}

/**
 * Resolve which vessel (portal cube id) carries a feature. Prefers the cube
 * bound to that feature; falls back to the current vessel so the chain never
 * breaks; final fallback is the first portal cube.
 */
export function resolveHopVessel({
  blocks = [],
  featureId = null,
  currentBlockId = null,
} = {}) {
  const list = Array.isArray(blocks) ? blocks : [];
  const portals = list.filter((b) => b && b.blockType === "portal");
  if (!portals.length) return null;
  const routes = BLOCK_WORLD_PORTAL_ROUTE_REGISTRY;
  const bound = portals.find((b, i) => {
    const idx = portals.findIndex((p) => p.id === b.id);
    const route = routes.length ? routes[((idx % routes.length) + routes.length) % routes.length] : null;
    return route?.featureId === featureId;
  });
  return (
    bound?.id ??
    (portals.some((b) => b.id === currentBlockId) ? currentBlockId : null) ??
    portals[0].id
  );
}

/**
 * List the nested cubes inside a block that can be dived into.
 */
export function resolveNestedDiveTargets(block = null) {
  const contents = Array.isArray(block?.contents) ? block.contents : [];
  return contents
    .filter((c) => c && typeof c.id === "string")
    .map((c, index) => ({
      contentId: c.id,
      contentIndex: index,
      label: c.label ?? c.contentType ?? "nested cube",
      contentType: c.contentType ?? null,
    }));
}

function now() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/**
 * Deterministic transport state machine.
 *
 * Actions: begin | arrive | deeper | hop | exit | land | cancel
 * Returns { ok, state, snapshot } — snapshot is a frozen, local-only record.
 */
export function diveTransition(diveState, action, payload = {}) {
  if (!diveState || typeof diveState !== "object") {
    return { ok: false, reason: "no-dive-state", state: "field", snapshot: null };
  }
  const t = now();
  switch (action) {
    case "begin": {
      if (diveState.state !== "field") {
        return { ok: false, reason: "already-diving", state: diveState.state, snapshot: null };
      }
      const frame = freezeFrame({
        blockId: payload.blockId ?? null,
        featureId: payload.featureId ?? null,
        label: payload.label ?? payload.featureId ?? "cube",
        level: 0,
        kind: payload.kind ?? "dive",
        at: t,
      });
      diveState.state = "diving";
      diveState.active = frame;
      diveState.startedAt = t;
      return { ok: true, state: "diving", snapshot: frame };
    }
    case "arrive": {
      if (diveState.state !== "diving") {
        return { ok: false, reason: "not-diving", state: diveState.state, snapshot: null };
      }
      const frame = freezeFrame({ ...(diveState.active ?? {}), at: t });
      diveState.state = "inside";
      diveState.active = frame;
      diveState.stack = [...(diveState.stack ?? []), frame];
      return { ok: true, state: "inside", snapshot: frame };
    }
    case "deeper": {
      if (diveState.state !== "inside") {
        return { ok: false, reason: "not-inside", state: diveState.state, snapshot: null };
      }
      const parent = diveState.active;
      const frame = freezeFrame({
        blockId: parent?.blockId ?? null,
        featureId: parent?.featureId ?? null,
        label: payload.label ?? parent?.label ?? "cube",
        level: (parent?.level ?? 0) + 1,
        contentId: payload.contentId ?? null,
        kind: "deeper",
        at: t,
      });
      diveState.state = "diving";
      diveState.active = frame;
      diveState.startedAt = t;
      return { ok: true, state: "diving", snapshot: frame };
    }
    case "hop": {
      if (diveState.state !== "inside") {
        return { ok: false, reason: "not-inside", state: diveState.state, snapshot: null };
      }
      const frame = freezeFrame({
        blockId: payload.blockId ?? null,
        featureId: payload.featureId ?? null,
        label: payload.label ?? payload.featureId ?? "cube",
        level: 0,
        kind: "hop",
        at: t,
      });
      diveState.state = "diving";
      diveState.active = frame;
      diveState.startedAt = t;
      return { ok: true, state: "diving", snapshot: frame };
    }
    case "exit": {
      if (diveState.state !== "inside") {
        return { ok: false, reason: "not-inside", state: diveState.state, snapshot: null };
      }
      diveState.state = "exiting";
      diveState.startedAt = t;
      return { ok: true, state: "exiting", snapshot: diveState.active };
    }
    case "land": {
      if (diveState.state !== "exiting") {
        return { ok: false, reason: "not-exiting", state: diveState.state, snapshot: null };
      }
      diveState.state = "field";
      diveState.active = null;
      diveState.stack = [];
      diveState.startedAt = t;
      return { ok: true, state: "field", snapshot: freezeFrame({ at: t }) };
    }
    case "cancel": {
      if (diveState.state === "diving" || diveState.state === "exiting") {
        const stack = diveState.stack ?? [];
        const back = stack.length ? stack[stack.length - 1] : null;
        diveState.state = back ? "inside" : "field";
        diveState.active = back;
        diveState.startedAt = t;
        return { ok: true, state: diveState.state, snapshot: back };
      }
      return { ok: false, reason: "nothing-to-cancel", state: diveState.state, snapshot: null };
    }
    default:
      return { ok: false, reason: "unknown-action", state: diveState.state, snapshot: null };
  }
}
