// Explicit browser acceptance runner; needs the desktop bundled Playwright.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire('C:/Users/carlg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});
const errors=[],evidence=[];
try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.__surfaceContextLosses=0;document.addEventListener('webglcontextlost',()=>window.__surfaceContextLosses++,true);});
  await page.goto('http://127.0.0.1:4184/?feature=contract-atelier',{waitUntil:'domcontentloaded',timeout:30000});
  await page.getByRole('button',{name:'Pause updates',exact:true}).click({timeout:10000});
  await page.waitForSelector('[data-lens-surface-attached=true]',{timeout:20000});
  const intro=page.locator('[data-lens-surface-attached=true] .assembly-surface-intro');
  assert.equal(await intro.evaluate(element=>element.open),false,'compact view initially folds only its static introduction');
  const introText=await intro.locator('p').textContent();
  await intro.locator('summary').click();
  await page.waitForTimeout(500);
  assert.equal(await intro.evaluate(element=>element.open),true,'frames do not undo the reader opening About');
  assert.equal(await intro.locator('p').textContent(),introText,'original introduction remains accessible');
  await intro.locator('summary').press('Enter');
  assert.equal(await intro.evaluate(element=>element.open),false,'Enter activates native summary, not world navigation');
  const boundary=page.locator('[data-lens-surface-attached=true] .cw-authority');
  await boundary.locator('summary').click();
  assert.equal(await boundary.evaluate(element=>element.open),true,'local simulation explanation remains readable by native tap');
  await boundary.locator('summary').press('Enter');
  assert.equal(await boundary.evaluate(element=>element.open),false);
  for(const [orientation,viewport] of [['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]]){
    await page.setViewportSize(viewport);
    for(const shape of ['phone','sphere','cube','wave','rectangle','cylinder']){
      await page.evaluate(shape=>{const select=document.querySelector('[data-tab-shape]');select.value=shape;select.dispatchEvent(new Event('change',{bubbles:true}));},shape);
      await page.waitForTimeout(750);
      const state=await page.evaluate(()=>{
        const panel=document.querySelector('[data-lens-surface-attached=true]'),rect=panel.getBoundingClientRect();
        const assembly=window.__TUMBO_REALITY_ASSEMBLY__,root=assembly.getFeatureObject('contract-atelier').root;
        return {shape:panel.dataset.objectShape,mode:document.querySelector('#reality-assembly').dataset.readingProjection,
          rect:rect.toJSON(),width:innerWidth,height:innerHeight,horizontalOverflow:panel.scrollWidth>panel.clientWidth+1,
          renderedFont:parseFloat(getComputedStyle(panel).fontSize)*rect.width/panel.offsetWidth,
          scale:root.scale.toArray(),objectCount:assembly.getSnapshot().objects.filter(object=>object.id==='contract-atelier').length,
          visible:!panel.hidden&&getComputedStyle(panel).display!=='none',contextLosses:window.__surfaceContextLosses};
      });
      evidence.push(state);console.log(JSON.stringify(state));
      assert.equal(state.shape,shape);assert.equal(state.mode,orientation);assert.equal(state.visible,true);
      assert.equal(state.objectCount,1,'reshaping keeps one canonical entity');assert.equal(state.contextLosses,0);
      assert.equal(state.horizontalOverflow,false,`${shape}/${orientation} must reflow`);
      assert.ok(state.renderedFont>=14.5,`${shape}/${orientation} native readable typography`);
      assert.ok(state.rect.x>=8&&state.rect.right<=viewport.width-8,`${shape}/${orientation} horizontal frame`);
      assert.ok(state.rect.y>=48&&state.rect.bottom<=viewport.height-60,`${shape}/${orientation} chrome clearance`);
      assert.ok(state.rect.height>=(orientation==='portrait'?340:190),`${shape}/${orientation} usable reading height`);
      if(['wave','sphere'].includes(shape))await page.screenshot({path:`surface-contract-${orientation}-${shape}.png`,timeout:20000});
    }
  }
  await page.setViewportSize({width:1440,height:900});
  await page.waitForTimeout(750);
  assert.equal(await intro.evaluate(element=>element.open),true,'desktop restores the unfolded static introduction');
  assert.equal(await intro.locator('summary').isVisible(),false,'desktop has no redundant disclosure control');
  assert.equal(await intro.locator('p').textContent(),introText);
  assert.deepEqual(errors,[]);console.log(`PASS ${evidence.length} shape/orientation projections; no page errors or context losses.`);
}finally{await browser.close();}
