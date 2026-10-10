import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenEngine } from '../src/domains/token.js?v=20261003-skin360';
import { serializeTokenEngine, loadTokenEngine } from '../src/domains/token-store.js?v=20261003-skin360';
import { createEconomicKernel, ECONOMIC_POOLS } from '../src/domains/economic-kernel.js?v=20261003-skin360';
import { createEconomicFinance } from '../src/domains/economic-finance.js?v=20261003-skin360';

const START = 1791040000000, YEAR = 365 * 24 * 60 * 60 * 1000;
function fixture() {
  const engine = createTokenEngine();
  for (const who of ['payer', 'creator', 'provider', 'treasury', 'buyer', 'seller', 'lender', 'borrower', 'alice', 'bob', 'carol']) {
    engine.faucet(`u:${who}`, 'TUMBO', 100000, { idempotencyKey: `seed:${who}` });
  }
  for (const who of ['seller', 'borrower']) {
    const quote = engine.quote({ action: 'exchange', from: `u:${who}`, fromAsset: 'TUMBO', toAsset: 'sMIMAS', amountIn: 10000 });
    engine.execute(quote, { idempotencyKey: `seed:exchange:${who}` });
  }
  let now = START;
  const kernel = createEconomicKernel({ engine, clock: () => now }), finance = createEconomicFinance(kernel);
  return { engine, kernel, finance, now: () => now, setTime(value) { now = value; } };
}
const payment = f => f.paymentRequest({ actor: 'u:creator', payer: 'u:payer', creator: 'u:creator', provider: 'u:provider', treasury: 'u:treasury',
  amountFluff: 101, creatorFluff: 71, providerFluff: 20, treasuryFluff: 10, expiresAt: START + 10000, refundUntil: START + 20000, terms: 'One delivered local artifact', idempotencyKey: 'request' });
const order = (f, side, key, overrides = {}) => f.orderPlace({ actor: side === 'BUY' ? 'u:buyer' : 'u:seller', baseAsset: 'sMIMAS', quoteAsset: 'TUMBO', side,
  lots: 6, lotSizeFluff: 10, priceNumeratorFluff: side === 'BUY' ? 5 : 4, priceDenominatorLots: 2, expiresAt: START + 10000, idempotencyKey: key, ...overrides });
const policy = { sources: [{ source: 'a', observer: 'b:oracle-a' }, { source: 'b', observer: 'b:oracle-b' }], maxAgeMs: 1000, maxDeviationBps: 1000 };
function observe(f, now = START, numerator = 2, denominator = 1, suffix = '') {
  for (const source of ['a', 'b']) f.oracleObserve({ actor: `b:oracle-${source}`, source, baseAsset: 'sMIMAS', quoteAsset: 'TUMBO', numerator, denominator, observedAt: now, evidence: 'Explicit local observation fixture', idempotencyKey: `observe:${source}${suffix}` });
}
const offer = (f, overrides = {}) => f.loanOffer({ actor: 'u:lender', asset: 'TUMBO', collateralAsset: 'sMIMAS', capitalFluff: 1000, maxLtvBps: 5000,
  termMs: 2000, expiresAt: START + 10000, interestKind: 'FIXED', fixedInterestFluff: 10, terms: 'Local fixed-interest collateral credit', oracle: policy, idempotencyKey: 'offer', ...overrides });
const market = (f, overrides = {}) => f.predictionCreate({ actor: 'u:creator', resolver: 'b:resolver', reviewer: 'b:reviewer', question: 'Did the explicit local event occur?',
  evidenceSpec: 'A recorded local fixture result, with challenge review.', closeAt: START + 1000, resolutionAt: START + 2000, challengeMs: 1000, idempotencyKey: 'market', ...overrides });
function stake(f, m, owner, outcome, amountFluff, key) { return f.predictionStake({ actor: owner, marketId: m.id, outcome, amountFluff, idempotencyKey: key }); }
function propose(f, m, outcome = 'YES', key = 'proposal') { return f.predictionPropose({ actor: 'b:resolver', marketId: m.id, outcome, evidence: 'Recorded test fixture outcome; no live sports or provider claim.', idempotencyKey: key }); }
function approvals(f, m, key = '') {
  for (const who of ['resolver', 'reviewer']) f.predictionApprove({ actor: `b:${who}`, marketId: m.id, proposalId: m.proposal.id, idempotencyKey: `approve:${who}${key}` });
}
function assertAtomicRejection(fx, action, regex) {
  const count = fx.engine.ledger.journalCount(), snapshot = fx.finance.snapshot(), commands = fx.kernel.snapshot().commandCount;
  assert.throws(action, regex);
  assert.equal(fx.engine.ledger.journalCount(), count); assert.deepEqual(fx.finance.snapshot(), snapshot); assert.equal(fx.kernel.snapshot().commandCount, commands);
}

test('payment authorization holds exact cover; one-journal delivery splits, replay and approved refund restore it', () => {
  const fx = fixture(), f = fx.finance, row = payment(f), before = fx.engine.balance('u:payer', 'TUMBO');
  assert.equal(fx.engine.balance(row.escrow, 'TUMBO'), 0);
  const authInput = { actor: 'u:payer', paymentId: row.id, idempotencyKey: 'authorize' }, authorized = f.paymentAuthorize(authInput);
  assert.equal(fx.engine.balance('u:payer', 'TUMBO'), before - 101); assert.equal(fx.engine.balance(row.escrow, 'TUMBO'), 101);
  assert.equal(f.paymentAuthorize(authInput), authorized);
  assert.equal(f.snapshot().obligations.find(o => o.id === row.id).covered, true);
  const count = fx.engine.ledger.journalCount();
  f.paymentFulfill({ actor: 'u:provider', paymentId: row.id, evidence: 'Artifact provided', idempotencyKey: 'fulfill' });
  assert.equal(fx.engine.ledger.journalCount(), count + 1); assert.equal(fx.engine.balance(row.escrow, 'TUMBO'), 0);
  assert.equal(fx.engine.balance('u:creator', 'TUMBO'), 100071); assert.equal(fx.engine.balance('u:provider', 'TUMBO'), 100020); assert.equal(fx.engine.balance('u:treasury', 'TUMBO'), 100010);
  f.paymentRefundRequest({ actor: 'u:payer', paymentId: row.id, reason: 'Returned local artifact', idempotencyKey: 'refund-request' });
  assertAtomicRejection(fx, () => f.paymentRefund({ actor: 'u:payer', paymentId: row.id, idempotencyKey: 'refund-denied' }), /every affected payee/);
  for (const who of ['creator', 'provider', 'treasury']) f.paymentRefundApprove({ actor: `u:${who}`, paymentId: row.id, idempotencyKey: `refund-approve:${who}` });
  const refunded = f.paymentRefund({ actor: 'u:payer', paymentId: row.id, idempotencyKey: 'refund' });
  assert.equal(refunded.status, 'refunded'); assert.equal(fx.engine.balance('u:payer', 'TUMBO'), before); assert.equal(fx.kernel.proof().conserved, true);
});

