/* Tests the exact worker function against real pinned MediaPipe assets.
 * Public fixture, desktop CI Chromium, not physical-phone acceptance.
 */
const fs=require('node:fs');const assert=require('node:assert/strict');const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('browser:',m.text());});
await page.goto('http://127.0.0.1:9876/field-lab-grab.html');
const source=fs.readFileSync('src/field-lab/field-lab-touch-repair.js','utf8');const a=source.indexOf('function workerProgram(){'),b=source.indexOf('\nfunction terminateWorker()',a);assert(a>=0&&b>a);const body='('+source.slice(a,b)+')()';
const fixtureResponse=await fetch('https://storage.googleapis.com/mediapipe-tasks/hand_landmarker/woman_hands.jpg');assert(fixtureResponse.ok);const fixture=Buffer.from(await fixtureResponse.arrayBuffer()).toString('base64');
const result=await page.evaluate(async({body,fixture})=>{const worker=new Worker(URL.createObjectURL(new Blob([body],{type:'text/javascript'})));const base=location.origin+'/vendor/field-lab/';
const exchange=(message,transfer=[])=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker exchange timeout')),60000);worker.onmessage=e=>{clearTimeout(timer);e.data.type==='error'?reject(Error(e.data.message)):resolve(e.data);};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};worker.postMessage(message,transfer);});
let ticks=0;const ticker=setInterval(()=>ticks++,20);try{const ready=await exchange({type:'init',bundle:base+'vision_bundle.mjs',wasm:base+'wasm',model:base+'hand_landmarker.task'});if(ready.type!=='ready')throw Error('Model not ready');
const blob=await(await fetch('data:image/jpeg;base64,'+fixture)).blob();const first=await createImageBitmap(blob);const scale=Math.min(1,480/Math.max(first.width,first.height));const image=await createImageBitmap(first,{resizeWidth:Math.round(first.width*scale),resizeHeight:Math.round(first.height*scale)});first.close();const t=performance.now();const hand=await exchange({type:'frame',image,time:t,sequence:1},[image]);
const canvas=new OffscreenCanvas(320,240);canvas.getContext('2d').fillRect(0,0,320,240);const blank=canvas.transferToImageBitmap();const empty=await exchange({type:'frame',image:blank,time:performance.now()+1,sequence:2},[blank]);
return {ready:true,hands:hand.landmarks.length,landmarks:hand.landmarks[0]?.length||0,finite:hand.landmarks.flat().every(p=>[p.x,p.y,p.z].every(Number.isFinite)),handInferenceMs:hand.inferenceMs,blankHands:empty.landmarks.length,interfaceTicks:ticks,runtime:'MediaPipe Tasks Vision 0.10.14',delegate:'CPU in classic Worker',fixture:'Google official Hand Landmarker notebook woman_hands.jpg fixture',physicalPhoneTested:false};
}finally{clearInterval(ticker);worker.terminate();}}, {body,fixture});
console.log(JSON.stringify(result,null,2));assert(result.ready&&result.hands>=1&&result.landmarks===21&&result.finite,'Real model must detect a complete hand');assert.equal(result.blankHands,0);assert.equal(errors.length,0);result.passed=true;fs.writeFileSync('field-worker-real-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
