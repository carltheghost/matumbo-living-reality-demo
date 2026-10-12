/*
 * Read-only accounting projection for the local TUMBO-SIM economy.
 *
 * This module deliberately does not own balances, issue tokens, settle an
 * order, or persist anything.  The canonical owner remains TokenLedger in
 * token.js.  The projection is useful to a UI because every amount is an
 * integer fluff value and every derived total names the account category it
 * came from.
 */
import {
  ASSETS,
  MARKET_ACTIONS,
  assertAsset,
  isUserAccount,
  mulDivFloor,
} from "./token.js";
import { loadTokenEngine } from "./token-store.js";

export const TOKEN_ECONOMY_OVERVIEW_FORMAT = "tumbo-sim-token-economy-overview-v1";
export const TOKEN_ECONOMY_OVERVIEW_UNIT = "integer fluff";

export const ACCOUNT_CATEGORIES = Object.freeze([
  "available",
  "locked",
  "reserved",
  "burned",
  "treasury",
  "faucet",
  "market",
  "issuanceMirror",
  "otherSystem",
]);

const CATEGORY_BY_ACCOUNT = Object.freeze({
  "sys:issuance": "issuanceMirror",
  "sys:treasury": "treasury",
  "sys:faucet": "faucet",
  "sys:escrow": "reserved",
  "sys:vault": "locked",
  "sys:void": "burned",
  "sys:market": "market",
});

