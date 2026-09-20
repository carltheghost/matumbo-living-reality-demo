/**
 * TUMBO-SIM token lifecycle — domain contribution (audit surface).
 *
 * Pure projection data describing the token lifecycle audit console:
 * transaction history, reverse / cancel lifecycle semantics, and the
 * EchoProof-style receipt chain. This module cannot execute, authorize,
 * custody, settle, or publish anything; it only describes the simulated
 * audit surface. Live behavior lives in src/domains/token.js (core) and
 * src/render/token-lifecycle.js (view).
 *
 * Simulation-only: TUMBO-SIM are simulated points. No real money,
 * wagering, wallets, custody, or chains.
 */

export const TOKEN_LIFECYCLE_SCHEMA_VERSION = 1;
export const TOKEN_LIFECYCLE_SOURCE = "tumbo-token-lifecycle";
export const TOKEN_LIFECYCLE_UNIT = "TUMBO-SIM";
export const TOKEN_LIFECYCLE_KIND = "token-lifecycle";

const freeze = (value) => Object.freeze(value);

export const TOKEN_LIFECYCLE_CAPABILITIES = freeze([
  freeze({
    id: "token-lifecycle.view-history",
    label: "View simulated transaction history with action/account filters",
    enabled: true,
    mode: "local-projection",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  freeze({
    id: "token-lifecycle.inspect-receipt",
    label: "Inspect a simulated EchoProof receipt with recomputed hashes",
    enabled: true,
    mode: "local-projection",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  freeze({
    id: "token-lifecycle.verify-chain",
    label: "Run simulated chain-integrity verification",
    enabled: true,
    mode: "local-projection",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  freeze({
    id: "token-lifecycle.reverse-cancel",
    label: "Rehearse simulated reverse / cancel lifecycle transitions",
    enabled: true,
    mode: "local-projection",
    authority: "none",
    simulationOnly: true,
    executable: false,
    note: "Compensating journals in a local demo ledger; never real settlement.",
  }),
  freeze({
    id: "token-lifecycle.live-settlement",
    label: "Settle, custody, or move real value",
    enabled: false,
    mode: "denied",
    authority: "none",
    status: "denied",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "No settlement, custody, wallet, or chain authority exists in the demo.",
  }),
  freeze({
    id: "token-lifecycle.real-money",
    label: "Represent money or a financial claim",
    enabled: false,
    mode: "denied",
    authority: "none",
    status: "denied",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "TUMBO-SIM are simulated points with no monetary value.",
  }),
]);

export const TOKEN_LIFECYCLE_PROVENANCE = freeze({
  source: "local-simulation",
  version: "token-lifecycle-v1",
  basis: "deterministic-local-ledger",
  simulation: true,
  externalSource: false,
  deterministic: true,
});

const LIFECYCLE_STATES = freeze(["pending", "settled", "reversed", "cancelled"]);
const LIFECYCLE_ACTIONS = freeze([
  "send",
  "receive",
  "exchange",
  "buy",
  "sell",
  "deliver",
  "tip",
  "stake",
  "save",
  "deposit",
  "lock",
  "reverse",
  "cancel",
  "unstake",
  "withdraw",
]);

export { LIFECYCLE_STATES, LIFECYCLE_ACTIONS };

function createEvidence(updatedAt) {
  return freeze([
    freeze({
      id: `token-lifecycle-boundary:${updatedAt}`,
      kind: "simulation-boundary",
      status: "enforced",
      simulation: true,
      liveSettlement: false,
      custody: false,
      walletConnection: false,
      signing: false,
      realMoney: false,
      note: "The audit console rehearses lifecycle transitions on simulated points only.",
    }),
    freeze({
      id: `token-lifecycle-semantics:${updatedAt}`,
      kind: "lifecycle-semantics",
      status: "declared",
      simulation: true,
      reverseWindowTicks: 1000,
      reverseModel: "compensating-journal",
      historyModel: "append-only",
      doubleReverse: "impossible-by-deterministic-idempotency-key",
      cancelOfSettled: "rejected-closed",
      note: "Reversals never edit history; expired windows and settled cancels fail closed.",
    }),
  ]);
}

/**
 * Build the deterministic local contribution describing the token
 * lifecycle audit surface.
 */
export function createTokenLifecycleContribution({ updatedAt } = {}) {
  const stamp = updatedAt ?? new Date().toISOString();
  const entities = freeze([
    freeze({
      id: "token-lifecycle:audit-console",
      type: TOKEN_LIFECYCLE_KIND,
      kind: TOKEN_LIFECYCLE_KIND,
      label: "Token Lifecycle Audit Console (simulated)",
      unit: TOKEN_LIFECYCLE_UNIT,
      route: "token-lifecycle.html",
      simulation: true,
      executable: false,
      features: freeze([
        "history-list-with-action-account-filters",
        "receipt-inspector-with-recomputed-hashes",
        "chain-integrity-verification",
        "reverse-cancel-rehearsal",
        "glass-cube-chain-visualization",
      ]),
      provenance: TOKEN_LIFECYCLE_PROVENANCE,
    }),
  ]);
  return freeze({
    schemaVersion: TOKEN_LIFECYCLE_SCHEMA_VERSION,
    source: TOKEN_LIFECYCLE_SOURCE,
    simulation: true,
    updatedAt: stamp,
    kind: TOKEN_LIFECYCLE_KIND,
    unit: TOKEN_LIFECYCLE_UNIT,
    actions: LIFECYCLE_ACTIONS,
    states: LIFECYCLE_STATES,
    entities,
    evidence: createEvidence(stamp),
    capabilities: TOKEN_LIFECYCLE_CAPABILITIES,
    provenance: TOKEN_LIFECYCLE_PROVENANCE,
  });
}

export const tokenLifecycleProjection = createTokenLifecycleContribution({
  updatedAt: "2026-09-20T00:00:00.000Z",
});

export default tokenLifecycleProjection;
