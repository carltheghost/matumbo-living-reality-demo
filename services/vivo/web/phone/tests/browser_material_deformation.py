"""Synthetic Chromium acceptance for the bounded phone material patch.

This exercises the real phone worker, touch adapter, detached preview,
accepted sparse propagation, reload persistence, and the existing synthetic
21-landmark hand entrypoint. It never starts a camera and does not claim
dense-volume, physical-device, or real-hand accuracy.
"""

from __future__ import annotations

import json
import os
import shutil
import sys

from playwright.sync_api import sync_playwright


def dispatch_pointer(page, kind: str, pointer_id: int, x: float, y: float) -> None:
    page.evaluate(
        """
        ({ kind, pointerId, x, y }) => document.querySelector('#world').dispatchEvent(new PointerEvent(kind, {
          bubbles: true, cancelable: true, pointerId, pointerType: 'touch',
          isPrimary: pointerId === 1, clientX: x, clientY: y,
          buttons: kind === 'pointerup' || kind === 'pointercancel' ? 0 : 1,
        }))
        """,
        {"kind": kind, "pointerId": pointer_id, "x": x, "y": y},
    )


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
    page.get_by_role("button", name="Enter local Vivo").click()
    page.wait_for_selector("#phoneFieldAtlas", state="attached")
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
    page.wait_for_function("() => (window.VivaShared?.R?.materialNodePoints || []).length === 12")
    install_pointer_shim(page)


def material_snapshot(page) -> dict:
    return page.evaluate("() => window.VivaPhoneEngine.materialSnapshot()")


def node_point(page, suffix: str = "r1c2") -> dict[str, float]:
    page.wait_for_function(
        "suffix => Boolean(window.VivaShared.R.materialNodePoints.find(point => point.nodeId.endsWith(suffix) && window.VivaShared.R.at(point.x, point.y) === 'workpiece'))",
        arg=suffix,
    )
    return page.evaluate(
        "suffix => { const point = window.VivaShared.R.materialNodePoints.find(item => item.nodeId.endsWith(suffix) && window.VivaShared.R.at(item.x, item.y) === 'workpiece'); return { x: point.x, y: point.y, nodeId: point.nodeId }; }",
        suffix,
    )


def pinch_hand_at(screen_x: float, screen_y: float, width: float, height: float) -> list[dict[str, float]]:
    video_width, video_height = 640.0, 480.0
    scale = max(width / video_width, height / video_height)
    rendered_width, rendered_height = video_width * scale, video_height * scale
    crop_x, crop_y = (rendered_width - width) / 2, (rendered_height - height) / 2
    normalized_x = 1 - (screen_x + crop_x) / rendered_width
    normalized_y = (screen_y + crop_y) / rendered_height
    base = [(0, 0), (.08, -.03), (.13, -.06), (.16, -.1), (.195, -.012)]
    points = [(x, y) for x, y in base]
    for finger_x in (.2, .4, .6, .8):
        points.extend([(finger_x, 0), (finger_x, -.12), (finger_x, -.25), (finger_x, -.05)])
    shift_x, shift_y = normalized_x - .1975, normalized_y + .031
    return [{"x": x + shift_x, "y": y + shift_y, "z": 0} for x, y in points]


def open_hand_from_pinch(hand: list[dict[str, float]]) -> list[dict[str, float]]:
    result = [dict(point) for point in hand]
    # Separate thumb/index and extend every fingertip for an explicit open
    # frame, then return to the reproducible pinch frame. The camera is never
    # started by this test.
    result[4]["x"] += 0.25
    result[4]["y"] -= 0.12
    for index in (8, 12, 16, 20):
        result[index]["y"] -= 0.2
    # Keep the smallest fingertip beyond the same extension threshold so the
    # frame is classified as open and arms the following pinch frame.
    result[20]["y"] -= 0.1
    return result


