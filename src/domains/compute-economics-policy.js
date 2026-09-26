/**
 * compute-economics-policy.js — sustainable margin allocation rehearsal.
 *
 * Rewards, treasury allocation and any future burn budget are derived only
 * from positive post-provider margin. The model never treats customer
 * principal or gross revenue as free distributable value.
 */

export const COMPUTE_ECONOMICS_POLICY_SOURCE = "matumbo-compute-economics-policy";

function money(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a finite non-negative number`);
  return Math.round((number + Number.EPSILON) * 1e8) / 1e8;
}

function rate(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} must be between 0 and 1`);
  return number;
}

export function evaluateComputeEconomics({
  customerRevenueUsd = 0,
  providerCostUsd = 0,
  paymentOpsCostUsd = 0,
  rewardBudgetRate = 0.15,
  treasuryReserveRate = 0.5,
  futureBurnBudgetRate = 0.1,
} = {}) {
  const revenue = money(customerRevenueUsd, "Customer revenue");
  const providerCost = money(providerCostUsd, "Provider cost");
  const paymentOps = money(paymentOpsCostUsd, "Payment/ops cost");
  const rewardRate = rate(rewardBudgetRate, "Reward budget rate");
  const reserveRate = rate(treasuryReserveRate, "Treasury reserve rate");
  const burnRate = rate(futureBurnBudgetRate, "Future burn budget rate");
  if (rewardRate + reserveRate + burnRate > 1) throw new Error("Allocation rates cannot exceed 100% of positive margin");

  const grossMarginUsd = Math.round((revenue - providerCost - paymentOps + Number.EPSILON) * 1e8) / 1e8;
  const distributableMarginUsd = Math.max(0, grossMarginUsd);
  const rewardBudgetUsd = Math.round(distributableMarginUsd * rewardRate * 1e8) / 1e8;
  const treasuryReserveUsd = Math.round(distributableMarginUsd * reserveRate * 1e8) / 1e8;
  const futureBurnBudgetUsd = Math.round(distributableMarginUsd * burnRate * 1e8) / 1e8;
  const retainedMarginUsd = Math.round(
    (distributableMarginUsd - rewardBudgetUsd - treasuryReserveUsd - futureBurnBudgetUsd + Number.EPSILON) * 1e8,
  ) / 1e8;

  return Object.freeze({
    source: COMPUTE_ECONOMICS_POLICY_SOURCE,
    customerRevenueUsd: revenue,
    providerCostUsd: providerCost,
    paymentOpsCostUsd: paymentOps,
    grossMarginUsd,
    distributableMarginUsd,
    sustainable: grossMarginUsd > 0,
    rewardBudgetUsd,
    treasuryReserveUsd,
    futureBurnBudgetUsd,
    retainedMarginUsd,
    futureBurnExecuted: false,
    realMoneyMovement: false,
    localOnly: true,
    simulation: true,
    boundary:
      "Planning math only. No treasury transfer, reward payment, token purchase, mint, burn, staking, or settlement is executed.",
  });
}

export default Object.freeze({
  COMPUTE_ECONOMICS_POLICY_SOURCE,
  evaluateComputeEconomics,
});
