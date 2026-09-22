/**
 * token-transfers-ui.js - Part 02, Token transfer console (block-world UI).
 *
 * A small, self-mounting transfer console for the TUMBO-SIM transfer engine.
 * A small translucent-blue glass cube (three.js r179.1, built with the
 * canonical glass-style helpers) lives in a minimized chip from the first
 * frame; the chip opens the transfer panel only on interaction.
 *
 * Simulation-only: every surface is labeled simulated. No real money,
 * wagering, wallets, custody, or chains.
 */

import * as THREE from "three?v=20260922-cache2";
import {
  makeGlassCube,
  addGlassLighting,
  glassTintFor,
} from "../render/glass-style.js?v=20260922-cache2";
import {
  attachTokenTransfers,
  FLUFF_PER_TUMBO_SIM,
} from "./token-transfers.js?v=20260922-cache2";

export const TOKEN_TRANSFER_UI_VERSION = "20260922-token-transfers-cube3";
export const TOKEN_TRANSFER_UI_SOURCE = "tumbo-token-transfer-console";

const CHIP_STORAGE_KEY = "tumbo:token-transfer-chip-pos";
const PANEL_STORAGE_KEY = "tumbo:token-transfer-panel-pos";
const DEMO_USER = "u:you";
const TRANSFER_CUBE_TINT = glassTintFor("#2fd4c8", 0.32);

