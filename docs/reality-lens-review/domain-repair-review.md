# Reality Lens domain repairs and independent integration review

Date: 2026-10-03
Reviewer: domain_repairs agent; source owner for the canonical token/projection/Contract Atelier repair slice.

## Checkout and evidence boundary

The actual shared checkout reviewed is `C:\Users\carlg\Documents\Codex\2026-10-03\muse-pc-bridge-running-sharing-folder\work\reality-lens`, branch `fix/reality-lens-calm-2026-10-03`, HEAD `a12462cd865dc094a44c58f6d11ef8061eb7b79e`. The repairs are working-tree changes shared with root and two other agents. No commit, push, merge, or deployment was performed by this reviewer. Node used for these checks: v24.19.0.

This report records functional repairs, the current API contract, test migrations, and an independent source review of root's nested token controls and Windows launch/stop/package scripts. It does not substitute for root's full-suite, browser, device, archive, or launch proof. UI findings below were source-reviewed unless an explicit runtime probe is described.

## Verified scoped results

The following scoped runs passed without failures, cancellations, skipped tests, or TODOs at their recorded repair stage. The final 264-token aggregate below overlaps the earlier scopes; these counts are not additive:

| Scope | Checks | Result |
| --- | ---: | --- |
| Canonical token, activity, facade, vault, persistence, lifecycle, firewall, projection | 179 | 179 pass |
| Contract Atelier domain, algorithmic house/pool, safety, mounted approval flow | 42 | 42 pass |
| Token ticker presentation plus actual engine reversal boundary | 17 | 17 pass |
| BotPay and transfer adapters after canonical URL normalization | 62 | 62 pass |
| Portal issuer/session graph and foreign-capability rejection | 16 | 16 pass |
| Final token aggregate after first-use ownership/layer repairs | 264 | 264 pass |

Token/projection command:

```powershell
node --test tests/token-idempotency.test.mjs tests/token-facade.test.mjs tests/token-ledger.test.mjs tests/token-gamification.test.mjs tests/token-vault.test.mjs tests/token-unified.test.mjs tests/token-exchange.test.mjs tests/token-lifecycle-unified.test.mjs tests/token-firewall.test.mjs tests/projection-session.test.mjs
```

The 179 checks comprise projection 4, exchange 20, firewall 6, facade 10, gamification 33, idempotency 17, ledger/store 38, unified lifecycle 23, unified token 12, and vault 16.

Contract command:

```powershell
node --test tests/contract-atelier.test.mjs tests/contract-atelier-domain-extra.test.mjs tests/contract-atelier-house-pool.test.mjs tests/contract-atelier-safety.test.mjs tests/contract-flow-atelier.test.mjs
```

Final review repair command:

```powershell
node --test tests/token-ticker.test.mjs
node --check src/render/token-ticker.js
node --check src/domains/token-vault-ui.js
git diff --check -- src/render/token-ticker.js tests/token-ticker.test.mjs src/domains/token-vault-ui.js
```

These commands exited successfully. Scoped syntax and diff checks for the earlier domain repair slice also passed at its freeze. Git reported ordinary LF-to-CRLF working-copy notices, with no whitespace errors.

The media agent originally reported 20 BotPay checks and 38 transfer checks passing, and 81 combined checks with unified lifecycle. After final cache normalization, this reviewer repaired owner recognition and added four adapter checks: 22 BotPay plus 40 transfer checks were independently rerun and passed. Their 62 checks are separate from the 179 count.

## Current token contract and functional repairs

### One canonical financial owner

`src/domains/token.js` remains the financial authority for this local simulation: QuoteEngine owns TokenLedger, quotes, lifecycle receipts, and wallet operations. Activity, vault, BotPay, and transfers adapt this engine. Their own maps track local UI metadata, claims, positions, or escrow ownership; they do not maintain competing spendable balances. An explicitly constructed isolated engine remains useful for standalone tests and factory callers.

