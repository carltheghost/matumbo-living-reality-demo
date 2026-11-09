import {LivingEncounters, encounterScope, encounterKey} from './living-encounters.mjs';
import {EncounterStore} from './encounter-store.mjs';

/** Independent sensing/persistence schedule. Existing physics and input still own actions. */
export class EncounterRuntime {
  constructor({getEnvelope,store=new EncounterStore(),now=()=>Date.now(),onChange=()=>{},verifyMessageReceipt=null}){
    this.getEnvelope=getEnvelope;this.store=store;this.now=now;this.onChange=onChange;this.verifyMessageReceipt=verifyMessageReceipt;
    this.current=null;this.saving=Promise.resolve();this.enabled=true;this.closed=false;
  }
  notify(){try{this.onChange(this.status());}catch{/* UI cannot veto sensing or storage. */}}
  status(){const c=this.current;return {ready:!!c?.ready,enabled:this.enabled,storage:c?.storage??'waiting',scope:c?structuredClone(c.field.scope):null,truncated:c?.field.truncated??0,revision:c?.revision??0};}
  async update(envelope=this.getEnvelope()){
    if(this.closed||!envelope)return;
    const scope=encounterScope(envelope),key=encounterKey(scope);
    if(this.current?.key===key){this.current.field.sync(envelope);return this.current.loading;}
    if(this.current?.ready)void this.flush();
    const c={key,field:new LivingEncounters({scope,now:this.now}),revision:0,savedVersion:0,storage:'restoring',ready:false,queue:[]};
    c.field.sync(envelope);c.field.pause(!this.enabled);this.current=c;this.notify();
    c.loading=(async()=>{
      try{const saved=await this.store.load(key);if(this.current!==c||this.closed)return;
        if(saved.value)c.field.restore(saved.value);
        c.revision=saved.revision;c.savedVersion=c.field.version;c.storage='saved';
      }catch{if(this.current!==c||this.closed)return;c.storage='unavailable';}
      if(this.current!==c||this.closed)return;
      c.ready=true;for(const item of c.queue.splice(0)){if(this.now()-item.at<=1500&&this.enabled)this.contact(item.entityId,item.kind,item.id);}
      this.notify();
    })();return c.loading;
  }
  contact(entityId,kind='touch',id='contact.'+crypto.randomUUID()){
    const c=this.current;if(!c||this.closed||!this.enabled||!['touch','hand'].includes(kind))return false;
    if(!c.ready){if(c.queue.length<32)c.queue.push({entityId,kind,id,at:this.now()});return false;}
    if(!c.field.objects.has(entityId))return false;
    const result=c.field.observe({id,entityId,kind:'touch',intensity:1,provenance:kind==='hand'?'local-hand':'local-touch'});this.notify();return result.changed;
  }
  light(entityId){const c=this.current;if(!c?.ready||this.closed)throw new Error('ENCOUNTERS_NOT_READY');const count=c.field.light(entityId);this.notify();return count;}
  message(entityId,{id,receiptId=null,expectedScope}={}){
    // Trusted host hook only: does not publish to an external bot or mark a job done.
    const c=this.current;if(!c?.ready||this.closed)return false;
    if(!expectedScope || encounterKey(expectedScope)!==c.key)throw new Error('MESSAGE_SCOPE_CHANGED');
    if(receiptId && (!this.verifyMessageReceipt || this.verifyMessageReceipt({receiptId,entityId,scope:c.field.scope})!==true))throw new Error('MESSAGE_RECEIPT_VERIFICATION_REQUIRED');
    const result=c.field.observe({id,entityId,kind:'message',intensity:.9,provenance:receiptId?'confirmed-message':'local-message',receiptId});
    this.notify();return result.changed;
  }
  tick(){
    const c=this.current;if(!c?.ready||this.closed||!this.enabled)return;
    const envelope=this.getEnvelope();if(!envelope)return;
    if(encounterKey(encounterScope(envelope))!==c.key){void this.update(envelope);return;}
    c.field.sync(envelope);if(c.field.proximity())this.notify();
  }
  effect(entityId){return this.current?.ready?this.current.field.effect(entityId):{energy:0,memory:0,channels:{},lastKind:null};}
  history(entityId){return this.current?.ready?this.current.field.history(entityId):[];}
  pause(value=true){this.enabled=!value;this.current?.field.pause(value);if(value)this.current?.queue.splice(0);this.notify();}
  forget(entityId){if(!this.current?.ready)throw new Error('ENCOUNTERS_NOT_READY');this.current.field.forget(entityId);this.notify();return this.flush();}
  flush(){
    const c=this.current;if(!c?.ready||c.storage==='conflict'||c.storage==='unavailable')return this.saving;
    this.saving=this.saving.catch(()=>{}).then(async()=>{
      if(c.storage==='conflict'||c.storage==='unavailable'||c.savedVersion===c.field.version)return;
      const version=c.field.version,value=c.field.export();c.storage='saving';this.notify();
      try{c.revision=await this.store.save(c.key,value,c.revision);c.savedVersion=version;c.storage='saved';}
      catch(e){c.storage=e?.message==='ENCOUNTER_OTHER_TAB_CHANGED'?'conflict':'unsaved';}
      if(this.current===c)this.notify();
    });return this.saving;
  }
  async close(){if(this.closed)return;this.pause();await this.flush();this.closed=true;this.current=null;}
}

