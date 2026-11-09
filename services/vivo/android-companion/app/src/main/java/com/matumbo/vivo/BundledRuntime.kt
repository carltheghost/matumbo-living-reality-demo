package com.matumbo.vivo

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream

/** Serve only packaged public assets at the SAME origin as the original companion. */
class BundledRuntime(private val context: Context) {
    fun intercept(uri: Uri): WebResourceResponse? {
        val path = NavigationPolicy.assetPath(uri.toString()) ?: return null
        // API requests are never answered with an HTML fallback or fabricated acceptance.
        if (path.startsWith("api/") || path.startsWith("ws") || path in setOf("readyz", "healthz")) return null
        return try {
            val stream = context.assets.open("vivo/$path")
            WebResourceResponse(mime(path), if (path.endsWith(".wasm") || path.endsWith(".task")) null else "UTF-8", stream).apply {
                responseHeaders = mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")
            }
        } catch (_: java.io.IOException) {
            WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", mapOf("Cache-Control" to "no-store"),
                ByteArrayInputStream("This file is not in the installed Vivo build.".toByteArray()))
        }
    }
    private fun mime(path: String): String = when (path.substringAfterLast('.').lowercase()) {
        "mjs", "js" -> "text/javascript"
        "html" -> "text/html"
        "css" -> "text/css"
        "json" -> "application/json"
        "webmanifest" -> "application/manifest+json"
        "wasm" -> "application/wasm"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "woff2" -> "font/woff2"
        "txt" -> "text/plain"
        else -> "application/octet-stream"
    }
}
