import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname, resolve, sep, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../../../../..');
const phone=resolve(here,'..');
const original=await readFile(resolve(phone,'index.html'),'utf8');
const entry=await readFile(resolve(phone,'field-lab.html'),'utf8');
const assemblySource=entry.match(/<script type="module" id="fieldLabAssembler">([\s\S]*?)<\/script>/)[1];
const {assembleFieldLab}=await import('data:text/javascript;base64,'+Buffer.from(assemblySource).toString('base64'));
const combined=assembleFieldLab(original);
const ids=text=>[...text.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const externalModules=text=>[...text.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)].map(m=>m[1]);
const nav=combined.match(/<script type="module" id="fieldLabNavigation">([\s\S]*?)<\/script>/)?.[1];
const config=JSON.parse(nav.match(/const labConfig = (\[[^\n]+\]);/)[1]);

test('integrated entry preserves every canonical phone DOM hook',()=>{
  const actual=new Set(ids(combined));
  for(const id of ids(original))assert.ok(actual.has(id),`missing native hook ${id}`);
  assert.equal(actual.size,ids(combined).length,'duplicate IDs');
});
test('entry reuses the exact native runtime script order without a second engine',()=>{
  assert.deepEqual(externalModules(combined),externalModules(original));
  assert.deepEqual(externalModules(combined),['./static-shared.js','./bootstrap.mjs','./companion.mjs']);
  assert.equal((combined.match(/id="world"/g)||[]).length,1);
  assert.equal((combined.match(/id="cameraVideo"/g)||[]).length,1);
});
test('new entry is not a legacy HTML file picker or iframe wrapper',()=>{
  assert.ok(!/<iframe\b/i.test(combined));
  assert.ok(!/type="file"|matumbo-field-lab-v04|Choose original Field Lab/.test(combined));
  assert.ok(combined.includes('No original HTML download is required'));
  assert.ok(combined.includes('maTumbo Field Lab · Integrated Vivo'));
});
test('every installed-tool action has an existing native target',()=>{
  const actual=new Set(ids(combined));
  assert.equal(config.length,12);assert.equal(new Set(config.map(x=>x.key)).size,12);
  for(const entry of config){
    assert.ok(combined.includes(`data-lab-action="${entry.key}"`));
    if(entry.target)assert.ok(actual.has(entry.target),`missing target ${entry.target}`);
    if(entry.panel)assert.ok(combined.includes(`data-sheet="${entry.panel}"`));
  }
});
test('navigation adds no authority, camera, agent grant, or financial action',()=>{
  assert.ok(nav);
  for(const forbidden of ['getUserMedia(','.submit(','.translate(','.setEye(','.checked = true',
    '.checked=true','localStorage.clear','deleteDatabase','caches.delete','innerHTML','fetch('])
    assert.ok(!nav.includes(forbidden),`unexpected operation ${forbidden}`);
  assert.deepEqual(config.filter(x=>!x.panel&&x.key!=='atlas').map(x=>x.key),['exchange','contracts']);
});
test('camera inclusion and agent permissions remain unchecked',()=>{
  const tags=[...combined.matchAll(/<input\b[^>]*(?:id="recordCamera"|data-local-cap=)[^>]*>/g)].map(m=>m[0]);
  assert.equal(tags.length,4);for(const tag of tags)assert.ok(!/\bchecked\b/.test(tag));
});
test('all-tools uses the native panel lifecycle rather than a competing modal',()=>{
  assert.equal((combined.match(/<dialog\b/g)||[]).length,1);
  assert.ok(combined.includes('data-panel="all"'));
  assert.ok(combined.includes('data-sheet="all"'));
  assert.ok(combined.includes('data-panel="phone" id="fieldLabPhoneBridge"'));
  assert.ok(nav.includes('typeof trigger.onclick'));
});
test('feature status distinguishes local, permission, backend and simulation limits',()=>{
  for(const phrase of ['Permission required','Backend required','Simulation only','Device / Companion',
    'not every experiment or unmerged PR','not automatically imported','not this added HTML file'])
    assert.ok(combined.includes(phrase),phrase);
});
test('canonical offline entry and preserved applications retain correct relative routes',()=>{
  const base=new URL('https://example.test/repo/services/vivo/web/phone/field-lab.html');
  assert.equal(new URL('./index.html',base).pathname,'/repo/services/vivo/web/phone/index.html');
  assert.equal(new URL('../studio.html',base).pathname,'/repo/services/vivo/web/studio.html');
  assert.equal(new URL('../../../../index.html',base).pathname,'/repo/index.html');
  for(const css of ['../shared.css','./phone-world.css'])assert.ok(combined.includes(`href="${css}"`));
});

test('assembler rejects drift, duplicate assembly and invalid source before mounting',()=>{
  for(const bad of ['',null,'<html>not a full app</html>',original.replace('id="world"','id="missing"'),original.replace('./bootstrap.mjs','./unknown.mjs'),combined])
    assert.throws(()=>assembleFieldLab(bad));
});

const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=25000){
  const end=Date.now()+timeout;let last;
  while(Date.now()<end){try{const result=await fn();if(result)return result;}catch(e){last=e;}await pause(100);}
  throw new Error(`Timed out: ${label}${last?': '+last.message:''}`);
}

