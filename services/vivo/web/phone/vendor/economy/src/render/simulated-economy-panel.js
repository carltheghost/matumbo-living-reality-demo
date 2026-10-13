/*
 * Contextual UI for the local simulated economy.
 *
 * This is intentionally a mountable panel, not a page or a second world.
 * The Vivo field owns the trigger and placement; the panel owns only its
 * controls, labels, and calls into SimulatedEconomy. Every surface says
 * TUMBO-SIM / local demo and does not imply a wallet, external venue, live
 * odds feed, or real settlement.
 */

import {
  CONTRACT_EVIDENCE_KIND,
  PREDICTION_PROVENANCE_KIND,
  createSimulatedEconomy,
} from "../domains/simulated-economy.js";
import { formatSimAmount } from "../domains/token.js";

export const SIMULATED_ECONOMY_PANEL_SOURCE = "simulated-economy-panel";
export const SIMULATED_ECONOMY_PANEL_OBJECT_ID = "vivo:economy-field-object";

const CSS_ID = "simulated-economy-panel-style";
let panelMountSequence = 0;

function createPanelOperationNamespace() {
  panelMountSequence += 1;
  let entropy = "";
  try { entropy = globalThis.crypto?.randomUUID?.() ?? ""; } catch { /* optional browser API */ }
  if (!entropy) entropy = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${panelMountSequence}-${entropy}`;
}

function byId(root, id) {
  return root?.getElementById?.(id) ?? null;
}

function text(root, tag, value, className = "") {
  const element = root.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}

function button(root, label, action, className = "") {
  const element = text(root, "button", label, className);
  element.type = "button";
  element.dataset.action = action;
  return element;
}

function field(root, label, input, id) {
  const wrapper = root.createElement("label");
  wrapper.className = "sim-economy-field";
  wrapper.htmlFor = id;
  wrapper.append(text(root, "span", label));
  input.id = id;
  wrapper.append(input);
  return wrapper;
}

function input(root, type = "text", value = "") {
  const element = root.createElement("input");
  element.type = type;
  element.value = value;
  element.autocomplete = "off";
  return element;
}

function select(root, options, value) {
  const element = root.createElement("select");
  for (const option of options) {
    const node = root.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    element.append(node);
  }
  if (value !== undefined) element.value = value;
  return element;
}

function assetAmount(amount, asset) {
  return `${formatSimAmount(amount)} ${asset === "TUMBO" ? "TUMBO-SIM" : asset}`;
}

const DURABLE_STORAGE_STATES = new Set([
  "persisted-local-snapshot",
  "restored-local-snapshot",
  "restored-canonical-snapshot",
  "restored-token-snapshot",
]);

function persistenceSummary(model) {
  const state = String(model?.storageStatus || "unknown");
  if (DURABLE_STORAGE_STATES.has(state)) return `durable local snapshot · ${state}`;
  if (state === "storage-unavailable") return "not saved · storage unavailable; reload may discard this state";
  if (state === "in-memory") return "not saved · in-memory state only";
  if (state.includes("invalid")) return `not saved · ${state}`;
  return `persistence status · ${state}`;
}

function housePoolOwnActiveFluff(model) {
  if (typeof model?.housePools !== "function") return null;
  try {
    return model.housePools({ owner: "you" })
      .flatMap((pool) => pool.contributions)
      .filter((contribution) => ["reserved", "committed"].includes(contribution.status))
      .reduce((total, contribution) => total + contribution.amountFluff, 0);
  } catch {
    return null;
  }
}

function exactShare(entry) {
  const numerator = Number(entry?.ownershipNumerator);
  const denominator = Number(entry?.ownershipDenominator);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) return "—";
  const percent = ((numerator / denominator) * 100).toFixed(3);
  return `${numerator.toLocaleString("en-US")}/${denominator.toLocaleString("en-US")} units · ${percent}%`;
}

function addStyles(documentRoot) {
  if (!documentRoot?.head || byId(documentRoot, CSS_ID)) return;
  const style = documentRoot.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.sim-economy-panel{position:fixed;inset:auto 16px 16px auto;z-index:80;width:min(560px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 32px));display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid rgba(118,222,255,.42);border-radius:18px;background:linear-gradient(160deg,rgba(7,29,43,.98),rgba(4,12,20,.98));color:#e9fbff;box-shadow:0 20px 70px rgba(0,0,0,.58),inset 0 0 38px rgba(40,176,216,.08);backdrop-filter:blur(18px);overflow:auto;font:12px/1.4 system-ui,sans-serif}
.sim-economy-panel[hidden]{display:none}
.sim-economy-head{display:flex;align-items:flex-start;gap:10px;border-bottom:1px solid rgba(137,222,247,.16);padding-bottom:10px}
.sim-economy-head h2{margin:0;color:#e9fbff;font-size:18px;line-height:1.15}
.sim-economy-kicker{margin:0 0 3px;color:#83d9f0;font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
.sim-economy-boundary{margin:4px 0 0;color:#9ebbc6;font-size:10px;line-height:1.4}
.sim-economy-close{margin-left:auto;min-width:42px!important;min-height:42px!important;padding:6px!important;border:1px solid rgba(153,225,244,.3)!important;background:rgba(59,137,172,.13)!important;color:#d8f8ff!important;font-size:20px!important;line-height:1!important}
.sim-economy-balance{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.sim-economy-balance-card{padding:8px;border:1px solid rgba(137,222,247,.16);border-radius:10px;background:rgba(33,110,145,.12)}
.sim-economy-balance-card strong{display:block;color:#e9fbff;font-size:14px;font-variant-numeric:tabular-nums}
.sim-economy-balance-card span{display:block;margin-top:2px;color:#83afbd;font-size:8px;letter-spacing:.12em;text-transform:uppercase}
.sim-economy-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.sim-economy-tabs button[aria-selected=true]{border-color:#75e0f6;background:rgba(52,153,182,.3);color:#fff}
.sim-economy-tab[hidden]{display:none}
.sim-economy-form{display:grid;gap:7px;padding:10px;border:1px solid rgba(137,222,247,.14);border-radius:12px;background:rgba(7,36,51,.58)}
.sim-economy-form h3{margin:0;color:#dcf9ff;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.sim-economy-field{display:grid;gap:3px;color:#9fc8d3;font-size:9px;letter-spacing:.06em;text-transform:uppercase}
.sim-economy-field input,.sim-economy-field select{width:100%;min-height:40px;box-sizing:border-box;border:1px solid rgba(137,222,247,.24);border-radius:8px;background:rgba(3,15,23,.82);color:#e9fbff;padding:8px;font:inherit;font-size:12px;letter-spacing:0;text-transform:none}
.sim-economy-actions{display:flex;flex-wrap:wrap;gap:7px}
.sim-economy-panel button{min-height:44px;border:1px solid rgba(137,222,247,.28);border-radius:9px;background:rgba(42,137,167,.16);color:#d8f7ff;padding:8px 11px;cursor:pointer;font:inherit;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;touch-action:manipulation}
.sim-economy-panel button:hover,.sim-economy-panel button:focus-visible{border-color:#8feafa;background:rgba(52,153,182,.34);outline:2px solid rgba(143,234,250,.2);outline-offset:1px}
.sim-economy-panel button:disabled{opacity:.45;cursor:not-allowed}
.sim-economy-primary{border-color:rgba(113,228,183,.48)!important;background:rgba(39,137,114,.2)!important;color:#ddfff2!important}
.sim-economy-danger{border-color:rgba(255,148,164,.4)!important;background:rgba(148,59,76,.14)!important;color:#ffd8dd!important}
.sim-economy-records{display:grid;gap:7px;max-height:280px;overflow:auto}
.sim-economy-record{display:grid;gap:5px;padding:9px;border:1px solid rgba(137,222,247,.14);border-radius:10px;background:rgba(3,20,30,.72)}
.sim-economy-record strong{color:#e9fbff;font-size:11px}
.sim-economy-meta{color:#8db6c1;font-size:9px;line-height:1.35}
.sim-economy-house-pool-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.sim-economy-house-pool-card{display:grid;gap:4px;padding:8px;border:1px solid rgba(137,222,247,.14);border-radius:10px;background:rgba(3,20,30,.72)}
.sim-economy-house-pool-card strong{color:#e9fbff;font-size:11px}
.sim-economy-house-pool-card span{color:#9ebbc6;font-size:9px;line-height:1.35}
.sim-economy-house-pool-ratio{color:#b8f3df!important;font-variant-numeric:tabular-nums}
.sim-economy-house-pool-storage{padding:8px;border:1px solid rgba(137,222,247,.18);border-radius:9px;color:#b8d9e2;font-size:9px;line-height:1.4;background:rgba(7,36,51,.42)}
.sim-economy-house-pool-storage[data-durable=true]{border-color:rgba(113,228,183,.32);color:#b8f3df;background:rgba(39,137,114,.1)}
.sim-economy-house-pool-unavailable{padding:8px;border:1px dashed rgba(255,210,122,.34);border-radius:9px;color:#f0d9a2;font-size:9px;line-height:1.4;background:rgba(121,75,40,.09)}
.sim-economy-house-pool-contribution{display:grid;gap:4px;padding:8px;border:1px solid rgba(137,222,247,.12);border-radius:9px;background:rgba(3,15,23,.72)}
.sim-economy-house-pool-contribution strong{color:#e9fbff;font-size:10px}
.sim-economy-house-pool-contribution span{color:#9ebbc6;font-size:9px;line-height:1.35}
.sim-economy-empty{padding:10px;border:1px dashed rgba(137,222,247,.22);border-radius:9px;color:#8db6c1;font-size:10px}
.sim-economy-status{min-height:18px;color:#9de6c8;font-size:10px}
.sim-economy-status[data-tone=error]{color:#ffb7c0}
.sim-economy-note{margin:0;color:#91b1bc;font-size:9px;line-height:1.45}
@media(max-width:700px){.sim-economy-panel{inset:auto 8px 8px;width:auto;max-height:calc(100vh - 16px);padding:11px;border-radius:14px}.sim-economy-head h2{font-size:16px}.sim-economy-balance{grid-template-columns:repeat(2,minmax(0,1fr))}.sim-economy-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.sim-economy-house-pool-grid{grid-template-columns:1fr}.sim-economy-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.sim-economy-actions button{width:100%}}
`;
  documentRoot.head.append(style);
}