const CSS = `
#token-transfer-chip{position:fixed;z-index:44;width:118px;padding:8px 8px 7px;border:1px solid rgba(129,232,255,.24);border-radius:16px;background:linear-gradient(165deg,rgba(4,17,25,.93),rgba(3,7,12,.88));box-shadow:0 18px 50px rgba(0,0,0,.45),inset 0 0 24px rgba(70,210,255,.05);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;color:#dff7ff;font:inherit;text-align:center}
#token-transfer-chip:active{cursor:grabbing}
#token-transfer-chip:focus-visible{outline:2px solid #7ae6ff;outline-offset:2px}
#token-transfer-chip[data-selected=true]{border-color:rgba(197,230,255,.75);box-shadow:0 18px 50px rgba(0,0,0,.45),0 0 26px rgba(110,220,255,.28)}
#token-transfer-cube{display:block;width:100px;height:100px;margin:0 auto;pointer-events:none}
.tt-chip-label{display:block;margin-top:2px;color:#c8f7ff;font-size:9px;font-weight:700;letter-spacing:.14em;line-height:1.5}
.tt-chip-sim{display:inline-block;margin-top:3px;padding:2px 6px;border:1px solid rgba(255,194,139,.4);border-radius:999px;color:#f0d3a8;background:rgba(121,75,40,.16);font-size:7px;letter-spacing:.12em}
.tt-chip-peek{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);min-width:170px;max-width:230px;padding:8px 10px;border:1px solid rgba(129,232,255,.25);border-radius:10px;background:rgba(3,12,18,.95);color:#b9deea;font-size:9px;line-height:1.5;letter-spacing:.03em;pointer-events:none;white-space:pre-line}
.tt-chip-peek[hidden]{display:none}
#token-transfer-console{position:fixed;z-index:45;right:20px;bottom:86px;width:min(440px,calc(100vw - 40px));max-height:min(660px,calc(100vh - 110px));display:flex;flex-direction:column;border:1px solid rgba(129,232,255,.26);border-radius:18px;background:linear-gradient(165deg,rgba(4,17,25,.96),rgba(3,7,12,.94));box-shadow:0 24px 70px rgba(0,0,0,.55),inset 0 0 36px rgba(56,203,235,.05);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);overflow:hidden}
#token-transfer-console[hidden]{display:none}
#token-transfer-console.tt-expanded{width:min(620px,calc(100vw - 40px));max-height:calc(100vh - 60px);top:30px;bottom:auto}
.tt-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;cursor:grab;padding:13px 14px 10px;border-bottom:1px solid rgba(129,232,255,.14)}
.tt-head:active{cursor:grabbing}.tt-eyebrow{display:block;color:#70cce0;font-size:8px;letter-spacing:.2em;text-transform:uppercase}
.tt-head h2{margin:4px 0 3px;color:#e0fbff;font-size:18px;letter-spacing:.01em}
.tt-head p{margin:0;color:#8baab5;font-size:10px;line-height:1.4}
.tt-head-actions{display:flex;gap:6px;flex:0 0 auto}
.tt-icon-btn{appearance:none;min-width:40px;min-height:40px;border:1px solid rgba(137,222,239,.2);border-radius:9px;background:rgba(84,170,195,.08);color:#9bc7d2;font-size:13px;cursor:pointer;touch-action:manipulation}
.tt-icon-btn:hover,.tt-icon-btn:focus-visible{color:#eaffff;border-color:rgba(178,244,255,.6);outline:none}
.tt-body{overflow-y:auto;overflow-x:hidden;padding:12px 14px 14px;scrollbar-width:thin;scrollbar-color:rgba(111,217,239,.42) rgba(5,20,28,.62)}
.tt-section{margin-bottom:14px}
.tt-section h3{margin:0 0 7px;color:#9ee6f5;font-size:9px;letter-spacing:.15em;text-transform:uppercase}
.tt-balances{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:7px}
.tt-balance{padding:7px 8px;border:1px solid rgba(124,226,245,.12);border-radius:8px;background:rgba(46,129,149,.08);min-width:0}
.tt-balance b{display:block;color:#d8f9ff;font-size:11px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-balance span{display:block;margin-top:2px;color:#6e99a5;font-size:7px;letter-spacing:.08em;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-form{display:grid;gap:7px}
.tt-form label{display:grid;gap:3px;color:#8fbbb0;font-size:8px;letter-spacing:.09em;text-transform:uppercase}
.tt-form input,.tt-form select{width:100%;min-width:0;min-height:40px;padding:8px 9px;border:1px solid rgba(130,225,202,.2);border-radius:8px;background:rgba(3,19,20,.78);color:#d7fff0;font-size:12px;outline:none;touch-action:manipulation}
.tt-form input:focus,.tt-form select:focus{border-color:rgba(165,255,225,.72);box-shadow:0 0 0 2px rgba(66,190,152,.14)}
.tt-form-row{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.tt-btn{appearance:none;min-height:44px;border:1px solid rgba(133,244,211,.3);border-radius:9px;padding:9px 10px;background:rgba(42,167,132,.16);color:#d5fff1;font-size:9px;font-weight:750;letter-spacing:.07em;text-transform:uppercase;cursor:pointer;touch-action:manipulation;transition:.16s ease}
.tt-btn:hover,.tt-btn:focus-visible{border-color:rgba(211,255,239,.84);background:rgba(52,181,151,.3);outline:none;transform:translateY(-1px)}
.tt-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
.tt-btn-secondary{border-color:rgba(126,208,249,.32);background:rgba(45,113,165,.18);color:#d9f4ff}
.tt-btn-secondary:hover,.tt-btn-secondary:focus-visible{background:rgba(55,132,190,.34)}
.tt-form-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.tt-status{padding:7px 8px;border-left:2px solid rgba(111,225,178,.6);border-radius:0 7px 7px 0;background:rgba(52,153,124,.12);color:#bdeed9;font-size:9px;line-height:1.4;overflow-wrap:anywhere}
.tt-status[data-tone=error]{border-left-color:rgba(255,120,132,.65);background:rgba(148,59,76,.14);color:#ffd1d6}
.tt-status[data-tone=info]{border-left-color:rgba(123,222,255,.6);background:rgba(39,123,164,.13);color:#c9f2ff}
.tt-status[hidden]{display:none}
.tt-intent{display:grid;gap:5px;margin-bottom:6px;padding:8px;border:1px solid rgba(255,208,121,.22);border-radius:9px;background:rgba(86,59,27,.22)}
.tt-intent-title{color:#ffe8bd;font-size:10px;font-weight:700;overflow-wrap:anywhere}
.tt-intent-meta{color:#d8b66f;font-size:8px;letter-spacing:.04em;text-transform:uppercase;overflow-wrap:anywhere}
.tt-intent-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.tt-empty{padding:8px;color:#8daeb8;font-size:9px}
.tt-receipt{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center;width:100%;margin-bottom:5px;padding:8px;border:1px solid rgba(255,207,133,.14);border-radius:9px;background:rgba(48,30,17,.6);color:#ecd7bd;text-align:left;cursor:pointer}
.tt-receipt:hover,.tt-receipt:focus-visible,.tt-receipt[aria-pressed=true]{border-color:rgba(255,221,161,.7);background:rgba(173,105,40,.26);outline:none}
.tt-receipt-title{color:#ffe8c6;font-size:9px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-receipt-meta{color:#c4a477;font-size:7px;letter-spacing:.05em;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-receipt-verify{color:#8fe1c7;font-size:8px;font-weight:700;white-space:nowrap}
.tt-detail{margin-top:8px;padding:9px;border:1px solid rgba(255,207,133,.2);border-radius:9px;background:rgba(8,11,16,.72)}
.tt-detail[hidden]{display:none}
.tt-detail pre{max-height:22vh;overflow:auto;margin:0 0 7px;padding:8px;border:1px solid rgba(255,207,133,.12);border-radius:7px;background:rgba(3,8,12,.8);color:#d9c8ad;font-size:8px;line-height:1.45;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.tt-checks{display:grid;gap:3px;margin-bottom:7px}
.tt-check{display:flex;justify-content:space-between;gap:8px;padding:4px 6px;border-radius:6px;background:rgba(48,30,17,.5);color:#e5caa5;font-size:8px;letter-spacing:.04em;text-transform:uppercase}
.tt-check b{color:#8fe1c7}
.tt-check[data-ok=false] b{color:#ff9aa2}
.tt-boundary{margin:4px 0 0;padding:8px 9px;border-left:2px solid rgba(255,194,139,.66);border-radius:0 8px 8px 0;background:rgba(121,75,40,.14);color:#dbc6af;font-size:9px;line-height:1.4}
@media (max-width:480px){
#token-transfer-chip{width:104px}
#token-transfer-cube{width:88px;height:88px}
#token-transfer-console{right:10px;left:10px;bottom:10px;width:auto;max-height:calc(100vh - 20px)}
#token-transfer-console.tt-expanded{top:10px;width:auto}
.tt-form-row{grid-template-columns:1fr}
}
`;

function readStoredPos(storage) {
  try {
    if (!storage || typeof storage.getItem !== "function") return null;
    const raw = storage.getItem(CHIP_STORAGE_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) return pos;
  } catch (_) {}
  return null;
}

function writeStoredPos(storage, pos) {
  try {
    if (storage && typeof storage.setItem === "function") storage.setItem(CHIP_STORAGE_KEY, JSON.stringify(pos));
  } catch (_) {}
}

function readStoredPanelPos(storage) {
  try {
    if (!storage || typeof storage.getItem !== "function") return null;
    const raw = storage.getItem(PANEL_STORAGE_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw);
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) return pos;
  } catch (_) {}
  return null;
}

