"""Mounted Full Studio journal-capacity and write-race regression.

The server is started with a deliberately small retained-event budget.  The
test fills the journal to the cleanup reserve, verifies that both Studio write
controls are disabled, then races a projection publish against the final
accepted observer write.  The rejected publish and canonical commit must settle
as structured results without changing the accepted binding/entity or local
Studio projection.

This is synthetic Chromium loopback evidence.  It does not certify a physical
camera, hand, head, phone, headset, AR, or VR device.
"""

import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8769/local/"
REPORT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("browser-studio-authority-capacity.json")


async def wait_connected(page):
    status = page.locator("#vivoStudioAuthorityBridge [data-vivo-authority-status]")
    await status.wait_for(state="visible", timeout=20000)
    for _ in range(200):
        if await status.inner_text() == "CONNECTED":
            return
        await asyncio.sleep(0.1)
    raise AssertionError(await page.locator("#vivoStudioAuthorityBridge [data-vivo-authority-message]").inner_text())


async def main():
    page_errors = []
    camera_calls = 0
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            context = await browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
            await context.add_init_script("""
                window.__vivoCameraCalls = 0;
                if (navigator.mediaDevices) {
                  navigator.mediaDevices.getUserMedia = (...args) => {
                    window.__vivoCameraCalls++;
                    return Promise.reject(new Error('browser capacity smoke camera gate'));
                  };
                }
            """)
            page = await context.new_page()
            page.on("pageerror", lambda error: page_errors.append({"message": str(error)}))
            await page.goto(BASE.rstrip("/") + "/?vivoAuthority=1&seat=one", wait_until="domcontentloaded", timeout=60000)
            await wait_connected(page)

            prepared = await page.evaluate("""
                async () => {
                  const bridge = window.__vivoStudioAuthorityBridge;
                  while (!bridge.state.journal.readOnly && bridge.state.journal.remainingEvents > 1) {
                    const eye = structuredClone(bridge.state.eye);
                    eye.q[0] += 0.01;
                    eye.slice.x1 = eye.q[0];
                    await bridge.transport.moveEye(eye, eye.revision);
                  }
                  window.FieldApp.engine.q[55 * 9] = 3.2;
                  return bridge.debug();
                }
            """)
            assert prepared["journal"]["readOnly"] is False, prepared
            assert prepared["journal"]["remainingEvents"] == 1, prepared
            assert prepared["localDiverged"] is True, prepared

            raced_publish = await page.evaluate("""
                async () => {
                  const bridge = window.__vivoStudioAuthorityBridge;
                  const originalSubmit = bridge.transport.submit.bind(bridge.transport);
                  let raced = false;
                  bridge.transport.submit = async command => {
                    if (!raced && command.kind === 'studio.transform') {
                      raced = true;
                      const eye = structuredClone(bridge.state.eye);
                      eye.q[0] += 0.01;
                      eye.slice.x1 = eye.q[0];
                      await bridge.transport.moveEye(eye, eye.revision);
                    }
                    return originalSubmit(command);
                  };
                  return bridge.publish();
                }
            """)
            assert raced_publish["status"] == "rejected", raced_publish
            assert raced_publish["code"] == "JOURNAL_BACKPRESSURE", raced_publish
            assert "read-only" in raced_publish["reason"], raced_publish

            after_race = await page.evaluate("window.__vivoStudioAuthorityBridge.debug()")
            assert after_race["journal"]["readOnly"] is True, after_race
            assert after_race["acceptedEntityQ"] == prepared["acceptedEntityQ"]
            assert after_race["acceptedEntityRevision"] == prepared["acceptedEntityRevision"]
            assert after_race["binding"] == prepared["binding"]
            assert after_race["localProjection"] == prepared["localProjection"]
            assert after_race["publishResult"]["code"] == "JOURNAL_BACKPRESSURE"
            assert await page.locator("[data-vivo-authority-publish]").is_disabled()
            assert await page.locator("[data-vivo-authority-commit]").is_disabled()

            canonical = await page.evaluate("window.__vivoStudioAuthorityBridge.commitCanonical()")
            assert canonical["status"] == "rejected", canonical
            assert canonical["code"] == "JOURNAL_BACKPRESSURE", canonical
            assert "read-only" in canonical["reason"], canonical
            settled = await page.evaluate("window.__vivoStudioAuthorityBridge.debug()")
            assert settled["canonicalCommitResult"]["code"] == "JOURNAL_BACKPRESSURE"
            capability_text = await page.locator("[data-vivo-authority-capability]").inner_text()
            assert ".." not in capability_text, capability_text
            camera_calls = await page.evaluate("window.__vivoCameraCalls")
            evidence = {"schema": "vivo.browser-studio-authority-capacity/1",
                        "physicalDeviceValidated": False, "cameraCalls": camera_calls,
                        "pageErrors": page_errors, "prepared": prepared,
                        "racedPublish": raced_publish, "afterRace": after_race,
                        "canonical": canonical, "settled": settled}
        finally:
            try:
                await page.evaluate("window.__vivoStudioAuthorityBridge.close()")
            except Exception:
                pass
            await browser.close()
    assert camera_calls == 0, camera_calls
    assert not page_errors, page_errors
    REPORT.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
