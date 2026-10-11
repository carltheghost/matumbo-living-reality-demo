"""Real Chromium regression for phase x4 targets and lease cleanup.

Run against the canonical local launcher, for example:

    python3 services/vivo/tests/application/browser_x4_regression.py \\
      http://127.0.0.1:8767/

This intentionally keeps camera permissions off. It verifies actual accepted
receipts and returned canonical state for x4 targets, accepted release receipts,
response loss after server-side acceptance, reconciliation, and a second
seat's handoff.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8767/"
REPORT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("browser-x4-regression.json")


async def wait_text(page, selector, needle, timeout=20):
    end = asyncio.get_running_loop().time() + timeout
    last = ""
    while asyncio.get_running_loop().time() < end:
        last = await page.locator(selector).inner_text()
        if needle in last:
            return last
        await asyncio.sleep(0.1)
    raise AssertionError(f"timeout {selector} {needle!r}: {last!r}")


async def wait_hidden(page, selector, timeout=10):
    end = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < end:
        if not await page.locator(selector).is_visible():
            return
        await asyncio.sleep(0.1)
    raise AssertionError(f"still visible: {selector}")


async def wait_until(predicate, label, timeout=10):
    end = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < end:
        value = predicate()
        if value:
            return value
        await asyncio.sleep(0.05)
    raise AssertionError(f"timeout waiting for {label}")


def summarize_rpc_body(seat, body, index):
    args = body.get("args", {}) if isinstance(body, dict) else {}
    row = {"index": index, "seat": seat, "op": body.get("op") if isinstance(body, dict) else None}
    if row["op"] == "submit":
        command = args.get("command", {})
        payload = command.get("payload", {}) if isinstance(command, dict) else {}
        row.update({
            "commandId": command.get("id"),
            "kind": command.get("kind"),
            "entityId": payload.get("entityId"),
            "leaseId": payload.get("leaseId"),
            "inputEpoch": payload.get("inputEpoch"),
            "targetSeq": payload.get("targetSeq"),
            "q": payload.get("q"),
            "reason": payload.get("reason"),
            "expectedRevision": command.get("expectedRevision"),
        })
    elif row["op"] == "reconcileLease":
        event = args.get("event", {})
        command = event.get("command") if isinstance(event, dict) else None
        receipt = event.get("receipt") if isinstance(event, dict) else None
        row["kind"] = "reconcileLease"
        row["event"] = {
            "reason": event.get("reason") if isinstance(event, dict) else None,
            "commandId": command.get("id") if isinstance(command, dict) else None,
            "receiptStatus": receipt.get("status") if isinstance(receipt, dict) else None,
            "leaseId": event.get("leaseId") if isinstance(event, dict) else None,
            "inputEpoch": event.get("inputEpoch") if isinstance(event, dict) else None,
        }
        row["commandId"] = row["event"]["commandId"]
        row["leaseId"] = row["event"]["leaseId"]
        row["inputEpoch"] = row["event"]["inputEpoch"]
    return row


async def record_response(response, seat, responses):
    if "/api/local/rpc" not in response.url:
        return
    request = response.request
    try:
        body = json.loads(request.post_data or "{}")
        summary = summarize_rpc_body(seat, body, -1)
        payload = await response.json()
        summary.update({"httpStatus": response.status, "body": payload})
    except Exception as error:
        summary = {
            "seat": seat,
            "httpStatus": response.status,
            "parseError": f"{type(error).__name__}: {error}",
        }
    responses.append(summary)


async def drain_response_tasks(response_tasks):
    if response_tasks:
        await asyncio.gather(*response_tasks, return_exceptions=True)


async def open_seat(context, seat, page_errors, requests, responses, response_tasks):
    page = await context.new_page()
    page.on("pageerror", lambda error: page_errors.append({
        "seat": seat, "message": str(error), "stack": error.stack,
    }))

    def capture_request(request):
        if "/api/local/rpc" not in request.url or not request.post_data:
            return
        try:
            body = json.loads(request.post_data)
        except (TypeError, json.JSONDecodeError):
            return
        if body.get("op") not in ("submit", "reconcileLease"):
            return
        requests.append(summarize_rpc_body(seat, body, len(requests)))

    def capture_response(response):
        response_tasks.append(asyncio.create_task(record_response(response, seat, responses)))

    page.on("request", capture_request)
    page.on("response", capture_response)
    await page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    await wait_text(page, "#serviceReady", "LOCAL SERVER READY")
    await page.select_option("#localSeat", seat)
    await page.click("#createRoom")
    await wait_text(page, "#connection", "LOCAL SAVED")
    return page


async def open_panel(page, name):
    if await page.locator("#panel").is_visible():
        await page.click("#closePanel")
        await wait_hidden(page, "#panel")
    await page.click(f'[data-panel="{name}"]')
    await page.locator("#panel").wait_for(state="visible")


async def wait_request(requests, seat, *, after=0, kind=None, q4=None, op=None, timeout=10):
    def find():
        for row in requests[after:]:
            if row.get("seat") != seat:
                continue
            if kind is not None and row.get("kind") != kind:
                continue
            if op is not None and row.get("op") != op:
                continue
            if q4 is not None:
                q = row.get("q")
                if not isinstance(q, list) or len(q) < 4 or abs(q[3] - q4) > 1e-9:
                    continue
            return row
        return None

    try:
        return await wait_until(find, f"{seat} {kind or op or 'RPC'} request", timeout)
    except AssertionError as error:
        recent = [row for row in requests[after:] if row.get("seat") == seat]
        raise AssertionError(f"{error}; recent={recent!r}") from error


async def wait_response(responses, command_id, timeout=10):
    def find():
        return next((row for row in responses if row.get("commandId") == command_id), None)

    return await wait_until(find, f"response for {command_id}", timeout)


def receipt_evidence(receipt):
    return {
        key: receipt.get(key)
        for key in ("id", "status", "authorityId", "acceptedSequence",
                    "entityRevision", "code", "stateHash", "result")
    }


def state_evidence(state):
    snapshot = state.get("snapshot", {})
    return {
        "acceptedSequence": snapshot.get("acceptedSequence"),
        "stateHash": snapshot.get("stateHash"),
        "constraints": state.get("constraints", []),
    }


def response_evidence(row):
    body = row.get("body", {})
    value = body.get("value") if isinstance(body, dict) else None
    evidence = {
        key: row.get(key)
        for key in ("seat", "op", "kind", "commandId", "httpStatus")
        if key in row
    }
    if isinstance(value, dict) and value.get("schema") == "vivo.receipt/1":
        evidence["receipt"] = receipt_evidence(value)
    elif isinstance(value, dict) and row.get("op") == "reconcileLease":
        evidence["value"] = {
            "released": value.get("released"),
            "snapshot": {
                key: value.get("snapshot", {}).get(key)
                for key in ("acceptedSequence", "stateHash")
            },
        }
    if isinstance(body, dict) and isinstance(body.get("state"), dict):
        evidence["state"] = state_evidence(body["state"])
    if "parseError" in row:
        evidence["parseError"] = row["parseError"]
    return evidence


def accepted_response(row, request, prior_sequence):
    assert row.get("httpStatus") == 200, row
    body = row.get("body", {})
    receipt = body.get("value")
    assert isinstance(receipt, dict), row
    assert receipt.get("id") == request.get("commandId"), (request, receipt)
    assert receipt.get("status") == "accepted", receipt
    assert receipt.get("acceptedSequence", -1) > prior_sequence, (prior_sequence, receipt)
    state = body.get("state")
    assert isinstance(state, dict), row
    snapshot = state.get("snapshot", {})
    assert snapshot.get("acceptedSequence") == receipt.get("acceptedSequence"), row
    assert snapshot.get("stateHash") == receipt.get("stateHash"), row
    return receipt, state


def assert_target_receipt(receipt, request, lease_id):
    result = receipt.get("result", {})
    assert result.get("leaseId") == lease_id == request.get("leaseId"), (request, receipt)
    assert result.get("targetSeq") == request.get("targetSeq") and result.get("targetSeq", 0) > 0, (request, receipt)
    target = result.get("target", {})
    assert target.get("q", [None, None, None, None])[3] == 0.12, (request, receipt)


def active_constraint(state, seat):
    actor_id = {"one": "local.one", "two": "local.two"}[seat]
    matches = [
        item for item in state.get("constraints", [])
        if item.get("actorId") == actor_id and item.get("entityId") == "relic"
    ]
    assert len(matches) == 1, (seat, state.get("constraints"))
    return matches[0]


def assert_no_relic_constraint(state, seat):
    actor_id = {"one": "local.one", "two": "local.two"}[seat]
    assert not any(
        item.get("actorId") == actor_id and item.get("entityId") == "relic"
        for item in state.get("constraints", [])
    ), (seat, state.get("constraints"))


async def x4_target(page, seat, requests, responses, prior_sequence):
    start = len(requests)
    await open_panel(page, "move")
    await page.select_option("#moveTarget", "object")
    await page.select_option("#moveAxis", "3")
    await page.click("#axisPlus")

    begin_request = await wait_request(requests, seat, after=start, kind="grab.begin")
    begin_response = await wait_response(responses, begin_request["commandId"])
    begin_receipt, _begin_state = accepted_response(begin_response, begin_request, prior_sequence)
    lease_id = begin_receipt.get("result", {}).get("leaseId")
    assert isinstance(lease_id, str) and lease_id

    try:
        # The first UI click can begin a lease while its initial target is
        # still in flight. If its pre-await sample ages out, the controller
        # safely drops that provisional sample. Nudge back to zero and forward
        # again with fresh timestamps so this remains a browser/UI check while
        # still requiring the accepted x4 target receipt below.
        target_request = await wait_request(
            requests, seat, after=start, kind="grab.target", q4=0.12, timeout=2,
        )
    except AssertionError:
        await page.click("#axisMinus")
        await page.click("#axisPlus")
        target_request = await wait_request(
            requests, seat, after=start, kind="grab.target", q4=0.12,
        )
    target_response = await wait_response(responses, target_request["commandId"])
    target_receipt, target_state = accepted_response(
        target_response, target_request, begin_receipt["acceptedSequence"],
    )
    assert_target_receipt(target_receipt, target_request, lease_id)
    target_constraint = active_constraint(target_state, seat)
    assert target_constraint.get("target", {}).get("q", [None, None, None, None])[3] == 0.12, target_state

    return {
        "beginRequest": begin_request,
        "beginResponse": response_evidence(begin_response),
        "beginReceipt": receipt_evidence(begin_receipt),
        "targetRequest": target_request,
        "targetResponse": response_evidence(target_response),
        "targetReceipt": receipt_evidence(target_receipt),
        "targetConstraint": target_constraint,
        "leaseId": lease_id,
    }


async def release(page, seat, requests, responses, prior_sequence, expected_lease):
    start = len(requests)
    await page.click("#releaseGrab")
    end_request = await wait_request(requests, seat, after=start, kind="grab.end")
    assert end_request.get("leaseId") == expected_lease, (end_request, expected_lease)
    end_response = await wait_response(responses, end_request["commandId"])
    end_receipt, end_state = accepted_response(end_response, end_request, prior_sequence)
    assert end_receipt.get("result", {}).get("released") is True, end_receipt
    assert end_receipt.get("result", {}).get("leaseId") == expected_lease, end_receipt
    assert_no_relic_constraint(end_state, seat)
    return {
        "request": end_request,
        "response": response_evidence(end_response),
        "receipt": receipt_evidence(end_receipt),
        "releasedState": state_evidence(end_state),
    }


async def main():
    checks = []
    page_errors = []
    requests = []
    responses = []
    response_tasks = []

    def check(name, condition, details=None):
        row = {"name": name, "passed": bool(condition)}
        if details is not None:
            row["details"] = details
        checks.append(row)
        if not condition:
            raise AssertionError(f"{name}: {details}")

    async with async_playwright() as playwright:
        launch_options = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        # CI installs Playwright's pinned managed Chromium. A local operator may
        # still select an explicitly installed browser for a portable POSIX run.
        executable = os.environ.get("VIVO_CHROMIUM_EXECUTABLE")
        if executable:
            launch_options["executable_path"] = executable
        browser = await playwright.chromium.launch(**launch_options)
        context = await browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
        one = await open_seat(context, "one", page_errors, requests, responses, response_tasks)
        two = await open_seat(context, "two", page_errors, requests, responses, response_tasks)
        try:
            check(
                "Both seats open camera-off Relic root",
                (
                    await one.locator("#selectedName").inner_text() == "Relic"
                    and await two.locator("#selectedName").inner_text() == "Relic"
                    and not await one.locator("#recordCamera").is_checked()
                    and not await two.locator("#recordCamera").is_checked()
                ),
            )

            first = await x4_target(one, "one", requests, responses, prior_sequence=0)
            check(
                "Seat one grab.begin has accepted receipt and active lease",
                True,
                {"receipt": first["beginReceipt"], "leaseId": first["leaseId"]},
            )
            check(
                "Seat one x4 target has accepted receipt and canonical target state",
                True,
                {
                    "receipt": first["targetReceipt"],
                    "constraint": first["targetConstraint"],
                },
            )

            first_release = await release(
                one, "one", requests, responses, first["targetReceipt"]["acceptedSequence"], first["leaseId"],
            )
            check(
                "Seat one grab.end has accepted release receipt and no active lease",
                True,
                first_release,
            )

            failed_start = len(requests)
            lost_target = {}

            async def lose_after_server_accept(route, request):
                try:
                    body = json.loads(request.post_data or "{}")
                except json.JSONDecodeError:
                    body = {}
                command = body.get("args", {}).get("command", {})
                payload = command.get("payload", {})
                if (
                    not lost_target
                    and body.get("op") == "submit"
                    and command.get("kind") == "grab.target"
                    and payload.get("q", [None, None, None, None])[3] == 0.12
                ):
                    fetched = await route.fetch()
                    server_body = await fetched.json()
                    request_summary = summarize_rpc_body("one", body, -1)
                    lost_target.update({
                        "request": request_summary,
                        "serverRow": {
                            **request_summary,
                            "httpStatus": fetched.status,
                            "body": server_body,
                        },
                    })
                    await route.abort("failed")
                    return
                await route.continue_()

            await one.route("**/api/local/rpc", lose_after_server_accept)
            await open_panel(one, "move")
            await one.select_option("#moveTarget", "object")
            await one.select_option("#moveAxis", "3")
            await one.click("#axisPlus")
            def lost_or_target_sent():
                return lost_target.get("serverRow") or any(
                    row.get("seat") == "one"
                    and row.get("kind") == "grab.target"
                    and isinstance(row.get("q"), list)
                    and len(row["q"]) >= 4
                    and row["q"][3] == 0.12
                    and row.get("index", -1) >= failed_start
                    for row in requests
                )
            try:
                await wait_until(lost_or_target_sent, "x4 target request before response-loss interception", timeout=2)
            except AssertionError:
                await one.click("#axisMinus")
                await one.click("#axisPlus")
            await wait_until(lambda: lost_target.get("serverRow"), "server-accepted target before response loss")
            failed_request = lost_target["request"]
            server_target_receipt, server_target_state = accepted_response(
                lost_target["serverRow"],
                failed_request,
                first_release["receipt"]["acceptedSequence"],
            )
            assert_target_receipt(server_target_receipt, failed_request, failed_request["leaseId"])
            check(
                "Fault-injected x4 request is accepted by the server before browser response loss",
                True,
                {
                    "request": failed_request,
                    "serverResponse": response_evidence(lost_target["serverRow"]),
                    "serverState": state_evidence(server_target_state),
                },
            )

            reconciliation_request = await wait_request(
                requests, "one", after=failed_start, op="reconcileLease",
            )
            reconciliation_response = await wait_response(
                responses, reconciliation_request["commandId"],
            )
            reconciliation_body = reconciliation_response.get("body", {})
            reconciliation_value = reconciliation_body.get("value", {})
            reconciliation_state = reconciliation_body.get("state", {})
            assert reconciliation_request.get("event", {}).get("commandId") == failed_request["commandId"], (
                reconciliation_request, failed_request,
            )
            assert reconciliation_request.get("leaseId") == failed_request["leaseId"], (
                reconciliation_request, failed_request,
            )
            assert reconciliation_request.get("event", {}).get("receiptStatus") is None, reconciliation_request
            assert reconciliation_value.get("released") is True, reconciliation_body
            assert reconciliation_value.get("snapshot", {}).get("acceptedSequence") == reconciliation_state.get("snapshot", {}).get("acceptedSequence"), reconciliation_body
            assert reconciliation_value.get("snapshot", {}).get("stateHash") == reconciliation_state.get("snapshot", {}).get("stateHash"), reconciliation_body
            assert reconciliation_state.get("snapshot", {}).get("acceptedSequence", -1) > server_target_receipt["acceptedSequence"], reconciliation_body
            assert_no_relic_constraint(reconciliation_state, "one")
            assert not any(
                row.get("op") == "submit" and row.get("commandId") == failed_request["commandId"]
                for row in responses
            ), responses
            await one.unroute("**/api/local/rpc", lose_after_server_accept)
            check(
                "Lost accepted target has no client receipt and matching reconciliation clears the lease",
                True,
                {
                    "reconciliationRequest": reconciliation_request,
                    "reconciliationResponse": response_evidence(reconciliation_response),
                    "lostCommandId": failed_request["commandId"],
                },
            )

            second = await x4_target(
                two, "two", requests, responses,
                prior_sequence=reconciliation_state["snapshot"]["acceptedSequence"],
            )
            assert second["leaseId"] != failed_request["leaseId"], (second, failed_request)
            check(
                "Seat two acquires after reconciliation with accepted begin receipt",
                True,
                {"receipt": second["beginReceipt"], "leaseId": second["leaseId"]},
            )
            check(
                "Seat two x4 target has accepted receipt and canonical target state",
                True,
                {
                    "receipt": second["targetReceipt"],
                    "constraint": second["targetConstraint"],
                },
            )
            second_release = await release(
                two, "two", requests, responses, second["targetReceipt"]["acceptedSequence"], second["leaseId"],
            )
            check(
                "Seat two grab.end has accepted release receipt and no active lease",
                True,
                second_release,
            )
            check("No uncaught page errors", not page_errors, page_errors)

            await drain_response_tasks(response_tasks)
            report = {
                "schema": "vivo.browser-x4-evidence/2",
                "base": BASE,
                "checks": checks,
                "passed": sum(1 for item in checks if item["passed"]),
                "failed": sum(1 for item in checks if not item["passed"]),
                "requests": requests,
                "responses": [
                    response_evidence(row) for row in responses
                    if row.get("op") in ("submit", "reconcileLease")
                ],
                "page_errors": page_errors,
            }
            REPORT.write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps(report, indent=2), flush=True)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
