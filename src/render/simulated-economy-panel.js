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
.sim-economy-balance{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.sim-economy-balance-card{padding:8px;border:1px solid rgba(137,222,247,.16);border-radius:10px;background:rgba(33,110,145,.12)}
.sim-economy-balance-card strong{display:block;color:#e9fbff;font-size:14px;font-variant-numeric:tabular-nums}
.sim-economy-balance-card span{display:block;margin-top:2px;color:#83afbd;font-size:8px;letter-spacing:.12em;text-transform:uppercase}
.sim-economy-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
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
.sim-economy-empty{padding:10px;border:1px dashed rgba(137,222,247,.22);border-radius:9px;color:#8db6c1;font-size:10px}
.sim-economy-status{min-height:18px;color:#9de6c8;font-size:10px}
.sim-economy-status[data-tone=error]{color:#ffb7c0}
.sim-economy-note{margin:0;color:#91b1bc;font-size:9px;line-height:1.45}
@media(max-width:700px){.sim-economy-panel{inset:auto 8px 8px;width:auto;max-height:calc(100vh - 16px);padding:11px;border-radius:14px}.sim-economy-head h2{font-size:16px}.sim-economy-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.sim-economy-actions button{width:100%}}
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

  tabsRoot.append(exchangeTab, predictionTab, contractsTab);

  let keySequence = 0;
  const nextKey = (scope) => `${SIMULATED_ECONOMY_PANEL_SOURCE}:${scope}:${++keySequence}`;
  const show = () => { panel.hidden = false; refresh(); onWorldFocus?.({ objectId: SIMULATED_ECONOMY_PANEL_OBJECT_ID, kind: "simulated-economy" }); };
  const hide = () => { panel.hidden = true; };
  const setStatus = (message, tone = "ok") => { status.textContent = message; status.dataset.tone = tone; };
  const showError = (error) => setStatus(error?.message || String(error), "error");

  function refreshBalance() {
    const snapshot = model.balances("you");
    balance.replaceChildren(
      (() => { const node = documentRoot.createElement("div"); node.className = "sim-economy-balance-card"; node.append(text(documentRoot, "strong", assetAmount(snapshot.available.TUMBO, "TUMBO")), text(documentRoot, "span", "available TUMBO-SIM")); return node; })(),
      (() => { const node = documentRoot.createElement("div"); node.className = "sim-economy-balance-card"; node.append(text(documentRoot, "strong", assetAmount(snapshot.available.sMIMAS, "sMIMAS")), text(documentRoot, "span", "available sMIMAS")); return node; })(),
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

  function refresh() {
    refreshBalance();
    refreshOrders();
    refreshMarkets();
    refreshContracts();
  }

  let actionBusy = false;
  let lastActionFinishedAt = -Infinity;
  let lastActionType = null;
  const run = async (action, actionType = "economy-action") => {
    // A fast double-tap should not enqueue two different economic actions.
    // The domain still enforces idempotency for callers that retry explicitly;
    // this guard keeps the contextual UI quiet until its first action settles.
    if (actionBusy || (actionType === lastActionType && Date.now() - lastActionFinishedAt < 350)) return null;
    actionBusy = true;
    panel.dataset.busy = "true";
    try {
      await action();
      refresh();
      setStatus("Committed to the local simulated receipt ledger.");
      return true;
    } catch (error) {
      showError(error);
      return null;
    } finally {
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
      for (const node of [exchangeTab, predictionTab, contractsTab]) node.hidden = node.id !== `sim-economy-tab-${tabId}`;
      return;
    }
    if (action === "exchange:seed") {
      run(async () => { model.seedDemoLiquidity(); }, action);
      return;
    }
    if (action === "exchange:place") {
      run(async () => {
        model.placeExchangeOrder({
          owner: "you", side: exchangeSide.value, amountBase: Number(exchangeAmount.value), priceNum: Number(exchangeNum.value), priceDen: Number(exchangeDen.value), idempotencyKey: nextKey("exchange-order"),
        });
      }, action);
      return;
    }
    if (action === "exchange:quote") {
      run(async () => {
        const amountIn = Number(quoteAmount.value);
        const quote = model.token.quote({ action: "buy", from: "u:you", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn });
        const receipt = model.token.execute(quote, { idempotencyKey: nextKey("shared-quote") });
        setStatus(`Shared local quote settled · ${assetAmount(receipt.amountOut, "sMIMAS")}.`);
      }, action);
      return;
    }
    if (action.startsWith("exchange:cancel:")) {
      const orderId = action.slice("exchange:cancel:".length);
      const order = model.exchangeOrders({ owner: "you" }).find((entry) => entry.id === orderId);
      if (!order) return;
      run(async () => { model.cancelExchangeOrder({ orderId, owner: "you", expectedRevision: order.revision, idempotencyKey: nextKey("exchange-cancel") }); }, action);
      return;
    }
    if (action.startsWith("prediction:buy:")) {
      const marketId = action.slice("prediction:buy:".length);
      const node = [...marketList.children].find((entry) => entry.dataset.marketId === marketId);
      const controls = node?._simPredictionControls;
      if (!controls) return;
      run(async () => { model.buyPredictionPosition({ marketId, outcome: controls.outcomeSelect.value, units: Number(controls.units.value), idempotencyKey: nextKey("prediction-buy") }); }, action);
      return;
    }
    if (action.startsWith("prediction:settle:")) {
      const marketId = action.slice("prediction:settle:".length);
      const node = [...marketList.children].find((entry) => entry.dataset.marketId === marketId);
      const controls = node?._simPredictionControls;
      if (!controls) return;
      run(async () => { model.settlePredictionMarket({ marketId, outcome: controls.settleOutcome.value, provenance: { kind: PREDICTION_PROVENANCE_KIND, source: controls.source.value, live: false }, idempotencyKey: nextKey("prediction-settle") }); }, action);
      return;
    }
    if (action === "prediction:create") {
      run(async () => { model.createPredictionMarket({ title: predictionTitle.value, outcomes: predictionOutcomes.value.split(",").map((value) => value.trim()), priceFluff: Number(predictionPrice.value), idempotencyKey: nextKey("prediction-create") }); }, action);
      return;
    }
    if (action === "contract:create") {
      run(async () => { model.createContract({ title: contractTitle.value, amountFluff: Number(contractAmount.value), idempotencyKey: nextKey("contract-create") }); }, action);
      return;
    }
    if (action.startsWith("contract:accept:")) {
      const contractId = action.slice("contract:accept:".length);
      const contract = model.contracts().find((entry) => entry.id === contractId);
      if (!contract) return;
      run(async () => { model.acceptContract({ contractId, actor: "b:guide", expectedRevision: contract.revision, idempotencyKey: nextKey("contract-accept") }); }, action);
      return;
    }
    if (action.startsWith("contract:fund:")) {
      const contractId = action.slice("contract:fund:".length);
      const contract = model.contracts().find((entry) => entry.id === contractId);
      if (!contract) return;
      run(async () => { model.fundContract({ contractId, actor: "you", expectedRevision: contract.revision, idempotencyKey: nextKey("contract-fund") }); }, action);
      return;
    }
    if (action.startsWith("contract:complete:")) {
      const contractId = action.slice("contract:complete:".length);
      const contract = model.contracts().find((entry) => entry.id === contractId);
      if (!contract) return;
      run(async () => { model.completeContract({ contractId, actor: "b:guide", evidence: "Local field object marked complete", provenance: { kind: CONTRACT_EVIDENCE_KIND, source: "user-entered-demo-evidence", live: false }, expectedRevision: contract.revision, idempotencyKey: nextKey("contract-complete") }); }, action);
      return;
    }
    if (action.startsWith("contract:cancel:")) {
      const contractId = action.slice("contract:cancel:".length);
      const contract = model.contracts().find((entry) => entry.id === contractId);
      if (!contract) return;
      run(async () => { model.cancelContract({ contractId, actor: "you", expectedRevision: contract.revision, idempotencyKey: nextKey("contract-cancel") }); }, action);
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
