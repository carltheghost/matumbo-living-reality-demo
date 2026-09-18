/**
 * Compact cube controls for feature surfaces that keep the Block World field
 * visible underneath them. This renderer is deliberately only an affordance:
 * the Block World layer remains the sole owner of selection, draft state,
 * collision rules, carry state, and interaction receipts.
 */

export const BLOCK_WORLD_QUICK_ACTIONS_SOURCE = "block-world-quick-actions";
// Backward-compatible name for callers that describe the same renderer as a
// cube affordance. Both names intentionally resolve to one local source.
export const CUBE_QUICK_ACTIONS_SOURCE = BLOCK_WORLD_QUICK_ACTIONS_SOURCE;
export const CUBE_QUICK_ACTIONS_BOUNDARY =
  "One shared local projection: cube actions and feature panels read the same projection session. Actions reuse the Block World draft; no sync, wallet, token, persistence, or external transfer.";

export const CUBE_QUICK_ACTIONS = Object.freeze([
  "open",
  "inspect",
  "move-left",
  "grab",
  "hold",
  "place",
]);

// View/navigation actions intentionally live beside (rather than inside) the
// legacy six-action list.  A few reduced hosts import CUBE_QUICK_ACTIONS to
// build only the original cube controls, so expanding that export would be a
// breaking change.  The persistent rail can still expose both groups through
// one runAction/getSnapshot contract.
export const CUBE_QUICK_VIEW_ACTIONS = Object.freeze([
  "depth-3d",
  "depth-4d",
  "depth-5d",
  "linked-previous",
  "linked-next",
]);

export const CUBE_QUICK_ACTIONS_ALL = Object.freeze([
  ...CUBE_QUICK_ACTIONS,
  ...CUBE_QUICK_VIEW_ACTIONS,
]);

const ACTION_META = Object.freeze({
  open: Object.freeze({ label: "OPEN CUBE", shortLabel: "OPEN", ariaLabel: "Open or close the selected cube" }),
  inspect: Object.freeze({ label: "INSPECT", shortLabel: "INSPECT", ariaLabel: "Inspect the selected cube" }),
  "move-left": Object.freeze({ label: "MOVE ←", shortLabel: "MOVE", ariaLabel: "Move the selected cube one step left" }),
  grab: Object.freeze({ label: "GRAB", shortLabel: "GRAB", ariaLabel: "Grab the selected cube" }),
  hold: Object.freeze({ label: "HOLD +X", shortLabel: "HOLD", ariaLabel: "Carry the held cube one step on the X axis" }),
  place: Object.freeze({ label: "PLACE", shortLabel: "PLACE", ariaLabel: "Place the held cube" }),
});

const VIEW_ACTION_META = Object.freeze({
  "depth-3d": Object.freeze({ label: "3D", ariaLabel: "Use three-dimensional semantic depth projection" }),
  "depth-4d": Object.freeze({ label: "4D", ariaLabel: "Use four-dimensional semantic depth projection" }),
  "depth-5d": Object.freeze({ label: "5D", ariaLabel: "Use five-dimensional semantic depth projection" }),
  "linked-previous": Object.freeze({ label: "← LINK", ariaLabel: "Navigate to the previous linked cube" }),
  "linked-next": Object.freeze({ label: "LINK →", ariaLabel: "Navigate to the next linked cube" }),
});

const ACTION_IDS = Object.freeze({
  open: "block-world-quick-action-open",
  inspect: "block-world-quick-action-inspect",
  "move-left": "block-world-quick-action-move-left",
  grab: "block-world-quick-action-grab",
  hold: "block-world-quick-action-hold",
  place: "block-world-quick-action-place",
});

const LEGACY_ACTION_IDS = Object.freeze({
  open: "cube-quick-action-open",
  inspect: "cube-quick-action-inspect",
  "move-left": "cube-quick-action-move-left",
  grab: "cube-quick-action-grab",
  hold: "cube-quick-action-hold",
  place: "cube-quick-action-place",
});

const VIEW_ACTION_IDS = Object.freeze({
  "depth-3d": "block-world-quick-action-depth-3d",
  "depth-4d": "block-world-quick-action-depth-4d",
  "depth-5d": "block-world-quick-action-depth-5d",
  "linked-previous": "block-world-quick-action-linked-previous",
  "linked-next": "block-world-quick-action-linked-next",
});

function byId(documentRoot, primary, fallback = null) {
  return documentRoot?.getElementById?.(primary)
    ?? (fallback ? documentRoot?.getElementById?.(fallback) : null)
    ?? null;
}

function text(value, fallback = "") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function clone(value) {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === "function") {
    try { return structuredClone(value); } catch { /* fall through */ }
  }
  if (typeof value !== "object") return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

