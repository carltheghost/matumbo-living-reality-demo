import test from 'node:test';
import assert from 'node:assert/strict';
import {mountHandsEyesControls} from '../src/render/hands-eyes-controls.js';

// Only the DOM behaviors used by this owner are stubbed. The real controller
// and real hand/gaze arbitration run together; no camera/model/GPU is acquired.
function eventTarget() {
  const listeners=new Map();
  return {
    addEventListener(type,fn,options=false){const capture=options===true||options?.capture===true;const rows=listeners.get(type)??[];rows.push({fn,capture});listeners.set(type,rows);},
    removeEventListener(type,fn){listeners.set(type,(listeners.get(type)??[]).filter(row=>row.fn!==fn));},
    dispatch(type,fields={}){
      const event={target:this,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...fields};
      const rows=[...(listeners.get(type)??[])].sort((a,b)=>Number(b.capture)-Number(a.capture));
      for(const row of rows){row.fn(event);if(event.stopped)break;}
      return event;
    },
  };
}
function makeDocument() {
  const doc={...eventTarget(),hidden:false,activeElement:null};
  const view={...eventTarget(),innerWidth:390,innerHeight:844,intervals:new Map(),serial:0,
    setInterval(fn){const id=++this.serial;this.intervals.set(id,fn);return id;},clearInterval(id){this.intervals.delete(id);}};
  doc.defaultView=view;
  const matches=(el,selector)=>{
    if(selector==='[hidden]')return el.hidden;
    if(selector.startsWith('#'))return el.id===selector.slice(1);
    if(selector.startsWith('.'))return el.className.split(/\s+/).includes(selector.slice(1));
    const attr=/^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if(attr)return Object.hasOwn(el.attributes,attr[1])&&(attr[2]===undefined||el.attributes[attr[1]]===attr[2]);
    return el.tagName===selector.toUpperCase();
  };
  doc.createElement=tag=>{
    const el={...eventTarget(),ownerDocument:doc,tagName:tag.toUpperCase(),children:[],parentElement:null,
      style:{setProperty(name,value){this[name]=String(value);}},dataset:{},attributes:{},className:'',id:'',textContent:'',hidden:false,disabled:false,checked:false,value:'',
      get isConnected(){return this===doc.body||this===doc.head||Boolean(this.parentElement?.isConnected);},
      append(...children){for(const child of children){child.remove();child.parentElement=this;this.children.push(child);}},
      prepend(child){child.remove();child.parentElement=this;this.children.unshift(child);},
      remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}},
      setAttribute(name,value){this.attributes[name]=String(value);if(name==='id')this.id=String(value);if(name==='class')this.className=String(value);if(name==='value')this.value=String(value);if(['hidden','checked','disabled'].includes(name))this[name]=true;if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);},
      getAttribute(name){return this.attributes[name]??null;},
      closest(selector){for(let current=this;current;current=current.parentElement)if(matches(current,selector))return current;return null;},
      querySelector(selector){return this.querySelectorAll(selector)[0]??null;},
      querySelectorAll(selector){const result=[];const visit=node=>{for(const child of node.children){if(matches(child,selector))result.push(child);visit(child);}};visit(this);return result;},
      focus(){doc.activeElement=this;},click(){if(!this.disabled)this.dispatch('click');},
    };
    Object.defineProperty(el,'innerHTML',{set(html){
      for(const child of [...el.children])child.remove();const stack=[el],voids=new Set(['INPUT','LINK','BR','HR','IMG']);
      for(const match of html.matchAll(/<\/?[a-z][^>]*>/gi)){
        const token=match[0];if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}
        const name=/^<([a-z][a-z0-9-]*)/i.exec(token)[1],child=doc.createElement(name);
        const attrs=token.slice(name.length+1,-1);
        for(const attr of attrs.matchAll(/([^\s=/>]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))child.setAttribute(attr[1],attr[2]??attr[3]??attr[4]??'');
        const parent=stack.at(-1);parent.append(child);
        if(child.tagName==='OPTION'&&parent.tagName==='SELECT'&&!parent.value)parent.value=child.value;
        if(!voids.has(child.tagName)&&!token.endsWith('/>'))stack.push(child);
      }
    }});
    return el;
  };
  doc.body=doc.createElement('body');doc.head=doc.createElement('head');
  doc.getElementById=id=>doc.body.querySelector(`#${id}`)??doc.head.querySelector(`#${id}`);
  return doc;
}
function fixture() {
  const doc=makeDocument(),calls=[],stats={cameraEnabled:0,cameraDisabled:0,eyeEnabled:0,eyeDisabled:0,eyeDestroyed:0,calibrationCleared:0,processedFrames:[],captures:[],detection:[]};
  let now=0,state='idle',source={kind:'camera',id:'camera-a',mirrored:true,width:640,height:480},handDetection=true;
  let interactionHandler=null,openHandler=null,eyeCallbacks;
  const stateSubscribers=new Set(),frameSubscribers=new Set();
  const sourcePanel=doc.createElement('aside');sourcePanel.id='hand-lens-panel';sourcePanel.hidden=true;
  const video=doc.createElement('video');sourcePanel.append(video);doc.body.append(sourcePanel);
  const camera={
    getSnapshot:()=>({state,source:{...source},handModel:{state:handDetection?'ready':'disabled'},diagnostic:{message:'Camera source stopped'}}),getState:()=>state,
    getPanelElement:()=>sourcePanel,setPanelOpen(open){sourcePanel.hidden=!open;},
    enable(){stats.cameraEnabled++;state='running';this.publish();},
    disable(){stats.cameraDisabled++;state='idle';this.publish();},
    setHandDetectionEnabled(value){handDetection=value;stats.detection.push(value);this.publish();},
    onStateChange(fn){stateSubscribers.add(fn);return ()=>stateSubscribers.delete(fn);},
    onVideoFrame(fn){frameSubscribers.add(fn);return ()=>frameSubscribers.delete(fn);},
    publish(patch={}){if(patch.state)state=patch.state;if(patch.source)source={...source,...patch.source};for(const fn of stateSubscribers)fn(this.getSnapshot());},
    frame(){const frame={video,timestamp:now,source:{...source}};for(const fn of frameSubscribers)fn(frame);return frame;},
  };
  const session={getCamera:()=>camera,setInteractionHandler(fn){interactionHandler=fn;},setOpenHandler(fn){openHandler=fn;}};
  let eyeState={state:'disabled',detectorReady:false,reason:'eyes-disabled',calibration:{status:'uncalibrated',metrics:null}};
  const eyeFactory=callbacks=>{
    eyeCallbacks=callbacks;
    const notify=()=>callbacks.onStatus({...eyeState});
    return {
      enable(){stats.eyeEnabled++;eyeState={...eyeState,state:'ready',detectorReady:true,reason:'calibration-needed'};notify();return Promise.resolve();},
      disable(){stats.eyeDisabled++;eyeState={...eyeState,state:'disabled',detectorReady:false,reason:'eyes-disabled'};notify();},
      getSnapshot:()=>({...eyeState}),processFrame(frame){stats.processedFrames.push(frame);return Promise.resolve();},
      clearCalibration(){stats.calibrationCleared++;eyeState={...eyeState,calibration:{status:'uncalibrated',metrics:null}};callbacks.onSample({valid:false,reason:'calibration-needed',timestamp:now});notify();},
      startCalibration(){eyeState={...eyeState,reason:'calibration-started'};notify();return {accepted:true};},
      calibrationSample(target){stats.captures.push({...target});return {accepted:true};},
      finishCalibration(){const calibration={accepted:true,status:'calibrated',metrics:{holdoutRmse:.03,maxHoldoutError:.05}};eyeState={...eyeState,calibration};notify();return calibration;},
      destroy(){stats.eyeDestroyed++;},
    };
  };
  const target={kind:'space',id:'agents',label:'Agents',controlActionability:false,dwellAllowed:true};
  const assembly={active:true,arrange:false,hover:null,
    setTrackingArrange(value){this.arrange=value;},
    handleTrackingInput(input){calls.push(input);if(typeof input.arrange==='boolean')this.arrange=input.arrange;this.hover=input.type==='cancel'?null:target;return {handled:this.active,target:this.hover};},
  };
  const controls=mountHandsEyesControls({session,getAssembly:()=>assembly,documentRoot:doc,eyeFactory,clock:()=>now});
  const panel=doc.getElementById('hands-eyes-panel'),q=name=>panel.querySelector(`[data-he-${name}]`);
  const change=(name,value)=>{const el=q(name);if(el.tagName==='SELECT')el.value=value;else el.checked=value;el.dispatch('change');};
  const hands=(events=[],names=['Left'])=>interactionHandler({timestamp:now,source:{...source},hands:names.map(handedness=>({handedness,landmarks:Array.from({length:21},()=>({x:.4,y:.4}))})),lensEvents:events});
  const pinch=(type,x=.4,y=.4)=>({type,hand:'Left',x,y});
  return {doc,camera,assembly,controls,calls,stats,sourcePanel,video,q,change,hands,pinch,setNow:value=>{now=value;},
    gaze(point={x:.5,y:.5}){eyeCallbacks.onSample({valid:true,point,timestamp:now});},tick(){for(const fn of doc.defaultView.intervals.values())fn();},
    get handlers(){return {interactionHandler,openHandler};},get subscriptions(){return {state:stateSubscribers.size,frames:frameSubscribers.size};},
  };
}

