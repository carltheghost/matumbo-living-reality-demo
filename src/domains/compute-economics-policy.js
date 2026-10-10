/**
 * compute-economics-policy.js — sustainable margin allocation rehearsal.
 *
 * Rewards, treasury allocation and any future burn budget are derived only
 * from positive post-provider margin. The model never treats customer
 * principal or gross revenue as free distributable value.
 */

export const COMPUTE_ECONOMICS_POLICY_SOURCE = "matumbo-compute-economics-policy";
import {
  toComputeUnits,
  fromComputeUnits,
  COMPUTE_UNITS_PER_USD
} from "./compute-account.js?v=20261003-skin360";

function money(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a finite non-negative number`);
  return toComputeUnits(value, label);
}

function rate(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} must be between 0 and 1`);
  const scaled = toComputeUnits(value, label);
  if (scaled % 10000 !== 0) throw new Error(`${label} must use whole basis points`);
  return scaled / 10000;
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
  if (rewardRate + reserveRate + burnRate > 10000) throw new Error("Allocation rates cannot exceed 100% of positive margin");

  if (!Number.isSafeInteger(providerCost + paymentOps)) throw new Error("Combined costs exceed safe compute-credit units");
  const grossMarginUnits = revenue - providerCost - paymentOps;
  const distributableUnits = Math.max(0, grossMarginUnits);
  const allocate = (basisPoints) => Number(BigInt(distributableUnits) * BigInt(basisPoints) / 10000n);
  const rewardUnits = allocate(rewardRate),
    reserveUnits = allocate(reserveRate),
    burnUnits = allocate(burnRate);
  // Floors prevent over-allocation; the exact remainder stays with the owner.
  const retainedUnits = distributableUnits - rewardUnits - reserveUnits - burnUnits;
  const grossMarginUsd = grossMarginUnits / COMPUTE_UNITS_PER_USD;
  const distributableMarginUsd = fromComputeUnits(distributableUnits);
  const rewardBudgetUsd = fromComputeUnits(rewardUnits),
    treasuryReserveUsd = fromComputeUnits(reserveUnits);
  const futureBurnBudgetUsd = fromComputeUnits(burnUnits),
    retainedMarginUsd = fromComputeUnits(retainedUnits);

  return Object.freeze({
    source: COMPUTE_ECONOMICS_POLICY_SOURCE,
    customerRevenueUsd: fromComputeUnits(revenue),
    providerCostUsd: fromComputeUnits(providerCost),
    paymentOpsCostUsd: fromComputeUnits(paymentOps),
    unitsPerUsd: COMPUTE_UNITS_PER_USD,
    grossMarginUnits,
    distributableMarginUnits: distributableUnits,
    rewardBudgetUnits: rewardUnits,
    treasuryReserveUnits: reserveUnits,
    futureBurnBudgetUnits: burnUnits,
    retainedMarginUnits: retainedUnits,
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
    boundary: "Planning math only. No treasury transfer, reward payment, token purchase, mint, burn, staking, or settlement is executed.",
  });
}

export default Object.freeze({
  COMPUTE_ECONOMICS_POLICY_SOURCE,
  evaluateComputeEconomics,
});
