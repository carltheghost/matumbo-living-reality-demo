import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WARDROBE_ATELIER_BOUNDARY,
  WARDROBE_ATELIER_CONSOLE_SOURCE,
  WARDROBE_ATELIER_SCHEMA_VERSION,
  WARDROBE_ATELIER_SOURCE,
  WARDROBE_ATELIER_STARTER_OUTFITS,
  WARDROBE_EQUIPPED,
  WARDROBE_ERROR_IMMUTABLE,
  WARDROBE_ERROR_NOT_FOUND,
  createWardrobeAtelier,
  createWardrobeAtelierContribution,
  hashWardrobeAtelierSeed,
} from "../src/domains/wardrobe-atelier.js";
import { createWardrobeAtelierConsole, WARDROBE_STORAGE_KEY } from "../src/render/wardrobe-atelier.js";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";

const FIXED_NOW = "2026-09-18T12:00:00.000Z";

function atelier() {
  return createWardrobeAtelier({ seed: "test-seed", now: () => FIXED_NOW });
}

function starterId(studio, key) {
  return studio.listOutfits().find((outfit) => outfit.key === key).id;
}

test("starter set is seeded, deterministic, and mirrors the studio wardrobe", () => {
  const first = atelier().listOutfits().map((outfit) => outfit.id);
  const second = atelier().listOutfits().map((outfit) => outfit.id);
  assert.deepEqual(first, second);
  assert.equal(first.length, WARDROBE_ATELIER_STARTER_OUTFITS.length);
  assert.ok(first.every((id) => /^wdr:[0-9a-f]{8}$/.test(id)));
  const other = createWardrobeAtelier({ seed: "different-seed", now: () => FIXED_NOW }).listOutfits();
  assert.notDeepEqual(other.map((outfit) => outfit.id), first);
  const starters = atelier().listOutfits();
  assert.ok(starters.some((outfit) => outfit.studioOutfitId === "obsidian"));
  assert.ok(starters.every((outfit) => outfit.origin === "starter"));
  assert.ok(atelier().getEquipped(), "a starter look is equipped on first open");
});

test("created outfits are frozen fictional records with no authority flags", () => {
  const studio = atelier();
  const outfit = studio.createOutfit({
    name: "  Nebula Coat  ",
    palette: "#0b1026 / #8ab4ff",
    motif: "evening",
    description: "A rehearsal look.",
    pieces: ["coat", "trousers"],
  });
  assert.equal(outfit.name, "Nebula Coat");
  assert.equal(outfit.motif, "evening");
  assert.deepEqual(outfit.pieces, ["coat", "trousers"]);
  assert.equal(outfit.simulation, true);
  assert.equal(outfit.purchasable, false);
  assert.equal(outfit.transferable, false);
  assert.equal(outfit.valuable, false);
  assert.equal(outfit.studioOutfitId, null);
  assert.equal(outfit.origin, "custom");
  assert.ok(Object.isFrozen(outfit));
});

test("create validates names and bounds every field", () => {
  const studio = atelier();
  assert.throws(() => studio.createOutfit({ name: "   " }), TypeError);
  assert.throws(() => studio.createOutfit({ name: "x", pieces: "nope" }), TypeError);
  const long = studio.createOutfit({ name: "n".repeat(200), description: "d".repeat(900), palette: "p".repeat(400) });
  assert.ok(long.name.length <= 48);
  assert.ok(long.description.length <= 280);
  assert.ok(long.palette.length <= 96);
  const many = studio.createOutfit({ name: "many", pieces: Array.from({ length: 20 }, (_, i) => `piece-${i}`) });
  assert.equal(many.pieces.length, 8);
});

