/* Mounted route inventory. Workflow tests are recorded separately: a mounted
 * route is evidence of ownership/layout, not proof that its engine is complete. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const repo=path.join(__dirname,'..'),stage=process.env.STAGE||'final';
const out=path.resolve(process.env.FEATURE_COMPLETION_OUTPUT || path.join(__dirname,'../work/feature-completion/routes'),stage);
fs.mkdirSync(out,{recursive:true});
function hashes(){const result={};function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else result[path.relative(repo,f).replaceAll('\\','/')]=crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');}}walk(path.join(repo,'src'));return result;}
const report={started:new Date().toISOString(),base:process.env.FEATURE_COMPLETION_BASE_URL || 'http://127.0.0.1:8082/',stage,sourceBefore:hashes(),runs:[]};
const save=()=>fs.writeFileSync(path.join(out,'route-inventory.json'),JSON.stringify(report,null,2));
async function inventory(browser,name,viewport){
  const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage();
  const run={name,viewport,routes:[],errors:[],failedRequests:[]};report.runs.push(run);save();
  let active='bootstrap';page.on('pageerror',e=>run.errors.push({route:active,error:e.stack}));
  page.on('requestfailed',r=>run.failedRequests.push({route:active,url:r.url().split('?')[0],reason:r.failure()?.errorText}));
  try{
    await page.goto(report.base,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForFunction(()=>window.__TUMBO_REALITY_ASSEMBLY__?.active&&window.__TUMBO_FEATURE_NAVIGATOR__,null,{timeout:45000});
    const definitions=await page.evaluate(async()=>{const m=await import('/src/render/feature-navigator.js');return m.FEATURE_DEFINITIONS;});
    assert.equal(definitions.length,36);
    for(const definition of definitions){
      active=definition.id;const before=run.errors.length;
      const route={...definition};run.routes.push(route);
      try{
        await page.evaluate(id=>{window.__TUMBO_FEATURE_NAVIGATOR__.select(id,'popstate',{updateLocation:false});window.__TUMBO_FEATURE_NAVIGATOR__.close();},active);
        await page.waitForFunction(id=>{const s=window.__TUMBO_REALITY_ASSEMBLY__.getSnapshot();if(window.__TUMBO_FEATURE_NAVIGATOR__.getSnapshot().activeId!==id)return false;if(id==='person')return !s.active&&window.__TUMBO_PERSON_STUDIO__?.active;if(id==='reality-lens')return s.active&&s.spaceView==='gateway'&&!s.liveObject;return s.active&&s.liveObject?.entityId===id;},active,{timeout:15000});
        await page.waitForTimeout(200);
        Object.assign(route,await page.evaluate(id=>{
          const a=window.__TUMBO_REALITY_ASSEMBLY__,c=a.getSurfaceController();c?.refresh();const s=a.getSnapshot(),doc=c?.document.snapshot(),panel=document.getElementById(s.liveObject?.panelId);
          const exposed=e=>!e.hidden&&getComputedStyle(e).display!=='none'&&!e.closest('[hidden]');
          return {activeId:window.__TUMBO_FEATURE_NAVIGATOR__.getSnapshot().activeId,view:s.spaceView,active:s.active,person:window.__TUMBO_PERSON_STUDIO__?.active??false,mountedOwner:s.liveObject?.entityId??null,panelId:s.liveObject?.panelId??null,engine:s.liveObject?.engine??null,canonicalOwners:s.liveObject?.canonicalOwners??null,actionCount:doc?.actionCount??0,blockCount:doc?.blockCount??0,chartCount:s.liveObject?.interactiveSurfaceCount??0,kinds:doc?.kinds??[],actions:panel?[...panel.querySelectorAll('button')].filter(exposed).map(e=>({text:e.textContent.trim(),disabled:e.disabled,action:e.dataset.action??null})):[],inputs:panel?[...panel.querySelectorAll('input,textarea,select')].filter(exposed).map(e=>({tag:e.tagName,type:e.type,name:e.name,placeholder:e.placeholder,label:e.getAttribute('aria-label')})):[],textExcerpt:panel?.textContent.replace(/\s+/g,' ').slice(0,1800)??null,iframeCount:document.querySelectorAll('iframe[src*="youtube.com/embed/"]').length,overflow:document.documentElement.scrollWidth>innerWidth};
        },active));
        route.pageErrors=run.errors.slice(before);
        Object.assign(route,await page.evaluate(id=>{const s=window.__TUMBO_PROJECTION_SESSION__.getSnapshot(),owner=s.surfaces[id];return {observationOwner:owner?.source,observedMounted:owner?.mounted,observedOpened:owner?.opened,activeSurfaceOpen:s.activeFeature.surfaceOpen};},active));
        assert.equal(route.observedMounted,true);assert.equal(route.observedOpened,true);assert.equal(route.activeSurfaceOpen,true);
        assert.equal(route.activeId,active);assert.equal(route.overflow,false);assert.deepEqual(route.pageErrors,[]);assert(route.iframeCount<=1);
        if(active==='person'){assert(route.person);assert.equal(route.active,false);assert.equal(route.mountedOwner,null);}
        else if(active==='reality-lens'){assert.equal(route.view,'gateway');assert.equal(route.mountedOwner,null);}
        else{assert.equal(route.mountedOwner,active);assert.equal(route.engine,'mesh-uv-360');assert.equal(route.canonicalOwners,1);assert(route.chartCount>=3);assert(route.blockCount>0);}
        if(['arena','rooms','nft-atelier','academy','chess'].includes(active))await page.screenshot({path:path.join(out,`${name}-${active}-object.png`)});
        route.pass=true;
      }catch(e){route.pass=false;route.error=e.stack;}
      save();console.log(JSON.stringify({view:name,route:active,pass:route.pass,actions:route.actions?.length,error:route.error??null}));
    }
  }finally{await context.close();save();}
}
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
  try{for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}]])await inventory(browser,name,viewport);}
  catch(e){report.fatal=e.stack;console.error(e.stack);}
  finally{await browser.close();report.finished=new Date().toISOString();report.sourceAfter=hashes();report.sourceUnchanged=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);save();}
  const summary=report.runs.map(r=>({view:r.name,passed:r.routes.filter(x=>x.pass).length,failed:r.routes.filter(x=>!x.pass).length,pageErrors:r.errors.length}));
  console.log(JSON.stringify({summary,sourceUnchanged:report.sourceUnchanged,fatal:report.fatal??null}));
  if(report.fatal||report.runs.some(r=>r.errors.length||r.routes.some(x=>!x.pass))||(stage==='final'&&!report.sourceUnchanged))process.exitCode=1;
})();