test('unfunded, unauthorized, expired and mismatched payment commands fail without advancing domain state', () => {
  const fx = fixture(), f = fx.finance, row = payment(f);
  assertAtomicRejection(fx, () => f.paymentAuthorize({ actor: 'u:provider', paymentId: row.id, idempotencyKey: 'wrong-role' }), /required role/);
  assertAtomicRejection(fx, () => f.paymentFulfill({ actor: 'u:provider', paymentId: row.id, evidence: 'Premature', idempotencyKey: 'premature' }), /requested/);
  assertAtomicRejection(fx, () => f.paymentRequest({ ...row, actor: 'u:creator', amountFluff: 102, idempotencyKey: 'bad-split' }), /exactly equal/);
  fx.setTime(START + 10000);
  assertAtomicRejection(fx, () => f.paymentAuthorize({ actor: 'u:payer', paymentId: row.id, idempotencyKey: 'expired' }), /expired/);
  assert.equal(f.paymentCancel({ actor: 'u:payer', paymentId: row.id, idempotencyKey: 'cancel' }).status, 'cancelled');
  assertAtomicRejection(fx, () => f.paymentCancel({ actor: 'u:payer', paymentId: row.id, idempotencyKey: 'cancel-again' }), /cancelled/);
});

test('an unfunded payer never enters authorization and cannot use a system or purpose account as a role', () => {
  const fx = fixture(), f = fx.finance, p = payment(f);
  fx.kernel.pay({ from: 'u:payer', to: 'u:alice', amountFluff: 100000, idempotencyKey: 'payer-spent' });
  assertAtomicRejection(fx, () => f.paymentAuthorize({ actor: 'u:payer', paymentId: p.id, idempotencyKey: 'unfunded' }), /insufficient/);
  assertAtomicRejection(fx, () => f.orderPlace({ actor: 'sys:treasury', baseAsset: 'sMIMAS', quoteAsset: 'TUMBO', side: 'BUY', lots: 1, lotSizeFluff: 1, priceNumeratorFluff: 1, expiresAt: START + 1000, idempotencyKey: 'system-order' }), /participant/);
  assertAtomicRejection(fx, () => f.loanOffer({ actor: p.escrow, asset: 'TUMBO', collateralAsset: 'sMIMAS', capitalFluff: 1, idempotencyKey: 'purpose-role' }), /participant|escrow/);
});

test('reserved payment cancellation releases funds after expiry; failed refund cannot partially claw back payees', () => {
  const fx = fixture(), f = fx.finance, row = payment(f);
  f.paymentAuthorize({ actor: 'u:payer', paymentId: row.id, idempotencyKey: 'authorize' });
  fx.setTime(START + 10000);
  f.paymentCancel({ actor: 'u:payer', paymentId: row.id, idempotencyKey: 'cancel' });
  assert.equal(fx.engine.balance('u:payer', 'TUMBO'), 100000); assert.equal(fx.engine.balance(row.escrow, 'TUMBO'), 0);
  const other = fixture(), g = other.finance, p = payment(g);
  g.paymentAuthorize({ actor: 'u:payer', paymentId: p.id, idempotencyKey: 'authorize' }); g.paymentFulfill({ actor: 'u:provider', paymentId: p.id, evidence: 'Delivered', idempotencyKey: 'fulfill' });
  g.paymentRefundRequest({ actor: 'u:payer', paymentId: p.id, reason: 'Return', idempotencyKey: 'request-refund' });
  for (const who of ['creator', 'provider', 'treasury']) g.paymentRefundApprove({ actor: `u:${who}`, paymentId: p.id, idempotencyKey: `approve:${who}` });
  other.kernel.pay({ from: 'u:creator', to: 'u:alice', amountFluff: 100071, idempotencyKey: 'creator-spent' });
  assertAtomicRejection(other, () => g.paymentRefund({ actor: 'u:payer', paymentId: p.id, idempotencyKey: 'refund' }), /insufficient/);
  assert.equal(other.engine.balance('u:provider', 'TUMBO'), 100020);
});

test('purpose escrow cannot impersonate participant and treasury operations splits use only explicit affected-role refunds', () => {
  const fx = fixture(), f = fx.finance;
  assert.throws(() => fx.kernel.pay({ from: 'b:econ-pay-private', to: 'u:alice', amountFluff: 1, idempotencyKey: 'sweep' }), /participant/);
  const p = f.paymentRequest({ actor: 'u:creator', payer: 'u:payer', creator: 'u:creator', provider: 'u:provider', treasury: ECONOMIC_POOLS.operations,
    amountFluff: 10, creatorFluff: 7, providerFluff: 2, treasuryFluff: 1, expiresAt: START + 1000, refundUntil: START + 2000, terms: 'Funded operations share', idempotencyKey: 'pool-payment' });
  f.paymentAuthorize({ actor: 'u:payer', paymentId: p.id, idempotencyKey: 'authorize' }); f.paymentFulfill({ actor: 'u:provider', paymentId: p.id, evidence: 'Delivered', idempotencyKey: 'deliver' });
  assert.equal(fx.kernel.balance(ECONOMIC_POOLS.operations), 1);
  f.paymentRefundRequest({ actor: 'u:payer', paymentId: p.id, reason: 'Returned', idempotencyKey: 'refund-request' });
  assert.equal(f.snapshot().obligations.find(o => o.kind === 'payment-refund-request').segregated, false);
  for (const who of ['u:creator', 'u:provider', ECONOMIC_POOLS.operations]) f.paymentRefundApprove({ actor: who, paymentId: p.id, idempotencyKey: `approval:${who}` });
  assert.equal(f.snapshot().obligations.find(o => o.kind === 'payment-refund-request').approvalComplete, true);
  f.paymentRefund({ actor: 'u:payer', paymentId: p.id, idempotencyKey: 'refund' }); assert.equal(fx.kernel.balance(ECONOMIC_POOLS.operations), 0);
});

