"""Verify the canonical Studio commit after a durable server restart.

This is synthetic loopback Chromium evidence against the supported POSIX
checkpoint store. It does not certify a physical camera, hand, head, AR, or
VR device.
"""

import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8768/local/"
EXPECTED_ENTITY_Q0 = float(sys.argv[2]) if len(sys.argv) > 2 else 2.5
EXPECTED_ENTITY_REVISION = int(sys.argv[3]) if len(sys.argv) > 3 else 1
EXPECTED_BINDING_Q0 = float(sys.argv[4]) if len(sys.argv) > 4 else 2.8
EXPECTED_BINDING_REVISION = int(sys.argv[5]) if len(sys.argv) > 5 else 5
REPORT = Path(sys.argv[6]) if len(sys.argv) > 6 else Path("browser-studio-authority-restart.json")


async def wait_connected(page):
    status = page.locator("#vivoStudioAuthorityBridge [data-vivo-authority-status]")
    await status.wait_for(state="visible", timeout=20000)
    deadline = asyncio.get_running_loop().time() + 20
    while asyncio.get_running_loop().time() < deadline:
        if await status.inner_text() == "CONNECTED":
            return
        await asyncio.sleep(0.1)
    raise AssertionError(
        "Studio authority bridge did not connect after restart: "
        f"status={await status.inner_text()!r}, "
        f"message={await page.locator('#vivoStudioAuthorityBridge [data-vivo-authority-message]').inner_text()!r}"
    )


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
                    return Promise.reject(new Error('browser restart smoke camera gate'));
                  };
                }
            """)
            page = await context.new_page()
            page.on("pageerror", lambda error: page_errors.append({"message": str(error)}))
            await page.goto(BASE.rstrip("/") + "/?vivoAuthority=1&seat=one", wait_until="domcontentloaded", timeout=60000)
            await wait_connected(page)
            debug = await page.evaluate("window.__vivoStudioAuthorityBridge.debug()")
            assert debug["canonicalCommitCapability"]["allowed"] is True
            assert debug["acceptedEntityQ"] == [EXPECTED_ENTITY_Q0, -0.15, 0.25, 0]
            assert debug["acceptedEntityRevision"] == EXPECTED_ENTITY_REVISION
            assert debug["binding"]["q"][0] == EXPECTED_BINDING_Q0
            assert debug["binding"]["bindingRevision"] == EXPECTED_BINDING_REVISION
            assert debug["localProjection"][0] == EXPECTED_BINDING_Q0
            camera_calls = await page.evaluate("window.__vivoCameraCalls")
            evidence = {"debug": debug, "cameraCalls": camera_calls, "pageErrors": page_errors,
                        "physicalDeviceValidated": False, "durableRestartVerified": True}
        finally:
            await browser.close()
    assert camera_calls == 0, camera_calls
    assert not page_errors, page_errors
    REPORT.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
