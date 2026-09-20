/**
 * Local simulated exchange + coin registry.
 *
 * This is deliberately NOT a blockchain, wallet, custody layer, payment rail,
 * or real-money exchange. It supplies:
 *   1. a curated catalog of public crypto symbols for UI discovery;
 *   2. a bounded custom-coin registry;
 *   3. deterministic anti-abuse / anti-manipulation rules;
 *   4. order/quote previews only.
 *
 * Nothing in this file signs, settles, transfers, or connects to a chain.
 */

export const SIM_EXCHANGE_SOURCE = "simulated-exchange";
export const CUSTOM_COIN_LIMIT = 128;
export const CUSTOM_COINS_PER_CREATOR_LIMIT = 8;
export const CREATE_WINDOW_MS = 10 * 60 * 1000;
export const CREATE_MAX_IN_WINDOW = 3;
export const CREATE_COOLDOWN_MS = 60 * 1000;
export const ORDER_WINDOW_MS = 60 * 1000;
export const ORDER_MAX_IN_WINDOW = 30;
export const MAX_OPEN_ORDERS_PER_ACTOR = 20;
export const MAX_ORDER_NOTIONAL = 100_000;
export const PRICE_BAND_BPS = 1_000;
export const MAX_SUSPICION_SCORE = 100;

export const DEFAULT_CRYPTO_ASSETS = Object.freeze([
  { symbol: "BTC", name: "Bitcoin", category: "major" },
  { symbol: "ETH", name: "Ethereum", category: "major" },
  { symbol: "USDT", name: "Tether", category: "stablecoin" },
  { symbol: "BNB", name: "BNB", category: "major" },
  { symbol: "XRP", name: "XRP", category: "major" },
  { symbol: "USDC", name: "USD Coin", category: "stablecoin" },
  { symbol: "SOL", name: "Solana", category: "major" },
  { symbol: "TRX", name: "TRON", category: "major" },
  { symbol: "ZEC", name: "Zcash", category: "privacy" },
  { symbol: "HYPE", name: "Hyperliquid", category: "exchange" },
  { symbol: "DOGE", name: "Dogecoin", category: "meme" },
  { symbol: "XMR", name: "Monero", category: "privacy" },
  { symbol: "LINK", name: "Chainlink", category: "infrastructure" },
  { symbol: "ADA", name: "Cardano", category: "major" },
  { symbol: "XLM", name: "Stellar", category: "payments" },
  { symbol: "AVAX", name: "Avalanche", category: "major" },
  { symbol: "SUI", name: "Sui", category: "major" },
  { symbol: "NEAR", name: "NEAR Protocol", category: "major" },
  { symbol: "DOT", name: "Polkadot", category: "infrastructure" },
  { symbol: "SHIB", name: "Shiba Inu", category: "meme" },
].map((asset) => Object.freeze(asset)));

export const RESERVED_SYMBOLS = new Set([
  ...DEFAULT_CRYPTO_ASSETS.map((asset) => asset.symbol),
  "TUMBO",
  "TMBO",
  "USDT",
  "USDC",
  "USD",
  "BTC",
  "WBTC",
  "ETH",
  "ETC",
  "XRP",
  "SOL",
  "BNB",
  "DOGE",
  "ADA",
  "TRX",
  "XMR",
  "XLM",
  "LINK",
]);

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nowMs(now) {
  const value = typeof now === "function" ? now() : now;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

function cleanSymbol(value) {
  const symbol = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,7}$/.test(symbol)) {
    throw new TypeError("symbol must be 2-8 ASCII letters/digits");
  }
  return symbol;
}

function cleanName(value) {
  const name = String(value ?? "").trim();
  if (name.length < 2 || name.length > 48) {
    throw new TypeError("name must be 2-48 characters");
  }
  return name;
}

function cleanCreator(value) {
  const creator = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.:-]{0,63}$/.test(creator)) {
    throw new TypeError("creatorId is malformed");
  }
  return creator;
}