function freezeRecord(value) {
  if (!value || typeof value !== "object") return value;
  return Object.freeze(value);
}

function findSelected(snapshot) {
  const draft = snapshot?.draft ?? snapshot;
  const blocks = Array.isArray(draft?.blocks) ? draft.blocks : [];
  const selectedId = snapshot?.selectedId ?? draft?.selectedId ?? null;
  const selected = blocks.find((block) => block?.id === selectedId) ?? null;
  const held = snapshot?.heldBlock ?? draft?.heldBlock ?? null;
  return { draft, selected, held, selectedId };
}

function summaryFor(snapshot, context) {
  const { draft, selected, held, selectedId } = findSelected(snapshot);
  const visible = selected ?? held;
  const feature = text(context?.featureLabel, text(context?.featureId, "LOCAL FEATURE"));
  const cube = visible
    ? `${visible.label ?? visible.id ?? "CUBE"} · ${visible.x ?? 0},${visible.y ?? 0},${visible.z ?? 0}`
    : "NO CUBE SELECTED";
  const mode = held || snapshot?.holding === true || draft?.holding === true
    ? "HOLDING"
    : visible?.container
      ? (visible.open ? "OPEN CONTAINER" : "CLOSED CONTAINER")
      : visible
        ? "SOLID CUBE"
        : "READY";
  return {
    feature,
    cube,
    mode,
    selectedId,
    holding: Boolean(held || snapshot?.holding === true || draft?.holding === true),
    selected,
    held,
  };
}

function viewSummaryFor(snapshot) {
  const depth = snapshot?.semanticDepth ?? null;
  const mode = text(depth?.mode, "3d").toLowerCase();
  const selectedId = snapshot?.selectedId ?? snapshot?.draft?.selectedId ?? null;
  const axes = Array.isArray(depth?.axes)
    ? depth.axes.find((entry) => entry?.blockId === selectedId)
      ?? depth.axes.find((entry) => entry?.blockId === snapshot?.hoveredId)
      ?? null
    : null;
  const nestedContentDepth = Number.isFinite(Number(axes?.nestedContentDepth))
    ? Number(axes.nestedContentDepth)
    : 0;
  const linkedNeighborDegree = Number.isFinite(Number(axes?.linkedNeighborDegree))
    ? Number(axes.linkedNeighborDegree)
    : 0;
  return {
    mode,
    axes,
    nestedContentDepth,
    linkedNeighborDegree,
    projectionOnly: depth?.projectionOnly !== false,
    available: Boolean(depth),
  };
}

function disabledFor(action, state) {
  const selected = state?.selected;
  const held = state?.held;
  const direct = Boolean(state?.snapshot?.directManipulation);
  const carrying = Boolean(state?.holding || held);
  if (action === "open") return !selected || !selected.canOpen || carrying || direct;
  if (action === "inspect") return !selected && !held;
  if (action === "move-left") return !selected || carrying || direct || selected.canMove === false;
  if (action === "grab") return !selected || carrying || direct || selected.canGrab === false;
  if (action === "hold") return !carrying || direct;
  if (action === "place") return !carrying || direct;
  if (CUBE_QUICK_VIEW_ACTIONS.includes(action)) {
    const view = state?.view;
    if (action.startsWith("depth-")) return !view?.available;
    return !state?.selected || carrying || direct || Number(view?.linkedNeighborDegree ?? 0) <= 0;
  }
  return true;
}

/**
 * Mount an optional quick-action rail. All DOM nodes are supplied by the
 * document so a static/fallback host can omit the rail without breaking the
 * Block World renderer.
 */
