# Economic primitives API handoff

2026-10-03, current dirty checkout `work/reality-lens`, branch `fix/reality-lens-calm-2026-10-03`. The workstream changed only these five pure modules and one new test file:

- `src/domains/compute-account.js`
- `src/domains/compute-exchange.js`
- `src/domains/compute-economics-policy.js`
- `src/domains/economic-timeline.js`
- `src/domains/contribution-vault.js`
- `tests/economic-primitives-safety.test.mjs`

No commits, pushes, key changes, real provider execution, deployment or real-money actions occurred in this workstream. These are local economic primitives for the root-owned connected kernel and UI.

## Exact compute-credit account

`createComputeAccount({startingCreditsUsd=0,monthlyBudgetUsd=100,perTaskBudgetUsd=25,now=()=>Date.now(),maxEvents=10000})`

Amounts use exact integers at **100,000,000 compute units per demo USD**. This preserves the existing eight-decimal public cost interface. `toComputeUnits(value,label)` accepts bounded nonnegative decimal/exponent notation, rejects discarded precision, and uses BigInt for parsing. `fromComputeUnits(units)` is display conversion. There is no dollar value assigned to TUMBO-SIM.

| Operation | Contract |
|---|---|
| `fundDemo({fundingId,amountUsd,reason?})` | Positive explicit funding. Exact ID replay returns the prior account state; changed amount/reason throws `IDEM_MISMATCH`. |
| `setBudget({monthlyBudgetUsd?,perTaskBudgetUsd?})` | Positive exact limits; per-task cannot exceed monthly. |
| `preflightSpend({spendId,providerId?,taskId=spendId,amountUsd})` | No economic mutation. Checks payload-bound replay, cumulative task spending/reservations, the UTC calendar-month budget and available unreserved credits. |
| `spendVerified(sameInput)` | Preserved historical API name. Commits a local demo debit; it is not provider billing authentication. Exact duplicate returns `accepted:false,duplicate:true`; mismatched reuse throws. |
| `reserve({reservationId,taskId=reservationId,providerId?,amountUsd})` | Positive hold. Reserves available credits and task/month budget before work begins. |
| `settleReservation({reservationId,spendId,amountUsd})` | Charges an amount from zero to the ceiling and releases unused hold. Overrun returns a rejection with no state change. Exact replay cannot charge again. |
| `cancelReservation({reservationId,cancelId})` | Releases only the named held reservation. Payload-bound cancellation. |
| `refund({spendId,refundId,amountUsd?})` | Partial or full compensating credit, never beyond the unrefunded original spend. Protected rewarded spends require explicit reward reconciliation and cannot refund through this API. |
| `preflightRewardDebit({spendId,rewardId})` | Requires a positive unrefunded debit, verifies immutable identity and issues an opaque WeakMap-owned preparation with `amountUnits`, `providerId`, `taskId`, `period`. |
| `commitPreparedRewardDebit(prepared,settle)` | Holds the account mutation lock while the synchronous single funded-ledger callback runs. Successful settlement records `credits.reward-protected` and returns `{protection,settlement}`. Failed callback leaves the debit unprotected. |
| `exportState()` / `importState(rawObject)` | Schema v2. Validates and replays event operations/checksums; never adopts balances from JSON totals. Failed replay restores the previous owner state. |

Snapshot fields preserve `balanceUsd`, `spentUsd`, `budget`, `events`, and add `balanceUnits`, `availableUnits`, `availableBalanceUsd`, `reservedUnits`, `reservedUsd`, `period`, `periodSpentUnits`, `periodSpentUsd`, reservations and spend rows. `balanceUsd` includes still-owned reserved credits; available credits exclude them. `spentUsd` is lifetime net spending after refunds. Holds crossing a month charge the originally authorized month; cumulative task caps do not reset when the month changes.

Each event has `{sequence,type,source,at,previousChecksum,args,checksum}`. Currency operations live in `args`; exact spend rows carry integer `units` and optional `rewardId`. Checksums detect local corruption but are explicitly non-cryptographic and cannot authenticate external billing.

## Receipt exchange

`createComputeExchangeLedger({rewardPolicy=DEFAULT_REWARD_POLICY,maxReceipts=10000})`

