"""Real remote Neural Memory UI: owner archive, editor recall, revoke, no provider calls."""
from __future__ import annotations

import asyncio
import hashlib
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
                await owner_sheet.get_by_label("Council report to archive").set_input_files(
                    {"name":"fixture.json","mimeType":"application/json","buffer":json.dumps(reports[0]).encode()})
                await owner_sheet.get_by_role("button",name="Archive selected report").click()
                await status(owner_status,"Report archived on private server.")
                await owner_sheet.get_by_role("button",name="Recall evidence").click()
                await status(owner_status,"1 accessible reports")
                await owner_sheet.get_by_text("Restore a local Neural Memory capsule",exact=True).click()
                raw=json.dumps(reports,separators=(",",":"),ensure_ascii=False)
                capsule={"schema":"matumbo.neural-memory-capsule/1","journalJson":raw,
                         "journalSha256":hashlib.sha256(raw.encode()).hexdigest()}
                capsule_status=owner_sheet.get_by_label("Vault capsule status")
                capsule_input=owner_sheet.get_by_label("Local Neural Memory capsule")
                review_button=owner_sheet.get_by_role("button",name="Review capsule on server")
                restore_button=owner_sheet.get_by_role("button",name="Restore reviewed capsule to vault")
                capsule_requests=[]
                owner.on("request",lambda request: capsule_requests.append(request.url) if request.url.endswith("/api/neural-memory/capsule") else None)
                await capsule_input.set_input_files({"name":"recovery.json","mimeType":"application/json","buffer":json.dumps(capsule).encode()})
                check("file selection does not upload or enable restore",not capsule_requests and await restore_button.is_disabled())
                await review_button.click()
                await status(capsule_status,"Preview: 1 new · 1 duplicates · 1 existing.")
                await owner_sheet.get_by_role("button",name="Recall evidence").click()
                await status(owner_status,"1 accessible reports")
                check("review alone does not archive evidence",await owner_sheet.get_by_label("Remote Neural Memory results").locator("details").count()==1)
                await restore_button.click()
                await status(capsule_status,"Restored 1 new reports · 1 duplicates skipped · 2 in private vault.")
                await status(owner_status,"2 accessible reports")
                check("owner archives and restores two reports",await owner_sheet.get_by_label("Remote Neural Memory results").locator("details").count()==2)
                check("exactly one review and one restore request",len(capsule_requests)==2)
                await owner_sheet.get_by_role("button",name="Check last restore receipt").click()
                await status(capsule_status,"Commit confirmed: 1 new reports were restored.")
                receipts=owner_sheet.get_by_label("Vault restore receipts")
                await receipts.locator("summary").click()
                receipt_text=await receipts.inner_text()
                check("restore receipt links capsule and added original evidence",
                      capsule["journalSha256"] in receipt_text and reports[1]["reportSha256"] in receipt_text)
                await owner_sheet.get_by_role("button",name="Recent restore receipts").click()
                await status(capsule_status,"1 recent changed-restore receipts")
                check("owner can recall committed restore history",await receipts.locator("details").count()==1)
                check("receipt queries never resubmit restore",len(capsule_requests)==4)
                await owner_sheet.get_by_text("Back up private evidence vault",exact=True).click()
                async with owner.expect_download(timeout=15000) as pending:
                    await owner_sheet.get_by_role("button",name="Download first backup part").click()
                backup=await pending.value
                backup_path=await backup.path()
                exported=json.loads(backup_path.read_text(encoding="utf-8"))
                check("owner backup preserves exact original capsule",
                      exported==capsule and exported["journalSha256"]==hashlib.sha256(exported["journalJson"].encode()).hexdigest())
                await status(owner_sheet.get_by_label("Vault backup status"),"Final part")
                check("backup is read-only and completes at two reports",len(capsule_requests)==5 and
                      await owner_sheet.get_by_role("button",name="Download next backup part").is_disabled())
                await owner_sheet.get_by_role("button",name="Recall evidence").click()
                await status(owner_status,"2 accessible reports")
                async with owner.expect_download(timeout=15000) as pending:
                    await owner_sheet.get_by_role("button",name="Download complete backup file").click()
                complete=await pending.value
                complete_path=await complete.path()
                bundle=json.loads(complete_path.read_text(encoding="utf-8"))
                manifest=json.loads(bundle["manifestJson"])
                check("complete backup binds all original parts to a manifest",
                      bundle["schema"]=="vivo.memory-backup-set/1" and manifest["total"]==2 and
                      bundle["capsules"]==[capsule] and
                      hashlib.sha256(bundle["manifestJson"].encode()).hexdigest()==bundle["manifestSha256"])
                verify_input=owner_sheet.get_by_label("Complete backup file to verify")
                verify_status=owner_sheet.get_by_label("Backup verification status")
                extract=owner_sheet.get_by_role("button",name="Extract verified capsule")
                await verify_input.set_input_files({"name":"missing.json","mimeType":"application/json",
                    "buffer":json.dumps({**bundle,"capsules":[]}).encode()})
                await status(verify_status,"No capsule available to extract.")
                check("incomplete backup cannot extract a capsule",await extract.is_disabled())
                await verify_input.set_input_files(str(complete_path))
                await status(verify_status,"Verified complete backup: 2 reports · 1 capsule parts.")
                await owner_sheet.get_by_label("Verified recovery part").select_option("0")
                async with owner.expect_download(timeout=15000) as pending:
                    await extract.click()
                extracted=await pending.value
                extracted_path=await extracted.path()
                check("verified backup extracts the exact original restore capsule",
                      json.loads(extracted_path.read_text(encoding="utf-8"))==capsule)
                check("offline verification and extraction make no server requests",len(capsule_requests)==6)

                await open_panel(editor, "neural")
                check("editor cannot see archive or grant controls", not await editor_sheet.get_by_role("button",name="Archive selected report").is_visible())
                check("editor cannot see private capsule restore",not await editor_sheet.get_by_text("Restore a local Neural Memory capsule",exact=True).is_visible())
                check("editor cannot see full vault backup",not await editor_sheet.get_by_text("Back up private evidence vault",exact=True).is_visible())
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
                async with editor.expect_download(timeout=15000) as pending:
                    await result.get_by_role("button",name="Download original report").click()
                download=await pending.value
                downloaded_path=await download.path()
                check("authorized mobile export preserves original envelope",
                      json.loads(downloaded_path.read_text(encoding="utf-8"))==reports[0] and
                      download.suggested_filename=="council-fixture-"+digest[:12]+".json")
                await editor_sheet.get_by_role("button",name="Reason from authorized evidence").click()
                await status(editor_status,"Local reasoning complete · 1 authorized reports")
                reasoning=editor_sheet.get_by_label("Advisory reasoning result")
                reasoning_text=await reasoning.inner_text()
                check("local reasoning independently verifies the optimum",
                      "Verified plan: C,D · cost 7 / 7 · value 13" in reasoning_text and "15 subsets checked · 8 feasible" in reasoning_text)
                await reasoning.locator("summary").click()
                reasoning_text=await reasoning.inner_text()
                check("reasoning retains exact evidence digest and dissent",digest in reasoning_text and "kimi · over-budget · A,C" in reasoning_text)
                await editor_sheet.get_by_text("Plan a custom agent mission",exact=True).click()
                planner=editor_sheet.get_by_label("Verified custom mission result")
                await editor_sheet.get_by_role("button",name="Solve and verify mission").click()
                await status(editor_status,"Mission verified · 1 authorized reports")
                await planner.locator("summary").click()
                plan_text=await planner.inner_text()
                check("exact custom definition reuses only authorized original task evidence",
                      "Verified plan: C,D" in plan_text and "16 subsets checked" in plan_text and digest in plan_text)
                mission_input=editor_sheet.get_by_label("Agent mission definition")
                changed=json.loads(await mission_input.input_value())
                changed["required"]=["A"]
                changed["conflicts"]=[["A","B"]]
                await mission_input.fill(json.dumps(changed))
                check("editing mission invalidates displayed certificate",not (await planner.inner_text()).strip())
                await editor_sheet.get_by_role("button",name="Solve and verify mission").click()
                await status(editor_status,"Mission verified · 0 authorized reports")
                plan_text=await planner.inner_text()
                check("custom constraints change optimum without transferring unrelated memory",
                      "Verified plan: A,D · cost 5 / 7 · value 9" in plan_text and
                      "Historical Council proposals were not recalled." in plan_text and digest not in plan_text)
                await editor_sheet.get_by_role("button",name="Load dependency example").click()
                await editor_sheet.get_by_role("button",name="Solve and verify mission").click()
                await status(editor_status,"Mission verified · 0 authorized reports")
                layered=await planner.inner_text()
                check("dependency planner verifies prerequisites and ordered layers on mobile",
                      "Verified plan: A,C,D · cost 10 / 10 · value 18" in layered and
                      all(label in layered for label in ("Layer 1: A","Layer 2: D","Layer 3: C")) and digest not in layered)
                dependency_mission=json.loads(await mission_input.input_value())
                dependency_mission["required"]=["C"];dependency_mission["budget"]=9
                await mission_input.fill(json.dumps(dependency_mission))
                await editor_sheet.get_by_role("button",name="Solve and verify mission").click()
                await status(editor_status,"Mission verified · 0 authorized reports")
                blocked=await planner.inner_text()
                check("dependency closure explains infeasible required work",
                      "Required closure: A, C, D · minimum cost 10" in blocked and
                      "Mandatory prerequisites exceed the available budget." in blocked)
                dependency_mission["dependencies"].append(["A","C"])
                await mission_input.fill(json.dumps(dependency_mission))
                await editor_sheet.get_by_role("button",name="Solve and verify mission").click()
                await status(editor_status,"MISSION_DEPENDENCY_CYCLE")
                check("cyclic mission is rejected with no displayed certificate",not (await planner.inner_text()).strip())
                await editor_sheet.get_by_label("Agent evidence provenance").select_option("live")
                await editor_sheet.get_by_role("button",name="Prepare agent evidence").click()
                await status(editor_status,"No matching authorized evidence.")
                check("fixture never promoted to live context",await result.locator("details").count()==0)
                await editor_sheet.get_by_label("Agent evidence provenance").select_option("fixture")
                await editor_sheet.get_by_role("button",name="Prepare agent evidence").click()
                await status(editor_status,"Prepared 1 evidence reports")
                await result.locator("summary").click()
                stale_download=result.get_by_role("button",name="Download original report")
                unexpected_downloads=[]
                editor.on("download",lambda download: unexpected_downloads.append(download.suggested_filename))
                await load_button.click()
                await status(owner_status,"Select a collaborator.")
                await invite_select.select_option(label=editor_actor+" · shared")
                await owner_sheet.get_by_role("button",name="Revoke recall access").click()
                await status(owner_status,"Future recall access revoked.")
                # The displayed result predates revocation. A new download
                # must use a fresh authorized get rather than these old bytes.
                await stale_download.click()
                await status(editor_status,"NOT_FOUND")
                check("revoked evidence cannot be exported from stale view",not unexpected_downloads and await result.locator("details").count()==0)
                await editor_sheet.get_by_role("button",name="Prepare agent evidence").click()
                await status(editor_status,"No matching authorized evidence.")
                check("revoked grant cannot be recalled",await result.locator("details").count()==0)
                await editor_sheet.get_by_role("button",name="Reason from authorized evidence").click()
                await status(editor_status,"Local reasoning complete · 0 authorized reports")
                reasoning_text=await reasoning.inner_text()
                check("revocation leaves local proof but no private evidence",
                      "Verified plan: C,D" in reasoning_text and "Local proof only." in reasoning_text and digest not in reasoning_text)
                # Two real fixture envelopes plus two new originals spread across
                # two capsules. The entire set must be reviewed and committed once.
                extra=[]
                for i in range(2):
                    payload=json.loads(reports[0]["reportJson"])
                    payload["runId"]="complete-restore-browser-"+str(i)
                    raw=json.dumps(payload,separators=(",",":"),ensure_ascii=False)
                    extra.append({"schema":"matumbo.provider-council-export/1","reportJson":raw,
                                  "reportSha256":hashlib.sha256(raw.encode()).hexdigest()})
                parts,manifest_parts,offset=[],[],0
                for envelopes in ([reports[0],extra[0]],[reports[1],extra[1]]):
                    raw=json.dumps(envelopes,separators=(",",":"),ensure_ascii=False)
                    part_digest=hashlib.sha256(raw.encode()).hexdigest()
                    parts.append({"schema":"matumbo.neural-memory-capsule/1","journalJson":raw,"journalSha256":part_digest})
                    manifest_parts.append({"offset":offset,"count":len(envelopes),"journalSha256":part_digest})
                    offset+=len(envelopes)
                raw_manifest=json.dumps({"schema":"vivo.memory-backup-manifest/1","revision":"a"*64,
                    "total":offset,"parts":manifest_parts,"includesGrants":False,"includesRestoreReceipts":False},separators=(",",":"))
                complete_set={"schema":"vivo.memory-backup-set/1","manifestJson":raw_manifest,
                    "manifestSha256":hashlib.sha256(raw_manifest.encode()).hexdigest(),"capsules":parts}
                set_requests=[]
                owner.on("request",lambda request:set_requests.append(json.loads(request.post_data)["op"]) if request.url.endswith("/api/neural-memory/backup-set") else None)
                await verify_input.set_input_files({"name":"complete.json","mimeType":"application/json",
                    "buffer":json.dumps(complete_set).encode()})
                await status(verify_status,"Verified complete backup: 4 reports · 2 capsule parts.")
                check("complete restore selection is local and cannot commit",not set_requests and
                      await owner_sheet.get_by_role("button",name="Restore all reviewed reports").is_disabled())
                await owner_sheet.get_by_role("button",name="Review complete backup on server").click()
                set_status=owner_sheet.get_by_label("Complete restore status")
                await status(set_status,"Preview: 2 new · 2 duplicates · 2 parts.")
                await owner_sheet.get_by_role("button",name="Recall evidence").click()
                await status(owner_status,"2 accessible reports")
                check("complete review does not write",set_requests==["preview"])
                await owner_sheet.get_by_role("button",name="Restore all reviewed reports").click()
                await status(set_status,"Restored 2 new reports · 2 duplicates skipped · 4 in private vault.")
                await status(owner_status,"4 accessible reports")
                await owner_sheet.get_by_role("button",name="Check complete restore receipt").click()
                await status(set_status,"Complete commit confirmed: 2 new reports were restored.")
                set_receipts=owner_sheet.get_by_label("Complete restore receipts")
                await set_receipts.locator("summary").click()
                receipt_text=await set_receipts.inner_text()
                check("one complete commit receipt binds both new original reports",
                      complete_set["manifestSha256"] in receipt_text and all(e["reportSha256"] in receipt_text for e in extra))
                await owner_sheet.get_by_role("button",name="Recent complete restore receipts").click()
                await status(set_status,"1 recent complete restore receipts")
                check("complete recovery only commits once",set_requests==["preview","restore","receipt","recent"])
                await editor_sheet.get_by_role("button",name="Prepare agent evidence").click()
                await status(editor_status,"No matching authorized evidence.")
                check("complete restoration grants no new collaborator access",await result.locator("details").count()==0)
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
