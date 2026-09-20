/**
 * web-ai.js — Web + AI glass console renderer.
 *
 * DOM adapter for the Web + AI feature. It injects its own glass panel (an
 * <aside>, like the feature-world overlay in feature-worlds.js) so no
 * index.html edit is needed, and main.js mounts it exactly like the other
 * feature consoles.
 *
 * Design-law compliance:
 *  - glass look: translucent blue glass panel, cyan edges, backdrop blur
 *  - small by default: two tabs (WEB / AI HELP), every panel body scrolls
 *  - minimize collapses to a small translucent chip
 *  - draggable header; position remembered in localStorage
 *  - opens only on interaction (portal route / Mission Control)
 *  - mobile: full-width sheet at <=700px (390x844)
 *
 * 3D note (standing requirement): this console adds NO new 3D geometry and
 * uses no 3D library at all. The Web + AI portal cube itself is rendered by
 * the existing block-world layer with the repo's pinned three.js r179.1
 * glass recipe (translucent blue glass + glowing edges + connection lines
 * via the import map "three" -> ./vendor/three-r179.1/build/three.module.js).
 * All 3D in this feature therefore stays three.js r179.1.
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
} from "../domains/web-ai.js";

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
      ? windowRoot.open(url, "_blank", "noopener")
      : null;
    return opened !== null && opened !== undefined;
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

  const styleEl = doc.createElement("style");
  styleEl.setAttribute("data-web-ai-style", "true");
  styleEl.textContent = STYLE_TEXT;
  (doc.head || doc).appendChild(styleEl);

  const state = { opened: false, minimized: false, tab: "web", url: "", note: "" };

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
  tabs.appendChild(webTab);
  tabs.appendChild(aiTab);
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
  handoffActions.appendChild(handoffOpenButton);
  handoffActions.appendChild(handoffTryButton);
  handoffActions.appendChild(handoffCopyButton);
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

  body.appendChild(webSection);
  body.appendChild(aiSection);
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

  function updatePromptPreview() {
    promptPreview.value = buildAiPrompt({ taskNote: state.note, pageUrl: state.url });
  }

  function applyStoredPosition() {
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
    state.tab = next === "ai" ? "ai" : "web";
    const isWeb = state.tab === "web";
    webTab.setAttribute("aria-selected", String(isWeb));
    aiTab.setAttribute("aria-selected", String(!isWeb));
    webSection.hidden = !isWeb;
    aiSection.hidden = isWeb;
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
    return publish(actionName, method, { targetUrl: url, userNavigation: "new-tab", popupBlocked: !ok });
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
      externalContent: true,
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
    if (state.url) openInNewTab(state.url, "button", "handoff-open-new-tab", setStatus);
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
  noteInput.addEventListener("input", () => {
    state.note = noteInput.value;
    writeStorage(store, WEB_AI_STORAGE_KEYS.taskNote, state.note);
    updatePromptPreview();
  });
  webTab.addEventListener("click", () => setTab("web", "button"));
  aiTab.addEventListener("click", () => setTab("ai", "button"));
  minimizeButton.addEventListener("click", () => minimize("button"));
  closeButton.addEventListener("click", () => setOpen(false, "button"));
  chip.addEventListener("click", () => setOpen(true, "chip"));

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
      setAiStatus(
        ok ? `OPENED ${assistant.name.toUpperCase()} IN A NEW TAB — PASTE THE COPIED PROMPT.` : "POP-UP BLOCKED — ALLOW POP-UPS, THEN RETRY.",
        ok ? "info" : "error",
      );
      publish("assistant-open", "button", {
        assistantId: assistant.id,
        targetUrl: assistant.url,
        userNavigation: "new-tab",
        popupBlocked: !ok,
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
  setTab(readStorage(store, WEB_AI_STORAGE_KEYS.lastTab) === "ai" ? "ai" : "web", "init", true);
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