test('real Chromium integrated route: 11D edit, save/reload, tools, source privacy', {timeout:90000},async t=>{
  if(!existsSync(resolve(phone,'bootstrap.mjs')))return t.skip('Complete repository runtime not present in this checkout');
  const executable=[process.env.CHROME_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/opt/google/chrome/chrome'].find(p=>p&&existsSync(p));
  if(!executable)return t.skip('Chromium/Chrome executable unavailable; browser acceptance not claimed');
  const profile=await mkdtemp(resolve(tmpdir(),'vivo-field-lab-'));
  let browser,ws;const pending=new Map();let serial=0,session;const errors=[],requests=[];
  const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');let file=resolve(root,'.'+decodeURIComponent(url.pathname));
      if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
      if((await stat(file)).isDirectory())file=resolve(file,'index.html');
      const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(body);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  function send(method,params={},sessionId=session){
    return new Promise((resolve,reject)=>{
      const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`));},15000);
      pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }
  async function evaluate(expression){
    const out=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(out.exceptionDetails)throw new Error(out.exceptionDetails.exception?.description||out.exceptionDetails.text);
    return out.result.value;
  }
  try{
    browser=spawn(executable,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',
      '--disable-component-update','--no-first-run','--no-default-browser-check','--use-gl=angle','--use-angle=swiftshader',
      '--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
    let stderr='';browser.stderr.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>50000)stderr=stderr.slice(-50000);});
    const endpoint=await until(()=>stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1],'Chromium debugging endpoint');
    ws=new WebSocket(endpoint);await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
    ws.addEventListener('message',event=>{
      const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}
      else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
      else if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);
    });
    const target=await send('Target.createTarget',{url:'about:blank'},null);
    session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
    await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__cameraRequests=0;if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{window.__cameraRequests++;throw new DOMException('Test camera denied','NotAllowedError');};`});
    const route=base+'/services/vivo/web/phone/field-lab.html';
    await send('Page.navigate',{url:route});
    await until(()=>evaluate("Boolean(document.querySelector('#enterPhoneLocal') && document.querySelector('#createD option[value=\"11\"]'))"),'native phone startup');
    await evaluate("document.querySelector('#fieldLabExplore').click()");
    assert.equal(await evaluate("document.querySelector('[data-lab-action=move]').disabled"),true);
    await evaluate("document.querySelector('#panel').close();document.querySelector('#createD').value='11';document.querySelector('#enterPhoneLocal').click()");
    await until(()=>evaluate('Boolean(window.VivaPhoneEngine?.active)'),'local engine');
    await until(()=>evaluate("document.querySelector('#phoneEconomyNav')?.hidden===false"),'mounted local economy');
    await evaluate("document.querySelector('#fieldLabTools').click()");
    assert.equal(await evaluate("document.querySelector('[data-lab-action=move]').disabled"),false);
    assert.ok((await evaluate("document.querySelector('#fieldLabRuntime').textContent")).includes('Local world active'));
    await evaluate("document.querySelector('[data-lab-action=move]').click()");
    await until(()=>evaluate("document.querySelectorAll('#moveAxis option').length===11"),'all eleven movement axes');
    const snapshot=`(async()=>{const e=await window.VivaPhoneEngine.snapshot();const eye=e.eyes[e.currentEyeId];return {world:e.snapshot.worldId,eye:e.currentEyeId,entity:e.snapshot.spaces[eye.spaceId].entities.relic};})()`;
    const before=await evaluate(snapshot);
    await evaluate("document.querySelector('#moveAxis').value='10';document.querySelector('#axisPlus').click()");
    await until(async()=>((await evaluate(snapshot)).entity.q[10]>before.entity.q[10]+.05),'accepted 11D movement');
    const after=await evaluate(snapshot);assert.ok(after.entity.revision>before.entity.revision);
    await evaluate("document.querySelector('#panel').close();document.querySelector('#fieldLabTools').click();document.querySelector('[data-lab-action=save]').click();document.querySelector('#phonePersist').click()");
    await pause(500);
    await send('Page.reload',{ignoreCache:true});
    await until(()=>evaluate("Boolean(document.querySelector('#enterPhoneLocal'))"),'reload startup');
    await evaluate("document.querySelector('#enterPhoneLocal').click()");
    await until(()=>evaluate('Boolean(window.VivaPhoneEngine?.active)'),'reopened local engine');
    const restored=await evaluate(snapshot);
    assert.equal(restored.world,after.world);assert.equal(restored.eye,after.eye);
    assert.ok(Math.abs(restored.entity.q[10]-after.entity.q[10])<.001);
    await evaluate("document.querySelector('#fieldLabTools').click();document.querySelector('[data-lab-action=agents]').click()");
    assert.equal(await evaluate("document.querySelector('[data-sheet=phone]').classList.contains('active')"),true);
    assert.equal(await evaluate("document.querySelectorAll('[data-local-cap]:checked').length"),0);
    await evaluate("document.querySelector('#panel').close();document.querySelector('#fieldLabTools').click();document.querySelector('[data-lab-action=hands]').click()");
    assert.equal(await evaluate("document.querySelector('[data-sheet=camera]').classList.contains('active')"),true);
    assert.equal(await evaluate('window.__cameraRequests'),0);
    assert.equal(await evaluate("document.querySelector('#recordCamera').checked"),false);
    assert.deepEqual(requests.filter(url=>/\/(api|ws)(\/|\?|$)/.test(new URL(url).pathname)),[]);
    assert.deepEqual(errors,[]);
    t.diagnostic('Real Chromium, native worker/runtime: 11D edit and persistent world/Eye reload passed; navigation grants no camera/agent permission and sends no backend requests. No physical-device claim.');
  } finally {
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Browser cleanup'));}pending.clear();
    ws?.close();browser?.kill('SIGKILL');server.closeAllConnections();await new Promise(r=>server.close(r));
    await pause(100);await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
});
