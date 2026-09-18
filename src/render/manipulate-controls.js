/**
 * manipulate-controls.js — free 3D gizmo manipulation for the Living Reality projection.
 *
 * Tumbo's correction: the 3D world is not really 3D if you can only look around.
 * Everything in there must be mutable — grab any object and move it in ALL
 * dimensions (including back into depth), spin it any way, stretch/scale it.
 *
 * This module wraps the locally vendored
 * `three-r179.1/examples/jsm/controls/TransformControls.js` (no network, no CDN).
 * It owns: mode state (translate / rotate / scale), gizmo attach/detach, enlarged
 * touch hit areas, and the release write-back callback that hands the final
 * transform back to the host renderer so it can persist into the projection record.
 *
 * The TransformControls class is INJECTED (never imported here) so this module
 * stays runnable in Node tests and in static-fallback hosts where Three.js never
 * loads. When no class is provided every mutating call returns a frozen
 * "blocked/unavailable" snapshot and changes nothing.
 *
 * Boundaries (non-negotiable):
 * - Local projection only. The gizmo reshapes presentation state; it never
 *   touches wallet, ledger, contracts, PAYCORE, T402, network, or settlement.
 * - Transforms are presentation + local snapshot state, never authority over
 *   anything real. The Three.js world is a projection, never a ledger.
 * - Reality Lens Ω naming only. World Eye stays retired.
 */

export const MANIPULATE_MODES = Object.freeze(["translate", "rotate", "scale"]);
export const MANIPULATE_MODE_LABELS = Object.freeze({
  translate: "MOVE",
  rotate: "ROTATE",
  scale: "STRETCH",
});
export const MANIPULATE_MODE_SHORTCUTS = Object.freeze({
  translate: "T",
  rotate: "R",
  scale: "S",
});
export const MANIPULATE_SOURCE = "manipulate-controls";
export const MANIPULATE_SCHEMA_VERSION = 1;
// Desktop gizmo size matches the TransformControls default.
export const MANIPULATE_GIZMO_SIZE_DESKTOP = 1;
// Touch-first: Tumbo has no mouse. The gizmo (including its raycast pickers)
// is scaled up so handles stay grabbable with a finger.
export const MANIPULATE_GIZMO_SIZE_TOUCH = 1.5;
export const MANIPULATE_TOUCH_HIT_MINIMUM = 1.4;
export const MANIPULATE_BOUNDARY =
  "Local projection only: the gizmo reshapes presentation transforms. No wallet, ledger, contracts, network, custody, mainnet, or settlement authority.";

function freezeRecord(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeRecord));
  if (value && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeRecord(entry)])),
    );
  }
  return value;
}

function round4(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(4));
}

/**
 * Read a plain, JSON-safe transform from a Three.js object.
 * Position and scale come from Vector3-likes; rotation from an Euler-like.
 */
export function readObjectTransform(object) {
  const position = object?.position ?? {};
  const rotation = object?.rotation ?? {};
  const scale = object?.scale ?? {};
  return freezeRecord({
    position: [round4(position.x), round4(position.y), round4(position.z)],
    rotation: [round4(rotation.x), round4(rotation.y), round4(rotation.z)],
    scale: [
      round4(Number.isFinite(Number(scale.x)) ? scale.x : 1),
      round4(Number.isFinite(Number(scale.y)) ? scale.y : 1),
      round4(Number.isFinite(Number(scale.z)) ? scale.z : 1),
    ],
  });
}

export function normalizeManipulateMode(mode) {
  if (mode == null) return null;
  const normalized = String(mode).trim().toLowerCase();
  return MANIPULATE_MODES.includes(normalized) ? normalized : undefined;
}

