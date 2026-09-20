# XR Spatial Controls + Simulated Exchange

The Living Reality XR path now has one shared spatial control rail and one shared
air-keyboard integration point.

## Interaction model

- **WebXR hand tracking** is requested as an optional session feature. When the
  browser/device grants it, the existing Three.js renderer attaches the
  vendored XR hand models to the same scene.
- **Point + pinch / controller select** continues to use the existing shared
  raycast selection authority.
- **Open-palm swipe left/right** moves through the XR side tabs.
- **Finger tap** events from the existing Hand Lens are reduced to normalized
  x/y + gesture metadata. A tap only activates a matching side-rail DOM button;
  it never becomes a new block-world raycaster.
- **AIR KB** toggles the existing `air-keyboard.js` instance. The keyboard's
  own focus/input behavior remains authoritative.
- The side rail can move between the left and right edge with **MOVE**.

## Exchange surface

The side rail's EXCHANGE tab is a discovery and rehearsal surface. The catalog
contains BTC, ETH, XRP, and a wider set of recognizable public crypto assets.
The catalog contains symbols/names only; current market observations remain a
separate evidence surface.

Custom coins are bounded by deterministic rules:

- 128 custom coins total by default.
- 8 custom coins per creator.
- 3 coin creations per 10-minute rolling window.
- 60-second creation cooldown.
- 2–8 character uppercase ASCII symbols.
- Reserved public symbols are blocked.
- Duplicate definitions are blocked.
- Order previews are limited to 30 per minute, 20 open orders per actor, and
  100,000 simulated notional units per preview.
- Preview prices outside a 10% band from the supplied reference are blocked.
- Self-trade previews are blocked.
- Suspicion score increases for abuse patterns and hard-blocks at 100.

These are deliberately simulation controls. They do not authenticate users and
do not claim to prevent abuse against a real financial exchange.

## Privacy / authority boundary

No XR hand frame, camera image, biometric identity, key, wallet credential,
transaction signature, or settlement request crosses the spatial UI event
bridge. WebXR capability metadata is local-only. Exchange operations are
preview-only and never settle funds.

## Current verification

The repository includes unit coverage for the capability layer and simulated
exchange guard. Hardware compatibility still requires a physical WebXR
headset/browser check because browser and device support varies.
