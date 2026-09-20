/**
 * Luna Companion — hardened intent grammar (adversarial review, 2026-09-18).
 *
 * Pure, deterministic, local-only intent parsing for Luna's scripted dialogue.
 * Core principle: certainty → action; uncertainty → conversation; unknown → guidance.
 *
 * Hardening implemented here:
 *  - filler-word removal before parsing (please, can you, hey luna, ...)
 *  - first-sentence priority + word cap for long inputs (deterministic)
 *  - confidence tiers: exact → act silently; strong typo → act + confirm phrase;
 *    weak fuzzy → ask with suggestions
 *  - ambiguity threshold: best − secondBest < gap → ask, never guess
 *  - alias conflict table (market/pool/person/contract/atelier); substring never decides
 *  - multi-intent detection: never executes two navigations; explain-before-open
 *    when the explain clause comes first, otherwise asks for order
 *  - navigation requires verb + recognized target (verb alone never navigates)
 *  - passive explain forms: learn about X, give me info on X, explain X before I go
 *  - internalId separated from curated spokenAliases (aliases are curated, not generated)
 *  - knownFeatureRegistryOnly: never invents destinations
 *  - reserved words (open, show, go, take, tell, what, where, help) never become matches
 *  - undo pattern detection ("no, not that one") — session state lives in the domain
 *
 * No network, no AI model, no persistence. Scoring is deterministic:
 * ties always break in feature-definition order (stable sort).
 */

export const LUNA_INTENT_SCHEMA_VERSION = 2;

/** Confidence tier cutoffs for the scored matcher. */
export const LUNA_TIER_EXACT = 0.99;
export const LUNA_TIER_STRONG = 0.72;
export const LUNA_TIER_WEAK = 0.42;
/** If best − secondBest < gap, the input is ambiguous: ask, never guess. */
export const LUNA_AMBIGUITY_GAP = 0.12;
/** Grammar input budget: first-sentence priority, then a hard word cap. */
export const LUNA_MAX_PARSE_WORDS = 60;

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** Filler phrases stripped (word-boundary safe) before any intent matching. */
const FILLER_PHRASES = [
  "hey luna",
  "the thing called",
  "i would like to",
  "i'd like to",
  "i want to",
  "can you",
  "could you",
  "would you",
  "please",
  "kindly",
];

/** Reserved words: navigation/explain verbs and interrogatives — never feature matches. */
const RESERVED_WORDS = new Set(["open", "show", "go", "take", "tell", "what", "where", "help"]);

/** Low-signal nouns dropped from target phrases before scoring. */
const STOPWORDS = new Set([
  "the", "a", "an", "thing", "place", "stuff", "area", "section", "spot",
  "some", "any", "one",
]);

/**
 * Curated spoken aliases per internal feature id. Curated, not generated:
 * an alias only exists because a human wrote it here. Aliases never outrank
 * an exact internal id/label match.
 */
const CURATED_ALIASES = {
  "contract-atelier": ["contracts", "contract studio", "atelier contracts"],
  "nft-atelier": ["nft", "nfts", "nft studio"],
  "wardrobe-atelier": ["wardrobe", "outfits", "clothing", "clothes"],
  "agent": ["luna", "assistant", "guide", "agent", "agents"],
  "person": ["person studio", "avatar", "identity", "me", "myself"],
  "person-studio": ["person", "avatar", "identity"],
  "ledger": ["prime ledger", "echoproof", "echo proof"],
  "paycore": ["pay core", "balances"],
  "arena": ["game lab", "game"],
  "rooms": ["messages", "messaging", "chat rooms", "chat"],
  "t402": ["value routing", "t 402"],
  "reality-lens": ["reality lens", "lens", "home", "start"],
  "contracts": ["pools", "contract list"],
  "asset-market": ["market", "asset exchange"],
  "block-world": ["blocks", "fabric"],
  "exchange": ["market", "trading"],
  "treasury": ["vault", "funds"],
};

/**
 * Words that collide across features. An exact hit here ALWAYS asks with the
 * resolved options — substring matching never decides. Only entries present in
 * the injected feature list are offered.
 */
const ALIAS_CONFLICTS = {
  market: ["asset-market", "exchange", "treasury"],
  pool: ["contract-atelier", "asset-market"],
  person: ["person", "person-studio", "wardrobe-atelier", "avatar"],
  contract: ["contract-atelier", "contracts"],
  atelier: ["contract-atelier", "nft-atelier", "wardrobe-atelier"],
};