function writeStoredPanelPos(storage, pos) {
  try {
    if (storage && typeof storage.setItem === "function") storage.setItem(PANEL_STORAGE_KEY, JSON.stringify(pos));
  } catch (_) {}
}

function injectStyles(doc) {
  try {
    if (!doc || doc.getElementById("token-transfer-styles")) return;
    const style = doc.createElement("style");
    style.id = "token-transfer-styles";
    style.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(style);
  } catch (_) {}
}

function makeKey() {
  let rand = "";
  try {
    const bytes = new Uint8Array(6);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(bytes);
      rand = Array.from(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    }
  } catch (_) {}
  if (!rand) rand = Math.random().toString(16).slice(2, 14);
  return "tt-" + Date.now().toString(36) + "-" + rand;
}

function safeStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch (_) {}
  return null;
}

function buildChip(doc) {
  const chip = doc.createElement("button");
  chip.id = "token-transfer-chip";
  chip.type = "button";
  chip.setAttribute("data-selected", "false");
  chip.setAttribute("aria-label", "TUMBO-SIM token transfers (simulated). Activate to open the transfer panel.");
  chip.innerHTML = [
    "<canvas id='token-transfer-cube' width='104' height='104' aria-hidden='true'></canvas>",
    "<span class='tt-chip-label'>TUMBO-SIM<br>TRANSFERS</span>",
    "<span class='tt-chip-sim'>SIMULATED</span>",
    "<span class='tt-chip-peek' id='token-transfer-peek' hidden></span>",
  ].join("");
  return chip;
}

function buildPanel(doc) {
  const panel = doc.createElement("section");
  panel.id = "token-transfer-console";
  panel.setAttribute("aria-label", "TUMBO-SIM token transfers (simulated)");
  panel.hidden = true;
  panel.innerHTML = [
    "<header class='tt-head'>",
    "<div><span class='tt-eyebrow'>TUMBO-SIM - TOKEN TRANSFERS - SIMULATED</span>",
    "<h2>Token transfers</h2>",
    "<p>Send, receive, deliver and tip simulated TUMBO-SIM points. Practice only - nothing here has value.</p></div>",
    "<div class='tt-head-actions'>",
    "<button type='button' class='tt-icon-btn' id='tt-minimize' aria-label='Minimize transfer panel'>&#8211;</button>",
    "<button type='button' class='tt-icon-btn' id='tt-close' aria-label='Close transfer panel'>&#215;</button>",
    "</div></header>",
    "<div class='tt-body'>",
    "<section class='tt-section' aria-label='Balances'><h3>Balances</h3>",
    "<div class='tt-balances' id='tt-balances'></div>",
    "<button type='button' class='tt-btn tt-btn-secondary' id='tt-faucet'>Get demo funds (simulated)</button>",
    "</section>",
    "<section class='tt-section' aria-label='New transfer'><h3>Transfer</h3>",
    "<form class='tt-form' id='tt-form'>",
    "<label>Action<select id='tt-action' name='action'>",
    "<option value='send'>Send</option>",
    "<option value='receive'>Receive</option>",
    "<option value='tip'>Tip</option>",
    "<option value='deliver'>Deliver (two-phase hold)</option>",
    "</select></label>",
    "<div class='tt-form-row'>",
    "<label>From<input id='tt-from' name='from' value='u:you' autocomplete='off' spellcheck='false'></label>",
    "<label>To<input id='tt-to' name='to' value='u:friend' autocomplete='off' spellcheck='false'></label>",
    "</div>",
    "<div class='tt-form-row'>",
    "<label>Asset<select id='tt-asset' name='asset'><option value='TUMBO'>TUMBO</option><option value='sMIMAS'>sMIMAS</option></select></label>",
    "<label>Amount (TUMBO-SIM)<input id='tt-amount' name='amount' inputmode='decimal' value='1.000' autocomplete='off'></label>",
    "</div>",
    "<label>Memo (optional)<input id='tt-memo' name='memo' maxlength='140' autocomplete='off'></label>",
    "<label>Idempotency key<input id='tt-key' name='key' autocomplete='off' spellcheck='false'></label>",
    "<div class='tt-form-actions'>",
    "<button type='submit' class='tt-btn' id='tt-submit'>Submit transfer</button>",
    "<button type='button' class='tt-btn tt-btn-secondary' id='tt-replay'>Replay same key</button>",
    "</div>",
    "</form>",
    "<div class='tt-status' id='tt-status' data-tone='info' hidden></div>",
    "</section>",
    "<section class='tt-section' aria-label='Deliver intents'><h3>Deliver intents</h3><div id='tt-intents'></div></section>",
    "<section class='tt-section' aria-label='Receipts'><h3>Receipts</h3><div id='tt-receipts'></div><div class='tt-detail' id='tt-detail' hidden></div></section>",
    "<p class='tt-boundary'>Simulation boundary: transfers move simulated TUMBO-SIM points inside this demo only. No real money, no wagering, no wallets, no custody, no chains.</p>",
    "</div>",
  ].join("");
  return panel;
}

