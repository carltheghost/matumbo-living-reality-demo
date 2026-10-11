package com.matumbo.vivo

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Bundle
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject

/** Optional cross-app UI control. No node text is read, returned, or written to the audit. */
class VivoAccessibilityService : AccessibilityService() {
    private lateinit var audit: AuditLog
    override fun onServiceConnected() { super.onServiceConnected(); audit = AuditLog(this); instance = this }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit
    override fun onDestroy() { if (instance === this) instance = null; super.onDestroy() }

    private fun enabledByUser(): Boolean {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val grants = prefs.getStringSet(KEY_GRANTS, emptySet()).orEmpty()
        return prefs.getBoolean(KEY_ACCESSIBILITY_ENABLED, false) && "accessibility" in grants && isEnabledInSystemSettings()
    }

    fun perform(name: String, args: JSONObject): JSONObject {
        if (!enabledByUser()) return reject(name, "accessibility", "Accessibility agent control is disabled or revoked")
        val success = try {
            when (name) {
                "phone.accessibility.tap" -> gesture(args, scroll = false)
                "phone.accessibility.scroll" -> gesture(args, scroll = true)
                "phone.accessibility.text" -> setFocusedText(args.optString("text", ""))
                "phone.navigation" -> navigate(args.optString("action", "back"))
                else -> false
            }
        } catch (_: Exception) { false }
        audit.record(name, "accessibility", success)
        return if (success) JSONObject().put("accepted", true) else JSONObject().put("accepted", false).put("error", "Action unavailable; target content and input are not returned")
    }

    private fun gesture(args: JSONObject, scroll: Boolean): Boolean {
        val metrics = resources.displayMetrics
        val x = args.optDouble("x", metrics.widthPixels / 2.0).toFloat().coerceIn(1f, (metrics.widthPixels - 1).coerceAtLeast(2).toFloat())
        val y = args.optDouble("y", metrics.heightPixels / 2.0).toFloat().coerceIn(1f, (metrics.heightPixels - 1).coerceAtLeast(2).toFloat())
        val path = Path().apply {
            if (!scroll) moveTo(x, y)
            else {
                val distance = (metrics.heightPixels * 0.23f).coerceAtLeast(80f)
                val sign = if (args.optString("direction", "down") == "up") 1f else -1f
                moveTo(x, (y - sign * distance).coerceIn(1f, (metrics.heightPixels - 1).toFloat()))
                lineTo(x, (y + sign * distance).coerceIn(1f, (metrics.heightPixels - 1).toFloat()))
            }
        }
        val duration = if (scroll) 360L else 70L
        val stroke = GestureDescription.StrokeDescription(path, 0, duration)
        return dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    private fun setFocusedText(text: String): Boolean {
        if (text.length > 2000) return false
        val root = rootInActiveWindow ?: return false
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        val inputType = focused.inputType
        val password = focused.isPassword ||
            (inputType and 0x80) == 0x80 || (inputType and 0x10) == 0x10 ||
            (inputType and 0x1000) == 0x1000 || (inputType and 0x2000) == 0x2000
        if (!CapabilityPolicy.canSetText(enabledByUser(), password, text) || !focused.isEditable) return false
        return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) })
    }

    private fun navigate(action: String): Boolean {
        val globalAction = when (action) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents", "switch" -> GLOBAL_ACTION_RECENTS
            else -> return false
        }
        return performGlobalAction(globalAction)
    }

    private fun reject(name: String, capability: String, reason: String): JSONObject {
        if (::audit.isInitialized) audit.record(name, capability, false)
        return JSONObject().put("accepted", false).put("error", reason)
    }

    companion object {
        const val PREFS = "vivo-companion"
        const val KEY_GRANTS = "capability-grants"
        const val KEY_ACCESSIBILITY_ENABLED = "accessibility-agent-enabled"
        @Volatile var instance: VivoAccessibilityService? = null
        fun isEnabledInSystemSettings(context: android.content.Context? = instance): Boolean {
            if (context == null) return false
            val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
            val expected = android.content.ComponentName(context, VivoAccessibilityService::class.java)
            return enabled.split(':').mapNotNull { android.content.ComponentName.unflattenFromString(it) }.any { it == expected }
        }
    }
}
