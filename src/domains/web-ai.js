/**
 * web-ai.js — Web + AI block domain data.
 *
 * Pure, node-safe data module for the Web + AI feature. It owns:
 *  - the curated embed-vs-handoff policy (most publishers send
 *    X-Frame-Options / frame-ancestors headers that forbid framing),
 *  - the embed-friendly web presets and the known-blocked handoff presets,
 *  - the AI assistant link-out cards (Meta AI, ChatGPT, Grok),
 *  - the local prompt composer that carries the user's task note over.
 *
 * Links only — NEVER credentials, API keys, tokens, or secrets. Nothing
 * here touches the DOM, the network, or storage; it is safe to import in
 * Node for unit tests.
 */

export const WEB_AI_FEATURE_ID = "web-ai";
export const WEB_AI_CONSOLE_SOURCE = "web-ai-console";
export const WEB_AI_SCHEMA_VERSION = 1;

export const WEB_AI_BOUNDARY =
  "External sites open only by your explicit tap — inside a sandboxed frame or a separate tab that leaves the Reality Lens open. " +
  "Return to the Lens tab to continue; provider sign-in does not authorize this demo or return through an OAuth callback. " +
  "This demo never collects, stores, or sends credentials, API keys, tokens, or logins. AI handoffs are links plus a prompt you copy yourself.";

export const WEB_AI_STORAGE_KEYS = Object.freeze({
  position: "tumbo.web-ai.pos.v1",
  minimized: "tumbo.web-ai.min.v1",
  taskNote: "tumbo.web-ai.note.v1",
  lastUrl: "tumbo.web-ai.url.v1",
  lastTab: "tumbo.web-ai.tab.v1",
  lensReturn: "tumbo.web-ai.lens-return.v1",
});

/** Sites verified to permit framing — safe to embed in the glass frame. */
export const WEB_AI_EMBED_PRESETS = Object.freeze([
  Object.freeze({
    id: "osm-embed",
    label: "OpenStreetMap",
    url: "https://www.openstreetmap.org/export/embed.html?bbox=-0.1357%2C51.4975%2C-0.0957%2C51.5175&layer=mapnik",
    mode: "embed",
    note: "OSM's export endpoint is built for framing.",
  }),
  Object.freeze({
    id: "example",
    label: "Example.com",
    url: "https://example.com/",
    mode: "embed",
    note: "IANA example domain — sends no framing headers.",
  }),
]);

/** Sites known to block framing — they hand off to a new tab instead. */
export const WEB_AI_HANDOFF_PRESETS = Object.freeze([
  Object.freeze({
    id: "google",
    label: "Google",
    url: "https://www.google.com/",
    mode: "handoff",
    note: "Sends X-Frame-Options: SAMEORIGIN — framing is blocked.",
  }),
  Object.freeze({
    id: "github",
    label: "GitHub",
    url: "https://github.com/",
    mode: "handoff",
    note: "Sends X-Frame-Options: deny — framing is blocked.",
  }),
  Object.freeze({
    id: "x",
    label: "X",
    url: "https://x.com/",
    mode: "handoff",
    note: "Blocks framing — opens in a new tab.",
  }),
]);

const WEB_AI_EMBED_HOSTS = Object.freeze([
  "www.openstreetmap.org",
  "openstreetmap.org",
  "example.com",
  "www.example.com",
  "example.org",
  "www.example.org",
]);

const WEB_AI_HANDOFF_HOSTS = Object.freeze([
  "google.com",
  "www.google.com",
  "github.com",
  "www.github.com",
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "facebook.com",
  "www.facebook.com",
  "meta.ai",
  "www.meta.ai",
  "chatgpt.com",
  "www.chatgpt.com",
  "chat.openai.com",
  "grok.com",
  "www.grok.com",
  "claude.ai",
  "www.claude.ai",
  "gemini.google.com",
  "chat.deepseek.com",
  "deepseek.com",
  "www.deepseek.com",
  "kimi.com",
  "www.kimi.com",
]);

/**
 * Normalize free-typed input into an absolute http(s) URL, or null.
 * Bare hosts get an https:// prefix; non-http(s) schemes are rejected.
 */
export function normalizeWebUrl(input) {
  if (typeof input !== "string") return null;
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  return url.href;
}

/**
 * Decide embed vs handoff for a URL. Returns a frozen record:
 *  - {mode:"embed"}   known to allow framing
 *  - {mode:"handoff"} known to block framing
 *  - {mode:"try"}     unknown policy — try the frame, keep a new-tab fallback
 *  - {mode:"invalid"} not a usable http(s) URL
 */
