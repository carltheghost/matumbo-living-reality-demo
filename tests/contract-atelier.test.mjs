import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTRACT_ATELIER_BOUNDARY,
  CONTRACT_ATELIER_CONSOLE_SOURCE,
  CONTRACT_ATELIER_LOGIC_KINDS,
  CONTRACT_ATELIER_MARKET_TYPES,
  CONTRACT_ATELIER_ROLES,
  CONTRACT_ATELIER_SCHEMA_VERSION,
  CONTRACT_ATELIER_SOURCE,
  CONTRACT_ATELIER_STAKE_UNIT,
  CONTRACT_ATELIER_STARTER_CONTRACTS,
  CONTRACT_ATELIER_TOPICS,
  createContractAtelier,
  describeContractLogic,
  evaluateContractLogic,
  hashContractAtelierSeed,
  normalizeContractLogic,
} from "../src/domains/contract-atelier.js";
import { createContractAtelierConsole } from "../src/render/contract-atelier.js";

const FIXED_NOW = "2026-09-18T12:00:00.000Z";

function atelier(seed = "test-seed") {
  return createContractAtelier({ seed, now: () => FIXED_NOW });
}

test("starter set is seeded and deterministic per seed", () => {
  const first = atelier().list().map((contract) => contract.id);
  const second = atelier().list().map((contract) => contract.id);
  assert.deepEqual(first, second);
  assert.equal(first.length, CONTRACT_ATELIER_STARTER_CONTRACTS.length);
  assert.ok(first.every((id) => /^ctr:[0-9a-f]{8}:\d{4}$/.test(id)));
  const other = atelier("different-seed").list().map((contract) => contract.id);
  assert.notDeepEqual(first, other);
});

test("creation validates market type, role, topic, title, and logic", () => {
  const studio = atelier();
  assert.throws(() => studio.createContract({ type: "weird", role: "house", topic: "sports", title: "X", logic: "p" }), TypeError);
  assert.throws(() => studio.createContract({ type: "yes_no", role: "bank", topic: "sports", title: "X", logic: "p" }), TypeError);
  assert.throws(() => studio.createContract({ type: "binary", role: "house", topic: "movies", title: "X", logic: "p" }), TypeError);
  assert.throws(() => studio.createContract({ type: "binary", role: "house", topic: "sports", title: "   ", logic: "p" }), TypeError);
  assert.throws(() => studio.createContract({ type: "binary", role: "house", topic: "sports", title: "X", logic: { kind: "maybe", proposition: "p" } }), TypeError);
  assert.throws(() => studio.createContract({ type: "binary", role: "house", topic: "sports", title: "X", logic: { kind: "and", conditions: ["only-one"] } }), TypeError);
});

test("all three market types open with their outcome rules", () => {
  const studio = atelier();
  const binary = studio.createContract({ type: "binary", role: "player", topic: "sports", title: "Binary demo", logic: "team wins" });
  assert.deepEqual(binary.outcomes, ["YES", "NO"]);
  const pool = studio.createContract({ type: "yes_no", role: "house", topic: "weather", title: "Pool demo", logic: "rain", outcomes: ["RAIN", "DRY"] });
  assert.deepEqual(pool.outcomes, ["RAIN", "DRY"]);
  assert.throws(() => studio.createContract({ type: "pool", role: "house", topic: "weather", title: "Bad pool", logic: "rain", outcomes: ["RAIN"] }), TypeError);
  const multi = studio.createContract({ type: "over_under", role: "player", topic: "politics", title: "Multi demo", logic: "vote held", outcomes: ["A", "B", "C"] });
  assert.deepEqual(multi.outcomes, ["A", "B", "C"]);
  assert.throws(() => studio.createContract({ type: "multi", role: "player", topic: "politics", title: "Bad multi", logic: "vote held", outcomes: ["A", "A"] }), TypeError);
  for (const contract of [binary, pool, multi]) {
    assert.equal(contract.status, "open");
    assert.equal(contract.simulation, true);
    assert.equal(contract.realMoney, false);
    assert.equal(contract.wagering, false);
    assert.equal(contract.settlement, false);
    assert.ok(Object.isFrozen(contract));
    assert.ok(Object.isFrozen(contract.logic));
    assert.ok(Object.isFrozen(contract.outcomes));
  }
});

