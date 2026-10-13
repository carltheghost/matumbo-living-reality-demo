"""Exercise the repaired local phone route in synthetic Chromium only.

This test deliberately uses a mocked media stream and a deliberately missing
two-hand worker. It proves the touch camera preview is independent from the
hand model, not that a physical camera or device is supported.
"""

from __future__ import annotations

import json
import shutil
import sys
from typing import Any

from playwright.sync_api import Page, sync_playwright


CAMERA_INIT = r"""
(() => {
  window.__phoneCameraCalls = 0;
  window.__phoneCameraDenied = false;
  window.__phoneHandWorkerCalls = 0;
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      const marker = String(options?.name || url);
      if (marker.includes('two-hand')) {
        window.__phoneHandWorkerCalls += 1;
        throw new Error('deliberately unavailable hand model');
      }
      super(url, options);
    }
  };
  const media = navigator.mediaDevices || (navigator.mediaDevices = {});
  media.getUserMedia = async () => {
    window.__phoneCameraCalls += 1;
    if (window.__phoneCameraDenied) throw new DOMException('permission denied', 'NotAllowedError');
    const listeners = new Map();
    const track = {
      kind: 'video', readyState: 'live',
      stop() { this.readyState = 'ended'; listeners.get('ended')?.(); },
      getSettings() { return { facingMode: 'user' }; },
      addEventListener(name, handler) { listeners.set(name, handler); },
      getCapabilities() { return {}; },
    };
    const stream = new MediaStream();
    stream.getVideoTracks = () => [track];
    stream.getTracks = () => [track];
    window.__phoneLastStream = stream;
    return stream;
  };
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
  Object.defineProperty(HTMLVideoElement.prototype, 'readyState', { configurable: true, get: () => 4 });
  HTMLMediaElement.prototype.play = async function() {};
})();
"""


HAND_WORKER_READY_INIT = r"""
(() => {
  const PreviousWorker = window.Worker;
  window.Worker = class {
    constructor(url, options) {
      const marker = String(options?.name || url);
      if (!marker.includes('two-hand')) return new PreviousWorker(url, options);
      window.__phoneHandWorkerCalls += 1;
      this.onmessage = null;
      this.onerror = null;
    }
    postMessage(message) {
      if (message?.type === 'init') {
        setTimeout(() => this.onmessage?.({data: {type: 'ready', maxHands: 2, landmarksPerHand: 21}}), 0);
      }
    }
    terminate() {}
  };
})();
"""


def snapshot_relic(page: Page) -> dict[str, Any]:
    return page.evaluate(
        """
        async () => {
          const envelope = await window.VivaPhoneEngine.snapshot();
          const space = envelope.snapshot.spaces[envelope.eyes[envelope.currentEyeId].spaceId];
          const entity = space.entities.relic;
          return { q: entity.q, revision: entity.revision, dimension: space.dimension };
        }
        """
    )


def snapshot_view(page: Page) -> dict[str, Any]:
    return page.evaluate(
        """
        async () => {
          const envelope = await window.VivaPhoneEngine.snapshot();
          const eye = envelope.eyes[envelope.currentEyeId];
          const participant = window.VivaShared.S.state?.participants?.find(item => item.id === eye.id)
            || window.VivaShared.S.state?.participants?.[0];
          return {
            eyeId: envelope.currentEyeId,
            eyeQ: eye.q,
            participantQ: participant?.observer?.q,
            sharedQ: window.VivaShared.S.observer?.q,
            origin: window.VivaShared.R.origin,
            expectedOrigin: [eye.q[0], eye.q[2], eye.q[1]],
          };
        }
        """
    )


