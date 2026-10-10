import {TargetMailbox} from '../../../../research/vivo-phase-fabric/web/target-mailbox.mjs';
import {validateCommand, validateFrame, validateReceipt} from '../../contracts/validate.mjs';

export class InputError extends Error {
  constructor(code, message = code) { super(message); this.name = 'InputError'; this.code = code; }
}
const freeze = (value, seen = new WeakSet()) => {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value); for (const child of Object.values(value)) freeze(child, seen);
    Object.freeze(value);
  }
  return value;
};
const frameCopy = f => freeze({spaceId:f.spaceId, chart:f.chart, dimension:f.dimension, q:[...f.q]});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a,b) => { resolve=a; reject=b; });
  // A fault can precede end/cancel. Preserve rejection for callers without an unhandled rejection.
  promise.catch(() => {});
  return {promise, resolve, reject};
};
function reasonText(reason) {
  if (typeof reason !== 'string' || !reason.length || reason.length > 120) throw new TypeError('Release reason must be 1-120 characters');
  return reason;
}

/** One leased input stream. Does not acquire leases, transform pixels, or mutate material. */
export class GripController {
  constructor({session, submit, onReconcile, onPreview=()=>{}, onReceipt=()=>{}, onStatus=()=>{},
    now=()=>performance.now(), setTimer=setTimeout, clearTimer=clearTimeout,
    maxAgeMs=150, requestTimeoutMs=5000, acceptedSequence=0,
    idPrefix='input.' + globalThis.crypto.randomUUID()}) {
    if (!session || !['local','remote'].includes(session.mode) || typeof submit !== 'function' || typeof onReconcile !== 'function') throw new TypeError('Session, submit and reconciliation notification port required');
    if (![onPreview,onReceipt,onStatus,now,setTimer,clearTimer].every(f=>typeof f==='function')) throw new TypeError('Invalid adapter port');
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || maxAgeMs > 150 || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > 2147483647) throw new TypeError('Invalid timing budget');
    if (!Number.isSafeInteger(acceptedSequence) || acceptedSequence < 0 || typeof idPrefix !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(idPrefix)) throw new TypeError('Invalid sequence or command ID prefix');
    if (typeof session.authorityId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(session.authorityId)) throw new TypeError('Invalid authority identity');
    this.session = freeze({mode:session.mode, worldId:session.worldId, authorityId:session.authorityId});
    this.ports = {submit,onReconcile,onPreview,onReceipt,onStatus};
    this.now=now; this.setTimer=setTimer; this.clearTimer=clearTimer;
    this.maxAgeMs=maxAgeMs; this.requestTimeoutMs=requestTimeoutMs;
    this.idPrefix=idPrefix; this.serial=0; this.lastEpoch=-1; this.acceptedSequence=acceptedSequence;
    this.grip=null; this.disposed=false; this.observerErrors=0;
  }
  get source() { return this.grip?.source ?? null; }
  get mode() { return this.session.mode; }
  get state() {
    const g=this.grip;
    return freeze({phase:this.disposed?'disposed':g?.phase??'idle', source:this.source,
      entityId:g?.entityId??null, leaseId:g?.leaseId??null, inputEpoch:g?.inputEpoch??null,
      entityRevision:g?.revision??null, acceptedSequence:this.acceptedSequence,
      targetSeq:g?.mail.sequence??0, pendingTargetSeq:g?.mail.pending?.sequence??null,
      inFlight:!!g?.mail.flight || g?.phase==='releasing', cancelled:!!g?.cancelled,
      error:g?.error?.code??null, observerErrors:this.observerErrors});
  }
  _notify(name, event) {
    try {
      const result=this.ports[name](event);
      if (result && typeof result.then==='function') Promise.resolve(result).catch(()=>{this.observerErrors++;});
    } catch { this.observerErrors++; }
  }
  _clock() {
    const t=this.now();
    if (!Number.isFinite(t)) throw new InputError('INVALID_CLOCK');
    return t;
  }
  _command(g, kind, payload) {
    return freeze(validateCommand({schema:'vivo.command/1', id:`${this.idPrefix}:${++this.serial}`,
      worldId:this.session.worldId, spaceId:g.frame.spaceId, kind,
      expectedRevision:g.revision, payload}));
  }
  begin({entity,leaseId,source,inputEpoch}) {
    if (this.disposed) throw new InputError('DISPOSED');
    if (this.grip && (this.grip.phase!=='closed' || this.grip.mail.flight)) throw new InputError('GRIP_NOT_SETTLED');
    validateFrame(entity);
    if (!Number.isSafeInteger(inputEpoch) || inputEpoch <= this.lastEpoch) throw new InputError('EPOCH_NOT_NEW');
    const g={entityId:entity.id, leaseId, source, inputEpoch, frame:frameCopy(entity),
      revision:entity.revision, phase:'active', cancelled:false, latest:null, acceptedTargetSeq:0,
      done:deferred(), endPromise:null, kick:null, reason:null, error:null, finalError:null};
    // Validate ownership fields with the frozen envelope guards, without issuing grab.begin.
    this._command(g,'grab.begin',{entityId:g.entityId,source,inputEpoch});
    this._command(g,'grab.end',{entityId:g.entityId,leaseId,inputEpoch,reason:'validate-only'});
    g.mail=new TargetMailbox({now:()=>this._clock(), maxAgeMs:this.maxAgeMs,
      send:message=>this._target(g,message),
      preview:p=>{
        const frame=frameCopy({...g.frame,q:p.position.slice(0,g.frame.dimension)});
        g.latest=freeze({frame,observedAt:g.observedAt,targetSeq:p.sequence}); g.finalError=null;
        this._notify('onPreview',freeze({provisional:true,entityId:g.entityId,leaseId:g.leaseId,
          source:g.source,inputEpoch:g.inputEpoch,targetSeq:p.sequence,frame}));
      },
      status:message=>{
        if (message==='stale-pending-target-discarded') this._drop(g,g.latest?.targetSeq);
        this._notify('onStatus',freeze({source:g.source,inputEpoch:g.inputEpoch,message}));
        this._kick(g);
      }});
    // Reference mailbox is a scheduler, not a spatial solver. Its 3D minimum is
    // accommodated by one internal zero for 2D; the wire and preview remain 2D.
    // Its revision is only an internal completion counter; never a material revision.
    g.mail.begin({entity:g.entityId,dimension:Math.max(3,g.frame.dimension),revision:0});
    this.grip=g; this.lastEpoch=inputEpoch;
  }
  offer(target, observedAt) {
    const g=this.grip;
    if (this.disposed || !g || g.phase!=='active') return false;
    validateFrame(target);
    if (target.spaceId!==g.frame.spaceId || target.chart!==g.frame.chart || target.dimension!==g.frame.dimension) throw new InputError('FRAME_MISMATCH','Transform into the leased frame before offer');
    const age=this._clock()-observedAt;
    if (!Number.isFinite(observedAt) || age < -5 || age > this.maxAgeMs) return false;
    g.observedAt=observedAt;
    const q=[...target.q]; if (q.length===2) q.push(0);
    return g.mail.offer(q,observedAt);
  }
  end(reason) {
    reasonText(reason); const g=this.grip;
    if (!g) return Promise.resolve();
    if (!g.endPromise) {
      g.endPromise=g.done.promise.then(()=>{
        if (g.cancelled) throw new InputError('END_CANCELLED');
        if (g.finalError) throw g.finalError;
      });
      g.endPromise.catch(()=>{});
    }
    if (g.phase==='active') { g.phase='ending'; g.reason=reason; this._kick(g); }
    return g.endPromise;
  }
  cancel(reason) {
    reasonText(reason); const g=this.grip;
    if (!g) return Promise.resolve();
    if (g.phase==='blocked' && !g.cancelled) {
      g.cancelled=true; g.reason=reason; this._notify('onPreview',null);
      this._reconcile(g,new InputError('CANCEL_REQUIRES_RECONCILIATION',reason),g.failureCommand??null);
    }
    if (!['closed','blocked'].includes(g.phase)) {
      g.cancelled=true; g.reason=reason;
      if (g.phase!=='releasing') g.phase='cancelling';
      g.mail.cancel(reason); this._notify('onPreview',null); this._kick(g);
    }
    return g.done.promise;
  }
  async dispose() {
    this.disposed=true;
    await this.cancel('disposed');
  }
  _drop(g, targetSeq) {
    const isLatest=targetSeq===g.latest?.targetSeq;
    if (isLatest) {
      g.finalError=new InputError('FINAL_TARGET_STALE','Latest target expired before send; lease cleanup is separate');
      this._notify('onPreview',null);
    }
    this._notify('onStatus',freeze({source:g.source,inputEpoch:g.inputEpoch,message:'target-expired',targetSeq}));
  }
  _kick(g) {
    if (g.kick!==null) return;
    // A task, not a render hook or polling loop: mailbox Promise finalizers run first.
    g.kick=this.setTimer(()=>{g.kick=null; this._advance(g);},0);
  }
  _advance(g) {
    if (g!==this.grip || !['ending','cancelling'].includes(g.phase) || g.mail.flight || g.mail.pending) return;
    g.phase='releasing';
    void this._release(g);
  }
  async _target(g, message) {
    let command=null;
    try {
      if (g!==this.grip || !['active','ending'].includes(g.phase)) return {revision:message.expectedRevision+1};
      const age=this._clock()-message.observedAt;
      if (age < -5 || age > this.maxAgeMs) {
        this._drop(g,message.sequence); return {revision:message.expectedRevision+1};
      }
      command=this._command(g,'grab.target',{entityId:g.entityId,leaseId:g.leaseId,source:g.source,
        inputEpoch:g.inputEpoch,targetSeq:message.sequence,dimension:g.frame.dimension,chart:g.frame.chart,
        q:message.position.slice(0,g.frame.dimension),sampleAgeMs:Math.max(0,age)});
      const receipt=await this._request(g,command);
      this._accept(g,command,receipt);
      g.acceptedTargetSeq=message.sequence;
      if (g.cancelled) this._reconcile(g,new InputError('CANCELLED_IN_FLIGHT'),command,receipt);
      return {revision:message.expectedRevision+1};
    } catch (error) {
      this._fail(g,error,command); throw error;
    } finally { this._kick(g); }
  }
  _checked(command, raw) {
    const r=freeze(structuredClone(validateReceipt(raw)));
    if (r.id!==command.id || r.authorityId!==this.session.authorityId) throw new InputError('RECEIPT_MISMATCH');
    return r;
  }
  _request(g, command) {
    return new Promise((resolve,reject)=>{
      let settled=false;
      const timer=this.setTimer(()=>{
        settled=true; reject(new InputError('TRANSPORT_UNCERTAIN','Receipt deadline elapsed; do not retry or assume rollback'));
      },this.requestTimeoutMs);
      const finish=(raw,error)=>{
        if (settled) {
          let receipt=null;
          try { if (!error) receipt=this._checked(command,raw); } catch { /* retain uncertainty */ }
          // A late valid receipt is evidence for the adapter, never permission to resume.
          if (receipt) this._notify('onReceipt',freeze({command,receipt,late:true,cancelled:g.cancelled}));
          this._reconcile(g,new InputError('LATE_OUTCOME'),command,receipt);
          return;
        }
        settled=true; this.clearTimer(timer);
        if (error) { reject(new InputError('TRANSPORT_UNCERTAIN',String(error.message??error))); return; }
        try { resolve(this._checked(command,raw)); } catch (e) { reject(e); }
      };
      try { Promise.resolve(this.ports.submit(command)).then(r=>finish(r,null),e=>finish(null,e)); }
      catch (e) { finish(null,e); }
    });
  }
  _accept(g, command, receipt) {
    if (receipt.acceptedSequence < this.acceptedSequence) throw new InputError('STALE_RECEIPT');
    if (receipt.status==='rejected') {
      this._notify('onReceipt',freeze({command,receipt,late:false,cancelled:g.cancelled}));
      throw new InputError('AUTHORITY_REJECTED',receipt.code);
    }
    if (receipt.acceptedSequence <= this.acceptedSequence || receipt.entityRevision===null || receipt.entityRevision < g.revision) throw new InputError('STALE_RECEIPT');
    g.revision=receipt.entityRevision; this.acceptedSequence=receipt.acceptedSequence;
    this._notify('onReceipt',freeze({command,receipt,late:false,cancelled:g.cancelled}));
  }
  async _release(g) {
    let command=null;
    try {
      command=this._command(g,'grab.end',{entityId:g.entityId,leaseId:g.leaseId,inputEpoch:g.inputEpoch,reason:g.reason});
      const receipt=await this._request(g,command); this._accept(g,command,receipt);
      g.phase='closed'; g.mail.cancel('lease-release-accepted');
      this._notify('onPreview',null); g.done.resolve();
    } catch (error) { this._fail(g,error,command); }
  }
  _reconcile(g,error,command,receipt=null) {
    this._notify('onReconcile',freeze({reason:error.code??'INPUT_FAILURE',message:error.message,
      worldId:this.session.worldId,authorityId:this.session.authorityId,spaceId:g.frame.spaceId,
      entityId:g.entityId,leaseId:g.leaseId,source:g.source,inputEpoch:g.inputEpoch,
      command,receipt,latest:g.latest,cancelled:g.cancelled}));
  }
  _fail(g,error,command) {
    if (g.error) return;
    g.error=error instanceof InputError?error:new InputError('INPUT_FAILURE',error.message);
    g.failureCommand=command; g.phase='blocked'; g.mail.cancel('reconciliation-required');
    this._notify('onPreview',null); this._reconcile(g,g.error,command); g.done.reject(g.error);
  }
}

