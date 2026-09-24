# maTumbo contract organism — model-switch handoff

Saved: 2026-09-24 06:49 UTC. Repository checkpoint copy; original snapshot statements below describe that handoff time. Subsequent verification passed all 128 focused contract/persistence/workbench tests AND the desktop/phone native service-contract workflow with two reloads after the latest main wiring. Legacy pooled-market browser and storage-failure verification remain pending. The user asked for this handoff before switching to a less expensive model. Stop expanding the task unnecessarily; preserve existing work and continue from the next unchecked step. This is a work record, not proof that the goal is complete.

## 1. User objective and current priority

Review all nine supplied images, especially the last, repair the designed living-object surfaces, and implement usable contract workflows that run automatically after creation and required approvals. The last image explicitly says: **information IS the object, adapts to its shape, and acts with it; it must not be a detached panel pasted on top.**

The user also asks to conserve credits. Their latest request is this continuity document, not more feature work. Do not start a new app, repeat a broad repository hunt, or treat the previous short builder-advice response as implementation progress.

Original images, already reviewed by root and the surface worker:

`C:\Users\carlg\.codex\attachments\f025496d-9b39-40db-b4ec-9d715cf58ad9\image-1.png` through `image-9.png`.

- Images 1/8: crushed text, overlapping tall tiny controls.
- Images 2/6/7: disconnected, tiny, duplicated surfaces and poor focus/space use.
- Images 3/4: edge-on reading surfaces; large gold decorations obstruct the useful content.
- Image 5: information looks pasted onto a shape instead of belonging to it.
- Image 9: universal shape-aware information-object requirement.

Keep the full objective. Fifteen templates plus a custom rules engine are implemented, but this is NOT a claim that every conceivable real-world or legally enforceable contract exists.

## 2. Exact authoritative workspace

**Edit and run commands here:**

`C:\Users\carlg\Documents\Codex\2026-08-24\referenced-chatgpt-conversation-this-is-an\work\contract-organism`

- Branch: `codex/contract-organism-2026-09-24`.
- Base HEAD: `e7249f54b78f43f7174ab6b816e93227d7862771`.
- All current implementation is uncommitted, including important new/untracked files. Preserve it. No commits, merges, pushes or deployment were done.
- Parent task directory (where this handoff lives) is NOT a Git repository.
- Read worktree `AGENTS.md` and `docs/contract-organism-task.md`. Referenced `.tumbo/continuity`, ownership and packet files were absent in this exported repository; this is documented, not a reason to invent authority.
- Original source checkout: `C:\Users\carlg\Documents\Codex\2026-09-23\f\work\matumbo-living-reality-demo`. Its unrelated dirty `src/render/person-studio-scene.js` is preserved.
- Newer source worktree: `C:\Users\carlg\Documents\Codex\2026-09-23\f\work\reality-lens-spatial-tabs`. Its unrelated dirty tests/scripts are preserved.
- Clean comparison checkout: sibling `work\contract-baseline`, detached at the same base. Do not edit it.

The existing preview is **http://127.0.0.1:4184/?feature=contract-atelier**, served from our worktree. At handoff, port4184 was listening under PID5932. Revalidate before assuming it remains alive; do not restart just because a tool wait times out. The old ambient4180 preview is NOT this implementation.

To restart only if confirmed stopped, run `node scripts/public-preview.mjs` in this worktree with `$env:MATUMBO_PREVIEW_PORT='4184'`. Keep any separate background launcher hidden on Windows. Do not terminate unrelated ports/processes.

## 3. Architecture and boundaries to preserve

