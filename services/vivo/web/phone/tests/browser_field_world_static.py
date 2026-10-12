"""Smoke-test the published static phone route without a camera or authority."""

from __future__ import annotations

import json
import os
import shutil
import sys
import time

from playwright.sync_api import sync_playwright


def main(base_url: str) -> None:
    route = base_url.rstrip("/") + "/services/vivo/web/phone/"
    page_errors: list[str] = []
    camera_calls: list[str] = []
    requests: list[str] = []
    with sync_playwright() as playwright:
        chromium_path = os.environ.get("VIVO_CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("chromium-browser")
        browser_options = {"executable_path": chromium_path} if chromium_path else {}
        browser = playwright.chromium.launch(headless=True, **browser_options)
        camera_init_script = """
            (() => {
              const media = navigator.mediaDevices || (navigator.mediaDevices = {});
              media.getUserMedia = async (...args) => {
                window.__phoneCameraCalls = (window.__phoneCameraCalls || 0) + 1;
                throw new Error('camera must stay off during the static phone smoke');
              };
              window.__phoneCameraCalls = 0;
            })();
            """
        context = browser.new_context()
        context.set_default_timeout(7000)
        context.add_init_script(camera_init_script)
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("request", lambda request: requests.append(request.url))
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
        assert not any(url.rstrip("/").endswith("/readyz") for url in requests), requests

        page.get_by_role("button", name="Preview move").click()
        page.wait_for_function(
            "window.VivaPhoneEngine.fieldWorld().preview && window.VivaPhoneEngine.fieldWorld().preview.entityId === 'relic'"
        )
        workpiece_point = page.evaluate(
            "() => { const point = window.VivaShared.R.screen.find(item => item.id === 'workpiece'); return {x: point.x, y: point.y}; }"
        )
        page.mouse.click(workpiece_point["x"], workpiece_point["y"])
        page.wait_for_function(
            "document.querySelector('#phoneFieldEntity').value === 'workpiece' && !window.VivaPhoneEngine.fieldWorld().preview"
        )
        retargeted = page.evaluate(
            "() => ({selected: document.querySelector('#phoneFieldEntity').value, rendererSelected: window.VivaShared.R.selected, applyDisabled: document.querySelector('#phoneFieldApply').disabled})"
        )
        assert retargeted == {"selected": "workpiece", "rendererSelected": "workpiece", "applyDisabled": True}, retargeted
        page.get_by_role("button", name="Preview move").click()
        page.wait_for_function(
            "window.VivaPhoneEngine.fieldWorld().preview && window.VivaPhoneEngine.fieldWorld().preview.entityId === 'workpiece'"
        )
        page.get_by_role("button", name="Discard preview").click()
        page.wait_for_function("!window.VivaPhoneEngine.fieldWorld().preview")
        page.select_option("#phoneFieldEntity", "relic")
        page.wait_for_function("document.querySelector('#phoneFieldEntity').value === 'relic'")

        mobile_context = browser.new_context(viewport={"width": 390, "height": 844})
        mobile_context.set_default_timeout(7000)
        mobile_context.add_init_script(camera_init_script)
        mobile_page = mobile_context.new_page()
        mobile_page.goto(route, wait_until="domcontentloaded")
        mobile_page.wait_for_selector("#enterPhoneLocal")
        mobile_page.get_by_role("button", name="Enter local Vivo").click()
        mobile_page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
        mobile_page.wait_for_function("document.querySelector('#phoneFieldStatus').textContent.includes('coordinate planes')")
        mobile_actions = mobile_page.evaluate(
            """
            () => {
              const dock = document.querySelector('#phoneFieldDock').getBoundingClientRect();
              const actions = document.querySelector('.field-actions').getBoundingClientRect();
              const apply = document.querySelector('#phoneFieldApply').getBoundingClientRect();
              return {dockTop: dock.top, dockBottom: dock.bottom, actionsTop: actions.top, actionsBottom: actions.bottom, applyTop: apply.top, applyWidth: apply.width};
            }
            """
        )
        assert mobile_actions["actionsTop"] >= mobile_actions["dockTop"]
        assert mobile_actions["actionsBottom"] <= mobile_actions["dockBottom"]
        assert mobile_actions["applyTop"] >= mobile_actions["actionsTop"]
        assert mobile_actions["applyWidth"] > 0, mobile_actions
        mobile_context.close()

        before_layout = page.locator("#phoneFieldAtlas").evaluate("node => node.toDataURL()")
        page.select_option("#phoneFieldLayout", "ring")
        page.wait_for_timeout(50)
        ring_layout = page.locator("#phoneFieldAtlas").evaluate("node => node.toDataURL()")
        assert ring_layout != before_layout, "Ring layout must change rendered atlas pixels"
        page.select_option("#phoneFieldAxisA", "2")
        page.wait_for_timeout(50)
        changed_axis = page.locator("#phoneFieldAtlas").evaluate("node => node.toDataURL()")
        assert changed_axis != ring_layout, "Eye-axis selection must change the rendered atlas"
        page.fill("#phoneFieldQuery", "memory")
        page.wait_for_timeout(50)
        query_atlas = page.locator("#phoneFieldAtlas").evaluate("node => node.toDataURL()")
        assert query_atlas != changed_axis, "Information query must change the rendered field"
        page.fill("#phoneFieldQuery", "")

        page.get_by_role("button", name="Preview turn").click()
        page.wait_for_timeout(50)
        rotated_preview = page.locator("#phoneFieldAtlas").evaluate("node => node.toDataURL()")
        assert rotated_preview != changed_axis, "Turn preview must change rendered atlas pixels"
        page.get_by_role("button", name="Discard preview").click()
        page.wait_for_function("document.querySelector('#phoneFieldPreview').textContent.includes('No local edit preview')")

        race_context = browser.new_context()
        race_context.set_default_timeout(7000)
        race_context.add_init_script(camera_init_script)
        race_context.add_init_script(
            """
            (() => {
              const NativeWorker = window.Worker;
              window.__delayedApplySubmitted = false;
              window.__delayedApplyCompleted = false;
              window.Worker = class VivoDelayedWorker {
                constructor(url, options) {
                  const worker = new NativeWorker(url, options);
                  let onmessage = null;
                  let onerror = null;
                  const delayedResponses = new Set();
                  Object.defineProperties(worker, {
                    onmessage: { configurable: true, get: () => onmessage, set: value => { onmessage = value; } },
                    onerror: { configurable: true, get: () => onerror, set: value => { onerror = value; } },
                  });
                  const postMessage = worker.postMessage.bind(worker);
                  worker.postMessage = (message, transfer) => {
                    if (message?.method === 'applyLocalEdit') {
                      delayedResponses.add(message.id);
                      window.__delayedApplySubmitted = true;
                    }
                    return postMessage(message, transfer);
                  };
                  worker.addEventListener('message', event => {
                    if (delayedResponses.has(event.data?.id)) {
                      delayedResponses.delete(event.data.id);
                      setTimeout(() => { window.__delayedApplyCompleted = true; onmessage?.call(worker, event); }, 350);
                    }
                    else onmessage?.call(worker, event);
                  });
                  worker.addEventListener('error', event => onerror?.call(worker, event));
                  return worker;
                }
              };
            })();
            """
        )
        race_page = race_context.new_page()
        race_errors: list[str] = []
        race_page.on("pageerror", lambda error: race_errors.append(str(error)))
        race_page.goto(route, wait_until="domcontentloaded")
        race_page.wait_for_selector("#enterPhoneLocal")
        race_page.get_by_role("button", name="Enter local Vivo").click()
        race_page.wait_for_selector("#phoneFieldAtlas")
        race_page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
        race_page.get_by_role("button", name="Preview move").click()
        first_preview = race_page.evaluate(
            """
            () => {
              const model = window.VivaPhoneEngine.fieldWorld();
              return model.entities.find(entity => entity.id === 'relic').q;
            }
            """
        )
        race_page.get_by_role("button", name="Apply local edit").click()
        race_page.wait_for_function("window.__delayedApplySubmitted === true")
        race_page.get_by_role("button", name="Preview move").click()
        newer_preview = race_page.evaluate(
            """
            () => ({
              q: window.VivaPhoneEngine.fieldWorld().entities.find(entity => entity.id === 'relic').q,
              modelPreview: window.VivaPhoneEngine.fieldWorld().preview,
              preview: document.querySelector('#phoneFieldPreview').textContent,
              applyDisabled: document.querySelector('#phoneFieldApply').disabled,
            })
            """
        )
        assert "move preview" in newer_preview["preview"]
        assert newer_preview["applyDisabled"] is False
        race_page.wait_for_function(
            "window.__delayedApplyCompleted === true"
        )
        deadline = time.monotonic() + 7
        settled = None
        while time.monotonic() < deadline:
            settled = race_page.evaluate(
                """
                async () => {
                  const snapshot = await window.VivaPhoneEngine.snapshot();
                  const preview = document.querySelector('#phoneFieldPreview').textContent;
                  const modelPreview = window.VivaPhoneEngine.fieldWorld().preview;
                  const accepted = (snapshot.snapshot.localOperationResults || []).some(item => item?.result?.changed === true);
                  return { accepted, preview, modelPreview, applyDisabled: document.querySelector('#phoneFieldApply').disabled };
                }
                """
            )
            if settled["accepted"] and settled["modelPreview"] and settled["modelPreview"]["baseRevision"] >= 1 and "move preview" in settled["preview"] and not settled["applyDisabled"]:
                break
            race_page.wait_for_timeout(50)
        else:
            raise AssertionError({"newer": newer_preview, "settled": settled})
        rebased_preview = race_page.evaluate(
            """
            async () => {
              const snapshot = await window.VivaPhoneEngine.snapshot();
              return {
                engineQ: snapshot.snapshot.spaces.root.entities.relic.q,
                engineRevision: snapshot.snapshot.spaces.root.entities.relic.revision,
                delayedApplyCompleted: window.__delayedApplyCompleted,
                previewQ: window.VivaPhoneEngine.fieldWorld().entities.find(entity => entity.id === 'relic').q,
                modelPreview: window.VivaPhoneEngine.fieldWorld().preview,
                preview: document.querySelector('#phoneFieldPreview').textContent,
                status: document.querySelector('#phoneStatus')?.textContent || '',
                applyDisabled: document.querySelector('#phoneFieldApply').disabled,
              };
            }
            """
        )
        expected_increment = newer_preview["modelPreview"].get("intentDelta", newer_preview["modelPreview"]["delta"])[0]
        assert "move preview" in rebased_preview["preview"], {"newer": newer_preview, "rebased": rebased_preview}
        assert rebased_preview["applyDisabled"] is False
        assert rebased_preview["delayedApplyCompleted"] is True
        assert abs(rebased_preview["previewQ"][0] - (rebased_preview["engineQ"][0] + expected_increment)) < 1e-9, rebased_preview
        race_page.evaluate("document.querySelector('#phoneFieldApply').click()")
        deadline = time.monotonic() + 7
        settled = None
        while time.monotonic() < deadline:
            settled = race_page.evaluate(
                """
                async () => {
                  const snapshot = await window.VivaPhoneEngine.snapshot();
                  const operations = (snapshot.snapshot.localOperationResults || []).filter(item => item?.result?.changed === true);
                  return { preview: document.querySelector('#phoneFieldPreview').textContent, operationCount: operations.length };
                }
                """
            )
            if "No local edit preview" in settled["preview"] and settled["operationCount"] >= 2:
                break
            race_page.wait_for_timeout(50)
        else:
            raise AssertionError({"rebased": rebased_preview, "settled": settled})
        race_final = race_page.evaluate(
            """
            async () => {
              const snapshot = await window.VivaPhoneEngine.snapshot();
              const operations = (snapshot.snapshot.localOperationResults || []).filter(item => item?.result?.changed === true);
              return {
                q: snapshot.snapshot.spaces.root.entities.relic.q,
                revision: snapshot.snapshot.spaces.root.entities.relic.revision,
                operationCount: operations.length,
                operations,
                preview: document.querySelector('#phoneFieldPreview').textContent,
                status: document.querySelector('#phoneStatus')?.textContent || '',
                cameraCalls: window.__phoneCameraCalls,
              };
            }
            """
        )
        assert race_final["operationCount"] >= 2, race_final
        second_operation = race_final["operations"][-1]
        second_fingerprint = json.loads(second_operation["fingerprint"])
        assert second_operation["result"]["changed"] is True
        assert abs(second_fingerprint["delta"][0] - expected_increment) < 1e-9, race_final
        assert race_final["cameraCalls"] == 0
        assert not race_errors, race_errors
        race_context.close()

        for overlap_attempt in range(3):
            overlap_context = browser.new_context()
            overlap_context.set_default_timeout(7000)
            overlap_context.add_init_script(camera_init_script)
            overlap_context.add_init_script(
                """
                (() => {
                  const NativeWorker = window.Worker;
                  window.__overlapApplyCount = 0;
                  window.__overlapFirstApplyResult = false;
                  window.__overlapSnapshotHeld = false;
                  window.__overlapHeldEvent = null;
                  window.__releaseOlderApplySnapshot = () => {
                    const event = window.__overlapHeldEvent;
                    if (!event) return false;
                    window.__overlapHeldEvent = null;
                    setTimeout(() => window.__overlapOnMessage?.(event), 0);
                    return true;
                  };
                  window.Worker = class VivoOverlapWorker {
                    constructor(url, options) {
                      const worker = new NativeWorker(url, options);
                      let onmessage = null;
                      let onerror = null;
                      let firstApplyId = null;
                      let heldSnapshotId = null;
                      Object.defineProperties(worker, {
                        onmessage: { configurable: true, get: () => onmessage, set: value => { onmessage = value; window.__overlapOnMessage = value; } },
                        onerror: { configurable: true, get: () => onerror, set: value => { onerror = value; } },
                      });
                      const postMessage = worker.postMessage.bind(worker);
                      worker.postMessage = (message, transfer) => {
                        if (message?.method === 'applyLocalEdit') {
                          window.__overlapApplyCount += 1;
                          if (window.__overlapApplyCount === 1) firstApplyId = message.id;
                        }
                        if (message?.method === 'snapshot' && window.__overlapFirstApplyResult && !heldSnapshotId) heldSnapshotId = message.id;
                        return postMessage(message, transfer);
                      };
                      worker.addEventListener('message', event => {
                        if (event.data?.id === firstApplyId) {
                          window.__overlapFirstApplyResult = true;
                          onmessage?.call(worker, event);
                          return;
                        }
                        if (event.data?.id === heldSnapshotId) {
                          window.__overlapSnapshotHeld = true;
                          window.__overlapHeldEvent = event;
                          return;
                        }
                        onmessage?.call(worker, event);
                      });
                      worker.addEventListener('error', event => onerror?.call(worker, event));
                      return worker;
                    }
                  };
                })();
                """
            )
            overlap_page = overlap_context.new_page()
            overlap_errors: list[str] = []
            overlap_page.on("pageerror", lambda error: overlap_errors.append(str(error)))
            overlap_page.goto(route, wait_until="domcontentloaded")
            overlap_page.wait_for_selector("#enterPhoneLocal")
            overlap_page.get_by_role("button", name="Enter local Vivo").click()
            overlap_page.wait_for_selector("#phoneFieldAtlas")
            overlap_page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
            overlap_page.get_by_role("button", name="Preview move").click()
            first_overlap = overlap_page.evaluate(
                """
                () => ({
                  q: window.VivaPhoneEngine.fieldWorld().entities.find(entity => entity.id === 'relic').q,
                  modelPreview: window.VivaPhoneEngine.fieldWorld().preview,
                })
                """
            )
            overlap_page.get_by_role("button", name="Apply local edit").click()
            overlap_page.wait_for_function("window.__overlapSnapshotHeld === true")
            overlap_page.get_by_role("button", name="Preview move").click()
            second_overlap = overlap_page.evaluate(
                """
                () => ({
                  q: window.VivaPhoneEngine.fieldWorld().entities.find(entity => entity.id === 'relic').q,
                  modelPreview: window.VivaPhoneEngine.fieldWorld().preview,
                  preview: document.querySelector('#phoneFieldPreview').textContent,
                  applyDisabled: document.querySelector('#phoneFieldApply').disabled,
                })
                """
            )
            expected_increment = second_overlap["modelPreview"].get("intentDelta", [second_overlap["q"][0] - first_overlap["q"][0]])[0]
            overlap_page.get_by_role("button", name="Apply local edit").click()
            overlap_page.wait_for_timeout(150)
            held = overlap_page.evaluate(
                """
                () => ({
                  applyCount: window.__overlapApplyCount,
                  preview: document.querySelector('#phoneFieldPreview').textContent,
                  applyDisabled: document.querySelector('#phoneFieldApply').disabled,
                })
                """
            )
            assert held["applyCount"] == 1, {"attempt": overlap_attempt, "held": held}
            assert "move preview" in held["preview"] and held["applyDisabled"] is False, held
            assert overlap_page.evaluate("window.__releaseOlderApplySnapshot()") is True
            deadline = time.monotonic() + 7
            settled_overlap = None
            while time.monotonic() < deadline:
                settled_overlap = overlap_page.evaluate(
                    """
                    async () => {
                      const snapshot = await window.VivaPhoneEngine.snapshot();
                      const operations = (snapshot.snapshot.localOperationResults || []).filter(item => item?.result?.changed === true);
                      return {
                        applyCount: window.__overlapApplyCount,
                        operationCount: operations.length,
                        preview: document.querySelector('#phoneFieldPreview').textContent,
                        applyDisabled: document.querySelector('#phoneFieldApply').disabled,
                        operations,
                      };
                    }
                    """
                )
                if settled_overlap["applyCount"] >= 2 and settled_overlap["operationCount"] >= 2 and "No local edit preview" in settled_overlap["preview"]:
                    break
                overlap_page.wait_for_timeout(50)
            else:
                raise AssertionError({"attempt": overlap_attempt, "second": second_overlap, "settled": settled_overlap})
            final_overlap = overlap_page.evaluate(
                """
                async () => {
                  const snapshot = await window.VivaPhoneEngine.snapshot();
                  const operations = (snapshot.snapshot.localOperationResults || []).filter(item => item?.result?.changed === true);
                  return { operations, q: snapshot.snapshot.spaces.root.entities.relic.q, preview: document.querySelector('#phoneFieldPreview').textContent };
                }
                """
            )
            second_operation = final_overlap["operations"][-1]
            second_fingerprint = json.loads(second_operation["fingerprint"])
            assert abs(second_fingerprint["delta"][0] - expected_increment) < 1e-9, {"attempt": overlap_attempt, "final": final_overlap}
            assert not overlap_errors, {"attempt": overlap_attempt, "errors": overlap_errors}
            overlap_context.close()

        page.get_by_role("button", name="Preview move").click()
        page.evaluate(
            """
            () => {
              const button = document.querySelector('#phoneFieldApply');
              button.dispatchEvent(new MouseEvent('click', {bubbles: true}));
              button.dispatchEvent(new MouseEvent('click', {bubbles: true}));
            }
            """
        )
        page.wait_for_function("document.querySelector('#phoneFieldPreview').textContent.includes('No local edit preview')")
        print(json.dumps({"step": "edit-applied"}), flush=True)
        expected_revision = initial["revision"] + 1
        page.wait_for_function(
            f"""
            () => window.VivaPhoneEngine.snapshot().then(snapshot =>
              (snapshot.snapshot.localOperationResults || []).some(
                item => item?.result?.changed === true && item.result.revision === {expected_revision}
              )
            )
            """
        )
        final = page.evaluate(
            """
            async () => {
              const snapshot = await window.VivaPhoneEngine.snapshot();
              const relic = snapshot.snapshot.spaces.root.entities.relic;
              const operations = (snapshot.snapshot.localOperationResults || [])
                .filter(item => item?.result?.changed === true);
              const accepted = operations.at(-1) || null;
              return {
                q: relic.q,
                acceptedRevision: accepted?.result?.revision ?? null,
                currentRevision: relic.revision,
                operationCount: operations.length,
                cameraCalls: window.__phoneCameraCalls,
                controlled: Boolean(navigator.serviceWorker.controller),
              };
            }
            """
        )
        assert final["acceptedRevision"] == expected_revision, final
        assert final["operationCount"] == 1, final
        assert final["currentRevision"] >= final["acceptedRevision"], final
        assert final["q"][0] != initial["q"][0]
        assert final["cameraCalls"] == 0
        page.get_by_role("button", name="Advanced").click()
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
        reopened.wait_for_selector("text=LOCAL FIELD / VIVO WORLD")
        offline = reopened.evaluate(
            "() => ({controlled: Boolean(navigator.serviceWorker.controller), hasCanonicalContent: document.body.innerText.includes('LOCAL FIELD / VIVO WORLD'), route: location.pathname})"
        )
        assert offline["controlled"] is True
        assert offline["hasCanonicalContent"] is True
        assert offline["route"].endswith("/services/vivo/web/phone/")
        assert not page_errors, page_errors
        print(json.dumps({"route": route, "initial": initial, "final": final, "offline": offline, "pageErrors": page_errors, "backendProbes": [url for url in requests if '/readyz' in url or '/healthz' in url]}))
        browser.close()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9892/")
