/** token-ticker.test.mjs — pure helper tests for the token ticker panel.
 * No DOM, no ledger: exercises the presentation helpers against fixed inputs.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  escapeHtml,
  reversalWindowInfo,
  shortHash,
  checkChainLinkage,
  chainStatusLabel,
  activitySummary,
  journalSummary,
} from '../src/render/token-ticker.js';

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    assert.equal(escapeHtml('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
  });
  it('tolerates null/undefined', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });
});

describe('reversalWindowInfo', () => {
  it('is eligible inside the 1000-tick window', () => {
    const info = reversalWindowInfo(100, 500, 1000);
    assert.equal(info.eligible, true);
    assert.equal(info.ticksLeft, 600);
  });
  it('closes exactly at the window boundary', () => {
    const info = reversalWindowInfo(0, 1000, 1000);
    assert.equal(info.eligible, false);
    assert.equal(info.ticksLeft, 0);
  });
  it('is closed past the window', () => {
    const info = reversalWindowInfo(10, 2000, 1000);
    assert.equal(info.eligible, false);
    assert.equal(info.ticksLeft, 0);
  });
  it('fails closed on non-finite inputs', () => {
    assert.deepEqual(reversalWindowInfo(NaN, 5, 1000), { eligible: false, ticksLeft: 0 });
    assert.deepEqual(reversalWindowInfo(5, 9, 0), { eligible: false, ticksLeft: 0 });
    assert.deepEqual(reversalWindowInfo(9, 5, 1000), { eligible: false, ticksLeft: 0 });
  });
});

describe('shortHash', () => {
  it('truncates long hashes', () => {
    assert.equal(shortHash('abcdef0123456789'), 'abcdef0123…');
  });
  it('passes short values through', () => {
    assert.equal(shortHash('abc'), 'abc');
    assert.equal(shortHash(null), '');
  });
});

describe('checkChainLinkage', () => {
  const mk = (hash, prevHash) => ({ hash, prevHash });
  it('passes an intact newest-first chain', () => {
    const rows = [mk('c', 'b'), mk('b', 'a'), mk('a', 'genesis')];
    assert.deepEqual(checkChainLinkage(rows), { ok: true, badIndex: -1 });
  });
  it('flags the broken link', () => {
    const rows = [mk('c', 'b'), mk('b', 'TAMPERED'), mk('a', 'genesis')];
    assert.deepEqual(checkChainLinkage(rows), { ok: false, badIndex: 1 });
  });
  it('passes empty and single rows', () => {
    assert.deepEqual(checkChainLinkage([]), { ok: true, badIndex: -1 });
    assert.deepEqual(checkChainLinkage([mk('a', 'genesis')]), { ok: true, badIndex: -1 });
  });
});

describe('chainStatusLabel', () => {
  it('labels verified / broken / unknown', () => {
    assert.equal(chainStatusLabel({ ok: true }), 'verified');
    assert.equal(chainStatusLabel({ ok: false, badSeq: 3 }), 'broken');
    assert.equal(chainStatusLabel(null), 'unknown');
    assert.equal(chainStatusLabel({}), 'unknown');
  });
});

describe('activitySummary', () => {
  it('summarizes a wallet history row', () => {
    const s = activitySummary({ id: 'j1', kind: 'send', from: 'you', to: 'alice', asset: 'TUMBO-SIM', amountFluff: 1500, at: '2026-01-01' });
    assert.equal(s.kind, 'send');
    assert.equal(s.who, 'you → alice');
    assert.equal(s.amountFluff, 1500);
  });
  it('tolerates missing fields', () => {
    const s = activitySummary({});
    assert.equal(s.kind, 'activity');
    assert.equal(s.amountFluff, 0);
  });
});

describe('journalSummary', () => {
  it('marks in-window receipts reversible with a countdown', () => {
    const s = journalSummary({ id: 'j9', action: 'send', seq: 9, tick: 100, hash: 'abcdef0123456789', prevHash: 'p' }, 500, 1000);
    assert.equal(s.reversible, true);
    assert.equal(s.ticksLeft, 600);
    assert.equal(s.hash, 'abcdef0123…');
  });
  it('marks out-of-window receipts closed', () => {
    const s = journalSummary({ id: 'j1', action: 'send', tick: 1, hash: 'h', prevHash: 'g' }, 5000, 1000);
    assert.equal(s.reversible, false);
    assert.equal(s.ticksLeft, 0);
  });
});
