# Reality Lens economic runtime gap audit

**Stage note:** the original audit below is historical evidence from before repair. A connected local kernel, finance, creator and compute runtime now exists. The implementation acceptance immediately below records the subsequent source, tests and probes; it supersedes the original gap table when judging current behavior. The external-authority boundaries remain deliberate.

Audit date: 2026-10-03. Checkout: `work/reality-lens`. Branch: `fix/reality-lens-calm-2026-10-03`. HEAD at initial inspection: `a12462cd865dc094a44c58f6d11ef8061eb7b79e`, with concurrent authorized repairs. The initial read-only audit inspected dirty source. This workstream subsequently implemented the authorized primitive modules and compute cross-stream validation; other agents own runtime, kernel, finance, creator and rendering changes.

## Subsequent implementation acceptance

The current runtime uses **one canonical QuoteEngine**, separate exact simulated USD credit accounting, and projection-only economic views. It implements actual local transitions rather than display-only balances. Current reproducible product scope is documented in `work/reality-lens/docs/OURPLACE_ECONOMY.md`.

| Current mechanism | Verified acceptance | Evidence |
|---|---|---|
| Credit ownership | 100,000,000 integer credit units per simulated USD; payload-bound funding/spend; cumulative task caps and UTC calendar months; holds, final-charge reconciliation, cancellation, bounded compensation | Primitive safety tests; historical API compatibility tests |
| Compute work | Privacy/cost ceiling, held credits, actual deterministic installed text tool, output commitment, explicit simulated billing, unused hold release, cancellation/refund | `compute-jobs.test.mjs`; the local tool does not claim LLM inference or authenticated provider billing |
| Paid usage protection | A funded canonical journal and immutable credit protection commit together under a synchronous owner guard; a paid spend cannot be directly refunded | Real canonical onCommit observer tests; protected refund after paired reload |
| Consent reward | Immutable provider-bound metadata acceptance, retention, terminal revocation and one consumed entitlement; funded journal acknowledgement guarded against observer mutation | Primitive safety tests; contribution reward/reload tests; no raw prompt/file corpus stored |
| Shared restore | Independently valid streams are reconciled causally before candidate adoption; a credit/consent/usage/kernel prefix cannot silently erase newer obligations or paid claims | Runtime invariant tests, including valid-prefix deletion with recomputed outer digests |
| Reward receipt ancestry | Exact two-leg purpose-pool/beneficiary postings, amount, action, policy commitment, canonical receipt hash, owning kernel command and day; computed amount uses the configured exchange policy | `compute.validateRestoredState()`; connected rewarded jobs and legacy WebAI claims |
| Purpose segregation | Ordinary transfer/facade/stake/quote/raw-post routes cannot debit economic pools or escrows, including internal-authority options | Current segregation probe: sweep blocked, thief balance zero, held payment remains covered, receipt chain valid |
| Creator economy | Reviewed immutable descriptors, explicit local publishing, portable licensed lineage, independent local observations, anti-repeat caps, funded attribution payouts | Current creator tests and paired creator payout probe; imported author declarations do not acquire local payout authority |
| Local finance | Funded service escrow and exact split/refund, rational two-asset matching, lender capital and collateral/oracle/interest/default/liquidation, segregated prediction stake/challenge/two-role resolution/payout | Current finance tests, including all four paired lifecycle replays and exact conservation |
| Minimum-unit sustainability | Positive-margin basis-point allocation floors shares and retains the exact remainder; no negative residual or excess allocation | One-unit/uneven allocation safety tests |
| Deep history | Immutable timeline JSON fits the shared wrapper depth, row/field limits and one-million-character history budget; sequence/checksum replay; view exhaustion disclosed instead of interrupting accounting | Timeline atomic-budget tests and exact-bound runtime reload; WebAI best-effort projection source reviewed |
| Exportable capacity | Owner preflight bounds 3,000 canonical journals, 1,000 issued quotes and two-million-character command history; rejected adoptions roll back observations; time offset equals recorded advances | Kernel/runtime boundary tests and current capacity probe |

Executed after compute source freeze:

