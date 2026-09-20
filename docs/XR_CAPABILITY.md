# XR capability and glasses readiness

The Living Reality renderer uses one canonical WebXR session for both
immersive VR and immersive AR. The XR capability layer is intentionally
separate from token/domain work so parallel renderer agents can merge without
creating a second world.

## Capability discovery

`src/render/xr-capabilities.js` performs a non-immersive capability probe with
`navigator.xr.isSessionSupported()`. The probe does not call
`requestSession()`, so it does not start a headset session or trigger an XR
permission prompt.

The probe reports:

- whether WebXR exists;
- whether `immersive-vr` is supported;
- whether `immersive-ar` is supported;
- secure-context state;
- the currently desired optional feature set.

## Runtime session evidence

After a session starts, `inspectXrSession()` records the features actually
granted by the browser/device, including:

- `local-floor`;
- `hand-tracking`;
- `hit-test`;
- `anchors`;
- `depth-sensing`;
- DOM overlay state;
- `environmentBlendMode`.

The application should use these runtime values to decide which presentation
and interaction affordances are enabled. Optional features are not treated as
guaranteed just because they were requested.

## Glasses interpretation

This is a WebXR capability layer, not a claim that every commercial smart-glass
product exposes WebXR. A compatible AR headset/browser can use
`immersive-ar`; a phone can provide the existing camera-based Hand Lens
fallback. Hardware-specific support still has to be verified on the actual
device/browser combination.

## Security and privacy

The XR capability module never reads camera pixels, raw hand landmarks, eye
data, audio, or identity data. It only observes WebXR capability/session
metadata. The user must explicitly initiate an immersive session.

## Verification

Run:

    node --test tests/xr-capabilities.test.mjs

The tests use a fake navigator/session and verify that capability discovery
does not invoke `requestSession()`, that unsupported modes are reported
explicitly, and that granted runtime features are preserved.
