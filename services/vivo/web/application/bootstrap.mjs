import {Renderer,embed} from '/render.js';
import {Camera} from '/camera.js';
import {GripHost} from '/services/vivo/web/authority/grip-host.mjs';
import {LocalTransport,requestJSON} from './transport.mjs';
import {ApplicationInputs} from './interactions.mjs';
import {eventTime,frameOf,screenTarget,viewBasis,viewAngles,projectAccepted,timestampedCameraClass} from './adapters.mjs';

const $=id=>document.getElementById(id),copy=structuredClone;
const renderer=new Renderer($('world'),$('overlay'));
const previews=new Map(),grids=new Map(),densityCache=new Map();
let transport=null,host=null,inputs=null,state=null,selected=null,poll=null,densityPoll=null,densityRequest=0,online=false,viewTail=Promise.resolve();
let orbit=null,hand=null,rendering=true,readOnlySeen=false,connectionGeneration=0,connecting=false;
const sessionOnly=document.documentElement.dataset.vivoStore==='memory';
const acceptedPreview=document.documentElement.dataset.vivoStage==='accepted-preview';
const acceptedLabel=acceptedPreview?(document.documentElement.dataset.vivoPhase==='true'?'ACCEPTED PHASE PREVIEW · ':'ACCEPTED BACKEND PREVIEW · '):'';
const scopeLabel=sessionOnly?'SESSION ONLY':'LOCAL SAVED';
const say=text=>{$('status').textContent=text;};
const safe=fn=>async(...args)=>{try{return await fn(...args);}catch(error){say(error.message||String(error));return null;}};
const saved=()=>{try{return JSON.parse(sessionStorage.getItem('vivo.local.session'));}catch{return null;}};
function remember(value){try{if(value)sessionStorage.setItem('vivo.local.session',JSON.stringify(value));else sessionStorage.removeItem('vivo.local.session');}catch{}}
const element=(tag,properties)=>Object.assign(document.createElement(tag),properties);

// Existing application controls are reused, with unsupported paths removed from this mode.
$('displayName').closest('label').hidden=true;
$('spaceKind').closest('.row').hidden=true;
$('metricInputLabel').hidden=true;$('keyLabel').hidden=true;$('joinRoom').hidden=true;
$('inviteNote').textContent=sessionOnly
  ?'Two local seats on this computer. SESSION ONLY: accepted state lasts only while this local server process runs; no backend world/checkpoint/database file is written. Camera stays off.'
  :'Two local seats on this computer. This is local host admission, not remote person authentication. Camera stays off.';
const seatLabel=element('label',{textContent:'Your local seat'}),seat=element('select',{id:'localSeat'});
seat.append(element('option',{value:'one',textContent:'Seat one'}),element('option',{value:'two',textContent:'Seat two'}));
seat.value=saved()?.seat||new URL(location.href).searchParams.get('seat')||'one';seatLabel.append(seat);
$('createRoom').before(seatLabel);
$('welcome').querySelector('a').href='/local/';$('welcome').querySelector('a').textContent='Full Studio (primary) ↗';
$('welcome').querySelectorAll('p.muted').forEach(e=>{if(e!==$('inviteNote'))e.hidden=true;});
$('createRoom').textContent=sessionOnly?'Open session-only seat':'Open local seat';
document.querySelector('[data-panel="neural"]').hidden=true;
document.querySelector('[data-panel="people"]').textContent='♧ Local seats';
document.querySelector('[data-panel="record"]').textContent=sessionOnly?'↧ Session state':'↧ Saved state';
$('moveTarget').options[0].textContent='Grip target (material driver pending)';
const moveSheet=document.querySelector('[data-sheet="move"]');
moveSheet.querySelector('p').textContent='Drag a relic or use an axis to set an accepted grip target. Dashed targets are constraints. The solid relic remains at its accepted material coordinates until a real material driver is connected.';
moveSheet.querySelector('p.muted').textContent='This mode supports an explicit flat 4D workshop and its mapped 11D nested space. Time is separate and the material clock is paused.';
const enterButton=element('button',{id:'enterSpace',textContent:'Enter selected inner space'}),exitButton=element('button',{id:'exitSpace',textContent:sessionOnly?'Return to session outer Eye':'Return to saved outer Eye'});
moveSheet.append(enterButton,exitButton);
const eyeSheet=document.querySelector('[data-sheet="eye"]');
eyeSheet.querySelector('p').textContent=sessionOnly
  ?'Your accepted Eye coordinates, basis, slice and nested return frame live independently in this server process. They are discarded when it stops.'
  :'Your accepted Eye coordinates, basis, slice and nested return frame are saved independently. Looking never moves another seat or the relic.';
