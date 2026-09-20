/**
 * TypeSafe judgment provider seam for Living Reality (Bot Plaza + Contract Atelier).
 *
 * ARCHITECTURE LAW (TypeSafe): code owns the workflow; judgments supply narrow,
 * typed semantic calls (Choice / Score with probabilities + confidence). This
 * module asks exactly one narrow question per question, never generates prose,
 * never mutates anything, and never invents facts. Code decides what to do
 * with the answers.
 *
 * Question catalog:
 *   bot-intent          (Choice) — which Bot Plaza handler owns this message?
 *   bot-slot            (Choice) — which enabled bot did the message name?
 *   proposal-readiness  (Score)  — how ready is this proposal for review?
 *
 * Confidence policy: CLARIFY_THRESHOLD = 0.65. Below it, code must clarify or
 * confirm with Tumbo instead of acting. Never act blind.
 *
 * Providers:
 *   "heuristic" (DEFAULT) — deterministic local rules that mirror the existing
 *     bot-plaza trigger vocabulary (BOT_ATELIER_TEMPLATES rules, Bot Plaza
 *     capabilities, world actions). Byte-identical answers for byte-identical
 *     inputs. Honestly labeled `provider: "heuristic"`.
 *   "mock" — deterministic canned answers, for unit tests.
 *   "http" — live Jev judgments. Reads TYPESAFE_API_KEY / TYPESAFE_API_URL
 *     from the SERVER environment only (process.env — never shipped to client
 *     code, never in the browser bundle). Any failure — missing key or URL,
 *     network error, or a non-conforming answer — falls back to the heuristic
 *     provider so the demo never blocks and never acts blind. The local demo
 *     never configures these variables, so live Jev is never active here.
 *
 * Hard boundaries: simulated TUMBO / rehearsal points only. No wallet, no
 * chain, no custody, no mainnet, no real money. This module makes no network
 * calls unless the "http" provider is explicitly selected AND server-side
 * credentials are present — and even then it degrades to heuristic on failure.
 */

export const JUDGMENTS_MODULE_VERSION = 1;
export const JUDGMENTS_SOURCE = "ai-judgments";

/** Below this confidence, code must clarify/confirm instead of acting. */
export const CLARIFY_THRESHOLD = 0.65;

export const JUDGMENT_PROVIDERS = Object.freeze(["mock", "heuristic", "http"]);\nexport const JEV_DEFAULT_MODEL = "jev-latest";\nexport const JEV_DEFAULT_TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";\nexport const JEV_DEFAULT_AGENT_ENDPOINT = "https://jev-agent.com/api/v1/systemone";\nexport const JEV_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Bot Plaza intents (Choice). One narrow question: which handler owns the turn?
// The vocabulary mirrors the bot-plaza trigger rules and the Bot Plaza
// capability set — code-owned keywords, never a judgment.
// ---------------------------------------------------------------------------

export const BOT_INTENTS = Object.freeze([
  "chat",
  "world_action",
  "draft_contract",
  "propose_contract",
  "journal",
  "message_bots",
  "announce",
  "explain_contract",
  "help",
  "no_match",
]);

const INTENT_LABELS = {
  chat: "a chat",
  world_action: "a world action",
  draft_contract: "drafting a contract",
  propose_contract: "proposing a contract for your review",
  journal: "a journal entry",
  message_bots: "messaging another bot",
  announce: "an announcement",
  explain_contract: "explaining a contract",
  help: "help",
  no_match: "something I don't recognize",
};

export function intentLabel(intent) {
  return INTENT_LABELS[intent] ?? String(intent);
}