```powershell
node --test --test-reporter=tap tests/economic-kernel.test.mjs tests/compute-jobs.test.mjs tests/economic-runtime-invariants.test.mjs tests/economic-runtime.test.mjs tests/economic-primitives-safety.test.mjs tests/economic-finance.test.mjs tests/creator-economy.test.mjs
```

Final focused result: **139 passed, 0 failed, 0 skipped**. Log: `economic-runtime-invariant-tests.tap`. Scoped source/test `git diff --check` passed, with the usual LF-to-CRLF notices only. This count includes concurrent kernel/runtime/creator additions visible in the shared checkout. The earlier 47-test primitive run remains a separate evidence set, not an additional independent coverage total.

`economic-runtime-paired-verification.json` confirms 11 unchanged canonical journals after restoring funded compute and consent, a paid creator plan and held payment. Corrupt outer metadata, corrupt inner replay and a missing paid-debit protection prefix are rejected without replacing the fresh canonical owner. `economic-segregation-probe.json` confirms the originally demonstrated escrow sweep is now rejected.

The final capacity audit initially reproduced two further root-owned defects: 4,004 native journals exceeded the bundle's 4,000-row JSON limit, and 4,001 rejected adoption attempts retained observations beyond creator-history limits. Both are now repaired and independently reprobed. Current `economic-runtime-capacity-probe.json` records the intentional 3,000-journal stop before a new debit, an exact retry with no new journal, a successful 2,967,417-character export, and 4,001 rejected adoption attempts retaining **zero** observations with export still available. A saved time offset whose advance command was removed is rejected with the offset restored to zero.

Kernel input validation reserves **four** nesting levels for `bundle.kernel.commands[index].input` before any handler can settle; the exact shared-depth boundary test accepts, persists and reloads a 13-object extra field, while rejecting the next level without a payment or journal. Command storage reserves wrapper/receipt overhead within its two-million-character budget, and receipt labels are capped before posting. Timeline validation likewise accounts for its four wrappers, limits payload depth to 14, rows to 4,000 and object fields to 100, rejects sparse arrays and oversized type/source text, and preflights a maximum one-million-character history. A valid but over-budget imported timeline fails atomically. The shared primitive sealing helper retains its independent compatibility limits.

The external production boundaries are unchanged: participant identities/observations are local rehearsal roles, provider usage is not authenticated billing, portable author integrity is not identity attestation, oracle/resolver roles are fixtures, and neither SHA-256 commitments nor the canonical FNV chain imply signatures, custody, external settlement or public deployment. Browser/package/release acceptance is tracked by the parent workstream and is not asserted by this domain audit.

## Original pre-repair audit

The expanded request is to implement the full economic idea while making Reality Lens clean and usable. The current Compute tab rehearses several separate calculations, but it does not yet implement the connected economic operation described in `docs/COMPUTE_ECONOMY.md`. A connected **local** economy can be implemented now. Authenticated external inference, provider billing authenticity and real-money settlement remain separate capabilities that cannot be manufactured by browser code.

## What is actually present

