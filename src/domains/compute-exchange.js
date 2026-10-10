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

import {
  toComputeUnits,
  fromComputeUnits
} from "./compute-account.js?v=20261003-skin360";
import {
  sealEconomicMetadata,
  stableEconomicString,
  economicChecksum
} from "./economic-timeline.js?v=20261003-skin360";
export const COMPUTE_EXCHANGE_SCHEMA_VERSION = 2;
export const COMPUTE_EXCHANGE_SOURCE = "matumbo-compute-exchange";

export const COMPUTE_EXCHANGE_BOUNDARY =
  "Local economic rehearsal only. Provider links are external, pricing must come from a connected adapter or receipt, " +
  "and TUMBO-SIM rewards are non-transferable demo accounting. No API key, wallet, custody, staking, settlement, mint, or burn is executed.";

export const COMPUTE_PROVIDERS = Object.freeze([
  Object.freeze({
    id: "openai",
    name: "OpenAI / GPT",
    chatUrl: "https://chatgpt.com/",
    executionMode: "external",
    capabilities: Object.freeze(["chat", "reasoning", "code", "vision"])
  }),
  Object.freeze({
    id: "anthropic",
    name: "Anthropic / Claude",
    chatUrl: "https://claude.ai/",
    executionMode: "external",
    capabilities: Object.freeze(["chat", "reasoning", "code", "vision"])
  }),
  Object.freeze({
    id: "google",
    name: "Google / Gemini",
    chatUrl: "https://gemini.google.com/",
    executionMode: "external",
    capabilities: Object.freeze(["chat", "reasoning", "code", "vision"])
  }),
  Object.freeze({
    id: "deepseek",
    name: "DeepSeek",
    chatUrl: "https://chat.deepseek.com/",
    executionMode: "external",
    capabilities: Object.freeze(["chat", "reasoning", "code"])
  }),
  Object.freeze({
    id: "kimi",
    name: "Kimi",
    chatUrl: "https://www.kimi.com/en/",
    executionMode: "external",
    capabilities: Object.freeze(["chat", "reasoning", "code", "research"])
  }),
  Object.freeze({
    id: "nvidia",
    name: "NVIDIA / NIM",
    chatUrl: "https://build.nvidia.com/",
    executionMode: "external",
    capabilities: Object.freeze(["chat", "reasoning", "code", "vision"]),
    apiBaseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyEnv: "NVIDIA_API_KEY",
    freeTier: true,
    models: Object.freeze(["deepseek-ai/deepseek-v4-flash", "z-ai/glm-5.3", "z-ai/glm-5.3-flash", "moonshotai/kimi-k3"]),
    rosterNote: "Free developer key, no credit card; hosted model roster rotates — adapter should refresh via GET /v1/models"
  }),
  Object.freeze({
    id: "local",
    name: "Local / Self-hosted",
    chatUrl: null,
    executionMode: "local",
    capabilities: Object.freeze(["chat", "reasoning", "code", "private"])
  }),
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
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Usage counts and latency must be non-negative safe integers");
  return number;
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
  const reportedCostUsd = fromComputeUnits(toComputeUnits(input.reportedCostUsd ?? 0, "Reported cost"));
  const verified = input.verified === true;
  const receiptId = String(input.receiptId ?? "").trim();

  if (!receiptId || receiptId.length > 160) throw new Error("A receiptId is required and must fit 160 characters");
  if (!Number.isSafeInteger(inputTokens + outputTokens)) throw new Error("Total tokens exceed the safe integer range");
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
    // A boolean entered by a caller is a local rehearsal declaration, never
    // authenticated provider billing. Live usage without cost remains unverified.
    source: "local-demo-receipt",
    verificationBasis: verified ? "declared-local-rehearsal" : "unverified",
    billingVerified: false,
    simulation: true,
    jobId: String(input.jobId ?? "").slice(0, 160),
    quoteId: String(input.quoteId ?? "").slice(0, 160),
  });
}

