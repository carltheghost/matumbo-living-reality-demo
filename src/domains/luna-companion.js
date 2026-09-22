/**
 * Luna Companion — a scripted local guide for the Living Reality demo.
 *
 * Luna is NOT an AI model. There is no conversation service, no network
 * fetch, and no memory past this page session. Every reply is produced by
 * local deterministic intent parsing (see ./luna-intent.js) against an
 * injected feature list. Luna navigates and explains only: it triggers the
 * same feature-open path a click would, and it cannot mint, burn, transfer,
 * settle, post, or change any world state.
 *
 * Hardened intent contract (adversarial review, 2026-09-18):
 * certainty → action, uncertainty → conversation, unknown → guidance.
 */

import { parseLunaIntent } from "./luna-intent.js?v=20260922-cache2";

export const LUNA_SCHEMA_VERSION = 2;
export const LUNA_SOURCE = "luna-companion";
export const LUNA_CONSOLE_SOURCE = "luna-companion-console";
export const LUNA_UPDATED_AT = "2026-09-18T00:00:00.000Z";
export const LUNA_MAX_MESSAGE_LENGTH = 240;
export const LUNA_MAX_HISTORY = 40;

export const LUNA_BOUNDARY =
  "Luna is a scripted local guide. No AI model, conversation service, or network is connected. Luna navigates and explains only; it changes nothing you could not click yourself, and it remembers nothing past this page session.";

const HELP_EMPTY_REPLY =
  "I'm ready. You can ask me to open a feature, explain a place, or show what you can do.";

/**
 * Raw-input policy checks, applied before the grammar's filler stripping.
 * The grammar strips filler phrases ("can you" turns "what can you do?"
 * into "what do"), and weak fuzzy matches can shadow the advice flag, so
 * these two policies are decided on the raw text — exactly as the previous
 * domain generation did. The grammar module itself is not modified.
 */
const RAW_HELP_PATTERN = /^(help|what can you do|how do you work|commands)\b/i;
const RAW_ADVICE_PATTERN = /\b(invest|investing|buy|sell|stock|crypto|bet|betting|odds|wager|legal|lawsuit|lawyer|medical|doctor|diagnos|symptom|treatment|prescription)\b/i;

