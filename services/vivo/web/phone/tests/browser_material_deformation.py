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


def coherent_material_state(page) -> dict:
    return page.evaluate(
        """
        async () => {
          const material = await window.VivaPhoneEngine.materialSnapshot();
          const snapshot = await window.VivaPhoneEngine.snapshot();
          const body = material.body;
          const entity = snapshot.snapshot.spaces.root.entities.workpiece;
          return {
            bodyRevision: body.bodyRevision,
            entityRevision: body.entityRevision,
            bodyCentroid: body.centroid,
            bodySimulationTime: body.simulationTime,
            bodyAcceptedSequence: body.acceptedSequence,
            entity,
            worldSimulationTime: snapshot.snapshot.simulationTime,
            worldAcceptedSequence: snapshot.snapshot.acceptedSequence,
          };
        }
        """
    )


def assert_coherent_material_state(state: dict) -> None:
    assert state["entity"]["q"] == state["bodyCentroid"]["q"], state
    assert state["entity"]["v"] == state["bodyCentroid"]["v"], state
    assert state["entity"]["revision"] == state["entityRevision"], state
    assert state["worldSimulationTime"] == state["bodySimulationTime"], state
    assert state["worldAcceptedSequence"] == state["bodyAcceptedSequence"], state


def run_mounted_worker_regressions(page) -> dict:
    return page.evaluate(
        """
        async () => {
          const { capturedInverseMapping } = await import('/services/vivo/web/phone/material-patch.mjs');
          const engine = window.VivaPhoneEngine;
          const actuator = { maxForce: 2, stiffness: 3, damping: 0.4 };
          const nodeIds = ['workpiece.patch.v1.r0c2', 'workpiece.patch.v1.r1c2', 'workpiece.patch.v1.r2c2', 'workpiece.patch.v1.r0c3'];
          let operation = 0;
          const nextOperation = label => `mounted-material-regression:${label}:${++operation}`;
          const current = async () => {
            const material = await engine.materialSnapshot();
            return { material, identity: material.body.identity };
          };
          const attachment = (body, nodeId) => {
            const q = body.nodes[nodeId].q;
            return {
              nodeId, capturedCanonicalPoint: [...q], capturedAt: 100,
              inverseMapping: capturedInverseMapping({
                devicePoint: [100, 100], viewport: { left: 0, top: 0, width: 400, height: 400 },
                renderer: { w: 400, h: 400, yaw: 0.55, pitch: 0.68, distance: 10.5, origin: [0, 0, 0] },
                axes: [0, 2, 1], depth: 10.5, canonicalQ: q,
              }),
            };
          };
          const begin = async (contactId, source, nodeId) => {
            const { material, identity } = await current();
            return engine.materialBegin({
              operationId: nextOperation(`begin:${contactId}`), contactId, source,
              identity, attachment: attachment(material.body, nodeId), actuator,
              observedAt: 100, receivedAt: 101,
            });
          };
          const stop = async (operationId, source) => {
            const { identity } = await current();
            return engine.materialStopSource({ operationId, source, identity, observedAt: 102, receivedAt: 103, reason: 'mounted-regression' });
          };
          const operationState = material => ({
            activeContacts: material.activeContacts,
            receipts: material.body?.receipts,
            inputCursor: material.body?.inputCursor,
          });

          const rapidBefore = await current();
          const rapidSource = { kind: 'touch', sourceId: 'mounted-rapid', sessionId: 'mounted-regression', generation: 1 };
          const rapidNodeId = 'workpiece.patch.v1.r1c2';
          const rapidBegin = await begin('mounted:rapid', rapidSource, rapidNodeId);
          const rapidAttachment = attachment(rapidBefore.material.body, rapidNodeId);
          const rapidQ = rapidBefore.material.body.nodes[rapidNodeId].q.map((value, axis) => value + (axis === 0 ? 0.45 : axis === 2 ? 0.08 : 0));
          const rapidTarget = {
            schema: 'vivo.phone.material-target/1', operationId: nextOperation('target:rapid'), contactId: rapidBegin.contact.contactId,
            identity: { ...rapidBefore.identity, bodyRevision: rapidBegin.receipt.bodyRevision }, source: rapidSource, targetSeq: 1,
            q: rapidQ, attachment: rapidAttachment, actuator, observedAt: 104, receivedAt: 105,
          };
          const rapidTargetPromise = engine.materialTarget(rapidTarget);
          const rapidEndPromise = engine.materialEnd({
            operationId: nextOperation('end:rapid'), contactId: rapidBegin.contact.contactId, source: rapidSource,
            identity: { ...rapidBefore.identity, bodyRevision: rapidBegin.receipt.bodyRevision }, observedAt: 106, receivedAt: 107,
          });
          const [rapidTargetResult, rapidEnd] = await Promise.all([rapidTargetPromise, rapidEndPromise]);
          const rapidAfter = await current();
          const rapidAfterSnapshot = await engine.snapshot();
          const rapidEntity = rapidAfterSnapshot.snapshot.spaces.root.entities.workpiece;

          const oldSource = { kind: 'finger', sourceId: 'mounted-hand:index', parentSourceId: 'mounted-hand', fingerId: 'index', sessionId: 'mounted-regression', generation: 1 };
          const freshSource = { kind: 'finger', sourceId: 'mounted-hand:middle', parentSourceId: 'mounted-hand', fingerId: 'middle', sessionId: 'mounted-regression', generation: 2 };
          await begin('mounted:finger:old', oldSource, nodeIds[0]);
          await begin('mounted:finger:fresh', freshSource, nodeIds[1]);
          const handStop = await stop(nextOperation('stop:hand:old'), { kind: 'hand', sourceId: 'mounted-hand', sessionId: 'mounted-regression', generation: 1 });
          const afterHandStop = await engine.materialSnapshot();
          const handContacts = afterHandStop.activeContacts.map(item => item.contactId);
          const handFence = await begin('mounted:finger:newer', { ...freshSource, sourceId: 'mounted-hand:ring', fingerId: 'ring' }, nodeIds[2]);
          await stop(nextOperation('stop:hand:fresh'), { kind: 'hand', sourceId: 'mounted-hand', sessionId: 'mounted-regression', generation: 2 });

          const agent1 = { kind: 'agent', sourceId: 'mounted-agent', sessionId: 'mounted-regression', generation: 1 };
          const agent2 = { ...agent1, generation: 2 };
          await begin('mounted:agent:old', agent1, nodeIds[3]);
          const replayOperation = nextOperation('stop:agent:original');
          await stop(replayOperation, agent1);
          await begin('mounted:agent:fresh', agent2, nodeIds[0]);
          const beforeConflict = await engine.materialSnapshot();
          const beforeConflictOperationState = operationState(beforeConflict);
          let conflictMessage = '';
          try { await stop(replayOperation, agent2); } catch (error) { conflictMessage = String(error?.message || error); }
          const afterConflict = await engine.materialSnapshot();
          const afterConflictOperationState = operationState(afterConflict);
          // Physics may advance between these two worker reads while the
          // fresh contact keeps the clock alive. Compare only state the
          // rejected operation could mutate, then probe the source fence by
          // admitting a different contact in the same generation.
          let sameGenerationAccepted = false;
          let sameGenerationError = '';
          try {
            const admitted = await begin('mounted:agent:same-generation-after-reject', agent2, nodeIds[1]);
            sameGenerationAccepted = admitted.status === 'accepted';
            if (sameGenerationAccepted) {
              const { identity } = await current();
              await engine.materialCancel({
                operationId: nextOperation('cancel:agent:same-generation-after-reject'),
                contactId: admitted.contact.contactId, source: agent2,
                identity: { ...identity, bodyRevision: admitted.receipt.bodyRevision },
                observedAt: 204, receivedAt: 205, reason: 'mounted-regression-cleanup',
              });
            }
          } catch (error) { sameGenerationError = String(error?.message || error); }
          await stop(nextOperation('stop:agent:fresh'), agent2);
          return {
            handStopReleased: handStop.released?.map(item => item.contactId) || [],
            handContacts,
            handFenceAccepted: handFence.status === 'accepted',
            conflictMessage,
            conflictOperationStateUnchanged: JSON.stringify(beforeConflictOperationState) === JSON.stringify(afterConflictOperationState),
            sameGenerationAccepted,
            sameGenerationError,
            conflictPhysicsTickBefore: beforeConflict.body.physicsTick,
            conflictPhysicsTickAfter: afterConflict.body.physicsTick,
            conflictBodyRevisionBefore: beforeConflict.body.bodyRevision,
            conflictBodyRevisionAfter: afterConflict.body.bodyRevision,
            cleanupContacts: (await engine.materialSnapshot()).activeContacts.length,
            rapidBodyRevisionBefore: rapidBefore.material.body.bodyRevision,
            rapidBodyRevisionAfter: rapidAfter.material.body.bodyRevision,
            rapidPhysicsAdvanced: rapidEnd.physicsAdvanced === true,
            rapidTargetAccepted: rapidTargetResult.status === 'accepted',
            rapidCoherent: rapidEntity.revision === rapidAfter.material.body.entityRevision &&
              JSON.stringify(rapidEntity.q) === JSON.stringify(rapidAfter.material.body.centroid.q) &&
              JSON.stringify(rapidEntity.v) === JSON.stringify(rapidAfter.material.body.centroid.v),
            rapidWorldTime: rapidAfterSnapshot.snapshot.simulationTime,
            rapidBodyTime: rapidAfter.material.body.simulationTime,
          };
        }
        """
    )


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
    assert_coherent_material_state(coherent_material_state(page))

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
    assert_coherent_material_state(coherent_material_state(page))

    mounted_regressions = run_mounted_worker_regressions(page)
    assert mounted_regressions["rapidBodyRevisionAfter"] > mounted_regressions["rapidBodyRevisionBefore"], mounted_regressions
    assert mounted_regressions["rapidPhysicsAdvanced"] is True, mounted_regressions
    assert mounted_regressions["rapidTargetAccepted"] is True, mounted_regressions
    assert mounted_regressions["rapidCoherent"] is True, mounted_regressions
    assert mounted_regressions["rapidWorldTime"] == mounted_regressions["rapidBodyTime"], mounted_regressions
    assert mounted_regressions["handStopReleased"] == ["mounted:finger:old"], mounted_regressions
    assert mounted_regressions["handContacts"] == ["mounted:finger:fresh"], mounted_regressions
    assert mounted_regressions["handFenceAccepted"] is True, mounted_regressions
    assert "MATERIAL_OPERATION_REPLAY_MISMATCH" in mounted_regressions["conflictMessage"], mounted_regressions
    assert mounted_regressions["conflictOperationStateUnchanged"] is True, mounted_regressions
    assert mounted_regressions["sameGenerationAccepted"] is True, mounted_regressions
    assert mounted_regressions["sameGenerationError"] == "", mounted_regressions
    assert mounted_regressions["cleanupContacts"] == 0, mounted_regressions

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
