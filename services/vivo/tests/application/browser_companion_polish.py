"""Browser evidence for the Vivo companion choose/place/return flow.

This is a local-only visual smoke test. It uses the real static phone route and
local persistence, but never enables camera/microphone capture or configures a
conversation provider. Screenshots are written to the untracked evidence
folder so this test does not publish reference material or alter app data.
"""
from __future__ import annotations

import json
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


REPO = Path(__file__).resolve().parents[4]
EVIDENCE = REPO / "evidence" / "vivo-companion-polish" / "browser"
PORT = int(os.environ.get("VIVO_COMPANION_PORT", "8794"))
PHONE_PATH = "services/vivo/web/phone/index.html"


def browser_path() -> str | None:
    candidates = [
        os.environ.get("VIVO_BROWSER"),
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome",
    ]
    return next((path for path in candidates if path and Path(path).is_file()), None)


def serve() -> tuple[ThreadingHTTPServer, threading.Thread]:
    handler = partial(SimpleHTTPRequestHandler, directory=str(REPO))
    server = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    thread = threading.Thread(target=server.serve_forever, name="vivo-companion-static", daemon=True)
    thread.start()
    return server, thread


def install_guards(page: Page) -> None:
    page.add_init_script(
        """
        (() => {
          const checks = { fetchUrls: [], cameraCalls: 0, canvasTexts: [] };
          window.__vivoCompanionChecks = checks;
          const originalFetch = window.fetch;
          window.fetch = (...args) => {
            checks.fetchUrls.push(String(args[0]?.url || args[0] || ''));
            return originalFetch(...args);
          };
          const media = navigator.mediaDevices;
          if (media?.getUserMedia) {
            media.getUserMedia = async () => {
              checks.cameraCalls += 1;
              throw new Error('camera/microphone access is forbidden in this smoke test');
            };
          }
          const canvasContext = window.CanvasRenderingContext2D?.prototype;
          const originalFillText = canvasContext?.fillText;
          if (originalFillText) {
            canvasContext.fillText = function (text, ...args) {
              checks.canvasTexts.push(String(text));
              return originalFillText.call(this, text, ...args);
            };
          }
        })();
        """
    )


