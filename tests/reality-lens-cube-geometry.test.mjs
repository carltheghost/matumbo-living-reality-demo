import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Reality Lens semantic nodes keep their interactive sigils block-shaped", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const start = main.indexOf("function makeSemanticNode(");
  const end = main.indexOf("function attachSemanticObjects(", start);
  assert.ok(start >= 0 && end > start, "expected the Reality Lens semantic-node builder");
  const semanticNodeBuilder = main.slice(start, end);

  assert.match(semanticNodeBuilder, /const sigilGeom=new THREE\.BoxGeometry\(\.\.\.sigilSize\)/);
  assert.match(semanticNodeBuilder, /raycastTargets\.push\(sigil\);semanticTargets\.push\(sigil\)/);
  assert.doesNotMatch(semanticNodeBuilder, /(?:CylinderGeometry|OctahedronGeometry|TorusGeometry|SphereGeometry|CircleGeometry)/);
});
