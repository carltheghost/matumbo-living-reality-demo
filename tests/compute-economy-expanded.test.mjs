import test from "node:test";
import assert from "node:assert/strict";
import { createComputeAccount } from "../src/domains/compute-account.js";
import { createContributionVault } from "../src/domains/contribution-vault.js";
import { createEconomicTimeline } from "../src/domains/economic-timeline.js";

test("compute account enforces balance and budget before local spend", () => {
  const account = createComputeAccount({ monthlyBudgetUsd: 50, perTaskBudgetUsd: 20 });
  assert.equal(account.spendVerified({ spendId: "a", providerId: "openai", amountUsd: 1 }).reason, "insufficient-credits");
  account.fundDemo({ fundingId: "fund-1", amountUsd: 25 });
  assert.equal(account.spendVerified({ spendId: "b", providerId: "openai", amountUsd: 21 }).reason, "per-task-budget");
  assert.equal(account.spendVerified({ spendId: "c", providerId: "openai", amountUsd: 10 }).accepted, true);
  assert.equal(account.snapshot().balanceUsd, 15);
  assert.equal(account.snapshot().spentUsd, 10);
});

test("contribution vault requires explicit consent and stores no raw content", () => {
  const vault = createContributionVault();
  vault.propose({ contributionId: "c1", category: "prompt-pattern", units: 100, purpose: "aggregate research" });
  const denied = vault.accept("c1", { evidenceId: "e0" });
  assert.equal(denied.accepted, false);
  vault.authorize("c1", { scope: "aggregate-only", allowResearch: true, allowTraining: false });
  const accepted = vault.accept("c1", { evidenceId: "e1" });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.record.rawContentStored, false);
  assert.equal(accepted.record.rewardTumboSim, 0.1);
});

test("economic timeline preserves deterministic local ancestry without claiming cryptographic proof", () => {
  const timeline = createEconomicTimeline();
  const first = timeline.append({ type: "credits.demo-funded", source: "account", payload: { amountUsd: 10 } });
  const second = timeline.append({ type: "usage.settled", source: "provider", payload: { amountUsd: 2 } });
  assert.equal(second.previousChecksum, first.checksum);
  assert.equal(timeline.verify(), true);
  assert.equal(timeline.snapshot().cryptographicProof, false);
  assert.equal(timeline.snapshot().verifiedLocalChain, true);
});


test("demo funding IDs are idempotent", () => {
  const account = createComputeAccount();
  account.fundDemo({ fundingId: "same", amountUsd: 10 });
  account.fundDemo({ fundingId: "same", amountUsd: 10 });
  assert.equal(account.snapshot().balanceUsd, 10);
});

test("Jev usage receipt preserves metering and rejects altered bytes", async () => {
  const { createHash } = await import("node:crypto");
  const { parseJevAdviceReceipt } = await import("../src/domains/jev-advice-receipt.js");
  const digest = "a".repeat(64);
  const receipt = {
    schema: "tumbo.jev-advice-receipt/1",
    provider: "typesafe",
    sourceUrl: "https://api.typesafe.ai/v1/systemone",
    requestId: "usage-test",
    connectionId: "test-connection",
    requestedModel: "jev-latest",
    resolvedModel: "jev-fixture",
    receivedAt: "2026-11-22T00:00:00Z",
    probability: 0.7,
    probabilitySource: "answers.decision.noul",
    usage: { input_tokens: 330, output_tokens: 20 },
    stateSha256: digest,
    questionSha256: digest,
    requestBodySha256: digest,
    responseBodySha256: digest,
    worldActionExecuted: false,
  };
  const receiptJson = JSON.stringify(receipt);
  const exported = {
    schema: "tumbo.jev-advice-export/1",
    receiptJson,
    receiptSha256: createHash("sha256").update(receiptJson).digest("hex"),
  };
  assert.deepEqual((await parseJevAdviceReceipt(exported)).usage, receipt.usage);
  const changed = { ...exported, receiptJson: receiptJson.replace("330", "331") };
  await assert.rejects(parseJevAdviceReceipt(changed), /No valid downloadable Jev advice receipt/);
});
