"""Chromium coverage for phone-local multi-contact transforms.

This deliberately uses synthetic PointerEvents and the public synthetic-landmark
entrypoint. It verifies the browser wiring and persistence boundary; it is not
physical-device or camera-tracking acceptance.
"""

from __future__ import annotations

import json
import shutil
import sys
import time

from playwright.sync_api import sync_playwright


def open_world_controls(page) -> None:
    world_context = page.locator(".vivo-companion-world-context")
    if not world_context.evaluate("node => node.open"):
        page.locator(".vivo-companion-world-context > summary").click()
    page.wait_for_function("document.querySelector('.vivo-companion-world-context')?.open === true")


def dispatch_pointer(page, kind: str, pointer_id: int, x: float, y: float) -> None:
    page.evaluate(
        """
        ({ kind, pointerId, x, y }) => {
          document.querySelector('#world').dispatchEvent(new PointerEvent(kind, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType: 'touch',
            isPrimary: pointerId === 1,
            clientX: x,
            clientY: y,
            buttons: kind === 'pointerup' || kind === 'pointercancel' ? 0 : 1,
          }));
        }
        """,
        {"kind": kind, "pointerId": pointer_id, "x": x, "y": y},
    )


def object_point(page, object_id: str) -> dict[str, float]:
    page.wait_for_function(
        f"() => Boolean(window.VivaShared?.R?.screen?.find(point => point.id === {json.dumps(object_id)}))"
    )
    return page.evaluate(
        "objectId => { const point = window.VivaShared.R.screen.find(item => item.id === objectId); return { x: point.x, y: point.y }; }",
        object_id,
    )


def enter_local(page, route: str) -> None:
    response = page.goto(route, wait_until="domcontentloaded")
    assert response is not None and response.status == 200, response
    page.wait_for_selector("#enterPhoneLocal")
    page.get_by_role("button", name="Enter local Vivo").click()
    open_world_controls(page)
    page.wait_for_selector("#phoneFieldAtlas")
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")


def install_pointer_shim(page) -> None:
    page.evaluate(
        """
        () => {
          HTMLCanvasElement.prototype.setPointerCapture = () => {};
          HTMLCanvasElement.prototype.releasePointerCapture = () => {};
        }
        """
    )


def snapshot_entity(page, object_id: str) -> dict:
    return page.evaluate(
        """
        async objectId => {
          const value = await window.VivaPhoneEngine.snapshot();
          const entity = value.snapshot.spaces.root.entities[objectId];
          return { worldId: value.snapshot.worldId, branchId: value.branchId, eyeId: value.currentEyeId, entity };
        }
        """,
        object_id,
    )


def wait_revision(page, object_id: str, revision: int) -> dict:
    page.wait_for_function(
        """
        ({ objectId, revision }) => window.VivaPhoneEngine.snapshot().then(value =>
          Number(value.snapshot.spaces.root.entities[objectId]?.revision) >= revision)
        """,
        arg={"objectId": object_id, "revision": revision},
    )
    return snapshot_entity(page, object_id)


def begin_pair(page, object_id: str, first_id: int, second_id: int) -> tuple[dict, dict]:
    point = object_point(page, object_id)
    first = {"x": point["x"] - 12, "y": point["y"]}
    second = {"x": point["x"] + 12, "y": point["y"]}
    dispatch_pointer(page, "pointerdown", first_id, first["x"], first["y"])
    dispatch_pointer(page, "pointerdown", second_id, second["x"], second["y"])
    dispatch_pointer(page, "pointermove", first_id, point["x"] - 20, point["y"] + 16)
    dispatch_pointer(page, "pointermove", second_id, point["x"] + 20, point["y"] - 16)
    page.wait_for_function("() => Boolean(window.VivaPhoneEngine.fieldWorld()?.previews?.length)")
    return first, second


