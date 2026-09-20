/**
 * Reality Lens Ω — contract status vocabulary adapter tests (node:test).
 * Pure module, no DOM, no dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_STATUSES,
  REVIEW_STATUSES,
  HARDENING_STATUSES,
  LEDGER_STATUSES,
  DIALECTS,
  toCanonical,
  fromCanonical,
  translate,
  mappingInfo,
  isCanonical,
  isKnownStatus,
  normalizeToCanonical,
} from '../src/domains/contract-status-vocab.js';

describe('vocabulary shape', () => {
  test('canonical lifecycle is the hardened seven-state vocabulary', () => {
    assert.deepEqual([...CANONICAL_STATUSES],
      ['draft', 'open', 'locked', 'graded', 'settled', 'claimed', 'voided']);
  });

  test('all four dialects are declared', () => {
    assert.deepEqual([...DIALECTS], ['canonical', 'review', 'hardening', 'ledger']);
    assert.equal(REVIEW_STATUSES.length, 6);
    assert.equal(HARDENING_STATUSES.length, 7);
    assert.equal(LEDGER_STATUSES.length, 7);
  });
});

describe('toCanonical — review dialect', () => {
  const cases = [
    ['draft', 'draft'],
    ['pending_review', 'draft'],
    ['active', 'open'],
    ['graded', 'graded'],
    ['claimable', 'settled'],
    ['cancelled', 'voided'],
  ];
  for (const [from, to] of cases) {
    test(`${from} → ${to}`, () => assert.equal(toCanonical(from, 'review'), to));
  }
});

describe('toCanonical — hardening dialect', () => {
  const cases = [
    ['draft', 'draft'],
    ['open', 'open'],
    ['joined', 'open'],
    ['locked', 'locked'],
    ['graded', 'graded'],
    ['paid', 'settled'],
    ['cancelled', 'voided'],
  ];
  for (const [from, to] of cases) {
    test(`${from} → ${to}`, () => assert.equal(toCanonical(from, 'hardening'), to));
  }
});

describe('toCanonical — ledger dialect', () => {
  const cases = [
    ['proposed', 'draft'],
    ['open', 'open'],
    ['active', 'locked'],
    ['graded', 'graded'],
    ['claimed', 'claimed'],
    ['reversed', 'voided'],
    ['cancelled', 'voided'],
  ];
  for (const [from, to] of cases) {
    test(`${from} → ${to}`, () => assert.equal(toCanonical(from, 'ledger'), to));
  }
});

describe('fromCanonical', () => {
  test('canonical is identity', () => {
    for (const s of CANONICAL_STATUSES) assert.equal(fromCanonical(s, 'canonical'), s);
  });

  test('review dialect', () => {
    assert.deepEqual(
      CANONICAL_STATUSES.map((s) => fromCanonical(s, 'review')),
      ['draft', 'active', 'active', 'graded', 'claimable', 'claimable', 'cancelled']);
  });

  test('hardening dialect', () => {
    assert.deepEqual(
      CANONICAL_STATUSES.map((s) => fromCanonical(s, 'hardening')),
      ['draft', 'open', 'locked', 'graded', 'paid', 'paid', 'cancelled']);
  });

  test('ledger dialect', () => {
    assert.deepEqual(
      CANONICAL_STATUSES.map((s) => fromCanonical(s, 'ledger')),
      ['proposed', 'open', 'active', 'graded', 'graded', 'claimed', 'cancelled']);
  });
});

describe('translate — direct dialect to dialect', () => {
  test('review active → ledger open (both are the joinable live stage)', () => {
    assert.equal(translate('active', 'review', 'ledger'), 'open');
  });
  test('ledger claimed → review claimable', () => {
    assert.equal(translate('claimed', 'ledger', 'review'), 'claimable');
  });
  test('hardening paid → ledger graded', () => {
    assert.equal(translate('paid', 'hardening', 'ledger'), 'graded');
  });
  test('review claimable → hardening paid', () => {
    assert.equal(translate('claimable', 'review', 'hardening'), 'paid');
  });
  test('exact round-trips preserve meaning', () => {
    assert.equal(translate('graded', 'review', 'hardening'), 'graded');
    assert.equal(translate('cancelled', 'hardening', 'ledger'), 'cancelled');
  });
});

describe('fidelity reporting', () => {
  test('exact translations are flagged exact', () => {
    assert.equal(mappingInfo('graded', 'review', 'canonical').exact, true);
    assert.equal(mappingInfo('claimable', 'review', 'canonical').exact, true);
    assert.equal(mappingInfo('paid', 'hardening', 'canonical').exact, true);
  });

  test('lossy translations are flagged with an explanatory note', () => {
    const joined = mappingInfo('joined', 'hardening', 'canonical');
    assert.equal(joined.exact, false);
    assert.match(joined.note, /participation/i);

    const reversed = mappingInfo('reversed', 'ledger', 'canonical');
    assert.equal(reversed.exact, false);
    assert.match(reversed.note, /audit trail/i);

    const pending = mappingInfo('pending_review', 'review', 'canonical');
    assert.equal(pending.exact, false);
    assert.match(pending.note, /pre-lifecycle/i);
  });

  test('mappingInfo reports the canonical pivot', () => {
    const info = mappingInfo('active', 'review', 'ledger');
    assert.equal(info.from, 'active');
    assert.equal(info.via, 'open');
    assert.equal(info.to, 'open');
    assert.equal(info.toDialect, 'ledger');
  });
});

describe('guards', () => {
  test('unknown statuses throw with the valid list', () => {
    assert.throws(() => toCanonical('flying', 'review'), /Valid review statuses/);
    assert.throws(() => fromCanonical('flying', 'review'), /Valid canonical statuses/);
    assert.throws(() => translate('flying', 'ledger', 'review'), TypeError);
  });

  test('unknown dialects throw', () => {
    assert.throws(() => toCanonical('open', 'espn'), /Unknown contract status dialect/);
    assert.throws(() => fromCanonical('open', 'kalshi'), /Unknown contract status dialect/);
  });

  test('isCanonical / isKnownStatus', () => {
    assert.equal(isCanonical('settled'), true);
    assert.equal(isCanonical('claimable'), false);
    assert.equal(isKnownStatus('claimable', 'review'), true);
    assert.equal(isKnownStatus('claimable', 'canonical'), false);
    assert.equal(isKnownStatus('reversed', 'ledger'), true);
    assert.equal(isKnownStatus('reversed', 'review'), false);
  });
});

describe('normalizeToCanonical', () => {
  test('translates the status without mutating the input', () => {
    const record = { id: 'c1', status: 'claimable', title: 'Game tomorrow' };
    const out = normalizeToCanonical(record, 'review');
    assert.equal(out.status, 'settled');
    assert.equal(out.id, 'c1');
    assert.equal(record.status, 'claimable', 'input untouched');
    assert.notEqual(out, record);
  });

  test('defaults to the canonical dialect (identity)', () => {
    const record = { status: 'locked' };
    assert.deepEqual(normalizeToCanonical(record), { status: 'locked' });
  });

  test('throws on unknown status and non-objects', () => {
    assert.throws(() => normalizeToCanonical({ status: 'nope' }, 'ledger'), TypeError);
    assert.throws(() => normalizeToCanonical(null), TypeError);
  });
});