test('two-asset partial matching executes at the older price and atomically releases buyer price improvement', () => {
  const fx = fixture(), f = fx.finance, sell = order(f, 'SELL', 'sell'), buy = order(f, 'BUY', 'buy');
  assert.equal(fx.engine.balance(sell.escrow, 'sMIMAS'), 60); assert.equal(fx.engine.balance(buy.escrow, 'TUMBO'), 15);
  const count = fx.engine.ledger.journalCount();
  const input = { actor: 'u:buyer', buyOrderId: buy.id, sellOrderId: sell.id, lots: 2, idempotencyKey: 'match' }, match = f.orderMatch(input);
  assert.equal(match.quoteFluff, 4); assert.equal(match.releasedFluff, 1); assert.equal(match.priceOrderId, sell.id); assert.equal(fx.engine.ledger.journalCount(), count + 1);
  assert.equal(f.orderMatch(input), match); assert.equal(fx.engine.balance('u:buyer', 'sMIMAS'), 20);
  assert.equal(fx.engine.balance(buy.escrow, 'TUMBO'), 10); assert.equal(fx.engine.balance(sell.escrow, 'sMIMAS'), 40);
  f.orderCancel({ actor: 'u:buyer', orderId: buy.id, idempotencyKey: 'cancel-buy' }); f.orderCancel({ actor: 'u:seller', orderId: sell.id, idempotencyKey: 'cancel-sell' });
  assert.equal(fx.engine.balance('u:buyer', 'TUMBO'), 99996); assert.equal(fx.kernel.proof().conserved, true);
});

test('rational prices require exact matched quote lots and reject non-crossing, wrong-role and expired trades', () => {
  const fx = fixture(), f = fx.finance, sell = order(f, 'SELL', 'sell', { priceNumeratorFluff: 1, priceDenominatorLots: 3 }), buy = order(f, 'BUY', 'buy');
  assertAtomicRejection(fx, () => f.orderMatch({ actor: 'u:buyer', buyOrderId: buy.id, sellOrderId: sell.id, lots: 1, idempotencyKey: 'fraction' }), /integer quote/);
  assertAtomicRejection(fx, () => f.orderMatch({ actor: 'u:alice', buyOrderId: buy.id, sellOrderId: sell.id, lots: 3, idempotencyKey: 'stranger' }), /participant/);
  const matched = f.orderMatch({ actor: 'u:seller', buyOrderId: buy.id, sellOrderId: sell.id, lots: 3, idempotencyKey: 'exact' }); assert.equal(matched.quoteFluff, 1);
  fx.setTime(START + 10000);
  assertAtomicRejection(fx, () => f.orderMatch({ actor: 'u:buyer', buyOrderId: buy.id, sellOrderId: sell.id, lots: 3, idempotencyKey: 'expired' }), /Expired/);
  const other = fixture(), sellHigh = order(other.finance, 'SELL', 'sell', { priceNumeratorFluff: 100 }), buyLow = order(other.finance, 'BUY', 'buy');
  assertAtomicRejection(other, () => other.finance.orderMatch({ actor: 'u:buyer', buyOrderId: buyLow.id, sellOrderId: sellHigh.id, lots: 2, idempotencyKey: 'no-cross' }), /do not cross/);
});

test('large rational intermediate multiplication stays exact; unfunded and overflowing reservations fail before posting', () => {
  const fx = fixture(), f = fx.finance;
  const large = order(f, 'BUY', 'large', { lots: 999, lotSizeFluff: 1, priceNumeratorFluff: 9000000000000001, priceDenominatorLots: 9000000000000000 });
  assert.equal(large.reservedFluff, 1000);
  assertAtomicRejection(fx, () => order(f, 'SELL', 'overflow', { lots: Number.MAX_SAFE_INTEGER, lotSizeFluff: 2 }), /exact integer range/);
  assertAtomicRejection(fx, () => order(f, 'BUY', 'unfunded', { priceNumeratorFluff: 1000000 }), /insufficient/);
  assertAtomicRejection(fx, () => order(f, 'BUY', 'nan', { lots: NaN }), /finite/);
});

test('a loan consumes only explicit lender capital and returns collateral with full principal plus fixed interest', () => {
  const fx = fixture(), f = fx.finance; observe(f); const o = offer(f), lenderBefore = fx.engine.balance('u:lender', 'TUMBO'), collateralBefore = fx.engine.balance('u:borrower', 'sMIMAS');
  const count = fx.engine.ledger.journalCount(), loan = f.loanBorrow({ actor: 'u:borrower', offerId: o.id, principalFluff: 100, collateralFluff: 100, idempotencyKey: 'borrow' });
  assert.equal(loan.debtFluff, 110); assert.equal(fx.engine.ledger.journalCount(), count + 1); assert.equal(fx.engine.balance(o.escrow, 'TUMBO'), 900);
  assert.equal(fx.engine.balance(loan.escrow, 'sMIMAS'), 100); assert.equal(f.snapshot().obligations.filter(o => o.covered === false).length, 0);
  f.loanRepay({ actor: 'u:borrower', loanId: loan.id, amountFluff: 50, idempotencyKey: 'repay-part' }); assert.equal(fx.engine.balance(loan.escrow, 'sMIMAS'), 100);
  const repaid = f.loanRepay({ actor: 'u:borrower', loanId: loan.id, amountFluff: 60, idempotencyKey: 'repay-full' });
  assert.equal(repaid.status, 'repaid'); assert.equal(fx.engine.balance('u:borrower', 'sMIMAS'), collateralBefore); assert.equal(fx.engine.balance('u:lender', 'TUMBO'), lenderBefore + 110);
  f.loanOfferCancel({ actor: 'u:lender', offerId: o.id, idempotencyKey: 'offer-cancel' }); assert.equal(fx.engine.balance('u:lender', 'TUMBO'), 100010); assert.equal(fx.kernel.proof().conserved, true);
});

test('oracle-sensitive borrowing fails closed for unknown, stale, conflicting and dependent observations', () => {
  const fx = fixture(), f = fx.finance, o = offer(f);
  const borrow = key => f.loanBorrow({ actor: 'u:borrower', offerId: o.id, principalFluff: 100, collateralFluff: 100, idempotencyKey: key });
  assertAtomicRejection(fx, () => borrow('unknown'), /Unknown or stale/);
  observe(f); fx.setTime(START + 1001); assertAtomicRejection(fx, () => borrow('stale'), /Unknown or stale/);
  f.oracleObserve({ actor: 'b:oracle-a', source: 'a', baseAsset: 'sMIMAS', quoteAsset: 'TUMBO', numerator: 2, denominator: 1, observedAt: fx.now(), evidence: 'Local updated fixture', idempotencyKey: 'new-a' });
  f.oracleObserve({ actor: 'b:oracle-b', source: 'b', baseAsset: 'sMIMAS', quoteAsset: 'TUMBO', numerator: 3, denominator: 1, observedAt: fx.now(), evidence: 'Conflicting local fixture', idempotencyKey: 'new-b' });
  assertAtomicRejection(fx, () => borrow('conflict'), /disagree/);
  assertAtomicRejection(fx, () => offer(f, { idempotencyKey: 'dependent', oracle: { ...policy, sources: [{ source: 'a', observer: 'u:lender' }, { source: 'b', observer: 'b:oracle-b' }] } }), /independent/);
  assertAtomicRejection(fx, () => f.oracleObserve({ actor: 'b:oracle-a', source: 'future', baseAsset: 'sMIMAS', quoteAsset: 'TUMBO', numerator: 1, denominator: 1, observedAt: fx.now() + 1, evidence: 'Future fixture', idempotencyKey: 'future' }), /Future/);
});

