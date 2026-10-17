"""Exercise the local phone control hierarchy in synthetic Chromium only.

This is a usability regression pass for the static phone route. It does not
request camera access, contact a backend, or claim physical-device support.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

from playwright.sync_api import Page, sync_playwright


def rect(page: Page, selector: str) -> dict[str, float]:
    box = page.locator(selector).bounding_box()
    assert box is not None, selector
    return {key: float(value) for key, value in box.items()}


def overlaps(first: dict[str, float], second: dict[str, float]) -> bool:
    return (
        max(first["x"], second["x"]) < min(first["x"] + first["width"], second["x"] + second["width"])
        and max(first["y"], second["y"]) < min(first["y"] + first["height"], second["y"] + second["height"])
    )


def layout(page: Page) -> dict[str, Any]:
    dock = rect(page, "#phoneFieldDock")
    status = rect(page, "#status")
    toolbar = rect(page, "#toolbar")
    return {
        "viewport": page.evaluate("() => ({width: innerWidth, height: innerHeight})"),
        "dock": dock,
        "status": status,
        "toolbar": toolbar,
        "dockStatusOverlap": overlaps(dock, status),
        "dockToolbarOverlap": overlaps(dock, toolbar),
    }


def enter_local(page: Page, route: str) -> None:
    response = page.goto(route, wait_until="domcontentloaded")
    assert response is not None and response.status == 200, response
    page.wait_for_selector("#enterPhoneLocal")
    page.get_by_role("button", name="Enter local Vivo").click()
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
    page.wait_for_selector("#phoneFieldAtlas", state="attached")
    page.wait_for_function("document.querySelector('#phoneFieldStatus').textContent.includes('coordinate planes')")


def open_world_controls(page: Page) -> None:
    context = page.locator("details.vivo-companion-world-context")
    if not context.evaluate("node => node.open"):
        context.locator(":scope > summary").click()
    page.wait_for_function("document.querySelector('details.vivo-companion-world-context')?.open === true")


def snapshot_selected(page: Page) -> dict[str, Any]:
    return page.evaluate(
        """
        async () => {
          const envelope = await window.VivaPhoneEngine.snapshot();
          const eye = envelope.eyes[envelope.currentEyeId];
          const space = envelope.snapshot.spaces[eye.spaceId];
          const id = document.querySelector('#phoneFieldEntity').value;
          const entity = space.entities[id];
          return {
            worldId: envelope.snapshot.worldId,
            branchId: envelope.branchId,
            eyeId: envelope.currentEyeId,
            entityId: id,
            q: entity?.q,
            revision: entity?.revision,
            persistence: envelope.persistence?.state,
          };
        }
        """
    )


def save_screenshot(page: Page, directory: Path, name: str) -> str:
    path = directory / name
    page.screenshot(path=str(path), full_page=True)
    return str(path)


def main(base_url: str) -> None:
    route = base_url.rstrip("/") + "/services/vivo/web/phone/"
    screenshot_dir = Path(os.environ.get("VIVO_USABILITY_SCREENSHOT_DIR", "/tmp/vivo-usability-pass"))
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    page_errors: list[str] = []
    restricted_requests: list[str] = []
    screenshots: list[str] = []
    with sync_playwright() as playwright:
        chromium_path = os.environ.get("VIVO_CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("chromium-browser")
        launch_options = {"executable_path": chromium_path} if chromium_path else {}
        browser = playwright.chromium.launch(headless=True, **launch_options)
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        context.set_default_timeout(10000)
        context.add_init_script(
            "localStorage.setItem('vivo.phone.worldId', 'vivo.phone.usability-pass-2026-10-17');"
        )
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "request",
            lambda request: restricted_requests.append(request.url)
            if ("/api/" in request.url or "/ws" in request.url or "/readyz" in request.url or "/healthz" in request.url)
            else None,
        )

        enter_local(page, route)
        mobile_initial = layout(page)
        assert not mobile_initial["dockStatusOverlap"], mobile_initial
        assert not mobile_initial["dockToolbarOverlap"], mobile_initial
        screenshots.append(save_screenshot(page, screenshot_dir, "01-mobile-initial.png"))

        open_world_controls(page)
        page.locator("#phoneFieldDock").hover()
        page.mouse.wheel(0, 1000)

        # The compact dock keeps the primary edit path visible and progressively
        # discloses the less frequent turn/mix/discard controls.
        secondary = page.locator("details.field-secondary-actions")
        summary = secondary.locator("summary")
        summary.scroll_into_view_if_needed()
        summary.focus()
        summary.press("Enter")
        page.wait_for_function("document.querySelector('details.field-secondary-actions')?.open === true")
        assert page.evaluate("document.activeElement === document.querySelector('.field-secondary-actions summary')")
        screenshots.append(save_screenshot(page, screenshot_dir, "02-mobile-secondary-actions.png"))
        summary.press("Space")
        page.wait_for_function("document.querySelector('details.field-secondary-actions')?.open === false")

        # Advanced controls are a modal sheet. Opening focuses its heading;
        # closing returns focus to the control that opened it. Repeat this to
        # catch stale dialog/focus state after the first close.
        page.locator("#phonePanelButton").click()
        page.wait_for_selector("#panel[open]")
        assert page.evaluate("document.activeElement === document.querySelector('#panelTitle')")
        assert page.locator("#phonePersist").is_visible()
        assert page.locator("#phoneExitNested").is_visible()
        page.keyboard.press("Escape")
        page.wait_for_function("!document.querySelector('#panel')?.open")
        assert page.evaluate("document.activeElement === document.querySelector('#phonePanelButton')")
        page.locator("#phonePanelButton").click()
        page.wait_for_selector("#panel[open]")
        assert page.evaluate("document.activeElement === document.querySelector('#panelTitle')")
        page.locator("#closePanel").click()
        page.wait_for_function("!document.querySelector('#panel')?.open")
        assert page.evaluate("document.activeElement === document.querySelector('#phonePanelButton')")

        selected_before = snapshot_selected(page)
        page.locator("#phoneFieldPreviewMove").click()
        page.wait_for_function("Boolean(window.VivaPhoneEngine.fieldWorld().preview)")
        assert page.locator("#phoneFieldApply").is_enabled()
        page.locator("#phoneFieldApply").click()
        page.wait_for_function("!window.VivaPhoneEngine.fieldWorld().preview")
        page.wait_for_function("() => window.VivaPhoneEngine.snapshot().then(value => value.persistence.state === 'saved')")
        selected_after = snapshot_selected(page)
        assert selected_after["worldId"] == selected_before["worldId"]
        assert selected_after["entityId"] == selected_before["entityId"]
        assert selected_after["revision"] > selected_before["revision"], {"before": selected_before, "after": selected_after}
        assert selected_after["q"] != selected_before["q"], {"before": selected_before, "after": selected_after}

        page.set_viewport_size({"width": 1024, "height": 768})
        page.wait_for_timeout(100)
        desktop = layout(page)
        assert not desktop["dockStatusOverlap"], desktop
        assert not desktop["dockToolbarOverlap"], desktop
        screenshots.append(save_screenshot(page, screenshot_dir, "03-desktop.png"))

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(100)
        mobile_after_resize = layout(page)
        assert not mobile_after_resize["dockStatusOverlap"], mobile_after_resize
        assert not mobile_after_resize["dockToolbarOverlap"], mobile_after_resize
        assert page.locator("#phoneFieldEntity").input_value() == selected_after["entityId"]

        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#enterPhoneLocal")
        page.get_by_role("button", name="Enter local Vivo").click()
        page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
        page.wait_for_selector("#phoneFieldAtlas", state="attached")
        page.wait_for_function("document.querySelector('#phoneFieldEntity').value !== ''")
        reopened = snapshot_selected(page)
        assert reopened["worldId"] == selected_after["worldId"], {"before": selected_after, "after": reopened}
        assert reopened["entityId"] == selected_after["entityId"], {"before": selected_after, "after": reopened}
        assert reopened["revision"] >= selected_after["revision"], {"before": selected_after, "after": reopened}
        # The local field solver may continue advancing a material revision
        # between Apply and reload. Assert the durable edit survived by its
        # direction/magnitude, rather than requiring a frozen simulation tick.
        assert selected_after["q"][0] - selected_before["q"][0] > 0.08, {
            "before": selected_before,
            "after": selected_after,
        }
        assert reopened["q"][0] - selected_before["q"][0] > 0.05, {
            "before": selected_before,
            "after": reopened,
        }
        screenshots.append(save_screenshot(page, screenshot_dir, "04-reopened.png"))

        assert not restricted_requests, restricted_requests
        assert not page_errors, page_errors
        result = {
            "route": route,
            "mobileInitial": mobile_initial,
            "desktop": desktop,
            "mobileAfterResize": mobile_after_resize,
            "focus": {"advancedHeading": True, "focusReturnedAfterEscape": True, "focusReturnedAfterRepeatClose": True},
            "persistence": {"before": selected_before, "after": selected_after, "reopened": reopened},
            "screenshots": screenshots,
            "restrictedRequests": restricted_requests,
            "pageErrors": page_errors,
        }
        browser.close()
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9896/")
