/**
 * Quark Wallet — the one-coin financial core (ledger-core).
 *
 * Ported from TumboAgent PR #6 (`matumbo/realms/wallet.py`, tag
 * archive/pr-6-claude-matumbo-master-spec-mz1vv4).
 *
 * A SIMULATED-custody TUMBO wallet service (DEMO only): hold, send,
 * receive, request, and escrow-lock TUMBO, with a proper balance model,
 * permission checks, atomic double-entry settlement, and an EchoProof
 * receipt for every balance change.
 *
 * Balance model. Each user has three ledger sub-accounts:
 *
 *     available   spendable now
 *     reserved    held for open orders (reserved, not spendable)
 *     escrow      locked in an escrow agreement
 *
 *     total = available + reserved + escrow
 *
 * TUMBO is issued from a single system issuance account (allowNegative) so
 * the whole ledger always sums to zero — issuance is the negative mirror
 * of every coin in circulation.
 *
 * Simulation-only: every balance is simulated TUMBO points. There is no
 * real custody, no real chain, no settlement. "Custody" below always means
 * simulated custody inside this demo ledger.
 */

import { randomUUID } from "node:crypto";
import { EchoProof } from "./echoproof.js";
import { Ledger, Posting } from "./ledger.js";
import { Money, TUMBO } from "./money.js";
import { PermissionDenied, PolicyEngine, Principal, Role } from "./permissions.js";

export const REALM = "quark_wallet";
export const ISSUANCE_ACCOUNT = "system:issuance";
const BUCKETS = ["available", "reserved", "escrow"];

/**
 * Sub-account key. TUMBO keeps its original unprefixed key (so any engine
 * hardcoding `wallet:{user}:available` keeps working untouched); every
 * other asset gets its own namespaced sub-account — this is what makes
 * the wallet multi-asset.
 */
export function subAccount(userId, bucket, currency = TUMBO) {
  if (currency.code === TUMBO.code) return `wallet:${userId}:${bucket}`;
  return `wallet:${userId}:${currency.code}:${bucket}`;
}

/** Immutable three-bucket balance snapshot. */
export class WalletBalance {
  constructor(available, reserved, escrow) {
    this.available = available;
    this.reserved = reserved;
    this.escrow = escrow;
    Object.freeze(this);
  }

  get total() {
    return this.available.add(this.reserved).add(this.escrow);
  }

  toDict() {
    return {
      available: this.available.toString(),
      reserved: this.reserved.toString(),
      escrow: this.escrow.toString(),
      total: this.total.toString(),
    };
  }
}

/** An open payment request: `fromUser` is asked to pay `toUser`. Immutable. */
export class PaymentRequest {
  constructor({ requestId, fromUser, toUser, amount, memo, status = "open" }) {
    this.requestId = requestId;
    this.fromUser = fromUser;
    this.toUser = toUser;
    this.amount = amount;
    this.memo = memo;
    this.status = status;
    Object.freeze(this);
  }
}

function requirePrincipal(principal) {
  if (!(principal instanceof Principal)) {
    throw new TypeError("expected a Principal");
  }
}

/**
 * Simulated-custody wallet service. All mutation goes through the ledger,
 * so every operation inherits atomicity, idempotency, and the no-negative
 * invariant for free.
 */
export class QuarkWallet {
  /**
   * @param {Ledger} ledger
   * @param {EchoProof} echoproof
   * @param {PolicyEngine} [policy]
   */
  constructor(ledger, echoproof, policy = null) {
    if (!(ledger instanceof Ledger)) throw new TypeError("ledger must be a Ledger");
    if (!(echoproof instanceof EchoProof)) {
      throw new TypeError("echoproof must be an EchoProof");
    }
    this.ledger = ledger;
    this.echoproof = echoproof;
    this.policy = policy ?? new PolicyEngine();
    this.ledger.openAccount(ISSUANCE_ACCOUNT, TUMBO, true);
    this._requests = new Map();
  }