test('APR interest uses exact term fractions and lender-specific offers cannot use another lender capital', () => {
  const fx = fixture(), f = fx.finance; observe(f); const o = offer(f, { capitalFluff: 10000, interestKind: 'APR', aprBps: 1250, termMs: YEAR / 2 });
  const loan = f.loanBorrow({ actor: 'u:borrower', offerId: o.id, principalFluff: 101, collateralFluff: 101, idempotencyKey: 'borrow' }); assert.equal(loan.interestFluff, 7);
  assertAtomicRejection(fx, () => f.loanBorrow({ actor: 'u:borrower', offerId: o.id, principalFluff: 9900, collateralFluff: 10000, idempotencyKey: 'over-offer' }), /lender-specific/);
  assertAtomicRejection(fx, () => f.loanOfferCancel({ actor: 'u:alice', offerId: o.id, idempotencyKey: 'wrong-lender' }), /required role/);
  assertAtomicRejection(fx, () => f.loanBorrow({ actor: 'u:borrower', offerId: o.id, principalFluff: 100, collateralFluff: 1, idempotencyKey: 'bad-ltv' }), /maximum LTV/);
});

test('complete promised interest must be collateral covered before origination and arithmetic overflow cannot post', () => {
  const fx = fixture(), f = fx.finance; observe(f); const o = offer(f, { fixedInterestFluff: 101 });
  assertAtomicRejection(fx, () => f.loanBorrow({ actor: 'u:borrower', offerId: o.id, principalFluff: 100, collateralFluff: 100, idempotencyKey: 'uncovered-interest' }), /complete agreed interest/);
  const huge = offer(f, { fixedInterestFluff: Number.MAX_SAFE_INTEGER, idempotencyKey: 'huge-interest' });
  assertAtomicRejection(fx, () => f.loanBorrow({ actor: 'u:borrower', offerId: huge.id, principalFluff: 100, collateralFluff: 100, idempotencyKey: 'overflow-debt' }), /exact integer range/);
});

test('maturity default requires its deadline, liquidation returns excess collateral and residual debt stays explicit', () => {
  const fx = fixture(), f = fx.finance; observe(f); const o = offer(f), loan = f.loanBorrow({ actor: 'u:borrower', offerId: o.id, principalFluff: 100, collateralFluff: 100, idempotencyKey: 'borrow' });
  assertAtomicRejection(fx, () => f.loanDefault({ actor: 'u:lender', loanId: loan.id, reason: 'maturity', idempotencyKey: 'early' }), /deadline/);
  fx.setTime(loan.dueAt); f.loanDefault({ actor: 'u:lender', loanId: loan.id, reason: 'maturity', idempotencyKey: 'default' });
  assertAtomicRejection(fx, () => f.loanLiquidate({ actor: 'u:lender', loanId: loan.id, idempotencyKey: 'stale-liquidate' }), /Unknown or stale/);
  observe(f, fx.now(), 2, 1, ':fresh'); const count = fx.engine.ledger.journalCount();
  const liquidated = f.loanLiquidate({ actor: 'u:lender', loanId: loan.id, idempotencyKey: 'liquidate' });
  assert.equal(liquidated.seizedCollateralFluff, 55); assert.equal(liquidated.returnedCollateralFluff, 45); assert.equal(liquidated.remainingDebtFluff, 0); assert.equal(fx.engine.ledger.journalCount(), count + 1);
  const other = fixture(), g = other.finance; observe(g); const offer2 = offer(g), l = g.loanBorrow({ actor: 'u:borrower', offerId: offer2.id, principalFluff: 100, collateralFluff: 100, idempotencyKey: 'borrow' });
  other.setTime(START + 100); observe(g, other.now(), 1, 2, ':drop'); g.loanDefault({ actor: 'u:lender', loanId: l.id, reason: 'margin', idempotencyKey: 'margin' });
  const loss = g.loanLiquidate({ actor: 'u:lender', loanId: l.id, idempotencyKey: 'liquidate' }); assert.equal(loss.remainingDebtFluff, 60); assert.equal(loss.seizedCollateralFluff, 100);
  const debt = g.snapshot().obligations.find(o => o.kind === 'borrower-debt'); assert.equal(debt.amountFluff, 60); assert.equal(debt.secured, false);
  assert.equal(g.loanRepay({ actor: 'u:borrower', loanId: l.id, amountFluff: 60, idempotencyKey: 'residual-repay' }).status, 'repaid');
});

test('extremely small oracle ratios transfer bounded collateral instead of overflowing a theoretical seizure', () => {
  const fx = fixture(), f = fx.finance; observe(f); const o = offer(f), loan = f.loanBorrow({ actor: 'u:borrower', offerId: o.id, principalFluff: 100, collateralFluff: 100, idempotencyKey: 'borrow' });
  fx.setTime(START + 100); observe(f, fx.now(), 1, Number.MAX_SAFE_INTEGER, ':tiny');
  f.loanDefault({ actor: 'u:lender', loanId: loan.id, reason: 'margin', idempotencyKey: 'default' });
  const result = f.loanLiquidate({ actor: 'u:lender', loanId: loan.id, idempotencyKey: 'liquidate' }); assert.equal(result.seizedCollateralFluff, 100); assert.equal(result.remainingDebtFluff, 110);
});

test('binary markets segregate maximum liability and distribute the entire pool with deterministic integer remainders', () => {
  const fx = fixture(), f = fx.finance, m = market(f);
  stake(f, m, 'u:alice', 'YES', 1, 'alice'); stake(f, m, 'u:bob', 'YES', 2, 'bob'); stake(f, m, 'u:carol', 'NO', 7, 'carol');
  const obligation = f.snapshot().obligations.find(o => o.id === m.id); assert.equal(obligation.amountFluff, 10); assert.equal(obligation.covered, true);
  fx.setTime(START + 2000); const p = propose(f, m); approvals(f, p);
  assertAtomicRejection(fx, () => f.predictionFinalize({ actor: 'u:creator', marketId: m.id, proposalId: p.proposal.id, idempotencyKey: 'early-finalize' }), /challenge window/);
  fx.setTime(START + 3000); const count = fx.engine.ledger.journalCount(), input = { actor: 'u:creator', marketId: m.id, proposalId: p.proposal.id, idempotencyKey: 'finalize' }, finalized = f.predictionFinalize(input);
  assert.equal(finalized.outcome, 'YES'); assert.equal(finalized.payouts.reduce((n, p) => n + p.amountFluff, 0), 10); assert.deepEqual(finalized.payouts.map(p => p.amountFluff).sort((a, b) => a - b), [3, 7]);
  assert.equal(fx.engine.balance(m.escrow, 'TUMBO'), 0); assert.equal(fx.engine.ledger.journalCount(), count + 1); assert.equal(f.predictionFinalize(input), finalized); assert.equal(fx.kernel.proof().conserved, true);
  assertAtomicRejection(fx, () => f.predictionFinalize({ ...input, idempotencyKey: 'double-finalize' }), /finalized/);
});

