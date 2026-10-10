# Funded local finance API

Source: `src/domains/economic-finance.js`. Import `createEconomicFinance` from the served module with revision `20261003-complete8`, then call it once with the canonical economic kernel. It registers the `finance` projection and the command types below. All public commands require a payload-bound, unique `idempotencyKey`. A repeated identical request returns the original result; changed fields with the same key are rejected by the kernel.

This is explicit local simulated authority. Selecting an actor is a rehearsal role, not authentication. The module adds no network calls, signing, custody, external oracle, exchange, or regulated lending adapter. All amounts are exact integer fluff in the canonical `TUMBO` or `sMIMAS` asset. Funding comes from existing participant balances; domains never debit `sys:*` or issue assets. Purpose accounts are reserved `b:econ-*` accounts generated from the command key. Every value-moving command uses one atomic journal.

## Payments

`paymentRequest({ actor, payer, creator, provider, treasury, asset = 'TUMBO', amountFluff, creatorFluff, providerFluff, treasuryFluff, expiresAt, refundUntil, terms, idempotencyKey })`

The actor is the creator. Four accounts must be distinct. Treasury may be the operations pool `ECONOMIC_POOLS.operations`; other roles are participants. The three nonnegative splits must sum to the positive request amount. Expiry must be future, and refundUntil must be at or after expiry. Returns a stable `id`, purpose `escrow`, immutable terms, and `status: 'requested'`. No funds move until authorization.

- `paymentAuthorize({ actor: payer, paymentId, idempotencyKey })` reserves the full payment before expiry.
- `paymentFulfill({ actor: provider, paymentId, evidence, idempotencyKey })` credits all three agreed payees atomically before expiry.
- `paymentCancel({ actor: payer, paymentId, idempotencyKey })` cancels a request or returns its authorized reservation, including after expiry.
- `paymentRefundRequest({ actor: payer, paymentId, reason, idempotencyKey })` opens a return request within its window after fulfillment.
- `paymentRefundApprove({ actor: affectedPayee, paymentId, idempotencyKey })` records a new approval by a payee with a positive split. An explicit operations-pool role is accepted only here when it is the affected treasury.
- `paymentRefund({ actor: payer, paymentId, idempotencyKey })` reverses all splits atomically after every affected payee approves, within the refund window. Insufficient payee funds reject the entire refund. A requested refund is disclosed as unsegregated and unguaranteed; it does not pretend cash is already reserved.

## Exact two-asset orders

`orderPlace({ actor, baseAsset, quoteAsset, side: 'BUY' | 'SELL', lots, lotSizeFluff, priceNumeratorFluff, priceDenominatorLots = 1, expiresAt, idempotencyKey })`

The base and quote assets must differ. Each lot contains `lotSizeFluff` base units. The rational price is `priceNumeratorFluff / priceDenominatorLots` quote units per lot. SELL reserves every base unit; BUY reserves the ceiling of its limit-price cost. Returns the order id, sequence, and reserved amount.

- `orderMatch({ actor: eitherOwner, buyOrderId, sellOrderId, lots, idempotencyKey })` requires distinct owners, the same pair and lot size, unexpired orders, crossing limits, and enough remaining lots. The earlier sequence supplies the execution price. The selected lots must yield an exact integer quote amount at that price. One journal transfers base to the buyer and quote to the seller, and releases any buy reservation above the remaining order's required cover. This is a manual local match, with no automated market, external exchange, fill guarantee, or fee implied.
- `orderCancel({ actor: owner, orderId, idempotencyKey })` returns the remaining reservation, including after expiry.

## Lender-specific collateral credit

`oracleObserve({ actor: observer, source, baseAsset, quoteAsset, numerator, denominator, observedAt, evidence, idempotencyKey })`

An observation is a named local claim, with `externalVerification: false`. Future timestamps and non-advancing timestamps for the same source/observer pair are rejected. Each asset pair has at most 16 current observations. The numerator/denominator is quote-asset units per base-asset unit.

`loanOffer({ actor: lender, asset, collateralAsset, capitalFluff, maxLtvBps = 5000, termMs, expiresAt, interestKind: 'FIXED' | 'APR', fixedInterestFluff | aprBps, terms, oracle: { sources: [{ source, observer }, ...], minObservations = 2, maxAgeMs, maxDeviationBps = 1000 }, idempotencyKey })`

The loan and collateral assets must differ. The lender reserves this offer's capital only. Sources and observer roles must be distinct, with two to eight allowed sources. The lender and borrower may not be oracle observers. Freshness is capped at 24 hours; deviation at 50%; principal LTV at 90%; loan term at five years; APR at 1,000%. These are bounds on a local experiment, not advertised financial product terms. FIXED interest is the specified amount per loan. APR interest is `ceil(principal * aprBps * termMs / (10000 * 365 days))`. The full fixed-term interest amount is recorded at origination, and full principal plus agreed interest must initially be collateral covered.