test('mounting and opening controls reuse one original source panel without starting a camera or model',()=>{
  const f=fixture();
  try{
    assert.equal(f.stats.cameraEnabled,0);assert.equal(f.stats.eyeEnabled,0);assert.equal(f.controls.getSnapshot().opened,false);
    assert.equal(f.q('camera').children[0],f.sourcePanel);assert.equal(f.sourcePanel.querySelector('video'),f.video);
    assert.equal(f.doc.body.querySelectorAll('video').length,1);assert.equal(f.sourcePanel.hidden,true);
    f.controls.open();assert.equal(f.controls.getSnapshot().opened,true);assert.equal(f.sourcePanel.hidden,false);
    assert.equal(f.stats.cameraEnabled,0);assert.equal(f.stats.eyeEnabled,0);
    assert.equal(f.q('calibrate').disabled,true);
  }finally{f.controls.destroy();}
});

test('closing the settings keeps the shared camera running and tracking, while reopening cancels a held interaction',()=>{
  const f=fixture();
  try{
    f.camera.publish({state:'running'});f.controls.open();f.controls.close();
    assert.equal(f.stats.cameraDisabled,0);assert.equal(f.camera.getState(),'running');
    f.hands();f.hands([f.pinch('pinchstart')]);f.hands([f.pinch('pinchmove',.5,.5)]);
    assert.equal(f.controls.getSnapshot().interaction.held,'Left');assert.equal(f.doc.getElementById('hands-eyes-cursor').hidden,false);
    f.controls.open();assert.equal(f.controls.getSnapshot().interaction.held,null);assert.equal(f.calls.at(-1).type,'cancel');
    const before=f.calls.filter(row=>row.type==='down').length;f.hands([f.pinch('pinchstart')]);
    assert.equal(f.calls.filter(row=>row.type==='down').length,before,'the panel cannot control objects behind itself');
    assert.equal(f.doc.getElementById('hands-eyes-cursor').hidden,true);assert.equal(f.stats.cameraDisabled,0);
  }finally{f.controls.destroy();}
});

