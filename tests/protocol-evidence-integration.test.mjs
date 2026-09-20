import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Contracts + Pools exposes an explicit public protocol evidence route without joining TVL to scenarios", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(main, /fetchProtocolEvidence/);
  assert.match(main, /createProtocolEvidenceRail/);
  assert.match(main, /panel.*contracts|feature.*contracts/);
  assert.match(main, /live.*protocols/);
  assert.match(main, /refresh-protocol-evidence/);
  assert.match(main, /simulated liquidity|simulatedLiquidity/);
  assert.match(html, /protocol-evidence-rail|protocol-evidence-refresh/);
});
