from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8769/"
OWNER_TOKEN = sys.argv[2] if len(sys.argv) > 2 else ""
REPORT = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("remote-browser.json")


async def wait_text(page, selector, needle, timeout=20):
    end = asyncio.get_running_loop().time() + timeout
    last = ""
    while asyncio.get_running_loop().time() < end:
        last = await page.locator(selector).inner_text()
        if needle in last:
            return last
        await asyncio.sleep(0.1)
    raise AssertionError(f"timeout {selector} {needle!r}: {last!r}")


def axis_value(text, axis):
    match = re.search(rf"(?:^| · )x{axis}\s+(-?\d+(?:\.\d+)?)", text)
    if not match:
        raise AssertionError(f"x{axis} missing from {text!r}")
    return float(match.group(1))


async def wait_axis(page, axis, predicate, timeout=12):
    end = asyncio.get_running_loop().time() + timeout
    last = None
    while asyncio.get_running_loop().time() < end:
        text = await page.locator("#selectedCoords").inner_text()
        last = axis_value(text, axis)
        if predicate(last):
            return last
        await asyncio.sleep(0.1)
    raise AssertionError(f"x{axis} condition timed out; last={last}")


async def open_panel(page, name):
    if await page.locator("#panel").is_visible():
        await page.click("#closePanel")
    await page.click(f'[data-panel="{name}"]')
    await page.locator("#panel").wait_for(state="visible")


async def connect(page, token, expected_role):
    await page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    await wait_text(page, "#serviceReady", "REMOTE AUTHORITY READY")
    await page.fill("#remoteToken", token)
    await page.click("#createRoom")
    await wait_text(page, "#connection", f"REMOTE {expected_role.upper()}")
    await page.locator("#toolbar").wait_for(state="visible")
    assert not await page.locator("#recordCamera").is_checked()
    assert "no frame uploads" in (await page.locator("#metrics").inner_text()).lower()


