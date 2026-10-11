"""Real Chromium acceptance probe for the mounted accepted phase preview."""
import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8879"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("evidence/repair")
OUT.mkdir(parents=True, exist_ok=True)
checks = []
page_errors = []
not_found = []
states = {"one": [], "two": []}
rpc_values = {"one": [], "two": []}


def check(name, value, details=None):
    row = {"name": name, "passed": bool(value)}
    if details is not None:
        row["details"] = details
    checks.append(row)
    if not value:
        raise AssertionError(f"{name}: {details}")


async def wait_text(page, selector, needle, timeout=20):
    end = asyncio.get_running_loop().time() + timeout
    last = ""
    while asyncio.get_running_loop().time() < end:
        last = await page.locator(selector).inner_text()
        if needle in last:
            return last
        await asyncio.sleep(.1)
    raise AssertionError(f"timeout {selector} {needle!r}: {last!r}")


async def open_panel(page, name):
    if await page.locator("#panel").is_visible():
        await page.click("#closePanel")
    await page.click(f'[data-panel="{name}"]')
    await page.locator("#panel").wait_for(state="visible")


async def wait_value(seat, predicate, label, timeout=10):
    end = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < end:
        for row in reversed(rpc_values[seat]):
            if predicate(row):
                return row
        await asyncio.sleep(.05)
    raise AssertionError(f"timeout waiting for {label}: {rpc_values[seat][-8:]!r}")


