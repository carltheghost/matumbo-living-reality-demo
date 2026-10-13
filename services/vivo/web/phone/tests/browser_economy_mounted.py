"""Drive the mounted simulated economy through the actual Vivo phone UI."""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import time
from typing import Any

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright


def route_for(base_url: str) -> str:
    return base_url.rstrip("/") + "/services/vivo/web/phone/"


def wait_for_local(page: Page, route: str) -> None:
    page.goto(route, wait_until="domcontentloaded")
    page.wait_for_selector("#enterPhoneLocal")
    page.get_by_role("button", name=re.compile("Enter local Vivo")).click()
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
    world_context = page.locator(".vivo-companion-world-context")
    if not world_context.evaluate("node => node.open"):
        page.locator(".vivo-companion-world-context > summary").click()
    page.wait_for_function("document.querySelector('.vivo-companion-world-context')?.open === true")
    page.wait_for_selector("#phoneEconomyContext:not([hidden])")
    page.wait_for_function("document.querySelector('#phoneEconomyStatus').textContent.includes('TUMBO-SIM')")
    field_selection = page.locator("#phoneFieldEntity")
    if field_selection.locator("option").count() > 1:
        next_option = field_selection.locator("option").nth(1)
        next_label = next_option.inner_text().split(" · ", 1)[0]
        field_selection.select_option(next_option.get_attribute("value"))
        page.wait_for_function(
            "name => document.querySelector('#phoneEconomyTrigger')?.textContent.includes(name)",
            arg=next_label,
        )
    page.locator("#phoneEconomyTrigger").click()
    page.wait_for_selector("#simulated-economy-panel:not([hidden])")
    page.wait_for_selector(".token-economy-overview")
    page.wait_for_function(
        "document.querySelector('.token-economy-overview')?.textContent.includes('Intended fixed maximum: 42,000,000,000,000 TUMBO')"
    )
    page.wait_for_function(
        "document.querySelector('.token-economy-overview-host')?.dataset.auditState === 'current'"
    )
    assert page.locator(".sim-economy-kicker").inner_text() == "FIELD OBJECT · LOCAL REHEARSAL"
    assert "No live market" in page.locator(".sim-economy-boundary").inner_text()
    overview_text = page.locator(".token-economy-overview").inner_text()
    assert re.search(r"Overall accounting\s+healthy", overview_text), overview_text
    assert "Current issued simulation supply: 10,000,000 TUMBO-SIM (10,000,000,000 fluff)" in overview_text
    assert "Intended fixed maximum: 42,000,000,000,000 TUMBO (42,000,000,000,000,000 fluff)" in overview_text
    assert re.search(r"Rewards\s+not-observed", overview_text)
    counts = page.evaluate(
        """
        () => ({
          ownerCount: Number(Boolean(window.__vivoPhoneSimulatedEconomyOwner)),
          panelCount: document.querySelectorAll('#simulated-economy-panel').length,
          overviewCount: document.querySelectorAll('.token-economy-overview').length,
        })
        """
    )
    assert counts == {"ownerCount": 1, "panelCount": 1, "overviewCount": 1}


def committed(page: Page) -> None:
    # The panel action handler is deliberately async so a rapid second click
    # can be fenced. Allow its busy flag and refresh microtasks to settle
    # before asserting the visible receipt status.
    page.wait_for_timeout(500)
    page.wait_for_function("!document.querySelector('#simulated-economy-panel')?.dataset.busy")
    page.wait_for_function("document.querySelector('.sim-economy-status')?.textContent.includes('Committed')")
    page.wait_for_function(
        "document.querySelector('.token-economy-overview-host')?.dataset.auditState === 'current'"
    )


def dispatch_clicks_same_task(page: Page, locator) -> None:
    """Dispatch two genuine click events synchronously to exercise duplicate fencing."""
    locator.evaluate(
        """element => {
          const init = { bubbles: true, cancelable: true, view: window };
          element.dispatchEvent(new MouseEvent('click', init));
          element.dispatchEvent(new MouseEvent('click', init));
        }"""
    )