  // ---- accounts -----------------------------------------------------
  openWallet(userId, currency = TUMBO) {
    for (const bucket of BUCKETS) {
      this.ledger.openAccount(subAccount(userId, bucket, currency), currency);
    }
  }

  balance(userId, currency = TUMBO) {
    this.openWallet(userId, currency);
    return new WalletBalance(
      this.ledger.balance(subAccount(userId, "available", currency)),
      this.ledger.balance(subAccount(userId, "reserved", currency)),
      this.ledger.balance(subAccount(userId, "escrow", currency))
    );
  }

  /** Balances across many assets in one call — the multi-asset view. */
  multiBalance(userId, currencies) {
    const out = {};
    for (const c of currencies) out[c.code] = this.balance(userId, c);
    return out;
  }

  _receipt(principal, action, summary, before, after, payload) {
    return this.echoproof.issue({
      actorId: principal.principalId,
      realm: REALM,
      reference: payload.idempotencyKey ?? "-",
      action,
      summary,
      beforeState: before,
      afterState: after,
      payload,
    });
  }

  _issuanceAccount(currency) {
    return currency.code === TUMBO.code
      ? ISSUANCE_ACCOUNT
      : `${ISSUANCE_ACCOUNT}:${currency.code}`;
  }

  // ---- demo funding (DEMO mode only) --------------------------------
  /**
   * Issue a DEMO asset to a user from that asset's issuance account.
   * In production this door is closed; here it is how test wallets are
   * funded — for TUMBO from the native issuance account, for any other
   * asset from its own demo issuance mirror, so every asset's ledger
   * independently sums to zero.
   */
  demoGrant(principal, amount, { idempotencyKey = null } = {}) {
    requirePrincipal(principal);
    if (!(amount instanceof Money) || !amount.isPositive) {
      throw new TypeError("demoGrant amount must be positive Money");
    }
    const currency = amount.currency;
    const key = idempotencyKey ?? `grant:${randomUUID()}`;
    const issuance = this._issuanceAccount(currency);
    this.ledger.openAccount(issuance, currency, true);
    this.openWallet(principal.principalId, currency);
    const before = this.balance(principal.principalId, currency).toDict();
    this.ledger.post(
      [
        new Posting(issuance, amount.neg()),
        new Posting(subAccount(principal.principalId, "available", currency), amount),
      ],
      {
        realm: REALM,
        actorId: "system",
        idempotencyKey: key,
        eventType: "wallet.demo_grant",
        memo: "DEMO issuance",
      }
    );
    const after = this.balance(principal.principalId, currency).toDict();
    return this._receipt(principal, "demo_grant", `Granted ${amount} (DEMO)`, before, after, {
      amount: amount.toString(),
      idempotencyKey: key,
    });
  }

  // ---- transfers ----------------------------------------------------
  /**
   * Move `amount` (any held asset) from sender.available to
   * recipient.available.
   */
  send(sender, toUser, amount, { memo = "", idempotencyKey = null } = {}) {
    requirePrincipal(sender);
    this.policy.require(sender, "wallet.send");
    if (!(amount instanceof Money) || !amount.isPositive) {
      throw new TypeError("send amount must be positive Money");
    }
    const currency = amount.currency;
    const key = idempotencyKey ?? `send:${randomUUID()}`;
    this.openWallet(sender.principalId, currency);
    this.openWallet(toUser, currency);
    const before = {
      sender: this.balance(sender.principalId, currency).toDict(),
      recipient: this.balance(toUser, currency).toDict(),
    };
    this.ledger.post(
      [
        new Posting(subAccount(sender.principalId, "available", currency), amount.neg()),
        new Posting(subAccount(toUser, "available", currency), amount),
      ],
      { realm: REALM, actorId: sender.principalId, idempotencyKey: key, eventType: "wallet.send", memo }
    );
    const after = {
      sender: this.balance(sender.principalId, currency).toDict(),
      recipient: this.balance(toUser, currency).toDict(),
    };
    return this._receipt(sender, "send", `Sent ${amount} to ${toUser}`, before, after, {
      to: toUser,
      amount: amount.toString(),
      memo,
      idempotencyKey: key,
    });
  }

