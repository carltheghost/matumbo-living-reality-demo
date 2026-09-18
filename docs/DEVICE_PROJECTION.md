# Phone / PC / XR device projection

The device projection is the presentation seam for one canonical Living Reality
world. It deliberately does not create a second state store: the browser keeps
the same `SIMFABRIC` envelope and pairs it with local viewport, input,
accessibility, and fallback metadata.

Mission Control opens the **Phone / PC / XR** console with the shareable route
`/?feature=projections`. The console exposes three inspectable profiles:

- **Phone** — compact layout, coarse/touch input, and reduced-motion-aware
  fallback;
- **PC** — expanded pointer/keyboard presentation with the existing orbit and
  semantic-object interactions;
- **XR** — explicitly `not-tested` and `fallback-only` until a real WebXR
  session, mobile performance trace, and cross-device parity test exist.

Selecting a profile focuses the nearest arena organ and emits a local intent.
Replay walks `canonical-world → device-profile → fallback-boundary`; reset clears
the in-memory trace. These controls do not resize the canonical state, open a
WebXR session, synchronize devices, persist preferences, or contact a provider.

The cube workspace also exposes the explicit `panel=gesture` route for phone
input. Touch/pointer is always the fallback. Camera motion is a separate,
permission-gated **viewpoint-only** control that reduces frames to coarse
motion and releases the stream when stopped. The gesture panel reports
orientation, gaze, native-hand, and XR-hand capability states; gaze is used only
when a host supplies `__TUMBO_GAZE_TRACKER__`, and native hand input is used only
when an explicitly enabled host supplies `__TUMBO_NATIVE_HAND_TRACKER__` (or its
compatibility alias). Host samples are reduced to bounded pose plus the coarse
`pinch`, `point`, `open`, or `inspect` gesture (plus XR-hand `select`), or the
explicit native-hand carry signals `grab`, `hold`, `place`, and `release`. No
raw frames, landmarks, faces, identity, recordings, uploads, or provider calls
cross this bridge. A fresh gaze lock gates same-target local selection,
inspection, and carry: `grab` starts a held draft, `hold` accepts only one
integer grid step, and `place`/`release` leaves that draft at its current held
cell. Different-target, stale, invalid, duplicate, or no-held actions are
rejected; these operations never infer a destination or edit the canonical
projection. A fresh lock is rendered as a short-lived red edge cue on the
existing cube and the readout announces **EYE LOCK ARMED**. Coordinate-less native-hand
or XR-hand input reuses that locked block id even if presentation easing moves a
neighboring mesh; explicit hand coordinates must still raycast the same block.
On the local route, **Enable phone gestures** is explicit; stopping it returns
to the touch fallback. Packet 185 carry evidence is recorded in
`work/audit-gaze-hand-manipulation-185.json` (24/24 checks, including
Grab → one-step Hold → Place/Release and fail-closed carry cases).
The final-tree companion recheck is recorded in
`work/audit-gaze-hand-final-tree-recheck-211.json` (24/24 checks at
`2026-08-30T12:09:17.115Z`, including same-target Grab → Hold → Release,
mismatch/invalid/no-held/stale/Stop rejection, zero unexpected requests, and
zero page/console errors).

When both host capabilities are active, the panel makes the handoff explicit:
**LOOK THEN PINCH / POINT / OPEN / INSPECT / XR SELECT**. A valid gaze point must first
raycast an existing cube and creates a renderer-local `GAZE LOCK` for 1,800 ms.
Native-hand samples may then address only that same block; a hand sample with
no coordinates reuses the fresh gaze point/lock id, while a stale or missing
gaze is inert. Point is a non-mutating confirmation, pinch selects, XR-hand
`select` selects through the same coupling, and open/inspect delegate to the
existing local cube operations. The lock is cleared by Stop, by an unpointed
gaze sample, or by expiry. Packet 183 browser evidence is recorded in
`work/audit-gaze-hand-target-cue-183.json` (27/27 checks, including the red cue,
same-target XR select, explicit mismatch rejection, and cue lifecycle); the
earlier Packet 174 receipt remains a compatibility baseline. These sanitized
host hooks are not a claim that a physical phone camera, eye sensor, hand
tracker, or production WebXR session is present.

The implementation lives in `src/render/device-projection.js` and is exercised
by `tests/device-projection-render.test.mjs`. The underlying metadata contract
remains in `src/projections/device-projection.js`.
