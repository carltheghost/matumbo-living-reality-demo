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
            await pages[0].evaluate("""
                () => {
                  const app = window.FieldApp;
                  app.engine.q[55 * 9] = 2.5;
                  return window.__vivoStudioAuthorityBridge.publish();
                }
            """)
            await wait_for_binding(pages[1], 2.5)
            after_publish = await pages[1].evaluate("window.__vivoStudioAuthorityBridge.debug()")
            assert after_publish["acceptedEntityQ"] == [-1.2, -0.15, 0.25, 0]
            assert after_publish["binding"]["q"] == [2.5, after_publish["binding"]["q"][1], after_publish["binding"]["q"][2], after_publish["binding"]["q"][3]]
            assert after_publish["lastApplied"]["q"][0] == 2.5

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
            assert resolved["localDiverged"] is False and resolved["localProjection"][0] == 2.5

            # The explicit fork is accepted by the authority and includes the
            # binding, but no merge/replay is attempted.
            branch = await pages[0].evaluate("window.__vivoStudioAuthorityBridge.forkOffline()")
            assert branch["mode"] == "offline"
            assert branch["snapshot"]["studioBindings"]["studio.node.echo"]["q"][0] == 2.5
            assert branch["snapshot"]["branch"]["parentWorldId"] == "vivo.local.workshop"
            camera_calls = await pages[0].evaluate("window.__vivoCameraCalls") + await pages[1].evaluate("window.__vivoCameraCalls")
            evidence = {"initialOne": initial_one, "initialTwo": initial_two, "afterPublish": after_publish,
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