function section(root, title, content) {
  const node = root.createElement("section");
  node.className = "sim-economy-form";
  node.append(text(root, "h3", title));
  node.append(content);
  return node;
}

function actions(root, children) {
  const node = root.createElement("div");
  node.className = "sim-economy-actions";
  node.append(...children);
  return node;
}

function record(root, heading, meta, children = []) {
  const node = root.createElement("article");
  node.className = "sim-economy-record";
  node.append(text(root, "strong", heading));
  if (meta) node.append(text(root, "div", meta, "sim-economy-meta"));
  if (children.length) node.append(actions(root, children));
  return node;
}

/**
 * Mount the economic controls into an existing world context.
 *
 * The design layer supplies `trigger` (usually an existing Vivo field/world
 * object control) and may supply `onWorldFocus({objectId, kind})` to move the
 * field Eye toward the economic object. `panelHost` is optional; when absent,
 * the factory appends one local fixed panel to the document body. The module
 * never replaces the world canvas or the phone authority.
 */
export function mountSimulatedEconomyPanel({
  documentRoot = globalThis.document,
  economy = null,
  trigger = null,
  panelHost = null,
  onWorldFocus = null,
  autoOpen = false,
  seedLiquidity = true,
} = {}) {
  if (!documentRoot?.createElement) throw new TypeError("a document is required to mount the economy panel");
  addStyles(documentRoot);
  const model = economy ?? createSimulatedEconomy({ seedLiquidity });
  const panel = documentRoot.createElement("aside");
  panel.className = "sim-economy-panel";
  panel.id = "simulated-economy-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "TUMBO-SIM local economy");
  if (panelHost?.append) panelHost.append(panel);
  else documentRoot.body?.append?.(panel);

  const heading = documentRoot.createElement("div");
  heading.className = "sim-economy-head";
  const headingText = documentRoot.createElement("div");
  headingText.append(text(documentRoot, "p", "FIELD OBJECT · LOCAL REHEARSAL", "sim-economy-kicker"));
  headingText.append(text(documentRoot, "h2", "TUMBO-SIM economy"));
  headingText.append(text(documentRoot, "p", "Orders, demo positions, and contracts share the local receipt ledger. No live market, wallet, external order, or real-money settlement exists.", "sim-economy-boundary"));
  heading.append(headingText);
  const close = button(documentRoot, "×", "close", "sim-economy-close");
  close.setAttribute("aria-label", "Close TUMBO-SIM economy");
  heading.append(close);
  panel.append(heading);

  const balance = documentRoot.createElement("div");
  balance.className = "sim-economy-balance";
  panel.append(balance);

  const tabs = documentRoot.createElement("div");
  tabs.className = "sim-economy-tabs";
  const tabButtons = [
    ["exchange", "Exchange"],
    ["prediction", "Prediction"],
    ["contracts", "Contracts"],
    ["house-pool", "House pool"],
  ].map(([id, label], index) => {
    const tab = button(documentRoot, label, `tab:${id}`);
    tab.dataset.tab = id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", index === 0 ? "true" : "false");
    tab.setAttribute("aria-controls", `sim-economy-tab-${id}`);
    tabs.append(tab);
    return tab;
  });
  panel.append(tabs);

  const status = text(documentRoot, "div", "Ready · local simulated state", "sim-economy-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  panel.append(status);
  const tabsRoot = documentRoot.createElement("div");
  panel.append(tabsRoot);

  const exchangeTab = documentRoot.createElement("div");
  exchangeTab.id = "sim-economy-tab-exchange";
  exchangeTab.className = "sim-economy-tab";
  exchangeTab.setAttribute("role", "tabpanel");
  const exchangeSide = select(documentRoot, [{ value: "buy", label: "Buy TUMBO-SIM" }, { value: "sell", label: "Sell TUMBO-SIM" }], "buy");
  const exchangeAmount = input(documentRoot, "number", "1000");
  exchangeAmount.min = "1";
  exchangeAmount.step = "1";
  const exchangeNum = input(documentRoot, "number", "1");
  exchangeNum.min = "1";
  exchangeNum.step = "1";
  const exchangeDen = input(documentRoot, "number", "1");
  exchangeDen.min = "1";
  exchangeDen.step = "1";
  const placeOrder = button(documentRoot, "Place demo order", "exchange:place", "sim-economy-primary");
  const seed = button(documentRoot, "Seed demo liquidity", "exchange:seed");
  const quoteAmount = input(documentRoot, "number", "1000");
  quoteAmount.min = "1";
  quoteAmount.step = "1";
  const quoteButton = button(documentRoot, "Use shared quote", "exchange:quote");
  const exchangeForm = documentRoot.createElement("div");
  exchangeForm.append(
    field(documentRoot, "Order side", exchangeSide, "sim-economy-order-side"),
    field(documentRoot, "Base amount · integer fluff", exchangeAmount, "sim-economy-order-amount"),
    field(documentRoot, "Price numerator · sMIMAS fluff", exchangeNum, "sim-economy-order-num"),
    field(documentRoot, "Price denominator · TUMBO fluff", exchangeDen, "sim-economy-order-den"),
    actions(documentRoot, [placeOrder, seed]),
    text(documentRoot, "p", "Orders may partially fill. Cancelled reserves return through a canonical receipt; the visible book is local demo liquidity only.", "sim-economy-note"),
  );
  exchangeTab.append(section(documentRoot, "Exchange orders", exchangeForm));
  const quoteForm = documentRoot.createElement("div");
  quoteForm.append(field(documentRoot, "Canonical TUMBO → sMIMAS quote · fluff", quoteAmount, "sim-economy-quote-amount"), actions(documentRoot, [quoteButton]), text(documentRoot, "p", "This uses the existing local QuoteEngine at its configured simulated rate; it is not an external exchange.", "sim-economy-note"));
  exchangeTab.append(section(documentRoot, "Shared token quote", quoteForm));
  const orderList = documentRoot.createElement("div");
  orderList.className = "sim-economy-records";
  exchangeTab.append(orderList);

  const predictionTab = documentRoot.createElement("div");
  predictionTab.id = "sim-economy-tab-prediction";
  predictionTab.className = "sim-economy-tab";
  predictionTab.hidden = true;
  predictionTab.setAttribute("role", "tabpanel");
  const predictionTitle = input(documentRoot, "text", "Will the demo marker glow?");
  const predictionOutcomes = input(documentRoot, "text", "YES, NO");
  const predictionPrice = input(documentRoot, "number", "100");
  predictionPrice.min = "1";
  predictionPrice.step = "1";
  const predictionCreate = button(documentRoot, "Open demo market", "prediction:create", "sim-economy-primary");
  const predictionForm = documentRoot.createElement("div");
  predictionForm.append(field(documentRoot, "Question", predictionTitle, "sim-economy-prediction-title"), field(documentRoot, "Outcomes · comma separated", predictionOutcomes, "sim-economy-prediction-outcomes"), field(documentRoot, "Cost per share · fluff", predictionPrice, "sim-economy-prediction-price"), actions(documentRoot, [predictionCreate]), text(documentRoot, "p", "Settlement is manual demo input only. A source note is recorded; live odds and live feeds are rejected.", "sim-economy-note"));
  predictionTab.append(section(documentRoot, "Prediction market", predictionForm));
  const marketList = documentRoot.createElement("div");
  marketList.className = "sim-economy-records";
  predictionTab.append(marketList);

  const contractsTab = documentRoot.createElement("div");
  contractsTab.id = "sim-economy-tab-contracts";
  contractsTab.className = "sim-economy-tab";
  contractsTab.hidden = true;
  contractsTab.setAttribute("role", "tabpanel");
  const contractTitle = input(documentRoot, "text", "Build a local field marker");
  const contractAmount = input(documentRoot, "number", "1000");
  contractAmount.min = "0";
  contractAmount.step = "1";
  const contractCreate = button(documentRoot, "Draft contract", "contract:create", "sim-economy-primary");
  const contractForm = documentRoot.createElement("div");
  contractForm.append(field(documentRoot, "Contract title", contractTitle, "sim-economy-contract-title"), field(documentRoot, "Escrow amount · fluff", contractAmount, "sim-economy-contract-amount"), actions(documentRoot, [contractCreate]), text(documentRoot, "p", "Lifecycle is draft → active → funded → completed or cancelled. Evidence is an explicit local demo note, not an oracle or deployed contract.", "sim-economy-note"));
  contractsTab.append(section(documentRoot, "Contract atelier", contractForm));
  const contractList = documentRoot.createElement("div");
  contractList.className = "sim-economy-records";
  contractsTab.append(contractList);

  const housePoolTab = documentRoot.createElement("div");
  housePoolTab.id = "sim-economy-tab-house-pool";
  housePoolTab.className = "sim-economy-tab";
  housePoolTab.hidden = true;
  housePoolTab.setAttribute("role", "tabpanel");

  const housePoolName = input(documentRoot, "text", "Local house pool");
  const housePoolCapacity = input(documentRoot, "number", "10000");
  housePoolCapacity.min = "1";
  housePoolCapacity.step = "1";
  const housePoolCreate = button(documentRoot, "Create house pool", "house-pool:create", "sim-economy-primary");
  const housePoolCreateForm = documentRoot.createElement("div");
  housePoolCreateForm.append(
    field(documentRoot, "Pool name", housePoolName, "sim-economy-house-pool-name"),
    field(documentRoot, "Capacity · integer fluff", housePoolCapacity, "sim-economy-house-pool-capacity"),
    actions(documentRoot, [housePoolCreate]),
    text(documentRoot, "p", "Capacity is explicit TUMBO-SIM integer fluff. Atelier rehearsal credits never enter this pool.", "sim-economy-note"),
  );
  housePoolTab.append(section(documentRoot, "Create a local house pool", housePoolCreateForm));

  const housePoolStorage = text(documentRoot, "div", "Receipt persistence status · checking…", "sim-economy-house-pool-storage");
  housePoolStorage.setAttribute("role", "status");
  housePoolStorage.setAttribute("aria-live", "polite");
  housePoolTab.append(housePoolStorage);

  const housePoolUnavailable = text(documentRoot, "p", "Outcome commitment locking and settlement are unavailable in this mounted panel. Reserved contributions can be released; imported committed contributions remain locked until a supported lifecycle exists.", "sim-economy-house-pool-unavailable");
  housePoolTab.append(housePoolUnavailable);

  const housePoolSelect = select(documentRoot, [{ value: "", label: "Select a house pool" }], "");
  const housePoolAmount = input(documentRoot, "number", "1000");
  housePoolAmount.min = "1";
  housePoolAmount.step = "1";
  const housePoolReserve = button(documentRoot, "Reserve my TUMBO-SIM", "house-pool:reserve", "sim-economy-primary");
  const housePoolReserveForm = documentRoot.createElement("div");
  housePoolReserveForm.append(
    field(documentRoot, "House pool", housePoolSelect, "sim-economy-house-pool-select"),
    field(documentRoot, "My contribution · integer fluff", housePoolAmount, "sim-economy-house-pool-amount"),
    actions(documentRoot, [housePoolReserve]),
    text(documentRoot, "p", "The reserve moves your available TUMBO-SIM into the canonical local escrow account and returns an auditable receipt.", "sim-economy-note"),
  );
  housePoolTab.append(section(documentRoot, "Reserve your own available balance", housePoolReserveForm));

  const housePoolList = documentRoot.createElement("div");
  housePoolList.className = "sim-economy-records";
  housePoolTab.append(housePoolList);

  tabsRoot.append(exchangeTab, predictionTab, contractsTab, housePoolTab);

  const operationNamespace = createPanelOperationNamespace();
  let keySequence = 0;
  const pendingIntents = new Map();
  const operationIntent = (scope, fingerprint) => {
    const identity = `${scope}:${JSON.stringify(fingerprint)}`;
    const existing = pendingIntents.get(identity);
    if (existing) return existing;
    const entry = Object.freeze({
      identity,
      key: `${SIMULATED_ECONOMY_PANEL_SOURCE}:${operationNamespace}:${scope}:${++keySequence}`,
    });
    pendingIntents.set(identity, entry);
    return entry;
  };
  const show = () => { panel.hidden = false; refresh(); onWorldFocus?.({ objectId: SIMULATED_ECONOMY_PANEL_OBJECT_ID, kind: "simulated-economy" }); };
  const hide = () => { panel.hidden = true; };
  const setStatus = (message, tone = "ok") => { status.textContent = message; status.dataset.tone = tone; };
  const showError = (error) => setStatus(error?.message || String(error), "error");
  const committedStatus = () => {
    const state = String(model?.storageStatus || "unknown");
    if (state === "storage-unavailable") return "Committed to the local simulated receipt ledger in memory; local save unavailable, so reload may discard it.";
    if (state === "in-memory") return "Committed to the local simulated receipt ledger in memory; no durable local snapshot is configured.";
    return "Committed to the local simulated receipt ledger and local snapshot.";
  };

  function refreshBalance() {
    const snapshot = model.balances("you");
    const reservedFluff = housePoolOwnActiveFluff(model);
    balance.replaceChildren(
      (() => { const node = documentRoot.createElement("div"); node.className = "sim-economy-balance-card"; node.append(text(documentRoot, "strong", assetAmount(snapshot.available.TUMBO, "TUMBO")), text(documentRoot, "span", "available TUMBO-SIM")); return node; })(),
      (() => { const node = documentRoot.createElement("div"); node.className = "sim-economy-balance-card"; node.append(text(documentRoot, "strong", assetAmount(snapshot.available.sMIMAS, "sMIMAS")), text(documentRoot, "span", "available sMIMAS")); return node; })(),
      (() => { const node = documentRoot.createElement("div"); node.className = "sim-economy-balance-card"; node.append(text(documentRoot, "strong", reservedFluff === null ? "—" : assetAmount(reservedFluff, "TUMBO")), text(documentRoot, "span", "reserved in house pools")); return node; })(),
    );
  }

  function refreshOrders() {
    orderList.replaceChildren();
    const orders = model.exchangeOrders();
    if (!orders.length) { orderList.append(text(documentRoot, "div", "No local orders yet.", "sim-economy-empty")); return; }
    for (const order of orders) {
      const meta = `${order.side.toUpperCase()} · ${order.status.toUpperCase()} · ${order.remainingBase.toLocaleString()} base fluff remaining · price ${order.priceNum}/${order.priceDen}`;
      const children = [];
      if (["open", "partial"].includes(order.status) && order.owner === "u:you") {
        const cancel = button(documentRoot, "Cancel reserve", `exchange:cancel:${order.id}`, "sim-economy-danger");
        children.push(cancel);
      }
      const node = record(documentRoot, order.id, meta, children);
      node.dataset.objectId = SIMULATED_ECONOMY_PANEL_OBJECT_ID;
      node.addEventListener("click", () => onWorldFocus?.({ objectId: SIMULATED_ECONOMY_PANEL_OBJECT_ID, kind: "exchange-order", orderId: order.id }));
      orderList.append(node);
    }
  }

  function refreshMarkets() {
    marketList.replaceChildren();
    const markets = model.predictionMarkets();
    if (!markets.length) { marketList.append(text(documentRoot, "div", "No local prediction markets yet.", "sim-economy-empty")); return; }
    for (const market of markets) {
      const controls = [];
      if (market.status === "open") {
        const outcomeSelect = select(documentRoot, market.outcomes.map((value) => ({ value, label: value })), market.outcomes[0]);
        const units = input(documentRoot, "number", "1"); units.min = "1"; units.step = "1";
        const buy = button(documentRoot, "Buy position", `prediction:buy:${market.id}`, "sim-economy-primary");
        const settleOutcome = select(documentRoot, market.outcomes.map((value) => ({ value, label: value })), market.outcomes[0]);
        const source = input(documentRoot, "text", "user-entered-demo-outcome");
        const settle = button(documentRoot, "Settle explicit demo", `prediction:settle:${market.id}`, "sim-economy-danger");
        const form = documentRoot.createElement("div");
        form.append(field(documentRoot, "Position outcome", outcomeSelect, `sim-economy-market-${market.id}-outcome`), field(documentRoot, "Units", units, `sim-economy-market-${market.id}-units`), actions(documentRoot, [buy]), field(documentRoot, "Demo outcome", settleOutcome, `sim-economy-market-${market.id}-settle`), field(documentRoot, "Provenance source", source, `sim-economy-market-${market.id}-source`), actions(documentRoot, [settle]));
        controls.push(form);
        const node = record(documentRoot, market.title, `${market.status.toUpperCase()} · pool ${assetAmount(market.poolFluff, "TUMBO")} · ${market.outcomes.join(" / ")}`, controls);
        node.dataset.marketId = market.id;
        node.querySelector?.(`[data-action="prediction:buy:${market.id}"]`)?.addEventListener("click", () => {});
        // Store the controls on the record for the delegated action handler.
        node._simPredictionControls = { outcomeSelect, units, settleOutcome, source };
        marketList.append(node);
      } else {
        marketList.append(record(documentRoot, market.title, `SETTLED · ${market.settlement?.outcome ?? "recorded"} · explicit demo provenance`));
      }
    }
  }

  function refreshContracts() {
    contractList.replaceChildren();
    const contracts = model.contracts();
    if (!contracts.length) { contractList.append(text(documentRoot, "div", "No local contracts yet.", "sim-economy-empty")); return; }
    for (const contract of contracts) {
      const children = [];
      if (contract.status === "draft") children.push(button(documentRoot, "Accept as guide", `contract:accept:${contract.id}`, "sim-economy-primary"));
      if (contract.status === "active" && contract.funding.status === "unfunded") children.push(button(documentRoot, "Fund as you", `contract:fund:${contract.id}`, "sim-economy-primary"));
      if (contract.status === "active" && (contract.funding.status === "funded" || contract.amountFluff === 0)) children.push(button(documentRoot, "Complete demo", `contract:complete:${contract.id}`, "sim-economy-primary"));
      if (["draft", "active"].includes(contract.status)) children.push(button(documentRoot, "Cancel", `contract:cancel:${contract.id}`, "sim-economy-danger"));
      const meta = `${contract.status.toUpperCase()} · ${assetAmount(contract.amountFluff, "TUMBO")} · ${contract.creator} → ${contract.counterparty}`;
      contractList.append(record(documentRoot, contract.title, meta, children));
    }
  }

  function refreshHousePools() {
    if (typeof model.housePools !== "function") {
      housePoolStorage.textContent = "House-pool reservations are unavailable in this economy model.";
      housePoolStorage.dataset.durable = "false";
      housePoolSelect.replaceChildren(select(documentRoot, [{ value: "", label: "House pools unavailable" }], "").firstChild);
      housePoolSelect.disabled = true;
      housePoolReserve.disabled = true;
      housePoolList.replaceChildren(text(documentRoot, "div", "No house-pool lifecycle is mounted in this model.", "sim-economy-empty"));
      return;
    }

    const pools = model.housePools({ owner: "you" });
    const previousPoolId = housePoolSelect.value;
    housePoolSelect.replaceChildren();
    housePoolSelect.append(text(documentRoot, "option", pools.length ? "Select a house pool" : "Create a house pool first"));
    housePoolSelect.firstChild.value = "";
    for (const pool of pools) {
      const option = text(documentRoot, "option", `${pool.name} · ${assetAmount(pool.totalUnits, "TUMBO")} / ${assetAmount(pool.capacityFluff, "TUMBO")}`);
      option.value = pool.id;
      housePoolSelect.append(option);
    }
    const selectedPoolId = pools.some((pool) => pool.id === previousPoolId) ? previousPoolId : pools[0]?.id ?? "";
    housePoolSelect.value = selectedPoolId;
    housePoolSelect.disabled = pools.length === 0;
    housePoolReserve.disabled = !selectedPoolId;
    const storage = persistenceSummary(model);
    housePoolStorage.textContent = `Receipt persistence · ${storage}`;
    housePoolStorage.dataset.durable = String(DURABLE_STORAGE_STATES.has(String(model.storageStatus || "unknown")));

    housePoolList.replaceChildren();
    if (!pools.length) {
      housePoolList.append(text(documentRoot, "div", "No local house pools yet. Create one with an explicit capacity above.", "sim-economy-empty"));
      return;
    }
    for (const pool of pools) {
      const own = pool.contributors.find((entry) => entry.account === "u:you") ?? null;
      const ownReserved = own?.reservedUnits ?? 0;
      const ownCommitted = own?.committedUnits ?? 0;
      const children = [];
      const poolNode = record(
        documentRoot,
        pool.name,
        `${pool.status.toUpperCase()} · ${assetAmount(pool.totalUnits, "TUMBO")} in this pool / ${assetAmount(pool.capacityFluff, "TUMBO")} capacity · ${assetAmount(pool.availableCapacityFluff, "TUMBO")} remaining`,
        children,
      );
      poolNode.classList.add("sim-economy-house-pool-card");
      poolNode.dataset.poolId = pool.id;
      poolNode.append(
        text(documentRoot, "span", `My balance · available ${assetAmount(model.balances("you").available.TUMBO, "TUMBO")} · reserved ${assetAmount(ownReserved + ownCommitted, "TUMBO")}`),
        text(documentRoot, "span", `My units · reserved ${ownReserved.toLocaleString("en-US")} · committed ${ownCommitted.toLocaleString("en-US")} · share ${exactShare(own)}`, "sim-economy-house-pool-ratio"),
      );
      if (pool.contributions.length) {
        for (const contribution of pool.contributions.filter((entry) => entry.contributor === "u:you")) {
          const contributionNode = documentRoot.createElement("div");
          contributionNode.className = "sim-economy-house-pool-contribution";
          contributionNode.dataset.contributionId = contribution.id;
          contributionNode.append(
            text(documentRoot, "strong", `${contribution.status.toUpperCase()} · ${assetAmount(contribution.amountFluff, "TUMBO-SIM")}`),
            text(documentRoot, "span", `Receipt · ${contribution.status === "released" ? contribution.releaseReceiptId : contribution.reserveReceiptId}`),
            text(documentRoot, "span", `Pool share · ${exactShare(own)} · revision ${pool.revision}`),
          );
          if (contribution.status === "reserved") {
            const release = button(documentRoot, "Release uncommitted contribution", "house-pool:release", "sim-economy-danger");
            release.dataset.poolId = pool.id;
            release.dataset.contributionId = contribution.id;
            contributionNode.append(actions(documentRoot, [release]));
          } else if (contribution.status === "committed") {
            contributionNode.append(text(documentRoot, "span", "Commitment lock unavailable here; no release or settlement action is exposed.", "sim-economy-house-pool-unavailable"));
          }
          poolNode.append(contributionNode);
        }
      }
      housePoolList.append(poolNode);
    }
  }

  function refresh() {
    refreshBalance();
    refreshOrders();
    refreshMarkets();
    refreshContracts();
    refreshHousePools();
  }

  let actionBusy = false;
  let lastActionFinishedAt = -Infinity;
  let lastActionType = null;
  const run = async (action, actionType = "economy-action", intent = null) => {
    // A fast double-tap should not enqueue two different economic actions.
    // The domain still enforces idempotency for callers that retry explicitly;
    // this guard keeps the contextual UI quiet until its first action settles.
    if (actionBusy || (actionType === lastActionType && Date.now() - lastActionFinishedAt < 350)) return null;
    actionBusy = true;
    panel.dataset.busy = "true";
    let committed = false;
    try {
      await action();
      refresh();
      setStatus(committedStatus());
      committed = true;
      return true;
    } catch (error) {
      showError(error);
      return null;
    } finally {
      if (committed && intent) pendingIntents.delete(intent.identity);
      actionBusy = false;
      lastActionFinishedAt = Date.now();
      lastActionType = actionType;
      delete panel.dataset.busy;
    }
  };

  panel.addEventListener("click", (event) => {
    const action = event.target?.dataset?.action;
    if (!action) return;
    if (action === "close") { hide(); return; }
    if (action.startsWith("tab:")) {
      const tabId = action.slice(4);
      for (const tab of tabButtons) tab.setAttribute("aria-selected", tab.dataset.tab === tabId ? "true" : "false");
      for (const node of [exchangeTab, predictionTab, contractsTab, housePoolTab]) node.hidden = node.id !== `sim-economy-tab-${tabId}`;
      return;
    }
    if (action === "exchange:seed") {
      const intent = operationIntent("exchange-seed", {});
      run(async () => { model.seedDemoLiquidity({ idempotencyKey: intent.key }); }, action, intent);
      return;
    }
    if (action === "exchange:place") {
      const request = {
        owner: "you",
        side: exchangeSide.value,
        amountBase: Number(exchangeAmount.value),
        priceNum: Number(exchangeNum.value),
        priceDen: Number(exchangeDen.value),
      };
      const intent = operationIntent("exchange-order", request);
      run(async () => {
        model.placeExchangeOrder({ ...request, idempotencyKey: intent.key });
      }, action, intent);
      return;
    }
    if (action === "exchange:quote") {
      const amountIn = Number(quoteAmount.value);
      const intent = operationIntent("shared-quote", { amountIn });
      run(async () => {
        const quote = model.token.quote({ action: "buy", from: "u:you", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn });
        const receipt = model.token.execute(quote, { idempotencyKey: intent.key });
        setStatus(`Shared local quote settled · ${assetAmount(receipt.amountOut, "sMIMAS")}.`);
      }, action, intent);
      return;
    }
    if (action.startsWith("exchange:cancel:")) {
      const orderId = action.slice("exchange:cancel:".length);
      const order = model.exchangeOrders({ owner: "you" }).find((entry) => entry.id === orderId);
      if (!order) return;
      const intent = operationIntent("exchange-cancel", { orderId, revision: order.revision });
      run(async () => { model.cancelExchangeOrder({ orderId, owner: "you", expectedRevision: order.revision, idempotencyKey: intent.key }); }, action, intent);
      return;
    }
    if (action.startsWith("prediction:buy:")) {
      const marketId = action.slice("prediction:buy:".length);
      const node = [...marketList.children].find((entry) => entry.dataset.marketId === marketId);
      const controls = node?._simPredictionControls;
      if (!controls) return;
      const request = { marketId, outcome: controls.outcomeSelect.value, units: Number(controls.units.value) };
      const intent = operationIntent("prediction-buy", request);
      run(async () => { model.buyPredictionPosition({ ...request, idempotencyKey: intent.key }); }, action, intent);
      return;
    }
    if (action.startsWith("prediction:settle:")) {
      const marketId = action.slice("prediction:settle:".length);
      const node = [...marketList.children].find((entry) => entry.dataset.marketId === marketId);
      const controls = node?._simPredictionControls;
      if (!controls) return;
      const request = { marketId, outcome: controls.settleOutcome.value, source: controls.source.value };
      const intent = operationIntent("prediction-settle", request);
      run(async () => { model.settlePredictionMarket({ marketId, outcome: request.outcome, provenance: { kind: PREDICTION_PROVENANCE_KIND, source: request.source, live: false }, idempotencyKey: intent.key }); }, action, intent);
      return;
    }
    if (action === "prediction:create") {
      const request = { title: predictionTitle.value, outcomes: predictionOutcomes.value.split(",").map((value) => value.trim()), priceFluff: Number(predictionPrice.value) };
      const intent = operationIntent("prediction-create", request);
      run(async () => { model.createPredictionMarket({ ...request, idempotencyKey: intent.key }); }, action, intent);
      return;
    }
    if (action === "house-pool:create") {
      const request = { name: housePoolName.value, capacityFluff: Number(housePoolCapacity.value), owner: "you" };
      const intent = operationIntent("house-pool-create", request);
      run(async () => { model.createHousePool({ ...request, idempotencyKey: intent.key }); }, action, intent);
      return;
    }
    if (action === "house-pool:reserve") {
      if (typeof model.housePools !== "function" || !housePoolSelect.value) return;
      const pool = model.housePools({ owner: "you" }).find((entry) => entry.id === housePoolSelect.value);
      if (!pool) return;
      const request = {
        poolId: pool.id,
        contributor: "you",
        amountFluff: Number(housePoolAmount.value),
        expectedRevision: pool.revision,
      };
      const intent = operationIntent("house-pool-reserve", request);
      run(async () => { model.reserveHousePoolContribution({ ...request, idempotencyKey: intent.key }); }, action, intent);
      return;
    }
    if (action === "house-pool:release") {
      if (typeof model.housePools !== "function") return;
      const poolId = event.target?.dataset?.poolId;
      const contributionId = event.target?.dataset?.contributionId;
      const pool = model.housePools({ owner: "you" }).find((entry) => entry.id === poolId);
      const contribution = pool?.contributions.find((entry) => entry.id === contributionId);
      if (!pool || !contribution || contribution.status !== "reserved") return;
      const request = { poolId, contributionId, actor: "you", expectedRevision: pool.revision };
      const intent = operationIntent("house-pool-release", request);
      run(async () => { model.releaseHousePoolContribution({ ...request, idempotencyKey: intent.key }); }, action, intent);
      return;
    }
    if (action === "contract:create") {
      const request = { title: contractTitle.value, amountFluff: Number(contractAmount.value) };
      const intent = operationIntent("contract-create", request);
      run(async () => { model.createContract({ ...request, idempotencyKey: intent.key }); }, action, intent);
      return;
    }
    if (action.startsWith("contract:accept:")) {
      const contractId = action.slice("contract:accept:".length);
      const contract = model.contracts().find((entry) => entry.id === contractId);
      if (!contract) return;
      const intent = operationIntent("contract-accept", { contractId, revision: contract.revision });
      run(async () => { model.acceptContract({ contractId, actor: "b:guide", expectedRevision: contract.revision, idempotencyKey: intent.key }); }, action, intent);
      return;
    }
    if (action.startsWith("contract:fund:")) {
      const contractId = action.slice("contract:fund:".length);
      const contract = model.contracts().find((entry) => entry.id === contractId);
      if (!contract) return;
      const intent = operationIntent("contract-fund", { contractId, revision: contract.revision });
      run(async () => { model.fundContract({ contractId, actor: "you", expectedRevision: contract.revision, idempotencyKey: intent.key }); }, action, intent);
      return;
    }
    if (action.startsWith("contract:complete:")) {
      const contractId = action.slice("contract:complete:".length);
      const contract = model.contracts().find((entry) => entry.id === contractId);
      if (!contract) return;
      const request = { contractId, revision: contract.revision, evidence: "Local field object marked complete", source: "user-entered-demo-evidence" };
      const intent = operationIntent("contract-complete", request);
      run(async () => { model.completeContract({ contractId, actor: "b:guide", evidence: request.evidence, provenance: { kind: CONTRACT_EVIDENCE_KIND, source: request.source, live: false }, expectedRevision: request.revision, idempotencyKey: intent.key }); }, action, intent);
      return;
    }
    if (action.startsWith("contract:cancel:")) {
      const contractId = action.slice("contract:cancel:".length);
      const contract = model.contracts().find((entry) => entry.id === contractId);
      if (!contract) return;
      const intent = operationIntent("contract-cancel", { contractId, revision: contract.revision });
      run(async () => { model.cancelContract({ contractId, actor: "you", expectedRevision: contract.revision, idempotencyKey: intent.key }); }, action, intent);
    }
  });

  const off = model.on(() => { if (!panel.hidden) refresh(); });
  trigger?.addEventListener?.("click", show);
  trigger?.setAttribute?.("aria-controls", panel.id);
  trigger?.setAttribute?.("aria-haspopup", "dialog");
  if (autoOpen) show();
  refresh();

  return Object.freeze({
    source: SIMULATED_ECONOMY_PANEL_SOURCE,
    objectId: SIMULATED_ECONOMY_PANEL_OBJECT_ID,
    economy: model,
    element: panel,
    open: show,
    close: hide,
    refresh,
    snapshot: () => model.snapshot(),
    destroy() {
      off?.();
      trigger?.removeEventListener?.("click", show);
      panel.remove();
    },
  });
}

export default mountSimulatedEconomyPanel;
