package com.matumbo.vivo

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Actual Android WebView, worker, IndexedDB and original runtime. No fake engine. */
@RunWith(AndroidJUnit4::class)
class OfflineRuntimeTest {
    private fun js(scenario: ActivityScenario<MainActivity>, source: String): String {
        val latch = CountDownLatch(1); var result = "null"
        scenario.onActivity { activity -> activity.findViewById<WebView>(R.id.vivo_web).evaluateJavascript(source) { value -> result = value; latch.countDown() } }
        assertTrue("WebView callback timed out", latch.await(10, TimeUnit.SECONDS))
        return result
    }
    private fun waitFor(scenario: ActivityScenario<MainActivity>, label: String, expression: String, seconds: Long = 45) {
        val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        while (System.nanoTime() < end) {
            if (js(scenario, "Boolean($expression)") == "true") return
            Thread.sleep(150)
        }
        fail("$label: " + js(scenario, "JSON.stringify({title:document.title,body:document.body.innerText.slice(0,1800),error:window.__androidTestError})"))
    }
    private fun enter(scenario: ActivityScenario<MainActivity>, dimension: Int = 4) {
        waitFor(scenario, "Canonical bundled page", "document.getElementById('enterPhoneLocal')")
        js(scenario, "document.getElementById('createD').value='$dimension';document.getElementById('enterPhoneLocal').click();true")
        waitFor(scenario, "Native worker ready", "window.VivaPhoneEngine?.active")
    }
    private fun snapshot(scenario: ActivityScenario<MainActivity>): JSONObject {
        js(scenario, "window.__testSnapshot=null;window.__androidTestError=null;window.VivaPhoneEngine.snapshot().then(v=>window.__testSnapshot=v).catch(e=>window.__androidTestError=String(e));true")
        waitFor(scenario, "Snapshot returned", "window.__testSnapshot || window.__androidTestError")
        assertEquals("null", js(scenario, "window.__androidTestError"))
        val encoded = js(scenario, "JSON.stringify(window.__testSnapshot)")
        return JSONObject(org.json.JSONTokener(encoded).nextValue() as String)
    }
    @Test fun offlineColdStartLoadsOriginalRuntimeWithoutFilePicker() {
        ActivityScenario.launch(MainActivity::class.java).use { s ->
            enter(s)
            assertEquals("true", js(s, "location.origin==='https://carltheghost.github.io'"))
            assertEquals("true", js(s, "location.pathname.endsWith('/phone/field-lab.html')"))
            assertEquals("true", js(s, "!!window.VivaPhoneEngine.active && !document.body.innerText.includes('Choose original Field Lab')"))
            assertEquals("saved", snapshot(s).getJSONObject("persistence").getString("state"))
        }
    }
    @Test fun originalWorldAndEyeSurviveActivityRecreationWithEleventhAxisEdit() {
        ActivityScenario.launch(MainActivity::class.java).use { s ->
            waitFor(s, "Entry ready", "document.getElementById('enterPhoneLocal')")
            // Isolated test world inside the emulator's test installation only.
            js(s, "localStorage.setItem('vivo.phone.worldId','android.test.'+crypto.randomUUID());true")
            enter(s, 11)
            val before = snapshot(s)
            assertEquals(11, before.getJSONObject("snapshot").getJSONObject("spaces").getJSONObject("root").getInt("dimension"))
            val worldId = before.getJSONObject("snapshot").getString("worldId")
            val eye = before.getString("currentEyeId")
            val old = before.getJSONObject("snapshot").getJSONObject("spaces").getJSONObject("root").getJSONObject("entities").getJSONObject("relic").getJSONArray("q").getDouble(10)
            js(s, "window.__editDone=false;window.VivaPhoneEngine.applyLocalEdit('relic',Array.from({length:11},(_,i)=>i===10?.25:0)).then(()=>window.__editDone=true).catch(e=>window.__androidTestError=String(e));true")
            waitFor(s, "Accepted edit", "window.__editDone")
            val edited = snapshot(s)
            assertEquals(old + .25, edited.getJSONObject("snapshot").getJSONObject("spaces").getJSONObject("root").getJSONObject("entities").getJSONObject("relic").getJSONArray("q").getDouble(10), 1e-8)
            s.recreate()
            enter(s)
            val after = snapshot(s)
            assertEquals(worldId, after.getJSONObject("snapshot").getString("worldId"))
            assertEquals(eye, after.getString("currentEyeId"))
            assertEquals(before.getString("branchId"), after.getString("branchId"))
            assertEquals(old + .25, after.getJSONObject("snapshot").getJSONObject("spaces").getJSONObject("root").getJSONObject("entities").getJSONObject("relic").getJSONArray("q").getDouble(10), 1e-8)
        }
    }
    @Test fun noCameraPermissionOrNativeGrantsAreAddedOnStartup() {
        ActivityScenario.launch(MainActivity::class.java).use { s ->
            enter(s)
            val context = ApplicationProvider.getApplicationContext<Context>()
            assertNotEquals(PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.CAMERA))
            assertTrue(CapabilityBroker(context).requestedGrants().isEmpty())
            assertEquals("true", js(s, "typeof window.VivoPhone==='object' && !document.querySelector('video')?.srcObject"))
        }
    }
    @Test fun missingDocumentDisplaysRecoveryWithoutClearingSavedWorld() {
        ActivityScenario.launch(MainActivity::class.java).use { s ->
            enter(s); val before = snapshot(s).getJSONObject("snapshot").getString("worldId")
            s.onActivity { it.findViewById<WebView>(R.id.vivo_web).loadUrl("https://carltheghost.github.io${NavigationPolicy.PREFIX}not-shipped.html") }
            Thread.sleep(1000)
            s.onActivity { a ->
                assertNotNull(a.findViewById<android.view.View>(R.id.vivo_recovery))
                (a.findViewById<android.widget.LinearLayout>(R.id.vivo_recovery)).getChildAt(2).performClick()
            }
            enter(s)
            assertEquals(before, snapshot(s).getJSONObject("snapshot").getString("worldId"))
        }
    }
    @Test fun packagedManifestMatchesEntryAndListsRuntimeAssets() {
        val c = ApplicationProvider.getApplicationContext<Context>()
        val manifest = JSONObject(c.assets.open("vivo/android-bundle.json").bufferedReader().use { it.readText() })
        assertEquals("phone/field-lab.html", manifest.getString("entry"))
        assertTrue(manifest.getJSONArray("files").length() >= 80)
        for (file in listOf("phone/engine-worker.mjs", "phone/storage.mjs", "phone/index.html")) {
            assertTrue(c.assets.open("vivo/$file").use { it.read() } >= 0)
        }
    }
}