def run_independent_preview_refresh_regression(host_page, route: str) -> dict:
    """Keep two live object intents through an unrelated accepted solver update."""
    page = host_page.context.new_page()
    requests: list[str] = []
    page_errors: list[str] = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url))
    original_world_id = host_page.evaluate("() => localStorage.getItem('vivo.phone.worldId')")
    regression_world_id = "vivo.phone.multi-preview-refresh-regression"
    try:
        response = page.goto(route, wait_until="domcontentloaded")
        assert response is not None and response.status == 200, response
        page.evaluate(
            "worldId => localStorage.setItem('vivo.phone.worldId', worldId)",
            regression_world_id,
        )
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#enterPhoneLocal")
        page.get_by_role("button", name="Enter local Vivo").click()
        open_world_controls(page)
        page.wait_for_selector("#phoneFieldAtlas")
        page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
        install_pointer_shim(page)

        relic_before = snapshot_entity(page, "relic")
        workpiece_before = snapshot_entity(page, "workpiece")
        relic_point = object_point(page, "relic")
        workpiece_point = object_point(page, "workpiece")

        # Two separate one-contact object gestures create two candidates while
        # the second selection is active. This is the exact state that used to
        # be reduced to one global field-world preview.
        dispatch_pointer(page, "pointerdown", 40, relic_point["x"], relic_point["y"])
        dispatch_pointer(page, "pointermove", 40, relic_point["x"] + 16, relic_point["y"] + 10)
        dispatch_pointer(page, "pointerdown", 41, workpiece_point["x"], workpiece_point["y"])
        dispatch_pointer(page, "pointermove", 41, workpiece_point["x"] - 14, workpiece_point["y"] - 12)
        page.wait_for_function(
            "() => window.VivaPhoneEngine.interaction().contacts.length === 2 && window.VivaPhoneEngine.fieldWorld().previews.length === 2"
        )
        before_solver = page.evaluate(
            """
            () => {
              const model = window.VivaPhoneEngine.fieldWorld();
              return {
                previews: model.previews.map(item => ({ entityId: item.entityId, operationId: item.operationId, delta: item.delta })),
                contacts: window.VivaPhoneEngine.interaction().contacts.map(item => [item.contactId, item.objectId]),
                selected: document.querySelector('#phoneFieldEntity').value,
                applyDisabled: document.querySelector('#phoneFieldApply').disabled,
              };
            }
            """
        )
        assert {item["entityId"] for item in before_solver["previews"]} == {"relic", "workpiece"}, before_solver
        assert {tuple(item) for item in before_solver["contacts"]} == {("touch:40", "relic"), ("touch:41", "workpiece")}, before_solver
        assert before_solver["selected"] == "workpiece" and not before_solver["applyDisabled"], before_solver

        portal_result = page.evaluate(
            """
            async () => {
              const before = await window.VivaPhoneEngine.snapshot();
              const entity = before.snapshot.spaces.root.entities.portal;
              const expected = {
                worldId: before.snapshot.worldId,
                branchId: before.branchId,
                eyeId: before.currentEyeId,
                spaceId: 'root',
                entityId: 'portal',
                baseRevision: entity.revision,
                operationId: 'browser-transform:independent-preview-portal',
              };
              const result = await window.VivaPhoneEngine.applyLocalTransform(
                'portal', [0.14, 0, 0, 0], entity.geometry, expected,
              );
              return { result, beforeRevision: entity.revision };
            }
            """
        )
        # The portal edit activates the sparse chain. Let normal solver events
        # arrive, rather than merely inspecting the immediate render frame.
        page.wait_for_timeout(250)
        after_solver = page.evaluate(
            """
            () => {
              const model = window.VivaPhoneEngine.fieldWorld();
              return {
                previews: model.previews.map(item => ({ entityId: item.entityId, operationId: item.operationId, baseRevision: item.baseRevision })),
                entities: Object.fromEntries(model.entities.filter(item => ['relic', 'workpiece'].includes(item.id)).map(item => [item.id, { q: item.q, preview: item.preview }])),
                contacts: window.VivaPhoneEngine.interaction().contacts.map(item => [item.contactId, item.objectId]),
                applyDisabled: document.querySelector('#phoneFieldApply').disabled,
              };
            }
            """
        )
        assert {item["entityId"] for item in after_solver["previews"]} == {"relic", "workpiece"}, after_solver
        assert {tuple(item) for item in after_solver["contacts"]} == {("touch:40", "relic"), ("touch:41", "workpiece")}, after_solver
        assert not after_solver["applyDisabled"], after_solver
        assert all(value["preview"] for value in after_solver["entities"].values()), after_solver

        # Release in a deterministic order. Each object must keep its own
        # candidate and produce an accepted local operation, not just remain
        # painted in the renderer.
        dispatch_pointer(page, "pointerup", 40, 0, 0)
        page.wait_for_function(
            "() => window.VivaPhoneEngine.interaction().contacts.map(item => item.contactId).join(',') === 'touch:41'"
        )
        # The worker may still be persisting the first release while the
        # sparse chain emits revisions. Give that accepted operation a turn
        # before fencing the survivor's release behind it.
        page.wait_for_timeout(500)
        page.wait_for_function(
            "() => window.VivaPhoneEngine.snapshot().then(value => value.snapshot.localOperationResults.filter(item => String(item.operationId || '').startsWith('field-preview:')).length >= 1)",
        )
        page.wait_for_function(
            """
            () => window.VivaPhoneEngine.snapshot().then(value => {
              const entity = value.snapshot.spaces.root.entities.workpiece;
              const preview = window.VivaPhoneEngine.fieldWorld().previews.find(item => item.entityId === 'workpiece');
              return Boolean(preview && preview.baseRevision === entity.revision);
            })
            """
        )
        dispatch_pointer(page, "pointerup", 41, 0, 0)
        page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.length === 0")
        page.wait_for_timeout(500)
        page.wait_for_function(
            "() => window.VivaPhoneEngine.snapshot().then(value => value.snapshot.localOperationResults.filter(item => String(item.operationId || '').startsWith('field-preview:')).length >= 2)",
        )
        page.wait_for_function("() => window.VivaPhoneEngine.fieldWorld().previews.length === 0")
        released = page.evaluate(
            """
            async () => {
              const value = await window.VivaPhoneEngine.snapshot();
              return {
                relic: value.snapshot.spaces.root.entities.relic,
                workpiece: value.snapshot.spaces.root.entities.workpiece,
                operations: value.snapshot.localOperationResults.map(item => item.operationId),
              };
            }
            """
        )
        assert released["relic"]["revision"] > relic_before["entity"]["revision"], released
        assert released["workpiece"]["revision"] > workpiece_before["entity"]["revision"], released
        assert released["relic"]["q"] != relic_before["entity"]["q"], released
        assert released["workpiece"]["q"] != workpiece_before["entity"]["q"], released
        assert len([operation for operation in released["operations"] if operation.startswith("field-preview:")]) >= 2, released

        # Finally prove that the field Apply path still works after both live
        # contacts have released and their accepted transforms settled.
        relic_before_apply = snapshot_entity(page, "relic")
        apply_started = page.evaluate(
            """
            () => {
              const select = document.querySelector('#phoneFieldEntity');
              select.value = 'relic';
              select.dispatchEvent(new Event('change', { bubbles: true }));
              document.querySelector('#phoneFieldPreviewMove').click();
              const apply = document.querySelector('#phoneFieldApply');
              const enabled = !apply.disabled;
              if (enabled) apply.click();
              return enabled;
            }
            """
        )
        assert apply_started, "field Apply was disabled after the live contacts released"
        page.wait_for_function("() => window.VivaPhoneEngine.fieldWorld().previews.length === 0")
        applied = wait_revision(page, "relic", relic_before_apply["entity"]["revision"] + 1)
        assert applied["entity"]["q"] != relic_before_apply["entity"]["q"], applied
        assert not any("/readyz" in url or "/healthz" in url for url in requests), requests
        assert page.evaluate("() => window.__phoneCameraCalls") == 0
        assert not page_errors, page_errors
        return {
            "portalResult": portal_result["result"],
            "previewsAfter250ms": after_solver["previews"],
            "releasedRevisions": {"relic": released["relic"]["revision"], "workpiece": released["workpiece"]["revision"]},
            "applyRevision": applied["entity"]["revision"],
            "cameraCalls": 0,
        }
    finally:
        if original_world_id is None:
            host_page.evaluate("() => localStorage.removeItem('vivo.phone.worldId')")
        else:
            host_page.evaluate(
                "worldId => localStorage.setItem('vivo.phone.worldId', worldId)",
                original_world_id,
            )
        page.close()