export function estimateTumboSimReward(receipt, policy = DEFAULT_REWARD_POLICY) {
  const normalized = normalizeUsageReceipt(receipt);
  const rewardBasisUnits = toComputeUnits(policy?.usdPerTumboSim ?? DEFAULT_REWARD_POLICY.usdPerTumboSim, "Reward normalization basis");
  const minimumUnits = toComputeUnits(policy?.minimumVerifiedSpendUsd ?? DEFAULT_REWARD_POLICY.minimumVerifiedSpendUsd, "Reward minimum");
  const spendUnits = toComputeUnits(normalized.reportedCostUsd);

  if (!normalized.verified || spendUnits < minimumUnits || rewardBasisUnits === 0) {
    return Object.freeze({
      eligible: false,
      tumboSim: 0,
      basisUsd: normalized.reportedCostUsd,
      reason: normalized.verified ? "below-minimum" : "unverified",
    });
  }

  const rewardUnits = BigInt(spendUnits) * 1_000_000n / BigInt(rewardBasisUnits);
  if (rewardUnits > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Reward entitlement exceeds safe units");
  return Object.freeze({
    eligible: true,
    tumboSim: Number(rewardUnits) / 1_000_000,
    basisUsd: normalized.reportedCostUsd,
    reason: "declared-local-rehearsal-spend",
  });
}

export function rankProviderQuotes(quotes = [], {
  priority = "balanced"
} = {}) {
  const clean = quotes
    .map((quote) => {
      const provider = providerById(String(quote?.providerId ?? ""));
      if (!provider) return null;
      return Object.freeze({
        quoteId: String(quote?.quoteId ?? "").slice(0, 160),
        model: String(quote?.model ?? "unspecified").slice(0, 120),
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
    return Object.freeze({
      ...quote,
      score: round(score, 8)
    });
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
  const allowed = Array.isArray(allowedProviderIds) && allowedProviderIds.length ?
    new Set(allowedProviderIds.map(String)) :
    null;
  const required = Array.isArray(requiredCapabilities) ? requiredCapabilities.map(String) : [];
  const costCap = finiteNonNegative(maxCostUsd, Number.POSITIVE_INFINITY);
  const latencyCap = finiteNonNegative(maxLatencyMs, Number.POSITIVE_INFINITY);
  const rejected = [];
  const eligible = [];

  for (const quote of quotes) {
    const provider = providerById(String(quote?.providerId ?? ""));
    if (!provider) {
      rejected.push(Object.freeze({
        providerId: String(quote?.providerId ?? "unknown"),
        reason: "unknown-provider"
      }));
      continue;
    }
    if (allowed && !allowed.has(provider.id)) {
      rejected.push(Object.freeze({
        providerId: provider.id,
        reason: "provider-not-allowed"
      }));
      continue;
    }
    if (required.some((capability) => !provider.capabilities.includes(capability))) {
      rejected.push(Object.freeze({
        providerId: provider.id,
        reason: "missing-capability"
      }));
      continue;
    }
    if (quote?.meetsCapability === false) {
      rejected.push(Object.freeze({
        providerId: provider.id,
        reason: "missing-capability"
      }));
      continue;
    }
    if (privacy === "local-only" && provider.executionMode !== "local") {
      rejected.push(Object.freeze({
        providerId: provider.id,
        reason: "privacy-local-only"
      }));
      continue;
    }
    const estimatedCostUsd = finiteNonNegative(quote?.estimatedCostUsd, Number.POSITIVE_INFINITY);
    const estimatedLatencyMs = finiteNonNegative(quote?.estimatedLatencyMs, Number.POSITIVE_INFINITY);
    if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd > costCap) {
      rejected.push(Object.freeze({
        providerId: provider.id,
        reason: "cost-cap"
      }));
      continue;
    }
    if ((Number.isFinite(latencyCap) && !Number.isFinite(estimatedLatencyMs)) || estimatedLatencyMs > latencyCap) {
      rejected.push(Object.freeze({
        providerId: provider.id,
        reason: "latency-cap"
      }));
      continue;
    }
    eligible.push({
      ...quote,
      providerId: provider.id,
      meetsCapability: true,
      privacyMode: privacy,
    });
  }

  const candidates = rankProviderQuotes(eligible, {
    priority
  });
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

export function createComputeExchangeLedger({
  rewardPolicy = DEFAULT_REWARD_POLICY,
  maxReceipts = 10000
} = {}) {
  if (!Number.isSafeInteger(maxReceipts) || maxReceipts < 1 || maxReceipts > 100000) throw new Error("Invalid compute receipt limit");
  rewardPolicy = sealEconomicMetadata(rewardPolicy);
  let receipts = [];
  let ids = new Map();

  function preflightReceipt(input) {
    const receipt = normalizeUsageReceipt(input);
    const original = ids.get(receipt.receiptId);
    if (original) {
      if (stableEconomicString(original.receipt) !== stableEconomicString(receipt)) throw new Error("IDEM_MISMATCH: receipt ID belongs to another usage record");
      return Object.freeze({
        accepted: false,
        duplicate: true,
        reason: "duplicate-receipt",
        receipt: original.receipt,
        reward: original.reward
      });
    }
    if (receipts.length >= maxReceipts) throw new Error("Compute receipt history is full; export before continuing");
    const tokenTotal = receipts.reduce((sum, row) => sum + row.totalTokens, receipt.totalTokens);
    const costTotal = receipts.reduce((sum, row) => sum + toComputeUnits(row.reportedCostUsd), toComputeUnits(receipt.reportedCostUsd));
    if (!Number.isSafeInteger(tokenTotal) || !Number.isSafeInteger(costTotal)) throw new Error("Compute usage totals exceed safe units");
    return Object.freeze({
      accepted: true,
      duplicate: false,
      reason: "ready-local-demo",
      receipt,
      reward: estimateTumboSimReward(receipt, rewardPolicy)
    });
  }

  function record(input) {
    const ready = preflightReceipt(input);
    if (!ready.accepted) return ready;
    const {
      receipt,
      reward
    } = ready;
    ids.set(receipt.receiptId, Object.freeze({
      receipt,
      reward
    }));
    receipts.push(receipt);
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

    totals.reportedSpendUsd = fromComputeUnits(receipts.reduce((sum, row) => sum + toComputeUnits(row.reportedCostUsd), 0));
    totals.verifiedSpendUsd = fromComputeUnits(receipts.filter(row => row.verified).reduce((sum, row) => sum + toComputeUnits(row.reportedCostUsd), 0));
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
      totals: Object.freeze({
        ...totals
      }),
      byProvider: Object.freeze(byProvider),
      receipts: Object.freeze([...receipts]),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      executable: false,
    });
  }

  function exportState() {
    const body = {
      schemaVersion: COMPUTE_EXCHANGE_SCHEMA_VERSION,
      source: COMPUTE_EXCHANGE_SOURCE,
      rewardPolicy,
      receipts
    };
    return sealEconomicMetadata({
      ...body,
      checksum: economicChecksum(stableEconomicString(body)),
      cryptographicProof: false
    });
  }

  function importState(input) {
    const data = sealEconomicMetadata(input);
    if (data.schemaVersion !== COMPUTE_EXCHANGE_SCHEMA_VERSION || data.source !== COMPUTE_EXCHANGE_SOURCE || !Array.isArray(data.receipts) || data.receipts.length > maxReceipts || stableEconomicString(data.rewardPolicy) !== stableEconomicString(rewardPolicy)) throw new Error("Invalid compute exchange state");
    const body = {
      schemaVersion: data.schemaVersion,
      source: data.source,
      rewardPolicy: data.rewardPolicy,
      receipts: data.receipts
    };
    if (economicChecksum(stableEconomicString(body)) !== data.checksum) throw new Error("Compute exchange checksum is invalid");
    const next = [],
      nextIds = new Map();
    for (const raw of data.receipts) {
      const receipt = normalizeUsageReceipt(raw);
      if (stableEconomicString(receipt) !== stableEconomicString(raw) || nextIds.has(receipt.receiptId)) throw new Error("Invalid or duplicate imported receipt");
      next.push(receipt);
      nextIds.set(receipt.receiptId, Object.freeze({
        receipt,
        reward: estimateTumboSimReward(receipt, rewardPolicy)
      }));
    }
    const totalTokens = next.reduce((sum, row) => sum + row.totalTokens, 0);
    const totalCosts = next.reduce((sum, row) => sum + toComputeUnits(row.reportedCostUsd), 0);
    if (!Number.isSafeInteger(totalTokens) || !Number.isSafeInteger(totalCosts)) throw new Error("Imported compute totals exceed safe units");
    receipts = next;
    ids = nextIds;
    return snapshot();
  }
  return Object.freeze({
    record,
    preflightReceipt,
    preflightRecord: preflightReceipt,
    snapshot,
    exportState,
    importState
  });
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
