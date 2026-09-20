/**
 * Decimal-safe money for maTumbo (ledger-core).
 *
 * Ported from TumboAgent PR #6 (`matumbo/core/money.py`, tag
 * archive/pr-6-claude-matumbo-master-spec-mz1vv4). Constitution rule 0:
 *
 *   "All financial calculations use fixed-point, integer, bigint, or
 *    decimal-safe arithmetic. Never use ordinary JavaScript floats for
 *    ledger-critical values."
 *
 * Every amount is stored as an integer number of *base units* (BigInt).
 * TUMBO has 8 decimal places, so 1 TUMBO == 100_000_000n base units.
 * There is no float anywhere in the value path: `Money.of()` accepts
 * strings (or BigInt), never Number.
 *
 * Simulation-only: amounts denominated here are simulated TUMBO points.
 * No real money, no custody, no settlement.
 */

export class MoneyError extends Error {}
export class CurrencyMismatchError extends MoneyError {}
export class PrecisionError extends MoneyError {}

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * A currency definition. TUMBO is the one native coin; internal points,
 * ratings, LP positions etc. are NOT currencies and must never be
 * represented with Money.
 */
export class Currency {
  /**
   * @param {string} code - e.g. "TUMBO"
   * @param {number} decimals - e.g. 8
   */
  constructor(code, decimals) {
    if (typeof code !== "string" || code.trim() === "") {
      throw new TypeError("Currency code must be a non-empty string");
    }
    if (!Number.isInteger(decimals) || decimals < 0) {
      throw new TypeError("Currency decimals must be a non-negative integer");
    }
    this.code = code;
    this.decimals = decimals;
    Object.freeze(this);
  }

  /**
   * Convert a human amount (e.g. "1.5") to integer base units, exactly.
   * Raises if the amount carries more precision than the currency allows —
   * we never silently truncate someone's money.
   * @param {string|bigint} human
   * @returns {bigint}
   */
  baseUnits(human) {
    if (typeof human === "bigint") return human;
    if (typeof human !== "string") {
      throw new TypeError(
        `Money amounts must be given as decimal strings (or BigInt), not ${typeof human}. ` +
          "Ordinary JS Numbers are floats and are refused on the value path."
      );
    }
    const m = DECIMAL_RE.exec(human.trim());
    if (!m) {
      throw new MoneyError(`not a decimal amount: ${JSON.stringify(human)}`);
    }
    const [, sign, intPart, fracPart = ""] = m;
    if (fracPart.length > this.decimals) {
      throw new PrecisionError(
        `${human} exceeds ${this.decimals}-dp precision for ${this.code}`
      );
    }
    const scale = 10n ** BigInt(this.decimals);
    const fracPadded = fracPart.padEnd(this.decimals, "0");
    const units = BigInt(intPart) * scale + BigInt(fracPadded || "0");
    return sign === "-" ? -units : units;
  }

  equals(other) {
    return (
      other instanceof Currency &&
      other.code === this.code &&
      other.decimals === this.decimals
    );
  }
}

/** The one and only native coin. */
export const TUMBO = new Currency("TUMBO", 8);

/**
 * Parse a ratio string (e.g. "0.003", "1.5") into an exact {num, den}
 * BigInt pair. Used for fee rates so scaling never touches a float.
 */
function parseRatio(factor) {
  const m = DECIMAL_RE.exec(String(factor).trim());
  if (!m) throw new MoneyError(`not a decimal ratio: ${JSON.stringify(factor)}`);
  const [, sign, intPart, fracPart = ""] = m;
  const den = 10n ** BigInt(fracPart.length);
  const num = BigInt(intPart + fracPart || "0");
  return { num: sign === "-" ? -num : num, den };
}

const abs = (n) => (n < 0n ? -n : n);

/**
 * An exact amount of a single currency, stored as integer base units.
 * Immutable, comparable, and refuses to mix currencies or silently lose
 * precision. Division uses an explicit rounding mode because rounding a
 * fee is a policy decision, not an accident.
 */
export class Money {
  /**
   * @param {bigint} units - signed integer number of base units
   * @param {Currency} currency
   */
  constructor(units, currency) {
    if (typeof units !== "bigint") {
      throw new TypeError(
        "Money.units must be a BigInt (base units) — floats and Numbers are refused"
      );
    }
    if (!(currency instanceof Currency)) {
      throw new TypeError("Money.currency must be a Currency");
    }
    this.units = units;
    this.currency = currency;
    Object.freeze(this);
  }

  /** Build Money from a human-readable amount, e.g. Money.of("1.5"). */
  static of(human, currency = TUMBO) {
    return new Money(currency.baseUnits(human), currency);
  }

  static zero(currency = TUMBO) {
    return new Money(0n, currency);
  }

  _check(other) {
    if (!(other instanceof Money)) {
      throw new TypeError("cannot combine Money with non-Money");
    }
    if (!other.currency.equals(this.currency)) {
      throw new CurrencyMismatchError(
        `currency mismatch: ${this.currency.code} vs ${other.currency.code}`
      );
    }
  }

  add(other) {
    this._check(other);
    return new Money(this.units + other.units, this.currency);
  }

  sub(other) {
    this._check(other);
    return new Money(this.units - other.units, this.currency);
  }

  neg() {
    return new Money(-this.units, this.currency);
  }

  equals(other) {
    return (
      other instanceof Money &&
      other.units === this.units &&
      other.currency.equals(this.currency)
    );
  }

  /**
   * Multiply by a ratio (e.g. a fee rate) with an explicit rounding mode.
   * Returns whole base units — money cannot hold fractional base units.
   * @param {string} factor - decimal ratio string, e.g. "0.003"
   * @param {"half-up"|"down"} [rounding="half-up"]
   */
  scale(factor, rounding = "half-up") {
    const { num, den } = parseRatio(factor);
    const prod = this.units * num;
    let q = prod / den; // BigInt division truncates toward zero
    if (rounding === "half-up") {
      const r = prod % den;
      if (r !== 0n && 2n * abs(r) >= abs(den)) {
        q += prod >= 0n ? 1n : -1n; // half away from zero, like ROUND_HALF_UP
      }
    } else if (rounding !== "down") {
      throw new MoneyError(`unknown rounding mode: ${rounding}`);
    }
    return new Money(q, this.currency);
  }

  /**
   * Split into {fee, remainder} so that fee + remainder == this exactly.
   * The fee rounds down; the remainder absorbs the rounding dust so nothing
   * is created or lost.
   */
  splitFee(rate) {
    const fee = this.scale(rate, "down");
    return { fee, remainder: this.sub(fee) };
  }

  get isZero() {
    return this.units === 0n;
  }

  get isNegative() {
    return this.units < 0n;
  }

  get isPositive() {
    return this.units > 0n;
  }

  /** Human-readable decimal string, e.g. "1.50000000". */
  toHumanString() {
    const scale = 10n ** BigInt(this.currency.decimals);
    const sign = this.units < 0n ? "-" : "";
    const mag = abs(this.units);
    const intPart = mag / scale;
    const fracPart = String(mag % scale).padStart(this.currency.decimals, "0");
    return `${sign}${intPart}.${fracPart}`;
  }

  toString() {
    return `${this.toHumanString()} ${this.currency.code}`;
  }

  /** JSON-safe form: units as a decimal string (BigInt is not JSON-safe). */
  toJSON() {
    return { units: this.units.toString(), currency: this.currency.code };
  }
}
