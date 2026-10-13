"""Chromium coverage for phone-local source-bound agent stop/revoke.

The browser uses the real phone route and worker. Pointer contacts and local
agent contacts are deterministic fixtures; this is not physical-device or
Android OS permission acceptance.
"""

from __future__ import annotations

import json
import shutil
import sys

from playwright.sync_api import sync_playwright


def open_world_controls(page) -> None:
    world_context = page.locator(".vivo-companion-world-context")
    if not world_context.evaluate("node => node.open"):
        page.locator(".vivo-companion-world-context > summary").click()
    page.wait_for_function("document.querySelector('.vivo-companion-world-context')?.open === true")


def install_pointer_shim(page) -> None:
    page.evaluate(
        """
        () => {
          HTMLCanvasElement.prototype.setPointerCapture = () => {};
          HTMLCanvasElement.prototype.releasePointerCapture = () => {};
        }
        """
    )


def enter_local(page, route: str, world_id: str) -> None:
    response = page.goto(route, wait_until="domcontentloaded")
    assert response is not None and response.status == 200, response
    page.evaluate("worldId => localStorage.setItem('vivo.phone.worldId', worldId)", world_id)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#enterPhoneLocal")
    if page.locator("#createD").count():
        page.locator("#createD").select_option("11")
    page.get_by_role("button", name="Enter local Vivo").click()
    open_world_controls(page)
    page.wait_for_selector("#phoneFieldAtlas")
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
    install_pointer_shim(page)


def open_agent_panel(page) -> None:
    page.locator("#phonePanelButton").click()
    page.wait_for_selector("#phoneAgentSource")
    for capability in ("world.read", "world.edit"):
        page.locator(f"[data-local-cap='{capability}']").check(force=True)
    page.wait_for_function(
        "() => document.querySelectorAll('[data-local-cap]:checked').length >= 2"
    )


def snapshot(page) -> dict:
    return page.evaluate(
        """
        async () => {
          const value = await window.VivaPhoneEngine.snapshot();
          return {
            worldId: value.snapshot.worldId,
            branchId: value.branchId,
            eyeId: value.currentEyeId,
            entities: value.snapshot.spaces.root.entities,
          };
        }
        """
    )


def payload_for(page, entity_id: str, operation_id: str, axis: int, amount: float) -> dict:
    return page.evaluate(
        """
        ({ entityId, operationId, axis, amount }) => window.VivaPhoneEngine.snapshot().then(value => {
          const spaceId = value.eyes[value.currentEyeId].spaceId;
          const entity = value.snapshot.spaces[spaceId].entities[entityId];
          const delta = Array(entity.dimension).fill(0);
          delta[axis] = amount;
          return {
            worldId: value.snapshot.worldId,
            branchId: value.branchId,
            eyeId: value.currentEyeId,
            spaceId,
            entityId,
            baseRevision: entity.revision,
            operationId,
            delta,
            geometry: entity.geometry,
          };
        })
        """,
        {"entityId": entity_id, "operationId": operation_id, "axis": axis, "amount": amount},
    )


def invoke_fresh_edit(page, session: dict, entity_id: str, operation_id: str, axis: int, amount: float) -> dict:
    """Capture the CAS and submit it as one browser-side operation.

    The local sparse solver may advance adjacent nodes between two Python-side
    round trips. Retrying only an explicit CAS-stale capture keeps this test
    deterministic without weakening the acceptance fence.
    """
    return page.evaluate(
        """
        async ({ session, entityId, operationId, axis, amount }) => {
          let lastError = null;
          for (let attempt = 0; attempt < 8; attempt++) {
            const value = await window.VivaPhoneEngine.snapshot();
            const entity = value.snapshot.spaces[value.eyes[value.currentEyeId].spaceId].entities[entityId];
            const delta = Array(entity.dimension).fill(0);
            delta[axis] = amount;
            const payload = {
              worldId: value.snapshot.worldId,
              branchId: value.branchId,
              eyeId: value.currentEyeId,
              spaceId: value.eyes[value.currentEyeId].spaceId,
              entityId,
              baseRevision: entity.revision,
              operationId,
              delta,
              geometry: entity.geometry,
            };
            try {
              const result = await window.VivaAgentTools.invokeFor(session, 'vivo.world.edit', payload);
              const after = await window.VivaPhoneEngine.snapshot();
              return { before: entity.q, after: after.snapshot.spaces[payload.spaceId].entities[entityId].q, result };
            } catch (error) {
              lastError = error;
              if (!String(error?.message || error).includes('AGENT_CAS_STALE')) throw error;
              await new Promise(resolve => setTimeout(resolve, 2));
            }
          }
          throw lastError || new Error('fresh local edit did not complete');
        }
        """,
        {"session": session, "entityId": entity_id, "operationId": operation_id, "axis": axis, "amount": amount},
    )


