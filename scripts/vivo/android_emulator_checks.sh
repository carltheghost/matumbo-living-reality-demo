#!/usr/bin/env bash
# One process: the emulator action executes separate script lines in separate shells.
# Collect diagnostics BEFORE the action tears its emulator down. Never wait forever.
set -uo pipefail
mkdir -p android-evidence
adb shell svc wifi disable
adb shell svc data disable
adb shell dumpsys webviewupdate > android-evidence/webview-provider.txt
adb shell dumpsys connectivity > android-evidence/emulator-connectivity.txt
set +e
gradle --no-daemon -p services/vivo/android-companion connectedDebugAndroidTest 2>&1 | tee android-evidence/instrumentation.log
result=${PIPESTATUS[0]}
timeout 10s adb logcat -d -t 4000 > android-evidence/emulator-logcat.txt 2>&1
timeout 10s adb pull /sdcard/Android/data/com.matumbo.vivo/files/android-evidence android-evidence/phone-ui
exit "$result"
