/**
 * compute-account.js — local maTumbo compute-credit account rehearsal.
 *
 * Credits are USD-denominated demo accounting units so provider costs can be
 * compared without pretending that raw model-token counts are fungible.
 * Nothing in this module charges a card, moves money, or creates a wallet.
 */

export const COMPUTE_ACCOUNT_SCHEMA_VERSION = 1;
export const COMPUTE_ACCOUNT_SOURCE = "matumbo-compute-account";
export const COMPUTE_ACCOUNT_BOUNDARY =
  "Local demo-credit accounting only. No card charge, bank transfer, wallet, custody, settlement, subscription billing, or real balance exists.";

function amount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("Amount must be a finite non-negative number");
  return Math.round((number + Number.EPSILON) * 1e8) / 1e8;
}

function positive(value, label) {
  const result = amount(value);
  if (result <= 0) throw new Error(`${label} must be greater than zero`);
  return result;
}

export function createComputeAccount({
  startingCreditsUsd = 0,
  monthlyBudgetUsd = 100,
  perTaskBudgetUsd = 25,
} = {}) {
  let balanceUsd = amount(startingCreditsUsd);
  let spentUsd = 0;
  let budget = Object.freeze({
    monthlyBudgetUsd: positive(monthlyBudgetUsd, "Monthly budget"),
    perTaskBudgetUsd: positive(perTaskBudgetUsd, "Per-task budget"),
  });
  const spendIds = new Set();
  const events = [];
  let sequence = 0;

  function push(type, payload = {}) {
    const event = Object.freeze({
      sequence: ++sequence,
      type,
      source: COMPUTE_ACCOUNT_SOURCE,
      ...payload,
    });
    events.push(event);
    return event;
  }

  function setBudget(next = {}) {
    const monthly = next.monthlyBudgetUsd === undefined ? budget.monthlyBudgetUsd : positive(next.monthlyBudgetUsd, "Monthly budget");
    const perTask = next.perTaskBudgetUsd === undefined ? budget.perTaskBudgetUsd : positive(next.perTaskBudgetUsd, "Per-task budget");
    if (perTask > monthly) throw new Error("Per-task budget cannot exceed monthly budget");
    budget = Object.freeze({ monthlyBudgetUsd: monthly, perTaskBudgetUsd: perTask });
    push("budget.updated", budget);
    return budget;
  }

  function fundDemo({ fundingId, amountUsd, reason = "manual-demo-credit" } = {}) {
    const id = String(fundingId ?? "").trim();
    if (!id) throw new Error("fundingId is required");
    const value = positive(amountUsd, "Demo credit");
    balanceUsd = amount(balanceUsd + value);
    push("credits.demo-funded", { fundingId: id, amountUsd: value, reason: String(reason).slice(0, 120) });
    return snapshot();
  }

  function spendVerified({ spendId, providerId, amountUsd } = {}) {
    const id = String(spendId ?? "").trim();
    if (!id) throw new Error("spendId is required");
    if (spendIds.has(id)) {
      return Object.freeze({ accepted: false, duplicate: true, reason: "duplicate-spend", snapshot: snapshot() });
    }

    const value = positive(amountUsd, "Spend");
    if (value > budget.perTaskBudgetUsd) {
      return Object.freeze({ accepted: false, duplicate: false, reason: "per-task-budget", snapshot: snapshot() });
    }
    if (amount(spentUsd + value) > budget.monthlyBudgetUsd) {
      return Object.freeze({ accepted: false, duplicate: false, reason: "monthly-budget", snapshot: snapshot() });
    }
    if (value > balanceUsd) {
      return Object.freeze({ accepted: false, duplicate: false, reason: "insufficient-credits", snapshot: snapshot() });
    }

    spendIds.add(id);
    balanceUsd = amount(balanceUsd - value);
    spentUsd = amount(spentUsd + value);
    push("credits.spent", {
      spendId: id,
      providerId: String(providerId ?? "unknown"),
      amountUsd: value,
    });
    return Object.freeze({ accepted: true, duplicate: false, reason: "settled-local-demo", snapshot: snapshot() });
  }

  function snapshot() {
    return Object.freeze({
      schemaVersion: COMPUTE_ACCOUNT_SCHEMA_VERSION,
      source: COMPUTE_ACCOUNT_SOURCE,
      balanceUsd,
      spentUsd,
      remainingMonthlyBudgetUsd: amount(Math.max(0, budget.monthlyBudgetUsd - spentUsd)),
      budget,
      events: Object.freeze([...events]),
      localOnly: true,
      simulation: true,
      externalTransfer: false,
      executable: false,
      boundary: COMPUTE_ACCOUNT_BOUNDARY,
    });
  }

  return Object.freeze({ setBudget, fundDemo, spendVerified, snapshot });
}

export default Object.freeze({
  COMPUTE_ACCOUNT_SCHEMA_VERSION,
  COMPUTE_ACCOUNT_SOURCE,
  COMPUTE_ACCOUNT_BOUNDARY,
  createComputeAccount,
});
