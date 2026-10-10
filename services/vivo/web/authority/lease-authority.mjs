/** Local, single-writer canonical lease authority. Targets are constraints, NOT physics.
 * The host supplies validated world state. No network, camera, render, or material loop.
 */
import {validateCommand, validateFrame, validateReceipt} from '../../contracts/validate.mjs';
const clone = value => structuredClone(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const sha256 = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(canonical(value)))), b => b.toString(16).padStart(2, '0')).join('');
const fail = code => { throw Object.assign(new Error(code), {code}); };
const key = (...parts) => JSON.stringify(parts);
const uuid = () => crypto.randomUUID();

/** Atomic in-process test/personal-session store; explicitly volatile, not disk persistence. */
export class MemoryAuthorityStore {
  #value = null;
  async load() { return clone(this.#value); }
  async compareAndSwap(expected, value) {
    if ((this.#value?.digest ?? null) !== expected) fail('STORE_CONFLICT');
    this.#value = clone(value);
  }
}

function validateSeed(s) {
  if (!s || s.schema !== 'vivo.snapshot/1' || !validId(s.worldId) || !validId(s.authorityId)
      || !Number.isSafeInteger(s.acceptedSequence) || s.acceptedSequence < 0
      || !Number.isFinite(s.simulationTime) || s.simulationTime < 0
      || !s.spaces || !Object.hasOwn(s.spaces, s.rootSpaceId)) fail('INVALID_SNAPSHOT');
  for (const [sid, space] of Object.entries(s.spaces)) {
    if (sid !== space.id || !validId(sid) || !Number.isInteger(space.dimension)
        || space.dimension < 2 || space.dimension > 11 || !space.entities) fail('INVALID_SPACE');
    for (const [eid, e] of Object.entries(space.entities)) {
      validateFrame(e);
      if (e.id !== eid || !validId(eid) || e.spaceId !== sid || e.dimension !== space.dimension
          || !Number.isSafeInteger(e.revision) || e.revision < 0) fail('INVALID_ENTITY');
      if (!Array.isArray(e.v) || e.v.length !== e.dimension || !e.v.every(Number.isFinite)) fail('INVALID_VELOCITY');
      if (e.innerSpaceId !== null && !Object.hasOwn(s.spaces, e.innerSpaceId)) fail('MISSING_INNER_SPACE');
    }
  }
}

/** Host-owned factory. attach() is privileged local admission, not remote authentication. */
export class LocalLeaseWorld {
  #state; #record; #store; #clock; #tail = Promise.resolve(); #clients = new Map();
  #ttl; #limit;
  constructor(token, record, store, clock, ttl, limit) {
    if (token !== LocalLeaseWorld) fail('USE_CREATE');
    this.#record = record; this.#state = record.state; this.#store = store;
    this.#clock = clock; this.#ttl = ttl; this.#limit = limit;
  }
  static async create({snapshot, store = new MemoryAuthorityStore(), now = () => Date.now(), leaseMs = 3000, maxEvents = 4096}) {
    if (typeof now !== 'function' || !Number.isFinite(leaseMs) || leaseMs < 100 || leaseMs > 60000
        || !Number.isSafeInteger(maxEvents) || maxEvents < 8 || maxEvents > 65536) fail('INVALID_OPTIONS');
    let record = await store.load();
    if (record) {
      if (record.schema !== 'vivo.lease-checkpoint/1' || record.digest !== await sha256(record.state)) fail('CHECKPOINT_HASH');
      validateSeed(record.state.snapshot);
      if (snapshot && (snapshot.worldId !== record.state.snapshot.worldId || snapshot.authorityId !== record.state.snapshot.authorityId)) fail('WORLD_MISMATCH');
    } else {
      validateSeed(snapshot);
      const state = {snapshot: clone(snapshot), leases: {}, epochs: {}, receipts: {}, events: []};
      state.snapshot.stateHash = await sha256({snapshot:{...state.snapshot,stateHash:null},leases:state.leases});
      record = {schema: 'vivo.lease-checkpoint/1', state, digest: await sha256(state)};
      await store.compareAndSwap(null, record);
    }
    const world = new LocalLeaseWorld(LocalLeaseWorld, record, store, now, leaseMs, maxEvents);
    // Process-local session capabilities never survive a restart. State and history do.
    if (Object.keys(record.state.leases).length) await world.#internal('restart-release', null, s => {s.leases = {};});
    return world;
  }
  #time() { const t = this.#clock(); if (!Number.isFinite(t) || t < 0) fail('INVALID_CLOCK'); return t; }
  #queue(fn) { const job = this.#tail.then(fn); this.#tail = job.catch(() => {}); return job; }
  #session(token) { const s = this.#clients.get(token); if (!s || s.closed) fail('SESSION_CLOSED'); return s; }
  snapshot() { return clone(this.#state.snapshot); }
  checkpoint() { return clone(this.#record); }
  constraints() {
    const now = this.#time();
    return clone(Object.values(this.#state.leases).filter(l => l.expiresAt > now && l.target !== null));
  }
  attach({role = 'editor', actorId = 'actor.' + uuid()} = {}) {
    if (!validId(actorId) || !['editor','viewer'].includes(role)) fail('INVALID_ADMISSION');
    const token = uuid();
    const session = Object.freeze({mode:'local',actorId,worldId:this.#state.snapshot.worldId,
      authorityId:this.#state.snapshot.authorityId,capabilities:Object.freeze(role === 'editor' ? ['grab'] : [])});
    const state = {session, role, listeners:new Set(), closed:false}; this.#clients.set(token, state);
    let opened = false;
    return Object.freeze({
      open: async () => { this.#session(token); opened = true; return session; },
      getSnapshot: () => { this.#session(token); if (!opened) fail('NOT_OPEN'); return this.snapshot(); },
      submit: command => { if (!opened) return Promise.reject(Object.assign(new Error('NOT_OPEN'),{code:'NOT_OPEN'})); return this.#submit(token,command); },
      subscribe: listener => { this.#session(token); if (typeof listener !== 'function') fail('INVALID_LISTENER'); state.listeners.add(listener); return () => state.listeners.delete(listener); },
      inspectLease: (spaceId,entityId) => { this.#session(token); const l=this.#state.leases[key(spaceId,entityId)]; return l?.session === token && l.expiresAt > this.#time() ? clone(l) : null; },
      renewLease: leaseId => this.#renew(token, leaseId),
      reconcileLease: event => this.#reconcile(token, event),
      close: () => this.#queue(async () => {
        if (state.closed) return;
        await this.#commitInternal('session-close',token,s=>{for (const [k,l] of Object.entries(s.leases)) if(l.session===token) delete s.leases[k];});
        state.closed=true; state.listeners.clear(); this.#clients.delete(token);
      })
    });
  }
  async #save(next) {
    const record={schema:'vivo.lease-checkpoint/1',state:next,digest:await sha256(next)};
    await this.#store.compareAndSwap(this.#record.digest,record);
    this.#record=record;this.#state=next;
    for(const c of this.#clients.values()) for(const listener of c.listeners) {
      try { Promise.resolve(listener(this.snapshot())).catch(()=>{}); } catch { /* Observer cannot undo acceptance. */ }
    }
  }
  async #advance(next, kind, actorId, payload) {
    if(next.events.length>=this.#limit) fail('JOURNAL_FULL');
    next.snapshot.acceptedSequence++;
    next.snapshot.stateHash=await sha256({snapshot:{...next.snapshot,stateHash:null},leases:next.leases});
    next.events.push({sequence:next.snapshot.acceptedSequence,kind,actorId,payload:clone(payload),stateHash:next.snapshot.stateHash});
  }
  async #commitInternal(kind,token,mutate) {
    const next=clone(this.#state); mutate(next);
    await this.#advance(next,kind,token?this.#session(token).session.actorId:'authority',{});
    await this.#save(next);return this.snapshot();
  }
  #internal(kind,token,mutate) { return this.#queue(()=>this.#commitInternal(kind,token,mutate)); }
  sweepExpired() { return this.#queue(async()=>{
    const now=this.#time();
    if(!Object.values(this.#state.leases).some(l=>l.expiresAt<=now)) return this.snapshot();
    return this.#commitInternal('lease-expired',null,s=>{for(const [k,l]of Object.entries(s.leases))if(l.expiresAt<=now)delete s.leases[k];});
  }); }
  #receipt(command,status,code,entity=null,result=null) {
    return validateReceipt({schema:'vivo.receipt/1',id:command.id,status,authorityId:this.#state.snapshot.authorityId,
      acceptedSequence:this.#state.snapshot.acceptedSequence,entityRevision:entity?.revision??null,
      code,stateHash:this.#state.snapshot.stateHash,result});
  }
  #submit(token, raw) {
    let command;
    try { command=clone(validateCommand(raw)); } catch(error) { return Promise.reject(error); }
    return this.#queue(async()=>{
      const client=this.#session(token), s=this.#state, p=command.payload;
      const reject=(code,e=null)=>clone(this.#receipt(command,'rejected',code,e));
      if(command.worldId!==s.snapshot.worldId) return reject('WORLD_MISMATCH');
      const fingerprint=await sha256(command), requestKey=key(token,command.id), prior=s.receipts[requestKey];
      if(prior) return prior.fingerprint===fingerprint?clone(prior.receipt):reject('COMMAND_ID_REUSE');
      if(client.role!=='editor') return reject('VIEWER');
      if(!['grab.begin','grab.target','grab.end'].includes(command.kind)) return reject('NOT_IMPLEMENTED');
      const space=Object.hasOwn(s.snapshot.spaces,command.spaceId)?s.snapshot.spaces[command.spaceId]:null;
      const entity=space&&Object.hasOwn(space.entities,p.entityId)?space.entities[p.entityId]:null;
      if(!entity) return reject('NO_ENTITY');
      if(entity.revision!==command.expectedRevision) return reject('STALE_REVISION',entity);
      const next=clone(s), k=key(command.spaceId,p.entityId), current=next.leases[k], now=this.#time();
      const alive=current && current.expiresAt>now;
      let result;
      if(command.kind==='grab.begin') {
        if(alive) return reject('LEASE_HELD',entity);
        const ek=key(token,command.spaceId,p.entityId,p.source), previous=next.epochs[ek]??-1;
        if(p.inputEpoch<=previous) return reject('STALE_EPOCH',entity);
        const lease={id:'lease.'+uuid(),session:token,actorId:client.session.actorId,spaceId:command.spaceId,
          entityId:p.entityId,source:p.source,inputEpoch:p.inputEpoch,targetSeq:0,expiresAt:now+this.#ttl,target:null};
        next.leases[k]=lease;next.epochs[ek]=p.inputEpoch;
        result={leaseId:lease.id,expiresAt:lease.expiresAt,leaseMs:this.#ttl,entity:clone(entity)};
      } else {
        if(!alive) return reject('LEASE_EXPIRED',entity);
        if(current.session!==token || current.id!==p.leaseId || current.inputEpoch!==p.inputEpoch) return reject('LEASE_MISMATCH',entity);
        if(command.kind==='grab.target') {
          if(p.source!==current.source) return reject('SOURCE_MISMATCH',entity);
          if(p.dimension!==entity.dimension || p.chart!==entity.chart) return reject('FRAME_MISMATCH',entity);
          if(p.targetSeq<=current.targetSeq) return reject('STALE_TARGET',entity);
          current.targetSeq=p.targetSeq;current.expiresAt=now+this.#ttl;
          current.target={spaceId:command.spaceId,chart:p.chart,dimension:p.dimension,q:[...p.q]};
          result={leaseId:current.id,target:clone(current.target),targetSeq:p.targetSeq};
        } else { delete next.leases[k]; result={leaseId:p.leaseId,released:true}; }
      }
      await this.#advance(next,command.kind,client.session.actorId,command);
      const receipt={...this.#receipt(command,'accepted','OK',entity,result),acceptedSequence:next.snapshot.acceptedSequence,stateHash:next.snapshot.stateHash};
      next.receipts[requestKey]={fingerprint,receipt};
      await this.#save(next);return clone(receipt);
    });
  }
  #renew(token,leaseId) { return this.#queue(async()=>{
    this.#session(token);const now=this.#time();
    const entry=Object.entries(this.#state.leases).find(([,l])=>l.id===leaseId&&l.session===token&&l.expiresAt>now);
    if(!entry) fail('LEASE_EXPIRED');
    const [k]=entry;
    await this.#commitInternal('lease-renew',token,s=>{s.leases[k].expiresAt=now+this.#ttl;});
    return clone(this.#state.leases[k]);
  }); }
  #reconcile(token,event) {
    const e=clone(event);
    return this.#queue(async()=>{
      this.#session(token);
      if(!e || e.worldId!==this.#state.snapshot.worldId || e.authorityId!==this.#state.snapshot.authorityId) fail('RECONCILE_WORLD');
      const k=key(e.spaceId,e.entityId), lease=this.#state.leases[k];
      if(lease && lease.id===e.leaseId) {
        if(lease.session!==token || lease.inputEpoch!==e.inputEpoch) fail('RECONCILE_OWNER');
        await this.#commitInternal('lease-reconciled',token,s=>{delete s.leases[k];});
      }
      return {released:!this.#state.leases[k]||this.#state.leases[k].id!==e.leaseId,snapshot:this.snapshot()};
    });
  }
}