test('evidence challenge clears both approvals; resolution needs two independent roles on the replacement proposal', () => {
  const fx = fixture(), f = fx.finance, m = market(f); stake(f, m, 'u:alice', 'YES', 10, 'stake'); fx.setTime(START + 2000);
  const p = propose(f, m); approvals(f, p);
  f.predictionChallenge({ actor: 'u:alice', marketId: m.id, proposalId: p.proposal.id, reason: 'Evidence contradicts immutable terms', idempotencyKey: 'challenge' });
  assertAtomicRejection(fx, () => f.predictionFinalize({ actor: 'u:creator', marketId: m.id, proposalId: p.proposal.id, idempotencyKey: 'challenged-finalize' }), /challenged/);
  const revised = propose(f, m, 'INVALID', 'revised'); assert.equal(revised.proposal.approvals.length, 0);
  assertAtomicRejection(fx, () => f.predictionApprove({ actor: 'b:reviewer', marketId: m.id, proposalId: p.proposal.id, idempotencyKey: 'stale-approval' }), /exact proposal/);
  f.predictionApprove({ actor: 'b:resolver', marketId: m.id, proposalId: revised.proposal.id, idempotencyKey: 'one-approval' }); fx.setTime(START + 3000);
  assertAtomicRejection(fx, () => f.predictionFinalize({ actor: 'u:creator', marketId: m.id, proposalId: revised.proposal.id, idempotencyKey: 'one-role' }), /both/);
  f.predictionApprove({ actor: 'b:reviewer', marketId: m.id, proposalId: revised.proposal.id, idempotencyKey: 'second-approval' });
  const result = f.predictionFinalize({ actor: 'u:creator', marketId: m.id, proposalId: revised.proposal.id, idempotencyKey: 'refund' });
  assert.equal(result.refunded, true); assert.equal(fx.engine.balance('u:alice', 'TUMBO'), 100000);
});

test('INVALID and no-winner outcomes refund every stake exactly, with no treasury subsidy or unfunded liability', () => {
  for (const proposedOutcome of ['INVALID', 'NO']) {
    const fx = fixture(), f = fx.finance, m = market(f); stake(f, m, 'u:alice', 'YES', 101, 'a'); stake(f, m, 'u:alice', 'YES', 2, 'a2');
    fx.setTime(START + 2000); const p = propose(f, m, proposedOutcome); approvals(f, p); fx.setTime(START + 3000);
    const result = f.predictionFinalize({ actor: 'u:creator', marketId: m.id, proposalId: p.proposal.id, idempotencyKey: 'final' });
    assert.equal(result.outcome, 'INVALID'); assert.equal(result.payouts.reduce((sum, s) => sum + s.amountFluff, 0), 103); assert.equal(fx.engine.balance('u:alice', 'TUMBO'), 100000);
    const receipt = fx.engine.ledger._receipts.get(result.receiptKey); assert.equal(receipt.postings.length, 2); assert.equal(receipt.postings.some(p => p.account.startsWith('sys:')), false);
  }
});

test('late stakes, resolver stakes, duplicate role approvals and outcome changes fail closed', () => {
  const fx = fixture(), f = fx.finance, m = market(f);
  assertAtomicRejection(fx, () => stake(f, m, 'b:resolver', 'YES', 1, 'resolver-stake'), /resolution role/);
  assertAtomicRejection(fx, () => f.predictionCreate({ actor: 'u:creator', resolver: 'b:same', reviewer: 'b:same', question: 'Bad', evidenceSpec: 'Bad', closeAt: START + 1, resolutionAt: START + 2, challengeMs: 1, idempotencyKey: 'same-roles' }), /independent/);
  fx.setTime(START + 1000); assertAtomicRejection(fx, () => stake(f, m, 'u:alice', 'YES', 1, 'late'), /closed/);
  fx.setTime(START + 2000); const p = propose(f, m); f.predictionApprove({ actor: 'b:resolver', marketId: m.id, proposalId: p.proposal.id, idempotencyKey: 'approve' });
  assertAtomicRejection(fx, () => f.predictionApprove({ actor: 'b:resolver', marketId: m.id, proposalId: p.proposal.id, idempotencyKey: 'approve-again' }), /new independent role/);
  assertAtomicRejection(fx, () => propose(f, m, 'NO', 'change-outcome'), /immutable/);
});

test('all financial records and obligations are immutable and command keys bind every economic field', () => {
  const fx = fixture(), f = fx.finance, row = payment(f), before = fx.kernel.snapshot().commandCount;
  assert.throws(() => { row.creatorFluff = 0; }, TypeError); assert.throws(() => { f.snapshot().payments.push(row); }, TypeError);
  assertAtomicRejection(fx, () => f.paymentRequest({ actor: 'u:creator', payer: 'u:payer', creator: 'u:creator', provider: 'u:provider', treasury: 'u:treasury', amountFluff: 101, creatorFluff: 70, providerFluff: 21, treasuryFluff: 10, expiresAt: START + 10000, refundUntil: START + 20000, terms: 'One delivered local artifact', idempotencyKey: 'request' }), /IDEM_MISMATCH/);
  assert.equal(fx.kernel.snapshot().commandCount, before); assert.equal(f.snapshot().externalSettlement, false); assert.equal(f.snapshot().productionAdapters.authentication, 'unsupported');
});

