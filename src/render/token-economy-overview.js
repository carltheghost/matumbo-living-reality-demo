/* Small DOM renderer for the read-only token/economy projection. */
import { ACCOUNT_CATEGORIES, formatAssetAmount } from "../domains/token-economy-overview.js";

const CATEGORY_LABELS = Object.freeze({
  available: "Available user/bot",
  locked: "Locked / vault",
  reserved: "Reserved / escrow",
  burned: "Burned / Void",
  treasury: "Treasury",
  faucet: "Faucet",
  market: "Market inventory",
  issuanceMirror: "Issuance mirror",
  otherSystem: "Other system",
});

function element(documentRef, tag, text = "", className = "") {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

function appendMetric(documentRef, list, label, value) {
  const item = element(documentRef, "li", "", "token-economy-overview__metric");
  item.append(element(documentRef, "span", label, "token-economy-overview__label"));
  item.append(element(documentRef, "strong", value, "token-economy-overview__value"));
  list.append(item);
}

function groupedDecimal(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError("supply policy values must be canonical decimal strings");
  }
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function renderSupplyPolicy(documentRef, policy) {
  if (!policy || policy.simulation !== true || policy.asset !== "TUMBO-SIM") return null;
  const section = element(documentRef, "section", "", "token-economy-overview__supply-policy");
  section.append(element(documentRef, "h3", "Supply policy (simulation metadata)"));
  section.append(element(
    documentRef,
    "p",
    `Current issued simulation supply: ${groupedDecimal(policy.currentIssued.wholeTumbo)} TUMBO-SIM (${groupedDecimal(policy.currentIssued.fluff)} fluff); conservation anchor only.`,
  ));
  section.append(element(
    documentRef,
    "p",
    `Intended fixed maximum: ${groupedDecimal(policy.intendedMaximum.wholeTumbo)} TUMBO (${groupedDecimal(policy.intendedMaximum.fluff)} fluff); policy metadata only, not issued or minted.`,
  ));
  section.append(element(
    documentRef,
    "p",
    `Exact unit: 1 TUMBO-SIM = ${groupedDecimal(policy.fluffPerTumbo)} fluff. Policy metadata does not alter balances, genesis, journals, or receipts.`,
    "token-economy-overview__supply-note",
  ));
  return section;
}

function renderAsset(documentRef, assetReport) {
  const article = element(documentRef, "article", "", "token-economy-overview__asset");
  article.dataset.asset = assetReport.asset;
  article.append(element(documentRef, "h3", assetReport.asset));
  article.append(element(documentRef, "p", `Recorded runtime supply: ${assetReport.recordedSupplyDisplay}`, "token-economy-overview__supply"));

  const list = element(documentRef, "ul", "", "token-economy-overview__metrics");
  for (const category of ACCOUNT_CATEGORIES) {
    appendMetric(documentRef, list, CATEGORY_LABELS[category] ?? category, formatAssetAmount(assetReport.asset, assetReport.categories[category]));
  }
  appendMetric(documentRef, list, "Circulating (derived)", assetReport.circulatingDisplay);
  article.append(list);

  const checks = element(documentRef, "p", "", "token-economy-overview__checks");
  checks.append(element(documentRef, "span", `Conservation ${assetReport.invariants.conservation ? "OK" : "FAILED"}`));
  checks.append(element(documentRef, "span", `Journal ${assetReport.invariants.journalBalanced ? "balanced" : "FAILED"}`));
  checks.append(element(documentRef, "span", `Fee ${assetReport.invariants.marketFeeConsistency ? "consistent" : "FAILED"}`));
  article.append(checks);
  return article;
}

/**
 * Render the projection into a caller-owned container.  The function never
 * attaches listeners or mutates the token/economy owner; callers can invoke
 * it again after receiving their normal local simulation update event.
 */
export function renderTokenEconomyOverview(container, overview) {
  if (!container || typeof container.replaceChildren !== "function") throw new TypeError("overview container must be a DOM element");
  if (!overview || overview.simulation !== true || overview.format !== "tumbo-sim-token-economy-overview-v1") {
    throw new TypeError("renderTokenEconomyOverview requires the canonical overview projection");
  }
  const documentRef = container.ownerDocument ?? globalThis.document;
  if (!documentRef?.createElement) throw new TypeError("overview rendering requires a DOM document");

  const root = element(documentRef, "section", "", "token-economy-overview");
  root.dataset.simulation = "true";
  root.dataset.status = overview.status;
  root.dataset.overviewFormat = overview.format;
  root.append(element(documentRef, "h2", "TUMBO-SIM economy"));
  root.append(element(documentRef, "p", "Local simulation only — no external settlement, custody, payout, or price promise.", "token-economy-overview__status"));

  const statusList = element(documentRef, "ul", "", "token-economy-overview__status-list");
  appendMetric(documentRef, statusList, "Receipt chain", overview.invariants.chain.ok ? "verified" : "FAILED");
  appendMetric(documentRef, statusList, "Replay safety", overview.invariants.idempotency.ok ? "no duplicate journals" : "FAILED");
  appendMetric(documentRef, statusList, "Overall accounting", overview.invariants.ok ? "healthy" : "review required");
  appendMetric(documentRef, statusList, "Rewards", overview.rewards.status);
  appendMetric(documentRef, statusList, "Economy adapter", overview.economy.status);
  root.append(statusList);

  const supplyPolicy = renderSupplyPolicy(documentRef, overview.supplyPolicy);
  if (supplyPolicy) root.append(supplyPolicy);

  const assets = element(documentRef, "div", "", "token-economy-overview__assets");
  for (const assetReport of Object.values(overview.assets)) assets.append(renderAsset(documentRef, assetReport));
  root.append(assets);

  const explanation = element(documentRef, "details", "", "token-economy-overview__definitions");
  explanation.append(element(documentRef, "summary", "How totals are derived"));
  const definitions = element(documentRef, "ul");
  for (const [label, text] of Object.entries(overview.definitions)) appendMetric(documentRef, definitions, label, text);
  explanation.append(definitions);
  root.append(explanation);

  container.replaceChildren(root);
  return root;
}

export default renderTokenEconomyOverview;
