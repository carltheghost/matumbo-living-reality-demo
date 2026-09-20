import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  CAMERA_INPUT_SOURCE,
  estimateMotion,
} from "../src/render/camera-input.js";

const ROOT = new URL("../", import.meta.url);

function frame(width, height, points = []) {
  const data = new Uint8ClampedArray(width * height * 4);
  points.forEach(([x, y, value]) => {
    const offset = (y * width + x) * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  });
  return data;
}

test("camera motion estimator is deterministic, local, and bounded", () => {
  const previous = frame(4, 3, [[0, 1, 255]]);
  const current = frame(4, 3, [[3, 1, 255]]);
  const first = estimateMotion(previous, current, 4, 3, 1);
  const second = estimateMotion(previous, current, 4, 3, 1);
  assert.deepEqual(second, first);
  assert.equal(first.simulation, true);
  assert.equal(first.localOnly, true);
  assert.equal(first.biometric, false);
  assert.equal(first.recording, false);
  assert.equal(first.externalNetwork, false);
  assert.ok(first.samples > 0);
  assert.ok(first.dx >= -1 && first.dx <= 1);
  assert.ok(first.dy >= -1 && first.dy <= 1);
  assert.ok(first.magnitude >= 0 && first.magnitude <= 1);
  assert.equal(Object.isFrozen(first), true);
});

test("camera motion estimator returns a safe zero vector for missing frames", () => {
  const motion = estimateMotion(null, null);
  assert.deepEqual({ dx: motion.dx, dy: motion.dy, magnitude: motion.magnitude, samples: motion.samples }, {
    dx: 0,
    dy: 0,
    magnitude: 0,
    samples: 0,
  });
  assert.equal(motion.localOnly, true);
  assert.equal(motion.biometric, false);
});

test("camera motion estimator preserves the direction of a translating feature", () => {
  const left = frame(8, 5, [[1, 2, 255]]);
  const right = frame(8, 5, [[6, 2, 255]]);
  const up = frame(8, 5, [[4, 1, 255]]);
  const down = frame(8, 5, [[4, 4, 255]]);

  const moveRight = estimateMotion(left, right, 8, 5, 1);
  const moveLeft = estimateMotion(right, left, 8, 5, 1);
  const moveDown = estimateMotion(up, down, 8, 5, 1);

  // The old absolute-difference centroid returned dx=0 for left→right and
  // right→left translations because the departure and arrival pixels
  // cancelled.  Direction is the contract that makes the camera control
  // visibly useful rather than merely reporting an active stream.
  assert.ok(moveRight.dx > 0.5, `expected rightward dx, got ${moveRight.dx}`);
  assert.ok(moveLeft.dx < -0.5, `expected leftward dx, got ${moveLeft.dx}`);
  assert.ok(moveDown.dy > 0.5, `expected downward dy, got ${moveDown.dy}`);
  assert.ok(moveRight.magnitude > 0.5);
  assert.equal(moveRight.localOnly, true);
  assert.equal(moveRight.biometric, false);
  assert.equal(moveRight.recording, false);
});