def dispatch_pointer(page, kind: str, pointer_id: int, x: float, y: float) -> None:
    page.evaluate(
        """
        ({ kind, pointerId, x, y }) => document.querySelector('#world').dispatchEvent(new PointerEvent(kind, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: 'touch',
          isPrimary: pointerId === 77,
          clientX: x,
          clientY: y,
          buttons: kind === 'pointerup' || kind === 'pointercancel' ? 0 : 1,
        }))
        """,
        {"kind": kind, "pointerId": pointer_id, "x": x, "y": y},
    )


def run_desktop(page, route: str) -> dict:
    enter_local(page, route, "vivo.phone.agent-stop-browser-desktop")
    open_agent_panel(page)
    page.wait_for_function(
        "() => Boolean(window.VivaAgentTools && window.VivaPhoneAgentAdmin && !window.VivaAgentTools.register && !window.VivaAgentTools.reenable)"
    )
    registered = page.evaluate(
        """
        () => ({
          worker: window.VivaPhoneAgentAdmin.register({ sourceId: 'worker', capabilities: ['world.read', 'world.edit'] }),
          workerTwo: window.VivaPhoneAgentAdmin.register({ sourceId: 'worker:2', capabilities: ['world.read', 'world.edit'] }),
        })
        """
    )
    assert {item["sourceId"] for item in page.evaluate("() => window.VivaPhoneAgentAdmin.agents()")} == {"worker", "worker:2"}
    assert page.locator("#phoneAgentSessions .agent-stop").count() == 2

    point = page.evaluate(
        """
        () => {
          const point = window.VivaShared.R.screen.find(item => item.id === 'relic');
          return { x: point.x, y: point.y };
        }
        """
    )
    dispatch_pointer(page, "pointerdown", 77, point["x"], point["y"])
    dispatch_pointer(page, "pointermove", 77, point["x"] + 18, point["y"] + 12)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.some(item => item.source === 'touch:77')")

    page.evaluate(
        """
        ({ worker, workerTwo }) => {
          window.VivaPhoneAgentAdmin.beginContact(worker.sessionId, {
            contactId: 'same-object', objectId: 'relic', canonicalPoint: [0, 0, 0, 0], gesture: 'grab'
          });
          window.VivaPhoneAgentAdmin.beginContact(workerTwo.sessionId, {
            contactId: 'same-object', objectId: 'relic', canonicalPoint: [1, 0, 0, 0], gesture: 'grab'
          });
          window.VivaPhoneAgentAdmin.beginContact(workerTwo.sessionId, {
            contactId: 'other-object', objectId: 'workpiece', canonicalPoint: [0, 0, 0, 0], gesture: 'grab'
          });
        }
        """,
        registered,
    )
    before_stop = page.evaluate(
        """
        () => window.VivaPhoneEngine.interaction().contacts.map(item => ({ id: item.contactId, source: item.source, objectId: item.objectId }))
        """
    )
    assert {item["source"] for item in before_stop} == {"touch:77", "agent:worker", "agent:worker:2"}, before_stop

    stopped = page.evaluate("session => window.VivaPhoneAgentAdmin.stop(session, 'user-stop')", registered["worker"]["sessionId"])
    after_stop = page.evaluate(
        """
        () => ({
          contacts: window.VivaPhoneEngine.interaction().contacts.map(item => ({ source: item.source, objectId: item.objectId })),
          agents: window.VivaPhoneAgentAdmin.agents(),
          status: document.querySelector('#phoneAgentControlStatus').textContent,
        })
        """,
    )
    assert stopped["released"], stopped
    assert {item["source"] for item in after_stop["contacts"]} == {"touch:77", "agent:worker:2"}, after_stop
    assert {item["objectId"] for item in after_stop["contacts"]} == {"relic", "workpiece"}, after_stop
    assert after_stop["agents"][0]["status"] == "stopped", after_stop
    assert "preserved" in after_stop["status"], after_stop
    assert page.locator("#phoneAgentSessions .agent-reenable").count() == 1

    # Grant refresh is deliberately allowed to change visibility but cannot
    # turn the stopped worker back on.
    page.locator("[data-local-cap='world.edit']").uncheck(force=True)
    page.locator("[data-local-cap='world.edit']").check(force=True)
    refreshed = page.evaluate("() => window.VivaPhoneAgentAdmin.agents().find(item => item.sourceId === 'worker')")
    assert refreshed["status"] == "stopped", refreshed

    # End the surviving agent constraints selectively, then exercise an
    # explicit fresh generation and real q[3]/q[10] acceptance.
    page.evaluate(
        "({ workerTwo }) => window.VivaPhoneAgentAdmin.stop(workerTwo.sessionId, 'user-stop')",
        registered,
    )
    fresh_worker = page.evaluate("() => window.VivaPhoneAgentAdmin.reenable('worker')")
    assert fresh_worker["generation"] == registered["worker"]["generation"] + 1, fresh_worker
    stale_error = page.evaluate(
        "async session => { try { await window.VivaAgentTools.invokeFor(session, 'vivo.world.edit', {}); return ''; } catch (error) { return error.message; } }",
        registered["worker"],
    )
    assert "AGENT_GENERATION_STALE" in stale_error, stale_error

    edit_q3 = invoke_fresh_edit(page, fresh_worker, "relic", "browser-agent:q3", 3, 0.22)
    result_q3 = edit_q3["result"]
    assert result_q3["status"] == "accepted", result_q3
    assert abs(edit_q3["after"][3] - edit_q3["before"][3] - 0.22) < 0.05, edit_q3

    fresh_worker_two = page.evaluate("() => window.VivaPhoneAgentAdmin.reenable('worker:2')")
    # Switch the registered local Eye into the disconnected 11D nested space
    # so q[10] is exercised without a solver clock changing its CAS under us.
    if page.locator("#panel[open]").count():
        page.locator("#closePanel").click()
    if not page.locator(".vivo-companion-world-context").evaluate("node => node.open"):
        page.locator(".vivo-companion-world-context > summary").click()
    page.locator("#phoneFieldDock").hover()
    page.mouse.wheel(0, 1000)
    page.wait_for_function(
        "() => { const dock = document.querySelector('#phoneFieldDock').getBoundingClientRect(); const field = document.querySelector('#phoneFieldEntity').getBoundingClientRect(); return field.top >= dock.top && field.bottom <= dock.bottom; }"
    )
    page.locator("#phoneFieldEntity").select_option("portal")
    page.locator("#phonePanelButton").click()
    page.wait_for_selector("#phoneEnterNested")
    page.locator("#phoneEnterNested").click()
    page.wait_for_function(
        "async () => { const value = await window.VivaPhoneEngine.snapshot(); return value.eyes[value.currentEyeId].spaceId === 'inner'; }"
    )
    edit_q10 = invoke_fresh_edit(page, fresh_worker_two, "innerRelic", "browser-agent:q10", 10, -0.31)
    result_q10 = edit_q10["result"]
    assert result_q10["status"] == "accepted", result_q10
    assert abs(edit_q10["after"][10] - edit_q10["before"][10] + 0.31) < 0.05, edit_q10

    identity_error = page.evaluate(
        "async ({ session, payload }) => { try { await window.VivaAgentTools.invokeFor(session, 'vivo.world.edit', { ...payload, agentId: 'worker' }); return ''; } catch (error) { return error.message; } }",
        {"session": fresh_worker_two, "payload": payload_for(page, "innerRelic", "browser-agent:identity-reject", 10, 0.1)},
    )
    assert "AGENT_IDENTITY_NOT_IN_PAYLOAD" in identity_error, identity_error
    unscoped_error = page.evaluate(
        "async payload => { try { await window.VivaAgentTools.invoke('vivo.world.edit', payload); return ''; } catch (error) { return error.message; } }",
        payload_for(page, "innerRelic", "browser-agent:unscoped-reject", 10, 0.1),
    )
    assert "Registered local agent session required" in unscoped_error, unscoped_error
    assert page.locator("#phoneAgentControlStatus").inner_text() != ""
    return {"stopped": stopped, "q3": result_q3, "q10": result_q10, "cameraCalls": page.evaluate("() => window.__phoneCameraCalls")}


