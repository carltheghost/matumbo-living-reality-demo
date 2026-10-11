"""Two-tab Full Studio authority-bridge smoke; camera and XR remain off.

Run against a mounted local server, for example:

    python services/vivo/tests/application/browser_studio_authority.py \
      http://127.0.0.1:8768/local/ browser-studio-authority.json

This is synthetic browser evidence. It does not certify a physical phone,
headset, camera, hand, AR, or VR device.
"""

import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8768/local/"
REPORT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("browser-studio-authority.json")


async def wait_connected(page):
    await page.locator("#vivoStudioAuthorityBridge [data-vivo-authority-status]").wait_for(state="visible", timeout=20000)
    deadline = asyncio.get_running_loop().time() + 20
    while asyncio.get_running_loop().time() < deadline:
        if await page.locator("#vivoStudioAuthorityBridge [data-vivo-authority-status]").inner_text() == "CONNECTED":
            return
        await asyncio.sleep(0.1)
    status = await page.locator("#vivoStudioAuthorityBridge [data-vivo-authority-status]").inner_text()
    message = await page.locator("#vivoStudioAuthorityBridge [data-vivo-authority-message]").inner_text()
    raise AssertionError(f"Studio authority bridge did not connect: status={status!r}, message={message!r}")


async def wait_for_binding(page, expected_q0):
    deadline = asyncio.get_running_loop().time() + 20
    while asyncio.get_running_loop().time() < deadline:
        debug = await page.evaluate("window.__vivoStudioAuthorityBridge.debug()")
        if abs((debug.get("binding", {}).get("q", [float("nan")])[0]) - expected_q0) < 1e-6:
            return
        await asyncio.sleep(0.1)
    raise AssertionError(f"Studio authority binding did not reach x1={expected_q0}")


async def wait_for_conflict(page, expected_local_q0, expected_remote_q0):
    deadline = asyncio.get_running_loop().time() + 20
    while asyncio.get_running_loop().time() < deadline:
        debug = await page.evaluate("window.__vivoStudioAuthorityBridge.debug()")
        local_q = debug.get("localProjection") or []
        status = await page.locator("#vivoStudioAuthorityBridge [data-vivo-authority-status]").inner_text()
        if (status == "CONFLICT" and debug.get("publishConflict") and debug.get("publishConflict", {}).get("acceptedBinding")
                and debug.get("localDiverged") is True and debug.get("publishConflict", {}).get("acceptedBinding", {}).get("q", [float("nan")])[0] == expected_remote_q0
                and local_q and abs(local_q[0] - expected_local_q0) < 1e-6):
            return debug
        await asyncio.sleep(0.1)
    raise AssertionError(f"Studio authority bridge did not expose an explicit publish conflict: {debug}")


