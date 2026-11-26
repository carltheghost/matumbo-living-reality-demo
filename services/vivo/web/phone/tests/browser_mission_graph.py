"""Mounted Vivo worker and IndexedDB: dependent missions and receipt evidence."""
from __future__ import annotations
import json
import shutil
import sys
from playwright.sync_api import sync_playwright
from browser_agent_stop import enter_local, open_agent_panel


def exercise(page, route, label):
    world_id = "vivo.phone.mission-graph-" + label
    enter_local(page, route, world_id)
    open_agent_panel(page)
    page.wait_for_function("Boolean(window.VivaPhoneAgentAdmin?.taskAccess)")
    registered = page.evaluate("""async () => {
      const admin=window.VivaPhoneAgentAdmin;
      const a=admin.register({sourceId:'mission-planner',capabilities:['world.read','world.edit']});
      const b=admin.register({sourceId:'mission-builder',capabilities:['world.read','world.edit']});
      const first=await admin.taskAccess.create(a,'Prepare object');
      return {a,b,first};
    }""")
    panel=page.locator("#vivo-ai-accounts")
    panel.get_by_role("button",name="Refresh saved tasks").click()
    page.wait_for_function("document.querySelector('#vivo-ai-accounts')?.dataset.taskBusy==='false'")
    prereq=panel.get_by_role("listbox",name="Prerequisite tasks for new task")
    prereq.select_option(registered["first"]["taskId"])
    panel.locator("#vivoMemoryAgent").select_option(registered["b"]["sessionId"])
    panel.get_by_role("textbox",name="New task title").fill("Build after preparation")
    panel.get_by_role("button",name="Create and attach task").click()
    page.wait_for_function("document.querySelector('#vivo-ai-accounts')?.dataset.taskBusy==='false'")
    second_progress=page.evaluate("async agent=>window.VivaAgentTools.invokeFor(agent,'task.progress')",registered["b"])
    assert second_progress["mission"]["state"]=="blocked",second_progress
    second=second_progress["task"]
    assert second["dependsOn"]==[registered["first"]["taskId"]],second
    edit="""async ({agent,operationId,amount})=>{
      const e=await window.VivaPhoneEngine.snapshot(),spaceId=e.eyes[e.currentEyeId].spaceId;
      const entity=e.snapshot.spaces[spaceId].entities.relic,delta=Array(entity.dimension).fill(0);delta[3]=amount;
      const args={worldId:e.snapshot.worldId,branchId:e.branchId,eyeId:e.currentEyeId,spaceId,
        entityId:entity.id||'relic',baseRevision:entity.revision,operationId,delta,geometry:null};
      try{
        const result=await window.VivaAgentTools.invokeFor(agent,'vivo.world.edit',args);
        await window.VivaPhoneEngine.snapshot();await window.VivaPhoneAgentAdmin.taskAccess.reconcile();
        return {result,args};
      }catch(e){return {error:e.code||e.message};}
    }"""
    blocked=page.evaluate(edit,{"agent":registered["b"],"operationId":"graph:build","amount":0.12})
    assert blocked=={"error":"TASK_PREREQUISITES_INCOMPLETE"},blocked
    prepared=page.evaluate(edit,{"agent":registered["a"],"operationId":"graph:prepare","amount":0})
    assert prepared["result"]["status"]=="accepted",prepared
    assert page.evaluate("async agent=>(await window.VivaAgentTools.invokeFor(agent,'task.progress')).mission.state",registered["b"])=="blocked"
    # Read back the reviewed task/epoch through the existing owner face, then complete it.
    panel.get_by_role("button",name="Refresh saved tasks").click()
    page.wait_for_function("document.querySelector('#vivo-ai-accounts')?.dataset.taskBusy==='false'")
    panel.get_by_role("combobox",name="Saved task in this world and branch").select_option(registered["first"]["taskId"])
    panel.locator("#vivoMemoryAgent").select_option(registered["a"]["sessionId"])
    panel.get_by_role("button",name="Complete selected task with confirmed receipts").click()
    page.wait_for_function("document.querySelector('#vivo-ai-accounts')?.dataset.taskBusy==='false'")
    ready=page.evaluate("async agent=>window.VivaAgentTools.invokeFor(agent,'task.progress')",registered["b"])
    assert ready["mission"]["state"]=="ready",ready
    assert ready["mission"]["dependencies"][0]["receipts"][0]["operationId"]=="graph:prepare",ready
    assert ready["mission"]["authorizesAction"] is False,ready
    built=page.evaluate(edit,{"agent":registered["b"],"operationId":"graph:build","amount":0.12})
    assert built["result"]["status"]=="accepted",built
    enter_local(page,route,world_id)
    open_agent_panel(page)
    restored=page.evaluate("""async ({taskId,branchId})=>{
      const admin=window.VivaPhoneAgentAdmin,e=await window.VivaPhoneEngine.snapshot();
      const agent=admin.register({sourceId:'mission-builder',capabilities:['world.read','world.edit']});
      const before=window.VivaAgentTools.listFor(agent).some(t=>t.name==='task.progress');
      await admin.taskAccess.resume(agent,taskId);
      const p=await window.VivaAgentTools.invokeFor(agent,'task.progress');
      return {before,sameBranch:e.branchId===branchId,p,receipts:e.snapshot.localOperationResults.filter(r=>r.operationId.startsWith('graph:')).map(r=>r.operationId)};
    }""",{"taskId":second["id"],"branchId":built["args"]["branchId"]})
    assert not restored["before"] and restored["sameBranch"],restored
    assert restored["p"]["mission"]["state"]=="ready",restored
    assert restored["p"]["mission"]["dependencies"][0]["receipts"][0]["operationId"]=="graph:prepare",restored
    assert restored["p"]["task"]["steps"][0]["state"]=="confirmed",restored
    assert sorted(restored["receipts"])==["graph:build","graph:prepare"],restored
    # Owner-side recommendation must not auto-attach or replay any action.
    state=page.evaluate("""async taskId=>{
      const admin=window.VivaPhoneAgentAdmin;
      const builder=admin.agents().find(a=>a.sourceId==='mission-builder');
      admin.taskAccess.pause(builder);
      const other=admin.register({sourceId:'mission-reviewer',capabilities:['world.read','world.edit']});
      const plan=await admin.taskAccess.recommend(taskId);
      return {builder,other,plan,before:window.VivaAgentTools.listFor(builder).some(t=>t.name==='task.progress')};
    }""",second["id"])
    assert state["plan"]["recommended"]["sourceId"]=="mission-builder" and not state["before"],state
    panel=page.locator("#vivo-ai-accounts")
    panel.get_by_role("button",name="Refresh saved tasks").click()
    page.wait_for_function("document.querySelector('#vivo-ai-accounts')?.dataset.taskBusy==='false'")
    panel.get_by_role("combobox",name="Saved task in this world and branch").select_option(second["id"])
    panel.get_by_role("button",name="Recommend agent for selected task").click()
    page.wait_for_function("document.querySelector('#vivo-ai-accounts')?.dataset.taskBusy==='false'")
    assert panel.get_by_role("button",name="Approve recommended assignment").is_enabled()
    page.evaluate("agent=>window.VivaPhoneAgentAdmin.stop(agent.sessionId,'test-stale-plan')",state["builder"])
    panel.get_by_role("button",name="Approve recommended assignment").click()
    page.wait_for_function("document.querySelector('#vivo-ai-accounts')?.dataset.taskBusy==='false'")
    assert page.evaluate("agent=>window.VivaAgentTools.listFor(agent).some(t=>t.name==='task.progress')",state["other"]) is False
    panel.get_by_role("button",name="Recommend agent for selected task").click()
    page.wait_for_function("document.querySelector('#vivo-ai-accounts')?.dataset.taskBusy==='false'")
    assert panel.get_by_role("button",name="Approve recommended assignment").is_enabled()
    panel.get_by_role("button",name="Approve recommended assignment").click()
    page.wait_for_function("document.querySelector('#vivo-ai-accounts')?.dataset.taskBusy==='false'")
    assigned=page.evaluate("""async agent=>{
      const p=await window.VivaAgentTools.invokeFor(agent,'task.progress'),e=await window.VivaPhoneEngine.snapshot();
      return {p,receipts:e.snapshot.localOperationResults.filter(r=>r.operationId.startsWith('graph:')).map(r=>r.operationId)};
    }""",state["other"])
    assert assigned["p"]["task"]["sourceId"]=="mission-reviewer",assigned
    assert assigned["p"]["task"]["steps"][0]["sourceId"]=="mission-builder",assigned
    assert sorted(assigned["receipts"])==["graph:build","graph:prepare"],assigned
    return {"blockedBeforeCompletion":True,"receiptEvidenceShared":True,"confirmedOperations":2,"reloaded":True,"autoGrant":False,"advisoryAssignment":True,"staleRecommendationRejected":True}


def main(base):
    route=base.rstrip("/")+"/services/vivo/web/phone/"
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=shutil.which("chromium") or shutil.which("chromium-browser"),args=["--no-sandbox","--disable-gpu"])
        result={}
        for label,viewport in [("desktop",{"width":1000,"height":900}),("mobile",{"width":390,"height":844})]:
            context=browser.new_context(viewport=viewport)
            page=context.new_page();page.set_default_timeout(15000);errors=[]
            page.on("pageerror",lambda error:errors.append(str(error)))
            result[label]=exercise(page,route,label)
            assert not errors,errors
            context.close()
        browser.close()
    print(json.dumps(result))


if __name__=="__main__":
    main(sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:9897/")