const freeze = (value) => {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** Deterministic FNV-1a hash; keeps Luna's suggestions stable per seed. */
export function hashLunaSeed(value) {
  const text = safeText(value, "luna-local");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function nowIso(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    // null/undefined/"" mean "no injected clock": use the wall clock.
    // (new Date(null) would silently become the 1970 epoch.)
    if (value === null || value === undefined || value === "") {
      return new Date().toISOString();
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Fall through to the wall clock; tests inject `now`.
  }
  return new Date().toISOString();
}

function featureText(feature) {
  return `${safeText(feature.id)} ${safeText(feature.label)} ${safeText(feature.kicker)}`.toLowerCase();
}

/** Last-resort suggestions for inputs the grammar cannot place at all. */
function closestLabels(features, rawQuery, count = 3) {
  const query = safeText(rawQuery)
    .toLowerCase()
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = query.split(" ").filter(Boolean);
  const scored = features.map((feature, index) => {
    const haystack = featureText(feature);
    const overlap = words.filter((word) => haystack.includes(word)).length;
    return { feature, overlap, index };
  });
  scored.sort((a, b) => b.overlap - a.overlap || a.index - b.index);
  return scored.slice(0, count).map((entry) => entry.feature.label);
}

function formatOptions(labels) {
  const quoted = labels.slice(0, 3).map((label) => `"${label}"`);
  if (quoted.length === 0) return null;
  if (quoted.length === 1) return `${quoted[0]}?`;
  if (quoted.length === 2) return `${quoted[0]} or ${quoted[1]}?`;
  return `${quoted[0]}, ${quoted[1]}, or ${quoted[2]}?`;
}

function cleanTarget(target) {
  return safeText(target).replace(/^the\s+/i, "").trim();
}

function firstWords(text, count) {
  const words = safeText(text).split(/\s+/).filter(Boolean);
  const head = words.slice(0, count).join(" ");
  return words.length > count ? `${head}…` : head;
}

/**
 * Create the scripted Luna companion. `features` is the FEATURE_DEFINITIONS
 * list injected by the renderer (keeps the domain decoupled from the
 * navigator module). `now` is injectable for deterministic tests.
 */
export function createLunaCompanion({ seed = "luna-local", now = null, features = [] } = {}) {
  const lunaSeed = safeText(seed) || "luna-local";
  const featureList = Array.isArray(features) ? features.slice() : [];
  const history = [];
  const trace = [];
  const intentCounts = {
    navigate: 0,
    explain: 0,
    context: 0,
    help: 0,
    greet: 0,
    clarify: 0,
    undo: 0,
    fallback: 0,
  };
  let sequence = 0;
  let suggestCounter = 0;
  const suggestOffset = parseInt(hashLunaSeed(`${lunaSeed}:suggest`), 16) % 997;
  // Session navigation state for the undo pattern (R3). Never persisted.
  let currentFeatureId = null;
  let previousFeatureId = null;

  function recordTrace({ intent, featureId, normalizedInput, candidateFeatures, chosenFeature, confidence }) {
    sequence += 1;
    trace.push(freeze({
      seq: sequence,
      intent,
      normalizedInput: safeText(normalizedInput),
      candidateFeatures: candidateFeatures ?? [],
      chosenFeature: chosenFeature ?? null,
      confidence: Number(confidence) || 0,
      featureId: featureId ?? null,
      at: nowIso(now),
      simulation: true,
    }));
  }

  function recordTurn(role, text) {
    history.push(freeze({ role, text: safeText(text), at: nowIso(now) }));
    while (history.length > LUNA_MAX_HISTORY) history.shift();
  }

  function suggestionLine(visited = []) {
    const suggestion = suggestUnvisited(visited);
    if (!suggestion) return "Ask me to open any feature by name.";
    return `Try: "take me to the ${suggestion.label}".`;
  }

  function suggestUnvisited(visited = []) {
    const visitedSet = new Set((Array.isArray(visited) ? visited : []).map((id) => safeText(id)));
    const pool = featureList.filter((feature) => !visitedSet.has(safeText(feature.id)));
    const source = pool.length ? pool : featureList;
    if (!source.length) return null;
    const pick = source[(suggestOffset + suggestCounter) % source.length];
    suggestCounter += 1;
    return freeze({ id: pick.id, label: pick.label, kicker: pick.kicker });
  }

  /**
   * Resolve the caller-supplied current feature against the injected registry.
   * Luna never claims "you are inside X" unless the navigator confirms it.
   */
  function resolveCurrentFeature(currentFeature) {
    if (!currentFeature) return null;
    const id = typeof currentFeature === "object"
      ? safeText(currentFeature.id)
      : safeText(currentFeature);
    if (!id) return null;
    return featureList.find((feature) => safeText(feature.id) === id) ?? null;
  }

  function navigateTo(target) {
    const featureId = safeText(target.id);
    previousFeatureId = currentFeatureId;
    currentFeatureId = featureId;
    return featureId;
  }

  function respond({ text, currentFeature = null } = {}) {
    // Display copy is trimmed for the log; the grammar always sees the full
    // input so first-sentence priority applies to long rambles.
    const rawInput = safeText(text).trim().replace(/\s+/g, " ");
    let display = rawInput;
    let trimmedNote = "";
    if (display.length > LUNA_MAX_MESSAGE_LENGTH) {
      display = display.slice(0, LUNA_MAX_MESSAGE_LENGTH);
      trimmedNote = " (I trimmed your message to 240 characters.)";
    }
    const at = nowIso(now);
    // Policy pre-checks on the raw input (see RAW_HELP_PATTERN /
    // RAW_ADVICE_PATTERN above): help first, then advice — the old precedence.
    const baseParse = parseLunaIntent(rawInput, featureList);
    const parse = rawInput.length > 0 && RAW_HELP_PATTERN.test(rawInput)
      ? { ...baseParse, intent: "help" }
      : RAW_ADVICE_PATTERN.test(` ${rawInput.toLowerCase()} `)
        ? { ...baseParse, intent: "fallback", advice: true }
        : baseParse;

    let intent = "fallback";
    let featureId = null;
    let askOptions = [];
    let thenNavigate = null;
    let reply = "";

    const grammarPrefix = parse.grammarTruncated
      ? `I understood the first part: "${firstWords(parse.firstSentence, 12)}". `
      : "";

    switch (parse.intent) {
      case "help": {
        intent = "help";
        reply = parse.empty
          ? HELP_EMPTY_REPLY
          : `I open features by name ("take me to the arena"), explain what a place does ("what is paycore?"), and narrate where you are ("where am I?"). ${LUNA_BOUNDARY}`;
        break;
      }
      case "greet": {
        intent = "greet";
        reply = `Hello! I'm Luna — a scripted local guide, not an AI. I live in this page and forget everything when it closes. ${suggestionLine()}`;
        break;
      }
      case "navigate": {
        if (parse.chosenFeature && (parse.tier === "exact" || parse.tier === "strong")) {
          const target = parse.chosenFeature;
          intent = "navigate";
          featureId = navigateTo(target);
          reply = parse.tier === "exact"
            ? `Opening ${target.label} — ${safeText(target.kicker) || "local rehearsal"}.`
            : `I think you mean ${target.label}. Taking you there.`;
        } else if (parse.tier === "weak" && parse.askOptions.length > 0) {
          // Weak fuzzy: ask with suggestions, never navigate on uncertainty (R1).
          intent = "clarify";
          askOptions = parse.askOptions.slice(0, 3);
          reply = `Did you mean ${formatOptions(askOptions)}`;
        } else {
          // Verb with no recognized target, or nothing viable: guidance (R5).
          intent = "fallback";
          const target = cleanTarget(parse.target).slice(0, 60) || "that";
          reply = `I don't have access to "${target}". I can guide you through available features — ask "what can you do?"`;
        }
        break;
      }
      case "explain": {
        if (parse.chosenFeature) {
          const target = parse.chosenFeature;
          intent = "explain";
          featureId = safeText(target.id);
          reply = `${target.label} — ${safeText(target.description)} Boundary: ${safeText(target.boundary)}`;
          if (parse.multiIntent && parse.thenNavigate) {
            thenNavigate = freeze({
              id: safeText(parse.thenNavigate.id),
              label: safeText(parse.thenNavigate.label),
            });
            reply += ` Want me to open ${thenNavigate.label} next? Say "open ${thenNavigate.label}".`;
          }
        } else if (parse.askOptions.length > 0) {
          intent = "clarify";
          askOptions = parse.askOptions.slice(0, 3);
          const target = cleanTarget(parse.target).slice(0, 60) || "that";
          reply = `I couldn't find "${target}" to explain. Did you mean ${formatOptions(askOptions)}`;
        } else {
          intent = "fallback";
          const target = cleanTarget(parse.target).slice(0, 60) || "that";
          reply = `I don't know a feature called "${target}". Ask "what can you do?" to see what I cover.`;
        }
        break;
      }
      case "clarify": {
        intent = "clarify";
        if (parse.orderQuestion) {
          // Multi-intent: never execute two navigations; ask the order.
          reply = parse.orderQuestion;
        } else {
          askOptions = parse.askOptions.slice(0, 3);
          const options = formatOptions(askOptions);
          if (parse.tier === "ambiguous") {
            const target = cleanTarget(parse.target).slice(0, 40) || "that";
            reply = `I found multiple places related to "${target}". Did you mean ${options}`;
          } else {
            reply = `Did you mean ${options}`;
          }
        }
        break;
      }
      case "context": {
        intent = "context";
        const current = resolveCurrentFeature(currentFeature);
        if (current && safeText(current.label)) {
          featureId = safeText(current.id) || null;
          reply = `You are in ${current.label} — ${safeText(current.kicker) || "local rehearsal"}. ${safeText(current.boundary)}`;
        } else {
          const areas = featureList
            .slice(0, 5)
            .map((feature) => safeText(feature.label))
            .filter(Boolean)
            .join(", ");
          reply = `You are at the Living Reality starting view. Available areas include ${areas}. Ask me to open one by name.`;
        }
        break;
      }
      case "undo": {
        intent = "undo";
        if (previousFeatureId) {
          const target = featureList.find((feature) => safeText(feature.id) === previousFeatureId);
          const label = target ? safeText(target.label) : previousFeatureId;
          featureId = previousFeatureId;
          const swap = currentFeatureId;
          currentFeatureId = previousFeatureId;
          previousFeatureId = swap;
          reply = `Going back to ${label} — same as clicking it.`;
        } else {
          reply = "There's nothing to undo yet — I haven't opened anything this session.";
        }
        break;
      }
      default: {
        intent = "fallback";
        if (parse.advice) {
          reply = `I can't help with that — I only navigate and explain features. ${LUNA_BOUNDARY}`;
        } else {
          const suggestions = closestLabels(featureList, rawInput);
          reply = `I didn't catch that… ${suggestionLine()} Or ask "what can you do?" — closest features to your words: ${suggestions.map((label) => `"${label}"`).join(", ")}.`;
        }
        break;
      }
    }

    reply = `${grammarPrefix}${reply}${trimmedNote}`;

    const intentTrace = freeze({
      input: rawInput,
      normalizedInput: parse.normalizedInput,
      intent,
      candidateFeatures: freeze(parse.candidates.map((candidate) => safeText(candidate.id))),
      chosenFeature: parse.chosenFeature ? safeText(parse.chosenFeature.id) : null,
      confidence: Number(parse.confidence) || 0,
    });

    intentCounts[intent] = (intentCounts[intent] ?? 0) + 1;
    recordTrace({
      intent,
      featureId,
      normalizedInput: parse.normalizedInput,
      candidateFeatures: intentTrace.candidateFeatures,
      chosenFeature: intentTrace.chosenFeature,
      confidence: intentTrace.confidence,
    });
    recordTurn("user", display);
    recordTurn("luna", reply);
    return freeze({
      reply,
      intent,
      featureId,
      at,
      askOptions: freeze(askOptions.slice()),
      thenNavigate,
      intentTrace,
    });
  }

  function historyView() {
    return freeze(history.slice());
  }

  function clear() {
    history.length = 0;
    trace.length = 0;
    sequence = 0;
    suggestCounter = 0;
    currentFeatureId = null;
    previousFeatureId = null;
    Object.keys(intentCounts).forEach((key) => { intentCounts[key] = 0; });
    return getSnapshot();
  }

  function getSnapshot() {
    return freeze({
      schemaVersion: LUNA_SCHEMA_VERSION,
      source: LUNA_SOURCE,
      seed: lunaSeed,
      simulation: true,
      localOnly: true,
      turns: history.length,
      intents: freeze({ ...intentCounts }),
      trace: freeze(trace.slice(-12)),
      boundary: LUNA_BOUNDARY,
      network: false,
      persistence: false,
      aiModel: false,
    });
  }

  function createContribution() {
    return freeze({
      schemaVersion: LUNA_SCHEMA_VERSION,
      source: LUNA_SOURCE,
      updatedAt: LUNA_UPDATED_AT,
      simulation: true,
      entities: [{ id: "luna-companion", kind: "companion-guide", simulation: true }],
      evidence: [{ id: "luna-companion:local-dialogue", kind: "session-dialogue-log", status: "local" }],
      capabilities: [{ id: "luna-companion.navigate", mode: "local-rehearsal", authority: "none", executable: false }],
      boundary: LUNA_BOUNDARY,
    });
  }

  return freeze({
    respond,
    suggestUnvisited,
    history: historyView,
    clear,
    getSnapshot,
    createContribution,
    source: LUNA_SOURCE,
    boundary: LUNA_BOUNDARY,
  });
}

export function createLunaCompanionContribution({ seed = "luna-local", updatedAt = LUNA_UPDATED_AT } = {}) {
  const luna = createLunaCompanion({ seed });
  const contribution = luna.createContribution();
  return freeze({ ...contribution, updatedAt });
}

export default createLunaCompanion;
