# Viva phone stage

GitHub Pages remains the canonical Vivo UI. The Android Companion is a hardened WebView host for that same Pages app; it does not ship a second renderer or a separate object model. The web implementation is additive under `services/vivo/web/phone/` and leaves the protected root Vivo entry points and deployment workflow alone.

## Runtime layout

- `phone/engine.mjs` holds one sparse world snapshot, object IDs, material edges, and per-Eye projection state. The local root can use the selected 3D through 11D dimension, with an 11D nested world, without allocating dense higher-dimensional grids.
- `phone/engine-worker.mjs` runs the local solver in a module Worker. The engine uses WebGPU/WebGL2/WASM capability detection only to describe available rendering/inference paths; the sparse solver has a JavaScript fallback.
- `phone/storage.mjs` stores the world snapshot and Eyes in IndexedDB. The service worker caches the Vivo shell only. The optional hand-model cache is separate and can be cleared separately. API, websocket and camera traffic are excluded from the app-shell cache.
- `hand-worker.js` owns hand inference. It asks the pinned MediaPipe Tasks Vision model for up to two hands, all 21 landmarks per hand, and tries the GPU delegate before CPU fallback. Video frames travel to that worker as transferable `ImageBitmap`s; no camera frame is sent to the Pages server, Android bridge, or service worker.
- `phone/hand-gestures.mjs` matches hands across detection-order changes, derives five finger states and poses, and calculates two-hand span/roll. The existing renderer draws the 21-point skeleton for each detected hand.
- `phone/bridge.mjs` connects the Pages UI to AndroidX `WebMessageListener` at the fixed GitHub Pages origin. The native tool list is filtered to the capabilities currently granted by the app and supported by OS/device state.
- `android-companion/` loads the canonical Pages URL. `CapabilityBroker` combines explicit in-app grants with Android runtime permission, sensor, and optional AccessibilityService state before exposing a tool.

The local phone world keeps a stable world ID and object identities. Each Eye has independent view, projection, nested-world return state, and revision. Offline work creates a named branch envelope and does not silently merge with a shared/server world.

## Hand input

Use the front camera with palm and fingertips visible. Gestures in local phone mode:

| Gesture | Action |
| --- | --- |
| Point with index finger | Select an object under the index fingertip |
| Open hand, then pinch | Arm and grab an object; move it along the selected `x1` through `x11` axis |
| Fist or open hand | Release the grabbed object |
| Peace sign | Toggle overview and current-slice view |
| Thumbs-up | Cycle the active material axis |
| Open-hand swipe | Select the next or previous object |
| Two hands, change fingertip span | Zoom the Eye |
| Two hands, rotate the line between index fingertips | Rotate the Eye |
| Touch drag / two-finger pinch and rotate | Select or move objects; zoom and rotate without the camera |

The tracker supports two hands because the pinned MediaPipe hand landmark task exposes a maximum of two. It draws every returned hand and all 21 landmarks; there is no one-hand-only selection path. Camera tracking and projection are separate controls. Browser and Android lifecycle rules may suspend camera capture when the display is backgrounded.

## Android Companion

Install/run from `services/vivo/android-companion/`. The app opens `https://carltheghost.github.io/matumbo-living-reality-demo/services/vivo/web/` and only injects its message bridge at `https://carltheghost.github.io`. Navigation to other hosts opens outside the WebView; file/content URLs and cleartext traffic are disabled.

Use **Capabilities** to select individual tools. Camera and notification grants also require Android's runtime permission. The optional accessibility path requires both the app kill-switch and the Android Accessibility settings switch. Turning the app switch off immediately removes accessibility tools, even if Android still has the service enabled.

The MediaProjection action asks Android for its system consent and then opens the device Cast settings hook. This companion does not capture a display, establish a Cast SDK session, or claim a TV route is connected. Use Android's system screen-mirroring/cast UI, and confirm whether the device/browser keeps its local camera track alive when that UI takes focus.

## Build and test

Run web tests with:

```sh
node --test services/vivo/web/phone/tests/*.test.mjs
```

Run Android unit tests and an app build with Gradle 8.11.1, JDK 17, and Android SDK Platform 35:

```sh
cd services/vivo/android-companion
gradle testDebugUnitTest assembleDebug
```

The `Vivo phone stage` GitHub Actions workflow runs both jobs on pull requests and on the named work branch. It has no Pages deployment job.

## Known device-dependent limits

- Physical camera permission prompts, GPU/CPU inference speed, two-hand occlusion, torch sharing with camera capture, Android volume behavior, notification delivery, document providers, sensor availability, and accessibility actions require device checks.
- ScreenProjection permission is a hook only. Actual TV, projector, or glasses routing is provided by Android/system/browser support and is not established by this repository.
- Browser policies may stop or throttle camera frames when the page loses foreground visibility. `Hands-free Projection` keeps the web capture session requested across the route change, but the OS/browser remains authoritative.
- The Android build and WebView bridge need a physical device or emulator for runtime acceptance; CI cannot validate OEM casting or camera behavior.