def flow(page: Page) -> dict[str, Any]:
    """Run exchange, prediction and contract flows entirely through controls."""
    # The seeded local account owns TUMBO-SIM, while the demo market maker
    # owns the opposing sMIMAS inventory. Sell first to acquire sMIMAS, then
    # exercise the buy path with the newly available balance.
    page.locator("#sim-economy-order-side").select_option("sell")
    page.locator("#sim-economy-order-amount").fill("1000")
    page.locator("#sim-economy-order-num").fill("1")
    page.locator("#sim-economy-order-den").fill("1")
    place = page.locator('[data-action="exchange:place"]')
    dispatch_clicks_same_task(page, place)
    committed(page)
    assert page.locator(".sim-economy-record").filter(has_text="SELL · FILLED").count() == 1

    # A gap beyond the 350ms duplicate fence is two intentionally distinct actions.
    page.locator("#sim-economy-order-amount").fill("25")
    place.click()
    committed(page)
    page.wait_for_timeout(400)
    place.click()
    committed(page)
    assert page.locator(".sim-economy-record").filter(has_text="SELL · FILLED").count() == 3

    page.locator("#sim-economy-order-side").select_option("buy")
    page.locator("#sim-economy-order-amount").fill("100")
    page.locator("#sim-economy-order-num").fill("1")
    page.locator("#sim-economy-order-den").fill("1")
    dispatch_clicks_same_task(page, place)
    committed(page)
    assert page.locator(".sim-economy-record").filter(has_text="BUY · FILLED").count() == 1

    page.locator("#sim-economy-order-side").select_option("sell")
    page.locator("#sim-economy-order-amount").fill("100")
    page.locator("#sim-economy-order-num").fill("2")
    page.locator("#sim-economy-order-den").fill("1")
    place.click()
    committed(page)
    open_order = page.locator(".sim-economy-record").filter(has_text="SELL · OPEN").filter(has_text="price 2/1")
    assert open_order.count() == 1
    open_order.locator('[data-action^="exchange:cancel:"]').click()
    committed(page)
    assert page.locator(".sim-economy-record").filter(has_text="SELL · CANCELLED").filter(has_text="price 2/1").count() == 1

    page.locator('[data-action="tab:prediction"]').click()
    page.locator("#sim-economy-prediction-title").fill("Will the selected field marker glow?")
    page.locator("#sim-economy-prediction-outcomes").fill("YES, NO")
    page.locator("#sim-economy-prediction-price").fill("100")
    page.locator('[data-action="prediction:create"]').click()
    committed(page)
    market = page.locator("[data-market-id]").last
    market_id = market.get_attribute("data-market-id")
    assert market_id
    market.locator('[data-action^="prediction:buy:"]').click()
    committed(page)
    market = page.locator(f'[data-market-id="{market_id}"]')
    market.locator('[data-action^="prediction:settle:"]').click()
    committed(page)
    settled_market = page.locator(".sim-economy-record").filter(has_text="Will the selected field marker glow?")
    assert "SETTLED" in settled_market.inner_text()
    assert "explicit demo provenance" in settled_market.inner_text()

    page.locator('[data-action="tab:contracts"]').click()
    page.locator("#sim-economy-contract-title").fill("Complete selected field marker")
    page.locator("#sim-economy-contract-amount").fill("1000")
    page.locator('[data-action="contract:create"]').click()
    committed(page)
    complete_contract = page.locator(".sim-economy-record").filter(has_text="Complete selected field marker")
    complete_contract.locator('[data-action^="contract:accept:"]').click()
    committed(page)
    complete_contract = page.locator(".sim-economy-record").filter(has_text="Complete selected field marker")
    complete_contract.locator('[data-action^="contract:fund:"]').click()
    committed(page)
    complete_contract = page.locator(".sim-economy-record").filter(has_text="Complete selected field marker")
    complete_contract.locator('[data-action^="contract:complete:"]').click()
    committed(page)
    assert "COMPLETED" in page.locator(".sim-economy-record").filter(has_text="Complete selected field marker").inner_text()

    page.locator("#sim-economy-contract-title").fill("Cancel selected field marker")
    page.locator("#sim-economy-contract-amount").fill("250")
    page.locator('[data-action="contract:create"]').click()
    committed(page)
    cancel_contract = page.locator(".sim-economy-record").filter(has_text="Cancel selected field marker")
    cancel_contract.locator('[data-action^="contract:accept:"]').click()
    committed(page)
    cancel_contract = page.locator(".sim-economy-record").filter(has_text="Cancel selected field marker")
    cancel_contract.locator('[data-action^="contract:fund:"]').click()
    committed(page)
    cancel_contract = page.locator(".sim-economy-record").filter(has_text="Cancel selected field marker")
    cancel_contract.locator('[data-action^="contract:cancel:"]').click()
    committed(page)
    assert "CANCELLED" in page.locator(".sim-economy-record").filter(has_text="Cancel selected field marker").inner_text()

    overview_text = page.locator(".token-economy-overview").inner_text()
    assert "Current issued simulation supply: 10,000,000 TUMBO-SIM" in overview_text
    assert "Intended fixed maximum: 42,000,000,000,000 TUMBO" in overview_text
    assert "not-observed" in overview_text
    assert page.locator(".token-economy-overview").count() == 1

    house_pool = house_pool_flow(page)

    state = page.evaluate(
        """
        () => {
          const owner = window.__vivoPhoneSimulatedEconomyOwner;
          const model = owner?.model;
          const snapshot = model?.snapshot();
          return {
            balances: model?.balances('you')?.available,
            orders: snapshot?.exchange?.orders,
            markets: snapshot?.predictions?.markets,
            positions: snapshot?.predictions?.positions,
            contracts: snapshot?.contracts,
            housePools: snapshot?.housePools?.map(pool => ({
              id: pool.id,
              name: pool.name,
              revision: pool.revision,
              totalUnits: pool.contributions.filter(row => ['reserved', 'committed'].includes(row.status)).reduce((sum, row) => sum + row.amountFluff, 0),
              contributions: pool.contributions.map(row => [row.id, row.status, row.amountFluff, row.reserveReceiptId, row.releaseReceiptId]),
            })),
            receiptCount: model?.receipts({ limit: 500 })?.length,
            storageStatus: model?.storageStatus,
          };
        }
        """
    )
    assert state["receiptCount"] and state["storageStatus"] not in ("storage-unavailable", "invalid-token-snapshot-skipped")
    assert state["housePools"] == [house_pool]
    return state