The existing economic values were retained and centralized through `token-config.js`: TUMBO supply 10,000,000,000 fluff, sMIMAS supply 100,000,000,000 fluff, market TUMBO float 1,000,000,000 fluff, faucet inventory 500,000,000 fluff, and price 1 TUMBO to 10 sMIMAS. Canonical quotes expire after 60,000 milliseconds. The old tick-based quote TTL remains identified as a legacy constant. Market settlement retains the configured 10-basis-point Void tithe and reciprocal sell pricing.

These are integer simulation balances. Receipt hashes are integrity checks for the local data model, not external signatures, credentials, or proof of real settlement.

### Atomic posting and replay intent

TokenLedger now binds every idempotency key to the complete posting request. Reusing a key for altered legs, action, memo, or links is rejected as an intent mismatch. Posting aggregates and validates every resulting balance before opening accounts or mutating balances, tick, or journal history. An underfunded or invalid transaction leaves those structures unchanged.

Canonical receipt hashes bind lifecycle and adapter ownership links as well as postings. QuoteEngine remembers the hashes of quotes it issued: a caller cannot change a quote, calculate a new hash, and thereby obtain engine approval; a quote from another engine is also rejected. Constructor parameters for supply/price/tithe/TTL are checked before use. Quote expiry is exclusive: execution at `now >= expiresAt` is rejected.

Faucet and cancellation replays bind their original intent. Wallet sends bind sender, recipient, asset, amount, and memo. A valid replay returns the original receipt without a second balance change, ledger commit, or observer wave. Event observer failures cannot unwind a committed settlement. Ledger `onCommit` supports persistence without introducing another financial owner.

Conservation, request mismatches, unchanged failure state, forged and foreign quotes, receipt-link tampering, and duplicate event suppression are exercised in `token-ledger`, `token-idempotency`, `token-exchange`, `token-unified`, `token-firewall`, and `token-lifecycle-unified` tests.

### Wallet locks and vault ownership

Wallet locks now use the canonical `sys:vault` account. User/bot ownership is checked; ordinary callers cannot use the wallet lock API to acquire treasury principal. Lock records carry hashed owner, amount, asset, label, and maturity links. They reconstruct from journal history after snapshot reload. A lock whose opening receipt has been reversed cannot later unlock against another participant's vault principal.

The new `token-vault.js` adapter implements stake, deposit, lock, withdrawal, savings pockets, reward estimates, maturity, and local vault ticks against this same engine. Decimal input parsing uses exact integer math and rejects more than three decimal places. Savings pocket identifiers are derived from the owner/goal and hash, and their ownership is checked. Initial simulated grants use canonical inventory and fixed replay keys. Simulated rewards come from existing inventory, with principal and reward paid atomically.

Open positions, closure state, pocket ownership, local vault ticks, and replay request metadata reconstruct from canonical journals. Reloading or attaching a second adapter cannot repeat a grant or release. Reversing an opening journal invalidates its later withdrawal. Owned open position principal must be covered by the shared vault balance; other adapters may also have funds there. Accordingly, the UI's former claim `vault = open positions` was replaced with `OK — owned positions covered` during the final review repair.

The 16 dedicated vault checks cover mixed assets, conservation, maturity, release replay, ownership/input validation, rewards, pockets, and chain verification. Additional ledger/idempotency checks cover reconstruction, reversed openings, and shared wallet/vault ownership.

### Activity and object visibility

The new `token-activity.js` adapter supplies local presence, ribbon, daily drip, tip/send/lock, and hunger audit behavior without a second balance engine. Financial actions post through the canonical ledger. Its displayed receipts retain the actual ledger tick and hash; local gameplay ticks are a separate field. Tick overflow fails before financial mutation. Day-aware claim replay remains safe after a day advances and after reconstruction from journals.

Activity observes financial receipts from other shared-engine adapters without reposting them. A financial receipt is emitted and shown once. Pure UI clock advancement with no journal-backed claim is local metadata; this report does not claim arbitrary gameplay clock state is persisted.