test("equip returns the outfit plus a person-studio-consumable event", () => {
  const studio = atelier();
  const target = studio.listOutfits().find((outfit) => outfit.studioOutfitId === "cobalt");
  const { outfit, event } = studio.equipOutfit(target.id);
  assert.equal(outfit.id, target.id);
  assert.equal(outfit.equipped, true);
  assert.equal(studio.getEquipped().id, target.id);
  assert.equal(event.type, WARDROBE_EQUIPPED);
  assert.equal(event.outfitId, target.id);
  assert.equal(event.studioOutfitId, "cobalt");
  assert.ok(event.previousOutfitId, "previousOutfitId is carried for consumers");
  assert.ok(event.timestamp, "timestamp is carried");
  assert.ok(Number.isInteger(event.seq), "monotonic sequence number is carried");
  assert.equal(event.simulation, true);
  assert.equal(event.localOnly, true);
  assert.throws(
    () => studio.equipOutfit("wdr:deadbeef"),
    (error) => error instanceof TypeError && error.code === WARDROBE_ERROR_NOT_FOUND,
    "unknown ids fail deterministically with OUTFIT_NOT_FOUND",
  );
});

test("duplicate names are allowed; IDs are the identity", () => {
  const studio = atelier();
  const first = studio.createOutfit({ name: "Midnight" });
  const second = studio.createOutfit({ name: "Midnight" });
  assert.notEqual(first.id, second.id);
  assert.equal(first.name, second.name);
  assert.equal(studio.listOutfits().filter((outfit) => outfit.name === "Midnight").length, 2);
});

test("equip is component-scoped: only the two touched records change", () => {
  const studio = atelier();
  const before = new Map(studio.listOutfits().map((outfit) => [outfit.id, JSON.stringify(outfit)]));
  const target = studio.listOutfits().find((outfit) => outfit.studioOutfitId === "ivory");
  const previousId = studio.getEquipped().id;
  studio.equipOutfit(target.id);
  const after = new Map(studio.listOutfits().map((outfit) => [outfit.id, JSON.stringify(outfit)]));
  for (const [id, json] of before) {
    if (id !== target.id && id !== previousId) {
      assert.equal(after.get(id), json, `untouched outfit ${id} must be byte-identical`);
    }
  }
  assert.equal(studio.getEquipped().id, target.id);
});

test("rapid equips are ordered; last confirmed wins", () => {
  const studio = atelier();
  const first = studio.listOutfits().find((outfit) => outfit.studioOutfitId === "cobalt");
  const second = studio.listOutfits().find((outfit) => outfit.studioOutfitId === "oxblood");
  const one = studio.equipOutfit(first.id);
  const two = studio.equipOutfit(second.id);
  assert.ok(two.event.seq > one.event.seq, "sequence numbers increase");
  assert.equal(two.event.previousOutfitId, first.id);
  assert.equal(studio.getEquipped().id, second.id, "last confirmed wins");
});

test("invalid outfit data is rejected or normalized, never stored raw", () => {
  const studio = atelier();
  const outfit = studio.createOutfit({
    name: "Junk Test",
    palette: "banana rainbow",
    pieces: ["hat", null, 42, "  boots  ", { nope: true }],
  });
  assert.deepEqual(outfit.pieces, ["hat", "boots"], "non-string pieces are dropped, never coerced");
  assert.equal(outfit.palette, "unspecified", "palettes without hex colors normalize away");
  const hex = studio.createOutfit({ name: "Hex", palette: "#0b1026 / #8ab4ff" });
  assert.equal(hex.palette, "#0b1026 / #8ab4ff");
  assert.throws(() => studio.createOutfit({ name: "bad", pieces: "nope" }), TypeError);
});

test("delete rejects unknown ids deterministically", () => {
  const studio = atelier();
  assert.throws(
    () => studio.deleteOutfit("wdr:deadbeef"),
    (error) => error instanceof TypeError && error.code === WARDROBE_ERROR_NOT_FOUND,
  );
});

