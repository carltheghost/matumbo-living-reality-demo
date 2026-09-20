import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("public status route quarantines the compatibility fixture", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/render/live-gateway.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(main, /includeLegacyFixture:\s*false/);
  assert.match(main, /getElementById\('live-gateway-console'\)\?\.classList\.add\('public-status-only'\)/);
  assert.match(main, /get\('panel'\) === 'live-status'/);
  assert.match(main, /liveStatusRouteQuery\.get\(\'live\'\).*all/);
  assert.match(renderer, /legacyFixtureEl\.hidden = true/);
  assert.match(renderer, /legacyFixtureEl\.setAttribute\?\.\("aria-hidden", "true"\)/);
  assert.match(renderer, /ROWS STAY PROVIDER-RETURNED/);
  assert.match(html, /id=["']live-gateway-public-status["']/);
  assert.match(html, /id=["']live-gateway-legacy-fixture["']/);
  assert.match(html, /Legacy mock observations · internal only/);
});