def pinch_hand_at(screen_x: float, screen_y: float, width: float, height: float) -> list[dict[str, float]]:
    video_width, video_height = 640.0, 480.0
    scale = max(width / video_width, height / video_height)
    rendered_width, rendered_height = video_width * scale, video_height * scale
    crop_x, crop_y = (rendered_width - width) / 2, (rendered_height - height) / 2
    normalized_x = 1 - (screen_x + crop_x) / rendered_width
    normalized_y = (screen_y + crop_y) / rendered_height
    base = [(0, 0), (.08, -.03), (.13, -.06), (.16, -.1), (.195, -.012)]
    points = [(x, y) for x, y in base]
    for start, tip, finger_x in [(5, 8, .2), (9, 12, .4), (13, 16, .6), (17, 20, .8)]:
        points.extend([(finger_x, 0), (finger_x, -.12), (finger_x, -.25), (finger_x, -.05)])
    shift_x, shift_y = normalized_x - .1975, normalized_y + .031
    return [{"x": x + shift_x, "y": y + shift_y, "z": 0} for x, y in points]


def run_desktop_flow(page, route: str, requests: list[str], page_errors: list[str]) -> dict:
    enter_local(page, route)
    install_pointer_shim(page)
    independent_refresh = run_independent_preview_refresh_regression(page, route)
    initial = snapshot_entity(page, "relic")
    baseline_pixels = page.evaluate(
        "() => [document.querySelector('#world').toDataURL(), document.querySelector('#overlay').toDataURL()]"
    )

    begin_pair(page, "relic", 1, 2)
    preview = page.evaluate(
        """
        () => {
          const model = window.VivaPhoneEngine.fieldWorld();
          const relic = model.entities.find(entity => entity.id === 'relic');
          return {
            geometry: relic.geometry,
            delta: model.preview?.delta,
            previewPixels: document.querySelector('#world').toDataURL(),
            overlayPixels: document.querySelector('#overlay').toDataURL(),
            contacts: window.VivaPhoneEngine.interaction().contacts,
            previewText: document.querySelector('#phoneFieldPreview').textContent,
          };
        }
        """
    )
    assert len(preview["contacts"]) == 2, preview
    assert {item["contactId"] for item in preview["contacts"]} == {"touch:1", "touch:2"}, preview
    assert preview["geometry"]["scale"] > 1.05, preview
    assert abs(preview["geometry"]["rotation"]) > 0.05, preview
    assert len(preview["delta"]) == 4 and abs(preview["delta"][3]) < 1e-9, preview
    assert "transform preview" in preview["previewText"], preview
    rendered_pixels = page.evaluate(
        "() => [document.querySelector('#world').toDataURL(), document.querySelector('#overlay').toDataURL()]"
    )
    assert rendered_pixels != baseline_pixels, "The local transform preview must be visible on the renderer"
    assert len(preview["overlayPixels"]) > 100, preview

    dispatch_pointer(page, "pointerup", 1, 0, 0)
    page.wait_for_function(
        "() => window.VivaPhoneEngine.interaction().contacts.map(item => item.contactId).join(',') === 'touch:2'"
    )
    mid = snapshot_entity(page, "relic")
    assert mid["entity"]["revision"] == initial["entity"]["revision"], mid
    assert page.evaluate("() => Boolean(window.VivaPhoneEngine.fieldWorld()?.previews?.length)")
    dispatch_pointer(page, "pointerup", 2, 0, 0)
    accepted = wait_revision(page, "relic", initial["entity"]["revision"] + 1)
    accepted_geometry = accepted["entity"]["geometry"]
    assert accepted_geometry["scale"] > 1.05, accepted
    assert abs(accepted_geometry["rotation"]) > 0.05, accepted
    assert page.evaluate("() => window.VivaPhoneEngine.fieldWorld()?.previews?.length === 0")

    # The accepted local geometry survives a real page reload through the phone-owned store.
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#enterPhoneLocal")
    page.get_by_role("button", name="Enter local Vivo").click()
    open_world_controls(page)
    page.wait_for_selector("#phoneFieldAtlas")
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
    install_pointer_shim(page)
    reloaded = snapshot_entity(page, "relic")
    assert reloaded["worldId"] == initial["worldId"], reloaded
    # The sparse solver may advance the accepted object between the release
    # acknowledgement and reopening; geometry and identity are the transform
    # boundary, while revision is monotonic rather than a frozen frame count.
    assert reloaded["entity"]["revision"] >= accepted["entity"]["revision"], reloaded
    assert reloaded["entity"]["geometry"] == accepted_geometry, reloaded

    # Cancel one member of a pair: the survivor remains live, but the canceled
    # contact never contributes an accepted scale/rotation.
    workpiece_before = snapshot_entity(page, "workpiece")
    begin_pair(page, "workpiece", 10, 11)
    workpiece_point = object_point(page, "workpiece")
    dispatch_pointer(page, "pointercancel", 10, workpiece_point["x"] - 20, workpiece_point["y"] + 16)
    page.wait_for_function(
        "() => window.VivaPhoneEngine.interaction().contacts.map(item => item.contactId).join(',') === 'touch:11'"
    )
    canceled_preview = page.evaluate(
        """
        () => {
          const value = window.VivaPhoneEngine.fieldWorld();
          const entity = value.entities.find(item => item.id === 'workpiece');
          return { geometry: entity.geometry, contacts: window.VivaPhoneEngine.interaction().contacts };
        }
        """
    )
    assert canceled_preview["contacts"][0]["contactId"] == "touch:11", canceled_preview
    assert canceled_preview["geometry"]["scale"] == 1, canceled_preview
    assert canceled_preview["geometry"]["rotation"] == 0, canceled_preview
    dispatch_pointer(page, "pointerup", 11, 0, 0)
    workpiece_after = wait_revision(page, "workpiece", workpiece_before["entity"]["revision"] + 1)
    assert workpiece_after["entity"]["q"] != workpiece_before["entity"]["q"], workpiece_after
    assert workpiece_after["entity"]["geometry"]["scale"] == 1, workpiece_after

    # Two independent objects keep separate contact identities and revisions.
    relic_before = snapshot_entity(page, "relic")
    workpiece_before = snapshot_entity(page, "workpiece")
    relic_point = object_point(page, "relic")
    workpiece_point = object_point(page, "workpiece")
    dispatch_pointer(page, "pointerdown", 20, relic_point["x"], relic_point["y"])
    dispatch_pointer(page, "pointerdown", 21, workpiece_point["x"], workpiece_point["y"])
    identities = page.evaluate(
        "() => window.VivaPhoneEngine.interaction().contacts.map(item => [item.contactId, item.objectId])"
    )
    assert {tuple(item) for item in identities} == {("touch:20", "relic"), ("touch:21", "workpiece")}, identities
    dispatch_pointer(page, "pointermove", 20, relic_point["x"] + 14, relic_point["y"])
    dispatch_pointer(page, "pointermove", 21, workpiece_point["x"], workpiece_point["y"] - 14)
    dispatch_pointer(page, "pointerup", 20, 0, 0)
    dispatch_pointer(page, "pointerup", 21, 0, 0)
    relic_after = wait_revision(page, "relic", relic_before["entity"]["revision"] + 1)
    workpiece_after = wait_revision(page, "workpiece", workpiece_before["entity"]["revision"] + 1)
    assert relic_after["entity"]["q"] != relic_before["entity"]["q"], relic_after
    assert workpiece_after["entity"]["q"] != workpiece_before["entity"]["q"], workpiece_after

    # The synthetic/model path reaches the same fabric with two hand identities;
    # an empty frame is a deterministic selective-loss cancellation.
    hand_point = object_point(page, "workpiece")
    viewport = page.evaluate("() => ({ width: innerWidth, height: innerHeight })")
    hands = [
        pinch_hand_at(hand_point["x"] - 10, hand_point["y"], viewport["width"], viewport["height"]),
        pinch_hand_at(hand_point["x"] + 10, hand_point["y"], viewport["width"], viewport["height"]),
    ]
    synthetic = page.evaluate(
        """
        hands => window.VivaPhoneEngine.syntheticHandLandmarks(hands, { handednesses: ['Left', 'Right'] })
        """,
        hands,
    )
    page.wait_for_function(
        "() => window.VivaPhoneEngine.interaction().contacts.filter(item => item.source.startsWith('hand:')).length === 2"
    )
    assert synthetic == {"accepted": True, "hands": 2, "landmarksPerHand": 21}, synthetic
    synthetic_contacts = page.evaluate(
        "() => window.VivaPhoneEngine.interaction().contacts.filter(item => item.source.startsWith('hand:')).map(item => item.source)"
    )
    assert len(synthetic_contacts) == 2 and len(set(synthetic_contacts)) == 2, synthetic_contacts
    page.evaluate("() => window.VivaPhoneEngine.syntheticHandLandmarks([])")
    page.wait_for_function("() => window.VivaPhoneEngine.interaction().contacts.length === 0")

    # Re-open the local worker before the CAS fence assertions. The previous
    # touch/hand flow intentionally exercised the sparse solver; reopening
    # clears its in-memory active set while retaining the persisted geometry,
    # so the two deliberately overlapping requests share a stable revision.
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#enterPhoneLocal")
    page.get_by_role("button", name="Enter local Vivo").click()
    open_world_controls(page)
    page.wait_for_selector("#phoneFieldAtlas")
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")

    # Stale revision and overlapping Apply calls are rejected/serialized by the
    # phone worker; no canonical or remote command is involved.
    stale = page.evaluate(
        """
        async () => {
          const before = await window.VivaPhoneEngine.snapshot();
          const entity = before.snapshot.spaces.root.entities.portal;
          const expected = {
            worldId: before.snapshot.worldId, branchId: before.branchId, eyeId: before.currentEyeId,
            spaceId: 'root', entityId: 'portal', baseRevision: entity.revision,
            operationId: 'browser-transform:stale-source',
          };
          const accepted = await window.VivaPhoneEngine.applyLocalTransform(
            'portal', [0, 0, 0, 0], { scale: 1.25, rotation: 0.2, axes: [0, 2] }, expected);
          let staleMessage = '';
          try {
            await window.VivaPhoneEngine.applyLocalTransform(
              'portal', [0, 0, 0, 0], { scale: 1.3, rotation: 0.3, axes: [0, 2] },
              { ...expected, operationId: 'browser-transform:stale-different' });
          } catch (error) { staleMessage = error.message; }
          const overlapBase = await window.VivaPhoneEngine.snapshot();
          const overlapExpected = {
            worldId: overlapBase.snapshot.worldId, branchId: overlapBase.branchId, eyeId: overlapBase.currentEyeId,
            spaceId: 'root', entityId: 'portal', baseRevision: overlapBase.snapshot.spaces.root.entities.portal.revision,
          };
          const outcomes = await Promise.allSettled([
            window.VivaPhoneEngine.applyLocalTransform('portal', [0, 0, 0, 0], { scale: 1.4, rotation: 0.4, axes: [0, 2] }, { ...overlapExpected, operationId: 'browser-transform:overlap-a' }),
            window.VivaPhoneEngine.applyLocalTransform('portal', [0, 0, 0, 0], { scale: 1.5, rotation: 0.5, axes: [0, 2] }, { ...overlapExpected, operationId: 'browser-transform:overlap-b' }),
          ]);
          const after = await window.VivaPhoneEngine.snapshot();
          return {
            accepted,
            staleMessage,
            statuses: outcomes.map(item => item.status),
            reasons: outcomes.filter(item => item.status === 'rejected').map(item => item.reason?.message || ''),
            revision: after.snapshot.spaces.root.entities.portal.revision,
            geometry: after.snapshot.spaces.root.entities.portal.geometry,
          };
        }
        """
    )
    assert stale["accepted"]["changed"] is True, stale
    assert "STALE_LOCAL_PREVIEW" in stale["staleMessage"], stale
    assert stale["statuses"].count("fulfilled") == 1 and stale["statuses"].count("rejected") == 1, stale
    assert any("STALE_LOCAL_PREVIEW" in reason for reason in stale["reasons"]), stale
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#enterPhoneLocal")
    page.get_by_role("button", name="Enter local Vivo").click()
    open_world_controls(page)
    page.wait_for_selector("#phoneFieldAtlas")
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
    portal_after_reload = snapshot_entity(page, "portal")
    # Earlier local material motion can legitimately advance neighboring
    # revisions through the sparse solver; the accepted geometry itself must
    # still be the exact persisted result after reload.
    assert portal_after_reload["entity"]["revision"] >= stale["revision"], portal_after_reload
    assert portal_after_reload["entity"]["geometry"] == stale["geometry"], portal_after_reload

    assert not any("/readyz" in url or "/healthz" in url for url in requests), requests
    assert page.evaluate("() => window.__phoneCameraCalls") == 0
    assert not page_errors, page_errors
    return {
        "initialRevision": initial["entity"]["revision"],
        "acceptedGeometry": accepted_geometry,
        "portalGeometry": portal_after_reload["entity"]["geometry"],
        "independentPreviewRefresh": independent_refresh,
        "requestCount": len(requests),
        "cameraCalls": 0,
    }


