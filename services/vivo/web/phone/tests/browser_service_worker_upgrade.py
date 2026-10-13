"""Exercise real v13 -> v14 and v14 -> v15 service-worker upgrades.

The test serves three deployments from one origin. It persists a local
simulated-economy contribution under v13, verifies the v13 -> v14 retirement,
then verifies the v14 -> v15 retirement and reopens the phone route offline
after each upgrade. Each old cache is made observable with legacy responses
for the changed staged economy modules before it is retired.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from playwright.sync_api import BrowserContext, Page, sync_playwright


SCOPE_PATH = "/services/vivo/web/"
V13_CACHE = "vivo-phone-shell-2026-10-13-v13"
V14_CACHE = "vivo-phone-shell-2026-10-13-v14"
V15_CACHE = "vivo-phone-shell-2026-10-13-v15"
ECONOMY_ENTRY_PATH = "phone/economy-entry.mjs"
MANIFEST_PATH = "phone/vendor/economy/manifest.json"
OVERVIEW_PATH = "phone/vendor/economy/src/domains/token-economy-overview.js"
STORE_PATH = "phone/vendor/economy/src/domains/token-store.js"
PANEL_PATH = "phone/vendor/economy/src/render/simulated-economy-panel.js"
MODEL_PATH = "phone/vendor/economy/src/domains/simulated-economy.js"
CACHE_ASSERT_PATHS = [
    ECONOMY_ENTRY_PATH,
    MANIFEST_PATH,
    OVERVIEW_PATH,
    STORE_PATH,
    PANEL_PATH,
    MODEL_PATH,
]


class DeploymentServer(ThreadingHTTPServer):
    deployment_root: Path


class DeploymentHandler(SimpleHTTPRequestHandler):
    server: DeploymentServer

    def translate_path(self, path: str) -> str:
        relative_url = urlsplit(path).path
        if not relative_url.startswith(SCOPE_PATH):
            return str(self.server.deployment_root / "__missing__")
        relative = relative_url[len(SCOPE_PATH):].lstrip("/")
        candidate = (self.server.deployment_root / relative).resolve()
        root = self.server.deployment_root.resolve()
        if candidate != root and root not in candidate.parents:
            return str(root / "__missing__")
        return str(candidate)

    def end_headers(self) -> None:
        # The deployment switch must be visible to registration.update().
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, _format: str, *_args: Any) -> None:
        return


def set_deployment(server: DeploymentServer, root: Path) -> None:
    server.deployment_root = root


def wait_for_local(page: Page, route: str) -> None:
    page.goto(route, wait_until="domcontentloaded")
    page.wait_for_selector("#enterPhoneLocal")
    page.get_by_role("button", name="Enter local Vivo").click()
    page.wait_for_function("Boolean(window.VivaPhoneEngine && window.VivaPhoneEngine.active)")
    context = page.locator(".vivo-companion-world-context")
    if not context.evaluate("node => node.open"):
        page.locator(".vivo-companion-world-context > summary").click()
    page.wait_for_function("document.querySelector('.vivo-companion-world-context')?.open === true")
    field_selection = page.locator("#phoneFieldEntity")
    if field_selection.locator("option").count() > 1:
        next_option = field_selection.locator("option").nth(1)
        next_label = next_option.inner_text().split(" · ", 1)[0]
        field_selection.select_option(next_option.get_attribute("value"))
        page.wait_for_function(
            "name => document.querySelector('#phoneEconomyTrigger')?.textContent.includes(name)",
            arg=next_label,
        )
    page.wait_for_selector("#phoneEconomyContext:not([hidden])")
    page.wait_for_function("document.querySelector('#phoneEconomyStatus')?.textContent.includes('TUMBO-SIM')")


def wait_for_committed(page: Page) -> None:
    page.wait_for_timeout(350)
    page.wait_for_function("!document.querySelector('#simulated-economy-panel')?.dataset.busy")
    page.wait_for_function("document.querySelector('.sim-economy-status')?.textContent.includes('Committed')")
    page.wait_for_function(
        "document.querySelector('.token-economy-overview-host')?.dataset.auditState === 'current'"
    )


def economy_state(page: Page) -> dict[str, Any]:
    return page.evaluate(
        """
        () => {
          const model = window.__vivoPhoneSimulatedEconomyOwner?.model;
          const pool = model?.housePools({owner: 'you'})?.find(row => row.name === 'Upgrade pool');
          return {
            storageStatus: model?.storageStatus,
            availableTumbo: model?.balances('you')?.available?.TUMBO,
            pool: pool && {
              id: pool.id,
              totalUnits: pool.totalUnits,
              revision: pool.revision,
              contributions: pool.contributions.map(row => ({
                id: row.id,
                status: row.status,
                amountFluff: row.amountFluff,
                reserveReceiptId: row.reserveReceiptId,
                releaseReceiptId: row.releaseReceiptId,
              })),
            },
            receiptIds: model?.receipts({limit: 500})?.filter(row => row.links?.poolId).map(row => row.id),
          };
        }
        """
    )


def open_and_create_pool(page: Page) -> dict[str, Any]:
    page.locator("#phoneEconomyTrigger").click()
    page.wait_for_selector("#simulated-economy-panel:not([hidden])")
    page.locator('[data-action="tab:house-pool"]').click()
    page.locator("#sim-economy-house-pool-name").fill("Upgrade pool")
    page.locator("#sim-economy-house-pool-capacity").fill("3000")
    page.locator('[data-action="house-pool:create"]').click()
    page.wait_for_function(
        "document.querySelector('.token-economy-overview-host')?.dataset.auditState === 'pending'"
    )
    assert "pending" in page.locator(".token-economy-overview-audit").inner_text().lower()
    wait_for_committed(page)
    page.locator("#sim-economy-house-pool-amount").fill("750")
    page.locator('[data-action="house-pool:reserve"]').click()
    wait_for_committed(page)
    state = economy_state(page)
    assert state["storageStatus"] == "persisted-local-snapshot", state
    assert state["pool"]["totalUnits"] == 750, state
    assert state["pool"]["contributions"][0]["status"] == "reserved", state
    assert state["receiptIds"], state
    overview_text = page.locator(".token-economy-overview").inner_text()
    assert "Overall accounting" in overview_text and "healthy" in overview_text, overview_text
    return state


def cache_snapshot(page: Page, cache_name: str, paths: list[str]) -> dict[str, Any]:
    return page.evaluate(
        """
        async ([cacheName, assetPaths]) => {
          const cache = await caches.open(cacheName);
          const result = {};
          for (const assetPath of assetPaths) {
            const response = await cache.match(new URL(assetPath, location.origin + '/services/vivo/web/'));
            result[assetPath] = response ? await response.text() : null;
          }
          return {names: await caches.keys(), assets: result};
        }
        """,
        [cache_name, paths],
    )


def make_deployment(web_root: Path, temp_root: Path, directory: str, cache_name: str) -> Path:
    deployment_root = temp_root / directory
    shutil.copytree(web_root, deployment_root)
    worker = deployment_root / "vivo-sw.js"
    content = worker.read_text(encoding="utf-8")
    updated = content.replace(V15_CACHE, cache_name)
    assert updated != content, f"the current worker must be {V15_CACHE} before making {cache_name}"
    worker.write_text(updated, encoding="utf-8")
    return deployment_root


def mark_legacy_cache(page: Page, cache_name: str, marker: str) -> dict[str, Any]:
    page.evaluate(
        """
        async ([cacheName, assetPaths, legacyMarker]) => {
          const cache = await caches.open(cacheName);
          for (const assetPath of assetPaths) {
            const url = new URL(assetPath, location.origin + '/services/vivo/web/');
            await cache.put(new Request(url), new Response(`${legacyMarker} ${assetPath}`, {
              headers: {'Content-Type': 'text/javascript'}
            }));
          }
        }
        """,
        [cache_name, CACHE_ASSERT_PATHS, marker],
    )
    legacy = cache_snapshot(page, cache_name, CACHE_ASSERT_PATHS)
    assert all(marker in value for value in legacy["assets"].values()), legacy
    return legacy


def wait_for_upgrade(page: Page, old_cache: str, new_cache: str) -> dict[str, Any]:
    page.evaluate(
        """
        async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          if (!registration) throw new Error('missing service-worker registration');
          await registration.update();
        }
        """
    )
    upgraded = page.evaluate(
        """
        async ([oldCache, newCache, assetPaths]) => {
          const deadline = Date.now() + 20_000;
          while (Date.now() < deadline) {
            const names = await caches.keys();
            if (names.includes(newCache) && !names.includes(oldCache)) {
              const cache = await caches.open(newCache);
              const assets = {};
              for (const assetPath of assetPaths) {
                const response = await cache.match(new URL(assetPath, location.origin + '/services/vivo/web/'));
                assets[assetPath] = response ? await response.text() : null;
              }
              return {names, assets};
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          throw new Error(`service-worker upgrade did not retire ${oldCache}`);
        }
        """,
        [old_cache, new_cache, CACHE_ASSERT_PATHS],
    )
    assert old_cache not in upgraded["names"], upgraded
    assert new_cache in upgraded["names"], upgraded
    assert "house-pool:create" in upgraded["assets"][PANEL_PATH], upgraded
    assert "createHousePool" in upgraded["assets"][MODEL_PATH], upgraded
    return upgraded


def expected_cached_assets(web_root: Path) -> dict[str, str]:
    return {
        asset_path: (web_root / asset_path).read_text(encoding="utf-8")
        for asset_path in CACHE_ASSERT_PATHS
    }


def assert_exact_cached_assets(upgraded: dict[str, Any], expected: dict[str, str]) -> None:
    assert upgraded["assets"] == expected, {
        asset_path: {
            "expectedLength": len(expected[asset_path]),
            "actualLength": len(upgraded["assets"].get(asset_path) or ""),
            "exact": upgraded["assets"].get(asset_path) == expected[asset_path],
        }
        for asset_path in CACHE_ASSERT_PATHS
        if upgraded["assets"].get(asset_path) != expected[asset_path]
    }


def reopen_pool_offline(page: Page, route: str, expected: dict[str, Any]) -> dict[str, Any]:
    page.reload(wait_until="domcontentloaded")
    wait_for_local(page, route)
    page.locator("#phoneEconomyTrigger").click()
    page.wait_for_selector("#simulated-economy-panel:not([hidden])")
    page.locator('[data-action="tab:house-pool"]').click()
    page.wait_for_selector("#sim-economy-house-pool-capacity")
    assert not page.locator('[data-action="house-pool:commit"]').count()
    pool_text = page.locator(".sim-economy-house-pool-card").filter(has_text="Upgrade pool").inner_text()
    assert "RESERVED" in pool_text, pool_text
    assert "Receipt ·" in pool_text, pool_text
    after = economy_state(page)
    assert after["storageStatus"] in {"restored-local-snapshot", "restored-canonical-snapshot", "persisted-local-snapshot"}, after
    assert after["availableTumbo"] == expected["availableTumbo"], {"expected": expected, "after": after}
    assert after["pool"] == expected["pool"], {"expected": expected, "after": after}
    assert set(expected["receiptIds"]).issubset(after["receiptIds"]), {"expected": expected, "after": after}
    return after


def run() -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[5]
    web_root = repo_root / "services" / "vivo" / "web"
    with tempfile.TemporaryDirectory(prefix="vivo-sw-upgrade-") as temporary:
        temporary_root = Path(temporary)
        v13_root = make_deployment(web_root, temporary_root, "v13", V13_CACHE)
        v14_root = make_deployment(web_root, temporary_root, "v14", V14_CACHE)
        server = DeploymentServer(("127.0.0.1", 0), DeploymentHandler)
        set_deployment(server, v13_root)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        route = f"http://127.0.0.1:{server.server_port}{SCOPE_PATH}phone/"
        page_errors: list[str] = []
        browser = None
        try:
            with sync_playwright() as playwright:
                executable = os.environ.get("VIVO_CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("chromium-browser")
                launch_options = {"headless": True}
                if executable:
                    launch_options["executable_path"] = executable
                browser = playwright.chromium.launch(**launch_options)
                context: BrowserContext = browser.new_context()
                page = context.new_page()
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                page.goto(route, wait_until="domcontentloaded")
                page.wait_for_selector("#enterPhoneLocal")

                registration = page.evaluate(
                    """
                    async () => {
                      const scope = new URL('../', location.href).pathname;
                      const registration = await navigator.serviceWorker.register(
                        new URL('../vivo-sw.js', location.href), {scope}
                      );
                      await navigator.serviceWorker.ready;
                      return {scope, active: Boolean(registration.active)};
                    }
                    """
                )
                assert registration == {"scope": SCOPE_PATH, "active": True}, registration
                page.reload(wait_until="domcontentloaded")
                page.wait_for_function("Boolean(navigator.serviceWorker.controller)")
                initial_cache = cache_snapshot(page, V13_CACHE, [PANEL_PATH, MODEL_PATH])
                assert V13_CACHE in initial_cache["names"], initial_cache

                wait_for_local(page, route)
                before = open_and_create_pool(page)

                legacy_v13 = mark_legacy_cache(page, V13_CACHE, "/* legacy v13 PR132 economy shell placeholder */")
                set_deployment(server, v14_root)
                upgraded_v14 = wait_for_upgrade(page, V13_CACHE, V14_CACHE)
                context.set_offline(True)
                after_v14 = reopen_pool_offline(page, route, before)
                assert after_v14["availableTumbo"] == before["availableTumbo"], {"before": before, "after": after_v14}
                assert after_v14["pool"] == before["pool"], {"before": before, "after": after_v14}

                context.set_offline(False)
                legacy_v14 = mark_legacy_cache(page, V14_CACHE, "/* legacy v14 PR132 economy shell placeholder */")
                set_deployment(server, web_root)
                upgraded_v15 = wait_for_upgrade(page, V14_CACHE, V15_CACHE)
                assert_exact_cached_assets(upgraded_v15, expected_cached_assets(web_root))
                context.set_offline(True)
                after_v15 = reopen_pool_offline(page, route, before)
                assert after_v15["availableTumbo"] == before["availableTumbo"], {"before": before, "after": after_v15}
                assert after_v15["pool"] == before["pool"], {"before": before, "after": after_v15}
                assert not page_errors, page_errors
                result = {
                    "v13ToV14": {
                        "oldCacheRetired": V13_CACHE not in upgraded_v14["names"],
                        "newCachePresent": V14_CACHE in upgraded_v14["names"],
                        "legacyAssetsObserved": all("legacy v13 PR132" in value for value in legacy_v13["assets"].values()),
                        "newPanelCached": "house-pool:create" in upgraded_v14["assets"][PANEL_PATH],
                        "newModelCached": "createHousePool" in upgraded_v14["assets"][MODEL_PATH],
                        "housePoolReopenedOffline": after_v14["pool"] == before["pool"],
                        "cacheNames": upgraded_v14["names"],
                    },
                    "v14ToV15": {
                        "oldCacheRetired": V14_CACHE not in upgraded_v15["names"],
                        "newCachePresent": V15_CACHE in upgraded_v15["names"],
                        "legacyAssetsObserved": all("legacy v14 PR132" in value for value in legacy_v14["assets"].values()),
                        "exactCurrentAssets": True,
                        "newPanelCached": "house-pool:create" in upgraded_v15["assets"][PANEL_PATH],
                        "newModelCached": "createHousePool" in upgraded_v15["assets"][MODEL_PATH],
                        "housePoolReopenedOffline": after_v15["pool"] == before["pool"],
                        "cacheNames": upgraded_v15["names"],
                    },
                    "persistedBalancePreserved": after_v15["availableTumbo"] == before["availableTumbo"],
                    "persistedReceiptPreserved": set(before["receiptIds"]).issubset(after_v15["receiptIds"]),
                    "housePoolReopenedOffline": True,
                    "cacheNames": upgraded_v15["names"],
                    "pool": after_v15["pool"],
                    "pageErrors": page_errors,
                }
                print(json.dumps(result, indent=2))
                context.close()
                browser.close()
                return result
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    run()
