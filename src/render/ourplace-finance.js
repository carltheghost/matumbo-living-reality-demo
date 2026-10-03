import {
  ECONOMIC_POOLS
} from '../domains/economic-kernel.js?v=20261003-complete8';
import {
  runLocalComputeTool
} from '../domains/compute-jobs.js?v=20261003-complete8';

function fluff(value) {
  if (!/^\d+(?:\.\d{0,3})?$/.test(String(value))) throw new Error('Enter a non-negative amount with at most three decimal places');
  const [whole, fraction = ''] = String(value).split('.'), result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount exceeds the exact local range');
  return Number(result);
}
/** Explicit local roles make the policy transitions inspectable without implying authentication. */
export function wireOurplaceFinance(ui) {
  const {
    runtime,
    panes,
    button: baseButton,
    field,
    select,
    create,
    key,
    actor,
    status
  } = ui, f = runtime.finance;
  let paymentId = null,
    buyId = null,
    sellId = null,
    offerId = null,
    loanId = null,
    marketId = null,
    proposalId = null;
  let disposed = false,
    refreshFinance = () => {};
  let currentSnapshot = f.snapshot();
  const pickers = [],
    actions = [],
    rules = new Map();
  const button = (parent, label, action, name, options) => {
    const node = baseButton(parent, label, () => {
      try {
        return action();
      } finally {
        refreshFinance();
        // The parent click handler releases its busy state after awaiting the action.
        queueMicrotask(() => queueMicrotask(refreshFinance));
      }
    }, name, options);
    actions.push({
      name,
      node
    });
    return node;
  };

  function picker(parent, collection, label, newLabel, eligible, assign, filter = () => true) {
    const node = select(parent, label, [
      ['', 'Choose an existing record'],
      ['new', newLabel]
    ], {
      'data-finance-record': collection + '-' + pickers.length
    });
    const info = create('small', '', {
      'data-finance-record-info': collection
    });
    parent.append(info);
    let selected = null,
      initialized = false;
    const rows = () => currentSnapshot[collection].filter(filter);
    const row = () => rows().find(item => item.id === selected) ?? null;

    function sync(snapshot) {
      const all = snapshot[collection].filter(filter);
      if (!initialized) {
        const pending = all.filter(eligible);
        selected = pending.length === 1 ? pending[0].id : all.length === 1 ? all[0].id : !all.length ? 'new' : '';
        initialized = true;
      }
      if (selected !== 'new' && !all.some(item => item.id === selected)) selected = '';
      node.replaceChildren(create('option', 'Choose an existing record', {
        value: ''
      }), create('option', newLabel, {
        value: 'new'
      }));
      for (const item of all) node.append(create('option', `${item.id.slice(0, 8)} · ${item.status} · ${item.owner ?? item.payer ?? item.lender ?? item.creator ?? item.borrower}`, {
        value: item.id
      }));
      node.value = selected;
      const record = all.find(item => item.id === selected) ?? null;
      assign(record);
      info.textContent = record ? `${label}: ${record.id} · ${record.status}${record.remainingLots !== undefined ? ` · ${record.remainingLots} lots reserved at ${record.priceNumeratorFluff}/${record.priceDenominatorLots} quote fluff per lot` : ''}${record.remainingDebtFluff !== undefined ? ` · remaining debt ${record.remainingDebtFluff / 1000} ${record.asset}-SIM · borrower ${record.borrower}` : ''}${record.proposal ? ` · current proposal ${record.proposal.id} · ${record.proposal.approvals.length}/2 approvals` : ''}` : selected === 'new' ? newLabel : 'Several records may be available. Choose one explicitly to continue.';
    }
    const control = {
      node,
      row,
      isNew: () => selected === 'new',
      requireNew() {
        if (selected !== 'new') throw new Error(`Choose “${newLabel}” before creating another record`);
      },
      requireRow() {
        const value = f.snapshot()[collection].find(item => item.id === selected && filter(item));
        if (!value) throw new Error(`Choose an existing ${label.toLowerCase()} first`);
        return value;
      },
      choose(id) {
        selected = id;
        currentSnapshot = f.snapshot();
        sync(currentSnapshot);
      },
      sync,
    };
    node.addEventListener('change', () => {
      selected = node.value;
      currentSnapshot = f.snapshot();
      sync(currentSnapshot);
      refreshFinance();
    });
    pickers.push(control);
    return control;
  }
  const show = value => {
    status.textContent = JSON.stringify(value, null, 2);
  };
  const services = panes.get('services');
  services.append(create('small', 'A local service splits payment 30% creator / 60% provider / 10% operations. The payer reserves funds; delivery releases them once.'));
  const paymentPicker = picker(services, 'payments', 'Service request', 'New service request', row => ['requested', 'authorized', 'refund-requested'].includes(row.status), row => {
    paymentId = row?.id ?? null;
  });
  const servicePrice = field(services, 'Price (TUMBO-SIM)', 'text', '2.000', {
    'data-service-price': '',
    inputmode: 'decimal'
  });
  const serviceText = field(services, 'Text-summary service input', 'textarea', 'A design becomes valuable when it helps people do useful things.', {
    'data-service-text': '',
    maxlength: '4000'
  });
  button(services, 'Create service request · creator role', () => {
    paymentPicker.requireNew();
    const amountFluff = fluff(servicePrice.value),
      creatorFluff = Number(BigInt(amountFluff) * 30n / 100n),
      providerFluff = Number(BigInt(amountFluff) * 60n / 100n);
    const row = f.paymentRequest({
      actor: 'u:creator',
      payer: 'u:you',
      creator: 'u:creator',
      provider: 'u:visitor',
      treasury: ECONOMIC_POOLS.operations,
      amountFluff,
      creatorFluff,
      providerFluff,
      treasuryFluff: amountFluff - creatorFluff - providerFluff,
      expiresAt: runtime.now() + 3600000,
      refundUntil: runtime.now() + 86400000,
      terms: 'Local text-summary delivery. Explicit role authorization. Creator/provider/operations split. Refund requires every recipient approval.',
      idempotencyKey: key('service-request')
    });
    paymentPicker.choose(row.id);
    show(row);
  }, 'service-request', {
    primary: true
  });
  button(services, 'Authorize & reserve · payer role', () => show(f.paymentAuthorize({
    actor: paymentPicker.requireRow().payer,
    paymentId,
    idempotencyKey: key('service-authorize')
  })), 'service-authorize');
  button(services, 'Run tool & fulfill · provider role', () => {
    const row = paymentPicker.requireRow(),
      delivery = runLocalComputeTool('text-summary', serviceText.value);
    show(f.paymentFulfill({
      actor: row.provider,
      paymentId,
      evidence: `Installed local tool output commitment ${delivery.outputHash}; ${delivery.words} words processed.`,
      idempotencyKey: key('service-fulfill')
    }));
  }, 'service-fulfill');
  button(services, 'Cancel & release · payer role', () => show(f.paymentCancel({
    actor: paymentPicker.requireRow().payer,
    paymentId,
    idempotencyKey: key('service-cancel')
  })), 'service-cancel');
  const refunds = create('details');
  refunds.append(create('summary', 'Review a completed service refund'));
  services.append(refunds);
  button(refunds, 'Request refund · payer role', () => show(f.paymentRefundRequest({
    actor: paymentPicker.requireRow().payer,
    paymentId,
    reason: 'Explicit local service refund review',
    idempotencyKey: key('refund-request')
  })), 'service-refund-request');
  for (const [role, property] of [
      ['creator', 'creator'],
      ['provider', 'provider'],
      ['operations', 'treasury']
    ]) button(refunds, `Approve refund · ${role} role`, () => show(f.paymentRefundApprove({
    actor: paymentPicker.requireRow()[property],
    paymentId,
    idempotencyKey: key(`refund-${role}`)
  })), `service-refund-${role}`);
  button(refunds, 'Commit approved refund · payer role', () => show(f.paymentRefund({
    actor: paymentPicker.requireRow().payer,
    paymentId,
    idempotencyKey: key('service-refund')
  })), 'service-refund');
  const markets = panes.get('markets');
  markets.append(create('small', 'The local order book reserves real canonical demo balances. Prices are explicit user offers; they are separate from a forecast probability.'));
  button(markets, 'Convert 20 demo TUMBO → sMIMAS for selected participant', () => {
    const engine = runtime.kernel.engine,
      q = engine.quote({
        action: 'buy',
        from: actor.value,
        fromAsset: 'TUMBO',
        toAsset: 'sMIMAS',
        amountIn: 20000
      });
    show(engine.execute(q, {
      idempotencyKey: key('canonical-exchange')
    }));
  }, 'market-fund-asset');
  const lots = field(markets, 'Whole lots (new orders: 1 sMIMAS each)', 'number', '5', {
      min: '1',
      step: '1',
      'data-order-lots': ''
    }),
    price = field(markets, 'New order limit price per lot (TUMBO-SIM)', 'text', '0.100', {
      inputmode: 'decimal',
      'data-order-price': ''
    });
  const buyPicker = picker(markets, 'orders', 'Buy order', 'New buy order', row => row.status === 'open', row => {
    buyId = row?.id ?? null;
  }, row => row.side === 'BUY');
  const sellPicker = picker(markets, 'orders', 'Sell order', 'New sell order', row => row.status === 'open', row => {
    sellId = row?.id ?? null;
  }, row => row.side === 'SELL');
  const order = (side, who) => f.orderPlace({
    actor: who,
    baseAsset: 'sMIMAS',
    quoteAsset: 'TUMBO',
    side,
    lots: Number(lots.value),
    lotSizeFluff: 1000,
    priceNumeratorFluff: fluff(price.value),
    priceDenominatorLots: 1,
    expiresAt: runtime.now() + 3600000,
    idempotencyKey: key(`order-${side}`)
  });
  button(markets, 'Reserve buy order · you', () => {
    buyPicker.requireNew();
    const row = order('BUY', 'u:you');
    buyPicker.choose(row.id);
    show(row);
  }, 'order-buy');
  button(markets, 'Reserve sell order · visitor', () => {
    sellPicker.requireNew();
    const row = order('SELL', 'u:visitor');
    sellPicker.choose(row.id);
    show(row);
  }, 'order-sell');
  button(markets, 'Match compatible reserved lots', () => {
    const buy = buyPicker.requireRow();
    sellPicker.requireRow();
    show(f.orderMatch({
      actor: buy.owner,
      buyOrderId: buyId,
      sellOrderId: sellId,
      lots: Number(lots.value),
      idempotencyKey: key('order-match')
    }));
  }, 'order-match', {
    primary: true
  });
  button(markets, 'Cancel selected buy reservation · owner role', () => show(f.orderCancel({
    actor: buyPicker.requireRow().owner,
    orderId: buyId,
    idempotencyKey: key('order-cancel')
  })), 'order-cancel');
  button(markets, 'Cancel selected sell reservation · owner role', () => show(f.orderCancel({
    actor: sellPicker.requireRow().owner,
    orderId: sellId,
    idempotencyKey: key('order-sell-cancel')
  })), 'order-sell-cancel');
  const predictions = create('details');
  predictions.append(create('summary', 'Create a collateralized prediction contract'));
  markets.append(predictions);
  predictions.append(create('small', 'Binary parimutuel local contract. Immutable evidence rules, segregated stakes, two named review roles and a challenge window. Rehearsal roles are simulated.'));
  const marketPicker = picker(predictions, 'markets', 'Prediction contract', 'New prediction contract', row => row.status !== 'finalized', row => {
    marketId = row?.id ?? null;
    proposalId = row?.proposal?.id ?? null;
  });
  const question = field(predictions, 'Question', 'text', 'Will the local Ourplace design pass its recorded usability checks?', {
    'data-prediction-question': '',
    maxlength: '2000'
  });
  const outcome = select(predictions, 'Proposed resolution', [
    ['YES', 'YES'],
    ['NO', 'NO'],
    ['INVALID', 'INVALID · refund stakes']
  ], {
    'data-prediction-outcome': ''
  });
  const evidence = field(predictions, 'Resolution evidence', 'textarea', 'Local usability report and recorded acceptance evidence; inspect before approving.', {
    'data-prediction-evidence': '',
    maxlength: '4000'
  });
  button(predictions, 'Freeze new prediction contract', () => {
    marketPicker.requireNew();
    const row = f.predictionCreate({
      actor: 'u:you',
      resolver: 'u:resolver',
      reviewer: 'u:reviewer',
      question: question.value,
      evidenceSpec: 'Resolve from the recorded local acceptance report. Invalid or unavailable evidence requires INVALID/refund. No live market or model authority.',
      closeAt: runtime.now() + 30000,
      resolutionAt: runtime.now() + 30000,
      challengeMs: 15000,
      maxStakeFluff: 100000,
      idempotencyKey: key('prediction-create')
    });
    marketPicker.choose(row.id);
    show(row);
  }, 'prediction-create');
  button(predictions, 'Stake 1 YES · you', () => show(f.predictionStake({
    actor: 'u:you',
    marketId,
    outcome: 'YES',
    amountFluff: 1000,
    idempotencyKey: key('prediction-yes')
  })), 'prediction-yes');
  button(predictions, 'Stake 1 NO · visitor', () => show(f.predictionStake({
    actor: 'u:visitor',
    marketId,
    outcome: 'NO',
    amountFluff: 1000,
    idempotencyKey: key('prediction-no')
  })), 'prediction-no');
  const advance = parent => button(parent, 'Advance rehearsal clock by 1 minute', () => {
    runtime.advanceClock({
      deltaMs: 60000,
      explicit: true,
      idempotencyKey: key('clock')
    });
    status.textContent = `Local rehearsal clock: ${new Date(runtime.now()).toISOString()}. Real system time and canonical quote expiry were not changed.`;
  }, 'clock-advance');
  advance(predictions);
  button(predictions, 'Propose evidence-bound result · resolver', () => {
    const row = f.predictionPropose({
      actor: marketPicker.requireRow().resolver,
      marketId,
      outcome: outcome.value,
      evidence: evidence.value,
      idempotencyKey: key('prediction-propose')
    });
    proposalId = row.proposal.id;
    show(row);
  }, 'prediction-propose');
  button(predictions, 'Approve exact proposal · resolver', () => show(f.predictionApprove({
    actor: marketPicker.requireRow().resolver,
    marketId,
    proposalId,
    idempotencyKey: key('prediction-approve-resolver')
  })), 'prediction-approve-resolver');
  button(predictions, 'Approve exact proposal · independent reviewer', () => show(f.predictionApprove({
    actor: marketPicker.requireRow().reviewer,
    marketId,
    proposalId,
    idempotencyKey: key('prediction-approve-reviewer')
  })), 'prediction-approve-reviewer');
  button(predictions, 'Challenge exact proposal · visitor', () => show(f.predictionChallenge({
    actor: 'u:visitor',
    marketId,
    proposalId,
    reason: 'Local participant disputes the supplied evidence',
    idempotencyKey: key('prediction-challenge')
  })), 'prediction-challenge');
  button(predictions, 'Finalize after challenge window', () => show(f.predictionFinalize({
    actor: marketPicker.requireRow().creator,
    marketId,
    proposalId,
    idempotencyKey: key('prediction-finalize')
  })), 'prediction-finalize');
  const credit = panes.get('credit');
  credit.append(create('small', 'A lender explicitly escrows their own capital. A different borrower locks collateral. Customer custody and prediction collateral cannot fund this offer.'));
  const offerPicker = picker(credit, 'offers', 'Capital offer', 'New lender capital offer', row => row.status === 'open', row => {
    offerId = row?.id ?? null;
  });
  const loanPicker = picker(credit, 'loans', 'Loan', 'New collateralized loan', row => row.remainingDebtFluff > 0, row => {
    loanId = row?.id ?? null;
  });
  const collateralPrice = field(credit, 'Local oracle fixture value (TUMBO per sMIMAS)', 'text', '0.100', {
    'data-oracle-price': '',
    inputmode: 'decimal'
  });
  button(credit, 'Record two independent local oracle roles', () => {
    for (const [source, observer] of [
        ['local-a', 'u:oracle-a'],
        ['local-b', 'u:oracle-b']
      ]) f.oracleObserve({
      actor: observer,
      source,
      baseAsset: 'sMIMAS',
      quoteAsset: 'TUMBO',
      numerator: fluff(collateralPrice.value),
      denominator: 1000,
      observedAt: runtime.now(),
      evidence: 'Explicit local valuation fixture; not a market price or an authenticated external oracle.',
      idempotencyKey: key(source)
    });
    status.textContent = 'Two separately named local fixture observations recorded. Live oracle verification remains unavailable.';
  }, 'oracle-record');
  const principal = field(credit, 'Loan principal (TUMBO-SIM)', 'text', '5.000', {
      'data-loan-principal': '',
      inputmode: 'decimal'
    }),
    collateral = field(credit, 'Locked collateral (sMIMAS)', 'text', '100.000', {
      'data-loan-collateral': '',
      inputmode: 'decimal'
    });
  button(credit, 'Offer 20 TUMBO capital · lender role', () => {
    offerPicker.requireNew();
    const row = f.loanOffer({
      actor: 'u:you',
      asset: 'TUMBO',
      collateralAsset: 'sMIMAS',
      capitalFluff: 20000,
      maxLtvBps: 6000,
      termMs: 3600000,
      expiresAt: runtime.now() + 3600000,
      interestKind: 'FIXED',
      fixedInterestFluff: 50,
      terms: 'Explicit local lender capital. Fixed 0.050 TUMBO-SIM interest; one-hour term; 60% maximum LTV; fresh two-source local oracle; no guarantee.',
      oracle: {
        sources: [{
          source: 'local-a',
          observer: 'u:oracle-a'
        }, {
          source: 'local-b',
          observer: 'u:oracle-b'
        }],
        minObservations: 2,
        maxAgeMs: 300000,
        maxDeviationBps: 500
      },
      idempotencyKey: key('loan-offer')
    });
    offerPicker.choose(row.id);
    show(row);
  }, 'loan-offer');
  button(credit, 'Borrow & lock collateral · visitor role', () => {
    loanPicker.requireNew();
    offerPicker.requireRow();
    const row = f.loanBorrow({
      actor: 'u:visitor',
      offerId,
      principalFluff: fluff(principal.value),
      collateralFluff: fluff(collateral.value),
      idempotencyKey: key('loan-borrow')
    });
    loanPicker.choose(row.id);
    show(row);
  }, 'loan-borrow', {
    primary: true
  });
  button(credit, 'Repay outstanding debt · borrower role', () => {
    const row = loanPicker.requireRow();
    show(f.loanRepay({
      actor: row.borrower,
      loanId,
      amountFluff: row.remainingDebtFluff,
      idempotencyKey: key('loan-repay')
    }));
  }, 'loan-repay');
  button(credit, 'Withdraw unused offered capital', () => show(f.loanOfferCancel({
    actor: offerPicker.requireRow().lender,
    offerId,
    idempotencyKey: key('loan-offer-cancel')
  })), 'loan-offer-cancel');
  const defaultReview = create('details');
  defaultReview.append(create('summary', 'Review margin default and liquidation'));
  credit.append(defaultReview);
  defaultReview.append(create('small', 'Change the explicit fixture valuation above and record fresh observations before attempting a margin action. Stale or conflicting observations block it. Collateral realization is a local in-kind transfer.'));
  button(defaultReview, 'Mark proven margin default · lender', () => show(f.loanDefault({
    actor: loanPicker.requireRow().lender,
    loanId,
    reason: 'margin',
    idempotencyKey: key('loan-default')
  })), 'loan-default');
  button(defaultReview, 'Liquidate after guarded default · lender', () => show(f.loanLiquidate({
    actor: loanPicker.requireRow().lender,
    loanId,
    idempotencyKey: key('loan-liquidate')
  })), 'loan-liquidate');
  advance(panes.get('proof'));
  rules.set('service-request', () => paymentPicker.isNew());
  rules.set('service-authorize', () => paymentPicker.row()?.status === 'requested' && runtime.now() < paymentPicker.row().expiresAt);
  rules.set('service-fulfill', () => paymentPicker.row()?.status === 'authorized' && runtime.now() < paymentPicker.row().expiresAt);
  rules.set('service-cancel', () => ['requested', 'authorized'].includes(paymentPicker.row()?.status));
  rules.set('service-refund-request', () => paymentPicker.row()?.status === 'fulfilled' && runtime.now() <= paymentPicker.row().refundUntil);
  for (const [role, property, amount] of [
      ['creator', 'creator', 'creatorFluff'],
      ['provider', 'provider', 'providerFluff'],
      ['operations', 'treasury', 'treasuryFluff']
    ]) rules.set(`service-refund-${role}`, () => {
    const row = paymentPicker.row();
    return row?.status === 'refund-requested' && runtime.now() <= row.refundUntil && row[amount] > 0 && !row.refundApprovals.includes(row[property]);
  });
  rules.set('service-refund', () => {
    const row = paymentPicker.row();
    return row?.status === 'refund-requested' && runtime.now() <= row.refundUntil && [
      [row.creator, row.creatorFluff],
      [row.provider, row.providerFluff],
      [row.treasury, row.treasuryFluff]
    ].every(([a, n]) => !n || row.refundApprovals.includes(a));
  });
  rules.set('order-buy', () => buyPicker.isNew());
  rules.set('order-sell', () => sellPicker.isNew());
  rules.set('order-match', () => buyPicker.row()?.status === 'open' && sellPicker.row()?.status === 'open' && runtime.now() < Math.min(buyPicker.row().expiresAt, sellPicker.row().expiresAt));
  rules.set('order-cancel', () => buyPicker.row()?.status === 'open');
  rules.set('order-sell-cancel', () => sellPicker.row()?.status === 'open');
  rules.set('prediction-create', () => marketPicker.isNew());
  for (const [name, who] of [
      ['prediction-yes', 'u:you'],
      ['prediction-no', 'u:visitor']
    ]) rules.set(name, () => {
    const row = marketPicker.row();
    return row?.status === 'open' && runtime.now() < row.closeAt && ![row.resolver, row.reviewer].includes(who);
  });
  rules.set('prediction-propose', () => ['open', 'challenged'].includes(marketPicker.row()?.status) && runtime.now() >= marketPicker.row().resolutionAt);
  for (const role of ['resolver', 'reviewer']) rules.set(`prediction-approve-${role}`, () => {
    const row = marketPicker.row();
    return row?.status === 'proposed' && !row.proposal.approvals.includes(row[role]);
  });
  rules.set('prediction-challenge', () => {
    const row = marketPicker.row();
    return row?.status === 'proposed' && runtime.now() < row.proposal.challengeUntil && ![row.resolver, row.reviewer].includes('u:visitor');
  });
  rules.set('prediction-finalize', () => {
    const row = marketPicker.row();
    return row?.status === 'proposed' && runtime.now() >= row.proposal.challengeUntil && [row.resolver, row.reviewer].every(a => row.proposal.approvals.includes(a));
  });
  rules.set('loan-offer', () => offerPicker.isNew());
  rules.set('loan-borrow', () => loanPicker.isNew() && offerPicker.row()?.status === 'open' && runtime.now() < offerPicker.row().expiresAt);
  rules.set('loan-repay', () => {
    const row = loanPicker.row();
    return row?.remainingDebtFluff > 0 && ['active', 'defaulted', 'liquidated'].includes(row.status);
  });
  rules.set('loan-offer-cancel', () => offerPicker.row()?.status === 'open');
  rules.set('loan-default', () => loanPicker.row()?.status === 'active');
  rules.set('loan-liquidate', () => loanPicker.row()?.status === 'defaulted');
  let orderSelection = '',
    loanSelection = null,
    marketSelection = '';
  refreshFinance = () => {
    if (disposed) return;
    const snap = f.snapshot();
    currentSnapshot = snap;
    for (const control of pickers) control.sync(snap);
    const payment = paymentPicker.row();
    servicePrice.disabled = Boolean(payment);
    if (payment) servicePrice.value = (payment.amountFluff / 1000).toFixed(3);
    const buy = buyPicker.row(),
      sell = sellPicker.row(),
      signature = `${buy?.id}:${buy?.remainingLots}/${sell?.id}:${sell?.remainingLots}`;
    if (signature !== orderSelection && buy?.status === 'open' && sell?.status === 'open') lots.value = String(Math.min(buy.remainingLots, sell.remainingLots));
    orderSelection = signature;
    const selectedLoan = loanPicker.row();
    if (selectedLoan?.id && selectedLoan.id !== loanSelection) offerPicker.choose(selectedLoan.offerId);
    loanSelection = selectedLoan?.id ?? null;
    principal.disabled = collateral.disabled = Boolean(selectedLoan);
    if (selectedLoan) {
      principal.value = (selectedLoan.principalFluff / 1000).toFixed(3);
      collateral.value = (selectedLoan.collateralFluff / 1000).toFixed(3);
    }
    const chosenMarket = marketPicker.row();
    question.disabled = Boolean(chosenMarket);
    if (chosenMarket) question.value = chosenMarket.question;
    const proposalSelection = `${chosenMarket?.id}/${chosenMarket?.proposal?.id}`;
    if (proposalSelection !== marketSelection && chosenMarket?.proposal) {
      outcome.value = chosenMarket.proposal.outcome;
      evidence.value = chosenMarket.proposal.evidence;
    }
    marketSelection = proposalSelection;
    outcome.disabled = evidence.disabled = Boolean(chosenMarket && ['proposed', 'finalized'].includes(chosenMarket.status));
    for (const {
        name,
        node
      }
      of actions)
      if (rules.has(name)) node.disabled = !rules.get(name)();
  };
  const off = runtime.kernel.onEvent(() => queueMicrotask(() => queueMicrotask(refreshFinance)));
  refreshFinance();
  return Object.freeze({
    refresh: refreshFinance,
    dispose() {
      disposed = true;
      off();
    }
  });
}
