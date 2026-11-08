package com.matumbo.vivo

import org.junit.Assert.*
import org.junit.Test

class NavigationPolicyTest {
    private val root = "https://carltheghost.github.io/matumbo-living-reality-demo/services/vivo/web/"
    @Test fun originalOriginAndCanonicalEntryAreRetained() {
        assertTrue(NavigationPolicy.trusted(NavigationPolicy.ENTRY))
        assertEquals(root + "phone/field-lab.html", NavigationPolicy.ENTRY)
        assertTrue(NavigationPolicy.trusted(root + "phone/index.html"))
    }
    @Test fun onlyExplicitHttpsHostAndPortAreTrusted() {
        for (url in listOf(root.replace("https:", "http:"), root.replace(".io/", ".io:8443/"), root.replace(".io/", ".io.evil.test/"), "https://user@carltheghost.github.io${NavigationPolicy.PREFIX}")) {
            assertFalse(url, NavigationPolicy.trusted(url))
        }
        assertTrue(NavigationPolicy.trusted(root.replace(".io/", ".io:443/")))
    }
    @Test fun traversalAndEncodedSeparatorsNeverBecomeAssetPaths() {
        for (path in listOf("../index.html", "phone/../../index.html", "%2e%2e/index.html", "phone%2f../a", "phone/./index.html", "phone/%252e%252e/index.html", "phone\\index.html")) {
            assertFalse(path, NavigationPolicy.trusted(root + path))
            assertNull(NavigationPolicy.assetPath(root + path))
        }
    }
    @Test fun relatedSiteIsNotGrantedTheNativeBridge() {
        assertFalse(NavigationPolicy.trusted(NavigationPolicy.LIVE_WORLD))
        assertFalse(NavigationPolicy.trustedOrigin(NavigationPolicy.LIVE_WORLD))
        assertTrue(NavigationPolicy.safeExternal(NavigationPolicy.LIVE_WORLD))
    }
    @Test fun queriesAndFragmentsDoNotChangeAnAssetPath() {
        assertEquals("phone/index.html", NavigationPolicy.assetPath(root + "phone/?next=https://evil.test#state"))
        assertEquals("index.html", NavigationPolicy.assetPath(root))
        assertEquals("phone/engine-worker.mjs", NavigationPolicy.assetPath(root + "phone/engine-worker.mjs?v=30"))
    }
    @Test fun arbitrarySchemesAndCredentialsCannotLaunchAnExternalIntent() {
        for (url in listOf("javascript:alert(1)", "file:///sdcard/world", "content://files/1", "intent://evil", "http://example.test", "https://user:pass@example.test/", "https://example.test:8080/"))
            assertFalse(url, NavigationPolicy.safeExternal(url))
    }
    @Test fun originPolicyRejectsSpoofedOriginsAndUnknownPorts() {
        assertTrue(NavigationPolicy.trustedOrigin("https://carltheghost.github.io"))
        for (url in listOf("https://carltheghost.github.io.evil.test", "http://carltheghost.github.io", "https://carltheghost.github.io:81", "https://user@carltheghost.github.io"))
            assertFalse(url, NavigationPolicy.trustedOrigin(url))
    }
    @Test fun unrelatedGithubPagesPathsAreNotNativeAuthority() {
        assertFalse(NavigationPolicy.trusted("https://carltheghost.github.io/other/index.html"))
        assertFalse(NavigationPolicy.trusted(root.removeSuffix("/")))
    }
    @Test fun malformedAndOversizedUrlsFailClosed() {
        for (url in listOf(null, "", "not a URL", root + "x".repeat(9000), "https://[bad]")) {
            assertFalse(NavigationPolicy.trusted(url)); assertFalse(NavigationPolicy.safeExternal(url))
        }
    }
    @Test fun bundledSourceDoesNotRelyOnAUserSelectedFile() {
        assertFalse(NavigationPolicy.ENTRY.contains("file:"))
        assertEquals("phone/field-lab.html", NavigationPolicy.assetPath(NavigationPolicy.ENTRY))
    }
}
