from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9877/"
REPORT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("phone-engine-smoke.json")


async def wait_ready(page, timeout=20):
    end = asyncio.get_running_loop().time() + timeout
    last = ""
    while asyncio.get_running_loop().time() < end:
        last = await page.locator("#vivoPhoneEngineState").inner_text()
        if "READY" in last:
            return last
        await asyncio.sleep(.1)
    raise AssertionError(f"phone engine readiness timeout: {last!r}")


async def main():
    checks = []
    def check(name, condition, details=None):
        checks.append({"name": name, "passed": bool(condition), "details": details})
        if not condition:
            raise AssertionError(f"{name}: {details}")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = await browser.new_context()
        page = await context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            await page.goto(BASE + "field-lab-studio.html", wait_until="domcontentloaded", timeout=60000)
            state_text = await wait_ready(page)
            check("phone engine panel boots", "READY" in state_text, state_text)

            caps = await page.evaluate("() => window.VivoPhoneEngine.capabilities()")
            check("dimensions 3 through 11", caps["dimensions"] == list(range(3, 12)), caps["dimensions"])
            check("separate simulation time", caps["timeSeparate"] is True)
            check("worker sparse compute", caps["compute"] == "worker-sparse", caps["compute"])
            check("IndexedDB persistence", caps["storage"] == "IndexedDB", caps["storage"])
            check("camera frame upload disabled", caps["cameraFramesUploaded"] is False)
            check("explicit XR capability surface", caps["xr"]["schema"] == "vivo.xr-capabilities/1", caps["xr"])
            check("XR cannot claim physical validation", caps["xr"]["physicalValidation"] is False, caps["xr"])
            check("XR frame upload disabled", caps["xr"]["cameraFramesUploaded"] is False, caps["xr"])

            before = await page.evaluate("() => window.VivoPhoneEngine.state.nodes[0].q[3]")
            await page.evaluate("() => window.VivoPhoneEngine.constraint(0,[0,0,0,1])")
            end = asyncio.get_running_loop().time() + 5
            moved = before
            while asyncio.get_running_loop().time() < end:
                moved = await page.evaluate("() => window.VivoPhoneEngine.state.nodes[0].q[3]")
                if moved > before + 1e-5:
                    break
                await asyncio.sleep(.05)
            check("x4 local sparse material moves", moved > before + 1e-5, {"before": before, "after": moved})
            await page.evaluate("() => window.VivoPhoneEngine.release(0)")

            agent = await page.evaluate("""async () => {
              return await window.VivoPhoneEngine.runAgent('device.guardian',{});
            }""")
            check("bounded local agent ran", len(agent["trace"]) >= 1 and agent["trace"][0]["tool"] == "device.info", agent)

            saved = await page.evaluate("""async () => {
              const cp=await window.VivoPhoneEngine.checkpoint();
              return cp.state.nodes[0].q[3];
            }""")
            check("checkpoint stores moved x4", saved > before + 1e-5, saved)

            await page.reload(wait_until="domcontentloaded")
            await wait_ready(page)
            end = asyncio.get_running_loop().time() + 5
            restored = 0
            while asyncio.get_running_loop().time() < end:
                restored = await page.evaluate("() => window.VivoPhoneEngine.state.nodes[0].q[3]")
                if restored > before + 1e-5:
                    break
                await asyncio.sleep(.05)
            check("IndexedDB state restores after reload", restored > before + 1e-5, {"saved": saved, "restored": restored})
            check("no uncaught page errors", not errors, errors)

            report = {
                "schema": "vivo.phone-engine-browser-smoke/1",
                "passed": sum(1 for c in checks if c["passed"]),
                "failed": sum(1 for c in checks if not c["passed"]),
                "checks": checks,
                "pageErrors": errors,
                "physicalDeviceValidated": False,
                "nativeCompanionValidated": False,
            }
            REPORT.write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps(report, indent=2))
        finally:
            await context.close()
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
