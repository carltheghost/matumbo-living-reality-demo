/**
 * Presentation-only metadata for a canonical SIMFABRIC projection envelope.
 *
 * These helpers do not copy, reshape, or filter world state. They only pair the
 * canonical world reference with local display preferences so renderers can
 * choose an appropriate presentation without creating a second source of truth.
 */

export const DEVICE_PROJECTION_SCHEMA_VERSION = 1;

export const ViewportClass = Object.freeze({
  COMPACT: "compact",
  MEDIUM: "medium",
  EXPANDED: "expanded",
});

export const MotionPreference = Object.freeze({
  FULL: "full",
  REDUCED: "reduced",
});

const INPUT_MODES = new Set(["pointer-fine", "pointer-coarse", "keyboard", "unknown"]);
const CONTRAST_PREFERENCES = new Set(["more", "less", "no-preference"]);
const COLOR_SCHEMES = new Set(["dark", "light", "no-preference"]);

function requireRecord(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function requireBoolean(value, field) {
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean`);
  return value;
}

function requireEnum(value, values, field) {
  if (!values.has(value)) throw new TypeError(`${field} has an unsupported value`);
  return value;
}

export function classifyViewport(width) {
  if (!Number.isFinite(width) || width <= 0) {
    throw new TypeError("viewport.width must be a positive finite number");
  }
  if (width < 600) return ViewportClass.COMPACT;
  if (width < 1024) return ViewportClass.MEDIUM;
  return ViewportClass.EXPANDED;
}

/** Build deterministic metadata from already-observed local preferences. */
export function createDeviceProjectionMetadata({
  viewport,
  reducedMotion = false,
  inputMode = "unknown",
  contrast = "no-preference",
  colorScheme = "no-preference",
  textScale = 1,
}) {
  requireRecord(viewport, "viewport");
  const width = viewport.width;
  const height = viewport.height;
  classifyViewport(width);
  if (!Number.isFinite(height) || height <= 0) {
    throw new TypeError("viewport.height must be a positive finite number");
  }
  if (!Number.isFinite(textScale) || textScale < 1) {
    throw new TypeError("textScale must be a finite number greater than or equal to 1");
  }

  const motion = requireBoolean(reducedMotion, "reducedMotion")
    ? MotionPreference.REDUCED
    : MotionPreference.FULL;

  return Object.freeze({
    schemaVersion: DEVICE_PROJECTION_SCHEMA_VERSION,
    kind: "simfabric.device-projection-metadata",
    simulation: true,
    authority: "none",
    viewport: Object.freeze({
      width,
      height,
      class: classifyViewport(width),
      orientation: width > height ? "landscape" : "portrait",
    }),
    accessibility: Object.freeze({
      motion,
      animationScale: motion === MotionPreference.REDUCED ? 0 : 1,
      contrast: requireEnum(contrast, CONTRAST_PREFERENCES, "contrast"),
      colorScheme: requireEnum(colorScheme, COLOR_SCHEMES, "colorScheme"),
      textScale,
    }),
    input: Object.freeze({
      mode: requireEnum(inputMode, INPUT_MODES, "inputMode"),
      coarse: inputMode === "pointer-coarse",
    }),
    xr: Object.freeze({
      enabled: false,
      status: "not-tested",
      supportClaim: false,
      note: "VR/AR/WebXR support is not established by this projection helper.",
    }),
  });
}

function validateCanonicalEnvelope(envelope) {
  requireRecord(envelope, "envelope");
  if (envelope.kind !== "simfabric.projection-envelope") {
    throw new TypeError("envelope must be a canonical SIMFABRIC projection envelope");
  }
  if (envelope.simulation !== true || envelope.authority !== "none") {
    throw new TypeError("envelope must remain a local, non-authoritative simulation");
  }
  const world = requireRecord(envelope.world, "envelope.world");
  if (world.schemaVersion !== envelope.schemaVersion || world.simulation !== true) {
    throw new TypeError("envelope and world must share the canonical simulation schema");
  }
  return world;
}

/**
 * Pair device metadata with a canonical view. `world` deliberately retains
 * reference identity: presentation preferences cannot fork canonical truth.
 */
export function createDeviceProjection(envelope, preferences) {
  const world = validateCanonicalEnvelope(envelope);
  return Object.freeze({
    schemaVersion: envelope.schemaVersion,
    kind: "simfabric.device-projection",
    simulation: true,
    authority: "none",
    projectedAt: envelope.projectedAt,
    world,
    presentation: createDeviceProjectionMetadata(preferences),
  });
}

/** Read browser display hints; this performs no network or external action. */
export function readBrowserProjectionPreferences(browserWindow = globalThis.window) {
  if (!browserWindow || !Number.isFinite(browserWindow.innerWidth)) {
    throw new TypeError("A browser window with viewport dimensions is required");
  }
  const matches = (query) => browserWindow.matchMedia?.(query)?.matches === true;
  const inputMode = matches("(pointer: coarse)")
    ? "pointer-coarse"
    : matches("(pointer: fine)")
      ? "pointer-fine"
      : "unknown";

  return Object.freeze({
    viewport: Object.freeze({
      width: browserWindow.innerWidth,
      height: browserWindow.innerHeight,
    }),
    reducedMotion: matches("(prefers-reduced-motion: reduce)"),
    inputMode,
    contrast: matches("(prefers-contrast: more)")
      ? "more"
      : matches("(prefers-contrast: less)")
        ? "less"
        : "no-preference",
    colorScheme: matches("(prefers-color-scheme: dark)")
      ? "dark"
      : matches("(prefers-color-scheme: light)")
        ? "light"
        : "no-preference",
    textScale: 1,
  });
}