def house_pool_flow(page: Page) -> dict[str, Any]:
    """Exercise the mounted house-pool controls with a real SimulatedEconomy owner."""
    page.locator('[data-action="tab:house-pool"]').click()
    assert "commitment locking and settlement are unavailable" in page.locator(".sim-economy-house-pool-unavailable").inner_text().lower()
    assert not page.locator('[data-action="house-pool:commit"]').count()

    page.locator("#sim-economy-house-pool-name").fill("Mounted house pool")
    page.locator("#sim-economy-house-pool-capacity").fill("3000")
    page.locator('[data-action="house-pool:create"]').click()
    page.wait_for_function(
        "document.querySelector('.token-economy-overview-host')?.dataset.auditState === 'pending'"
    )
    assert "pending" in page.locator(".token-economy-overview-audit").inner_text().lower()
    committed(page)
    pool = page.locator(".sim-economy-house-pool-card").filter(has_text="Mounted house pool")
    assert pool.count() == 1
    assert page.locator("#sim-economy-house-pool-select").input_value()

    page.locator("#sim-economy-house-pool-amount").fill("750")
    page.locator('[data-action="house-pool:reserve"]').click()
    committed(page)
    pool = page.locator(".sim-economy-house-pool-card").filter(has_text="Mounted house pool")
    pool_text = pool.inner_text()
    assert "RESERVED" in pool_text
    assert re.search(r"750/750 units", pool_text), pool_text
    assert "Receipt ·" in pool_text
    assert "available" in pool_text.lower() and "reserved" in pool_text.lower()
    persistence = page.locator(".sim-economy-house-pool-storage").inner_text().lower()
    assert "durable local snapshot" in persistence or "persisted-local-snapshot" in persistence, persistence
    overview_text = page.locator(".token-economy-overview").inner_text()
    assert re.search(r"Overall accounting\s+healthy", overview_text), overview_text

    return page.evaluate(
        """
        () => {
          const model = window.__vivoPhoneSimulatedEconomyOwner?.model;
          const pool = model?.housePools({owner: 'you'})?.find(row => row.name === 'Mounted house pool');
          return {
            id: pool?.id,
            name: pool?.name,
            revision: pool?.revision,
            totalUnits: pool?.totalUnits,
            contributions: pool?.contributions?.map(row => [row.id, row.status, row.amountFluff, row.reserveReceiptId, row.releaseReceiptId]),
          };
        }
        """
    )