`token-gamification.js` and its renderer now consume this adapter instead of removed prototype exports. The renderer exposes `setVisible(next, {objectVisible = true} = {})`. Hiding closes its panel, clears drag/hover/selection state, hides cube/tether/chip/peek, and restores camera controls. `setVisible(true, {objectVisible:false})` permits the panel to open inside the existing Asset Token surface while leaving the secondary object inert and hidden. Default standalone renderer behavior is preserved.

Root owns the main navigation integration and rendered proof. In the reviewed main path, activity is loaded on an explicit button click, hidden immediately after mount, reparented inside `#asset-launch`, and opened only if Asset Token is still the active route. Navigation hides/closes the controller and resets its button. The normal resolved path has no extra activity cube or standalone chip.

### Facade, persistence, and boot

`token-facade.js` exposes the current canonical engine, wallet, activity, vault, balances, quote/execute, lifecycle, verification, history, formatting, and disposal APIs. Market quote execution uses the engine's quote contract; named wallet/activity execution requires an explicit client idempotency key. Canonical object shape is used at adapter boundaries to tolerate equivalent ES module URL identities in tests. The facade does not fabricate a second document receipt event wave. Layered adapters preserve the existing frozen facade and shared engine.

`token-store.js` implements a versioned canonical snapshot. Loading replays journals through a fresh TokenLedger instead of trusting serialized balances. Validation covers format/config, supply/genesis, balanced postings, account constraints, order and unique IDs, hash linkage, request indexes, receipt/journal binding, quote math/tithe, and pending/executed/cancelled/reversed lifecycle indexes. Local bot prices are persisted; capability tokens and challenges are not. Fifteen corruption cases and file/localStorage round trips are exercised in the 38 ledger/store checks.

`token-boot.js` has no eager import-time funding. Explicit boot reuses the canonical mounted owner and fixed visitor/guide grant keys. Repeated boot and repeated facade creation do not double-fund or duplicate event waves. A validated saved engine is hydrated into the untouched shared owner only before active mounted work exists; it does not replace an engine already in use. Boot exposes restored, invalid-skipped, or in-memory storage state and supports queued commit persistence and disposal.

### Trade renderer and lifecycle

`token-trade.js` and `token-trade-mount.js` no longer import removed token stub exports. Buying spends TUMBO and receives sMIMAS; selling uses the reciprocal quote. Input must be an exact integer amount rather than being silently floored. The UI reports actual net output including the configured tithe and shows real expiry/guard errors. It no longer uses a sentinel or a misleading 1:1 rate.

Exported helpers are `requestTokenTradeQuote`, `isTokenTradeQuoteFresh`, and `settleTokenTradeQuote`. Freshness uses `now < expiresAt`. Root owns the separate migrated quote-expiry and historical lifecycle suites and their final browser coverage.

The canonical reversal window permits age 1000 and rejects age 1001. Independent review reproduced a ticker discrepancy before repair: `{ageBeforeReverse:1000,ticker:{eligible:false,ticksLeft:0},coreReversalSucceeded:true}`. The ticker now uses the inclusive boundary. Its new test commits actual canonical journals, reverses at age 1000, and verifies both ticker and engine refusal at age 1001. The ticker's 17 checks pass.

### Projection ownership

`projection-session.js` now exposes the Neural Mesh metadata slice, selected node ID, and `getNeuralMeshSnapshot` consistently with other owner slices. It retains local advisory authority and immutable projections. It does not fabricate a credential, external identity, or settlement authority. All four projection checks pass.

## Contract Atelier repair and preserved behavior

The existing binary, pool, and multi modes remain available. Algorithmic `yes_no` is additive. It uses a numerically stable LMSR model with configured house fees, price before/after, and the `B ln 2` model loss bound. Named single houses and house pools can provide capital; a partially funded house pool cannot trade. Capital shares freeze before trading. Positions belong to named participants and can be sold before resolution, bounded by ownership and available shares.

