import { inspectXrSession, XR_OPTIONAL_FEATURES } from "./xr-capabilities.js?v=20260922-cache2";

/** A single renderer/scene and the existing domain actions across desktop, VR and AR. */
export const IMMERSIVE_SESSION_SOURCE = "immersive-session";

export const XR_SESSION_OPTIONS = Object.freeze({
  optionalFeatures: Object.freeze([
    "local-floor",
    "bounded-floor",
    "hand-tracking",
    "dom-overlay",
  ]),
});

function safeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

/**
 * Create the one immersive-session controller for the canonical Three.js
 * renderer. VR and AR both reuse the same scene, camera, raycast targets and
 * selection authorities; no second world is constructed.
 */
export function createImmersiveSession({
  THREE,
  renderer,
  scene,
  camera,
  controls,
  targets = [],
  onSelect = null,
  onStatus = null,
  documentRoot = globalThis.document,
  navigatorRoot = globalThis.navigator,
} = {}) {
  if (!THREE || !renderer || !scene || !camera) {
    throw new TypeError("Immersive session needs THREE, renderer, scene, and camera");
  }

  let session = null;
  let starting = false;
  let activeMode = null;
  let destroyed = false;
  let controlsEnabledBeforeSession = null;

  const ray = new THREE.Raycaster();
  const rotation = new THREE.Matrix4();
  const controllerRigs = [];

  let visualStateBeforeSession = null;

  renderer.xr.enabled = true;

  const toolbar = documentRoot?.createElement?.("div") ?? null;
  const status = documentRoot?.createElement?.("span") ?? null;
  const buttons = [];

  function emitStatus(state, detail = null) {
    const snapshot = Object.freeze({
      source: IMMERSIVE_SESSION_SOURCE,
      state,
      mode: activeMode,
      active: Boolean(session),
      starting,
      webxr: Boolean(navigatorRoot?.xr?.requestSession),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalExecution: false,
      handTracking: activeMode ? "requested-if-supported" : "not-requested",
      detail: detail ?? null,
    });
    if (status) {
      status.textContent = detail ?? (state.toUpperCase() + (activeMode ? " · " + (activeMode === "immersive-ar" ? "AR" : "VR") : ""));
    }
    onStatus?.(snapshot);
    return snapshot;
  }

  function makeButton(title, onClick) {
    if (!toolbar || !documentRoot?.createElement) return null;
    const button = documentRoot.createElement("button");
    button.type = "button";
    button.textContent = title;
    button.addEventListener("click", onClick);
    toolbar.append(button);
    buttons.push(button);
    return button;
  }

  if (toolbar && documentRoot?.body) {
    toolbar.id = "immersive-toolbar";
    toolbar.style.cssText =
      "position:fixed;right:12px;top:8px;z-index:110;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 24px);background:#091723;padding:6px;border:1px solid #4e788f;border-radius:8px;font:12px system-ui;color:#d9efff";
    const vr = makeButton("Enter VR", () => start("immersive-vr"));
    const ar = makeButton("Enter AR", () => start("immersive-ar"));
    const leave = makeButton("Exit XR", () => session?.end());
    leave.hidden = true;

    if (status) {
      status.setAttribute("role", "status");
      status.textContent = "Same world · XR ready";
      toolbar.append(status);
    }
    documentRoot.body.append(toolbar);
    toolbar._xrButtons = { vr, ar, leave };
  }

  function setButtonState(active) {
    const controlsGroup = toolbar?._xrButtons;
    if (!controlsGroup) return;
    controlsGroup.vr.disabled = active || starting;
    controlsGroup.ar.disabled = active || starting;
    controlsGroup.leave.hidden = !active;
  }

  function visibleTarget(object) {
    let current = object;
    while (current) {
      if (!current.visible) return false;
      current = current.parent;
    }
    return true;
  }

  function selectFromController(controller) {
    if (!controller || !Array.isArray(targets)) return null;
    controller.updateWorldMatrix?.(true, false);
    rotation.identity().extractRotation(controller.matrixWorld);

    ray.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    ray.ray.direction.set(0, 0, -1).applyMatrix4(rotation);

    const intersections = ray.intersectObjects(targets, false);
    const hit = intersections.find((entry) => visibleTarget(entry.object));
    if (!hit) return null;

    onSelect?.(hit.object, {
      source: "xr",
      mode: activeMode,
      inputType: controller.userData?.inputType ?? "xr-pointer",
      distance: hit.distance,
      handTracking: controller.userData?.handTracking === true,
      simulation: true,
      localOnly: true,
    });
    return hit.object;
  }

  function wireController(index) {
    const controller = renderer.xr.getController(index);
    controller.userData.inputType = "xr-pointer";
    controller.userData.handTracking = false;

    const linePoints = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
    const material = new THREE.LineBasicMaterial({ color: 0xee455c });
    const line = new THREE.Line(geometry, material);
    line.scale.z = 25;
    controller.add(line);
    scene.add(controller);
    controllerRigs.push(controller);

    const onSelectStart = () => selectFromController(controller);
    const onSelect = () => selectFromController(controller);
    controller.addEventListener("selectstart", onSelectStart);
    controller.addEventListener("select", onSelect);

    controller._maTumboCleanup = () => {
      controller.removeEventListener("selectstart", onSelectStart);
      controller.removeEventListener("select", onSelect);
      controller.parent?.remove(controller);
      geometry.dispose?.();
      material.dispose?.();
    };

    return controller;
  }

  wireController(0);
  wireController(1);

  async function supports(mode) {
    if (destroyed || !navigatorRoot?.xr?.requestSession) return false;
    if (typeof navigatorRoot.xr.isSessionSupported !== "function") return true;
    try {
      return await navigatorRoot.xr.isSessionSupported(mode);
    } catch {
      return false;
    }
  }

  function setReferenceSpace() {
    try {
      renderer.xr.setReferenceSpaceType("local-floor");
      return "local-floor";
    } catch {
      renderer.xr.setReferenceSpaceType("local");
      return "local";
    }
  }

  async function start(mode = "immersive-vr") {
    if (destroyed || session || starting) return false;
    if (mode !== "immersive-vr" && mode !== "immersive-ar") {
      throw new TypeError("XR mode must be immersive-vr or immersive-ar");
    }

    const supported = await supports(mode);
    if (!supported) {
      emitStatus("unsupported", (mode === "immersive-ar" ? "AR" : "VR") + " is not supported on this browser/device");
      return false;
    }

    starting = true;
    activeMode = mode;
    visualStateBeforeSession = {
      background: scene.background,
      clearAlpha: typeof renderer.getClearAlpha === "function" ? renderer.getClearAlpha() : 1,
    };
    setButtonState(false);
    emitStatus("starting", "Starting " + (mode === "immersive-ar" ? "AR" : "VR") + " session…");

    try {
      const requestOptions = {
        optionalFeatures: [...XR_SESSION_OPTIONS.optionalFeatures],
      };
      if (documentRoot?.body) {
        requestOptions.domOverlay = { root: documentRoot.body };
      }

      const nextSession = await navigatorRoot.xr.requestSession(mode, requestOptions);
      session = nextSession;

      if (mode === "immersive-ar") {
        scene.background = null;
        renderer.setClearAlpha(0);
      }

      setReferenceSpace();
      await renderer.xr.setSession(nextSession);
      controlsEnabledBeforeSession = controls?.enabled ?? null;
      if (controls) controls.enabled = false;

      nextSession.addEventListener("end", reset, { once: true });

      controllerRigs.forEach((controller) => {
        const hasHand = Array.from(nextSession.inputSources ?? []).some((input) => input?.hand);
        controller.userData.handTracking = hasHand;
      });

      starting = false;
      setButtonState(true);
      emitStatus(
        "active",
        (mode === "immersive-ar" ? "AR" : "VR") + " · point + pinch / trigger to open cube",
      );
      return true;
    } catch (error) {
      try {
        await session?.end?.();
      } catch {
        // Keep the fallback path deterministic when XR rejects startup.
      }
      reset();
      const name = safeText(error?.name, "unavailable");
      emitStatus("error", "XR not started: " + name);
      return false;
    }
  }

  function reset() {
    session = null;
    activeMode = null;
    starting = false;
    if (visualStateBeforeSession) {
      scene.background = visualStateBeforeSession.background;
      renderer.setClearAlpha(visualStateBeforeSession.clearAlpha);
      visualStateBeforeSession = null;
    }
    if (controls && controlsEnabledBeforeSession !== null) controls.enabled = controlsEnabledBeforeSession;
    controlsEnabledBeforeSession = null;
    setButtonState(false);
    emitStatus("desktop", "Desktop · same world retained");
  }

  function getSnapshot() {
    return Object.freeze({
      source: IMMERSIVE_SESSION_SOURCE,
      active: Boolean(session),
      starting,
      mode: activeMode,
      webxr: Boolean(navigatorRoot?.xr?.requestSession),
      controllerCount: controllerRigs.length,
      requestedFeatures: [...XR_SESSION_OPTIONS.optionalFeatures],
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalExecution: false,
    });
  }

  async function destroy() {
    if (destroyed) return;
    destroyed = true;

    try {
      await session?.end?.();
    } catch {
      // Best effort session cleanup.
    }

    reset();
    controllerRigs.splice(0).forEach((controller) => controller._maTumboCleanup?.());
    toolbar?.remove?.();
  }

  emitStatus("ready", navigatorRoot?.xr?.requestSession
    ? "Same world · XR checked when you enter"
    : "Same world · XR unavailable in this browser");

  return Object.freeze({
    start,
    supports,
    reset,
    destroy,
    get active() {
      return Boolean(session);
    },
    get mode() {
      return activeMode;
    },
    get session() {
      return session;
    },
    getSnapshot,
  });
}

export default createImmersiveSession;
