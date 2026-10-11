from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8769/"
REPORT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("device-check-smoke.json")


async def main():
    errors = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            await page.goto(BASE + "device-check", wait_until="domcontentloaded", timeout=60000)
            assert "NO CAMERA FRAMES UPLOADED" in await page.locator("#privacy").inner_text()
            assert await page.locator("#staticChecks .check").count() >= 6
            await page.click("#network")
            deadline = asyncio.get_running_loop().time() + 10
            network_text = ""
            while asyncio.get_running_loop().time() < deadline:
                network_text = await page.locator("#networkState").inner_text()
                if "5/5" in network_text:
                    break
                await asyncio.sleep(0.1)
            else:
                raise AssertionError(f"network check timeout: {network_text!r}")
            deadline = asyncio.get_running_loop().time() + 5
            summary = json.loads(await page.locator("#summary").inner_text())
            while not summary.get("releaseIdentityVerified") and asyncio.get_running_loop().time() < deadline:
                await asyncio.sleep(0.1)
                summary = json.loads(await page.locator("#summary").inner_text())
            assert summary["releaseIdentityVerified"] is True, summary
            assert summary["testedOrigin"] == BASE.rstrip("/"), summary
            # Mouse click must not become physical-touch evidence.
            await page.click("#touchTarget")
            summary = json.loads(await page.locator("#summary").inner_text())
            assert summary["physicalTouch"] is False, summary
            assert summary["physicalDeviceValidated"] is False, summary
            assert summary["frontCameraProcessed"] is False, summary
            assert summary["rearCameraProcessed"] is False, summary
            assert summary["cameraFramesUploaded"] is False, summary
            verdict = await page.locator("#verdict").inner_text()
            assert verdict.startswith("PENDING"), verdict
            assert not errors, errors
            result = {
                "schema": "vivo.device-check-smoke/1",
                "passed": True,
                "physicalDeviceValidated": False,
                "cameraFramesUploaded": False,
                "pageErrors": errors,
                "summary": summary,
            }
            REPORT.write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps(result, indent=2))
        finally:
            await context.close()
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