export function mountTokenTransferConsole(options) {
  const opts = options || {};
  const doc = opts.documentRoot || (typeof document !== "undefined" ? document : null);
  if (!doc || !doc.createElement || !doc.body || !doc.getElementById) return null;
  if (doc.getElementById("token-transfer-chip")) return { alreadyMounted: true };
  injectStyles(doc);
  let facade = null;
  let engine = null;
  try {
    facade = attachTokenTransfers(typeof window !== "undefined" ? window.TumboToken : undefined, { ledgerOptions: opts.engineOptions || {} });
    engine = facade.tokenTransfers;
  } catch (_) {
    return null;
  }
  try {
    if (typeof window !== "undefined") window.__TUMBO_TOKEN_TRANSFERS__ = engine;
  } catch (_) {}
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  const chip = buildChip(doc);
  const panel = buildPanel(doc);
  doc.body.appendChild(chip);
  doc.body.appendChild(panel);
  try {
    const pos = readStoredPos(storage);
    if (pos) {
      chip.style.left = pos.left + "px";
      chip.style.top = pos.top + "px";
      chip.style.right = "auto";
      chip.style.bottom = "auto";
    }
  } catch (_) {}
  const ctx = {
    doc: doc,
    storage: storage,
    chip: chip,
    panel: panel,
    facade: facade,
    engine: engine,
    scene: null,
    expanded: false,
    byId: function (id) {
      try {
        return doc.getElementById(id);
      } catch (_) {
        return null;
      }
    },
  };
  try {
    const keyInput = ctx.byId("tt-key");
    if (keyInput) keyInput.value = makeKey();
  } catch (_) {}
  wireChipInteractions(ctx);
  try {
    ctx.scene = startChipScene(ctx.byId("token-transfer-cube"));
  } catch (_) {}
  wirePanel(ctx);
  refreshAll(ctx);
  return {
    chip: chip,
    panel: panel,
    facade: facade,
    engine: engine,
    open: function () { openPanel(ctx); },
    close: function () { closePanel(ctx); },
    dispose: function () { disposeConsole(ctx); },
  };
}

function openPanel(ctx) {
  try {
    ctx.panel.hidden = false;
    ctx.chip.setAttribute("data-selected", "true");
    refreshAll(ctx);
  } catch (_) {}
}

function closePanel(ctx) {
  try {
    ctx.panel.hidden = true;
    ctx.chip.setAttribute("data-selected", "false");
  } catch (_) {}
}

function disposeConsole(ctx) {
  try {
    if (ctx.scene && typeof ctx.scene.dispose === "function") ctx.scene.dispose();
  } catch (_) {}
  try { ctx.chip.remove(); } catch (_) {}
  try { ctx.panel.remove(); } catch (_) {}
}

function clampToViewport(left, top, width, height) {
  try {
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    return {
      left: Math.max(0, Math.min(Math.max(0, vw - width), left)),
      top: Math.max(0, Math.min(Math.max(0, vh - height), top)),
    };
  } catch (_) {
    return { left: left, top: top };
  }
}

