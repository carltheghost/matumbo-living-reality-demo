"""Responsive smoke coverage for the application-owned Vivo overlay.

This serves the checked-in routes as static files on a disposable loopback port.
It does not request camera, AR, or VR permissions; those paths are exercised by
the capability-gated controls and the existing route-owned mocks/tests.
"""
from __future__ import annotations

import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


REPO = Path(__file__).resolve().parents[4]
REPORTS = REPO / "services" / "vivo" / "reports" / "ui-overlay"
PORT = int(os.environ.get("VIVO_UI_PORT", "8791"))


def browser_path() -> str | None:
    candidates = [
        os.environ.get("VIVO_BROWSER"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/usr/bin/chromium",
    ]
    return next((path for path in candidates if path and Path(path).is_file()), None)


def serve() -> tuple[ThreadingHTTPServer, threading.Thread]:
    handler = partial(SimpleHTTPRequestHandler, directory=str(REPO))
    server = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    thread = threading.Thread(target=server.serve_forever, name="vivo-ui-static", daemon=True)
    thread.start()
    return server, thread


def main() -> None:
    executable = browser_path()
    if not executable:
        raise SystemExit("No supported Chromium browser executable was found")
    REPORTS.mkdir(parents=True, exist_ok=True)
    server, thread = serve()
    base = f"http://127.0.0.1:{PORT}"
    errors: list[str] = []
    results: list[dict[str, object]] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=executable,
            headless=True,
            args=["--disable-gpu", "--disable-dev-shm-usage"],
        )
        try:
            def open_route(path: str, width: int, height: int):
                page = browser.new_page(
                    viewport={"width": width, "height": height},
                    device_scale_factor=1,
                    has_touch=width <= 430,
                    is_mobile=width <= 430,
                )
                page.set_default_timeout(6000)
                page.set_default_navigation_timeout(10000)
                page.on("pageerror", lambda error: errors.append(f"{path}@{width}: {error}"))
                page.goto(f"{base}/{path}", wait_until="domcontentloaded")
                install_overlay(page, path.endswith("studio.html"))
                return page

            def install_overlay(page, studio: bool):
                page.evaluate(
                    """async ([source, studio]) => {
                      const href = new URL('vivo-ui-overlay.css', source).href;
                      if (!document.querySelector(`link[href="${href}"]`)) {
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = href;
                        document.head.append(link);
                      }
                      const overlay = await import(source);
                      (studio ? overlay.installStudioOverlay : overlay.installWorkshopOverlay)();
                    }""",
                    [f"{base}/services/vivo/web/vivo-ui-overlay.mjs", studio],
                )

            for width in (320, 390, 430, 768, 1280):
                page = open_route("services/vivo/web/index.html", width, 900 if width < 500 else 800)
                page.wait_for_selector("#vivo-workshop-ui")
                page.wait_for_timeout(160)
                # Baseline: remove only the application-owned overlay, preserving
                # the actual route's canvas, controls, and original shared.css.
                page.evaluate(
                    """() => {
                      document.getElementById('vivo-workshop-ui')?.remove();
                      document.body.classList.remove('vivo-workshop-page');
                      document.querySelectorAll('link[href*="vivo-ui-overlay.css"]').forEach(e => e.remove());
                    }"""
                )
                page.screenshot(path=str(REPORTS / f"workshop-before-{width}.png"), full_page=True)
                page.reload(wait_until="domcontentloaded")
                install_overlay(page, False)
                page.wait_for_selector("#vivo-workshop-ui")
                page.evaluate(
                    """() => {
                      document.getElementById('welcome').hidden = true;
                      document.getElementById('toolbar').hidden = false;
                    }"""
                )
                page.wait_for_timeout(160)
                workshop = page.evaluate(
                    """() => {
                      const first = document.querySelector('[data-vivo-mode="touch"]');
                      const rect = first?.getBoundingClientRect();
                      return {
                        overflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
                        overlay: !!document.getElementById('vivo-workshop-ui'),
                        dockVisible: getComputedStyle(document.querySelector('.vivo-mode-dock')).display !== 'none',
                        targetHeight: rect?.height || 0,
                      };
                    }"""
                )
                page.screenshot(path=str(REPORTS / f"workshop-after-{width}.png"), full_page=True)
                page.click('[data-vivo-mode="mouse"]')
                assert page.locator(".vivo-mode-dock").get_attribute("data-input-mode") == "mouse"
                assert "MOUSE" in page.locator("[data-vivo-input-status]").inner_text()
                page.click('[data-panel="move"]')
                assert page.locator("#panel").evaluate("e => e.open")
                assert page.locator('[data-panel="move"]').get_attribute("aria-pressed") == "true"
                page.keyboard.press("Escape")
                assert not page.locator("#panel").evaluate("e => e.open")
                page.keyboard.press("Tab")
                assert page.evaluate("document.activeElement?.tagName === 'BUTTON'")
                results.append({"route": "workshop", "width": width, **workshop})
                page.close()

            for width in (320, 390, 430, 768, 1280):
                page = open_route("services/vivo/web/studio.html", width, 900 if width < 500 else 800)
                page.wait_for_selector("#vivo-studio-ui", timeout=15000)
                page.wait_for_timeout(350)
                page.evaluate(
                    """() => {
                      document.getElementById('vivo-studio-ui')?.remove();
                      document.querySelectorAll('link[href*="vivo-ui-overlay.css"]').forEach(e => e.remove());
                    }"""
                )
                page.screenshot(path=str(REPORTS / f"studio-before-{width}.png"), full_page=True)
                page.reload(wait_until="domcontentloaded")
                install_overlay(page, True)
                page.wait_for_selector("#vivo-studio-ui", timeout=15000)
                page.wait_for_timeout(350)
                studio = page.evaluate(
                    """() => ({
                      overflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
                      overlay: !!document.getElementById('vivo-studio-ui'),
                      xrState: document.querySelector('[data-vivo-xr-state]')?.textContent || '',
                      arDisabled: !!document.querySelector('[data-vivo-xr="ar"]')?.disabled,
                      vrDisabled: !!document.querySelector('[data-vivo-xr="vr"]')?.disabled,
                      guideHeight: document.querySelector('.vivo-input-card [data-vivo-input-copy]')?.getBoundingClientRect().height || 0,
                    })"""
                )
                page.screenshot(path=str(REPORTS / f"studio-after-{width}.png"), full_page=True)
                if width <= 1280:
                    page.click("[data-vivo-toggle]")
                    assert page.locator(".vivo-input-card").get_attribute("data-collapsed") == "false"
                page.click('[data-vivo-mode="hand"]')
                assert page.locator(".vivo-input-card").get_attribute("data-input-mode") == "hand"
                results.append({"route": "studio", "width": width, **studio})
                page.close()
        finally:
            browser.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    if errors:
        raise AssertionError("Browser page errors: " + " | ".join(errors))
    if any(row["overflow"] for row in results):
        raise AssertionError("Responsive overflow detected: " + repr(results))
    if any(row["targetHeight"] < 44 for row in results if row["route"] == "workshop"):
        raise AssertionError("Workshop input tab missed the 44px touch target")
    if not all(row["arDisabled"] and row["vrDisabled"] for row in results if row["route"] == "studio"):
        raise AssertionError("Unsupported static HTTP XR state was not capability-gated")
    print({"browser": executable, "port": PORT, "screenshots": str(REPORTS), "checks": len(results) * 4})


if __name__ == "__main__":
    main()
