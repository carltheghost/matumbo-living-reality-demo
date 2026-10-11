"""Smoke-test the published static phone route without a camera or authority."""

from __future__ import annotations

import json
import sys

from playwright.sync_api import sync_playwright


def main(base_url: str) -> None:
    route = base_url.rstrip("/") + "/services/vivo/web/phone/"
    page_errors: list[str] = []
    camera_calls: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context()
        context.set_default_timeout(7000)
        context.add_init_script(
            """
            (() => {
              const media = navigator.mediaDevices || (navigator.mediaDevices = {});
              media.getUserMedia = async (...args) => {
                window.__phoneCameraCalls = (window.__phoneCameraCalls || 0) + 1;
                throw new Error('camera must stay off during the static phone smoke');
              };
              window.__phoneCameraCalls = 0;
            })();
            """
        )
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        print(json.dumps({"step": "goto", "route": route}), flush=True)
        response = page.goto(route, wait_until="domcontentloaded")
        assert response is not None and response.status == 200, response
        page.wait_for_selector("#enterPhoneLocal")
        print(json.dumps({"step": "enter-local"}), flush=True)
        page.get_by_role("button", name="Enter local Vivo").click()
        page.wait_for_selector("#phoneFieldAtlas")
        page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
        page.wait_for_function("document.querySelector('#phoneFieldStatus').textContent.includes('coordinate planes')")
        print(json.dumps({"step": "field-ready"}), flush=True)

        initial = page.evaluate(
            """
            async () => {
              const snapshot = await window.VivaPhoneEngine.snapshot();
              const relic = snapshot.snapshot.spaces.root.entities.relic;
              return {
                q: relic.q,
                revision: relic.revision,
                status: document.querySelector('#phoneFieldStatus').textContent,
                authority: document.querySelector('#phoneAuthorityState').textContent,
                connectDisabled: document.querySelector('#phoneAuthorityConnect').disabled,
                publishDisabled: document.querySelector('#phoneAuthorityPublish').disabled,
                commitDisabled: document.querySelector('#phoneAuthorityCommit').disabled,
                atlas: document.querySelector('#phoneFieldAtlas').toDataURL().length,
              };
            }
            """
        )
        assert "coordinate planes" in initial["status"]
        assert "analytic information mix" in initial["status"]
        assert "PAGES STATIC/OFFLINE" in initial["authority"]
        assert initial["connectDisabled"] is True
        assert initial["publishDisabled"] is True
        assert initial["commitDisabled"] is True
        assert initial["atlas"] > 100

        page.get_by_role("button", name="Preview move").click()
        page.get_by_role("button", name="Apply local edit").click()
        page.wait_for_function("document.querySelector('#phoneFieldPreview').textContent.includes('No local edit preview')")
        print(json.dumps({"step": "edit-applied"}), flush=True)
        final = page.evaluate(
            """
            async () => {
              const snapshot = await window.VivaPhoneEngine.snapshot();
              const relic = snapshot.snapshot.spaces.root.entities.relic;
              return {
                q: relic.q,
                revision: relic.revision,
                cameraCalls: window.__phoneCameraCalls,
                controlled: Boolean(navigator.serviceWorker.controller),
              };
            }
            """
        )
        assert final["revision"] == initial["revision"] + 1
        assert final["q"][0] != initial["q"][0]
        assert final["cameraCalls"] == 0
        page.get_by_role("button", name="Install offline shell").click()
        page.wait_for_function("document.querySelector('#phoneEngineState').textContent.includes('service worker active')")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("Boolean(navigator.serviceWorker.controller)")
        page.close()
        context.set_offline(True)
        reopened = context.new_page()
        reopened.on("pageerror", lambda error: page_errors.append(str(error)))
        offline_response = reopened.goto(route, wait_until="domcontentloaded")
        assert offline_response is not None and offline_response.status == 200, offline_response
        reopened.wait_for_selector("text=SHARED WORKSHOP")
        offline = reopened.evaluate(
            "() => ({controlled: Boolean(navigator.serviceWorker.controller), hasCanonicalContent: document.body.innerText.includes('SHARED WORKSHOP'), route: location.pathname})"
        )
        assert offline["controlled"] is True
        assert offline["hasCanonicalContent"] is True
        assert offline["route"].endswith("/services/vivo/web/phone/")
        assert not page_errors, page_errors
        print(json.dumps({"route": route, "initial": initial, "final": final, "offline": offline, "pageErrors": page_errors}))
        browser.close()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9892/")
