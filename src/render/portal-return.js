/**
 * Same-page return handoff for a Block World portal destination.
 *
 * A portal route temporarily moves the viewer from the cube field into one
 * of the existing local feature surfaces. This tiny renderer owns only the
 * visible way back. It keeps the originating navigation draft in memory,
 * emits a frozen local return record, and never changes the URL, projection,
 * persistence, network, provider, wallet, or value state.
 */

export const PORTAL_RETURN_SOURCE = "block-world-portal-return";
export const PORTAL_RETURN_CONSOLE_SOURCE = PORTAL_RETURN_SOURCE;
export const PORTAL_RETURN_REPLAY_SOURCE = "block-world-portal-return-replay";
export const PORTAL_RETURN_BOUNDARY =
  "Same-page local handoff only. Returning to the cube field preserves the current Block World draft and portal trace; no URL route, persistence, network, provider, wallet, transfer, settlement, or execution path is active.";

export const PORTAL_RETURN_DOM_IDS = Object.freeze({
  panel: "portal-return-console",
  button: "portal-return-button",
  status: "portal-return-status",
  detail: "portal-return-detail",
  boundary: "portal-return-boundary",
});

const freeze = (value) => Object.freeze(value);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return freeze(value.map(clone));
  if (!isRecord(value)) return value;
  return freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)])));
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeNavigation(navigation) {
  if (!isRecord(navigation)) throw new TypeError("portal navigation must be an object");
  const targetFeature = requireString(
    navigation.targetFeature ?? navigation.featureId ?? navigation.route?.featureId,
    "navigation.targetFeature",
  );
  const sourceBlockId = requireString(
    navigation.sourceBlockId ?? navigation.sourceBlock?.id,
    "navigation.sourceBlockId",
  );
  const routeId = requireString(
    navigation.routeId ?? navigation.route?.id ?? targetFeature,
    "navigation.routeId",
  );
  const sourceCoordinate = navigation.sourceCoordinate ?? navigation.sourceBlock?.coordinate ?? null;
  if (sourceCoordinate !== null
    && (!Array.isArray(sourceCoordinate)
      || sourceCoordinate.length !== 3
      || !sourceCoordinate.every((entry) => Number.isInteger(entry)))) {
    throw new TypeError("navigation.sourceCoordinate must be an integer [x, y, z] coordinate");
  }
  return clone({
    source: PORTAL_RETURN_SOURCE,
    action: "portal-open",
    sourceBlockId,
    sourceCoordinate,
    targetFeature,
    routeId,
    transition: navigation.transition ?? "portal",
    portalTransition: navigation.portalTransition ?? null,
    navigationDraft: true,
    simulation: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  });
}

function text(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = String(value);
  return element;
}

/**
 * Mount the return rail into an existing DOM. The host decides how to focus
 * the camera and select the Block World feature; this renderer only invokes
 * `onReturn` with a frozen local record.
 */
