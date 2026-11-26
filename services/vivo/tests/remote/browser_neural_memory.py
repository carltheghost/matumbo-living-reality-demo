"""Real remote Neural Memory UI: owner archive, editor recall, revoke, no provider calls."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit

from playwright.async_api import async_playwright
from browser_two_person import BASE, OWNER_TOKEN, REPORT, connect, open_panel, wait_text

ROOT = Path(__file__).resolve().parents[4]


def fixture(task):
    return json.loads(subprocess.check_output(
        ["node", str(ROOT / "scripts/vivo/provider-council.mjs"), "--fixture", "--task="+task],
        cwd=ROOT, text=True))


async def main():
    reports = [fixture("route"), fixture("arithmetic")]
    digest = reports[0]["reportSha256"]
    checks, errors, forbidden = [], [], []
    origin = urlsplit(BASE)
    def check(name, condition):
        checks.append({"name":name,"passed":bool(condition)})
        if not condition:
            raise AssertionError(name)
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=["--no-sandbox","--disable-dev-shm-usage"])
            owner_context = await browser.new_context(viewport={"width":1280,"height":900})
            editor_context = await browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True)
            async def route(request_route):
                url = urlsplit(request_route.request.url)
                if (url.scheme, url.netloc) == (origin.scheme, origin.netloc):
                    await request_route.continue_()
                else:
                    forbidden.append(url.hostname or url.scheme)
                    await request_route.abort()
            for context in [owner_context, editor_context]:
                await context.route("**/*", route)
            owner, editor = await owner_context.new_page(), await editor_context.new_page()
            for page in [owner, editor]:
                page.on("pageerror", lambda error: errors.append(str(error)))
            try:
                await connect(owner, OWNER_TOKEN, "owner")
                await open_panel(owner, "people")
                async def create_invite(previous=""):
                    await owner.click("#makeInvite")
                    # No eval: bounded DOM-value polling under strict CSP.
                    deadline = asyncio.get_running_loop().time() + 10
                    while asyncio.get_running_loop().time() < deadline:
                        value = await owner.locator("#inviteLink").input_value()
                        if "#token=" in value and value != previous:
                            return value
                        await asyncio.sleep(0.1)
                    raise AssertionError("new invitation was not produced")
                # Keep an older active invitation so an implicit first-option
                # grant would target the wrong actor, even in an isolated run.
                older_invite = await create_invite()
                invite = await create_invite(older_invite)
                check("two distinct invitations created under strict CSP", invite != older_invite)
                await editor.goto(invite, wait_until="domcontentloaded", timeout=60000)
                await wait_text(editor, "#serviceReady", "REMOTE AUTHORITY READY")
                await editor.click("#createRoom")
                editor_label = await wait_text(editor, "#connection", "REMOTE EDITOR")
                editor_actor = editor_label.split(" · ")[-1]
                check("authenticated editor identity", editor_actor.startswith("remote.invite."))
                await editor.locator("#toolbar").wait_for(state="visible")

                owner_sheet = owner.locator('[data-sheet="neural"]')
                editor_sheet = editor.locator('[data-sheet="neural"]')
                owner_status = owner_sheet.get_by_role("status")
                editor_status = editor_sheet.get_by_role("status")
                async def status(locator, expected):
                    from playwright.async_api import expect
                    await expect(locator).to_contain_text(expected, timeout=15000)
                await open_panel(owner, "neural")
                for envelope in reports:
                    await owner_sheet.get_by_label("Council report to archive").set_input_files(
                        {"name":"fixture.json","mimeType":"application/json","buffer":json.dumps(envelope).encode()})
                    await owner_sheet.get_by_role("button",name="Archive selected report").click()
                    await status(owner_status,"Report archived on private server.")
                await owner_sheet.get_by_role("button",name="Recall evidence").click()
                await status(owner_status,"2 accessible reports")
                check("owner archives two reports", await owner_sheet.get_by_label("Remote Neural Memory results").locator("details").count()==2)

                await open_panel(editor, "neural")
                check("editor cannot see archive or grant controls", not await editor_sheet.get_by_role("button",name="Archive selected report").is_visible())
                await editor_sheet.get_by_text("Prepare agent evidence context",exact=True).click()
                await editor_sheet.get_by_label("Required provider in evidence").select_option("kimi")
                await editor_sheet.get_by_role("button",name="Prepare agent evidence").click()
                await status(editor_status,"No matching authorized evidence.")
                check("unshared evidence is absent",await editor_sheet.get_by_label("Remote Neural Memory results").locator("details").count()==0)

                evidence_select = owner_sheet.get_by_label("Evidence to share")
                invite_select = owner_sheet.get_by_label("Collaborator invitation")
                grant_button = owner_sheet.get_by_role("button",name="Grant recall access")
                load_button = owner_sheet.get_by_role("button",name="Load invitations and grants")
                check("no evidence implicitly selected", await evidence_select.input_value()=="" and await load_button.is_disabled())
                await evidence_select.select_option("council:"+digest)
                await load_button.click()
                await status(owner_status,"Select a collaborator.")
                check("multiple invitations but no implicit grant target",
                      await invite_select.locator("option").count()>=3 and await invite_select.input_value()=="" and await grant_button.is_disabled())
                await invite_select.select_option(label=editor_actor+" · private")
                check("explicit editor target enables grant", not await grant_button.is_disabled())
                # Changing the report must invalidate the loaded invitation
                # target, even if the same actor is still active.
                await evidence_select.select_option("council:"+reports[1]["reportSha256"])
                check("changing evidence invalidates the selected grant target",
                      await invite_select.input_value()=="" and await grant_button.is_disabled())
                await evidence_select.select_option("council:"+digest)
                await load_button.click()
                await status(owner_status,"Select a collaborator.")
                await invite_select.select_option(label=editor_actor+" · private")
                await grant_button.click()
                await status(owner_status,"Recall access granted. Target: "+editor_actor)
                await editor_sheet.get_by_role("button",name="Prepare agent evidence").click()
                await status(editor_status,"Prepared 1 evidence reports")
                result = editor_sheet.get_by_label("Remote Neural Memory results")
                await result.locator("summary").click()
                text = await result.inner_text()
                check("exact digest and dissent recalled on mobile",digest in text and "kimi · over-budget · A,C" in text and "Fixture · not live" in text)
                check("only selected mission is shared",await result.locator("details").count()==1)
                await editor_sheet.get_by_label("Agent evidence provenance").select_option("live")
                await editor_sheet.get_by_role("button",name="Prepare agent evidence").click()
                await status(editor_status,"No matching authorized evidence.")
                check("fixture never promoted to live context",await result.locator("details").count()==0)
                await editor_sheet.get_by_label("Agent evidence provenance").select_option("fixture")
                await load_button.click()
                await status(owner_status,"Select a collaborator.")
                await invite_select.select_option(label=editor_actor+" · shared")
                await owner_sheet.get_by_role("button",name="Revoke recall access").click()
                await status(owner_status,"Future recall access revoked.")
                await editor_sheet.get_by_role("button",name="Prepare agent evidence").click()
                await status(editor_status,"No matching authorized evidence.")
                check("revoked grant cannot be recalled",await result.locator("details").count()==0)
                check("no page errors",not errors)
                check("no external browser requests",not forbidden)
            finally:
                await editor_context.close()
                await owner_context.close()
                await browser.close()
    finally:
        evidence={"schema":"vivo.remote-memory-browser/1","checks":checks,
                  "passed":sum(c["passed"] for c in checks),"pageErrors":errors,"forbiddenHosts":forbidden,
                  "physicalDeviceValidated":False,"paidProviderCalls":False}
        REPORT.write_text(json.dumps(evidence,indent=2)+"\n")
        print(json.dumps(evidence,indent=2))


if __name__=="__main__":
    asyncio.run(main())
