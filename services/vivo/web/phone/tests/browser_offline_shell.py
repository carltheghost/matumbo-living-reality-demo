"""Prove the installed phone service worker reopens the canonical Companion URL offline."""

from __future__ import annotations

import json
import os
import shutil
import sys

from playwright.sync_api import sync_playwright


def main(base_url: str) -> None:
    base = base_url.rstrip("/") + "/"
    companion_url = f"{base}services/vivo/web/"
    page_errors: list[str] = []

    with sync_playwright() as playwright:
        launch_options = {"headless": True}
        executable = os.environ.get("VIVO_CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("chromium-browser")
        if executable:
            launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)
        context = browser.new_context()
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        first = page.goto(companion_url, wait_until="domcontentloaded")
        assert first is not None and first.status == 200, first

        registration = page.evaluate(
            """
            async () => {
              const registration = await navigator.serviceWorker.register(
                new URL('vivo-sw.js', location.href),
                {scope: new URL('./', location.href).pathname}
              );
              await navigator.serviceWorker.ready;
              return {scope: registration.scope, active: Boolean(registration.active)};
            }
            """
        )
        assert registration["scope"] == companion_url
        assert registration["active"] is True

        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("Boolean(navigator.serviceWorker.controller)")
        page.close()

        context.set_offline(True)
        reopened = context.new_page()
        reopened.on("pageerror", lambda error: page_errors.append(str(error)))
        response = reopened.goto(companion_url, wait_until="domcontentloaded")
        assert response is not None and response.status == 200, response
        reopened.wait_for_selector("text=SHARED WORKSHOP")
        state = reopened.evaluate(
            """
            () => ({
              url: location.href,
              controlled: Boolean(navigator.serviceWorker.controller),
              hasCanonicalContent: document.body.innerText.includes('SHARED WORKSHOP')
            })
            """
        )
        assert state["url"] == companion_url
        assert state["controlled"] is True
        assert state["hasCanonicalContent"] is True
        assert not page_errors, page_errors
        print(json.dumps({"canonicalUrl": companion_url, "offlineReopen": state, "pageErrors": page_errors}))
        browser.close()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9878/")
