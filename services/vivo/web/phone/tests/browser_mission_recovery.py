"""Real mounted worker and IndexedDB: diagnosed blockers and evidence-preserving recovery."""
from __future__ import annotations
import json
import shutil
import sys
from playwright.sync_api import sync_playwright
from browser_agent_stop import enter_local, open_agent_panel


def exercise(page, route, label):
    world_id = "vivo.phone.mission-recovery-" + label
    enter_local(page, route, world_id)
    open_agent_panel(page)
    page.wait_for_function("Boolean(window.VivaPhoneAgentAdmin?.taskAccess?.diagnose)")
    setup=page.evaluate("""async()=>{
      const admin=window.VivaPhoneAgentAdmin;
      const a=admin.register({sourceId:'recovery-a',capabilities:['world.read','world.edit']});
      const b=admin.register({sourceId:'recovery-b',capabilities:['world.read','world.edit']});
      const c=admin.register({sourceId:'recovery-c',capabilities:['world.read','world.edit']});
      const root=await admin.taskAccess.create(a,'Archived preparation');
      const dependent=await admin.taskAccess.create(b,'Dependent construction',[root.taskId]);
      return {a,b,c,root,dependent};
    }""")
    edit="""async ({agent,operationId,amount})=>{
      const host=window.VivaPhoneEngine,admin=window.VivaPhoneAgentAdmin;
      const e=await host.snapshot(),spaceId=e.eyes[e.currentEyeId].spaceId;
      const entity=e.snapshot.spaces[spaceId].entities.relic,delta=Array(entity.dimension).fill(0);delta[3]=amount;
      const result=await window.VivaAgentTools.invokeFor(agent,'vivo.world.edit',{worldId:e.snapshot.worldId,branchId:e.branchId,
        eyeId:e.currentEyeId,spaceId,entityId:entity.id||'relic',baseRevision:entity.revision,operationId,delta,geometry:null});
      await host.snapshot();await admin.taskAccess.reconcile();
      return {result,progress:await window.VivaAgentTools.invokeFor(agent,'task.progress'),branchId:e.branchId};
    }"""
    first=page.evaluate(edit,{"agent":setup["a"],"operationId":"recovery:before","amount":0})
    assert first["result"]["status"]=="accepted",first
    page.evaluate("""async agent=>{
      const admin=window.VivaPhoneAgentAdmin;
      await admin.taskAccess.finish(agent);await admin.stop(agent.sessionId,'fixture archived agent');
    }""",setup["a"])
    blocked=page.evaluate("taskId=>window.VivaPhoneAgentAdmin.taskAccess.diagnose(taskId)",setup["dependent"]["taskId"])
    assert blocked["target"]["state"]=="waiting-prerequisites",blocked
    assert blocked["roots"][0]["state"]=="closed-incomplete",blocked
    assert blocked["roots"][0]["assignment"]["sourceId"]=="recovery-c",blocked
    assert blocked["reviewToken"] is None,blocked
    panel=page.locator("#vivo-ai-accounts")
    def idle():
        page.wait_for_function("document.querySelector('#vivo-ai-accounts')?.dataset.taskBusy==='false'")
    panel.get_by_role("button",name="Refresh saved tasks").click()
    idle()
    panel.get_by_role("combobox",name="Saved task in this world and branch").select_option(setup["root"]["taskId"])
    panel.get_by_role("button",name="Review selected task blockers").click()
    idle()
    assert panel.get_by_role("button",name="Reopen reviewed incomplete task").is_enabled()
    panel.get_by_role("textbox",name="Reason for reopening task").fill("Replacement agent")
    panel.get_by_role("button",name="Reopen reviewed incomplete task").click()
    idle()
    after=page.evaluate("""async ({root,dependent})=>{
      const admin=window.VivaPhoneAgentAdmin,state=await admin.taskAccess.inspect(),e=await window.VivaPhoneEngine.snapshot();
      return {task:state.tasks.find(t=>t.id===root.taskId),attachments:state.attachments,
        dependent:(await window.VivaAgentTools.invokeFor(dependent,'task.progress')).mission.state,
        receipts:e.snapshot.localOperationResults.filter(r=>r.operationId.startsWith('recovery:')).map(r=>r.operationId)};
    }""",{"root":setup["root"],"dependent":setup["b"]})
    assert after["task"]["closed"] is False and after["task"]["epoch"]==first["progress"]["task"]["epoch"]+1,after
    assert after["task"]["steps"]==first["progress"]["task"]["steps"],after
    assert after["task"]["recoveries"][0]["reason"]=="Replacement agent",after
    assert not any(a["taskId"]==setup["root"]["taskId"] for a in after["attachments"]),after
    assert after["dependent"]=="blocked" and after["receipts"]==["recovery:before"],after
    plan=page.evaluate("taskId=>window.VivaPhoneAgentAdmin.taskAccess.recommend(taskId)",setup["root"]["taskId"])
    assert plan["recommended"]["sourceId"]=="recovery-c",plan
    page.evaluate("plan=>window.VivaPhoneAgentAdmin.taskAccess.approveRecommendation(plan)",plan)
    second=page.evaluate(edit,{"agent":setup["c"],"operationId":"recovery:after","amount":0.12})
    assert second["result"]["status"]=="accepted",second
    page.evaluate("""async ({agent,task})=>window.VivaPhoneAgentAdmin.taskAccess.complete(agent,{taskId:task.id,epoch:task.epoch})""",
                  {"agent":setup["c"],"task":second["progress"]["task"]})
    ready=page.evaluate("agent=>window.VivaAgentTools.invokeFor(agent,'task.progress')",setup["b"])
    assert ready["mission"]["state"]=="ready",ready
    assert [(r["operationId"],r["sourceId"]) for r in ready["mission"]["dependencies"][0]["receipts"]]==[("recovery:before","recovery-a"),("recovery:after","recovery-c")],ready
    completed=page.evaluate("()=>window.VivaPhoneAgentAdmin.taskAccess.inspect()")
    profiles={p["sourceId"]:p for p in completed["experience"]}
    assert set(profiles)=={"recovery-a","recovery-c"},profiles
    assert profiles["recovery-a"]["confirmedUnchanged"]==1 and profiles["recovery-a"]["completedContributions"]==1,profiles
    assert profiles["recovery-c"]["confirmedChanged"]==1 and profiles["recovery-c"]["completedContributions"]==1,profiles
    assert profiles["recovery-c"]["objects"][0]["completedChangedTasks"]==1,profiles
    assert ready["experience"]["authorizesAction"] is False and ready["experience"]["scope"]=="attached-task-and-completed-direct-prerequisites",ready
    assert ready["experience"]["profiles"]==completed["experience"],ready
    panel.get_by_role("button",name="Refresh saved tasks").click()
    idle()
    experience_text=panel.locator("#vivoMissionExperience").inner_text()
    assert "recovery-a" in experience_text and "recovery-c" in experience_text and "completed task contribution(s)" in experience_text,experience_text
    enter_local(page,route,world_id)
    open_agent_panel(page)
    restored=page.evaluate("""async()=>{
      const state=await window.VivaPhoneAgentAdmin.taskAccess.inspect(),e=await window.VivaPhoneEngine.snapshot();
      return {tasks:state.tasks,experience:state.experience,attachments:state.attachments,branchId:e.branchId,
        receipts:e.snapshot.localOperationResults.filter(r=>r.operationId.startsWith('recovery:')).map(r=>r.operationId)};
    }""")
    assert restored["tasks"]==completed["tasks"] and restored["attachments"]==[],restored
    assert restored["experience"]==completed["experience"],restored
    assert restored["branchId"]==second["branchId"] and sorted(restored["receipts"])==["recovery:after","recovery:before"],restored
    return {"rootDiagnosed":True,"reopened":True,"replacementRecommended":True,"originalReceiptPreserved":True,
            "dependentBlockedUntilCompletion":True,"reload":True,"autoGrant":False,"nativeOperations":2,
            "collectiveExperiencePreserved":True,"originalSourceCredited":True,"scopedAgentExperience":True}


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