// Ordered rules. Phrases score 3x; tokens 1x. The heuristic mirrors the
// existing bot-plaza trigger vocabulary ("scout", "contract", journal notes,
// world actions, announcements) in this precedence order.
const INTENT_RULES = [
  {
    intent: "propose_contract",
    phrases: ["scout it", "scout this", "scout them", "bring it to me", "bring them to me", "bring me", "put up for review", "for your review", "for my review", "for review", "bring to review", "propose it", "bring it"],
    tokens: ["scout", "propose", "review"],
    weight: 2,
  },
  {
    intent: "draft_contract",
    phrases: ["draft a contract", "draft contract", "draft the contract", "write a contract", "write up a contract", "draft it", "write it up"],
    tokens: ["draft"],
    weight: 2,
  },
  {
    intent: "message_bots",
    phrases: ["tell the other bot", "tell another bot", "ask the other bot", "ask another bot", "tell them", "ask them", "other bots", "other bot", "pass it to", "relay to"],
    tokens: ["relay"],
    weight: 2,
  },
  {
    intent: "announce",
    phrases: ["announce", "broadcast", "plaza-wide", "tell everyone"],
    tokens: ["announcement"],
    weight: 2,
  },
  {
    intent: "journal",
    phrases: ["journal", "write it down", "log this", "log it", "note this", "note it down", "make a note"],
    tokens: ["log", "note"],
    weight: 2,
  },
  {
    intent: "explain_contract",
    phrases: ["explain the contract", "explain this contract", "explain that contract", "what does the contract", "what do the terms", "contract terms", "what are the terms"],
    tokens: ["explain"],
    weight: 2,
  },
  {
    intent: "world_action",
    phrases: ["focus cube", "focus the cube", "open the cube", "open cube", "select the cube", "select cube", "move camera", "move the camera", "launch feature", "launch the feature", "open feature", "glide the camera"],
    tokens: ["cube", "cubes", "camera", "feature", "focus", "select", "glide", "highlight"],
    weight: 1,
  },
  {
    intent: "help",
    phrases: ["help", "what can you do", "how does this work", "what are your capabilities", "how do i use"],
    tokens: ["capabilities"],
    weight: 2,
  },
  {
    intent: "chat",
    phrases: ["hello", "hi there", "hey", "good morning", "good evening", "good afternoon", "how are you", "thank you", "thanks"],
    tokens: ["please", "sure", "okay", "cool"],
    weight: 1,
  },
];

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Precompile phrase matchers with real word boundaries so "draft a contract"
// still matches inside "draft a contract and tell the other bot…".
for (const rule of INTENT_RULES) {
  rule.matchers = rule.phrases.map((phrase) => new RegExp(`\\b${escapeRegExp(phrase)}\\b`));
}

function softmax(scores) {
  const exps = scores.map((entry) => Math.exp(entry.score));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  const probabilities = {};
  scores.forEach((entry, index) => {
    probabilities[entry.intent] = Math.round((exps[index] / total) * 10000) / 10000;
  });
  return probabilities;
}

/**
 * Deterministic heuristic for the bot-intent Choice question. Mirrors the
 * existing bot-plaza trigger vocabulary in precedence order.
 *
 * state: { message } — the raw user message.
 * Returns { choice, probabilities, confidence } following the TypeSafe Choice
 * contract. Real ambiguity (top two intents within 3 points) reports
 * confidence below CLARIFY_THRESHOLD.
 */
export function routeBotIntentHeuristic(state = {}) {
  const raw = String(state?.message ?? "");
  const normalized = normalizeText(raw);
  const words = new Set(normalized.split(" ").filter(Boolean));

  if (!normalized) {
    return {
      choice: "no_match",
      probabilities: softmax(BOT_INTENTS.map((intent) => ({ intent, score: intent === "no_match" ? 6 : 0 }))),
      confidence: 0.95,
    };
  }

  const scores = INTENT_RULES.map((rule) => {
    let score = 0;
    for (const matcher of rule.matchers) {
      if (matcher.test(normalized)) score += 3 * rule.weight;
    }
    for (const token of rule.tokens) {
      if (words.has(token)) score += 1 * rule.weight;
    }
    return { intent: rule.intent, score };
  });

  const ranked = [...scores].sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const runnerUp = ranked[1];

  if (top.score <= 0) {
    return {
      choice: "no_match",
      probabilities: softmax(BOT_INTENTS.map((intent) => ({ intent, score: intent === "no_match" ? 6 : 0 }))),
      confidence: 0.85,
    };
  }

  const probabilities = softmax(scores.concat({ intent: "no_match", score: 0 }));
  const ambiguous = top.score - runnerUp.score < 3;
  const confidence = ambiguous
    ? Math.round(Math.min(0.62, probabilities[top.intent]) * 100) / 100
    : Math.round(Math.min(0.97, Math.max(0.66, probabilities[top.intent])) * 100) / 100;

  return { choice: top.intent, probabilities, confidence };
}