test("house and player roles are recorded on the contract", () => {
  const studio = atelier();
  const house = studio.createContract({ type: "binary", role: "house", topic: "transport", title: "House contract", logic: "bus on time" });
  const player = studio.createContract({ type: "binary", role: "player", topic: "transport", title: "Player contract", logic: "bus on time" });
  assert.equal(house.role, "house");
  assert.equal(player.role, "player");
  assert.deepEqual([...CONTRACT_ATELIER_ROLES].sort(), ["house", "player"]);
  assert.deepEqual([...CONTRACT_ATELIER_MARKET_TYPES].sort(), ["home_away", "over_under", "yes_no"]);
  assert.deepEqual([...CONTRACT_ATELIER_TOPICS].sort(), ["custom", "politics", "sports", "transport", "weather"]);
  assert.deepEqual([...CONTRACT_ATELIER_LOGIC_KINDS].sort(), ["and", "condition", "if_else", "or"]);
});

test("logic constructor evaluates condition, AND, OR, and IF/ELSE", () => {
  const facts = { "rain": true, "wind": false, "quorum met": true };
  assert.equal(evaluateContractLogic(normalizeContractLogic("rain"), facts), true);
  assert.equal(evaluateContractLogic(normalizeContractLogic("wind"), facts), false);
  assert.equal(evaluateContractLogic(normalizeContractLogic("unknown"), facts), false);
  const andNode = normalizeContractLogic({ kind: "and", conditions: ["rain", "quorum met"] });
  assert.equal(evaluateContractLogic(andNode, facts), true);
  assert.equal(evaluateContractLogic(normalizeContractLogic({ kind: "and", conditions: ["rain", "wind"] }), facts), false);
  const orNode = normalizeContractLogic({ kind: "or", conditions: ["rain", "wind"] });
  assert.equal(evaluateContractLogic(orNode, facts), true);
  const ifElse = normalizeContractLogic({ kind: "if_else", if: "rain", then: "quorum met", else: "wind" });
  assert.equal(evaluateContractLogic(ifElse, facts), true);
  assert.equal(evaluateContractLogic(ifElse, { rain: false, wind: true, "quorum met": false }), true);
  assert.equal(evaluateContractLogic(ifElse, { rain: false, wind: false, "quorum met": true }), false);
  assert.match(describeContractLogic(ifElse), /IF/);
  assert.match(describeContractLogic(andNode), /AND/);
  assert.match(describeContractLogic(orNode), /OR/);
});

test("staking validates side, amount, and contract state", () => {
  const studio = atelier();
  const contract = studio.createContract({ type: "binary", role: "house", topic: "sports", title: "Stake demo", logic: "win" });
  const stake = studio.placeStake({ contractId: contract.id, side: "YES", amount: 25 });
  assert.equal(stake.side, "YES");
  assert.equal(stake.amount, 25);
  assert.equal(stake.unit, CONTRACT_ATELIER_STAKE_UNIT);
  assert.equal(stake.simulation, true);
  assert.ok(Object.isFrozen(stake));
  assert.throws(() => studio.placeStake({ contractId: contract.id, side: "MAYBE", amount: 10 }), TypeError);
  assert.throws(() => studio.placeStake({ contractId: contract.id, side: "YES", amount: 0 }), TypeError);
  assert.throws(() => studio.placeStake({ contractId: contract.id, side: "YES", amount: -5 }), TypeError);
  assert.throws(() => studio.placeStake({ contractId: contract.id, side: "YES", amount: 10001 }), TypeError);
  assert.throws(() => studio.placeStake({ contractId: "ctr:deadbeef:0000", side: "YES", amount: 10 }), TypeError);
  studio.resolveContract({ contractId: contract.id, facts: { win: true } });
  assert.throws(() => studio.placeStake({ contractId: contract.id, side: "YES", amount: 10 }), TypeError);
});

