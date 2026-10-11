import {Renderer,embed} from '/render.js';
import {Camera} from '/camera.js';
import {GripHost} from '/services/vivo/web/authority/grip-host.mjs';
import {RemoteTransport} from './remote-transport.mjs';
import {ApplicationInputs} from './interactions.mjs';
import {eventTime,screenTarget,viewBasis,projectAccepted,timestampedCameraClass} from './adapters.mjs';

const $=id=>document.getElementById(id),element=(tag,p={})=>Object.assign(document.createElement(tag),p);
const renderer=new Renderer($('world'),$('overlay')),grids=new Map(),previews=new Map();
let transport=null,host=null,inputs=null,state=null,selected=null,hand=null,online=false,role=null;
const say=t=>{$('status').textContent=t;},safe=fn=>async(...a)=>{try{return await fn(...a);}catch(e){say(e.code||e.message||String(e));}};
const tokenFromUrl=()=>{const p=new URLSearchParams(location.hash.slice(1)),token=p.get('token')||'';if(token)history.replaceState(null,'',location.pathname+location.search);return token;};
const tokenInput=element('input',{id:'remoteToken',type:'password',autocomplete:'off',placeholder:'Owner or invitation token',value:tokenFromUrl()});
const tokenLabel=element('label',{textContent:'Private access token'});tokenLabel.append(tokenInput);
$('displayName').closest('label').replaceWith(tokenLabel);
$('spaceKind').closest('.row').hidden=true;$('metricInputLabel').hidden=true;$('keyLabel').hidden=true;$('joinRoom').hidden=true;
$('createRoom').textContent='Enter shared Vivo';$('inviteNote').textContent='The token stays in this browser session and WebSocket join message. Camera frames never leave this device.';
$('welcome').querySelector('a').hidden=true;document.querySelector('[data-panel="neural"]').hidden=true;
document.querySelector('[data-panel="people"]').textContent='♧ People';document.querySelector('[data-panel="record"]').textContent='↧ State';
$('moveTarget').options[0].textContent='Shared learned material object';
const moveSheet=document.querySelector('[data-sheet="move"]');
const objectLabel=element('label',{textContent:'Active object'}),objectSelect=element('select',{id:'remoteObject'});objectLabel.append(objectSelect);moveSheet.prepend(objectLabel);
objectSelect.onchange=()=>{selected=objectSelect.value;renderer.selected=selected;updateUI();};
moveSheet.querySelector('p').textContent='Drag the same object from two devices. Matching cooperative grips become separate accepted constraints; one canonical learned material state responds to both.';
moveSheet.querySelector('p.muted').textContent='Root is native 4D; the nested relic is native 11D. Time is separate. Dashed markers are targets, not the object itself.';
const enterButton=element('button',{id:'enterSpace',textContent:'Enter selected inner world'});
const exitButton=element('button',{id:'exitSpace',textContent:'Return through saved Eye frame'});moveSheet.append(enterButton,exitButton);
const eyeSheet=document.querySelector('[data-sheet="eye"]');eyeSheet.querySelector('p').textContent='Your Eye is persistent and independent. Another participant can remain in root while you enter the 11D inner world.';
const peopleSheet=document.querySelector('[data-sheet="people"]');$('inviteRole').closest('label').hidden=true;$('inviteRole').hidden=true;
$('makeInvite').textContent='Create 1-hour editor invitation';$('revokeInvites').textContent='Refresh invitation list';
peopleSheet.querySelector('p.muted').textContent='Invitation links are bearer capabilities. The server stores only token hashes. Shared object state is server-readable; camera video is never part of this protocol.';
peopleSheet.querySelector('a').hidden=true;
const recordSheet=document.querySelector('[data-sheet="record"]');for(const child of [...recordSheet.children])child.hidden=true;
const materialButton=element('button',{id:'remoteMaterial',textContent:'Run learned material'});
const exportButton=element('button',{id:'remoteExport',textContent:'Export accepted world JSON'});
const reconcileButton=element('button',{id:'remoteReconcile',textContent:'Reconcile uncertain grips'});
recordSheet.append(materialButton,exportButton,reconcileButton,element('p',{className:'muted',textContent:'Exports accepted world/Eye/history only. No invitation tokens, camera frames, microphone or private runtime token.'}));
const badge=element('div',{id:'localCapabilities',textContent:'REMOTE · disconnected'});document.body.append(badge);

