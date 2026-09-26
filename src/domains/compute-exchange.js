/**
 * compute-exchange.js — provider-neutral maTumbo compute economy.
 *
 * This module deliberately separates three things humans love mixing together:
 * model tokens, money, and reward units. One million model tokens is NOT a
 * stable unit of value across providers or models. Rewards therefore derive
 * from verified provider-reported spend, while raw token counts remain usage
 * evidence.
 *
 * No provider API calls, credentials, wallet actions, token issuance, staking,
 * settlement, or burn happens here. This is a deterministic local accounting
 * and routing model for the Reality Lens.
 */

export const COMPUTE_EXCHANGE_SCHEMA_VERSION = 1;
export const COMPUTE_EXCHANGE_SOURCE = "matumbo-compute-exchange";

export const COMPUTE_EXCHANGE_BOUNDARY =
  "Local economic rehearsal only. Provider links are external, pricing must come from a connected adapter or receipt, " +
  "and TUMBO-SIM rewards are non-transferable demo accounting. No API key, wallet, custody, staking, settlement, mint, or burn is executed.";

export const COMPUTE_PROVIDERS = Object.freeze([
  Object.freeze({ id: "openai", name: "OpenAI / GPT", chatUrl: "https://chatgpt.com/", executionMode: "external", capabilities: Object.freeze(["chat","reasoning","code","vision"]) }),
  Object.freeze({ id: "anthropic", name: "Anthropic / Claude", chatUrl: "https://claude.ai/", executionMode: "external", capabilities: Object.freeze(["chat","reasoning","code","vision"]) }),
  Object.freeze({ id: "google", name: "Google / Gemini", chatUrl: "https://gemini.google.com/", executionMode: "external", capabilities: Object.freeze(["chat","reasoning","code","vision"]) }),
  Object.freeze({ id: "deepseek", name: "DeepSeek", chatUrl: "https://chat.deepseek.com/", executionMode: "external", capabilities: Object.freeze(["chat","reasoning","code"]) }),
  Object.freeze({ id: "kimi", name: "Kimi", chatUrl: "https://www.kimi.com/en/", executionMode: "external", capabilities: Object.freeze(["chat","reasoning","code","research"]) }),
  Object.freeze({ id: "local", name: "Local / Self-hosted", chatUrl: null, executionMode: "local", capabilities: Object.freeze(["chat","reasoning","code","private"]) }),
]);

export const DEFAULT_REWARD_POLICY = Object.freeze({
  id: "verified-spend-v1",
  usdPerTumboSim: 10,
  minimumVerifiedSpendUsd: 0.01,
  label: "1 TUMBO-SIM per $10 verified provider spend",
});

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function wholeNonNegative(value) {
  return Math.floor(finiteNonNegative(value));
}

