"""Real mounted worker and IndexedDB: reviewed multi-step mission plan."""
from __future__ import annotations
import json
import shutil
import sys
from playwright.sync_api import sync_playwright
from browser_agent_stop import enter_local, open_agent_panel


def exercise(page, route, label):
    world_id = "vivo.phone.mission-planner-" + label
    enter_local(page, route, world_id)
    open_agent_panel(page)
    page.wait_for_function("Boolean(window.VivaPhoneAgentAdmin?.taskAccess?.previewPlan)")
    page.evaluate("""() => {
      const admin=window.VivaPhoneAgentAdmin;
      for(const sourceId of ['planner-a','planner-b','planner-c'])admin.register({sourceId,capabilities:['world.read','world.edit']});
    }""")
    panel=page.locator("#vivo-ai-accounts")
    def idle():
        page.wait_for_function("document.querySelector('#vivo-ai-accounts')?.dataset.taskBusy==='false'")
    panel.get_by_role("textbox",name="Mission objective").fill("Prepare and assemble")
    panel.get_by_role("textbox",name="Mission plan steps").fill(
        "finish | Assemble | planner-c | left,right\nleft | First preparation | planner-a |\nright | Second preparation | planner-b |")
    panel.get_by_role("button",name="Review mission plan").click()
    idle()
    assert panel.get_by_role("button",name="Save reviewed mission plan").is_enabled()
    assert page.evaluate("async()=> (await window.VivaPhoneAgentAdmin.taskAccess.inspect()).tasks.length")==0
    panel.get_by_role("button",name="Save reviewed mission plan").click()
    idle()
    initial=page.evaluate("()=>window.VivaPhoneAgentAdmin.taskAccess.inspect()")
    assert len(initial["tasks"])==3 and initial["attachments"]==[],initial
    assert initial["plans"][0]["ready"]==2 and initial["plans"][0]["blocked"]==1,initial
    ids={t["plan"]["stepKey"]:t["id"] for t in initial["tasks"]}
    assert initial["tasks"][2]["dependsOn"]==[ids["left"],ids["right"]],initial
    panel.get_by_role("listbox",name="Hypothetically unavailable agent sources").select_option(["planner-a","planner-b"])
    panel.get_by_role("button",name="Compare mission assignment scenarios").click()
    idle()
    scenario_text=panel.locator("#vivoMissionScenario").inner_text()
    assert "Current availability · 2/3 assignable now" in scenario_text and "Hypothetical availability · 1/3 assignable now" in scenario_text,scenario_text
    result=page.evaluate("taskIds=>window.VivaPhoneAgentAdmin.taskAccess.compareScenario({taskIds,unavailableSourceIds:['planner-a','planner-b']})",list(ids.values()))
    assert result["baseline"]["assignable"]==2 and result["alternative"]["assignable"]==1 and result["lostCapacity"]==1,result
    assert result["authorizesAction"] is False and result["predictsCompletion"] is False,result
    assert next(r for r in result["alternative"]["rows"] if r["taskId"]==ids["finish"])["status"]=="TASK_PREREQUISITES_INCOMPLETE",result
    panel.get_by_role("button",name="Compare multi-stage mission strategies").click()
    idle()
    strategy_text=panel.locator("#vivoMissionScenario").inner_text()
    assert "Dependency depth: 2" in strategy_text and "Current availability · 3/3 hypothetically scheduled · 2 rounds" in strategy_text,strategy_text
    assert "Hypothetical availability · 3/3 hypothetically scheduled · 3 rounds" in strategy_text,strategy_text
    strategy=page.evaluate("taskIds=>window.VivaPhoneAgentAdmin.taskAccess.compareStrategy({taskIds,unavailableSourceIds:['planner-a','planner-b']})",list(ids.values()))
    assert strategy["baseline"]["roundCount"]==2 and strategy["alternative"]["roundCount"]==3 and strategy["roundDifference"]==1,strategy
    assert strategy["authorizesAction"] is False and strategy["predictsCompletion"] is False,strategy
    assert strategy["baseline"]["waves"][-1]["assignments"][0]["taskId"]==ids["finish"],strategy
    panel.get_by_role("button",name="Challenge and review mission strategy").click()
    idle()
    critic_text=panel.locator("#vivoMissionScenario").inner_text()
    assert "Current availability · 2 → 2 hypothetical rounds" in critic_text,critic_text
    assert "Hypothetical availability · 3 → 3 hypothetical rounds" in critic_text,critic_text
    assert "Conditional minimum proved by lower bound" in critic_text and "Single-source stress tests: 3/3 sources" in critic_text,critic_text
    critic=page.evaluate("taskIds=>window.VivaPhoneAgentAdmin.taskAccess.reviewStrategy({taskIds,unavailableSourceIds:['planner-a','planner-b']})",list(ids.values()))
    assert critic["baseline"]["audit"]["valid"] and critic["alternative"]["audit"]["valid"],critic
    assert critic["baseline"]["preferredRounds"]==2 and critic["alternative"]["preferredRounds"]==3,critic
    assert critic["authorizesAction"] is False and critic["predictsCompletion"] is False,critic
    unchanged=page.evaluate("()=>window.VivaPhoneAgentAdmin.taskAccess.inspect()")
    assert unchanged["tasks"]==initial["tasks"] and unchanged["attachments"]==[],unchanged
    stale=page.evaluate("""async()=>{
      const admin=window.VivaPhoneAgentAdmin,agent=admin.agents().find(a=>a.sourceId==='planner-c');
      const preview=await admin.taskAccess.previewPlan({objective:'Stale plan',steps:[{key:'one',title:'Test',sourceId:'planner-c'}]});
      await admin.stop(agent.sessionId,'fixture-stale-plan');
      let error=null;try{await admin.taskAccess.commitPlan(preview.token);}catch(e){error=e.code;}
      await admin.reenable('planner-c');return {error,count:(await admin.taskAccess.inspect()).tasks.length};
    }""")
    assert stale=={"error":"PLAN_AGENT_STALE","count":3},stale
    assert page.evaluate("async taskId=>(await window.VivaPhoneAgentAdmin.taskAccess.recommend(taskId)).reason",ids["finish"])=="TASK_PREREQUISITES_INCOMPLETE"

    execute="""async ({taskId,operationId,amount})=>{
      const admin=window.VivaPhoneAgentAdmin,tools=window.VivaAgentTools;
      const plan=await admin.taskAccess.recommend(taskId);
      if(plan.state!=='recommended')return {error:plan.reason};
      await admin.taskAccess.approveRecommendation(plan);
      const agent=admin.agents().find(a=>a.sessionId===plan.recommended.sessionId);
      const e=await window.VivaPhoneEngine.snapshot(),spaceId=e.eyes[e.currentEyeId].spaceId;
      const entity=e.snapshot.spaces[spaceId].entities.relic,delta=Array(entity.dimension).fill(0);delta[3]=amount;
      const result=await tools.invokeFor(agent,'vivo.world.edit',{worldId:e.snapshot.worldId,branchId:e.branchId,eyeId:e.currentEyeId,
        spaceId,entityId:entity.id||'relic',baseRevision:entity.revision,operationId,delta,geometry:null});
      await window.VivaPhoneEngine.snapshot();await admin.taskAccess.reconcile();
      const progress=await tools.invokeFor(agent,'task.progress');
      await admin.taskAccess.complete(agent,{taskId,epoch:progress.task.epoch});
      return {result,source:agent.sourceId,progress,branchId:e.branchId};
    }"""
    first=page.evaluate(execute,{"taskId":ids["left"],"operationId":"plan:left","amount":0})
    assert first["source"]=="planner-a" and first["result"]["status"]=="accepted",first
    assert page.evaluate("async taskId=>(await window.VivaPhoneAgentAdmin.taskAccess.recommend(taskId)).reason",ids["finish"])=="TASK_PREREQUISITES_INCOMPLETE"
    second=page.evaluate(execute,{"taskId":ids["right"],"operationId":"plan:right","amount":0})
    assert second["source"]=="planner-b" and second["result"]["status"]=="accepted",second
    third=page.evaluate(execute,{"taskId":ids["finish"],"operationId":"plan:finish","amount":0.12})
    assert third["source"]=="planner-c" and third["result"]["status"]=="accepted",third
    evidence=third["progress"]["mission"]["dependencies"]
    assert [r["operationId"] for d in evidence for r in d["receipts"]]==["plan:left","plan:right"],evidence
    # A second, independent synthetic mission exposes a greedy scheduling loss.
    # The original real mission is completed; the second mission stays detached.
    chain=page.evaluate("""async()=>{
      const access=window.VivaPhoneAgentAdmin.taskAccess;
      const steps=[['a','Independent A',[]],['b','Independent B',[]],['c','Critical start',[]],['d','Critical middle',['c']],['e','Critical finish',['d']]]
        .map(([key,title,dependsOn])=>({key,title,sourceId:'planner-a',dependsOn}));
      const p=await access.previewPlan({objective:'Challenge critical chain',steps});
      return access.commitPlan(p.token);
    }""")
    before_review=page.evaluate("()=>window.VivaPhoneAgentAdmin.taskAccess.inspect()")
    panel.get_by_role("button",name="Refresh saved tasks").click()
    idle()
    panel.get_by_role("combobox",name="Saved task in this world and branch").select_option(chain["created"][0]["taskId"])
    panel.get_by_role("listbox",name="Hypothetically unavailable agent sources").select_option(["planner-c"])
    panel.get_by_role("button",name="Challenge and review mission strategy").click()
    idle()
    critic_text=panel.locator("#vivoMissionScenario").inner_text()
    assert "Hypothetical availability · 4 → 3 hypothetical rounds" in critic_text,critic_text
    assert "Conditional minimum proved by exact search" in critic_text,critic_text
    improved=page.evaluate("taskIds=>window.VivaPhoneAgentAdmin.taskAccess.reviewStrategy({taskIds,unavailableSourceIds:['planner-c']})",[t["taskId"] for t in chain["created"]])
    assert improved["alternative"]["originalRounds"]==4 and improved["alternative"]["preferredRounds"]==3,improved
    assert improved["alternative"]["proofStatus"]=="exact-search-proven" and improved["alternative"]["audit"]["valid"],improved
    completed=page.evaluate("()=>window.VivaPhoneAgentAdmin.taskAccess.inspect()")
    assert completed==before_review,completed
    assert completed["plans"][0]["completed"]==3 and completed["attachments"]==[],completed
    enter_local(page,route,world_id)
    open_agent_panel(page)
    restored=page.evaluate("""async()=>{
      const admin=window.VivaPhoneAgentAdmin,e=await window.VivaPhoneEngine.snapshot(),state=await admin.taskAccess.inspect();
      return {branchId:e.branchId,plans:state.plans,tasks:state.tasks,attachments:state.attachments,
        receipts:e.snapshot.localOperationResults.filter(r=>r.operationId.startsWith('plan:')).map(r=>r.operationId)};
    }""")
    assert restored["branchId"]==third["branchId"] and restored["plans"]==completed["plans"],restored
    assert restored["tasks"]==completed["tasks"] and restored["attachments"]==[],restored
    assert sorted(restored["receipts"])==["plan:finish","plan:left","plan:right"],restored
    return {"created":3,"completed":3,"parallelPrerequisites":2,"staleReviewRejected":True,"reload":True,"autoGrant":False,"scenarioComparison":True,"hypotheticalOutageCapacity":1,"scenarioReadOnly":True,"multiStageStrategy":True,"outageExtraRounds":1,"strategyReadOnly":True,"strategyCritic":True,"greedyRounds":4,"exactRounds":3,"criticReadOnly":True}


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