test("delete removes a non-equipped custom outfit without touching the equipped look", () => {
  const studio = atelier();
  const custom = studio.createOutfit({ name: "Temporary" });
  const equippedBefore = studio.getEquipped().id;
  const result = studio.deleteOutfit(custom.id);
  assert.equal(result.deleted.id, custom.id);
  assert.equal(result.event, null, "no equip event when the equipped look is untouched");
  assert.equal(studio.getEquipped().id, equippedBefore);
  assert.equal(studio.getOutfit(custom.id), null);
  assert.throws(() => studio.equipOutfit(custom.id),
    (error) => error.code === WARDROBE_ERROR_NOT_FOUND,
    "equip after delete fails deterministically");
});

test("deleting the equipped outfit auto-transitions to the default starter", () => {
  const studio = atelier();
  const custom = studio.createOutfit({ name: "Doomed" });
  studio.equipOutfit(custom.id);
  const fallbackId = starterId(studio, "obsidian");
  const result = studio.deleteOutfit(custom.id);
  assert.equal(result.outfit.id, fallbackId, "default starter is equipped instead");
  assert.equal(result.event.type, WARDROBE_EQUIPPED);
  assert.equal(result.event.previousOutfitId, custom.id);
  assert.equal(result.event.reason, "delete-fallback");
  assert.equal(studio.getEquipped().id, fallbackId);
  assert.ok(studio.verifyIntegrity().ok, "no dangling equippedId after delete");
});

test("starter outfits are immutable: delete and mutation are refused", () => {
  const studio = atelier();
  const obsidian = starterId(studio, "obsidian");
  assert.throws(
    () => studio.deleteOutfit(obsidian),
    (error) => error instanceof TypeError && error.code === WARDROBE_ERROR_IMMUTABLE,
  );
  assert.ok(studio.getOutfit(obsidian), "the starter still exists");
});

test("customize clones the source into a new custom outfit; the source is untouched", () => {
  const studio = atelier();
  const obsidian = starterId(studio, "obsidian");
  const before = JSON.stringify(studio.getOutfit(obsidian));
  const derived = studio.customizeOutfit(obsidian);
  assert.notEqual(derived.id, obsidian);
  assert.equal(derived.name, "Copy of Obsidian");
  assert.equal(derived.origin, "custom");
  assert.equal(derived.studioOutfitId, null, "derived looks stay in the atelier");
  assert.deepEqual(derived.pieces, studio.getOutfit(obsidian).pieces);
  assert.equal(JSON.stringify(studio.getOutfit(obsidian)), before, "starter record is byte-identical");
  const named = studio.customizeOutfit(obsidian, { name: "Pink Dream", pieces: ["pink blazer"] });
  assert.equal(named.name, "Pink Dream");
  assert.deepEqual(named.pieces, ["pink blazer"]);
  assert.throws(() => studio.customizeOutfit("wdr:deadbeef"),
    (error) => error.code === WARDROBE_ERROR_NOT_FOUND);
});

test("snapshot carries outfits[], equippedId, and version; restore rebuilds the wardrobe", () => {
  const studio = atelier();
  const custom = studio.createOutfit({ name: "Round Trip" });
  studio.equipOutfit(custom.id);
  const snapshot = studio.getSnapshot();
  assert.equal(snapshot.schemaVersion, WARDROBE_ATELIER_SCHEMA_VERSION);
  assert.ok(Array.isArray(snapshot.outfits), "outfits[] is present");
  assert.equal(snapshot.outfitCount, snapshot.outfits.length);
  assert.equal(snapshot.equippedId, custom.id);
  studio.reset();
  assert.equal(studio.getOutfit(custom.id), null, "reset drops user outfits (replay lifecycle)");
  studio.restoreFromSnapshot(snapshot);
  assert.ok(studio.getOutfit(custom.id), "restore brings user outfits back");
  assert.equal(studio.getEquipped().id, custom.id);
  assert.ok(studio.verifyIntegrity().ok);
});

