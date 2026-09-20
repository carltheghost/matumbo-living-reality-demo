import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("distribution source contains no legacy round geometry and keeps local boundaries", async () => {
  const source = await readFile(new URL("../src/render/distribution-explorer.js", import.meta.url), "utf8");
  assert.match(source, /BoxGeometry/);
  assert.match(source, /distributionGeometry\s*=\s*"cube"/);
  assert.match(source, /distributionSelectionCue/);
  assert.doesNotMatch(source, /IcosahedronGeometry|TorusGeometry|OctahedronGeometry/);
  assert.doesNotMatch(source, /SphereGeometry|CircleGeometry|RingGeometry/);
  assert.match(source, /externalTransfer:\s*false/);
  assert.match(source, /executable:\s*false/);
  assert.doesNotMatch(source, /fetch\s*\(/i);
  assert.doesNotMatch(source, /WebSocket|localStorage|indexedDB/);
});
