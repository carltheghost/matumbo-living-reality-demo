import { createEyeTracker } from './eye-tracker.js';
import { createTrackingInteraction } from '../domains/tracking-interaction.js';

const TRAIN = [.1,.5,.9].flatMap(y => [.1,.5,.9].map(x => ({x,y,phase:'train'})));
const VALIDATE = [[.3,.3],[.7,.3],[.5,.5],[.3,.7],[.7,.7]].map(([x,y]) => ({x,y,phase:'validate'}));
const TARGETS = [...TRAIN,...VALIDATE];
const friendly = reason => ({
  'no-face':'Bring one face into view.', 'multiple-faces':'Keep just your face in view.',
  'eyes-closed':'Open your eyes when you are ready.', 'calibration-needed':'Calibrate to enable the gaze pointer.',
  'calibration-started':'Look at the target and keep your head comfortably still.',
  'not-enough-stable-frames':'Keep looking at the dot for another moment.',
  'unstable-eye-features':'Hold your gaze on the dot a little longer.',
  'stale-frame':'Waiting for fresh video.', 'eyes-disabled':'Eye tracking is off.',
  'holdout-error-too-high':'The accuracy check did not pass. Improve lighting, steady the camera and try again.',
  'ill-conditioned-calibration':'The samples did not distinguish where you were looking. Try again without following the dot with your head.',
  'insufficient-feature-variation':'The samples were too similar. Look directly at each dot and try again.',
  'invalid-iris-geometry':'Move a little closer and light your face evenly.',
  'hold-still':'Keep looking at the dot for another moment.',
  'eyes-not-stable':'Hold your gaze on the dot a little longer.',
  'head-not-stable':'Keep your head comfortably still and look with your eyes.',
  'insufficient-eye-variation':'Look directly at each target. The captured eye positions were too similar.',
  'degenerate-calibration':'These samples cannot support a reliable mapping. Steady your camera and try again.',
  'fresh-eyes-needed':'Waiting for a clear, fresh view of your eyes.',
  'target-captured':'Target captured. Look at the next light.',
}[reason] ?? String(reason ?? '').replaceAll('-',' '));

/** Shared source + explicit user controls. This controller never acquires a
 * second camera, stores sensor data, or substitutes another feature owner. */
