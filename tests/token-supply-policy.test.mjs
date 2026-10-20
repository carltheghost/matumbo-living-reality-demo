import assert from "node:assert/strict";
import test from "node:test";

import {
  FLUFF_PER_TUMBO,
  TOKEN_TOTAL_SUPPLY,
  TUMBO_INTENDED_MAX_SUPPLY_FLUFF,
  TUMBO_INTENDED_MAX_SUPPLY_FLUFF_DECIMAL,
  TUMBO_INTENDED_MAX_SUPPLY_TUMBO,
  TUMBO_INTENDED_MAX_SUPPLY_TUMBO_DECIMAL,
} from "../src/domains/token-config.js";
import { createTokenEngine } from "../src/domains/token.js";
import { loadTokenEngine, serializeTokenEngine } from "../src/domains/token-store.js";
import {
  TOKEN_SUPPLY_POLICY_ASSET,
  TOKEN_SUPPLY_POLICY_FORMAT,
  fluffToTumboExact,
  formatExactInteger,
  getTumboSupplyPolicy,
  loadTumboSupplyPolicy,
  parseCanonicalUintDecimal,
  serializeTumboSupplyPolicy,
  tumboToFluffExact,
} from "../src/domains/token-supply-policy.js";

test("the fixed maximum is exact BigInt arithmetic and exceeds safe fluff integers", () => {
  assert.equal(typeof TUMBO_INTENDED_MAX_SUPPLY_TUMBO, "bigint");
  assert.equal(typeof TUMBO_INTENDED_MAX_SUPPLY_FLUFF, "bigint");
  assert.equal(TUMBO_INTENDED_MAX_SUPPLY_TUMBO, 40_000_000_000_000n);
  assert.equal(TUMBO_INTENDED_MAX_SUPPLY_FLUFF, 40_000_000_000_000_000n);
  assert.equal(TUMBO_INTENDED_MAX_SUPPLY_FLUFF, TUMBO_INTENDED_MAX_SUPPLY_TUMBO * BigInt(FLUFF_PER_TUMBO));
  assert.ok(TUMBO_INTENDED_MAX_SUPPLY_FLUFF > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(TUMBO_INTENDED_MAX_SUPPLY_TUMBO_DECIMAL, "40000000000000");
  assert.equal(TUMBO_INTENDED_MAX_SUPPLY_FLUFF_DECIMAL, "40000000000000000");
});

test("exact-unit helpers reject Number coercion and fractional whole-token values", () => {
  assert.equal(tumboToFluffExact(40_000_000_000_000n), 40_000_000_000_000_000n);
  assert.equal(fluffToTumboExact(40_000_000_000_000_000n), 40_000_000_000_000n);
  assert.throws(() => tumboToFluffExact(Number.MAX_SAFE_INTEGER), /bigint/);
  assert.throws(() => fluffToTumboExact(40_000_000_000_000_001n), /whole-TUMBO/);
  assert.throws(() => parseCanonicalUintDecimal(Number.MAX_SAFE_INTEGER + 1, "unsafe"), /canonical unsigned decimal string/);
  assert.equal(parseCanonicalUintDecimal("9007199254740992"), 9_007_199_254_740_992n);
  assert.equal(formatExactInteger(40_000_000_000_000_000n), "40,000,000,000,000,000");
});

test("policy metadata keeps current issued simulation supply distinct from intended maximum", () => {
  const policy = getTumboSupplyPolicy();
  assert.equal(policy.format, TOKEN_SUPPLY_POLICY_FORMAT);
  assert.equal(policy.asset, TOKEN_SUPPLY_POLICY_ASSET);
  assert.equal(policy.simulation, true);
  assert.deepEqual(policy.currentIssued, {
    wholeTumbo: "10000000",
    fluff: String(TOKEN_TOTAL_SUPPLY),
  });
  assert.deepEqual(policy.intendedMaximum, {
    wholeTumbo: TUMBO_INTENDED_MAX_SUPPLY_TUMBO_DECIMAL,
    fluff: TUMBO_INTENDED_MAX_SUPPLY_FLUFF_DECIMAL,
  });
  assert.notEqual(policy.currentIssued.fluff, policy.intendedMaximum.fluff);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.currentIssued), true);
  assert.equal(Object.isFrozen(policy.intendedMaximum), true);
});

test("policy serialization is canonical string-only JSON and round-trips exactly", () => {
  const raw = serializeTumboSupplyPolicy();
  assert.equal(raw, JSON.stringify(getTumboSupplyPolicy()));
  assert.equal(raw.includes("40000000000000000"), true);
  assert.equal(raw.includes("42000000000000000"), false);
  assert.equal(/(?:\d)n(?:[,}\]])/.test(raw), false, "serialized policy must not contain BigInt syntax");
  assert.deepEqual(loadTumboSupplyPolicy(raw), getTumboSupplyPolicy());
  assert.deepEqual(loadTumboSupplyPolicy(JSON.parse(raw)), getTumboSupplyPolicy());
});

test("policy loader rejects rounded, historical, numeric, and extra-field values", () => {
  const base = JSON.parse(serializeTumboSupplyPolicy());
  const cases = [
    ["historical fluff cap", { ...base, intendedMaximum: { ...base.intendedMaximum, fluff: "42000000000000000" } }],
    ["rounded fluff", { ...base, intendedMaximum: { ...base.intendedMaximum, fluff: "40000000000000001" } }],
    ["historical whole-token cap", { ...base, intendedMaximum: { ...base.intendedMaximum, wholeTumbo: "42000000000000" } }],
    ["leading zero", { ...base, intendedMaximum: { ...base.intendedMaximum, fluff: "040000000000000000" } }],
    ["numeric cap", { ...base, intendedMaximum: { ...base.intendedMaximum, fluff: 40000000000000000 } }],
    ["fractional cap", { ...base, intendedMaximum: { ...base.intendedMaximum, fluff: "40000000000000000.0" } }],
    ["extra policy field", { ...base, policyRevision: 2 }],
  ];
  for (const [label, value] of cases) {
    assert.throws(() => loadTumboSupplyPolicy(value), undefined, label);
  }
});

test("legacy token engine snapshots remain byte-identical and do not gain cap config", () => {
  const engine = createTokenEngine();
  engine.faucet("u:alice", "TUMBO", 12_345, { idempotencyKey: "cap-policy-legacy-fund" });
  const quote = engine.quote({ action: "buy", from: "u:alice", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1000 });
  engine.execute(quote, { idempotencyKey: "cap-policy-legacy-buy" });

  const before = serializeTokenEngine(engine);
  const parsed = JSON.parse(before);
  assert.equal(parsed.format, "tumbo-token-engine-v2");
  assert.deepEqual(parsed.config.supply, { TUMBO: TOKEN_TOTAL_SUPPLY, sMIMAS: 100_000_000_000 });
  assert.equal(Object.hasOwn(parsed.config, "intendedMaximum"), false);
  assert.equal(before.includes(TUMBO_INTENDED_MAX_SUPPLY_FLUFF_DECIMAL), false);

  const restored = loadTokenEngine(before);
  assert.equal(serializeTokenEngine(restored), before);
  assert.deepEqual(restored.config.supply, parsed.config.supply);
  assert.equal(restored.ledger.journalCount(), engine.ledger.journalCount());
  assert.equal(restored.ledger._lastReceiptHash, engine.ledger._lastReceiptHash);
  assert.equal(restored.balance("u:alice", "TUMBO"), engine.balance("u:alice", "TUMBO"));
  assert.equal(restored.balance("u:alice", "sMIMAS"), engine.balance("u:alice", "sMIMAS"));
});