async def main():
    if len(OWNER_TOKEN) < 32:
        raise SystemExit("owner token required")
    errors = []
    checks = []

    def check(name, condition, details=None):
        checks.append({"name": name, "passed": bool(condition), "details": details})
        if not condition:
            raise AssertionError(f"{name}: {details}")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        owner_context = await browser.new_context(viewport={"width": 1280, "height": 900})
        editor_context = await browser.new_context(viewport={"width": 1100, "height": 820})
        owner = await owner_context.new_page()
        editor = await editor_context.new_page()
        owner.on("pageerror", lambda e: errors.append({"page": "owner", "error": str(e)}))
        editor.on("pageerror", lambda e: errors.append({"page": "editor", "error": str(e)}))
        try:
            await connect(owner, OWNER_TOKEN, "owner")
            check("owner connected camera-off", True)

            await open_panel(owner, "people")
            await owner.click("#makeInvite")
            end = asyncio.get_running_loop().time() + 10
            invite = ""
            while asyncio.get_running_loop().time() < end:
                invite = await owner.locator("#inviteLink").input_value()
                if "#token=" in invite:
                    break
                await asyncio.sleep(0.1)
            check("owner created invitation", "#token=" in invite, invite)

            await editor.goto(invite, wait_until="domcontentloaded", timeout=60000)
            await wait_text(editor, "#serviceReady", "REMOTE AUTHORITY READY")
            check("invitation fragment removed after capture", "#token=" not in editor.url, editor.url)
            check("captured editor token retained only in input", len(await editor.locator("#remoteToken").input_value()) >= 20)
            await editor.click("#createRoom")
            editor_label = await wait_text(editor, "#connection", "REMOTE EDITOR")
            check("editor connected", "REMOTE EDITOR" in editor_label)

            await open_panel(owner, "record")
            await owner.click("#remoteMaterial")
            await wait_text(owner, "#remoteMaterial", "Pause")
            await asyncio.sleep(0.6)
            check("learned material running", "Pause" in await owner.locator("#remoteMaterial").inner_text())

            # Person A changes x4 of the shared Relic through the real UI.
            await open_panel(owner, "move")
            await owner.select_option("#remoteObject", "relic")
            await owner.select_option("#moveTarget", "object")
            await owner.select_option("#moveAxis", "3")
            q4_before = axis_value(await owner.locator("#selectedCoords").inner_text(), 4)
            await owner.click("#axisPlus")
            q4_a = await wait_axis(owner, 4, lambda value: value > q4_before + 1e-5)
            await editor.wait_for_timeout(400)
            q4_editor_after_a = axis_value(await editor.locator("#selectedCoords").inner_text(), 4)
            check("owner x4 material change reaches editor", abs(q4_editor_after_a - q4_a) < 1e-3,
                  {"owner": q4_a, "editor": q4_editor_after_a})

            # Person B shapes the same persistent object next.
            await open_panel(editor, "move")
            await editor.select_option("#remoteObject", "relic")
            await editor.select_option("#moveTarget", "object")
            await editor.select_option("#moveAxis", "3")
            await editor.click("#axisPlus")
            q4_b = await wait_axis(editor, 4, lambda value: value > q4_a + 1e-5)
            await owner.wait_for_timeout(400)
            q4_owner_after_b = axis_value(await owner.locator("#selectedCoords").inner_text(), 4)
            check("editor changes same canonical object seen by owner", abs(q4_owner_after_b - q4_b) < 1e-3,
                  {"owner": q4_owner_after_b, "editor": q4_b})

            # Owner enters nested 11D world; editor Eye remains in root 4D.
            await open_panel(owner, "move")
            await owner.select_option("#remoteObject", "portal")
            await owner.click("#enterSpace")
            await wait_text(owner, "#dimensionBadge", "11 spatial axes")
            await wait_text(editor, "#dimensionBadge", "4 spatial axes")
            check("independent Eyes across nested entry", True)

            await open_panel(owner, "move")
            await owner.select_option("#remoteObject", "relic")
            await owner.select_option("#moveTarget", "object")
            await owner.select_option("#moveAxis", "10")
            q11_before = axis_value(await owner.locator("#selectedCoords").inner_text(), 11)
            await owner.click("#axisPlus")
            q11_after = await wait_axis(owner, 11, lambda value: value > q11_before + 1e-5)
            check("native x11 object coordinate advances", q11_after > q11_before,
                  {"before": q11_before, "after": q11_after})

            await owner.click("#exitSpace")
            await wait_text(owner, "#dimensionBadge", "4 spatial axes")
            await open_panel(owner, "move")
            await owner.select_option("#remoteObject", "portal")
            await owner.click("#enterSpace")
            await wait_text(owner, "#dimensionBadge", "11 spatial axes")
            await open_panel(owner, "move")
            await owner.select_option("#remoteObject", "relic")
            q11_return = axis_value(await owner.locator("#selectedCoords").inner_text(), 11)
            check("nested object change survives leave and return", abs(q11_return - q11_after) < 1e-3,
                  {"beforeReturn": q11_after, "afterReturn": q11_return})

            # Closing editor must not corrupt owner's private authority pipe.
            editor_actor = (await editor.locator("#connection").inner_text()).split(" · ")[-1]
            await editor_context.close()
            editor = None
            end = asyncio.get_running_loop().time() + 8
            presence = ""
            while asyncio.get_running_loop().time() < end:
                await open_panel(owner, "people")
                presence = await owner.locator("#peopleList").inner_text()
                if editor_actor not in presence:
                    break
                await asyncio.sleep(0.15)
            check("editor disconnect drains safely and owner remains live",
                  editor_actor not in presence and "REMOTE OWNER" in await owner.locator("#connection").inner_text(),
                  presence)

            check("no uncaught browser errors", not errors, errors)
            report = {"schema": "vivo.remote-browser-two-person/1",
                      "checks": checks,
                      "passed": sum(1 for c in checks if c["passed"]),
                      "failed": sum(1 for c in checks if not c["passed"]),
                      "pageErrors": errors,
                      "cameraFramesUploaded": False,
                      "physicalDeviceValidated": False}
            REPORT.write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps(report, indent=2))
        finally:
            await owner_context.close()
            if editor is not None:
                await editor_context.close()
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