| Requirement from the economic thesis | Current authoritative implementation | Evidence and limit |
|---|---|---|
| One task across eligible models/providers | Provider registry and manually entered quote ranking | `src/domains/compute-exchange.js:23-31,108-213`; quote ranking returns provider/cost/latency, but drops model and quote identity. No task/job is created or executed by selection. |
| Compute credits and guardrails | Separate renderer-created `createComputeAccount` | `src/render/web-ai.js:242-245`; explicit funding, per-call cap, balance cap and cumulative spend cap work. No reservation, refund, subscription period, budget rollover or reconciliation operation exists. |
| Actual usage evidence | Manually entered receipts | `web-ai.js:1053-1139`; a checkbox sets `verified:true`. This is an explicit receipt lab, not authenticated provider spend. |
| NVIDIA inference | Separate bounded server-side prototype bridge and API Connections surface | `scripts/provider_bridge.py:134-182`, `src/render/api-connections.js:263,311`; successful responses expose sanitized usage, model and verification time, but not billing cost or a stable economic receipt ID. No call to `recordComputeUsage` links the response to credits/rewards. No inference was run in this audit. |
| PAYCORE meter | Independent static balance/flow fixture | `src/core/demo-projection.js:65-71`, `src/domains/paycore.js:146`; preview never mutates balances. Compute receipt `economicLoop` strings name PAYCORE but do not update it. |
| T402 route/escrow | Independent static offer/route/escrow fixture | `demo-projection.js:167-173`, `src/domains/t402.js:158`; no active compute job controls its lifecycle. Canonical token transfers now provide a real local two-phase escrow adapter, which should be reused. |
| Reward accrual | Compute receipt accumulator and separate contribution accumulator | `compute-exchange.js:215-294`, `contribution-vault.js:108-151`; totals are display numbers, not funded canonical-token transfers. They have no shared reward-tranche owner or combined cap. |
| Contribution consent | Metadata-only proposal, authorization, acceptance and API revocation | `contribution-vault.js`; positive existing boundary: raw content is not accepted. The UI combines authorize and accept, offers no revocation action or receipt inspection, and provider-specific consent lacks a provider binding. |
| Self-hosted provision, tools/agents, marketplace splits | Listed as planned | `docs/COMPUTE_ECONOMY.md` Earning channels; `web-ai.js:607-613`. No offer registration, service job, creator split or local settlement exists. |
| Sustainable treasury | Independent planning calculator | `compute-economics-policy.js`; the positive-margin rule is sound in intent, but the calculation is disconnected from actual jobs and has a rounding defect. |
| Prime Ledger / EchoProof ancestry | Independent static fixture plus a separate FNV demo timeline | `demo-projection.js:152-164`, `economic-timeline.js`; compute emits a proof target only. The ledger console does not display actual canonical QuoteEngine journals. |
| Canonical shared token balances | Repaired QuoteEngine + facade, transfer, vault, activity, BotPay adapters | Existing token repair source is useful infrastructure. Compute and Contract Atelier do not consume this engine. Do not restore a competing token ledger. |
| Contract/value operations | Contract lifecycle and house/YES-NO/pool models | `contract-atelier.js:331-470`; stakes, capital and proceeds are independent rehearsal-credit bookkeeping. No participant account is debited, no collateral is held, and resolution is not bounded by shared funded account balances. |
| Spatial projection | Dynamic `compute-economy-world` contribution | `src/main.js:7845-7880`, `compute-world-projection.js`; world graph receives receipts/consent/timeline entities, but this does not synchronize PAYCORE/T402/Prime Ledger console sources. |
| Durable local economic history | None for compute state | Compute owners are recreated inside the renderer; `web-ai.js:1351` declares no persistence. Note/URL/position storage is separate from economic state. |

## Defects reproduced with current executable domain modules

Reproduction: `node work/economic-runtime-probe.mjs` from the workspace root, or `node economic-runtime-probe.mjs` from `work`. Results are saved in `outputs/reality-lens-review/economic-runtime-probe.json`. These are domain/API-sequence probes; they are not claimed as visual browser proof.

1. **Duplicate receipt can debit credits without recording usage.** Record an unverified `same` receipt first. `recordComputeUsage` normalizes a verified retry for `same`, debits the account, then calls the exchange ledger. The debit succeeds; the exchange rejects the duplicate. Credits drop from $10 to $8 although the only stored receipt still has zero reported cost. The rejected result also returns a reward calculated from the newly submitted $2 payload rather than the original receipt. Source: `web-ai.js:1378-1393`, `compute-exchange.js:220-223`.
2. **Margin rounding can allocate more than the available margin.** A margin of `0.00000001` with 50% reward and 50% reserve produces two `0.00000001` allocations and retained margin `-0.00000001`. Rates total 100%, so the existing validation misses the over-allocation. Source: `compute-economics-policy.js:39-46`.
3. **Unknown latency bypasses a finite latency cap.** A local quote with cost 1 and missing latency is selected under `maxLatencyMs:1000`; the comparison only runs for finite estimates. Source: `compute-exchange.js:182-188`. A finite cap needs known, bounded evidence or a precise rejection.
4. **The append-only timeline is shallow and caller-mutable.** Append a payload `{amountUsd:1}`, then change the original object to 999. The recorded event changes to 999 and `verifiedLocalChain` becomes false. Source: `economic-timeline.js:30-45`. Deep-copy/deep-freeze accepted metadata before sealing it.
5. **Consent can be reaccepted after revocation with the same contribution ID.** `authorize` blocks direct rewriting of accepted consent, but revocation changes state and reauthorization becomes allowed. A second accept replaces the evidence and emits another accepted event. Current total stays 1 rather than doubling, but connecting event-driven payouts would create a replay hazard. Provider-specific consent also accepts no provider identity. Source: `contribution-vault.js:74-130`.
6. **Invalid usage evidence is silently converted.** Negative input tokens become zero and fractional output tokens are floored, even for `verified:true`. Unsafe/invalid counts should be rejected at an economic evidence boundary. Source: `compute-exchange.js:40-83`.
7. **Funding replay is not payload-bound.** Reusing `fundingId:fund` with amounts 10 then 90 silently returns the first snapshot. It does not double-fund, but does not identify a mismatched request; preserve the original receipt and reject mismatched payloads. Source: `compute-account.js:61-68`.

