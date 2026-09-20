/**
 * Reality Lens Ω — Contract status vocabulary adapter
 * =============================================================================
 * One connector so every contract lane interoperates without rewriting the
 * hardened canonical lifecycle. The canonical statuses are the law (pinned by
 * the hardened outcome-contracts suite: guarded transitions, escrow accounting,
 * anti-double-join/grade/claim, deterministic grading, expiresAt: null).
 * Lanes that speak a different dialect translate THROUGH canonical — no lane
 * may redefine what a canonical status means.
 *
 * Canonical lifecycle (authority):
 *   draft → open → locked → graded → settled → claimed   (voided any time pre-claim)
 *
 * Dialects connected here:
 *   review    — contract review / cross-review target flow:
 *               draft → pending_review → active → graded → claimable → cancelled
 *   hardening — rejected wholesale rewrite; kept ONLY as an input dialect so its
 *               useful micro-ideas can be quoted without adopting its vocabulary:
 *               draft → open → joined → locked → graded → paid → cancelled
 *   ledger    — contract-ledger tracking lane:
 *               proposed → open → active → graded → claimed → cancelled
 *               (reversed = undone after grading/claim; joined is an event, not a status)
 *
 * Fidelity: translations that collapse or approximate a distinction return
 * exact: false with a note explaining what was lost. The ledger/audit trail
 * always holds the full truth; statuses are just the shared shorthand.
 *
 * Simulated TUMBO points only. No wallets, no signing, no custody, no
 * settlement, no real money. Projection-only.
 */

export const CANONICAL_STATUSES = Object.freeze([
  'draft', 'open', 'locked', 'graded', 'settled', 'claimed', 'voided',
]);

export const REVIEW_STATUSES = Object.freeze([
  'draft', 'pending_review', 'active', 'graded', 'claimable', 'cancelled',
]);

export const HARDENING_STATUSES = Object.freeze([
  'draft', 'open', 'joined', 'locked', 'graded', 'paid', 'cancelled',
]);

export const LEDGER_STATUSES = Object.freeze([
  'proposed', 'open', 'active', 'graded', 'claimed', 'reversed', 'cancelled',
]);

export const DIALECTS = Object.freeze(['canonical', 'review', 'hardening', 'ledger']);

const DIALECT_STATUS_LIST = {
  canonical: CANONICAL_STATUSES,
  review: REVIEW_STATUSES,
  hardening: HARDENING_STATUSES,
  ledger: LEDGER_STATUSES,
};

/**
 * Dialect → canonical. Each entry: [canonicalStatus, exact, note].
 * exact=false means the translation collapses or approximates a distinction;
 * read the note before relying on round-trips.
 */
const TO_CANONICAL = {
  review: {
    draft: ['draft', true, ''],
    pending_review: ['draft', false,
      'The review queue is a pre-lifecycle stage owned by the review lane. ' +
      'Once Tumbo approves the draft card it materializes as a canonical draft contract.'],
    active: ['open', false,
      'Review dialect does not distinguish canonical open vs locked; both collapse to active. ' +
      'Join-window detail lives in the canonical contract record.'],
    graded: ['graded', true, ''],
    claimable: ['settled', true,
      'Graded with payouts computed and claimable forever (expiresAt: null) — the eternal-escrow state.'],
    cancelled: ['voided', true, ''],
  },
  hardening: {
    draft: ['draft', true, ''],
    open: ['open', true, ''],
    joined: ['open', false,
      'Canonical tracks participation inside the open state (anti-double-join guards); ' +
      'a separate joined state does not exist. Participant counts live on the contract record.'],
    locked: ['locked', true, ''],
    graded: ['graded', true, ''],
    paid: ['settled', true,
      'Payouts computed and claimable; canonical keeps settled distinct from claimed ' +
      'because claims are eternal and recorded by the ledger.'],
    cancelled: ['voided', true, ''],
  },
  ledger: {
    proposed: ['draft', true,
      'Ledger proposed mirrors canonical draft: created, not yet published.'],
    open: ['open', true, ''],
    active: ['locked', false,
      'Ledger active means live past the open stage; canonical splits that into open vs locked. ' +
      'Mapped to locked (join window closed); join-window detail lives in the canonical record.'],
    graded: ['graded', true, ''],
    claimed: ['claimed', true, ''],
    reversed: ['voided', false,
      'Canonical has no post-grading reversal state; reversed contracts are voided for ' +
      'lifecycle purposes. The reversal itself is preserved forever in the ledger audit trail.'],
    cancelled: ['voided', true, ''],
  },
};

/**
 * Canonical → dialect. Each entry: [dialectStatus, exact, note].
 */