test('all four domain lifecycles restore against the paired ledger without a second debit or altered evidence', () => {
  const fx = fixture(), f = fx.finance, p = payment(f); f.paymentAuthorize({ actor: 'u:payer', paymentId: p.id, idempotencyKey: 'authorize' });
  const sell = order(f, 'SELL', 'sell'), buy = order(f, 'BUY', 'buy'); f.orderMatch({ actor: 'u:buyer', buyOrderId: buy.id, sellOrderId: sell.id, lots: 2, idempotencyKey: 'match' });
  observe(f); const o = offer(f), loan = f.loanBorrow({ actor: 'u:borrower', offerId: o.id, principalFluff: 100, collateralFluff: 100, idempotencyKey: 'borrow' });
  f.loanRepay({ actor: 'u:borrower', loanId: loan.id, amountFluff: 20, idempotencyKey: 'repay' });
  const m = market(f); stake(f, m, 'u:alice', 'YES', 3, 'yes'); stake(f, m, 'u:bob', 'NO', 5, 'no');
  fx.setTime(START + 2000); const proposed = propose(f, m); approvals(f, proposed); fx.setTime(START + 3000);
  f.predictionFinalize({ actor: 'u:creator', marketId: m.id, proposalId: proposed.proposal.id, idempotencyKey: 'finalize' });
  // An unrelated participant spend leaves much less cash than early command-time balances.
  fx.kernel.pay({ from: 'u:borrower', to: 'u:alice', amountFluff: 90000, idempotencyKey: 'spend-after-loan' });
  fx.kernel.pay({ from: 'u:alice', to: 'u:carol', amountFluff: 150000, idempotencyKey: 'spend-after-win' });
  const restoredEngine = loadTokenEngine(serializeTokenEngine(fx.engine)), kernel = createEconomicKernel({ engine: restoredEngine, clock: () => 1 }), finance = createEconomicFinance(kernel), count = restoredEngine.ledger.journalCount();
  kernel.restore(fx.kernel.exportState()); assert.equal(restoredEngine.ledger.journalCount(), count); assert.deepEqual(finance.snapshot(), f.snapshot()); assert.equal(kernel.snapshot().eventRoot, fx.kernel.snapshot().eventRoot); assert.deepEqual(kernel.proof(), fx.kernel.proof());
});

test('closed refunds, filled orders, margin loss and challenged invalid resolution replay with their exact terminal states', () => {
  const fx = fixture(), f = fx.finance, p = payment(f);
  f.paymentAuthorize({ actor: 'u:payer', paymentId: p.id, idempotencyKey: 'authorize' }); f.paymentFulfill({ actor: 'u:provider', paymentId: p.id, evidence: 'Delivered local result', idempotencyKey: 'deliver' });
  f.paymentRefundRequest({ actor: 'u:payer', paymentId: p.id, reason: 'Returned', idempotencyKey: 'request-refund' });
  for (const who of ['creator', 'provider', 'treasury']) f.paymentRefundApprove({ actor: `u:${who}`, paymentId: p.id, idempotencyKey: `refund-approve:${who}` });
  f.paymentRefund({ actor: 'u:payer', paymentId: p.id, idempotencyKey: 'refund' });
  const sell = order(f, 'SELL', 'sell'), buy = order(f, 'BUY', 'buy'); f.orderMatch({ actor: 'u:seller', buyOrderId: buy.id, sellOrderId: sell.id, lots: 6, idempotencyKey: 'fill' });
  observe(f); const o = offer(f), l = f.loanBorrow({ actor: 'u:borrower', offerId: o.id, principalFluff: 100, collateralFluff: 100, idempotencyKey: 'borrow' });
  fx.setTime(START + 100); observe(f, fx.now(), 1, 2, ':decline'); f.loanDefault({ actor: 'u:lender', loanId: l.id, reason: 'margin', idempotencyKey: 'default' });
  f.loanLiquidate({ actor: 'u:lender', loanId: l.id, idempotencyKey: 'liquidate' });
  const m = market(f); stake(f, m, 'u:alice', 'YES', 17, 'stake'); fx.setTime(START + 2000); const proposed = propose(f, m); approvals(f, proposed);
  f.predictionChallenge({ actor: 'u:alice', marketId: m.id, proposalId: proposed.proposal.id, reason: 'Fixture evidence invalid', idempotencyKey: 'challenge' });
  const revised = propose(f, m, 'INVALID', 'revised'); approvals(f, revised, ':revised'); fx.setTime(START + 3000);
  f.predictionFinalize({ actor: 'u:creator', marketId: m.id, proposalId: revised.proposal.id, idempotencyKey: 'finalize' });
  fx.kernel.pay({ from: 'u:provider', to: 'u:alice', amountFluff: 100000, idempotencyKey: 'provider-later-spend' });
  const restoredEngine = loadTokenEngine(serializeTokenEngine(fx.engine)), kernel = createEconomicKernel({ engine: restoredEngine, clock: () => 0 }), finance = createEconomicFinance(kernel), count = restoredEngine.ledger.journalCount();
  kernel.restore(fx.kernel.exportState()); assert.deepEqual(finance.snapshot(), f.snapshot()); assert.equal(restoredEngine.ledger.journalCount(), count); assert.equal(kernel.snapshot().eventRoot, fx.kernel.snapshot().eventRoot);
  assert.equal(finance.snapshot().payments[0].status, 'refunded'); assert.equal(finance.snapshot().orders.every(o => o.status === 'filled'), true); assert.equal(finance.snapshot().loans[0].remainingDebtFluff, 60);
});

test('reservation coverage exposes an externally disturbed local ledger and settlement fails atomically', () => {
  const fx = fixture(), f = fx.finance, m = market(f); stake(f, m, 'u:alice', 'YES', 10, 'stake');
  // Public/raw posts now require the owner-issued economic capability, including internal authority.
  assert.throws(() => fx.engine.ledger.post([{ account: m.escrow, asset: 'TUMBO', amount: -1 }, { account: 'u:bob', asset: 'TUMBO', amount: 1 }], { idempotencyKey: 'adversarial-disturbance', authority: 'internal' }), /economic custody/);
  // Explicit private-state fault injection exercises disclosure after corruption outside every API.
  fx.engine.ledger._balances.set(`${m.escrow}|TUMBO`, 9);
  fx.engine.ledger._balances.set('u:bob|TUMBO', fx.engine.balance('u:bob', 'TUMBO') + 1);
  const liability = f.snapshot().obligations.find(o => o.id === m.id); assert.equal(liability.covered, false); assert.equal(liability.shortfallFluff, 1);
  fx.setTime(START + 2000); const p = propose(f, m); approvals(f, p); fx.setTime(START + 3000);
  assertAtomicRejection(fx, () => f.predictionFinalize({ actor: 'u:creator', marketId: m.id, proposalId: p.proposal.id, idempotencyKey: 'unfunded-payout' }), /insufficient/);
});

test('entity, stake and oracle source capacity is bounded without uncommitted state changes', () => {
  const fx = fixture(), f = fx.finance;
  for (let i = 0; i < 256; i += 1) f.paymentRequest({ actor: 'u:creator', payer: 'u:payer', creator: 'u:creator', provider: 'u:provider', treasury: 'u:treasury', amountFluff: 1, creatorFluff: 1, providerFluff: 0, treasuryFluff: 0, expiresAt: START + 10000, refundUntil: START + 20000, terms: 'Bounded metadata fixture', idempotencyKey: `payment:${i}` });
  assertAtomicRejection(fx, () => payment(f), /capacity/);
  const m = market(f);
  for (let i = 0; i < 128; i += 1) stake(f, m, 'u:alice', 'YES', 1, `stake:${i}`);
  assertAtomicRejection(fx, () => stake(f, m, 'u:alice', 'NO', 1, 'stake-overflow'), /capacity/);
  for (let i = 0; i < 16; i += 1) f.oracleObserve({ actor: `b:observer-${i}`, source: `source-${i}`, baseAsset: 'sMIMAS', quoteAsset: 'TUMBO', numerator: 1, denominator: 10, observedAt: START, evidence: 'Bounded local fixture', idempotencyKey: `source:${i}` });
  assertAtomicRejection(fx, () => f.oracleObserve({ actor: 'b:observer-17', source: 'source-17', baseAsset: 'sMIMAS', quoteAsset: 'TUMBO', numerator: 1, denominator: 10, observedAt: START, evidence: 'Over capacity fixture', idempotencyKey: 'source-overflow' }), /capacity/);
});

