import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MUSE_AGENT_BOUNDARY,
  MUSE_AGENT_CONSOLE_SOURCE,
  MUSE_AGENT_MAX_DESIGNS,
  MUSE_AGENT_MAX_DISPLAY_NAME,
  MUSE_AGENT_MAX_PROFILES,
  MUSE_AGENT_PROVIDERS,
  MUSE_AGENT_SCHEMA_VERSION,
  MUSE_AGENT_SOURCE,
  MUSE_AGENT_STORAGE_KEY,
  createMuseAgent,
  createMuseAgentContribution,
  designFromPrompt,
  hashMuseAgentSeed,
} from "../src/domains/muse-agent.js";

const FIXED_NOW = "2026-09-18T12:00:00.000Z";

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

function agent(options = {}) {
  return createMuseAgent({ storage: fakeStorage(), seed: "test-seed", now: () => FIXED_NOW, ...options });
}

test("a guest profile exists on first run and designing works immediately", () => {
  const muse = agent();
  const active = muse.getActiveProfile();
  assert.ok(active);
  assert.equal(active.displayName, "Guest");
  assert.equal(active.localOnly, true);
  assert.equal(active.verified, false);
  const design = muse.generate({ kind: "avatar", prompt: "golden hologram champion" });
  assert.equal(design.kind, "avatar");
  assert.ok(design.title.length > 0);
});

test("profiles are local display names: bounded, provider-tagged, no credentials", () => {
  const muse = agent();
  const profile = muse.addProfile({ displayName: "  Tumbo  ", provider: "muse" });
  assert.equal(profile.displayName, "Tumbo");
  assert.equal(profile.provider, "muse");
  assert.equal(profile.providerLabel, "Muse");
  assert.equal(profile.localOnly, true);
  assert.equal(profile.verified, false);
  assert.ok(!("password" in profile) && !("token" in profile));
  const other = muse.addProfile({ displayName: "Alt", provider: "bogus-provider" });
  assert.equal(other.provider, "other");
  assert.equal(other.providerLabel, "Other account");
  assert.throws(() => muse.addProfile({ displayName: "   " }), TypeError);
  const long = muse.addProfile({ displayName: "x".repeat(200) });
  assert.ok(long.displayName.length <= MUSE_AGENT_MAX_DISPLAY_NAME);
  for (let i = 0; i < MUSE_AGENT_MAX_PROFILES - 4; i += 1) muse.addProfile({ displayName: `extra-${i}` });
  assert.throws(() => muse.addProfile({ displayName: "overflow" }), TypeError);
  assert.deepEqual(MUSE_AGENT_PROVIDERS.map((entry) => entry.id).sort(), ["muse", "other"]);
});

test("select, rename, and remove profiles; designs follow their profile", () => {
  const muse = agent();
  const first = muse.addProfile({ displayName: "First" });
  const second = muse.addProfile({ displayName: "Second", provider: "other" });
  muse.selectProfile(second.id);
  assert.equal(muse.getActiveProfile().id, second.id);
  assert.throws(() => muse.selectProfile("muse-profile:deadbeef"), TypeError);
  const renamed = muse.renameProfile(second.id, "Renamed");
  assert.equal(renamed.displayName, "Renamed");
  muse.selectProfile(second.id);
  const design = muse.save(muse.generate({ kind: "image", prompt: "violet nebula portrait" }));
  assert.equal(design.profileId, second.id);
  muse.removeProfile(second.id);
  assert.equal(muse.getDesign(design.id), null);
  assert.notEqual(muse.getActiveProfile().id, second.id);
  assert.equal(muse.listProfiles().some((entry) => entry.id === first.id), true);
  assert.throws(() => muse.removeProfile("muse-profile:deadbeef"), TypeError);
});

test("designFromPrompt is deterministic and keyword-driven", () => {
  const first = designFromPrompt({ kind: "avatar", prompt: "royal crimson champion" });
  const second = designFromPrompt({ kind: "avatar", prompt: "royal crimson champion" });
  assert.deepEqual(first, second);
  assert.equal(first.palette.id, "oxblood-royal");
  assert.equal(first.style.id, "regal");
  assert.equal(first.mood.id, "triumphant");
  assert.equal(first.outfitId, "oxblood");
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.palette));
  const different = designFromPrompt({ kind: "avatar", prompt: "calm ocean minimal" });
  assert.notDeepEqual(first.palette.id, different.palette.id);
  assert.equal(different.style.id, "minimal");
  assert.throws(() => designFromPrompt({ kind: "avatar", prompt: "   " }), TypeError);
});

