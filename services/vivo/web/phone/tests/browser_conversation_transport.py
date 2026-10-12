"""Synthetic browser proof for the explicit Vivo conversation handoff.

The provider is backed by an in-page fixture function, never a network/API
credential. This exercises the real phone route at both source and copied
static-artifact hosts without camera, microphone, XR, account, or provider
access.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def enter_local(page, route: str) -> None:
    response = page.goto(route, wait_until="domcontentloaded")
    assert response is not None and response.status == 200, response
    page.wait_for_selector("#enterPhoneLocal")
    page.get_by_role("button", name="Enter local Vivo").click()
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
    page.wait_for_selector(".vivo-companion")
    page.wait_for_function("document.querySelector('[data-companion=provider-badge]').textContent.includes('BACKEND NOT CONNECTED')")


def connect_fixture(page) -> dict:
    return page.evaluate(
        """
        async () => {
          const {createRemoteConversationProvider} = await import(
            new URL('../application/conversation-transport.mjs', location.href).href
          );
          const token = 'synthetic-owner-token-never-sent-to-network-0123456789';
          const provider = createRemoteConversationProvider({
            token,
            origin: location.origin,
            sessionId: 'phone-browser-fixture',
            fetch: async (url, init) => {
              const body = init.body ? JSON.parse(init.body) : null;
              window.__conversationCalls.push({
                url: String(url),
                method: init.method,
                headers: {...init.headers},
                body,
              });
              if (init.method === 'GET') {
                return {ok: true, status: 200, json: async () => ({
                  schema: 'vivo.conversation/2', status: 'ready', available: true,
                })};
              }
              if (window.__conversationMode === 'hold') {
                return new Promise((resolve, reject) => {
                  const cancel = () => reject(Object.assign(new Error('fixture cancelled'), {name: 'AbortError'}));
                  init.signal?.addEventListener('abort', cancel, {once: true});
                  window.__releaseConversation = () => {
                    init.signal?.removeEventListener('abort', cancel);
                    resolve({ok: true, status: 200, json: async () => ({
                      schema: 'vivo.conversation/2', status: 'complete',
                      requestId: body.requestId, generation: body.generation,
                      conversationId: 'fixture-conversation', text: 'held response', reaction: 'pulse',
                    })});
                  };
                });
              }
              return {ok: true, status: 200, json: async () => ({
                schema: 'vivo.conversation/2', status: 'complete',
                requestId: body.requestId, generation: body.generation,
                conversationId: 'fixture-conversation', text: 'Synthetic response from the authorized fixture.', reaction: 'pulse',
              })};
            },
          });
          await provider.connect();
          window.__conversationCalls = window.__conversationCalls || [];
          window.VivoConversationProvider = provider;
          await window.VivoCompanion.refresh();
          return {available: provider.available, sessionId: provider.sessionId};
        }
        """
    )


def run_flow(page, route: str, label: str, screenshot_dir: Path | None) -> dict:
    requests: list[str] = []
    errors: list[str] = []
    page.on("request", lambda request: requests.append(request.url))
    page.on("pageerror", lambda error: errors.append(str(error)))
    enter_local(page, route)
    initial = page.evaluate(
        """
        () => ({
          badge: document.querySelector('[data-companion=provider-badge]').textContent,
          sendDisabled: document.querySelector('[data-companion=send]').disabled,
          cameraCalls: window.__phoneCameraCalls,
          selection: window.VivoCompanion.state.selectedId,
        })
        """
    )
    assert initial["badge"] == "BACKEND NOT CONNECTED", initial
    assert initial["sendDisabled"] is True, initial
    assert initial["cameraCalls"] == 0, initial

    connected = connect_fixture(page)
    assert connected["available"] is True, connected
    page.wait_for_function("document.querySelector('[data-companion=provider-badge]').textContent.includes('LIVE PROVIDER READY')")
    assert page.locator("[data-companion=send]").is_enabled()
    page.locator("[data-companion=conversation]").evaluate("node => { node.open = true; }")

    page.locator("[data-companion=chat-input]").fill("What is this place?")
    page.locator("[data-companion=send]").click()
    page.wait_for_function("document.querySelector('[data-companion=chat-log]').textContent.includes('Synthetic response from the authorized fixture.')")
    first_chat = page.locator("[data-companion=chat-log]").inner_text()
    assert "YOU" in first_chat and "Synthetic response from the authorized fixture." in first_chat, first_chat
    first_call = page.evaluate("() => window.__conversationCalls.at(-1)")
    assert first_call["method"] == "POST", first_call
    assert first_call["headers"]["Authorization"].startswith("Bearer "), first_call
    token = first_call["headers"]["Authorization"][len("Bearer "):]
    assert token not in first_call["url"]
    assert token not in json.dumps(first_call["body"])
    assert "color" not in first_call["body"]["companion"]
    assert "prompt" not in first_call["body"]["companion"]
    assert first_call["body"]["world"]["worldId"], first_call
    if screenshot_dir:
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(screenshot_dir / f"{label}-live-response.png"), full_page=True)

    page.evaluate("() => { window.__conversationMode = 'hold'; }")
    page.locator("[data-companion=chat-input]").fill("Stop this turn")
    page.locator("[data-companion=send]").click()
    page.wait_for_function("!document.querySelector('[data-companion=stop]').hidden")
    page.locator("[data-companion=stop]").click()
    page.wait_for_function("document.querySelector('[data-companion=stop]').hidden && !window.VivoCompanion.state.responseBusy")
    stopped_chat = page.locator("[data-companion=chat-log]").inner_text()
    assert "held response" not in stopped_chat, stopped_chat

    page.evaluate("() => { window.__conversationMode = 'hold'; }")
    page.locator("[data-companion=chat-input]").fill("Selection cancels this turn")
    page.locator("[data-companion=send]").click()
    page.wait_for_function("!document.querySelector('[data-companion=stop]').hidden")
    page.locator("[data-character-id=workpiece]").click()
    page.wait_for_function("window.VivoCompanion.state.selectedId === 'workpiece' && !window.VivoCompanion.state.responseBusy")
    assert page.locator("[data-companion=name]").inner_text() == "Workpiece"

    if screenshot_dir:
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(screenshot_dir / f"{label}.png"), full_page=True)

    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#enterPhoneLocal")
    page.get_by_role("button", name="Enter local Vivo").click()
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
    page.wait_for_function("document.querySelector('[data-companion=provider-badge]').textContent.includes('BACKEND NOT CONNECTED')")
    reloaded = page.evaluate(
        """
        () => ({
          badge: document.querySelector('[data-companion=provider-badge]').textContent,
          provider: Boolean(window.VivoConversationProvider),
          selected: window.VivoCompanion.state.selectedId,
          cameraCalls: window.__phoneCameraCalls,
        })
        """
    )
    assert reloaded["badge"] == "BACKEND NOT CONNECTED", reloaded
    assert reloaded["provider"] is False, reloaded
    assert reloaded["cameraCalls"] == 0, reloaded
    assert not any("/api/conversation/" in url for url in requests), requests
    assert not errors, errors
    return {"initial": initial, "connected": connected, "reloaded": reloaded, "requestCount": len(requests), "pageErrors": errors}


def main(base_url: str) -> None:
    route = base_url.rstrip("/") + "/services/vivo/web/phone/"
    screenshot_root = Path(os.environ["VIVO_SCREENSHOT_DIR"]) if os.environ.get("VIVO_SCREENSHOT_DIR") else None
    with sync_playwright() as playwright:
        executable = os.environ.get("VIVO_CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("chromium-browser")
        launch_options = {"headless": True, "args": ["--no-sandbox", "--disable-gpu"]}
        if executable:
            launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)
        results = {}
        for label, viewport in (("desktop", {"width": 1280, "height": 900}), ("mobile", {"width": 390, "height": 844})):
            context = browser.new_context(viewport=viewport, is_mobile=label == "mobile", has_touch=label == "mobile")
            context.set_default_timeout(12000)
            context.add_init_script(
                """
                (() => {
                  window.__phoneCameraCalls = 0;
                  const media = navigator.mediaDevices || (navigator.mediaDevices = {});
                  media.getUserMedia = async () => { window.__phoneCameraCalls += 1; throw new Error('camera must stay off'); };
                  window.__conversationCalls = [];
                  window.__conversationMode = 'reply';
                })();
                """
            )
            page = context.new_page()
            results[label] = run_flow(page, route, label, screenshot_root)
            context.close()
        browser.close()
    print(json.dumps({"route": route, "scope": "synthetic in-page provider fixture; no real backend, credential, camera, microphone, XR, or account access", "results": results}))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9896/")