export function classifyWebTarget(input) {
  const href = normalizeWebUrl(input);
  if (!href) {
    return Object.freeze({ mode: "invalid", url: null, reason: "Enter an http(s) URL." });
  }
  const host = new URL(href).hostname.toLowerCase();
  if (WEB_AI_EMBED_HOSTS.includes(host)) {
    return Object.freeze({ mode: "embed", url: href, reason: "This host is known to allow framing." });
  }
  if (WEB_AI_HANDOFF_HOSTS.includes(host)) {
    return Object.freeze({
      mode: "handoff",
      url: href,
      reason: "This site blocks framing (X-Frame-Options / frame-ancestors).",
    });
  }
  return Object.freeze({
    mode: "try",
    url: href,
    reason: "Framing policy unknown — trying the frame with a new-tab fallback.",
  });
}

/** AI assistant link-out cards. Links only — never credentials or API keys. */
export const WEB_AI_ASSISTANTS = Object.freeze([
  Object.freeze({
    id: "meta-ai",
    name: "Meta AI",
    url: "https://www.meta.ai/",
    blurb: "Meta's assistant — open it, then paste the copied prompt.",
  }),
  Object.freeze({
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    blurb: "OpenAI's assistant — paste the copied prompt to continue there.",
  }),
  Object.freeze({
    id: "grok",
    name: "Grok",
    url: "https://grok.com/",
    blurb: "xAI's assistant — bring your task note along.",
  }),
  Object.freeze({
    id: "claude",
    name: "Claude",
    url: "https://claude.ai/",
    blurb: "Anthropic's assistant — open it with the same maTumbo task note.",
  }),
  Object.freeze({
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com/",
    blurb: "Google's Gemini web app — use the same prompt handoff without sharing credentials.",
  }),
  Object.freeze({
    id: "deepseek",
    name: "DeepSeek",
    url: "https://chat.deepseek.com/",
    blurb: "DeepSeek chat — another provider surface for the same task.",
  }),
  Object.freeze({
    id: "kimi",
    name: "Kimi",
    url: "https://www.kimi.com/en/",
    blurb: "Kimi — carry the same task into Moonshot's assistant.",
  }),
]);

export function getWebAiAssistant(id) {
  if (typeof id !== "string") return null;
  return WEB_AI_ASSISTANTS.find((assistant) => assistant.id === id) ?? null;
}

const WEB_AI_MAX_PROMPT_CHARS = 1200;
const WEB_AI_MAX_NOTE_CHARS = 400;

/**
 * Compose the prompt that travels with an AI handoff: the user's task note
 * plus the page they were viewing. Bounded and fully local — the user
 * copies it themselves; nothing is ever posted to an assistant API.
 */
export function buildAiPrompt({ taskNote = "", pageUrl = "", pageTitle = "" } = {}) {
  const note = String(taskNote ?? "").trim().slice(0, WEB_AI_MAX_NOTE_CHARS) || "(no task note written yet)";
  const page = String(pageUrl ?? "").trim().slice(0, 300);
  const title = String(pageTitle ?? "").trim().slice(0, 120);
  const lines = [
    "I'm using maTumbo Living Reality, a browser-based Reality Lens. Feature tools are live interfaces attached to mutable 3D objects; the selected object's real controls stay in the Lens.",
    "External assistants may open in a separate tab. This demo has no provider OAuth or sign-in bridge: returning to the Lens resumes its object and locally saved note, but does not connect the provider account.",
    "",
    `Task note: ${note}`,
  ];
  if (page) lines.push(`Page I was viewing: ${title ? `${title} — ` : ""}${page}`);
  lines.push(
    "",
    "Please help with the task note. Treat the repository as the source of truth; inspect its current code instead of assuming a cube-only scene. Give concrete, scoped steps that fit its existing patterns.",
  );
  return lines.join("\n").slice(0, WEB_AI_MAX_PROMPT_CHARS);
}

export default Object.freeze({
  WEB_AI_FEATURE_ID,
  WEB_AI_CONSOLE_SOURCE,
  WEB_AI_SCHEMA_VERSION,
  WEB_AI_BOUNDARY,
  WEB_AI_STORAGE_KEYS,
  WEB_AI_EMBED_PRESETS,
  WEB_AI_HANDOFF_PRESETS,
  WEB_AI_ASSISTANTS,
});