function wireChipInteractions(ctx) {
  const chip = ctx.chip;
  const peek = ctx.byId("token-transfer-peek");
  let dragState = null;
  let lastPointerToggle = 0;
  function peekText() {
    const lines = ["TUMBO-SIM balances (simulated)"];
    try {
      const assets = ["TUMBO", "sMIMAS"];
      for (let i = 0; i < assets.length; i++) {
        lines.push(assets[i] + ": " + ctx.facade.fmt(ctx.engine.balance(DEMO_USER, assets[i])));
      }
    } catch (_) {
      lines.push("(unavailable)");
    }
    return lines.join("\n");
  }
  function showPeek() {
    try {
      if (!peek || !ctx.panel.hidden) return;
      peek.textContent = peekText();
      peek.hidden = false;
    } catch (_) {}
  }
  function hidePeek() {
    try { if (peek) peek.hidden = true; } catch (_) {}
  }
  function togglePanel() {
    if (ctx.panel.hidden) openPanel(ctx);
    else closePanel(ctx);
  }
  const storedPanelPos = readStoredPanelPos(ctx.storage);
  if (storedPanelPos) {
    ctx.panel.style.left = storedPanelPos.left + "px";
    ctx.panel.style.top = storedPanelPos.top + "px";
    ctx.panel.style.right = "auto";
    ctx.panel.style.bottom = "auto";
  }
  let panelDragState = null;
  const clampPanel = (left, top) => {
    const rect = ctx.panel.getBoundingClientRect();
    const width = rect.width || 420, height = rect.height || 500;
    const vw = Math.max(320, window.innerWidth || 0), vh = Math.max(320, window.innerHeight || 0), margin = 18;
    return { left: Math.max(margin - width + 44, Math.min(vw - margin - 44, left)), top: Math.max(margin, Math.min(vh - margin - 44, top)) };
  };
  ctx.byId("tt-transfer-drag-handle");
  const panelHead = ctx.panel.querySelector?.(".tt-head");
  if (panelHead) {
    panelHead.addEventListener("pointerdown", function (event) {
      try {
        if (event.button !== 0 || event.target?.closest?.("button, a, input, select, textarea")) return;
        const rect = ctx.panel.getBoundingClientRect();
        panelDragState = { pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, origLeft:rect.left, origTop:rect.top, moved:false };
        panelHead.setPointerCapture?.(event.pointerId);
      } catch (_) { panelDragState = null; }
    });
    panelHead.addEventListener("pointermove", function (event) {
      try {
        if (!panelDragState || event.pointerId !== panelDragState.pointerId) return;
        const dx=event.clientX-panelDragState.startX, dy=event.clientY-panelDragState.startY;
        if (!panelDragState.moved && Math.hypot(dx,dy)<5) return;
        panelDragState.moved=true;
        const next=clampPanel(panelDragState.origLeft+dx,panelDragState.origTop+dy);
        ctx.panel.style.left=next.left+"px"; ctx.panel.style.top=next.top+"px"; ctx.panel.style.right="auto"; ctx.panel.style.bottom="auto";
        event.preventDefault();
      } catch (_) {}
    });
    const endPanelDrag=function(event){
      try {
        if(!panelDragState || (event && event.pointerId!==panelDragState.pointerId)) return;
        const wasDrag=panelDragState.moved; panelDragState=null;
        panelHead.releasePointerCapture?.(event.pointerId);
        if(wasDrag){ const rect=ctx.panel.getBoundingClientRect(); writeStoredPanelPos(ctx.storage,{left:Math.round(rect.left),top:Math.round(rect.top)}); }
      } catch (_) { panelDragState=null; }
    };
    panelHead.addEventListener("pointerup", endPanelDrag);
    panelHead.addEventListener("pointercancel", endPanelDrag);
  }
  chip.addEventListener("pointerdown", function (event) {
    try {
      chip.setPointerCapture(event.pointerId);
      const rect = chip.getBoundingClientRect();
      dragState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origLeft: rect.left, origTop: rect.top, moved: false };
    } catch (_) {
      dragState = null;
    }
  });
  chip.addEventListener("pointermove", function (event) {
    try {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      if (!dragState.moved && Math.hypot(dx, dy) < 6) return;
      dragState.moved = true;
      hidePeek();
      const rect = chip.getBoundingClientRect();
      const next = clampToViewport(dragState.origLeft + dx, dragState.origTop + dy, rect.width, rect.height);
      chip.style.left = next.left + "px";
      chip.style.top = next.top + "px";
      chip.style.right = "auto";
      chip.style.bottom = "auto";
    } catch (_) {}
  });
  function endDrag(event) {
    try {
      if (!dragState || (event && event.pointerId !== dragState.pointerId)) return;
      const wasDrag = dragState.moved;
      dragState = null;
      if (wasDrag) {
        const rect = chip.getBoundingClientRect();
        writeStoredPos(ctx.storage, { left: Math.round(rect.left), top: Math.round(rect.top) });
      } else {
        lastPointerToggle = Date.now();
        togglePanel();
      }
    } catch (_) {
      dragState = null;
    }
  }
  chip.addEventListener("pointerup", endDrag);
  chip.addEventListener("pointercancel", endDrag);
  chip.addEventListener("click", function () {
    try {
      if (Date.now() - lastPointerToggle < 600) return;
      togglePanel();
    } catch (_) {}
  });
  chip.addEventListener("dblclick", function (event) {
    try {
      event.preventDefault();
      openPanel(ctx);
      ctx.expanded = !ctx.expanded;
      ctx.panel.classList.toggle("tt-expanded", ctx.expanded);
    } catch (_) {}
  });
  chip.addEventListener("mouseenter", showPeek);
  chip.addEventListener("mouseleave", hidePeek);
  chip.addEventListener("focus", showPeek);
  chip.addEventListener("blur", hidePeek);
  try {
    window.addEventListener("resize", function () {
      try {
        const rect = chip.getBoundingClientRect();
        const next = clampToViewport(rect.left, rect.top, rect.width, rect.height);
        chip.style.left = next.left + "px";
        chip.style.top = next.top + "px";
        chip.style.right = "auto";
        chip.style.bottom = "auto";
      } catch (_) {}
    });
  } catch (_) {}
  try {
    const minimize = ctx.byId("tt-minimize");
    if (minimize) minimize.addEventListener("click", function () { closePanel(ctx); });
    const close = ctx.byId("tt-close");
    if (close) close.addEventListener("click", function () { closePanel(ctx); });
  } catch (_) {}
}

