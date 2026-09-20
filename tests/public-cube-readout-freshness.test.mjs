import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

test("public evidence cube readouts retain retrieval provenance and explicit refresh ownership", async () => {
  const main = await readFile(new URL("src/main.js", ROOT), "utf8");
  const worldStart = main.indexOf("function showWorldEvidenceReadout");
  const sportsStart = main.indexOf("function showSportsEvidenceReadout");
  const sportsEnd = main.indexOf("// A portal destination", sportsStart);
  assert.ok(worldStart >= 0 && sportsStart > worldStart && sportsEnd > sportsStart);

  const worldReadout = main.slice(worldStart, sportsStart);
  const sportsReadout = main.slice(sportsStart, sportsEnd);
  assert.match(worldReadout, /retrieved \$\{record\.retrievedAt \?\? 'unavailable'\}/);
  assert.match(worldReadout, /refresh explicitly there for current provider data/);
  assert.match(sportsReadout, /retrieved \$\{record\.retrievedAt \?\? 'unavailable'\}/);
  assert.match(sportsReadout, /refresh explicitly there for current provider data/);
  assert.match(sportsReadout, /data grade \$\{grade\} \(completeness only\)/);
  assert.doesNotMatch(worldReadout, /fetch\s*\(/);
  assert.doesNotMatch(sportsReadout, /fetch\s*\(/);
});