/**
 * botIntentQuestion() — Choice over BOT_INTENTS. Criteria describe the Bot
 * Plaza capabilities so a live model can pick the right handler.
 */
export function botIntentQuestion() {
  return {
    id: "bot-intent",
    kind: "choice",
    instructions:
      "Which Bot Plaza handler owns this user message? Read the message, then pick exactly one intent.",
    criteria: {
      chat: "plain conversation with a bot",
      world_action: "cube/camera/feature actions in the 3D world (focus, select, open cubes; move camera; launch a feature)",
      draft_contract: "drafting a contract text (a local DRAFT proposal; nothing executes)",
      propose_contract: "drafting a structured outcome-contract proposal to bring to Tumbo for review in the Contract Atelier",
      journal: "writing an entry into the plaza journal (local)",
      message_bots: "sending a message to another bot in the plaza",
      announce: "a plaza-wide announcement",
      explain_contract: "explaining a contract's terms or logic",
      help: "asking what bots can do",
      no_match: "nothing above fits",
    },
    options: [...BOT_INTENTS],
  };
}

// ---------------------------------------------------------------------------
// Bot slot (Choice). Code finds candidates by name-token matching; the
// judgment selects the intended one. Real ambiguity -> the "none" choice.
// ---------------------------------------------------------------------------

/**
 * slotBotQuestion(candidates) — Choice over candidate bot ids + "none".
 * candidates: [{ id, label, matchScore }] where matchScore is 3 = full bot
 * name mentioned, 2 = a name token matched, 1 = weak token overlap.
 * Always includes the "none" outcome (select, don't generate).
 */
export function slotBotQuestion(candidates = []) {
  const ids = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => String(candidate?.id ?? ""))
    .filter(Boolean);
  return {
    id: "bot-slot",
    kind: "choice",
    instructions:
      "Which bot did the message refer to? Pick exactly one candidate bot id, or \"none\" when the message names no clear bot.",
    criteria: {
      note: "Candidates were found by code matching bot names in the message. Prefer the strongest name match; choose \"none\" when two or more candidates are equally plausible or the match is weak.",
    },
    options: [...ids, "none"],
  };
}

const LOW_SLOT_CONFIDENCE = 0.35;

/**
 * Deterministic heuristic for the bot-slot Choice question.
 * Unique top candidate with matchScore >= 2 resolves; ties, weak (score 1)
 * matches, or zero candidates resolve to "none" (0.9 when no candidates at
 * all, 0.35 under real ambiguity — a confirmation case for code).
 */
export function selectSlotHeuristic(candidates = []) {
  const list = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({
      id: String(candidate?.id ?? ""),
      matchScore: Number(candidate?.matchScore) || 0,
    }))
    .filter((candidate) => candidate.id);
  const options = [...list.map((candidate) => candidate.id), "none"];

  if (!list.length) {
    return {
      choice: "none",
      probabilities: Object.fromEntries(options.map((option) => [option, option === "none" ? 0.9 : 0])),
      confidence: 0.9,
    };
  }

  const ranked = [...list].sort((a, b) => b.matchScore - a.matchScore);
  const top = ranked[0];
  const tied = ranked.filter((candidate) => candidate.matchScore === top.matchScore);

  if (tied.length === 1 && top.matchScore >= 2) {
    const probabilities = {};
    options.forEach((option) => {
      probabilities[option] = option === top.id ? 0.85 : option === "none" ? 0.05 : 0.1 / Math.max(1, options.length - 2);
    });
    return { choice: top.id, probabilities, confidence: 0.85 };
  }

  // Real ambiguity (tie) or a weak token-overlap match: ask, don't guess.
  const probabilities = {};
  options.forEach((option) => {
    probabilities[option] = option === "none" ? 0.65 : 0.35 / Math.max(1, options.length - 1);
  });
  return { choice: "none", probabilities, confidence: LOW_SLOT_CONFIDENCE };
}

// ---------------------------------------------------------------------------
// Proposal readiness (Score). Deterministic readiness from proposal fields.
// ---------------------------------------------------------------------------

/**
 * Deterministic readiness score (0..1) from proposal fields: title, event
 * label, outcomes, stake range, source/research notes, pending status, and
 * freshness. Returns { score, probabilities, confidence, reasons[] }.
 *
 * options: { now } — timestamp source (default Date.now). Pass a fixed `now`
 * in tests for byte-identical answers.
 */