const freeze = (value, seen = new Set()) => {
  if (!value || typeof value !== "object" || seen.has(value) || Object.isFrozen(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
};

function safeInteger(value, field, { signed = true } = {}) {
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) {
    throw new TypeError(`${field} must be a safe integer${signed ? "" : " greater than or equal to zero"}`);
  }
  return value;
}

function safeError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Convert a TUMBO-SIM decimal string to fluff without passing through a
 * binary floating point number.  Numbers are intentionally rejected: the
 * caller must make precision explicit at the boundary.
 */
export function parseTumboSimExact(value) {
  if (typeof value !== "string") throw new TypeError("TUMBO-SIM amounts must be decimal strings");
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) {
    throw new TypeError("TUMBO-SIM amounts need at most three decimal places");
  }
  const [whole, fraction = ""] = text.split(".");
  const fluff = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  if (fluff > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("TUMBO-SIM amount exceeds the safe integer range");
  return Number(fluff);
}

function groupedInteger(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Format a safe integer without using floating point arithmetic. */
export function formatAssetAmount(asset, fluff) {
  assertAsset(asset);
  safeInteger(fluff, `${asset} fluff`);
  const sign = fluff < 0 ? "-" : "";
  const magnitude = Math.abs(fluff);
  if (asset === "TUMBO") {
    const whole = Math.floor(magnitude / 1000);
    const fraction = String(magnitude % 1000).padStart(3, "0");
    return `${sign}${groupedInteger(whole)}.${fraction} TUMBO-SIM`;
  }
  return `${sign}${groupedInteger(magnitude)} ${asset}-fluff`;
}

function normalizeEngine({ engine = null, token = null, snapshot = null } = {}) {
  const hasSnapshot = snapshot !== null && snapshot !== undefined;
  if (hasSnapshot && (engine !== null && engine !== undefined || token !== null && token !== undefined)) {
    throw new TypeError("provide either a canonical engine/token or a serialized token snapshot, not both");
  }
  if (hasSnapshot) {
    const restored = loadTokenEngine(snapshot);
    return { engine: restored, sourceKind: "serialized-snapshot", snapshotFormat: "tumbo-token-engine-v2" };
  }
  const candidate = engine ?? token;
  const resolved = candidate?.engine ?? candidate?._engine ?? candidate;
  if (!resolved?.ledger || typeof resolved.balance !== "function" || typeof resolved.quote !== "function" || typeof resolved.execute !== "function" ||
      typeof resolved.ledger.verifyChain !== "function" || !Array.isArray(resolved.ledger._journals) || !(resolved.ledger._balances instanceof Map) ||
      !(resolved.ledger._receipts instanceof Map) || !(resolved.ledger._requestKeys instanceof Map) || !resolved.config) {
    throw new TypeError("token economy overview requires the canonical QuoteEngine owner");
  }
  return { engine: resolved, sourceKind: "live-engine", snapshotFormat: null };
}

function categoryFor(account) {
  if (CATEGORY_BY_ACCOUNT[account]) return CATEGORY_BY_ACCOUNT[account];
  if (isUserAccount(account)) return "available";
  if (String(account).startsWith("sys:")) return "otherSystem";
  return "otherSystem";
}

function emptyCategoryTotals() {
  return Object.fromEntries(ACCOUNT_CATEGORIES.map((category) => [category, 0]));
}

function ledgerAccounts(engine) {
  const opened = typeof engine.ledger.accounts === "function" ? engine.ledger.accounts() : [];
  if (!Array.isArray(opened)) throw new TypeError("canonical ledger accounts() must return an array");
  const rows = new Map();
  for (const row of opened) {
    if (!row || typeof row.account !== "string" || typeof row.asset !== "string") {
      throw new TypeError("canonical ledger returned a malformed account row");
    }
    assertAsset(row.asset);
    rows.set(`${row.account}|${row.asset}`, { account: row.account, asset: row.asset });
  }
  // Include private balance entries as a corruption signal if a caller has
  // tampered with the canonical owner without updating its opened-account
  // index.  Normal TokenLedger operation never needs this fallback.
  if (engine.ledger._balances instanceof Map) {
    for (const key of engine.ledger._balances.keys()) {
      const separator = key.lastIndexOf("|");
      if (separator <= 0) continue;
      const account = key.slice(0, separator);
      const asset = key.slice(separator + 1);
      if (ASSETS.includes(asset)) rows.set(`${account}|${asset}`, { account, asset });
    }
  }
  return [...rows.values()].sort((left, right) => left.account.localeCompare(right.account) || left.asset.localeCompare(right.asset));
}

function readBalances(engine, accounts) {
  const rows = [];
  const totals = Object.fromEntries(ASSETS.map((asset) => [asset, emptyCategoryTotals()]));
  const negativeBalances = [];
  const invalidBalances = [];
  for (const { account, asset } of accounts) {
    let balance;
    try {
      balance = engine.balance(account, asset);
    } catch (error) {
      invalidBalances.push({ account, asset, error: safeError(error) });
      continue;
    }
    if (!Number.isSafeInteger(balance)) {
      invalidBalances.push({ account, asset, value: balance });
      continue;
    }
    const category = categoryFor(account);
    totals[asset][category] = safeInteger(totals[asset][category] + balance, `${asset}.${category} total`);
    if (balance < 0 && account !== "sys:issuance") negativeBalances.push({ account, asset, balanceFluff: balance });
    rows.push({ account, asset, category, balanceFluff: balance });
  }
  return { rows, totals, negativeBalances, invalidBalances };
}

function readJournalEvidence(engine, config) {
  const journals = Array.isArray(engine.ledger._journals) ? engine.ledger._journals : null;
  if (!journals) throw new TypeError("canonical ledger journal history is unavailable");
  const journalNet = Object.fromEntries(ASSETS.map((asset) => [asset, 0]));
  const seenKeys = new Set();
  const duplicateKeys = [];
  const missingReceipts = [];
  const feeChecks = [];
  const voidCredits = [];
  for (const journal of journals) {
    if (!journal || typeof journal.idempotencyKey !== "string" || !Array.isArray(journal.postings)) {
      throw new TypeError("canonical ledger journal history contains a malformed receipt");
    }
    if (seenKeys.has(journal.idempotencyKey)) duplicateKeys.push(journal.idempotencyKey);
    seenKeys.add(journal.idempotencyKey);
    if (engine.ledger._receipts instanceof Map && !engine.ledger._receipts.has(journal.idempotencyKey)) {
      missingReceipts.push(journal.idempotencyKey);
    }
    const byAsset = Object.fromEntries(ASSETS.map((asset) => [asset, 0]));
    for (const posting of journal.postings) {
      if (!posting || !ASSETS.includes(posting.asset) || !Number.isSafeInteger(posting.amount)) {
        throw new TypeError(`malformed posting in ${journal.idempotencyKey}`);
      }
      journalNet[posting.asset] = safeInteger(journalNet[posting.asset] + posting.amount, `${posting.asset} journal total`);
      byAsset[posting.asset] = safeInteger(byAsset[posting.asset] + posting.amount, `${posting.asset} journal leg total`);
      if (posting.account === "sys:void" && posting.amount > 0) {
        voidCredits.push({
          idempotencyKey: journal.idempotencyKey,
          action: journal.action,
          asset: posting.asset,
          amountFluff: posting.amount,
          attributedAs: MARKET_ACTIONS.includes(journal.action) ? "tithe" : "other-authorized-burn",
        });
      }
    }
    for (const asset of ASSETS) {
      if (byAsset[asset] !== 0) throw new Error(`journal ${journal.idempotencyKey} is unbalanced for ${asset}`);
    }
    if (MARKET_ACTIONS.includes(journal.action)) {
      const negativeByAsset = Object.fromEntries(ASSETS.map((asset) => [asset, 0]));
      const voidByAsset = Object.fromEntries(ASSETS.map((asset) => [asset, 0]));
      for (const posting of journal.postings) {
        if (isUserAccount(posting.account) && posting.amount < 0) {
          negativeByAsset[posting.asset] = safeInteger(negativeByAsset[posting.asset] - posting.amount, `${posting.asset} market input`);
        }
        if (posting.account === "sys:void" && posting.amount > 0) {
          voidByAsset[posting.asset] = safeInteger(voidByAsset[posting.asset] + posting.amount, `${posting.asset} Void tithe`);
        }
      }
      for (const asset of ASSETS) {
        if (negativeByAsset[asset] === 0 && voidByAsset[asset] === 0) continue;
        const expected = mulDivFloor(negativeByAsset[asset], config.titheBps, config.titheDenominator);
        feeChecks.push({
          idempotencyKey: journal.idempotencyKey,
          action: journal.action,
          asset,
          inputFluff: negativeByAsset[asset],
          expectedTitheFluff: expected,
          actualTitheFluff: voidByAsset[asset],
          ok: expected === voidByAsset[asset],
        });
      }
    }
  }
  let chain;
  try {
    chain = engine.ledger.verifyChain();
  } catch (error) {
    chain = { ok: false, error: safeError(error) };
  }
  return { journals, journalNet, seenKeys, duplicateKeys, missingReceipts, feeChecks, voidCredits, chain };
}

function rewardReport(vault, engine) {
  if (vault === null || vault === undefined) {
    return {
      status: "not-observed",
      simulation: true,
      reason: "Pass the shared token-vault adapter to observe pending reward liabilities and reserve coverage.",
      byAsset: Object.fromEntries(ASSETS.map((asset) => [asset, {
        openPrincipalFluff: 0,
        pendingRewardFluff: null,
        reserveFluff: null,
        coverageFluff: null,
        ok: null,
      }])),
    };
  }
  if (vault.engine !== engine) throw new TypeError("token-vault adapter must share the canonical engine");
  try {
    if (typeof vault.openPositions !== "function" || typeof vault.estimateRewards !== "function" || typeof vault.rewardsReserveOf !== "function") {
      throw new TypeError("token-vault adapter does not expose the required read-only methods");
    }
    const positions = vault.openPositions();
    if (!Array.isArray(positions)) throw new TypeError("token-vault openPositions() must return an array");
    const byAsset = Object.fromEntries(ASSETS.map((asset) => [asset, {
      openPrincipalFluff: 0,
      pendingRewardFluff: 0,
      reserveFluff: null,
      coverageFluff: null,
      ok: true,
    }]));
    for (const position of positions) {
      if (!position || !ASSETS.includes(position.asset) || !Number.isSafeInteger(position.amountFluff) || position.amountFluff < 0) {
        throw new TypeError("token-vault returned a malformed open position");
      }
      const row = byAsset[position.asset];
      row.openPrincipalFluff = safeInteger(row.openPrincipalFluff + position.amountFluff, `${position.asset} open principal`, { signed: false });
      const reward = vault.estimateRewards(position.id);
      safeInteger(reward, `pending reward for ${position.id}`, { signed: false });
      row.pendingRewardFluff = safeInteger(row.pendingRewardFluff + reward, `${position.asset} pending rewards`, { signed: false });
    }
    for (const asset of ASSETS) {
      const reserve = vault.rewardsReserveOf(asset);
      safeInteger(reserve, `${asset} reward reserve`, { signed: false });
      byAsset[asset].reserveFluff = reserve;
      byAsset[asset].coverageFluff = reserve - byAsset[asset].pendingRewardFluff;
      byAsset[asset].ok = byAsset[asset].coverageFluff >= 0;
    }
    const integrity = typeof vault.vaultIntegrity === "function" ? vault.vaultIntegrity() : null;
    const integrityOk = !integrity || Object.values(integrity).every((row) => row?.ok !== false);
    return {
      status: "observed",
      simulation: true,
      positionCount: positions.length,
      byAsset,
      vaultIntegrity: integrity,
      ok: Object.values(byAsset).every((row) => row.ok) && integrityOk,
    };
  } catch (error) {
    return { status: "invalid", simulation: true, ok: false, error: safeError(error) };
  }
}

function economyReport(economy, engine) {
  if (economy === null || economy === undefined) {
    return { status: "not-provided", simulation: true, reason: "Pass the shared SimulatedEconomy adapter to include exchange, prediction, and contract obligations." };
  }
  if (economy.engine !== engine) throw new TypeError("simulated economy adapter must share the canonical engine");
  try {
    if (typeof economy.snapshot !== "function") throw new TypeError("simulated economy adapter must expose snapshot()");
    const state = economy.snapshot();
    const orders = Array.isArray(state?.exchange?.orders) ? state.exchange.orders : [];
    const markets = Array.isArray(state?.predictions?.markets) ? state.predictions.markets : [];
    const contracts = Array.isArray(state?.contracts) ? state.contracts : [];
    const operations = Array.isArray(state?.operations) ? state.operations : [];
    const activeOrders = orders.filter((order) => order.status !== "cancelled");
    const obligations = { TUMBO: 0, sMIMAS: 0 };
    for (const order of activeOrders) {
      if (order.side === "sell") obligations.TUMBO = safeInteger(obligations.TUMBO + order.remainingBase, "TUMBO exchange obligation", { signed: false });
      if (order.side === "buy") obligations.sMIMAS = safeInteger(obligations.sMIMAS + order.reservedQuote, "sMIMAS exchange obligation", { signed: false });
    }
    for (const market of markets) if (market.status === "open") obligations.TUMBO = safeInteger(obligations.TUMBO + market.poolFluff, "TUMBO prediction obligation", { signed: false });
    for (const contract of contracts) if (contract.funding?.status === "funded") obligations.TUMBO = safeInteger(obligations.TUMBO + contract.amountFluff, "TUMBO contract obligation", { signed: false });
    const baseline = {
      TUMBO: state.escrowBaseline?.TUMBO ?? 0,
      sMIMAS: state.escrowBaseline?.sMIMAS ?? 0,
    };
    const actual = Object.fromEntries(ASSETS.map((asset) => [asset, engine.balance("sys:escrow", asset)]));
    const expected = Object.fromEntries(ASSETS.map((asset) => [asset, baseline[asset] + obligations[asset]]));
    const escrow = Object.fromEntries(ASSETS.map((asset) => [asset, {
      actualFluff: actual[asset],
      expectedFluff: expected[asset],
      deltaFluff: actual[asset] - expected[asset],
      ok: actual[asset] === expected[asset],
    }]));
    const operationKeys = operations.map((operation) => operation?.key).filter((key) => typeof key === "string");
    const uniqueOperationKeys = new Set(operationKeys);
    let verification = { ok: true };
    if (typeof economy.verify === "function") {
      try { verification = economy.verify(); }
      catch (error) { verification = { ok: false, error: safeError(error) }; }
    }
    return {
      status: "observed",
      simulation: true,
      storageStatus: economy.storageStatus ?? "unknown",
      stateRevision: state.exchange?.revision ?? null,
      counts: {
        activeExchangeOrders: activeOrders.length,
        exchangeTrades: Array.isArray(state.exchange?.trades) ? state.exchange.trades.length : 0,
        openPredictionMarkets: markets.filter((market) => market.status === "open").length,
        openPredictionPositions: Array.isArray(state.predictions?.positions) ? state.predictions.positions.filter((position) => position.status === "open").length : 0,
        fundedContracts: contracts.filter((contract) => contract.funding?.status === "funded").length,
        operations: operations.length,
      },
      pendingObligationsFluff: obligations,
      escrow,
      operationRegistry: { unique: uniqueOperationKeys.size === operationKeys.length, count: operationKeys.length },
      verification,
      ok: Object.values(escrow).every((row) => row.ok) && uniqueOperationKeys.size === operationKeys.length && verification.ok !== false,
    };
  } catch (error) {
    return { status: "invalid", simulation: true, ok: false, error: safeError(error) };
  }
}

function makeAssetReport(asset, config, totals, journalNet, chain, feeChecks) {
  const categories = totals[asset];
  const recordedSupplyFluff = config.supply[asset];
  const nonIssuanceTotalFluff = ACCOUNT_CATEGORIES
    .filter((category) => category !== "issuanceMirror")
    .reduce((sum, category) => sum + categories[category], 0);
  const circulatingFluff = categories.available + categories.locked + categories.reserved;
  const reconciliationDeltaFluff = nonIssuanceTotalFluff - recordedSupplyFluff;
  const assetFeeChecks = feeChecks.filter((check) => check.asset === asset);
  return {
    asset,
    unit: TOKEN_ECONOMY_OVERVIEW_UNIT,
    recordedSupplyFluff,
    recordedSupplyDisplay: formatAssetAmount(asset, recordedSupplyFluff),
    categories: { ...categories },
    circulatingFluff,
    circulatingDisplay: formatAssetAmount(asset, circulatingFluff),
    nonIssuanceTotalFluff,
    journalNetFluff: journalNet[asset],
    reconciliationDeltaFluff,
    feeChecks: assetFeeChecks,
    invariants: {
      conservation: reconciliationDeltaFluff === 0,
      journalBalanced: journalNet[asset] === 0,
      marketFeeConsistency: assetFeeChecks.every((check) => check.ok),
      chain: chain.ok === true,
    },
  };
}

/**
 * Build a frozen, source-bound projection over a canonical QuoteEngine.
 * `snapshot` is accepted as either the JSON string emitted by
 * serializeTokenEngine or its parsed object; it is loaded into a fresh
 * canonical owner and never adopted into another owner.
 */
export function createTokenEconomyOverview({ engine = null, token = null, snapshot = null, economy = null, vault = null } = {}) {
  const resolved = normalizeEngine({ engine, token, snapshot });
  const canonical = resolved.engine;
  const config = canonical.config;
  if (!config?.supply || !ASSETS.every((asset) => Number.isSafeInteger(config.supply[asset]) && config.supply[asset] >= 0)) {
    throw new TypeError("canonical token configuration has invalid supplies");
  }
  const accounts = ledgerAccounts(canonical);
  const balances = readBalances(canonical, accounts);
  const evidence = readJournalEvidence(canonical, config);
  const assetReports = Object.fromEntries(ASSETS.map((asset) => [
    asset,
    makeAssetReport(asset, config, balances.totals, evidence.journalNet, evidence.chain, evidence.feeChecks),
  ]));
  const feeTotalFluff = Object.fromEntries(ASSETS.map((asset) => [
    asset,
    evidence.feeChecks.filter((check) => check.asset === asset).reduce((sum, check) => sum + check.actualTitheFluff, 0),
  ]));
  const reward = rewardReport(vault, canonical);
  const economyState = economyReport(economy, canonical);
  const chain = evidence.chain;
  const replaySafe = evidence.duplicateKeys.length === 0 && evidence.missingReceipts.length === 0;
  const balancesHealthy = balances.invalidBalances.length === 0 && balances.negativeBalances.length === 0;
  const economyHealthy = economyState.status === "not-provided" || economyState.ok === true;
  const rewardHealthy = reward.status !== "invalid" && (reward.status !== "observed" || reward.ok === true);
  const conservationHealthy = ASSETS.every((asset) => assetReports[asset].invariants.conservation);
  const journalHealthy = ASSETS.every((asset) => assetReports[asset].invariants.journalBalanced);
  const feeHealthy = evidence.feeChecks.every((check) => check.ok);
  const report = {
    format: TOKEN_ECONOMY_OVERVIEW_FORMAT,
    simulation: true,
    status: "local-simulation-only",
    source: {
      kind: resolved.sourceKind,
      canonicalModule: "src/domains/token.js",
      canonicalOwner: "TokenLedger / QuoteEngine",
      snapshotFormat: resolved.snapshotFormat,
      journalCount: evidence.journals.length,
      tipHash: chain.tip ?? null,
      hashAlgorithm: "fnv1a64-local-receipt-chain",
    },
    definitions: {
      unit: TOKEN_ECONOMY_OVERVIEW_UNIT,
      available: "Balances in u:/b: accounts, including savings pockets represented as user accounts.",
      locked: "The canonical sys:vault balance; wallet locks and token-vault positions share this account.",
      reserved: "The canonical sys:escrow balance; exchange, prediction, and contract obligations are included when their adapter is supplied.",
      burned: "The positive sys:void balance. It remains in the configured conservation anchor; it is not spendable.",
      circulating: "available + locked + reserved; excludes treasury, faucet, market inventory, issuance mirror, and burned balance.",
      recordedSupply: "The runtime conservation anchor from the canonical token configuration; this view does not choose a public supply allocation.",
      pricesAndSettlement: "No market price, external venue, wallet custody, payment, payout, or yield promise is represented here.",
    },
    assets: assetReports,
    accounts: balances.rows,
    fees: {
      configuredTitheBps: config.titheBps,
      configuredTitheDenominator: config.titheDenominator,
      realizedTitheFluff: feeTotalFluff,
      checks: evidence.feeChecks,
      unattributedVoidCredits: evidence.voidCredits.filter((credit) => credit.attributedAs !== "tithe"),
    },
    rewards: reward,
    economy: economyState,
    invariants: {
      ok: chain.ok === true && balancesHealthy && conservationHealthy && journalHealthy && replaySafe && feeHealthy && rewardHealthy && economyHealthy,
      chain,
      nonNegativeBalances: { ok: balancesHealthy, violations: balances.negativeBalances, invalid: balances.invalidBalances },
      conservation: Object.fromEntries(ASSETS.map((asset) => [asset, assetReports[asset].invariants.conservation])),
      journalBalanced: { ok: journalHealthy, netFluff: evidence.journalNet },
      idempotency: { ok: replaySafe, duplicateJournalKeys: evidence.duplicateKeys, missingReceipts: evidence.missingReceipts },
      marketFees: { ok: feeHealthy, checks: evidence.feeChecks },
      rewards: { ok: rewardHealthy, status: reward.status },
      economy: { ok: economyHealthy, status: economyState.status },
    },
  };
  return freeze(report);
}

export default createTokenEconomyOverview;
