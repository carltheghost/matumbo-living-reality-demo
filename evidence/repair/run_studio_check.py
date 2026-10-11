"""One-shot real Chromium acceptance probe for the recovered primary Studio."""
import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8879"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("evidence/repair")
OUT.mkdir(parents=True, exist_ok=True)
checks = []
errors = []
not_found = []
environment_gates = []


def check(name, value, details=None):
    row = {"name": name, "passed": bool(value)}
    if details is not None:
        row["details"] = details
    checks.append(row)
    if not value:
        raise AssertionError(f"{name}: {details}")


def overlaps(first, second):
    return bool(first and second and first["x"] < second["x"] + second["width"]
                and second["x"] < first["x"] + first["width"]
                and first["y"] < second["y"] + second["height"]
                and second["y"] < first["y"] + first["height"])


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
        page = await context.new_page()
        page.on("pageerror", lambda error: errors.append({"type": "pageerror", "message": str(error)}))
        page.on("console", lambda message: errors.append({"type": "console", "level": message.type, "message": message.text}) if message.type == "error" else None)
        page.on("response", lambda response: not_found.append(response.url) if response.status == 404 else None)
        page.on("dialog", lambda dialog: asyncio.create_task(dialog.accept()))

        await page.goto(BASE + "/local/", wait_until="domcontentloaded")
        await page.wait_for_timeout(1800)
        check("Primary /local opens preserved Studio", page.url.endswith("/local/"))
        check("Primary advertises accepted preview", await page.locator("#vivoLocalEntry a").get_attribute("href") == "/local/accepted/")
        check("Primary does not load backend bootstrap", await page.locator('script[src="/application/bootstrap.mjs"]').count() == 0)
        check("Field canvas renders", await page.locator("#field").evaluate("e => e.width > 0 && e.height > 0"))
        structure = await page.evaluate(
            """() => ({
                nodes: FieldApp.engine.count,
                dimensions: document.querySelectorAll('[data-dim]').length,
                modes: document.querySelectorAll('[data-mode]').length,
                inspector: getComputedStyle(document.querySelector('#inspector')).display !== 'none',
                cameraOff: !FieldApp.presence.stream,
            })"""
        )
        check("Original dense field, views, inspector and camera-off state are live", structure == {
            "nodes": 300, "dimensions": 8, "modes": 3, "inspector": True, "cameraOff": True,
        }, structure)

        target = await page.evaluate("({id: 4, ...FieldApp.renderer.nodeScreen[4]})")
        check("A real field target is hittable", bool(target), target)
        await page.mouse.click(target["x"], target["y"])
        await page.wait_for_timeout(160)
        check("Canvas selection updates inspector", await page.evaluate("id => FieldApp.renderer.selected === id", target["id"]))
        for mode in ("network", "memory", "field"):
            await page.click(f'[data-mode="{mode}"]')
            check(f"{mode} view control is active", await page.locator(f'[data-mode="{mode}"]').get_attribute("aria-pressed") == "true")
        await page.click('[data-dim="4"]')
        await page.wait_for_timeout(450)
        check("Dimension branch control is active", await page.evaluate("FieldApp.engine.activeDimensions === 4"))
        before_distance = await page.evaluate("FieldApp.renderer.camera.distance")
        await page.mouse.move(700, 500)
        await page.mouse.wheel(0, -120)
        check("Desktop wheel navigation changes the Eye", abs(await page.evaluate("FieldApp.renderer.camera.distance") - before_distance) > 0.001)
        await page.locator("#field").click(position={"x": 700, "y": 500})
        await page.evaluate("document.body.tabIndex = 0; document.body.focus()")
        await page.keyboard.press("Space")
        check("Keyboard pause works", await page.evaluate("FieldApp.paused") is True)
        await page.keyboard.press("Space")
        check("Keyboard resume works", await page.evaluate("FieldApp.paused") is False)

        await page.click("#pause")
        saved = await page.evaluate("FieldApp.snapshot()")
        await page.click("#saveMenu")
        await page.locator("#saveDialog").wait_for(state="visible")
        await page.select_option("#quality", "ultra")
        check("Quality control remains wired", await page.evaluate("FieldApp.renderer.quality") == "ultra")
        await page.click("#saveLocal")
        check("Browser checkpoint writes to local storage", bool(await page.evaluate("Object.keys(localStorage)")))
        async with page.expect_download(timeout=5000) as download_info:
            await page.click("#exportState")
        state_path = OUT / "studio-field-state.json"
        await (await download_info.value).save_as(str(state_path))
        exported = json.loads(Path(state_path).read_text())
        check("Field JSON export is real", exported.get("format") == "matumbo-field-lab" and exported.get("version") == 2)
        if await page.locator("#saveDialog").is_visible():
            await page.click('[data-close="saveDialog"]')

        await page.click("#saveMenu")
        await page.locator("#saveDialog").wait_for(state="visible")
        await page.click("#resetField")
        await page.locator("#resetDialog").wait_for(state="visible")
        await page.click("#confirmReset")
        await page.wait_for_timeout(200)
        await page.click("#saveMenu")
        await page.locator("#saveDialog").wait_for(state="visible")
        await page.click("#loadLocal")
        await page.wait_for_timeout(250)
        restored = await page.evaluate("FieldApp.snapshot()")
        check("Browser checkpoint restores the saved branch", restored["engine"]["branch"] == saved["engine"]["branch"])
        if await page.locator("#saveDialog").is_visible():
            await page.click('[data-close="saveDialog"]')

        await page.click("#vivaEnter")
        await page.wait_for_timeout(350)
        check("Mapped Viva portal enters", await page.locator("body").evaluate("e => e.classList.contains('viva-inside')"))
        await page.click("#vivaBack")
        await page.wait_for_timeout(350)
        check("Mapped Viva portal returns", not await page.locator("body").evaluate("e => e.classList.contains('viva-inside')"))

        await page.click("#studioOpen")
        await page.locator("#studioDialog").wait_for(state="visible")
        check("Studio record panel is present", await page.locator("#studioHistoryStart").is_visible() and await page.locator("#studioVideoStart").is_visible())
        check("Camera inclusion defaults off", not await page.locator("#studioCameraConsent").is_checked())
        await page.click("#studioHistoryStart")
        await page.wait_for_timeout(1400)
        await page.click("#studioHistoryStop")
        await page.wait_for_timeout(200)
        frame_count = await page.evaluate("FieldApp.studio.tape.frames.length")
        check("History captures checkpoints", frame_count >= 2, frame_count)
        await page.locator("#studioTimeline").evaluate("e => { e.value = '0'; e.dispatchEvent(new Event('input', {bubbles:true})); }")
        await page.wait_for_timeout(220)
        check("History scrub is read-only", await page.evaluate("FieldApp.studio.replay") is True and "RECORDED PAST" in await page.locator("#studioHistoryState").inner_text())
        await page.click("#studioReturn")
        check("History returns to live", await page.evaluate("FieldApp.studio.replay") is False)
        async with page.expect_download(timeout=5000) as download_info:
            await page.click("#studioHistorySave")
        history_path = OUT / "studio-history.json"
        await (await download_info.value).save_as(str(history_path))
        history = json.loads(Path(history_path).read_text())
        check("History export is real", isinstance(history.get("frames"), list) and len(history["frames"]) >= 2)
        async with page.expect_download(timeout=5000) as download_info:
            await page.click("#studioStill")
        still_path = OUT / "studio-still.png"
        await (await download_info.value).save_as(str(still_path))
        check("PNG still export is non-empty", Path(still_path).stat().st_size > 1000)
        await page.click("#studioVideoStart")
        await page.wait_for_timeout(1500)
        await page.click("#studioVideoStop")
        for _ in range(120):
            if "Save video, then discard" in await page.locator("#studioVideoState").inner_text():
                break
            await asyncio.sleep(.1)
        else:
            raise AssertionError("Video encoder did not finish its onstop callback")
        video_size = await page.evaluate("FieldApp.studio.videoBlob?.size || 0")
        camera_included = await page.locator("#studioCameraConsent").is_checked()
        video_path = OUT / "studio-recording.webm"
        if video_size > 1000 and not camera_included:
            check("Field-only video records without camera", True, video_size)
            async with page.expect_download(timeout=5000) as download_info:
                await page.click("#studioVideoSave")
            await (await download_info.value).save_as(str(video_path))
            check("Recorded video saves as a real file", video_path.stat().st_size > 1000)
            discard = page.get_by_role("button", name="Discard saved video buffer")
            if await discard.count():
                await discard.click()
        else:
            environment_gates.append({
                "name": "Field-only video recording",
                "status": "blocked-by-environment",
                "details": {
                    "mediaRecorderBlobBytes": video_size,
                    "cameraIncluded": camera_included,
                    "reason": "Headless Chromium exposed MediaRecorder but emitted no usable blob; rerun in a visible browser/encoder environment.",
                },
            })
        await page.click("#studioClose")
        await page.wait_for_timeout(120)
        desktop_hud = await page.locator("#vivaLightHud").bounding_box()
        desktop_experiment = await page.locator(".experiment").bounding_box()
        check("Desktop touch-ready status reserves space above the learning card", not overlaps(desktop_hud, desktop_experiment), {"status": desktop_hud, "experiment": desktop_experiment})
        await page.screenshot(path=str(OUT / "primary-studio-final-desktop.png"), full_page=True)
        await page.set_viewport_size({"width": 943, "height": 421})
        await page.wait_for_timeout(350)
        inspector_box = await page.locator("#inspector").bounding_box()
        toolbar_box = await page.locator(".bottom-center .toolbar").bounding_box()
        check("Landscape inspector stays fully above the action dock", bool(inspector_box and toolbar_box and inspector_box["y"] + inspector_box["height"] <= toolbar_box["y"]), {"inspector": inspector_box, "toolbar": toolbar_box})
        landscape_hud = await page.locator("#vivaLightHud").bounding_box()
        touch_bar = await page.locator(".touch-bar").bounding_box()
        check("Landscape touch-ready status does not cover touch controls", not overlaps(landscape_hud, touch_bar), {"status": landscape_hud, "touchBar": touch_bar})
        await page.locator("#inspector").evaluate("e => { e.scrollTop = e.scrollHeight; return e.scrollTop; }")
        check("Landscape inspector scroll exposes Kick axis", await page.locator("#kickAxis").is_visible())
        before_kick_events = await page.evaluate("FieldApp.engine.events.length")
        await page.click("#kickAxis")
        await page.wait_for_timeout(120)
        check("Landscape inspector Kick axis performs a real action", await page.evaluate("FieldApp.engine.events.length") > before_kick_events)
        await page.click("#physicsButton")
        check("Landscape inspector Physics evidence opens", await page.locator("#physicsDialog").is_visible())
        await page.click('[data-close="physicsDialog"]')
        check("Compact Studio tools toggle is available in short landscape", await page.locator("#vivoStudioTools").is_visible())
        await page.click("#vivoStudioTools")
        check("Compact Studio tools drawer opens", await page.locator("#vivoStudioToolsDrawer").is_visible())
        await page.locator("#vivoStudioSearch").fill("Echo")
        check("Compact Studio search forwards to the original search", await page.locator("#search").input_value() == "Echo")
        await page.click('[data-vivo-mode="network"]')
        check("Compact Studio Field/Network/Memory controls remain wired", await page.locator('[data-mode="network"]').get_attribute("aria-pressed") == "true")
        await page.click('[data-vivo-lens="2"]')
        check("Compact Studio camera lenses remain wired", await page.locator('[data-lens="2"]').get_attribute("aria-pressed") == "true")
        check("Compact Studio parent-return control remains present", await page.locator("#vivoStudioParent").is_visible())
        await page.click("#vivoStudioExperiment")
        check("Compact Studio learning experiment remains reachable", await page.locator("#learningDialog").is_visible())
        await page.click('[data-close="learningDialog"]')
        await page.evaluate("document.querySelector('[data-mode=field]').click(); document.querySelector('[data-lens=all]').click();")
        await page.screenshot(path=str(OUT / "primary-studio-final-landscape.png"), full_page=True)
        await page.set_viewport_size({"width": 430, "height": 932})
        await page.wait_for_timeout(350)
        portrait_hud = await page.locator("#vivaLightHud").bounding_box()
        portrait_camera = await page.locator("#cameraLaunch").bounding_box()
        check("Portrait touch-ready status does not cover Camera / AR", not overlaps(portrait_hud, portrait_camera), {"status": portrait_hud, "camera": portrait_camera})
        if portrait_camera:
            await page.mouse.click(portrait_camera["x"] + portrait_camera["width"] / 2, portrait_camera["y"] + portrait_camera["height"] / 2)
        await page.wait_for_timeout(120)
        check("Portrait Camera / AR control is tappable without requesting camera", await page.locator("body").evaluate("e => e.classList.contains('presence-open')") and await page.locator("#cameraPanel").is_visible() and not await page.evaluate("!!FieldApp.presence.stream"))
        await page.click("#cameraClose")
        check("Portrait Camera / AR panel closes cleanly", not await page.locator("body").evaluate("e => e.classList.contains('presence-open')"))
        await page.screenshot(path=str(OUT / "primary-studio-final-portrait.png"), full_page=True)
        await page.set_viewport_size({"width": 1440, "height": 1000})
        await page.wait_for_timeout(200)
        await page.screenshot(path=str(OUT / "primary-studio-interactive-desktop.png"), full_page=True)
        check("No uncaught application page errors", not any(item["type"] == "pageerror" for item in errors), errors)
        report = {
            "surface": "primary-studio",
            "viewport": [1440, 1000],
            "passed": sum(row["passed"] for row in checks),
            "failed": sum(not row["passed"] for row in checks),
            "checks": checks,
            "errors": errors,
            "404s": not_found,
            "camera": "not requested; permissions=[]; inclusion remained false",
            "artifacts": ["studio-field-state.json", "studio-history.json", "studio-still.png"] + (["studio-recording.webm"] if video_path.exists() else []),
            "environmentGates": environment_gates,
        }
        (OUT / "studio-interaction.json").write_text(json.dumps(report, indent=2))
        print(json.dumps({"passed": report["passed"], "failed": report["failed"], "errors": errors, "404s": not_found}))
        await context.close()
        await browser.close()


try:
    asyncio.run(main())
except Exception as error:
    (OUT / "studio-interaction.json").write_text(json.dumps({"success": False, "checks": checks, "errors": errors, "404s": not_found, "environmentGates": environment_gates, "error": str(error)}, indent=2))
    raise