- Canonical domains own state. Entity Store / Event Fabric / Neural Mesh feed world projection; Three.js must not become ledger, identity, signing, wallet, custody or external execution authority.
- Everything here is explicit local simulation. Local-role approval is NOT verified identity/signature; public score provenance is NOT an authenticated oracle; points have no real value.
- Automation runs while the browser is open and catches up on return. Do not claim execution while the browser/device is closed. A real always-on authorized executor is a separate unresolved requirement, not something to imply with a timer.
- Do not delete saved browser data to make a test pass. Test corruption/quota/stale-tab failures in isolated browser contexts or fake storage.
- Preserve the canonical landing/world navigation and right-side dock from AGENTS.md. Do not redesign an unrelated root to make focused screenshots look good.
- Main used `3d-web-experience` skill: `C:\Users\carlg\.codex\skills\3d-web-experience\SKILL.md`. Read it before further surface work. It guided touch targets, readable geometry, device adaptation, calm rendering and native-control preservation.

## 4. What is implemented

### A. New durable contract engine

`src/domains/contract-automation.js` owns immutable terms, named-party approvals, typed observations, nested conditions, sequential dependencies, schedules, caps, disputes, receipts, history, validation and persistence.

Templates: service, milestone, delivery, subscription, recurring, lease, access, license, governance, conditional_transfer, escrow, prediction_binary, prediction_multi, prediction_pool, custom.

Important API: `createContractAutomation({now,storage,onEvent})`, `listTemplates`, `create`, `approve`, `observe`, `tick`, `pause`, `resume`, `cancel`, `dispute`, `resolveDispute`, `get`, `list`, `snapshot`, `subscribe`, `exportState`, `importState`.

- All named parties approve the same frozen terms; amendments/reuse create a new agreement needing fresh approvals.
- Missing, stale, conflicting evidence remains UNKNOWN, including under NOT. No guessed execution.
- Pauses, disputes, expiry, execution/point caps hold rules. Recurring catch-up is bounded.
- Effects: record, simulated_transfer, release_escrow, grant_access, revoke_access, settle_prediction. Prediction grading reuses the existing conserved-cent algorithm.
- Receipts are immutable and idempotent on reload. Import only into an empty workspace. Storage errors do not expose unsaved effects as success.
- Storage key `matumbo.contract-automation.v1`. No distributed exactly-once claim.

### B. Native workbench attached to the living body

`src/render/contract-workbench.js` / `.css` mount via `mountContractWorkbench({root,engine,onSelect,getPublicEvents,onRefreshEvidence})`.

- All fifteen families, typed rule/action/source editors, dependency and schedule controls, advanced nested JSON, prediction positions, approvals, lifecycle/dispute actions, observations, receipts/history and backup/import.
- Ordinary inputs are readable native controls inside the object's skin, not generated textures or separate floating windows.
- External updates defer detail rebuild while a user edits; preserve field values, expanded disclosures and ancestor scroll.
- Public event choices show actual participant names. Explicit action can use those names as outcomes; never silently map YES/NO or reassign positions.
- Latest phone-chrome change: selected contract title/status leads, duplicate heading/card removed, storage guidance moved to backup disclosure, two44px navigation actions side-by-side. **Latest appearance still needs root screenshot recheck.**

### C. Public observations and canonical graph

`src/domains/contract-public-evidence.js`: declared public sources bind to exact ESPN event IDs. Requires fresh successful provider records, HTTPS ESPN provenance, final+completed status, unambiguous participants/result, and exact approved outcome names. Holds absent/conflicting/stale data. Returns totals and `byContract` so one contract's refresh does not claim another's result.

`src/domains/contract-world-projection.js`: contracts, parties, declared sources/bindings, rules, approved actions, observations, receipts, effects and history are canonical projected entities. Stored edges include input-to, precedes, authorizes, observes, fulfills, used-by, records-effect and emitted-for. No guessed proximity relationships.

`src/render/contract-organism.js`: one body-attached procedural anatomy. Condition folds, approval clasps, source shoulder ports, observation beads and receipt facets change with actual state. Recessed threads use stored graph relationship IDs. No idle animation; only semantic changes rebuild. Bounded visible parts expose hidden counts; full data stays inspectable in the workbench.

### D. Surface/mobile repair

