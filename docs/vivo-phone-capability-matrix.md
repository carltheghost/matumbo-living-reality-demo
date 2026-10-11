# Viva phone capability matrix

Tools are listed only after the in-app capability grant and any required Android runtime/device state pass `CapabilityBroker`. Android and vendor behavior can still reject an operation at use time; every native agent invocation is audited without storing its arguments.

| Capability | Agent tool(s) | App grant | Android/device gate | Scope / fallback |
| --- | --- | --- | --- | --- |
| Camera | `phone.camera.start`, `phone.camera.stop` | Camera | Camera runtime permission and WebView video-capture request | Frames stay in browser memory and the local Worker. Camera button remains available in the Pages UI. |
| Torch | `phone.torch.set` | Torch | Camera permission, rear camera flash hardware | Can fail while the camera owns the sensor. Browser touch controls remain available. |
| Vibration / haptics | `phone.haptics` | Haptics | Vibrator hardware | Short 35 ms confirmation. |
| Brightness | `phone.brightness` | Brightness | App window | Changes only Vivo's app-window brightness, not the Android system brightness. |
| Volume | `phone.volume` | Volume | Android media stream | Changes media stream level; user/device policy applies. |
| Clipboard | `phone.clipboard.write` | Clipboard write | Clipboard service | Write-only tool; clipboard contents are not returned to agents or logged. |
| Share | `phone.share` | Share | Android Sharesheet handler | User chooses the destination. |
| Notifications | `phone.notifications` | Notifications | Android 13+ notification runtime permission | Creates the Vivo channel on first use. |
| File picker / document access | `phone.files.open` | Files | User selects via Storage Access Framework | Returns selected name, MIME type, and up to 2 MiB encoded content to the caller; larger files are rejected. No broad storage permission. |
| Screen projection / MediaProjection / casting | `phone.projection` | Projection | Android MediaProjection consent dialog and available Cast settings | Consent-and-routing hook only. No display capture, Cast SDK connection, or connected-route claim. |
| Orientation sensors | `phone.sensors.orientation` | Sensors | Rotation-vector sensor | Read only while the capability is active and the Activity is foregrounded. |
| Accessibility tap / scroll | `phone.accessibility.tap`, `phone.accessibility.scroll` | Accessibility | Explicit app switch and Android Accessibility settings | Gesture dispatch; Android can refuse or redirect actions. |
| Accessibility text input | `phone.accessibility.text` | Accessibility | Explicit app switch and Android Accessibility settings | Focused editable non-password field only; input limited to 2,000 characters and never returned/logged. |
| Navigation / app switching | `phone.navigation` | Accessibility | Explicit app switch and Android Accessibility settings | Back, Home, Recents. System policy decides what is allowed. |

The accessibility service does not expose a screen-tree read tool. It does not inspect or return node text. Password-like focused fields are refused before text input. The app's **Agent UI: off** kill-switch removes all accessibility tools immediately; Android settings can independently revoke the service.
