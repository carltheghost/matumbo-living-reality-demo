import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const require=createRequire(process.env.MATUMBO_NODE_DEPENDENCIES??new URL('../package.json',import.meta.url).pathname);
const {chromium}=require('playwright');
const base=process.env.MATUMBO_PREVIEW_URL??'http://127.0.0.1:4184/';
const expectedBuild=process.env.MATUMBO_EXPECTED_BUILD??null;
const output=resolve('artifacts/universal-browser');
await mkdir(output,{recursive:true});

async function waitForExactBuild(){
  if(!expectedBuild||/^https?:\/\/127\.0\.0\.1|localhost/.test(base))return;
  const buildUrl=new URL('build.txt',base).href;
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){
    try{
      const response=await fetch(buildUrl,{cache:'no-store'});
      const text=(await response.text()).trim();
      if(response.ok&&text===expectedBuild)return;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,4000));
  }
  throw new Error(`Live Pages build did not reach expected commit ${expectedBuild}`);
}

await waitForExactBuild();

const browser=await chromium.launch({
  headless:true,
  args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist'],
});
const results=[];
try{
  for(const mode of ['desktop','phone']){
    const context=await browser.newContext({
      viewport:mode==='phone'?{width:390,height:844}:{width:1440,height:900},
      isMobile:mode==='phone',
      hasTouch:mode==='phone',
      deviceScaleFactor:1,
      reducedMotion:'reduce',
    });
    const page=await context.newPage();
    const pageErrors=[],consoleErrors=[],failedRequests=[];
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    page.on('requestfailed',request=>{
      const url=request.url();
      if(!/espn|wikimedia|youtube|google|provider|api\./i.test(url))failedRequests.push(`${request.failure()?.errorText??'failed'} ${url}`);
    });

    const url=new URL(base);
    url.searchParams.set('feature','reality-lens');
    url.searchParams.set('proof',expectedBuild??'local');
    await page.goto(url.href,{waitUntil:'commit',timeout:30000});
    const deadline=Date.now()+45000;
    let ready=false;
    let diagnostics=null;
    while(Date.now()<deadline){
      diagnostics=await page.evaluate(()=>({
        runtime:window.__MATUMBO_RUNTIME__?.getState?.()??null,
        hasAssembly:Boolean(window.__TUMBO_REALITY_ASSEMBLY__),
        assemblyActive:Boolean(window.__TUMBO_REALITY_ASSEMBLY__?.active),
        hasUniversal:Boolean(window.__TUMBO_UNIVERSAL_OBJECTS__),
        universal:window.__TUMBO_UNIVERSAL_OBJECTS__?.getSnapshot?.()??null,
        runtimeBanner:document.getElementById('runtime-status-message')?.textContent??null,
      }));
      if(diagnostics.hasAssembly&&diagnostics.assemblyActive&&diagnostics.universal?.featureCount>10){ready=true;break;}
      await page.waitForTimeout(500);
    }
    if(!ready){
      await page.screenshot({path:resolve(output,`${mode}-startup-failure.png`),fullPage:true});
      throw new Error(`Reality Lens universal startup timeout: ${JSON.stringify({diagnostics,pageErrors,consoleErrors,failedRequests})}`);
    }
    await page.waitForTimeout(1200);

    const proof=await page.evaluate(()=>{
      const universal=window.__TUMBO_UNIVERSAL_OBJECTS__.getSnapshot();
      const assembly=window.__TUMBO_REALITY_ASSEMBLY__.getSnapshot();
      const featureEntries=Object.entries(universal.features);
      const missingUniversal=featureEntries
        .filter(([id,value])=>id!=='block-world'&&(!value.entityIds.length||!value.kinds.length||!value.geometryFamilies.length))
        .map(([id])=>id);
      const unregistered=Object.entries(universal.dataFeeds)
        .filter(([,feed])=>!feed.registered)
        .map(([id])=>id);
      const availableSources=Object.entries(universal.dataFeeds)
        .filter(([,feed])=>feed.available)
        .map(([id,feed])=>({id,sourceName:feed.sourceName}));
      const canvas=[...document.querySelectorAll('canvas')].map(canvas=>({
        width:canvas.width,height:canvas.height,
        clientWidth:canvas.clientWidth,clientHeight:canvas.clientHeight,
      }));
      return {
        route:new URLSearchParams(location.search).get('feature'),
        runtime:window.__MATUMBO_RUNTIME__.getState(),
        active:window.__TUMBO_REALITY_ASSEMBLY__.active,
        selectedId:universal.selectedId,
        featureCount:universal.featureCount,
        universalObjectCount:universal.universalObjectCount,
        realFeedRegisteredCount:universal.realFeedRegisteredCount,
        realFeedAvailableCount:universal.realFeedAvailableCount,
        unregistered,
        missingUniversal,
        availableSources,
        preserved:universal.preserved,
        assemblyObjectCount:assembly.objects?.length??0,
        canvas,
        webgl:canvas.length>0,
      };
    });

    assert.equal(proof.route,'reality-lens');
    assert.equal(proof.runtime,'ready');
    assert.equal(proof.active,true);
    assert.ok(proof.featureCount>=30,`expected broad Reality Lens feature coverage, got ${proof.featureCount}`);
    assert.equal(proof.realFeedRegisteredCount,proof.featureCount,'every rendered feature must declare a real-data feed');
    assert.deepEqual(proof.unregistered,[]);
    assert.deepEqual(proof.missingUniversal,[]);
    assert.ok(proof.universalObjectCount>=proof.featureCount-1,'all non-preserved features must have universal objects');
    assert.ok(proof.realFeedAvailableCount>=12,`expected many live feature feeds, got ${proof.realFeedAvailableCount}`);
    assert.ok(proof.preserved.includes('block-world'));
    assert.ok(proof.canvas.length>=1);
    assert.ok(proof.canvas.some(item=>item.clientWidth>0&&item.clientHeight>0));
    assert.deepEqual(pageErrors,[]);
    assert.deepEqual(failedRequests,[]);

    const screenshot=resolve(output,`${mode}-reality-lens-universal.png`);
    await page.screenshot({path:screenshot,fullPage:true});
    results.push({mode,proof,pageErrors,consoleErrors,failedRequests,screenshot});
    await context.close();
  }
  const payload={passed:true,base,expectedBuild,createdAt:new Date().toISOString(),results};
  await writeFile(resolve(output,'proof.json'),JSON.stringify(payload,null,2));
  console.log(JSON.stringify(payload,null,2));
}finally{
  await browser.close();
}