test('remainder allocation conserves every funded pool across uneven stake distributions', () => {
  for (let a = 1; a <= 6; a += 1) for (let b = 1; b <= 4; b += 1) {
    const fx = fixture(), f = fx.finance, m = market(f); stake(f, m, 'u:alice', 'YES', a, 'a'); stake(f, m, 'u:bob', 'YES', b, 'b'); stake(f, m, 'u:carol', 'NO', 7, 'c');
    fx.setTime(START + 2000); const p = propose(f, m); approvals(f, p); fx.setTime(START + 3000);
    const result = f.predictionFinalize({ actor: 'u:creator', marketId: m.id, proposalId: p.proposal.id, idempotencyKey: 'final' });
    assert.equal(result.payouts.reduce((n, p) => n + p.amountFluff, 0), a + b + 7); assert.equal(fx.engine.balance(m.escrow, 'TUMBO'), 0); assert.equal(fx.kernel.proof().conserved, true);
  }
});

test('generic token reversal cannot claw back delivered service splits outside approved finance refunds', () => {
  const fx = fixture(), f = fx.finance, p = payment(f);
  f.paymentAuthorize({ actor: 'u:payer', paymentId: p.id, idempotencyKey: 'authorize' });
  const delivered = f.paymentFulfill({ actor: 'u:provider', paymentId: p.id, evidence: 'Delivered local fixture', idempotencyKey: 'deliver' });
  assertAtomicRejection(fx, () => fx.engine.reverse({ idempotencyKey: delivered.receiptKey, actor: 'u:payer' }), /economic|owning domain/i);
  assert.equal(fx.engine.balance(p.escrow, 'TUMBO'), 0);
  assert.equal(fx.engine.balance('u:creator', 'TUMBO'), 100071);
  f.paymentRefundRequest({ actor: 'u:payer', paymentId: p.id, reason: 'Agreed local return', idempotencyKey: 'request-refund' });
  for (const who of ['creator', 'provider', 'treasury'])
    f.paymentRefundApprove({ actor: `u:${who}`, paymentId: p.id, idempotencyKey: `approve:${who}` });
  assert.equal(f.paymentRefund({ actor: 'u:payer', paymentId: p.id, idempotencyKey: 'refund' }).status, 'refunded');
  assert.equal(fx.engine.balance('u:payer', 'TUMBO'), 100000);
});

test('generic token reversal cannot return filled assets while leaving spot reservations partially consumed', () => {
  const fx = fixture(), f = fx.finance, sell = order(f, 'SELL', 'sell'), buy = order(f, 'BUY', 'buy');
  const fill = f.orderMatch({ actor: 'u:buyer', buyOrderId: buy.id, sellOrderId: sell.id, lots: 2, idempotencyKey: 'match' });
  assertAtomicRejection(fx, () => fx.engine.reverse({ journalId: fill.receiptId, actor: 'u:seller' }), /economic|owning domain/i);
  assert.equal(fx.engine.balance('u:buyer', 'sMIMAS'), 20);
  assert.equal(fx.engine.balance(buy.escrow, 'TUMBO'), 10);
  assert.equal(fx.engine.balance(sell.escrow, 'sMIMAS'), 40);
  f.orderCancel({ actor: 'u:buyer', orderId: buy.id, idempotencyKey: 'cancel-buy' });
  f.orderCancel({ actor: 'u:seller', orderId: sell.id, idempotencyKey: 'cancel-sell' });
  assert.equal(fx.engine.balance('u:buyer', 'TUMBO'), 99996);
});

test('generic token reversal cannot erase a debt repayment or recreate discharged collateral', () => {
  const fx = fixture(), f = fx.finance; observe(f); const o = offer(f);
  const loan = f.loanBorrow({ actor: 'u:borrower', offerId: o.id, principalFluff: 100, collateralFluff: 100, idempotencyKey: 'borrow' });
  const partial = f.loanRepay({ actor: 'u:borrower', loanId: loan.id, amountFluff: 50, idempotencyKey: 'repay-part' });
  // A partial repayment has no purpose debit, so escrow-only firewall checks cannot protect it.
  assertAtomicRejection(fx, () => fx.engine.reverse({ idempotencyKey: partial.receiptKey, actor: 'u:borrower' }), /economic|owning domain/i);
  assert.equal(f.snapshot().loans[0].remainingDebtFluff, 60);
  const final = f.loanRepay({ actor: 'u:borrower', loanId: loan.id, amountFluff: 60, idempotencyKey: 'repay-full' });
  assertAtomicRejection(fx, () => fx.engine.reverse({ idempotencyKey: final.receiptKey, actor: 'u:lender' }), /economic|owning domain/i);
  assert.equal(f.snapshot().loans[0].status, 'repaid');
  assert.equal(fx.engine.balance(loan.escrow, 'sMIMAS'), 0);
});

test('generic token reversal cannot revoke a finalized prediction payout while keeping its terminal outcome', () => {
  const fx = fixture(), f = fx.finance, m = market(f);
  stake(f, m, 'u:alice', 'YES', 3, 'yes'); stake(f, m, 'u:bob', 'NO', 5, 'no');
  fx.setTime(START + 2000); const p = propose(f, m); approvals(f, p); fx.setTime(START + 3000);
  const finalized = f.predictionFinalize({ actor: 'u:creator', marketId: m.id, proposalId: p.proposal.id, idempotencyKey: 'finalize' });
  assertAtomicRejection(fx, () => fx.engine.reverse({ idempotencyKey: finalized.receiptKey, actor: 'u:bob' }), /economic|owning domain/i);
  assert.equal(fx.engine.balance('u:alice', 'TUMBO'), 100005);
  assert.equal(fx.engine.balance(m.escrow, 'TUMBO'), 0);
  assert.equal(f.snapshot().markets[0].status, 'finalized');
});