test("export/import is the persistence lifecycle: user outfits survive, reset drops them", () => {
  const studio = atelier();
  const custom = studio.createOutfit({ name: "Keeper" });
  studio.equipOutfit(custom.id);
  const exported = studio.exportState();
  studio.reset();
  assert.equal(studio.listOutfits().length, WARDROBE_ATELIER_STARTER_OUTFITS.length);
  studio.importState(exported);
  assert.ok(studio.getOutfit(custom.id), "imported state preserves user outfits");
  assert.equal(studio.getEquipped().id, custom.id);
  assert.throws(() => studio.importState({ ...exported, equippedId: "wdr:deadbeef" }),
    (error) => error.code === WARDROBE_ERROR_NOT_FOUND,
    "imported dangling equippedId is rejected");
});

test("verifyIntegrity reports starter tampering", () => {
  const studio = atelier();
  const report = studio.verifyIntegrity();
  assert.equal(report.ok, true);
  assert.equal(report.equippedResolves, true);
  assert.equal(report.startersIntact, true);
  assert.deepEqual(report.issues, []);
});

test("reset restores the starter set and the default equipped look", () => {
  const studio = atelier();
  studio.createOutfit({ name: "Temporary" });
  assert.equal(studio.listOutfits().length, WARDROBE_ATELIER_STARTER_OUTFITS.length + 1);
  studio.reset();
  assert.equal(studio.listOutfits().length, WARDROBE_ATELIER_STARTER_OUTFITS.length);
  assert.ok(studio.getEquipped());
  assert.ok(studio.verifyIntegrity().ok);
});

test("hashWardrobeAtelierSeed is deterministic", () => {
  assert.equal(hashWardrobeAtelierSeed("abc"), hashWardrobeAtelierSeed("abc"));
  assert.notEqual(hashWardrobeAtelierSeed("abc"), hashWardrobeAtelierSeed("abd"));
  assert.match(hashWardrobeAtelierSeed("abc"), /^[0-9a-f]{8}$/);
});

test("snapshot and contribution carry simulation-only flags", () => {
  const studio = atelier();
  const snapshot = studio.getSnapshot();
  assert.equal(snapshot.schemaVersion, WARDROBE_ATELIER_SCHEMA_VERSION);
  assert.equal(snapshot.source, WARDROBE_ATELIER_SOURCE);
  assert.equal(snapshot.simulation, true);
  assert.equal(snapshot.localOnly, true);
  assert.equal(snapshot.singleInstance, true);
  assert.equal(snapshot.marketplace, false);
  assert.equal(snapshot.purchase, false);
  assert.equal(snapshot.transfer, false);
  const contribution = studio.createContribution();
  assert.equal(contribution.source, WARDROBE_ATELIER_SOURCE);
  assert.equal(contribution.entities.length, WARDROBE_ATELIER_STARTER_OUTFITS.length);
  assert.ok(contribution.entities.every((entity) => entity.kind === "wardrobe-outfit" && entity.simulation === true));
  assert.equal(contribution.capabilities[0].authority, "none");
  assert.equal(contribution.capabilities[0].executable, false);
  const factory = createWardrobeAtelierContribution({ updatedAt: FIXED_NOW });
  assert.equal(factory.updatedAt, FIXED_NOW);
});

test("wardrobe-atelier resolves inside the canonical projection sources", () => {
  const projection = createLivingRealityProjection({ projectedAt: FIXED_NOW });
  assert.ok(projection.world.sources.includes("wardrobe-atelier"));
  const entity = projection.world.entities.find((entry) => entry.kind === "wardrobe-outfit");
  assert.ok(entity);
  assert.equal(entity.simulation, true);
});

test("console source constant matches the feature wiring contract", () => {
  assert.equal(WARDROBE_ATELIER_CONSOLE_SOURCE, "wardrobe-atelier-console");
});

