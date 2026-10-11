# Device acceptance and exact limits

## What automation proves

- Production HTTP endpoints and TCP WebSocket protocol: join, capability validation, two separate clients, revision checks, exclusive grabs/handoff, idempotency, revocation, observer movement, reconnect and SQLite server restart.
- Coordinate mathematics and chart transitions from 3D through 11D; explicit custom SPD metrics; local guidance rebuilds; pinned learned model predictions.
- Browser DOM/controllers, Canvas fallback, touch event path, higher-axis controls, history inspection, actual canvas video encoding, generated video-stream stop, controlled landmark handling and lighting samples.

The supplied browser harness exists because the environment blocks top-level browser navigation and native browser networking. It injects the real scripts/DOM and bridges browser WebSocket calls to separate real TCP sockets. This is **not a public-origin integration test**, not a way to bypass policies on a user's device, and not part of the shipped client.

The still-image MediaPipe test loaded the real packaged model and runtime. Inference encountered an unavailable WebGL image-processing path. This is a recorded incomplete acceptance check, not counted as a passed hand-recognition test. The CPU delegate does not eliminate the browser runtime's image-preprocessing requirement.

## Required on a physical phone and two remote devices

1. Open the directly hosted HTTPS URL in Chrome/Safari as supported. Verify camera permission prompt, front preview, rear preview and local model readiness. A file/content URL is invalid for this workflow.
2. Camera OFF: drag and release a relic from each device. Verify the other device sees exactly the accepted position, and simultaneous ownership is rejected visibly.
3. Move x4 out of the slice. Confirm it vanishes only from that view; follow with the Eye and rediscover it. The collaborator's independent viewpoint must not move silently.
4. Disconnect one phone while holding. It must release; reconnect obtains current state without replaying unacknowledged drag packets.
5. Show open hand, aim, pinch, move, release. Test a pinched hand returning after loss; no grab until three fresh open observations. Stale frames cannot continue movement. Missing hand input must not cancel a separate touch-owned grab.
6. Bright background, dim background, partly lit hand: inspect both usability and false/missed grabs. The software does not promise perfect tracking in darkness or clipped exposure. Touch remains usable. Torch/exposure require explicit support and user action.
7. Sphere atlas, torus wrap and Möbius seam: the path and display must stay coherent. On a Möbius crossing the transverse coordinate/frame flips; after two circuits it restores.
8. Field goal/block/crowd: a real learned-cost field changes and rebuilds; no furniture moves without an explicit command. Compare learned/analytic/off modes.
9. Record a scene with camera unchecked, then explicitly checked. Confirm no audio. Stop, hide tab, disconnect and leave. Save and replay locally. Camera feed must not appear on the collaborator's device.
10. Save a server checkpoint, restart deployment, reopen valid invitations, and compare exact object IDs, positions, neural version, chart IDs and history. Check persistent-volume permissions and durability.

Measure actual hand-to-visible-object latency on the phone; animation FPS and local-server ACK time are not substitutes. Record device, browser, lighting, model init time, dropped/stale frames and failed grabs. Never call this done merely because the health check is green.
