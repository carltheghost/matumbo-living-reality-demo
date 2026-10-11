"""Verify the Full Studio bridge fails closed for a material-owned world.

The backend remains the final authority. This browser check confirms the
capability reason is visible, the canonical button is disabled, and a forced
bridge call still leaves accepted and local state unchanged.
"""

import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8768/local/"
REPORT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("browser-studio-authority-material.json")


async def main():
    page_errors = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            context = await browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
            await context.add_init_script("""
                window.__vivoCameraCalls = 0;
                if (navigator.mediaDevices) {
                  navigator.mediaDevices.getUserMedia = (...args) => {
                    window.__vivoCameraCalls++;
                    return Promise.reject(new Error('browser material smoke camera gate'));
                  };
                }
            """)
            page = await context.new_page()
            page.on("pageerror", lambda error: page_errors.append({"message": str(error)}))
            await page.goto(BASE.rstrip("/") + "/?vivoAuthority=1&seat=one", wait_until="domcontentloaded", timeout=60000)
            status = page.locator("#vivoStudioAuthorityBridge [data-vivo-authority-status]")
            await status.wait_for(state="visible", timeout=20000)
            for _ in range(200):
                if await status.inner_text() == "CONNECTED":
                    break
                await asyncio.sleep(0.1)
            else:
                raise AssertionError(await page.locator("#vivoStudioAuthorityBridge [data-vivo-authority-message]").inner_text())
            before = await page.evaluate("window.__vivoStudioAuthorityBridge.debug()")
            capability = before["canonicalCommitCapability"]
            assert capability["allowed"] is False
            assert capability["rejectionCode"] == "STUDIO_MATERIAL_BOUNDARY"
            assert "driver-authoritative" in capability["reason"]
            assert await page.locator("[data-vivo-authority-commit]").is_disabled()
            rejected = await page.evaluate("window.__vivoStudioAuthorityBridge.commitCanonical()")
            assert rejected["status"] == "rejected"
            assert rejected["code"] == "STUDIO_MATERIAL_BOUNDARY"
            assert "driver-authoritative" in rejected["reason"]
            after = await page.evaluate("window.__vivoStudioAuthorityBridge.debug()")
            assert after["acceptedEntityQ"] == before["acceptedEntityQ"]
            assert after["acceptedEntityRevision"] == before["acceptedEntityRevision"]
            assert after["localProjection"] == before["localProjection"]
            camera_calls = await page.evaluate("window.__vivoCameraCalls")
            evidence = {"capability": capability, "rejected": rejected, "before": before,
                        "after": after, "cameraCalls": camera_calls, "pageErrors": page_errors,
                        "physicalDeviceValidated": False}
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