- `loanBorrow({ actor: borrower, offerId, principalFluff, collateralFluff, idempotencyKey })` needs available offer capital and the required independent fresh observations. Observation prices must agree within the offer's immutable policy. The minimum fresh price supplies conservative collateral valuation. Origination atomically transfers that lender's reserved principal to the borrower and borrower collateral to that loan's escrow. Returns debt, due date, exact terms, and oracle evidence.
- `loanOfferCancel({ actor: lender, offerId, idempotencyKey })` returns only the offer's unallocated capital.
- `loanRepay({ actor: borrower, loanId, amountFluff, idempotencyKey })` pays down remaining debt. Final repayment atomically returns held collateral. Repayment may discharge disclosed residual debt after liquidation.
- `loanDefault({ actor: lender, loanId, reason: 'maturity' | 'margin', idempotencyKey })` needs the due date for maturity default, or independent fresh prices showing collateral below remaining debt for margin default. It moves no value.
- `loanLiquidate({ actor: lender, loanId, idempotencyKey })` requires default and a new currently fresh valid oracle gate. It transfers only the collateral required by conservative debt valuation, capped at held collateral, and returns excess collateral to the borrower in the same journal. The local collateral-value settlement credit is disclosed separately from actual cash. Any remaining debt stays an explicit unsecured obligation. There is no external collateral sale or custody sweep.

## Funded binary predictions

`predictionCreate({ actor: creator, resolver, reviewer, asset = 'TUMBO', question, evidenceSpec, closeAt, resolutionAt, challengeMs, maxStakeFluff = 1000000000, idempotencyKey })`

Creator, resolver, and reviewer must be distinct local accounts. Terms and deadlines are immutable. This is a funded binary parimutuel model: maximum liability is exactly the segregated stake pool. It offers no fixed-odds payout that would require unfunded cover.

- `predictionStake({ actor, marketId, outcome: 'YES' | 'NO', amountFluff, idempotencyKey })` reserves a stake before close. Resolver and reviewer may not stake. A market supports at most 128 stakes.
- `predictionPropose({ actor: resolver, marketId, outcome: 'YES' | 'NO' | 'INVALID', evidence, idempotencyKey })` requires resolution time. It creates a stable proposal id, evidence hash, and full challenge window. An unchallenged current proposal cannot be silently replaced.
- `predictionChallenge({ actor: independentChallenger, marketId, proposalId, reason, idempotencyKey })` binds grounds to the exact proposal before its deadline. It invalidates all prior approvals. The resolver must supply a new proposal and restart the challenge window. Up to 16 challenges are retained.
- `predictionApprove({ actor: resolver | reviewer, marketId, proposalId, idempotencyKey })` requires a new independent role approval on the exact current proposal.
- `predictionFinalize({ actor: creator, marketId, proposalId, idempotencyKey })` requires the complete challenge period and both approvals. One journal pays the entire stake pool proportionately to winning stakes. BigInt division and deterministic largest-remainder allocation conserve every unit. INVALID or a result with no winning stakes refunds every stake exactly. Finalization cannot repeat under a new key.

## Projection, replay, and verification

`snapshot()` is deeply immutable and includes payments, orders, offers, loans, markets, observations, and obligations. Obligations disclose reserved cover, actual purpose-account balances and shortfalls, unsegregated refund requests, secured or unsecured borrower debt, and exact prediction maximum liability. `kernel.snapshot().domains.finance` and the kernel's SHA-256 liability commitment use this same projection.

The kernel records every accepted command with its context time and deterministic ids. Restore requires the paired canonical ledger first, then replays commands against its already-recorded journals without another debit. Domain capacity is 256 rows per major entity type; all amounts and aggregate results must remain safe integers, with BigInt intermediates. Oracle-sensitive operations reject unknown, stale, future, conflicting, or dependent evidence.

Verification command:

```powershell
node --test tests/economic-finance.test.mjs tests/economic-kernel.test.mjs
```

Observed result at implementation handoff: **32 tests pass, zero fail** (24 finance, eight kernel). Evidence: `economic-finance-tests.tap`. The tests include all four lifecycles, approvals and refunds, insufficient-funds atomicity, rational matching, APR and extreme-ratio liquidation math, adverse oracle conditions, residual debt, private-state fault injection to exercise escrow cover after blocked public/raw debits, 256/128/16 capacity gates, 24 uneven prediction payout combinations, and restore with unrelated later participant spending. Native UI continuation and browser integration have separate verification.
