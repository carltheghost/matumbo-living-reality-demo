import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("gesture cube actions are deliberate, host-scoped, and non-editing", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const gesture = await readFile(new URL("../src/render/gesture-input.js", import.meta.url), "utf8");
  assert.match(main, /inputSource === 'native-hand'/);
  assert.match(main, /\['pinch', 'open', 'inspect'\]/);
  assert.match(main, /blockWorld\.openBlock\(true\)/);
  assert.match(main, /blockWorld\.inspectBlock\(\)/);
  assert.match(main, /lastGestureActionAt/);
  assert.match(main, /No raw frames.*arbitrary movement.*camera-driven edits/i);
  assert.match(gesture, /NATIVE_HAND_GESTURES\s*=\s*new Set\(\["pinch",\s*"point",\s*"open",\s*"inspect",\s*"grab",\s*"hold",\s*"place",\s*"release"\]\)/);
  assert.doesNotMatch(main, /applyGestureCubeFocus[\s\S]{0,2200}blockWorld\.(moveSelected|grabSelected|holdSelected|placeHeld|edit)\(/);
});