Additional structural deficiencies are source-proven, rather than reproduced as failures: monthly budget means lifetime page-session spending; there is no monthly key or rollover. Per-task cap means per-receipt amount, so splitting one task into receipts bypasses a task-total cap. Pending work cannot reserve budget; simultaneous future jobs can each pass an available-balance check. Receipt model/cost metadata is not bound to an issued quote or job. Contribution acceptance requires a nonempty evidence string but not a unique scoped acceptance evidence record. Timeline does not load/replay persisted state.

## Supply and specification conflict requiring an explicit reconciliation

`token-config.js:20` configures 10,000,000,000 **fluff**, meaning 10,000,000 TUMBO-SIM at 1,000 fluff/unit. `asset-token.js:17` projects 1,000,000,000 **TUMBO-SIM units**, with eight allocation classes and eighteen aggregate launch cohorts. `docs/TOKEN.md` and `TOKEN-CONTRACT.md` call the public supply undecided, while later launch documents and current UI show the fixed billion-unit fixture. These are different universes, not equal units.

Do not change canonical numeric token configuration silently to make the numbers agree. Either implement the known economic allocation as a labeled projection of its own explicit manifest, with a mathematically verified scale bridge to the runtime funded supply, or resolve the product decision in a consolidated economic specification using recovered user intent. The UI must distinguish a historical aggregate launch rehearsal from the actual local ledger's circulating/funded simulation totals.

The older token document also describes a constant-product AMM, yield tranches, activity-linked rolling sink guard and dynamic entry/exit fees, while current QuoteEngine uses a fixed rational market rate and a configured Void tithe. This should not be called implementation of those different mechanisms. Preserve the currently repaired exchange and decide which explicitly recovered economic requirements must be implemented next.

## Concrete implementation plan

### 1. Give the economic state one owning coordinator

Add a domain owner such as `economic-runtime.js`, injected with the existing canonical QuoteEngine and clock. It owns task IDs, issued compute/service quotes, job lifecycle, exact demo compute-credit accounting, policy periods, funding/debits/reservations/refunds, acceptance evidence, allocation receipts and timeline. The renderer renders and invokes the owner; it does not create independent economic systems or authorize receipt verification.

Keep distinct units: raw usage tokens are evidence, demo compute credits are accounting units, and integer fluff is canonical TUMBO-SIM. Do not assign a fiat price or guaranteed conversion to TUMBO-SIM. Economic TUMBO transfers use the existing engine and funded system tranches. Demo compute-credit accounting can remain a separate unit inside the coordinator, with its own balanced integer journal; it must never become a second TUMBO ledger.

### 2. Implement a complete runnable local job before connecting external billing

The concrete flow should be:

`draft task → collect issued eligible quotes → rank with reason → authorize one quote → reserve maximum local charge → execute named local/demo adapter → attach adapter-owned result and usage evidence → reconcile final charge → release unused reservation → allocate funded rewards/creator revenue → record causal receipts → project identical state everywhere`.