test('eyes-only tracking disables hand detection but consumes the same camera video and never acquires another source',()=>{
  const f=fixture();
  try{
    f.camera.publish({state:'running'});f.change('hands',false);f.change('eyes',true);
    assert.deepEqual(f.stats.detection,[false]);assert.equal(f.stats.cameraEnabled,0);assert.ok(f.stats.eyeEnabled>0);
    const frame=f.camera.frame();assert.equal(f.stats.processedFrames[0],frame);assert.equal(frame.video,f.video);
    f.gaze();assert.equal(f.calls.at(-1).source,'gaze');assert.equal(f.calls.at(-1).type,'hover');
    const before=f.calls.length;assert.equal(f.hands([f.pinch('pinchstart')]),true);assert.equal(f.calls.length,before);
    f.controls.open();f.controls.close();assert.equal(f.stats.cameraDisabled,0);
  }finally{f.controls.destroy();}
});

test('recorded gestures require explicit replay opt-in and a new source invalidates that choice',()=>{
  const f=fixture();
  try{
    f.camera.publish({state:'running',source:{kind:'video-file',id:'file-a'}});assert.equal(f.q('replay').checked,false);
    f.hands();f.hands([f.pinch('pinchstart')]);assert.equal(f.calls.some(row=>row.type==='down'),false);
    f.change('replay',true);f.hands();f.hands([f.pinch('pinchstart')]);assert.equal(f.controls.getSnapshot().interaction.held,'Left');
    const before=f.calls.filter(row=>row.type==='down').length;f.camera.publish({source:{id:'file-b'}});
    assert.equal(f.q('replay').checked,false);assert.equal(f.controls.getSnapshot().interaction.held,null);assert.equal(f.controls.getSnapshot().interaction.enabled,false);
    f.hands();f.hands([f.pinch('pinchstart')]);assert.equal(f.calls.filter(row=>row.type==='down').length,before);
  }finally{f.controls.destroy();}
});