function fakeDocument(missing = []) {
  const ids = [
    "wardrobe-atelier-console", "wardrobe-atelier-close", "wardrobe-atelier-status",
    "wardrobe-atelier-grid", "wardrobe-atelier-detail", "wardrobe-atelier-form",
    "wardrobe-atelier-name", "wardrobe-atelier-palette", "wardrobe-atelier-motif",
    "wardrobe-atelier-description", "wardrobe-atelier-create", "wardrobe-atelier-reset",
    "wardrobe-atelier-trace", "wardrobe-atelier-boundary",
  ].filter((id) => !missing.includes(id));
  const makeEl = (id) => ({
    id,
    children: [],
    dataset: {},
    value: "",
    textContent: "",
    hidden: true,
    disabled: false,
    listeners: new Map(),
    append(...nodes) { this.children.push(...nodes); return this; },
    replaceChildren() { this.children = []; },
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    setAttribute() {},
  });
  const byId = new Map(ids.map((id) => [id, makeEl(id)]));
  return {
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => byId.get(id) ?? null,
    __byId: byId,
  };
}

test("console mounts on the expected mount points and publishes snapshots", () => {
  const documentRoot = fakeDocument();
  const equipped = [];
  const studio = atelier();
  const api = createWardrobeAtelierConsole({
    documentRoot,
    atelier: studio,
    onEquip: (outfit, snapshot, event) => equipped.push([outfit, snapshot, event]),
    onReplay: () => {},
  });
  const snapshot = api.getSnapshot();
  assert.equal(snapshot.source, WARDROBE_ATELIER_CONSOLE_SOURCE);
  assert.equal(snapshot.boundary, WARDROBE_ATELIER_BOUNDARY);
  assert.equal(snapshot.marketplace, false);
  assert.equal(snapshot.purchase, false);
  api.select(studio.listOutfits()[0].id);
  api.equip();
  assert.equal(equipped.length, 1);
  assert.equal(equipped[0][0].equipped, true);
  assert.equal(equipped[0][2].type, WARDROBE_EQUIPPED);
  assert.equal(equipped[0][1].source, WARDROBE_ATELIER_CONSOLE_SOURCE);
  api.replay();
  assert.throws(() => createWardrobeAtelierConsole({ documentRoot: fakeDocument(["wardrobe-atelier-grid"]) }),
    /Wardrobe Atelier console mount points are missing/);
});

test("console clears a dangling selection with OUTFIT NOT FOUND instead of equipping blindly", () => {
  const documentRoot = fakeDocument();
  const studio = atelier();
  const custom = studio.createOutfit({ name: "Vanishing" });
  const api = createWardrobeAtelierConsole({ documentRoot, atelier: studio });
  api.select(custom.id);
  studio.deleteOutfit(custom.id);
  const result = api.equip();
  assert.equal(result, null);
  assert.match(documentRoot.__byId.get("wardrobe-atelier-status").textContent, /OUTFIT NOT FOUND/);
  assert.equal(api.getSnapshot().selectedId, null, "selection is cleared");
});

test("console survives a throwing person-studio sync without corrupting domain state", () => {
  const documentRoot = fakeDocument();
  const studio = atelier();
  const target = studio.listOutfits().find((outfit) => outfit.studioOutfitId === "cobalt");
  const api = createWardrobeAtelierConsole({
    documentRoot,
    atelier: studio,
    onEquip: () => { throw new Error("person studio exploded"); },
  });
  api.equip(target.id);
  assert.equal(studio.getEquipped().id, target.id, "domain committed before the failing callback");
  assert.match(documentRoot.__byId.get("wardrobe-atelier-status").textContent, /PERSON SYNC SKIPPED/);
  assert.ok(studio.verifyIntegrity().ok);
});

test("console delete and customize flow through the domain", () => {
  const documentRoot = fakeDocument();
  const studio = atelier();
  const api = createWardrobeAtelierConsole({ documentRoot, atelier: studio });
  api.create({ name: "Console Design" });
  const created = studio.listOutfits().find((outfit) => outfit.name === "Console Design");
  assert.ok(created, "create() flow works");
  api.select(created.id);
  api.delete();
  assert.equal(studio.getOutfit(created.id), null, "delete() flow works");
  const obsidian = starterId(studio, "obsidian");
  api.select(obsidian);
  const beforeCount = studio.listOutfits().length;
  api.customize();
  assert.equal(studio.listOutfits().length, beforeCount + 1, "customize() clones a starter");
  assert.ok(studio.verifyIntegrity().ok);
});

