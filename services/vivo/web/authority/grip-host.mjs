/** Main-owned integration around PR #75. No camera or renderer state is mutated. */
import {GripController} from '../input/controller.mjs';
import {validateCommand, validateFrame, validateReceipt} from '../../contracts/validate.mjs';
const error = code => Object.assign(new Error(code), {code});
const copy = value => structuredClone(value);

export class GripHost {
  #authority; #session; #entries = new Map(); #closed = false; #options; #timers; #ports;
  static async open(authority, options = {}) {
    const session = await authority.open({});
    if (typeof authority.reconcileLease !== 'function' || typeof authority.renewLease !== 'function')
      throw error('LEASE_PORTS_REQUIRED');
    return new GripHost(GripHost, authority, session, options);
  }
  constructor(token, authority, session, options) {
    if (token !== GripHost) throw error('USE_OPEN');
    this.#authority=authority; this.#session=session;
    this.#options={...options,requestTimeoutMs:options.requestTimeoutMs??5000,
      acquisitionTimeoutMs:options.acquisitionTimeoutMs??options.requestTimeoutMs??5000,
      cleanupTimeoutMs:options.cleanupTimeoutMs??options.requestTimeoutMs??5000};
    for(const name of ['requestTimeoutMs','acquisitionTimeoutMs','cleanupTimeoutMs'])
      if(!Number.isFinite(this.#options[name])||this.#options[name]<=0||this.#options[name]>2147483647)
        throw error('INVALID_TIMING_BUDGET');
    // Browser timer methods are Web IDL methods: detached native references can
    // throw "Illegal invocation" when called as object properties. Keep custom
    // injected timers untouched for deterministic tests, but bind the browser
    // defaults to their owning global.
    this.#timers={
      set:options.setTimer??((...args)=>globalThis.setTimeout(...args)),
      clear:options.clearTimer??((...args)=>globalThis.clearTimeout(...args))
    };
    this.#ports={preview:options.onPreview??(()=>{}),receipt:options.onReceipt??(()=>{}),
      snapshot:options.onSnapshot??(()=>{}),status:options.onStatus??(()=>{})};
  }
  #notify(kind, ...args) { try { Promise.resolve(this.#ports[kind](...args)).catch(()=>{}); } catch {} }
  #live(key, entry) { return this.#entries.get(key)===entry; }
  state(key) {
    const e=this.#entries.get(key);
    return e ? {phase:e.phase,source:e.source,leaseId:e.leaseId??null,controller:e.controller?.state??null,
      reconciling:!!e.recovery,pendingRenewal:e.renewal!==null,
      acquisitionPending:e.acquisitionPending,cleanupConfirmed:e.cleanupConfirmed,fenced:e.fenced} : null;
  }
  #stopRenew(e) { if(e.renewal!==null) this.#timers.clear(e.renewal); e.renewal=null; }
  #renew(key,e) {
    this.#stopRenew(e);
    if(!this.#live(key,e)||e.phase!=='active'||this.#closed) return;
    e.renewal=this.#timers.set(async()=>{
      e.renewal=null;
      try { await this.#authority.renewLease(e.leaseId); this.#renew(key,e); }
      catch(err) {
        if(this.#live(key,e)&&e.phase==='active') {
          await this.#recover(key,e,{reason:'LEASE_RENEWAL_FAILED'}).catch(()=>{});
        }
      }
    }, Math.max(25,Math.floor(e.leaseMs/3)));
    e.renewal?.unref?.();
  }
  #deadline(promise,ms,code) {
    return new Promise((resolve,reject)=>{
      const timer=this.#timers.set(()=>reject(error(code)),ms);
      Promise.resolve(promise).then(resolve,reject).finally(()=>this.#timers.clear(timer));
    });
  }
  #fence(key,e) {
    e.fenced=true;e.cancelled=true;this.#stopRenew(e);
    // Public cancel synchronously discards mailbox intent. The submit port below
    // also fences the controller's delayed release/ACK continuations.
    if(e.controller) void e.controller.cancel('host-reconciliation').catch(()=>{});
    if(this.#live(key,e)) this.#notify('preview',key,null);
  }
  #onReconcile(key,e,event) {
    // This is accepted target evidence, not a failed release. The controller is
    // already cancelling and will release after its in-flight target settles.
    if(event.reason==='CANCELLED_IN_FLIGHT' && event.command?.kind==='grab.target'
        && event.receipt?.status==='accepted') return;
    return this.#recover(key,e,event);
  }
  async #recover(key,e,event={}) {
    if(e.cleanupConfirmed) return e.cleanupResult;
    if(e.recovery) return e.recovery;
    if(!e.leaseId) throw error('ACQUIRE_CLEANUP_UNCONFIRMED');
    // Install the shared recovery before cancelling: cancellation itself can
    // synchronously notify onReconcile on an already-blocked controller.
    const attempt=Promise.resolve().then(async()=>{
      const result=copy(await this.#authority.reconcileLease({...event,worldId:this.#session.worldId,
        authorityId:this.#session.authorityId,spaceId:e.entity.spaceId,entityId:e.entity.id,
        leaseId:e.leaseId,inputEpoch:e.inputEpoch}));
      if(result?.released!==true || result.snapshot?.authorityId!==this.#session.authorityId
          || result.snapshot?.worldId!==this.#session.worldId) throw error('RECONCILIATION_UNCONFIRMED');
      e.cleanupConfirmed=true;e.cleanupResult=result;e.phase='reconciled';
      if(this.#live(key,e)) this.#notify('snapshot',copy(result.snapshot));
      return result;
    });
    const recovery=this.#deadline(attempt,this.#options.cleanupTimeoutMs,'RECONCILIATION_UNCONFIRMED');
    e.recovery=recovery;e.phase='reconciling';this.#fence(key,e);
    try { return await recovery; }
    catch(err) {
      if(!e.cleanupConfirmed)e.phase='blocked';
      this.#notify('status',key,{code:err?.code??'RECONCILIATION_FAILED'});throw err;
    } finally { if(e.recovery===recovery)e.recovery=null; }
  }
  async #cleanupAcquisition(key,e) {
    if(e.cleanupConfirmed)return e.cleanupResult;
    this.#fence(key,e);
    if(!e.leaseId && typeof this.#authority.inspectLease==='function') {
      // An absent lease is not a fence on an acquisition still in transport.
      // Owner/source/epoch alone can also describe another key's rejected grab.
      // Adoption additionally requires the exact accepted acquisition command.
      let known;
      try {
        known=await this.#deadline(Promise.resolve().then(()=>
          this.#authority.inspectLease(e.entity.spaceId,e.entity.id,{source:e.source,inputEpoch:e.inputEpoch,acquireCommandId:e.acquireCommandId})),
          this.#options.cleanupTimeoutMs,'ACQUIRE_CLEANUP_UNCONFIRMED');
      } catch(err) {
        if(e.cleanupConfirmed)return e.cleanupResult;
        if(!e.leaseId)throw err;
      }
      // A late authoritative receipt can settle or identify this acquisition
      // while inspection is pending. Its evidence wins over the older lookup.
      if(e.cleanupConfirmed)return e.cleanupResult;
      if(!e.leaseId && known?.acquireCommandId===e.acquireCommandId && known.actorId===this.#session.actorId
          && known.inputEpoch===e.inputEpoch && known.source===e.source
          && known.spaceId===e.entity.spaceId && known.entityId===e.entity.id) e.leaseId=known.id;
    }
    if(e.leaseId)return this.#recover(key,e);
    e.phase='blocked';throw error('ACQUIRE_CLEANUP_UNCONFIRMED');
  }
  #acquireReceipt(key,e,command,raw,late) {
    const r=copy(validateReceipt(raw));
    if(r.id!==command.id||r.authorityId!==this.#session.authorityId) throw error('ACQUIRE_RECEIPT_MISMATCH');
    // Observers may normalize or annotate evidence, but never the receipt or
    // nested acquisition result that drives our ownership/cleanup decisions.
    this.#notify('receipt',key,copy({command,receipt:r,late,cancelled:e.cancelled}));
    if(r.status!=='accepted') {
      e.cleanupConfirmed=true;
      if(e.phase!=='reconciled')e.phase='closed';
      throw error(r.code);
    }
    const leaseId=r.result?.leaseId,leaseMs=r.result?.leaseMs,accepted=r.result?.entity;
    if(typeof leaseId!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(leaseId)
        ||(e.leaseId!==null&&e.leaseId!==leaseId)) throw error('ACQUIRE_RESULT_MISMATCH');
    e.leaseId=leaseId; // Keep the capability for cleanup even if the remaining result is malformed.
    validateFrame(accepted);
    if(accepted.id!==e.entity.id||accepted.spaceId!==e.entity.spaceId||accepted.chart!==e.entity.chart
        ||accepted.dimension!==e.entity.dimension||accepted.revision!==r.entityRevision
        ||!Number.isFinite(leaseMs)||leaseMs<100||leaseMs>60000)
      throw error('ACQUIRE_RESULT_MISMATCH');
    e.entity=copy(accepted);e.leaseMs=leaseMs;
    return r;
  }
  async #lateAcquisition(key,e,command,fulfilled,value) {
    try {if(fulfilled)this.#acquireReceipt(key,e,command,value,true);} catch { /* Keep uncertainty. */ }
    if(!e.cleanupConfirmed) {
      await this.#cleanupAcquisition(key,e).catch(()=>{});
      if(!e.cleanupConfirmed)this.#notify('status',key,{code:'LATE_ACQUISITION_UNCONFIRMED'});
    }
  }
  #requestAcquisition(key,e,command) {
    return new Promise((resolve,reject)=>{
      let settled=false;
      const timer=this.#timers.set(()=>{settled=true;reject(error('ACQUIRE_UNCERTAIN'));},this.#options.acquisitionTimeoutMs);
      const finish=(fulfilled,value)=>{
        e.acquisitionPending=false;
        if(settled) {void this.#lateAcquisition(key,e,command,fulfilled,value);return;}
        settled=true;this.#timers.clear(timer);
        if(fulfilled)resolve(value);else reject(error('ACQUIRE_UNCERTAIN'));
      };
      try {Promise.resolve(this.#authority.submit(command)).then(v=>finish(true,v),v=>finish(false,v));}
      catch(v) {finish(false,v);}
    });
  }
  async begin(key,{entity,source,inputEpoch,cooperativeGroup=null}) {
    if(this.#closed) throw error('HOST_CLOSED');
    if(typeof key!=='string'||!key.length) throw error('SOURCE_KEY_REQUIRED');
    validateFrame(entity);
    const old=this.#entries.get(key);
    if(old&&!['closed','reconciled'].includes(old.phase)) throw error('SOURCE_BUSY');
    if(cooperativeGroup!==null&&(typeof cooperativeGroup!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(cooperativeGroup)))throw error('INVALID_COOPERATIVE_GROUP');
    const e={entity:copy(entity),source,inputEpoch,cooperativeGroup,phase:'acquiring',controller:null,
      cancelled:false,leaseId:null,leaseMs:3000,recovery:null,renewal:null,
      fenced:false,cleanupConfirmed:false,cleanupResult:null,acquisition:null,acquisitionPending:true};
    const idPrefix='host.'+crypto.randomUUID();
    const command=validateCommand({schema:'vivo.command/1',id:idPrefix+':acquire',worldId:this.#session.worldId,
      spaceId:entity.spaceId,kind:'grab.begin',expectedRevision:entity.revision,payload:{entityId:entity.id,source,inputEpoch,...(cooperativeGroup?{cooperativeGroup}:{})}});
    e.acquireCommandId=command.id;
    this.#entries.set(key,e);
    e.acquisition=this.#beginAcquisition(key,e,command,idPrefix);
    return e.acquisition;
  }
  async #beginAcquisition(key,e,command,idPrefix) {
    try {
      const r=this.#acquireReceipt(key,e,command,await this.#requestAcquisition(key,e,command),false);
      if(this.#closed||e.cancelled||e.fenced)throw error('ACQUIRE_CANCELLED');
      e.controller=new GripController({session:this.#session,idPrefix,acceptedSequence:r.acceptedSequence,
        submit:c=>{if(e.fenced)throw error('HOST_FENCED');return this.#authority.submit(c);},now:this.#options.now,
        setTimer:this.#timers.set,clearTimer:this.#timers.clear,requestTimeoutMs:this.#options.requestTimeoutMs??5000,
        onPreview:v=>{if(this.#live(key,e))this.#notify('preview',key,copy(v));},
        onReceipt:v=>this.#notify('receipt',key,v),
        onStatus:v=>this.#notify('status',key,v),
        onReconcile:event=>this.#onReconcile(key,e,event)});
      e.controller.begin({entity:e.entity,leaseId:e.leaseId,source:e.source,inputEpoch:e.inputEpoch});
      e.phase='active';this.#renew(key,e);
      return this.state(key);
    } catch(err) {
      if(!e.cleanupConfirmed) {
        try {await this.#cleanupAcquisition(key,e);}
        catch {
          if(!e.cleanupConfirmed)e.phase='blocked';
          if(err?.code==='ACQUIRE_CANCELLED')throw error('ACQUIRE_CLEANUP_UNCONFIRMED');
        }
      }
      throw err;
    }
  }
  offer(key,frame,observedAt) {
    const e=this.#entries.get(key);
    return !this.#closed&&e?.phase==='active' ? e.controller.offer(frame,observedAt) : false;
  }
  async end(key,reason,finalSample=null) {
    const e=this.#entries.get(key);if(!e) return;
    if(e.phase==='acquiring') return this.cancel(key,reason);
    if(e.cleanupConfirmed)return;
    if(e.fenced||!e.controller)return this.reconcile(key);
    // End capture before inspecting application-provided final data. Validation,
    // getters or frame conversion may throw; none may strand a renewing grip.
    this.#stopRenew(e);e.phase='ending';
    if(finalSample!==null) {
      let offered=false;
      try { offered=e.controller.offer(finalSample.frame,finalSample.observedAt); }
      catch { /* Invalid final data is cancelled, never timestamp-refreshed. */ }
      if(!offered) {
        try { await this.cancel(key,'invalid-final-sample'); }
        catch { throw error('FINAL_SAMPLE_CLEANUP_UNCONFIRMED'); }
        throw error('FINAL_SAMPLE_REJECTED');
      }
    }
    try { await e.controller.end(reason);if(!e.fenced){e.phase='closed';e.cleanupConfirmed=true;} }
    catch(err) { if(e.controller.state.phase==='closed'&&!e.fenced){e.phase='closed';e.cleanupConfirmed=true;}else await this.#recover(key,e).catch(()=>{});throw err; }
  }
  async cancel(key,reason='cancelled') {
    const e=this.#entries.get(key);if(!e) return;
    e.cancelled=true;this.#stopRenew(e);
    if(e.cleanupConfirmed)return e.cleanupResult;
    if(e.phase==='acquiring') {
      await e.acquisition.catch(()=>{});
      if(!e.cleanupConfirmed)throw error('ACQUIRE_CLEANUP_UNCONFIRMED');
      return e.cleanupResult;
    }
    if(!e.controller)return this.#cleanupAcquisition(key,e);
    if(e.fenced)return this.#recover(key,e);
    e.phase='cancelling';
    try {
      await e.controller.cancel(reason);
      if(!e.fenced){e.phase='closed';e.cleanupConfirmed=true;}
    } catch {return this.#recover(key,e);}
    if(e.recovery)await e.recovery;
    if(!e.cleanupConfirmed)throw error('RECONCILIATION_UNCONFIRMED');
  }
  async cancelSource(source,reason,key) {
    const matches=[...this.#entries].filter(([k,e])=>e.source===source&&(key===undefined||key===k));
    const results=await Promise.allSettled(matches.map(([k])=>this.cancel(k,reason)));
    const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);
    if(errors.length)throw new AggregateError(errors,'Source cleanup incomplete');
  }
  async reconcile(key) {
    const e=this.#entries.get(key);if(!e)return;
    if(e.phase==='acquiring') {this.#fence(key,e);return this.cancel(key,'host-reconciliation');}
    return e.leaseId?this.#recover(key,e):this.#cleanupAcquisition(key,e);
  }
  async close() {
    this.#closed=true;
    const results=await Promise.allSettled([...this.#entries].map(([key])=>this.cancel(key,'host-closed')));
    if(results.some(r=>r.status==='rejected')) throw error('CLOSE_REQUIRES_RECONCILIATION');
  }
}
