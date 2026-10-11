import {Camera} from '/camera.js';
import {installCameraConstraintFallback,normalizeCameraFacing} from './camera-compat.mjs';

installCameraConstraintFallback();

const $=id=>document.getElementById(id);
const startedAt=new Date().toISOString();
const report={
  schema:'vivo.physical-device-evidence/1',
  startedAt,
  scope:'manual physical-device evidence; no camera frames or tokens are recorded',
  cameraFramesUploaded:false,
  microphoneRequested:false,
  environment:{testedOrigin:location.origin,releaseDigest:null,releaseOrigin:null,releaseIdentityVerified:false},
  network:{samplesMs:[]},
  touch:{physicalDown:0,physicalUp:0,otherPointerDown:0,lastEventTimestamp:null},
  camera:{starts:[],states:[],gestureCounts:{aim:0,grab:0,move:0,release:0,lost:0},maxHandsSeen:0,processedHandFrames:0},
  physicalDeviceValidated:false
};
let activeStart=null;
let cameraStarting=false;
let trackingActive=false;

const row=(name,value,ok=null)=>{
  const div=document.createElement('div');div.className='check '+(ok===true?'ok':ok===false?'bad':'');
  const b=document.createElement('b');b.textContent=name;
  const span=document.createElement('span');span.textContent=String(value);
  div.append(b,span);return div;
};
function staticChecks(){
  const gl=(()=>{try{return !!document.createElement('canvas').getContext('webgl');}catch{return false;}})();
  Object.assign(report.environment,{
    secureContext:isSecureContext,
    protocol:location.protocol,
    mediaDevices:!!navigator.mediaDevices?.getUserMedia,
    worker:typeof Worker==='function',
    offscreenCanvas:typeof OffscreenCanvas==='function',
    createImageBitmap:typeof createImageBitmap==='function',
    webgl:gl,
    pointerEvent:typeof PointerEvent==='function',
    touchPoints:navigator.maxTouchPoints||0,
    screen:{width:screen.width,height:screen.height,devicePixelRatio:devicePixelRatio},
    userAgent:navigator.userAgent
  });
  const box=$('staticChecks');box.replaceChildren(
    row('Secure context',report.environment.secureContext,report.environment.secureContext),
    row('Camera API',report.environment.mediaDevices,report.environment.mediaDevices),
    row('Worker',report.environment.worker,report.environment.worker),
    row('OffscreenCanvas',report.environment.offscreenCanvas,report.environment.offscreenCanvas),
    row('createImageBitmap',report.environment.createImageBitmap,report.environment.createImageBitmap),
    row('WebGL',report.environment.webgl,report.environment.webgl),
    row('Touch points',report.environment.touchPoints,report.environment.touchPoints>0),
    row('Tested origin',report.environment.testedOrigin),
    row('Release identity',report.environment.releaseIdentityVerified?'verified':'pending',report.environment.releaseIdentityVerified)
  );
}
staticChecks();

function fetchWithTimeout(url,options={},timeoutMs=4000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  return fetch(url,{...options,signal:controller.signal}).finally(()=>clearTimeout(timer));
}
async function readReleaseIdentity(){
  try{
    const response=await fetchWithTimeout(location.href,{method:'HEAD',cache:'no-store'});
    const digest=response.headers.get('X-Vivo-Release-Digest');
    const releaseOrigin=response.headers.get('X-Vivo-Release-Origin');
    report.environment.releaseDigest=digest;
    report.environment.releaseOrigin=releaseOrigin;
    report.environment.releaseIdentityVerified=response.ok&&releaseOrigin===location.origin&&
      /^sha256:[0-9a-f]{64}$/i.test(digest||'');
  }catch(error){
    report.environment.releaseIdentityError=String(error?.message||error).slice(0,180);
  }
  staticChecks();update();
}
void readReleaseIdentity();

