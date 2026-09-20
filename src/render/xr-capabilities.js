/**
 * XR capability discovery for maTumbo Living Reality Ω.
 *
 * Pure capability layer:
 * - probes WebXR support for immersive-vr and immersive-ar;
 * - records secure-context state without requesting permissions;
 * - describes requested-vs-actually-enabled session features;
 * - never opens an XR session by itself;
 * - never touches camera frames, hand landmarks, identity, or network data.
 *
 * The caller remains responsible for explicit user activation and for the
 * actual session lifecycle.
 */

export const XR_CAPABILITY_SOURCE = "xr-capabilities";

export const XR_MODES = Object.freeze([
  "immersive-vr",
  "immersive-ar",
]);

export const XR_OPTIONAL_FEATURES = Object.freeze([
  "local-floor",
  "bounded-floor",
  "hand-tracking",
  "dom-overlay",
  "hit-test",
  "anchors",
  "depth-sensing",
]);

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freeze(entry)));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, freeze(entry)]),
    ));
  }
  return value;
}

function safeBoolean(value) {
  return value === true;
}

function safeString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function secureContextOf(root) {
  if (typeof root?.isSecureContext === "boolean") return root.isSecureContext;
  if (typeof globalThis.isSecureContext === "boolean") return globalThis.isSecureContext;
  return null;
}

async function probeMode(xr, mode) {
  if (!xr?.requestSession) {
    return {
      supported: false,
      reason: "webxr-unavailable",
    };
  }

  if (typeof xr.isSessionSupported !== "function") {
    return {
      supported: null,
      reason: "support-query-unavailable",
    };
  }

  try {
    const supported = await xr.isSessionSupported(mode);
    return {
      supported: Boolean(supported),
      reason: supported ? "supported" : "not-supported",
    };
  } catch (error) {
    return {
      supported: false,
      reason: safeString(error?.name) ?? "support-query-error",
    };
  }
}

/**
 * Probe capability without opening a session or triggering a permission prompt.
 *
 * @param {object} navigatorRoot navigator-like object
 * @param {object} environmentRoot optional window/global-like object
 * @returns {Promise<object>}
 */
export async function detectXrCapabilities(
  navigatorRoot = globalThis.navigator,
  environmentRoot = globalThis,
) {
  const xr = navigatorRoot?.xr ?? null;
  const secureContext = secureContextOf(environmentRoot);

  const [vr, ar] = await Promise.all([
    probeMode(xr, "immersive-vr"),
    probeMode(xr, "immersive-ar"),
  ]);

  const webxr = Boolean(xr?.requestSession);
  const availableModes = XR_MODES.filter((mode) => {
    const result = mode === "immersive-vr" ? vr : ar;
    return result.supported === true;
  });

  return freeze({
    source: XR_CAPABILITY_SOURCE,
    webxr,
    secureContext,
    availableModes,
    modes: {
      "immersive-vr": vr,
      "immersive-ar": ar,
    },
    requestedOptionalFeatures: [...XR_OPTIONAL_FEATURES],
    permissionRequested: false,
    sessionStarted: false,
    rawSensorDataTransferred: false,
    externalNetwork: false,
    localOnly: true,
  });
}

/**
 * Inspect a session after requestSession() succeeds. This reads only the
 * session's capability metadata; it does not read camera/image/hand frames.
 */
export function inspectXrSession(
  session,
  requestedFeatures = XR_OPTIONAL_FEATURES,
) {
  const enabledFeatures = Array.isArray(session?.enabledFeatures)
    ? session.enabledFeatures.map(String)
    : [];

  const domOverlayState = session?.domOverlayState
    ? Object.freeze({
      type: safeString(session.domOverlayState.type),
    })
    : null;

  return freeze({
    source: XR_CAPABILITY_SOURCE,
    sessionStarted: Boolean(session),
    mode: safeString(session?.sessionMode),
    environmentBlendMode: safeString(session?.environmentBlendMode),
    enabledFeatures,
    requestedFeatures: Array.from(new Set(
      (Array.isArray(requestedFeatures) ? requestedFeatures : []).map(String),
    )),
    domOverlay: domOverlayState,
    handTracking: enabledFeatures.includes("hand-tracking"),
    hitTest: enabledFeatures.includes("hit-test"),
    anchors: enabledFeatures.includes("anchors"),
    depthSensing: enabledFeatures.includes("depth-sensing"),
    localOnly: true,
    rawSensorDataTransferred: false,
    externalNetwork: false,
  });
}

export function summarizeXrCapabilities(capabilities = {}) {
  const modes = capabilities?.modes ?? {};
  const vr = modes["immersive-vr"]?.supported === true;
  const ar = modes["immersive-ar"]?.supported === true;

  if (!capabilities?.webxr) {
    return "WebXR unavailable";
  }

  if (!vr && !ar) {
    return "WebXR detected, but no immersive VR/AR mode is currently supported";
  }

  if (vr && ar) {
    return "VR + AR available";
  }

  return vr ? "VR available" : "AR available";
}

export default Object.freeze({
  XR_CAPABILITY_SOURCE,
  XR_MODES,
  XR_OPTIONAL_FEATURES,
  detectXrCapabilities,
  inspectXrSession,
  summarizeXrCapabilities,
});
