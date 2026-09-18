# PERSON Ω — Persistent Embodiment

**Identity persists. Motion flows. Appearance changes only by choice.**

The user supplied the avatar/companion specification and subsequently provided multiple visual-reference image sets. The images are design targets, not rigged assets. A stylized humanoid, personal room, architectural cube plinth and companion have now been built as actual Three.js geometry. They are not reference screenshots used as a background, and they are not a verified or photorealistic likeness.

## Current Person-room implementation

Open the local development route `http://127.0.0.1:8081/?feature=person` while the existing preview server is running.

- `src/render/person-studio-scene.js` builds the room and articulated humanoid in the application's existing Three.js scene. Individual fingers are modeled; finger tracking and finger-joint animation are not implemented here.
- `src/domains/person-studio.js` owns explicit avatar approval, local save/restore, four colorways of one outfit, three room themes and three companion forms. These choices do not imply purchased clothing, a shared account or a connected AI service.
- The approved asset fingerprint includes actual deterministic bind-pose geometry and transforms. It excludes UUIDs, animation and device shadow quality, and is identical in desktop and compact builds. A geometry mismatch on reload is rejected without overwriting the saved profile.
- Approval and saved preferences use this browser's local storage. Exports contain local profile data; no authenticated cross-device synchronization is supplied.
- Head and arm sliders drive manual pose input. Motion cannot edit the identity record or wardrobe version. Missing motion eases toward rest.
- Orbit dragging is separated from click selection by a pointer-release movement threshold. Room/wardrobe controls, recentering, hide-controls mode and existing feature routes are mounted.
- The Person browser audit uses an isolated test profile, not the user's saved avatar. Its receipt and screenshots are in `work/person-studio-audit.json`, `work/person-studio-desktop.png` and `work/person-studio-mobile.png`.

The audit proves only the enumerated checks in its receipt. A desktop browser resized to a phone viewport is not a physical-phone or headset test. The full Node suite includes many other domain and boundary tests; its pass count is not evidence that the complete ecosystem is released.

## Implemented domain foundation

`src/domains/avatar-embodiment.js` separates immutable approved asset identity, versioned wardrobe authority, temporary motion, and per-world projection transforms. No webcam frame is accepted as identity data.

- Approval records stable person/avatar IDs, rig and asset references, asset SHA-256 and approval time. A digest identifies the approved record; it is not a biometric identity or authentication proof.
- Motion writers receive only `pushPose` and `samplePose`. Appearance/identity fields in motion packets are rejected. Sensor code cannot receive an appearance mutation capability through this interface.
- Canonical named quaternion joints support head, torso, limbs, hands and explicit finger joints. Per-source sequence checks reject old samples while allowing device changes. Sensor adapters must normalize their coordinate conventions before submitting poses.
- Each missing joint decays independently through hold/rest. Valid head updates cannot preserve an occluded hand indefinitely. No human geometry is reconstructed after loss.
- LOCKED denies world wardrobe changes. CONTEXTUAL requires a separate user-confirmed action. OPEN can use only an already-approved preset for the matching world.
- Appearance transactions create versions and bounded history. Multiple projections reference the same person/avatar IDs.
- Persistent snapshot export/restore retains identity, wardrobe and projection transforms, checks record integrity, and omits transient camera motion.
- A structured contribution adapter exposes the approved person reference and disabled authentication capability. The Person room and read-only session carry approved-avatar references; this is not an authenticated global identity service.

Tests cover motion/identity isolation, explicit appearance changes, prohibited world overrides, source switching, stale/invalid samples, independent hand loss, snapshot integrity, exact restore and common identity across projections.

## Required next implementation

1. Higher-fidelity, user-approved likeness modeling and consent-based enrollment. The current stylized model is not an exact likeness or biometric verification.
2. Production humanoid skinning, blendshapes, finger articulation, IK, garment assets and LOD. The current articulated procedural model does not implement these complete systems.
3. Pose adapters for webcam/phone/XR, confidence-aware smoothing, normalized coordinates, safe reset/recalibration and facial expression/lip synchronization. Ordinary webcams do not provide guaranteed gaze or full-body tracking.
4. Explicit user storage controls and authenticated multi-device persistence. The export/restore codec does not by itself provide login, cloud storage or cross-device identity.
5. Modular outfit assets attached to rig anchors, approved contextual presets, accessory history and reversible changes. Marketplace ownership requires its own verified backend; appearance is not ownership evidence.
6. Authenticated multiplayer: identity/asset references plus compact bounded pose/expression packets, interpolation and voice transport. Do not upload raw camera video when avatar mode was chosen. Never fall back to raw video if tracking fails.
7. Stable companion identity with context-dependent embodiment, user-selected appearance and semantic selection context. Companion entity relationships and actions must be governed, not decorative labels or silent authority.
8. End-to-end tests across dark rooms, occlusion, changed physical clothes, leaving the frame, phone/webcam switching, headset changes and network interruption. Appearance hash/version must remain unchanged without an explicit appearance action.

## Deliberate limits

No realistic avatar, voice clone, full-body tracker, garment reconstruction, facial rig, cloth physics, shared avatar service or AI conversation has been claimed finished. No new biometric collection or remote image upload occurs. The existing camera preview is local and opt-in; group calls are not connected. The Person-room packet does not authorize publication, token/provider execution, commits or pushes during its bounded verification continuation.
