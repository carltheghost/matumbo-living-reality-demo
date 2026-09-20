import assert from "node:assert/strict";
import { test } from "node:test";
import {
  askJudgments,
  belowThreshold,
  botIntentQuestion,
  BOT_INTENTS,
  CLARIFY_THRESHOLD,
  intentLabel,
  JUDGMENT_PROVIDERS,
  proposalReadinessQuestion,
  routeBotIntentHeuristic,
  scoreProposalHeuristic,
  selectProvider,
  selectSlotHeuristic,
  slotBotQuestion,
} from "../src/ai/judgments.js";

const FIXED_NOW = Date.parse("2026-09-20T12:00:00.000Z");

function completeProposal(overrides = {}) {
  return {
    title: "Derby day showdown",
    eventLabel: "City derby — Saturday",
    eventId: "soccer:derby-2026",
    outcomes: ["Home win", "Draw", "Away win"],
    minStake: 100,
    maxStake: 1000,
    sourceNotes: "Saw it in the journal.",
    researchNotes: "Form table checked locally.",
    status: "pending",
    createdAt: new Date(FIXED_NOW - 3600 * 1000).toISOString(),
    ...overrides,
  };
}

test("CLARIFY_THRESHOLD is 0.65", () => {
  assert.equal(CLARIFY_THRESHOLD, 0.65);
  assert.equal(belowThreshold({ confidence: 0.64 }), true);
  assert.equal(belowThreshold({ confidence: 0.65 }), false);
  assert.equal(belowThreshold({ confidence: 0.9 }), false);
  assert.equal(belowThreshold({}), true);
  assert.equal(belowThreshold(null), true);
});

test("intent routing on clear inputs", () => {
  const cases = [
    ["draft a contract on the derby", "draft_contract"],
    ["tell the other bot about the game", "message_bots"],
    ["scout it", "propose_contract"],
    ["bring it to me for review", "propose_contract"],
    ["announce the winner to the plaza", "announce"],
    ["write it down in the journal", "journal"],
    ["open the cube", "world_action"],
    ["explain the contract terms", "explain_contract"],
    ["help", "help"],
    ["hello", "chat"],
  ];
  for (const [message, intent] of cases) {
    const judged = routeBotIntentHeuristic({ message });
    assert.equal(judged.choice, intent, `message: ${message}`);
    assert.ok(judged.confidence >= 0.65, `confidence for "${message}" is ${judged.confidence}`);
    assert.ok(!belowThreshold(judged), `belowThreshold for "${message}"`);
  }
});

test("ambiguous intent input lands below the clarify threshold", () => {
  const judged = routeBotIntentHeuristic({ message: "draft a contract and scout it" });
  assert.ok(judged.confidence < 0.65, `expected < 0.65, got ${judged.confidence}`);
  assert.ok(belowThreshold(judged));
});

test("empty and unrecognized input routes to no_match", () => {
  const empty = routeBotIntentHeuristic({ message: "   " });
  assert.equal(empty.choice, "no_match");
  assert.ok(!belowThreshold(empty));
  const odd = routeBotIntentHeuristic({ message: "xylophone zeppelin quantum" });
  assert.equal(odd.choice, "no_match");
});

test("intent probabilities are a valid distribution", () => {
  const judged = routeBotIntentHeuristic({ message: "draft a contract on the derby" });
  const total = Object.values(judged.probabilities).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 0.001, `probabilities sum to ${total}`);
  assert.ok(judged.probabilities.draft_contract >= judged.confidence - 0.001);
});

test("slot heuristic resolves a unique strong match", () => {
  const judged = selectSlotHeuristic([
    { id: "scout-1", label: "Contract Scout", matchScore: 3 },
    { id: "muse-1", label: "Muse Agent", matchScore: 1 },
  ]);
  assert.equal(judged.choice, "scout-1");
  assert.ok(judged.confidence >= 0.65);
});