async function gridFor(d){if(!grids.has(d)){const r=await fetch('/api/remote/grid?dimension='+d);if(!r.ok)throw Error(await r.text());grids.set(d,await r.json());}return grids.get(d);}
function currentEntity(){return state?.snapshot.spaces[state.eye.spaceId].entities[selected];}
function configureAxes(){if(!state)return;for(const id of ['moveAxis','sliceAxis']){$(id).replaceChildren();for(let a=id==='sliceAxis'?3:0;a<state.eye.dimension;a++)$(id).append(element('option',{value:String(a),textContent:'x'+(a+1)}));}const a=+$('sliceAxis').value;$('sliceValue').value=String(state.eye.slice?.['x'+(a+1)]||0);}
function receive(next){if(!next)return;const old=state?.eye?.spaceId;state=next;online=true;
  const entities=next.snapshot.spaces[next.eye.spaceId].entities;if(!selected||!entities[selected])selected=Object.keys(entities)[0];
  renderer.actor=transport?.actorId;renderer.selected=selected;
  void gridFor(next.eye.dimension).then(grid=>{renderer.grid=grid;renderer.state=projectAccepted(next,grid);renderer.slice=[...next.eye.q];for(const[k,v]of Object.entries(next.eye.slice||{}))renderer.slice[+k.slice(1)-1]=v;renderer.origin=embed(next.eye.q,renderer.state.geometry,next.eye.chart);});
  if(old!==next.eye.spaceId)configureAxes();updateUI();
}
function updateUI(){if(!state)return;const e=currentEntity(),activeRole=role??transport?.role??'joining';$('connection').textContent=(online?'REMOTE '+activeRole.toUpperCase():'DISCONNECTED')+' · '+transport.actorId;
  $('worldName').textContent=state.eye.spaceId==='root'?'Shared 4D adaptive workshop':'Inside persistent 11D relic world';
  $('dimensionBadge').textContent=state.eye.dimension+' spatial axes + separate time';$('geometryBadge').textContent='Eye r'+state.eye.revision+' · seq '+state.snapshot.acceptedSequence;
  $('selection').hidden=!e;if(e){$('selectedName').textContent=e.name;$('selectedCoords').textContent=e.q.map((v,i)=>'x'+(i+1)+' '+v.toFixed(3)).join(' · ');}
  const ids=Object.keys(state.snapshot.spaces[state.eye.spaceId].entities);
  if(objectSelect.options.length!==ids.length||ids.some((id,i)=>objectSelect.options[i]?.value!==id))objectSelect.replaceChildren(...ids.map(id=>element('option',{value:id,textContent:state.snapshot.spaces[state.eye.spaceId].entities[id].name||id})));
  objectSelect.value=selected;
  enterButton.disabled=!e?.innerSpaceId;exitButton.disabled=!state.eye.stack?.length;
  $('peopleList').replaceChildren();for(const p of state.participants||[])$('peopleList').append(element('p',{textContent:(p.actorId||p.seat)+' · '+(p.online?'online':'offline')+(p.actorId===transport.actorId?' (you)':'')}));
  const running=state.capabilities.material?.running;materialButton.hidden=role!=='owner';materialButton.textContent=(running?'Pause':'Run')+' learned adaptive material';
  badge.textContent='REMOTE · canonical '+(state.capabilities.materialLearning?'LEARNED 4D/11D MATERIAL':'MATERIAL OFF')+' · independent Eyes';
  $('metrics').textContent='Camera '+(camera.stream?'on':'off')+' · no microphone · no frame uploads · sim t '+state.snapshot.simulationTime.toFixed(3);
}
async function connect(){if(transport&&!transport.closed)await disconnect();const token=tokenInput.value.trim();if(!token)throw Error('Enter owner or invitation token');
  const socket=(location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws';
  const client=new RemoteTransport({url:socket,token,onState:receive,onError:error=>say('Remote: '+(error.code||error.message||'protocol error'))});transport=client;const admitted=await client.admit();role=admitted.role;receive(admitted.state);
  host=await GripHost.open(client,{onPreview:(key,v)=>v?previews.set(key,v):previews.delete(key),onStatus:(_k,e)=>e.code&&say('Grip: '+e.code)});
  inputs=new ApplicationInputs({host,nextEpoch:()=>client.nextEpoch(),project:(entity,anchor,point)=>screenTarget(renderer,entity,anchor,point),onRemove:key=>previews.delete(key)});
  await gridFor(state.eye.dimension);configureAxes();$('welcome').hidden=true;$('toolbar').hidden=false;say('Connected to one canonical Vivo world. Touch, hands and Eye actions use accepted authority state.');
}
async function disconnect(){online=false;camera.stop();try{await inputs?.cancelAll('remote-disconnect');}catch{}try{await inputs?.close();}catch{}try{await transport?.close();}catch{}host=null;inputs=null;transport=null;state=null;$('welcome').hidden=false;$('toolbar').hidden=true;badge.textContent='REMOTE · disconnected';}
function cooperativeGroup(id){return 'shared.'+state.eye.spaceId+'.'+id;}
async function beginGesture(key,source,id,point,observedAt){if(!inputs||!online)throw Error('Not connected');const e=state.snapshot.spaces[state.eye.spaceId].entities[id];selected=id;renderer.selected=id;updateUI();return inputs.begin(key,{entity:e,source,point,observedAt,cooperativeGroup:cooperativeGroup(id)});}
const moveGesture=(key,p,t)=>inputs?.move(key,p,t),endGesture=(key,p,t)=>inputs?.end(key,{point:p,observedAt:t});
async function releaseAll(){await inputs?.releaseAll();}
async function editEye(change){const eye=structuredClone(state.eye);change(eye);await transport.moveEye(eye,eye.revision);}
async function navigate(enter){
 await releaseAll();
 for(let attempt=0;attempt<3;attempt++){
   const eye=state.eye,e=currentEntity();if(enter&&!e?.innerSpaceId)throw Error('Select an entrance object');
   const command={schema:'vivo.command/1',id:'nav.'+crypto.randomUUID(),worldId:state.snapshot.worldId,spaceId:eye.spaceId,kind:enter?'space.enter':'space.exit',expectedRevision:enter?e.revision:eye.revision,payload:enter?{eyeId:'main',portalEntityId:e.id}:{eyeId:'main',returnFrameId:eye.stack.at(-1)?.id}};
   const receipt=await transport.submit(command);
   if(receipt.status==='accepted'){say(enter?'Entered persistent nested world. Your collaborator Eye was not moved.':'Returned through your saved Eye frame.');return;}
   if(!(enter&&receipt.code==='STALE_REVISION'&&attempt<2))throw Error(receipt.code);
   // A moving material portal can advance between render and submit. Refresh
   // identity/state and retry; do not reuse the stale command ID or guess state.
   await transport.refresh();
 }
 throw Error('STALE_REVISION');
}
$('createRoom').onclick=safe(connect);$('connection').onclick=safe(disconnect);enterButton.onclick=safe(()=>navigate(true));exitButton.onclick=safe(()=>navigate(false));
$('closePanel').onclick=()=>$('panel').close();document.querySelectorAll('.toolbar button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.sheet').forEach(s=>{const active=s.dataset.sheet===b.dataset.panel;s.hidden=!active;s.classList.toggle('active',active);});$('panelTitle').textContent=b.textContent;$('panel').showModal();});
$('homeView').onclick=safe(()=>editEye(eye=>{eye.q=Array(eye.dimension).fill(0);eye.basis=viewBasis(eye.dimension,.55,.68);for(const k of Object.keys(eye.slice||{}))eye.slice[k]=0;}));
$('followSelected').onclick=safe(()=>editEye(eye=>{const e=currentEntity();eye.q=[...e.q];for(let a=3;a<eye.dimension;a++)eye.slice['x'+(a+1)]=e.q[a];}));
$('sliceValue').oninput=safe(()=>editEye(eye=>{const a=+$('sliceAxis').value;eye.slice['x'+(a+1)]=+$('sliceValue').value;eye.q[a]=+$('sliceValue').value;}));
async function axisMove(sign){
  const axis=+$('moveAxis').value;
  if($('moveTarget').value==='observer')return editEye(eye=>{eye.q[axis]+=sign*.25;if(axis>=3)eye.slice['x'+(axis+1)]=eye.q[axis];});
  const entity=currentEntity();if(!entity)throw Error('Select an object');
  if(!state.capabilities.material?.running)throw Error(role==='owner'?'Run learned material first':'Ask the owner to run learned material');
  const key='axis:'+crypto.randomUUID(),epoch=await transport.nextEpoch(),target={spaceId:entity.spaceId,chart:entity.chart,dimension:entity.dimension,q:[...entity.q]};
  target.q[axis]+=sign*.25;
  await host.begin(key,{entity,source:'keyboard',inputEpoch:epoch,cooperativeGroup:cooperativeGroup(entity.id)});
  const observedAt=performance.now(),epsilon=1e-6;
  try{
    if(!host.offer(key,target,observedAt))throw Error('Axis target rejected');
    const acceptedDeadline=performance.now()+1800;
    while(performance.now()<acceptedDeadline){
      const own=state?.constraints?.find(c=>c.actorId===transport.actorId&&c.spaceId===entity.spaceId&&c.entityId===entity.id);
      if(own?.target?.q?.length===target.q.length&&Math.abs(own.target.q[axis]-target.q[axis])<=epsilon)break;
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    const own=state?.constraints?.find(c=>c.actorId===transport.actorId&&c.spaceId===entity.spaceId&&c.entityId===entity.id);
    if(!(own?.target?.q?.length===target.q.length&&Math.abs(own.target.q[axis]-target.q[axis])<=epsilon))throw Error('Axis target was not accepted before release');
    const moveDeadline=performance.now()+2600,start=entity.q[axis];
    while(performance.now()<moveDeadline){
      const accepted=state?.snapshot.spaces[entity.spaceId]?.entities[entity.id];
      if(accepted&&Math.abs(accepted.q[axis]-start)>epsilon)break;
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    const accepted=state?.snapshot.spaces[entity.spaceId]?.entities[entity.id];
    if(!(accepted&&Math.abs(accepted.q[axis]-start)>epsilon))throw Error('No material step moved the held axis target');
    await host.end(key,'axis-nudge');
  }catch(error){await host.cancel(key,'axis-nudge-failed').catch(()=>{});throw error;}
}
for(const [id,sign] of [['axisMinus',-1],['axisPlus',1]])$(id).onclick=safe(()=>axisMove(sign));
$('remoteMaterial').onclick=safe(async()=>{await transport.materialRun(!state.capabilities.material.running);});
$('remoteExport').onclick=safe(async()=>{await releaseAll();const data=await transport.export();const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));const a=element('a',{href:u,download:'vivo-remote-accepted.json'});a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);});
$('remoteReconcile').onclick=safe(()=>inputs.reconcileAll());
$('makeInvite').onclick=safe(async()=>{if(role!=='owner')throw Error('Only owner creates invitations');const inv=await transport.createInvite(3600);const u=new URL(location.href);u.hash='token='+encodeURIComponent(inv.token);$('inviteLink').value=u.toString();say('One-hour editor invitation created. Token is shown once and stored only as a hash on the server.');});
$('copyInvite').onclick=safe(()=>navigator.clipboard.writeText($('inviteLink').value));$('revokeInvites').onclick=safe(async()=>{if(role!=='owner')throw Error('Owner only');const list=await transport.listInvites();for(const inv of list)if(!inv.revoked&&inv.actorId!==transport.actorId)await transport.revokeInvite(inv.id);say('Guest invitations revoked.');});
$('reconnect').onclick=safe(connect);$('leaveRoom').onclick=safe(disconnect);

