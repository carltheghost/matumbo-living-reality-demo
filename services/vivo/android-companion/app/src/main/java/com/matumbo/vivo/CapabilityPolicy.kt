package com.matumbo.vivo

data class NativeTool(val name: String, val capability: String, val description: String)

object CapabilityPolicy {
    val selectable = listOf(
        "camera" to "Camera access", "torch" to "Torch", "haptics" to "Vibration / haptics",
        "brightness" to "App brightness", "volume" to "Media volume", "clipboard.write" to "Write clipboard",
        "share" to "Android share sheet", "notifications" to "Notifications", "files" to "Open user-selected documents",
        "projection" to "Projection / casting hooks", "sensors" to "Device orientation sensors",
        "accessibility" to "AccessibilityService actions",
    )

    val tools = listOf(
        NativeTool("phone.camera.start", "camera", "Start local camera hand tracking after Android permission."),
        NativeTool("phone.camera.stop", "camera", "Stop camera capture and release its track."),
        NativeTool("phone.torch.set", "torch", "Turn the rear phone torch on or off."),
        NativeTool("phone.haptics", "haptics", "Play a short haptic confirmation."),
        NativeTool("phone.brightness", "brightness", "Set app-window brightness from 0 to 1."),
        NativeTool("phone.volume", "volume", "Set media volume from 0 to 1."),
        NativeTool("phone.clipboard.write", "clipboard.write", "Write provided text to the system clipboard."),
        NativeTool("phone.share", "share", "Open Android Sharesheet with provided text."),
        NativeTool("phone.notifications", "notifications", "Post a Vivo notification after notification permission."),
        NativeTool("phone.files.open", "files", "Open a selected document; return up to 2 MiB to the requesting agent."),
        NativeTool("phone.projection", "projection", "Ask for screen-projection consent and open Android cast controls."),
        NativeTool("phone.sensors.orientation", "sensors", "Read device orientation while this capability is active."),
        NativeTool("phone.accessibility.tap", "accessibility", "Tap a screen coordinate using the optional service."),
        NativeTool("phone.accessibility.scroll", "accessibility", "Scroll the active UI using the optional service."),
        NativeTool("phone.accessibility.text", "accessibility", "Set text in a focused non-password input."),
        NativeTool("phone.navigation", "accessibility", "Use Android Back, Home, or Recents when permitted."),
    )

    fun visibleTools(granted: Set<String>, accessibilityReady: Boolean): List<NativeTool> =
        tools.filter { it.capability in granted && (it.capability != "accessibility" || accessibilityReady) }

    fun permits(name: String, granted: Set<String>, accessibilityReady: Boolean): Boolean =
        visibleTools(granted, accessibilityReady).any { it.name == name }

    fun safeAuditOutcome(success: Boolean): String = if (success) "accepted" else "rejected"

    fun canSetText(serviceEnabled: Boolean, passwordField: Boolean, text: String): Boolean =
        serviceEnabled && !passwordField && text.length <= 2000
}
