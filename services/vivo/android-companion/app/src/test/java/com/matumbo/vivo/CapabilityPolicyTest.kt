package com.matumbo.vivo

import org.junit.Assert.*
import org.junit.Test

class CapabilityPolicyTest {
    @Test fun onlyExplicitCapabilitiesAppearInAgentToolCatalog() {
        val granted = setOf("camera", "share")
        val names = CapabilityPolicy.visibleTools(granted, accessibilityReady = false).map { it.name }.toSet()
        assertEquals(setOf("phone.camera.start", "phone.camera.stop", "phone.share"), names)
        assertFalse(CapabilityPolicy.permits("phone.clipboard.write", granted, false))
    }

    @Test fun accessibilityNeedsBothAppGrantAndEnabledService() {
        val grant = setOf("accessibility")
        assertTrue(CapabilityPolicy.visibleTools(grant, accessibilityReady = true).isNotEmpty())
        assertTrue(CapabilityPolicy.visibleTools(grant, accessibilityReady = false).isEmpty())
        assertFalse(CapabilityPolicy.permits("phone.navigation", emptySet(), true))
    }

    @Test fun passwordTextIsNeverEligibleAndInputIsBounded() {
        assertFalse(CapabilityPolicy.canSetText(true, passwordField = true, text = "secret"))
        assertFalse(CapabilityPolicy.canSetText(true, passwordField = false, text = "x".repeat(2001)))
        assertTrue(CapabilityPolicy.canSetText(true, passwordField = false, text = "hello"))
        assertFalse(CapabilityPolicy.canSetText(false, passwordField = false, text = "hello"))
    }
}