$('homeView').textContent='Reset own Eye view';
const peopleSheet=document.querySelector('[data-sheet="people"]');
for(const id of['inviteRole','makeInvite','inviteLink','copyInvite','revokeInvites']){$(id).hidden=true;if(id==='inviteRole')$(id).closest('label').hidden=true;}
peopleSheet.querySelector('p.muted').textContent=sessionOnly
  ?'Open a second tab and choose the other seat. Each seat has an independent Eye in this process. Tab-scoped session tokens are not durable and become invalid after restart; remote sharing is not enabled.'
  :'Open a second tab and choose the other seat. Each seat has a separate saved Eye. A reload rotates its session and releases old grips. Remote sharing is not enabled.';
peopleSheet.querySelector('a').href='/local/';peopleSheet.querySelector('a').textContent='Full Studio (primary) ↗';
const recordSheet=document.querySelector('[data-sheet="record"]');
for(const child of[...recordSheet.children])child.hidden=true;
const saveButton=element('button',{id:'saveLocal',textContent:'Verify saved checkpoint'}),exportButton=element('button',{id:'exportLocal',textContent:sessionOnly?'Download accepted session JSON':'Export accepted state JSON'}),reconcileButton=element('button',{id:'reconcileLocal',textContent:'Reconcile uncertain grips'});
if(!sessionOnly)recordSheet.append(saveButton);
recordSheet.append(exportButton,reconcileButton,element('p',{id:'journalState',className:'muted'}),element('p',{className:'muted',textContent:sessionOnly
  ?'SESSION ONLY: accepted state, Eyes, leases and phase checkpoints live only in this local server process. This download is a user-requested export, not durable storage or an import/reload path. Browser/sessionStorage tokens are tab-scoped and not backend world storage. No camera frames or session tokens are exported.'
  :'Every accepted operation is atomically saved on this computer. This export is state evidence, not a replay/import feature. The bounded journal becomes read-only before cleanup capacity runs out. No camera frames or session tokens are exported.'}));
const phaseButton=element('button',{id:'runPhase',textContent:'Run experimental 4D phase'});phaseButton.hidden=true;recordSheet.append(phaseButton);
const capability=element('div',{id:'localCapabilities',textContent:acceptedLabel+(sessionOnly?'SESSION ONLY · volatile server memory · no backend world/checkpoint/database file':'LOCAL ONLY · material motion / learning pending')});
const densityPanel=element('div',{id:'phaseDensity',hidden:true,role:'status','aria-live':'polite'});
document.body.append(capability);
document.body.append(densityPanel);

