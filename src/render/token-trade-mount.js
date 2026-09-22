/**
 * Minimal token-trade self-registration for Mission Control / HUD.
 * Does not edit feature-navigator.js. Mounts Buy/Sell consoles and injects
 * two openers into the feature list (or a fallback HUD) after DOM ready.
 * SIMULATED — not real money.
 */
import {
  createTokenBuyConsole,
  createTokenSellConsole,
} from "./token-trade.js?v=20260922-cache2";

const FEATURES = Object.freeze([
  Object.freeze({
    id: "token-buy",
    label: "Buy TUMBO (simulated)",
    kicker: "sMIMAS → TUMBO",
  }),
  Object.freeze({
    id: "token-sell",
    label: "Sell TUMBO (simulated)",
    kicker: "TUMBO → sMIMAS",
  }),
]);

function injectStyles(doc) {
  if (doc.getElementById("token-trade-mount-styles")) return;
  const style = doc.createElement("style");
  style.id = "token-trade-mount-styles";
  style.textContent = `
.token-trade-nav-btn {
  display: block; width: 100%; text-align: left;
  appearance: none; cursor: pointer;
  background: rgba(21,57,84,0.55); color: #e8f4ff;
  border: 1px solid rgba(127,212,255,0.35); border-radius: 10px;
  padding: 10px 12px; margin: 6px 0; font: 13px/1.35 system-ui, sans-serif;
}
.token-trade-nav-btn:hover { border-color: #7fd4ff; }
.token-trade-nav-btn .kicker { display:block; font-size:10px; letter-spacing:.06em; color:#7fd4ff; text-transform:uppercase; margin-bottom:2px; }
.token-trade-nav-btn .sim { font-size:10px; color:#9ec9e8; }
.token-trade-hud {
  position: fixed; z-index: 46; left: 12px; bottom: 16px;
  display: flex; flex-direction: column; gap: 6px; max-width: 200px;
}
@media (max-width:700px) {
  .token-trade-hud { left: 8px; bottom: 72px; }
}
`;
  doc.head.appendChild(style);
}

function openForFeature(id, buy, sell) {
  if (id === "token-buy") {
    sell?.close?.();
    buy?.open?.();
    return true;
  }
  if (id === "token-sell") {
    buy?.close?.();
    sell?.open?.();
    return true;
  }
  return false;
}

function injectIntoFeatureNav(doc, buy, sell) {
  const list = doc.getElementById("feature-nav");
  if (!list) return false;
  if (list.querySelector("[data-token-trade-nav]")) return true;
  const wrap = doc.createElement("div");
  wrap.dataset.tokenTradeNav = "1";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Simulated token trade");
  FEATURES.forEach((f) => {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "token-trade-nav-btn";
    btn.dataset.featureId = f.id;
    btn.innerHTML = `<span class="kicker">${f.kicker}</span><strong>${f.label}</strong><span class="sim">SIMULATED — not real money</span>`;
    btn.addEventListener("click", () => {
      openForFeature(f.id, buy, sell);
      try {
        const url = new URL(globalThis.location.href);
        url.searchParams.set("feature", f.id);
        globalThis.history.replaceState(null, "", url);
      } catch { /* ignore */ }
    });
    wrap.appendChild(btn);
  });
  list.appendChild(wrap);
  return true;
}

function injectHudFallback(doc, buy, sell) {
  if (doc.getElementById("token-trade-hud")) return;
  const hud = doc.createElement("div");
  hud.id = "token-trade-hud";
  hud.className = "token-trade-hud";
  FEATURES.forEach((f) => {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "token-trade-nav-btn";
    btn.textContent = f.label;
    btn.title = "SIMULATED — not real money";
    btn.addEventListener("click", () => openForFeature(f.id, buy, sell));
    hud.appendChild(btn);
  });
  doc.body.appendChild(hud);
}

function handleRoute(buy, sell) {
  try {
    const id = new URL(globalThis.location.href).searchParams.get("feature");
    openForFeature(id, buy, sell);
  } catch { /* ignore */ }
}

export function mountTokenTrade({ documentRoot = document, acct = "local-participant" } = {}) {
  if (!documentRoot?.body) return null;
  injectStyles(documentRoot);
  const buy = createTokenBuyConsole({ documentRoot, acct });
  const sell = createTokenSellConsole({ documentRoot, acct });
  globalThis.__TUMBO_TOKEN_BUY__ = buy;
  globalThis.__TUMBO_TOKEN_SELL__ = sell;
  const injected = injectIntoFeatureNav(documentRoot, buy, sell);
  if (!injected) injectHudFallback(documentRoot, buy, sell);
  handleRoute(buy, sell);
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (injectIntoFeatureNav(documentRoot, buy, sell) || tries > 40) clearInterval(timer);
  }, 250);
  return Object.freeze({ buy, sell, features: FEATURES });
}

if (typeof document !== "undefined") {
  const boot = () => {
    try {
      mountTokenTrade();
    } catch (err) {
      console.warn("[token-trade-mount] deferred boot", err?.message || err);
      setTimeout(() => {
        try { mountTokenTrade(); } catch { /* ignore */ }
      }, 800);
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}

export default mountTokenTrade;
