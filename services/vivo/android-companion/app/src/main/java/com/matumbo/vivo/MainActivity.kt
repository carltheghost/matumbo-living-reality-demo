package com.matumbo.vivo

import android.Manifest
import android.app.AlertDialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.util.Base64
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

/** WebView shell for the canonical GitHub Pages Vivo UI. The web world remains the product UI. */
class MainActivity : ComponentActivity(), SensorEventListener {
    private lateinit var webView: WebView
    private lateinit var statusView: TextView
    private lateinit var accessibilityButton: Button
    private lateinit var audit: AuditLog
    private lateinit var broker: CapabilityBroker
    private lateinit var sensors: SensorManager
    private var latestOrientation = JSONObject()
    private var sensorListening = false
    private var cameraPermissionDismissed = false
    private var notificationPermissionDismissed = false
    private var pendingBrowserCamera: PermissionRequest? = null
    private var pendingNotification: NativePending? = null
    private var pendingFile: NativePending? = null
    private var pendingProjection: NativePending? = null
    private val asyncPageActions = mutableMapOf<String, JavaScriptReplyProxy>()
    private val asyncPageActionNames = mutableMapOf<String, String>()
    private var lastReplyProxy: JavaScriptReplyProxy? = null
    private var torchCameraId: String? = null

    private data class NativePending(val id: String, val proxy: JavaScriptReplyProxy, val args: JSONObject)

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        cameraPermissionDismissed = !granted
        audit.record("android.permission.camera.${if (granted) "granted" else "denied"}", "camera", granted)
        pendingBrowserCamera?.let { request ->
            pendingBrowserCamera = null
            if (granted && "camera" in rawGrants()) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
        }
        updateStatus(); publishTools()
        requestMissingSelectedPermission()
    }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        notificationPermissionDismissed = !granted
        audit.record("android.permission.notifications.${if (granted) "granted" else "denied"}", "notifications", granted)
        val pending = pendingNotification; pendingNotification = null
        if (pending != null) {
            if (granted) runCatching { postNotification(pending) }.onFailure { reject(pending.id, pending.proxy, "Notification could not be posted", "notifications", "phone.notifications") }
            else reject(pending.id, pending.proxy, "Notification permission denied", "notifications", "phone.notifications")
        }
        updateStatus(); publishTools(); requestMissingSelectedPermission()
    }
    private val documentPicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val pending = pendingFile; pendingFile = null
        if (pending == null) return@registerForActivityResult
        if (uri == null) { reject(pending.id, pending.proxy, "Document selection cancelled", "files", "phone.files.open"); return@registerForActivityResult }
        runCatching { readDocument(uri) }
            .onSuccess { value -> audit.record("phone.files.open", "files", true); respond(pending.id, pending.proxy, true, value) }
            .onFailure { error -> reject(pending.id, pending.proxy, error.message ?: "Could not read selected document", "files", "phone.files.open") }
    }
    private val projectionConsent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val pending = pendingProjection; pendingProjection = null
        if (pending == null) return@registerForActivityResult
        if (result.resultCode != RESULT_OK || result.data == null) {
            reject(pending.id, pending.proxy, "Screen projection was not approved", "projection", "phone.projection")
        } else {
            audit.record("phone.projection", "projection", true)
            val route = castSettingsRoute()
            respond(pending.id, pending.proxy, true, JSONObject()
                .put("route", route)
                .put("consent", "granted").put("castConnected", false).put("framesUploaded", false))
            Handler(Looper.getMainLooper()).postDelayed({ openCastSettings() }, 450)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        audit = AuditLog(this)
        broker = CapabilityBroker(this)
        sensors = getSystemService(SENSOR_SERVICE) as SensorManager
        buildShell()
        configureWebView()
        webView.loadUrl(PAGES_URL)
        updateStatus()
    }

    private fun buildShell() {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(0xff111418.toInt()) }
        val title = TextView(this).apply {
            text = "VIVO COMPANION  ·  GitHub Pages UI"
            setTextColor(0xffc8fff4.toInt()); textSize = 14f; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(7), dp(14), 0)
        }
        statusView = TextView(this).apply { textSize = 11f; setTextColor(0xffb8c1ca.toInt()); setPadding(dp(14), dp(2), dp(14), dp(4)) }
        val controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        controls.addView(button("Capabilities", ::manageCapabilities), weightedParams())
        accessibilityButton = button("Agent UI: off", ::manageAccessibility)
        controls.addView(accessibilityButton, weightedParams())
        controls.addView(button("Audit", ::showAudit), weightedParams())
        root.addView(title)
        root.addView(statusView)
        root.addView(controls)
        webView = WebView(this)
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
    }

    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label; textSize = 11f; isAllCaps = false; setPadding(dp(2), 0, dp(2), 0); setOnClickListener { action() }
    }
    private fun weightedParams() = LinearLayout.LayoutParams(0, dp(44), 1f)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).roundToInt()

    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) safeBrowsingEnabled = true
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return true
                if (isTrustedVivoUrl(uri)) return false
                if (uri.scheme == "https" || uri.scheme == "http") runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                return true
            }
            override fun onReceivedSslError(view: WebView?, handler: android.webkit.SslErrorHandler?, error: android.net.http.SslError?) { handler?.cancel() }
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                if (url != null && !isTrustedVivoUrl(Uri.parse(url))) view?.stopLoading()
                super.onPageStarted(view, url, favicon)
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                val uri = url?.let { runCatching { Uri.parse(it) }.getOrNull() } ?: return
                val canonicalPage = uri.path == PAGES_PATH_PREFIX || uri.path == PAGES_PATH_PREFIX + "index.html"
                if (!canonicalPage || !isTrustedVivoUrl(uri)) return
                view?.evaluateJavascript(
                    "(async()=>{await import(new URL('phone/bootstrap.mjs',location.href).href)})().catch(error=>console.error('Vivo phone stage failed',error));",
                    null
                )
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val originAllowed = request.origin.scheme == "https" && request.origin.host == PAGES_HOST && webView.url?.let { runCatching { isTrustedVivoUrl(Uri.parse(it)) }.getOrDefault(false) } == true
                    val videoOnly = request.resources.size == 1 && request.resources[0] == PermissionRequest.RESOURCE_VIDEO_CAPTURE
                    if (!originAllowed || !videoOnly || "camera" !in rawGrants()) { request.deny(); return@runOnUiThread }
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    } else {
                        pendingBrowserCamera?.deny()
                        pendingBrowserCamera = request
                        cameraPermission.launch(Manifest.permission.CAMERA)
                    }
                }
            }
            override fun onPermissionRequestCanceled(request: PermissionRequest) { if (pendingBrowserCamera === request) pendingBrowserCamera = null }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "VivoPhone", setOf("https://$PAGES_HOST")) { _, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy ->
                if (!isMainFrame || sourceOrigin.scheme != "https" || sourceOrigin.host != PAGES_HOST || webView.url?.let { runCatching { isTrustedVivoUrl(Uri.parse(it)) }.getOrDefault(false) } != true) return@addWebMessageListener
                lastReplyProxy = replyProxy
                receiveBridgeMessage(message.data ?: return@addWebMessageListener, replyProxy)
            }
        } else updateStatus("This Android System WebView lacks WebMessageListener; native capabilities are unavailable.")
    }

    private fun receiveBridgeMessage(raw: String, proxy: JavaScriptReplyProxy) {
        if (raw.length > 32_768) return
        val message = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val id = message.optString("id", "")
        if (id.length > 128) return
        when (message.optString("kind")) {
            "hello" -> sendTools(id, proxy)
            "tools.list" -> respond(id, proxy, true, toolSnapshot())
            "async-result" -> {
                val original = asyncPageActions.remove(id) ?: return
                val name = asyncPageActionNames.remove(id) ?: "phone.camera.start"
                val ok = message.optBoolean("ok")
                if (ok) { audit.record(name, "camera", true); respond(id, original, true, message.opt("value") ?: JSONObject()) }
                else reject(id, original, message.optString("error", "Page-side action failed"), "camera", name)
            }
            "tool.invoke" -> invokeTool(id, proxy, message.optString("name"), message.optJSONObject("args") ?: JSONObject())
            else -> if (id.isNotBlank()) reject(id, proxy, "Unsupported Android bridge message", "bridge")
        }
    }

    private fun sendTools(id: String, proxy: JavaScriptReplyProxy) {
        val snapshot = toolSnapshot()
        proxy.postMessage(JSONObject().put("id", id).put("kind", "tools")
            .put("tools", snapshot.optJSONArray("tools") ?: JSONArray())
            .put("capabilities", snapshot.optJSONArray("capabilities") ?: JSONArray()).toString())
    }

    private fun toolSnapshot(): JSONObject {
        val grants = effectiveGrants()
        val ready = accessibilityReady()
        val tools = JSONArray()
        CapabilityPolicy.visibleTools(grants, ready).forEach { tools.put(JSONObject().put("name", it.name).put("capability", it.capability).put("description", it.description)) }
        return JSONObject().put("tools", tools).put("capabilities", JSONArray(grants.toList()))
            .put("accessibility", JSONObject().put("enabled", ready).put("userSwitch", prefs().getBoolean(KEY_ACCESSIBILITY_ENABLED, false)))
    }

    private fun invokeTool(id: String, proxy: JavaScriptReplyProxy, name: String, args: JSONObject) {
        val tool = CapabilityPolicy.tools.firstOrNull { it.name == name }
        if (tool == null || !broker.permits(name, accessibilityReady())) {
            reject(id, proxy, "Tool not granted or not available on this device", tool?.capability ?: "unknown", name); publishTools(); return
        }
        try {
            when (name) {
                "phone.camera.start", "phone.camera.stop" -> dispatchPageAction(id, proxy, name, args)
                "phone.torch.set" -> withCameraPermission(id, proxy, name, args)
                "phone.haptics" -> { val vibrator = vibrator(); if (!vibrator.hasVibrator()) throw IllegalStateException("No vibrator available"); vibrateShort(vibrator); accept(id, proxy, name, tool.capability, JSONObject().put("played", true)) }
                "phone.brightness" -> { val level = args.optDouble("level", -1.0); if (level !in 0.0..1.0) throw IllegalArgumentException("Brightness must be from 0 to 1"); window.attributes = window.attributes.apply { screenBrightness = level.toFloat() }; accept(id, proxy, name, tool.capability, JSONObject().put("level", level)) }
                "phone.volume" -> { val level = args.optDouble("level", -1.0); if (level !in 0.0..1.0) throw IllegalArgumentException("Volume must be from 0 to 1"); val audio = getSystemService(AUDIO_SERVICE) as AudioManager; val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC); val next = (max * level).roundToInt().coerceIn(0, max); audio.setStreamVolume(AudioManager.STREAM_MUSIC, next, 0); accept(id, proxy, name, tool.capability, JSONObject().put("level", next.toDouble() / max.coerceAtLeast(1))) }
                "phone.clipboard.write" -> { val text = args.optString("text", ""); if (text.length > 20_000) throw IllegalArgumentException("Clipboard text is too long"); val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager; clipboard.setPrimaryClip(ClipData.newPlainText("Vivo", text)); accept(id, proxy, name, tool.capability, JSONObject().put("written", true)) }
                "phone.share" -> { val text = args.optString("text", ""); if (text.length > 20_000) throw IllegalArgumentException("Share text is too long"); startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Share with")); accept(id, proxy, name, tool.capability, JSONObject().put("opened", true)) }
                "phone.notifications" -> requestNotification(id, proxy, args)
                "phone.files.open" -> { pendingFile = NativePending(id, proxy, args); documentPicker.launch(arrayOf(args.optString("mimeType", "*/*").takeIf(::validMime) ?: "*/*")) }
                "phone.projection" -> requestProjection(id, proxy)
                "phone.sensors.orientation" -> { startSensors(); accept(id, proxy, name, tool.capability, JSONObject(latestOrientation.toString())) }
                "phone.accessibility.tap", "phone.accessibility.scroll", "phone.accessibility.text", "phone.navigation" -> {
                    val service = VivoAccessibilityService.instance ?: throw IllegalStateException("AccessibilityService is not connected")
                    val result = service.perform(name, args)
                    respond(id, proxy, result.optBoolean("accepted"), result)
                }
            }
        } catch (error: Exception) { reject(id, proxy, error.message ?: "Android capability failed", tool.capability, name) }
    }

    private fun dispatchPageAction(id: String, proxy: JavaScriptReplyProxy, name: String, args: JSONObject) {
        asyncPageActions[id] = proxy
        asyncPageActionNames[id] = name
        proxy.postMessage(JSONObject().put("kind", "agent-action").put("id", id).put("name", name).put("args", args).toString())
    }

    private fun withCameraPermission(id: String, proxy: JavaScriptReplyProxy, name: String, args: JSONObject) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) throw SecurityException("Android Camera permission is not granted. Enable Camera in Capabilities first.")
        val manager = getSystemService(CAMERA_SERVICE) as CameraManager
        val cameraId = manager.cameraIdList.firstOrNull { manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK && manager.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
            ?: throw IllegalStateException("This device has no rear torch")
        val enabled = args.optBoolean("enabled", true)
        manager.setTorchMode(cameraId, enabled); torchCameraId = cameraId
        accept(id, proxy, name, "torch", JSONObject().put("enabled", enabled))
    }

    private fun requestNotification(id: String, proxy: JavaScriptReplyProxy, args: JSONObject) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            pendingNotification = NativePending(id, proxy, args); notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS); return
        }
        postNotification(NativePending(id, proxy, args))
    }

    private fun postNotification(pending: NativePending) {
        val title = pending.args.optString("title", "Vivo").take(80)
        val body = pending.args.optString("body", "Vivo needs your attention.").take(240)
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(NOTIFICATION_CHANNEL, "Vivo updates", NotificationManager.IMPORTANCE_DEFAULT))
        val notification = notificationBuilder()
        notification.setSmallIcon(android.R.drawable.ic_menu_view).setContentTitle(title).setContentText(body).setAutoCancel(true)
        manager.notify((System.currentTimeMillis() and 0x7fffffff).toInt(), notification.build())
        accept(pending.id, pending.proxy, "phone.notifications", "notifications", JSONObject().put("posted", true))
    }

    private fun requestProjection(id: String, proxy: JavaScriptReplyProxy) {
        pendingProjection = NativePending(id, proxy, JSONObject())
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projectionConsent.launch(manager.createScreenCaptureIntent())
    }

    private fun castSettingsRoute(): String = when {
        Intent("android.settings.CAST_SETTINGS").resolveActivity(packageManager) != null -> "android-cast-settings-hook"
        Intent(Settings.ACTION_DISPLAY_SETTINGS).resolveActivity(packageManager) != null -> "android-display-settings-hook"
        else -> "media-projection-consent-hook"
    }
    private fun openCastSettings() {
        val cast = Intent("android.settings.CAST_SETTINGS")
        if (cast.resolveActivity(packageManager) != null) { runCatching { startActivity(cast) }; return }
        val display = Intent(Settings.ACTION_DISPLAY_SETTINGS)
        if (display.resolveActivity(packageManager) != null) runCatching { startActivity(display) }
    }

    private fun readDocument(uri: Uri): JSONObject {
        val maxBytes = 2 * 1024 * 1024
        val output = ByteArrayOutputStream()
        contentResolver.openInputStream(uri)?.use { input ->
            val buffer = ByteArray(8192)
            while (true) { val count = input.read(buffer); if (count < 0) break; if (output.size() + count > maxBytes) throw IllegalArgumentException("Selected document exceeds 2 MiB limit"); output.write(buffer, 0, count) }
        } ?: throw IllegalStateException("Could not open selected document")
        val name = contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null } ?: "document"
        return JSONObject().put("name", name.take(240)).put("mimeType", contentResolver.getType(uri) ?: "application/octet-stream")
            .put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP))
    }

    private fun validMime(value: String) = value.matches(Regex("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+*-]+"))
    @Suppress("DEPRECATION")
    private fun vibrator(): Vibrator = if (Build.VERSION.SDK_INT >= 31) (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator else getSystemService(VIBRATOR_SERVICE) as Vibrator
    private fun vibrateShort(vibrator: Vibrator) {
        if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createOneShot(35, VibrationEffect.DEFAULT_AMPLITUDE))
        else vibrator.vibrate(35)
    }
    @Suppress("DEPRECATION")
    private fun notificationBuilder(): android.app.Notification.Builder = if (Build.VERSION.SDK_INT >= 26) android.app.Notification.Builder(this, NOTIFICATION_CHANNEL) else android.app.Notification.Builder(this)

    private fun accept(id: String, proxy: JavaScriptReplyProxy, name: String, capability: String, value: JSONObject) {
        audit.record(name, capability, true); respond(id, proxy, true, value); publishTools()
    }
    private fun reject(id: String, proxy: JavaScriptReplyProxy, reason: String, capability: String, actionName: String = "request.rejected") {
        audit.record(actionName, capability, false); respond(id, proxy, false, reason); publishTools()
    }
    private fun respond(id: String, proxy: JavaScriptReplyProxy, ok: Boolean, value: Any) {
        val payload = if (ok) value else if (value is JSONObject) value.optString("message", "Android capability request failed") else value.toString()
        proxy.postMessage(JSONObject().put("id", id).put("ok", ok).put(if (ok) "value" else "error", payload).toString())
    }
    private fun publishTools() { lastReplyProxy?.let { sendTools("", it) } }

    private fun manageCapabilities() {
        val labels = CapabilityPolicy.selectable.map { it.second }.toTypedArray()
        val keys = CapabilityPolicy.selectable.map { it.first }
        val current = rawGrants()
        val checked = BooleanArray(keys.size) { keys[it] in current }
        val next = current.toMutableSet()
        AlertDialog.Builder(this).setTitle("Agent capability grants")
            .setMessage("Only checked capabilities are exposed as native tools. Android may ask separately when a tool uses a protected capability.")
            .setMultiChoiceItems(labels, checked) { _, index, isChecked -> if (isChecked) next.add(keys[index]) else next.remove(keys[index]) }
            .setPositiveButton("Save grants") { _, _ ->
                cameraPermissionDismissed = false; notificationPermissionDismissed = false
                val removed = current - next
                val added = next - current
                removed.forEach { audit.record("capability.revoke", it, true) }
                added.forEach { audit.record("capability.grant", it, true) }
                saveGrants(next); updateStatus(); publishTools(); requestMissingSelectedPermission()
                if ("sensors" !in next && sensorListening) { sensors.unregisterListener(this); sensorListening = false }
                if ("accessibility" in next && prefs().getBoolean(KEY_ACCESSIBILITY_ENABLED, false) && !VivoAccessibilityService.isEnabledInSystemSettings(this)) openAccessibilitySettings()
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun manageAccessibility() {
        val enabled = prefs().getBoolean(KEY_ACCESSIBILITY_ENABLED, false)
        AlertDialog.Builder(this).setTitle("Optional agent UI control")
            .setMessage("This Android AccessibilityService can tap, scroll, enter text into a focused non-password field, and use Back, Home, or Recents. It never returns screen text, refuses password fields, and records actions without text values. Enablement is separate from the Android service switch; turn it off here to revoke agent actions immediately.")
            .setPositiveButton(if (enabled) "Revoke agent UI control" else "Enable agent UI control") { _, _ ->
                val next = !enabled
                prefs().edit().putBoolean(KEY_ACCESSIBILITY_ENABLED, next).apply()
                audit.record(if (next) "accessibility.enable-requested" else "accessibility.kill-switch", "accessibility", true)
                if (next && "accessibility" in rawGrants() && !VivoAccessibilityService.isEnabledInSystemSettings(this)) openAccessibilitySettings()
                updateStatus(); publishTools()
            }
            .setNeutralButton("Open Android Accessibility settings") { _, _ -> openAccessibilitySettings() }
            .setNegativeButton("Close", null).show()
    }

    private fun openAccessibilitySettings() {
        runCatching { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            .onFailure { updateStatus("Open Android Settings → Accessibility to enable Vivo agent UI control.") }
    }

    private fun showAudit() {
        val rows = audit.recent(100)
        val lines = (0 until rows.length()).map { i -> rows.getJSONObject(i).let { "${it.optLong("time")}  ${it.optString("outcome")}  ${it.optString("name")}  [${it.optString("capability")}]" } }
        AlertDialog.Builder(this).setTitle("Agent action audit · latest ${lines.size}")
            .setMessage(if (lines.isEmpty()) "No capability actions have been recorded." else lines.joinToString("\n"))
            .setNeutralButton("Export full audit") { _, _ ->
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_TEXT, audit.all().toString(2)), "Export audit log"))
            }
            .setPositiveButton("Close", null).show()
    }

    private fun prefs() = getSharedPreferences(VivoAccessibilityService.PREFS, MODE_PRIVATE)
    private fun isTrustedVivoUrl(uri: Uri) = uri.scheme == "https" && uri.host == PAGES_HOST && uri.path?.startsWith(PAGES_PATH_PREFIX) == true
    private fun rawGrants(): Set<String> = broker.requestedGrants()
    private fun saveGrants(value: Set<String>) = broker.saveGrants(value)
    private fun effectiveGrants(): Set<String> = broker.effectiveGrants(accessibilityReady())
    private fun accessibilityReady() = "accessibility" in rawGrants() && prefs().getBoolean(KEY_ACCESSIBILITY_ENABLED, false) && VivoAccessibilityService.isEnabledInSystemSettings(this) && VivoAccessibilityService.instance != null

    private fun requestMissingSelectedPermission() {
        if (("camera" in rawGrants() || "torch" in rawGrants()) && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED && pendingBrowserCamera == null && !cameraPermissionDismissed) {
            cameraPermission.launch(Manifest.permission.CAMERA); return
        }
        if (Build.VERSION.SDK_INT >= 33 && "notifications" in rawGrants() && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && pendingNotification == null && !notificationPermissionDismissed) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun updateStatus(override: String? = null) {
        val grants = effectiveGrants().size
        val accessibility = when {
            accessibilityReady() -> "Agent UI enabled"
            "accessibility" in rawGrants() && VivoAccessibilityService.isEnabledInSystemSettings(this) -> "Accessibility service on · agent switch off"
            prefs().getBoolean(KEY_ACCESSIBILITY_ENABLED, false) -> "Agent UI switch on · Android service not enabled"
            else -> "Agent UI off"
        }
        statusView.text = override ?: "$grants native tool grants · $accessibility · camera frames stay on this device"
        if (::accessibilityButton.isInitialized) accessibilityButton.text = when {
            accessibilityReady() -> "Agent UI: on"
            prefs().getBoolean(KEY_ACCESSIBILITY_ENABLED, false) -> "Agent UI: setup"
            else -> "Agent UI: off"
        }
    }

    private fun startSensors() {
        if (sensorListening || "sensors" !in effectiveGrants()) return
        val sensor = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) ?: return
        sensorListening = sensors.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ROTATION_VECTOR || "sensors" !in effectiveGrants()) return
        val matrix = FloatArray(9); val angles = FloatArray(3)
        SensorManager.getRotationMatrixFromVector(matrix, event.values); SensorManager.getOrientation(matrix, angles)
        latestOrientation = JSONObject().put("azimuth", Math.toDegrees(angles[0].toDouble())).put("pitch", Math.toDegrees(angles[1].toDouble())).put("roll", Math.toDegrees(angles[2].toDouble()))
        lastReplyProxy?.postMessage(JSONObject().put("kind", "event").put("name", "orientation").put("value", latestOrientation).toString())
    }
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    override fun onResume() {
        super.onResume(); webView.onResume(); webView.resumeTimers()
        if ("sensors" in effectiveGrants()) startSensors()
        updateStatus(); publishTools()
    }
    override fun onPause() {
        if (sensorListening) { sensors.unregisterListener(this); sensorListening = false }
        webView.onPause(); super.onPause()
    }
    override fun onDestroy() { webView.stopLoading(); webView.destroy(); audit.close(); super.onDestroy() }

    companion object {
        const val PAGES_HOST = "carltheghost.github.io"
        const val PAGES_PATH_PREFIX = "/matumbo-living-reality-demo/services/vivo/web/"
        const val PAGES_URL = "https://carltheghost.github.io/matumbo-living-reality-demo/services/vivo/web/"
        const val KEY_GRANTS = VivoAccessibilityService.KEY_GRANTS
        const val KEY_ACCESSIBILITY_ENABLED = VivoAccessibilityService.KEY_ACCESSIBILITY_ENABLED
        const val NOTIFICATION_CHANNEL = "vivo-agent"
    }
}