function currentEntity(){return state?.snapshot.spaces[state.eye.spaceId].entities[selected];}
async function gridFor(d){if(!grids.has(d))grids.set(d,await requestJSON('/api/local/grid?dimension='+d));return grids.get(d);}
function receive(next){
  const generation=connectionGeneration;
  const priorSpace=state?.eye.spaceId;state=next;online=true;
  if(!next.snapshot.spaces[next.eye.spaceId].entities[selected])selected=Object.keys(next.snapshot.spaces[next.eye.spaceId].entities)[0];
  renderer.actor=transport?.session?.actorId;renderer.selected=selected;
  const apply=()=>{if(generation!==connectionGeneration||!state)return;const grid=grids.get(state.eye.dimension);if(!grid)return;
    renderer.grid=grid;renderer.state=projectAccepted(state,grid);renderer.slice=state.eye.q.slice();
    for(const[k,v]of Object.entries(state.eye.slice))renderer.slice[Number(k.slice(1))-1]=v;
    renderer.origin=embed(state.eye.q,renderer.state.geometry,state.eye.chart);
    if(!orbit){const angles=viewAngles(state.eye.basis);renderer.yaw=angles.yaw;renderer.pitch=angles.pitch;}
  };
  if(grids.has(next.eye.dimension))apply();else void gridFor(next.eye.dimension).then(apply).catch(e=>{if(generation===connectionGeneration)say(e.message);});
  if(priorSpace!==next.eye.spaceId)configureAxes();
  updateUI();
  if(next.eye.spaceId!=='root'){renderer.setDensity(null);updateDensityPanel(null);}
  else if(renderer.densityMeta?.materialDigest&&renderer.densityMeta.materialDigest!==next.snapshot?.spaces?.root?.field?.hash){densityPanel.hidden=false;densityPanel.textContent='LAST ACCEPTED FIELD DENSITY · '+renderer.densityMeta.entityId+' · awaiting committed sample';}
  if(next.journal?.readOnly&&!readOnlySeen){readOnlySeen=true;void cancelAll('journal-read-only').catch(e=>say(e.message));say(sessionOnly?'Session journal is read-only; download the current process state.':'Journal is read-only. Saved state is intact; export it. New editing needs a reviewed journal continuation.');}
}
function configureAxes(){if(!state)return;for(const id of['moveAxis','sliceAxis']){$(id).replaceChildren();for(let a=id==='sliceAxis'?3:0;a<state.eye.dimension;a++)$(id).append(element('option',{value:String(a),textContent:'x'+(a+1)}));$(id).disabled=!$(id).options.length;}const axis=+$('sliceAxis').value;$('sliceValue').value=String(state.eye.slice['x'+(axis+1)]||0);}
function updateUI(){
  if(!state)return;const e=currentEntity();
  $('connection').textContent=(online?scopeLabel:'DISCONNECTED')+' · '+(seat.value==='one'?'seat one':'seat two');
  $('worldName').textContent=state.eye.spaceId==='root'?(sessionOnly?'Local session · shared accepted state':'Local workshop · shared accepted state'):(sessionOnly?'Inside the relic · session Eye':'Inside the relic · saved nested space');
  $('dimensionBadge').textContent=state.eye.dimension+' spatial axes + separate time';
  $('geometryBadge').textContent='Flat · '+state.eye.spaceId+' · Eye r'+state.eye.revision;
  $('selection').hidden=!e;if(e){$('selectedName').textContent=e.name||e.id;$('selectedCoords').textContent=e.q.map((v,i)=>'x'+(i+1)+' '+v.toFixed(2)).join(' · ');}
  enterButton.disabled=!e?.innerSpaceId||!!state.journal?.readOnly;exitButton.disabled=!state.eye.stack.length||!!state.journal?.readOnly;
  $('peopleList').replaceChildren();for(const person of state.participants||[])$('peopleList').append(element('p',{textContent:(person.actorId||person.id||person.seat)+' · '+(person.online?'online':'offline')+(person.actorId===transport?.session?.actorId?' (you)':'')}));
  $('journalState').textContent=(sessionOnly?'Session sequence ':'Accepted sequence ')+state.snapshot.acceptedSequence+' · '+JSON.stringify(state.journal);
  $('metrics').textContent='Camera '+(camera.stream?'on, local only':'off')+' · no microphone · no frame uploads · '+(sessionOnly?'session-only server memory; no backend world/checkpoint/database file':'accepted sequence '+state.snapshot.acceptedSequence);
  const phase=state.capabilities?.material;
  phaseButton.hidden=!phase;phaseButton.disabled=connecting||!online||!!state.journal?.readOnly||!!transport?.session?.readOnly;
  if(phase){
    const phaseRunning=phase.running&&state.materialHost?.running!==false;
    phaseButton.disabled=phaseButton.disabled||!!state.materialHost?.fault;
    phaseButton.textContent=(phaseRunning?'Pause':'Run')+' experimental 4D phase';
    $('moveTarget').options[0].textContent='Finite compliant phase target';
    moveSheet.querySelector('p').textContent='Dashed targets are accepted constraints. Solid relics mark the accepted density centroids of real 4D phase fields; they are not liquid surfaces. Phase targets must stay within −4 ≤ x < 4 on each axis.';
    moveSheet.querySelector('p.muted').textContent='Root: periodic 4D phase, 8 samples per axis. Nested 11D material is unavailable. Run/Pause is shared by both seats; each Eye stays independent. Numerical fidelity and learning remain experimental/unimplemented.';
    const diag=state.materialDiagnostics?.diagnostics;
    $('metrics').textContent+=' · simulation t='+state.snapshot.simulationTime.toFixed(3)+' · '+(phaseRunning?'running: at most 0.02 s per 0.5 wall s':'paused')+(diag?' · mass '+diag.mass.toFixed(8)+' · energy '+diag.energy.toFixed(5)+' · residual '+diag.residual.toExponential(2):'');
    if(state.materialHost?.fault)$('metrics').textContent+=' · phase stopped: '+state.materialHost.fault.code;
  }
  if(sessionOnly) capability.textContent=acceptedLabel+(state.journal?.readOnly
    ?'SESSION ONLY · process journal read-only · download available'
    :'SESSION ONLY · volatile server memory · '+(phase?'experimental 4D phase centroids · ':'accepted constraints · ')+'no backend world/checkpoint/database file');
  else capability.textContent=acceptedLabel+(state.journal?.readOnly?'READ ONLY · saved history preserved':phase?'LOCAL · experimental 4D phase centroids · '+(state.eye.dimension===4?'learning unavailable':'11D material unavailable'):'LOCAL ONLY · accepted constraints; material motion / learning pending');
}
function updateDensityPanel(observation){
  if(!observation||state?.eye?.spaceId!=='root'||state?.capabilities?.material?.profile!=='phase'){
    densityPanel.hidden=true;densityPanel.textContent='';return;
  }
  const shape=Array.isArray(observation.shape)?observation.shape.join('×'):'8×8';
  densityPanel.hidden=false;densityPanel.textContent='ACCEPTED FIELD DENSITY · '+observation.entityId+' · x1/x2 slice · '+shape+' · sequence '+observation.acceptedSequence+' · tick '+observation.tick;
}
function densityKey(){
  if(!state?.capabilities?.material||state.eye.spaceId!=='root'||state.eye.dimension!==4||!selected)return null;
  const fieldHash=state.snapshot?.spaces?.root?.field?.hash||'unknown';
  return selected+'|0,1|'+fieldHash+'|'+JSON.stringify([state.eye.slice?.x3??0,state.eye.slice?.x4??0]);
}
async function refreshDensity(generation,client){
  if(generation!==connectionGeneration||transport!==client||client.closed)return;
  const key=densityKey();
  if(!key){renderer.setDensity(null);updateDensityPanel(null);return;}
  const cached=densityCache.get(key);
  if(cached){renderer.setDensity(cached);updateDensityPanel(cached);densityPoll=setTimeout(()=>refreshDensity(generation,client),1000);return;}
  const request=++densityRequest;
  try{
    const observation=await client.observeMaterial(selected,[0,1]);
    if(generation===connectionGeneration&&transport===client&&request===densityRequest&&densityKey()===key&&observation?.entityId===selected&&observation?.materialDigest===state.snapshot?.spaces?.root?.field?.hash){
      if(renderer.setDensity(observation)){
        densityCache.set(key,observation);while(densityCache.size>8)densityCache.delete(densityCache.keys().next().value);
        updateDensityPanel(observation);
      }else updateDensityPanel(null);
    }
  }catch(error){
    if(generation===connectionGeneration&&transport===client&&densityKey()===key&&!renderer.densityMeta)updateDensityPanel(null);
  }
  if(generation===connectionGeneration&&transport===client&&!client.closed)densityPoll=setTimeout(()=>refreshDensity(generation,client),1000);
}
async function connect(){
  if(connecting)return;connecting=true;$('createRoom').disabled=true;
  let generation;
  try{
    if(transport?.session&&!transport.closed)await disconnect();
    generation=++connectionGeneration;readOnlySeen=false;
    const previous=saved();let client;client=new LocalTransport({onState:next=>{if(generation===connectionGeneration&&transport===client)receive(next);}});transport=client;
    let result;try{result=await client.admit(seat.value,previous?.seat===seat.value?previous.token:undefined);}catch(error){if(error.code==='JOURNAL_BACKPRESSURE')result=await client.admit(seat.value,previous?.seat===seat.value?previous.token:undefined,true);else if(error.code==='SESSION_EXPIRED'){remember(null);transport=null;throw Error(sessionOnly?'Previous session no longer exists. Click Open session-only seat for a fresh world.':'Previous local session expired. Click Open local seat again to restore your saved Eye.');}else{transport=null;throw error;}}
    remember({seat:seat.value,token:result.token});
    host=await GripHost.open(client,{onPreview:(key,value)=>{if(generation!==connectionGeneration)return;if(value)previews.set(key,value);else previews.delete(key);},
      onSnapshot:()=>{},onReceipt:(_key,{command,receipt})=>{if(generation!==connectionGeneration)return;if(command.kind==='grab.target'&&receipt.status==='accepted')say(state.capabilities?.materialDynamics?'Grip target accepted. The phase field responds only through accepted numerical steps.':'Grip target accepted. Material coordinates remain unchanged: driver pending.');},
      onStatus:(_key,event)=>{if(generation!==connectionGeneration)return;if(event.code)say('Grip status: '+event.code);},requestTimeoutMs:5000,cleanupTimeoutMs:5000});
    inputs=new ApplicationInputs({host,nextEpoch:()=>client.nextEpoch(),project:(entity,anchor,point)=>screenTarget(renderer,entity,anchor,point),onRemove:key=>{if(generation===connectionGeneration)previews.delete(key);}});
    await gridFor(state.eye.dimension);configureAxes();receive(state);
    $('welcome').hidden=true;$('toolbar').hidden=false;say(sessionOnly?'Session-only world open. State lasts while this local server process runs. Tap a relic, travel with your Eye, or enter its nested space.':'Saved world open. Tap a relic, travel with your Eye, or enter its nested space.');
    clearTimeout(poll);clearTimeout(densityPoll);void refreshLoop(client,generation);void refreshDensity(generation,client);
  }finally{connecting=false;$('createRoom').disabled=false;}
}
async function refreshLoop(client,generation){
  if(generation!==connectionGeneration||transport!==client||client.closed)return;
  try{await client.refresh();}catch(error){if(generation!==connectionGeneration||transport!==client)return;online=false;updateUI();say(error.message+' · no uncertain edits are replayed. Reconnect explicitly.');}
  if(generation===connectionGeneration&&transport===client&&!client.closed)poll=setTimeout(()=>refreshLoop(client,generation),350);
}
async function beginGesture(key,source,id,point,observedAt){
  if(connecting||!inputs||!online||state.journal?.readOnly||transport.session.readOnly)throw Error('Editing is unavailable');
  const entity=state.snapshot.spaces[state.eye.spaceId].entities[id];if(!entity)return;
  selected=id;renderer.setDensity(null);updateDensityPanel(null);updateUI();renderer.selected=id;
  return inputs.begin(key,{entity,source,point,observedAt});
}
function moveGesture(key,point,observedAt){return inputs?.move(key,point,observedAt);}
async function endGesture(key,point=null,observedAt=null){return inputs?.end(key,{point,observedAt});}
async function cancelGesture(key,reason){return inputs?.cancel(key,reason);}
async function cancelAll(reason){orbit=null;hand=null;await inputs?.cancelAll(reason);}
async function releaseAll(){await inputs?.releaseAll();}

