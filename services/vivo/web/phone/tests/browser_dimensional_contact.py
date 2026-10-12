"""Chromium coverage for explicit higher-dimensional touch/hand contacts.

The test uses synthetic PointerEvents and the mounted synthetic-landmark
entrypoint. It exercises the real phone route, worker, renderer inverse,
local CAS/idempotency and IndexedDB boundary; it is not physical camera or
hand-tracking acceptance.
"""

from __future__ import annotations

import json
import shutil
import sys

from playwright.sync_api import sync_playwright


def dispatch_pointer(page, kind: str, pointer_id: int, x: float, y: float) -> None:
    page.evaluate(
        """
        ({ kind, pointerId, x, y }) => document.querySelector('#world').dispatchEvent(new PointerEvent(kind, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: 'touch',
          isPrimary: pointerId === 101,
          clientX: x,
          clientY: y,
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
    page.locator("#createD").select_option("11")
    page.get_by_role("button", name="Enter local Vivo").click()
    page.wait_for_selector("#phoneFieldAtlas")
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
    install_pointer_shim(page)


def reopen_local(page) -> None:
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#enterPhoneLocal")
    page.get_by_role("button", name="Enter local Vivo").click()
    page.wait_for_selector("#phoneFieldAtlas")
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
    install_pointer_shim(page)


def open_phone_panel(page) -> None:
    page.locator("#phonePanelButton").click()
    page.wait_for_selector("#phoneContactMode")
    assert page.locator("#phoneContactMode").is_visible()
    assert page.locator("#phoneAxis").is_visible()


def set_contact_mode(page, axis: int, mode: str = "dimensional") -> None:
    page.locator("#phoneAxis").select_option(str(axis))
    page.locator("#phoneContactMode").select_option(mode)
    if mode == "dimensional":
        page.wait_for_function(
            "() => document.querySelector('#phoneContactModeState').textContent.includes('DIMENSIONAL CONTACT')"
        )
    else:
        page.wait_for_function(
            "() => document.querySelector('#phoneContactModeState').textContent.includes('SURFACE CONTACT')"
        )


def object_point(page, object_id: str) -> dict[str, float]:
    page.wait_for_function(
        f"() => Boolean(window.VivaShared?.R?.screen?.find(point => point.id === {json.dumps(object_id)}))"
    )
    return page.evaluate(
        "objectId => { const point = window.VivaShared.R.screen.find(item => item.id === objectId); return { x: point.x, y: point.y }; }",
        object_id,
    )


def scope(page, object_id: str | None = None) -> dict:
    return page.evaluate(
        """
        async objectId => {
          const value = await window.VivaPhoneEngine.snapshot();
          const eye = value.eyes[value.currentEyeId];
          const space = value.snapshot.spaces[eye.spaceId];
          return {
            worldId: value.snapshot.worldId,
            branchId: value.branchId,
            eyeId: value.currentEyeId,
            spaceId: eye.spaceId,
            returnDepth: eye.returnStack.length,
            entity: objectId ? space.entities[objectId] : null,
            operations: value.snapshot.localOperationResults || [],
            persistence: value.persistence,
          };
        }
        """,
        object_id,
    )


def preview_state(page, object_id: str) -> dict:
    return page.evaluate(
        """
        objectId => {
          const interaction = window.VivaPhoneEngine.interaction();
          const model = window.VivaPhoneEngine.fieldWorld();
          return {
            contacts: interaction.contacts.filter(item => item.objectId === objectId),
            preview: model.previews.find(item => item.entityId === objectId) || null,
            entity: model.entities.find(item => item.id === objectId) || null,
          };
        }
        """,
        object_id,
    )


def wait_new_operation(page, entity_id: str, prior_ids: list[str], space_id: str) -> dict:
    page.wait_for_function(
        """
        ({ entityId, priorIds, spaceId }) => window.VivaPhoneEngine.snapshot().then(value =>
          (value.snapshot.localOperationResults || []).some(item =>
            !priorIds.includes(item.operationId)
            && item.identity?.entityId === entityId
            && item.identity?.spaceId === spaceId))
        """,
        arg={"entityId": entity_id, "priorIds": prior_ids, "spaceId": space_id},
    )
    return page.evaluate(
        """
        ({ entityId, priorIds, spaceId }) => window.VivaPhoneEngine.snapshot().then(value => ({
          value,
          matches: (value.snapshot.localOperationResults || []).filter(item =>
            !priorIds.includes(item.operationId)
            && item.identity?.entityId === entityId
            && item.identity?.spaceId === spaceId),
        }))
        """,
        {"entityId": entity_id, "priorIds": prior_ids, "spaceId": space_id},
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


def assert_dimensional_preview(value: dict, axis: int, contact_count: int | None = None, require_delta: bool = True) -> None:
    contacts = value["contacts"]
    if contact_count is not None:
        assert len(contacts) == contact_count, value
    assert contacts, value
    for contact in contacts:
        metadata = contact["metadata"]
        assert metadata["contactMode"] == "dimensional", value
        assert metadata["activeAxis"] == axis, value
        assert metadata["positionAxes"] == [axis], value
        assert metadata["inverseAxes"] == [axis, 2, 1], value
    preview = value["preview"]
    assert preview and len(preview["delta"]) == 11, value
    if require_delta:
        assert abs(preview["delta"][axis]) > 1e-5, value
        for index, amount in enumerate(preview["delta"]):
            if index != axis:
                assert abs(amount) < 1e-8, value
    else:
        assert all(abs(amount) < 1e-8 for amount in preview["delta"]), value


def run_desktop(page, route: str, requests: list[str], page_errors: list[str]) -> dict:
    enter_local(page, route, "vivo.phone.dimensional-contact-browser-desktop")
    open_phone_panel(page)
    assert page.locator("#phoneAxis option").count() == 11
    assert page.locator("#phoneContactMode option[value='dimensional']").count() == 1

    set_contact_mode(page, 3, "dimensional")
    root_before = scope(page, "relic")
    root_prior_operation_ids = [item["operationId"] for item in root_before["operations"]]
    relic = object_point(page, "relic")
    dispatch_pointer(page, "pointerdown", 101, relic["x"], relic["y"])
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.some(item => item.contactId === 'touch:101')")
    dispatch_pointer(page, "pointermove", 101, relic["x"] + 18, relic["y"] - 8)
    page.wait_for_function("() => Boolean(window.VivaPhoneEngine.fieldWorld().previews.find(item => item.entityId === 'relic'))")
    first_preview = preview_state(page, "relic")
    assert_dimensional_preview(first_preview, 3, 1)
    assert first_preview["preview"]["geometry"] == root_before["entity"]["geometry"], first_preview
    candidate = dict(first_preview["preview"])

    # Changing both controls during a held contact must not reinterpret it.
    set_contact_mode(page, 4, "surface")
    dispatch_pointer(page, "pointermove", 101, relic["x"] + 42, relic["y"] - 2)
    held_after_change = preview_state(page, "relic")
    assert_dimensional_preview(held_after_change, 3, 1)
    assert "held contacts keep" in page.locator("#phoneContactModeState").inner_text()
    candidate = dict(held_after_change["preview"])
    dispatch_pointer(page, "pointerup", 101, 0, 0)
    dispatch_pointer(page, "pointerup", 101, 0, 0)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.length === 0")
    accepted = wait_new_operation(page, "relic", root_prior_operation_ids, "root")
    matches = accepted["matches"]
    assert len(matches) == 1, matches
    assert matches[0]["result"]["changed"] is True, matches
    accepted_operation = matches[0]
    operation_id = accepted_operation["operationId"]
    candidate["baseRevision"] = accepted_operation["identity"]["baseRevision"]
    assert accepted["value"]["snapshot"]["spaces"]["root"]["entities"]["relic"]["geometry"] == root_before["entity"]["geometry"]

    # Exact replay is idempotent; a different operation at the old revision is
    # stale and cannot double-apply the dimensional move.
    replay = page.evaluate(
        """
        async ({ before, candidate, operationId }) => {
          const expected = {
            worldId: before.worldId, branchId: before.branchId, eyeId: before.eyeId,
            spaceId: 'root', entityId: 'relic', baseRevision: candidate.baseRevision,
            operationId,
          };
          return window.VivaPhoneEngine.applyLocalTransform('relic', candidate.delta, candidate.geometry, expected);
        }
        """,
        {"before": root_before, "candidate": candidate, "operationId": operation_id},
    )
    assert replay["replayed"] is True, replay
    stale_message = page.evaluate(
        """
        async ({ before, candidate }) => {
          try {
            await window.VivaPhoneEngine.applyLocalTransform('relic', candidate.delta, candidate.geometry, {
              worldId: before.worldId, branchId: before.branchId, eyeId: before.eyeId,
              spaceId: 'root', entityId: 'relic', baseRevision: candidate.baseRevision,
              operationId: 'dimensional-contact-stale-revision',
            });
            return '';
          } catch (error) { return error.message; }
        }
        """,
        {"before": root_before, "candidate": candidate},
    )
    assert "STALE_LOCAL_PREVIEW" in stale_message, stale_message

    # An Eye transition fences the held local contact instead of applying it
    # against a different Eye identity.
    set_contact_mode(page, 4, "dimensional")
    workpiece_before_eye = scope(page, "workpiece")
    workpiece = object_point(page, "workpiece")
    dispatch_pointer(page, "pointerdown", 111, workpiece["x"], workpiece["y"])
    dispatch_pointer(page, "pointermove", 111, workpiece["x"] + 16, workpiece["y"] + 8)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.some(item => item.contactId === 'touch:111')")
    page.locator("#phoneNewEye").click()
    page.wait_for_function(
        "oldEye => window.VivaPhoneEngine.interaction().contacts.length === 0 && document.querySelectorAll('#phoneEyeSelect option').length >= 2 && window.VivaPhoneEngine.snapshot().then(value => value.currentEyeId !== oldEye)",
        arg=workpiece_before_eye["eyeId"],
    )
    assert not page.evaluate("() => window.VivaPhoneEngine.fieldWorld().previews.some(item => item.entityId === 'workpiece')")
    after_eye = scope(page, "workpiece")
    assert not any(item["operationId"] == "touch:111" for item in after_eye["operations"])

    # An explicit offline branch likewise fences a held contact and preserves
    # the branch boundary; this remains phone-local and sends nothing.
    workpiece_branch_before = scope(page, "workpiece")
    workpiece = object_point(page, "workpiece")
    dispatch_pointer(page, "pointerdown", 112, workpiece["x"], workpiece["y"])
    dispatch_pointer(page, "pointermove", 112, workpiece["x"] - 15, workpiece["y"] + 6)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.some(item => item.contactId === 'touch:112')")
    page.locator("#phoneFork").click()
    page.wait_for_function(
        "oldBranch => window.VivaPhoneEngine.interaction().contacts.length === 0 && window.VivaPhoneEngine.snapshot().then(value => value.branchId !== oldBranch)",
        arg=workpiece_branch_before["branchId"],
    )
    after_branch = scope(page, "workpiece")
    assert not page.evaluate("() => window.VivaPhoneEngine.fieldWorld().previews.some(item => item.entityId === 'workpiece')")
    assert after_branch["entity"]["id"] == "workpiece"

    # Dimensional bimanual input still changes only the selected canonical
    # coordinate while scale/rotation come from visible inverse geometry.
    set_contact_mode(page, 3, "dimensional")
    workpiece = object_point(page, "workpiece")
    dispatch_pointer(page, "pointerdown", 121, workpiece["x"] - 12, workpiece["y"])
    dispatch_pointer(page, "pointerdown", 122, workpiece["x"] + 12, workpiece["y"])
    dispatch_pointer(page, "pointermove", 121, workpiece["x"] - 20, workpiece["y"] + 16)
    dispatch_pointer(page, "pointermove", 122, workpiece["x"] + 20, workpiece["y"] - 16)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.filter(item => item.objectId === 'workpiece').length === 2")
    pair_preview = preview_state(page, "workpiece")
    assert_dimensional_preview(pair_preview, 3, 2)
    assert pair_preview["preview"]["geometry"]["scale"] > 1.05, pair_preview
    assert abs(pair_preview["preview"]["geometry"]["rotation"]) > 0.05, pair_preview
    pair_prior_operation_ids = [item["operationId"] for item in scope(page, "workpiece")["operations"]]
    dispatch_pointer(page, "pointerup", 121, 0, 0)
    dispatch_pointer(page, "pointerup", 122, 0, 0)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.length === 0")
    wait_new_operation(page, "workpiece", pair_prior_operation_ids, "root")

    # A drag over a portal remains an ordinary local drag; it cannot silently
    # enter the nested space.
    page.locator("#phoneFieldEntity").select_option("portal")
    page.wait_for_function("() => document.querySelector('#phoneFieldEntity').value === 'portal'")
    portal_before = scope(page, "portal")
    portal_prior_operation_ids = [item["operationId"] for item in portal_before["operations"]]
    portal = object_point(page, "portal")
    dispatch_pointer(page, "pointerdown", 131, portal["x"], portal["y"])
    dispatch_pointer(page, "pointermove", 131, portal["x"] + 14, portal["y"] + 4)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.some(item => item.contactId === 'touch:131')")
    assert scope(page)["spaceId"] == "root"
    dispatch_pointer(page, "pointerup", 131, 0, 0)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.length === 0")
    wait_new_operation(page, "portal", portal_prior_operation_ids, "root")

    # Enter the predefined inner world and exercise the actual x11 route.
    page.locator("#phoneFieldEntity").select_option("portal")
    page.locator("#phoneEnterNested").click()
    page.wait_for_function(
        "() => window.VivaPhoneEngine.snapshot().then(value => value.eyes[value.currentEyeId].spaceId === 'inner')"
    )
    inner_before = scope(page, "innerRelic")
    inner_prior_operation_ids = [item["operationId"] for item in inner_before["operations"]]
    assert inner_before["returnDepth"] == 1, inner_before
    assert inner_before["entity"]["dimension"] == 11, inner_before
    set_contact_mode(page, 10, "dimensional")

    # The mounted synthetic hand path reaches the same captured mapping; an
    # empty frame is a deterministic tracking-loss cancellation.
    inner_point = object_point(page, "innerRelic")
    viewport = page.evaluate("() => ({ width: innerWidth, height: innerHeight })")
    hands = [
        pinch_hand_at(inner_point["x"] - 10, inner_point["y"], viewport["width"], viewport["height"]),
        pinch_hand_at(inner_point["x"] + 10, inner_point["y"], viewport["width"], viewport["height"]),
    ]
    synthetic = page.evaluate(
        "hands => window.VivaPhoneEngine.syntheticHandLandmarks(hands, { handednesses: ['Left', 'Right'] })",
        hands,
    )
    assert synthetic == {"accepted": True, "hands": 2, "landmarksPerHand": 21}, synthetic
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.filter(item => item.source.startsWith('hand:')).length === 2")
    hand_preview = preview_state(page, "innerRelic")
    assert_dimensional_preview(hand_preview, 10, 2, require_delta=False)
    moved_hands = [
        pinch_hand_at(inner_point["x"] + 4, inner_point["y"] + 8, viewport["width"], viewport["height"]),
        pinch_hand_at(inner_point["x"] + 24, inner_point["y"] + 8, viewport["width"], viewport["height"]),
    ]
    page.evaluate("hands => window.VivaPhoneEngine.syntheticHandLandmarks(hands, { handednesses: ['Left', 'Right'] })", moved_hands)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.filter(item => item.source.startsWith('hand:')).length === 2")
    moved_hand_preview = preview_state(page, "innerRelic")
    assert_dimensional_preview(moved_hand_preview, 10, 2)
    set_contact_mode(page, 3, "surface")
    page.evaluate("hands => window.VivaPhoneEngine.syntheticHandLandmarks(hands, { handednesses: ['Left', 'Right'] })", moved_hands)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.filter(item => item.source.startsWith('hand:')).length === 2")
    held_hands_after_change = preview_state(page, "innerRelic")
    assert_dimensional_preview(held_hands_after_change, 10, 2)
    # An empty mounted synthetic frame is a deterministic tracking-loss
    # cancellation; it must not become an accepted operation.
    page.evaluate("() => window.VivaPhoneEngine.syntheticHandLandmarks([])")
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.length === 0")
    assert not page.evaluate("() => window.VivaPhoneEngine.fieldWorld().previews.some(item => item.entityId === 'innerRelic')")

    # A touch release in the nested space is accepted on q[10], then survives
    # explicit save, return/re-enter, and a real page reload with identity.
    set_contact_mode(page, 10, "dimensional")
    inner_point = object_point(page, "innerRelic")
    dispatch_pointer(page, "pointerdown", 141, inner_point["x"], inner_point["y"])
    dispatch_pointer(page, "pointermove", 141, inner_point["x"] + 24, inner_point["y"] - 3)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.some(item => item.contactId === 'touch:141')")
    inner_preview = preview_state(page, "innerRelic")
    assert_dimensional_preview(inner_preview, 10, 1)
    inner_candidate = dict(inner_preview["preview"])
    dispatch_pointer(page, "pointerup", 141, 0, 0)
    dispatch_pointer(page, "pointerup", 141, 0, 0)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.length === 0")
    inner_accepted = wait_new_operation(page, "innerRelic", inner_prior_operation_ids, "inner")
    assert len(inner_accepted["matches"]) == 1, inner_accepted
    inner_operation = inner_accepted["matches"][0]["operationId"]
    inner_after = scope(page, "innerRelic")
    assert inner_after["entity"]["q"][10] != inner_before["entity"]["q"][10], inner_after
    page.locator("#phonePersist").click()
    page.wait_for_function("() => window.VivaPhoneEngine.snapshot().then(value => value.persistence.state === 'saved')")

    page.locator("#phoneExitNested").click()
    page.wait_for_function("() => window.VivaPhoneEngine.snapshot().then(value => value.eyes[value.currentEyeId].spaceId === 'root')")
    page.locator("#phoneFieldEntity").select_option("portal")
    page.locator("#phoneEnterNested").click()
    page.wait_for_function("() => window.VivaPhoneEngine.snapshot().then(value => value.eyes[value.currentEyeId].spaceId === 'inner')")
    reentered = scope(page, "innerRelic")
    assert reentered["worldId"] == inner_after["worldId"], reentered
    assert reentered["branchId"] == inner_after["branchId"], reentered
    assert reentered["eyeId"] == inner_after["eyeId"], reentered
    assert reentered["entity"]["id"] == "innerRelic", reentered
    assert abs(reentered["entity"]["q"][10] - inner_after["entity"]["q"][10]) < 0.2, (reentered, inner_after)

    page.locator("#phonePersist").click()
    page.wait_for_function("() => window.VivaPhoneEngine.snapshot().then(value => value.persistence.state === 'saved')")
    reopen_local(page)
    reloaded = scope(page, "innerRelic")
    assert reloaded["worldId"] == inner_after["worldId"], reloaded
    assert reloaded["branchId"] == inner_after["branchId"], reloaded
    assert reloaded["eyeId"] == inner_after["eyeId"], reloaded
    assert reloaded["spaceId"] == "inner" and reloaded["returnDepth"] == 1, reloaded
    assert reloaded["entity"]["id"] == "innerRelic", reloaded
    assert abs(reloaded["entity"]["q"][10] - inner_after["entity"]["q"][10]) < 0.2, (reloaded, inner_after)
    assert any(item["operationId"] == inner_operation for item in reloaded["operations"]), reloaded
    assert not any("/readyz" in url or "/healthz" in url for url in requests), requests
    assert page.evaluate("() => window.__phoneCameraCalls") == 0
    assert not page_errors, page_errors
    return {
        "rootAxis": 3,
        "innerAxis": 10,
        "rootOperation": operation_id,
        "innerOperation": inner_operation,
        "branchId": reloaded["branchId"],
        "eyeId": reloaded["eyeId"],
        "worldId": reloaded["worldId"],
        "cameraCalls": 0,
    }


def run_mobile(page, route: str, requests: list[str], page_errors: list[str]) -> dict:
    enter_local(page, route, "vivo.phone.dimensional-contact-browser-mobile")
    open_phone_panel(page)
    set_contact_mode(page, 3, "dimensional")
    assert page.locator("#phoneContactMode").is_visible()
    point = object_point(page, "relic")
    dispatch_pointer(page, "pointerdown", 201, point["x"], point["y"])
    dispatch_pointer(page, "pointermove", 201, point["x"] + 16, point["y"] + 4)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.some(item => item.contactId === 'touch:201')")
    value = preview_state(page, "relic")
    assert_dimensional_preview(value, 3, 1)
    dispatch_pointer(page, "pointercancel", 201, 0, 0)
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.length === 0")
    assert page.locator("#phoneFieldAtlas").bounding_box()
    assert page.evaluate("() => window.__phoneCameraCalls") == 0
    assert not any("/readyz" in url or "/healthz" in url for url in requests), requests
    assert not page_errors, page_errors
    return {"viewport": [390, 844], "axis": 3, "cancelled": True, "cameraCalls": 0}


def main(base_url: str) -> None:
    route = base_url.rstrip("/") + "/services/vivo/web/phone/"
    with sync_playwright() as playwright:
        launch_options = {"headless": True, "args": ["--no-sandbox", "--disable-gpu"]}
        executable = shutil.which("chromium") or shutil.which("chromium-browser")
        if executable:
            launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)
        camera_script = """
        (() => {
          window.__phoneCameraCalls = 0;
          const media = navigator.mediaDevices || (navigator.mediaDevices = {});
          media.getUserMedia = async () => {
            window.__phoneCameraCalls += 1;
            throw new Error('camera must stay off during synthetic dimensional coverage');
          };
        })();
        """

        desktop_context = browser.new_context(viewport={"width": 1000, "height": 900})
        desktop_context.set_default_timeout(12000)
        desktop_context.add_init_script(camera_script)
        desktop = desktop_context.new_page()
        desktop_errors: list[str] = []
        desktop_requests: list[str] = []
        desktop.on("pageerror", lambda error: desktop_errors.append(str(error)))
        desktop.on("request", lambda request: desktop_requests.append(request.url))
        desktop_result = run_desktop(desktop, route, desktop_requests, desktop_errors)

        mobile_context = browser.new_context(viewport={"width": 390, "height": 844})
        mobile_context.set_default_timeout(12000)
        mobile_context.add_init_script(camera_script)
        mobile = mobile_context.new_page()
        mobile_errors: list[str] = []
        mobile_requests: list[str] = []
        mobile.on("pageerror", lambda error: mobile_errors.append(str(error)))
        mobile.on("request", lambda request: mobile_requests.append(request.url))
        mobile_result = run_mobile(mobile, route, mobile_requests, mobile_errors)

        mobile_context.close()
        desktop_context.close()
        browser.close()
        print(json.dumps({"route": route, "desktop": desktop_result, "mobile": mobile_result, "scope": "synthetic Chromium only; no physical camera/hand/device acceptance"}))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9894/")
