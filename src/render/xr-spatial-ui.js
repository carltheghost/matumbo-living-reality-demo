/**
 * XR Spatial UI — side rail for WebXR, hand gestures, pointer input, and the
 * existing air keyboard.
 *
 * This module is presentation/orchestration only. It never owns the world,
 * wallet, ledger, sensor frames, or financial settlement.
 */

import {
  DEFAULT_CRYPTO_ASSETS,
  createSimulatedExchange,
} from "../domains/simulated-exchange.js";

export const XR_SPATIAL_UI_SOURCE = "xr-spatial-ui";
export const XR_SPATIAL_GESTURE_EVENT = "matumbo:spatial-gesture";
export const XR_SIDE_TAB_EVENT = "matumbo:xr-side-tab";
export const XR_AIR_KEYBOARD_EVENT = "matumbo:xr-air-keyboard";

export const XR_SIDE_TABS = Object.freeze([
  Object.freeze({ id: "world", label: "WORLD", title: "Living Reality" }),
  Object.freeze({ id: "market", label: "MARKET", title: "Public market evidence" }),
  Object.freeze({ id: "exchange", label: "EXCHANGE", title: "Simulation exchange" }),
  Object.freeze({ id: "agents", label: "AGENTS", title: "Agent space" }),
  Object.freeze({ id: "keyboard", label: "AIR KB", title: "Air keyboard" }),
]);

