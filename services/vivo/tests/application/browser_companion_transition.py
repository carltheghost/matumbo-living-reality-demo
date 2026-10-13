"""Focused browser regression for the desktop-collapse to narrow-reopen transition."""
from __future__ import annotations

import os

from playwright.sync_api import sync_playwright

import browser_companion_polish as polish


REPO = polish.REPO
EVIDENCE = REPO / "evidence" / "vivo-companion-transition" / "browser"
IDENTITIES = ("relic", "workpiece", "portal")


def inspect_narrow_state(page) -> dict[str, object]:
    state = polish.companion_state(page)
    geometry = polish.layout(page)
    return {"state": state, "layout": geometry}


def state_violations(observation: dict[str, object], character_id: str, *, collapsed: bool) -> list[str]:
    state = observation["state"]
    geometry = observation["layout"]
    violations: list[str] = []
    if state["rendererSelected"] != character_id:
        violations.append(f"selected renderer={state['rendererSelected']!r}, expected {character_id!r}")
    if state["selectedHit"] != character_id:
        violations.append(f"selected hit={state['selectedHit']!r}, expected {character_id!r}")
    if state["collapsed"] is not collapsed:
        violations.append(f"collapsed={state['collapsed']!r}, expected {collapsed!r}")
    if geometry["scrollWidth"] > geometry["innerWidth"]:
        violations.append(f"horizontal overflow {geometry['scrollWidth']} > {geometry['innerWidth']}")
    if geometry["companionBottom"] > geometry["dockBottom"] + 1:
        violations.append(f"companion escapes dock: {geometry['companionBottom']} > {geometry['dockBottom']}")
    if not collapsed and state["selectedScreen"]["y"] >= geometry["dock"]["top"] - 80:
        violations.append(
            f"selected y={state['selectedScreen']['y']:.2f} is not above dock threshold {geometry['dock']['top'] - 80:.2f}"
        )
    return violations


def main() -> None:
    executable = polish.browser_path()
    if not executable:
        raise SystemExit("No supported Chromium browser executable was found")
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    polish.PORT = int(os.environ.get("VIVO_COMPANION_PORT", "8804"))
    server, thread = polish.serve()
    results: dict[str, object] = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=executable,
            headless=True,
            args=["--disable-gpu", "--disable-dev-shm-usage"],
        )
        failures: list[str] = []
        try:
            for character_id in IDENTITIES:
                context, page, errors = polish.open_phone(browser, width=1280, height=900)
                page.locator(f'[data-companion="roster"] [data-character-id="{character_id}"]').click()
                page.locator('[data-companion="place"]').click()
                page.wait_for_function(
                    "document.querySelector('[data-companion=\"persistence\"]')?.dataset.state === 'saved'"
                )

                # Desktop expanded -> collapse into world view -> ordinary resize.
                page.locator('[data-companion="focus"]').click()
                page.wait_for_function("document.querySelector('#vivoCompanion')?.dataset.collapsed === 'true'")
                page.set_viewport_size({"width": 500, "height": 757})
                page.wait_for_timeout(120)

                page.locator('[data-companion="focus"]').click()
                page.wait_for_function("document.querySelector('#vivoCompanion')?.dataset.collapsed === 'false'")
                page.wait_for_timeout(120)
                expanded_observation = inspect_narrow_state(page)
                page.screenshot(path=str(EVIDENCE / f"{character_id}-transition-expanded.png"))
                failures.extend(
                    f"{character_id} expanded: {violation}"
                    for violation in state_violations(expanded_observation, character_id, collapsed=False)
                )

                page.locator('[data-companion="focus"]').click()
                page.wait_for_function("document.querySelector('#vivoCompanion')?.dataset.collapsed === 'true'")
                page.wait_for_timeout(120)
                collapsed_observation = inspect_narrow_state(page)
                page.screenshot(path=str(EVIDENCE / f"{character_id}-transition-collapsed.png"))
                failures.extend(
                    f"{character_id} collapsed: {violation}"
                    for violation in state_violations(collapsed_observation, character_id, collapsed=True)
                )

                assert not errors, f"{character_id} page errors: {errors}"
                results[character_id] = {"expanded": expanded_observation, "collapsed": collapsed_observation}
                context.close()

            # A fresh narrow open is the control state described by the report.
            fresh_context, fresh, fresh_errors = polish.open_phone(browser, width=500, height=757)
            fresh.locator('[data-companion="roster"] [data-character-id="relic"]').click()
            fresh.locator('[data-companion="place"]').click()
            fresh.wait_for_function("document.querySelector('[data-companion=\"persistence\"]')?.dataset.state === 'saved'")
            fresh_state = inspect_narrow_state(fresh)
            fresh.screenshot(path=str(EVIDENCE / "relic-fresh-narrow-expanded.png"))
            failures.extend(
                f"fresh narrow relic: {violation}"
                for violation in state_violations(fresh_state, "relic", collapsed=False)
            )
            assert not fresh_errors, f"fresh narrow page errors: {fresh_errors}"
            results["freshNarrow"] = fresh_state
            fresh_context.close()
        finally:
            browser.close()
            server.shutdown()
            thread.join(timeout=2)

    for path in EVIDENCE.glob("*.png"):
        if path.stat().st_size <= 10_000:
            raise AssertionError(f"Screenshot is unexpectedly small: {path}")
    if failures:
        raise AssertionError("\n".join(failures))
    print("BROWSER_COMPANION_TRANSITION_PASS")


if __name__ == "__main__":
    main()
