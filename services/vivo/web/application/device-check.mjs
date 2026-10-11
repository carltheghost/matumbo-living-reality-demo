import {Camera} from '/camera.js';

const $=id=>document.getElementById(id);
const startedAt=new Date().toISOString();
const report={
  schema:'vivo.physical-device-evidence/1',
  startedAt,
  scope:'manual physical-device evidence; no camera frames or tokens are recorded',
  cameraFramesUploaded:false,
  microphoneRequested:false,
  environment:{},
  network:{samplesMs:[]},
  touch:{physicalDown:0,physicalUp:0,otherPointerDown:0,lastEventTimestamp:null},
  camera:{starts:[],states:[],gestureCounts:{aim:0,grab:0,move:0,release:0,lost:0},maxHandsSeen:0},
  physicalDeviceValidated:false
};
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
    row('Touch points',report.environment.touchPoints,report.environment.touchPoints>0)
  );
}
staticChecks();

async function measureNetwork(){
  const samples=[];
  for(let i=0;i<5;i++){
    const t=performance.now();
    const response=await fetch('/healthz',{cache:'no-store'});
    const body=await response.json();
    if(!response.ok||!body.ok)throw Error('Remote authority is not ready');
    samples.push(performance.now()-t);
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  report.network.samplesMs=samples.map(v=>+v.toFixed(2));
  report.network.medianMs=[...samples].sort((a,b)=>a-b)[Math.floor(samples.length/2)];
  report.network.healthOk=true;
  $('networkState').textContent='Median '+report.network.medianMs.toFixed(1)+' ms · 5/5 health checks';
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
  if(Object.hasOwn(report.camera.gestureCounts,event.type))report.camera.gestureCounts[event.type]++;
  update();
}
function hands(points){
  report.camera.maxHandsSeen=Math.max(report.camera.maxHandsSeen,points.length?1:0);
}
const camera=new Camera($('cameraVideo'),cameraState,gesture,hands);
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
    row('Facing',d.facing),
    row('Frame age ms',report.camera.diagnostics.frameAgeMs),
    row('Inference ms',report.camera.diagnostics.inferenceMs),
    row('Frames uploaded',d.framesUploaded,d.framesUploaded===false)
  );
}
async function startCamera(facing,tracking){
  const at=new Date().toISOString();
  const ok=await camera.start(facing,tracking);
  const d=camera.diagnostics();
  report.camera.starts.push({at,requestedFacing:facing,tracking,started:!!ok,actualFacing:d.facing,modelReady:d.modelReady});
  updateCameraMetrics();update();
}
$('front').onclick=()=>startCamera('user',true);
$('rear').onclick=()=>startCamera('environment',true);
$('preview').onclick=()=>startCamera('environment',false);
$('stop').onclick=()=>{camera.stop('Camera stopped by user');updateCameraMetrics();update();};
setInterval(()=>{if(camera.stream)updateCameraMetrics();},500);

function update(){
  const env=report.environment;
  const touch=report.touch.physicalDown>0&&report.touch.physicalUp>0;
  const cameraStart=report.camera.starts.some(s=>s.started);
  const model=report.camera.starts.some(s=>s.tracking&&s.started&&s.modelReady)||
    report.camera.states.some(s=>s.text.includes('MODEL READY')||s.text.includes('1 HAND'));
  const localOnly=report.camera.diagnostics?.framesUploaded===false;
  report.physicalDeviceValidated=Boolean(
    env.secureContext&&env.mediaDevices&&env.worker&&env.createImageBitmap&&
    report.network.healthOk&&touch&&cameraStart&&model&&localOnly
  );
  $('verdict').textContent=report.physicalDeviceValidated
    ?'PASS · physical touch, camera, local hand model and server path verified on this device.'
    :'PENDING · complete network, physical touch and camera + hand-model checks on the real device.';
  $('verdict').className=report.physicalDeviceValidated?'ok':'';
  $('summary').textContent=JSON.stringify({
    physicalDeviceValidated:report.physicalDeviceValidated,
    networkMedianMs:report.network.medianMs??null,
    physicalTouch:touch,
    cameraStarted:cameraStart,
    handModelReady:model,
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
window.addEventListener('pagehide',()=>camera.stop());
update();