Call `preflightReceipt(raw)` before any debit. Alias: `preflightRecord(raw)`.

- Fresh valid receipt returns `{accepted:true,duplicate:false,receipt,reward}`.
- Exact receipt-ID replay returns `{accepted:false,duplicate:true,reason:'duplicate-receipt',receipt:ORIGINAL,reward:ORIGINAL}`.
- Changed payload for an existing receipt ID throws `IDEM_MISMATCH`; it cannot return a reward computed from new rejected data.
- Invalid/negative/fractional/unsafe token counts and invalid cost fail closed. Totals cannot exceed safe exact units.
- `record(raw)` commits only a successful preflight.
- `exportState()` / `importState(rawObject)` validate schema v2, policy, normalized receipts, unique IDs, checksum and aggregate limits before replacing any state.

The legacy `verified:true` boolean means **declared local rehearsal evidence**. Normalized receipts carry `source:'local-demo-receipt'`, `verificationBasis:'declared-local-rehearsal'`, `billingVerified:false`, `simulation:true`. A checkbox does not establish provider billing authenticity. Actual NVIDIA usage without billing cost remains unverified for spend-derived incentives.

Route selection preserves quote ID and model, respects explicit missing capability, and rejects unknown latency under a finite latency cap. Infinity may still represent an unbounded policy/unknown latency in the pure router; renderer/timeline publication must convert it to explicit null/unavailable metadata.

## Contribution consent and one-time entitlement

`createContributionVault({now=()=>Date.now(),maxContributions=2000})`

Existing `propose`, `authorize`, `revoke`, `accept`, `snapshot` remain. Proposal IDs are payload-bound. Provider-specific consent requires a known `providerId`, and acceptance must name the same provider. Research-only consent cannot permit training. Acceptance evidence belongs to only one contribution. Revocation is terminal for the proposal ID and cannot create a second acceptance reward. Retention expiration blocks new acceptance and unclaimed payout.

`preflightAccept(contributionId,{evidenceId,providerId?})` checks eligibility without changing economic state. Exact acceptance replay returns the original entitlement. Entitlement is integer `rewardFluff` (one fluff per authorized unit, capped at 1,000), with `rewardTumboSim=rewardFluff/1000`; the root ledger must fund actual payout.

`preflightClaim({contributionId,claimId})` returns an opaque owner-issued preparation. `claimReward(input,{prepared?})` consumes an entitlement only; it explicitly returns `transferExecuted:false` and is useful for validated replay/legacy API compatibility.

For funded integration use:

```js
const prepared = vault.preflightClaim({contributionId, claimId});
const {claim, settlement} = vault.commitPreparedClaim(prepared, () =>
  ctx.post(oneBalancedCanonicalRewardJournal)
);
```

`commitPreparedClaim` validates owner identity/state, fixes authorization time before posting, locks all vault mutations during the synchronous callback, rejects genuine async functions before invocation and rejects thenable returns. It acknowledges only after callback success. A preparation cannot be cloned, forged, reused or consumed after an intervening vault mutation. A millisecond expiry crossing does not invalidate an already authorized synchronous payout. The callback contract is one synchronous settlement operation that returns its receipt; do not place an asynchronous step or throw additional work after the ledger post inside this callback.

Consent events are schema-v2 operations with local corruption checksums. `exportState()` / `importState(rawObject)` replay accepted evidence, revocation and consumed claims atomically. Raw conversations, prompts and files are never accepted by this vault.

## Timeline and margin allocation

Timeline deep-copies and freezes bounded JSON metadata, rejects executable/cyclic/non-finite data, verifies exact sequence/checksum order, and supports validated export/import. Its FNV checksum remains a local ordering check, not cryptographic EchoProof.

`createEconomicTimeline({maxEvents=10000,maxExportChars=1000000})` additionally preflights exportability. Runtime payloads fit depth 14 below their four wrappers, arrays up to 4,000 and objects up to 100 fields. Sparse arrays are rejected. Type/source strings share the 8,192-character metadata text bound. History is capped at one million serialized characters, including event/wrapper overhead; a smaller configured cap must be at least 1,000. Append and import reject excess capacity before changing accepted history. The shared `sealEconomicMetadata` helper keeps its existing broader compatibility bounds for other pure owners. WebAI treats an exhausted timeline as a disclosed projection limit and continues recording the paired economic debit/usage.