async function disconnect(){
  ++connectionGeneration;online=false;updateUI();clearTimeout(poll);clearTimeout(densityPoll);densityRequest++;renderer.setDensity(null);updateDensityPanel(null);points.clear();camera.stop();await cancelAll('disconnect');
  if(inputs)await inputs.close();else if(host)await host.close();if(transport&&!transport.closed)await transport.close();
  host=null;inputs=null;transport=null;online=false;remember(null);
}
function editEye(change){
  const generation=connectionGeneration,client=transport;
  const task=viewTail.then(async()=>{if(generation!==connectionGeneration||client!==transport)throw Error('Observer action cancelled after connection changed');if(connecting||!state||!online)throw Error('Open your local seat first');if(state.journal?.readOnly||transport.session.readOnly)throw Error('This session is read-only');const eye=copy(state.eye);change(eye);await transport.moveEye(eye,eye.revision);});
  viewTail=task.catch(()=>{});return task;
}
async function navigate(enter){
  if(connecting||!online)throw Error('Open your local seat first');
  const generation=connectionGeneration,client=transport;await releaseAll();if(generation!==connectionGeneration||client!==transport)throw Error('Navigation cancelled after connection changed');const eye=state.eye,e=currentEntity();
  const command={schema:'vivo.command/1',id:'navigation.'+crypto.randomUUID(),worldId:state.snapshot.worldId,spaceId:eye.spaceId,
    kind:enter?'space.enter':'space.exit',expectedRevision:enter?e.revision:eye.revision,
    payload:enter?{eyeId:'main',portalEntityId:e.id}:{eyeId:'main',returnFrameId:eye.stack.at(-1)?.id}};
  const receipt=await transport.submit(command);if(receipt.status!=='accepted')throw Error(receipt.code);
  $('panel').close();say(enter?(sessionOnly?'Entered the mapped inner space. Your outer Eye remains in this session.':'Entered the mapped inner space. Your outer Eye is saved.'):(sessionOnly?'Returned to your session outer Eye. Accepted object state is unchanged.':'Returned to your exact saved outer Eye. Accepted object state is unchanged.'));
}

