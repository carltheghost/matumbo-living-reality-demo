# Vivo causal cooperation laboratory

This is the next bounded milestone after PR #139: exact memory and a measured
world observation actually condition a recovered neural decision, which proposes
one of two explicitly permitted world edits. The existing native agent controller
and world acceptance path execute the proposal; its operation receipt and position
are checked after saving and loading a fresh engine.

**Not a live-phone upgrade, general language planner, trained architectural
improvement, all-five-brain cooperation proof, or superintelligence.** No user
world, renderer, entrypoint, existing agent code, model weight, or ledger is edited.
No training, merge, deployment, paid service, or external account connection.

## Scope and dependencies

Stacked on `e3873f342b3936d1fafdabbaf7f0c24eb7bc522a` (PR #139).
New files live only under `experiments/vivo-cooperation/`. Existing imports come
from `services/vivo/web/phone/` at that parent: native world engine, agent controller,
tool registry, convergence adapter, and the canonical simulated economy.

Python requires the separately recovered `Vivo-Convergence-2026.10.22` bundle,
including `native/src`, `native/checkpoint`, and `config/convergence.json`.
Private notes/checkpoint bytes are not added to public GitHub by this change.
The provided local runnable kit contains the required model/source dependency,
not the user's archived Obsidian notes. Only synthetic cue documents are loaded.

Tested here: Node v22.16.0, Python 3.13.5, NumPy 2.3.5. Use Node 22+ and Python
3.11+ with NumPy. No API key or network service is required.

```sh
export VIVO_RECOVERED_BUNDLE=/absolute/path/to/Vivo-Convergence-2026.10.22
node --test experiments/vivo-cooperation/tests/*.test.mjs
node experiments/vivo-cooperation/run-benchmark.mjs \
  --bundle "$VIVO_RECOVERED_BUNDLE" --output ./cooperation-results
```

The real-neural suite fails, rather than silently skips or substitutes a fake,
when the source/checkpoint dependency is missing. `cooperation.test.mjs` uses an
explicit provider double for lifecycle faults; `real-neural.test.mjs` and the
benchmark load the actual trained parameters in a local Python subprocess.
The host closes only that subprocess after its requests finish.

## Causal task and model boundary

1. Read an exact synthetic SQLite document containing a binary cue.
2. Read the real native world and measure the sign of a distinct probe entity's
   fourth or eleventh coordinate. This supplies the query bit.
3. Inspect a zero-value simulated contract and its verified receipt chain.
   Compact `coop-lab/1` terms respect the existing 240-character terms limit.
4. Pass the observed cue/query, delay, and distractor to the existing five-compartment
   model's learned delayed-retrieval route. No answer/target label enters inference.
5. Convert its predicted index into a bounded +/-0.25 last-axis target.
6. On explicit execution, revalidate memory, probe, contract, world scope, revision,
   and expiry. An independently granted laboratory `world.edit` capability and a
   synchronous acceptance-time guard are mandatory. A draft contract is NOT
   spending authority; the model is NOT an authorization source.
7. Submit through the existing AgentToolRegistry/LocalAgentController. Inspect
   the actual operation receipt and compare the complete saved/reloaded state.

The independent benchmark scores cue/query equality after receiving the model's
answer. It never uses that equality oracle to select or approve the runtime action.
A symbolic equality solver is included as a transparent task baseline; this simple
benchmark does not demonstrate a neural advantage over deterministic software.

## Measured results

See `evidence/summary.json` for recorded local results, not PR-CI totals.
The test protocol is written to `protocol.json` before execution. Full per-case
results go to `report.json`. All combinations are executed, without cherry-picking:
2 cues x 2 measurements x 3 delays x 2 distractors x 2 world dimensions = **48**.
Eight masks/settings yield **384** inference runs over the same parameter identity.
All modes use the same transition count per episode; exact equal FLOPs are not claimed.

- Intact model: **48/48** correct choices, 48 actual accepted world edits, 48 exact
  reload checks, zero automatic retries, zero integration faults.
- Changing only the stored cue changes the decision in **24/24** paired cases.
  Changing only the measured query does the same in **24/24** pairs.
- Removing branch 0 or branch 1 and its observation/permissions: **24/48** each.
- Removing the lateral connection alone: **48/48**. Removing neural slot memory
  alone: **48/48**. Logits change, but classifications remain unchanged here.
- Removing branch 2 or 3: **48/48**, identical logits. These branches have no owned
  cue/query inputs in the preserved task protocol. They are NOT demonstrated useful.
- Silencing the final decision: **48 abstentions**, no default action. This is an
  output intervention, NOT an experiment deleting the central recurrence.
- Symbolic task baseline: **48/48**, without a neural model.

The intact instrumented path matches the original inference-loader logits exactly.
No parameter updates occur. The recovered model remains experimental with its
separate result-task development gate rejected at 55/64; this easier integration
benchmark does not override, replace, or retest that gate.

**Conclusion:** external memory, the measured tool result, and the two input-owning
neural branches are causally connected to action selection. Necessity of the lateral
link, neural slot memory, or the other two branches is NOT established by this task.
A harder future task must be specified before training or claiming five-way gains.

## Execution and fault semantics

`CausalCooperationLoop` takes explicit invoke, measure, commit, reconcile and stop
ports. `plan(task)` returns a frozen provisional proposal, not permission. `execute`
requires the exact locally issued proposal object, consumes it once, rechecks its
inputs, and never automatically retries. Targets preserve all unrelated dimensions.

`connectLab` wraps existing owners and requires `labWriteEnabled: true` explicitly.
Its acceptance-time guard verifies the current contract, probe, entity revision and
allowed displacement immediately before the native transform. Revoking its host grant
or stopping the registered source prevents new submission. Other sources stay active.

A timeout or cancellation may occur AFTER the existing authority accepted an edit.
The loop inspects the existing receipt and reports `reconciled-after-interruption`;
it does not pretend the action was rolled back or submit it again. The experiment
uses atomic file replacement for its own saved world and native SQLite for its own
synthetic memory, never the user's existing vault or world storage.

Current limit: memory and world validation are separate local reads, not a distributed
transaction. A live collaborative host needs a joint version/authority boundary.
The Python stdio process and in-app ports are trusted local components, not an
arbitrary-code plugin sandbox, remote authentication system, or browser Python runtime.
No physics-driver claims: the accepted operation is the existing local coordinate-edit
API, not a newly implemented force/constraint law.

## Verification

33 new checks: 25 lifecycle/native-owner tests and 8 real-checkpoint tests.
26 existing adjacent adapter/agent/economy tests also pass unchanged. Zero skips.
The 384 benchmark evaluations are separate from unit-test counts.

```sh
node --test services/vivo/web/phone/tests/convergence-adapter.test.mjs \
  services/vivo/web/phone/tests/agent-control.test.mjs \
  services/vivo/web/phone/tests/agent-tools.test.mjs \
  services/vivo/web/phone/tests/economy-entry.test.mjs
```

An initial new fixture omitted the required idempotency key when cancelling its
contract. Correcting that fixture made the 25 lifecycle tests pass; no existing
contract guard or test was weakened. All existing live application files stay intact.

Future integration requires a host-reviewed transport/UI mount, fuller tasks and
measured architectural training, and browser/device/shared-authority acceptance.
This stage neither resolves unrelated older ZIP-test failures nor qualifies a release.
