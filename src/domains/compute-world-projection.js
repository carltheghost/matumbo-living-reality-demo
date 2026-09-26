import { validateProjectionContribution } from "../core/world-state.js";

export const COMPUTE_WORLD_SOURCE = "compute-economy-world";

/**
 * Project the local compute economy into SIMFABRIC without turning the
 * renderer into a billing or token authority. Every economic object remains
 * visibly simulated and inspectable by the same world projection pipeline.
 */
export function createComputeWorldContribution(snapshot = {}, updatedAt = new Date().toISOString()) {
  const exchange = snapshot.exchange ?? {};
  const account = snapshot.account ?? {};
  const vault = snapshot.vault ?? {};
  const timeline = snapshot.timeline ?? {};
  const entities = [];
  const evidence = [];
  const relationships = [];
  const linked = new Set();

  const add = (entity) => entities.push(Object.freeze({ ...entity, simulation: true }));
  const link = (from, to, relation) => {
    const id = `${from}:${relation}:${to}`;
    if (linked.has(id)) return;
    linked.add(id);
    const edge = Object.freeze({ id, kind: "neural-relationship", from, to, relation, simulation: true });
    relationships.push(edge);
    entities.push(edge);
  };

  const exchangeId = "compute:exchange";
  const walletId = "compute:wallet";
  const rewardId = "compute:reward-pool";
  const ledgerTargetId = "compute:ledger-target";

  add({
    id: exchangeId,
    kind: "compute-exchange",
    label: "maTumbo Compute Exchange",
    organId: "exchange",
    totals: exchange.totals ?? {},
    providerCount: Array.isArray(exchange.byProvider) ? exchange.byProvider.length : 0,
    authority: "local-simulation",
  });
  add({
    id: walletId,
    kind: "compute-credit-wallet",
    label: "Compute Credits",
    organId: "asset-token",
    balanceUsd: account.balanceUsd ?? 0,
    spentUsd: account.spentUsd ?? 0,
    budget: account.budget ?? null,
    realMoney: false,
  });
  add({
    id: rewardId,
    kind: "compute-reward-accrual",
    label: "TUMBO-SIM Reward Accrual",
    organId: "asset-token",
    computeRewardTumboSim: exchange.totals?.tumboSimReward ?? 0,
    contributionRewardTumboSim: vault.totalRewardTumboSim ?? 0,
    transferable: false,
  });
  add({
    id: ledgerTargetId,
    kind: "ledger-proof-target",
    label: "Prime Ledger / EchoProof Target",
    organId: "ledger",
    cryptographicProof: false,
    status: "local-ancestry-only",
  });
  link(walletId, exchangeId, "funds-compute");
  link(exchangeId, rewardId, "accrues");
  link(exchangeId, ledgerTargetId, "projects-receipts-to");

  for (const provider of exchange.byProvider ?? []) {
    const providerId = `compute:provider:${provider.providerId}`;
    add({
      id: providerId,
      kind: "compute-provider",
      label: provider.providerName,
      organId: "exchange",
      calls: provider.calls,
      totalTokens: provider.totalTokens,
      verifiedSpendUsd: provider.verifiedSpendUsd,
    });
    link(providerId, exchangeId, "serves");
  }

  for (const receipt of exchange.receipts ?? []) {
    const receiptId = `compute:receipt:${receipt.receiptId}`;
    add({
      id: receiptId,
      kind: "compute-usage-receipt",
      label: `${receipt.providerName} · ${receipt.model}`,
      organId: "proof",
      providerId: receipt.providerId,
      model: receipt.model,
      inputTokens: receipt.inputTokens,
      outputTokens: receipt.outputTokens,
      totalTokens: receipt.totalTokens,
      reportedCostUsd: receipt.reportedCostUsd,
      verified: receipt.verified,
    });
    evidence.push(Object.freeze({
      id: `${receiptId}:evidence`,
      kind: "compute-usage-evidence",
      status: receipt.verified ? "provider-receipt-demo-verified" : "unverified-local-demo",
      receiptId: receipt.receiptId,
      providerId: receipt.providerId,
    }));
    link(`compute:provider:${receipt.providerId}`, receiptId, "produced");
    link(receiptId, exchangeId, "metered-by");
    link(receiptId, ledgerTargetId, "ancestry-target");
  }

  for (const contribution of vault.contributions ?? []) {
    const id = `compute:contribution:${contribution.contributionId}`;
    add({
      id,
      kind: "consented-data-contribution",
      label: contribution.category,
      organId: "proof",
      units: contribution.units,
      state: contribution.state,
      consent: contribution.consent,
      retentionDays: contribution.retentionDays,
      rewardTumboSim: contribution.rewardTumboSim,
      rawContentStored: false,
    });
    evidence.push(Object.freeze({
      id: `${id}:consent`,
      kind: "consent-evidence",
      status: contribution.consent?.explicit === true ? "explicit-local-consent" : "no-consent",
      contributionId: contribution.contributionId,
      rawContentStored: false,
    }));
    link(id, rewardId, "may-accrue");
    link(id, ledgerTargetId, "consent-ancestry-target");
  }

  for (const event of timeline.events ?? []) {
    const id = `compute:event:${event.sequence}`;
    add({
      id,
      kind: "economic-event",
      label: event.type,
      organId: "ledger",
      sequence: event.sequence,
      source: event.source,
      checksum: event.checksum,
      previousChecksum: event.previousChecksum,
      cryptographicProof: false,
    });
    link(id, ledgerTargetId, "records-before-proof");
  }

  const contribution = {
    schemaVersion: 1,
    source: COMPUTE_WORLD_SOURCE,
    simulation: true,
    updatedAt,
    entities,
    evidence,
    relationships,
    capabilities: [
      {
        id: "compute-economy.inspect",
        mode: "local-projection",
        authority: "none",
        executable: false,
      },
    ],
    boundary:
      "Local compute economy projection only. No provider billing authority, wallet settlement, token issuance, staking, burn, or cryptographic proof.",
  };
  validateProjectionContribution(contribution);
  return contribution;
}

export default Object.freeze({
  COMPUTE_WORLD_SOURCE,
  createComputeWorldContribution,
});
