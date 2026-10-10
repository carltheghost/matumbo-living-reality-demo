# Field Studio 0.6: movement, visibility and records

User request: review five supplied Shorts, treat the multidimensional world as buildable software, improve motion, bright/dark-room use, and recording/history. This is an additive implementation against main 7adf837336e2503ade1ad45d7cf0f7b5bb1986b5, following the working merged 0.5 grab repair.

## Ownership
Branch: feature/field-studio-movement-light-history. Tumbo reviews and merges. No self-merge. Scoped paths: new field-lab-studio.html; src/field-lab/studio*.js; scripts/field-lab/test-studio-core.cjs; new Studio test workflow; this packet; docs/field-studio-tests.json. The existing deploy workflow changes only its live-verification list to include the new launcher/modules. Root index.html, original phone/grab launchers, 0.5 repair and worker remain byte-for-byte unchanged. No wallet, ledger, identity, signing or settlement authority is introduced. AGENTS.md was read; its continuity/ownership/interface files remain absent as documented in the prior packet. No user photos or camera recordings are committed.

## Implemented
- Visible scene movement pad for selected node, whole field or observer. Near/far depth, left/right/up/down. Actual active-coordinate updates with work accounting; dormant coordinates retained.
- Explicit active-axis steps and rotations in two independent active spatial axes. Time remains distinct from spatial-dimension controls.
- Optional bounded apparent-palm-size depth during camera pinches. Default off, labelled uncalibrated; hand tilt can affect this heuristic.
- Automatic preview-luminance display selection with hysteresis, plus bright/dim/neutral overrides. It changes display contrast, not sensor performance. Capability-gated explicit rear torch control. Poor-light warning recommends light or touch, not fake night vision.
- Explicit rolling history capture at 2 Hz, complete state/observer checkpoints, read-only scrub, exact return to pre-replay state, validated JSON export/import. 120-frame ceiling and 16 MB estimated serialized-size budget. The default dense field retains roughly 16 seconds before the byte limit evicts older frames; UI reports eviction. No camera pixels or hand-landmark sequences in history. This is discrete checkpoint playback, not continuous event replay, forecasts or recorded physical-room reconstruction.
- Explicit real scene video and PNG export. Camera inclusion unchecked by default; no microphone/audio. Video capability checks, max 60 seconds/about 32 MB; stop on tab/focus loss, camera stop when included, resize or immersive session. Existing buffer must be explicitly discarded before a new recording. No uploads.
- Existing separate Room AR center-aim/tap controls retained. Immersive camera video capture is explicitly unsupported. Simulation history during AR is not persistent room/anchor history.
- Existing trained hand model, worker, One Euro filter and labelled pinch calibration retained. No model retraining, general intelligence or measured phone latency improvement is claimed.

## Local evidence
124 passing checks across six suites: 25 pure mathematics/history; 31 full-app Studio browser; 11 visible-pad/torch-fixture/depth/export; 7 loader integrity/assembly; 38 original grab/worker regression; 12 original calibration/XR-adapter regression. The scene video was actually encoded/exported by Chromium MediaRecorder, not a fake encoder. Full suites, assembled source, pinned hand assets and reports accompany the conversation source ZIP. The new repository CI runs the 25 pure tests plus syntax and manifest checks; these overlap local coverage and must not be added again to 124.

Limits: browser UI uses the actual Canvas fallback. Camera input is generated; landmarks, torch and XR are controlled fixtures. No physical phone, real low-light recognition, real gesture-depth accuracy, real ARCore room test, GPU renderer or current-device latency measurement. The new public HTTPS route and actual persistence require post-merge/device acceptance. A successful branch test is not publication.

## Five-video access record
4UJo6sx6xWw: title only, The 4TH DIMENSION Explained !! w/ Michio Kaku.
yhfyAelnXno, q4mMCTd71MA, -pgI7zpgHo4: no reliable content retrieved.
vOM8NngVBIw: title only, 11 Dimensions Explained #dimensions.
All five were attempted, none yielded a complete video/audio/transcript. No full review or content-specific implementation is claimed. A vidIQ connection was surfaced but not established. Work proceeds from the user's explicit movement, lighting and recording requirements independently.

## Phone acceptance after deployment
Wait for merge plus successful Deploy and HTTP/hash verification. Use the HTTPS Studio route and the same stored original v04 app. First touch/drag, then open Move / Light / Record and show the movement pad. Test node vs whole-field vs viewpoint plus near/far. Test 2-9 active axes and rotation; verify dormant preservation. Then camera hands and optional approximate depth. Try normal, bright and dim rooms and verify touch survives tracking loss. Record/stop/scrub/return history, save/load JSON. Separately record/save field-only video, explicitly include camera, stop and verify final output. Check unsupported torch/recorder/AR paths fail clearly. Do not describe the release as physically phone-verified until these checks are performed on a real device.