export function scoreProposalHeuristic(proposal = {}, { now = null } = {}) {
  const reasons = [];
  let points = 0;
  const add = (value, reason) => {
    points += value;
    if (reason) reasons.push(reason);
  };

  const title = String(proposal?.title ?? "").trim();
  const eventLabel = String(proposal?.eventLabel ?? "").trim();
  const outcomes = Array.isArray(proposal?.outcomes) ? proposal.outcomes : [];
  const minStake = proposal?.minStake;
  const maxStake = proposal?.maxStake;
  const sourceNotes = String(proposal?.sourceNotes ?? "").trim();
  const researchNotes = String(proposal?.researchNotes ?? "").trim();
  const status = String(proposal?.status ?? "");
  const eventId = String(proposal?.eventId ?? "").trim();

  if (title) add(10, "clear title");
  else reasons.push("missing title");

  if (eventLabel) add(15, "event named");
  else reasons.push("missing event label");

  const distinctOutcomes = new Set(outcomes.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean));
  if (distinctOutcomes.size >= 2) {
    const outcomePoints = Math.min(20, 5 * distinctOutcomes.size);
    add(outcomePoints, `${distinctOutcomes.size} distinct outcomes`);
  } else {
    reasons.push("needs at least 2 distinct outcomes");
  }

  const validStake = (value) => Number.isInteger(value) && value > 0;
  if (validStake(minStake)) add(10, "minimum stake set");
  else reasons.push("no minimum stake");
  if (validStake(maxStake)) add(10, "maximum stake set");
  else reasons.push("no maximum stake");
  if (validStake(minStake) && validStake(maxStake)) {
    if (minStake <= maxStake) add(5, "stake range is sane");
    else reasons.push("minimum stake exceeds maximum stake");
  }

  if (sourceNotes) add(10, "source notes attached");
  else reasons.push("no source notes");
  if (researchNotes) add(10, "research notes attached");
  else reasons.push("no research notes");

  if (status === "pending") add(5, "still pending review");
  else if (status) reasons.push(`status is ${status}, not pending`);
  else reasons.push("status unknown");

  if (eventId) add(5, "event id pinned");

  const nowMs = typeof now === "number" ? now : Date.now();
  const createdMs = Date.parse(proposal?.createdAt);
  if (Number.isFinite(createdMs)) {
    const ageMs = nowMs - createdMs;
    if (ageMs >= 0 && ageMs <= 72 * 3600 * 1000) {
      reasons.push("freshly submitted");
    } else if (ageMs > 72 * 3600 * 1000) {
      reasons.push("submitted over 72h ago");
    }
  }

  const score = Math.round((points / 100) * 100) / 100;
  return {
    score,
    probabilities: { ready: score, not_ready: Math.round((1 - score) * 100) / 100 },
    confidence: 0.9,
    reasons,
  };
}

/**
 * proposalReadinessQuestion() — Score 0..1: how ready is this proposal for
 * Tumbo's review in "Contracts for your review"?
 */
export function proposalReadinessQuestion() {
  return {
    id: "proposal-readiness",
    kind: "score",
    instructions:
      "How ready is this contract proposal for Tumbo's review? Level 1 = fully reviewable; level 0 = not reviewable.",
    criteria: [
      "not reviewable: missing required proposal fields, invalid stake range, or no longer pending",
      "fully reviewable: clear title, named event, at least two distinct outcomes, sane min/max stake range, source and research notes, and pending status",
    ],
  };
}

// ---------------------------------------------------------------------------
// Provider seam
// ---------------------------------------------------------------------------

/**
 * True when the judgment answer's confidence is below the threshold —
 * code must clarify/confirm instead of acting.
 */
export function belowThreshold(answer, threshold = CLARIFY_THRESHOLD) {
  const confidence = Number(answer?.confidence);
  if (!Number.isFinite(confidence)) return true;
  return confidence < threshold;
}

/**
 * Selects the judgment provider from the TYPESAFE_JUDGMENTS environment
 * variable (mock | heuristic | http). Defaults to "heuristic" — deterministic
 * and local. Anything unrecognized also defaults to "heuristic".
 */