$('createRoom').onclick=safe(connect);
$('reconnect').onclick=safe(async()=>{
  if(connecting)return;connecting=true;++connectionGeneration;online=false;updateUI();points.clear();clearTimeout(poll);
  try{if(inputs)await inputs.close().catch(()=>say('Inspecting the saved session before reopening; cleanup is not yet confirmed.'));else if(host)await host.close().catch(()=>{});host=null;inputs=null;transport=null;previews.clear();}
  finally{connecting=false;}
  await connect();
});
$('leaveRoom').onclick=safe(async()=>{if(connecting)return;connecting=true;try{await disconnect();$('welcome').hidden=false;$('toolbar').hidden=true;say(sessionOnly?'Local seat closed. Session-only state remains only while the server process runs.':'Local seat closed. Saved state remains on this computer.');}finally{connecting=false;}});
$('releaseGrab').onclick=safe(releaseAll);enterButton.onclick=safe(()=>navigate(true));exitButton.onclick=safe(()=>navigate(false));
async function axisStep(sign){
  const owner=inputs,generation=connectionGeneration;const axis=+$('moveAxis').value,time=performance.now();
  if($('moveTarget').value==='observer'){await editEye(eye=>{eye.q[axis]+=sign*.12;if(axis>=3)eye.slice['x'+(axis+1)]=eye.q[axis];});say((sessionOnly?'Your session Eye moved along x':'Your saved Eye moved along x')+(axis+1));return;}
  if(!inputs.get('keyboard'))await beginGesture('keyboard','keyboard',selected,[0,0],time);
  if(owner!==inputs||generation!==connectionGeneration)return;const record=owner.get('keyboard');if(!record)return;
  const frame=copy(record.latest.frame);frame.q[axis]+=sign*.12;record.latest={frame,observedAt:time};
  owner.offer('keyboard',frame,time);
}
$('axisMinus').onclick=safe(()=>axisStep(-1));$('axisPlus').onclick=safe(()=>axisStep(1));
const points=new Map();
$('world').addEventListener('pointerdown',safe(async event=>{
  if(!state)return;const point=[event.clientX,event.clientY],time=eventTime(event);
  points.set(event.pointerId,point);$('world').setPointerCapture(event.pointerId);
  if(points.size>1){await cancelAll('multi-touch-navigation');return;}
  const id=renderer.at(...point);
  if(id)await beginGesture('pointer.'+event.pointerId,'touch',id,point,time);
  else orbit={pointer:event.pointerId,point};
}));
$('world').addEventListener('pointermove',safe(event=>{
  if(!points.has(event.pointerId))return;const point=[event.clientX,event.clientY];points.set(event.pointerId,point);
  if(orbit?.pointer===event.pointerId){renderer.yaw+=(point[0]-orbit.point[0])*.006;renderer.pitch=Math.max(-1.3,Math.min(1.3,renderer.pitch+(point[1]-orbit.point[1])*.006));orbit.point=point;}
  else moveGesture('pointer.'+event.pointerId,point,eventTime(event));
}));
$('world').addEventListener('pointerup',safe(async event=>{
  points.delete(event.pointerId);
  if(orbit?.pointer===event.pointerId){const yaw=renderer.yaw,pitch=renderer.pitch;orbit=null;await editEye(eye=>{eye.basis=viewBasis(eye.dimension,yaw,pitch);});}
  else await endGesture('pointer.'+event.pointerId,[event.clientX,event.clientY],eventTime(event));
}));
for(const name of['pointercancel','lostpointercapture'])$('world').addEventListener(name,safe(async event=>{if(name==='lostpointercapture'&&!points.has(event.pointerId))return;points.delete(event.pointerId);if(orbit?.pointer===event.pointerId)orbit=null;await cancelGesture('pointer.'+event.pointerId,name);}));
$('world').addEventListener('wheel',event=>{event.preventDefault();renderer.distance=Math.max(4,Math.min(22,renderer.distance+event.deltaY*.007));},{passive:false});
const panelNames={move:'Accepted targets & nested space',eye:sessionOnly?'Your session Eye':'Your saved Eye',camera:'Local camera',people:'Two local seats',record:sessionOnly?'Session-only state':'Saved accepted state'};
function captureConnection(){
  if(connecting||!transport||transport.closed||!inputs)throw Error('Wait for the local connection');
  const client=transport,owner=inputs,generation=connectionGeneration;
  return{client,owner,assert(){if(generation!==connectionGeneration||client!==transport||owner!==inputs||connecting)throw Error('Action cancelled after connection changed');}};
}
async function showPanel(id){
  const action=captureConnection();let cleanupError;
  try{await action.owner.releaseAll();}catch(error){cleanupError=error;}
  action.assert();$('panelTitle').textContent=panelNames[id];document.querySelectorAll('[data-sheet]').forEach(e=>e.classList.toggle('active',e.dataset.sheet===id));$('panel').showModal();
  if(cleanupError){
    const panelScope=document.documentElement?.dataset?.vivoStore==='memory'?'Session state':'Saved state';
    say('Cleanup is uncertain. Use '+panelScope+' → Reconcile uncertain grips; controls remain available.');
  }
}

