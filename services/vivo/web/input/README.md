# Vivo Chat 3 input controller

Parent: `93dd51c2aabcfb7ffe32a53bd6ed1bee9620319a`.
Owned implementation: `controller.mjs`. No renderer, material, authority,
shared-contract, entrypoint, or deployment changes.

## Exports and ports

`GripController` implements the five methods in the frozen `InputController`:
`begin({entity, leaseId, source, inputEpoch})`, `offer(Frame, observedAt)`,
`end(reason)`, `cancel(reason)`, and `dispose()`.
`InputError` exposes a stable `code`. `InputSources` groups controllers by explicit
pointer/track keys: `add`, `remove`, `cancelSource(source, reason, optionalKey)`,
`cancelAll`, and `disconnect` (remote streams only).

Construct a controller with `session`, `submit(command) -> Promise<Receipt>`, and
required `onReconcile(event)`. Optional notification ports are `onPreview`,
`onReceipt`, and `onStatus`. Optional clocks are `now`, `setTimer`, and `clearTimer`;
tests inject deterministic adapters. `state` is an immutable diagnostic snapshot.
`acceptedSequence` seeds the last known authority sequence (default 0).
`idPrefix` defaults to a UUID; an override must be unique per controller/session.

`begin` consumes an ALREADY accepted lease; it does not submit `grab.begin` or
invent ownership. `submit` must bind to the intended authority's canonical API,
never the older relative `move` endpoint. Actor identity comes from that session,
not from a client payload.

Each controller owns one source stream. Give every pointer/hand track its own
controller and route events to that key. A new begin after a successful close
requires a strictly newer inputEpoch and an externally verified lease/entity.
No controller acquires ownership or arbitrates multiple leases on the same entity.

## Wiring example (integration-owned caller)

```js
import {GripController, InputSources} from './input/controller.mjs';

const sources = new InputSources();
// authority/session/entity/lease are provided by the integration, not this module.
const input = new GripController({
  session,
  acceptedSequence: authority.getSnapshot().acceptedSequence,
  submit: command => authority.submit(command),
  onPreview: value => setProvisionalForSource('pointer:7', value),
  onReceipt: event => consumeReceiptEvidence(event),
  onReconcile: event => requestAuthorityReconciliation(event),
});
input.begin({entity, leaseId, source: 'touch', inputEpoch});
sources.add('pointer:7', input);
input.offer(transformedFrame, performance.now());
// On normal pointerup, offer its final VALID transformed position before end.
await input.end('pointerup');
sources.remove('pointer:7');
// Hand loss: sources.cancelSource('hand', 'tracking-lost', 'hand:left').
// Camera stop: sources.cancelSource('hand', 'camera-stopped').
// Pointer cancel: sources.cancelSource('touch', 'pointercancel', 'pointer:7').
```

The named callback functions above are required application adapters, not supplied
implementations. Bind `onPreview` to its source key: a `null` event clears ONLY that
controller's provisional target. Valid preview events have `provisional: true`,
entity/lease/source/epoch/targetSeq identity and a detached full-dimensional Frame.
No accepted entity, velocity, field, observer, or history is mutated here.

## Behavior and failure boundaries

The exact recovered `research/vivo-phase-fabric/web/target-mailbox.mjs` is imported,
not rewritten. It retains one in-flight target and one replaceable unsent target.
The wrapper translates to canonical commands and validates receipts before passing
a completion counter back to the reference. That counter is NOT entity revision;
actual revision/acceptedSequence come only from checked authority receipts.
Accepted targets may leave entity material revision unchanged.

The reference scheduler requires at least three numbers. For a 2D Frame only, the
wrapper pads one private zero for scheduling and removes it before preview/wire.
All wire frames remain exactly 2-11 spatial coordinates; this is not another
physical/spatial dimension. Input must already be transformed into the leased
space/chart/dimension. Camera/hand inference and frame transforms stay outside.

Normal `end` stops capture, drains the latest still-valid target, then submits
`grab.end` only after the target's checked receipt and mailbox finalization.
`cancel` immediately removes local preview/pending motion. A dispatched command
may have committed: checked late-to-cancel acceptance is reported through
`onReceipt` and `onReconcile` before release uses the resulting revision.
A cancellation before the send microtask suppresses that target entirely.
Cancellation supersedes a pending `end`; that end rejects `END_CANCELLED`.

Age is recomputed from a local monotonic clock AT SEND. The frozen budget is
150 ms maximum, including time spent waiting behind a request. The reference's
5 ms future tolerance is clamped to a zero wire age. Expired movement is dropped,
not timestamp-refreshed; an expired final target causes `end` to reject
`FINAL_TARGET_STALE` even when lease cleanup succeeds. A newer valid target is
never erased by expiry of an older reserved target. Loss/cancel discards pending
movement rather than promising final-target delivery.

Bad, mismatched, duplicate-as-new, regressing, rejected, or timed-out replies block
that stream and request explicit reconciliation. No automatic retry, revision
invention, lease-stealing, rollback claim, or silent offline branch is made. The
receipt deadline defaults to 5 seconds and is configurable. A late reply after a
deadline is evidence only; it cannot unblock the controller or mark a lease closed.
`onReconcile` is a notification port, NOT an implemented recovery service. Its
consumer must reconcile committed state and resolve release/lease expiry. Retained
latest intent is evidence, not permission to replay it, especially when cancelled.
Blocked controllers cannot begin again. Only after external reconciliation may the
integrator create a new controller with a verified lease/session/epoch.

Preview/receipt/status observer failures are counted and isolated. Reconciliation
notification failures are also counted; the controller stays blocked rather than
assuming success. Async callback failures do not become unhandled rejections.

## Tests and deployment gaps

```sh
node --test services/vivo/tests/input/*.test.mjs
node --test services/vivo/tests/input/*.test.mjs services/vivo/tests/integration/contracts.test.mjs research/vivo-phase-fabric/tests/target-mailbox.test.mjs
```

Node v22.16.0: 65 input tests plus 17 unchanged contract tests and 9 unchanged
reference-mailbox tests, 91 passed, 0 failed/skipped. Evidence is unit/fake-transport
plus one real-host-event-loop test, not native-browser-network, physical-device,
authority/backend, material, or public deployment evidence. Fake task timers run
only after Promise microtasks drain, matching host event-loop ordering.

Main integration still supplies lease acquisition/fencing/renewal, authority
snapshot reconciliation/recovery, transformed input and hand-quality gates,
per-source preview rendering, lifecycle wiring, and fixed-step material response.
No camera/physics/render loop is scheduled or patched here; target transport is
event-driven and lease finalization uses a one-shot task outside rendering.
The web build must expose or bundle the repository-relative reference-mailbox and
canonical-validator imports. This PR does not change asset mounts or entrypoints.