export function selectProvider() {
  const raw = (() => {
    try {
      return typeof process !== "undefined" ? process.env?.TYPESAFE_JUDGMENTS : undefined;
    } catch {
      return undefined;
    }
  })();
  const wanted = String(raw ?? "").trim().toLowerCase();
  return JUDGMENT_PROVIDERS.includes(wanted) ? wanted : "heuristic";
}

function heuristicAnswer(question, state) {
  if (question.kind === "choice" && question.id === "bot-intent") {
    return { kind: "choice", answer: routeBotIntentHeuristic(state) };
  }
  if (question.kind === "choice" && question.id === "bot-slot") {
    return { kind: "choice", answer: selectSlotHeuristic(state?.candidates) };
  }
  if (question.kind === "score" && question.id === "proposal-readiness") {
    const judged = scoreProposalHeuristic(state?.proposal, { now: state?.now ?? null });
    return {
      kind: "score",
      answer: { score: judged.score, probabilities: judged.probabilities, confidence: judged.confidence },
    };
  }
  throw new TypeError(`heuristic has no rule for question ${question?.id}`);
}

const MOCK_ANSWERS = {
  "bot-intent": { kind: "choice", answer: { choice: "chat", probabilities: { chat: 1 }, confidence: 1 } },
  "bot-slot": { kind: "choice", answer: { choice: "none", probabilities: { none: 1 }, confidence: 1 } },
  "proposal-readiness": { kind: "score", answer: { score: 0.5, probabilities: { ready: 0.5, not_ready: 0.5 }, confidence: 1 } },
};

function mockAnswer(question) {
  const canned = MOCK_ANSWERS[question?.id];
  if (!canned) throw new TypeError(`mock has no canned answer for question ${question?.id}`);
  return JSON.parse(JSON.stringify(canned));
}

function readServerEnv(name) {
  // Server-side only: in a browser bundle process is undefined and this
  // returns undefined, so API keys can never leak into client code.
  try {
    if (typeof process !== "undefined" && process.env) return process.env[name];
  } catch {
    // ignore
  }
  return undefined;
}

function serverJevConfig() {
  const typesafeKey = readServerEnv("TYPESAFE_API_KEY");
  const jevKey = readServerEnv("JEV_AGENT_KEY") ?? readServerEnv("JEV_API_KEY");
  const explicitUrl = readServerEnv("JEV_API_URL") ?? readServerEnv("TYPESAFE_API_URL");
  const model = readServerEnv("JEV_MODEL") || JEV_DEFAULT_MODEL;

  if (explicitUrl) {
    const key = typesafeKey || jevKey;
    return key ? { key, url: explicitUrl, model } : { key: null, url: explicitUrl, model };
  }
  if (typesafeKey) {
    return { key: typesafeKey, url: JEV_DEFAULT_TYPESAFE_ENDPOINT, model };
  }
  if (jevKey) {
    return { key: jevKey, url: JEV_DEFAULT_AGENT_ENDPOINT, model };
  }
  return { key: null, url: null, model };
}

function toJevQuestion(question, state) {
  const kind = question?.kind === "choice"
    ? "choice"
    : question?.kind === "score"
      ? "score"
      : "noul";

  if (kind === "choice") {
    const options = Array.isArray(question?.options) ? question.options.map(String) : null;
    let criteria = question?.criteria;

    if (question?.id === "bot-slot" && options) {
      const candidates = Array.isArray(state?.candidates) ? state.candidates : [];
      const byId = new Map(candidates.map((candidate) => [
        String(candidate?.id ?? ""),
        String(candidate?.label ?? candidate?.id ?? "candidate bot"),
      ]));
      criteria = Object.fromEntries(options.map((option) => [
        option,
        option === "none"
          ? "no clear bot was named"
          : "candidate bot selected by code from name matching: " + (byId.get(option) ?? "named candidate"),
      ]));
    } else if (options) {
      const existing = criteria && typeof criteria === "object" ? criteria : {};
      criteria = Object.fromEntries(options.map((option) => [option, existing[option] ?? null]));
    }

    return {
      type: "choice",
      instructions: String(question?.instructions ?? ""),
      criteria: criteria && typeof criteria === "object" ? criteria : {},
    };
  }

  if (kind === "score") {
    return {
      type: "score",
      instructions: String(question?.instructions ?? ""),
      criteria: Array.isArray(question?.criteria) ? question.criteria : [],
    };
  }

  return {
    type: "noul",
    instructions: String(question?.instructions ?? ""),
    ...(question?.criteria === undefined ? {} : { criteria: question.criteria }),
  };
}