export function createPortalReturnHandoff({
  documentRoot = globalThis.document,
  onReturn = null,
  onReplay = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Portal return handoff needs a document-like owner");
  const panel = documentRoot.getElementById(PORTAL_RETURN_DOM_IDS.panel);
  const button = documentRoot.getElementById(PORTAL_RETURN_DOM_IDS.button);
  const statusElement = documentRoot.getElementById(PORTAL_RETURN_DOM_IDS.status);
  const detailElement = documentRoot.getElementById(PORTAL_RETURN_DOM_IDS.detail);
  const boundaryElement = documentRoot.getElementById(PORTAL_RETURN_DOM_IDS.boundary);
  if (!panel || !button || !statusElement || !detailElement || !boundaryElement) {
    throw new Error("Portal return handoff mount points are missing");
  }

  let navigation = null;
  let opened = panel.hidden !== true;
  let returnCount = 0;
  let replayCount = 0;
  let lastReturn = null;
  let lastReplay = null;
  const pendingKeyboardActivations = new WeakSet();

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.setAttribute?.("aria-hidden", String(!opened));
    if (opened) {
      panel.dataset ??= {};
      panel.dataset.localOnly = "true";
      button.focus?.({ preventScroll: true });
    } else {
      button.blur?.();
    }
    if (!opened && method === "dismiss") {
      statusElement.textContent = "PORTAL RETURN HIDDEN · CHOOSE ANOTHER LOCAL FEATURE";
    }
  }

  function render() {
    if (!navigation) {
      statusElement.textContent = "NO PORTAL DESTINATION OPEN";
      detailElement.textContent = "Open a feature from a portal cube to reveal the return handoff.";
      button.disabled = true;
      return;
    }
    const target = navigation.targetFeature.replace(/-/g, " ").toUpperCase();
    const coordinate = navigation.sourceCoordinate?.join(",") ?? "unknown";
    statusElement.textContent = `PORTAL OPEN · ${target} · LOCAL ONLY`;
    detailElement.textContent = `Opened from cube ${navigation.sourceBlockId} at ${coordinate}. Return keeps the cube draft and portal trace.`;
    button.disabled = false;
    boundaryElement.textContent = PORTAL_RETURN_BOUNDARY;
  }

  function open(nextNavigation, method = "portal") {
    navigation = normalizeNavigation(nextNavigation);
    render();
    setOpen(true, method);
    return getSnapshot();
  }

  function close(method = "api") {
    setOpen(false, method);
    return getSnapshot();
  }

  function returnToCubeField(method = "button") {
    if (!navigation) {
      statusElement.textContent = "RETURN BLOCKED · NO PORTAL DESTINATION IS OPEN";
      return null;
    }
    const result = clone({
      source: PORTAL_RETURN_SOURCE,
      action: "return-to-cube-field",
      method,
      sourceBlockId: navigation.sourceBlockId,
      sourceCoordinate: navigation.sourceCoordinate,
      targetFeature: navigation.targetFeature,
      routeId: navigation.routeId,
      preservedDraft: true,
      preservedPortalTrace: true,
      returnCount: returnCount + 1,
      simulation: true,
      deterministic: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      boundary: PORTAL_RETURN_BOUNDARY,
    });
    returnCount += 1;
    lastReturn = result;
    onReturn?.(result);
    setOpen(false, "return");
    return result;
  }

  function replay(method = "replay") {
    if (!navigation) {
      statusElement.textContent = "REPLAY BLOCKED · NO PORTAL DESTINATION IS OPEN";
      return null;
    }
    replayCount += 1;
    const result = clone({
      source: PORTAL_RETURN_REPLAY_SOURCE,
      action: "replay-return",
      method,
      replayCount,
      returnCount,
      sourceBlockId: navigation.sourceBlockId,
      sourceCoordinate: navigation.sourceCoordinate,
      targetFeature: navigation.targetFeature,
      routeId: navigation.routeId,
      sequence: ["portal-open", "return-to-cube-field"],
      preservedDraft: true,
      preservedPortalTrace: true,
      simulation: true,
      deterministic: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      boundary: PORTAL_RETURN_BOUNDARY,
    });
    lastReplay = result;
    statusElement.textContent = `REPLAYED · PORTAL RETURN #${replayCount} · LOCAL ONLY`;
    onReplay?.(result);
    return result;
  }

  // Native buttons already support Enter/Space and touch. This supplement
  // keeps synthetic keyboard harnesses deterministic without double-emitting
  // trusted browser activation.
  button.tabIndex = 0;
  button.setAttribute?.("type", "button");
  button.setAttribute?.("aria-keyshortcuts", "Enter Space");
  button.setAttribute?.("aria-label", "Return to the cube field");
  button.addEventListener?.("click", (event) => {
    if (pendingKeyboardActivations.has(button)
      && (event?.detail === undefined || event?.detail === 0)) {
      pendingKeyboardActivations.delete(button);
      return;
    }
    pendingKeyboardActivations.delete(button);
    returnToCubeField(event?.detail === 0 ? "keyboard" : "button-or-touch");
  });
  button.addEventListener?.("keydown", (event) => {
    const key = event?.key;
    if (event?.repeat || !["Enter", " ", "Spacebar"].includes(key)) return;
    if (event?.isTrusted === true) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    pendingKeyboardActivations.add(button);
    returnToCubeField("keyboard");
  });
  render();
  setOpen(opened, "initial");

  function getSnapshot() {
    return clone({
      source: PORTAL_RETURN_SOURCE,
      opened,
      navigation,
      returnCount,
      replayCount,
      lastReturn,
      lastReplay,
      status: statusElement.textContent,
      accessibility: {
        keyboard: true,
        touch: true,
        ariaKeyshortcuts: "Enter Space",
      },
      preservedDraft: true,
      preservedPortalTrace: true,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      persistence: false,
      executable: false,
      boundary: PORTAL_RETURN_BOUNDARY,
    });
  }

  return Object.freeze({
    open,
    close,
    returnToCubeField,
    replay,
    getSnapshot,
    isOpen: () => opened,
  });
}

export const createPortalReturnConsole = createPortalReturnHandoff;
export const createCubeFieldReturnHandoff = createPortalReturnHandoff;

export default createPortalReturnHandoff;
