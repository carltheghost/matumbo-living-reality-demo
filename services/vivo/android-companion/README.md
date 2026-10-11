# Vivo Android Companion

The Companion opens the canonical GitHub Pages Vivo app in an Android WebView. It adds an explicit capability broker and local permission-gated tools around that page. It is not an alternate world renderer.

## Build

Requirements: JDK 17, Android SDK Platform 35, Gradle 8.11.1.

```sh
gradle testDebugUnitTest assembleDebug
```

The debug APK is written under `app/build/outputs/apk/debug/`. The app loads `https://carltheghost.github.io/matumbo-living-reality-demo/services/vivo/web/`; change the source constant only when the canonical Pages URL changes.

## Permissions and privacy

No capability is granted by default. Select capabilities in the app, then satisfy Android runtime and device gates. The optional AccessibilityService requires a second explicit in-app enable switch and Android's Accessibility settings switch. The app's kill-switch immediately stops agent actions and hides those tools.

Camera frames remain in WebView memory and a local Worker. The WebView bridge accepts messages only from the canonical GitHub Pages origin and the top frame. It rejects audio capture requests, local files, and non-HTTPS navigation. Agent action audit records omit all arguments, including typed text, clipboard contents, and document data.

Projection is a system-consent/cast-settings hook only. The app does not capture its display or implement a Cast receiver/session. See `docs/vivo-phone-capability-matrix.md` and `docs/vivo-phone-device-checklist.md` for behavior and device validation requirements.