Files: `living-surface-layout-engine.js`, `reality-object-engine.js`, `reality-assembly-scene.js`, `reality-assembly.js`, `reality-assembly.css`, `mobile-panel-manager.js` and their tests.

- Projection-aware density produces ~16px text and native44px+ controls instead of scaling them to unreadable sizes.
- Reading facets are part of sphere/cylinder geometry. The entire object faces the camera; the content does not separately billboard.
- One interactive attached surface with expandable provenance replaces duplicated surrounding plaques.
- Whole-body optical adaptation for portrait/landscape preserves canonical identity and keeps content attached; varied forms remain recognizable.
- Fixed MutationObserver starvation from repeated `hidden` writes, wrong mobile-panel election, hidden-ancestor/idless panel candidates, and duplicate early mobile initialization in main.
- Fixed old floating-panel pointer capture stealing native disclosure clicks. Attached skins opt out; summary taps and Enter now work.
- Accessible CSS3D fallback exists. Actual hardware phone/XR not verified.

### E. Existing pooled-market desk + Frozen Relic durability — MOST RECENT INTEGRATION

New `src/domains/outcome-persistence.js` exports:

```js
createPersistentContractWorkspace({ storage, outcomeSeed, relicSeed, now })
// => stable .vault and .outcomeDesk proxies,
// getSnapshot/getPersistenceStatus/exportState/reloadFromStorage/subscribe
```

- One namespaced replay journal stages the raw vault and desk together. Nested grading→escrow→NFT→Frozen Relic effects commit atomically before becoming visible.
- Preserves joins, lifecycle, holder transfers, claims, receipts and idempotency across reload. Linked vault award actions route through the canonical desk. Reset that would orphan awards is blocked.
- Storage key `matumbo.contract-workspace.v1`; corruption, quota errors and stale-tab writes hold without changing stored bytes.
- Durable desk `createContract` accepts an `idempotencyKey` for approval retry.
- `contract-flow.js` accepts `storage`; stores bindings at `matumbo.contract-flow.v1`. `approveProposal(proposal)` returns `{contract,approval}` and saves the binding before marking the review queue approved. Retry reuses the same book. `getApprovedBindings`, `getApprovedBindingForProposal`, `getPersistenceStatus` added.
- Approved final games automatically grade/settle; interrupted grade→settle resumes without remint. Missing/ambiguous evidence waits.
- `outcome-contracts.js` now preserves exact event IDs through160 characters (old silent64-character truncation broke long ESPN IDs), rejecting oversize inputs.

**Root just wired this into main and has ONLY syntax/diff validation on that last integration.** `contract-runtime.js` now owns browser storage wrappers and an EMPTY read-only unavailable workspace facade. `main.js` creates the shared workspace before the relic UI, uses its desk, creates the durable flow, injects approval orchestration into `render/contract-atelier.js`, shows held-storage errors, and republishes desk+vault contributions. `render/contract-atelier.js` no longer hides approval-hook failures as success.

## 5. Verified evidence (do not inflate its scope)

- Earlier full clean-base run: 1618 tests,1566 passed,52 failed.
- Latest full run before final persistence wiring: **1691 tests,1641 passed,50 failed**. Two old scan/dedup/retry failures were fixed;50 inherited failures remained. This is not a green release.
- Contract engine24 tests passed; latest workbench28 passed.
- Domain persistence worker: broader85 passed, latest focused48 passed after long-ID fix;10 workspace persistence tests and6 flow persistence tests added.
- Surface worker:31 focused tests passed; browser matrix6forms×2orientations passed without overflow/offscreen/pageerrors/context loss. Portrait395–449px reading height, landscape243–253px, effective text15.8–16.3px. Native disclosure tap/Enter and desktop restoration passed.
- Root native browser flow passed on desktop1280×900 and touch phone390×844: create service contract → first approval creates no receipt → second approval arms but creates no receipt → true required evidence automatically completes → two reloads preserve exactly2approvals,1receipt,8events and conserved local balance deltas. No page errors. Geometry attached,7meshes,10stored connections; world25relationships. This proof predates the most recent durable shared-desk main wiring.