function safeString(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function clampIndex(value, length) {
  if (!length) return 0;
  return ((value % length) + length) % length;
}

function emit(documentRoot, type, detail) {
  try {
    documentRoot?.dispatchEvent?.(
      new CustomEvent(type, {
        detail: Object.freeze({
          source: XR_SPATIAL_UI_SOURCE,
          localOnly: true,
          simulation: true,
          externalExecution: false,
          ...detail,
        }),
      }),
    );
  } catch {
    // DOM-less harnesses and minimal test doubles may not expose CustomEvent.
  }
}

function cssEscape(value) {
  return safeString(value).replace(/"/g, '\"');
}

export function createXrSpatialUi({
  documentRoot = globalThis.document,
  onTab = null,
  onKeyboard = null,
  exchange = null,
} = {}) {
  if (!documentRoot?.createElement) {
    return Object.freeze({
      mount: () => false,
      destroy: () => {},
      show: () => false,
      hide: () => false,
      isVisible: () => false,
      setActiveTab: () => false,
      nextTab: () => false,
      previousTab: () => false,
      toggleSide: () => false,
      getSnapshot: () =>
        Object.freeze({
          source: XR_SPATIAL_UI_SOURCE,
          mounted: false,
          visible: false,
          activeTab: "world",
          side: "left",
          simulation: true,
          localOnly: true,
        }),
    });
  }

  const exchangeApi = exchange ?? createSimulatedExchange();
  let root = null;
  let panel = null;
  let exchangeBody = null;
  let activeTab = 0;
  let side = "left";
  let mounted = false;
  let visible = false;
  let keyboardVisible = false;
  let lastGestureAt = -Infinity;

  const tabButtons = new Map();
  const listeners = [];

  function addListener(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    listeners.push(() => target?.removeEventListener?.(type, handler, options));
  }

  function currentTab() {
    return XR_SIDE_TABS[activeTab] ?? XR_SIDE_TABS[0];
  }

  function applySide() {
    if (!panel) return;
    if (side === "left") {
      panel.style.left = "12px";
      panel.style.right = "auto";
    } else {
      panel.style.right = "12px";
      panel.style.left = "auto";
    }
  }

  function renderExchange() {
    if (!exchangeBody) return;
    const search = panel?.querySelector?.("#xr-exchange-search");
    const query = safeString(search?.value).toUpperCase();

    let assets = DEFAULT_CRYPTO_ASSETS;
    if (query) {
      assets = assets.filter(
        (asset) =>
          asset.symbol.includes(query) || asset.name.toUpperCase().includes(query),
      );
    }

    const custom = exchangeApi.getCoinRegistrySnapshot?.() ?? {
      customCount: 0,
      maxCustomCoins: 128,
      remaining: 128,
    };
    const guard = exchangeApi.getGuardSnapshot?.() ?? {
      status: "armed",
      score: 0,
    };

    const rows = assets.slice(0, 16).map(
      (asset) =>
        '<button type="button" class="xr-coin-row" data-asset="' +
        cssEscape(asset.symbol) +
        '">' +
        "<strong>" +
        cssEscape(asset.symbol) +
        "</strong><span>" +
        cssEscape(asset.name) +
        "</span></button>",
    );

    exchangeBody.innerHTML =
      '<div class="xr-exchange-meta">' +
      '<span>SIM EXCHANGE</span><span>' +
      assets.length +
      " assets</span>" +
      "</div>" +
      '<div class="xr-exchange-meta">' +
      '<span>CUSTOM COINS</span><span>' +
      String(custom.customCount) +
      "/" +
      String(custom.maxCustomCoins) +
      "</span>" +
      "</div>" +
      '<div class="xr-exchange-guard">' +
      '<b>ABUSE GUARD ' +
      safeString(guard.status, "armed").toUpperCase() +
      "</b><span>risk " +
      String(guard.score ?? 0) +
      "</span></div>" +
      '<div class="xr-exchange-list">' +
      (rows.join("") ||
        '<div class="xr-empty">No matching demo assets.</div>') +
      "</div>" +
      '<div class="xr-exchange-foot">LOCAL SIMULATION · NO WALLET · NO SETTLEMENT</div>';

    exchangeBody.querySelectorAll?.(".xr-coin-row").forEach((button) => {
      addListener(button, "click", () => {
        const symbol = safeString(button.dataset?.asset).toUpperCase();
        emit(documentRoot, XR_SIDE_TAB_EVENT, {
          tabId: "exchange",
          action: "select-asset",
          asset: symbol,
        });
        onTab?.({ tabId: "exchange", action: "select-asset", asset: symbol });
      });
    });
  }

  function render() {
    if (!root) return;
    XR_SIDE_TABS.forEach((tab, index) => {
      const button = tabButtons.get(tab.id);
      if (!button) return;
      const selected = index === activeTab;
      button.setAttribute("aria-selected", String(selected));
      button.dataset.active = selected ? "true" : "false";
    });

    root.dataset.activeTab = currentTab().id;
    root.dataset.side = side;
    panel?.querySelectorAll?.(".xr-spatial-page").forEach((page) => {
      page.hidden = page.dataset.page !== currentTab().id;
    });
    if (currentTab().id === "exchange") renderExchange();
  }

  function setActiveTab(tabId, method = "api") {
    const index = XR_SIDE_TABS.findIndex((tab) => tab.id === tabId);
    if (index < 0) return false;
    activeTab = index;
    const detail = { tabId, method };
    emit(documentRoot, XR_SIDE_TAB_EVENT, detail);
    onTab?.(detail);
    render();
    return true;
  }

  function step(delta, method) {
    activeTab = clampIndex(activeTab + delta, XR_SIDE_TABS.length);
    return setActiveTab(currentTab().id, method);
  }

  function toggleKeyboard(method = "button") {
    keyboardVisible = !keyboardVisible;
    const detail = { visible: keyboardVisible, method };
    emit(documentRoot, XR_AIR_KEYBOARD_EVENT, detail);
    onKeyboard?.(detail);
    render();
    return keyboardVisible;
  }

  function toggleSide(method = "button") {
    side = side === "left" ? "right" : "left";
    applySide();
    emit(documentRoot, XR_SIDE_TAB_EVENT, {
      tabId: currentTab().id,
      action: "move-rail",
      side,
      method,
    });
    return side;
  }

  function hitTestNormalized(x, y) {
    const view = documentRoot.defaultView ?? globalThis;
    const width = Number(view?.innerWidth);
    const height = Number(view?.innerHeight);
    if (!(width > 0 && height > 0)) return null;
    const px = Math.max(0, Math.min(0.999999, Number(x))) * width;
    const py = Math.max(0, Math.min(0.999999, Number(y))) * height;
    try {
      return documentRoot.elementFromPoint?.(px, py) ?? null;
    } catch {
      return null;
    }
  }

  function handleSpatialGesture(event) {
    if (!visible || !event || typeof event.type !== "string") return false;
    const now = Number(event.timestamp ?? Date.now());
    if (Number.isFinite(now) && now - lastGestureAt < 120) return false;

    if (event.type === "swipe") {
      lastGestureAt = now;
      if (event.direction === "left") return step(1, "hand-swipe-left");
      if (event.direction === "right") return step(-1, "hand-swipe-right");
      return false;
    }

    if (event.type === "tap") {
      lastGestureAt = now;
      const target = hitTestNormalized(event.x, event.y);
      const button =
        target?.closest?.("button[data-tab],button[data-xr-action]") ?? null;
      if (!button) return false;
      button.click?.();
      return true;
    }

    if (event.type === "pinchend" && event.action === "keyboard") {
      return toggleKeyboard("hand-pinch");
    }

    return false;
  }

  function mount() {
    if (mounted) return true;

    root = documentRoot.createElement("div");
    root.id = "xr-spatial-ui";
    root.setAttribute("aria-label", "maTumbo XR spatial controls");
    root.style.cssText =
      "position:fixed;top:50%;transform:translateY(-50%);z-index:10020;pointer-events:none;font:12px system-ui,sans-serif;color:#e8f6ff;display:block;";

    panel = documentRoot.createElement("section");
    panel.style.cssText =
      "pointer-events:auto;width:178px;max-height:min(78vh,620px);overflow:hidden;background:rgba(6,14,22,.86);backdrop-filter:blur(12px);border:1px solid rgba(134,206,239,.55);border-radius:14px;padding:8px;box-shadow:0 12px 34px rgba(0,0,0,.32);";

    const header = documentRoot.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:7px;";

    const title = documentRoot.createElement("strong");
    title.textContent = "maTumbo · XR";
    title.style.cssText = "font-size:11px;letter-spacing:.08em;";
    header.append(title);

    const move = documentRoot.createElement("button");
    move.type = "button";
    move.dataset.xrAction = "move";
    move.textContent = "MOVE";
    move.title = "Move the rail to the opposite side";
    move.style.cssText =
      "border:1px solid rgba(134,206,239,.35);border-radius:7px;background:rgba(255,255,255,.06);color:inherit;padding:3px 6px;font-size:9px;";
    addListener(move, "click", () => toggleSide("button"));
    header.append(move);

    panel.append(header);

    const tabs = documentRoot.createElement("div");
    tabs.style.cssText =
      "display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:7px;";
    for (const tab of XR_SIDE_TABS) {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.dataset.tab = tab.id;
      button.textContent = tab.label;
      button.title = tab.title;
      button.setAttribute("aria-selected", String(tab.id === currentTab().id));
      button.style.cssText =
        "border:1px solid rgba(134,206,239,.25);border-radius:7px;background:rgba(255,255,255,.035);color:inherit;padding:6px 4px;font-size:9px;letter-spacing:.04em;";
      addListener(button, "click", () => {
        if (tab.id === "keyboard") {
          toggleKeyboard("tab");
          return;
        }
        setActiveTab(tab.id, "tab");
      });
      tabButtons.set(tab.id, button);
      tabs.append(button);
    }
    panel.append(tabs);

    for (const tab of XR_SIDE_TABS.filter((entry) => entry.id !== "keyboard")) {
      const page = documentRoot.createElement("div");
      page.className = "xr-spatial-page";
      page.dataset.page = tab.id;
      page.style.cssText =
        "max-height:min(58vh,440px);overflow:auto;padding:2px 1px;";
      const heading = documentRoot.createElement("div");
      heading.textContent = tab.title;
      heading.style.cssText = "font-size:10px;opacity:.8;margin-bottom:7px;";
      page.append(heading);

      if (tab.id === "exchange") {
        const search = documentRoot.createElement("input");
        search.id = "xr-exchange-search";
        search.type = "text";
        search.placeholder = "Type BTC, XRP, SOL…";
        search.autocomplete = "off";
        search.style.cssText =
          "width:100%;box-sizing:border-box;border-radius:8px;border:1px solid rgba(134,206,239,.3);background:rgba(0,0,0,.2);color:inherit;padding:7px 8px;margin-bottom:7px;";
        addListener(search, "input", renderExchange);
        page.append(search);

        exchangeBody = documentRoot.createElement("div");
        page.append(exchangeBody);
      } else {
        const copy = documentRoot.createElement("div");
        copy.textContent =
          tab.id === "world"
            ? "Same canonical world. Point, pinch, select, and swipe."
            : tab.id === "market"
              ? "Public observations stay read-only and explicitly sourced."
              : "Local agent surfaces remain advisory and non-authoritative.";
        copy.style.cssText =
          "font-size:10px;line-height:1.45;opacity:.85;padding:4px 2px;";
        page.append(copy);
      }

      panel.append(page);
    }

    const keyboardButton = documentRoot.createElement("button");
    keyboardButton.type = "button";
    keyboardButton.dataset.xrAction = "keyboard";
    keyboardButton.textContent = "SHOW / HIDE AIR KEYBOARD";
    keyboardButton.style.cssText =
      "width:100%;border:1px solid rgba(134,206,239,.35);border-radius:8px;background:rgba(255,255,255,.05);color:inherit;padding:7px;margin-top:7px;font-size:9px;";
    addListener(keyboardButton, "click", () => toggleKeyboard("button"));
    panel.append(keyboardButton);

    root.append(panel);
    documentRoot.body?.append(root);
    mounted = true;
    visible = true;
    applySide();
    render();

    const gestureHandler = (event) => handleSpatialGesture(event.detail);
    addListener(documentRoot, XR_SPATIAL_GESTURE_EVENT, gestureHandler);

    return true;
  }

  function show() {
    if (!mounted) mount();
    visible = true;
    if (root) root.hidden = false;
    return true;
  }

  function hide() {
    visible = false;
    if (root) root.hidden = true;
    return true;
  }

  function destroy() {
    listeners.splice(0).forEach((cleanup) => cleanup());
    root?.remove?.();
    root = null;
    panel = null;
    exchangeBody = null;
    tabButtons.clear();
    mounted = false;
    visible = false;
  }

  return Object.freeze({
    mount,
    destroy,
    show,
    hide,
    isVisible: () => visible,
    setActiveTab,
    nextTab: () => step(1, "api-next"),
    previousTab: () => step(-1, "api-previous"),
    toggleSide,
    toggleKeyboard,
    handleSpatialGesture,
    getSnapshot: () =>
      Object.freeze({
        source: XR_SPATIAL_UI_SOURCE,
        mounted,
        visible,
        activeTab: currentTab().id,
        side,
        keyboardVisible,
        tabCount: XR_SIDE_TABS.length,
        cryptoAssetCount: DEFAULT_CRYPTO_ASSETS.length,
        simulation: true,
        localOnly: true,
        externalExecution: false,
      }),
  });
}

export default createXrSpatialUi;