test("null clock uses the wall clock instead of the 1970 epoch", () => {
  const studio = createWardrobeAtelier({ seed: "epoch-check", now: null });
  const outfit = studio.createOutfit({ name: "Epoch Check Look" });
  assert.ok(!outfit.createdAt.startsWith("1970-01-01"), "createdAt must not be the unix epoch");
  const year = Number(outfit.createdAt.slice(0, 4));
  assert.ok(year >= 2026, "createdAt must be the wall clock");
});

test("wardrobe import validates every record before changing the gallery", () => {
  const studio = atelier();
  const custom = studio.createOutfit({ name: "Keep my design" });studio.equipOutfit(custom.id);
  const backup = studio.exportState(), before = studio.getSnapshot();
  const mutations = [
    state => { state.outfits.at(-1).id = "bad"; },
    state => { state.outfits.pop();state.equippedId = custom.id; },
    state => { state.outfits[0].name = "Fake starter"; },
    state => { state.outfits.at(-1).studioOutfitId = "ivory"; },
    state => { state.outfits.shift(); },
    state => { state.outfits.push(state.outfits.at(-1)); },
    state => { state.equippedId = "wdr:deadbeef"; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(backup);mutate(invalid);
    assert.throws(() => studio.importState(invalid));
    assert.deepEqual(studio.getSnapshot(), before, "bad backup must leave every existing outfit and selection intact");
  }
});

test("import from a different seed keeps current starter identity and Person mapping", () => {
  const studio = atelier(), foreign = createWardrobeAtelier({ seed: "another-browser", now: () => "2026-09-19T00:00:00Z" });
  const idsBefore = studio.listOutfits().map(outfit => outfit.id);
  foreign.equipOutfit(starterId(foreign, "cobalt"));
  const design = foreign.createOutfit({ name: "Foreign design" });
  studio.importState(foreign.exportState());
  assert.deepEqual(studio.listOutfits().filter(outfit => outfit.origin === "starter").map(outfit => outfit.id), idsBefore);
  assert.equal(studio.getEquipped().studioOutfitId, "cobalt");
  assert.equal(studio.getEquipped().id, starterId(studio, "cobalt"));
  assert.ok(studio.getOutfit(design.id));assert.ok(studio.verifyIntegrity().ok);
});

test("customized long names produce self-importable bounded backups and outfit limits refuse additions", () => {
  const studio = atelier(), original = studio.createOutfit({ name: "x".repeat(48) });
  assert.equal(studio.customizeOutfit(original.id).name.length, 48);
  studio.importState(studio.exportState());
  while (studio.listOutfits().length < 256) studio.createOutfit({ name: "Another design" });
  assert.throws(() => studio.createOutfit({ name: "Too many" }), /256 outfits/);
  assert.throws(() => studio.customizeOutfit(original.id), /256 outfits/);
});

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}

test("wardrobe saves custom designs and selected/equipped look and reloads the exact local workspace", () => {
  const storage = memoryStorage();
  const studio = atelier(), api = createWardrobeAtelierConsole({ documentRoot: fakeDocument(), atelier: studio, storage });
  api.create({ name: "Persistent design", palette: "#123456 / #abcdef" });api.equip();
  const selectedId = api.getSnapshot().selectedId;
  assert.equal(api.getSnapshot().persistence, true);
  const callbacks = [], restored = createWardrobeAtelierConsole({ documentRoot: fakeDocument(), atelier: atelier(), storage, onEquip: (outfit, snapshot, event) => callbacks.push({ outfit, event }) });
  assert.equal(restored.getSnapshot().selectedId, selectedId);
  assert.equal(restored.getSnapshot().atelier.equippedId, selectedId);
  restored.open();assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].outfit.name, "Persistent design");
  assert.deepEqual(restored.exportBackup().atelier.outfits, api.exportBackup().atelier.outfits);
});