test("pool resolution splits the pool pro-rata among winning stakes", () => {
  const studio = atelier();
  const contract = studio.createContract({
    type: "pool", role: "player", topic: "weather", title: "Rain pool",
    logic: { kind: "or", conditions: ["rain am", "rain pm"] }, outcomes: ["RAIN", "DRY"],
  });
  studio.placeStake({ contractId: contract.id, side: "RAIN", amount: 30 });
  studio.placeStake({ contractId: contract.id, side: "RAIN", amount: 10 });
  studio.placeStake({ contractId: contract.id, side: "DRY", amount: 60 });
  const resolved = studio.resolveContract({ contractId: contract.id, facts: { "rain am": true, "rain pm": false } });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolution.winningSide, "RAIN");
  assert.equal(resolved.resolution.totalStaked, 100);
  const paid = resolved.resolution.payouts.reduce((sum, payout) => sum + payout.amount, 0);
  assert.ok(Math.abs(paid - 100) < 0.011, `pool fully distributed, got ${paid}`);
  const first = resolved.resolution.payouts.find((payout) => payout.stakeId.endsWith(":stake-1"));
  assert.equal(first.amount, 75);
  assert.ok(resolved.resolution.payouts.every((payout) => payout.unit === CONTRACT_ATELIER_STAKE_UNIT));
  assert.throws(() => studio.resolveContract({ contractId: contract.id, facts: {} }), TypeError);
});

test("binary resolution pays fictional double-or-nothing to the winning side", () => {
  const studio = atelier();
  const contract = studio.createContract({ type: "binary", role: "house", topic: "sports", title: "Binary payout", logic: "home wins" });
  studio.placeStake({ contractId: contract.id, side: "NO", amount: 40 });
  const resolved = studio.resolveContract({ contractId: contract.id, facts: { "home wins": false } });
  assert.equal(resolved.resolution.winningSide, "NO");
  assert.equal(resolved.resolution.payouts.length, 1);
  assert.equal(resolved.resolution.payouts[0].amount, 80);
});

test("multi resolution needs a listed winner and holding logic conditions", () => {
  const studio = atelier();
  const contract = studio.createContract({
    type: "multi", role: "house", topic: "politics", title: "Motion vote",
    logic: { kind: "and", conditions: ["quorum met", "vote concluded"] },
    outcomes: ["Motion A", "Motion B", "Neither"],
  });
  studio.placeStake({ contractId: contract.id, side: "Motion A", amount: 50 });
  studio.placeStake({ contractId: contract.id, side: "Motion B", amount: 50 });
  assert.throws(() => studio.resolveContract({ contractId: contract.id, facts: { "quorum met": true }, winner: "Motion A" }), TypeError);
  assert.throws(() => studio.resolveContract({ contractId: contract.id, facts: { "quorum met": true, "vote concluded": true }, winner: "Nobody" }), TypeError);
  const resolved = studio.resolveContract({
    contractId: contract.id,
    facts: { "quorum met": true, "vote concluded": true },
    winner: "Motion A",
  });
  assert.equal(resolved.resolution.winningSide, "Motion A");
  assert.equal(resolved.resolution.payouts.length, 1);
  assert.equal(resolved.resolution.payouts[0].amount, 100);
});

test("snapshot and contribution are frozen and carry no money authority flags", () => {
  const studio = atelier();
  const contract = studio.createContract({ type: "binary", role: "player", topic: "custom", title: "Snapshot demo", logic: "it happens" });
  studio.placeStake({ contractId: contract.id, side: "YES", amount: 5 });
  const snapshot = studio.getSnapshot();
  assert.equal(snapshot.schemaVersion, CONTRACT_ATELIER_SCHEMA_VERSION);
  assert.equal(snapshot.source, CONTRACT_ATELIER_SOURCE);
  assert.equal(snapshot.simulation, true);
  assert.equal(snapshot.localOnly, true);
  assert.equal(snapshot.open, CONTRACT_ATELIER_STARTER_CONTRACTS.length + 1);
  assert.equal(snapshot.realMoney, false);
  assert.equal(snapshot.wagering, false);
  assert.equal(snapshot.wallet, false);
  assert.equal(snapshot.chain, false);
  assert.equal(snapshot.custody, false);
  assert.equal(snapshot.settlement, false);
  assert.equal(snapshot.externalPublication, false);
  assert.equal(snapshot.stakeUnit, CONTRACT_ATELIER_STAKE_UNIT);
  assert.ok(Object.isFrozen(snapshot));
  const contribution = studio.createContribution();
  assert.equal(contribution.source, CONTRACT_ATELIER_SOURCE);
  assert.equal(contribution.entities.length, CONTRACT_ATELIER_STARTER_CONTRACTS.length + 1);
  assert.ok(contribution.entities.every((entity) => entity.kind === "contract-market" && entity.simulation === true));
  assert.deepEqual(contribution.capabilities, [{ id: "contract-atelier.stake", mode: "local-rehearsal", authority: "none", executable: false }]);
  assert.ok(Object.isFrozen(contribution));
});

