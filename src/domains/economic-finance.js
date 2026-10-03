/** Funded local finance over the canonical ledger. Actors and oracle observations
 * are explicit rehearsal roles, never authentication, custody or external prices.
 * Every value-moving transition prepares its complete next state before one post.
 */
import {
  economicActor,
  economicInteger,
  economicJson,
  economicDigest,
  ECONOMIC_POOLS
} from './economic-kernel.js?v=20261003-complete8';

export const ECONOMIC_FINANCE_SOURCE = 'matumbo-economic-finance';
const ASSETS = new Set(['TUMBO', 'sMIMAS']);
const LIMIT = 256,
  MAX_STAKES = 128,
  YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const integer = economicInteger;
const zero = value => integer(value, 'amount', {
  positive: false
});
const exact = (value, label = 'calculation') => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${label} exceeds exact integer range`);
  return Number(value);
};
const sum = values => exact(values.reduce((n, v) => n + BigInt(v), 0n));
const mul = (a, b) => exact(BigInt(a) * BigInt(b));
const ceilDiv = (a, b) => (a + b - 1n) / b;
const asset = value => {
  if (!ASSETS.has(value)) throw new Error('Unsupported canonical asset');
  return value;
};
const actor = value => {
  const a = economicActor(value);
  if (a.startsWith('b:econ-')) throw new Error('Purpose escrow is not a participant');
  return a;
};
const text = (value, label = 'text', max = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`Bounded ${label} is required`);
  return value.trim();
};
const tag = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,60}$/.test(value)) throw new TypeError('Bounded source identifier required');
  return value;
};
const time = value => integer(value, 'time', {
  positive: false
});
const requireActor = (input, expected) => {
  if (actor(input.actor) !== expected) throw new Error('Local actor does not hold the required role');
};
const allowed = (row, states) => {
  if (!states.includes(row.status)) throw new Error(`Transition is unavailable from ${row.status}`);
};
const get = (map, id, label) => {
  const row = map.get(id);
  if (!row) throw new Error(`Unknown ${label}`);
  return row;
};
const room = map => {
  if (map.size >= LIMIT) throw new Error('Local finance capacity reached; export this rehearsal');
};
const escrow = (ctx, purpose) => `b:econ-${purpose}-${ctx.id(purpose)}`;
const receiptFields = receipt => ({
  receiptId: receipt.id,
  receiptKey: receipt.idempotencyKey
});
const legs = (from, to, amount, token) => amount ? [{
  account: from,
  asset: token,
  amount: -amount
}, {
  account: to,
  asset: token,
  amount
}] : [];
// Combine legs before posting, avoiding intermediate sum overflow for large payouts.
function compactPostings(postings) {
  const net = new Map();
  for (const p of postings) {
    const key = `${p.account}|${p.asset}`;
    net.set(key, {
      ...p,
      amount: (net.get(key)?.amount ?? 0n) + BigInt(p.amount)
    });
  }
  return [...net.values()].filter(p => p.amount !== 0n).map(p => ({
    ...p,
    amount: p.amount < 0n ? -exact(-p.amount) : exact(p.amount)
  }));
}
const quote = (lots, row, roundUp = true) => {
  const n = BigInt(lots) * BigInt(row.priceNumeratorFluff),
    d = BigInt(row.priceDenominatorLots);
  if (!roundUp && n % d) throw new Error('Trade lots do not produce an integer quote amount');
  return exact(roundUp ? ceilDiv(n, d) : n / d, 'quote');
};

export function createEconomicFinance(kernel) {
  if (!kernel?.register || !kernel?.project || !kernel?.balance) throw new TypeError('Canonical economic kernel required');
  const payments = new Map(),
    orders = new Map(),
    offers = new Map(),
    loans = new Map(),
    markets = new Map(),
    observations = new Map();
  let orderSequence = 0;
  const register = (name, handler) => kernel.register(`finance.${name}`, handler);

  function finish(map, row, ctx, postings, label) {
    // economicJson validates the complete transition before value can move.
    const next = economicJson(row);
    const receipt = ctx.post(compactPostings(postings), {
      label,
      links: {
        id: row.id,
        purpose: label
      }
    });
    const result = Object.freeze({
      ...next,
      ...receiptFields(receipt)
    });
    map.set(row.id, result);
    return result;
  }

  function update(map, row) {
    const result = economicJson(row);
    map.set(row.id, result);
    return result;
  }

  const paymentRequest = register('payment.request', (input, ctx) => {
    room(payments);
    const payer = actor(input.payer),
      creator = actor(input.creator),
      provider = actor(input.provider);
    const treasury = input.treasury === ECONOMIC_POOLS.operations ? input.treasury : actor(input.treasury);
    requireActor(input, creator);
    if (new Set([payer, creator, provider, treasury]).size !== 4) throw new Error('Payment roles require four distinct accounts');
    const amountFluff = integer(input.amountFluff),
      creatorFluff = zero(input.creatorFluff),
      providerFluff = zero(input.providerFluff),
      treasuryFluff = zero(input.treasuryFluff);
    if (sum([creatorFluff, providerFluff, treasuryFluff]) !== amountFluff) throw new Error('Payment splits must exactly equal the request amount');
    const expiresAt = time(input.expiresAt),
      refundUntil = time(input.refundUntil);
    if (expiresAt <= ctx.now || refundUntil < expiresAt) throw new Error('Payment deadlines must be ordered and in the future');
    return update(payments, {
      id: ctx.id('payment'),
      escrow: escrow(ctx, 'pay'),
      status: 'requested',
      payer,
      creator,
      provider,
      treasury,
      asset: asset(input.asset ?? 'TUMBO'),
      amountFluff,
      creatorFluff,
      providerFluff,
      treasuryFluff,
      expiresAt,
      refundUntil,
      terms: text(input.terms, 'payment terms'),
      createdAt: ctx.now,
      refundApprovals: [],
      simulation: true
    });
  });
  const paymentAuthorize = register('payment.authorize', (input, ctx) => {
    const row = get(payments, input.paymentId, 'payment');
    allowed(row, ['requested']);
    requireActor(input, row.payer);
    if (ctx.now >= row.expiresAt) throw new Error('Payment request expired');
    return finish(payments, {
      ...row,
      status: 'authorized',
      authorizedAt: ctx.now
    }, ctx, legs(row.payer, row.escrow, row.amountFluff, row.asset), 'payment-reserve');
  });
  const paymentFulfill = register('payment.fulfill', (input, ctx) => {
    const row = get(payments, input.paymentId, 'payment');
    allowed(row, ['authorized']);
    requireActor(input, row.provider);
    if (ctx.now >= row.expiresAt) throw new Error('Payment authorization expired; cancel to release it');
    const evidence = text(input.evidence, 'delivery evidence');
    return finish(payments, {
        ...row,
        status: 'fulfilled',
        fulfilledAt: ctx.now,
        evidence
      }, ctx,
      [...legs(row.escrow, row.creator, row.creatorFluff, row.asset), ...legs(row.escrow, row.provider, row.providerFluff, row.asset), ...legs(row.escrow, row.treasury, row.treasuryFluff, row.asset)], 'payment-fulfill');
  });
  const paymentCancel = register('payment.cancel', (input, ctx) => {
    const row = get(payments, input.paymentId, 'payment');
    allowed(row, ['requested', 'authorized']);
    requireActor(input, row.payer);
    const next = {
      ...row,
      status: 'cancelled',
      cancelledAt: ctx.now
    };
    return row.status === 'authorized' ? finish(payments, next, ctx, legs(row.escrow, row.payer, row.amountFluff, row.asset), 'payment-cancel') : update(payments, next);
  });
  const paymentRefundRequest = register('payment.refund-request', (input, ctx) => {
    const row = get(payments, input.paymentId, 'payment');
    allowed(row, ['fulfilled']);
    requireActor(input, row.payer);
    if (ctx.now > row.refundUntil) throw new Error('Payment refund window closed');
    return update(payments, {
      ...row,
      status: 'refund-requested',
      refundReason: text(input.reason, 'refund reason'),
      refundApprovals: []
    });
  });
  const refundRoles = row => [
    [row.creator, row.creatorFluff],
    [row.provider, row.providerFluff],
    [row.treasury, row.treasuryFluff]
  ].filter(([, n]) => n > 0).map(([a]) => a);
  const paymentRefundApprove = register('payment.refund-approve', (input, ctx) => {
    const row = get(payments, input.paymentId, 'payment');
    allowed(row, ['refund-requested']);
    const who = input.actor === ECONOMIC_POOLS.operations ? input.actor : actor(input.actor);
    if (ctx.now > row.refundUntil || !refundRoles(row).includes(who) || row.refundApprovals.includes(who)) throw new Error('Refund needs a new approval from an affected payee within its window');
    return update(payments, {
      ...row,
      refundApprovals: [...row.refundApprovals, who]
    });
  });
  const paymentRefund = register('payment.refund', (input, ctx) => {
    const row = get(payments, input.paymentId, 'payment');
    allowed(row, ['refund-requested']);
    requireActor(input, row.payer);
    if (ctx.now > row.refundUntil || refundRoles(row).some(a => !row.refundApprovals.includes(a))) throw new Error('Refund requires every affected payee approval within the refund window');
    return finish(payments, {
        ...row,
        status: 'refunded',
        refundedAt: ctx.now
      }, ctx,
      [...legs(row.creator, row.payer, row.creatorFluff, row.asset), ...legs(row.provider, row.payer, row.providerFluff, row.asset), ...legs(row.treasury, row.payer, row.treasuryFluff, row.asset)], 'payment-refund');
  });

  const orderPlace = register('order.place', (input, ctx) => {
    room(orders);
    const owner = actor(input.actor),
      baseAsset = asset(input.baseAsset),
      quoteAsset = asset(input.quoteAsset);
    if (baseAsset === quoteAsset || !['BUY', 'SELL'].includes(input.side)) throw new Error('A two-asset BUY or SELL limit order is required');
    const lots = integer(input.lots),
      lotSizeFluff = integer(input.lotSizeFluff),
      priceNumeratorFluff = integer(input.priceNumeratorFluff),
      priceDenominatorLots = integer(input.priceDenominatorLots ?? 1);
    const expiresAt = time(input.expiresAt);
    if (expiresAt <= ctx.now) throw new Error('Order expiry must be in the future');
    const row = {
      id: ctx.id('order'),
      escrow: escrow(ctx, 'order'),
      owner,
      baseAsset,
      quoteAsset,
      side: input.side,
      lots,
      remainingLots: lots,
      lotSizeFluff,
      priceNumeratorFluff,
      priceDenominatorLots,
      expiresAt,
      sequence: orderSequence + 1,
      createdAt: ctx.now,
      status: 'open',
      simulation: true
    };
    const reservedFluff = row.side === 'BUY' ? quote(lots, row) : mul(lots, lotSizeFluff);
    const result = finish(orders, {
      ...row,
      reservedFluff
    }, ctx, legs(owner, row.escrow, reservedFluff, row.side === 'BUY' ? quoteAsset : baseAsset), 'order-reserve');
    orderSequence += 1;
    return result;
  });
  const orderMatch = register('order.match', (input, ctx) => {
    const buy = get(orders, input.buyOrderId, 'buy order'),
      sell = get(orders, input.sellOrderId, 'sell order');
    allowed(buy, ['open']);
    allowed(sell, ['open']);
    const who = actor(input.actor);
    if (![buy.owner, sell.owner].includes(who)) throw new Error('A matching participant must explicitly request the trade');
    if (buy.side !== 'BUY' || sell.side !== 'SELL' || buy.owner === sell.owner || buy.baseAsset !== sell.baseAsset || buy.quoteAsset !== sell.quoteAsset || buy.lotSizeFluff !== sell.lotSizeFluff) throw new Error('Orders require distinct owners and the same two-asset lot market');
    if (ctx.now >= buy.expiresAt || ctx.now >= sell.expiresAt) throw new Error('Expired orders cannot match; cancel to release reservations');
    if (BigInt(buy.priceNumeratorFluff) * BigInt(sell.priceDenominatorLots) < BigInt(sell.priceNumeratorFluff) * BigInt(buy.priceDenominatorLots)) throw new Error('Limit prices do not cross');
    const lots = integer(input.lots);
    if (lots > Math.min(buy.remainingLots, sell.remainingLots)) throw new Error('Match exceeds reserved lots');
    const resting = buy.sequence < sell.sequence ? buy : sell,
      quoteFluff = quote(lots, resting, false);
    if (!quoteFluff) throw new Error('Match quote amount must be positive');
    const baseFluff = mul(lots, buy.lotSizeFluff),
      buyLots = buy.remainingLots - lots,
      sellLots = sell.remainingLots - lots;
    const buyReserved = buyLots ? quote(buyLots, buy) : 0,
      sellReserved = mul(sellLots, sell.lotSizeFluff);
    const releasedFluff = buy.reservedFluff - quoteFluff - buyReserved;
    if (releasedFluff < 0) throw new Error('Match would exceed the buy reservation');
    const nextBuy = economicJson({
      ...buy,
      remainingLots: buyLots,
      reservedFluff: buyReserved,
      status: buyLots ? 'open' : 'filled'
    });
    const nextSell = economicJson({
      ...sell,
      remainingLots: sellLots,
      reservedFluff: sellReserved,
      status: sellLots ? 'open' : 'filled'
    });
    const result = economicJson({
      id: ctx.id('match'),
      buyOrderId: buy.id,
      sellOrderId: sell.id,
      lots,
      baseFluff,
      quoteFluff,
      releasedFluff,
      priceOrderId: resting.id,
      at: ctx.now,
      simulation: true
    });
    const receipt = ctx.post(compactPostings([...legs(sell.escrow, buy.owner, baseFluff, buy.baseAsset), ...legs(buy.escrow, sell.owner, quoteFluff, buy.quoteAsset), ...legs(buy.escrow, buy.owner, releasedFluff, buy.quoteAsset)]), {
      label: 'order-match',
      links: result
    });
    orders.set(buy.id, nextBuy);
    orders.set(sell.id, nextSell);
    return Object.freeze({
      ...result,
      ...receiptFields(receipt)
    });
  });
  const orderCancel = register('order.cancel', (input, ctx) => {
    const row = get(orders, input.orderId, 'order');
    allowed(row, ['open']);
    requireActor(input, row.owner);
    return finish(orders, {
        ...row,
        status: 'cancelled',
        remainingLots: 0,
        reservedFluff: 0,
        cancelledAt: ctx.now
      }, ctx,
      legs(row.escrow, row.owner, row.reservedFluff, row.side === 'BUY' ? row.quoteAsset : row.baseAsset), 'order-cancel');
  });

  const oracleObserve = register('oracle.observe', (input, ctx) => {
    const observer = actor(input.actor),
      source = tag(input.source),
      baseAsset = asset(input.baseAsset),
      quoteAsset = asset(input.quoteAsset);
    if (baseAsset === quoteAsset) throw new Error('Oracle requires a two-asset price');
    const observedAt = time(input.observedAt);
    if (observedAt > ctx.now) throw new Error('Future oracle observations are unavailable');
    const pair = `${baseAsset}/${quoteAsset}`,
      rows = observations.get(pair) ?? [];
    const previous = rows.find(row => row.source === source && row.observer === observer);
    if (previous && observedAt <= previous.observedAt) throw new Error('Oracle source timestamp must advance');
    if (!previous && rows.length >= 16) throw new Error('Oracle source capacity reached');
    const row = economicJson({
      source,
      observer,
      baseAsset,
      quoteAsset,
      numerator: integer(input.numerator),
      denominator: integer(input.denominator),
      observedAt,
      evidence: text(input.evidence, 'oracle provenance'),
      authority: 'local-observation',
      externalVerification: false
    });
    observations.set(pair, economicJson([...rows.filter(r => r !== previous), row]));
    return row;
  });

  function oraclePolicy(input) {
    if (!Array.isArray(input.sources) || input.sources.length < 2 || input.sources.length > 8) throw new Error('Oracle policy needs two to eight independent named observer roles');
    const sources = input.sources.map(row => ({
      source: tag(row.source),
      observer: actor(row.observer)
    }));
    if (new Set(sources.map(s => s.source)).size !== sources.length || new Set(sources.map(s => s.observer)).size !== sources.length) throw new Error('Oracle sources and observer roles must be independent');
    const maxAgeMs = integer(input.maxAgeMs),
      maxDeviationBps = zero(input.maxDeviationBps ?? 1000);
    if (maxAgeMs > 24 * 60 * 60 * 1000 || maxDeviationBps > 5000) throw new Error('Oracle freshness/deviation policy exceeds local limits');
    return {
      sources,
      minObservations: integer(input.minObservations ?? 2),
      maxAgeMs,
      maxDeviationBps
    };
  }

  function priceFor(row, now) {
    const policy = row.oracle;
    const rows = (observations.get(`${row.collateralAsset}/${row.asset}`) ?? []).filter(obs => policy.sources.some(s => s.source === obs.source && s.observer === obs.observer) && obs.observedAt <= now && now - obs.observedAt <= policy.maxAgeMs);
    if (rows.length < policy.minObservations) throw new Error('Unknown or stale oracle: insufficient independent fresh observations');
    const sorted = [...rows].sort((a, b) => {
      const x = BigInt(a.numerator) * BigInt(b.denominator),
        y = BigInt(b.numerator) * BigInt(a.denominator);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    const low = sorted[0],
      high = sorted.at(-1),
      lo = BigInt(low.numerator) * BigInt(high.denominator),
      hi = BigInt(high.numerator) * BigInt(low.denominator);
    if ((hi - lo) * 10000n > lo * BigInt(policy.maxDeviationBps)) throw new Error('Oracle sources disagree beyond the immutable deviation policy');
    return economicJson({
      numerator: low.numerator,
      denominator: low.denominator,
      sources: sorted.map(s => ({
        source: s.source,
        observer: s.observer,
        observedAt: s.observedAt
      })),
      valuation: 'minimum-fresh-observation',
      simulation: true
    });
  }
  const valued = (amount, price) => exact(BigInt(amount) * BigInt(price.numerator) / BigInt(price.denominator), 'collateral valuation');
  const loanOffer = register('loan.offer', (input, ctx) => {
    room(offers);
    const lender = actor(input.actor),
      token = asset(input.asset),
      collateralAsset = asset(input.collateralAsset);
    if (token === collateralAsset) throw new Error('Loan requires a distinct collateral asset');
    const capitalFluff = integer(input.capitalFluff),
      maxLtvBps = integer(input.maxLtvBps ?? 5000),
      termMs = integer(input.termMs),
      expiresAt = time(input.expiresAt);
    if (maxLtvBps > 9000 || termMs > 5 * YEAR_MS || expiresAt <= ctx.now) throw new Error('Invalid bounded loan offer terms');
    const interestKind = input.interestKind;
    if (!['FIXED', 'APR'].includes(interestKind)) throw new Error('Loan needs explicit FIXED or APR interest terms');
    const fixedInterestFluff = interestKind === 'FIXED' ? zero(input.fixedInterestFluff) : 0;
    const aprBps = interestKind === 'APR' ? zero(input.aprBps) : 0;
    if (aprBps > 100000) throw new Error('APR exceeds the local offer limit');
    const oracle = oraclePolicy(input.oracle ?? {});
    if (oracle.minObservations < 2 || oracle.minObservations > oracle.sources.length || oracle.sources.some(s => s.observer === lender)) throw new Error('Invalid independent oracle observation quorum');
    const row = {
      id: ctx.id('offer'),
      escrow: escrow(ctx, 'offer'),
      lender,
      asset: token,
      collateralAsset,
      capitalFluff,
      availableFluff: capitalFluff,
      maxLtvBps,
      termMs,
      expiresAt,
      interestKind,
      fixedInterestFluff,
      aprBps,
      oracle,
      terms: text(input.terms, 'loan terms'),
      status: 'open',
      createdAt: ctx.now,
      simulation: true
    };
    return finish(offers, row, ctx, legs(lender, row.escrow, capitalFluff, token), 'loan-capital');
  });
  const loanOfferCancel = register('loan.offer-cancel', (input, ctx) => {
    const row = get(offers, input.offerId, 'loan offer');
    allowed(row, ['open']);
    requireActor(input, row.lender);
    return finish(offers, {
      ...row,
      availableFluff: 0,
      status: 'cancelled',
      cancelledAt: ctx.now
    }, ctx, legs(row.escrow, row.lender, row.availableFluff, row.asset), 'loan-offer-cancel');
  });
  const loanBorrow = register('loan.borrow', (input, ctx) => {
    room(loans);
    const offer = get(offers, input.offerId, 'loan offer');
    allowed(offer, ['open']);
    const borrower = actor(input.actor);
    if (borrower === offer.lender || offer.oracle.sources.some(s => s.observer === borrower) || ctx.now >= offer.expiresAt) throw new Error('Loan offer is expired or borrower is a lender/oracle role');
    const principalFluff = integer(input.principalFluff),
      collateralFluff = integer(input.collateralFluff);
    if (principalFluff > offer.availableFluff) throw new Error('Loan exceeds the lender-specific reserved capital');
    const price = priceFor(offer, ctx.now),
      collateralValueFluff = valued(collateralFluff, price);
    if (BigInt(principalFluff) * 10000n > BigInt(collateralValueFluff) * BigInt(offer.maxLtvBps)) throw new Error('Collateral does not satisfy the immutable maximum LTV');
    const interestFluff = offer.interestKind === 'FIXED' ? offer.fixedInterestFluff : exact(ceilDiv(BigInt(principalFluff) * BigInt(offer.aprBps) * BigInt(offer.termMs), 10000n * BigInt(YEAR_MS)), 'interest');
    const dueAt = exact(BigInt(ctx.now) + BigInt(offer.termMs)),
      debtFluff = sum([principalFluff, interestFluff]);
    if (debtFluff > collateralValueFluff) throw new Error('Collateral must cover principal and the complete agreed interest');
    const nextOffer = economicJson({
      ...offer,
      availableFluff: offer.availableFluff - principalFluff,
      status: offer.availableFluff === principalFluff ? 'exhausted' : 'open'
    });
    const row = {
      id: ctx.id('loan'),
      escrow: escrow(ctx, 'loan'),
      offerId: offer.id,
      borrower,
      lender: offer.lender,
      asset: offer.asset,
      collateralAsset: offer.collateralAsset,
      principalFluff,
      interestFluff,
      debtFluff,
      remainingDebtFluff: debtFluff,
      collateralFluff,
      heldCollateralFluff: collateralFluff,
      oracle: offer.oracle,
      maxLtvBps: offer.maxLtvBps,
      ltvBasis: 'principal',
      interestKind: offer.interestKind,
      interestPolicy: 'fixed-term-amount-at-origination',
      aprBps: offer.aprBps,
      termMs: offer.termMs,
      dueAt,
      priceAtOrigination: price,
      terms: offer.terms,
      status: 'active',
      createdAt: ctx.now,
      simulation: true
    };
    const result = finish(loans, row, ctx, [...legs(offer.escrow, borrower, principalFluff, offer.asset), ...legs(borrower, row.escrow, collateralFluff, row.collateralAsset)], 'loan-originate');
    offers.set(offer.id, nextOffer);
    return result;
  });
  const loanRepay = register('loan.repay', (input, ctx) => {
    const row = get(loans, input.loanId, 'loan');
    allowed(row, ['active', 'defaulted', 'liquidated']);
    requireActor(input, row.borrower);
    const amountFluff = integer(input.amountFluff);
    if (amountFluff > row.remainingDebtFluff) throw new Error('Repayment exceeds the remaining debt');
    const remainingDebtFluff = row.remainingDebtFluff - amountFluff,
      full = remainingDebtFluff === 0;
    return finish(loans, {
        ...row,
        remainingDebtFluff,
        heldCollateralFluff: full ? 0 : row.heldCollateralFluff,
        status: full ? 'repaid' : row.status,
        lastRepaidAt: ctx.now
      }, ctx,
      [...legs(row.borrower, row.lender, amountFluff, row.asset), ...legs(row.escrow, row.borrower, full ? row.heldCollateralFluff : 0, row.collateralAsset)], 'loan-repay');
  });
  const loanDefault = register('loan.default', (input, ctx) => {
    const row = get(loans, input.loanId, 'loan');
    allowed(row, ['active']);
    requireActor(input, row.lender);
    const reason = input.reason;
    if (reason === 'maturity') {
      if (ctx.now < row.dueAt) throw new Error('Loan has not reached its repayment deadline');
    } else if (reason === 'margin') {
      const price = priceFor(row, ctx.now);
      if (valued(row.heldCollateralFluff, price) >= row.remainingDebtFluff) throw new Error('Loan collateral covers its remaining debt');
    } else throw new Error('Default requires explicit maturity or margin grounds');
    return update(loans, {
      ...row,
      status: 'defaulted',
      defaultReason: reason,
      defaultedAt: ctx.now
    });
  });
  const loanLiquidate = register('loan.liquidate', (input, ctx) => {
    const row = get(loans, input.loanId, 'loan');
    allowed(row, ['defaulted']);
    requireActor(input, row.lender);
    const price = priceFor(row, ctx.now);
    const required = ceilDiv(BigInt(row.remainingDebtFluff) * BigInt(price.denominator), BigInt(price.numerator));
    const seizeFluff = exact(required < BigInt(row.heldCollateralFluff) ? required : BigInt(row.heldCollateralFluff), 'collateral seizure');
    const collateralValueFluff = valued(seizeFluff, price),
      recoveredDebtFluff = Math.min(row.remainingDebtFluff, collateralValueFluff),
      remainingDebtFluff = row.remainingDebtFluff - recoveredDebtFluff;
    return finish(loans, {
        ...row,
        heldCollateralFluff: 0,
        status: remainingDebtFluff ? 'liquidated' : 'repaid',
        liquidatedAt: ctx.now,
        remainingDebtFluff,
        seizedCollateralFluff: seizeFluff,
        returnedCollateralFluff: row.heldCollateralFluff - seizeFluff,
        recoveredDebtFluff,
        liquidationPrice: price,
        valuationDisclosure: 'Local conservative oracle settlement credit; collateral transfer is not a cash sale or external execution.'
      }, ctx,
      [...legs(row.escrow, row.lender, seizeFluff, row.collateralAsset), ...legs(row.escrow, row.borrower, row.heldCollateralFluff - seizeFluff, row.collateralAsset)], 'loan-liquidate');
  });

  const predictionCreate = register('prediction.create', (input, ctx) => {
    room(markets);
    const creator = actor(input.actor),
      resolver = actor(input.resolver),
      reviewer = actor(input.reviewer);
    if (new Set([creator, resolver, reviewer]).size !== 3) throw new Error('Prediction creator and two approver roles must be independent');
    const closeAt = time(input.closeAt),
      resolutionAt = time(input.resolutionAt),
      challengeMs = integer(input.challengeMs);
    if (closeAt <= ctx.now || resolutionAt < closeAt || challengeMs > 30 * 24 * 60 * 60 * 1000) throw new Error('Invalid immutable market deadlines');
    return update(markets, {
      id: ctx.id('prediction'),
      escrow: escrow(ctx, 'pred'),
      creator,
      resolver,
      reviewer,
      asset: asset(input.asset ?? 'TUMBO'),
      question: text(input.question, 'market question'),
      evidenceSpec: text(input.evidenceSpec, 'resolution evidence specification'),
      closeAt,
      resolutionAt,
      challengeMs,
      maxStakeFluff: integer(input.maxStakeFluff ?? 1000000000),
      stakes: [],
      stakePoolFluff: 0,
      status: 'open',
      proposal: null,
      challenges: [],
      payouts: [],
      createdAt: ctx.now,
      payoutModel: 'funded-binary-parimutuel',
      maximumLiability: 'segregated-stake-pool',
      simulation: true
    });
  });
  const predictionStake = register('prediction.stake', (input, ctx) => {
    const row = get(markets, input.marketId, 'prediction market');
    allowed(row, ['open']);
    const owner = actor(input.actor);
    if (ctx.now >= row.closeAt || [row.resolver, row.reviewer].includes(owner)) throw new Error('Market staking is closed or the actor holds a resolution role');
    if (!['YES', 'NO'].includes(input.outcome) || row.stakes.length >= MAX_STAKES) throw new Error('Binary stake or market capacity unavailable');
    const amountFluff = integer(input.amountFluff);
    if (amountFluff > row.maxStakeFluff) throw new Error('Stake exceeds the immutable per-command limit');
    const stake = economicJson({
      id: ctx.id('stake'),
      owner,
      outcome: input.outcome,
      amountFluff,
      at: ctx.now
    });
    return finish(markets, {
      ...row,
      stakes: [...row.stakes, stake],
      stakePoolFluff: sum([row.stakePoolFluff, amountFluff])
    }, ctx, legs(owner, row.escrow, amountFluff, row.asset), 'prediction-stake');
  });
  const predictionPropose = register('prediction.propose', (input, ctx) => {
    const row = get(markets, input.marketId, 'prediction market');
    allowed(row, ['open', 'proposed', 'challenged']);
    requireActor(input, row.resolver);
    if (ctx.now < row.resolutionAt || !['YES', 'NO', 'INVALID'].includes(input.outcome)) throw new Error('Resolution time or binary outcome unavailable');
    if (row.status === 'proposed') throw new Error('Existing unchallenged proposal is immutable');
    const evidence = text(input.evidence, 'resolution evidence', 4000),
      challengeUntil = exact(BigInt(ctx.now) + BigInt(row.challengeMs));
    const proposal = {
      id: ctx.id('proposal'),
      outcome: input.outcome,
      evidence,
      evidenceHash: economicDigest({
        evidence
      }),
      proposedAt: ctx.now,
      challengeUntil,
      approvals: []
    };
    return update(markets, {
      ...row,
      status: 'proposed',
      proposal
    });
  });
  const predictionChallenge = register('prediction.challenge', (input, ctx) => {
    const row = get(markets, input.marketId, 'prediction market');
    allowed(row, ['proposed']);
    const who = actor(input.actor);
    if (ctx.now >= row.proposal.challengeUntil || input.proposalId !== row.proposal.id || row.challenges.length >= 16 || [row.resolver, row.reviewer].includes(who)) throw new Error('Challenge window, exact proposal or independent challenger unavailable');
    const challenge = {
      id: ctx.id('challenge'),
      actor: who,
      proposalId: row.proposal.id,
      reason: text(input.reason, 'challenge grounds'),
      at: ctx.now
    };
    return update(markets, {
      ...row,
      status: 'challenged',
      challenges: [...row.challenges, challenge],
      proposal: {
        ...row.proposal,
        approvals: []
      }
    });
  });
  const predictionApprove = register('prediction.approve', (input, ctx) => {
    const row = get(markets, input.marketId, 'prediction market');
    allowed(row, ['proposed']);
    const who = actor(input.actor);
    if (![row.resolver, row.reviewer].includes(who) || row.proposal.approvals.includes(who) || input.proposalId !== row.proposal.id) throw new Error('Approval needs a new independent role bound to the exact proposal');
    return update(markets, {
      ...row,
      proposal: {
        ...row.proposal,
        approvals: [...row.proposal.approvals, who]
      }
    });
  });

  function payoutRows(row) {
    const winners = row.stakes.filter(s => s.outcome === row.proposal.outcome);
    if (row.proposal.outcome === 'INVALID' || !winners.length) return {
      outcome: 'INVALID',
      refunds: true,
      rows: row.stakes.map(s => ({
        stakeId: s.id,
        account: s.owner,
        amountFluff: s.amountFluff
      }))
    };
    const total = sum(winners.map(s => s.amountFluff)),
      pool = BigInt(row.stakePoolFluff),
      d = BigInt(total);
    const calculated = winners.map(s => {
      const numerator = pool * BigInt(s.amountFluff);
      return {
        stakeId: s.id,
        account: s.owner,
        amountFluff: exact(numerator / d),
        remainder: numerator % d
      };
    });
    const left = row.stakePoolFluff - sum(calculated.map(s => s.amountFluff));
    calculated.sort((a, b) => a.remainder === b.remainder ? a.stakeId.localeCompare(b.stakeId, 'en') : a.remainder > b.remainder ? -1 : 1);
    for (let i = 0; i < left; i += 1) calculated[i].amountFluff += 1;
    return {
      outcome: row.proposal.outcome,
      refunds: false,
      rows: calculated.map(({
        remainder,
        ...s
      }) => s)
    };
  }
  const predictionFinalize = register('prediction.finalize', (input, ctx) => {
    const row = get(markets, input.marketId, 'prediction market');
    allowed(row, ['proposed']);
    requireActor(input, row.creator);
    if (ctx.now < row.proposal.challengeUntil || input.proposalId !== row.proposal.id || [row.resolver, row.reviewer].some(a => !row.proposal.approvals.includes(a))) throw new Error('Finalization requires the complete challenge window and both exact-proposal approvals');
    const payout = payoutRows(row);
    if (sum(payout.rows.map(s => s.amountFluff)) !== row.stakePoolFluff) throw new Error('Prediction maximum liability is not covered');
    const next = {
      ...row,
      status: 'finalized',
      outcome: payout.outcome,
      refunded: payout.refunds,
      payouts: payout.rows,
      remainingLiabilityFluff: 0,
      finalizedAt: ctx.now
    };
    if (!row.stakePoolFluff) return update(markets, next);
    return finish(markets, next, ctx, payout.rows.flatMap(s => legs(row.escrow, s.account, s.amountFluff, row.asset)), 'prediction-finalize');
  });

  function snapshot() {
    const obligations = [];
    const covered = (kind, id, account, token, amountFluff) => {
      const balanceFluff = kernel.balance(account, token);
      obligations.push({
        kind,
        id,
        account,
        asset: token,
        amountFluff,
        balanceFluff,
        covered: balanceFluff >= amountFluff,
        shortfallFluff: Math.max(0, amountFluff - balanceFluff)
      });
    };
    for (const row of payments.values()) {
      if (row.status === 'authorized') covered('payment-reservation', row.id, row.escrow, row.asset, row.amountFluff);
      if (row.status === 'refund-requested') obligations.push({
        kind: 'payment-refund-request',
        id: row.id,
        asset: row.asset,
        amountFluff: row.amountFluff,
        recipient: row.payer,
        requiredPayees: refundRoles(row),
        approvals: row.refundApprovals,
        approvalComplete: refundRoles(row).every(a => row.refundApprovals.includes(a)),
        segregated: false,
        guarantee: false,
        expiresAt: row.refundUntil
      });
    }
    for (const row of orders.values())
      if (row.status === 'open') covered('order-reservation', row.id, row.escrow, row.side === 'BUY' ? row.quoteAsset : row.baseAsset, row.reservedFluff);
    for (const row of offers.values())
      if (row.availableFluff) covered('lender-capital', row.id, row.escrow, row.asset, row.availableFluff);
    for (const row of loans.values()) {
      if (row.heldCollateralFluff) covered('loan-collateral', row.id, row.escrow, row.collateralAsset, row.heldCollateralFluff);
      if (row.remainingDebtFluff) obligations.push({
        kind: 'borrower-debt',
        id: row.id,
        debtor: row.borrower,
        creditor: row.lender,
        asset: row.asset,
        amountFluff: row.remainingDebtFluff,
        secured: row.heldCollateralFluff > 0,
        status: row.status,
        dueAt: row.dueAt,
        guarantee: false
      });
    }
    for (const row of markets.values())
      if (row.status !== 'finalized') covered('prediction-maximum-liability', row.id, row.escrow, row.asset, row.stakePoolFluff);
    return economicJson({
      source: ECONOMIC_FINANCE_SOURCE,
      payments: [...payments.values()],
      orders: [...orders.values()],
      offers: [...offers.values()],
      loans: [...loans.values()],
      markets: [...markets.values()],
      oracleObservations: [...observations.values()].flat(),
      obligations,
      authority: 'explicit-local-simulated-roles',
      simulation: true,
      externalSettlement: false,
      productionAdapters: {
        authentication: 'unsupported',
        custody: 'unsupported',
        oracle: 'local-evidence-only',
        exchange: 'manual-local-match',
        lending: 'local-funded-terms',
        prediction: 'local-evidence-and-roles'
      }
    });
  }
  kernel.project('finance', snapshot);
  return Object.freeze({
    paymentRequest,
    paymentAuthorize,
    paymentFulfill,
    paymentCancel,
    paymentRefundRequest,
    paymentRefundApprove,
    paymentRefund,
    orderPlace,
    orderMatch,
    orderCancel,
    oracleObserve,
    loanOffer,
    loanOfferCancel,
    loanBorrow,
    loanRepay,
    loanDefault,
    loanLiquidate,
    predictionCreate,
    predictionStake,
    predictionPropose,
    predictionChallenge,
    predictionApprove,
    predictionFinalize,
    snapshot
  });
}
