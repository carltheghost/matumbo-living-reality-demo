# Vivo Android Companion

This optional app displays the same GitHub-hosted Vivo page and adds native phone
capabilities that a normal browser page cannot own.

Available native tools are deliberately explicit and user-visible: device info,
haptics, app-window brightness, keep-awake, media volume, rear torch, HTTPS URL
open, Android sharing, Settings and Cast settings.

Interactive tools ask for session approval. Camera permission is delegated to
Android when the same-origin Vivo page requests video. Microphone is not granted.

This companion does not contain a generic shell, root escalation, arbitrary
cross-app UI automation or silent package installation. Those are not ordinary
web permissions.

Build:

```sh
gradle -p android/vivo-companion :app:testDebugUnitTest :app:assembleDebug
```