def main(base_url: str) -> None:
    route = base_url.rstrip("/") + "/services/vivo/web/phone/"
    page_errors: list[str] = []
    requests: list[str] = []
    with sync_playwright() as playwright:
        executable = shutil.which("chromium") or shutil.which("chromium-browser")
        browser = playwright.chromium.launch(headless=True, executable_path=executable, args=["--no-sandbox", "--disable-gpu"])
        camera_script = """
        (() => {
          window.__phoneCameraCalls = 0;
          const media = navigator.mediaDevices || (navigator.mediaDevices = {});
          media.getUserMedia = async () => { window.__phoneCameraCalls += 1; throw new Error('camera must stay off'); };
        })();
        """
        desktop_context = browser.new_context(viewport={"width": 1000, "height": 900})
        desktop_context.set_default_timeout(10000)
        desktop_context.add_init_script(camera_script)
        desktop = desktop_context.new_page()
        desktop.on("pageerror", lambda error: page_errors.append(str(error)))
        desktop.on("request", lambda request: requests.append(request.url))
        desktop_result = run_desktop(desktop, route)
        assert desktop_result["cameraCalls"] == 0
        assert not any("/readyz" in url or "/healthz" in url for url in requests), requests

        mobile_context = browser.new_context(viewport={"width": 390, "height": 844})
        mobile_context.set_default_timeout(10000)
        mobile_context.add_init_script(camera_script)
        mobile = mobile_context.new_page()
        mobile.on("pageerror", lambda error: page_errors.append(str(error)))
        enter_local(mobile, route, "vivo.phone.agent-stop-browser-mobile")
        open_agent_panel(mobile)
        assert mobile.locator("#phoneAgentSource").is_visible()
        assert mobile.locator("#phoneAgentControlStatus").is_visible()
        assert mobile.evaluate("() => window.__phoneCameraCalls") == 0
        mobile_context.close()
        desktop_context.close()
        assert not page_errors, page_errors
        browser.close()
        print(json.dumps({"route": route, "desktop": desktop_result, "mobile": {"viewport": [390, 844], "cameraCalls": 0}, "scope": "synthetic Chromium only; no physical-device acceptance"}))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9894/")