const NAVIGATE_VERBS = ["take me to", "take me", "open", "go to", "show me"];
const EXPLAIN_VERBS = [
  "learn about",
  "give me info on",
  "tell me about",
  "what is",
  "what's",
  "describe",
  "explain",
];

const UNDO_PATTERN = /^(no[,.]?\s+not that(\s+one)?|undo(\s+that)?|go back|take me back)\b/;
const CONTEXT_PATTERN = /^(where am i|what can i do here|what is this place|describe this place)$/;
const HELP_PATTERN = /^(help|what can you do|how do you work|commands)\b/;
const GREET_PATTERN = /^(hello|hi|hey|good morning|good afternoon|good evening)\b/;
const ADVICE_PATTERN = /\b(invest|investing|buy|sell|stock|crypto|bet|betting|odds|wager|legal|lawsuit|lawyer|medical|doctor|diagnos|symptom|treatment|prescription)\b/;

function normalizeBasic(text) {
  return safeText(text)
    .toLowerCase()
    .replace(/[?!.,;:…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

function tokenize(text) {
  return normalizeBasic(text).split(" ").filter(Boolean);
}

/** Strip filler phrases (word-boundary safe), then normalize. */
export function normalizeWithFillers(text) {
  let padded = ` ${safeText(text).toLowerCase().replace(/[?!.,;:…]+/g, " ").replace(/\s+/g, " ").trim()} `;
  for (const phrase of FILLER_PHRASES) {
    padded = padded.split(` ${phrase} `).join(" ");
  }
  return padded.replace(/\s+/g, " ").trim().replace(/^the\s+/, "");
}

function takeFirstSentence(text) {
  const parts = safeText(text).split(/[.!?…\n]+/).map((part) => part.trim()).filter(Boolean);
  return parts[0] ?? safeText(text).trim();
}

function capWords(text, maxWords) {
  const words = safeText(text).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return { text: words.join(" "), truncated: false };
  return { text: words.slice(0, maxWords).join(" "), truncated: true };
}

function levenshtein(a, b) {
  const left = safeText(a);
  const right = safeText(b);
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let prev = new Array(right.length + 1);
  let curr = new Array(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) prev[j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[right.length];
}

function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  return 1 - levenshtein(a, b) / longest;
}

function featureTokenSet(feature) {
  const tokens = new Set(tokenize(`${safeText(feature.id)} ${safeText(feature.label)} ${safeText(feature.kicker)}`));
  for (const alias of CURATED_ALIASES[safeText(feature.id)] ?? []) {
    for (const token of tokenize(alias)) tokens.add(token);
  }
  return tokens;
}

/** Mean best-token similarity; exact token hits score 1, near-misses (≤2 edits) score < 1. */
function tokenMatchScore(targetTokens, featureTokens) {
  let sum = 0;
  for (const target of targetTokens) {
    let best = 0;
    for (const candidate of featureTokens) {
      if (target === candidate) {
        best = 1;
        break;
      }
      if (target.length >= 3 && Math.abs(target.length - candidate.length) <= 2) {
        const distance = levenshtein(target, candidate);
        if (distance <= 2) {
          const scored = similarity(target, candidate) * 0.9;
          if (scored > best) best = scored;
        }
      }
    }
    sum += best;
  }
  return targetTokens.length ? sum / targetTokens.length : 0;
}

/**
 * Score one feature against a target phrase. Exact id/label equality is the
 * only path to 1.0; every subset/token/alias match caps at 0.95 (strong tier).
 */
function scoreFeature(feature, phrase) {
  const id = normalizeBasic(feature.id);
  const label = normalizeBasic(feature.label);
  if (!phrase) return 0;
  if (phrase === id || phrase === label) return 1;
  const aliases = CURATED_ALIASES[safeText(feature.id)] ?? [];
  let score = aliases.some((alias) => normalizeBasic(alias) === phrase) ? 0.95 : 0;
  const targetTokens = tokenize(phrase).filter(
    (token) => !RESERVED_WORDS.has(token) && !STOPWORDS.has(token),
  );
  if (targetTokens.length) {
    const tokens = featureTokenSet(feature);
    score = Math.max(
      score,
      tokenMatchScore(targetTokens, tokens),
      similarity(phrase, label),
      similarity(phrase, id),
    );
  }
  if (score >= LUNA_TIER_EXACT) score = 0.95;
  return score;
}

/**
 * Match a target phrase against the feature registry. Tries progressively
 * shorter leading phrases so a ramble like "nft atelier because ..." still
 * resolves on its leading noun phrase.
 */
export function matchTargetCandidates(targetRaw, features) {
  const list = Array.isArray(features) ? features : [];
  const phrase = normalizeBasic(targetRaw);
  const empty = { tier: "none", candidates: [], chosenFeature: null, confidence: 0 };
  if (!phrase || !list.length) return empty;

  const conflict = ALIAS_CONFLICTS[phrase];
  if (conflict) {
    const resolved = conflict
      .map((id) => list.find((feature) => safeText(feature.id) === id))
      .filter(Boolean);
    if (resolved.length) {
      return {
        tier: "ambiguous",
        candidates: resolved.slice(0, 3).map((feature) => ({ id: feature.id, label: feature.label, score: 0.8 })),
        chosenFeature: null,
        confidence: 0.8,
        conflict: true,
      };
    }
  }

  const tokens = tokenize(phrase).filter((token) => !RESERVED_WORDS.has(token));
  let best = empty;
  for (let length = tokens.length; length >= 1; length -= 1) {
    const slice = tokens.slice(0, length).join(" ");
    const scored = list.map((feature, index) => ({ feature, index, score: scoreFeature(feature, slice) }));
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    const viable = scored.filter((entry) => entry.score >= LUNA_TIER_WEAK);
    if (!viable.length) continue;
    const [first, second] = viable;
    const candidates = viable.slice(0, 3).map((entry) => ({
      id: entry.feature.id,
      label: entry.feature.label,
      score: Number(entry.score.toFixed(4)),
    }));
    if (first.score >= LUNA_TIER_EXACT) {
      return {
        tier: "exact",
        candidates,
        chosenFeature: first.feature,
        confidence: 1,
      };
    }
    if (second && first.score - second.score < LUNA_AMBIGUITY_GAP) {
      return {
        tier: "ambiguous",
        candidates,
        chosenFeature: null,
        confidence: Number(first.score.toFixed(4)),
      };
    }
    const tier = first.score >= LUNA_TIER_STRONG ? "strong" : "weak";
    const result = {
      tier,
      candidates,
      chosenFeature: tier === "strong" ? first.feature : null,
      confidence: Number(first.score.toFixed(4)),
    };
    if (!best.candidates.length || result.confidence > best.confidence) best = result;
    if (tier === "strong") break;
  }
  return best;
}

function matchVerbFirst(text, verbs) {
  for (const verb of verbs) {
    if (text === verb || text.startsWith(`${verb} `)) {
      return { verb, rest: text.slice(verb.length).trim() };
    }
  }
  return null;
}

function splitClauses(normalized) {
  return normalized
    .split(/\s+(?:and then|then|and also)\s+|\s+and\s+|,\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function classifyClause(clause) {
  const nav = matchVerbFirst(clause, NAVIGATE_VERBS);
  if (nav) return { kind: "navigate", ...nav, clause };
  const explain = matchVerbFirst(clause, EXPLAIN_VERBS);
  if (explain) return { kind: "explain", ...explain, clause };
  return { kind: "other", verb: null, rest: clause, clause };
}

/**
 * Parse raw user text into a rich intent result. Deterministic: same input +
 * same feature list ⇒ same output.
 */
export function parseLunaIntent(rawText, features = []) {
  const list = Array.isArray(features) ? features.slice() : [];
  const input = safeText(rawText).trim().replace(/\s+/g, " ");
  const base = {
    input,
    firstSentence: "",
    grammarTruncated: false,
    normalizedInput: "",
    intent: "fallback",
    tier: "none",
    verb: null,
    target: "",
    candidates: [],
    chosenFeature: null,
    confidence: 0,
    multiIntent: false,
    thenNavigate: null,
    askOptions: [],
    advice: false,
    empty: false,
  };
  if (!input) return { ...base, intent: "help", empty: true };

  const firstSentence = takeFirstSentence(input);
  const capped = capWords(firstSentence, LUNA_MAX_PARSE_WORDS);
  const grammarTruncated = firstSentence.length < input.length || capped.truncated;
  const normalized = normalizeWithFillers(capped.text);
  Object.assign(base, {
    firstSentence,
    grammarTruncated,
    normalizedInput: normalized,
  });

  if (!normalized) {
    const greeted = GREET_PATTERN.test(` ${input.toLowerCase()} `);
    return { ...base, intent: greeted ? "greet" : "help", empty: !greeted };
  }
  if (UNDO_PATTERN.test(normalized)) return { ...base, intent: "undo" };
  if (CONTEXT_PATTERN.test(normalized)) return { ...base, intent: "context" };

  const clauses = splitClauses(normalized).map(classifyClause);
  const actionable = clauses.filter((clause) => clause.kind !== "other");
  if (actionable.length >= 2) {
    const [first, second] = actionable;
    const resolve = (part) => {
      const match = matchTargetCandidates(part.rest, list);
      return { match, label: match.chosenFeature?.label ?? part.rest };
    };
    const firstResolved = resolve(first);
    const secondResolved = resolve(second);
    if (first.kind === "explain" && second.kind === "navigate") {
      // Explain-before-open: do the explain now, offer the navigation after.
      if (firstResolved.match.chosenFeature && firstResolved.match.tier !== "weak") {
        return {
          ...base,
          intent: "explain",
          tier: firstResolved.match.tier,
          target: first.rest,
          candidates: firstResolved.match.candidates,
          chosenFeature: firstResolved.match.chosenFeature,
          confidence: firstResolved.match.confidence,
          multiIntent: true,
          thenNavigate: secondResolved.match.chosenFeature
            ? { id: secondResolved.match.chosenFeature.id, label: secondResolved.match.chosenFeature.label }
            : null,
        };
      }
    }
    const describe = (part, resolved) => (part.kind === "navigate"
      ? `open ${resolved.match.chosenFeature?.label ?? part.rest}`
      : `explain ${resolved.match.chosenFeature?.label ?? part.rest}`);
    return {
      ...base,
      intent: "clarify",
      tier: "ambiguous",
      multiIntent: true,
      candidates: [...firstResolved.match.candidates, ...secondResolved.match.candidates].slice(0, 3),
      askOptions: [],
      orderQuestion: `Which should I do first — ${describe(first, firstResolved)} or ${describe(second, secondResolved)}?`,
    };
  }

  const nav = matchVerbFirst(normalized, NAVIGATE_VERBS);
  if (nav) {
    const match = matchTargetCandidates(nav.rest, list);
    return {
      ...base,
      intent: "navigate",
      tier: match.tier,
      verb: nav.verb,
      target: nav.rest,
      candidates: match.candidates,
      chosenFeature: match.chosenFeature,
      confidence: match.confidence,
      askOptions: match.candidates.map((candidate) => candidate.label),
    };
  }

  const explain = matchVerbFirst(normalized, EXPLAIN_VERBS);
  if (explain) {
    const match = matchTargetCandidates(explain.rest, list);
    return {
      ...base,
      intent: "explain",
      tier: match.tier,
      verb: explain.verb,
      target: explain.rest,
      candidates: match.candidates,
      chosenFeature: match.chosenFeature,
      confidence: match.confidence,
      askOptions: match.candidates.map((candidate) => candidate.label),
    };
  }

  if (HELP_PATTERN.test(normalized)) return { ...base, intent: "help" };
  if (GREET_PATTERN.test(normalized)) return { ...base, intent: "greet" };

  // Bare target: no verb. Exact registry hits act; anything uncertain asks.
  const bare = matchTargetCandidates(normalized, list);
  if (bare.tier === "exact") {
    return {
      ...base,
      intent: "navigate",
      tier: "exact",
      target: normalized,
      candidates: bare.candidates,
      chosenFeature: bare.chosenFeature,
      confidence: 1,
    };
  }
  if (bare.tier === "strong" || bare.tier === "weak" || bare.tier === "ambiguous") {
    return {
      ...base,
      intent: "clarify",
      tier: bare.tier,
      target: normalized,
      candidates: bare.candidates,
      chosenFeature: null,
      confidence: bare.confidence,
      askOptions: bare.candidates.map((candidate) => candidate.label),
    };
  }

  if (ADVICE_PATTERN.test(` ${normalized} `)) return { ...base, advice: true };
  return base;
}

export default parseLunaIntent;
