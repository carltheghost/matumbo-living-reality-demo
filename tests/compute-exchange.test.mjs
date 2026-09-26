import test from "node:test";
import assert from "node:assert/strict";
import {
  createComputeExchangeLedger,
  estimateTumboSimReward,
  normalizeUsageReceipt,
  rankProviderQuotes,
} from "../src/domains/compute-exchange.js";

test("raw model-token volume alone never creates a reward", () => {
  const receipt = normalizeUsageReceipt({
    receiptId: "million-unverified",
    providerId: "openai",
    model: "example",
    inputTokens: 900000,
    outputTokens: 100000,
    reportedCostUsd: 12,
    verified: false,
  });
  const reward = estimateTumboSimReward(receipt);
  assert.equal(receipt.totalTokens, 1000000);
  assert.equal(reward.eligible, false);
  assert.equal(reward.tumboSim, 0);
});

test("verified provider spend accrues fractional TUMBO-SIM using the configured policy", () => {
  const reward = estimateTumboSimReward({
    receiptId: "verified-1",
    providerId: "anthropic",
    inputTokens: 1000,
    outputTokens: 500,
    reportedCostUsd: 5,
    verified: true,
  });
  assert.equal(reward.eligible, true);
  assert.equal(reward.tumboSim, 0.5);
});

test("ledger blocks duplicate receipts and preserves one economic loop", () => {
  const ledger = createComputeExchangeLedger();
  const input = {
    receiptId: "same-receipt",
    providerId: "kimi",
    inputTokens: 5000,
    outputTokens: 1000,
    reportedCostUsd: 2,
    verified: true,
  };
  const first = ledger.record(input);
  const second = ledger.record(input);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.duplicate, true);
  assert.equal(ledger.snapshot().totals.calls, 1);
  assert.deepEqual(first.economicLoop, [
    "provider-usage",
    "verified-receipt",
    "paycore-meter",
    "t402-route",
    "reward-accrual",
    "prime-ledger-receipt",
    "reality-lens-projection",
  ]);
});

test("router can rank provider quotes by cost, latency, or balanced policy", () => {
  const quotes = [
    { providerId: "openai", estimatedCostUsd: 0.8, estimatedLatencyMs: 900 },
    { providerId: "deepseek", estimatedCostUsd: 0.2, estimatedLatencyMs: 1300 },
    { providerId: "google", estimatedCostUsd: 0.5, estimatedLatencyMs: 500 },
  ];
  assert.equal(rankProviderQuotes(quotes, { priority: "cost" })[0].providerId, "deepseek");
  assert.equal(rankProviderQuotes(quotes, { priority: "latency" })[0].providerId, "google");
  assert.equal(rankProviderQuotes(quotes, { priority: "balanced" }).length, 3);
});
