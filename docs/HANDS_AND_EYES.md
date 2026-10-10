# Hands & eyes

Reality Lens accepts ordinary RGB cameras: a laptop camera, a USB webcam, and front or rear phone cameras exposed by the browser. It also accepts local video files. The camera stays off until you press **Start camera**. Selecting a source or opening the controls does not grant camera access.

## Start with hands

1. Open **Hands & eyes** in the Home header. The same controls are available from Gesture Lens and the Phone Gestures panel.
2. Leave **Hands** selected. Choose the default camera, **Refresh cameras** to discover available devices, or **Rear camera** on a phone. Rear selection requests a rear-facing camera explicitly; if the device cannot supply one, choose an available camera instead.
3. Press **Start camera**, then accept the browser's camera permission. Check the preview and the status. “Ready” describes the detector; the separate hand count tells you whether it sees a hand.
4. Choose **Use controls in the world**. Open your hand first, point with your index finger, then pinch thumb and index finger together and release over the target. The cursor names the object you are pointing at.
5. Choose **Arrange objects** to move an unlocked object. Keep pinching while moving. Add a second pinched hand to resize and roll it. Release to save the layout change. Losing the hand, changing the source, hiding the page or pressing Escape cancels the preview.
6. Use the persistent **Stop** control to release the camera and both detectors. Closing the settings drawer keeps tracking active, with its camera indicator visible.

Original object controls remain authoritative. Mesh picking respects actual silhouettes and empty torus centers. Hand pinches reach the same UV controls used by a mouse or touch, including the existing ink and game interfaces. Locked objects and recorded history cannot be edited. Home layout is saved in this browser; feature transforms follow the existing session-local Reality Timeline and its history export. **View → Reset Home layout** restores the authored Home positions.

Hand navigation also reaches the original Home and space breadcrumbs, Back, previous/next object pages, and Spaces catalog. Pinch **View** or **Text/Object view** to change presentation. Only these registered navigation controls accept camera input; unrelated overlays remain obstructions.

## Add eyes

Enable **Eyes** while using the same live camera, then press **Calibrate gaze**. Hands and eyes share one video source. No second camera is acquired.

Look at each light while keeping your head comfortably still. Press Space or tap Capture while continuing to look at the light. Nine targets fit your screen mapping; five different targets check it. Each capture requires fresh, stable eye samples, and each new target includes a settling interval. Cancel with Escape.

A successful check enables the gaze pointer. **Look, then pinch** uses gaze to aim and a deliberate hand pinch to confirm. Once held, the hand controls movement, so looking elsewhere does not teleport an object. **Gaze navigation** is optional: looking steadily for 1.8 seconds opens a navigation target. It does not submit feature commands or activate provider actions. Look away before repeating a dwell action.

Calibration reports root-mean-square and worst error from the five withheld check targets in normalized screen coordinates. Acceptance requires RMS error no greater than 0.10 and worst error no greater than 0.18, along with sufficient target coverage and a nondegenerate fit. These are setup measurements, not a clinical measurement or a guarantee of everyday accuracy. A failed check leaves the gaze pointer disabled. Try steadier framing and more even lighting, then recalibrate.

Closed eyes, a missing face, a second detected face, stale frames and unsuitable eye/head geometry remove the pointer. Changing camera, mirror setting, video dimensions, viewport or screen orientation requires a new calibration. Calibration samples and coefficients stay in memory and are cleared when tracking stops.

## Local video

Choose **Local video file**, select a browser-supported video, and start playback. Pause, resume and natural end are handled by the same source owner. Files are not uploaded. Temporary Blob URLs and decoders are released on stop, replacement, end and destruction.

Recorded gestures are observations until **Let this video control objects** is explicitly selected. That choice resets on source replacement. Eye landmarks can be inspected from a recording, but live screen-gaze calibration requires a camera: the person in a recording cannot respond to the calibration lights.

## Phone access and troubleshooting

- A phone needs a reachable **HTTPS** site. `http://127.0.0.1:8082` refers to the device opening it; on a phone it is not this PC. An ordinary LAN HTTP URL can be rejected for camera access.
- GitHub Pages can serve the browser app, local workers and model files after the branch is published. It cannot run the optional PC GPT bridge. The current published main branch and this working branch are separate releases.
- Camera denied: allow camera access in browser/site settings, then retry. Camera busy: close the other app using it. No rear camera: use the available camera selector.
- Model unavailable: reload the page and check that the local `.mjs`, `.wasm` and `.task` files are present. GPU initialization falls back to CPU. A browser without worker video input has a slower, explicitly reported hand CPU path.
- Eye detection without a usable calibration is not gaze control. Pointer and touch remain available throughout setup or failures.

## Implementation and verification boundaries

The app vendors `@mediapipe/tasks-vision` 1.0.1 and version-1 hand/face model bundles. [Asset provenance and SHA256 hashes](../assets/models/vision/provenance.json) accompany the files. `py -3 scripts/provision_vision.py` reproduces them with npm SHA512 verification and pinned asset checks; it does not run package scripts. Models and workers load from the app's own origin when enabled.

Actual production-worker checks have detected 21 hand landmarks from decoded local video and 478 face landmarks from the official public portrait fixture. A moving video marker verified fresh decoded content while the settings panel was hidden. Separate synthetic tests exercise calibration, object navigation, transforms, cancellation and original UV actions. These checks do not establish recognition or gaze accuracy on Tumbo's physical laptop, USB camera or phone. No physical camera was accessed during automated verification.

Sources: [Google Hand Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js), [Google Face Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js), [Google's distinction between iris tracking and gaze](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/), and [browser camera requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