Evidence scripts:

- `tests/browser-contract-workflow.mjs` (native controls, read-only assertions via exposed engine globals).
- `tests/browser-reading-projections.mjs` (forms/orientations/disclosures).
- `tests/browser-living-surfaces.mjs` (earlier surface runner).

Screenshots in worktree: `artifacts/contract-browser/{phone,desktop}-contract-completed.png`, `surface-contract-{portrait,landscape}-{wave,sphere}.png`. Root has inspected the earlier completed screenshots; latest workbench compact chrome needs fresh captures. Old root `outputs/` screenshots are historical, not current proof.

## 6. Next work — do this in order

### Checkpoint review findings — reproduce and repair first

Read-only review after the 128-test run found these uncovered edge cases; no fix is included in this checkpoint:

1. `outcome-persistence.js` permits resetting an ungraded desk while separate approved bindings still reference its books. Reload then holds the entire flow with "Saved approval does not match the immutable outcome book." Block destructive reset when saved bindings exist or coordinate a validated explicit reset; do not delete history implicitly.
2. `contract-flow.js` checks current queue status but constructs the approved book from the caller's older proposal object. An edited queue record can therefore be approved with stale outcomes. Compare the reviewed version/terms to the current proposal and require renewed review on mismatch.
3. Successful flow storage checks and idempotent workspace retries do not always clear a resolved storage error. After transient read denial, recovered state can continue reporting an error. Clear only errors proven resolved, not unresolved write failures.

The native service-contract regression finished successfully during commit preparation: desktop and phone creation, two required approvals, automatic receipt after evidence, two reloads, no page errors or horizontal overflow. This does not cover legacy market approval or storage-failure cases; those still need browser verification.

### 1. Verify the LAST integration before adding features

- Inspect `contract-runtime.js` held facade and `main.js` workspace/flow startup. Ensure corruption/localStorage denial does not crash the whole page, mutate storage, create writable fallback state or falsely show approval success.
- Add runtime-wrapper unit tests (not yet created). Test valid storage, storage getter denial, malformed journals, empty held projections, every mutating held method throwing, and unchanged original bytes.
- Check `render/contract-atelier.js` injected `approveContractProposal` path with native/fake DOM handlers. Quota/binding failure must show APPROVE BLOCKED and retry the SAME book; no duplicate/review falsely approved.
- Ensure workspace subscriber refresh is safe during mutations and keeps selected UI/projection coherent. Static startup alerts may need live updating if storage fails later.
- Re-run native browser-contract workflow; inspect fresh desktop AND phone screenshots after compact chrome. Do not consider a screenshot showing only headers sufficient usability proof.
- Add browser coverage for the actual legacy review→approve→join→final observation→award/relic→reload workflow, plus corruption/quota isolated contexts. Unit coverage alone is not whole-app proof. Preserve the actual public-source path; mocked fixtures must be labeled as fixtures.
- Verify durable flow resumes approved bindings when the proposal queue is reconstructed on reload; do not assume queue persistence equals binding persistence.

### 2. Finish integration gaps instead of adding disconnected features

- Full world projections now carry contract causal edges, but global Neural Mesh's feature-navigation graph is still authored/static. Verify actual graph consumers/history views receive dynamic contract relationships rather than only counts/raw JSON.
- New grant/revoke and transfer effects are local projected effects. Audit whether the relevant local room/access/value consumers respond; do not claim actual access enforcement or real settlement from a receipt alone.
- Workbench backup currently covers the new contract engine; pooled desk/vault and flow journals have export APIs but no unified portable UI bundle yet. If adding import, require schema/replay validation and explicit conflict handling; never overwrite populated histories silently.
- `provider:'local'`/unbound public sources can wait without an attached adapter. Either connect a specifically declared adapter through the domain/Event Fabric or disable/label it unconnected. Do not fake evidence.
- Audit automation schedule/time-window/offline-resume behavior through UI, including paused/disputed/expired cases, not only engine calls.

