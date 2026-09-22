/**
 * Double-entry ledger for maTumbo (ledger-core).
 *
 * Ported from TumboAgent PR #6 (`matumbo/core/ledger.py`, tag
 * archive/pr-6-claude-matumbo-master-spec-mz1vv4).
 *
 * Every balance change is a *transaction* made of one or more *postings*
 * whose signed amounts sum to exactly zero per currency. This is what
 * "double-entry" means and it is the single most important safety property
 * in the whole system: money is never created or destroyed by a transfer,
 * only moved between accounts.
 *
 * Design guarantees (tested in tests/ledger-core.test.mjs):
 *
 *   * Atomic     — a transaction posts fully or not at all.
 *   * Balanced   — postings within a transaction sum to exactly zero
 *                  (BigInt; no float epsilon).
 *   * Idempotent — replaying a transaction with the same idempotency key is
 *                  a no-op that returns the original event.
 *   * Guarded    — normal accounts cannot go negative; only accounts
 *                  explicitly flagged `allowNegative` (e.g. the system
 *                  issuance account, negative by design) may hold a
 *                  negative balance.
 *   * Auditable  — every transaction becomes an append-only domain Event.
 *
 * Simulation-only: balances here are simulated TUMBO points. No real
 * money, no custody, no settlement.
 */

import { createEvent, EventLog } from "./events.js?v=20260922-cache2";
import { Money, TUMBO } from "./money.js?v=20260922-cache2";

export class LedgerError extends Error {}
export class InsufficientFundsError extends LedgerError {}
export class UnbalancedTransactionError extends LedgerError {}
export class UnknownAccountError extends LedgerError {}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

/**
 * A ledger account holding a balance in one currency.
 *
 * `allowNegative` marks system source accounts (issuance, insurance fund)
 * whose whole purpose is to be the negative counterweight to user
 * holdings. User wallet accounts are never allowNegative.
 */
export class Account {
  constructor(accountId, currency = TUMBO, allowNegative = false) {
    requireNonEmptyString(accountId, "accountId");
    this.accountId = accountId;
    this.currency = currency;
    this.allowNegative = allowNegative;
    this._balance = Money.zero(currency);
  }

  get balance() {
    return this._balance;
  }

  /** @internal — only Ledger.post may mutate balances, atomically. */
  _setBalance(balance) {
    this._balance = balance;
  }
}

/** One leg of a transaction: `amount` added to `accountId`. Immutable. */
export class Posting {
  /**
   * @param {string} accountId
   * @param {Money} amount - signed; positive credits the account, negative debits it
   */
  constructor(accountId, amount) {
    requireNonEmptyString(accountId, "accountId");
    if (!(amount instanceof Money)) {
      throw new TypeError("Posting.amount must be Money");
    }
    this.accountId = accountId;
    this.amount = amount;
    Object.freeze(this);
  }
}

/** An in-memory double-entry ledger with an attached event log. */
export class Ledger {
  /** @param {EventLog} [eventLog] */
  constructor(eventLog = null) {
    this._accounts = new Map();
    this._log = eventLog ?? new EventLog();
  }

  /**
   * Open an account. Opening an already-open account is a no-op returning
   * the existing account (its flags are NOT changed).
   */
  openAccount(accountId, currency = TUMBO, allowNegative = false) {
    const existing = this._accounts.get(accountId);
    if (existing) return existing;
    const acct = new Account(accountId, currency, allowNegative);
    this._accounts.set(accountId, acct);
    return acct;
  }

  account(accountId) {
    const acct = this._accounts.get(accountId);
    if (!acct) throw new UnknownAccountError(`unknown account: ${accountId}`);
    return acct;
  }

  balance(accountId) {
    return this.account(accountId).balance;
  }

  /**
   * Atomically apply a balanced set of postings. The ONE write path.
   *
   * Returns the recorded domain Event. Safe to call twice with the same
   * `idempotencyKey` — the second call is a no-op returning the first
   * event.
   */
  post(
    postings,
    { realm, actorId, idempotencyKey, eventType = "ledger.transaction", memo = null }
  ) {
    requireNonEmptyString(realm, "realm");
    requireNonEmptyString(actorId, "actorId");
    requireNonEmptyString(idempotencyKey, "idempotencyKey");

    // 1. Idempotency: already applied? return the recorded event.
    const replayed = this._log.findByIdempotencyKey(idempotencyKey);
    if (replayed) return replayed;

    if (!Array.isArray(postings) || postings.length === 0) {
      throw new UnbalancedTransactionError(
        "a transaction needs at least one posting"
      );
    }

    // 2. Balanced-per-currency check: postings must sum to exactly zero.
    const totals = new Map();
    for (const p of postings) {
      if (!(p instanceof Posting)) {
        throw new TypeError("postings must be Posting instances");
      }
      const code = p.amount.currency.code;
      totals.set(code, (totals.get(code) ?? 0n) + p.amount.units);
    }
    for (const [code, total] of totals) {
      if (total !== 0n) {
        throw new UnbalancedTransactionError(
          `postings for ${code} sum to ${total} base units, must be 0`
        );
      }
    }

    // 3. Validate against staged copies so we never half-apply (atomicity).
    const staged = new Map();
    for (const p of postings) {
      const acct = this.account(p.accountId); // throws UnknownAccountError
      const current = staged.has(p.accountId)
        ? staged.get(p.accountId)
        : acct.balance;
      const next = current.add(p.amount);
      if (next.isNegative && !acct.allowNegative) {
        throw new InsufficientFundsError(
          `${p.accountId} would go to ${next} (negative)`
        );
      }
      staged.set(p.accountId, next);
    }

    // 4. Commit — validation passed, this cannot fail now.
    for (const [accountId, next] of staged) {
      this._accounts.get(accountId)._setBalance(next);
    }

    // 5. Record the immutable event.
    const event = this._log.append(
      createEvent({
        eventType,
        aggregateId: idempotencyKey,
        realm,
        actorId,
        idempotencyKey,
        payload: {
          postings: postings.map((p) => ({
            account: p.accountId,
            units: p.amount.units.toString(),
            currency: p.amount.currency.code,
          })),
          memo,
        },
      })
    );
    return event;
  }

  get log() {
    return this._log;
  }

  /**
   * Sum of all balances in a currency. For a closed system this must be
   * zero — issuance accounts are the negative mirror of user holdings.
   */
  trialBalance(currency = TUMBO) {
    let total = Money.zero(currency);
    for (const acct of this._accounts.values()) {
      if (acct.currency.equals(currency)) total = total.add(acct.balance);
    }
    return total;
  }

  accounts() {
    return [...this._accounts.values()];
  }
}
