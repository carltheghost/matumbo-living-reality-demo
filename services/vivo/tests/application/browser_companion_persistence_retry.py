"""Browser regression for Vivo companion persistence acknowledgement/retry.

The worker remains the real phone engine and IndexedDB store. Only this test's
worker response wraps the store to inject bounded quota failures or save delay;
no production storage behavior is changed and no camera/provider is enabled.
"""
from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import sync_playwright

import browser_companion_polish as polish


REPO = polish.REPO
EVIDENCE = REPO / "evidence" / "vivo-companion-polish" / "browser" / "persistence-retry"


def wait_for_persistence(page, state: str) -> None:
    page.wait_for_function(
        """
        expected => {
          const node = document.querySelector('[data-companion="persistence"]');
          return node?.dataset.state === expected && node?.dataset.placed === 'true';
        }
        """,
        arg=state,
    )


def main() -> None:
    executable = polish.browser_path()
    if not executable:
        raise SystemExit("No supported Chromium browser executable was found")
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    polish.PORT = int(os.environ.get("VIVO_COMPANION_PORT", "8800"))
    server, thread = polish.serve()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=executable,
            headless=True,
            args=["--disable-gpu", "--disable-dev-shm-usage"],
        )
        try:
            # Two post-bootstrap failures exercise the initial failure and a
            # repeated explicit retry. The third attempt must be durable.
            context, page, errors = polish.open_phone(
                browser,
                width=390,
                height=844,
                storage_profile={"skip_saves": 2, "failures": 2},
            )
            page.locator('[data-companion="roster"] [data-character-id="portal"]').click()
            page.locator('[data-companion="place"]').click()
            wait_for_persistence(page, "unsaved")
            first_failure = polish.companion_state(page)
            assert first_failure["persistence"] == "PLACEMENT · NOT SAVED", first_failure
            assert "not saved" in str(first_failure["reaction"]).lower(), first_failure
            assert "Retry remains available" in str(first_failure["reaction"]), first_failure
            page.screenshot(path=str(EVIDENCE / "failure-not-saved.png"))

            # This is the reviewed zero-delta path: it must perform a fresh
            # persistence attempt and remain honest when that attempt fails.
            page.locator('[data-companion="place"]').click()
            wait_for_persistence(page, "unsaved")
            repeated_failure = polish.companion_state(page)
            assert repeated_failure["persistence"] == "PLACEMENT · NOT SAVED", repeated_failure
            assert "not saved" in str(repeated_failure["reaction"]).lower(), repeated_failure
            assert repeated_failure["reaction"] != "Inner world is in the world. The accepted placement is saved locally.", repeated_failure
            page.screenshot(path=str(EVIDENCE / "repeat-failure-not-saved.png"))

            page.locator('[data-companion="place"]').click()
            wait_for_persistence(page, "saved")
            saved = polish.companion_state(page)
            assert saved["persistence"] == "PLACEMENT · SAVED LOCALLY", saved
            assert "saved locally" in str(saved["reaction"]).lower(), saved
            page.screenshot(path=str(EVIDENCE / "retry-saved.png"))

            page.reload(wait_until="domcontentloaded")
            page.locator("#enterPhoneLocal").click()
            page.locator("body.phone-local #vivoCompanion").wait_for()
            wait_for_persistence(page, "saved")
            reloaded = polish.companion_state(page)
            assert reloaded["persistence"] == "PLACEMENT · SAVED LOCALLY", reloaded
            assert reloaded["placed"] is True and reloaded["rendererSelected"] == "portal", reloaded
            page.screenshot(path=str(EVIDENCE / "retry-reloaded.png"))
            assert not errors, f"failure/retry page errors: {errors}"
            context.close()

            # A delayed successful save must remain visibly pending until the
            # worker reports the durable acknowledgement.
            slow_context, slow_page, slow_errors = polish.open_phone(
                browser,
                width=390,
                height=844,
                storage_profile={"skip_saves": 2, "delay_ms": 300},
            )
            slow_page.locator('[data-companion="roster"] [data-character-id="workpiece"]').click()
            slow_page.locator('[data-companion="place"]').click()
            slow_page.wait_for_function(
                """
                () => document.querySelector('[data-companion="persistence"]')?.dataset.state === 'saving'
                  && document.querySelector('[data-companion="place"]')?.textContent === 'Saving placement…'
                  && !document.querySelector('[data-companion="reaction"]')?.textContent.toLowerCase().includes('saved locally')
                """
            )
            pending = polish.companion_state(slow_page)
            assert pending["persistenceState"] == "saving", pending
            assert "save acknowledgement" in str(pending["reaction"]), pending
            slow_page.screenshot(path=str(EVIDENCE / "slow-save-pending.png"))
            wait_for_persistence(slow_page, "saved")
            slow_saved = polish.companion_state(slow_page)
            assert slow_saved["persistence"] == "PLACEMENT · SAVED LOCALLY", slow_saved
            slow_page.screenshot(path=str(EVIDENCE / "slow-save-complete.png"))
            assert not slow_errors, f"slow-save page errors: {slow_errors}"
            slow_context.close()
        finally:
            browser.close()
            server.shutdown()
            thread.join(timeout=2)

    print("BROWSER_COMPANION_PERSISTENCE_RETRY_PASS")


if __name__ == "__main__":
    main()