document.querySelectorAll('[data-panel]').forEach(button=>button.onclick=safe(()=>showPanel(button.dataset.panel)));
$('closePanel').onclick=()=>$('panel').close();$('connection').onclick=safe(()=>state&&showPanel('people'));
$('viewMode').onchange=()=>{renderer.overview=$('viewMode').value==='overview';};
$('sliceAxis').onchange=()=>{$('sliceValue').value=String(state?.eye.slice['x'+(+$('sliceAxis').value+1)]||0);};
$('sliceValue').onchange=safe(()=>{const axis=+$('sliceAxis').value,value=+$('sliceValue').value;return editEye(eye=>{eye.slice['x'+(axis+1)]=value;eye.q[axis]=value;});});
$('sliceValue').oninput=()=>{$('sliceReadout').textContent='x'+(+$('sliceAxis').value+1)+' = '+(+$('sliceValue').value).toFixed(2)+' (release to save)';};
$('homeView').onclick=safe(()=>editEye(eye=>{eye.q.fill(0);eye.basis=viewBasis(eye.dimension,.55,.68);for(const key of Object.keys(eye.slice))eye.slice[key]=0;}));
$('followSelected').onclick=safe(()=>editEye(eye=>{const e=currentEntity();eye.q=[...e.q];for(let a=3;a<eye.dimension;a++)eye.slice['x'+(a+1)]=eye.q[a];}));