function startChipScene(canvas) {
  const api = { pulse: function () {}, dispose: function () {} };
  try {
    if (!canvas || typeof canvas.getContext !== "function") return api;
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    camera.position.set(0, 0.25, 4.8);
    camera.lookAt(0, 0, 0);
    addGlassLighting(THREE, scene);

    // The transfer chip is one self-contained cube, not a little constellation.
    // Its six faces carry local-style doors + attached blocks and the whole
    // object continuously rotates on its own.
    const cubeRoot = new THREE.Group();
    cubeRoot.name = "tumbo-transfer-cube";
    scene.add(cubeRoot);
    const cube = makeGlassCube(THREE, { size: 1.5, tint: TRANSFER_CUBE_TINT });
    cubeRoot.add(cube);

    const faceColors = ["#48d7ff", "#7ff0b7", "#c59cff", "#ffd166", "#ff7188", "#72a7ff"];
    const faceDefs = [
      { axis: "x", sign: 1 }, { axis: "x", sign: -1 },
      { axis: "y", sign: 1 }, { axis: "y", sign: -1 },
      { axis: "z", sign: 1 }, { axis: "z", sign: -1 },
    ];
    faceDefs.forEach(function (def, index) {
      const face = new THREE.Group();
      face.position[def.axis] = def.sign * 0.78;
      const color = faceColors[index];
      const doorSize = def.axis === "y" ? [0.55, 0.055, 0.55] : def.axis === "x" ? [0.055, 0.7, 0.55] : [0.55, 0.7, 0.055];
      const doorGeo = new THREE.BoxGeometry(doorSize[0], doorSize[1], doorSize[2]);
      const doorMat = new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.8, transparent: true, opacity: 0.78, metalness: 0.2, roughness: 0.2 });
      const door = new THREE.Mesh(doorGeo, doorMat);
      door.position[def.axis] = def.sign * 0.035;
      face.add(door);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(doorGeo), new THREE.LineBasicMaterial({ color: "#e6fbff", transparent: true, opacity: 0.55 }));
      face.add(edge);
      const miniMat = new THREE.MeshStandardMaterial({ color: "#8deaff", emissive: "#39cfff", emissiveIntensity: 0.65, metalness: 0.35, roughness: 0.2 });
      const miniPositions = def.axis === "y"
        ? [[-0.55, def.sign * 0.09, 0.55], [0.55, def.sign * 0.09, 0.55], [0.55, def.sign * 0.09, -0.55]]
        : def.axis === "x"
          ? [[def.sign * 0.09, 0.55, 0.55], [def.sign * 0.09, 0.55, -0.55], [def.sign * 0.09, -0.55, 0.55]]
          : [[0.55, 0.55, def.sign * 0.09], [-0.55, 0.55, def.sign * 0.09], [0.55, -0.55, def.sign * 0.09]];
      miniPositions.forEach(function (pos, miniIndex) {
        const mini = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), miniMat.clone());
        mini.material.color.offsetHSL(miniIndex * 0.07, 0, miniIndex * 0.04);
        mini.position.set(pos[0], pos[1], pos[2]);
        face.add(mini);
      });
      cubeRoot.add(face);
    });

    const innerCore = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18, 1),
      new THREE.MeshStandardMaterial({ color: "#f4fdff", emissive: "#7fe8ff", emissiveIntensity: 1.5, transparent: true, opacity: 0.78, metalness: 0.1, roughness: 0.08 }),
    );
    innerCore.name = "tumbo-transfer-core";
    cubeRoot.add(innerCore);

    function resize() {
      try {
        const w = canvas.clientWidth || 104;
        const h = canvas.clientHeight || 104;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(Math.round(w), Math.round(h), false);
      } catch (_) {}
    }
    resize();
    try { window.addEventListener("resize", resize); } catch (_) {}
    let pulseUntil = 0;
    api.pulse = function () { try { pulseUntil = performance.now() + 900; } catch (_) {} };
    let raf = 0, disposed = false, clock = null;
    try { clock = new THREE.Clock(); } catch (_) { return api; }
    function frame() {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      try {
        if (document.hidden) return;
        const t = clock.getElapsedTime();
        cubeRoot.rotation.y = t * 0.5;
        cubeRoot.rotation.x = Math.sin(t * 0.24) * 0.2;
        cubeRoot.rotation.z = Math.cos(t * 0.17) * 0.1;
        innerCore.rotation.x = t * 0.75;
        innerCore.rotation.y = -t * 0.55;
        const now = performance.now();
        let scale = 1;
        if (now < pulseUntil) scale = 1 + 0.13 * Math.sin(((pulseUntil - now) / 900) * Math.PI);
        cubeRoot.scale.setScalar(scale);
        renderer.render(scene, camera);
      } catch (_) {}
    }
    frame();
    api.dispose = function () {
      try { disposed = true; cancelAnimationFrame(raf); } catch (_) {}
      try { window.removeEventListener("resize", resize); } catch (_) {}
      try { cubeRoot.traverse(function (object) { if (object.geometry) object.geometry.dispose(); if (object.material) { const mats = Array.isArray(object.material) ? object.material : [object.material]; mats.forEach(function (mat) { mat.dispose?.(); }); } }); } catch (_) {}
      try { renderer.dispose(); } catch (_) {}
    };
  } catch (_) {}
  return api;
}
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function setStatus(ctx, message, tone) {
  try {
    const el = ctx.byId("tt-status");
    if (!el) return;
    if (!message) { el.hidden = true; return; }
    el.hidden = false;
    el.setAttribute("data-tone", tone || "info");
    el.textContent = String(message);
  } catch (_) {}
}

function fmtAmount(ctx, fluff) {
  try { return ctx.facade.fmt(fluff); } catch (_) { return String(fluff) + " fluff"; }
}

function pulse(ctx) {
  try { if (ctx.scene && typeof ctx.scene.pulse === "function") ctx.scene.pulse(); } catch (_) {}
}

function refreshBalances(ctx) {
  const box = ctx.byId("tt-balances");
  if (!box) return;
  try {
    const accounts = [DEMO_USER, "sys:escrow", "sys:faucet"];
    const assets = ctx.engine.assets || [];
    const rows = [];
    for (let i = 0; i < accounts.length; i++) {
      for (let j = 0; j < assets.length; j++) {
        let bal = 0;
        try { bal = ctx.engine.balance(accounts[i], assets[j]); } catch (_) { bal = 0; }
        rows.push("<div class='tt-balance'><b>" + escapeHtml(fmtAmount(ctx, bal)) + "</b><span>" + escapeHtml(accounts[i] + " \u00b7 " + assets[j]) + "</span></div>");
      }
    }
    box.innerHTML = rows.join("");
  } catch (_) {}
}

function settleIntent(ctx, intentId, btn) {
  if (btn) btn.disabled = true;
  setStatus(ctx, "Settling " + intentId + " (simulated)\u2026", "info");
  try {
    const receipt = ctx.engine.deliverSettle({ intentId: intentId, idempotencyKey: makeKey(), actor: DEMO_USER });
    setStatus(ctx, "Settled (simulated). Receipt " + receipt.receiptId + " \u2014 " + receipt.summary, "ok");
    pulse(ctx);
  } catch (err) {
    setStatus(ctx, "Settle failed: " + (err && err.message ? err.message : String(err)), "error");
    if (btn) btn.disabled = false;
  }
  refreshAll(ctx);
}

