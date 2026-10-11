# maTumbo Viva Shared Workshop 0.8

A runnable shared-room server and mobile client, added alongside Viva Studio 0.7.
**Not a public deployment. Do not open index.html or an HTML attachment from Android Downloads.**

## Start on a computer

Install Python 3.11 or newer. On Windows double-click `start-local.cmd`; on macOS/Linux run `./start-local.sh`. These create a virtual environment and install the two pinned server dependencies. Open `http://localhost:8765` in a browser. The server must remain running.

Equivalent commands:

```sh
python -m venv .venv
# Use .venv/Scripts/python.exe on Windows or .venv/bin/python on macOS/Linux.
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m server
```

Localhost is for a computer-side test, not a public phone URL. A LAN HTTP address may display the world while blocking camera access. Use HTTPS for real phone camera testing.

## Share across different physical locations

Host this server on an HTTPS service that supports long-lived WebSockets and a persistent filesystem. One process / one replica owns each SQLite database. GitHub Pages cannot run this Python authority.

`Dockerfile`, `railway.toml`, and `compose.yaml` are supplied. They have not been deployed by this build. See `docs/DEPLOYMENT.md`. Never expose the database or creation key through the static web directory.

After deployment: open the HTTPS root, enter the server creation key, create a room, choose Share, and create a 24-hour Editor or Viewer invitation. Send that invitation to the other participant. They explicitly join. The owner token is not the guest invitation. Both devices must connect to this same authority.

The room creator chooses a display name; this is not identity verification. Invite links are bearer capabilities. Owner access expires after 30 days; guest access after 24 hours. This prototype has no account recovery or permanent ownership UI. Export and back up before expiry. Do not store secrets or sensitive work in a test room.

## First acceptance sequence

1. Create a flat 4D room, with the camera OFF. Drag Relic. Its gold handle means the server accepted the grab.
2. Join from a second browser/device using an Editor invitation. Verify the same object changes. A held object cannot be stolen; release and hand it over.
3. Choose Move, x4, and step three times. The relic leaves the fixed-x4 slice without deletion. Eye -> Meet selected object follows it. The other person's Eye stays independent.
4. Save a checkpoint, inspect recorded history, return to live, export JSON. Restart the server and rejoin using your valid invitation to verify persistence.
5. Create a sphere, torus, or Möbius room. Movement uses the metric and chart transitions. Field -> Trace route displays the learned-cost guidance. Block a route cell and let the local field rebuild.
6. Only then enable Front + hands or Back + hands. Allow camera access. Open hand, point, pinch, move, open to release. Actual model image processing needs working WebGL even with its CPU delegate. Stop releases camera tracks. Missing or stale hands cannot continue a hand-owned grab. Touch stays available.
7. Record a local scene clip or PNG. Camera inclusion is unchecked by default. No microphone is requested.

## What is implemented

- Real aiohttp HTTP + WebSocket authority; two separate socket clients; owner/editor/viewer capabilities; exclusive grabs; per-object revisions; duplicate-command protection; reconnect; SQLite durable events/checkpoints; all 3–11 coordinates used by movement.
- Phone-sized Canvas/WebGL client with visible grab handles, touch drag, explicit extra-axis movement, independent World Eye, sharing, history, local video and PNG capture. The renderer reads state; it does not define world coordinates.
- Local, pinned MediaPipe hand worker, one frame in flight, front/back camera, cover-crop/mirror mapping, speed-adaptive pointer smoothing, open-hand reacquisition, stale/lost safety, low-glow/glare display profiles, explicitly requested hardware torch/exposure where exposed.
- Curved-space core: sphere two-chart atlas, periodic torus, twisted Möbius seam, product extra coordinates, user-defined positive-definite metric expressions on a bounded chart. Metric-aware RK4 geodesic movement transforms tangents at chart seams.
- A trained 369-parameter cost rule with actual saved weights. Local neighbor updates grow a guidance field; changing obstacles/goal/crowding reorganizes it. Analytic and off modes provide comparisons.
- Existing Studio 0.7 preserved byte-for-byte as `web/studio-original.html`. `web/studio.html` adds an explicit publish/return bridge. Publish copies named nodes with stable provenance into a shared flat 9D room; it is a deliberate handoff, not automatic synchronization of every original nested space.

## Precisely what is not claimed

- No physical-phone, actual webcam, ARCore, native browser HTTPS/WebSocket-origin, or GPU acceptance test was completed here. Browser tests use an explicitly disclosed test transport because top-level navigation is blocked in the test environment. Separate server protocol tests use real TCP sockets.
- The real hand model loaded, but still-image inference was blocked by unavailable WebGL image processing in this environment. Controlled landmarks and generated real MediaStreams verified downstream gestures and lifecycle. This is not evidence of real hand-recognition accuracy or a phone latency improvement.
- Shared mode is a camera overlay, not world-anchored room AR. The original Studio retains its separate experimental AR controls. No simultaneous room-SLAM plus custom hands, real calibrated gaze, physical occlusion, or room-depth reconstruction is claimed.
- Built-in curved spaces are S², T² or a Möbius strip times flat extra coordinates. They are not arbitrary Calabi–Yau manifolds. The custom metric editor handles a smooth finite chart, not automatic arbitrary global topology. The guidance mesh samples a 2D working surface within the product space, not a dense 11D volume.
- Curved objects are chart-aware handles, not general curved solid-body colliders. Flat ball contact uses all active coordinates. Custom-metric display is an illustrative chart, not an isometric embedding.
- Room behavior is narrow learned wayfinding plus explicit local relaxation. It does not create intelligent beings, generate finished architecture, retrain online, or establish general intelligence. The quadratic baseline fits the synthetic teaching law better than the neural model.
- Single process, latest 301 checkpoints/events, last 1,200 command receipts. No multi-region scale, external security audit, account system, end-to-end encryption, or unlimited history.
- Publication credentials and browser storage from the old GitHub Pages origin cannot automatically cross into a newly hosted origin. Export/import the original Viva universe deliberately when moving sites.

## Test evidence

See `verification.json` and `reports/`. `docs/ACCEPTANCE.md` separates automated verification from the real-device checklist. No private camera/photo input, real invitation tokens, or live test database is included in the archive. The new shared mode vendors its tracking assets locally. Retained Studio head-pointer mode can still explicitly download its original MediaPipe face assets from jsDelivr/Google Storage; this is not frame upload.

## Tests and training

```sh
python -m unittest tests.test_geometry tests.test_adaptive tests.test_network -v
cd legacy/numerical && python -m unittest test_reference -v
# From root:
node legacy/studio/tests/core.cjs
node legacy/studio/tests/viva-core.cjs
```

Browser tests require Playwright and Chromium. `tests/browser_acceptance.py` uses the documented restricted-environment harness and expects a local server on port 8765. `tests/test_real_model.py IMAGE.jpg` uses an explicitly provided still image and does not retain it. A failed real-model run must not be reported as passed.

`python scripts/train_room.py` requires Torch. Only synthetic inputs are used; training/validation/test seeds are separate, and validation selects checkpoints. The exact teaching law and stronger quadratic baseline are reported.