function validProbabilityMap(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).length > 0
    && Object.values(value).every((entry) => {
      const numberValue = Number(entry);
      return Number.isFinite(numberValue) && numberValue >= 0 && numberValue <= 1;
    });
}

function validateJevAnswer(question, rawAnswer) {
  if (!rawAnswer || typeof rawAnswer !== "object") return null;

  if (question?.kind === "choice") {
    const choice = String(rawAnswer.choice ?? "");
    const options = Array.isArray(question?.options)
      ? question.options.map(String)
      : Object.keys(question?.criteria ?? {});
    const confidence = Number(rawAnswer.confidence);

    if (!options.includes(choice) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
    if (!validProbabilityMap(rawAnswer.probabilities)) return null;

    return {
      kind: "choice",
      answer: {
        choice,
        probabilities: rawAnswer.probabilities,
        confidence,
      },
    };
  }

  if (question?.kind === "score") {
    // Jev Score is a probability-weighted index. This question deliberately
    // has exactly two levels, so the result is normalized to the local 0..1
    // readiness convention used by the existing UI and heuristic.
    const score = Number(rawAnswer.score);
    const confidence = Number(rawAnswer.confidence);
    if (!Number.isFinite(score) || score < 0 || score > 1) return null;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
    if (!validProbabilityMap(rawAnswer.probabilities)) return null;

    return {
      kind: "score",
      answer: {
        score,
        probabilities: rawAnswer.probabilities,
        confidence,
        legend: rawAnswer.legend ?? null,
      },
    };
  }

  if (question?.kind === "noul") {
    const noul = Number(rawAnswer.noul);
    if (!Number.isFinite(noul) || noul < 0 || noul > 1) return null;
    return { kind: "noul", answer: { noul } };
  }

  return null;
}

async function fetchJevDecision(state, questions, config) {
  if (typeof fetch !== "function") throw new Error("server fetch unavailable");

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = setTimeout(() => controller?.abort(), JEV_TIMEOUT_MS);

  try {
    const bodyQuestions = {};
    for (const question of questions) {
      bodyQuestions[question.id] = toJevQuestion(question, state);
    }

    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        state,
        questions: bodyQuestions,
      }),
      signal: controller?.signal,
    });

    if (!response.ok) {
      throw new Error("Jev request failed with HTTP " + response.status);
    }

    const payload = await response.json();
    if (!payload?.answers || typeof payload.answers !== "object") {
      throw new Error("Jev response did not include answers");
    }

    const answers = {};
    for (const question of questions) {
      const normalized = validateJevAnswer(question, payload.answers[question.id]);
      if (!normalized) throw new Error("Jev returned a non-conforming answer for " + question.id);
      answers[question.id] = normalized;
    }

    return {
      answers,
      provider: "jev",
      model: String(payload.model ?? config.model),
      usage: payload.usage ?? null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * askJudgments(state, questions, provider?) — independent questions can be
 * fanned out in one Jev request. Live Jev is server-only; the public static
 * browser keeps using the deterministic heuristic unless a trusted server
 * explicitly selects the HTTP provider with a secret key.
 */
export async function askJudgments(state = {}, questions = [], provider = undefined) {
  const requested = provider ?? selectProvider();
  const list = Array.isArray(questions) ? questions : [questions];

  if (requested === "mock") {
    const answers = {};
    for (const question of list) answers[question.id] = mockAnswer(question);
    return { answers, provider: "mock" };
  }

  if (requested === "http") {
    const config = serverJevConfig();
    if (!config.key || !config.url) {
      const answers = {};
      for (const question of list) answers[question.id] = heuristicAnswer(question, state);
      return { answers, provider: "heuristic" };
    }

    try {
      return await fetchJevDecision(state, list, config);
    } catch {
      const answers = {};
      for (const question of list) answers[question.id] = heuristicAnswer(question, state);
      return { answers, provider: "heuristic" };
    }
  }

  const answers = {};
  for (const question of list) answers[question.id] = heuristicAnswer(question, state);
  return { answers, provider: "heuristic" };
}
