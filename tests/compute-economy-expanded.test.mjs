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


// Tests exercise the real journal with a new instance over the same storage
// (reload/remount), not a second copy of the production algorithm.
async function journalFixture() {
  const { createHash, webcrypto } = await import("node:crypto");
  const { createJevUsageJournal, JEV_HISTORY_KEY, JEV_HISTORY_LIMIT } = await import("../src/domains/jev-advice-receipt.js");
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  function envelope(changes = {}) {
    const digest = "a".repeat(64);
    const receiptJson = JSON.stringify({
      schema: "tumbo.jev-advice-receipt/1", provider: "typesafe",
      sourceUrl: "https://api.typesafe.ai/v1/systemone",
      requestId: "request-1", connectionId: "private-connection",
      requestedModel: "jev-latest", resolvedModel: "jev-fixture",
      receivedAt: "2026-11-24T00:00:00Z", probability: 0.7,
      probabilitySource: "answers.decision.noul",
      usage: { input_tokens: 330, output_tokens: 20 },
      stateSha256: digest, questionSha256: digest, requestBodySha256: digest,
      responseBodySha256: digest, worldActionExecuted: false, ...changes,
    });
    return { schema: "tumbo.jev-advice-export/1", receiptJson,
      receiptSha256: createHash("sha256").update(receiptJson).digest("hex") };
  }
  return { storage, envelope, JEV_HISTORY_KEY, JEV_HISTORY_LIMIT,
    journal: (override = storage) => createJevUsageJournal({ storage: override, cryptoApi: webcrypto }) };
}

test("Jev history survives remount and rejects duplicates and conflicts", async () => {
  const f = await journalFixture();
  const exported = f.envelope();
  assert.equal((await f.journal().importReceipt(exported)).status, "recorded");
  const reloaded = f.journal();
  assert.equal(reloaded.snapshot().length, 1);
  assert.deepEqual(reloaded.snapshot()[0].usage, { input_tokens: 330, output_tokens: 20 });
  assert.equal((await reloaded.importReceipt(exported)).status, "duplicate");
  await assert.rejects(reloaded.importReceipt(f.envelope({ probability: 0.8 })), /conflicting receipt/);
  assert.equal(reloaded.snapshot().length, 1);
  assert.doesNotMatch(f.storage.getItem(f.JEV_HISTORY_KEY), /private-connection|request-1|questionSha256/);
});

test("Jev history serializes concurrent imports within one tab", async () => {
  const f = await journalFixture();
  const exported = f.envelope();
  const results = await Promise.all([f.journal().importReceipt(exported), f.journal().importReceipt(exported)]);
  assert.deepEqual(results.map(r => r.status).sort(), ["duplicate", "recorded"]);
  assert.equal(f.journal().snapshot().length, 1);
});

test("Jev history retains missing metering without treating it as reported zero", async () => {
  const f = await journalFixture();
  await f.journal().importReceipt(f.envelope({ usage: null }));
  assert.equal(f.journal().snapshot()[0].usage, null);
  await f.journal().importReceipt(f.envelope({ connectionId: "other-connection" }));
  assert.equal(f.journal().snapshot().length, 2);
});

test("Jev history fails closed on invalid, unavailable or quota-limited storage", async () => {
  const f = await journalFixture();
  f.storage.setItem(f.JEV_HISTORY_KEY, "{invalid");
  await assert.rejects(f.journal().importReceipt(f.envelope()), /history is invalid/);
  assert.equal(f.storage.getItem(f.JEV_HISTORY_KEY), "{invalid");
  await assert.rejects(f.journal(null).importReceipt(f.envelope()), /storage is unavailable/);
  const quota = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  await assert.rejects(f.journal(quota).importReceipt(f.envelope()), /could not be saved/);
});

test("Jev history never evicts identities silently at the retention limit", async () => {
  const f = await journalFixture();
  const rows = Array.from({ length: f.JEV_HISTORY_LIMIT }, (_, i) => ({
    identity: i.toString(16).padStart(64, "0"), receiptSha256: "b".repeat(64),
    model: "jev-fixture", usage: null,
  }));
  const raw = JSON.stringify(rows);
  f.storage.setItem(f.JEV_HISTORY_KEY, raw);
  await assert.rejects(f.journal().importReceipt(f.envelope()), /history is full/);
  assert.equal(f.storage.getItem(f.JEV_HISTORY_KEY), raw);
});

test("Jev history refuses a tampered receipt before writing storage", async () => {
  const f = await journalFixture();
  const exported = f.envelope();
  exported.receiptJson = exported.receiptJson.replace("330", "331");
  await assert.rejects(f.journal().importReceipt(exported), /No valid downloadable/);
  assert.deepEqual(f.journal().snapshot(), []);
});