Logic resolves deterministically to YES when true and NO when false. Winners receive one simulated credit per winning share. Terminal house model profit/loss is allocated in exact cents, with the final contributor receiving the remainder so allocations sum exactly. Inputs are validated before IDs/counters mutate. Sub-cent zero amounts are rejected, model quantities are bounded, and cyclic/excess-depth condition trees are rejected. This is an in-memory simulation and does not move canonical token funds or claim real money authority.

The renderer exposes funding, participant position, and sell controls only for the algorithmic mode. Proposal readiness/countdown uses the proposal queue's own `getNowMs()` clock. A successful approval creates the book entry and changes queue state before optional notification hooks run. If a hook throws, the approved contract remains approved; the UI reports the hook failure and does not invite a duplicate approval. Rendering preserves action error/status feedback.

The 42 passing checks include six new safety cases, existing mode behavior, LMSR house and pool accounting, underfunded atomic rejection, owner sales, both signs of terminal P&L allocation, input/cycle limits, and mounted approval/hook/error behavior.

## Historical test migration and harness distinction

Several token suites imported `TumboLedger`, `TOKEN_STUB_BOUNDARY`, old supply helpers, or facade methods that no longer existed in the canonical token owner. An import/loader error in such a suite is evidence of a stale test contract, not proof that a browser transaction failed. Reintroducing the retired engine merely to satisfy those imports would have restored competing financial ledgers.

`token-ledger.test.mjs`, `token-facade.test.mjs`, and `token-idempotency.test.mjs` were migrated to substantive current behavior. They assert exact amounts, balanced postings/conservation, no partial state mutation, memo/intent binding, event count, issued quote ownership, lifecycle/reversal links, persistence reconstruction, and rejection of corrupted snapshots. Dedicated vault, gamification, lifecycle, exchange, BotPay, and transfer suites cover their own adapters. Old oracle/arbiter/seed-intent setters or prototype delivery methods were not fabricated on the canonical engine.

The old house suite demanded removal of all previous market modes. It now validates the additive algorithmic mode while existing mode checks remain. Historical tests that accidentally used `yes_no` for pooled or `over_under` for multi behavior were aligned to the existing explicit mode contracts. The ticker's historical exact-boundary expectation was changed only after an actual canonical-engine probe demonstrated the difference; its new engine-backed boundary test preserves the real reversal gate.

## Independent integration and Windows script review

### Findings repaired or being handled by root

1. **Ticker boundary mismatch — repaired and tested by this reviewer.** `src/render/token-ticker.js`, reversalWindowInfo, now allows the engine's final permitted tick. Seventeen ticker checks pass, including actual ledger advancement and refusal at the next tick.
2. **Vault equality wording — repaired by this reviewer.** `src/domains/token-vault-ui.js`, vault status, now states owned position coverage. The adapter intentionally permits other shared owners' reservations in `sys:vault`.
3. **Vault WebGL fallback could not close — root repair source-confirmed.** The current `open3D` failure branch wires Close and Escape before returning. Its prior return prevented those handlers from being installed. Root owns actual fallback browser proof.
4. **Hidden standalone chips consumed render loops — root repair source-confirmed.** Vault chip construction skips its WebGL renderer in assembly mode. Transfer console detects explicit embedded/assembly mode and skips its chip scene. Root owns route/browser performance verification.
5. **Launcher startup race could claim another launch — root repair source-confirmed.** After matching the bridge command path, launch now requires the actual listener PID to be the process it started or its direct child and creation time not to precede that launch. The previous path-only test did not bind process lineage. This reviewer did not execute a concurrent startup race.
6. **Partial lazy tool mount cleanup — passed to root for repair and final proof.** In the reviewed `main.js` token-tools loader, `Promise.all` could partially mount a self-mounting module before its sibling failed. A missing panel could also throw after earlier panels had been reparented. Clearing only the load promise did not remove partial disclosures or hide/dispose every mounted standalone control. Panel existence should be checked before reparenting and failure cleanup must cover partial mounts. This is a source-identified failure path, not a reproduced browser failure.
7. **Vault return from 3D left its embedded disclosure blank — passed to root for repair and final proof.** The 3D action hid the panel; overlay close removed the overlay without restoring the embedded panel. Its disclosure remained open until the user collapsed/reopened it. Root owns the close/restore lines and their current browser proof.

