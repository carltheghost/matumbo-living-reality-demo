import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

test("public contract-feed reads are reachable from visible user actions only", () => {
  assert.match(source, /onScanRequested:\s*\(\)\s*=>\s*runUserRequestedContractScan\(\)/);
  assert.match(source, /onRefreshEvidence:[\s\S]{0,220}?await runUserRequestedContractScan\(\)/);
  assert.match(source, /function runUserRequestedContractScan\(\)[\s\S]{0,220}?contractFlow\.scanAndQueue\(\)/);

  assert.doesNotMatch(source, /runAutomaticContractScan|AUTO_CONTRACT_SCAN/);
  assert.doesNotMatch(source, /void runUserRequestedContractScan\(\)/);
  assert.doesNotMatch(
    source,
    /addEventListener\(["'](?:online|pageshow|visibilitychange)["'][\s\S]{0,260}?runUserRequestedContractScan\(/,
  );
  assert.match(source, /if\s*\(requestedContractScanInFlight\)\s*return requestedContractScanInFlight/);
});