test('an acquired camera without available frames cannot start gaze calibration',()=>{
  const f=fixture();
  try{
    f.camera.publish({state:'running',source:{available:false,playing:false}});
    f.change('eyes',true);
    assert.equal(f.q('calibrate').disabled,true);
    assert.equal(f.q('status').textContent,'Camera source stopped');
    f.camera.publish({source:{available:true,playing:true}});
    assert.equal(f.q('calibrate').disabled,false);
    assert.match(f.q('status').textContent,/Camera active/);
  }finally{f.controls.destroy();}
});

test('an unarmed recorded video is consumed even when Assembly is inactive, preventing legacy control fallthrough',()=>{
  const f=fixture();
  try{
    f.assembly.active=false;
    f.camera.publish({state:'running',source:{kind:'video-file',id:'file-a'}});
    assert.equal(f.hands(),true);
    assert.equal(f.hands([f.pinch('pinchstart')]),true);
    assert.equal(f.hands([f.pinch('pinchend')]),true);
    assert.equal(f.calls.some(row=>['down','up','activate'].includes(row.type)),false);
    assert.equal(f.controls.getSnapshot().interaction.held,null);
  }finally{f.controls.destroy();}
});

test('the explicit Arrange setting reaches the original owner immediately, including while the panel is open',()=>{
  const f=fixture();
  try{
    f.controls.open();f.change('mode','arrange');
    assert.equal(f.assembly.arrange,true);assert.equal(f.controls.getSnapshot().interaction.arrange,true);
    f.controls.close();assert.equal(f.assembly.arrange,true);f.change('mode','interact');assert.equal(f.assembly.arrange,false);
  }finally{f.controls.destroy();}
});

test('hand loss and a stalled stream clear the original owner highlight as well as the cursor',()=>{
  const f=fixture();
  try{
    f.camera.publish({state:'running'});f.hands();assert.equal(f.assembly.hover?.id,'agents');
    f.hands([],[]);assert.equal(f.assembly.hover,null);assert.equal(f.doc.getElementById('hands-eyes-cursor').hidden,true);
    f.hands();assert.equal(f.assembly.hover?.id,'agents');f.setNow(701);f.tick();assert.equal(f.assembly.hover,null);
    const count=f.calls.length;f.tick();assert.equal(f.calls.length,count,'a stale source clears the owner once');
  }finally{f.controls.destroy();}
});

