const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export class OneEuro{
 constructor(){this.last=null;this.x=0;this.raw=0;this.dx=0;}
 update(x,t){if(this.last===null||t-this.last>500||t<=this.last){this.last=t;this.raw=this.x=x;this.dx=0;return x;}const dt=(t-this.last)/1000,a=f=>1/(1+1/(2*Math.PI*f*dt));this.dx+=a(1)*((x-this.raw)/dt-this.dx);this.x+=a(2.8+1.8*Math.abs(this.dx))*(x-this.x);this.last=t;this.raw=x;return this.x;}
}
export function fitPoint(p,vw,vh,w,h,mirror){const scale=Math.max(w/vw,h/vh);return [(mirror?1-p.x:p.x)*vw*scale-(vw*scale-w)/2,p.y*vh*scale-(vh*scale-h)/2];}
export class Camera{
 constructor(video,onState,onGesture,onHands){this.video=video;this.onState=onState;this.onGesture=onGesture;this.onHands=onHands;this.epoch=0;this.stream=null;this.worker=null;this.busy=false;this.facing='user';this.frame=0;this.lastResult=0;this.sequence=0;this.lastSequence=0;this.lastTime=-1;this.arm=0;this.held=false;this.fx=new OneEuro();this.fy=new OneEuro();this.age=0;this.inferenceMs=0;this.profile='auto';this.brightness=0;this.mean=0;this.lastLuma=0;this.ready=false;this.sampler=document.createElement('canvas');this.sampler.width=40;this.sampler.height=30;this.sctx=this.sampler.getContext('2d',{willReadFrequently:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop('Tab hidden; camera released');});window.addEventListener('pagehide',()=>this.stop());window.addEventListener('keydown',e=>{if(e.key==='Escape')this.stop('Camera stopped');});
 }
 lost(message){if(this.held)this.onGesture({type:'release',reason:message});this.held=false;this.arm=0;this.onHands([]);this.onGesture({type:'lost'});}
 stop(message='Camera off. Touch remains available.'){
  this.epoch++;cancelAnimationFrame(this.frame);this.worker?.terminate();this.worker=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.pause();this.video.srcObject=null;this.busy=false;this.ready=false;this.lost(message);document.body.classList.remove('camera-live');this.onState(message);clearTimeout(this.timer);if(this.initReject){const reject=this.initReject;this.initReject=null;reject(Error('Tracking initialization cancelled'));}
 }
 async start(facing='user',tracking=true){
  this.stop();const epoch=this.epoch;this.facing=facing;this.onState('Waiting for camera permission…');
  try{
   if(!['https:','http:'].includes(location.protocol)||!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Use a direct HTTPS page (or localhost), not a Downloads/content:// preview.');
   let stream;
   try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30}}});}
   catch(e){if(e.name==='OverconstrainedError')stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:facing}});else throw e;}
   if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return false;}
   this.stream=stream;const track=stream.getVideoTracks()[0];this.facing=track.getSettings?.().facingMode||facing;track.addEventListener('ended',()=>{if(epoch===this.epoch)this.stop('Camera disconnected');});
   this.video.srcObject=stream;this.video.muted=true;this.video.style.transform=this.facing==='user'?'scaleX(-1)':'none';await this.video.play();if(epoch!==this.epoch)return false;
   if(!this.video.videoWidth)await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Camera produced no frames')),12000);this.video.addEventListener('loadeddata',()=>{clearTimeout(t);resolve();},{once:true});});
   if(epoch!==this.epoch)return false;document.body.classList.add('camera-live');if(!tracking){this.keepPreview('VIDEO READY · touch controls; hand tracking is off');return true;}this.onState('Video ready. Loading local hand model…');
   if(!window.Worker||!window.OffscreenCanvas||!window.createImageBitmap)throw Error('This browser cannot run worker tracking');
   const worker=new Worker(new URL('./hand-worker.js',import.meta.url));this.worker=worker;
   await new Promise((resolve,reject)=>{
    this.initReject=reject;
    this.timer=setTimeout(()=>reject(Error('Hand model timed out; retry from a hosted page')),45000);
    worker.onerror=e=>{clearTimeout(this.timer);if(!this.ready)reject(Error(e.message||'Hand worker failed'));else this.keepPreview('Hand worker failed · camera and touch only');};
    worker.onmessage=({data:m})=>{if(epoch!==this.epoch)return;if(m.type==='ready'){this.initReject=null;clearTimeout(this.timer);resolve();}else if(m.type==='error'){clearTimeout(this.timer);if(!this.ready)reject(Error(m.message));else this.keepPreview('Hand tracking stopped: '+m.message+' · camera and touch only');}else this.consume(m);};
    worker.postMessage({type:'init',bundle:new URL('./vendor/field-lab/vision_bundle.mjs',import.meta.url).href,wasm:new URL('./vendor/field-lab/wasm',import.meta.url).href,model:new URL('./vendor/field-lab/hand_landmarker.task',import.meta.url).href});
   });
   if(epoch!==this.epoch)return false;this.ready=true;this.sequence=0;this.lastSequence=0;this.lastTime=-1;this.lastResult=performance.now();this.onState('MODEL READY · open hand, aim, pinch to grab');this.pump(epoch,performance.now());return true;
  }catch(e){if(epoch===this.epoch){const reason=e.name==='NotAllowedError'?'Camera permission denied. Allow Camera for this HTTPS site and retry.':e.message;if(this.stream&&this.video.readyState>=2){this.keepPreview(reason+' · camera preview and touch remain active');}else this.stop(reason);}return false;}
 }
 keepPreview(message='Camera preview and touch only'){
  clearTimeout(this.timer);this.initReject=null;cancelAnimationFrame(this.frame);
  this.worker?.terminate();this.worker=null;this.busy=false;this.ready=false;
  this.lost('Hand tracking is off');this.onState(message);
  const epoch=this.epoch;
  const sample=now=>{if(epoch!==this.epoch||!this.stream||this.worker)return;
   if(this.video.readyState>=2&&now-this.lastLuma>500){this.lastLuma=now;this.sampleLuma();}
   this.frame=requestAnimationFrame(sample);
  };
  this.frame=requestAnimationFrame(sample);
 }
 pump(epoch,now){
  if(epoch!==this.epoch||!this.worker||!this.stream)return;this.frame=requestAnimationFrame(t=>this.pump(epoch,t));
  if(now-this.lastResult>350&&this.held)this.lost('Stale camera result');
  if(this.busy){if(now-this.sentAt>2500)this.keepPreview('Hand worker stopped responding · camera and touch only');return;}
  if(now-(this.sentAt||0)<Math.max(65,this.inferenceMs*1.15)||this.video.readyState<2||this.video.currentTime===this.lastTime)return;
  this.busy=true;this.sentAt=now;this.lastTime=this.video.currentTime;const sequence=++this.sequence,w=this.video.videoWidth,h=this.video.videoHeight,k=Math.min(1,480/Math.max(w,h));
  createImageBitmap(this.video,{resizeWidth:Math.round(w*k),resizeHeight:Math.round(h*k),resizeQuality:'low'}).then(image=>{if(epoch!==this.epoch||!this.worker){image.close();return;}this.worker.postMessage({type:'frame',image,time:now,sequence},[image]);}).catch(e=>{if(epoch===this.epoch)this.stop('Frame transfer failed: '+e.message);});
 }
 sampleLuma(hand){try{this.sctx.drawImage(this.video,0,0,40,30);const data=this.sctx.getImageData(0,0,40,30).data;let sum=0,count=0,white=0;let xmin=0,xmax=40,ymin=0,ymax=30;if(hand?.length){xmin=clamp(Math.floor(Math.min(...hand.map(p=>p.x))*40),0,39);xmax=clamp(Math.ceil(Math.max(...hand.map(p=>p.x))*40),xmin+1,40);ymin=clamp(Math.floor(Math.min(...hand.map(p=>p.y))*30),0,29);ymax=clamp(Math.ceil(Math.max(...hand.map(p=>p.y))*30),ymin+1,30);}for(let y=ymin;y<ymax;y++)for(let x=xmin;x<xmax;x++){const i=(y*40+x)*4,v=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];sum+=v;count++;if(v>247)white++;}this.mean=sum/Math.max(1,count);this.clipped=white/Math.max(1,count);const p=this.profile==='auto'?(this.mean>200||this.clipped>.4?'bright':this.mean<35?'dark':'balanced'):this.profile;document.body.classList.toggle('bright',p==='bright');document.body.classList.toggle('dark',p==='dark');return this.mean>3&&this.clipped<.985;}catch(_){return true;}}
 consume(m){if(m.type!=='result')return;this.busy=false;if(m.sequence<=this.lastSequence)return;this.lastSequence=m.sequence;const now=performance.now();this.age=now-m.time;this.inferenceMs=m.inferenceMs;this.lastResult=now;const h=m.landmarks?.[0];if(this.age>300||!h||h.length!==21){this.lost('No fresh tracked hand');this.onState(this.age>300?'Tracking too late; using touch':'No hand detected · touch stays available');return;}
  if(now-this.lastLuma>500){this.lastLuma=now;this.lightOK=this.sampleLuma(h);}if(this.lightOK===false){this.lost('Hand region lacks usable image detail');this.onState('Camera detail too dark or clipped. Use touch or add light.');return;}
  const size=Math.hypot(h[5].x-h[17].x,h[5].y-h[17].y);if(size<.025){this.lost('Hand too small');return;}const ratio=Math.hypot(h[4].x-h[8].x,h[4].y-h[8].y)/size;const pts=h.map(p=>fitPoint(p,this.video.videoWidth,this.video.videoHeight,innerWidth,innerHeight,this.facing==='user'));
  const p=[this.fx.update(pts[8][0],now),this.fy.update(pts[8][1],now)];this.onHands(pts);this.onGesture({type:'aim',point:p});
  if(ratio>.6){this.arm=Math.min(3,this.arm+1);if(this.held){this.held=false;this.onGesture({type:'release',reason:'Open hand'});}}
  if(ratio<.33&&this.arm>=3&&!this.held){this.held=true;this.onGesture({type:'grab',point:p});}
  if(this.held)this.onGesture({type:'move',point:p});
  this.onState('1 HAND · '+(this.held?'PINCH HELD':this.arm>=3?'READY TO GRAB':'SHOW OPEN HAND')+' · '+Math.round(this.age)+' ms frame age');
 }
 async light(){if(!this.stream)throw Error('Start the back camera first');const t=this.stream.getVideoTracks()[0],c=t.getCapabilities?.();if(!c?.torch)throw Error('This camera/browser does not expose a torch');const current=t.getSettings?.().torch;await t.applyConstraints({advanced:[{torch:!current}]});return !current;}
 async exposure(){if(!this.stream)throw Error('Start a camera first');const t=this.stream.getVideoTracks()[0],c=t.getCapabilities?.().exposureCompensation;if(!c)throw Error('This camera/browser does not expose exposure compensation');const x=clamp((t.getSettings?.().exposureCompensation||0)-(c.step||.5),c.min,c.max);await t.applyConstraints({advanced:[{exposureCompensation:x}]});return x;}
 diagnostics(){return {stream:!!this.stream,modelReady:this.ready,facing:this.facing,frameAgeMs:this.age,inferenceMs:this.inferenceMs,handRegionMean:this.mean,whiteClippedFraction:this.clipped,secure:isSecureContext,protocol:location.protocol,framesUploaded:false};}
}
