# Viva Studio 0.7: mapped spaces and visibility

This extends PR #73 on the same `field-lab-studio.html` route. Do not rename the repository, replace the root site, merge automatically, or open a downloaded HTML as the phone camera app. The existing original-v04 IndexedDB launcher slot and v05 hand worker are retained. The three original Studio modules remain byte-for-byte unchanged. After verifying their hashes, the launcher inserts one bounded scene-recording hook into Studio and updates its displayed title. The six-module manifest rejects mismatches before execution.

## Delivered

- `viva-core.js`: fixed order-nine Smith primal/dual circuit solve; positive, distinct square sides; independent coverage, containment and overlap checks; bounded numerical residual. It is not an arbitrary mesh-to-rectangle algorithm.
- `viva-visibility.js`: 64x48 camera sample at four updates/second, clipped-white and near-black measures, hand-region statistics when available, display hysteresis, subdued glare/low-glow profiles, explicit capability-bounded exposure request/reset and existing torch control. Display filtering does not modify the hand-detector image. Late hand results (>240 ms), lost input and nearly black/clipped hand regions cannot keep dragging. Three distinct open-hand observations re-arm input.
- `viva-spaces.js`: root Field -> Circuit Atrium -> nine mapped room states. Echo Garden's Inner Workshop is a nested destination. Each room uses the existing NDFieldEngine with 24 nodes, persistent object identities and observer state. Root retains its original 300-node field. Exterior miniatures show child object state. Entry is an explicit mapped transition, not continuous portal geometry.
- Touch and camera pinch use the existing actual-coordinate grab path. World Eye provides circuit map, active 2-9 spatial-axis control, visited-space information, universe save/restore, and bounded JSON export/import.
- Focus view keeps entry, return, Eye and Controls visible while reducing clutter. Active recording indicators remain visible. Incompatible Room AR cannot silently start from an inner room; return Outside to use the existing root Room AR mode.
- Studio history checkpoints include space identity and observer state. Universe JSON saves all visited spaces, independently of the original single-field export. Invalid imports validate all candidate snapshots before replacement. Inactive rooms are paused; no unobserved history is invented.
- Video/PNG composition includes room geometry. Camera inclusion remains an explicit unchecked-by-default choice. No microphone or automatic uploads. State JSON contains no camera images or hand landmark recordings.

## Test evidence

119 local checks passed: 37 new pure core checks, 47 actual browser checks, 25 existing Studio mathematics/history checks rerun, and 10 launcher integrity/assembly checks. The browser rendered through Canvas fallback, used generated real MediaStreams with controlled landmarks/camera capabilities, and actually encoded a nonempty scene video. Tests cover pointer dragging, nested entry/return, exact restored positions and observer, JSON round-trip and atomic rejection, cross-space history, white/black frame detection, stale-input release, exposure bounds/reset, permitted-camera retention across explicit transitions, Stop releasing tracks, dimensional preservation, and no uncaught page errors.

The source bundle delivered with the conversation includes the browser suite and complete reports; repository CI independently runs the 25+37 pure tests, script compilation and six-module integrity checks. These are not 119 real-phone tests.

Not validated: a physical phone, real bright/dark hand tracking, new real-model inference, end-to-end phone latency, GPU/WebGL rendering, physical exposure/torch, real ARCore, new public deployment, or successful persistent IndexedDB save/reload. An attempted real-origin browser storage test was blocked by the test environment; JSON state restoration was verified.

Not implemented: eleven spatial axes, relativistic/QFT physics, seamless traversable portals, room collision or environmental occlusion for these interiors, simultaneous RGB hands and immersive room AR, automatic neural retraining, unlimited history, or night vision. All nine rooms share starter geometry and differ in identity/state; they are not nine finished themed worlds. Space transitions reset the original in-memory branch-parent stack; the current branch checkpoint is preserved per space.

## First phone acceptance sequence

After Tumbo reviews/merges this PR and the Pages deployment succeeds, open the existing HTTPS `field-lab-studio.html` launcher and choose **Open saved Field Lab with Viva 0.7**. Do not clear site data. Use the original-v04 file picker only if no original is stored.

1. Leave camera off. Enter Viva, select S1 / Echo Garden, Enter selected.
2. Drag Relic, select Inner Workshop, enter, move an object, then Outside. Re-enter and verify both changes persist.
3. World Eye -> Export universe JSON. Reload the launcher and import this JSON; verify location and objects. Separately test browser Save/Restore.
4. Controls -> Visibility / tracking. Compare Balanced, Bright/glare and Dark/low-glow. Touch must remain available with a black camera image.
5. Controls -> Camera / AR -> Front + hands. Open hand until armed; aim, pinch, move, release. Temporarily hide the hand: the object must release. Show a pinched hand: it must not reacquire until opened.
6. Controls -> Move / Light / Record. Record history and video separately; camera inclusion must remain opt-in.

No new live address is claimed until the post-merge deployment verifies HTTP 200 and matching content hashes.