/** Explicit source keys; no global hand-release operation can accidentally release touch. */
export class InputSources {
  constructor() { this.controllers=new Map(); }
  add(key, controller) {
    if (typeof key!=='string' || !key.length || this.controllers.has(key) || !(controller instanceof GripController) || !controller.source) throw new TypeError('Unique source key and begun controller required');
    if ([...this.controllers.values()].includes(controller)) throw new TypeError('Controller already registered');
    this.controllers.set(key,controller); return controller;
  }
  remove(key) {
    const c=this.controllers.get(key);
    if (c && !['closed','disposed'].includes(c.state.phase)) throw new InputError('GRIP_NOT_SETTLED');
    return this.controllers.delete(key);
  }
  async _cancel(entries, reason) {
    reasonText(reason);
    const results=await Promise.allSettled(entries.map(([,c])=>c.cancel(reason)));
    const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);
    if (errors.length) throw new AggregateError(errors,'Some grips need authority reconciliation');
  }
  cancelSource(source, reason, key) {
    return this._cancel([...this.controllers].filter(([k,c])=>c.source===source && (key===undefined || key===k)),reason);
  }
  cancelAll(reason) { return this._cancel([...this.controllers],reason); }
  disconnect(reason='disconnected') { return this._cancel([...this.controllers].filter(([,c])=>c.mode==='remote'),reason); }
}