const pointers=new Map();
$('overlay').addEventListener('pointerdown',safe(async event=>{if(!state||$('panel').open)return;const id=renderer.at(event.clientX,event.clientY);if(!id)return;const key='pointer:'+event.pointerId;event.currentTarget.setPointerCapture(event.pointerId);pointers.set(event.pointerId,key);await beginGesture(key,'touch',id,[event.clientX,event.clientY],eventTime(event));}));
$('overlay').addEventListener('pointermove',event=>{const key=pointers.get(event.pointerId);if(key)moveGesture(key,[event.clientX,event.clientY],eventTime(event));});
for(const type of ['pointerup','pointercancel'])$('overlay').addEventListener(type,event=>{const key=pointers.get(event.pointerId);if(!key)return;pointers.delete(event.pointerId);if(type==='pointerup')void endGesture(key,[event.clientX,event.clientY],eventTime(event)).catch(e=>say(e.code||e.message));else void inputs.cancel(key,'pointercancel').catch(e=>say(e.code||e.message));});

const TimedCamera=timestampedCameraClass(Camera);
const camera=new TimedCamera($('cameraVideo'),text=>{$('cameraState').textContent=text;},event=>{
 if(event.type==='lost'){renderer.pointer=null;hand=null;void inputs?.cancel('hand','hand-source-lost').catch(()=>{});return;}
 if(event.type==='aim'){renderer.pointer=event.point;return;}if(!state||$('panel').open)return;
 if(event.type==='grab'){const id=renderer.at(...event.point);if(id){hand={epoch:event.epoch};void beginGesture('hand','hand',id,event.point,event.observedAt).catch(e=>say(e.code||e.message));}}
 if(event.type==='move'&&hand?.epoch===event.epoch)moveGesture('hand',event.point,event.observedAt);
 if(event.type==='release'){hand=null;void endGesture('hand',event.point,event.observedAt).catch(e=>say(e.code||e.message));}
},points=>renderer.hand=$('skeleton').checked?points:[]);
for(const[id,facing]of[['frontCamera','user'],['backCamera','environment']])$(id).onclick=safe(async()=>{$('panel').close();await camera.start(facing);updateUI();});
$('previewCamera').onclick=safe(async()=>{$('panel').close();await camera.start('environment',false);updateUI();});$('stopCamera').onclick=()=>{camera.stop();updateUI();};$('visibility').onchange=()=>{camera.profile=$('visibility').value;camera.sampleLuma();};$('torch').onclick=safe(()=>camera.light());$('exposure').onclick=safe(()=>camera.exposure());

function drawTarget(target,label,color){if(!state||target.spaceId!==state.eye.spaceId)return;const p=renderer.project(embed(target.q,{kind:'flat',dimension:target.dimension},target.chart));if(!p.visible)return;const ctx=renderer.ctx;ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.setLineDash([5,5]);ctx.beginPath();ctx.arc(p.x,p.y,20,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText(label,p.x,p.y-27);ctx.restore();}
function draw(t){renderer.draw(t);for(const c of state?.constraints||[])drawTarget(c.target,'ACCEPTED '+(c.actorId===transport?.actorId?'YOU':'OTHER'),'#c8a7ed');for(const p of previews.values())drawTarget(p.frame,'PROVISIONAL','#edd395');requestAnimationFrame(draw);}requestAnimationFrame(draw);
fetch('/healthz').then(r=>r.json()).then(x=>{$('serviceReady').textContent=x.ok?'REMOTE AUTHORITY READY · camera stays local':'Remote authority not ready';$('createRoom').disabled=!x.ok;}).catch(e=>{$('serviceReady').textContent=e.message;});