def release_house_pool_contributions(page: Page) -> dict[str, Any]:
    page.locator('[data-action="tab:house-pool"]').click()
    while page.locator('[data-action="house-pool:release"]').count():
        page.locator('[data-action="house-pool:release"]').first.click()
        committed(page)
    pool = page.locator(".sim-economy-house-pool-card").filter(has_text="Mounted house pool")
    assert "RELEASED" in pool.inner_text()
    assert not page.locator('[data-action="house-pool:release"]').count()
    overview_text = page.locator(".token-economy-overview").inner_text()
    assert re.search(r"Overall accounting\s+healthy", overview_text), overview_text
    return page.evaluate(
        """
        () => {
          const model = window.__vivoPhoneSimulatedEconomyOwner?.model;
          const pool = model?.housePools({owner: 'you'})?.find(row => row.name === 'Mounted house pool');
          return {
            totalUnits: pool?.totalUnits,
            available: model?.balances('you')?.available?.TUMBO,
            reservedBalance: model?.housePools({owner: 'you'})?.flatMap(row => row.contributions)
              .filter(row => ['reserved', 'committed'].includes(row.status))
              .reduce((sum, row) => sum + row.amountFluff, 0),
          };
        }
        """
    )


def reopen_and_compare(page: Page, route: str, expected: dict[str, Any]) -> dict[str, Any]:
    page.reload(wait_until="domcontentloaded")
    wait_for_local(page, route)
    actual = page.evaluate(
        """
        () => {
          const model = window.__vivoPhoneSimulatedEconomyOwner?.model;
          const snapshot = model?.snapshot();
          return {
            balances: model?.balances('you')?.available,
            orderStatuses: snapshot?.exchange?.orders?.filter(order => order.owner === 'u:you').map(order => [order.id, order.status, order.remainingBase]),
            marketStatuses: snapshot?.predictions?.markets?.map(market => [market.id, market.status]),
            contractStatuses: snapshot?.contracts?.map(contract => [contract.title, contract.status, contract.funding.status]),
            housePools: snapshot?.housePools?.map(pool => ({
              id: pool.id,
              name: pool.name,
              revision: pool.revision,
              totalUnits: pool.contributions.filter(row => ['reserved', 'committed'].includes(row.status)).reduce((sum, row) => sum + row.amountFluff, 0),
              contributions: pool.contributions.map(row => [row.id, row.status, row.amountFluff, row.reserveReceiptId, row.releaseReceiptId]),
            })),
            receiptCount: model?.receipts({ limit: 500 })?.length,
          };
        }
        """
    )
    assert actual["balances"] == expected["balances"]
    assert actual["orderStatuses"] == [[order["id"], order["status"], order["remainingBase"]] for order in expected["orders"] if order["owner"] == "u:you"]
    assert actual["marketStatuses"] == [[market["id"], market["status"]] for market in expected["markets"]]
    assert actual["contractStatuses"] == [[contract["title"], contract["status"], contract["funding"]["status"]] for contract in expected["contracts"]]
    assert actual["housePools"] == expected["housePools"]
    assert actual["receiptCount"] == expected["receiptCount"]
    return actual


def assert_no_unexpected_network(requests: list[str], origin: str) -> None:
    unexpected = [url for url in requests if not url.startswith(origin) and not url.startswith("data:")]
    assert not unexpected, unexpected
    forbidden = [url for url in requests if re.search(r"/(?:api|ws)(?:/|$)", url)]
    assert not forbidden, forbidden


