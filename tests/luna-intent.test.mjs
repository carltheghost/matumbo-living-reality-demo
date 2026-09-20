/**
 * Tests for src/domains/luna-intent.js — the hardened, pure, deterministic
 * intent grammar. No DOM, no network, no clock: same input + same feature
 * list always yields the same parse.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LUNA_AMBIGUITY_GAP,
  LUNA_INTENT_SCHEMA_VERSION,
  LUNA_MAX_PARSE_WORDS,
  LUNA_TIER_EXACT,
  LUNA_TIER_STRONG,
  LUNA_TIER_WEAK,
  matchTargetCandidates,
  normalizeWithFillers,
  parseLunaIntent,
} from "../src/domains/luna-intent.js";
import { FEATURE_DEFINITIONS } from "../src/render/feature-navigator.js";

const F = FEATURE_DEFINITIONS;

test("schema and tier constants are sane", () => {
  assert.equal(LUNA_INTENT_SCHEMA_VERSION, 2);
  assert.ok(LUNA_TIER_WEAK < LUNA_TIER_STRONG && LUNA_TIER_STRONG < LUNA_TIER_EXACT);
  assert.ok(LUNA_AMBIGUITY_GAP > 0 && LUNA_AMBIGUITY_GAP < 0.5);
  assert.ok(LUNA_MAX_PARSE_WORDS >= 30);
});

test("filler phrases are stripped word-boundary-safely before parsing", () => {
  assert.equal(normalizeWithFillers("can you take me nft thing place"), "take me nft thing place");
  assert.equal(normalizeWithFillers("hey luna, please open the arena"), "open the arena");
  assert.equal(normalizeWithFillers("i want to learn about paycore"), "learn about paycore");
  // Word-boundary safety: "please" inside another word is untouched.
  assert.ok(normalizeWithFillers("unpleasantly open").includes("unpleasantly"));
});

test("first-sentence priority and word cap apply to long inputs", () => {
  const ramble = `take me to NFT Atelier because ${"it is great ".repeat(400)}`;
  const parsed = parseLunaIntent(ramble, F);
  assert.equal(parsed.grammarTruncated, true);
  assert.ok(parsed.firstSentence.startsWith("take me to NFT Atelier because"));
  assert.equal(parsed.intent, "navigate");
  assert.equal(parsed.chosenFeature.id, "nft-atelier");
  assert.ok(parsed.normalizedInput.split(" ").length <= LUNA_MAX_PARSE_WORDS);
});

test("exact registry hits act at the exact tier with full confidence", () => {
  const parsed = parseLunaIntent("take me to the arena", F);
  assert.equal(parsed.intent, "navigate");
  assert.equal(parsed.tier, "exact");
  assert.equal(parsed.chosenFeature.id, "arena");
  assert.equal(parsed.confidence, 1);
});

test("strong typos resolve with a strong tier and a chosen feature", () => {
  const parsed = parseLunaIntent("take me to contrct atelier", F);
  assert.equal(parsed.tier, "strong");
  assert.equal(parsed.chosenFeature.id, "contract-atelier");
});

test("weak fuzzy matches never choose a feature", () => {
  const parsed = parseLunaIntent("take me to the moon", F);
  assert.equal(parsed.tier, "weak");
  assert.equal(parsed.chosenFeature, null);
  assert.ok(parsed.candidates.length >= 1);
});

test("ambiguity gap: close contenders ask instead of guessing", () => {
  const parsed = parseLunaIntent("pool", F);
  assert.equal(parsed.intent, "clarify");
  assert.equal(parsed.tier, "ambiguous");
  assert.equal(parsed.chosenFeature, null);
  assert.ok(parsed.candidates.length >= 2);
});

test("alias-conflict table only offers registry-present features", () => {
  const market = matchTargetCandidates("market", F);
  assert.equal(market.tier, "ambiguous");
  for (const candidate of market.candidates) {
    assert.ok(F.some((feature) => feature.id === candidate.id), `${candidate.id} must exist`);
  }
  // "exchange" and "treasury" are not features, so they are never offered.
  assert.ok(!market.candidates.some((candidate) => ["exchange", "treasury"].includes(candidate.id)));
});

test("reserved words never become feature matches", () => {
  const parsed = parseLunaIntent("open", F);
  assert.equal(parsed.chosenFeature, null);
  const help = parseLunaIntent("help", F);
  assert.equal(help.chosenFeature, null);
});

test("navigation requires verb plus recognized target", () => {
  const parsed = parseLunaIntent("open sesame", F);
  assert.equal(parsed.intent, "navigate");
  assert.equal(parsed.tier, "none");
  assert.equal(parsed.chosenFeature, null);
  assert.equal(parsed.target, "sesame");
});

test("multi-intent never executes two navigations", () => {
  const both = parseLunaIntent("open the arena and open paycore", F);
  assert.equal(both.intent, "clarify");
  assert.equal(both.multiIntent, true);
  assert.equal(both.chosenFeature, null);
  assert.ok(both.orderQuestion.includes("Which should I do first"));
});

test("explain-before-open explains now and queues the navigation", () => {
  const parsed = parseLunaIntent("explain the ledger and open the arena", F);
  assert.equal(parsed.intent, "explain");
  assert.equal(parsed.multiIntent, true);
  assert.equal(parsed.chosenFeature.id, "ledger");
  assert.deepEqual(parsed.thenNavigate, { id: "arena", label: "ARENA / Game Lab" });
});

test("undo and context patterns are detected", () => {
  assert.equal(parseLunaIntent("no, not that one", F).intent, "undo");
  assert.equal(parseLunaIntent("undo that", F).intent, "undo");
  assert.equal(parseLunaIntent("where am I", F).intent, "context");
});

test("help and greet patterns are detected", () => {
  assert.equal(parseLunaIntent("help", F).intent, "help");
  assert.equal(parseLunaIntent("", F).intent, "help");
  assert.equal(parseLunaIntent("", F).empty, true);
  assert.equal(parseLunaIntent("hello", F).intent, "greet");
});

test("filler stripping explains why the domain pre-checks help on the raw input", () => {
  // "can you" is a filler phrase, so the grammar sees "what do" — the
  // domain therefore decides help on the raw text before delegating.
  assert.equal(normalizeWithFillers("what can you do?"), "what do");
  assert.equal(parseLunaIntent("what can you do?", F).intent, "fallback");
});

test("advice topics are flagged without navigating", () => {
  const parsed = parseLunaIntent("is crypto safe", F);
  assert.equal(parsed.advice, true);
  assert.equal(parsed.chosenFeature, null);
});

test("parsing is deterministic and order-stable on ties", () => {
  const first = parseLunaIntent("take me to the arena", F);
  const second = parseLunaIntent("take me to the arena", F);
  assert.deepEqual(first, second);
  // Pure: no wall-clock reads, no network handles in the result.
  assert.ok(!JSON.stringify(first).includes("http"));
});

test("bare exact target navigates; bare uncertain target clarifies", () => {
  const exact = parseLunaIntent("arena", F);
  assert.equal(exact.intent, "navigate");
  assert.equal(exact.chosenFeature.id, "arena");
  const uncertain = parseLunaIntent("person", F);
  assert.equal(uncertain.intent, "clarify");
  assert.equal(uncertain.chosenFeature, null);
});

test("curated aliases resolve but never outrank exact matches", () => {
  const alias = matchTargetCandidates("nft", F);
  assert.equal(alias.chosenFeature.id, "nft-atelier");
  const exact = matchTargetCandidates("nft-atelier", F);
  assert.equal(exact.tier, "exact");
});