/** Mount inside the original phone controls and decorate its existing objects. */
export function mountLivingEncounters({renderer,getEnvelope,isActive,documentRoot=document,scope=window}){
  const doc=documentRoot;
  const runtime=new EncounterRuntime({getEnvelope:()=>isActive()?getEnvelope():null,onChange:()=>refresh()});
  const section=doc.createElement('section');section.id='phoneEncounters';section.className='phone-section';
  section.innerHTML='<h3>Living encounters</h3><p>Objects sense touch and nearby objects. Meaningful traces stay with this world on this device.</p><p id="encounterState" role="status"></p><div class="row"><button type="button" id="encounterLight">Send simulated light pulse</button><button type="button" id="encounterPause">Pause sensing</button></div><div class="row"><button type="button" id="encounterSave">Save traces</button><button type="button" id="encounterForget">Forget selected traces</button></div><p><small>Local sensory reactions, not proof of external agent work. Light uses a simple full-dimensional distance model, not physical optics. No camera, network or training.</small></p><ol id="encounterHistory" aria-label="Selected object encounter history"></ol>';
  (doc.querySelector('#panel [data-sheet="phone"]')||doc.getElementById('phoneFieldDock'))?.append(section);
  const nav=doc.createElement('button');nav.type='button';nav.id='phoneEncountersButton';nav.textContent='Living objects';
  nav.onclick=()=>{doc.getElementById('phonePanelButton')?.click();section.scrollIntoView({block:'start'});refresh();};
  doc.getElementById('toolbar')?.append(nav);
  const reduced=scope.matchMedia?.('(prefers-reduced-motion: reduce)');let lastStatus='',lastSelection=null;
  const $=id=>section.querySelector('#'+id);
  function refresh(){
    const state=runtime.status(),selected=renderer.selected;
    const description=state.ready?`${selected||'No object selected'} · ${state.enabled?'sensing':'paused'} · history ${state.storage}${state.truncated?' · bounded to 128 objects':''}`:'Enter local Vivo to activate object encounters.';
    if(lastStatus!==description){$('encounterState').textContent=description;lastStatus=description;}
    for(const id of ['encounterLight','encounterForget'])$(id).disabled=!state.ready||!runtime.current?.field.objects.has(selected);
    $('encounterPause').textContent=state.enabled?'Pause sensing':'Resume sensing';
    const list=$('encounterHistory');list.replaceChildren();
    for(const event of runtime.history(selected).slice(-6).reverse()){
      const row=doc.createElement('li');row.textContent=`${event.kind} · ${event.provenance} · ${new Date(event.at).toLocaleTimeString()}`;list.append(row);
    }
    if(!list.children.length){const row=doc.createElement('li');row.textContent='No retained encounters for this object yet.';list.append(row);}
  }
  const act=fn=>()=>{try{Promise.resolve(fn()).catch(()=>{$('encounterState').textContent='Encounter storage is not saved. Your canonical world is unchanged.';});}catch{$('encounterState').textContent='This encounter is unavailable for the current object or coordinate system.';}};
  $('encounterLight').onclick=act(()=>runtime.light(renderer.selected));
  $('encounterSave').onclick=act(()=>runtime.flush());
  $('encounterPause').onclick=act(()=>runtime.pause(runtime.enabled));
  $('encounterForget').onclick=act(()=>runtime.forget(renderer.selected));
  const originalDraw=renderer.drawEntity;
  const wrappedDraw=function(ctx,entity,point,geometry){const result=originalDraw.call(this,ctx,entity,point,geometry);if(isActive()&&result?.interactive)drawEncounterResponse(ctx,point,Math.max(9,entity.radius*point.k),runtime.effect(entity.id),{reducedMotion:this.encounterReducedMotion});return result;};
  renderer.drawEntity=wrappedDraw;
  renderer.encounterEffect=id=>runtime.effect(id);
  renderer.encounterReducedMotion=!!reduced?.matches;
  const updateMotion=()=>{renderer.encounterReducedMotion=!!reduced?.matches;};reduced?.addEventListener?.('change',updateMotion);
  const changed=event=>{void runtime.update(event.detail.state).catch(()=>{$('encounterState').textContent='Encounter state unavailable; existing world remains active.';});};
  scope.addEventListener('vivo:phone-local-ready',changed);
  scope.addEventListener('vivo:phone-statechange',changed);
  const sample=scope.setInterval(()=>{if(doc.hidden||!isActive())return;try{runtime.tick();if(renderer.selected!==lastSelection){lastSelection=renderer.selected;refresh();}}catch{}},100);
  const save=scope.setInterval(()=>{if(runtime.status().ready)void runtime.flush();},1000);
  const visibility=()=>{if(doc.hidden)void runtime.flush();else refresh();};doc.addEventListener('visibilitychange',visibility);
  const pagehide=()=>{void runtime.flush();};scope.addEventListener('pagehide',pagehide);
  // Existing renderer continues its own schedule; effect() never records an event.
  const envelope=getEnvelope();if(isActive()&&envelope)void runtime.update(envelope);
  refresh();
  return {contact:(...args)=>runtime.contact(...args),message:(...args)=>runtime.message(...args),
    status:()=>runtime.status(),history:id=>runtime.history(id),effect:id=>runtime.effect(id),flush:()=>runtime.flush(),
    dispose:async()=>{scope.clearInterval(sample);scope.clearInterval(save);scope.removeEventListener('vivo:phone-local-ready',changed);scope.removeEventListener('vivo:phone-statechange',changed);scope.removeEventListener('pagehide',pagehide);doc.removeEventListener('visibilitychange',visibility);reduced?.removeEventListener?.('change',updateMotion);renderer.encounterEffect=null;if(renderer.drawEntity===wrappedDraw)renderer.drawEntity=originalDraw;section.remove();nav.remove();await runtime.close();}};
}

