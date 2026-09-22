// token-botpay.js — BotPay: simulated x402-style pay-per-action for bots/agents.
// Part of the TUMBO-SIM ledger core (src/domains).
//
// Models the x402 pattern (request → 402 challenge → pay → 200) as LOCAL calls.
// No HTTP, no stablecoins, no signing, no network. Every payment is a normal
// ledger tip/send, so EchoProof receipts + reversibility rules apply unchanged.
//
// Flow:
//   const ch  = pay.request({ fromBot, service, resource });   // may throw Pay402
//   const r   = pay.pay({ challengeId: ch.challengeId, authToken });        // ledger tip fromBot→payTo, memo=nonce
//   const res = pay.fulfill({ challengeId: ch.challengeId, receiptHash: r.hash }); // 200 {result} | 402 {error}
import { LedgerError, SYS, GATE_SYSTEM, assertSafeInt } from "./token.js?v=20260922-cache2";

export const DEFAULT_PRICING = Object.freeze({
  "cube.spawn":   50,
  "cube.message": 5,
  "cube.render":  20,
  "market.quote": 10,
  "arena.enter":  500,
  "travel.hop":   25,
  "presence.ping": 1,
});
const SPEND_CAP_PER_TICK = 10_000; // fluff, anti-drain per bot per tick

export class Pay402 extends Error {
  constructor(challenge) {
    super(`402 Payment Required: ${challenge.resource} costs ${challenge.priceFluff} fluff`);
    this.name = "Pay402";
    this.code = 402;
    this.challenge = challenge;
  }
}

export class BotPay {
  constructor(ledger, { pricing = DEFAULT_PRICING } = {}) {
    this.ledger = ledger;
    this.pricing = { ...pricing };
    this.wallets = {};    // botId -> { accountId, authToken }
    this.challenges = {}; // challengeId -> challenge
  }

  // NOTE: authToken is a simulation-model capability (who registered the bot),
  // NOT a real-world auth boundary — the whole bot layer is local and unsigned.
  // Bot FUNDING is gated: initialTumbo > 0 requires the system autonomy gate,
  // so registration can never draw from the faucet on its own.
  registerBot(botId, { initialTumbo = 0, gate = null } = {}) {
    if (this.wallets[botId]) throw new LedgerError("BOT_EXISTS", botId);
    const accountId = `b:${botId}`;
    this.ledger.ensureAccount(accountId, "bot", `Bot ${botId}`);
    const authToken = `simtok_${this.ledger._prng.hex(16)}`; // sim-only secret; never logged/hashed
    this.wallets[botId] = { botId, accountId, authToken };
    assertSafeInt(initialTumbo, "initialTumbo");
    if (initialTumbo < 0) throw new LedgerError("BAD_AMOUNT", "initialTumbo >= 0");
    if (initialTumbo > 0) {
      if (gate !== GATE_SYSTEM)
        throw new LedgerError("GATE_DENIED", "bot funding requires the system autonomy gate");
      this.ledger._commitRaw({
        action: "send", actor: SYS.faucet, idem: `bot-fund:${botId}`,
        entries: [
          { account: SYS.faucet, asset: "TUMBO", delta: -initialTumbo * 1000 },
          { account: accountId,  asset: "TUMBO", delta:  initialTumbo * 1000 },
        ],
        meta: { kind: "bot-funding" },
      }, { deferHolds: true, system: true });
    }
    return { botId, accountId }; // authToken returned separately via issueToken
  }
  issueToken(botId) { // in the demo this is the "bot signs in" step; token stays in memory
    const w = this.wallets[botId];
    if (!w) throw new LedgerError("UNKNOWN_BOT", botId);
    return w.authToken;
  }

  // Only the service bot itself (presenting its own authToken) may set that
  // service's price for a resource. Overrides persist in ledger state.
  setPrice({ service, resource, priceFluff, authToken }) {
    const w = this.wallets[service];
    if (!w || w.authToken !== authToken)
      throw new LedgerError("BAD_AUTH", "only the service bot may set its own prices");
    if (!Number.isSafeInteger(priceFluff) || priceFluff < 0) throw new LedgerError("BAD_PRICE", resource);
    this.ledger.s.botPricing[`${service}:${resource}`] = priceFluff;
    return priceFluff;
  }
  priceFor(service, resource) {
    const key = `${service}:${resource}`;
    return (key in this.ledger.s.botPricing) ? this.ledger.s.botPricing[key]
         : (this.pricing[resource] ?? 0);
  }

