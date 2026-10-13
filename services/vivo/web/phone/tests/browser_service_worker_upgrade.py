"""Exercise a real v13 service-worker install upgrading to the v14 shell.

The test serves two deployments from one origin. The first deployment installs
the old v13 worker and persists a local simulated-economy contribution. After
the old cache is made observable with legacy responses for the changed staged
economy modules, the server switches to the v14 deployment. The browser then
updates the worker, retires v13, and reopens the new phone route offline.
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
OLD_CACHE = "vivo-phone-shell-2026-10-13-v13"
NEW_CACHE = "vivo-phone-shell-2026-10-13-v14"
PANEL_PATH = "phone/vendor/economy/src/render/simulated-economy-panel.js"
MODEL_PATH = "phone/vendor/economy/src/domains/simulated-economy.js"


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
    wait_for_committed(page)
    page.locator("#sim-economy-house-pool-amount").fill("750")
    page.locator('[data-action="house-pool:reserve"]').click()
    wait_for_committed(page)
    state = economy_state(page)
    assert state["storageStatus"] == "persisted-local-snapshot", state
    assert state["pool"]["totalUnits"] == 750, state
    assert state["pool"]["contributions"][0]["status"] == "reserved", state
    assert state["receiptIds"], state
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


def make_old_deployment(web_root: Path, temp_root: Path) -> Path:
    old_root = temp_root / "old-v13"
    shutil.copytree(web_root, old_root)
    worker = old_root / "vivo-sw.js"
    content = worker.read_text(encoding="utf-8")
    updated = content.replace("vivo-phone-shell-2026-10-13-v14", OLD_CACHE)
    assert updated != content, "the current worker must be v14 before making the old deployment"
    worker.write_text(updated, encoding="utf-8")
    return old_root


def run() -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[5]
    web_root = repo_root / "services" / "vivo" / "web"
    with tempfile.TemporaryDirectory(prefix="vivo-sw-upgrade-") as temporary:
        old_root = make_old_deployment(web_root, Path(temporary))
        server = DeploymentServer(("127.0.0.1", 0), DeploymentHandler)
        set_deployment(server, old_root)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        route = f"http://127.0.0.1:{server.server_port}{SCOPE_PATH}phone/"
        page_errors: list[str] = []
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
                old_cache = cache_snapshot(page, OLD_CACHE, [PANEL_PATH, MODEL_PATH])
                assert OLD_CACHE in old_cache["names"], old_cache

                wait_for_local(page, route)
                before = open_and_create_pool(page)

                legacy_marker = "/* legacy v13 staged economy placeholder */"
                page.evaluate(
                    """
                    async ([cacheName, assetPaths, marker]) => {
                      const cache = await caches.open(cacheName);
                      for (const assetPath of assetPaths) {
                        const url = new URL(assetPath, location.origin + '/services/vivo/web/');
                        await cache.put(new Request(url), new Response(`${marker} ${assetPath}`, {
                          headers: {'Content-Type': 'text/javascript'}
                        }));
                      }
                    }
                    """,
                    [OLD_CACHE, [PANEL_PATH, MODEL_PATH], legacy_marker],
                )
                legacy = cache_snapshot(page, OLD_CACHE, [PANEL_PATH, MODEL_PATH])
                assert all(legacy_marker in value for value in legacy["assets"].values()), legacy

                # The same origin now serves the new deployment. The old
                # controller remains active until registration.update() runs.
                set_deployment(server, web_root)
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
                    [OLD_CACHE, NEW_CACHE, [PANEL_PATH, MODEL_PATH]],
                )
                assert OLD_CACHE not in upgraded["names"], upgraded
                assert NEW_CACHE in upgraded["names"], upgraded
                assert "house-pool:create" in upgraded["assets"][PANEL_PATH], upgraded
                assert "createHousePool" in upgraded["assets"][MODEL_PATH], upgraded

                context.set_offline(True)
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
                assert after["availableTumbo"] == before["availableTumbo"], {"before": before, "after": after}
                assert after["pool"] == before["pool"], {"before": before, "after": after}
                assert set(before["receiptIds"]).issubset(after["receiptIds"]), {"before": before, "after": after}
                assert not page_errors, page_errors
                result = {
                    "oldCacheRetired": True,
                    "newCachePresent": True,
                    "newPanelCached": "house-pool:create" in upgraded["assets"][PANEL_PATH],
                    "newModelCached": "createHousePool" in upgraded["assets"][MODEL_PATH],
                    "persistedBalancePreserved": after["availableTumbo"] == before["availableTumbo"],
                    "persistedReceiptPreserved": set(before["receiptIds"]).issubset(after["receiptIds"]),
                    "housePoolReopenedOffline": True,
                    "cacheNames": upgraded["names"],
                    "pool": after["pool"],
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
