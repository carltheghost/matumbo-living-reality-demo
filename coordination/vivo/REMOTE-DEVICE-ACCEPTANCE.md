# Vivo remote device acceptance

This is the final external gate for the canonical remote Vivo stage. Automated
CI already proves the software-side two-person path with two real WebSockets and
two independent managed-Chromium browser contexts. This checklist is deliberately
separate because a cloud runner is not a phone, a camera, a home Wi-Fi link, or a
public TLS deployment.

## Before the device run

Use a private durable data directory outside the checkout. Install the exact
service requirements and Node 22 or newer. Stage the exact Chat 3 input
dependency. Set a random owner capability of at least 32 characters in
`VIVO_OWNER_TOKEN`; do not paste it into source, logs or a screenshot.

For non-loopback use, provide a certificate and key that the phones trust and an
HTTPS Origin matching the address they open. The server refuses a non-loopback
bind without TLS. Example shape:

```sh
export VIVO_OWNER_TOKEN='use-a-real-random-secret-at-least-32-characters'
services/vivo/start-canonical-remote.sh \
  --host 0.0.0.0 --port 8768 \
  --data-dir /absolute/private/vivo-remote \
  --origin https://vivo.example.test:8768 \
  --cert /private/tls/fullchain.pem \
  --key /private/tls/privkey.pem
```

A self-signed certificate is useful for CI transport tests but is not a public
trust configuration. Do not disable browser certificate validation on the phones
and call that production acceptance.

## Two-device acceptance record

Record device model, OS, browser/version, network type and lighting. Never include
owner/invitation tokens in evidence.

1. Open the HTTPS Vivo page on device A with the owner capability. Create a
   one-hour editor invitation and open it on device B. Confirm the fragment
   disappears from B's address bar after capture and both participants appear.
2. Leave both cameras off. On the 4D root Relic, use touch from A and B. Ordinary
   unmatched grabs must stay exclusive; matching cooperative Vivo grips may act
   on the same object. Both screens must converge on one accepted object state.
3. Run learned material from the owner. Move x4 on the shared object. Verify the
   solid accepted object moves, not just the dashed target, and both devices show
   the same accepted coordinate.
4. Enter the Relic's inner world from A. A must show 11 spatial axes while B
   remains in root 4D. Move x11 on the inner Relic, leave, return, and verify the
   x11 change persisted. B's Eye must never move because A navigated.
5. While B holds an object, interrupt B's network or close the tab. A must remain
   live, B's lease must be released, and reconnect must load current accepted
   state without replaying an unacknowledged stale target.
6. Restart the Vivo server using the same durable directory. Reopen the still
   valid invitation. Verify stable actor identity, independent saved Eye, object
   IDs, 4D/11D coordinates, material model hash and accepted history. Process-local
   leases must not survive restart.
7. Camera on each device: test front preview, rear preview and camera-only/touch.
   Camera frames must never appear on the collaborator or in network requests.
   Microphone must remain unused.
8. Hand path: show open hand, aim, pinch, move, open. Verify the target timestamp
   comes from capture time, stale frames are rejected, tracking loss releases only
   the hand-owned grip, and a separate touch grip remains usable. Reacquisition
   must require fresh observations rather than resurrecting an old grip.
9. Test bright, balanced and dim lighting. Record model initialization, visible
   hand-to-object latency, stale/dropped frames and false/missed grabs. Do not use
   animation FPS or server ACK time as a substitute for hand-to-visible-object
   latency.
10. Hide/background the tab, flip cameras, stop the camera, rotate the phone and
    reconnect. No hidden tab or stopped camera may continue a hand-owned edit.

## Pass criteria

The gate passes only if both devices manipulate the same accepted persistent
object, higher spatial coordinates behave as coordinates with time separate, the
nested world returns to the same accepted changes, Eyes remain independent,
disconnect/restart reconcile safely, and the local camera/hand path does not leak
frames.

Until this physical run is recorded, repository health/CI must continue to report
`physicalDeviceValidated:false`. Public DNS/certificate operation and real
Internet latency are separate deployment evidence and are not implied by a
successful LAN device run.