export function createCubeQuickActions({
  documentRoot = globalThis.document,
  getBlockWorldSnapshot = () => null,
  actions = {},
  onAction,
} = {}) {
  const consoleEl = byId(documentRoot, "block-world-quick-actions", "cube-quick-actions-console");
  const statusEl = byId(documentRoot, "block-world-quick-actions-status", "cube-quick-actions-status");
  const selectedEl = byId(documentRoot, "block-world-quick-actions-selected", "cube-quick-actions-selected");
  const boundaryEl = byId(documentRoot, "block-world-quick-actions-boundary", "cube-quick-actions-boundary");
  const viewStatusEl = byId(documentRoot, "block-world-quick-view-status", "cube-quick-view-status");
  const viewBoundaryEl = byId(documentRoot, "block-world-quick-view-boundary", "cube-quick-view-boundary");
  const buttons = Object.fromEntries(CUBE_QUICK_ACTIONS.map((action) => [
    action,
    byId(documentRoot, ACTION_IDS[action], LEGACY_ACTION_IDS[action]),
  ]));
  const viewButtons = Object.fromEntries(CUBE_QUICK_VIEW_ACTIONS.map((action) => [
    action,
    byId(documentRoot, VIEW_ACTION_IDS[action]),
  ]));

  let opened = false;
  let context = Object.freeze({ featureId: null, featureLabel: "LOCAL FEATURE", method: "feature" });
  let latestSnapshot = null;
  let lastAction = null;
  const trace = [];

  function sync(snapshot = getBlockWorldSnapshot?.(), nextContext = context) {
    latestSnapshot = clone(snapshot);
    context = freezeRecord({
      featureId: text(nextContext?.featureId, context.featureId),
      featureLabel: text(nextContext?.featureLabel, context.featureLabel),
      method: text(nextContext?.method, context.method),
    });
    const state = {
      ...summaryFor(latestSnapshot, context),
      view: viewSummaryFor(latestSnapshot),
      snapshot: latestSnapshot,
    };
    consoleEl?.setAttribute?.("data-projection-session", "shared");
    consoleEl?.setAttribute?.("data-state-model", "one-composed-read-only-projection-session");
    const openable = Boolean(state.selected?.canOpen);
    const openLabel = state.selected?.open ? "CLOSE CUBE" : "OPEN CUBE";
    if (buttons.open) {
      buttons.open.disabled = disabledFor("open", state);
      buttons.open.textContent = openLabel;
      buttons.open.setAttribute("aria-label", state.selected?.open ? "Close the selected cube" : ACTION_META.open.ariaLabel);
    }
    CUBE_QUICK_ACTIONS.filter((action) => action !== "open").forEach((action) => {
      const button = buttons[action];
      if (!button) return;
      button.disabled = disabledFor(action, state);
      button.textContent = ACTION_META[action].label;
      button.setAttribute("aria-label", ACTION_META[action].ariaLabel);
    });
    CUBE_QUICK_VIEW_ACTIONS.forEach((action) => {
      const button = viewButtons[action];
      if (!button) return;
      button.disabled = disabledFor(action, state);
      button.textContent = VIEW_ACTION_META[action].label;
      button.setAttribute("aria-label", VIEW_ACTION_META[action].ariaLabel);
      if (action.startsWith("depth-")) {
        const mode = action.slice("depth-".length);
        button.setAttribute("aria-pressed", String(mode === state.view.mode));
        button.dataset.active = String(mode === state.view.mode);
      }
    });
    if (selectedEl) {
      selectedEl.textContent = `ONE PROJECTION · ${state.feature} · ${state.cube} · ${state.mode} · ${state.view.mode.toUpperCase()} · ${state.view.linkedNeighborDegree} LINK${state.view.linkedNeighborDegree === 1 ? "" : "S"} · ${state.holding ? "CARRY READY" : "LOCAL DRAFT"}`;
    }
    if (statusEl) {
      statusEl.textContent = lastAction
        ? `ONE PROJECTION · ${lastAction.toUpperCase()} · ${state.cube} · ${state.mode} · ${state.view.mode.toUpperCase()} · LOCAL ONLY`
        : `ONE PROJECTION · ${state.feature} · ${state.mode} · OPEN / INSPECT / MOVE / GRAB / HOLD / PLACE · ${state.view.mode.toUpperCase()} · LOCAL ONLY`;
    }
    if (boundaryEl) boundaryEl.textContent = CUBE_QUICK_ACTIONS_BOUNDARY;
    if (viewStatusEl) {
      viewStatusEl.textContent = state.view.available
        ? `${state.view.mode.toUpperCase()} PROJECTION · W ${state.view.nestedContentDepth} · V ${state.view.linkedNeighborDegree} · ${state.view.linkedNeighborDegree} LINK${state.view.linkedNeighborDegree === 1 ? "" : "S"} · LOCAL ONLY`
        : "SEMANTIC DEPTH UNAVAILABLE · LOCAL ONLY";
    }
    if (viewBoundaryEl) {
      viewBoundaryEl.textContent = "Depth is a reversible 3-D projection: W is nested-content depth and V is linked-neighbor degree; 4D/5D are semantic labels, not physical dimensions. Linked navigation selects an existing local cube only. Feature panels remain in this same projection.";
    }
    return getSnapshot();
  }

  function setOpen(next, reason = "api") {
    opened = Boolean(next);
    // Let the host move the floating intent-timeline opener out of the rail's
    // touch area on narrow screens. This is a presentation flag only; it does
    // not create another state owner or change the action contract.
    documentRoot.body?.classList?.toggle?.("cube-quick-actions-open", opened);
    if (consoleEl) {
      consoleEl.hidden = !opened;
      consoleEl.setAttribute("aria-hidden", String(!opened));
      consoleEl.dataset.reason = reason;
    }
    if (opened) sync(getBlockWorldSnapshot?.());
    return getSnapshot();
  }

  function runAction(action, method = "quick-action") {
    const canonicalAction = action === "move"
      ? "move-left"
      : action === "prev"
        ? "linked-previous"
        : action === "next"
          ? "linked-next"
          : action;
    if (!CUBE_QUICK_ACTIONS_ALL.includes(canonicalAction)) return null;
    const button = buttons[canonicalAction] ?? viewButtons[canonicalAction];
    if (button?.disabled) return null;
    const handler = actions?.[canonicalAction] ?? actions?.[action];
    if (typeof handler !== "function") {
      const blocked = freezeRecord({
        source: CUBE_QUICK_ACTIONS_SOURCE,
        action: canonicalAction,
        method,
        blocked: true,
        reason: "handler-unavailable",
        localOnly: true,
        externalNetwork: false,
        persistence: false,
      });
      trace.push(blocked);
      while (trace.length > 12) trace.shift();
      onAction?.(blocked);
      return blocked;
    }
    const result = handler();
    lastAction = canonicalAction;
    const receipt = freezeRecord({
      source: CUBE_QUICK_ACTIONS_SOURCE,
      action: canonicalAction,
      method,
      result: clone(result),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    });
    trace.push(receipt);
    while (trace.length > 12) trace.shift();
    onAction?.(receipt);
    sync(getBlockWorldSnapshot?.());
    return receipt;
  }

  CUBE_QUICK_ACTIONS_ALL.forEach((action) => {
    const button = buttons[action] ?? viewButtons[action];
    if (!button) return;
    button.type = "button";
    button.dataset.action = action;
    button.setAttribute("aria-keyshortcuts", "Enter Space");
    button.addEventListener?.("click", (event) => {
      if (event?.detail === 0 && button.__cubeQuickKeyboardActivation) {
        button.__cubeQuickKeyboardActivation = false;
        return;
      }
      runAction(action, event?.detail === 0 ? "keyboard" : "button-or-touch");
    });
    button.addEventListener?.("keydown", (event) => {
      if (event?.key !== "Enter" && event?.key !== " ") return;
      event.preventDefault?.();
      event.stopPropagation?.();
      button.__cubeQuickKeyboardActivation = true;
      runAction(action, "keyboard");
    });
  });

  function getSnapshot() {
    const view = viewSummaryFor(latestSnapshot);
    return freezeRecord({
      source: CUBE_QUICK_ACTIONS_SOURCE,
      opened,
      context: clone(context),
      latestSnapshot: clone(latestSnapshot),
      view: clone({
        mode: view.mode,
        nestedContentDepth: view.nestedContentDepth,
        linkedNeighborDegree: view.linkedNeighborDegree,
        projectionOnly: view.projectionOnly,
        available: view.available,
      }),
      lastAction,
      trace: Object.freeze(trace.map((entry) => freezeRecord(clone(entry)))),
      boundary: CUBE_QUICK_ACTIONS_BOUNDARY,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    });
  }

  sync(getBlockWorldSnapshot?.());

  return Object.freeze({
    open: (nextContext = {}) => {
      setContext(nextContext);
      return setOpen(true, "feature-context");
    },
    close: (reason = "api") => setOpen(false, reason),
    setVisible: (visible, nextContext = {}) => {
      if (!visible) return setOpen(false, "hidden");
      setContext(nextContext);
      return setOpen(true, "visible");
    },
    setContext: (nextContext = {}) => setContext(nextContext),
    sync,
    refresh: () => sync(getBlockWorldSnapshot?.()),
    runAction,
    getSnapshot,
    isOpen: () => opened,
    destroy: () => {
      setOpen(false, "destroy");
      CUBE_QUICK_ACTIONS_ALL.forEach((action) => {
        const button = buttons[action] ?? viewButtons[action];
        button?.replaceChildren?.();
      });
    },
  });

  function setContext(nextContext = {}) {
    const featureId = text(nextContext?.featureId, context.featureId);
    // A rail action is meaningful only inside the feature context in which it
    // occurred. Carrying `PLACE` or `HOLD` into a newly selected feature can
    // make the visible status disagree with the current canonical cube
    // snapshot (which may have no held block). Preserve the immutable trace,
    // but clear the transient status when context actually changes.
    if (featureId !== context.featureId) lastAction = null;
    context = freezeRecord({
      featureId,
      featureLabel: text(nextContext?.featureLabel, context.featureLabel),
      method: text(nextContext?.method, context.method),
    });
    return sync(getBlockWorldSnapshot?.(), context);
  }
}

// Name the factory after the visible mount as well; this keeps integration
// call-sites readable while retaining the generic cube affordance API.
export const createBlockWorldQuickActions = createCubeQuickActions;