Items 6 and 7 are explicitly delegated to root. This report is not a claim that their final source or rendered behavior has been verified by this reviewer. Lines may shift as root integrates cleanup and normalizes cache URLs.

### Positive script safety observations

The launcher derives paths from its script directory rather than the caller's current directory, validates Python, starts the helper hidden, and serves loopback. An existing verified listener is reused without taking new process ownership. A new launch records the actual listener PID, creation time, exact command line, checkout, port, instance ID, and root fingerprint. Failure cleanup targets only matching descendants/current process from this launch.

The stop script checks checkout/port, PID creation time and command line, then live instance/root fingerprint before stopping the recorded process. It does not kill by process name or indiscriminately clear a port. Launcher verification checks the expected checkout fingerprint, bridge health, required static resources, and provider status. A path fingerprint verifies checkout location, not the content revision; HTTP 200 verifies availability, not full module graph or rendered interactions.

The package script builds only explicit browser asset roots and permitted top-level web files, excluding hidden files and file symlinks. The bridge, logs, launch state, and local capability secrets are outside that source allowlist. Output cannot replace runtime source roots, and an existing ZIP is not overwritten. Packaging uses a checked temporary directory, deterministic sorted paths/timestamps/permissions, a per-file SHA-256 manifest, ZIP integrity/readback checks, and an archive SHA-256. The manifest states static-demo, server-not-included, credentials-not-required, and no external deployment. The PowerShell wrapper passes Python arguments as an array, preserving paths with spaces.

These are read-only source observations. Root owns actual launch/reuse/guarded-stop/foreign-listener tests and package extraction/archive validation. No additional destructive command, process termination, publication, or credential read was performed by this reviewer.

## Import/cache handoff and remaining verification owner

New or repaired token imports use the current modules: token -> token-config; token-activity -> token/token-config; token-vault -> token/sha256; token-facade -> token/token-activity/token-vault; token-boot -> token/token-facade/token-store; token-store -> token; gamification domain/renderer -> token-activity; token-vault-ui -> token-vault. Removed prototype exports are not needed.

Root is normalizing browser query strings after the source freeze. Equivalent module paths with different query strings can instantiate multiple default engines, so all mounted financial adapters must resolve the same browser token owner. Structural API checks make Node's query-identified fixtures usable; they do not replace that browser cache normalization. Root owns the whole-browser module graph, shared balances after activity/transfer/vault use, nested-panel close/reopen, route cleanup, fallback/mobile/device checks, full suite/CI evidence, final package, and release state.

Media agent owns BotPay and token-transfers financial adapters/tests. Root owns token-transfers UI handlers, nested tool/activity navigation, vault 3D lifecycle, launcher/stop/package, and final cache normalization. This reviewer's source and tests were frozen again after the two final ticker/wording repairs; only this report artifact was written afterward.


## Final cache-identity repair amendment

Root reopened this source slice after normalizing all browser imports to `?v=20261003-complete8`. The full-suite log showed 20 BotPay failures and four transfer attachment/funding failures at their constructors, plus ten portal entry/session/health failures. This amendment supersedes the earlier source-freeze statement for the six files listed below; the slice is now frozen again.

**Exact runtime source changes:** `src/domains/token-botpay.js` and `src/domains/token-transfers.js` no longer identify an engine solely through `instanceof QuoteEngine` from their own versioned import. Plain and versioned module URLs create different JavaScript classes even when their source/API is identical. Both adapters now require the complete canonical engine/ledger API they use: quote/execute/faucet/balance/events/history, ledger posting/account/verification/commit APIs, journal/replay/reversal indexes, a safe nonnegative tick, and positive canonical per-asset supply. They retain the exact supplied owner and ledger. Partial balance facades and incomplete owners fail before account/journal mutation. The transfer facade still rejects conflicting supplied/existing engines and only replaces a matching browser facade. These are local API compatibility checks, not remote authentication or an external authorization claim.