async def wait_density_progress(page, baseline, timeout=20):
    end = asyncio.get_running_loop().time() + timeout
    last = ""
    while asyncio.get_running_loop().time() < end:
        last = await page.locator("#phaseDensity").inner_text()
        if "ACCEPTED FIELD DENSITY" in last and last != baseline and "tick 0" not in last:
            return last
        await asyncio.sleep(.1)
    raise AssertionError(f"density did not publish a newer accepted tick: {last!r}")


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path="/usr/bin/chromium",
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader"],
        )
        context = await browser.new_context(
            viewport={"width": 1440, "height": 1000},
            device_scale_factor=1,
            permissions=[],
        )

        async def observe_response(response, seat):
            if "/api/local/rpc" not in response.url or response.status != 200:
                return
            try:
                body = await response.json()
            except Exception:
                return
            try:
                request_body = json.loads(response.request.post_data or "{}")
            except Exception:
                request_body = {}
            rpc_values[seat].append({"op": request_body.get("op"), "value": body.get("value"), "state": body.get("state")})
            if isinstance(body, dict) and isinstance(body.get("state"), dict):
                states[seat].append({
                    "op": request_body.get("op"),
                    "acceptedSequence": body["state"].get("snapshot", {}).get("acceptedSequence"),
                    "eye": body["state"].get("eye"),
                })

        async def new_seat(seat):
            page = await context.new_page()
            page.on("pageerror", lambda error: page_errors.append({"seat": seat, "type": "pageerror", "message": str(error)}))
            page.on("console", lambda message: page_errors.append({"seat": seat, "type": "console", "level": message.type, "message": message.text}) if message.type == "error" else None)
            page.on("response", lambda response: asyncio.create_task(observe_response(response, seat)))
            page.on("response", lambda response: not_found.append(response.url) if response.status == 404 else None)
            await page.goto(BASE + "/local/accepted/", wait_until="domcontentloaded")
            await wait_text(page, "#serviceReady", "LOCAL SERVER READY")
            await page.select_option("#localSeat", seat)
            await page.click("#createRoom")
            await wait_text(page, "#connection", "SESSION ONLY")
            return page

        try:
            launch = await context.new_page()
            launch.on("pageerror", lambda error: page_errors.append({"type": "pageerror", "message": str(error)}))
            await launch.goto(BASE + "/local/accepted/", wait_until="domcontentloaded")
            await wait_text(launch, "#serviceReady", "LOCAL SERVER READY")
            check("Accepted phase route labels its backend stage", "ACCEPTED PHASE PREVIEW" in await launch.locator(".brand small").inner_text())
            check("Camera is off before admission", await launch.locator("#cameraState").inner_text() == "OFF")
            check("Automatic camera recording is off", not await launch.locator("#recordCamera").is_checked())
            await launch.screenshot(path=str(OUT / "accepted-phase-launch-desktop.png"), full_page=True)
            await launch.close()

            one = await new_seat("one")
            two = await new_seat("two")
            check("Seat one and seat two render the selected Relic", await one.locator("#selectedName").inner_text() == "Relic" and await two.locator("#selectedName").inner_text() == "Relic")
            check("Both seats keep camera off", await one.locator("#cameraState").inner_text() == "OFF" and await two.locator("#cameraState").inner_text() == "OFF")
            await one.locator("#phaseDensity").wait_for(state="visible", timeout=20000)
            density_label = await one.locator("#phaseDensity").inner_text()
            check("Accepted solver density is visible beyond centroid discs", "ACCEPTED FIELD DENSITY" in density_label and "8×8" in density_label, density_label)
            check("Density observation is labeled with accepted progress", "sequence" in density_label and "tick" in density_label, density_label)
            await one.screenshot(path=str(OUT / "accepted-phase-connected-desktop.png"), full_page=True)

            await one.set_viewport_size({"width": 430, "height": 932})
            await one.wait_for_timeout(500)
            await one.screenshot(path=str(OUT / "accepted-phase-connected-portrait.png"), full_page=True)
            await one.set_viewport_size({"width": 932, "height": 430})
            await one.wait_for_timeout(500)
            await one.screenshot(path=str(OUT / "accepted-phase-connected-landscape.png"), full_page=True)
            await one.set_viewport_size({"width": 1440, "height": 1000})

            await open_panel(one, "eye")
            await one.select_option("#sliceAxis", "3")
            await one.locator("#sliceValue").fill("0.72")
            await one.locator("#sliceValue").dispatch_event("change")
            await one.wait_for_timeout(500)
            await one.click("#closePanel")
            await open_panel(two, "eye")
            await two.select_option("#sliceAxis", "3")
            await two.locator("#sliceValue").fill("-0.72")
            await two.locator("#sliceValue").dispatch_event("change")
            await two.wait_for_timeout(500)
            await two.click("#closePanel")
            await one.wait_for_timeout(600)
            one_eye = next((row["eye"] for row in reversed(states["one"]) if row.get("eye")), None)
            two_eye = next((row["eye"] for row in reversed(states["two"]) if row.get("eye")), None)
            check("Seat Eyes remain independent", one_eye and two_eye and one_eye["q"][3] > .6 and two_eye["q"][3] < -.6, {"one": one_eye, "two": two_eye})

            await open_panel(one, "record")
            await one.click("#runPhase")
            await wait_text(one, "#status", "Experimental phase running slowly")
            await one.wait_for_timeout(1100)
            await one.click("#runPhase")
            await wait_text(one, "#status", "Phase paused")
            running_density = await wait_density_progress(one, density_label)
            check("Run phase advances accepted solver density", "ACCEPTED FIELD DENSITY" in running_density and "tick 0" not in running_density, {"before": density_label, "after": running_density})
            await one.click("#closePanel")

            await open_panel(one, "move")
            await one.select_option("#moveTarget", "object")
            await one.select_option("#moveAxis", "3")
            await one.click("#axisPlus")
            target_predicate = lambda row: row["op"] == "submit" and row["value"].get("status") == "accepted" and row["value"].get("result", {}).get("target", {}).get("q", [None] * 4)[3] == .12
            try:
                target_one = await wait_value("one", target_predicate, "seat one accepted x4 target", timeout=2)
            except AssertionError:
                await one.click("#axisMinus")
                await one.click("#axisPlus")
                target_one = await wait_value("one", target_predicate, "seat one accepted x4 target retry")
            coords = await one.locator("#selectedCoords").inner_text()
            check("Seat one submits an accepted Relic target along x4", "x4" in coords, {"receipt": target_one["value"], "coords": coords})
            await one.click("#releaseGrab")
            await wait_value("one", lambda row: row["op"] == "submit" and row["value"].get("status") == "accepted" and row["value"].get("result", {}).get("released") is True, "seat one release")
            await one.click("#releaseGrab")
            await one.click("#closePanel")

            await open_panel(two, "move")
            await two.select_option("#moveTarget", "object")
            await two.select_option("#moveAxis", "3")
            await two.click("#axisPlus")
            target_two = await wait_value("two", target_predicate, "seat two accepted x4 target")
            await two.click("#releaseGrab")
            await wait_value("two", lambda row: row["op"] == "submit" and row["value"].get("status") == "accepted" and row["value"].get("result", {}).get("released") is True, "seat two release")
            second_coords = await two.locator("#selectedCoords").inner_text()
            check("Seat two takes a subsequent accepted x4 turn", "x4" in second_coords, {"receipt": target_two["value"], "coords": second_coords})
            await two.click("#closePanel")

            await open_panel(one, "eye")
            await one.select_option("#sliceAxis", "3")
            await one.locator("#sliceValue").fill("0")
            await one.locator("#sliceValue").dispatch_event("change")
            await one.wait_for_timeout(450)
            await one.click("#closePanel")
            await one.mouse.click(866, 540)
            await one.wait_for_timeout(350)
            check("Portal entity can be selected independently of Relic", await one.locator("#selectedName").inner_text() == "Inner world", await one.locator("#selectedName").inner_text())
            await open_panel(one, "move")
            await one.click("#enterSpace")
            await wait_text(one, "#worldName", "Inside the relic")
            check("Seat one enters the mapped portal", "Inside the relic" in await one.locator("#worldName").inner_text())
            check("11D nested material density is explicitly unavailable", not await one.locator("#phaseDensity").is_visible())
            check("Seat two stays in its own outer Eye", "Inside the relic" not in await two.locator("#worldName").inner_text())
            await open_panel(one, "move")
            await one.click("#exitSpace")
            await wait_text(one, "#worldName", "Local session")
            check("Seat one returns through the portal", "Local session" in await one.locator("#worldName").inner_text())
            if await one.locator("#panel").is_visible():
                await one.click("#closePanel")

            await open_panel(one, "record")
            async with one.expect_download(timeout=5000) as download_info:
                await one.click("#exportLocal")
            export_path = OUT / "accepted-session.json"
            await (await download_info.value).save_as(str(export_path))
            exported = json.loads(export_path.read_text())
            check("Accepted state export is real and omits camera/session tokens", exported.get("schema") == "vivo.mounted-export/1" and "camera" not in json.dumps(exported) and "token" not in json.dumps(exported), exported.get("schema"))
            await one.click("#closePanel")

            await open_panel(one, "people")
            await one.click("#reconnect")
            await wait_text(one, "#connection", "SESSION ONLY")
            check("Explicit reconnect restores the same local seat", "seat one" in await one.locator("#connection").inner_text())
            await one.click("#closePanel")
            await one.screenshot(path=str(OUT / "accepted-phase-final-desktop.png"), full_page=True)
            check("No uncaught browser page errors", not any(item["type"] == "pageerror" for item in page_errors), page_errors)
            report = {
                "schema": "vivo.accepted-phase-browser-evidence/1",
                "base": BASE,
                "viewport": [1440, 1000],
                "passed": sum(row["passed"] for row in checks),
                "failed": sum(not row["passed"] for row in checks),
                "checks": checks,
                "pageErrors": page_errors,
                "404s": not_found,
                "camera": "not requested; permissions=[]; recordCamera remained false",
                "restart": "same-process explicit reconnect only; durable restart is covered by POSIX phase tests",
                "artifacts": [
                    "accepted-phase-launch-desktop.png", "accepted-phase-connected-desktop.png",
                    "accepted-phase-connected-portrait.png", "accepted-phase-connected-landscape.png",
                    "accepted-phase-final-desktop.png", "accepted-session.json",
                ],
            }
            (OUT / "accepted-phase-interaction.json").write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps({"passed": report["passed"], "failed": report["failed"], "pageErrors": page_errors, "404s": not_found}))
        finally:
            await context.close()
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
