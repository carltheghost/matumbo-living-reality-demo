# Physical-phone acceptance checklist

Run on at least one current Pixel-class Android device and one non-Pixel/OEM device. Record device model, Android version, System WebView version, network state, and result for each item.

## Canonical UI and local engine

- [ ] Companion opens the GitHub Pages Vivo UI over HTTPS at the expected repo path; there is no second native renderer.
- [ ] Local mode opens without creating a room or connecting to the Viva API/WebSocket.
- [ ] Move the same object across `x1` through `x4`; verify its stable ID and other coordinates.
- [ ] Enter and exit the nested 11D world; verify the same Eye returns to the same root location.
- [ ] Create a second Eye and verify changing its slice/zoom/rotation does not alter the first Eye.
- [ ] Force-stop and reopen; verify IndexedDB keeps the world ID, object IDs, and Eyes.
- [ ] Install the offline shell, enable airplane mode, reopen local mode, and verify the world works. Confirm API/shared-room actions report offline.

## Camera and hand tracking

- [ ] Camera remains off until the user starts it. Deny permission and verify touch controls still work.
- [ ] Grant camera and show one hand: all five fingers and 21 landmarks render, with finger-tip indicators.
- [ ] Show left and right hands together; verify two stable hand IDs and all 21 landmarks per hand.
- [ ] Cross hands, swap sides, partially occlude one hand, remove it and return it; check ID stability and release behavior.
- [ ] Try point-select, open-then-pinch grab, fist/open release, peace overview toggle, thumbs-up axis cycle, open-hand swipe selection, and two-hand zoom/roll.
- [ ] Repeat in dim and bright light; note inference delegate, frame age, missed landmarks, heat, and battery use.
- [ ] Capture a network trace during tracking; confirm no video frames or landmark arrays are uploaded. Confirm no video is written to Cache Storage or IndexedDB.
- [ ] Start TV/projector casting via the OS hook while the camera is running. Record whether Android keeps the app foregrounded and whether the browser camera track remains `live`.

## Capability broker

- [ ] Start with no capability grants and confirm the native agent tool list is empty.
- [ ] Grant each tool separately; confirm only matching tools appear. Revoke each grant and confirm it disappears without reload.
- [ ] Exercise torch, haptics, app brightness, media volume, clipboard write, Sharesheet, notifications, document picker, and orientation sensor.
- [ ] Confirm no broad storage permission is requested, document contents are bounded to 2 MiB, and clipboard contents are never returned.
- [ ] Export the audit log. Verify accepted/rejected action names and times are present, while text, clipboard contents, file data, coordinates, and other arguments are absent.

## Optional AccessibilityService

- [ ] Verify the tool stays absent by default. Turn on the app switch, enable the named service in Android Accessibility settings, and confirm the status is visible.
- [ ] Test tap, scroll, Back, Home, Recents, and text entry in a safe non-password test app.
- [ ] Focus password, numeric-password, and web-password fields; verify text input is rejected and no password value enters the audit.
- [ ] Turn off **Agent UI** while Android's service remains enabled; confirm all accessibility tools disappear and requests fail immediately.
- [ ] Revoke the service in Android settings and confirm the companion status updates and tools remain unavailable.

## OS and device variants

- [ ] Android 13+: test notification permission accept/deny and revoked state.
- [ ] Android 14+: inspect per-session MediaProjection consent and cancel/accept flows.
- [ ] Test a device without a rotation-vector sensor, flash, or WebGPU; confirm unsupported tools are hidden or return a safe fallback.
- [ ] Test Android's screen-reader/large-font settings and ensure controls and permission explanations remain usable.