export function createManipulateControls({
  TransformControlsClass = null,
  scene = null,
  camera = null,
  domElement = null,
  isTouch = false,
  onTransformEnd = null,
  onDraggingChange = null,
} = {}) {
  let mode = null;
  let attached = null; // { object, blockId } | null
  let controls = null;
  let dragging = false;
  let touchMode = isTouch === true;
  const trace = [];

  function available() {
    return typeof TransformControlsClass === "function" && camera != null;
  }

  function gizmoSize() {
    return touchMode
      ? Math.max(MANIPULATE_GIZMO_SIZE_TOUCH, MANIPULATE_TOUCH_HIT_MINIMUM)
      : MANIPULATE_GIZMO_SIZE_DESKTOP;
  }

  function pushTrace(record) {
    trace.push(record);
    while (trace.length > 24) trace.shift();
  }

  function snapshot(action, extra = {}) {
    return freezeRecord({
      source: MANIPULATE_SOURCE,
      schemaVersion: MANIPULATE_SCHEMA_VERSION,
      action,
      mode,
      modeLabel: mode ? MANIPULATE_MODE_LABELS[mode] : null,
      attachedBlockId: attached?.blockId ?? null,
      dragging,
      touchMode,
      gizmoSize: gizmoSize(),
      available: available(),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      boundary: MANIPULATE_BOUNDARY,
      ...extra,
    });
  }

  function ensureControls() {
    if (controls) return controls;
    if (!available()) return null;
    controls = new TransformControlsClass(camera, domElement ?? null);
    if (typeof controls.setSize === "function") controls.setSize(gizmoSize());
    if (typeof controls.setSpace === "function") controls.setSpace("world");
    if (scene && typeof scene.add === "function") {
      const helper = typeof controls.getHelper === "function" ? controls.getHelper() : null;
      if (helper) {
        try {
          scene.add(helper);
        } catch {
          // A static or headless host may hand us a scene stub; the gizmo
          // simply stays unmounted and attach() reports unavailable.
        }
      }
    }
    if (typeof controls.addEventListener === "function") {
      controls.addEventListener("dragging-changed", (event) => {
        dragging = event?.value === true;
        const record = snapshot("dragging-changed", { dragging });
        pushTrace(record);
        try {
          onDraggingChange?.(dragging, attached ? { object: attached.object, blockId: attached.blockId } : null);
        } catch {
          // Host callback failures must never break the gizmo state machine.
        }
      });
      // TransformControls dispatches `mouseUp` only after a real gizmo drag,
      // so the write-back fires exactly once per release.
      controls.addEventListener("mouseUp", () => {
        writeBack("release");
      });
    }
    return controls;
  }

  function writeBack(reason) {
    if (!attached?.object) return null;
    const transform = readObjectTransform(attached.object);
    const record = snapshot("transform-end", {
      blockId: attached.blockId,
      transform,
      reason,
    });
    pushTrace(record);
    try {
      onTransformEnd?.(attached.blockId, transform, { reason, mode });
    } catch {
      // Host persistence failures must never break the gizmo state machine.
    }
    return record;
  }

  function setMode(next) {
    const normalized = normalizeManipulateMode(next);
    if (normalized === undefined) {
      const blocked = snapshot("mode-blocked", {
        requested: typeof next === "string" ? next : String(next ?? ""),
        reason: "unknown-mode",
      });
      pushTrace(blocked);
      return blocked;
    }
    mode = normalized;
    if (controls && typeof controls.setMode === "function" && mode) controls.setMode(mode);
    if (mode === null) detach("mode-off");
    const record = snapshot("mode-change", {});
    pushTrace(record);
    return record;
  }

  function attach(object, blockId, reason = "select") {
    if (!object || blockId == null || blockId === "") {
      const blocked = snapshot("attach-blocked", { reason: "missing-target", blockId: blockId ?? null });
      pushTrace(blocked);
      return blocked;
    }
    if (!available()) {
      const blocked = snapshot("attach-blocked", { reason: "unavailable", blockId });
      pushTrace(blocked);
      return blocked;
    }
    const active = ensureControls();
    if (!active) {
      const blocked = snapshot("attach-blocked", { reason: "unavailable", blockId });
      pushTrace(blocked);
      return blocked;
    }
    // Attaching the already-attached object is a no-op: canvas selection
    // raycasts the block behind a grabbed gizmo handle, and that must not
    // tear the gizmo down mid-drag.
    if (
      attached
      && attached.object === object
      && attached.blockId === blockId
      && (!mode || typeof active.getMode !== "function" || active.getMode() === mode)
    ) {
      return snapshot("attach-noop", { blockId, reason: "already-attached" });
    }
    if (mode && typeof active.setMode === "function") active.setMode(mode);
    if (typeof active.setSize === "function") active.setSize(gizmoSize());
    try {
      active.attach(object);
    } catch {
      const blocked = snapshot("attach-blocked", { reason: "attach-failed", blockId });
      pushTrace(blocked);
      return blocked;
    }
    attached = { object, blockId };
    const record = snapshot("attach", { blockId, reason });
    pushTrace(record);
    return record;
  }

  function detach(reason = "detach") {
    if (!attached && !controls) return snapshot("detach-noop", { reason });
    try {
      controls?.detach?.();
    } catch {
      // Detach is best-effort; the wrapper state is what the host reads.
    }
    attached = null;
    const record = snapshot("detach", { reason });
    pushTrace(record);
    return record;
  }

  function setTouchMode(next) {
    touchMode = next === true;
    try {
      controls?.setSize?.(gizmoSize());
    } catch {
      // Size is cosmetic; a failure here never blocks manipulation.
    }
    const record = snapshot("touch-mode", {});
    pushTrace(record);
    return record;
  }

  function destroy(reason = "destroy") {
    try {
      controls?.dispose?.();
    } catch {
      // Disposal is best-effort in degraded hosts.
    }
    controls = null;
    return detach(reason);
  }

  // ---- external pointer-source adapter (Gesture Lens, additive) ----
  // A registered host source lets an external pointer rehearsal (the
  // gesture-lens console) drive the same attach/translate/scale/rotate
  // pipeline as direct touch. The adapter is strictly additive: it never
  // intercepts or replays touch/mouse events, and every external action is
  // tagged `external: true` in the trace. Gesture deltas arrive in the
  // normalized rehearsal space; they are mapped to camera-relative world
  // units so a proxy drag feels like a direct drag.
  let externalSource = null; // { pick(pose) -> { object, blockId } | null } | null

  function setExternalIntentSource(source) {
    externalSource = source && typeof source.pick === "function" ? source : null;
    const record = snapshot("external-source", {
      external: true,
      registered: externalSource !== null,
    });
    pushTrace(record);
    return record;
  }

  function externalTranslate(object, dx, dy, dz) {
    const k = 4; // world units per normalized proxy unit
    try {
      const right = { x: 1, y: 0, z: 0 };
      const up = { x: 0, y: 1, z: 0 };
      const forward = { x: 0, y: 0, z: 1 };
      if (camera?.matrixWorld?.elements) {
        const e = camera.matrixWorld.elements;
        right.x = e[0]; right.y = e[1]; right.z = e[2];
        up.x = e[4]; up.y = e[5]; up.z = e[6];
        forward.x = -e[8]; forward.y = -e[9]; forward.z = -e[10];
      }
      object.position.x += (right.x * dx + up.x * dy + forward.x * dz) * k;
      object.position.y += (right.y * dx + up.y * dy + forward.y * dz) * k;
      object.position.z += (right.z * dx + up.z * dy + forward.z * dz) * k;
    } catch {
      // A failed nudge is a no-op; the trace still records the intent.
    }
  }

  function applyExternalIntent(event = {}) {
    const gesture = typeof event?.gesture === "string" ? event.gesture : "none";
    const detail = event?.detail && typeof event.detail === "object" ? event.detail : {};
    const pose = event?.pose && typeof event.pose === "object" ? event.pose : null;
    const base = { external: true, gesture, method: "gesture-lens" };
    if (gesture === "grab") {
      if (!externalSource) {
        const blocked = snapshot("external-blocked", { ...base, reason: "no-source" });
        pushTrace(blocked);
        return blocked;
      }
      let hit = null;
      try {
        hit = externalSource.pick(pose);
      } catch {
        hit = null;
      }
      if (!hit?.object || hit.blockId == null || hit.blockId === "") {
        const miss = snapshot("external-miss", { ...base, reason: "no-hit" });
        pushTrace(miss);
        return miss;
      }
      if (!mode) setMode("translate");
      const record = attach(hit.object, hit.blockId, "gesture-grab");
      pushTrace(snapshot("external-attach", { ...base, blockId: hit.blockId }));
      return record;
    }
    if (gesture === "proxy-move" || gesture === "drag") {
      if (!attached?.object) {
        const blocked = snapshot("external-blocked", { ...base, reason: "nothing-attached" });
        pushTrace(blocked);
        return blocked;
      }
      const dx = Number(detail.dx) || 0;
      const dy = Number(detail.dy) || 0;
      const dz = Number(detail.dz) || 0;
      externalTranslate(attached.object, dx, dy, dz);
      const record = snapshot("external-translate", { ...base, blockId: attached.blockId, dx, dy, dz });
      pushTrace(record);
      return record;
    }
    if (gesture === "scale") {
      if (!attached?.object) {
        const blocked = snapshot("external-blocked", { ...base, reason: "nothing-attached" });
        pushTrace(blocked);
        return blocked;
      }
      setMode("scale");
      const factor = Number(detail.factor);
      const clamped = Number.isFinite(factor) ? Math.min(4, Math.max(0.25, factor)) : 1;
      try {
        attached.object.scale.x *= clamped;
        attached.object.scale.y *= clamped;
        attached.object.scale.z *= clamped;
      } catch {
        // Scaling stays best-effort; the trace records the intent.
      }
      const record = snapshot("external-scale", { ...base, blockId: attached.blockId, factor: clamped });
      pushTrace(record);
      return record;
    }
    if (gesture === "rotate") {
      if (!attached?.object) {
        const blocked = snapshot("external-blocked", { ...base, reason: "nothing-attached" });
        pushTrace(blocked);
        return blocked;
      }
      setMode("rotate");
      const degrees = Number(detail.degrees) || 0;
      const radians = (degrees * Math.PI) / 180;
      try {
        // Twist around the camera view axis so a two-hand twist reads as a
        // twist of the held object.
        const axis = { x: 0, y: 0, z: 1 };
        if (camera?.matrixWorld?.elements) {
          const e = camera.matrixWorld.elements;
          axis.x = -e[8]; axis.y = -e[9]; axis.z = -e[10];
        }
        const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
        if (typeof attached.object.rotateOnWorldAxis === "function") {
          // Axis is pre-normalized; rotateOnWorldAxis only reads x/y/z.
          attached.object.rotateOnWorldAxis({ x: axis.x / len, y: axis.y / len, z: axis.z / len }, radians);
        } else {
          attached.object.rotation.y += radians;
        }
      } catch {
        // Rotation stays best-effort; the trace records the intent.
      }
      const record = snapshot("external-rotate", { ...base, blockId: attached.blockId, degrees });
      pushTrace(record);
      return record;
    }
    if (gesture === "release") {
      const had = attached ? { blockId: attached.blockId } : {};
      writeBack("gesture-release");
      const record = detach("gesture-release");
      pushTrace(snapshot("external-release", { ...base, ...had }));
      return record;
    }
    const ignored = snapshot("external-ignored", { ...base, reason: "unmapped-gesture" });
    pushTrace(ignored);
    return ignored;
  }

  return {
    setMode,
    getMode: () => mode,
    attach,
    detach,
    getAttached: () => (attached ? { object: attached.object, blockId: attached.blockId } : null),
    isDragging: () => dragging,
    isTouchMode: () => touchMode,
    setTouchMode,
    getGizmoSize: () => gizmoSize(),
    isAvailable: () => available(),
    getSnapshot: () => snapshot("read", {}),
    getTrace: () => [...trace],
    destroy,
    setExternalIntentSource,
    applyExternalIntent,
  };
}

export default createManipulateControls;