async function measureNetwork(){
  const samples=[];
  for(let i=0;i<5;i++){
    const t=performance.now();
    const response=await fetchWithTimeout('/healthz',{cache:'no-store'});
    const body=await response.json();
    if(!response.ok||!body.ok)throw Error('Remote authority is not ready');
    samples.push(performance.now()-t);
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  report.network.samplesMs=samples.map(v=>+v.toFixed(2));
  report.network.medianMs=[...samples].sort((a,b)=>a-b)[Math.floor(samples.length/2)];
  report.network.healthOk=true;
  $('networkState').textContent='Median '+report.network.medianMs.toFixed(1)+' ms - 5/5 health checks';
  update();
}
$('network').onclick=()=>measureNetwork().catch(error=>{$('networkState').textContent=error.message;report.network.healthOk=false;update();});

for(const type of ['pointerdown','pointerup'])$('touchTarget').addEventListener(type,event=>{
  report.touch.lastEventTimestamp=event.timeStamp;
  if(event.pointerType==='touch'){
    if(type==='pointerdown')report.touch.physicalDown++;
    else report.touch.physicalUp++;
  } else if(type==='pointerdown')report.touch.otherPointerDown++;
  $('touchState').textContent=report.touch.physicalDown&&report.touch.physicalUp
    ?'Physical touch down/up captured with original event timestamps'
    :'Pointer '+event.pointerType+' captured; physical touch still pending';
  update();
});

function cameraState(text){
  report.camera.states.push({at:new Date().toISOString(),text:String(text).slice(0,180)});
  if(report.camera.states.length>40)report.camera.states.shift();
  $('cameraState').textContent=text;
  updateCameraMetrics();
  update();
}
function gesture(event){
  if(event.type==='lost'){
    // Camera.stop()/start() emit a lifecycle loss. It is not tracking-loss
    // evidence from a processed frame and must not inflate the report.
    if(!trackingActive||cameraStarting)return;
  } else if(!trackingActive)return;
  if(Object.hasOwn(report.camera.gestureCounts,event.type))report.camera.gestureCounts[event.type]++;
  update();
}
function hands(points){
  if(!trackingActive||!points.length)return;
  report.camera.processedHandFrames++;
  if(activeStart)activeStart.processedHandFrames++;
  report.camera.maxHandsSeen=Math.max(report.camera.maxHandsSeen,1);
  update();
}
const camera=normalizeCameraFacing(new Camera($('cameraVideo'),cameraState,gesture,hands));
function updateCameraMetrics(){
  const d=camera.diagnostics();
  report.camera.diagnostics={
    stream:d.stream,modelReady:d.modelReady,facing:d.facing,
    frameAgeMs:Number.isFinite(d.frameAgeMs)?+d.frameAgeMs.toFixed(1):null,
    inferenceMs:Number.isFinite(d.inferenceMs)?+d.inferenceMs.toFixed(1):null,
    handRegionMean:Number.isFinite(d.handRegionMean)?+d.handRegionMean.toFixed(1):null,
    whiteClippedFraction:Number.isFinite(d.whiteClippedFraction)?+d.whiteClippedFraction.toFixed(4):null,
    secure:d.secure,protocol:d.protocol,framesUploaded:d.framesUploaded
  };
  $('cameraMetrics').replaceChildren(
    row('Stream',d.stream,!!d.stream),
    row('Model ready',d.modelReady,d.modelReady?true:null),
    row('Processed hand frames',report.camera.processedHandFrames,report.camera.processedHandFrames>0),
    row('Facing',d.facing),
    row('Frame age ms',report.camera.diagnostics.frameAgeMs),
    row('Inference ms',report.camera.diagnostics.inferenceMs),
    row('Frames uploaded',d.framesUploaded,d.framesUploaded===false)
  );
}
async function startCamera(facing,tracking){
  cameraStarting=true;trackingActive=false;
  const at=new Date().toISOString();
  const attempt={at,requestedFacing:facing,tracking,started:false,actualFacing:null,modelReady:false,processedHandFrames:0};
  report.camera.starts.push(attempt);activeStart=attempt;
  try{
    const ok=await camera.start(facing,tracking);
    const d=camera.diagnostics();
    attempt.started=!!ok;attempt.actualFacing=d.facing;attempt.modelReady=d.modelReady;
    trackingActive=Boolean(ok&&tracking&&d.modelReady);
  }catch(error){
    attempt.error=String(error?.message||error).slice(0,180);
  }finally{
    cameraStarting=false;
    updateCameraMetrics();update();
  }
}
$('front').onclick=()=>startCamera('user',true);
$('rear').onclick=()=>startCamera('environment',true);
$('preview').onclick=()=>startCamera('environment',false);
$('stop').onclick=()=>{cameraStarting=false;trackingActive=false;activeStart=null;camera.stop('Camera stopped by user');updateCameraMetrics();update();};
setInterval(()=>{if(camera.stream)updateCameraMetrics();},500);

function update(){
  const env=report.environment;
  const touch=report.touch.physicalDown>0&&report.touch.physicalUp>0;
  const cameraStart=report.camera.starts.some(s=>s.started&&s.processedHandFrames>0);
  const front=report.camera.starts.some(s=>s.tracking&&s.started&&s.actualFacing==='user'&&s.processedHandFrames>0);
  const rear=report.camera.starts.some(s=>s.tracking&&s.started&&s.actualFacing==='environment'&&s.processedHandFrames>0);
  const model=report.camera.processedHandFrames>0;
  const localOnly=report.camera.diagnostics?.framesUploaded===false;
  report.physicalDeviceValidated=Boolean(
    env.secureContext&&env.mediaDevices&&env.worker&&env.createImageBitmap&&
    env.releaseIdentityVerified&&report.network.healthOk&&touch&&cameraStart&&front&&rear&&model&&localOnly
  );
  $('verdict').textContent=report.physicalDeviceValidated
    ?'PASS - physical touch, front + rear cameras, processed local hand frames and server identity verified on this device.'
    :'PENDING - complete network, physical touch, both camera-facing paths and processed hand-frame checks on the real device.';
  $('verdict').className=report.physicalDeviceValidated?'ok':'';
  $('summary').textContent=JSON.stringify({
    physicalDeviceValidated:report.physicalDeviceValidated,
    networkMedianMs:report.network.medianMs??null,
    physicalTouch:touch,
    cameraStarted:cameraStart,
    frontCameraProcessed:front,
    rearCameraProcessed:rear,
    processedHandFrames:report.camera.processedHandFrames,
    handModelProcessed:model,
    releaseIdentityVerified:env.releaseIdentityVerified,
    testedOrigin:env.testedOrigin,
    releaseDigest:env.releaseDigest,
    cameraFramesUploaded:false
  },null,2);
}
$('export').onclick=()=>{
  updateCameraMetrics();update();
  report.finishedAt=new Date().toISOString();
  const blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='vivo-device-evidence.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
};
window.addEventListener('pagehide',()=>{cameraStarting=false;trackingActive=false;activeStart=null;camera.stop();});
update();
