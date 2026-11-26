"""Actual mounted Vivo worker and IndexedDB: owner-controlled mission handoff.
Synthetic native agents only; no real provider or external account.
"""
from __future__ import annotations

import json
import shutil
import sys
from playwright.sync_api import sync_playwright
from browser_agent_stop import enter_local, open_agent_panel


def exercise(page, route, label):
    world_id = "vivo.phone.task-handoff-" + label
    enter_local(page, route, world_id)
    open_agent_panel(page)
    page.wait_for_function("Boolean(window.VivaPhoneAgentAdmin?.taskAccess)")
    registered = page.evaluate("""async () => {
      const admin=window.VivaPhoneAgentAdmin;
      const a=admin.register({sourceId:'mission-a',capabilities:['world.read','world.edit']});
      const b=admin.register({sourceId:'mission-b',capabilities:['world.read','world.edit']});
      const task=await admin.taskAccess.create(a,'Shared mission');
      return {a,b,task};
    }""")
    edit = """async ({agent,operationId,amount}) => {
      const e=await window.VivaPhoneEngine.snapshot();
      const spaceId=e.eyes[e.currentEyeId].spaceId,entity=e.snapshot.spaces[spaceId].entities.relic;
      const delta=Array(entity.dimension).fill(0);delta[3]=amount;
      const args={worldId:e.snapshot.worldId,branchId:e.branchId,eyeId:e.currentEyeId,spaceId,
        entityId:entity.id||'relic',baseRevision:entity.revision,operationId,delta,geometry:null};
      const result=await window.VivaAgentTools.invokeFor(agent,'vivo.world.edit',args);
      await window.VivaPhoneEngine.snapshot();await window.VivaPhoneAgentAdmin.taskAccess.reconcile();
      return {result,args,task:(await window.VivaAgentTools.invokeFor(agent,'task.progress')).task};
    }"""
    first=page.evaluate(edit, {"agent":registered["a"],"operationId":"handoff:first","amount":0})
    assert first["result"]["status"]=="accepted",first
    assert first["task"]["steps"][0]["state"]=="confirmed",first
    panel=page.locator("#vivo-ai-accounts")
    panel.get_by_role("button",name="Refresh saved tasks").click()
    task_picker=panel.get_by_role("combobox",name="Saved task in this world and branch")
    task_picker.select_option(registered["task"]["taskId"])
    panel.locator("#vivoMemoryAgent").select_option(registered["b"]["sessionId"])
    panel.get_by_role("button",name="Handoff selected task to chosen agent").click()
    page.wait_for_function("""async ({agent,taskId}) => {
      try {const r=await window.VivaAgentTools.invokeFor(agent,'task.progress');return r.task.id===taskId;}
      catch{return false;}
    }""",arg={"agent":registered["b"],"taskId":registered["task"]["taskId"]})
    previous=page.evaluate("""async agent=>{try{await window.VivaAgentTools.invokeFor(agent,'task.progress');return false;}catch{return true;}}""",registered["a"])
    assert previous,"Previous source retained access"
    duplicate=page.evaluate("""async ({agent,args})=>{try{await window.VivaAgentTools.invokeFor(agent,'vivo.world.edit',args);return '';}catch(e){return e.code||e.message;}}""",{"agent":registered["b"],"args":first["args"]})
    assert duplicate=="TASK_OPERATION_ALREADY_RECORDED",duplicate
    second=page.evaluate(edit,{"agent":registered["b"],"operationId":"handoff:second","amount":0.12})
    assert second["result"]["status"]=="accepted",second
    task=second["task"]
    assert [s["sourceId"] for s in task["steps"]]==["mission-a","mission-b"],task
    assert all(s["state"]=="confirmed" for s in task["steps"]),task
    assert task["steps"][1]["changed"] is True,task
    assert task["handoffs"]==[{"from":"mission-a","to":"mission-b","epoch":task["epoch"]}],task
    enter_local(page,route,world_id)
    open_agent_panel(page)
    restored=page.evaluate("""async ({taskId,branchId})=>{
      const admin=window.VivaPhoneAgentAdmin,e=await window.VivaPhoneEngine.snapshot();
      const agent=admin.register({sourceId:'mission-b',capabilities:['world.read','world.edit']});
      const before=window.VivaAgentTools.listFor(agent).some(t=>t.name==='task.progress');
      await admin.taskAccess.resume(agent,taskId);
      const task=(await window.VivaAgentTools.invokeFor(agent,'task.progress')).task;
      return {sameBranch:e.branchId===branchId,before,task,receipts:e.snapshot.localOperationResults.filter(r=>r.operationId.startsWith('handoff:')).map(r=>r.operationId)};
    }""",{"taskId":task["id"],"branchId":second["args"]["branchId"]})
    assert restored["sameBranch"] and not restored["before"],restored
    assert restored["task"]["steps"]==task["steps"] and restored["task"]["handoffs"]==task["handoffs"],restored
    assert sorted(restored["receipts"])==["handoff:first","handoff:second"],restored
    return {"handoffs":1,"confirmedSteps":2,"reloaded":True,"autoGrant":False,"duplicateRejected":True}


def main(base):
    route=base.rstrip("/")+"/services/vivo/web/phone/"
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=shutil.which("chromium") or shutil.which("chromium-browser"),args=["--no-sandbox","--disable-gpu"])
        result={}
        for label, viewport in [("desktop",{"width":1000,"height":900}),("mobile",{"width":390,"height":844})]:
            context=browser.new_context(viewport=viewport)
            page=context.new_page()
            page.set_default_timeout(15000)
            errors=[]
            page.on("pageerror",lambda error:errors.append(str(error)))
            result[label]=exercise(page,route,label)
            assert not errors,errors
            context.close()
        browser.close()
    print(json.dumps(result))


if __name__=="__main__":
    main(sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:9897/")
