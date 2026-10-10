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
    this.#authority=authority; this.#session=session; this.#options=options;
    this.#timers={set:options.setTimer??setTimeout,clear:options.clearTimer??clearTimeout};
    this.#ports={preview:options.onPreview??(()=>{}),receipt:options.onReceipt??(()=>{}),
      snapshot:options.onSnapshot??(()=>{}),status:options.onStatus??(()=>{})};
  }
  #notify(kind, ...args) { try { Promise.resolve(this.#ports[kind](...args)).catch(()=>{}); } catch {} }
  #live(key, entry) { return this.#entries.get(key)===entry; }
  state(key) {
    const e=this.#entries.get(key);
    return e ? {phase:e.phase,source:e.source,leaseId:e.leaseId??null,controller:e.controller?.state??null,
      reconciling:!!e.recovery,pendingRenewal:e.renewal!==null} : null;
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
          e.phase='blocked';
          void e.controller.cancel('lease-renewal-failed').catch(()=>{});
          await this.#recover(key,e,{reason:'LEASE_RENEWAL_FAILED'}).catch(()=>{});
        }
      }
    }, Math.max(25,Math.floor(e.leaseMs/3)));
    e.renewal?.unref?.();
  }
  async #recover(key,e,event={}) {
    if(e.recovery) return e.recovery;
    this.#stopRenew(e);
    if(this.#live(key,e)) this.#notify('preview',key,null);
    e.phase='reconciling';
    e.recovery=(async()=>{
      const result=await this.#authority.reconcileLease({...event,worldId:this.#session.worldId,
        authorityId:this.#session.authorityId,spaceId:e.entity.spaceId,entityId:e.entity.id,
        leaseId:e.leaseId,inputEpoch:e.inputEpoch});
      if(!result?.released || result.snapshot?.authorityId!==this.#session.authorityId
          || result.snapshot?.worldId!==this.#session.worldId) throw error('RECONCILIATION_UNCONFIRMED');
      e.phase='reconciled';
      if(this.#live(key,e)) this.#notify('snapshot',copy(result.snapshot));
      return result;
    })();
    try { return await e.recovery; }
    catch(err) { e.phase='blocked'; this.#notify('status',key,{code:err.code??'RECONCILIATION_FAILED'}); throw err; }
    finally { e.recovery=null; }
  }
  async begin(key,{entity,source,inputEpoch}) {
    if(this.#closed) throw error('HOST_CLOSED');
    if(typeof key!=='string'||!key.length) throw error('SOURCE_KEY_REQUIRED');
    validateFrame(entity);
    const old=this.#entries.get(key);
    if(old&&!['closed','reconciled'].includes(old.phase)) throw error('SOURCE_BUSY');
    const e={entity:copy(entity),source,inputEpoch,phase:'acquiring',controller:null,
      cancelled:false,leaseId:null,leaseMs:3000,recovery:null,renewal:null};
    const idPrefix='host.'+crypto.randomUUID();
    const command=validateCommand({schema:'vivo.command/1',id:idPrefix+':acquire',worldId:this.#session.worldId,
      spaceId:entity.spaceId,kind:'grab.begin',expectedRevision:entity.revision,payload:{entityId:entity.id,source,inputEpoch}});
    this.#entries.set(key,e);
    try {
      const r=copy(validateReceipt(await this.#authority.submit(command)));
      if(r.id!==command.id||r.authorityId!==this.#session.authorityId) throw error('ACQUIRE_RECEIPT_MISMATCH');
      if(r.status!=='accepted') { e.phase='closed'; throw error(r.code); }
      e.leaseId=r.result?.leaseId; e.leaseMs=r.result?.leaseMs;
      const accepted=r.result?.entity; validateFrame(accepted);
      if(accepted.id!==entity.id||accepted.spaceId!==entity.spaceId||accepted.chart!==entity.chart
          ||accepted.dimension!==entity.dimension||accepted.revision!==r.entityRevision
          ||typeof e.leaseId!=='string'||!Number.isFinite(e.leaseMs)||e.leaseMs<100||e.leaseMs>60000)
        throw error('ACQUIRE_RESULT_MISMATCH');
      e.entity=copy(accepted);
      if(this.#closed||e.cancelled) { await this.#recover(key,e); throw error('ACQUIRE_CANCELLED'); }
      e.controller=new GripController({session:this.#session,idPrefix,acceptedSequence:r.acceptedSequence,
        submit:c=>this.#authority.submit(c),now:this.#options.now,
        setTimer:this.#timers.set,clearTimer:this.#timers.clear,requestTimeoutMs:this.#options.requestTimeoutMs??5000,
        onPreview:v=>{if(this.#live(key,e))this.#notify('preview',key,copy(v));},
        onReceipt:v=>this.#notify('receipt',key,v),
        onStatus:v=>this.#notify('status',key,v),
        onReconcile:event=>this.#recover(key,e,event)});
      e.controller.begin({entity:e.entity,leaseId:e.leaseId,source,inputEpoch});
      e.phase='active';this.#renew(key,e);
      return this.state(key);
    } catch(err) {
      if(e.leaseId&&e.phase!=='reconciled') await this.#recover(key,e).catch(()=>{});
      if(e.phase==='acquiring') {
        const known=this.#authority.inspectLease?.(entity.spaceId,entity.id);
        if(known?.inputEpoch===inputEpoch&&known.source===source) {
          e.leaseId=known.id;await this.#recover(key,e).catch(()=>{});
        } else e.phase='blocked';
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
    if(e.phase==='acquiring') { e.cancelled=true; return; }
    if(!e.controller) return;
    if(finalSample&&!e.controller.offer(finalSample.frame,finalSample.observedAt)) {
      await this.cancel(key,'invalid-final-sample');throw error('FINAL_SAMPLE_REJECTED');
    }
    this.#stopRenew(e);e.phase='ending';
    try { await e.controller.end(reason);e.phase='closed'; }
    catch(err) { if(e.controller.state.phase==='closed')e.phase='closed';else await this.#recover(key,e).catch(()=>{});throw err; }
  }
  async cancel(key,reason='cancelled') {
    const e=this.#entries.get(key);if(!e) return;
    e.cancelled=true;this.#stopRenew(e);
    if(e.phase==='acquiring') return;
    if(!e.controller) {if(e.leaseId)await this.#recover(key,e);return;}
    try { await e.controller.cancel(reason);if(!e.recovery)e.phase='closed'; }
    catch(err) {await this.#recover(key,e);}
    if(e.recovery) await e.recovery;
  }
  async cancelSource(source,reason,key) {
    const matches=[...this.#entries].filter(([k,e])=>e.source===source&&(key===undefined||key===k));
    const results=await Promise.allSettled(matches.map(([k])=>this.cancel(k,reason)));
    const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);
    if(errors.length)throw new AggregateError(errors,'Source cleanup incomplete');
  }
  async reconcile(key) { const e=this.#entries.get(key);if(e?.leaseId)return this.#recover(key,e); }
  async close() {
    this.#closed=true;
    const results=await Promise.allSettled([...this.#entries].map(([key])=>this.cancel(key,'host-closed')));
    if(results.some(r=>r.status==='rejected')) throw error('CLOSE_REQUIRES_RECONCILIATION');
  }
}