test("image designs produce copy-ready briefs with aspect hints", () => {
  const wide = designFromPrompt({ kind: "image", prompt: "wide cinematic desert caravan" });
  assert.equal(wide.kind, "image");
  assert.equal(wide.aspect, "16:9");
  assert.ok(wide.brief.includes("no image service is called"));
  assert.ok(wide.brief.length > 40);
  const square = designFromPrompt({ kind: "image", prompt: "square minimal portrait" });
  assert.equal(square.aspect, "1:1");
  const portrait = designFromPrompt({ kind: "image", prompt: "violet nebula" });
  assert.equal(portrait.aspect, "4:5");
  assert.equal(portrait.palette.id, "violet-lens");
});

test("gallery saves, lists, applies, and bounds designs", () => {
  const muse = agent();
  const saved = muse.save(muse.generate({ kind: "avatar", prompt: "golden champion" }));
  assert.equal(muse.listDesigns().length, 1);
  assert.ok(Object.isFrozen(muse.listDesigns()));
  const applied = muse.markApplied(saved.id);
  assert.equal(applied.applied, true);
  assert.ok(applied.appliedAt);
  assert.throws(() => muse.markApplied("muse-design:deadbeef:000"), TypeError);
  muse.removeDesign(saved.id);
  assert.equal(muse.listDesigns().length, 0);
  assert.throws(() => muse.removeDesign("muse-design:deadbeef:000"), TypeError);
  assert.throws(() => muse.save(null), TypeError);
  for (let i = 0; i < MUSE_AGENT_MAX_DESIGNS; i += 1) {
    muse.save(muse.generate({ kind: "image", prompt: `study ${i}` }));
  }
  assert.throws(() => muse.save(muse.generate({ kind: "image", prompt: "overflow study" })), TypeError);
});

test("profiles and designs persist to local storage and reload", () => {
  const storage = fakeStorage();
  const first = createMuseAgent({ storage, seed: "persist-seed", now: () => FIXED_NOW });
  const profile = first.addProfile({ displayName: "Persistent", provider: "other" });
  first.selectProfile(profile.id);
  const saved = first.save(first.generate({ kind: "avatar", prompt: "emerald voyager" }));
  assert.ok(storage.getItem(MUSE_AGENT_STORAGE_KEY)?.includes("Persistent"));
  const second = createMuseAgent({ storage, seed: "persist-seed", now: () => FIXED_NOW });
  assert.equal(second.getActiveProfile().displayName, "Persistent");
  assert.equal(second.getDesign(saved.id)?.title, saved.title);
  assert.equal(second.listProfiles().length, first.listProfiles().length);
});

test("corrupt storage never breaks the agent", () => {
  const storage = fakeStorage();
  storage.setItem(MUSE_AGENT_STORAGE_KEY, "{not-json");
  const muse = createMuseAgent({ storage, seed: "corrupt-seed", now: () => FIXED_NOW });
  assert.ok(muse.getActiveProfile());
  assert.equal(muse.listDesigns().length, 0);
});

test("snapshot and contribution carry the boundary and no authority flags", () => {
  const muse = agent();
  muse.save(muse.generate({ kind: "avatar", prompt: "golden champion" }));
  const snapshot = muse.getSnapshot();
  assert.equal(snapshot.schemaVersion, MUSE_AGENT_SCHEMA_VERSION);
  assert.equal(snapshot.source, MUSE_AGENT_SOURCE);
  assert.equal(snapshot.simulation, true);
  assert.equal(snapshot.localOnly, true);
  assert.equal(snapshot.deterministic, true);
  assert.equal(snapshot.externalNetwork, false);
  assert.equal(snapshot.externalAuth, false);
  assert.equal(snapshot.identityAuthority, false);
  assert.equal(snapshot.aiService, false);
  assert.equal(snapshot.boundary, MUSE_AGENT_BOUNDARY);
  assert.ok(Object.isFrozen(snapshot));
  const contribution = muse.createContribution();
  assert.deepEqual(contribution.capabilities, [
    { id: "muse-agent.design", mode: "local-deterministic", authority: "none", executable: false },
    { id: "muse-agent.profile", mode: "local-display-name", authority: "none", executable: false },
  ]);
  assert.ok(Object.isFrozen(contribution));
  const standalone = createMuseAgentContribution({ seed: "contrib-seed" });
  assert.equal(standalone.source, MUSE_AGENT_SOURCE);
});

test("hashMuseAgentSeed is deterministic", () => {
  assert.equal(hashMuseAgentSeed("abc"), hashMuseAgentSeed("abc"));
  assert.notEqual(hashMuseAgentSeed("abc"), hashMuseAgentSeed("abd"));
  assert.match(hashMuseAgentSeed("abc"), /^[0-9a-f]{8}$/);
});

test("console source constant matches the feature wiring contract", () => {
  assert.equal(MUSE_AGENT_CONSOLE_SOURCE, "muse-agent-console");
});

test("null clock uses the wall clock instead of the 1970 epoch", () => {
  const muse = createMuseAgent({ storage: fakeStorage(), seed: "epoch-check", now: null });
  const design = muse.save(muse.generate({ kind: "image", prompt: "epoch check" }));
  assert.ok(!design.createdAt.startsWith("1970-"));
});