const TimedCamera=timestampedCameraClass(Camera);
const camera=new TimedCamera($('cameraVideo'),text=>{$('cameraState').textContent=text;},event=>{
  if(event.type==='lost'){renderer.pointer=null;hand=null;void cancelGesture('hand','hand-source-lost').catch(e=>say(e.message));return;}
  if(event.type==='aim'){renderer.pointer=event.point;return;}
  if(!state||$('panel').open){hand=null;void cancelGesture('hand','controls-opened').catch(e=>say(e.message));return;}
  if(event.type==='grab'){const id=renderer.at(...event.point);if(!id)return;hand={epoch:event.epoch};void beginGesture('hand','hand',id,event.point,event.observedAt).catch(e=>say(e.message));}
  if(event.type==='move'&&hand?.epoch===event.epoch)safe(moveGesture)('hand',event.point,event.observedAt);
  if(event.type==='release'){hand=null;void endGesture('hand',event.point,event.observedAt).catch(e=>say(e.message));}
},points=>{renderer.hand=$('skeleton').checked?points:[];});
for(const[id,facing]of[['frontCamera','user'],['backCamera','environment']])$(id).onclick=safe(async()=>{$('panel').close();await camera.start(facing);updateUI();});
$('previewCamera').onclick=safe(async()=>{$('panel').close();await camera.start('environment',false);updateUI();});
$('stopCamera').onclick=()=>{camera.stop();updateUI();};$('visibility').onchange=()=>{camera.profile=$('visibility').value;camera.sampleLuma();};
$('torch').onclick=safe(()=>camera.light());$('exposure').onclick=safe(()=>camera.exposure());