test('calibration checks all nine learning and five validation targets, reports its error and resumes through explicit settings',()=>{
  const f=fixture();
  try{
    f.camera.publish({state:'running'});f.change('eyes',true);f.controls.open();f.q('calibrate').click();
    assert.equal(f.controls.getSnapshot().calibrating,true);assert.equal(f.controls.getSnapshot().interaction.enabled,false);
    assert.equal(f.stats.cameraDisabled,0);f.camera.frame();assert.equal(f.stats.processedFrames.length,1,'calibration continues receiving the original camera');
    for(let index=0;index<14;index++){f.setNow((index+1)*1100);f.doc.dispatch('keydown',{key:' ',code:'Space',repeat:false});}
    assert.equal(f.stats.captures.length,14);assert.equal(f.stats.captures.filter(target=>target.phase==='train').length,9);assert.equal(f.stats.captures.filter(target=>target.phase==='validate').length,5);
    assert.equal(f.controls.getSnapshot().calibrating,false);assert.equal(f.controls.getSnapshot().opened,true);
    assert.match(f.q('accuracy').textContent,/RMS error 3%.*worst 5%/);assert.equal(f.controls.getSnapshot().interaction.enabled,false);
    f.controls.close();assert.equal(f.controls.getSnapshot().interaction.enabled,true);
  }finally{f.controls.destroy();}
});

test('mirror, dimensions and source identity changes cancel held previews and invalidate calibration',()=>{
  for(const source of [{mirrored:false},{width:1280},{id:'camera-b'}]){
    const f=fixture();
    try{
      f.camera.publish({state:'running'});f.change('eyes',true);f.hands();f.hands([f.pinch('pinchstart')]);
      const cleared=f.stats.calibrationCleared;f.camera.publish({source});
      assert.equal(f.controls.getSnapshot().interaction.held,null);assert.ok(f.stats.calibrationCleared>cleared);
      f.controls.open();f.q('calibrate').click();assert.equal(f.controls.getSnapshot().calibrating,true);
      f.camera.publish({source:{id:'replacement'}});assert.equal(f.controls.getSnapshot().calibrating,false);assert.equal(f.controls.getSnapshot().opened,true);
    }finally{f.controls.destroy();}
  }
});

test('Escape is captured before legacy world shortcuts, and hidden pages cancel interactions without processing frames',()=>{
  const f=fixture();let legacyEscape=0;
  f.doc.addEventListener('keydown',()=>legacyEscape++);
  try{
    f.controls.open();const event=f.doc.dispatch('keydown',{key:'Escape'});
    assert.equal(event.defaultPrevented,true);assert.equal(legacyEscape,0);assert.equal(f.controls.getSnapshot().opened,false);
    f.camera.publish({state:'running'});f.change('eyes',true);f.hands();f.hands([f.pinch('pinchstart')]);
    f.doc.hidden=true;f.doc.dispatch('visibilitychange');assert.equal(f.controls.getSnapshot().interaction.held,null);assert.equal(f.controls.getSnapshot().interaction.enabled,false);
    f.camera.frame();assert.equal(f.stats.processedFrames.length,0);assert.equal(f.hands([f.pinch('pinchmove')]),true);
    f.doc.hidden=false;f.doc.dispatch('visibilitychange');assert.equal(f.controls.getSnapshot().interaction.enabled,true);
  }finally{f.controls.destroy();}
});

test('the shared stop control releases both models, clears held input and teardown removes subscriptions and hooks',()=>{
  const f=fixture();
  f.camera.publish({state:'running'});f.change('eyes',true);f.hands();f.hands([f.pinch('pinchstart')]);
  f.doc.getElementById('hands-eyes-live').querySelector('[data-he-live-stop]').click();
  assert.equal(f.stats.cameraDisabled,1);assert.ok(f.stats.eyeDisabled>0);assert.equal(f.controls.getSnapshot().interaction.held,null);
  assert.equal(f.camera.getState(),'idle');assert.equal(f.doc.getElementById('hands-eyes-live').hidden,true);
  f.controls.destroy();assert.deepEqual(f.subscriptions,{state:0,frames:0});assert.deepEqual(f.handlers,{interactionHandler:null,openHandler:null});
  assert.equal(f.stats.eyeDestroyed,1);assert.equal(f.doc.defaultView.intervals.size,0);assert.equal(f.doc.getElementById('hands-eyes-panel'),null);
});