test("camera input is opt-in and has no persistence or remote execution path", async () => {
  const source = await readFile(new URL("src/render/camera-input.js", ROOT), "utf8");
  const main = await readFile(new URL("src/main.js", ROOT), "utf8");
  const html = await readFile(new URL("index.html", ROOT), "utf8");
  assert.match(source, new RegExp(CAMERA_INPUT_SOURCE));
  assert.match(source, /getUserMedia/);
  assert.match(source, /explicit|button|permission/i);
  assert.doesNotMatch(source, /face\s*(recognition|detection)|biometric\s*inference/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\s*\(|WebSocket|sendBeacon/i);
  for (const id of [
    "camera-input-panel",
    "camera-input-open",
    "camera-input-toggle",
    "camera-input-stop",
    "camera-input-status",
    "camera-input-video",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /Frames are not stored or sent/i);
  assert.match(html, /Mouse and trackpad orbit remain available/i);
  assert.match(html, /id="block-world-camera-open"[^>]*aria-controls="camera-input-panel"/i);
  assert.match(html, /id="block-world-camera-status"[^>]*data-camera-state="off"/i);
  assert.match(html, /CAMERA OFF · MOUSE \/ TRACKPAD READY/);
  assert.match(html, /min-height:44px/);
  assert.match(main, /syncBlockWorldCameraStatus/);
  assert.match(main, /blockWorldCameraOpenButton[\s\S]*cameraInput\.open\(\)/);
  assert.match(main, /cameraMotionSpherical\.theta-=cameraMotion\.dx/);
  assert.match(main, /cameraMotionSpherical\.phi=.*cameraMotion\.dy/);
  assert.match(main, /__TUMBO_CAMERA_NAVIGATION__/);
  assert.match(main, /panel[^\n]*=== ['"]camera['"][\s\S]*setBlockWorldPresentation\(true, \{ cubeFirstUi: true \}\)/);
  assert.doesNotMatch(main, /navigator\.share/);
});

test("camera panel makes viewpoint-only cube relationship and explicit reset visible", async () => {
  const main = await readFile(new URL("src/main.js", ROOT), "utf8");
  const html = await readFile(new URL("index.html", ROOT), "utf8");
  assert.match(html, /Camera Motion · Viewpoint Only/);
  assert.match(html, /never moves, opens, edits, or uploads a cube/i);
  assert.match(html, /id=["']camera-input-reset["'][^>]*>Reset camera view</i);
  assert.match(html, /id=["']camera-input-boundary["']/i);
  assert.match(html, /Only coarse frame differences steer the viewpoint/i);
  assert.match(main, /camera-input-reset[\s\S]{0,260}camera-reset[\s\S]{0,120}\.click\(\)/i);
  assert.match(main, /camera-reset[\s\S]{0,320}desiredTarget\.set\(0, 1, 0\)[\s\S]{0,220}cameraMotion=\{dx:0,dy:0,magnitude:0\}/i);
  assert.doesNotMatch(main, /camera-input-reset[\s\S]{0,500}(blockWorld|blocks)\?\.(?:move|open|inspect|grab|snapshot)/i);
});

test("camera adapter waits for explicit enable and releases tracks on disable", async () => {
  const { createCameraInput } = await import("../src/render/camera-input.js");
  class FakeElement {
    constructor() {
      this.hidden = true;
      this.readyState = 0;
      this.listeners = new Map();
      this.classList = { toggle() {} };
    }
    setAttribute() {}
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    focus() {}
    async play() {}
  }
  const ids = [
    "camera-input-panel",
    "camera-input-open",
    "camera-input-close",
    "camera-input-toggle",
    "camera-input-stop",
    "camera-input-status",
    "camera-input-indicator",
    "camera-input-samples",
    "camera-input-video",
  ];
  const nodes = new Map(ids.map((id) => [id, new FakeElement()]));
  const documentRoot = {
    getElementById(id) { return nodes.get(id) ?? null; },
    createElement(tag) {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              drawImage() {},
              getImageData() { return { data: new Uint8ClampedArray(48 * 36 * 4) }; },
            };
          },
        };
      }
      return new FakeElement();
    },
    addEventListener() {},
  };
  let permissionCalls = 0;
  let stopped = 0;
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
    mediaDevices: {
      async getUserMedia() {
        permissionCalls += 1;
        return { getTracks: () => [{ stop() { stopped += 1; } }] };
      },
    },
    },
  });
  try {
    const camera = createCameraInput({ documentRoot });
    assert.equal(permissionCalls, 0, "permission must not be requested during mount");
    assert.equal(camera.getSnapshot().lastMotion, null, "camera exposes no motion before a frame sample");
    const enabled = await camera.enable("test");
    assert.equal(permissionCalls, 1);
    assert.equal(enabled.active, true);
    assert.equal(enabled.lastMotion, null, "camera starts without a retained motion vector");
    const disabled = camera.disable("test");
    assert.equal(disabled.active, false);
    assert.equal(disabled.lastMotion, null, "disabling clears the latest motion vector");
    assert.equal(stopped, 1, "disable must release the stream track");
  } finally {
    Object.defineProperty(globalThis, "navigator", previousNavigatorDescriptor);
  }
});

test("closing the visible camera panel is a real opt-out that releases an active stream", async () => {
  const { createCameraInput } = await import("../src/render/camera-input.js");
  class FakeElement {
    constructor() {
      this.hidden = true;
      this.readyState = 0;
      this.listeners = new Map();
      this.classList = { toggle() {} };
    }
    setAttribute() {}
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    focus() {}
    async play() {}
  }
  const ids = [
    "camera-input-panel", "camera-input-open", "camera-input-close",
    "camera-input-toggle", "camera-input-stop", "camera-input-status",
    "camera-input-indicator", "camera-input-samples", "camera-input-video",
  ];
  const nodes = new Map(ids.map((id) => [id, new FakeElement()]));
  const documentRoot = {
    getElementById(id) { return nodes.get(id) ?? null; },
    createElement(tag) {
      if (tag === "canvas") return { width: 0, height: 0, getContext() { return null; } };
      return new FakeElement();
    },
    addEventListener() {},
  };
  let stopped = 0;
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { async getUserMedia() { return { getTracks: () => [{ stop() { stopped += 1; } }] }; } } },
  });
  try {
    const camera = createCameraInput({ documentRoot });
    camera.open();
    await camera.enable("test");
    assert.equal(camera.getSnapshot().active, true);
    camera.close();
    const snapshot = camera.getSnapshot();
    assert.equal(snapshot.opened, false);
    assert.equal(snapshot.active, false);
    assert.equal(snapshot.status, "off");
    assert.equal(stopped, 1, "closing must release the approved local stream");
  } finally {
    Object.defineProperty(globalThis, "navigator", previousNavigatorDescriptor);
  }
});