def quota_storage_failure(browser: Browser, route: str) -> dict[str, Any]:
    """Verify that accepted memory-only economy state is never presented as saved."""
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    context.set_default_timeout(9000)
    context.add_init_script(
        """
        (() => {
          const nativeSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (key === 'matumbo.simulated-economy.v1' || key === 'tumbo.token.engine.v2') {
              throw new DOMException('The simulated storage quota is full.', 'QuotaExceededError');
            }
            return nativeSetItem.call(this, key, value);
          };
        })();
        """
    )
    try:
        page = context.new_page()
        wait_for_local(page, route)
        status = page.locator("#phoneEconomyStatus")
        page.wait_for_function("document.querySelector('#phoneEconomyStatus')?.dataset.tone === 'warn'")
        initial_status = status.inner_text().lower()
        assert "storage unavailable" in initial_status
        assert "reload will discard" in initial_status
        assert "persisted" not in initial_status
        assert "saved across reload" not in initial_status
        assert not page.locator("#phoneEconomyTrigger").is_disabled()

        page.locator("#sim-economy-order-side").select_option("sell")
        page.locator("#sim-economy-order-amount").fill("1000")
        page.locator("#sim-economy-order-num").fill("1")
        page.locator("#sim-economy-order-den").fill("1")
        page.locator('[data-action="exchange:place"]').click()
        committed(page)
        page.wait_for_function("document.querySelector('#phoneEconomyStatus')?.dataset.tone === 'warn'")
        after_action_status = status.inner_text().lower()
        assert "accepted in memory only" in after_action_status
        assert "reload will discard" in after_action_status
        assert "persisted" not in after_action_status
        assert page.locator(".sim-economy-record").filter(has_text="SELL · FILLED").count() == 1
        before_reload = page.evaluate(
            """
            () => ({
              storageStatus: window.__vivoPhoneSimulatedEconomyOwner?.model?.storageStatus,
              userOrders: window.__vivoPhoneSimulatedEconomyOwner?.model?.exchangeOrders({owner: 'you'}),
            })
            """
        )
        assert before_reload["storageStatus"] == "storage-unavailable"
        assert len(before_reload["userOrders"]) == 1

        page.reload(wait_until="domcontentloaded")
        wait_for_local(page, route)
        page.wait_for_function("document.querySelector('#phoneEconomyStatus')?.dataset.tone === 'warn'")
        after_reload_status = page.locator("#phoneEconomyStatus").inner_text().lower()
        assert "storage unavailable" in after_reload_status
        assert "reload will discard" in after_reload_status
        assert "persisted" not in after_reload_status
        after_reload = page.evaluate(
            """
            () => ({
              storageStatus: window.__vivoPhoneSimulatedEconomyOwner?.model?.storageStatus,
              userOrders: window.__vivoPhoneSimulatedEconomyOwner?.model?.exchangeOrders({owner: 'you'}),
            })
            """
        )
        assert after_reload["storageStatus"] == "storage-unavailable"
        assert after_reload["userOrders"] == []
        return {
            "initialWarning": initial_status,
            "afterActionWarning": after_action_status,
            "afterReloadWarning": after_reload_status,
            "acceptedInMemory": True,
            "vanishedAfterReload": True,
        }
    finally:
        context.close()


def install_offline(page: Page) -> None:
    page.locator("#phonePanelButton").click()
    page.locator("#phoneInstallOffline").click()
    page.wait_for_function("document.querySelector('#status')?.textContent.includes('Offline app shell cached')")
    page.locator("#closePanel").click()
    page.wait_for_function("Boolean(navigator.serviceWorker.controller)")


def stale_two_tab(context: BrowserContext, route: str) -> dict[str, Any]:
    first = context.pages[0]
    second = context.new_page()
    wait_for_local(second, route)
    first.locator('[data-action="tab:exchange"]').click()
    first.locator("#sim-economy-order-side").select_option("sell")
    first.locator("#sim-economy-order-amount").fill("75")
    first.locator("#sim-economy-order-num").fill("3")
    first.locator("#sim-economy-order-den").fill("1")
    first.locator('[data-action="exchange:place"]').click()
    committed(first)

    second.locator('[data-action="tab:exchange"]').click()
    second.locator("#sim-economy-order-side").select_option("sell")
    second.locator("#sim-economy-order-amount").fill("80")
    second.locator("#sim-economy-order-num").fill("4")
    second.locator("#sim-economy-order-den").fill("1")
    second.locator('[data-action="exchange:place"]').click()
    second.wait_for_function("document.querySelector('.sim-economy-status')?.dataset.tone === 'error'")
    message = second.locator(".sim-economy-status").inner_text()
    assert "reload" in message.lower() or "stale" in message.lower() or "wrapper" in message.lower(), message
    second.reload(wait_until="domcontentloaded")
    wait_for_local(second, route)
    second.close()
    return {"message": message, "recovered": True}