`evaluateComputeEconomics` calculates on integer credit units with whole basis-point allocation rates. It allocates only positive revenue minus provider/ops cost, floors each share, and puts the exact conserved remainder in retained margin. A one-unit margin cannot produce two one-unit allocations or negative retained value. Output retains dollar display fields and adds exact unit fields.

## Verification

Executed command:

`node --test --test-reporter=tap tests/economic-primitives-safety.test.mjs tests/compute-exchange.test.mjs tests/compute-economy-expanded.test.mjs tests/compute-economics-policy.test.mjs tests/compute-world-projection.test.mjs tests/web-ai-compute.test.mjs`

**47 tests passed, 0 failed, 0 skipped.** Of these, 30 are new safety/interaction tests and 17 preserve existing contracts. The new tests cover exact money parsing, payload-bound funding/receipts, finite router caps, reservations, ceiling reconciliation, cancellation, cumulative task budgets, month rollover, holds crossing months, refunds, validated replay, minimum-unit margin conservation, deep-sealed ancestry, provider-scoped consent, evidence/claim replay, expiration, prepared-claim expiry crossing, real canonical-ledger observers attempting consent/refund mutation, failed/async settlement, and durable refund protection.

Log: `outputs/reality-lens-review/economic-primitives-tests.tap`. Scoped `git diff --check` found no whitespace errors; Git emitted the repository's usual LF-to-CRLF notices.

The report `economic-runtime-gap-audit.md` retains the **pre-repair audit stage** and now has a separate current implementation acceptance section. The initial probe JSON remains historical. Current connected tests and probes are listed below.

## Compute owner restore handoff

The subsequent authorized source ownership includes `src/domains/compute-jobs.js`, `tests/compute-jobs.test.mjs` and `tests/economic-runtime-invariants.test.mjs`. All source is frozen after the bounded identity/model repairs.

`compute.validateRestoredState()` must run **after** account/exchange/vault imports and kernel command replay, and **before** any candidate replaces the active canonical owner. It does not copy balances, post a journal or acquire a second financial authority. It throws `Compute restored streams disagree: ...` on inconsistency; on success it returns `{ok:true,jobCount,claimCount,canonicalChainValid:true}`.

Validation reconciles every job's exact provider/task/ceiling, credit hold status, settlement/refund, model, token counts and amount with its credit reservation/debit and usage receipt. It rejects orphan reserved `job:` and `job-usage:` identities. Each paid compute claim must bind to an unrefunded exact debit protected by `rewardId === claimId`. Each contribution payout must bind to its immutable accepted entitlement consumed using the canonical command key. Claims require the exact canonical receipt ID/key/action, receipt/hash ancestry, policy metadata commitment, reward-pool debit, beneficiary credit, amount and day. The root runtime already invokes this gate before candidate adoption.

The identity bounds are consistent with the receiving owners: jobs up to 120 characters create usage IDs up to 130; compute evidence accepts at most 152 so the `compute:` protected identity fits the credit owner's 160 limit; contribution evidence preserves the vault's full 160-character bound. Model/tool identity is capped at 120 before any credit hold because the exchange stores that maximum.

Current connected test command and result:

```powershell
node --test --test-reporter=tap tests/economic-kernel.test.mjs tests/compute-jobs.test.mjs tests/economic-runtime-invariants.test.mjs tests/economic-runtime.test.mjs tests/economic-primitives-safety.test.mjs tests/economic-finance.test.mjs tests/creator-economy.test.mjs
```

**139 tests passed, 0 failed, 0 skipped** at the final compute/timeline freeze. TAP: `economic-runtime-invariant-tests.tap`. Additional tests cover all job terminal/pending states, direct off-owner compensation divergence, orphan holds/consumed consent, valid-prefix deletion of protection/claim/usage/settlement/refund/kernel/clock ownership, exact paired reward replay, legacy WebAI protected claims, maximum-length IDs, model rejection before reserve, metadata boundary reload and atomic timeline history budgets. Current capacity and paired probes confirm owner limits, failed-observation rollback, exact retries, paid refund protection and no replacement of the fresh owner on corrupt history. Rendered/public-release acceptance remains separate parent evidence.