async def main():
    page_errors = []
    camera_calls = []
    rpc_ops = {"one": [], "two": []}
    evidence = {}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        contexts = []
        pages = []
        try:
            for seat in ("one", "two"):
                context = await browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
                contexts.append(context)
                await context.add_init_script("""
                    window.__vivoCameraCalls = 0;
                    if (navigator.mediaDevices) {
                      const original = navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);
                      navigator.mediaDevices.getUserMedia = (...args) => {
                        window.__vivoCameraCalls++;
                        return Promise.reject(new Error('browser smoke camera gate'));
                      };
                      window.__vivoOriginalGetUserMedia = !!original;
                    }
                """)
                page = await context.new_page()
                pages.append(page)
                page.on("pageerror", lambda error, seat=seat: page_errors.append({"seat": seat, "message": str(error)}))
                page.on("request", lambda request, seat=seat: rpc_ops[seat].append(json.loads(request.post_data or "{}").get("op"))
                    if "/api/local/rpc" in request.url and request.post_data else None)
                await page.goto(BASE.rstrip("/") + "/?vivoAuthority=1&seat=" + seat, wait_until="domcontentloaded", timeout=60000)
                await wait_connected(page)
            initial_one = await pages[0].evaluate("window.__vivoStudioAuthorityBridge.debug()")
            initial_two = await pages[1].evaluate("window.__vivoStudioAuthorityBridge.debug()")
            assert initial_one["worldEyesIndependent"] and initial_two["worldEyesIndependent"]
            assert initial_one["acceptedEntityQ"] == [-1.2, -0.15, 0.25, 0]
            assert initial_two["authorityEye"]["q"] == [0, 0, 0, 0]

            # Change only the rich Studio node, then publish through the explicit
            # binding command. The authority maps no velocities/edges/material.
            first_publish = await pages[0].evaluate("""
                () => {
                  const app = window.FieldApp;
                  app.engine.q[55 * 9] = 2.5;
                  return window.__vivoStudioAuthorityBridge.publish();
                }
            """)
            assert first_publish["status"] == "accepted", first_publish
            await wait_for_binding(pages[1], 2.5)
            after_publish = await pages[1].evaluate("window.__vivoStudioAuthorityBridge.debug()")
            assert after_publish["acceptedEntityQ"] == [-1.2, -0.15, 0.25, 0]
            assert after_publish["binding"]["q"] == [2.5, after_publish["binding"]["q"][1], after_publish["binding"]["q"][2], after_publish["binding"]["q"][3]]
            assert after_publish["lastApplied"]["q"][0] == 2.5

            # Select a second existing Full Studio node explicitly.  Only its
            # accepted projection changes; the canonical Workpiece entity and
            # the already accepted Echo projection remain independent.
            workpiece_publish = await pages[0].evaluate("""
                async () => {
                  const bridge = window.__vivoStudioAuthorityBridge;
                  await bridge.selectBinding('studio.node.workpiece');
                  window.FieldApp.engine.q[56 * 9] = 1.75;
                  return bridge.publish();
                }
            """)
            assert workpiece_publish["status"] == "accepted", workpiece_publish
            await pages[1].evaluate("window.__vivoStudioAuthorityBridge.selectBinding('studio.node.workpiece')")
            await wait_for_binding(pages[1], 1.75)
            workpiece_state = await pages[1].evaluate("window.__vivoStudioAuthorityBridge.debug()")
            assert workpiece_state["bindingId"] == "studio.node.workpiece"
            assert workpiece_state["selectedEntityId"] == "workpiece"
            assert workpiece_state["acceptedEntityQ"] == [0.15, 0.75, 0.25, 0]
            assert workpiece_state["bindings"] == ["studio.node.echo", "studio.node.workpiece", "studio.node.portal"]
            await pages[0].evaluate("window.__vivoStudioAuthorityBridge.selectBinding('studio.node.echo')")
            await pages[1].evaluate("window.__vivoStudioAuthorityBridge.selectBinding('studio.node.echo')")
            await wait_for_binding(pages[1], 2.5)

            # A real concurrent Studio edit must not be silently overwritten.
            # Seat one keeps its local projection while seat two publishes a
            # different projection; the first retry is only an explicit
            # conflict acknowledgement, and the second retry is the explicit
            # replacement action.
            await pages[0].evaluate("window.FieldApp.engine.q[55 * 9] = 2.8")
            await pages[1].evaluate("window.FieldApp.engine.q[55 * 9] = 3.5")
            second_publish = await pages[1].evaluate("window.__vivoStudioAuthorityBridge.publish()")
            assert second_publish["status"] == "accepted", second_publish
            conflict = await wait_for_conflict(pages[0], 2.8, 3.5)
            assert conflict["publishConflict"]["acceptedBinding"]["q"][0] == 3.5
            blocked = await pages[0].evaluate("window.__vivoStudioAuthorityBridge.publish()")
            assert blocked["status"] == "rejected" and blocked["code"] == "STUDIO_CONFLICT", blocked
            assert await pages[0].locator("#vivoStudioAuthorityBridge [data-vivo-authority-status]").inner_text() == "CONFLICT"
            assert "publish again" in (await pages[0].locator("#vivoStudioAuthorityBridge [data-vivo-authority-message]").inner_text()).lower()
            armed = await pages[0].evaluate("window.__vivoStudioAuthorityBridge.debug()")
            assert armed["publishOverrideArmed"] is True

            # A newer accepted edit after the acknowledgement re-arms the
            # resolution rather than allowing the older acknowledgement to
            # become a silent last-writer-wins authorization.
            await pages[1].evaluate("window.FieldApp.engine.q[55 * 9] = 3.9")
            third_publish = await pages[1].evaluate("window.__vivoStudioAuthorityBridge.publish()")
            assert third_publish["status"] == "accepted", third_publish
            newer_conflict = await wait_for_conflict(pages[0], 2.8, 3.9)
            assert newer_conflict["publishOverrideArmed"] is False
            rearmed = await pages[0].evaluate("window.__vivoStudioAuthorityBridge.publish()")
            assert rearmed["status"] == "rejected" and rearmed["code"] == "STUDIO_CONFLICT", rearmed
            assert (await pages[0].evaluate("window.__vivoStudioAuthorityBridge.debug()"))["publishOverrideArmed"] is True
            replacement = await pages[0].evaluate("window.__vivoStudioAuthorityBridge.publish()")
            assert replacement["status"] == "accepted", replacement
            await wait_for_binding(pages[1], 2.8)
            after_conflict_resolution = await pages[0].evaluate("window.__vivoStudioAuthorityBridge.debug()")
            assert after_conflict_resolution["localProjection"][0] == 2.8
            assert after_conflict_resolution["localDiverged"] is False
            assert after_conflict_resolution["publishConflict"] is None, after_conflict_resolution

            # Move only seat one's authority Eye using the existing accepted API;
            # seat two must retain its own Eye and the Studio bridge must not call
            # moveEye while applying the shared object.
            await pages[0].evaluate("""
                async () => {
                  const bridge = window.__vivoStudioAuthorityBridge;
                  const eye = bridge.debug().authorityEye;
                  eye.q[0] = 0.7;
                  eye.slice.x1 = 0.7;
                  await bridge.transport.moveEye(eye, eye.revision);
                }
            """)
            await pages[1].wait_for_timeout(1200)
            one_eye = await pages[0].evaluate("window.__vivoStudioAuthorityBridge.debug().authorityEye.q")
            two_eye = await pages[1].evaluate("window.__vivoStudioAuthorityBridge.debug().authorityEye.q")
            assert one_eye[0] == 0.7 and two_eye[0] == 0

            # Local divergence is visible and is not silently overwritten by a
            # remote refresh; the explicit Apply action resolves it.
            await pages[1].evaluate("window.FieldApp.engine.q[55 * 9] = 3.5")
            divergent = await pages[1].evaluate("window.__vivoStudioAuthorityBridge.debug()")
            assert divergent["localDiverged"] is True
            await pages[1].evaluate("window.__vivoStudioAuthorityBridge.applyAccepted()")
            resolved = await pages[1].evaluate("window.__vivoStudioAuthorityBridge.debug()")
            assert resolved["localDiverged"] is False and resolved["localProjection"][0] == 2.8

            # The explicit fork is accepted by the authority and includes the
            # binding, but no merge/replay is attempted.
            branch = await pages[0].evaluate("window.__vivoStudioAuthorityBridge.forkOffline()")
            assert branch["mode"] == "offline"
            assert branch["snapshot"]["studioBindings"]["studio.node.echo"]["q"][0] == 2.8
            assert branch["snapshot"]["branch"]["parentWorldId"] == "vivo.local.workshop"
            camera_calls = await pages[0].evaluate("window.__vivoCameraCalls") + await pages[1].evaluate("window.__vivoCameraCalls")
            evidence = {"initialOne": initial_one, "initialTwo": initial_two, "afterPublish": after_publish,
                        "workpiecePublish": workpiece_publish, "workpieceState": workpiece_state,
                        "conflict": conflict, "afterConflictResolution": after_conflict_resolution,
                        "oneEye": one_eye, "twoEye": two_eye, "resolved": resolved, "offlineBranch": {
                            "worldId": branch["worldId"], "authorityId": branch["authorityId"], "parentWorldId": branch["parentWorldId"]}}
        finally:
            await browser.close()
    assert camera_calls == 0, camera_calls
    assert "moveEye" not in rpc_ops["two"], rpc_ops
    assert not page_errors, page_errors
    report = {"schema": "vivo.browser-studio-authority/1", "physicalDeviceValidated": False,
              "cameraCalls": camera_calls, "rpcOps": rpc_ops, "pageErrors": page_errors, "evidence": evidence}
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