def open_phone(browser, *, width: int, height: int, reduced_motion: bool = False):
    context = browser.new_context(
        viewport={"width": width, "height": height},
        device_scale_factor=1,
        has_touch=width <= 430,
        is_mobile=width <= 430,
        reduced_motion="reduce" if reduced_motion else "no-preference",
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.set_default_navigation_timeout(12000)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    install_guards(page)
    page.goto(f"http://127.0.0.1:{PORT}/{PHONE_PATH}", wait_until="domcontentloaded")
    page.locator("#enterPhoneLocal").click()
    page.locator("body.phone-local #vivoCompanion").wait_for()
    page.wait_for_timeout(250)
    return context, page, errors


def layout(page: Page) -> dict[str, object]:
    return page.evaluate(
        """
        () => {
          const rect = selector => {
            const box = document.querySelector(selector)?.getBoundingClientRect();
            return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null;
          };
          const dock = document.querySelector('#phoneFieldDock');
          const companion = document.querySelector('#vivoCompanion');
          const context = document.querySelector('.vivo-companion-world-context');
          return {
            innerWidth,
            scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            dock: rect('#phoneFieldDock'), companion: rect('#vivoCompanion'), context: rect('.vivo-companion-world-context'),
            dockBottom: dock?.getBoundingClientRect().bottom || 0,
            companionBottom: companion?.getBoundingClientRect().bottom || 0,
            contextBottom: context?.getBoundingClientRect().bottom || 0,
          };
        }
        """
    )


def assert_layout(page: Page, *, label: str) -> dict[str, object]:
    result = layout(page)
    assert result["scrollWidth"] <= result["innerWidth"], f"{label}: horizontal overflow: {result}"
    assert result["companionBottom"] <= result["dockBottom"] + 1, f"{label}: companion escapes dock: {result}"
    assert result["contextBottom"] <= result["dockBottom"] + 1, f"{label}: field disclosure escapes dock: {result}"
    return result


def companion_state(page: Page) -> dict[str, object]:
    return page.evaluate(
        """
        () => ({
          persistence: document.querySelector('[data-companion="persistence"]')?.textContent || '',
          persistenceState: document.querySelector('[data-companion="persistence"]')?.dataset.state || '',
          placed: document.querySelector('[data-companion="persistence"]')?.dataset.placed === 'true',
          collapsed: document.querySelector('#vivoCompanion')?.dataset.collapsed === 'true',
          worldOpen: document.querySelector('.vivo-companion-world-context')?.open === true,
          focusLabel: document.querySelector('[data-companion="focus"]')?.textContent || '',
          focusAria: document.querySelector('[data-companion="focus"]')?.getAttribute('aria-label') || '',
          selectionAction: document.querySelector('[data-companion="select-world"]')?.textContent || '',
          anchor: document.querySelector('[data-companion="anchor-copy"]')?.textContent || '',
          coordinates: document.querySelector('[data-companion="coordinates"]')?.textContent || '',
          reaction: document.querySelector('[data-companion="reaction"]')?.textContent || '',
          unavailable: document.querySelector('[data-companion="chat-unavailable"]')?.textContent || '',
          chatNote: document.querySelector('[data-companion="chat-note"]')?.textContent || '',
          chatDisabled: document.querySelector('[data-companion="chat-input"]')?.disabled === true,
          provider: window.VivoCompanion?.provider?.() || null,
          rendererWorldView: window.VivaShared?.R?.companionWorldView === true,
          materialEditing: window.VivaShared?.R?.materialEditing === true,
          materialNodes: window.VivaShared?.R?.materialNodePoints?.length || 0,
          canvasTexts: window.__vivoCompanionChecks?.canvasTexts || [],
          activeRole: document.activeElement?.getAttribute('role') || '',
          activeCharacter: document.activeElement?.dataset?.characterId || '',
          guards: window.__vivoCompanionChecks,
        })
        """
    )


def main() -> None:
    executable = browser_path()
    if not executable:
        raise SystemExit("No supported Chromium browser executable was found")
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    server, thread = serve()
    results: dict[str, object] = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=executable, headless=True, args=["--disable-gpu", "--disable-dev-shm-usage"])
        try:
            context, page, errors = open_phone(browser, width=390, height=844)
            page.screenshot(path=str(EVIDENCE / "mobile-start.png"))
            initial = companion_state(page)
            assert initial["persistenceState"] == "saved", initial
            assert initial["worldOpen"] is False, initial
            assert initial["chatDisabled"] is True and initial["provider"] is None, initial
            assert "Nothing is being simulated" in str(initial["chatNote"]), initial
            assert "root EYE" in str(initial["anchor"]) and "root" in str(initial["coordinates"]), initial
            assert_layout(page, label="mobile start")

            # Native button focus + Enter is the keyboard path for choosing.
            first_card = page.locator('[data-companion="roster"] button').first
            first_card.focus()
            assert page.evaluate("document.activeElement?.dataset.characterId") == "relic"
            page.keyboard.press("Enter")
            assert page.locator('[data-companion="reaction"]').inner_text().startswith("Relic is looking back")

            page.locator('[data-companion="place"]').click()
            page.wait_for_function("document.querySelector('[data-companion=\"persistence\"]')?.dataset.placed === 'true'")
            page.wait_for_timeout(150)
            placed = companion_state(page)
            page.screenshot(path=str(EVIDENCE / "mobile-placed.png"))
            assert placed["persistence"] == "PLACEMENT · SAVED LOCALLY", placed
            assert placed["persistenceState"] == "saved" and placed["placed"] is True, placed
            assert "saved locally" in str(placed["reaction"]).lower(), placed
            assert_layout(page, label="mobile placed")

            page.evaluate("window.__vivoCompanionChecks.canvasTexts.length = 0")
            page.locator('[data-companion="focus"]').click()
            page.wait_for_function("document.querySelector('#vivoCompanion')?.dataset.collapsed === 'true'")
            returned = companion_state(page)
            page.screenshot(path=str(EVIDENCE / "mobile-returned.png"))
            assert returned["focusLabel"] == "OPEN COMPANION" and returned["focusAria"] == "Open companion chooser", returned
            assert returned["worldOpen"] is False and returned["collapsed"] is True, returned
            assert returned["rendererWorldView"] is True and returned["materialEditing"] is False, returned
            assert returned["materialNodes"] > 0, returned
            collapsed_texts = returned["canvasTexts"]
            assert any(text == "Relic" for text in collapsed_texts), collapsed_texts
            assert not any("MATERIAL PATCH" in text for text in collapsed_texts), collapsed_texts
            assert not any(text == "MEMORY" or text.startswith("MEMORY ·") for text in collapsed_texts), collapsed_texts
            assert not any(text in {"Workpiece", "Inner world"} for text in collapsed_texts), collapsed_texts
            assert_layout(page, label="mobile returned")

            page.locator('[data-companion="focus"]').click()
            page.wait_for_function("document.querySelector('#vivoCompanion')?.dataset.collapsed === 'false'")
            reopened = companion_state(page)
            assert reopened["collapsed"] is False and reopened["worldOpen"] is False, reopened
            assert reopened["selectionAction"] == "Focus in world", reopened

            # Test the navigation fence with a deliberately synthetic provider.
            # This never leaves the page, is not used for screenshots, and does
            # not present its late text as a real assistant response.
            page.evaluate(
                """
                () => {
                  window.__syntheticConversation = { resolve: null, aborted: false };
                  window.VivoConversationProvider = {
                    schema: 'vivo.conversation-provider/1', available: true,
                    respond: ({ signal }) => new Promise(resolve => {
                      window.__syntheticConversation.resolve = resolve;
                      signal.addEventListener('abort', () => { window.__syntheticConversation.aborted = true; }, { once: true });
                    }),
                  };
                }
                """
            )
            page.wait_for_function("document.querySelector('[data-companion=\"chat-input\"]')?.disabled === false")
            page.locator('[data-companion="conversation"] > summary').click()
            page.locator('[data-companion="chat-input"]').fill("synthetic navigation check")
            page.locator('[data-companion="chat-input"]').press("Enter")
            page.wait_for_function("window.VivoCompanion?.state?.responseBusy === true")
            page.locator('[data-companion="focus"]').click()
            page.wait_for_function("document.querySelector('#vivoCompanion')?.dataset.collapsed === 'true'")
            page.evaluate("window.__syntheticConversation.resolve({ text: 'late synthetic reply' })")
            page.wait_for_timeout(100)
            assert page.evaluate("window.__syntheticConversation.aborted") is True
            page.locator('[data-companion="focus"]').click()
            page.wait_for_function("document.querySelector('#vivoCompanion')?.dataset.collapsed === 'false'")
            assert page.locator('.companion-message--companion').count() == 0

            # Reload online, then reopen the already-saved local placement while
            # offline. No provider, camera, or microphone call is allowed.
            page.reload(wait_until="domcontentloaded")
            page.locator("#enterPhoneLocal").click()
            page.locator("body.phone-local #vivoCompanion").wait_for()
            page.wait_for_timeout(300)
            reloaded = companion_state(page)
            page.screenshot(path=str(EVIDENCE / "mobile-reload.png"))
            assert reloaded["placed"] is True and reloaded["persistence"] == "PLACEMENT · SAVED LOCALLY", reloaded
            assert_layout(page, label="mobile reload")
            context.set_offline(True)
            page.locator('[data-companion="focus"]').click()
            page.wait_for_function("document.querySelector('#vivoCompanion')?.dataset.collapsed === 'true'")
            page.locator('[data-companion="focus"]').click()
            page.wait_for_function("document.querySelector('#vivoCompanion')?.dataset.collapsed === 'false'")
            offline = companion_state(page)
            assert offline["placed"] is True and offline["persistence"] == "PLACEMENT · SAVED LOCALLY", offline
            assert_layout(page, label="mobile offline reopen")
            assert not errors, f"mobile page errors: {errors}"
            assert not any("conversation" in url.lower() or "provider" in url.lower() for url in offline["guards"]["fetchUrls"]), offline
            assert offline["guards"]["cameraCalls"] == 0, offline
            results["mobile"] = {"initial": initial, "placed": placed, "returned": returned, "reloaded": reloaded, "offline": offline}
            context.close()

            # Desktop reframe and resize assertion.
            desktop_context, desktop, desktop_errors = open_phone(browser, width=1180, height=757)
            desktop.screenshot(path=str(EVIDENCE / "desktop-start.png"))
            desktop_start = companion_state(desktop)
            assert_layout(desktop, label="desktop start")
            desktop.set_viewport_size({"width": 390, "height": 844})
            assert_layout(desktop, label="desktop resized to mobile")
            desktop.set_viewport_size({"width": 1280, "height": 900})
            assert_layout(desktop, label="desktop resized back")
            assert not desktop_errors, f"desktop page errors: {desktop_errors}"
            results["desktop"] = {"start": desktop_start, "resized": layout(desktop)}
            desktop_context.close()

            # Reduced motion should remove avatar animation and control
            # transitions while keeping the same usable companion surface.
            reduced_context, reduced, reduced_errors = open_phone(browser, width=390, height=844, reduced_motion=True)
            reduced_motion = reduced.evaluate(
                """
                () => {
                  const avatar = getComputedStyle(document.querySelector('.companion-avatar-core')).animationName;
                  const card = getComputedStyle(document.querySelector('.companion-character')).transitionDuration;
                  return { avatar, card };
                }
                """
            )
            assert reduced_motion["avatar"] == "none", reduced_motion
            assert reduced_motion["card"] == "0s", reduced_motion
            assert_layout(reduced, label="reduced motion")
            assert not reduced_errors, f"reduced-motion page errors: {reduced_errors}"
            results["reducedMotion"] = reduced_motion
            reduced_context.close()
        finally:
            browser.close()
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)
    print(json.dumps({"browser": executable, "port": PORT, "evidence": str(EVIDENCE), "results": results}, indent=2))


if __name__ == "__main__":
    main()