/** Surface response on the existing object, not a floating proxy or a job-status badge. */
export function drawEncounterResponse(ctx,point,radius,effect,{reducedMotion=false}={}){
  if(!effect||!point?.visible||(!effect.energy&&!effect.memory))return;
  const energy=Math.min(1,Math.max(0,effect.energy||0)),memory=Math.min(1,Math.max(0,effect.memory||0));
  const colors={touch:'#ffd794',light:'#e9fbff',proximity:'#9ce8c4',message:'#c5b1ff'};
  ctx.save();ctx.strokeStyle=colors[effect.lastKind]||'#b4d0e2';ctx.globalAlpha=.12*memory+.7*energy;ctx.lineWidth=1+2*energy;
  const r=Math.max(12,radius*.85),spread=reducedMotion?0:(1-energy)*7;
  for(let i=0;i<4;i++){const a=i*Math.PI/2;ctx.beginPath();ctx.arc(point.x,point.y,r+spread,a+.12,a+1.1);ctx.stroke();}
  ctx.globalAlpha=.16*memory+.28*energy;ctx.fillStyle=colors[effect.lastKind]||'#b4d0e2';
  ctx.beginPath();ctx.arc(point.x,point.y,Math.max(3,radius*.25),0,Math.PI*2);ctx.fill();ctx.restore();
}

const installations = new WeakMap();
export function installEncounterHooks(scope,doc){
  if(installations.has(scope))return installations.get(scope);
  let surface=null,handIds=new Set();
  const ready=()=>{
    if(surface||!scope.VivaPhoneEngine?.active||!scope.VivaShared?.R)return;
    surface=mountLivingEncounters({renderer:scope.VivaShared.R,getEnvelope:()=>scope.VivaPhoneEngine.publishedSnapshot(),isActive:()=>!!scope.VivaPhoneEngine?.active,documentRoot:doc,scope});
    scope.VivoLivingEncounters=Object.freeze({status:surface.status,history:surface.history,effect:surface.effect,flush:surface.flush});
  };
  const touch=event=>{
    if(!surface||!scope.VivaPhoneEngine?.active||event.target!==doc.getElementById('world'))return;
    const id=scope.VivaShared.R.at(event.clientX,event.clientY);if(id)surface.contact(id,'touch');
  };
  const hands=()=>{
    if(!surface||doc.hidden||!scope.VivaPhoneEngine?.active)return;
    const items=[...(scope.VivaPhoneEngine.interaction()?.contacts||[]),...(scope.VivaPhoneEngine.materialContacts?.()||[]).map(c=>({...c,objectId:'workpiece'}))];
    const current=new Set();
    for(const c of items){if(c.source?.kind!=='hand'||!c.objectId)continue;const id=JSON.stringify([c.contactId,c.objectId]);current.add(id);if(!handIds.has(id))surface.contact(c.objectId,'hand');}
    handIds=current;
  };
  scope.addEventListener('vivo:phone-local-ready',ready);doc.addEventListener('pointerdown',touch,true);
  const timer=scope.setInterval(hands,100);
  const installation={dispose:async()=>{scope.clearInterval(timer);scope.removeEventListener('vivo:phone-local-ready',ready);doc.removeEventListener('pointerdown',touch,true);await surface?.dispose();delete scope.VivoLivingEncounters;installations.delete(scope);}};
  installations.set(scope,installation);ready();return installation;
}
