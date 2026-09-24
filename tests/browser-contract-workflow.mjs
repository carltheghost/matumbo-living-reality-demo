// Explicit native-control evidence. Run against the existing preview; this is
// not an offline unit test and requires a local Playwright installation.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const require=createRequire(process.env.MATUMBO_NODE_DEPENDENCIES??'C:/Users/carlg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const base=process.env.MATUMBO_PREVIEW_URL??'http://127.0.0.1:4184/';
const output=resolve('artifacts/contract-browser');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];
try{
  for(const mode of ['desktop','phone']){
    const context=await browser.newContext({viewport:mode==='phone'?{width:390,height:844}:{width:1280,height:900},isMobile:mode==='phone',hasTouch:mode==='phone',deviceScaleFactor:1,reducedMotion:'reduce'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/__preview/revision',route=>route.fulfill({json:{revision:'contract-verification-freeze'}}));
    await page.goto(`${base}?feature=contract-atelier`,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForSelector('#contract-atelier-console[data-lens-surface-attached=true]');
    await page.getByRole('button',{name:'Create contract',exact:true}).click();
    await page.locator('#contract-workbench input[name=title]').fill(`${mode} delivery acceptance`);
    await page.getByRole('button',{name:'Create & request approvals',exact:true}).click();
    const state=()=>page.evaluate(()=>{
      const c=window.__TUMBO_CONTRACT_AUTOMATION__.list().at(-1);
      return {id:c.id,status:c.status,approvals:c.approvals.length,receipts:c.receipts.length,effects:c.projection,eventCount:c.history.length};
    });
    assert.equal((await state()).status,'pending_approval');
    await page.getByRole('button',{name:'Approve as selected role',exact:true}).click();
    assert.equal((await state()).receipts,0,'one of two approvals must never execute');
    await page.locator('#contract-workbench select[name=actor]').selectOption('reviewer');
    await page.getByRole('button',{name:'Approve as selected role',exact:true}).click();
    assert.equal((await state()).status,'active');
    assert.equal((await state()).receipts,0,'approval is not proof of the condition');
    await page.locator('#contract-workbench select[name=evidence-value]').selectOption('true');
    await page.getByRole('button',{name:'Record evidence & evaluate',exact:true}).click();
    const completed=await state();
    assert.equal(completed.status,'completed');assert.equal(completed.receipts,1);
    assert.deepEqual(completed.effects.balanceDeltasCents,{owner:-10000,reviewer:10000});
    for(let reload=0;reload<2;reload++){
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForSelector('#contract-atelier-console[data-lens-surface-attached=true]');
      assert.deepEqual(await state(),completed,'reload must retain approved terms/history and never duplicate effects');
    }
    await page.waitForFunction(()=>window.__TUMBO_CONTRACT_ORGANISM__.getSnapshot().status==='completed');
    const projection=await page.evaluate(()=>{
      const panel=document.getElementById('contract-atelier-console');
      const graph=window.__SIMFABRIC_PROJECTION__.contributions.find(c=>c.source==='contract-organism');
      const r=panel.getBoundingClientRect();
      return {geometry:window.__TUMBO_CONTRACT_ORGANISM__.getSnapshot(),worldRelationships:graph.relationships.length,
        panel:{width:r.width,height:r.height,onscreen:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,horizontalOverflow:panel.scrollWidth>panel.clientWidth+1,font:getComputedStyle(panel).fontSize}};
    });
    assert.equal(projection.geometry.attached,true);assert.equal(projection.geometry.idleAnimation,false);
    assert.ok(projection.geometry.relationshipCount>0);assert.ok(projection.worldRelationships>projection.geometry.relationshipCount);
    assert.equal(projection.panel.horizontalOverflow,false);assert.equal(projection.panel.onscreen,true);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:resolve(output,`${mode}-contract-completed.png`)});
    results.push({mode,completed,projection,errors});
    await context.close();
  }
  console.log(JSON.stringify({passed:true,results},null,2));
}finally{await browser.close();}
