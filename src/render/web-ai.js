/**
 * web-ai.js — Web + AI glass console renderer.
 *
 * DOM adapter for the Web + AI feature. It injects its own glass panel (an
 * <aside>, like the feature-world overlay in feature-worlds.js) so no
 * index.html edit is needed, and main.js mounts it exactly like the other
 * feature consoles.
 *
 * Design-law compliance:
 *  - standalone mode keeps a compact, scrollable glass console
 *  - Reality Lens reparents this same live DOM into the selected object's
 *    Three.js CSS3D face; no second Web + AI cube or floating panel is made
 *  - two tabs (WEB / AI HELP); the task note stays local until the user copies it
 *  - minimize and drag apply only while the console is outside Reality Lens
 *  - mobile: full-width sheet at <=700px (390x844)
 *
 * Reality Lens owns the 3D transform and form. This module owns only the
 * Web/AI controls and explicit external handoff; sign-in is never captured.
 *
 * Top level is node-safe: document, window, and storage are only touched
 * inside createWebAiConsole(). The iframe is sandboxed WITHOUT
 * allow-same-origin (opaque origin) and never receives credentials; external
 * navigation happens only through the user's own tap opening a new tab.
 */
import {
  WEB_AI_ASSISTANTS,
  WEB_AI_BOUNDARY,
  WEB_AI_CONSOLE_SOURCE,
  WEB_AI_EMBED_PRESETS,
  WEB_AI_HANDOFF_PRESETS,
  WEB_AI_STORAGE_KEYS,
  buildAiPrompt,
  classifyWebTarget,
  getWebAiAssistant,
} from "../domains/web-ai.js?v=20260923-lens-return2";
import {
  COMPUTE_EXCHANGE_BOUNDARY,
  COMPUTE_PROVIDERS,
  DEFAULT_REWARD_POLICY,
  createComputeExchangeLedger,
  selectProviderRoute,
} from "../domains/compute-exchange.js?v=20260925-compute2";
import {
  COMPUTE_ACCOUNT_BOUNDARY,
  createComputeAccount,
} from "../domains/compute-account.js?v=20260925-compute1";
import {
  CONTRIBUTION_VAULT_BOUNDARY,
  CONTRIBUTION_SCOPES,
  createContributionVault,
} from "../domains/contribution-vault.js?v=20260925-compute1";
import { createEconomicTimeline } from "../domains/economic-timeline.js?v=20260925-compute1";

export { WEB_AI_CONSOLE_SOURCE };

const CONSOLE_ID = "web-ai-console";
const CHIP_ID = "web-ai-chip";
const FRAME_LOAD_TIMEOUT_MS = 12000;

const STYLE_TEXT = `
#web-ai-console{position:fixed;right:20px;top:145px;z-index:60;width:min(520px,calc(100vw - 40px));max-height:calc(100vh - 190px);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(125,212,255,.35);border-radius:18px;background:linear-gradient(165deg,rgba(5,25,35,.97),rgba(3,8,14,.96));box-shadow:0 24px 80px rgba(0,0,0,.62),inset 0 0 42px rgba(65,205,255,.08);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);color:#dff7ff;font-family:inherit}
#web-ai-console[hidden]{display:none}
.web-ai-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 15px 10px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none}
.web-ai-head:active{cursor:grabbing}
.web-ai-head .eyebrow{font-size:9px;letter-spacing:.2em;color:#7fd4ff;text-transform:uppercase}
.web-ai-head h2{margin:4px 0 4px;font-size:20px;color:#e8fbff;letter-spacing:.01em}
.web-ai-head p{margin:0;color:#a8c6cf;font-size:10px;line-height:1.42;max-width:380px}
.web-ai-head-actions{display:flex;gap:6px;flex:0 0 auto}
.web-ai-iconbtn{appearance:none;border:1px solid rgba(157,219,240,.25);border-radius:8px;background:rgba(70,139,163,.12);color:#b9eaf5;padding:5px 9px;font-size:14px;line-height:1;cursor:pointer}
.web-ai-iconbtn:hover,.web-ai-iconbtn:focus-visible{border-color:rgba(204,247,255,.72);color:#fff;outline:none}
.web-ai-tabs{display:flex;gap:6px;padding:0 15px 10px}
.web-ai-tab{appearance:none;flex:1;border:1px solid rgba(125,212,255,.22);border-radius:9px;padding:8px 10px;background:rgba(42,137,167,.1);color:#a9d6e4;font-size:9px;font-weight:750;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
.web-ai-tab[aria-selected="true"]{border-color:rgba(199,246,255,.75);background:rgba(52,153,182,.32);color:#f2fdff}
.web-ai-tab:hover,.web-ai-tab:focus-visible{border-color:rgba(199,246,255,.6);outline:none}
.web-ai-body{overflow-y:auto;overflow-x:hidden;padding:2px 15px 12px;display:flex;flex-direction:column;gap:10px;min-height:0;scrollbar-width:thin}
.web-ai-body>section{display:flex;flex-direction:column;gap:10px;min-height:0}
.web-ai-field{display:grid;gap:5px}
.web-ai-field>span{color:#8fd8f0;font-size:8px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}
.web-ai-note,.web-ai-prompt{width:100%;box-sizing:border-box;resize:vertical;min-height:44px;padding:8px 9px;border:1px solid rgba(125,212,255,.22);border-radius:9px;background:rgba(3,12,20,.8);color:#dff9ff;font-size:10px;line-height:1.45;font-family:inherit}
.web-ai-note:focus,.web-ai-url:focus{border-color:rgba(145,232,255,.7);outline:none;box-shadow:0 0 0 2px rgba(84,194,232,.14)}
.web-ai-urlrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}
.web-ai-url{width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid rgba(125,212,255,.22);border-radius:9px;background:rgba(3,12,20,.8);color:#dff9ff;font-size:10px;font-family:inherit}
.web-ai-go{appearance:none;border:1px solid rgba(125,212,255,.4);border-radius:9px;padding:8px 14px;background:rgba(42,137,167,.22);color:#e4fbff;font-size:9px;font-weight:800;letter-spacing:.1em;cursor:pointer}
.web-ai-go:hover,.web-ai-go:focus-visible{border-color:rgba(224,250,255,.85);background:rgba(52,153,182,.4);outline:none}
.web-ai-presets{display:flex;flex-wrap:wrap;gap:6px}
.web-ai-preset{appearance:none;display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border-radius:999px;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;background:rgba(5,21,29,.74);color:#aac8d0;border:1px solid rgba(118,225,249,.2)}
.web-ai-preset:hover,.web-ai-preset:focus-visible{color:#effcff;border-color:rgba(142,240,255,.55);outline:none}
.web-ai-preset .dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.web-ai-preset[data-mode="embed"] .dot{background:#7de8a8;box-shadow:0 0 8px rgba(125,232,168,.8)}
.web-ai-preset[data-mode="handoff"] .dot{background:#ffd27a;box-shadow:0 0 8px rgba(255,210,122,.8)}
.web-ai-status{padding:7px 8px;border-left:2px solid rgba(115,214,248,.54);border-radius:0 7px 7px 0;background:rgba(52,122,153,.12);color:#b9deea;font-size:8px;line-height:1.4;letter-spacing:.04em}
.web-ai-status[data-kind="warn"]{border-left-color:rgba(255,210,122,.7);background:rgba(121,75,40,.14);color:#e5cbaa}
.web-ai-status[data-kind="error"]{border-left-color:rgba(255,120,136,.7);background:rgba(149,57,75,.14);color:#ffd0d7}
.web-ai-framewrap{display:grid;gap:6px}
.web-ai-frame{width:100%;height:340px;border:1px solid rgba(125,212,255,.25);border-radius:10px;background:#02070b}
.web-ai-framebar{display:flex;gap:6px;flex-wrap:wrap}
.web-ai-btn{appearance:none;border:1px solid rgba(125,212,255,.32);border-radius:9px;padding:8px 10px;background:rgba(42,137,167,.16);color:#d6f7ff;font-size:8px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.web-ai-btn:hover,.web-ai-btn:focus-visible{border-color:rgba(224,250,255,.82);background:rgba(52,153,182,.3);outline:none}
.web-ai-btn.primary{border-color:rgba(255,210,122,.5);background:rgba(171,113,39,.2);color:#ffe7ba}
.web-ai-btn.primary:hover,.web-ai-btn.primary:focus-visible{border-color:rgba(255,226,171,.9);background:rgba(190,128,45,.34)}
.web-ai-handoff{display:grid;gap:8px;padding:10px;border:1px solid rgba(255,210,122,.35);border-radius:10px;background:rgba(121,75,40,.12)}
.web-ai-handoff p{margin:0;color:#e5cbaa;font-size:9px;line-height:1.45}
.web-ai-handoff-actions{display:flex;gap:6px;flex-wrap:wrap}
.web-ai-assistants{display:grid;gap:8px}
.web-ai-assistant{display:grid;gap:6px;padding:10px;border:1px solid rgba(125,212,255,.18);border-radius:10px;background:rgba(7,26,35,.62)}
.web-ai-assistant strong{color:#e4fbff;font-size:12px;letter-spacing:.02em}
.web-ai-assistant p{margin:0;color:#9ebbc5;font-size:9px;line-height:1.4}
.web-ai-assistant-actions{display:flex;gap:6px;flex-wrap:wrap}
.web-ai-economy-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.web-ai-metric{padding:9px;border:1px solid rgba(125,212,255,.17);border-radius:10px;background:rgba(7,26,35,.62)}
.web-ai-metric b{display:block;color:#e8fbff;font-size:16px;font-variant-numeric:tabular-nums}
.web-ai-metric span{display:block;margin-top:3px;color:#86aeb9;font-size:7px;letter-spacing:.11em;text-transform:uppercase}
.web-ai-economy-flow{display:grid;gap:5px;padding:9px;border:1px solid rgba(125,212,255,.16);border-radius:10px;background:rgba(3,12,20,.55)}
.web-ai-economy-flow div{padding:6px 7px;border-left:2px solid rgba(125,212,255,.42);background:rgba(42,137,167,.08);color:#b8d9e2;font-size:8px;line-height:1.35}
.web-ai-economy-form{display:grid;gap:7px;padding:10px;border:1px solid rgba(255,210,122,.24);border-radius:10px;background:rgba(121,75,40,.08)}
.web-ai-economy-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.web-ai-economy-form input,.web-ai-economy-form select{width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid rgba(125,212,255,.22);border-radius:9px;background:rgba(3,12,20,.8);color:#dff9ff;font-size:9px;font-family:inherit}
.web-ai-economy-check{display:flex;align-items:flex-start;gap:7px;color:#b9cfd6;font-size:8px;line-height:1.35}
.web-ai-economy-providers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.web-ai-economy-provider{display:grid;gap:5px;padding:8px;border:1px solid rgba(125,212,255,.15);border-radius:9px;background:rgba(7,26,35,.55)}
.web-ai-economy-provider strong{font-size:10px;color:#e4fbff}
.web-ai-economy-provider span{font-size:7px;color:#789da8;line-height:1.35}
.web-ai-economy-section{display:grid;gap:8px;padding:10px;border:1px solid rgba(125,212,255,.16);border-radius:11px;background:rgba(3,12,20,.45)}
.web-ai-economy-title{display:flex;align-items:baseline;justify-content:space-between;gap:8px;color:#e7fbff;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.web-ai-economy-title span{color:#6f98a4;font-size:7px;font-weight:600}
.web-ai-economy-actions{display:flex;gap:6px;flex-wrap:wrap}
.web-ai-economy-statusline{font-size:8px;line-height:1.4;color:#a8c5ce}
.web-ai-economy-timeline{display:grid;gap:5px;max-height:180px;overflow:auto}
.web-ai-economy-event{display:grid;grid-template-columns:auto 1fr auto;gap:7px;padding:6px 7px;border:1px solid rgba(125,212,255,.1);border-radius:8px;background:rgba(7,26,35,.48);font-size:7px}
.web-ai-economy-event b{color:#cceef6;font-variant-numeric:tabular-nums}
.web-ai-economy-event span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8eb0ba}
.web-ai-economy-event code{color:#7fd4ff;font-size:7px}
.web-ai-route-result{padding:8px;border:1px solid rgba(112,226,184,.2);border-radius:8px;background:rgba(46,154,113,.08);color:#bfead5;font-size:8px;line-height:1.4}
.web-ai-route-quotes{display:grid;gap:6px}
.web-ai-route-quote{display:grid;grid-template-columns:1.2fr .8fr .8fr;gap:6px;align-items:center}
.web-ai-route-quote strong{font-size:8px;color:#cceef6}
.web-ai-route-quote input{width:100%;box-sizing:border-box;padding:7px;border:1px solid rgba(125,212,255,.18);border-radius:8px;background:rgba(3,12,20,.8);color:#dff9ff;font-size:8px}
@media (max-width:700px){.web-ai-economy-grid,.web-ai-economy-providers,.web-ai-economy-form-grid{grid-template-columns:1fr}.web-ai-route-quote{grid-template-columns:1fr 1fr 1fr}}
.web-ai-boundary{padding:8px 15px 12px;color:#8fa6b1;font-size:8px;line-height:1.4;border-top:1px solid rgba(125,212,255,.1)}
.web-ai-boundary strong{color:#c9a86a;font-size:7px;letter-spacing:.13em}
#web-ai-chip{position:fixed;right:20px;bottom:86px;z-index:61;appearance:none;padding:9px 14px;border:1px solid rgba(125,212,255,.5);border-radius:999px;background:rgba(10,26,40,.72);color:#cfe9ff;font-size:11px;letter-spacing:.14em;font-weight:700;cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
#web-ai-chip[hidden]{display:none}
#web-ai-chip:hover{border-color:#7fd4ff;color:#fff}
@media (max-width:700px){#web-ai-console{left:8px;right:8px;top:auto;bottom:8px;width:auto;max-height:72vh}#web-ai-chip{right:12px;bottom:12px}.web-ai-frame{height:240px}}
`;