### 3. Address contract-related inherited failures honestly

`tests/contract-atelier-house-pool.test.mjs` expects LMSR house/pool exports/functions absent from this base; it also demands a YES/NO-only catalog. `tests/contract-atelier.test.mjs` expects a conflicting three-item catalog and mismatched old aliases. Do not rewrite assertions simply to get green or remove existing types. Inspect the implemented product contract, implement genuinely missing agreed behavior, and document any specification contradiction requiring user choice. Broader50 inherited failures also include absent token/hand modules, old launch/docs checks, person/mascot/chess/portal/projection mismatches. They were not repaired by this contract slice.

### 4. Completion audit and handoff

- Write `docs/contract-organism-verification.md` with requirement→implementation→specific evidence→remaining gate for all9images, contract families, lifecycle/automation, trace/graph, persistence, failure handling and device views.
- Run full suite once at integration end and compare to clean base. Preserve exact failed-test names; do not hide them.
- Do not mark active goal complete while full explicit requirements remain unsupported. No actual closed-browser executor, authenticated multi-user approvals, hardware XR proof, production financial/legal authority, deployment or full green release has been established.
- A backend/account/hosting/authentication decision that materially expands authority requires the user; do not invent credentials or deploy automatically.

## 7. Low-cost command sequence

Use explicit workdir above. First `git status --short`; do not dump main.js (it is huge). Use `rg -n` and bounded slices. Targeted tests first:

```powershell
node --check src/main.js
node --check src/domains/contract-runtime.js
node --test tests/contract-automation.test.mjs tests/contract-workbench.test.mjs tests/contract-public-evidence.test.mjs tests/contract-world-projection.test.mjs tests/contract-organism.test.mjs tests/outcome-persistence.test.mjs tests/contract-flow-persistence.test.mjs tests/contract-flow-automatic.test.mjs tests/contract-flow.test.mjs tests/outcome-contracts.test.mjs
node --test tests/living-surface-layout-engine.test.mjs tests/living-surface-rig.test.mjs tests/mobile-panel-manager.test.mjs tests/reality-assembly-scene.test.mjs
node tests/browser-contract-workflow.mjs
node tests/browser-reading-projections.mjs
git diff --check
```

Final full suite only after targeted/browser checks:

```powershell
node --test --test-concurrency=4 --test-reporter=./scripts/contract-test-reporter.mjs tests/*.test.mjs
```

The compact reporter avoids huge assertion dumps of main.js; its final Node diagnostic counts are authoritative (its separate REPORTED count includes parent suites). Browser scripts use bundled Playwright under `C:\Users\carlg\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\package.json`; browser-contract-workflow supports `MATUMBO_NODE_DEPENDENCIES` and `MATUMBO_PREVIEW_URL` overrides. No dependency installation needed here.

Use `apply_patch` for source edits. Reuse existing tests/scripts. Do not rerun all historical explorations, create new worktrees, install packages, publish, or launch broad agent swarms by default. Root's persistent Node REPL may exist but scripts are the reproducible evidence; do not depend on remembered REPL variables.

## 8. Agent handoff / current stop point

All three implementation workers have handed off; no further worker checks are needed just to resume. Changes are shared in the one worktree, not awaiting cherry-picks.

- contract_automation: engine plus combined persistence/flow domain tests complete; latest main wiring was root's responsibility.
- contract_workbench:28passing tests, compact phone chrome complete; latest rendered appearance unverified by root.
- living_surfaces:31focused tests plus12browser shape/orientation checks complete, native disclosures fixed.

The user may now lower the model capability. Read this file, inspect the specific next-step files, and continue from section6. Do not claim unfinished integration is complete and do not start over.
