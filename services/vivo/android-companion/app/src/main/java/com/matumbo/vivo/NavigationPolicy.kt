package com.matumbo.vivo

import java.net.URI

/** No Android state: unit tested URL policy shared by document and native bridge checks. */
object NavigationPolicy {
    const val HOST = "carltheghost.github.io"
    const val PREFIX = "/matumbo-living-reality-demo/services/vivo/web/"
    const val ENTRY = "https://$HOST${PREFIX}phone/field-lab.html"
    const val LIVE_WORLD = "https://matumbo-fabric-omega-v2.tumbo.chatgpt.site/vivo/services/vivo/web/phone/"
    fun trusted(raw: String?): Boolean = runCatching {
        if (raw == null || raw.length > 8192) return false
        val uri = URI(raw)
        val path = uri.rawPath ?: return false
        uri.scheme == "https" && uri.host == HOST && uri.userInfo == null &&
            (uri.port == -1 || uri.port == 443) && path.startsWith(PREFIX) &&
            !path.contains('%') && !path.contains('\\') &&
            path.split('/').none { it == "." || it == ".." }
    }.getOrDefault(false)

    fun trustedOrigin(raw: String?): Boolean = runCatching {
        if (raw == null) return false
        val u = URI(raw)
        u.scheme == "https" && u.host == HOST && u.userInfo == null && (u.port == -1 || u.port == 443)
    }.getOrDefault(false)

    fun safeExternal(raw: String?): Boolean = runCatching {
        if (raw == null || raw.length > 8192) return false
        val u = URI(raw)
        u.scheme == "https" && !u.host.isNullOrBlank() && u.userInfo == null && (u.port == -1 || u.port == 443)
    }.getOrDefault(false)

    fun assetPath(raw: String?): String? {
        if (!trusted(raw)) return null
        val path = URI(raw).rawPath.removePrefix(PREFIX)
        return path + if (path.endsWith('/') || path.isEmpty()) "index.html" else ""
    }
}