`tests/token-botpay.test.mjs` adds a real payment/fulfillment workflow using both plain and cache-versioned engine factories, exact shared balances and receipt verification, plus incomplete-owner atomic rejection. `tests/token-transfers.test.mjs` adds plain/versioned shared-engine attachment, exact fund/send balances, receipt verification and same-key replay, plus incomplete-owner rejection with unchanged journal/browser facade. All existing nonce, spend-cap, authority, conservation, escrow, reentrant, reversal, persistence, and corruption checks remain.

**Portal diagnosis and test graph migration:** no portal source was changed. Entry and session modules import the versioned opaque-handle issuer, whose private WeakMap correctly rejects handles created by a different plain module. Health imports the versioned session's private health Symbol, which correctly rejects sessions from a different URL. `tests/portal-entry-return.test.mjs` and `tests/portal-sessions.test.mjs` now import all ordinary portal modules from the exact `complete8` graph used by the browser. New explicit foreign-URL issuer checks reject entry, return, and session creation. A foreign-URL session remains rejected by health. Existing frozen-clone, revocation, expiry, lifecycle, and opacity checks remain. The source's private membership and symbols were preserved instead of being replaced by forgeable shape checks or global registries.

Fresh verification after these changes:

```powershell
node --test tests/token-botpay.test.mjs tests/token-transfers.test.mjs
# 62 tests, 62 pass, 0 fail, 0 skipped (22 BotPay + 40 transfer)
node --test tests/portal-entry-return.test.mjs tests/portal-sessions.test.mjs
# 16 tests, 16 pass, 0 fail, 0 skipped
node --check src/domains/token-botpay.js
node --check src/domains/token-transfers.js
git diff --check -- src/domains/token-botpay.js src/domains/token-transfers.js tests/token-botpay.test.mjs tests/token-transfers.test.mjs tests/portal-entry-return.test.mjs tests/portal-sessions.test.mjs
```

Both syntax checks and scoped diff validation passed. Git emitted only LF/CRLF notices. The earlier 179, 42, and 17 results remain their own scoped evidence; root owns the final whole-suite rerun after all agents freeze.

Root also identified a browser integration issue in vault UI: `getEngine()` returned an attached vault layer without publishing it when a facade already existed, making the adapter unreachable through the browser facade despite using the same engine. The current source captures the existing facade and publishes the layered result only when `window.TumboToken` is absent or still equals that captured facade, matching the transfer attachment rule. This reviewer confirmed that source condition. Root owns actual fund/send/hold/vault/activity browser proof and the remaining UI cleanup acceptance.


## Final independent review and first-use owner repair

Root requested another independent review after `work/full-repair-final2.txt` recorded 2042 JavaScript checks passing, zero failures/skips. This reviewer read that log footer. It predates the owner changes and ten new checks below; it does not establish acceptance of the later source. Root owns the final whole-suite and fresh-browser reruns.

The new review covered the current launch/stop/verifier scripts, provider health/static serving, static builder/packager, main's lazy token loading/cleanup, vault fallback keyboard behavior, README, and DEMO_LAUNCH commands. No further concrete launcher, health, package, or documented-command defect was identified in this pass. Process lineage/identity guards remain present; health/probe limitations are stated accurately; package exclusion/integrity behavior remains explicit. The documented start, alternate-port, verify, stop, foreground bridge, and static packaging commands match their script parameters and ownership model. This is source review, not another claim of process or archive execution.

Earlier UI findings are now source-confirmed as repaired: main waits for both lazy imports to settle, hides standalone controls, checks all required panels before reparenting, and hides partial panels on missing/import failures. Embedded vault 3D no longer hides its underlying panel. Both successful and failed WebGL views install and remove Escape handlers with the same `capture:true` setting; Escape prevents default and stops further propagation before closing, so the navigator's bubble handlers do not consume the same key. The successful path releases its renderer/resources. Root owns the actual keyboard/route proof.