function cancelIntent(ctx, intentId, btn) {
  if (btn) btn.disabled = true;
  setStatus(ctx, "Cancelling " + intentId + " (simulated)\u2026", "info");
  try {
    const receipt = ctx.engine.deliverCancel({ intentId: intentId, idempotencyKey: makeKey(), actor: DEMO_USER });
    setStatus(ctx, "Cancelled (simulated). Funds returned to sender. Receipt " + receipt.receiptId + ".", "ok");
    pulse(ctx);
  } catch (err) {
    setStatus(ctx, "Cancel failed: " + (err && err.message ? err.message : String(err)), "error");
    if (btn) btn.disabled = false;
  }
  refreshAll(ctx);
}

function refreshIntents(ctx) {
  const box = ctx.byId("tt-intents");
  if (!box) return;
  try {
    let intents = [];
    try { intents = ctx.engine.intents().filter(function (i) { return i && i.status === "held"; }); } catch (_) { intents = []; }
    if (!intents.length) {
      box.innerHTML = "<div class='tt-empty'>No held deliveries. A deliver hold parks funds in sys:escrow until settled or cancelled.</div>";
      return;
    }
    const rows = intents.slice().reverse().map(function (intent) {
      const id = escapeHtml(intent.intentId);
      return "<div class='tt-intent'><div class='tt-intent-title'>" + escapeHtml(fmtAmount(ctx, intent.amountFluff) + " " + intent.asset) + " \u2192 " + escapeHtml(intent.to) + "</div><div class='tt-intent-meta'>held \u00b7 from " + escapeHtml(intent.from) + " \u00b7 " + id + "</div><div class='tt-intent-actions'><button type='button' class='tt-btn' data-settle='" + id + "'>Settle</button><button type='button' class='tt-btn tt-btn-secondary' data-cancel='" + id + "'>Cancel</button></div></div>";
    });
    box.innerHTML = rows.join("");
    box.querySelectorAll("[data-settle]").forEach(function (btn) {
      btn.addEventListener("click", function () { settleIntent(ctx, btn.getAttribute("data-settle"), btn); });
    });
    box.querySelectorAll("[data-cancel]").forEach(function (btn) {
      btn.addEventListener("click", function () { cancelIntent(ctx, btn.getAttribute("data-cancel"), btn); });
    });
  } catch (_) {}
}

function refreshReceipts(ctx) {
  const box = ctx.byId("tt-receipts");
  if (!box) return;
  try {
    let receipts = [];
    try { receipts = ctx.engine.receipts(); } catch (_) { receipts = []; }
    if (!receipts.length) {
      box.innerHTML = "<div class='tt-empty'>No receipts yet. Submit a transfer to create the first one.</div>";
      return;
    }
    const latest = receipts.slice(-12).reverse();
    box.innerHTML = latest.map(function (r) {
      let badge = "unverified";
      try { badge = ctx.engine.verifyReceipt(r.receiptId).ok ? "verified" : "CHECK FAILED"; } catch (_) { badge = "unverified"; }
      const kind = r.phase ? r.action + ":" + r.phase : r.action;
      return "<button type='button' class='tt-receipt' data-receipt='" + escapeHtml(r.receiptId) + "' aria-pressed='false'><span><span class='tt-receipt-title'>" + escapeHtml(r.summary) + "</span><span class='tt-receipt-meta'>" + escapeHtml(r.receiptId + " \u00b7 " + kind + " \u00b7 " + r.asset) + "</span></span><span class='tt-receipt-verify'>" + escapeHtml(badge) + "</span></button>";
    }).join("");
    box.querySelectorAll("[data-receipt]").forEach(function (btn) {
      btn.addEventListener("click", function () { showReceiptDetail(ctx, btn.getAttribute("data-receipt"), btn); });
    });
  } catch (_) {}
}

function showReceiptDetail(ctx, receiptId, btn) {
  const detail = ctx.byId("tt-detail");
  if (!detail) return;
  try {
    if (detail.getAttribute("data-open") === receiptId && !detail.hidden) {
      detail.hidden = true;
      detail.removeAttribute("data-open");
      try { ctx.panel.querySelectorAll(".tt-receipt").forEach(function (b) { b.setAttribute("aria-pressed", "false"); }); } catch (_) {}
      return;
    }
    const receipt = ctx.engine.getReceipt(receiptId);
    const verification = ctx.engine.verifyReceipt(receiptId);
    const names = Object.keys(verification.checks);
    const checkRows = names.map(function (name) {
      const ok = !!verification.checks[name];
      return "<div class='tt-check' data-ok='" + (ok ? "true" : "false") + "'><span>" + escapeHtml(name) + "</span><b>" + (ok ? "pass" : "FAIL") + "</b></div>";
    }).join("");
    detail.innerHTML = "<div class='tt-checks'>" + checkRows + "</div><pre>" + escapeHtml(JSON.stringify(receipt, null, 2)) + "</pre><button type='button' class='tt-btn tt-btn-secondary' id='tt-reverify'>Recompute hashes</button>";
    detail.hidden = false;
    detail.setAttribute("data-open", receiptId);
    try {
      ctx.panel.querySelectorAll(".tt-receipt").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
      if (btn) btn.setAttribute("aria-pressed", "true");
    } catch (_) {}
    const reverify = detail.querySelector("#tt-reverify");
    if (reverify) {
      reverify.addEventListener("click", function () {
        detail.removeAttribute("data-open");
        showReceiptDetail(ctx, receiptId, btn);
        let ok = false;
        try { ok = ctx.engine.verifyReceipt(receiptId).ok; } catch (_) { ok = false; }
        setStatus(ctx, "Receipt hashes recomputed: " + (ok ? "all 5 checks pass" : "CHECKS FAILED"), ok ? "ok" : "error");
      });
    }
  } catch (err) {
    setStatus(ctx, "Could not open receipt: " + (err && err.message ? err.message : String(err)), "error");
  }
}