def run(base_url: str) -> dict[str, Any]:
    route = base_url.rstrip("/") + "/services/vivo/web/phone/"
    page_errors: list[str] = []
    restricted_requests: list[str] = []
    with sync_playwright() as playwright:
        chromium_path = shutil.which("chromium") or shutil.which("chromium-browser")
        launch_options = {"executable_path": chromium_path} if chromium_path else {}
        browser = playwright.chromium.launch(headless=True, **launch_options)
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
        context.set_default_timeout(10000)
        context.add_init_script(CAMERA_INIT)
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("request", lambda request: restricted_requests.append(request.url) if ("/api/" in request.url or "/ws" in request.url) else None)

        page.goto(route, wait_until="domcontentloaded")
        page.locator("#createD").select_option("11")
        page.locator("#enterPhoneLocal").click()
        page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
        page.wait_for_function("document.querySelector('#phoneEconomyNav')?.hidden === false")
        page.locator("#phoneFieldDock").evaluate("node => node.scrollTop = 0")
        nav_box = page.locator("#phoneEconomyNav").bounding_box()
        assert nav_box and nav_box["y"] < 844, nav_box

        page.get_by_role("button", name="Move", exact=True).click()
        page.wait_for_function("document.querySelectorAll('#moveAxis option').length === 11")
        before = snapshot_relic(page)
        page.locator("#moveAxis").select_option("10")
        page.locator("#axisPlus").click()
        page.wait_for_function("document.querySelector('#status')?.textContent.includes('LOCAL MOVE')")
        after = snapshot_relic(page)
        assert after["q"][10] > before["q"][10] + 0.05, {"before": before, "after": after}
        assert after["revision"] > before["revision"], {"before": before, "after": after}
        assert "LOCAL PHONE" in page.locator("#connection").inner_text()
        assert "PHONE-LOCAL" in page.locator("#moveAuthorityNote").inner_text()
        page.locator("#closePanel").click()

        page.reload(wait_until="domcontentloaded")
        page.locator("#enterPhoneLocal").click()
        page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
        page.wait_for_function("document.querySelector('#phoneEconomyNav')?.hidden === false")
        reloaded = snapshot_relic(page)
        assert abs(reloaded["q"][10] - after["q"][10]) < 0.001, {"after": after, "reloaded": reloaded}
        assert reloaded["revision"] >= after["revision"], {"after": after, "reloaded": reloaded}

        page.get_by_role("button", name="Move", exact=True).click()
        page.wait_for_function("document.querySelectorAll('#moveAxis option').length === 11")
        page.locator("#moveTarget").select_option("observer")
        page.locator("#moveAxis").select_option("0")
        before_view = snapshot_view(page)
        page.locator("#axisPlus").click()
        page.wait_for_function("document.querySelector('#status')?.textContent.includes('LOCAL EYE MOVE')")
        moved_view = snapshot_view(page)
        assert moved_view["eyeQ"] == moved_view["participantQ"] == moved_view["sharedQ"], moved_view
        assert moved_view["origin"] == moved_view["expectedOrigin"], moved_view
        page.locator("#closePanel").click()

        page.reload(wait_until="domcontentloaded")
        page.locator("#enterPhoneLocal").click()
        page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
        page.wait_for_function("document.querySelectorAll('#moveAxis option').length === 11")
        reloaded_view = snapshot_view(page)
        assert reloaded_view["eyeQ"] == moved_view["eyeQ"], {"moved": moved_view, "reloaded": reloaded_view}
        assert reloaded_view["participantQ"] == reloaded_view["eyeQ"], reloaded_view
        assert reloaded_view["sharedQ"] == reloaded_view["eyeQ"], reloaded_view
        assert reloaded_view["origin"] == reloaded_view["expectedOrigin"], reloaded_view

        page.locator("#phonePanelButton").click()
        page.wait_for_selector("#phoneEyeSelect")
        old_eye = page.locator("#phoneEyeSelect").input_value()
        page.locator("#phoneNewEye").click()
        page.wait_for_function("document.querySelectorAll('#phoneEyeSelect option').length >= 2")
        new_eye = page.locator("#phoneEyeSelect").input_value()
        new_q = [0.41, 0.12, 0.25] + [0] * 8
        page.evaluate("q => window.VivaPhoneEngine.setEye({q})", new_q)
        page.wait_for_function(
            "q => window.VivaPhoneEngine.snapshot().then(s => s.eyes[s.currentEyeId].q[0] === q[0])",
            arg=new_q,
        )
        changed_eye = snapshot_view(page)
        assert changed_eye["eyeId"] == new_eye, changed_eye
        assert changed_eye["participantQ"] == changed_eye["eyeQ"], changed_eye
        assert changed_eye["sharedQ"] == changed_eye["eyeQ"], changed_eye
        assert changed_eye["origin"] == changed_eye["expectedOrigin"], changed_eye
        page.locator("#phoneEyeSelect").select_option(old_eye)
        page.wait_for_function("value => window.VivaPhoneEngine.snapshot().then(s => s.currentEyeId === value)", arg=old_eye)
        switched_eye = snapshot_view(page)
        assert switched_eye["eyeId"] == old_eye, switched_eye
        assert switched_eye["participantQ"] == switched_eye["eyeQ"], switched_eye
        assert switched_eye["sharedQ"] == switched_eye["eyeQ"], switched_eye
        assert switched_eye["origin"] == switched_eye["expectedOrigin"], switched_eye
        page.locator("#closePanel").click()

        page.get_by_role("button", name="Camera", exact=True).click()
        page.locator("#previewCamera").click()
        page.wait_for_function("document.querySelector('#cameraState')?.textContent.includes('VIDEO READY')")
        preview = page.evaluate(
            """() => ({
              state: document.querySelector('#cameraState')?.textContent,
              calls: window.__phoneCameraCalls,
              handWorkers: window.__phoneHandWorkerCalls,
              live: document.body.classList.contains('camera-live'),
            })"""
        )
        assert preview["calls"] == 1 and preview["handWorkers"] == 0 and preview["live"] is True, preview
        page.get_by_role("button", name="Camera", exact=True).click()
        page.locator("#stopCamera").click()
        page.wait_for_function("!document.body.classList.contains('camera-live')")
        page.locator("#previewCamera").click()
        page.wait_for_function("document.querySelector('#cameraState')?.textContent.includes('VIDEO READY')")
        repeated = page.evaluate("() => ({ calls: window.__phoneCameraCalls, handWorkers: window.__phoneHandWorkerCalls })")
        assert repeated == {"calls": 2, "handWorkers": 0}, repeated
        page.get_by_role("button", name="Camera", exact=True).click()
        page.locator("#stopCamera").click()
        page.evaluate("window.__phoneCameraDenied = true")
        page.locator("#previewCamera").click()
        page.wait_for_function("document.querySelector('#cameraState')?.textContent.includes('Camera permission denied')")
        denied = page.evaluate(
            """() => ({
              state: document.querySelector('#cameraState')?.textContent,
              live: document.body.classList.contains('camera-live'),
              calls: window.__phoneCameraCalls,
              handWorkers: window.__phoneHandWorkerCalls,
            })"""
        )
        assert denied["live"] is False and denied["calls"] == 3 and denied["handWorkers"] == 0, denied

        hand_context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
        hand_context.set_default_timeout(10000)
        hand_context.add_init_script(CAMERA_INIT + HAND_WORKER_READY_INIT)
        hand_page = hand_context.new_page()
        hand_page.goto(route, wait_until="domcontentloaded")
        hand_page.locator("#enterPhoneLocal").click()
        hand_page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
        hand_page.get_by_role("button", name="Camera", exact=True).click()
        hand_page.locator("#frontCamera").click()
        hand_page.wait_for_function("document.querySelector('#phoneCameraVideo')?.style.display === 'block'")
        after_hands = hand_page.evaluate(
            """() => ({
              cameraVideoDisplay: document.querySelector('#cameraVideo')?.style.display,
              phoneVideoDisplay: document.querySelector('#phoneCameraVideo')?.style.display,
              live: document.body.classList.contains('camera-live'),
              handWorkers: window.__phoneHandWorkerCalls,
            })"""
        )
        hand_page.get_by_role("button", name="Camera", exact=True).click()
        hand_page.locator("#previewCamera").click()
        hand_page.wait_for_function("document.querySelector('#cameraState')?.textContent.includes('VIDEO READY')")
        hands_to_preview = hand_page.evaluate(
            """() => ({
              state: document.querySelector('#cameraState')?.textContent,
              cameraVideoDisplay: document.querySelector('#cameraVideo')?.style.display,
              phoneVideoDisplay: document.querySelector('#phoneCameraVideo')?.style.display,
              live: document.body.classList.contains('camera-live'),
              handWorkers: window.__phoneHandWorkerCalls,
            })"""
        )
        assert after_hands["cameraVideoDisplay"] == "none" and after_hands["phoneVideoDisplay"] == "block", after_hands
        assert hands_to_preview["cameraVideoDisplay"] == "", hands_to_preview
        assert hands_to_preview["phoneVideoDisplay"] == "none" and hands_to_preview["live"] is True, hands_to_preview
        hand_page.close()
        hand_context.close()

        page.locator("#phoneOpenExchange").click()
        page.wait_for_selector("#simulated-economy-panel:not([hidden])")
        page.wait_for_function("document.querySelector('#sim-economy-tab-exchange')?.hidden === false")
        page.locator("[data-action='tab:house-pool']").click()
        page.locator("#sim-economy-house-pool-name").fill("Review direct audit pool")
        page.locator("#sim-economy-house-pool-capacity").fill("3000")
        page.locator("[data-action='house-pool:create']").click()
        page.wait_for_function(
            "document.querySelector('.sim-economy-house-pool-card')?.textContent.includes('Review direct audit pool')"
        )
        page.locator("#simulated-economy-panel [data-action='close']").click()
        page.wait_for_function("document.querySelector('#simulated-economy-panel')?.hidden === true")
        page.wait_for_timeout(350)
        page.locator("#phoneOpenExchange").click()
        page.wait_for_selector("#simulated-economy-panel:not([hidden])")
        page.wait_for_function("document.querySelector('#sim-economy-tab-exchange')?.hidden === false")
        audit_after_direct_reopen = page.evaluate(
            """() => ({
              auditState: document.querySelector('.token-economy-overview-host')?.dataset.auditState,
              auditLabel: document.querySelector('.token-economy-overview-audit')?.textContent,
            })"""
        )
        assert audit_after_direct_reopen["auditState"] == "current", audit_after_direct_reopen
        exchange = {
            "panel": True,
            "exchangeTab": not page.locator("#sim-economy-tab-exchange").is_hidden(),
            "boundary": page.locator(".sim-economy-boundary").inner_text(),
        }
        page.locator("#simulated-economy-panel [data-action='close']").click()
        page.wait_for_function("document.querySelector('#simulated-economy-panel')?.hidden === true")
        page.locator("#phoneOpenContracts").click()
        page.wait_for_function("document.querySelector('#sim-economy-tab-contracts')?.hidden === false")
        contracts = {
            "contractsTab": not page.locator("#sim-economy-tab-contracts").is_hidden(),
            "exchangeTab": page.locator("#sim-economy-tab-exchange").is_hidden(),
        }
        assert contracts == {"contractsTab": True, "exchangeTab": True}, contracts
        assert not restricted_requests, restricted_requests
        assert not page_errors, page_errors
        result = {
            "route": route,
            "movement": {"before": before, "after": after, "reloaded": reloaded},
            "view": {"before": before_view, "moved": moved_view, "reloaded": reloaded_view, "changedEye": changed_eye, "switchedEye": switched_eye},
            "camera": {"preview": preview, "repeated": repeated, "denied": denied, "handsToPreview": hands_to_preview},
            "economy": {"exchange": exchange, "contracts": contracts, "directReopenAudit": audit_after_direct_reopen},
            "mobile": {"viewport": [390, 844], "economyEntryInViewport": True},
            "restrictedRequests": restricted_requests,
            "pageErrors": page_errors,
        }
        browser.close()
        return result


if __name__ == "__main__":
    print(json.dumps(run(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9892/"), ensure_ascii=False))