def main(base_url: str) -> None:
    route = base_url.rstrip("/") + "/services/vivo/web/phone/"
    with sync_playwright() as playwright:
        executable = shutil.which("chromium") or shutil.which("chromium-browser")
        launch_options = {"headless": True, "args": ["--no-sandbox", "--disable-gpu"]}
        if executable:
            launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)
        camera_init_script = """
        (() => {
          window.__phoneCameraCalls = 0;
          const media = navigator.mediaDevices || (navigator.mediaDevices = {});
          media.getUserMedia = async () => {
            window.__phoneCameraCalls += 1;
            throw new Error('camera must stay off during synthetic transform coverage');
          };
        })();
        """
        context = browser.new_context(viewport={"width": 1000, "height": 900})
        context.set_default_timeout(8000)
        context.add_init_script(camera_init_script)
        page_errors: list[str] = []
        requests: list[str] = []
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("request", lambda request: requests.append(request.url))
        desktop = run_desktop_flow(page, route, requests, page_errors)

        mobile_context = browser.new_context(viewport={"width": 390, "height": 844})
        mobile_context.set_default_timeout(8000)
        mobile_context.add_init_script(camera_init_script)
        mobile = mobile_context.new_page()
        mobile_errors: list[str] = []
        mobile_requests: list[str] = []
        mobile.on("pageerror", lambda error: mobile_errors.append(str(error)))
        mobile.on("request", lambda request: mobile_requests.append(request.url))
        enter_local(mobile, route)
        install_pointer_shim(mobile)
        mobile_before = mobile.evaluate(
            "() => [document.querySelector('#world').toDataURL(), document.querySelector('#overlay').toDataURL()]"
        )
        begin_pair(mobile, "relic", 31, 32)
        mobile_after = mobile.evaluate(
            "() => [document.querySelector('#world').toDataURL(), document.querySelector('#overlay').toDataURL()]"
        )
        atlas_box = mobile.locator("#phoneFieldAtlas").bounding_box()
        assert atlas_box and atlas_box["width"] > 0 and atlas_box["height"] > 0, atlas_box
        assert mobile_after != mobile_before, "Mobile renderer did not visibly render the transform preview"
        assert len(mobile_after[0]) > 1000 and len(mobile_after[1]) > 100, mobile_after
        assert mobile.evaluate("() => window.__phoneCameraCalls") == 0
        assert not any("/readyz" in url or "/healthz" in url for url in mobile_requests), mobile_requests
        assert not mobile_errors, mobile_errors
        mobile_context.close()
        context.close()
        browser.close()
        print(json.dumps({"route": route, "desktop": desktop, "mobile": {"viewport": [390, 844], "cameraCalls": 0}, "scope": "synthetic Chromium only; no physical tracking or device acceptance"}))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9892/")
