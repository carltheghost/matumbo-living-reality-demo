// Explicit browser evidence runner; not part of the dependency-free unit suite.
import {createRequire} from 'node:module';
const require=createRequire('C:/Users/carlg/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,timeout:60000});
const mobile=process.argv.includes('--mobile');
const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,reducedMotion:'reduce'});
page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.log('PAGEERROR',error.message);});
try{
  await page.goto('http://127.0.0.1:4184/?feature=bot-plaza',{waitUntil:'domcontentloaded',timeout:60000});
  console.log('navigated');
  await page.getByRole('button',{name:'Pause updates',exact:true}).click({timeout:10000});
  console.log('paused reload');
  await page.waitForSelector('[data-lens-surface-attached=true]',{timeout:30000});
  await page.waitForTimeout(1600);
  console.log(JSON.stringify(await page.evaluate(()=>({errors:[],panels:[...document.querySelectorAll('[data-lens-surface-attached=true]')].map(e=>({id:e.id,shape:e.dataset.objectShape,rect:e.getBoundingClientRect().toJSON(),width:e.clientWidth,scrollWidth:e.scrollWidth,font:getComputedStyle(e).fontSize,display:getComputedStyle(e).display})),globalKeys:Object.keys(window).filter(key=>/matumbo|assembly/i.test(key))})),null,2));
  console.log('saving screenshot');
  await page.screenshot({path:`C:/Users/carlg/Documents/Codex/2026-08-24/referenced-chatgpt-conversation-this-is-an/work/contract-organism/surface-${mobile?'mobile':'desktop'}.png`,timeout:20000});
  console.log('screenshot saved');
  console.log(JSON.stringify(await page.evaluate(()=>({mobile:[...document.querySelectorAll('[data-lens-surface-attached=true]')].map(e=>({id:e.id,rect:e.getBoundingClientRect().toJSON(),width:e.clientWidth,scrollWidth:e.scrollWidth,buttons:[...e.querySelectorAll('button')].slice(0,6).map(b=>({text:b.textContent,height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width}))}))})),null,2));
  console.log(JSON.stringify({errors}));
  if(process.argv.includes('--shapes')){
    for(const shape of ['phone','sphere','cube','wave','rectangle','cylinder']){
      await page.evaluate(shape=>{const select=document.querySelector('[data-tab-shape]');select.value=shape;select.dispatchEvent(new Event('change',{bubbles:true}));},shape);
      await page.waitForTimeout(700);
      console.log('shape',shape,await page.evaluate(()=>{const panel=document.querySelector('[data-lens-surface-attached=true]');return {shape:panel.dataset.objectShape,rect:panel.getBoundingClientRect().toJSON(),horizontalOverflow:panel.scrollWidth>panel.clientWidth+1};}));
    }
    await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(700);
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(700);
    console.log('resize responsive',await page.evaluate(()=>document.querySelector('[data-lens-surface-attached=true]').getBoundingClientRect().toJSON()));
  }
}finally{await browser.close();}