phaseButton.onclick=safe(async()=>{const context=captureConnection();const running=!context.client.current.capabilities.material?.running;await context.client.call('materialRun',{running});context.assert();say(running?'Experimental phase running slowly. Solid marks show accepted field centroids.':sessionOnly?'Phase paused; accepted fields remain in this server process.':'Phase paused; accepted fields remain saved.');});
saveButton.onclick=safe(async()=>{const action=captureConnection();await action.owner.releaseAll();action.assert();await action.client.refresh();action.assert();say('Checkpoint confirmed at accepted sequence '+action.client.current.snapshot.acceptedSequence+'. Saved atomically on this computer.');});
exportButton.onclick=safe(async()=>{const action=captureConnection();await action.owner.releaseAll();action.assert();const data=await action.client.export();action.assert();const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));const link=element('a',{href:url,download:'vivo-accepted-state.json'});link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);say(sessionOnly?'Downloaded accepted session state; this is not durable storage or an import/reload path. Camera frames and session tokens excluded.':'Exported accepted state; camera frames and session tokens excluded.');});
reconcileButton.onclick=safe(async()=>{const action=captureConnection();await action.owner.reconcileAll();action.assert();await action.client.refresh();action.assert();say(sessionOnly?'Reconciliation completed for known grips in this session.':'Reconciliation completed for known grips. Saved state refreshed.');});
document.addEventListener('visibilitychange',()=>{if(document.hidden){points.clear();camera.stop();void cancelAll('tab-hidden').catch(e=>say(e.message));}});
window.addEventListener('pagehide',()=>{camera.stop();void cancelAll('page-hidden').catch(()=>{});});
window.addEventListener('keydown',event=>{if(event.key==='Escape')void cancelAll('escape').catch(e=>say(e.message));});

function drawTarget(target,label,color){
  if(!state||target.spaceId!==state.eye.spaceId)return;
  const p=renderer.project(embed(target.q,{kind:'flat',dimension:target.dimension},target.chart));if(!p.visible)return;
  const ctx=renderer.ctx;ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;ctx.setLineDash([5,5]);ctx.beginPath();ctx.arc(p.x,p.y,20,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText(label,p.x,p.y-28);ctx.restore();
}
function draw(now){if(!rendering)return;renderer.draw(now);for(const constraint of state?.constraints||[])drawTarget(constraint.target,'ACCEPTED GRIP TARGET','#c8a7ed');for(const preview of previews.values())drawTarget(preview.frame,'PROVISIONAL TARGET','#edd395');requestAnimationFrame(draw);}
requestAnimationFrame(draw);
requestJSON('/api/local/ready').then(data=>{if(!data.ok)throw Error('Local authority is not ready');$('serviceReady').textContent='LOCAL SERVER READY · Python + Node · '+(sessionOnly?'SESSION ONLY · camera off':'camera off');$('createRoom').disabled=false;}).catch(error=>{$('serviceReady').textContent=error.message;$('createRoom').disabled=true;});