function refreshAll(ctx) {
  try { refreshBalances(ctx); } catch (_) {}
  try { refreshIntents(ctx); } catch (_) {}
  try { refreshReceipts(ctx); } catch (_) {}
}

function submitTransfer(ctx, isReplay) {
  let action = "send";
  let from = "";
  let to = "";
  let asset = "TUMBO";
  let amountText = "";
  let memo = "";
  let key = "";
  try {
    action = ctx.byId("tt-action").value;
    from = ctx.byId("tt-from").value.trim();
    to = ctx.byId("tt-to").value.trim();
    asset = ctx.byId("tt-asset").value;
    amountText = ctx.byId("tt-amount").value;
    memo = ctx.byId("tt-memo").value;
    const keyInput = ctx.byId("tt-key");
    key = keyInput.value.trim() || makeKey();
    keyInput.value = key;
  } catch (_) {
    setStatus(ctx, "Could not read the form.", "error");
    return;
  }
  let amountFluff = 0;
  try {
    amountFluff = ctx.engine.parseSimToFluff(amountText);
  } catch (err) {
    setStatus(ctx, "Amount problem: " + (err && err.message ? err.message : String(err)), "error");
    return;
  }
  setStatus(ctx, "Submitting " + action + " (simulated)\u2026", "info");
  try {
    const journalsBefore = ctx.engine.journalCount();
    const args = { from: from, to: to, asset: asset, amountFluff: amountFluff, idempotencyKey: key, memo: memo.trim() };
    let receipt = null;
    if (action === "send") receipt = ctx.engine.send(args);
    else if (action === "receive") receipt = ctx.engine.receive(args);
    else if (action === "tip") receipt = ctx.engine.tip(args);
    else if (action === "deliver") receipt = ctx.engine.deliverHold(args);
    else throw new Error("unknown action \"" + action + "\"");
    const replayed = ctx.engine.journalCount() === journalsBefore;
    if (replayed) {
      setStatus(ctx, "Replay: that idempotency key was already used \u2014 returned the original receipt " + receipt.receiptId + " (no new journal).", "info");
    } else if (action === "deliver") {
      setStatus(ctx, "Deliver hold placed in sys:escrow (simulated). Receipt " + receipt.receiptId + " \u2014 " + receipt.summary, "ok");
    } else {
      setStatus(ctx, "Done (simulated). Receipt " + receipt.receiptId + " \u2014 " + receipt.summary, "ok");
    }
    if (!replayed && !isReplay) {
      try { ctx.byId("tt-key").value = makeKey(); } catch (_) {}
    }
    if (!replayed) pulse(ctx);
  } catch (err) {
    setStatus(ctx, "Transfer failed: " + (err && err.message ? err.message : String(err)), "error");
  }
  refreshAll(ctx);
}

function wirePanel(ctx) {
  try {
    const form = ctx.byId("tt-form");
    if (form) {
      form.addEventListener("submit", function (event) {
        try { event.preventDefault(); } catch (_) {}
        submitTransfer(ctx, false);
      });
    }
    const replay = ctx.byId("tt-replay");
    if (replay) replay.addEventListener("click", function () { submitTransfer(ctx, true); });
    const faucet = ctx.byId("tt-faucet");
    if (faucet) {
      faucet.addEventListener("click", function () {
        try {
          ctx.engine.send({ from: "sys:faucet", to: DEMO_USER, asset: "TUMBO", amountFluff: 100 * FLUFF_PER_TUMBO_SIM, idempotencyKey: makeKey(), memo: "simulated demo funds" });
          ctx.engine.send({ from: "sys:faucet", to: DEMO_USER, asset: "sMIMAS", amountFluff: 50 * FLUFF_PER_TUMBO_SIM, idempotencyKey: makeKey(), memo: "simulated demo funds" });
          setStatus(ctx, "Demo funds added (simulated): " + fmtAmount(ctx, 100 * FLUFF_PER_TUMBO_SIM) + " TUMBO + " + fmtAmount(ctx, 50 * FLUFF_PER_TUMBO_SIM) + " sMIMAS.", "ok");
          pulse(ctx);
        } catch (err) {
          setStatus(ctx, "Faucet failed: " + (err && err.message ? err.message : String(err)), "error");
        }
        refreshAll(ctx);
      });
    }
    try {
      if (ctx.facade && typeof ctx.facade.on === "function") {
        ctx.facade.on("receipt", function () { refreshAll(ctx); pulse(ctx); });
        ctx.facade.on("balance-changed", function () { refreshBalances(ctx); });
      }
    } catch (_) {}
  } catch (_) {}
}

function autoMountTokenTransferConsole() {
  try {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    let params = null;
    try {
      const search = window.location && window.location.search ? window.location.search : "";
      params = new URLSearchParams(search);
    } catch (_) {
      params = null;
    }
    if (params && params.get("token-transfers-ui") === "off") return;
    mountTokenTransferConsole();
  } catch (_) {}
}

try {
  if (typeof document !== "undefined" && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMountTokenTransferConsole, { once: true });
  } else {
    autoMountTokenTransferConsole();
  }
} catch (_) {}
