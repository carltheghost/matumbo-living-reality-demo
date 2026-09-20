import test from "node:test";
import assert from "node:assert/strict";
import {
  detectXrCapabilities,
  inspectXrSession,
  summarizeXrCapabilities,
  XR_OPTIONAL_FEATURES,
} from "../src/render/xr-capabilities.js";

test("capability discovery probes VR and AR without starting a session", async () => {
  let requestSessionCalls = 0;
  const navigatorRoot = {
    xr: {
      requestSession() {
        requestSessionCalls += 1;
      },
      async isSessionSupported(mode) {
        return mode === "immersive-vr" || mode === "immersive-ar";
      },
    },
  };

  const result = await detectXrCapabilities(
    navigatorRoot,
    { isSecureContext: true },
  );

  assert.equal(result.webxr, true);
  assert.equal(result.secureContext, true);
  assert.deepEqual(result.availableModes, ["immersive-vr", "immersive-ar"]);
  assert.equal(result.modes["immersive-vr"].supported, true);
  assert.equal(result.modes["immersive-ar"].supported, true);
  assert.deepEqual(result.requestedOptionalFeatures, XR_OPTIONAL_FEATURES);
  assert.equal(result.permissionRequested, false);
  assert.equal(result.sessionStarted, false);
  assert.equal(result.localOnly, true);
  assert.equal(result.rawSensorDataTransferred, false);
  assert.equal(requestSessionCalls, 0);
  assert.equal(summarizeXrCapabilities(result), "VR + AR available");
});

test("unsupported XR mode is represented explicitly", async () => {
  const result = await detectXrCapabilities(
    {
      xr: {
        requestSession() {},
        async isSessionSupported(mode) {
          return mode === "immersive-vr";
        },
      },
    },
    { isSecureContext: true },
  );

  assert.equal(result.modes["immersive-vr"].supported, true);
  assert.equal(result.modes["immersive-ar"].supported, false);
  assert.deepEqual(result.availableModes, ["immersive-vr"]);
  assert.equal(summarizeXrCapabilities(result), "VR available");
});

test("missing WebXR is a clean capability result", async () => {
  const result = await detectXrCapabilities(
    {},
    { isSecureContext: true },
  );

  assert.equal(result.webxr, false);
  assert.deepEqual(result.availableModes, []);
  assert.equal(result.modes["immersive-vr"].reason, "webxr-unavailable");
  assert.equal(result.modes["immersive-ar"].reason, "webxr-unavailable");
  assert.equal(summarizeXrCapabilities(result), "WebXR unavailable");
});

test("session inspection reports granted features and environment blend mode", () => {
  const result = inspectXrSession({
    sessionMode: "immersive-ar",
    environmentBlendMode: "alpha-blend",
    enabledFeatures: [
      "local-floor",
      "hand-tracking",
      "hit-test",
    ],
    domOverlayState: {
      type: "screen",
    },
  });

  assert.equal(result.sessionStarted, true);
  assert.equal(result.mode, "immersive-ar");
  assert.equal(result.environmentBlendMode, "alpha-blend");
  assert.deepEqual(result.enabledFeatures, [
    "local-floor",
    "hand-tracking",
    "hit-test",
  ]);
  assert.equal(result.domOverlay.type, "screen");
  assert.equal(result.handTracking, true);
  assert.equal(result.hitTest, true);
  assert.equal(result.anchors, false);
  assert.equal(result.depthSensing, false);
  assert.equal(result.rawSensorDataTransferred, false);
  assert.equal(result.externalNetwork, false);
});

test("session inspection does not depend on optional feature support", () => {
  const result = inspectXrSession(
    {
      enabledFeatures: ["local-floor"],
    },
    ["local-floor", "hand-tracking", "depth-sensing"],
  );

  assert.deepEqual(result.requestedFeatures, [
    "local-floor",
    "hand-tracking",
    "depth-sensing",
  ]);
  assert.equal(result.handTracking, false);
  assert.equal(result.environmentBlendMode, null);
});
