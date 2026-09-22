import { inspectXrSession, XR_OPTIONAL_FEATURES } from "./xr-capabilities.js";
import { createXrSpatialUi } from "./xr-spatial-ui.js";

/** A single renderer/scene and the existing domain actions across desktop, VR and AR. */
export const IMMERSIVE_SESSION_SOURCE = "immersive-session";

export const XR_SESSION_OPTIONS = Object.freeze({
  optionalFeatures: Object.freeze([...XR_OPTIONAL_FEATURES]),
});

function safeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

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
  let sessionCapabilities = null;
  let handFactory = null;

  const ray = new THREE.Raycaster();
  const rotation = new THREE.Matrix4();
  const controllerRigs = [];
  const handRigs = [];

  const original = {
    background: scene.background,
    clearAlpha:
      typeof renderer.getClearAlpha === "function"
        ? renderer.getClearAlpha()
        : 1,
  };

  renderer.xr.enabled = true;

  const spatialUi = createXrSpatialUi({ documentRoot });

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
      handTracking: activeMode
        ? sessionCapabilities?.handTracking === true
          ? "granted"
          : "requested-if-supported"
        : "not-requested",
      enabledFeatures: sessionCapabilities?.enabledFeatures ?? [],
      environmentBlendMode: sessionCapabilities?.environmentBlendMode ?? null,
      detail: detail ?? null,
    });

    if (status) {
      status.textContent =
        detail ??
        (state.toUpperCase() +
          (activeMode
            ? " · " + (activeMode === "immersive-ar" ? "AR" : "VR")
            : ""));
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
    controllerRigs.push({ controller, geometry, material, line });

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

  function updateHandTrackingFlags() {
    const sources = Array.from(session?.inputSources ?? []);
    const hasHand = sources.some((input) => Boolean(input?.hand));
    controllerRigs.forEach(({ controller }) => {
      controller.userData.handTracking = hasHand;
    });
    return hasHand;
  }

  async function ensureHandModels() {
    if (!session || !renderer.xr?.getHand) return false;
    try {
      if (!handFactory) {
        const module = await import(
          "../../vendor/three-r179.1/examples/jsm/webxr/XRHandModelFactory.js"
        );
        handFactory = new module.XRHandModelFactory();
      }

      if (!handRigs.length) {
        for (let index = 0; index < 2; index += 1) {
          const hand = renderer.xr.getHand(index);
          const model = handFactory.createHandModel(hand, "spheres");
          hand.add(model);
          scene.add(hand);
          handRigs.push({ hand, model });
        }
      }

      updateHandTrackingFlags();
      return true;
    } catch {
      // XR hand models are optional presentation; input still works through
      // the existing controller and session input-source events.
      return false;
    }
  }

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
      emitStatus(
        "unsupported",
        (mode === "immersive-ar" ? "AR" : "VR") +
          " is not supported on this browser/device",
      );
      return false;
    }

    starting = true;
    activeMode = mode;
    setButtonState(false);
    spatialUi.mount();
    spatialUi.show();
    emitStatus(
      "starting",
      "Starting " + (mode === "immersive-ar" ? "AR" : "VR") + " session…",
    );

    try {
      const requestOptions = {
        optionalFeatures: [...XR_SESSION_OPTIONS.optionalFeatures],
      };

      if (documentRoot?.body) {
        requestOptions.domOverlay = { root: documentRoot.body };
      }

      const nextSession = await navigatorRoot.xr.requestSession(
        mode,
        requestOptions,
      );
      session = nextSession;

      if (mode === "immersive-ar") {
        scene.background = null;
        renderer.setClearAlpha(0);
      }

      setReferenceSpace();
      await renderer.xr.setSession(nextSession);

      sessionCapabilities = inspectXrSession(
        nextSession,
        XR_SESSION_OPTIONS.optionalFeatures,
      );

      nextSession.addEventListener("inputsourceschange", updateHandTrackingFlags);
      nextSession.addEventListener("end", reset, { once: true });

      await ensureHandModels();

      starting = false;
      setButtonState(true);
      emitStatus(
        "active",
        (mode === "immersive-ar" ? "AR" : "VR") +
          " · point + pinch / trigger · swipe tabs · AIR KB",
      );
      return true;
    } catch (error) {
      try {
        await session?.end?.();
      } catch {
        // Keep fallback deterministic when XR rejects startup.
      }
      reset();
      const name = safeText(error?.name, "unavailable");
      emitStatus("error", "XR not started: " + name);
      return false;
    }
  }

  function reset() {
    if (session) {
      try {
        session.removeEventListener("inputsourceschange", updateHandTrackingFlags);
      } catch {
        // Ignore listener cleanup failures.
      }
    }

    session = null;
    activeMode = null;
    starting = false;
    sessionCapabilities = null;
    scene.background = original.background;
    renderer.setClearAlpha(original.clearAlpha);
    spatialUi.hide();
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
      handModelCount: handRigs.length,
      requestedFeatures: [...XR_SESSION_OPTIONS.optionalFeatures],
      sessionCapabilities,
      environmentBlendMode: sessionCapabilities?.environmentBlendMode ?? null,
      enabledFeatures: sessionCapabilities?.enabledFeatures ?? [],
      handTracking: sessionCapabilities?.handTracking ?? false,
      domOverlay: sessionCapabilities?.domOverlay ?? null,
      spatialUi: spatialUi.getSnapshot(),
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
    controllerRigs.splice(0).forEach(({ controller }) => controller._maTumboCleanup?.());

    handRigs.splice(0).forEach(({ hand, model }) => {
      hand.remove?.(model);
      hand.parent?.remove(hand);
    });

    spatialUi.destroy();
    toolbar?.remove?.();
  }

  emitStatus("ready", "Same world · XR ready");

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
