import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import { PROFILE_ENTITIES } from "../src/domains/profile.js";

test("fictional Person Ω fixtures carry unique consented visual genomes", () => {
  assert.equal(PROFILE_ENTITIES.length, 4);

  const seeds = new Set();
  const palettes = new Set();
  for (const entity of PROFILE_ENTITIES) {
    assert.equal(entity.type, "person-profile");
    assert.equal(entity.simulation, true);
    assert.equal(entity.fictional, true);
    assert.equal(entity.consent.displayName.granted, true);
    assert.equal(entity.consent.externalIdentityCollection.granted, false);
    assert.equal(entity.presentation.kind, "person-organism");
    assert.equal(entity.presentation.position.length, 3);
    assert.ok(entity.presentation.position.every(Number.isFinite));
    assert.ok(entity.presentation.semanticCells.length >= 3);

    const { visualGenome } = entity.presentation;
    assert.equal(typeof visualGenome.identitySeed, "string");
    assert.equal(typeof visualGenome.shapeFamily, "string");
    assert.equal(typeof visualGenome.motionPattern, "string");
    seeds.add(visualGenome.identitySeed);
    palettes.add(`${visualGenome.primary}|${visualGenome.accent}|${visualGenome.aura}`);
  }

  assert.equal(seeds.size, PROFILE_ENTITIES.length);
  assert.equal(palettes.size, PROFILE_ENTITIES.length);
});

test("the deterministic Living Reality projection carries all Person Ω organisms", () => {
  const projection = createLivingRealityProjection();
  const organisms = projection.world.entities.filter(
    (entity) => entity.presentation?.kind === "person-organism",
  );

  assert.equal(organisms.length, PROFILE_ENTITIES.length);
  assert.equal(organisms.every((entity) => entity.simulation === true), true);
  assert.equal(organisms.every((entity) => entity.authoritative !== true), true);
  assert.equal(organisms.every((entity) => entity.executable !== true), true);
});

test("Reality Lens Ω exposes semantic scales through local projection intents", () => {
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const personRenderer = readFileSync(
    new URL("../src/render/person-organisms.js", import.meta.url),
    "utf8",
  );
  const combined = `${index}\n${renderer}\n${personRenderer}`;

  assert.match(index, /Reality Lens Ω/);
  assert.match(index, /data-lens-mode="world"/);
  assert.match(index, /data-lens-mode="population"/);
  assert.match(index, /data-lens-mode="detail"/);
  assert.match(renderer, /projection\.reality-lens/);
  assert.match(renderer, /getPersonSnapshot/);
  assert.match(renderer, /source: 'person-organisms'/);
  assert.match(renderer, /"reality-lens": \{/);
  assert.match(personRenderer, /simulation envelope/);
  assert.doesNotMatch(combined, /world eye/i);
});
