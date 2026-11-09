package com.matumbo.vivo

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.webkit.WebView
import android.view.MotionEvent
import android.view.InputDevice
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileOutputStream
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
        assertTrue("WebView callback timed out", latch.await(30, TimeUnit.SECONDS))
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
        js(scenario, "window.__testSnapshot=null;window.__androidTestError=null;window.VivaPhoneEngine.snapshot().then(v=>{const root=v.snapshot.spaces.root;window.__testSnapshot={snapshot:{worldId:v.snapshot.worldId,acceptedSequence:v.snapshot.acceptedSequence,spaces:{root:{dimension:root.dimension,entities:Object.fromEntries(Object.entries(root.entities).map(([k,e])=>[k,{q:e.q,revision:e.revision}]))}}},currentEyeId:v.currentEyeId,branchId:v.branchId,persistence:v.persistence};}).catch(e=>window.__androidTestError=String(e));true")
        waitFor(scenario, "Snapshot returned", "window.__testSnapshot || window.__androidTestError")
        assertEquals("null", js(scenario, "window.__androidTestError"))
        val encoded = js(scenario, "JSON.stringify(window.__testSnapshot)")
        return JSONObject(org.json.JSONTokener(encoded).nextValue() as String)
    }
    private fun capture(name: String) {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val directory = File(context.getExternalFilesDir(null), "android-evidence").apply { mkdirs() }
        val image = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        if (image != null) FileOutputStream(File(directory, "$name.png")).use { image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }
    private fun tapElement(s: ActivityScenario<MainActivity>, id: String) {
        // Place the control inside its real scrolling sheet, not just a nonzero rect.
        js(s, "document.getElementById('$id').scrollIntoView({block:'center',inline:'center',behavior:'instant'});true")
        waitFor(s, "Touch target is unobscured", "(()=>{const e=document.getElementById('$id'),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return x>0&&y>0&&x<innerWidth&&y<innerHeight&&e.contains(document.elementFromPoint(x,y));})()")
        val encoded = js(s, "JSON.stringify((()=>{const r=document.getElementById('$id').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth}})())")
        val point = JSONObject(org.json.JSONTokener(encoded).nextValue() as String)
        var x=0f; var y=0f
        s.onActivity { a ->
            val view=a.findViewById<WebView>(R.id.vivo_web);val position=IntArray(2);view.getLocationOnScreen(position)
            val scale=view.width/point.getDouble("width")
            x=(position[0]+point.getDouble("x")*scale).toFloat();y=(position[1]+point.getDouble("y")*scale).toFloat()
        }
        val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
        val downTime=SystemClock.uptimeMillis()
        for (action in listOf(MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP)) {
            if (action == MotionEvent.ACTION_UP) SystemClock.sleep(80)
            val event=MotionEvent.obtain(downTime,SystemClock.uptimeMillis(),action,x,y,0)
            event.source=InputDevice.SOURCE_TOUCHSCREEN
            try { assertTrue("Android touchscreen injection",automation.injectInputEvent(event,true)) }
            finally { event.recycle() }
        }
    }
    @Test fun offlineColdStartLoadsOriginalRuntimeWithoutFilePicker() {
        ActivityScenario.launch(MainActivity::class.java).use { s ->
            enter(s)
            assertEquals("true", js(s, "location.origin==='https://carltheghost.github.io'"))
            assertEquals("true", js(s, "location.pathname.endsWith('/phone/field-lab.html')"))
            assertEquals("true", js(s, "!!window.VivaPhoneEngine.active && !document.body.innerText.includes('Choose original Field Lab')"))
            assertEquals("saved", snapshot(s).getJSONObject("persistence").getString("state"))
            capture("offline-world")
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
    @Test fun nativeAndroidTapRunsExistingObjectMovementControl() {
        ActivityScenario.launch(MainActivity::class.java).use { s ->
            enter(s)
            val before=snapshot(s)
            val old=before.getJSONObject("snapshot").getJSONObject("spaces").getJSONObject("root").getJSONObject("entities").getJSONObject("relic").getJSONArray("q").getDouble(3)
            js(s, "window.VivaPhoneEngine.select('relic');document.querySelector('[data-panel=move]').click();document.getElementById('moveAxis').value='3';true")
            waitFor(s,"Movement control visible","document.getElementById('axisPlus').getBoundingClientRect().width>0")
            capture("native-touch-target")
            tapElement(s,"axisPlus")
            // Poll accepted state already published by the real worker. Repeated full
            // snapshot/render requests can overwhelm a software-rendered emulator.
            waitFor(s,"Native touch published an accepted fourth-axis object edit",
                "(window.VivaPhoneEngine.publishedSnapshot()?.snapshot?.spaces?.root?.entities?.relic?.q?.[3] ?? $old) > ${old + .01}")
            val after=snapshot(s)
            val entity=after.getJSONObject("snapshot").getJSONObject("spaces").getJSONObject("root").getJSONObject("entities").getJSONObject("relic")
            assertTrue("Native touch produced an accepted fourth-axis object edit", entity.getJSONArray("q").getDouble(3)>old+.01)
            assertTrue("Accepted edit advances object revision",entity.getInt("revision")>before.getJSONObject("snapshot").getJSONObject("spaces").getJSONObject("root").getJSONObject("entities").getJSONObject("relic").getInt("revision"))
            capture("native-touch-movement")
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