function readStorage(storage, key) {
  try {
    return storage && typeof storage.getItem === "function" ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeStorage(storage, key, value) {
  try {
    if (storage && typeof storage.setItem === "function") storage.setItem(key, value);
  } catch {}
}

function parsePosition(raw) {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.top)) {
      return { left: parsed.left, top: parsed.top };
    }
  } catch {}
  return null;
}

function el(documentRoot, tag, className, text) {
  const node = documentRoot.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function openNewTab(windowRoot, url) {
  try {
    const opened = windowRoot && typeof windowRoot.open === "function"
      ? windowRoot.open(url, "_blank")
      : null;
    if (opened && typeof opened === "object") {
      try { opened.opener = null; } catch {}
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function copyText(documentRoot, windowRoot, text) {
  const clipboard = windowRoot && windowRoot.navigator && windowRoot.navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    return clipboard.writeText(text).then(() => true, () => false);
  }
  try {
    const area = documentRoot.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    const host = documentRoot.body || documentRoot;
    host.appendChild(area);
    area.select();
    const ok = typeof documentRoot.execCommand === "function" ? documentRoot.execCommand("copy") : false;
    area.remove();
    return Promise.resolve(Boolean(ok));
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * Mount the Web + AI console. Mirrors the other feature consoles:
 * open/close/toggle/minimize, frozen snapshots, and an onEvent intent sink.
 */
export function createWebAiConsole({
  documentRoot = globalThis.document,
  windowRoot = globalThis.window,
  storage = null,
  onEvent = null,
} = {}) {
  const doc = documentRoot;
  if (!doc || typeof doc.createElement !== "function") {
    throw new Error("Web + AI console needs a document");
  }
  const store = storage || (windowRoot && windowRoot.localStorage) || null;
  let sessionStore=null;
  try{sessionStore=windowRoot?.sessionStorage??null;}catch{}

  const styleEl = doc.createElement("style");
  styleEl.setAttribute("data-web-ai-style", "true");
  styleEl.textContent = STYLE_TEXT;
  (doc.head || doc).appendChild(styleEl);

  const state = { opened: false, minimized: false, tab: "web", url: "", note: "", pendingExternalReturn: null };
  const computeLedger = createComputeExchangeLedger();
  const computeAccount = createComputeAccount({ monthlyBudgetUsd: 100, perTaskBudgetUsd: 25 });
  const contributionVault = createContributionVault();
  const economicTimeline = createEconomicTimeline();
  try{
    const receipt=JSON.parse(readStorage(sessionStore,WEB_AI_STORAGE_KEYS.lensReturn)||"null");
    if(receipt&&typeof receipt.assistantId==="string"&&Number.isFinite(receipt.openedAt)&&Date.now()-receipt.openedAt<12*60*60*1000)state.pendingExternalReturn=receipt;
    else writeStorage(sessionStore,WEB_AI_STORAGE_KEYS.lensReturn,"");
  }catch{state.pendingExternalReturn=null;}

  // --- panel ---
  const panel = el(doc, "aside");
  panel.id = CONSOLE_ID;
  panel.hidden = true;
  panel.setAttribute("aria-label", "Web + AI console");

  const head = el(doc, "div", "web-ai-head");
  const headCopy = el(doc, "div");
  headCopy.appendChild(el(doc, "div", "eyebrow", "WEB + AI · LOCAL PROJECTION"));
  headCopy.appendChild(el(doc, "h2", null, "Web + AI"));
  headCopy.appendChild(el(doc, "p", null, "Surf the web from inside the world — or hand your task to an AI assistant."));
  const headActions = el(doc, "div", "web-ai-head-actions");
  const minimizeButton = el(doc, "button", "web-ai-iconbtn", "–");
  minimizeButton.type = "button";
  minimizeButton.setAttribute("aria-label", "Minimize to chip");
  minimizeButton.title = "Minimize to chip";
  const closeButton = el(doc, "button", "web-ai-iconbtn", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close Web + AI");
  closeButton.title = "Close";
  headActions.appendChild(minimizeButton);
  headActions.appendChild(closeButton);
  head.appendChild(headCopy);
  head.appendChild(headActions);
  panel.appendChild(head);

  const tabs = el(doc, "div", "web-ai-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Web + AI sections");
  const webTab = el(doc, "button", "web-ai-tab", "WEB");
  webTab.type = "button";
  webTab.setAttribute("role", "tab");
  webTab.dataset.tab = "web";
  const aiTab = el(doc, "button", "web-ai-tab", "AI HELP");
  aiTab.type = "button";
  aiTab.setAttribute("role", "tab");
  aiTab.dataset.tab = "ai";
  const economyTab = el(doc, "button", "web-ai-tab", "COMPUTE");
  economyTab.type = "button";
  economyTab.setAttribute("role", "tab");
  economyTab.dataset.tab = "economy";
  tabs.appendChild(webTab);
  tabs.appendChild(aiTab);
  tabs.appendChild(economyTab);
  panel.appendChild(tabs);

  const body = el(doc, "div", "web-ai-body");

  // --- WEB tab ---
  const webSection = el(doc, "section");
  webSection.dataset.panel = "web";
  webSection.setAttribute("role", "tabpanel");

  const noteField = el(doc, "label", "web-ai-field");
  noteField.appendChild(el(doc, "span", null, "YOUR TASK NOTE — CARRIED INTO EVERY HANDOFF"));
  const noteInput = el(doc, "textarea", "web-ai-note");
  noteInput.rows = 2;
  noteInput.placeholder = "What are you trying to do? e.g. find the glass material recipe…";
  noteInput.setAttribute("aria-label", "Your task note");
  noteField.appendChild(noteInput);
  webSection.appendChild(noteField);

  const urlRow = el(doc, "div", "web-ai-urlrow");
  const urlInput = el(doc, "input", "web-ai-url");
  urlInput.type = "url";
  urlInput.placeholder = "https://… or example.com";
  urlInput.setAttribute("aria-label", "Web address");
  const goButton = el(doc, "button", "web-ai-go", "GO");
  goButton.type = "button";
  urlRow.appendChild(urlInput);
  urlRow.appendChild(goButton);
  webSection.appendChild(urlRow);

  const presets = el(doc, "div", "web-ai-presets");
  presets.setAttribute("aria-label", "Shortcuts");
  webSection.appendChild(presets);

  const status = el(doc, "div", "web-ai-status", "Pick a shortcut or enter a URL — framing-friendly sites embed, the rest hand off to a new tab.");
  status.dataset.kind = "info";
  status.setAttribute("role", "status");
  webSection.appendChild(status);

  const framewrap = el(doc, "div", "web-ai-framewrap");
  framewrap.hidden = true;
  const frame = el(doc, "iframe", "web-ai-frame");
  frame.title = "Embedded web page";
  frame.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("loading", "lazy");
  const framebar = el(doc, "div", "web-ai-framebar");
  const frameOpenButton = el(doc, "button", "web-ai-btn", "OPEN IN NEW TAB →");
  frameOpenButton.type = "button";
  framebar.appendChild(frameOpenButton);
  framewrap.appendChild(frame);
  framewrap.appendChild(framebar);
  webSection.appendChild(framewrap);

  const handoffBox = el(doc, "div", "web-ai-handoff");
  handoffBox.hidden = true;
  const handoffText = el(doc, "p");
  const handoffActions = el(doc, "div", "web-ai-handoff-actions");
  const handoffOpenButton = el(doc, "button", "web-ai-btn primary", "OPEN IN NEW TAB →");
  handoffOpenButton.type = "button";
  const handoffTryButton = el(doc, "button", "web-ai-btn", "TRY EMBED ANYWAY");
  handoffTryButton.type = "button";
  const handoffCopyButton = el(doc, "button", "web-ai-btn", "COPY NOTE + URL");
  handoffCopyButton.type = "button";
  const returnToLensButton = el(doc, "button", "web-ai-btn primary", "RETURN TO THIS LENS OBJECT");
  returnToLensButton.type = "button";
  returnToLensButton.hidden = true;
  handoffActions.appendChild(handoffOpenButton);
  handoffActions.appendChild(handoffTryButton);
  handoffActions.appendChild(handoffCopyButton);
  handoffActions.appendChild(returnToLensButton);
  handoffBox.appendChild(handoffText);
  handoffBox.appendChild(handoffActions);
  webSection.appendChild(handoffBox);

  // --- AI tab ---
  const aiSection = el(doc, "section");
  aiSection.dataset.panel = "ai";
  aiSection.setAttribute("role", "tabpanel");
  aiSection.hidden = true;

  const aiIntro = el(doc, "div", "web-ai-status", "LINKS ONLY — NEVER CREDENTIALS. COPY THE PROMPT, OPEN THE ASSISTANT, PASTE IT THERE.");
  aiIntro.dataset.kind = "info";
  aiSection.appendChild(aiIntro);

  const promptField = el(doc, "label", "web-ai-field");
  promptField.appendChild(el(doc, "span", null, "PROMPT PREVIEW — WHAT TRAVELS WITH YOU"));
  const promptPreview = el(doc, "textarea", "web-ai-prompt");
  promptPreview.rows = 5;
  promptPreview.readOnly = true;
  promptPreview.setAttribute("aria-label", "Prompt preview");
  promptField.appendChild(promptPreview);
  aiSection.appendChild(promptField);

  const aiStatus = el(doc, "div", "web-ai-status", "Choose an assistant below — your task note travels in the prompt.");
  aiStatus.dataset.kind = "info";
  aiStatus.setAttribute("role", "status");
  aiSection.appendChild(aiStatus);

  const assistants = el(doc, "div", "web-ai-assistants");
  aiSection.appendChild(assistants);

  // --- COMPUTE tab ---
  const economySection = el(doc, "section");
  economySection.dataset.panel = "economy";
  economySection.setAttribute("role", "tabpanel");
  economySection.hidden = true;

  const economyIntro = el(doc, "div", "web-ai-status",
    "ONE TASK · MANY MODELS · ONE RECEIPT TRAIL. RAW TOKENS ARE EVIDENCE; VERIFIED SPEND IS THE REWARD BASIS.");
  economyIntro.dataset.kind = "info";
  economySection.appendChild(economyIntro);

  const metrics = el(doc, "div", "web-ai-economy-grid");
  const balanceMetric = el(doc, "div", "web-ai-metric");
  const balanceValue = el(doc, "b", null, "$0.00");
  balanceMetric.append(balanceValue, el(doc, "span", null, "compute credits"));
  const spendMetric = el(doc, "div", "web-ai-metric");
  const spendValue = el(doc, "b", null, "$0.00");
  spendMetric.append(spendValue, el(doc, "span", null, "verified spend"));
  const tokenMetric = el(doc, "div", "web-ai-metric");
  const tokenValue = el(doc, "b", null, "0");
  tokenMetric.append(tokenValue, el(doc, "span", null, "model tokens"));
  const rewardMetric = el(doc, "div", "web-ai-metric");
  const rewardValue = el(doc, "b", null, "0");
  rewardMetric.append(rewardValue, el(doc, "span", null, "TUMBO-SIM total"));
  metrics.append(balanceMetric, spendMetric, tokenMetric, rewardMetric);
  economySection.appendChild(metrics);

  const rewardStatus = el(doc, "div", "web-ai-status",
    `DEMO POLICY · ${DEFAULT_REWARD_POLICY.label}. The rate is configurable and is not a promise of real issuance or yield.`);
  rewardStatus.dataset.kind = "warn";
  economySection.appendChild(rewardStatus);

  const accountSection = el(doc, "div", "web-ai-economy-section");
  const accountTitle = el(doc, "div", "web-ai-economy-title", "COMPUTE WALLET");
  accountTitle.appendChild(el(doc, "span", null, "demo credits · budget guardrails"));
  accountSection.appendChild(accountTitle);
  const accountGrid = el(doc, "div", "web-ai-economy-form-grid");
  const fundInput = el(doc, "input");
  fundInput.type = "number"; fundInput.min = "0.01"; fundInput.step = "0.01"; fundInput.value = "25";
  fundInput.setAttribute("aria-label", "Demo compute credits to add");
  const fundButton = el(doc, "button", "web-ai-btn primary", "ADD DEMO CREDITS");
  fundButton.type = "button";
  const monthlyBudgetInput = el(doc, "input");
  monthlyBudgetInput.type = "number"; monthlyBudgetInput.min = "0.01"; monthlyBudgetInput.step = "1"; monthlyBudgetInput.value = "100";
  monthlyBudgetInput.setAttribute("aria-label", "Monthly compute budget");
  const perTaskBudgetInput = el(doc, "input");
  perTaskBudgetInput.type = "number"; perTaskBudgetInput.min = "0.01"; perTaskBudgetInput.step = "1"; perTaskBudgetInput.value = "25";
  perTaskBudgetInput.setAttribute("aria-label", "Per task compute budget");
  accountGrid.append(fundInput, fundButton, monthlyBudgetInput, perTaskBudgetInput);
  accountSection.appendChild(accountGrid);
  const budgetButton = el(doc, "button", "web-ai-btn", "SAVE BUDGET GUARDRAILS");
  budgetButton.type = "button";
  accountSection.appendChild(budgetButton);
  const accountStatus = el(doc, "div", "web-ai-economy-statusline", "Balance starts at $0. Add demo credits explicitly; no money is charged.");
  accountSection.appendChild(accountStatus);
  economySection.appendChild(accountSection);

  const providerSection = el(doc, "div", "web-ai-economy-section");
  const providerTitle = el(doc, "div", "web-ai-economy-title", "MODEL MARKET");
  providerTitle.appendChild(el(doc, "span", null, "external providers + local lane"));
  providerSection.appendChild(providerTitle);
  const providerGrid = el(doc, "div", "web-ai-economy-providers");
  providerSection.appendChild(providerGrid);
  economySection.appendChild(providerSection);

  const routeSection = el(doc, "div", "web-ai-economy-section");
  const routeTitle = el(doc, "div", "web-ai-economy-title", "AUTO ROUTER");
  routeTitle.appendChild(el(doc, "span", null, "you or future adapters provide quotes"));
  routeSection.appendChild(routeTitle);
  const routePolicyGrid = el(doc, "div", "web-ai-economy-form-grid");
  const routePriority = el(doc, "select");
  [["balanced","BALANCED"],["cost","LOWEST COST"],["latency","LOWEST LATENCY"]].forEach(([value,label]) => {
    const option=el(doc,"option",null,label); option.value=value; routePriority.appendChild(option);
  });
  const routePrivacy = el(doc, "select");
  [["provider-default","PROVIDER DEFAULT"],["local-only","LOCAL ONLY"]].forEach(([value,label]) => {
    const option=el(doc,"option",null,label); option.value=value; routePrivacy.appendChild(option);
  });
  const routeMaxCost = el(doc, "input");
  routeMaxCost.type="number"; routeMaxCost.min="0"; routeMaxCost.step="0.01"; routeMaxCost.value="25";
  routeMaxCost.setAttribute("aria-label","Maximum estimated route cost");
  const routeMaxLatency = el(doc, "input");
  routeMaxLatency.type="number"; routeMaxLatency.min="0"; routeMaxLatency.step="1"; routeMaxLatency.value="10000";
  routeMaxLatency.setAttribute("aria-label","Maximum route latency");
  routePolicyGrid.append(routePriority, routePrivacy, routeMaxCost, routeMaxLatency);
  routeSection.appendChild(routePolicyGrid);
  const routeQuotes = el(doc, "div", "web-ai-route-quotes");
  routeSection.appendChild(routeQuotes);
  const routeButton = el(doc, "button", "web-ai-btn primary", "RANK ENTERED QUOTES");
  routeButton.type = "button";
  routeSection.appendChild(routeButton);
  const routeResult = el(doc, "div", "web-ai-route-result", "Enter estimated cost + latency for any providers. Blank rows are ignored. Live pricing is not invented.");
  routeSection.appendChild(routeResult);
  economySection.appendChild(routeSection);

  const form = el(doc, "div", "web-ai-economy-form");
  form.appendChild(el(doc, "div", "web-ai-status",
    "LOCAL RECEIPT LAB · use this to test the economic loop before live billing adapters exist."));
  const formGrid = el(doc, "div", "web-ai-economy-form-grid");
  const providerSelect = el(doc, "select");
  providerSelect.setAttribute("aria-label", "Compute provider");
  COMPUTE_PROVIDERS.forEach((provider) => {
    const option = el(doc, "option", null, provider.name);
    option.value = provider.id;
    providerSelect.appendChild(option);
  });
  const modelInput = el(doc, "input");
  modelInput.placeholder = "model name";
  modelInput.value = "demo-model";
  const inputTokensInput = el(doc, "input");
  inputTokensInput.type = "number"; inputTokensInput.min = "0"; inputTokensInput.value = "750000";
  inputTokensInput.setAttribute("aria-label", "Input tokens");
  const outputTokensInput = el(doc, "input");
  outputTokensInput.type = "number"; outputTokensInput.min = "0"; outputTokensInput.value = "250000";
  outputTokensInput.setAttribute("aria-label", "Output tokens");
  const spendInput = el(doc, "input");
  spendInput.type = "number"; spendInput.min = "0"; spendInput.step = "0.01"; spendInput.value = "10";
  spendInput.setAttribute("aria-label", "Provider reported cost in USD");
  formGrid.append(providerSelect, modelInput, inputTokensInput, outputTokensInput, spendInput);
  form.appendChild(formGrid);
  const verifiedLabel = el(doc, "label", "web-ai-economy-check");
  const verifiedInput = el(doc, "input");
  verifiedInput.type = "checkbox";
  verifiedInput.checked = true;
  verifiedLabel.append(verifiedInput, doc.createTextNode("Simulate a provider-verified receipt. This checkbox has demo authority only; a live build must verify server-side."));
  form.appendChild(verifiedLabel);
  const recordButton = el(doc, "button", "web-ai-btn primary", "RECORD LOCAL USAGE →");
  recordButton.type = "button";
  form.appendChild(recordButton);
  const economyStatus = el(doc, "div", "web-ai-status", "No usage receipts recorded in this page session.");
  economyStatus.dataset.kind = "info";
  form.appendChild(economyStatus);
  economySection.appendChild(form);

  const vaultSection = el(doc, "div", "web-ai-economy-section");
  const vaultTitle = el(doc, "div", "web-ai-economy-title", "CONTRIBUTION VAULT");
  vaultTitle.appendChild(el(doc, "span", null, "metadata-only · explicit consent"));
  vaultSection.appendChild(vaultTitle);
  const vaultGrid = el(doc, "div", "web-ai-economy-form-grid");
  const vaultCategory = el(doc, "select");
  ["prompt-pattern","evaluation-signal","public-dataset-note","tool-feedback","other"].forEach((value) => {
    const option=el(doc,"option",null,value.replace(/-/g," ").toUpperCase()); option.value=value; vaultCategory.appendChild(option);
  });
  const vaultUnits = el(doc, "input");
  vaultUnits.type="number"; vaultUnits.min="1"; vaultUnits.max="10000"; vaultUnits.value="100";
  vaultUnits.setAttribute("aria-label","Contribution units");
  const vaultPurpose = el(doc, "input");
  vaultPurpose.placeholder="purpose metadata, not raw content";
  vaultPurpose.setAttribute("aria-label","Contribution purpose");
  const vaultRetention = el(doc, "input");
  vaultRetention.type="number"; vaultRetention.min="1"; vaultRetention.max="3650"; vaultRetention.value="30";
  vaultRetention.setAttribute("aria-label","Retention days");
  const vaultScope = el(doc, "select");
  CONTRIBUTION_SCOPES.forEach((value) => { const option=el(doc,"option",null,value.toUpperCase()); option.value=value; vaultScope.appendChild(option); });
  vaultGrid.append(vaultCategory, vaultUnits, vaultPurpose, vaultRetention, vaultScope);
  vaultSection.appendChild(vaultGrid);
  const explicitConsentLabel = el(doc, "label", "web-ai-economy-check");
  const explicitConsent = el(doc, "input");
  explicitConsent.type="checkbox";
  explicitConsentLabel.append(explicitConsent, doc.createTextNode("I explicitly authorize this metadata-only demo contribution. No raw conversation or file content is stored by this vault."));
  vaultSection.appendChild(explicitConsentLabel);
  const trainingLabel = el(doc, "label", "web-ai-economy-check");
  const trainingConsent = el(doc, "input");
  trainingConsent.type="checkbox";
  trainingLabel.append(trainingConsent, doc.createTextNode("Allow training use in this consent rehearsal. Off by default."));
  vaultSection.appendChild(trainingLabel);
  const contributeButton = el(doc, "button", "web-ai-btn primary", "CREATE CONTRIBUTION RECEIPT");
  contributeButton.type="button";
  vaultSection.appendChild(contributeButton);
  const vaultStatus = el(doc, "div", "web-ai-economy-statusline", "Nothing is shared automatically. Without explicit consent, a proposal can exist but earns no reward.");
  vaultSection.appendChild(vaultStatus);
  economySection.appendChild(vaultSection);

  const earningsSection = el(doc, "div", "web-ai-economy-section");
  const earningsTitle = el(doc, "div", "web-ai-economy-title", "EARNING CHANNELS");
  earningsTitle.appendChild(el(doc, "span", null, "active + planned"));
  earningsSection.appendChild(earningsTitle);
  [
    "ACTIVE DEMO · verified compute usage → TUMBO-SIM accrual",
    "ACTIVE DEMO · explicit accepted contribution metadata → capped TUMBO-SIM accrual",
    "PLANNED · provide self-hosted compute → metered provider reward",
    "PLANNED · publish tools / agents → usage-linked creator reward",
    "PLANNED · treasury / fee / burn rules → only after real settlement authority exists",
  ].forEach((line) => earningsSection.appendChild(el(doc, "div", "web-ai-economy-statusline", line)));
  economySection.appendChild(earningsSection);

  const timelineSection = el(doc, "div", "web-ai-economy-section");
  const timelineTitle = el(doc, "div", "web-ai-economy-title", "ECONOMIC TIMELINE");
  timelineTitle.appendChild(el(doc, "span", null, "local ancestry · not cryptographic proof"));
  timelineSection.appendChild(timelineTitle);
  const timelineList = el(doc, "div", "web-ai-economy-timeline");
  timelineSection.appendChild(timelineList);
  economySection.appendChild(timelineSection);

  const flow = el(doc, "div", "web-ai-economy-flow");
  [
    "01 · PROVIDER USAGE — model call + raw token evidence",
    "02 · VERIFIED RECEIPT — provider-reported cost becomes normalization basis",
    "03 · PAYCORE METER — account usage is measured",
    "04 · T402 ROUTE — value path is declared",
    "05 · REWARD ACCRUAL — configurable TUMBO-SIM loyalty accounting",
    "06 · PRIME LEDGER / ECHOPROOF — receipt ancestry target",
    "07 · REALITY LENS — the same transaction becomes a visible object",
  ].forEach((row) => flow.appendChild(el(doc, "div", null, row)));
  economySection.appendChild(flow);

  const economyBoundary = el(doc, "div", "web-ai-status", `${COMPUTE_EXCHANGE_BOUNDARY} ${COMPUTE_ACCOUNT_BOUNDARY} ${CONTRIBUTION_VAULT_BOUNDARY}`);
  economyBoundary.dataset.kind = "warn";
  economySection.appendChild(economyBoundary);

  body.appendChild(webSection);
  body.appendChild(aiSection);
  body.appendChild(economySection);
  panel.appendChild(body);

  const boundary = el(doc, "div", "web-ai-boundary");
  boundary.appendChild(el(doc, "strong", null, "BOUNDARY — "));
  boundary.appendChild(doc.createTextNode(WEB_AI_BOUNDARY));
  panel.appendChild(boundary);

  const chip = el(doc, "button", null, "WEB+AI");
  chip.id = CHIP_ID;
  chip.hidden = true;
  chip.setAttribute("aria-label", "Restore Web + AI panel");
  chip.title = "Restore Web + AI";

  (doc.body || doc).appendChild(panel);
  (doc.body || doc).appendChild(chip);

  // --- behavior ---
  let embedTimer = null;
  let embedWaiting = false;

  function publish(action, method, extra) {
    const snapshot = Object.freeze({
      source: WEB_AI_CONSOLE_SOURCE,
      action,
      method,
      opened: state.opened,
      minimized: state.minimized,
      tab: state.tab,
      url: state.url,
      noteLength: state.note.length,
      pendingExternalReturn: Boolean(state.pendingExternalReturn),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      ...(extra || {}),
    });
    try {
      if (typeof onEvent === "function") onEvent(snapshot);
    } catch {}
    return snapshot;
  }

  function setStatus(text, kind) {
    status.textContent = text;
    status.dataset.kind = kind || "info";
  }

  function setAiStatus(text, kind) {
    aiStatus.textContent = text;
    aiStatus.dataset.kind = kind || "info";
  }

  function rememberExternalReturn(assistantId,method){
    const receipt={assistantId:String(assistantId||"external-site"),openedAt:Date.now()};
    state.pendingExternalReturn=receipt;
    writeStorage(sessionStore,WEB_AI_STORAGE_KEYS.lensReturn,JSON.stringify(receipt));
    returnToLensButton.hidden=true;
    handoffBox.hidden=false;
    handoffText.textContent="The external sign-in stays in its own tab. Reality Lens remains open here with your object and locally saved task note; switch back to this tab when you are ready.";
    setAiStatus("External tab opened. This Reality Lens object stays here; sign-in is not connected to the Lens.","info");
    publish("external-tab-open",method||"button",{assistantId:receipt.assistantId,returnInLens:true,authenticationConnected:false});
  }

  function showLensReturn(method="external-return"){
    if(!state.pendingExternalReturn)return false;
    setOpen(true,method);
    setTab("web",method,true);
    handoffBox.hidden=false;
    handoffText.textContent="You are back in the Reality Lens. This same Web + AI object and your task note stayed in this tab. External registration is not linked to a Lens account.";
    returnToLensButton.hidden=false;
    setStatus("BACK IN THE LENS · the Web + AI object and task note are still here.","info");
    publish("external-return",method,{assistantId:state.pendingExternalReturn.assistantId,returnedToSameTab:true,registrationVerified:false});
    return true;
  }

  function observeExternalReturn(){
    try{if(doc.visibilityState==="hidden")return;}catch{}
    showLensReturn("external-return");
  }

  function updatePromptPreview() {
    promptPreview.value = buildAiPrompt({ taskNote: state.note, pageUrl: state.url });
  }

  function applyStoredPosition() {
    if (panel.hasAttribute("data-lens-surface-attached")) return;
    const pos = parsePosition(readStorage(store, WEB_AI_STORAGE_KEYS.position));
    if (!pos) return;
    const viewportWidth = windowRoot && Number.isFinite(windowRoot.innerWidth) ? windowRoot.innerWidth : 1024;
    const viewportHeight = windowRoot && Number.isFinite(windowRoot.innerHeight) ? windowRoot.innerHeight : 768;
    const width = Math.min(520, viewportWidth - 40);
    panel.style.left = `${Math.max(0, Math.min(pos.left, viewportWidth - width))}px`;
    panel.style.top = `${Math.max(0, Math.min(pos.top, viewportHeight - 48))}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  function setTab(next, method, silent) {
    state.tab = ["web", "ai", "economy"].includes(next) ? next : "web";
    const isWeb = state.tab === "web";
    const isAi = state.tab === "ai";
    const isEconomy = state.tab === "economy";
    webTab.setAttribute("aria-selected", String(isWeb));
    aiTab.setAttribute("aria-selected", String(isAi));
    economyTab.setAttribute("aria-selected", String(isEconomy));
    webSection.hidden = !isWeb;
    aiSection.hidden = !isAi;
    economySection.hidden = !isEconomy;
    writeStorage(store, WEB_AI_STORAGE_KEYS.lastTab, state.tab);
    if (!silent) publish("tab", method || "api", { tab: state.tab });
  }

  function setOpen(next, method) {
    state.opened = Boolean(next);
    if (state.opened) {
      state.minimized = false;
      panel.hidden = false;
      chip.hidden = true;
      applyStoredPosition();
      writeStorage(store, WEB_AI_STORAGE_KEYS.minimized, "0");
    } else {
      panel.hidden = true;
      chip.hidden = true;
    }
    return publish(state.opened ? "open" : "close", method || "api");
  }

  function minimize(method) {
    state.minimized = true;
    state.opened = false;
    panel.hidden = true;
    chip.hidden = false;
    writeStorage(store, WEB_AI_STORAGE_KEYS.minimized, "1");
    return publish("minimize", method || "api");
  }

  function openInNewTab(url, method, actionName, statusSetter) {
    const ok = openNewTab(windowRoot, url);
    if (!ok && typeof statusSetter === "function") {
      statusSetter("POP-UP BLOCKED — ALLOW POP-UPS FOR THIS PAGE, OR COPY THE URL MANUALLY.", "error");
    }
    if(ok)rememberExternalReturn("external-site",method);
    return publish(actionName, method, { targetUrl: url, userNavigation: "new-tab", popupBlocked: !ok, externalNetwork: true });
  }

  function startEmbed(result, method) {
    handoffBox.hidden = true;
    framewrap.hidden = false;
    if (embedTimer) clearTimeout(embedTimer);
    embedWaiting = true;
    setStatus(
      `${result.mode === "try" ? "TRYING FRAME — POLICY UNKNOWN. " : "LOADING IN FRAME. "}If it stays blank, the site blocks framing — use “OPEN IN NEW TAB”.`,
      "info",
    );
    frame.onload = () => {
      embedWaiting = false;
      if (embedTimer) clearTimeout(embedTimer);
      setStatus("FRAME REPORTED LOAD — IF IT IS BLANK, THE SITE BLOCKS FRAMING.", "info");
    };
    if (frame.dataset.current === result.url) {
      try {
        frame.contentWindow.location.reload();
      } catch {
        frame.src = result.url;
      }
    } else {
      frame.dataset.current = result.url;
      frame.src = result.url;
    }
    embedTimer = setTimeout(() => {
      if (!embedWaiting) return;
      embedWaiting = false;
      setStatus("STILL BLANK AFTER 12S — THIS SITE LIKELY BLOCKS FRAMING. USE “OPEN IN NEW TAB”.", "warn");
    }, FRAME_LOAD_TIMEOUT_MS);
    publish("navigate-embed", method, {
      targetUrl: result.url,
      mode: result.mode,
      externalContent: true, externalNetwork: true,
      sandbox: "sandboxed-iframe",
    });
  }

  function showHandoff(result, method) {
    framewrap.hidden = true;
    handoffBox.hidden = false;
    let host = "";
    try {
      host = new URL(result.url).hostname;
    } catch {}
    handoffText.textContent =
      `${host || "This site"} blocks framing (${result.reason}) It opens in a new tab — ` +
      "use COPY NOTE + URL to carry your task note and the address over.";
    publish("navigate-handoff", method, { targetUrl: result.url, mode: "handoff", userNavigation: "new-tab" });
  }

  function openWebUrl(raw, method) {
    const result = classifyWebTarget(raw);
    if (result.mode === "invalid") {
      framewrap.hidden = true;
      handoffBox.hidden = true;
      setStatus(result.reason, "error");
      publish("navigate-invalid", method || "api", { input: String(raw ?? "").slice(0, 120) });
      return;
    }
    state.url = result.url;
    urlInput.value = result.url;
    writeStorage(store, WEB_AI_STORAGE_KEYS.lastUrl, result.url);
    updatePromptPreview();
    if (result.mode === "handoff") showHandoff(result, method || "api");
    else startEmbed(result, method || "api");
  }

  function assistantPrompt() {
    return buildAiPrompt({ taskNote: state.note, pageUrl: state.url });
  }

  // --- wire controls ---
  [...WEB_AI_EMBED_PRESETS, ...WEB_AI_HANDOFF_PRESETS].forEach((preset) => {
    const button = el(doc, "button", "web-ai-preset");
    button.type = "button";
    button.dataset.mode = preset.mode;
    button.title = preset.note;
    button.appendChild(el(doc, "span", "dot"));
    button.appendChild(doc.createTextNode(preset.label));
    button.addEventListener("click", () => openWebUrl(preset.url, "preset"));
    presets.appendChild(button);
  });

  goButton.addEventListener("click", () => openWebUrl(urlInput.value, "button"));
  urlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      openWebUrl(urlInput.value, "keyboard");
    }
  });
  frameOpenButton.addEventListener("click", () => {
    if (state.url) openInNewTab(state.url, "button", "frame-open-new-tab", setStatus);
  });
  handoffOpenButton.addEventListener("click", () => {
    if (state.url) { copyText(doc, windowRoot, assistantPrompt()); openInNewTab(state.url, "button", "handoff-open-new-tab", setStatus); }
  });
  handoffTryButton.addEventListener("click", () => {
    if (state.url) startEmbed({ mode: "try", url: state.url, reason: "Manual retry requested." }, "button");
  });
  handoffCopyButton.addEventListener("click", () => {
    copyText(doc, windowRoot, assistantPrompt()).then((ok) => {
      setStatus(ok ? "NOTE + URL COPIED — PASTE WHEREVER THE NEW TAB NEEDS IT." : "COPY FAILED — SELECT THE TEXT MANUALLY.", ok ? "info" : "error");
      publish("handoff-copy", "button", { copied: ok });
    });
  });
  returnToLensButton.addEventListener("click", () => {
    const assistantId=state.pendingExternalReturn?.assistantId??null;
    state.pendingExternalReturn=null;
    writeStorage(sessionStore,WEB_AI_STORAGE_KEYS.lensReturn,"");
    returnToLensButton.hidden=true;
    setTab("ai","lens-return");
    setAiStatus("You are back in this same Lens object. Your task note remains saved locally; paste it into the external assistant yourself. No sign-in has been shared with this demo.","info");
    publish("lens-return", "button", {assistantId,returnedToSameObject:true,authenticationConnected:false});
  });
  noteInput.addEventListener("input", () => {
    state.note = noteInput.value;
    writeStorage(store, WEB_AI_STORAGE_KEYS.taskNote, state.note);
    updatePromptPreview();
  });
  webTab.addEventListener("click", () => setTab("web", "button"));
  aiTab.addEventListener("click", () => setTab("ai", "button"));
  economyTab.addEventListener("click", () => setTab("economy", "button"));
  minimizeButton.addEventListener("click", () => minimize("button"));
  closeButton.addEventListener("click", () => setOpen(false, "button"));
  chip.addEventListener("click", () => setOpen(true, "chip"));
  windowRoot?.addEventListener?.("focus",observeExternalReturn);
  doc.addEventListener?.("visibilitychange",observeExternalReturn);

  function appendEconomicEvent(type, source, payload = {}) {
    const event = economicTimeline.append({ type, source, payload });
    renderEconomicTimeline();
    return event;
  }

  function renderEconomicTimeline() {
    if (!timelineList) return;
    timelineList.replaceChildren();
    const snapshot = economicTimeline.snapshot();
    if (!snapshot.events.length) {
      timelineList.appendChild(el(doc, "div", "web-ai-economy-statusline", "No economic events yet. The first demo credit, route decision, usage receipt or contribution will appear here."));
      return;
    }
    snapshot.events.slice(-10).reverse().forEach((event) => {
      const row = el(doc, "div", "web-ai-economy-event");
      row.appendChild(el(doc, "b", null, `#${event.sequence}`));
      row.appendChild(el(doc, "span", null, `${event.type} · ${event.source}`));
      row.appendChild(el(doc, "code", null, event.checksum));
      timelineList.appendChild(row);
    });
  }

  function refreshEconomyMetrics() {
    const exchange = computeLedger.snapshot();
    const account = computeAccount.snapshot();
    const vault = contributionVault.snapshot();
    balanceValue.textContent = `${account.balanceUsd.toFixed(2)}`;
    spendValue.textContent = `${exchange.totals.verifiedSpendUsd.toFixed(2)}`;
    tokenValue.textContent = exchange.totals.totalTokens.toLocaleString();
    const totalReward = exchange.totals.tumboSimReward + vault.totalRewardTumboSim;
    rewardValue.textContent = totalReward.toFixed(4).replace(/\.?0+$/, "") || "0";
    accountStatus.textContent = `$ ${account.balanceUsd.toFixed(2)} demo credits · $ ${account.spentUsd.toFixed(2)} spent · $ ${account.remainingMonthlyBudgetUsd.toFixed(2)} monthly budget remaining`;
    renderEconomicTimeline();
    return { exchange, account, vault, timeline: economicTimeline.snapshot(), totalRewardTumboSim: totalReward };
  }

  let demoFundingSequence = 0;
  fundButton.addEventListener("click", () => {
    try {
      const amountUsd = Number(fundInput.value);
      const fundingId = `demo-fund-${Date.now()}-${++demoFundingSequence}`;
      computeAccount.fundDemo({ fundingId, amountUsd, reason: "explicit-ui-demo-credit" });
      appendEconomicEvent("credits.demo-funded", "compute-account", { fundingId, amountUsd });
      accountStatus.textContent = `Added ${amountUsd.toFixed(2)} demo compute credits. No money was charged.`;
      refreshEconomyMetrics();
      publish("compute-demo-funded", "button", { fundingId, amountUsd });
    } catch (error) {
      accountStatus.textContent = `Demo credit rejected: ${error?.message ?? "invalid amount"}.`;
    }
  });

  budgetButton.addEventListener("click", () => {
    try {
      const budget = computeAccount.setBudget({
        monthlyBudgetUsd: monthlyBudgetInput.value,
        perTaskBudgetUsd: perTaskBudgetInput.value,
      });
      appendEconomicEvent("budget.updated", "compute-account", budget);
      accountStatus.textContent = `Budget guardrails saved: ${budget.monthlyBudgetUsd.toFixed(2)} monthly / ${budget.perTaskBudgetUsd.toFixed(2)} per task.`;
      refreshEconomyMetrics();
    } catch (error) {
      accountStatus.textContent = `Budget rejected: ${error?.message ?? "invalid budget"}.`;
    }
  });

  const quoteControls = new Map();
  COMPUTE_PROVIDERS.forEach((provider) => {
    const card = el(doc, "article", "web-ai-economy-provider");
    card.appendChild(el(doc, "strong", null, provider.name));
    card.appendChild(el(doc, "span", null, `capabilities · ${provider.capabilities.join(" · ")} · ${provider.executionMode} · live price requires adapter`));
    const openButton = el(doc, "button", "web-ai-btn", provider.chatUrl ? "OPEN PROVIDER →" : "LOCAL ADAPTER REQUIRED");
    openButton.type = "button";
    openButton.disabled = !provider.chatUrl;
    openButton.addEventListener("click", () => {
      if (!provider.chatUrl) return;
      const ok = openNewTab(windowRoot, provider.chatUrl);
      if (ok) rememberExternalReturn(provider.id, "compute-provider");
      economyStatus.textContent = ok
        ? `Opened ${provider.name} in a separate tab. maTumbo did not share credentials or claim billing authority.`
        : "Pop-up blocked. Allow pop-ups, then retry.";
      economyStatus.dataset.kind = ok ? "info" : "error";
      publish("compute-provider-open", "button", { providerId: provider.id, externalNetwork: true, popupBlocked: !ok });
    });
    card.appendChild(openButton);
    providerGrid.appendChild(card);

    const quoteRow = el(doc, "div", "web-ai-route-quote");
    quoteRow.appendChild(el(doc, "strong", null, provider.name));
    const cost = el(doc, "input");
    cost.type="number"; cost.min="0"; cost.step="0.0001"; cost.placeholder="cost $";
    cost.setAttribute("aria-label", `${provider.name} estimated cost`);
    const latency = el(doc, "input");
    latency.type="number"; latency.min="0"; latency.step="1"; latency.placeholder="latency ms";
    latency.setAttribute("aria-label", `${provider.name} estimated latency`);
    quoteRow.append(cost, latency);
    routeQuotes.appendChild(quoteRow);
    quoteControls.set(provider.id, { cost, latency });
  });

  routeButton.addEventListener("click", () => {
    const quotes = [];
    for (const [providerId, controls] of quoteControls) {
      if (controls.cost.value === "") continue;
      quotes.push({
        providerId,
        estimatedCostUsd: Number(controls.cost.value),
        estimatedLatencyMs: controls.latency.value === "" ? Number.POSITIVE_INFINITY : Number(controls.latency.value),
      });
    }
    const result = selectProviderRoute(quotes, {
      priority: routePriority.value,
      maxCostUsd: routeMaxCost.value === "" ? Number.POSITIVE_INFINITY : Number(routeMaxCost.value),
      maxLatencyMs: routeMaxLatency.value === "" ? Number.POSITIVE_INFINITY : Number(routeMaxLatency.value),
      requiredCapabilities: state.note ? ["chat"] : [],
      privacy: routePrivacy.value,
    });
    if (!result.selected) {
      routeResult.textContent = `No entered quote satisfies the policy. Rejected: ${result.rejected.map((row) => `${row.providerId}:${row.reason}`).join(", ") || "none entered"}.`;
      appendEconomicEvent("route.no-match", "compute-router", { policy: result.policy, rejected: result.rejected });
      publish("compute-route-no-match", "button", { policy: result.policy, rejected: result.rejected });
      return;
    }
    routeResult.textContent = `Selected ${result.selected.providerName} · estimated ${result.selected.estimatedCostUsd.toFixed(4)} · ${Number.isFinite(result.selected.estimatedLatencyMs) ? `${result.selected.estimatedLatencyMs} ms` : "latency unavailable"} · policy ${result.policy.priority}.`;
    appendEconomicEvent("route.selected", "compute-router", {
      providerId: result.selected.providerId,
      estimatedCostUsd: result.selected.estimatedCostUsd,
      estimatedLatencyMs: result.selected.estimatedLatencyMs,
      priority: result.policy.priority,
      privacy: result.policy.privacy,
    });
    publish("compute-route-selected", "button", { selected: result.selected, policy: result.policy });
  });

  let localReceiptSequence = 0;
  recordButton.addEventListener("click", () => {
    const receiptId = `local-demo-${Date.now()}-${++localReceiptSequence}`;
    const draftReceipt = {
      receiptId,
      providerId: providerSelect.value,
      model: modelInput.value,
      inputTokens: inputTokensInput.value,
      outputTokens: outputTokensInput.value,
      reportedCostUsd: spendInput.value,
      verified: verifiedInput.checked,
    };

    if (draftReceipt.verified) {
      let accountResult;
      try {
        accountResult = computeAccount.spendVerified({
          spendId: receiptId,
          providerId: draftReceipt.providerId,
          amountUsd: draftReceipt.reportedCostUsd,
        });
      } catch (error) {
        economyStatus.textContent = `Spend rejected: ${error?.message ?? "invalid amount"}.`;
        economyStatus.dataset.kind = "error";
        return;
      }
      if (!accountResult.accepted) {
        economyStatus.textContent = `Spend blocked by compute wallet: ${accountResult.reason}. Add demo credits or change your budget guardrails.`;
        economyStatus.dataset.kind = "warn";
        appendEconomicEvent("usage.blocked", "compute-account", { receiptId, reason: accountResult.reason });
        refreshEconomyMetrics();
        return;
      }
      appendEconomicEvent("credits.spent", "compute-account", {
        receiptId,
        providerId: draftReceipt.providerId,
        amountUsd: Number(draftReceipt.reportedCostUsd),
      });
    }

    let result;
    try {
      result = computeLedger.record(draftReceipt);
    } catch (error) {
      economyStatus.textContent = `Receipt rejected: ${error?.message ?? "invalid input"}.`;
      economyStatus.dataset.kind = "error";
      publish("compute-usage-rejected", "button", { reason: String(error?.message ?? "invalid input") });
      return;
    }

    appendEconomicEvent("provider.usage", result.receipt.providerId, {
      receiptId: result.receipt.receiptId,
      model: result.receipt.model,
      totalTokens: result.receipt.totalTokens,
      reportedCostUsd: result.receipt.reportedCostUsd,
      verified: result.receipt.verified,
    });
    appendEconomicEvent("prime-ledger.receipt-target", "prime-ledger-echoproof", {
      receiptId: result.receipt.receiptId,
      rewardTumboSim: result.reward.tumboSim,
      proofStatus: "target-only-not-cryptographic",
    });

    const snapshot = refreshEconomyMetrics();
    economyStatus.textContent = result.reward.eligible
      ? `Recorded ${result.receipt.totalTokens.toLocaleString()} tokens · $${result.receipt.reportedCostUsd.toFixed(4)} verified spend · +${result.reward.tumboSim} TUMBO-SIM.`
      : `Recorded ${result.receipt.totalTokens.toLocaleString()} tokens, but no reward accrued because the receipt is ${result.reward.reason}.`;
    economyStatus.dataset.kind = result.reward.eligible ? "info" : "warn";
    publish("compute-usage-recorded", "button", {
      receiptId: result.receipt.receiptId,
      providerId: result.receipt.providerId,
      totalTokens: result.receipt.totalTokens,
      reportedCostUsd: result.receipt.reportedCostUsd,
      verified: result.receipt.verified,
      tumboSimReward: result.reward.tumboSim,
      economicLoop: result.economicLoop ?? [],
      computeTotals: snapshot.exchange.totals,
      account: snapshot.account,
      vault: snapshot.vault,
      timeline: snapshot.timeline,
    });
  });

  let contributionSequence = 0;
  contributeButton.addEventListener("click", () => {
    const contributionId = `local-contribution-${Date.now()}-${++contributionSequence}`;
    try {
      const proposal = contributionVault.propose({
        contributionId,
        category: vaultCategory.value,
        units: vaultUnits.value,
        purpose: vaultPurpose.value,
        retentionDays: vaultRetention.value,
      });
      appendEconomicEvent("contribution.proposed", "contribution-vault", {
        contributionId,
        category: proposal.category,
        units: proposal.units,
      });

      if (!explicitConsent.checked) {
        vaultStatus.textContent = "Proposal created locally, but no consent was granted. No acceptance and no reward.";
        refreshEconomyMetrics();
        publish("contribution-proposed", "button", { contributionId, authorized: false });
        return;
      }

      contributionVault.authorize(contributionId, {
        scope: vaultScope.value,
        allowTraining: trainingConsent.checked,
        allowResearch: true,
      });
      appendEconomicEvent("contribution.authorized", "contribution-vault", {
        contributionId,
        scope: vaultScope.value,
        allowTraining: trainingConsent.checked,
      });
      const accepted = contributionVault.accept(contributionId, { evidenceId: `local-evidence-${contributionId}` });
      appendEconomicEvent("contribution.accepted", "contribution-vault", {
        contributionId,
        rewardTumboSim: accepted.record.rewardTumboSim,
        rawContentStored: false,
      });
      vaultStatus.textContent = `Accepted metadata-only contribution · +${accepted.record.rewardTumboSim} TUMBO-SIM demo reward · raw content stored: NO.`;
      refreshEconomyMetrics();
      publish("contribution-accepted", "button", {
        contributionId,
        rewardTumboSim: accepted.record.rewardTumboSim,
        consent: accepted.record.consent,
        rawContentStored: false,
      });
    } catch (error) {
      vaultStatus.textContent = `Contribution rejected: ${error?.message ?? "invalid contribution"}.`;
    }
  });

  refreshEconomyMetrics();

  WEB_AI_ASSISTANTS.forEach((assistant) => {
    const card = el(doc, "article", "web-ai-assistant");
    card.appendChild(el(doc, "strong", null, assistant.name));
    card.appendChild(el(doc, "p", null, assistant.blurb));
    const actions = el(doc, "div", "web-ai-assistant-actions");
    const copyButton = el(doc, "button", "web-ai-btn", "COPY PROMPT");
    copyButton.type = "button";
    copyButton.addEventListener("click", () => {
      copyText(doc, windowRoot, assistantPrompt()).then((ok) => {
        setAiStatus(
          ok ? `PROMPT COPIED — PASTE IT IN ${assistant.name.toUpperCase()}.` : "COPY FAILED — SELECT THE PREVIEW TEXT MANUALLY.",
          ok ? "info" : "error",
        );
        publish("assistant-copy", "button", { assistantId: assistant.id, copied: ok });
      });
    });
    const openButton = el(doc, "button", "web-ai-btn primary", `OPEN ${assistant.name.toUpperCase()} →`);
    openButton.type = "button";
    openButton.addEventListener("click", () => {
      const ok = openNewTab(windowRoot, assistant.url);
      if(ok)rememberExternalReturn(assistant.id,"button");
      setAiStatus(
        ok ? `OPENED ${assistant.name.toUpperCase()} IN A SEPARATE TAB — RETURN TO THIS SAME LENS OBJECT WHEN READY. SIGN-IN IS NOT LINKED TO THIS DEMO.` : "POP-UP BLOCKED — ALLOW POP-UPS, THEN RETRY.",
        ok ? "info" : "error",
      );
      publish("assistant-open", "button", {
        assistantId: assistant.id,
        targetUrl: assistant.url,
        userNavigation: "new-tab",
        popupBlocked: !ok, externalNetwork: true,
      });
    });
    actions.appendChild(copyButton);
    actions.appendChild(openButton);
    card.appendChild(actions);
    assistants.appendChild(card);
  });

  // --- drag the panel by its header; the position is remembered ---
  let drag = null;
  head.addEventListener("pointerdown", (event) => {
    if (panel.hasAttribute("data-lens-surface-attached")) return;
    if (event.button !== 0) return;
    if (event.target && event.target.closest && event.target.closest("button")) return;
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseLeft: rect.left,
      baseTop: rect.top,
    };
    try {
      head.setPointerCapture(event.pointerId);
    } catch {}
    event.preventDefault();
  });
  head.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const width = panel.offsetWidth || 320;
    const viewportWidth = windowRoot && Number.isFinite(windowRoot.innerWidth) ? windowRoot.innerWidth : 1024;
    const viewportHeight = windowRoot && Number.isFinite(windowRoot.innerHeight) ? windowRoot.innerHeight : 768;
    const maxLeft = Math.max(0, viewportWidth - width);
    const maxTop = Math.max(0, viewportHeight - 48);
    const left = Math.min(maxLeft, Math.max(0, drag.baseLeft + event.clientX - drag.startX));
    const top = Math.min(maxTop, Math.max(0, drag.baseTop + event.clientY - drag.startY));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });
  function endDrag(event) {
    if (!drag) return;
    if (event && event.pointerId !== drag.pointerId) return;
    drag = null;
    writeStorage(
      store,
      WEB_AI_STORAGE_KEYS.position,
      JSON.stringify({ left: parseFloat(panel.style.left) || 0, top: parseFloat(panel.style.top) || 0 }),
    );
  }
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);

  // --- restore remembered state ---
  state.note = readStorage(store, WEB_AI_STORAGE_KEYS.taskNote) || "";
  noteInput.value = state.note;
  const lastUrl = readStorage(store, WEB_AI_STORAGE_KEYS.lastUrl);
  if (lastUrl) {
    urlInput.value = lastUrl;
    state.url = lastUrl;
  }
  updatePromptPreview();
  {
    const savedTab = readStorage(store, WEB_AI_STORAGE_KEYS.lastTab);
    setTab(["web", "ai", "economy"].includes(savedTab) ? savedTab : "web", "init", true);
  }
  if (readStorage(store, WEB_AI_STORAGE_KEYS.minimized) === "1") {
    state.minimized = true;
    panel.hidden = true;
    chip.hidden = false;
  }

  function getSnapshot() {
    return Object.freeze({
      source: WEB_AI_CONSOLE_SOURCE,
      action: "read",
      method: "api",
      opened: state.opened,
      minimized: state.minimized,
      tab: state.tab,
      url: state.url,
      noteLength: state.note.length,
      computeEconomy: computeLedger.snapshot(),
      computeAccount: computeAccount.snapshot(),
      contributionVault: contributionVault.snapshot(),
      economicTimeline: economicTimeline.snapshot(),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      boundary: WEB_AI_BOUNDARY,
    });
  }

  return Object.freeze({
    source: WEB_AI_CONSOLE_SOURCE,
    open: (method = "api") => setOpen(true, method),
    close: (method = "api") => setOpen(false, method),
    toggle: (method = "api") => setOpen(!state.opened, method),
    minimize: (method = "api") => minimize(method),
    setTab: (tab, method = "api") => setTab(tab, method, false),
    getComputeEconomySnapshot: () => Object.freeze({
      exchange: computeLedger.snapshot(),
      account: computeAccount.snapshot(),
      vault: contributionVault.snapshot(),
      timeline: economicTimeline.snapshot(),
    }),
    fundDemoComputeCredits: (amountUsd, method = "api") => {
      const fundingId = `api-demo-fund-${Date.now()}-${++demoFundingSequence}`;
      const snapshot = computeAccount.fundDemo({ fundingId, amountUsd, reason: method });
      appendEconomicEvent("credits.demo-funded", "compute-account", { fundingId, amountUsd: Number(amountUsd) });
      refreshEconomyMetrics();
      publish("compute-demo-funded", method, { fundingId, amountUsd: Number(amountUsd) });
      return snapshot;
    },
    recordComputeUsage: (receipt, method = "api") => {
      if (receipt?.verified === true) {
        const debit = computeAccount.spendVerified({
          spendId: receipt.receiptId,
          providerId: receipt.providerId,
          amountUsd: receipt.reportedCostUsd,
        });
        if (!debit.accepted) return Object.freeze({ accepted: false, reason: debit.reason, account: debit.snapshot });
        appendEconomicEvent("credits.spent", "compute-account", {
          receiptId: receipt.receiptId,
          providerId: receipt.providerId,
          amountUsd: Number(receipt.reportedCostUsd),
        });
      }
      const result = computeLedger.record(receipt);
      appendEconomicEvent("provider.usage", result.receipt.providerId, {
        receiptId: result.receipt.receiptId,
        totalTokens: result.receipt.totalTokens,
        reportedCostUsd: result.receipt.reportedCostUsd,
        verified: result.receipt.verified,
      });
      refreshEconomyMetrics();
      publish("compute-usage-recorded", method, {
        receiptId: result.receipt.receiptId,
        providerId: result.receipt.providerId,
        totalTokens: result.receipt.totalTokens,
        reportedCostUsd: result.receipt.reportedCostUsd,
        verified: result.receipt.verified,
        tumboSimReward: result.reward.tumboSim,
        economicLoop: result.economicLoop ?? [],
      });
      return result;
    },
    navigate: (url, method = "api") => {
      setOpen(true, method);
      openWebUrl(url, method);
    },
    setNote: (note, method = "api") => {
      state.note = String(note ?? "");
      noteInput.value = state.note;
      writeStorage(store, WEB_AI_STORAGE_KEYS.taskNote, state.note);
      updatePromptPreview();
      return publish("set-note", method);
    },
    getSnapshot,
    getState: () => ({ ...state }),
  });
}

export default createWebAiConsole;