test("slot ambiguity resolves to none at 0.35", () => {
  const judged = selectSlotHeuristic([
    { id: "a", label: "Alpha Bot", matchScore: 2 },
    { id: "b", label: "Beta Bot", matchScore: 2 },
  ]);
  assert.equal(judged.choice, "none");
  assert.equal(judged.confidence, 0.35);
  assert.ok(belowThreshold(judged));
});

test("slot heuristic with no candidates resolves to none, high confidence", () => {
  const judged = selectSlotHeuristic([]);
  assert.equal(judged.choice, "none");
  assert.ok(judged.confidence >= 0.65);
  const options = slotBotQuestion([]).options;
  assert.deepEqual(options, ["none"]);
});

test("slot question options carry candidate ids plus none", () => {
  const question = slotBotQuestion([
    { id: "scout-1", label: "Contract Scout", matchScore: 3 },
    { id: "muse-1", label: "Muse Agent", matchScore: 2 },
  ]);
  assert.equal(question.kind, "choice");
  assert.deepEqual(question.options, ["scout-1", "muse-1", "none"]);
});

test("proposal scoring ranks complete above incomplete with stable order", () => {
  const complete = completeProposal();
  const noNotes = completeProposal({ sourceNotes: "", researchNotes: "" });
  const bare = completeProposal({
    outcomes: ["A", "B"],
    minStake: undefined,
    maxStake: undefined,
    sourceNotes: "",
    researchNotes: "",
    eventId: "",
  });
  const a = scoreProposalHeuristic(complete, { now: FIXED_NOW });
  const b = scoreProposalHeuristic(noNotes, { now: FIXED_NOW });
  const c = scoreProposalHeuristic(bare, { now: FIXED_NOW });
  assert.ok(a.score > b.score, `complete ${a.score} vs no-notes ${b.score}`);
  assert.ok(b.score > c.score, `no-notes ${b.score} vs bare ${c.score}`);
  assert.ok(Array.isArray(a.reasons) && a.reasons.length > 0);
  const total = a.probabilities.ready + a.probabilities.not_ready;
  assert.ok(Math.abs(total - 1) < 0.01);
  // Stable order: same input twice, same rank order.
  const again = [complete, noNotes, bare].map((proposal) => scoreProposalHeuristic(proposal, { now: FIXED_NOW }));
  assert.deepEqual(again.map((entry) => entry.score), [a.score, b.score, c.score]);
});

test("proposal scoring penalizes bad stake ranges and non-pending status", () => {
  const badStake = scoreProposalHeuristic(completeProposal({ minStake: 5000, maxStake: 100 }), { now: FIXED_NOW });
  assert.ok(badStake.reasons.some((reason) => reason.includes("minimum stake exceeds maximum stake")));
  const decided = scoreProposalHeuristic(completeProposal({ status: "approved" }), { now: FIXED_NOW });
  assert.ok(decided.score < scoreProposalHeuristic(completeProposal(), { now: FIXED_NOW }).score);
});

test("same input twice yields byte-identical answers", () => {
  const state = { message: "draft a contract on the derby" };
  const first = JSON.stringify(routeBotIntentHeuristic(state));
  const second = JSON.stringify(routeBotIntentHeuristic(state));
  assert.equal(first, second);

  const slotState = [
    { id: "a", label: "Alpha", matchScore: 3 },
    { id: "b", label: "Beta", matchScore: 1 },
  ];
  assert.equal(JSON.stringify(selectSlotHeuristic(slotState)), JSON.stringify(selectSlotHeuristic(slotState)));

  const proposal = completeProposal();
  assert.equal(
    JSON.stringify(scoreProposalHeuristic(proposal, { now: FIXED_NOW })),
    JSON.stringify(scoreProposalHeuristic(proposal, { now: FIXED_NOW }))
  );
});

