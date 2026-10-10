# Field Lab 0.5: touch, grab and hand-worker repair

User request: Android camera now detects hands, but interaction is slow, objects cannot be touched/moved, and camera overlay is mistaken for room projection. Add real manipulation and useful adaptation without replacing the original field.

## Ownership and constraints
- Branch: `fix/field-lab-grab-worker-2026-10-10`. Tumbo reviews/merges; no self-merge.
- Scoped files: `field-lab-grab.html`, `src/field-lab/field-lab-touch-repair.js`, `scripts/field-lab/*`, this packet, and the deployment workflow required to include/test the route.
- Canonical landing `index.html` and original `field-lab-phone.html` remain unchanged.
- AGENTS.md was read. Its referenced `.tumbo/continuity/STATE.md`, `OWNERSHIP.md`, and `INTERFACES.md` returned 404 on the default branch.
- This is local simulation/projection only. No wallet, signing, ledger, identity, settlement, external-action or financial authority is introduced.
- User images are not committed, uploaded, or used in CI.

## Implemented
- Grab node: touch or camera pinch moves actual active simulation coordinates. Explicit release and gold HELD feedback. Dormant coordinates stay unchanged. Kinematic work is energy-accounted.
- Move field: common active-coordinate translation of every node; View mode retains camera rotation separately.
- Input loss, stale results, Stop, blur and changed state release grabs safely. Reacquisition requires an open hand.
- Real classic worker with OffscreenCanvas and transferable resized frames; at most one frame in flight, one detected hand, no frame backlog. Explicit compatibility fallback.
- Speed-adaptive filtering, bounded decorative samples, exact cached contact broad phase. Full 300-node dynamics and law remain.
- Optional labelled open/pinch threshold calibration. Saves thresholds only when explicitly requested. This is not neural retraining or proof of improved accuracy.
- Existing WebXR room placement gains center-aim/tap grab, phone-motion manipulation and tap release. Separate from camera-hand mode. No persistent anchors or simultaneous hand camera inference in room mode.
- HTTPS loader reuses original v04 app saved in IndexedDB. Original and repair SHA-256 checks prevent running unexpected content. Does not accept arbitrary uploaded HTML.
- Pinned MediaPipe runtime/model are vendored into the deployment artifact at build time and served from the same origin.

## Evidence
76 primary local checks passed: 23 mathematics/physics; 38 full-app browser interaction; 12 calibration/XR-adapter; 3 loader integrity/assembly. Tests and JSON reports are included in the conversation source package.

Portable repository checks: `node scripts/field-lab/test-math.cjs` (13 checks, overlapping the local math coverage; not counted twice).

Real-model CI run 38013997235, build job 114100151624: SUCCESS. Exact worker plus pinned MediaPipe 0.10.14 detected 1 hand with 21 finite landmarks on Google's official Hand Landmarker notebook fixture; blank image produced zero hands. Initial inference 163.6 ms in desktop CI, NOT Android latency. Report artifact `field-worker-real-check`.

Limitations: local UI tests use Canvas fallback, generated camera streams and controlled landmark/model fixtures. XR adapter tests mock session/matrices/GL. Persistent-storage calibration test uses a test double. Full browser HTTPS launch could not be locally exercised because navigation was administrator-blocked. No physical phone, real webcam, real ARCore placement, or on-device latency measurement for 0.5.

## Publication
The attempted branch deployment job 114100311912 was rejected before running any steps. No new version reached the public site. The exact reason was not exposed by the available read endpoints; do not claim a diagnosed environment setting.

The workflow now builds/tests this branch but deploys ONLY from main, after a reviewed merge. No environment restriction was weakened. Successful build is not successful deployment. After merge, wait for Deploy and the HTTP/SHA live checks before describing `field-lab-grab.html` as live.

## Phone acceptance after deployment
1. Open the new HTTPS grab route and use Open saved Field Lab, or choose the original v04 HTML through the page.
2. With camera OFF, touch a labelled ring, drag, observe HELD and changed position, lift to release.
3. Start Front + hands. Show open hand, aim, pinch, move, open. Confirm status shows worker mode and finite latency. Compare responsiveness on the real device.
4. Test Move field, View, dimensions 2-9, loss/reacquisition, camera flip and Stop.
5. Optional calibration: collect open then pinch; test before saving; Reset restores defaults.
6. Room AR on supported Android: scan surface, place, aim center at node, tap grab, move phone, tap release. No hand-camera overlay in this mode.