Add visible failure paths: no eligible quote, unknown billing, insufficient credits, cap failure, expired quote, cancellation before execution, execution failure/refund, cost overrun awaiting a new authorization, duplicate response and retry. Every mutation uses a payload-bound idempotency key and either commits completely or changes nothing. A local adapter can perform a genuine deterministic local text/data operation, with an explicitly rehearsed quote/cost where relevant; do not present estimated tokenizer counts as provider-reported LLM tokens.

NVIDIA can produce actual inference evidence through the existing bridge when configured. Usage-only success must not be upgraded to billing-verified spend. Where provider cost is absent, fail closed for spend-derived rewards and clearly show the billing-evidence gap.

### 3. Make all earning channels actual local operations

Implement owner-registered compute capacity and creator tool/agent/service offers with explicit local simulation quotes, caps, capabilities and privacy. Execute an actual local service job and settle a predefined split only after its result/receipt is accepted. Reuse canonical token transfer/escrow ownership for TUMBO-denominated offers; community/remote access remains disabled until separately configured.

Contribution proposals remain metadata-only. Separate explicit authorization from acceptance, bind provider-specific scopes to an allowed provider, bind evidence to the contribution/version/purpose, prevent duplicate payout, expose revocation in the UI, preserve old evidence in history, and enforce expiration/retention through an injected clock. Reward transfers must draw from a funded capped rehearsal tranche. Revocation never manufactures a new reward for the same accepted contribution.

### 4. Enforce sustainable allocation with exact integer conservation

Move treasury planning into the job settlement path. Store demo costs/revenue as exact integer microcredits, rates as basis points, floor allocations and assign the conserved remainder to retained margin. No rewards, reserve, creator allocation or future burn budget can exceed positive post-provider/ops margin. Separately bound TUMBO reward units by the policy's funded tranche without claiming that one reward unit has a real-dollar value. No real burn executes; any local burn rehearsal must be an actual canonical Void receipt and be labeled accordingly.

### 5. Connect named economic surfaces to the same receipts

Generate PAYCORE, T402 and Prime Ledger contributions from the runtime snapshot plus canonical engine journals rather than maintaining parallel fixtures. PAYCORE shows exact credits/balances/charges. T402 shows issued offer, authorization, hold, verification, release/cancel state. Prime Ledger shows actual debit/credit postings and causal job/reward/consent ancestry; FNV local checks remain labeled non-cryptographic. Project job, provider, offer, contribution, allocation and receipt bodies into the native Reality Lens space; keep detailed controls on the selected body's front.

Contract Atelier and Outcome Desk require a funded account/escrow adapter before they can be part of this shared economy. Participant names must map to canonical accounts; stake and house-capital operations debit actual local funds, selling returns bounded funds, payouts cannot exceed held collateral, and claims must be single-use canonical receipts. Preserve distinct pure scenario mode when no financial adapter is installed.

### 6. Verify recovery and usable interaction

Persist an explicitly versioned, bounded local event stream, then reconstruct owners from events and verify every journal/idempotency binding. Never restore trusted balances by copying JSON totals. Corrupt/version-mismatched state must have an inspectable safe recovery path. Include explicit export/reset controls and no stored prompts, content or credentials in the economic log.

Browser acceptance: one task from quote to actual local result, budget reservation/reconciliation, cancel/refund, exhausted budget, contribution consent/accept/revoke, creator split, funded contract stake/claim, reload replay and the same receipt visible in Compute, PAYCORE, T402, Asset Token and Prime Ledger. Check desktop and phone, one native owner front, no startup financial chips, no overflow, no console exceptions.

## Verification status

Command executed against current source:

`node --test tests/compute-exchange.test.mjs tests/compute-economy-expanded.test.mjs tests/compute-economics-policy.test.mjs tests/compute-world-projection.test.mjs tests/web-ai-compute.test.mjs`

Result: **17 tests passed, 0 failed**. Those tests validate isolated happy paths, router policy examples, projection creation and source/UI labels. They do not cover the reproduced duplicate debit, atomic job lifecycle, allocation rounding, consent reacceptance, monthly rollover, canonical reward funding or cross-surface causal behavior. The green focused result therefore does not prove a complete connected economy.

This audit changed only its own reproduction script and two output artifacts. It did not change source, tests, commits, keys, external providers, deployment or live financial authority.
