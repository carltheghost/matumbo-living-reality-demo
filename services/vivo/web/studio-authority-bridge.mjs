/**
 * Optional, explicit bridge for the preserved Full Studio.
 *
 * The authority owns one versioned Echo projection.  This adapter never
 * replaces Studio controls, never calls moveEye, and never runs a second
 * physics/material loop.  It polls the accepted state because the local HTTP
 * transport has no browser push channel; every local publish, accepted
 * projection application, and offline fork is explicit.
 */
import {LocalTransport} from '/application/transport.mjs';
import {
  STUDIO_BINDING_ID,
  STUDIO_SOURCE_NODE,
  applyCanonicalBindingToStudioSnapshot,
  mapStudioNodeToCanonical,
  studioTransformCommand,
} from '/services/vivo/contracts/studio-binding.mjs';

const copy=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const qOf=value=>Array.isArray(value)?value.map(Number):null;
const bindingVersion=value=>value?{bindingRevision:value.bindingRevision,acceptedSequence:value.acceptedSequence,q:qOf(value.q)}:null;
const sameBinding=(a,b)=>same(bindingVersion(a),bindingVersion(b));
const seatId=value=>value==='two'?'two':'one';
const storageKey=seat=>'vivo.studio.authority.'+seat;

function downloadJSON(name,value){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}