const FROM_CANONICAL = {
  review: {
    draft: ['draft', true, ''],
    open: ['active', false,
      'Review dialect collapses canonical open+locked into a single active state.'],
    locked: ['active', false,
      'Review dialect collapses canonical open+locked into a single active state.'],
    graded: ['graded', true, ''],
    settled: ['claimable', true, ''],
    claimed: ['claimable', false,
      'Review dialect has no claimed state; the claim itself is recorded in the ' +
      'ledger/audit trail, claimable forever.'],
    voided: ['cancelled', true, ''],
  },
  hardening: {
    draft: ['draft', true, ''],
    open: ['open', true, ''],
    locked: ['locked', true, ''],
    graded: ['graded', true, ''],
    settled: ['paid', true, ''],
    claimed: ['paid', false,
      'Hardening dialect ends at paid; the eternal claim is tracked by the ledger, not the status.'],
    voided: ['cancelled', true, ''],
  },
  ledger: {
    draft: ['proposed', true, ''],
    open: ['open', true, ''],
    locked: ['active', true, ''],
    graded: ['graded', true, ''],
    settled: ['graded', false,
      'Ledger has no settled state; a graded contract with payouts pending stays graded. ' +
      'Claim pending-ness is tracked by ledger flags (expiresAt: null, claimed), not status.'],
    claimed: ['claimed', true, ''],
    voided: ['cancelled', true, ''],
  },
};

function assertDialect(dialect) {
  if (!DIALECT_STATUS_LIST[dialect]) {
    throw new TypeError(
      `Unknown contract status dialect "${dialect}". ` +
      `Expected one of: ${DIALECTS.join(', ')}.`
    );
  }
}

function assertStatus(status, dialect) {
  assertDialect(dialect);
  const list = DIALECT_STATUS_LIST[dialect];
  if (typeof status !== 'string' || !list.includes(status)) {
    throw new TypeError(
      `Unknown status "${status}" for dialect "${dialect}". ` +
      `Valid ${dialect} statuses: ${list.join(', ')}.`
    );
  }
}

/** Translate any dialect status into the canonical lifecycle vocabulary. */
export function toCanonical(status, dialect = 'canonical') {
  if (dialect === 'canonical') {
    assertStatus(status, 'canonical');
    return status;
  }
  assertStatus(status, dialect);
  return TO_CANONICAL[dialect][status][0];
}

/** Translate a canonical status into a lane dialect's vocabulary. */
export function fromCanonical(status, dialect = 'canonical') {
  assertStatus(status, 'canonical');
  if (dialect === 'canonical') return status;
  assertDialect(dialect);
  return FROM_CANONICAL[dialect][status][0];
}

/** Translate directly between two dialects, routed through canonical. */
export function translate(status, fromDialect, toDialect) {
  return fromCanonical(toCanonical(status, fromDialect), toDialect);
}

/**
 * Full fidelity report for one translation. Never throws on known inputs;
 * throws the same TypeError as toCanonical/fromCanonical on unknown ones.
 */
export function mappingInfo(status, fromDialect, toDialect = 'canonical') {
  const canonical = toCanonical(status, fromDialect);
  const entry = fromDialect === 'canonical'
    ? [canonical, true, '']
    : TO_CANONICAL[fromDialect][status];
  const target = fromCanonical(canonical, toDialect);
  const back = toDialect === 'canonical'
    ? [canonical, true, '']
    : FROM_CANONICAL[toDialect][canonical];
  const exact = entry[1] === true && back[1] === true;
  const notes = [entry[2], back[2]].filter(Boolean);
  return {
    from: status,
    fromDialect,
    to: target,
    toDialect,
    via: canonical,
    exact,
    note: notes.join(' '),
  };
}

/** True when the status belongs to the canonical hardened lifecycle. */
export function isCanonical(status) {
  return typeof status === 'string' && CANONICAL_STATUSES.includes(status);
}

/** True when the status is valid inside the named dialect. */
export function isKnownStatus(status, dialect) {
  return !!DIALECT_STATUS_LIST[dialect] &&
    typeof status === 'string' &&
    DIALECT_STATUS_LIST[dialect].includes(status);
}

/**
 * Return a shallow copy of a contract-like record with its status translated
 * to canonical. The input is never mutated. Throws on unknown status/dialect.
 */
export function normalizeToCanonical(record, dialect = 'canonical') {
  if (!record || typeof record !== 'object') {
    throw new TypeError('normalizeToCanonical expects a contract-like object.');
  }
  const info = mappingInfo(record.status, dialect, 'canonical');
  return { ...record, status: info.to };
}
