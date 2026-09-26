import test from "node:test";
import assert from "node:assert/strict";
import { evaluateComputeEconomics } from "../src/domains/compute-economics-policy.js";

test("rewards, treasury and future burn budget come only from positive margin", () => {
  const result = evaluateComputeEconomics({
    customerRevenueUsd: 20,
    providerCostUsd: 10,
    paymentOpsCostUsd: 2,
    rewardBudgetRate: 0.15,
    treasuryReserveRate: 0.5,
    futureBurnBudgetRate: 0.1,
  });
  assert.equal(result.grossMarginUsd, 8);
  assert.equal(result.rewardBudgetUsd, 1.2);
  assert.equal(result.treasuryReserveUsd, 4);
  assert.equal(result.futureBurnBudgetUsd, 0.8);
  assert.equal(result.retainedMarginUsd, 2);
  assert.equal(result.futureBurnExecuted, false);
});

test("an underwater plan produces zero distributable reward or burn budget", () => {
  const result = evaluateComputeEconomics({
    customerRevenueUsd: 10,
    providerCostUsd: 12,
    paymentOpsCostUsd: 1,
  });
  assert.equal(result.sustainable, false);
  assert.equal(result.distributableMarginUsd, 0);
  assert.equal(result.rewardBudgetUsd, 0);
  assert.equal(result.futureBurnBudgetUsd, 0);
});

test("allocation policy cannot distribute more than positive margin", () => {
  assert.throws(() => evaluateComputeEconomics({
    customerRevenueUsd: 20,
    providerCostUsd: 5,
    rewardBudgetRate: 0.5,
    treasuryReserveRate: 0.5,
    futureBurnBudgetRate: 0.2,
  }), /cannot exceed 100%/);
});
