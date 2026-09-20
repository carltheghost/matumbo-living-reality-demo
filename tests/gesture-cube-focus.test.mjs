import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("gesture cube focus is an explicit host seam over the existing local raycast", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(source, /applyGestureCubeFocus/);
  assert.match(source, /host-gaze.*native-hand/);
  assert.match(source, /gesture-pinch/);
  assert.match(source, /gesture-\$\{gestureKind\}/);
  assert.match(source, /\['pinch', 'open', 'inspect'\]/);
  assert.match(source, /native-hand.*\['pinch', 'open', 'inspect'\]/s);
  assert.match(source, /__TUMBO_GESTURE_CUBE_FOCUS__/);
  assert.match(source, /cameraDrivenBlockEdits:[^,}]*false/);
  assert.match(source, /no raw frames.*landmarks.*identity.*recording.*network.*storage/i);
  assert.match(source, /['\"]grab['\"],\s*['\"]hold['\"],\s*['\"]place['\"],\s*['\"]release['\"]/i);
});

test("gesture input remains capability-aware and does not expose raw sensor payloads", async () => {
  const source = await readFile(new URL("../src/render/gesture-input.js", import.meta.url), "utf8");
  assert.match(source, /__TUMBO_GAZE_TRACKER__/);
  assert.match(source, /__TUMBO_NATIVE_HAND_TRACKER__/);
  assert.match(source, /sanitizeNativeHandSample/);
  assert.match(source, /landmarks:[^,}]*false/);
  assert.match(source, /recording:[^,}]*false/);
  assert.match(source, /externalNetwork:[^,}]*false/);
  assert.match(source, /persistence:[^,}]*false/);
  assert.doesNotMatch(source, /cameraDrivenBlockEdits:[^,}]*true/);
});