test("a stale wardrobe tab refuses writes until explicit reload of the newer saved state", () => {
  const storage = memoryStorage(), docB = fakeDocument();
  const a = createWardrobeAtelierConsole({ documentRoot: fakeDocument(), atelier: atelier(), storage });
  const b = createWardrobeAtelierConsole({ documentRoot: docB, atelier: atelier(), storage });
  a.create({ name: "Newer design" });
  const newer = storage.getItem(WARDROBE_STORAGE_KEY);
  assert.equal(b.create({ name: "Stale design" }), null);
  assert.equal(b.getSnapshot().atelier.outfitCount, 4);
  assert.equal(storage.getItem(WARDROBE_STORAGE_KEY), newer);
  assert.match(docB.__byId.get("wardrobe-atelier-status").textContent, /newer wardrobe.*another tab/);
  b.reloadSaved();b.create({ name: "After reload" });
  assert.equal(b.getSnapshot().atelier.outfitCount, 6);
  assert.equal(b.getSnapshot().persistence, true);
});

test("wardrobe storage failures retain designs and say unsaved; corrupt stored state is preserved until explicit replacement", () => {
  const documentRoot = fakeDocument();
  const api = createWardrobeAtelierConsole({ documentRoot, atelier: atelier(), storage: { getItem: () => null, setItem: () => { throw new Error("Quota exceeded"); } } });
  api.create({ name: "In memory" });
  assert.equal(api.getSnapshot().atelier.outfitCount, 5);assert.equal(api.getSnapshot().persistence, false);
  assert.match(documentRoot.__byId.get("wardrobe-atelier-status").textContent, /NOT SAVED.*Quota exceeded/);
  const storage = memoryStorage();storage.setItem(WARDROBE_STORAGE_KEY, "broken saved data");
  const broken = createWardrobeAtelierConsole({ documentRoot: fakeDocument(), atelier: atelier(), storage });
  broken.create({ name: "Preserve in memory" });
  assert.equal(storage.getItem(WARDROBE_STORAGE_KEY), "broken saved data");
  assert.equal(broken.getSnapshot().persistence, false);
  broken.importBackup(api.exportBackup());
  assert.equal(broken.getSnapshot().persistence, true);
  assert.equal(JSON.parse(storage.getItem(WARDROBE_STORAGE_KEY)).atelier.outfits.at(-1).name, "In memory");
});

test("wardrobe create/delete failures remain visible and fallback deletion updates the Person consumer", () => {
  const documentRoot = fakeDocument(), callbacks = [], studio = atelier();
  const api = createWardrobeAtelierConsole({ documentRoot, atelier: studio, storage: null, onEquip: (outfit, snapshot, event) => callbacks.push({ outfit, event }) });
  documentRoot.__byId.get("wardrobe-atelier-create").listeners.get("click")();
  assert.match(documentRoot.__byId.get("wardrobe-atelier-status").textContent, /DESIGN BLOCKED/);
  api.delete(starterId(studio, "obsidian"));
  assert.match(documentRoot.__byId.get("wardrobe-atelier-status").textContent, /CANNOT DELETE/);
  api.create({ name: "Delete wearing design" });api.equip();api.delete();
  assert.equal(callbacks.at(-1).outfit.studioOutfitId, "obsidian");
  assert.equal(callbacks.at(-1).event.reason, "delete-fallback");
  api.reset();assert.equal(callbacks.at(-1).outfit.studioOutfitId, "obsidian");
});

