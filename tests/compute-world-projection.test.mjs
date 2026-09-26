import test from "node:test";
import assert from "node:assert/strict";
import { createProjectionEnvelope } from "../src/core/view-state.js";
import { createComputeWorldContribution } from "../src/domains/compute-world-projection.js";

test("compute economy becomes one SIMFABRIC world contribution with linked receipts and consent", () => {
  const snapshot = {
    exchange: {
      totals: { totalTokens: 1000000, verifiedSpendUsd: 10, tumboSimReward: 1 },
      byProvider: [{ providerId: "openai", providerName: "OpenAI / GPT", calls: 1, totalTokens: 1000000, verifiedSpendUsd: 10 }],
      receipts: [{
        receiptId: "r1",
        providerId: "openai",
        providerName: "OpenAI / GPT",
        model: "demo",
        inputTokens: 800000,
        outputTokens: 200000,
        totalTokens: 1000000,
        reportedCostUsd: 10,
        verified: true,
      }],
    },
    account: { balanceUsd: 15, spentUsd: 10, budget: { monthlyBudgetUsd: 100, perTaskBudgetUsd: 25 } },
    vault: {
      totalRewardTumboSim: 0.1,
      contributions: [{
        contributionId: "c1",
        category: "prompt-pattern",
        units: 100,
        state: "accepted",
        consent: { explicit: true, scope: "aggregate-only" },
        retentionDays: 30,
        rewardTumboSim: 0.1,
      }],
    },
    timeline: {
      events: [{ sequence: 1, type: "provider.usage", source: "openai", checksum: "abcd1234", previousChecksum: "GENESIS" }],
    },
  };
  const contribution = createComputeWorldContribution(snapshot, "2026-09-25T00:00:00.000Z");
  const envelope = createProjectionEnvelope({ contributions: [contribution], projectedAt: contribution.updatedAt });
  assert.equal(envelope.world.entities.some((entity) => entity.kind === "compute-exchange"), true);
  assert.equal(envelope.world.entities.some((entity) => entity.kind === "compute-usage-receipt"), true);
  assert.equal(envelope.world.entities.some((entity) => entity.kind === "consented-data-contribution"), true);
  assert.equal(envelope.world.evidence.some((item) => item.kind === "consent-evidence"), true);
  assert.equal(contribution.capabilities[0].authority, "none");
});