def run_flow(page, route: str, world_id: str, include_hand: bool) -> dict:
    requests: list[str] = []
    page_errors: list[str] = []
    page.on("request", lambda request: requests.append(request.url))
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    enter_local(page, route, world_id)

    before = material_snapshot(page)
    body_before = before["body"]
    geometry_scale = page.evaluate("() => window.VivaPhoneEngine.snapshot().then(value => value.snapshot.spaces.root.entities.workpiece.geometry.scale)")
    point = node_point(page)
    dispatch_pointer(page, "pointerdown", 701, point["x"], point["y"])
    page.wait_for_function("() => window.VivaPhoneEngine.materialContacts().length === 1")
    page.wait_for_function("() => window.VivaPhoneEngine.materialSnapshot().then(value => value.activeContacts.length === 1)")

    accepted_before_preview = material_snapshot(page)
    preview = page.evaluate(
        "({ contactId, x, y }) => window.VivaPhoneEngine.materialPreviewContact(contactId, [x + 24, y + 14])",
        {"contactId": "touch:701", "x": point["x"], "y": point["y"]},
    )
    assert preview["provisional"] is True, preview
    accepted_after_preview = material_snapshot(page)
    # The live contact clock may advance between the two worker reads. The
    # detached preview itself reports the accepted sequence it observed; the
    # unit contract test proves it cannot advance that sequence.
    assert preview["acceptedSequence"] >= accepted_before_preview["body"]["acceptedSequence"], preview
    assert accepted_after_preview["body"]["acceptedSequence"] >= preview["acceptedSequence"], accepted_after_preview
    page.wait_for_function("() => Boolean(window.VivaShared.R.materialProvisional?.provisional)")

    dispatch_pointer(page, "pointermove", 701, point["x"] + 36, point["y"] + 18)
    dispatch_pointer(page, "pointerup", 701, point["x"] + 36, point["y"] + 18)
    page.wait_for_function("() => window.VivaPhoneEngine.materialContacts().length === 0")
    page.wait_for_function(
        "revision => window.VivaPhoneEngine.materialSnapshot().then(value => Number(value.body.bodyRevision) > revision)",
        arg=body_before["bodyRevision"],
    )
    after = material_snapshot(page)
    body_after = after["body"]
    moved = body_after["nodes"][point["nodeId"]]["q"] != body_before["nodes"][point["nodeId"]]["q"]
    assert moved, {"before": body_before, "after": body_after}
    assert geometry_scale == page.evaluate("() => window.VivaPhoneEngine.snapshot().then(value => value.snapshot.spaces.root.entities.workpiece.geometry.scale)")
    assert body_after["edges"] and body_after["topologyId"] == "workpiece.patch.grid-4x3"
    assert page.evaluate("() => window.VivaShared.R.materialProvisional === null")

    # A new phone session retains accepted nodes but revives no contacts.
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#enterPhoneLocal")
    page.get_by_role("button", name="Enter local Vivo").click()
    page.wait_for_selector("#phoneFieldAtlas", state="attached")
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
    page.wait_for_function("() => window.VivaPhoneEngine.materialSnapshot().then(value => value.activeContacts.length === 0)")
    reloaded = material_snapshot(page)
    assert reloaded["body"]["bodyRevision"] >= body_after["bodyRevision"], reloaded
    assert reloaded["body"]["nodes"][point["nodeId"]]["q"] == body_after["nodes"][point["nodeId"]]["q"], reloaded

    hand_result = None
    if include_hand:
        install_pointer_shim(page)
        hand_point = node_point(page)
        viewport = page.evaluate("() => ({ width: innerWidth, height: innerHeight })")
        pinch = pinch_hand_at(hand_point["x"], hand_point["y"], viewport["width"], viewport["height"])
        page.evaluate("hand => window.VivaPhoneEngine.syntheticHandLandmarks([hand], { handednesses: ['Left'] })", open_hand_from_pinch(pinch))
        page.wait_for_timeout(80)
        page.evaluate("hand => window.VivaPhoneEngine.syntheticHandLandmarks([hand], { handednesses: ['Left'] })", pinch)
        page.wait_for_function("() => window.VivaPhoneEngine.materialContacts().length >= 1")
        hand_result = page.evaluate("() => window.VivaPhoneEngine.materialContacts()")
        assert all(item["source"]["kind"] == "finger" for item in hand_result), hand_result
        page.evaluate("() => window.VivaPhoneEngine.syntheticHandLandmarks([])")
        page.wait_for_function("() => window.VivaPhoneEngine.materialContacts().length === 0")

    assert page.evaluate("() => window.__phoneCameraCalls") == 0
    assert not any("/readyz" in url or "/healthz" in url for url in requests), requests
    assert not page_errors, page_errors
    return {
        "bodyRevision": body_after["bodyRevision"],
        "movedNode": point["nodeId"],
        "reloadedRevision": reloaded["body"]["bodyRevision"],
        "handContacts": len(hand_result or []),
        "cameraCalls": 0,
    }


def main(base_url: str) -> None:
    route = base_url.rstrip("/") + "/services/vivo/web/phone/"
    with sync_playwright() as playwright:
        executable = os.environ.get("VIVO_CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("chromium-browser")
        launch_options = {"headless": True, "args": ["--no-sandbox", "--disable-gpu"]}
        if executable:
            launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)
        init_script = """
        (() => {
          window.__phoneCameraCalls = 0;
          const media = navigator.mediaDevices || (navigator.mediaDevices = {});
          media.getUserMedia = async () => { window.__phoneCameraCalls += 1; throw new Error('camera must stay off during material coverage'); };
        })();
        """
        desktop_context = browser.new_context(viewport={"width": 1000, "height": 900})
        desktop_context.set_default_timeout(12000)
        desktop_context.add_init_script(init_script)
        desktop = desktop_context.new_page()
        desktop_result = run_flow(desktop, route, "vivo.phone.material-patch-desktop", True)

        mobile_context = browser.new_context(viewport={"width": 390, "height": 844})
        mobile_context.set_default_timeout(12000)
        mobile_context.add_init_script(init_script)
        mobile = mobile_context.new_page()
        mobile_result = run_flow(mobile, route, "vivo.phone.material-patch-mobile", False)

        mobile_context.close()
        desktop_context.close()
        browser.close()
        print(json.dumps({
            "route": route, "desktop": desktop_result, "mobile": mobile_result,
            "scope": "synthetic Chromium touch/landmark coverage only; no camera, dense volume, physical-device accuracy, or deployment claim",
        }))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9896/")