export function mountHandsEyesControls({ session, getAssembly, onOpen = () => {}, documentRoot = document,
  eyeFactory = createEyeTracker, clock = () => performance.now() } = {}) {
  const camera = session?.getCamera?.();
  if (!camera || !documentRoot?.body) return {open(){},close(){},destroy(){},getSnapshot:()=>({available:false})};
  const doc = documentRoot, view = doc.defaultView ?? globalThis;
  let destroyed=false, opened=false, calibrating=false, targetIndex=0, targetSince=0, previousFocus=null;
  let eyeStatus=null, lastSourceKey=null, lastRunning=false, captureNote='', calibrationResult=null;
  let observedHands=0, lastHandSampleAt=-Infinity;
  const unsubscribers=[];
  const style=doc.createElement('link');style.rel='stylesheet';style.href=new URL('./hands-eyes-controls.css',import.meta.url).href;doc.head.append(style);
  const trigger=doc.createElement('button');trigger.id='hands-eyes-trigger';trigger.type='button';trigger.textContent='Hands & eyes';
  trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','hands-eyes-panel');
  const panel=doc.createElement('aside');panel.id='hands-eyes-panel';panel.hidden=true;panel.setAttribute('aria-label','Hands and eyes controls');
  panel.setAttribute('data-controller-owned','tracking');
  panel.innerHTML=`<header><div><span class="he-eyebrow">Move naturally</span><h2>Hands &amp; eyes</h2></div><button data-he-close aria-label="Close Hands and eyes controls">×</button></header>
    <p class="he-intro">Your ordinary camera. Your objects. One shared view.</p>
    <div class="he-status" role="status" data-he-status>Camera off · nothing is being tracked</div>
    <div class="he-trackers">
      <label class="he-choice"><input data-he-hands type="checkbox" checked><span><strong>Hands</strong><small>Point &amp; pinch</small></span></label>
      <label class="he-choice"><input data-he-eyes type="checkbox"><span><strong>Eyes</strong><small>Calibrate &amp; look</small></span></label>
    </div>
    <section><h3>01 <span>Choose your source</span></h3><div data-he-camera></div><p class="he-note">Laptop, USB webcam or phone. Phone cameras need an HTTPS address that the phone can reach. A video file stays on this device.</p></section>
    <section><h3>02 <span>Choose how to move</span></h3>
      <label class="he-field">Hand action<select data-he-mode><option value="interact">Interact with objects</option><option value="arrange">Arrange objects</option></select></label>
      <p class="he-note" data-he-guide>Open your hand first. Pinch over an object to use its original controls.</p>
      <label class="he-choice"><input data-he-gaze-pinch type="checkbox"><span><strong>Look, then pinch</strong><small>Use calibrated gaze to aim; your hand confirms.</small></span></label>
      <label class="he-choice"><input data-he-dwell type="checkbox"><span><strong>Gaze navigation</strong><small>Look steadily for 1.8 seconds to open a space or feature.</small></span></label>
      <label class="he-choice" data-he-replay-row hidden><input data-he-replay type="checkbox"><span><strong>Let this video control objects</strong><small>Off by default. A recorded gesture can then act on this local world.</small></span></label>
    </section>
    <section><h3>03 <span>Make gaze yours</span></h3><p data-he-eye-status>Turn on Eyes and start a camera to calibrate.</p>
      <div class="he-buttons"><button data-he-calibrate>Calibrate gaze</button><button data-he-clear>Clear calibration</button></div>
      <p class="he-note">Nine targets teach your gaze. Five new targets check it. Moving the camera, switching sources or rotating the screen requires a new calibration. Larger objects are easier to target.</p>
      <output data-he-accuracy></output>
    </section>
    <footer><button data-he-resume>Use controls in the world</button><button data-he-stop>Stop all tracking</button><p>Frames and calibration stay on this device. No microphone, recording or upload.</p></footer>`;
  const cursor=doc.createElement('div');cursor.id='hands-eyes-cursor';cursor.hidden=true;cursor.setAttribute('aria-hidden','true');cursor.innerHTML='<i></i><span></span>';
  const indicator=doc.createElement('div');indicator.id='hands-eyes-live';indicator.hidden=true;
  indicator.innerHTML='<button data-he-live-open>Tracking</button><button data-he-live-stop aria-label="Stop all tracking">Stop</button>';
  const calibration=doc.createElement('div');calibration.id='hands-eyes-calibration';calibration.hidden=true;
  calibration.setAttribute('role','dialog');calibration.setAttribute('aria-modal','true');calibration.setAttribute('aria-label','Calibrate gaze');
  calibration.innerHTML='<div class="he-calibration-dot" aria-hidden="true"></div><div class="he-calibration-copy"><span data-he-step></span><h2>Look at the light</h2><p data-he-capture-note></p><button data-he-capture>Capture · Space</button><button data-he-cancel>Cancel · Esc</button></div>';
  doc.body.append(trigger,panel,cursor,indicator,calibration);
  const q=s=>panel.querySelector(s), cq=s=>calibration.querySelector(s);
  const text=(element,value)=>{if(element.textContent!==value)element.textContent=value;};
  const prop=(element,key,value)=>{if(element[key]!==value)element[key]=value;};
  const hands=q('[data-he-hands]'), eyes=q('[data-he-eyes]'), mode=q('[data-he-mode]'), gazePinch=q('[data-he-gaze-pinch]'), dwell=q('[data-he-dwell]'), replay=q('[data-he-replay]');
  // Reparent the source owner's one panel. It retains its real video, event
  // handlers and lifecycle, so no duplicate stream or preview is created.
  camera.setPanelOpen(true);
  const sourcePanel=camera.getPanelElement?.() ?? doc.getElementById('hand-lens-panel');
  if(sourcePanel)q('[data-he-camera]').append(sourcePanel);
  camera.setPanelOpen(false);
  const interaction=createTrackingInteraction({clock,isActive:()=>getAssembly()?.active===true,
    dispatch:input=>getAssembly()?.handleTrackingInput?.(input),
    onFocus:state=>{
      if(destroyed)return;
      cursor.hidden=!state.point||opened||calibrating;
      if(!state.point)return;
      cursor.style.left=`${state.point.x*100}%`;cursor.style.top=`${state.point.y*100}%`;
      cursor.style.setProperty('--progress',String(state.progress));cursor.dataset.source=state.source??'hand';
      cursor.dataset.held=String(state.held);cursor.dataset.target=String(Boolean(state.target));
      cursor.querySelector('span').textContent=state.target?.label??'';
    }});
  const eye=eyeFactory({now:clock,viewport:()=>({width:view.innerWidth,height:view.innerHeight}),
    onSample:sample=>interaction.handleGaze(sample),onStatus:state=>{eyeStatus=state;render();}});
  function configure(){
    const source=camera.getSnapshot().source;
    interaction.configure({enabled:!opened&&!calibrating&&!doc.hidden&&(source.kind!=='video-file'||replay.checked),
      arrange:mode.value==='arrange',gazePinch:gazePinch.checked&&eyes.checked,dwell:dwell.checked&&eyes.checked});
    getAssembly()?.setTrackingArrange?.(mode.value==='arrange');
    q('[data-he-guide]').textContent=mode.value==='arrange'
      ?'Pinch and move an unlocked object. Use two pinched hands to resize and turn it. Release to save; losing tracking cancels the move.'
      :'Open your hand first. Pinch over an object to use its original controls.';
  }
  function render(){
    if(destroyed)return;
    const state=camera.getSnapshot(), es=eyeStatus??{state:'disabled'}, running=state.state==='running';
    const fileSource=state.source.kind==='video-file';
    const startButton=doc.getElementById('hand-lens-enable');
    if(startButton)text(startButton,state.state==='requesting'?'Cancel startup':['running','paused'].includes(state.state)?'Stop source':fileSource?'Start video':'Start camera');
    const filePicker=doc.getElementById('hand-lens-file');if(filePicker)filePicker.hidden=!fileSource;
    const cameraPicker=doc.getElementById('hand-lens-camera-select');if(cameraPicker)cameraPicker.hidden=fileSource;
    const cameraRow=doc.getElementById('hand-lens-front')?.parentElement;if(cameraRow)cameraRow.hidden=fileSource;
    const handState=hands.checked?(state.handModel.state==='ready'?(observedHands?`${observedHands} in view`:'none in view'):state.handModel.state):'off';
    const statusText=running&&state.source.available!==false ? `${state.source.kind==='camera'?'Camera':'Local video'} active · hands ${handState} · eyes ${eyes.checked?es.state:'off'}`
      : state.state==='idle'?'Camera off · nothing is being tracked':state.diagnostic.message;
    text(q('[data-he-status]'),statusText);
    trigger.dataset.active=String(running);indicator.hidden=!running||calibrating;
    text(indicator.querySelector('[data-he-live-open]'),`${state.source.kind==='camera'?'Camera':'Video'} · ${hands.checked?'hands':''}${hands.checked&&eyes.checked?' + ':''}${eyes.checked?'eyes':''}${!hands.checked&&!eyes.checked?'preview':''}`);
    text(q('[data-he-eye-status]'),eyes.checked ? (es.state==='loading'?'Loading the local eye model…':friendly(es.reason)) : 'Turn on Eyes and start a camera to calibrate.');
    prop(q('[data-he-calibrate]'),'disabled',!eyes.checked||!running||state.source.available===false||!es.detectorReady||state.source.kind!=='camera');
    prop(q('[data-he-clear]'),'disabled',!eyes.checked);
    prop(gazePinch,'disabled',!eyes.checked||!hands.checked);prop(dwell,'disabled',!eyes.checked);
    q('[data-he-replay-row]').hidden=state.source.kind!=='video-file';
    const result=calibrationResult??es.calibration, metrics=result?.metrics;
    text(q('[data-he-accuracy]'),metrics
      ? `${result.accepted===false||result.status==='rejected'?'Retry needed':'Calibration check'} · RMS error ${Math.round(metrics.holdoutRmse*100)}% of normalized screen distance · worst ${Math.round(metrics.maxHoldoutError*100)}%. This is a setup check, not measured everyday accuracy.`
      : '');
    if(calibrating)renderTarget();
  }
  function close(){if(destroyed)return;opened=false;panel.hidden=true;camera.setPanelOpen(false);trigger.setAttribute('aria-expanded','false');configure();(previousFocus?.isConnected&&!previousFocus.closest?.('[hidden]')?previousFocus:trigger).focus?.();}
  function open(){if(destroyed||calibrating)return;previousFocus=doc.activeElement?.closest?.('#hands-eyes-calibration')?trigger:doc.activeElement;onOpen();opened=true;panel.hidden=false;camera.setPanelOpen(true);trigger.setAttribute('aria-expanded','true');configure();q('[data-he-close]').focus();render();}
  function stop(){if(calibrating)cancelCalibration();interaction.reset();camera.disable();eye.disable();calibrationResult=null;render();}
  function cancelCalibration(){calibrating=false;calibration.hidden=true;eye.clearCalibration();captureNote='';calibrationResult=null;open();}
  function renderTarget(){
    const target=TARGETS[targetIndex];if(!target)return;
    const dot=cq('.he-calibration-dot');dot.style.left=`${target.x*100}%`;dot.style.top=`${target.y*100}%`;
    // Keep instructions away from the target, including the bottom row.
    calibration.dataset.copyPosition=target.y>.6?'top':'bottom';
    cq('[data-he-step]').textContent=target.phase==='train'?`Learn ${targetIndex+1} of 9`:`Check ${targetIndex-8} of 5`;
    cq('[data-he-capture]').disabled=clock()-targetSince<1000;
    cq('[data-he-capture-note]').textContent=captureNote||'Keep looking at the dot. Press Space or tap Capture after a moment.';
  }
  function startCalibration(){
    if(q('[data-he-calibrate]').disabled)return;
    interaction.reset('calibrating');calibrationResult=null;eye.startCalibration();
    close();calibrating=true;opened=false;panel.hidden=true;calibration.hidden=false;indicator.hidden=true;
    targetIndex=0;targetSince=clock();captureNote='';configure();renderTarget();cq('[data-he-cancel]').focus();
  }
  function capture(){
    if(!calibrating||clock()-targetSince<1000)return;
    const result=eye.calibrationSample(TARGETS[targetIndex]);
    if(!result.accepted){captureNote=friendly(result.reason);renderTarget();return;}
    targetIndex++;captureNote='';targetSince=clock();
    if(targetIndex===TARGETS.length){calibrationResult=eye.finishCalibration();calibrating=false;calibration.hidden=true;open();render();}
    else renderTarget();
  }
  function onSource(state){
    const key=[state.source.id,state.source.mirrored,state.source.width,state.source.height].join(':');
    if(key!==lastSourceKey){interaction.reset('source-changed');calibrationResult=null;eye.clearCalibration();if(calibrating)cancelCalibration();lastSourceKey=key;replay.checked=false;configure();}
    if(state.state==='running'){if(eyes.checked)void eye.enable();}
    else {interaction.reset('source-stopped');if(lastRunning){eye.clearCalibration();calibrationResult=null;}if(!['requesting','paused'].includes(state.state))eye.disable();}
    lastRunning=state.state==='running';render();
  }
  unsubscribers.push(camera.onStateChange(onSource),camera.onVideoFrame(frame=>{if(eyes.checked&&!doc.hidden)void eye.processFrame(frame);}));
  session.setInteractionHandler(frame=>{
    const count=clock()-(frame.timestamp??0)<=350?(frame.hands?.length??0):0;
    lastHandSampleAt=clock();if(count!==observedHands){observedHands=count;render();}
    if(calibrating||opened||doc.hidden){interaction.cancel('controls-suspended');return true;}
    if(!hands.checked)return true;
    return interaction.handleHands(frame);
  });
  session.setOpenHandler(open);
  const events=[];
  const listen=(element,type,handler,options)=>{element.addEventListener(type,handler,options);events.push(()=>element.removeEventListener(type,handler,options));};
  listen(trigger,'click',()=>opened?close():open());listen(q('[data-he-close]'),'click',close);listen(q('[data-he-resume]'),'click',close);
  const phoneToolbar=doc.getElementById('gesture-input-toolbar');
  let phoneEntry=null;
  if(phoneToolbar){phoneEntry=doc.createElement('button');phoneEntry.type='button';phoneEntry.id='gesture-input-camera-tracking';phoneEntry.textContent='Camera hands & eyes';phoneEntry.title='Use a normal camera for hand tracking and calibrated gaze';phoneToolbar.prepend(phoneEntry);listen(phoneEntry,'click',open);}
  listen(q('[data-he-stop]'),'click',stop);listen(indicator.querySelector('[data-he-live-stop]'),'click',stop);listen(indicator.querySelector('[data-he-live-open]'),'click',open);
  listen(hands,'change',()=>{camera.setHandDetectionEnabled(hands.checked);configure();render();});
  listen(eyes,'change',()=>{if(eyes.checked&&camera.getState()==='running')void eye.enable();else eye.disable();calibrationResult=null;configure();render();});
  for(const el of [mode,gazePinch,dwell,replay])listen(el,'change',()=>{configure();render();});
  listen(q('[data-he-calibrate]'),'click',startCalibration);listen(q('[data-he-clear]'),'click',()=>{eye.clearCalibration();calibrationResult=null;interaction.reset();render();});
  listen(cq('[data-he-capture]'),'click',capture);listen(cq('[data-he-cancel]'),'click',cancelCalibration);
  listen(doc,'keydown',event=>{
    if(calibrating&&event.code==='Space'){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)capture();}
    if(event.key==='Escape'){if(calibrating){event.preventDefault();event.stopImmediatePropagation();cancelCalibration();}else if(opened){event.preventDefault();event.stopImmediatePropagation();close();}else if(interaction.snapshot().held){event.preventDefault();event.stopImmediatePropagation();interaction.cancel('escape');}}
    // Keep keyboard focus inside the calibration modal.
    if(calibrating&&event.key==='Tab'){event.preventDefault();event.stopImmediatePropagation();const captureButton=cq('[data-he-capture]'),cancelButton=cq('[data-he-cancel]');(doc.activeElement===captureButton||captureButton.disabled?cancelButton:captureButton).focus();}
  },true);
  listen(doc,'visibilitychange',()=>{interaction.reset('visibility-changed');configure();});
  listen(view,'resize',()=>{interaction.reset('viewport-changed');eye.clearCalibration();calibrationResult=null;if(calibrating)cancelCalibration();render();});
  const timer=view.setInterval(()=>{interaction.tick();if(observedHands&&clock()-lastHandSampleAt>350){observedHands=0;render();}if(calibrating)renderTarget();},120);
  render();configure();
  return {open,close,stop,
    getSnapshot:()=>({available:true,opened,calibrating,targetIndex,observedHands,camera:camera.getSnapshot(),eyes:eye.getSnapshot(),interaction:interaction.snapshot()}),
    destroy(){if(destroyed)return;stop();destroyed=true;view.clearInterval(timer);for(const unsubscribe of unsubscribers)unsubscribe?.();for(const remove of events)remove();session.setInteractionHandler(null);session.setOpenHandler(null);eye.destroy();for(const el of [trigger,panel,cursor,indicator,calibration,style,phoneEntry])el?.remove();},
  };
}