function round(value, places = 6) {
  const scale = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function providerById(id) {
  return COMPUTE_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export function normalizeUsageReceipt(input = {}) {
  const provider = providerById(String(input.providerId ?? ""));
  if (!provider) throw new Error("Unknown compute provider");

  const inputTokens = wholeNonNegative(input.inputTokens);
  const outputTokens = wholeNonNegative(input.outputTokens);
  const reportedCostUsd = round(finiteNonNegative(input.reportedCostUsd), 8);
  const verified = input.verified === true;
  const receiptId = String(input.receiptId ?? "").trim();

  if (!receiptId) throw new Error("A receiptId is required");
  if (reportedCostUsd <= 0 && verified) throw new Error("Verified receipts need a positive provider-reported cost");

  return Object.freeze({
    schemaVersion: COMPUTE_EXCHANGE_SCHEMA_VERSION,
    receiptId,
    providerId: provider.id,
    providerName: provider.name,
    model: String(input.model ?? "unspecified").trim().slice(0, 120) || "unspecified",
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    reportedCostUsd,
    verified,
    latencyMs: wholeNonNegative(input.latencyMs),
    source: verified ? "provider-receipt" : "local-demo",
  });
}

export function estimateTumboSimReward(receipt, policy = DEFAULT_REWARD_POLICY) {
  const normalized = normalizeUsageReceipt(receipt);
  const usdPerTumboSim = finiteNonNegative(policy?.usdPerTumboSim, DEFAULT_REWARD_POLICY.usdPerTumboSim);
  const minimum = finiteNonNegative(policy?.minimumVerifiedSpendUsd, DEFAULT_REWARD_POLICY.minimumVerifiedSpendUsd);

  if (!normalized.verified || normalized.reportedCostUsd < minimum || usdPerTumboSim <= 0) {
    return Object.freeze({
      eligible: false,
      tumboSim: 0,
      basisUsd: normalized.reportedCostUsd,
      reason: normalized.verified ? "below-minimum" : "unverified",
    });
  }

  return Object.freeze({
    eligible: true,
    tumboSim: round(normalized.reportedCostUsd / usdPerTumboSim, 6),
    basisUsd: normalized.reportedCostUsd,
    reason: "verified-provider-spend",
  });
}

export function rankProviderQuotes(quotes = [], { priority = "balanced" } = {}) {
  const clean = quotes
    .map((quote) => {
      const provider = providerById(String(quote?.providerId ?? ""));
      if (!provider) return null;
      return Object.freeze({
        providerId: provider.id,
        providerName: provider.name,
        estimatedCostUsd: finiteNonNegative(quote?.estimatedCostUsd, Number.POSITIVE_INFINITY),
        estimatedLatencyMs: finiteNonNegative(quote?.estimatedLatencyMs, Number.POSITIVE_INFINITY),
        meetsCapability: quote?.meetsCapability !== false,
        privacyMode: String(quote?.privacyMode ?? "provider-default"),
      });
    })
    .filter((quote) => quote && quote.meetsCapability && Number.isFinite(quote.estimatedCostUsd));

  if (!clean.length) return Object.freeze([]);

  const maxCost = Math.max(...clean.map((quote) => quote.estimatedCostUsd), 0.000001);
  const finiteLatencies = clean.map((quote) => quote.estimatedLatencyMs).filter(Number.isFinite);
  const maxLatency = Math.max(...finiteLatencies, 1);

  const scored = clean.map((quote) => {
    let score;
    if (priority === "cost") score = quote.estimatedCostUsd;
    else if (priority === "latency") score = quote.estimatedLatencyMs;
    else {
      const costScore = quote.estimatedCostUsd / maxCost;
      const latencyScore = Number.isFinite(quote.estimatedLatencyMs) ? quote.estimatedLatencyMs / maxLatency : 1;
      score = costScore * 0.65 + latencyScore * 0.35;
    }
    return Object.freeze({ ...quote, score: round(score, 8) });
  });

  return Object.freeze(scored.sort((a, b) => a.score - b.score || a.providerId.localeCompare(b.providerId)));
}


export function selectProviderRoute(quotes = [], {
  priority = "balanced",
  maxCostUsd = Number.POSITIVE_INFINITY,
  maxLatencyMs = Number.POSITIVE_INFINITY,
  allowedProviderIds = null,
  requiredCapabilities = [],
  privacy = "provider-default",
} = {}) {
  const allowed = Array.isArray(allowedProviderIds) && allowedProviderIds.length
    ? new Set(allowedProviderIds.map(String))
    : null;
  const required = Array.isArray(requiredCapabilities) ? requiredCapabilities.map(String) : [];
  const costCap = finiteNonNegative(maxCostUsd, Number.POSITIVE_INFINITY);
  const latencyCap = finiteNonNegative(maxLatencyMs, Number.POSITIVE_INFINITY);
  const rejected = [];
  const eligible = [];

  for (const quote of quotes) {
    const provider = providerById(String(quote?.providerId ?? ""));
    if (!provider) {
      rejected.push(Object.freeze({ providerId: String(quote?.providerId ?? "unknown"), reason: "unknown-provider" }));
      continue;
    }
    if (allowed && !allowed.has(provider.id)) {
      rejected.push(Object.freeze({ providerId: provider.id, reason: "provider-not-allowed" }));
      continue;
    }
    if (required.some((capability) => !provider.capabilities.includes(capability))) {
      rejected.push(Object.freeze({ providerId: provider.id, reason: "missing-capability" }));
      continue;
    }
    if (privacy === "local-only" && provider.executionMode !== "local") {
      rejected.push(Object.freeze({ providerId: provider.id, reason: "privacy-local-only" }));
      continue;
    }
    const estimatedCostUsd = finiteNonNegative(quote?.estimatedCostUsd, Number.POSITIVE_INFINITY);
    const estimatedLatencyMs = finiteNonNegative(quote?.estimatedLatencyMs, Number.POSITIVE_INFINITY);
    if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd > costCap) {
      rejected.push(Object.freeze({ providerId: provider.id, reason: "cost-cap" }));
      continue;
    }
    if (Number.isFinite(estimatedLatencyMs) && estimatedLatencyMs > latencyCap) {
      rejected.push(Object.freeze({ providerId: provider.id, reason: "latency-cap" }));
      continue;
    }
    eligible.push({
      ...quote,
      providerId: provider.id,
      meetsCapability: true,
      privacyMode: privacy,
    });
  }

  const candidates = rankProviderQuotes(eligible, { priority });
  return Object.freeze({
    selected: candidates[0] ?? null,
    candidates,
    rejected: Object.freeze(rejected),
    policy: Object.freeze({
      priority,
      maxCostUsd: costCap,
      maxLatencyMs: latencyCap,
      allowedProviderIds: allowed ? Object.freeze([...allowed]) : null,
      requiredCapabilities: Object.freeze([...required]),
      privacy,
    }),
  });
}

export function createComputeExchangeLedger({ rewardPolicy = DEFAULT_REWARD_POLICY } = {}) {
  const receipts = [];
  const ids = new Set();

  function record(input) {
    const receipt = normalizeUsageReceipt(input);
    if (ids.has(receipt.receiptId)) {
      return Object.freeze({ accepted: false, duplicate: true, receipt, reward: estimateTumboSimReward(receipt, rewardPolicy) });
    }
    ids.add(receipt.receiptId);
    receipts.push(receipt);
    const reward = estimateTumboSimReward(receipt, rewardPolicy);
    return Object.freeze({
      accepted: true,
      duplicate: false,
      receipt,
      reward,
      economicLoop: Object.freeze([
        "provider-usage",
        "verified-receipt",
        "paycore-meter",
        "t402-route",
        "reward-accrual",
        "prime-ledger-receipt",
        "reality-lens-projection",
      ]),
    });
  }

  function snapshot() {
    const totals = receipts.reduce((acc, receipt) => {
      acc.calls += 1;
      acc.inputTokens += receipt.inputTokens;
      acc.outputTokens += receipt.outputTokens;
      acc.totalTokens += receipt.totalTokens;
      acc.reportedSpendUsd += receipt.reportedCostUsd;
      if (receipt.verified) acc.verifiedSpendUsd += receipt.reportedCostUsd;
      const reward = estimateTumboSimReward(receipt, rewardPolicy);
      acc.tumboSimReward += reward.tumboSim;
      return acc;
    }, {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reportedSpendUsd: 0,
      verifiedSpendUsd: 0,
      tumboSimReward: 0,
    });

    totals.reportedSpendUsd = round(totals.reportedSpendUsd, 8);
    totals.verifiedSpendUsd = round(totals.verifiedSpendUsd, 8);
    totals.tumboSimReward = round(totals.tumboSimReward, 6);

    const byProvider = COMPUTE_PROVIDERS.map((provider) => {
      const rows = receipts.filter((receipt) => receipt.providerId === provider.id);
      return Object.freeze({
        providerId: provider.id,
        providerName: provider.name,
        calls: rows.length,
        totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
        verifiedSpendUsd: round(rows.filter((row) => row.verified).reduce((sum, row) => sum + row.reportedCostUsd, 0), 8),
      });
    });

    return Object.freeze({
      source: COMPUTE_EXCHANGE_SOURCE,
      schemaVersion: COMPUTE_EXCHANGE_SCHEMA_VERSION,
      rewardPolicy,
      totals: Object.freeze({ ...totals }),
      byProvider: Object.freeze(byProvider),
      receipts: Object.freeze([...receipts]),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      executable: false,
    });
  }

  return Object.freeze({ record, snapshot });
}

export default Object.freeze({
  COMPUTE_EXCHANGE_SCHEMA_VERSION,
  COMPUTE_EXCHANGE_SOURCE,
  COMPUTE_EXCHANGE_BOUNDARY,
  COMPUTE_PROVIDERS,
  DEFAULT_REWARD_POLICY,
  normalizeUsageReceipt,
  estimateTumboSimReward,
  rankProviderQuotes,
  selectProviderRoute,
  createComputeExchangeLedger,
});