  // Step 1: ask for a priced resource. Free resources return {free:true};
  // priced ones THROW Pay402 carrying the challenge (mirrors HTTP 402).
  request({ fromBot, service, resource, params = {} }) {
    const w = this.wallets[fromBot];
    if (!w) throw new LedgerError("UNKNOWN_BOT", fromBot);
    const priceFluff = this.priceFor(service, resource);
    if (priceFluff === 0) return { free: true, resource, service, params };
    const challengeId = `ch_${this.ledger._prng.hex(12)}`;
    const nonce = this.ledger._prng.hex(16);
    const ch = {
      challengeId, resource, service, params,
      priceFluff, payTo: `b:${service}`,
      nonce, fromBot,
      expiresTick: this.ledger._now() + 100,
      used: false,
    };
    this.ledger.ensureAccount(ch.payTo, "bot", `Bot ${service}`);
    this.challenges[challengeId] = ch;
    throw new Pay402(ch);
  }

  // Step 2: pay the challenge. One ledger tip, memo = nonce (binds payment↔challenge).
  pay({ challengeId, authToken }) {
    const ch = this.challenges[challengeId];
    if (!ch) throw new LedgerError("UNKNOWN_CHALLENGE", challengeId);
    if (ch.used) throw new LedgerError("NONCE_REUSED", "challenge already paid");
    if (this.ledger._now() > ch.expiresTick) throw new LedgerError("CHALLENGE_EXPIRED", challengeId);
    const w = this.wallets[ch.fromBot];
    if (!w || w.authToken !== authToken) throw new LedgerError("BAD_AUTH", "bot auth failed");
    // anti-drain: rolling per-bot spend cap over the last 10 ticks
    const now = this.ledger._now();
    const spends = this.ledger.s.botSpend[ch.fromBot] || [];
    const recent = spends.filter(s => s.tick > now - 10);
    const total = recent.reduce((a, b) => a + b.amount, 0);
    if (total + ch.priceFluff > SPEND_CAP_PER_TICK)
      throw new LedgerError("SPEND_CAP", "bot spend velocity cap hit (10-tick window)");
    const receipt = this.ledger.tip({
      from: w.accountId, to: ch.payTo, asset: "TUMBO",
      amountFluff: ch.priceFluff,
      idem: `x402:${challengeId}`,
      memo: `x402:${ch.nonce}`,
    });
    this.ledger.s.botSpend[ch.fromBot] = [...recent, { tick: now, amount: ch.priceFluff }];
    ch.used = true;
    ch.paymentTx = receipt.txId;
    return receipt;
  }

  // Step 3: service verifies payment, then serves the resource (200).
  fulfill({ challengeId, receiptHash, handler }) {
    const ch = this.challenges[challengeId];
    if (!ch) throw new LedgerError("UNKNOWN_CHALLENGE", challengeId);
    if (!ch.used || !ch.paymentTx) throw new LedgerError("UNPAID", "402: payment required first");
    if (this.ledger._now() > ch.expiresTick) throw new LedgerError("CHALLENGE_EXPIRED", challengeId);
    const r = this.ledger._receiptFor(ch.paymentTx);
    if (r.hash !== receiptHash) throw new LedgerError("RECEIPT_MISMATCH", "receipt does not match challenge payment");
    const paid = r.entries.find(e => e.account === ch.payTo);
    if (!paid || Number(paid.delta) !== ch.priceFluff)
      throw new LedgerError("UNDERPAID", "settled amount differs from challenge price");
    const memo = r.meta.memo || "";
    if (memo !== `x402:${ch.nonce}`) throw new LedgerError("NONCE_MISMATCH", "payment not bound to this challenge");
    delete this.challenges[challengeId]; // single-use
    return { status: 200, resource: ch.resource, service: ch.service,
             result: handler ? handler(ch) : { ok: true } };
  }
}
