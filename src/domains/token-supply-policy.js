/**
 * Exact, simulation-only TUMBO supply policy metadata.
 *
 * The live token engine deliberately keeps its current issued supply in safe
 * integer fluff and serializes the v2 engine snapshot unchanged. This module
 * is a separate read-only policy surface for the intended maximum. It never
 * mints, allocates, mutates a ledger, or changes genesis.
 *
 * BigInt is used for internal unit arithmetic. The policy codec emits only
 * canonical decimal strings so it is safe to JSON serialize and cannot round
 * the 42 quadrillion-fluff maximum through Number.
 */

import {
  FLUFF_PER_TUMBO,
  TOKEN_TOTAL_SUPPLY,
  TUMBO_INTENDED_MAX_SUPPLY_FLUFF,
  TUMBO_INTENDED_MAX_SUPPLY_FLUFF_DECIMAL,
  TUMBO_INTENDED_MAX_SUPPLY_TUMBO,
  TUMBO_INTENDED_MAX_SUPPLY_TUMBO_DECIMAL,
} from "./token-config.js";

export const TOKEN_SUPPLY_POLICY_FORMAT = "tumbo-supply-policy-v1";
export const TOKEN_SUPPLY_POLICY_ASSET = "TUMBO-SIM";

const FLUFF_PER_TUMBO_BIGINT = BigInt(FLUFF_PER_TUMBO);
const CURRENT_ISSUED_FLUFF = BigInt(TOKEN_TOTAL_SUPPLY);

function requireBigInt(value, name) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new TypeError(`${name} must be a non-negative bigint`);
  }
  return value;
}

/**
 * Parse a canonical unsigned decimal string without passing through Number.
 * Leading zeroes, signs, fractions, exponent notation, and numeric inputs are
 * rejected so the serialized representation has exactly one spelling.
 */
export function parseCanonicalUintDecimal(value, name = "value") {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`${name} must be a canonical unsigned decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed.toString() !== value) {
    throw new TypeError(`${name} is not canonically encoded`);
  }
  return parsed;
}

/** Convert an exact whole-TUMBO bigint into exact fluff. */
export function tumboToFluffExact(wholeTumbo) {
  return requireBigInt(wholeTumbo, "wholeTumbo") * FLUFF_PER_TUMBO_BIGINT;
}

/**
 * Convert exact fluff to whole TUMBO. Fractional whole-token values are
 * rejected rather than truncated or rounded.
 */
export function fluffToTumboExact(fluff) {
  const exactFluff = requireBigInt(fluff, "fluff");
  if (exactFluff % FLUFF_PER_TUMBO_BIGINT !== 0n) {
    throw new RangeError("fluff is not an exact whole-TUMBO amount");
  }
  return exactFluff / FLUFF_PER_TUMBO_BIGINT;
}

/** Exact comma grouping that never coerces a bigint through Number. */
export function formatExactInteger(value) {
  const exact = requireBigInt(value, "value");
  return exact.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function freezeMetadata(metadata) {
  return Object.freeze({
    ...metadata,
    currentIssued: Object.freeze({ ...metadata.currentIssued }),
    intendedMaximum: Object.freeze({ ...metadata.intendedMaximum }),
  });
}

const CURRENT_ISSUED_TUMBO = fluffToTumboExact(CURRENT_ISSUED_FLUFF);

const POLICY_METADATA = freezeMetadata({
  format: TOKEN_SUPPLY_POLICY_FORMAT,
  asset: TOKEN_SUPPLY_POLICY_ASSET,
  simulation: true,
  unit: "fluff",
  fluffPerTumbo: String(FLUFF_PER_TUMBO),
  currentIssued: {
    wholeTumbo: CURRENT_ISSUED_TUMBO.toString(),
    fluff: CURRENT_ISSUED_FLUFF.toString(),
  },
  intendedMaximum: {
    wholeTumbo: TUMBO_INTENDED_MAX_SUPPLY_TUMBO_DECIMAL,
    fluff: TUMBO_INTENDED_MAX_SUPPLY_FLUFF_DECIMAL,
  },
});

if (tumboToFluffExact(TUMBO_INTENDED_MAX_SUPPLY_TUMBO) !== TUMBO_INTENDED_MAX_SUPPLY_FLUFF) {
  throw new Error("TUMBO intended maximum unit conversion is inconsistent");
}

/** Return immutable, JSON-safe metadata with issued and intended values distinct. */
export function getTumboSupplyPolicy() {
  return POLICY_METADATA;
}
/** Serialize only canonical decimal strings; no BigInt reaches JSON.stringify. */
export function serializeTumboSupplyPolicy() {
  return JSON.stringify(POLICY_METADATA);
}

function assertExactKeys(value, expected, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${name} has an unsupported shape`);
  }
}

function assertPolicyDecimal(value, expected, name) {
  const parsed = parseCanonicalUintDecimal(value, name);
  if (parsed !== expected) throw new TypeError(`${name} differs from the fixed policy`);
}

/**
 * Validate a policy snapshot and return the canonical in-memory metadata.
 * This is intentionally independent from token-store's v2 engine snapshot;
 * loading it cannot alter balances, journals, receipts, or genesis.
 */
export function loadTumboSupplyPolicy(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  assertExactKeys(data, ["format", "asset", "simulation", "unit", "fluffPerTumbo", "currentIssued", "intendedMaximum"], "policy");
  if (data.format !== TOKEN_SUPPLY_POLICY_FORMAT || data.asset !== TOKEN_SUPPLY_POLICY_ASSET || data.simulation !== true || data.unit !== "fluff") {
    throw new TypeError("unsupported TUMBO supply policy");
  }
  assertPolicyDecimal(data.fluffPerTumbo, FLUFF_PER_TUMBO_BIGINT, "fluffPerTumbo");

  assertExactKeys(data.currentIssued, ["wholeTumbo", "fluff"], "currentIssued");
  assertPolicyDecimal(data.currentIssued.fluff, CURRENT_ISSUED_FLUFF, "currentIssued.fluff");
  assertPolicyDecimal(data.currentIssued.wholeTumbo, CURRENT_ISSUED_TUMBO, "currentIssued.wholeTumbo");

  assertExactKeys(data.intendedMaximum, ["wholeTumbo", "fluff"], "intendedMaximum");
  assertPolicyDecimal(data.intendedMaximum.wholeTumbo, TUMBO_INTENDED_MAX_SUPPLY_TUMBO, "intendedMaximum.wholeTumbo");
  assertPolicyDecimal(data.intendedMaximum.fluff, TUMBO_INTENDED_MAX_SUPPLY_FLUFF, "intendedMaximum.fluff");

  return POLICY_METADATA;
}