test("oversized or malformed JSON backups do not replace existing designs or storage", () => {
  const storage = memoryStorage(), api = createWardrobeAtelierConsole({ documentRoot: fakeDocument(), atelier: atelier(), storage });
  api.create({ name: "Preserve me" });
  const before = api.getSnapshot().atelier, raw = storage.getItem(WARDROBE_STORAGE_KEY);
  assert.throws(() => api.importBackup("x".repeat(524289)), /512 KiB/);
  assert.throws(() => api.importBackup("bad JSON"));
  assert.deepEqual(api.getSnapshot().atelier, before);
  assert.equal(storage.getItem(WARDROBE_STORAGE_KEY), raw);
});

test("Unicode at field and aggregate capacity always produces a portable UTF-8 backup", () => {
  const studio = atelier(), input = { name: "七".repeat(48), description: "七".repeat(280), motif: "七".repeat(48), pieces: Array(8).fill("七".repeat(48)) };
  let rejected = false;
  for (let index = 0; index < 252; index++) {
    const before = studio.getSnapshot();
    try { studio.createOutfit(input); }
    catch (error) { assert.match(error.message, /512 KiB/);assert.deepEqual(studio.getSnapshot(), before);rejected = true;break; }
  }
  assert.equal(rejected, true, "UTF-8 capacity should fill before the outfit count when fields contain three-byte characters");
  const api = createWardrobeAtelierConsole({ documentRoot: fakeDocument(), atelier: studio, storage: null });
  const raw = JSON.stringify(api.exportBackup());
  assert.ok(new TextEncoder().encode(raw).length <= 524288);
  const restored = createWardrobeAtelierConsole({ documentRoot: fakeDocument(), atelier: atelier(), storage: null });
  restored.importBackup(raw);
  assert.deepEqual(restored.exportBackup().atelier.outfits, api.exportBackup().atelier.outfits);
});

test("Wardrobe exposes one immutable source contribution and updates it on local mutations", () => {
  const contributions = [], api = createWardrobeAtelierConsole({ documentRoot: fakeDocument(), atelier: atelier(), storage: null, onChange: contribution => contributions.push(contribution) });
  api.create({ name: "Projection design" });
  assert.equal(contributions.at(-1).entities.length, 5);
  assert.equal(contributions.at(-1).source, WARDROBE_ATELIER_SOURCE);
  assert.ok(Object.isFrozen(contributions.at(-1)));
  assert.deepEqual(api.createContribution(), contributions.at(-1));
  api.reset();assert.equal(contributions.at(-1).entities.length, 4);
});

test("restored starter retries Person sync after readiness without changing wardrobe history or a fresh default", () => {
  const storage = memoryStorage(), saved = createWardrobeAtelierConsole({ documentRoot: fakeDocument(), atelier: atelier(), storage });
  saved.equip(starterId(atelier(), "cobalt"));
  const callbacks = [];
  let personReady = false;
  const restored = createWardrobeAtelierConsole({ documentRoot: fakeDocument(), atelier: atelier(), storage,
    onEquip: (outfit, snapshot, event) => { callbacks.push({ outfit, snapshot, event });return personReady; } });
  const before = restored.getSnapshot().atelier, raw = storage.getItem(WARDROBE_STORAGE_KEY);
  restored.open();
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].outfit.studioOutfitId, "cobalt");
  personReady = true;
  assert.equal(restored.syncEquipped("person-ready"), true);
  assert.equal(callbacks.length, 2);
  assert.equal(callbacks[1].snapshot.method, "person-ready");
  assert.equal(callbacks[1].event, null);
  assert.deepEqual(restored.getSnapshot().atelier, before, "readiness retries must not create equip history");
  assert.equal(storage.getItem(WARDROBE_STORAGE_KEY), raw);
  assert.equal(restored.syncEquipped("person-ready"), false, "accepted sync runs only once");
  const fresh = createWardrobeAtelierConsole({ documentRoot: fakeDocument(), atelier: atelier(), storage: null, onEquip: () => { throw new Error("untouched default must not override Person"); } });
  assert.equal(fresh.syncEquipped("person-ready"), false);
});
