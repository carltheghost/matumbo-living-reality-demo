# maTumbo Viva Shared Workshop 0.8.1

A built, runnable continuation of Viva 0.8. **Not a public deployment.**
Your GitHub Pages site and merged Studio 0.7 are not modified by this package.

## Open locally

Install Python 3.11 or newer, extract this ZIP, and run `start-local.cmd` on Windows
or `./start-local.sh` on macOS/Linux. Open `http://localhost:8765` on that computer.
The server must stay running. On the start screen, wait for **SERVER READY**.
Create a 4D room with the camera off. Drag Relic, open Share, invite a second
browser, and verify that both participants see one accepted object state.

## Open on a phone / collaborate remotely

Host the included server behind HTTPS with one process and persistent storage.
Use `RAILWAY-SETUP.md` or `compose.yaml`; see `docs/DEPLOYMENT.md`.
Replit creation was attempted in this conversation and rejected with an active-
subscription requirement. No Replit app, public domain, paid service or new PR
was created. Railway is not connected. No deployment is claimed.

A downloaded HTML or GitHub Pages-only upload cannot run this backend. The new
readiness screen detects a missing server and disables misleading create/join
buttons instead of leaving them apparently functional.

## This release changes

* Camera-only touch mode remains available. A hand-worker failure can fall back
  to the live camera instead of turning the whole experience off. Tracking is
  explicitly marked off; there are no invented hand landmarks.
* A `/readyz` endpoint checks application assets, the trained rule file and the
  opened database. It does not certify phones, cameras or a persistent volume.
* Public binding rejects weak/sample secrets, a missing HTTPS origin, and a
  database inside the public web directory. Proxy headers are not blindly trusted.
* A converged guidance field stops repeated solver work and frequent redundant
  broadcasts; a changed goal, obstacle or cost wakes it again.
* A visible participant can retain a motionless grab through authenticated lease
  renewals. Hiding the tab releases it. Another participant cannot renew it.
* Expired invitations are disconnected even when a viewer sends no commands,
  instead of allowing an idle connection to keep receiving future updates.
* Test discovery no longer accidentally launches a real-image probe without an
  image. Device probes run only when explicitly invoked.
* Real loopback TLS/WSS tests cover two-client collaboration with HTTPS origins.
* Current hosting instructions replace the obsolete Railway TOML example.

## Retained

Native 3–11 spatial-coordinate movement, curved-space examples, learned guidance,
independent World Eye, touch and camera controls, state history, JSON, PNG and
video capture, and the unchanged original assembled Viva Studio 0.7. The legacy
publish/return bridge remains explicit rather than silently syncing everything.

## Limits

No public URL, physical-phone benchmark, real webcam acceptance, immersive AR in
the new shared mode, arbitrary global manifold support, calibrated eye gaze,
online neural retraining, or general intelligence is claimed. Shared mode is a
camera overlay. The existing original Studio retains its experimental AR mode.
TLS/WSS loopback tests are real encrypted sockets, not a public internet test.
Browser component checks disclose their restricted-environment relay.

Read `BUILD-VERIFICATION.json` and the new `reports/` evidence. Prior 0.8 evidence
is preserved separately in `reports-08/`, not counted as fresh checks.

Run `python -m unittest discover -s tests -p 'test_*.py' -v` for pure/network tests.
`python tests/browser_acceptance.py` expects a local server with room creation
unlocked (the default loopback-only startup). A physical-device model probe is
opt-in and must never be counted as a pass unless genuine inference succeeds.