def stale_house_pool_two_tab(context: BrowserContext, route: str) -> dict[str, Any]:
    """A stale panel cannot reserve against an old pool revision."""
    first = context.pages[0]
    second = context.new_page()
    wait_for_local(second, route)
    first.locator('[data-action="tab:house-pool"]').click()
    first.locator("#sim-economy-house-pool-amount").fill("500")
    first.locator('[data-action="house-pool:reserve"]').click()
    committed(first)

    second.locator('[data-action="tab:house-pool"]').click()
    second.locator("#sim-economy-house-pool-amount").fill("600")
    second.locator('[data-action="house-pool:reserve"]').click()
    second.wait_for_function("document.querySelector('.sim-economy-status')?.dataset.tone === 'error'")
    message = second.locator(".sim-economy-status").inner_text()
    assert "reload" in message.lower() or "stale" in message.lower() or "wrapper" in message.lower(), message
    second.reload(wait_until="domcontentloaded")
    wait_for_local(second, route)
    second.locator('[data-action="tab:house-pool"]').click()
    assert "1.250 TUMBO-SIM" in second.locator(".sim-economy-house-pool-card").filter(has_text="Mounted house pool").inner_text()
    second.close()
    return {"message": message, "recovered": True}


def run(base_url: str) -> dict[str, Any]:
    route = route_for(base_url)
    origin = base_url.rstrip("/").split("/services/", 1)[0]
    report: dict[str, Any] = {"route": route, "desktop": {}, "mobile": {}}
    with sync_playwright() as playwright:
        chromium_path = os.environ.get("VIVO_CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("chromium-browser")
        browser_options = {"executable_path": chromium_path} if chromium_path else {}
        browser: Browser = playwright.chromium.launch(headless=True, **browser_options)
        try:
            desktop_context = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
            desktop_context.set_default_timeout(9000)
            desktop_requests: list[str] = []
            desktop_context.on("request", lambda request: desktop_requests.append(request.url))
            desktop = desktop_context.new_page()
            wait_for_local(desktop, route)
            desktop_state = flow(desktop)
            report["desktop"] = {"receiptCount": desktop_state["receiptCount"], "storageStatus": desktop_state["storageStatus"]}
            desktop_box = desktop.locator("#simulated-economy-panel").bounding_box()
            assert desktop_box and desktop_box["x"] >= 0 and desktop_box["x"] + desktop_box["width"] <= 1280, desktop_box
            reopen_and_compare(desktop, route, desktop_state)
            desktop_house_release = stale_house_pool_two_tab(desktop_context, route)
            report["desktop"]["staleHousePoolTwoTab"] = desktop_house_release
            release_house_pool_contributions(desktop)
            stale = stale_two_tab(desktop_context, route)
            report["desktop"]["staleTwoTab"] = stale
            install_offline(desktop)
            desktop_context.set_offline(True)
            desktop.reload(wait_until="domcontentloaded")
            wait_for_local(desktop, route)
            offline_status = desktop.locator("#phoneEconomyStatus").inner_text()
            assert "TUMBO-SIM" in offline_status and "unavailable" not in offline_status.lower(), offline_status
            report["desktop"]["offlineReopen"] = True
            assert_no_unexpected_network(desktop_requests, origin)
            desktop_context.close()

            mobile_context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            mobile_context.set_default_timeout(9000)
            mobile_requests: list[str] = []
            mobile_context.on("request", lambda request: mobile_requests.append(request.url))
            mobile = mobile_context.new_page()
            wait_for_local(mobile, route)
            mobile_state = flow(mobile)
            panel_box = mobile.locator("#simulated-economy-panel").bounding_box()
            assert panel_box and panel_box["x"] >= 0 and panel_box["x"] + panel_box["width"] <= 390 and panel_box["y"] + panel_box["height"] <= 844, panel_box
            assert mobile.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            mobile_house_release = release_house_pool_contributions(mobile)
            assert mobile_house_release["reservedBalance"] == 0
            close = mobile.locator('[data-action="close"]')
            close.click()
            mobile.wait_for_function("document.querySelector('#simulated-economy-panel')?.hidden === true")
            mobile.locator("#phoneEconomyTrigger").click()
            mobile.wait_for_selector("#simulated-economy-panel:not([hidden])")
            report["mobile"] = {"receiptCount": mobile_state["receiptCount"], "storageStatus": mobile_state["storageStatus"], "bounded": True}
            assert_no_unexpected_network(mobile_requests, origin)
            mobile_context.close()
            report["quotaFailure"] = quota_storage_failure(browser, route)
        finally:
            browser.close()
    return report


if __name__ == "__main__":
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9878/"
    result = run(base)
    print(json.dumps({"passed": True, **result}, indent=2))