test("reset restores the starter set and clears created contracts", () => {
  const studio = atelier();
  studio.createContract({ type: "binary", role: "house", topic: "sports", title: "Temporary", logic: "x" });
  assert.equal(studio.list().length, CONTRACT_ATELIER_STARTER_CONTRACTS.length + 1);
  studio.reset();
  assert.equal(studio.list().length, CONTRACT_ATELIER_STARTER_CONTRACTS.length);
  assert.ok(studio.list().every((contract) => contract.status === "open"));
});

test("hashContractAtelierSeed is deterministic", () => {
  assert.equal(hashContractAtelierSeed("abc"), hashContractAtelierSeed("abc"));
  assert.notEqual(hashContractAtelierSeed("abc"), hashContractAtelierSeed("abd"));
  assert.match(hashContractAtelierSeed("abc"), /^[0-9a-f]{8}$/);
});

test("console source constant matches the feature wiring contract", () => {
  assert.equal(CONTRACT_ATELIER_CONSOLE_SOURCE, "contract-atelier-console");
});

function fakeDocument(missing = []) {
  const ids = [
    "contract-atelier-console", "contract-atelier-close", "contract-atelier-status",
    "contract-atelier-list", "contract-atelier-detail", "contract-atelier-type",
    "contract-atelier-role", "contract-atelier-topic", "contract-atelier-title-input",
    "contract-atelier-logic-kind", "contract-atelier-prop-a", "contract-atelier-prop-b",
    "contract-atelier-prop-c", "contract-atelier-outcomes", "contract-atelier-create",
    "contract-atelier-reset", "contract-atelier-trace", "contract-atelier-boundary",
    "contract-atelier-review",
  ].filter((id) => !missing.includes(id));
  const makeEl = (id) => ({
    id,
    children: [],
    dataset: {},
    value: "",
    textContent: "",
    hidden: false,
    disabled: false,
    append(...nodes) { this.children.push(...nodes); return this; },
    replaceChildren() { this.children = []; },
    addEventListener() {},
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
  const seen = [];
  const studio = atelier();
  const consoleApi = createContractAtelierConsole({
    documentRoot,
    atelier: studio,
    onSelect: (snapshot) => seen.push(["select", snapshot]),
    onReplay: (snapshot) => seen.push(["replay", snapshot]),
  });
  const snapshot = consoleApi.getSnapshot();
  assert.equal(snapshot.source, CONTRACT_ATELIER_CONSOLE_SOURCE);
  assert.equal(snapshot.boundary, CONTRACT_ATELIER_BOUNDARY);
  assert.equal(snapshot.realMoney, false);
  assert.equal(snapshot.wagering, false);
  assert.equal(snapshot.atelier.open, CONTRACT_ATELIER_STARTER_CONTRACTS.length);
  const firstId = studio.list()[0].id;
  consoleApi.select(firstId);
  assert.equal(seen[0][0], "select");
  assert.equal(seen[0][1].selectedId, firstId);
  consoleApi.replay();
  assert.equal(seen[1][0], "replay");
  const created = consoleApi.create({ type: "binary", role: "player", topic: "custom", title: "Mount demo", logic: "demo holds" });
  assert.equal(created.action, "create");
  assert.throws(() => createContractAtelierConsole({ documentRoot: fakeDocument(["contract-atelier-list"]) }), /mount points are missing/);
});

test("null clock uses the wall clock instead of the 1970 epoch", () => {
  const desk = createContractAtelier({ seed: "epoch-check", now: null });
  const contract = desk.createContract({ type: "binary", role: "player", topic: "custom", title: "Epoch check", logic: "epoch holds" });
  assert.ok(!contract.createdAt.startsWith("1970-01-01"), "timestamp must not be the unix epoch");
  const year = Number(contract.createdAt.slice(0, 4));
  assert.ok(year >= 2026, "timestamp must be the wall clock");
});

/**
 * Interactive fake DOM for renderer tests that need to drive button clicks.
 * Mount-point elements are reachable via byId(); every createElement() call
 * is recorded on `created` so tests can inspect renderer-built UI.
 */
function interactiveDocument() {
  const created = [];
  function makeEl(id = "") {
    const el = {
      id,
      className: "",
      children: [],
      dataset: {},
      value: "",
      textContent: "",
      type: "",
      min: "",
      placeholder: "",
      hidden: false,
      disabled: false,
      handlers: {},
      append(...nodes) { this.children.push(...nodes); return this; },
      replaceChildren() { this.children = []; },
      addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute() {},
      click() { if (typeof this.handlers.click === "function") this.handlers.click(); },
    };
    created.push(el);
    return el;
  }
  const mountIds = [
    "contract-atelier-console", "contract-atelier-close", "contract-atelier-status",
    "contract-atelier-list", "contract-atelier-detail", "contract-atelier-type",
    "contract-atelier-role", "contract-atelier-topic", "contract-atelier-title-input",
    "contract-atelier-logic-kind", "contract-atelier-prop-a", "contract-atelier-prop-b",
    "contract-atelier-prop-c", "contract-atelier-outcomes", "contract-atelier-create",
    "contract-atelier-reset", "contract-atelier-trace", "contract-atelier-boundary",
    "contract-atelier-review",
  ];
  const byId = new Map(mountIds.map((id) => [id, makeEl(id)]));
  return {
    created,
    byId: (id) => byId.get(id) ?? null,
    createElement: (tag) => makeEl(""),
    getElementById: (id) => byId.get(id) ?? null,
  };
}

test("create button with blank outcomes falls back to binary YES/NO defaults", () => {
  const doc = interactiveDocument();
  const studio = atelier("blank-outcomes");
  createContractAtelierConsole({ documentRoot: doc, atelier: studio });
  doc.byId("contract-atelier-type").value = "binary";
  doc.byId("contract-atelier-role").value = "player";
  doc.byId("contract-atelier-topic").value = "custom";
  doc.byId("contract-atelier-title-input").value = "Blank outcomes check";
  doc.byId("contract-atelier-logic-kind").value = "condition";
  doc.byId("contract-atelier-prop-a").value = "rain holds";
  doc.byId("contract-atelier-outcomes").value = ""; // left blank on purpose
  doc.byId("contract-atelier-create").click();
  const status = doc.byId("contract-atelier-status").textContent;
  assert.ok(!status.includes("CREATE BLOCKED"), `creation should succeed, got status: ${status}`);
  const created = studio.list().find((contract) => contract.title === "Blank outcomes check");
  assert.ok(created, "contract was created");
  assert.deepEqual([...created.outcomes], ["YES", "NO"]);
});

test("create snapshots publish through the onSelect state channel", () => {
  const seen = [];
  const consoleApi = createContractAtelierConsole({
    documentRoot: fakeDocument(),
    atelier: atelier("publish-check"),
    onSelect: (snapshot) => seen.push(snapshot),
  });
  const snapshot = consoleApi.create({
    type: "binary", role: "player", topic: "custom",
    title: "Publish check", logic: "x", outcomes: ["YES", "NO"],
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].action, "create");
  assert.equal(seen[0], snapshot);
});

test("mounted multi contract shows a resolve hint about logic-satisfying facts", () => {
  const doc = interactiveDocument();
  const studio = atelier("hint-check");
  const consoleApi = createContractAtelierConsole({ documentRoot: doc, atelier: studio });
  const multi = studio.list().find((contract) => contract.type === "multi");
  assert.ok(multi, "starter set includes a multi contract");
  consoleApi.select(multi.id);
  const hints = doc.created.filter((el) =>
    String(el.className || "").includes("contract-atelier-hint")
    && /logic/i.test(String(el.textContent || "")));
  assert.ok(hints.length >= 1, "resolve hint element is present in the mounted console");
});
