"""Two-page phone authority adapter smoke against the mounted local HTTP app.

This is synthetic loopback browser evidence.  It exercises the explicit phone
adapter boundary, not physical camera, hand, head, AR, or VR hardware.

Run against the canonical local launcher, for example::

    python services/vivo/web/phone/tests/browser_authority_adapter.py \
      http://127.0.0.1:9895 browser-authority-adapter.json
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9895"
REPORT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("browser-authority-adapter.json")


async def main() -> None:
    base = BASE.rstrip("/")
    page_errors: list[dict[str, str]] = []
    rpc_ops: dict[str, list[str]] = {"one": [], "two": []}
    evidence: dict[str, object] = {}
    camera_calls = 0

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        pages = []
        try:
            for seat in ("one", "two"):
                context = await browser.new_context(viewport={"width": 1280, "height": 900})
                await context.add_init_script(
                    """
                    window.__vivoCameraCalls = 0;
                    if (navigator.mediaDevices) {
                      const original = navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);
                      navigator.mediaDevices.getUserMedia = (...args) => {
                        window.__vivoCameraCalls++;
                        return Promise.reject(new Error('phone authority browser smoke camera gate'));
                      };
                      window.__vivoOriginalGetUserMedia = Boolean(original);
                    }
                    """
                )
                page = await context.new_page()
                pages.append(page)
                page.on("pageerror", lambda error, seat=seat: page_errors.append({"seat": seat, "message": str(error)}))
                page.on(
                    "request",
                    lambda request, seat=seat: rpc_ops[seat].append(
                        json.loads(request.post_data or "{}").get("op", "?")
                    )
                    if "/api/local/rpc" in request.url and request.post_data
                    else None,
                )
                response = await page.goto(
                    f"{base}/local/accepted/", wait_until="domcontentloaded", timeout=60000
                )
                assert response is not None and response.status == 200, response
                await page.evaluate(
                    """
                    () => {
                      if (window.__phoneAuthorityFetchInstalled) return;
                      const nativeFetch = window.fetch.bind(window);
                      window.__phoneAuthorityFetchInstalled = true;
                      window.fetch = (input, init) => {
                        const url = typeof input === 'string' ? input : input?.url;
                        if (url?.includes('/api/local/rpc')) {
                          window.__phoneAuthorityFetches = (window.__phoneAuthorityFetches || 0) + 1;
                        }
                        return nativeFetch(input, init);
                      };
                    }
                    """
                )
                await page.evaluate(
                    """
                    async seat => {
                      const {createPhoneSnapshot, createEye} = await import('/phone/engine.mjs');
                      const {PhoneAuthorityAdapter} = await import('/phone/authority-adapter.mjs');
                      const snapshot = createPhoneSnapshot({
                        worldId: `browser.phone.${seat}`,
                        rootDimension: 4,
                      });
                      const eye = createEye({id: `browser.eye.${seat}`, dimension: 4});
                      const localEnvelope = {
                        snapshot,
                        eyes: {[eye.id]: eye},
                        currentEyeId: eye.id,
                        branchId: `browser.${seat}`,
                        mode: 'local',
                        parentBranchId: null,
                        branchLabel: null,
                        forkedAt: null,
                        persistence: {state: 'memory-only', error: null},
                      };
                      window.__phoneAuthorityLocal = localEnvelope;
                      window.__phoneAuthority = new PhoneAuthorityAdapter({
                        snapshot: () => structuredClone(localEnvelope),
                        seat,
                      });
                      await window.__phoneAuthority.syncLocal();
                    }
                    """,
                    seat,
                )

            one, two = pages
            await one.evaluate("window.__phoneAuthority.connect()")
            preview_before = await one.evaluate("window.__phoneAuthorityFetches || 0")
            preview = await one.evaluate("window.__phoneAuthority.preview()")
            preview_after = await one.evaluate("window.__phoneAuthorityFetches || 0")
            assert preview["status"] == "preview", preview
            assert preview["code"] == "PHONE_PREVIEW_ONLY", preview
            assert preview_before == preview_after, (preview_before, preview_after)

            # The local phone object is explicitly edited, then projected.  A
            # projection must move only the accepted binding, never the
            # canonical entity or the local phone envelope.
            await one.evaluate(
                """
                () => {
                  window.__phoneAuthorityLocal.snapshot.spaces.root.entities.relic.q[0] = -0.8;
                }
                """
            )
            before_publish = await one.evaluate("window.__phoneAuthority.debug()")
            publish = await one.evaluate("window.__phoneAuthority.publish()")
            assert publish["status"] == "accepted" and publish["projectionOnly"] is True, publish
            after_publish = await one.evaluate("window.__phoneAuthority.debug()")
            assert abs(after_publish["mapping"]["q"][0] + 0.8) < 1e-9
            assert after_publish["acceptedBinding"]["q"][0] == -0.8
            assert after_publish["acceptedEntity"]["q"][0] == -1.2
            assert after_publish["acceptedEntity"]["revision"] == 0
            assert after_publish["local"]["worldId"] == before_publish["local"]["worldId"]

            # The second page joins after the projection, edits its own local
            # envelope, and performs the stronger canonical commit.  The first
            # page then reads the accepted result without receiving that q.
            await two.evaluate("window.__phoneAuthority.connect()")
            await two.evaluate(
                """
                () => {
                  window.__phoneAuthorityLocal.snapshot.spaces.root.entities.relic.q[0] = 1.75;
                }
                """
            )
            commit = await two.evaluate("window.__phoneAuthority.commit()")
            assert commit["status"] == "accepted" and commit["canonical"] is True, commit
            after_commit_two = await two.evaluate("window.__phoneAuthority.debug()")
            assert after_commit_two["acceptedEntity"]["q"][0] == 1.75
            assert after_commit_two["acceptedEntity"]["revision"] == 1
            assert after_commit_two["acceptedBinding"]["q"][0] == 1.75
            await one.evaluate("window.__phoneAuthority.read()")
            after_remote_read_one = await one.evaluate("window.__phoneAuthority.debug()")
            assert after_remote_read_one["acceptedEntity"]["q"][0] == 1.75
            assert after_remote_read_one["acceptedEntity"]["revision"] == 1
            assert abs(after_remote_read_one["mapping"]["q"][0] + 0.8) < 1e-9
            assert after_remote_read_one["local"]["worldId"] == before_publish["local"]["worldId"]

            # An explicit offline branch is local-only.  Capture the RPC count
            # to prove the adapter fails closed before transport submission.
            rpc_before_offline = await one.evaluate("window.__phoneAuthorityFetches || 0")
            await one.evaluate(
                """
                () => {
                  window.__phoneAuthorityLocal.mode = 'offline-branch';
                  window.__phoneAuthorityLocal.branchId = 'browser.offline.branch';
                  window.__phoneAuthorityLocal.parentBranchId = 'browser.one';
                }
                """
            )
            offline = await one.evaluate("window.__phoneAuthority.commit()")
            rpc_after_offline = await one.evaluate("window.__phoneAuthorityFetches || 0")
            assert offline["status"] == "rejected", offline
            assert offline["code"] == "PHONE_OFFLINE_BRANCH_NO_SEND", offline
            assert rpc_before_offline == rpc_after_offline, (rpc_before_offline, rpc_after_offline)

            capability_one = await one.evaluate("window.__phoneAuthority.debug()")
            capability_two = await two.evaluate("window.__phoneAuthority.debug()")
            assert capability_two["capabilities"]["canonicalCommit"]["allowed"] is True
            assert capability_two["authorityPersistence"]["mode"] == "session-only"
            assert capability_two["authorityPersistence"]["durable"] is False
            evidence = {
                "preview": preview,
                "publish": publish,
                "commit": commit,
                "offline": offline,
                "beforePublish": before_publish,
                "afterPublish": after_publish,
                "afterCommitTwo": after_commit_two,
                "afterRemoteReadOne": after_remote_read_one,
                "offlineRpcCounts": [rpc_before_offline, rpc_after_offline],
                "capabilityOne": capability_one["capabilities"],
                "capabilityTwo": capability_two["capabilities"],
                "authorityPersistence": capability_two["authorityPersistence"],
            }
            camera_calls = await one.evaluate("window.__vivoCameraCalls") + await two.evaluate("window.__vivoCameraCalls")
        finally:
            await browser.close()

    assert camera_calls == 0, camera_calls
    assert not page_errors, page_errors
    report = {
        "schema": "vivo.browser-phone-authority-adapter/1",
        "physicalDeviceValidated": False,
        "cameraCalls": camera_calls,
        "rpcOps": rpc_ops,
        "pageErrors": page_errors,
        "evidence": evidence,
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
