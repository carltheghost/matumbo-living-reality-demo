"""Actual native agent bridge and UI, with synthetic same-origin GitHub HTTP.
No GitHub credentials, external calls, or Copilot execution.
"""
from __future__ import annotations
import json
import re
import shutil
import sys
from playwright.sync_api import sync_playwright
from browser_agent_stop import enter_local, open_agent_panel

REPO="owner/repo"
HEAD="a"*40
FILE="src/main.py"
def exercise(context,page,route,label):
    requests=[]
    current={"head":HEAD}
    branch_ref="refs/heads/vivo/agent/repair-"+"d"*16
    review_id="fixture-branch-review"
    branch_receipts=[]
    branch_base={"repository":REPO,"pullNumber":7,"headSha":HEAD,"reviewId":review_id,
                 "ref":branch_ref,"codeApplied":False,"authorizesAction":False,
                 "url":"https://github.com/owner/repo/tree/vivo/agent/repair-"+"d"*16}
    def reply(intercept):
        req=intercept.request
        endpoint=req.url.split("/api/vivo/accounts/github",1)[1]
        body=req.post_data_json if req.method=="POST" else None
        requests.append((endpoint,body))
        def send(data,status=200):
            intercept.fulfill(status=status,content_type="application/json",body=json.dumps(data))
        if endpoint=="":
            assert req.method=="GET"
            return send({"schema":"vivo.github-connector/1","configured":True,"repositories":[REPO],"liveAccessVerified":False,"readOnly":True})
        if endpoint=="/branch":
            assert req.method=="GET"
            return send({"schema":"vivo.github-branch-status/1","configured":True,"repositories":[REPO],
                         "receipts":branch_receipts,"authorizesAction":False,"processLocal":True})
        assert req.method=="POST" and req.headers.get("x-vivo-action")=="user"
        if endpoint=="/branch/preview":
            assert body=={"repository":REPO,"pullNumber":7,"expectedHeadSha":HEAD,"slug":"repair"},body
            return send({**branch_base,"schema":"vivo.github-branch-preview/1","state":"reviewed",
                         "reason":None,"observedSha":None,"expiresInSeconds":300,
                         "requiresExactRefConfirmation":True,"mayTriggerWorkflows":True})
        if endpoint=="/branch/execute":
            assert body=={"reviewId":review_id,"confirmation":branch_ref},body
            assert not branch_receipts,"duplicate branch dispatch"
            branch_receipts.append({**branch_base,"schema":"vivo.github-branch-receipt/1","state":"uncertain",
                                    "reason":"GITHUB_BRANCH_RESULT_UNCONFIRMED","observedSha":None})
            return send(branch_receipts[0])
        if endpoint=="/branch/reconcile":
            assert body=={"reviewId":review_id},body
            assert branch_receipts[0]["state"]=="uncertain"
            branch_receipts[0].update(state="observed-matching",reason="OBSERVATION_NOT_CREATION_PROOF",observedSha=HEAD)
            return send(branch_receipts[0])
        assert body["repository"]==REPO and body["pullNumber"]==7
        if body.get("expectedHeadSha") not in (None,current["head"]):
            return send({"error":"GITHUB_HEAD_CHANGED"},400)
        if endpoint=="/inspect":
            assert set(body) in ({"repository","pullNumber"},{"repository","pullNumber","expectedHeadSha"})
            return send({"schema":"vivo.github-pull-review/1","repository":REPO,"pullNumber":7,"headSha":current["head"],"sameRepositoryHead":True,
                "title":"Fixture review","state":"open","draft":True,"merged":False,"workflowTotal":1,"workflowPageComplete":True,
                "workflows":[{"id":11,"name":"Tests","status":"completed","conclusion":"success"}],"readOnly":True,"authorizesAction":False})
        if endpoint=="/file":
            assert body=={"repository":REPO,"pullNumber":7,"expectedHeadSha":HEAD,"path":FILE}
            return send({"schema":"vivo.github-file/1","repository":REPO,"pullNumber":7,"headSha":HEAD,"path":FILE,
                "size":8,"blobSha":"b"*40,"content":"print(1)","readOnly":True,"authorizesAction":False})
        raise AssertionError(endpoint)
    context.route(re.compile(r"/api/vivo/accounts/github(?:/inspect|/file|/branch(?:/preview|/execute|/reconcile)?)?$"),reply)
    world="vivo.phone.github-agent-"+label
    enter_local(page,route,world);open_agent_panel(page)
    panel=page.locator("#vivo-ai-accounts")
    panel.get_by_role("searchbox",name="Search AI providers").fill("GitHub")
    panel.locator("[data-provider-id=github-agent]").click()
    assert not requests
    panel.get_by_role("button",name="Check GitHub connector").click()
    page.wait_for_function("document.querySelector('#vivoGitHubReview').textContent.includes('Configured repositories: owner/repo')")
    assert len(requests)==1
    panel.get_by_role("spinbutton",name="GitHub pull request number").fill("7")
    panel.get_by_role("textbox",name="Optional GitHub file path").fill(FILE)
    panel.get_by_role("button",name="Verify GitHub pull request").click()
    page.wait_for_function("document.querySelector('#vivoGitHubReview').textContent.includes('Reviewed head:')")
    assert page.evaluate("window.VivaPhoneAgentAdmin.githubAccess.status().length")==0
    assert len(requests)==2
    panel.get_by_role("button",name="Create GitHub review agent and grant").click()
    page.wait_for_function("window.VivaPhoneAgentAdmin.githubAccess.status().length===1")
    agent=page.evaluate("window.VivaPhoneAgentAdmin.agents().find(a=>a.sourceId==='github-repository-reader')")
    assert agent["capabilities"]==[],agent
    tools=page.evaluate("agent=>window.VivaAgentTools.listFor(agent).map(t=>t.name)",agent)
    assert "github.pull.read" in tools and "github.file.read" in tools and "vivo.world.edit" not in tools,tools
    assert len(requests)==2
    panel.get_by_role("button",name="Read reviewed pull request",exact=True).click()
    page.wait_for_function("document.querySelector('#vivoGitHubReview').textContent.includes('Tests · completed · success')")
    panel.get_by_role("button",name="Read approved GitHub file",exact=True).click()
    page.wait_for_function("document.querySelector('#vivoGitHubReview').textContent.includes('print(1)')")
    result=page.evaluate("""async agent=>{
      try{await window.VivaAgentTools.invokeFor(agent,'github.file.read',{path:'private.txt'});return 'unexpected';}
      catch(e){return e.code;}
    }""",agent)
    assert result=="GITHUB_ARGUMENTS_INVALID",result
    assert len(requests)==4,requests
    # A proposal performs a pinned read, never a write.
    panel.get_by_text("GitHub development proposal",exact=True).click()
    panel.get_by_role("textbox",name="GitHub change summary").fill("Repair fixture")
    panel.get_by_role("textbox",name="GitHub proposed test plan").fill("Run focused tests")
    panel.get_by_role("textbox",name="GitHub proposed replacement").fill("print(2)")
    panel.get_by_role("button",name="Stage local GitHub change proposal").click()
    page.wait_for_function("document.querySelector('#vivoGitHubProposal').textContent.includes('PROPOSED REPLACEMENT (not applied)')")
    assert "print(1)" in panel.locator("#vivoGitHubProposal").inner_text()
    assert "print(2)" in panel.locator("#vivoGitHubProposal").inner_text()
    assert len(requests)==5,requests
    assert "github.change.propose" in tools and not any(t.startswith("github.branch.") for t in tools),tools
    panel.get_by_role("textbox",name="GitHub development branch label").fill("repair")
    panel.get_by_role("button",name="Review new GitHub development branch").click()
    page.wait_for_function("document.querySelector('#vivoGitHubBranch').textContent.includes('New ref:')")
    assert branch_ref in panel.locator("#vivoGitHubBranch").inner_text()
    assert "Creation may trigger repository workflows" in panel.locator("#vivoGitHubBranch").inner_text()
    assert not branch_receipts
    panel.get_by_role("textbox",name="Confirm exact GitHub branch ref").fill("refs/heads/main")
    panel.get_by_role("button",name="Approve and create reviewed branch").click()
    page.wait_for_function("document.querySelector('#vivoAccountStatus').textContent.includes('Type the exact reviewed branch ref')")
    assert not branch_receipts
    panel.get_by_role("textbox",name="Confirm exact GitHub branch ref").fill(branch_ref)
    panel.get_by_role("button",name="Approve and create reviewed branch").click()
    page.wait_for_function("document.querySelector('#vivoGitHubBranch').textContent.includes('uncertain')")
    assert len(branch_receipts)==1
    assert panel.get_by_role("button",name="Approve and create reviewed branch").is_disabled()
    panel.get_by_role("button",name="Check GitHub branch writer and receipts").click()
    page.wait_for_function("document.querySelector('#vivoGitHubBranchReceipts').textContent.includes('uncertain')")
    panel.get_by_role("combobox",name="Uncertain GitHub branch receipt").select_option(review_id)
    panel.get_by_role("button",name="Reconcile selected branch receipt").click()
    page.wait_for_function("document.querySelector('#vivoGitHubBranchReceipts').textContent.includes('observed-matching')")
    assert len([x for x in requests if x[0]=="/branch/execute"])==1
    assert branch_receipts[0]["codeApplied"] is False
    current["head"]="c"*40
    stale=page.evaluate("""async agent=>{try{await window.VivaAgentTools.invokeFor(agent,'github.pull.read');return 'unexpected';}catch(e){return e.code;}}""",agent)
    assert stale=="GITHUB_HEAD_CHANGED",stale
    panel.get_by_role("button",name="Revoke selected GitHub agent access").click()
    page.wait_for_function("window.VivaPhoneAgentAdmin.githubAccess.status().length===0")
    assert not page.evaluate("agent=>window.VivaAgentTools.listFor(agent).some(t=>t.name.startsWith('github.'))",agent)
    current["head"]=HEAD
    panel.get_by_role("button",name="Verify GitHub pull request").click()
    page.wait_for_function("document.querySelector('#vivoGitHubReview').textContent.includes('Reviewed head:')")
    panel.get_by_role("button",name="Grant reviewed GitHub access to selected agent").click()
    page.wait_for_function("window.VivaPhoneAgentAdmin.githubAccess.status().length===1")
    before=len(requests)
    enter_local(page,route,world);open_agent_panel(page)
    assert page.evaluate("window.VivaPhoneAgentAdmin.githubAccess.status().length")==0
    assert len(requests)==before
    return {"explicitReview":True,"nativeAgentGrant":True,"exactCommitAndFile":True,"staleHeadRejected":True,"revoke":True,"reloadNoGrant":True,"localProposal":True,"exactBranchConfirmation":True,"uncertainBranchReconciled":True,"noBranchRetry":True,"providerCalls":0,"fixtureRequests":before}

def main(base):
    route=base.rstrip("/")+"/services/vivo/web/phone/"
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=shutil.which("chromium") or shutil.which("chromium-browser"),args=["--no-sandbox","--disable-gpu"])
        results={}
        for label,viewport in [("desktop",{"width":1000,"height":900}),("mobile",{"width":390,"height":844})]:
            context=browser.new_context(viewport=viewport)
            page=context.new_page();page.set_default_timeout(15000);errors=[]
            page.on("pageerror",lambda error:errors.append(str(error)))
            results[label]=exercise(context,page,route,label)
            assert not errors,errors
            context.close()
        browser.close()
    print(json.dumps(results))
if __name__=="__main__":main(sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:9897/")