function fingerprint(parts) {
  let hash = 2166136261;
  const input = parts.join("|");
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function prune(list, cutoff) {
  while (list.length && list[0] < cutoff) list.shift();
}

function freezeCopy(value) {
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

class AbuseGuard {
  constructor({ now = () => Date.now() } = {}) {
    this._now = now;
    this._creates = new Map();
    this._orders = new Map();
    this._openOrders = new Map();
    this._scores = new Map();
    this._strikes = new Map();
  }

  _scoreFor(actor) {
    return this._scores.get(actor) ?? 0;
  }

  _setScore(actor, next) {
    const score = Math.max(0, Math.min(MAX_SUSPICION_SCORE, next));
    this._scores.set(actor, score);
    return score;
  }

  observe(actor, kind, severity = 0) {
    const id = cleanCreator(actor);
    const current = this._scoreFor(id);
    const decay = kind === "clean" ? -1 : 0;
    const score = this._setScore(id, current + decay + Math.max(0, severity));
    if (severity > 0) {
      this._strikes.set(id, (this._strikes.get(id) ?? 0) + 1);
    }
    return score;
  }

  checkCreate(actor) {
    const id = cleanCreator(actor);
    const now = nowMs(this._now);
    const rows = this._creates.get(id) ?? [];
    prune(rows, now - CREATE_WINDOW_MS);
    this._creates.set(id, rows);

    const cooldownUntil = rows.length
      ? rows[rows.length - 1] + CREATE_COOLDOWN_MS
      : 0;
    const score = this._scoreFor(id);

    if (score >= MAX_SUSPICION_SCORE) {
      return { allowed: false, code: "abuse-score-block", retryAfterMs: 60_000, score };
    }
    if (now < cooldownUntil) {
      return {
        allowed: false,
        code: "creator-cooldown",
        retryAfterMs: cooldownUntil - now,
        score,
      };
    }
    if (rows.length >= CREATE_MAX_IN_WINDOW) {
      return {
        allowed: false,
        code: "create-rate-limit",
        retryAfterMs: rows[0] + CREATE_WINDOW_MS - now,
        score,
      };
    }

    return { allowed: true, code: "ok", retryAfterMs: 0, score };
  }

  recordCreate(actor) {
    const id = cleanCreator(actor);
    const now = nowMs(this._now);
    const rows = this._creates.get(id) ?? [];
    rows.push(now);
    prune(rows, now - CREATE_WINDOW_MS);
    this._creates.set(id, rows);
    this.observe(id, "clean", 0);
  }

  checkOrder(actor, {
    notional = 0,
    openOrders = 0,
    now = this._now,
  } = {}) {
    const id = cleanCreator(actor);
    const time = nowMs(now);
    const rows = this._orders.get(id) ?? [];
    prune(rows, time - ORDER_WINDOW_MS);
    this._orders.set(id, rows);

    const score = this._scoreFor(id);
    const amount = Number(notional);

    if (score >= MAX_SUSPICION_SCORE) {
      return { allowed: false, code: "abuse-score-block", retryAfterMs: 60_000, score };
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_ORDER_NOTIONAL) {
      this.observe(id, "oversized-order", 15);
      return { allowed: false, code: "order-notional-limit", retryAfterMs: 0, score: this._scoreFor(id) };
    }
    if (Number(openOrders) >= MAX_OPEN_ORDERS_PER_ACTOR) {
      this.observe(id, "open-order-burst", 8);
      return { allowed: false, code: "open-order-limit", retryAfterMs: 0, score: this._scoreFor(id) };
    }
    if (rows.length >= ORDER_MAX_IN_WINDOW) {
      this.observe(id, "order-burst", 10);
      return {
        allowed: false,
        code: "order-rate-limit",
        retryAfterMs: rows[0] + ORDER_WINDOW_MS - time,
        score: this._scoreFor(id),
      };
    }
    return { allowed: true, code: "ok", retryAfterMs: 0, score };
  }

  recordOrder(actor) {
    const id = cleanCreator(actor);
    const now = nowMs(this._now);
    const rows = this._orders.get(id) ?? [];
    rows.push(now);
    prune(rows, now - ORDER_WINDOW_MS);
    this._orders.set(id, rows);
    this.observe(id, "clean", 0);
  }

  setOpenOrders(actor, value) {
    const id = cleanCreator(actor);
    const open = Math.max(0, Math.min(MAX_OPEN_ORDERS_PER_ACTOR, Math.floor(Number(value) || 0)));
    this._openOrders.set(id, open);
    return open;
  }

  riskSnapshot(actor = "anonymous") {
    const id = cleanCreator(actor);
    return Object.freeze({
      actor: id,
      status: this._scoreFor(id) >= MAX_SUSPICION_SCORE ? "blocked" : "armed",
      score: this._scoreFor(id),
      strikes: this._strikes.get(id) ?? 0,
      recentCreates: (this._creates.get(id) ?? []).length,
      recentOrders: (this._orders.get(id) ?? []).length,
      openOrders: this._openOrders.get(id) ?? 0,
      limits: Object.freeze({
        createsPerWindow: CREATE_MAX_IN_WINDOW,
        createWindowMs: CREATE_WINDOW_MS,
        createCooldownMs: CREATE_COOLDOWN_MS,
        ordersPerWindow: ORDER_MAX_IN_WINDOW,
        maxOpenOrders: MAX_OPEN_ORDERS_PER_ACTOR,
        maxOrderNotional: MAX_ORDER_NOTIONAL,
      }),
    });
  }
}

export class SimulatedCoinRegistry {
  constructor({
    maxCustomCoins = CUSTOM_COIN_LIMIT,
    perCreatorLimit = CUSTOM_COINS_PER_CREATOR_LIMIT,
    now = () => Date.now(),
    guard = null,
  } = {}) {
    this.maxCustomCoins = Math.max(1, Math.min(1_024, Math.floor(maxCustomCoins)));
    this.perCreatorLimit = Math.max(1, Math.min(64, Math.floor(perCreatorLimit)));
    this._now = now;
    this._guard = guard ?? new AbuseGuard({ now });
    this._coins = new Map();
    this._creatorCounts = new Map();
    this._fingerprints = new Set();
  }

  create({ creatorId, symbol, name, description = "", supply = 1_000_000 } = {}) {
    const creator = cleanCreator(creatorId);
    const coinSymbol = cleanSymbol(symbol);
    const coinName = cleanName(name);
    const note = String(description ?? "").trim().slice(0, 180);
    const amount = Number(supply);

    if (this._coins.size >= this.maxCustomCoins) {
      throw new Error("custom-coin-cap-reached");
    }
    if (RESERVED_SYMBOLS.has(coinSymbol)) {
      throw new Error("reserved-symbol");
    }

    const creatorCount = this._creatorCounts.get(creator) ?? 0;
    if (creatorCount >= this.perCreatorLimit) {
      throw new Error("creator-coin-limit");
    }

    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000_000) {
      throw new TypeError("supply must be a safe integer from 1 to 1,000,000,000");
    }

    const gate = this._guard.checkCreate(creator);
    if (!gate.allowed) {
      const error = new Error(gate.code);
      error.code = gate.code;
      error.retryAfterMs = gate.retryAfterMs;
      error.riskScore = gate.score;
      throw error;
    }

    const key = fingerprint([creator, coinSymbol, coinName.toLowerCase(), note.toLowerCase()]);
    if (this._fingerprints.has(key)) {
      this._guard.observe(creator, "duplicate-create", 30);
      throw new Error("duplicate-coin-definition");
    }

    if ([...this._coins.values()].some((coin) => coin.symbol === coinSymbol)) {
      this._guard.observe(creator, "symbol-collision", 20);
      throw new Error("symbol-already-used");
    }

    const id = "simcoin_" + fingerprint([creator, coinSymbol, coinName, String(this._now())]);
    const coin = Object.freeze({
      id,
      symbol: coinSymbol,
      name: coinName,
      description: note,
      creatorId: creator,
      supply: amount,
      createdAt: new Date(nowMs(this._now)).toISOString(),
      status: "simulated",
      localOnly: true,
      simulation: true,
      executable: false,
    });

    this._coins.set(id, coin);
    this._creatorCounts.set(creator, creatorCount + 1);
    this._fingerprints.add(key);
    this._guard.recordCreate(creator);
    return coin;
  }

  getCoinRegistrySnapshot() {
    return Object.freeze({
      customCount: this._coins.size,
      maxCustomCoins: this.maxCustomCoins,
      remaining: Math.max(0, this.maxCustomCoins - this._coins.size),
      perCreatorLimit: this.perCreatorLimit,
      coins: freezeCopy([...this._coins.values()]),
      simulation: true,
      localOnly: true,
    });
  }

  getCoin(symbol) {
    const key = cleanSymbol(symbol);
    return [...this._coins.values()].find((coin) => coin.symbol === key) ?? null;
  }

  getGuardSnapshot(actor = "anonymous") {
    return this._guard.riskSnapshot(actor);
  }
}

export class SimulatedExchange {
  constructor({
    registry = new SimulatedCoinRegistry(),
    now = () => Date.now(),
  } = {}) {
    this.registry = registry;
    this.guard = registry._guard;
    this._now = now;
    this._orders = new Map();
    this._nextOrder = 0;
  }

  getCoinRegistrySnapshot() {
    return this.registry.getCoinRegistrySnapshot();
  }

  getGuardSnapshot(actor = "anonymous") {
    return this.guard.riskSnapshot(actor);
  }

  createCoin(input) {
    return this.registry.create(input);
  }

  previewOrder({
    actor = "anonymous",
    symbol,
    side = "buy",
    units,
    referencePrice,
    openOrders = 0,
    makerActor = null,
    currentPrice = referencePrice,
  } = {}) {
    const trader = cleanCreator(actor);
    const asset = cleanSymbol(symbol);
    const direction = String(side).toLowerCase();
    if (direction !== "buy" && direction !== "sell") {
      throw new TypeError("side must be buy or sell");
    }

    if (makerActor && cleanCreator(makerActor) === trader) {
      throw new Error("self-trade-blocked");
    }

    const qty = Number(units);
    const price = Number(referencePrice);
    const mark = Number(currentPrice);
    if (!(qty > 0) || !Number.isFinite(qty) || !Number.isFinite(price) || price <= 0) {
      throw new TypeError("units and referencePrice must be positive finite numbers");
    }

    const notional = qty * price;
    const gate = this.guard.checkOrder(trader, { notional, openOrders, now: this._now });
    if (!gate.allowed) {
      const error = new Error(gate.code);
      error.code = gate.code;
      error.retryAfterMs = gate.retryAfterMs;
      error.riskScore = gate.score;
      throw error;
    }

    if (Number.isFinite(mark) && mark > 0) {
      const deviationBps = Math.abs(price - mark) / mark * 10_000;
      if (deviationBps > PRICE_BAND_BPS) {
        this.guard.observe(trader, "price-outside-band", 15);
        throw new Error("price-band-block");
      }
    }

    const order = Object.freeze({
      id: "simorder_" + (++this._nextOrder),
      actor: trader,
      symbol: asset,
      side: direction,
      units: Number(qty.toFixed(8)),
      referencePrice: Number(price.toFixed(8)),
      notional: Number(notional.toFixed(8)),
      status: "preview-only",
      createdAt: new Date(nowMs(this._now)).toISOString(),
      localOnly: true,
      simulation: true,
      settled: false,
      executable: false,
    });

    this._orders.set(order.id, order);
    this.guard.recordOrder(trader);
    return order;
  }

  cancelPreview(orderId, actor = "anonymous") {
    const order = this._orders.get(String(orderId));
    if (!order) throw new Error("unknown-order");
    const trader = cleanCreator(actor);
    if (order.actor !== trader) throw new Error("not-order-owner");
    this._orders.delete(order.id);
    return Object.freeze({ ...order, status: "cancelled", executable: false });
  }
}

export function createSimulatedExchange(options = {}) {
  return new SimulatedExchange(options);
}

export default {
  DEFAULT_CRYPTO_ASSETS,
  SimulatedCoinRegistry,
  SimulatedExchange,
  createSimulatedExchange,
};