export class StudioAuthorityBridge {
  constructor({app=globalThis.FieldApp,rootDocument=globalThis.document}={}){
    if(!app||typeof app.snapshot!=='function'||typeof app.applySnapshot!=='function')throw Error('FULL_STUDIO_UNAVAILABLE');
    this.app=app;this.document=rootDocument;this.transport=null;this.state=null;this.remoteBinding=null;
    this.lastApplied=null;this.localDiverged=false;this.pendingRemote=null;this.publishConflict=null;this.publishOverrideArmed=false;
    this.seat=seatId(new URL(location.href).searchParams.get('seat'));
    this.pollTimer=null;this.closed=false;this.message='Not connected. Accepted state is untouched.';this.xr=null;
    this.mount();
  }
  mount(){
    const doc=this.document;if(doc.getElementById('vivoStudioAuthorityBridge'))return;
    const style=doc.createElement('style');style.id='vivoStudioAuthorityBridgeStyle';style.textContent=`
#vivoStudioAuthorityBridge{position:fixed;right:14px;bottom:18px;z-index:121;width:min(340px,calc(100vw - 28px));padding:10px 11px;border:1px solid rgba(148,235,220,.34);border-radius:11px;background:rgba(7,18,24,.91);backdrop-filter:blur(14px);box-shadow:0 12px 34px rgba(0,0,0,.28);font:11px ui-monospace,SFMono-Regular,Consolas,monospace;color:#c6ddd8}
#vivoStudioAuthorityBridge .vivo-authority-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;color:#a9eadc;font-weight:700;letter-spacing:.06em}
#vivoStudioAuthorityBridge [data-vivo-authority-status]{color:#e9c48f;font-size:10px;font-weight:500;letter-spacing:0}
#vivoStudioAuthorityBridge .vivo-authority-copy{margin:0 0 8px;color:#a7bdbc;line-height:1.35}
#vivoStudioAuthorityBridge .vivo-authority-controls{display:grid;grid-template-columns:1fr 1fr;gap:5px}
#vivoStudioAuthorityBridge button,#vivoStudioAuthorityBridge select{min-height:29px;padding:5px 7px;border:1px solid #405e64;border-radius:7px;background:#102b34;color:#d6ebe5;font:10px ui-monospace,SFMono-Regular,Consolas,monospace}
#vivoStudioAuthorityBridge button:hover:not(:disabled),#vivoStudioAuthorityBridge button:focus-visible,#vivoStudioAuthorityBridge select:focus-visible{border-color:#94ebdc;outline:2px solid #94ebdc;outline-offset:1px}
#vivoStudioAuthorityBridge button:disabled{cursor:not-allowed;opacity:.45}
#vivoStudioAuthorityBridge .vivo-authority-seat{display:flex;align-items:center;gap:7px;margin-bottom:7px;color:#a7bdbc}
#vivoStudioAuthorityBridge .vivo-authority-seat select{flex:1}
#vivoStudioAuthorityBridge output{display:block;min-height:28px;margin-top:7px;color:#b9d4cc;white-space:pre-wrap;line-height:1.3}
@media(max-width:820px){#vivoStudioAuthorityBridge{right:10px;bottom:calc(245px + env(safe-area-inset-bottom));width:min(320px,calc(100vw - 20px));}}
`;
    doc.head.append(style);
    const root=doc.createElement('aside');root.id='vivoStudioAuthorityBridge';root.setAttribute('aria-label','Shared Studio object bridge');
    root.innerHTML=`<div class="vivo-authority-head"><span>SHARED OBJECT / ECHO</span><span data-vivo-authority-status>OFFLINE</span></div>
      <p class="vivo-authority-copy">Explicit projection only: Studio node 055 ↔ accepted root relic. Local physics, camera and World Eyes stay independent.</p>
      <label class="vivo-authority-seat">Authority seat <select data-vivo-authority-seat aria-label="Authority seat"><option value="one">Seat one</option><option value="two">Seat two</option></select></label>
      <div class="vivo-authority-controls"><button data-vivo-authority-connect type="button">Connect</button><button data-vivo-authority-refresh type="button" disabled>Refresh</button><button data-vivo-authority-apply type="button" disabled>Apply accepted</button><button data-vivo-authority-publish type="button" disabled>Publish Echo</button><button data-vivo-authority-fork type="button" disabled>Fork offline</button><button data-vivo-authority-xr type="button">Check AR / VR</button></div>
      <output data-vivo-authority-message aria-live="polite">Not connected. Accepted state is untouched.</output>`;
    doc.body.append(root);this.root=root;this.statusNode=root.querySelector('[data-vivo-authority-status]');this.messageNode=root.querySelector('[data-vivo-authority-message]');
    this.seatNode=root.querySelector('[data-vivo-authority-seat]');this.seatNode.value=this.seat;
    root.querySelector('[data-vivo-authority-seat]').addEventListener('change',event=>{this.seat=seatId(event.target.value);this.setMessage('Seat changed. Connect explicitly to that authority seat.');});
    root.querySelector('[data-vivo-authority-connect]').addEventListener('click',()=>this.connect().catch(error=>this.setMessage(error.message||String(error),'ERROR')));
    root.querySelector('[data-vivo-authority-refresh]').addEventListener('click',()=>this.refresh().catch(error=>this.setMessage(error.message||String(error),'ERROR')));
    root.querySelector('[data-vivo-authority-apply]').addEventListener('click',()=>this.applyAccepted().catch(error=>this.setMessage(error.message||String(error),'ERROR')));
    root.querySelector('[data-vivo-authority-publish]').addEventListener('click',()=>this.publish().catch(error=>this.setMessage(error.message||String(error),'ERROR')));
    root.querySelector('[data-vivo-authority-fork]').addEventListener('click',()=>this.forkOffline().catch(error=>this.setMessage(error.message||String(error),'ERROR')));
    root.querySelector('[data-vivo-authority-xr]').addEventListener('click',()=>this.checkXR().catch(error=>this.setMessage(error.message||String(error),'ERROR')));
    this.updateUI();
  }
  setMessage(message,status){
    this.message=String(message);if(this.messageNode)this.messageNode.textContent=this.message;
    if(this.statusNode)this.statusNode.textContent=status==='ERROR'?'ERROR':status==='CONFLICT'||this.publishConflict?'CONFLICT':this.transport&&!this.transport.closed?(this.localDiverged?'LOCAL DIVERGENCE':'CONNECTED'):'OFFLINE';
  }
  localQ(){try{return mapStudioNodeToCanonical(this.app.snapshot(),STUDIO_SOURCE_NODE);}catch{return null;}}
  currentBinding(){return this.state?.snapshot?.studioBindings?.[STUDIO_BINDING_ID]??null;}
  markLocalDivergence(){
    const local=this.localQ();
    if(this.lastApplied?.q&&local&&!same(local,this.lastApplied.q))this.localDiverged=true;
    return local;
  }
  async connect(){
    if(this.transport&&!this.transport.closed){this.setMessage('Already connected to '+this.seat+'.');return this.debug();}
    this.seat=seatId(this.seat);this.seatNode.value=this.seat;this.closed=false;
    const client=new LocalTransport({onState:state=>this.receive(state)});this.transport=client;
    let resume=null;try{resume=JSON.parse(sessionStorage.getItem(storageKey(this.seat))||'null')?.token??null;}catch{}
    let result;
    try{result=await client.admit(this.seat,resume);}catch(error){
      if(error.code==='SESSION_EXPIRED'){try{sessionStorage.removeItem(storageKey(this.seat));}catch{};result=await client.admit(this.seat);}
      else{this.transport=null;throw error;}
    }
    try{sessionStorage.setItem(storageKey(this.seat),JSON.stringify({token:result.token}));}catch{}
    this.receive(result.state);this.setMessage('Connected. Apply accepted state, or edit locally and publish explicitly.');this.schedulePoll();return this.debug();
  }
  async refresh(){
    if(!this.transport||this.transport.closed)throw Error('AUTHORITY_NOT_CONNECTED');
    this.markLocalDivergence();await this.transport.refresh();return this.debug();
  }
  schedulePoll(){clearTimeout(this.pollTimer);if(!this.transport||this.transport.closed)return;this.pollTimer=setTimeout(()=>this.refresh().catch(error=>{if(error.code!=='SESSION_EXPIRED')this.setMessage(error.message||String(error),'ERROR');}),700);}
  receive(state){
    if(!state?.snapshot)return;this.markLocalDivergence();const next=state.snapshot.studioBindings?.[STUDIO_BINDING_ID]??null;
    const changed=!this.remoteBinding||!next||next.bindingRevision!==this.remoteBinding.bindingRevision||next.acceptedSequence!==this.remoteBinding.acceptedSequence||!same(next.q,this.remoteBinding.q);
    this.state=copy(state);if(next)this.remoteBinding=copy(next);
    if(next&&changed){
      if(this.localDiverged){this.pendingRemote=copy(next);this.rememberConflict('STUDIO_CONFLICT','Accepted Echo changed while this Studio is locally divergent. Choose Apply accepted, or click Publish Echo again to explicitly replace it.',{acceptedBinding:next,acceptedSequence:state.snapshot.acceptedSequence});}
      else this.applyBinding(next,'Accepted Echo applied; Studio paused at the authority projection.');
    }
    this.updateUI();this.schedulePoll();
  }
  applyBinding(binding,message='Accepted Echo applied; Studio paused at the authority projection.'){
    const next=applyCanonicalBindingToStudioSnapshot(this.app.snapshot(),binding);this.app.applySnapshot(next);
    this.lastApplied={q:[...binding.q],bindingRevision:binding.bindingRevision,acceptedSequence:binding.acceptedSequence};this.localDiverged=false;this.pendingRemote=null;this.publishConflict=null;this.publishOverrideArmed=false;this.setMessage(message);this.updateUI();return this.debug();
  }
  async applyAccepted(){
    if(!this.remoteBinding)throw Error('STUDIO_BINDING_UNAVAILABLE');return this.applyBinding(this.remoteBinding,'Accepted Echo applied explicitly; local divergent Studio state was discarded.');
  }
  blockedPublish(code='STUDIO_CONFLICT'){
    return {status:'rejected',code,acceptedSequence:this.state?.snapshot?.acceptedSequence??null};
  }
  rememberConflict(code,message,{acceptedBinding=this.currentBinding(),acceptedSequence=this.state?.snapshot?.acceptedSequence??null,allowNextPublish=false}={}){
    const local=this.localQ();
    this.publishConflict={code,localQ:local?[...local]:null,acceptedBinding:acceptedBinding?copy(acceptedBinding):null,acceptedSequence,explicitRetryRequired:true};
    this.publishOverrideArmed=allowNextPublish;this.setMessage(message,'CONFLICT');this.updateUI();return this.blockedPublish(code);
  }
  async publish(){
    if(!this.transport||this.transport.closed)throw Error('AUTHORITY_NOT_CONNECTED');
    const q=this.markLocalDivergence();if(!q)throw Error('STUDIO_NODE_UNAVAILABLE');
    const conflict=this.publishConflict;
    if(conflict){
      if(!same(q,conflict.localQ)){
        this.publishConflict={...conflict,localQ:[...q]};this.publishOverrideArmed=false;
        this.setMessage('Local Echo changed after the conflict. Click Publish Echo again to explicitly replace accepted Echo, or Apply accepted.','CONFLICT');this.updateUI();return this.blockedPublish();
      }
      if(!this.publishOverrideArmed){
        this.publishOverrideArmed=true;this.setMessage('Conflict is visible. Click Publish Echo again to explicitly replace accepted Echo, or Apply accepted.','CONFLICT');this.updateUI();return this.blockedPublish();
      }
    }
    // Presence and observer registration advance the world sequence without
    // changing the binding.  Refresh before constructing the CAS command so
    // an ordinary two-client join does not turn a valid publish into a stale
    // command.  The authority CAS remains strict for a real concurrent edit.
    await this.transport.refresh();
    const freshQ=this.markLocalDivergence();if(!freshQ)throw Error('STUDIO_NODE_UNAVAILABLE');
    const freshBinding=this.currentBinding();
    if(conflict&&!sameBinding(freshBinding,conflict.acceptedBinding)){
      return this.rememberConflict('STUDIO_CONFLICT','Accepted Echo changed again. Apply accepted, or click Publish Echo again after reviewing the new accepted projection.',{acceptedBinding:freshBinding,acceptedSequence:this.state?.snapshot?.acceptedSequence});
    }
    if(!conflict&&this.publishConflict){
      this.publishOverrideArmed=false;this.setMessage('Accepted Echo changed while publish was preparing. Click Publish Echo again to explicitly replace it, or Apply accepted.','CONFLICT');this.updateUI();return this.blockedPublish();
    }
    const snapshot=this.transport.getSnapshot();const command=studioTransformCommand(snapshot,freshQ,{expectedRevision:snapshot.acceptedSequence,commandId:'studio.transform.'+crypto.randomUUID()});
    const receipt=await this.transport.submit(command);
    if(receipt.status!=='accepted'){
      if(receipt.code==='STALE_WORLD'){
        // The submit response already carries a current state, but make the
        // recovery explicit and never retry the rejected command implicitly.
        await this.transport.refresh();
        if(this.publishConflict){
          this.publishOverrideArmed=false;this.setMessage('Accepted Echo changed during publish. Review the accepted projection, then click Publish Echo again to explicitly replace it, or Apply accepted.','CONFLICT');this.updateUI();
        }else{
          this.rememberConflict('STALE_WORLD','Authority advanced during publish. Accepted state was refreshed; click Publish Echo again to explicitly retry.',{acceptedBinding:this.currentBinding(),acceptedSequence:this.state?.snapshot?.acceptedSequence,allowNextPublish:true});
        }
      }else this.setMessage('Publish rejected: '+receipt.code+'. Refresh and resolve explicitly.','ERROR');
      return receipt;
    }
    this.localDiverged=false;
    const accepted=this.state?.snapshot?.studioBindings?.[STUDIO_BINDING_ID]??receipt.result?.binding;
    if(accepted)this.applyBinding(accepted,'Echo transform accepted at sequence '+receipt.acceptedSequence+'. Studio paused at the accepted projection.');
    else this.setMessage('Echo transform accepted at sequence '+receipt.acceptedSequence+'.');
    return receipt;
  }
  async forkOffline(){
    if(!this.transport||this.transport.closed)throw Error('AUTHORITY_NOT_CONNECTED');
    const receipt=await this.transport.forkOffline({newWorldId:'offline:studio:'+crypto.randomUUID()});
    if(receipt.status!=='accepted')throw Error(receipt.code);const branch=receipt.result;downloadJSON('vivo-offline-'+branch.worldId.replace(/[^A-Za-z0-9_.-]/g,'_')+'.json',branch);
    this.setMessage('Explicit offline branch '+branch.worldId+' downloaded. No branch merge was attempted.');return branch;
  }
  async checkXR(){
    const secure=globalThis.isSecureContext===true,api=!!globalThis.navigator?.xr?.isSessionSupported;let ar=false,vr=false;
    if(secure&&api){try{ar=await navigator.xr.isSessionSupported('immersive-ar');}catch{}try{vr=await navigator.xr.isSessionSupported('immersive-vr');}catch{}}
    this.xr={secureContext:secure,webXRAPI:api,arSupported:ar,vrSupported:vr,sessionStarted:false};
    this.setMessage('XR capability only: immersive AR '+(ar?'available':'unavailable')+', VR '+(vr?'available':'unavailable')+'. No camera or XR session was started.');return copy(this.xr);
  }
  async close(){clearTimeout(this.pollTimer);if(this.transport&&!this.transport.closed)await this.transport.close();this.transport=null;this.state=null;this.remoteBinding=null;this.pendingRemote=null;this.localDiverged=false;this.publishConflict=null;this.publishOverrideArmed=false;this.updateUI();}
  updateUI(){
    if(!this.root)return;const connected=!!this.transport&&!this.transport.closed,local=this.markLocalDivergence();
    this.root.querySelector('[data-vivo-authority-connect]').disabled=connected;
    this.root.querySelector('[data-vivo-authority-refresh]').disabled=!connected;
    this.root.querySelector('[data-vivo-authority-apply]').disabled=!this.remoteBinding;
    this.root.querySelector('[data-vivo-authority-publish]').disabled=!connected||!local;
    this.root.querySelector('[data-vivo-authority-fork]').disabled=!connected;
    if(this.statusNode)this.statusNode.textContent=this.publishConflict?'CONFLICT':connected?(this.localDiverged?'LOCAL DIVERGENCE':'CONNECTED'):'OFFLINE';
  }
  debug(){
    this.markLocalDivergence();const snapshot=this.state?.snapshot;return {schema:'vivo.studio-authority-bridge/1',connected:!!this.transport&&!this.transport.closed,seat:this.seat,
      binding:this.remoteBinding?copy(this.remoteBinding):null,acceptedSequence:snapshot?.acceptedSequence??null,localProjection:this.localQ(),
      acceptedEntityQ:copy(snapshot?.spaces?.root?.entities?.relic?.q??null),
      lastApplied:this.lastApplied?copy(this.lastApplied):null,localDiverged:this.localDiverged,pendingRemote:this.pendingRemote?copy(this.pendingRemote):null,
      publishConflict:this.publishConflict?copy(this.publishConflict):null,publishOverrideArmed:this.publishOverrideArmed,
      authorityEye:copy(this.state?.eye??null),worldEyesIndependent:true,xr:this.xr?copy(this.xr):null};
  }
}

const bridge=new StudioAuthorityBridge();
globalThis.VivoStudioAuthorityBridge=StudioAuthorityBridge;
globalThis.__vivoStudioAuthorityBridge=bridge;
if(new URL(location.href).searchParams.get('vivoAuthority')==='1')bridge.connect().catch(error=>bridge.setMessage(error.message||String(error),'ERROR'));