**New concrete first-use defect:** main originally imported self-mounting vault and transfer modules concurrently before initializing the canonical default facade. With no existing browser facade, each adapter's standalone factory can create an isolated engine. Vault-first returned a layer without an engine property, causing transfer recognition to fail. Transfer-first created a separate engine that later activity initialization could replace. In-memory probes produced:

```json
{"vaultLayerHasEngine":false,"vaultLayerHasTokenVault":true,"transferError":"existing facade must identify its canonical QuoteEngine"}
{"vaultFactoryUsesSharedEngine":false,"transfersFactoryUsesSharedEngine":false,"activityFacadeUsesSharedEngine":true}
```

The isolated factory behavior is appropriate for explicit standalone construction. The integration defect was using that fallback in a mounted shared-owner flow. Root now awaits the canonical token module and `ensureTumboTokenFacade()` before either lazy self-mount import. Root owns browser proof of tools-first and activity-first fresh contexts, exact engine/ledger identity, shared financial outcomes, and route reopening.

Root reopened `token.js`, `token-vault.js`, and meaningful regression tests for this fix. Exact changes by this reviewer:

- `ensureTumboTokenFacade()` and `getTumboTokenFacade()` inspect the current browser layer before a cached base. A complete facade with the exact shared engine and matching wallet/core ledger is returned unchanged. Existing transfer/vault APIs therefore survive activity opening. A conflicting engine or partial same-engine facade is rejected before seeding, journal mutation, or replacement. A matching layer already installed before first ensure is reused without new funding.
- Base construction is separate from window installation. `installFacade(force:true)` remains an explicit replacement of its target, including a conflicting browser target. Unforced installation still preserves an existing target. Forcing another target does not strip the browser's adapter layer. Reinstalling a cached base into an empty window does not seed again.
- `attachTokenVault()` now publishes its exact engine on every layer, including bare standalone attachment, caches by the actual owner, and returns a frozen layer. It rejects conflicting explicit/existing engines, a vault adapter belonging to a different owner, and financial facade fields without an identified engine. Genuine matching existing methods/custom fields are preserved. A metadata-only object can still be layered onto an explicitly standalone vault.
- New `tests/token-owner-identity.test.mjs` contains eight actual ownership regressions: layers after base creation, layers before initial ensure, initial/late conflicts, explicit force, unforced target preservation, separate-target force, partial-owner rejection, and cached-base republication. Financial side effects and journal counts are checked. `tests/token-vault.test.mjs` adds bare-vault-plus-transfer financial/conservation proof and conflict rejection without mutation. Its historical fake-ledger/balance-42 preservation assertion was replaced by preserving a genuine matching facade and its methods.

Final targeted verification after these repairs:

```powershell
node --test tests/token-owner-identity.test.mjs tests/token-vault.test.mjs tests/token-exchange.test.mjs tests/token-unified.test.mjs tests/token-lifecycle-unified.test.mjs tests/token-botpay.test.mjs tests/token-transfers.test.mjs tests/token-facade.test.mjs tests/token-idempotency.test.mjs tests/token-ledger.test.mjs tests/token-gamification.test.mjs tests/token-firewall.test.mjs tests/token-ticker.test.mjs
# 264 tests, 264 pass, 0 fail, 0 skipped
node --check src/domains/token.js
node --check src/domains/token-vault.js
git diff --check -- src/domains/token.js src/domains/token-vault.js tests/token-vault.test.mjs tests/token-owner-identity.test.mjs
```

Both syntax checks and scoped diff validation passed (ordinary LF/CRLF notices only). One intermediate test assertion incorrectly demanded adapter object identity across two separate module URLs; it was corrected to assert preservation of the actual supplied facade's adapter and exact engine. The final aggregate passed. No primary price/supply/tithe/lifecycle policy was changed.

The reopened source/test slice is frozen again. Root owns main, current rendered/layout proof, the final full suite, Windows process verification, package preparation, Git state, and release acceptance. No commit, push, merge, or deployment was performed by this reviewer.