test('ledger observers cannot cancel reserves or challenge a proposal while its finance settlement commits', () => {
  const fx = fixture(), f = fx.finance, sell = order(f, 'SELL', 'sell'), buy = order(f, 'BUY', 'buy'), attempts = [];
  const offFill = fx.engine.ledger.onCommit(receipt => {
    if (receipt.action !== 'economic:finance.order.match') return;
    try { f.orderCancel({ actor: 'u:buyer', orderId: buy.id, idempotencyKey: 'observer-cancel' }); }
    catch (error) { attempts.push(error.message); }
  });
  const count = fx.engine.ledger.journalCount();
  f.orderMatch({ actor: 'u:buyer', buyOrderId: buy.id, sellOrderId: sell.id, lots: 2, idempotencyKey: 'match' });
  offFill();
  assert.equal(fx.engine.ledger.journalCount(), count + 1);
  assert.equal(attempts.length, 1); assert.match(attempts[0], /re-enter/);
  assert.equal(f.snapshot().orders.find(row => row.id === buy.id).remainingLots, 4);
  assert.equal(f.snapshot().obligations.every(row => row.covered !== false), true);
  const m = market(f); stake(f, m, 'u:alice', 'YES', 3, 'yes');
  fx.setTime(START + 2000); const p = propose(f, m); approvals(f, p); fx.setTime(START + 3000);
  const offPayout = fx.engine.ledger.onCommit(receipt => {
    if (receipt.action !== 'economic:finance.prediction.finalize') return;
    try { f.predictionChallenge({ actor: 'u:alice', marketId: m.id, proposalId: p.proposal.id, reason: 'Observer challenge', idempotencyKey: 'observer-challenge' }); }
    catch (error) { attempts.push(error.message); }
  });
  f.predictionFinalize({ actor: 'u:creator', marketId: m.id, proposalId: p.proposal.id, idempotencyKey: 'finalize' });
  offPayout();
  assert.equal(attempts.length, 2); assert.match(attempts[1], /re-enter/);
  assert.equal(f.snapshot().markets[0].status, 'finalized');
  assert.equal(fx.engine.balance(m.escrow, 'TUMBO'), 0);
});

test('a valid finance history prefix cannot erase a payout while retaining its newer paired canonical journal', () => {
  const fx = fixture(), f = fx.finance, m = market(f);
  stake(f, m, 'u:alice', 'YES', 3, 'yes'); stake(f, m, 'u:bob', 'NO', 5, 'no');
  fx.setTime(START + 2000); const p = propose(f, m); approvals(f, p); fx.setTime(START + 3000);
  const prefix = fx.kernel.exportState();
  f.predictionFinalize({ actor: 'u:creator', marketId: m.id, proposalId: p.proposal.id, idempotencyKey: 'finalize' });
  const engine = loadTokenEngine(serializeTokenEngine(fx.engine)), kernel = createEconomicKernel({ engine, clock: () => 0 }), finance = createEconomicFinance(kernel);
  const count = engine.ledger.journalCount();
  assert.throws(() => kernel.restore(prefix), /missing its domain command/);
  assert.equal(engine.ledger.journalCount(), count);
  assert.equal(finance.snapshot().markets.length, 0);
  assert.equal(kernel.snapshot().commandCount, 0);
  assert.equal(engine.balance('u:alice', 'TUMBO'), 100005);
});

test('paired finance replay rejects historical generic reversals of economics-owned journals', () => {
  const fx = fixture(), f = fx.finance, p = payment(f);
  f.paymentAuthorize({ actor: 'u:payer', paymentId: p.id, idempotencyKey: 'authorize' });
  const delivered = f.paymentFulfill({ actor: 'u:provider', paymentId: p.id, evidence: 'Delivered local fixture', idempotencyKey: 'deliver' });
  const original = fx.engine.ledger._receipts.get(delivered.receiptKey);
  // Explicit legacy fixture: reconstruct the pre-repair reversal's exact public
  // journal and registry shape. The finance command stream has no compensation.
  fx.engine.ledger.post(original.postings.map(leg => ({ ...leg, amount: -leg.amount })), {
    idempotencyKey: `reverse:${original.idempotencyKey}`, action: 'reverse',
    memo: `reversal of ${original.id} (${original.action})`, authority: 'internal',
    links: { reverses: original.id, reversesKey: original.idempotencyKey, actor: 'u:payer' }
  });
  fx.engine._reversedJournalKeys.add(original.idempotencyKey);
  const tokenHistory = serializeTokenEngine(fx.engine), domainHistory = fx.kernel.exportState();
  assert.throws(() => {
    const engine = loadTokenEngine(tokenHistory), kernel = createEconomicKernel({ engine, clock: () => 0 });
    createEconomicFinance(kernel);
    kernel.restore(domainHistory);
  }, /economic|owning domain/i);
});

test('repeated partial fills and cancellation conserve both assets for either resting price across rational limits', () => {
  for (const restingSide of ['BUY', 'SELL']) for (let denominator = 1; denominator <= 4; denominator += 1) for (let numerator = 1; numerator <= 5; numerator += 1) {
    const fx = fixture(), f = fx.finance, lots = 2 * denominator + 1;
    const overrides = { lots, lotSizeFluff: 3, priceDenominatorLots: denominator };
    const place = side => order(f, side, side, { ...overrides, priceNumeratorFluff: side === 'BUY' ? numerator + denominator : numerator });
    const first = place(restingSide), second = place(restingSide === 'BUY' ? 'SELL' : 'BUY');
    const buy = restingSide === 'BUY' ? first : second, sell = restingSide === 'SELL' ? first : second;
    const buyerStart = fx.engine.balance('u:buyer', 'TUMBO') + buy.reservedFluff;
    const sellerStart = fx.engine.balance('u:seller', 'sMIMAS') + sell.reservedFluff;
    const quotePerFill = restingSide === 'BUY' ? numerator + denominator : numerator;
    for (let fill = 0; fill < 2; fill += 1) {
      const result = f.orderMatch({ actor: fill ? 'u:seller' : 'u:buyer', buyOrderId: buy.id, sellOrderId: sell.id, lots: denominator, idempotencyKey: `fill:${fill}` });
      assert.equal(result.quoteFluff, quotePerFill);
      assert.equal(f.snapshot().obligations.every(row => row.covered !== false), true);
    }
    f.orderCancel({ actor: 'u:buyer', orderId: buy.id, idempotencyKey: 'cancel-buy' });
    f.orderCancel({ actor: 'u:seller', orderId: sell.id, idempotencyKey: 'cancel-sell' });
    assert.equal(fx.engine.balance('u:buyer', 'TUMBO'), buyerStart - 2 * quotePerFill);
    assert.equal(fx.engine.balance('u:buyer', 'sMIMAS'), 6 * denominator);
    assert.equal(fx.engine.balance('u:seller', 'sMIMAS'), sellerStart - 6 * denominator);
    assert.equal(fx.engine.balance(buy.escrow, 'TUMBO'), 0);
    assert.equal(fx.engine.balance(sell.escrow, 'sMIMAS'), 0);
    assert.equal(fx.kernel.proof().conserved, true);
  }
});