  // ---- payment requests ---------------------------------------------
  requestPayment(requester, fromUser, amount, memo = "") {
    requirePrincipal(requester);
    if (!(amount instanceof Money) || !amount.isPositive) {
      throw new TypeError("request amount must be positive Money");
    }
    const req = new PaymentRequest({
      requestId: `req:${randomUUID()}`,
      fromUser,
      toUser: requester.principalId,
      amount,
      memo,
      status: "open",
    });
    this._requests.set(req.requestId, req);
    return req;
  }

  payRequest(payer, requestId) {
    requirePrincipal(payer);
    const req = this._requests.get(requestId);
    if (!req) throw new Error(`unknown payment request: ${requestId}`);
    if (req.fromUser !== payer.principalId) {
      throw new Error("only the requested payer may settle this request");
    }
    if (req.status !== "open") {
      throw new Error(`request is ${req.status}`);
    }
    const receipt = this.send(payer, req.toUser, req.amount, {
      memo: `pay ${requestId}: ${req.memo}`,
      idempotencyKey: `payreq:${requestId}`,
    });
    this._requests.set(
      requestId,
      new PaymentRequest({ ...req, status: "paid" })
    );
    return receipt;
  }

  // ---- escrow -------------------------------------------------------
  /**
   * Move funds (any held asset) from available to escrow. They become
   * unspendable until released.
   */
  escrowLock(principal, amount, { idempotencyKey = null } = {}) {
    requirePrincipal(principal);
    this.policy.require(principal, "wallet.escrow");
    if (!(amount instanceof Money) || !amount.isPositive) {
      throw new TypeError("escrow amount must be positive Money");
    }
    const currency = amount.currency;
    const key = idempotencyKey ?? `escrow:${randomUUID()}`;
    this.openWallet(principal.principalId, currency);
    const before = this.balance(principal.principalId, currency).toDict();
    this.ledger.post(
      [
        new Posting(subAccount(principal.principalId, "available", currency), amount.neg()),
        new Posting(subAccount(principal.principalId, "escrow", currency), amount),
      ],
      { realm: REALM, actorId: principal.principalId, idempotencyKey: key, eventType: "wallet.escrow_lock" }
    );
    const after = this.balance(principal.principalId, currency).toDict();
    return this._receipt(principal, "escrow_lock", `Locked ${amount} in escrow`, before, after, {
      amount: amount.toString(),
      idempotencyKey: key,
    });
  }

  /**
   * Release escrowed funds (any held asset) to a counterparty
   * (e.g. on delivery).
   */
  escrowRelease(principal, toUser, amount, { idempotencyKey = null } = {}) {
    requirePrincipal(principal);
    if (!(amount instanceof Money) || !amount.isPositive) {
      throw new TypeError("escrow release amount must be positive Money");
    }
    const currency = amount.currency;
    const key = idempotencyKey ?? `escrow_rel:${randomUUID()}`;
    this.openWallet(toUser, currency);
    const before = {
      from: this.balance(principal.principalId, currency).toDict(),
      to: this.balance(toUser, currency).toDict(),
    };
    this.ledger.post(
      [
        new Posting(subAccount(principal.principalId, "escrow", currency), amount.neg()),
        new Posting(subAccount(toUser, "available", currency), amount),
      ],
      { realm: REALM, actorId: principal.principalId, idempotencyKey: key, eventType: "wallet.escrow_release" }
    );
    const after = {
      from: this.balance(principal.principalId, currency).toDict(),
      to: this.balance(toUser, currency).toDict(),
    };
    return this._receipt(principal, "escrow_release", `Released ${amount} escrow to ${toUser}`, before, after, {
      to: toUser,
      amount: amount.toString(),
      idempotencyKey: key,
    });
  }
}

export { PermissionDenied, Role };