test("determinism over 50 varied inputs", () => {
  const fragments = [
    "draft", "contract", "scout", "journal", "announce", "hello", "help",
    "open the cube", "move camera", "explain", "review", "the other bot",
    "propose", "note", "log", "feature", "select", "broadcast",
  ];
  const inputs = [];
  for (let index = 0; index < 50; index += 1) {
    inputs.push(`${fragments[index % fragments.length]} ${fragments[(index * 7 + 3) % fragments.length]} ${index}`);
  }
  for (const message of inputs) {
    const first = JSON.stringify(routeBotIntentHeuristic({ message }));
    const second = JSON.stringify(routeBotIntentHeuristic({ message }));
    assert.equal(first, second, `nondeterministic for: ${message}`);
  }
});

test("provider defaults to heuristic; mock provider shape", async () => {
  const saved = process.env.TYPESAFE_JUDGMENTS;
  delete process.env.TYPESAFE_JUDGMENTS;
  try {
    assert.equal(selectProvider(), "heuristic");
    process.env.TYPESAFE_JUDGMENTS = "nonsense";
    assert.equal(selectProvider(), "heuristic");
    process.env.TYPESAFE_JUDGMENTS = "mock";
    assert.equal(selectProvider(), "mock");
  } finally {
    if (saved === undefined) delete process.env.TYPESAFE_JUDGMENTS;
    else process.env.TYPESAFE_JUDGMENTS = saved;
  }

  const batch = await askJudgments(
    { message: "hello" },
    [botIntentQuestion(), slotBotQuestion([{ id: "a", matchScore: 1 }]), proposalReadinessQuestion()]
  );
  assert.equal(batch.provider, "heuristic");
  assert.ok(batch.answers["bot-intent"]);
  assert.ok(batch.answers["bot-slot"]);
  assert.ok(batch.answers["proposal-readiness"]);
  assert.equal(batch.answers["bot-intent"].kind, "choice");
  assert.equal(batch.answers["proposal-readiness"].kind, "score");

  const mockBatch = await askJudgments({ message: "hello" }, [botIntentQuestion()], "mock");
  assert.equal(mockBatch.provider, "mock");
  assert.equal(mockBatch.answers["bot-intent"].kind, "choice");
  assert.ok(typeof mockBatch.answers["bot-intent"].answer.choice === "string");
  assert.ok(typeof mockBatch.answers["bot-intent"].answer.confidence === "number");
});

test("http provider without server credentials falls back to heuristic", async () => {
  const savedKey = process.env.TYPESAFE_API_KEY;
  const savedUrl = process.env.TYPESAFE_API_URL;
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_URL;
  try {
    const batch = await askJudgments({ message: "draft a contract" }, [botIntentQuestion()], "http");
    assert.equal(batch.provider, "heuristic");
    assert.equal(batch.answers["bot-intent"].answer.choice, "draft_contract");
  } finally {
    if (savedKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = savedKey;
    if (savedUrl === undefined) delete process.env.TYPESAFE_API_URL;
    else process.env.TYPESAFE_API_URL = savedUrl;
  }
});

test("question builders carry complete meaning for a live model", () => {
  const intent = botIntentQuestion();
  assert.equal(intent.kind, "choice");
  assert.deepEqual(intent.options, [...BOT_INTENTS]);
  assert.ok(intent.instructions.length > 20);
  assert.ok(intent.criteria.draft_contract.includes("DRAFT"));

  const readiness = proposalReadinessQuestion();
  assert.equal(readiness.kind, "score");
  assert.ok(readiness.criteria["1.0"].includes("pending"));

  assert.deepEqual(JUDGMENT_PROVIDERS, ["mock", "heuristic", "http"]);
  assert.equal(intentLabel("propose_contract"), "proposing a contract for your review");
  assert.equal(intentLabel("mystery"), "mystery");
});

test("askJudgments answers the proposal-readiness score in a parallel batch", async () => {
  const proposal = completeProposal();
  const batch = await askJudgments(
    { message: "review these", proposal, now: FIXED_NOW },
    [botIntentQuestion(), proposalReadinessQuestion()]
  );
  const readiness = batch.answers["proposal-readiness"].answer;
  assert.equal(readiness.score, scoreProposalHeuristic(proposal, { now: FIXED_NOW }).score);
  assert.ok(readiness.confidence >= 0.65);
});
