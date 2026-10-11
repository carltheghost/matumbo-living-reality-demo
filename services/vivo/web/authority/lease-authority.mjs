/** Local, single-writer canonical lease authority. Targets are constraints, NOT physics.
 * The host supplies validated world state. Optional versioned material acceptance
 * is private to the host. No network, camera, render, or material loop.
 */
import {validateCommand, validateFrame, validateReceipt} from '../../contracts/validate.mjs';
import {validateStudioBinding} from '../../contracts/studio-binding.mjs';
const clone = value => structuredClone(value);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const sha256 = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(canonical(value)))), b => b.toString(16).padStart(2, '0')).join('');
const acceptedStateHash = state => sha256({snapshot: {...state.snapshot,stateHash:null},leases:state.leases,eyes:state.eyes});
const fail = code => { throw Object.assign(new Error(code), {code}); };
const key = (...parts) => JSON.stringify(parts);
const uuid = () => crypto.randomUUID();

async function offlineBranch(state, actorId, payload) {
  const branchAuthorityId = 'offline.' + (await sha256({
    parentAuthorityId: state.snapshot.authorityId,
    parentCheckpointHash: state.snapshot.stateHash,
    newWorldId: payload.newWorldId,
  })).slice(0, 32);
  const snapshot = clone(state.snapshot);
  snapshot.worldId = payload.newWorldId;
  snapshot.authorityId = branchAuthorityId;
  snapshot.acceptedSequence = 0;
  snapshot.stateHash = '0'.repeat(64);
  snapshot.branch = {
    schema: 'vivo.offline-branch/1',
    mode: 'offline',
    parentWorldId: state.snapshot.worldId,
    parentAuthorityId: state.snapshot.authorityId,
    parentCheckpointHash: state.snapshot.stateHash,
    parentAcceptedSequence: state.snapshot.acceptedSequence,
  };
  const branchState = {snapshot, leases: {}, epochs: {}, receipts: {}, events: [], eyes: {}};
  for(const binding of Object.values(snapshot.studioBindings??{})) {
    binding.bindingRevision=0;
    binding.acceptedSequence=0;
  }
  snapshot.stateHash = await acceptedStateHash(branchState);
  const eye = state.eyes[key(actorId, 'main')] ? clone(state.eyes[key(actorId, 'main')]) : null;
  const material = state.material ? {
    protocol: state.material.protocol,
    state: 'paused',
    checkpointIncluded: false,
    checkpointDigest: await sha256(state.material.checkpoint),
  } : null;
  return {
    schema: 'vivo.offline-branch/1',
    mode: 'offline',
    worldId: snapshot.worldId,
    authorityId: snapshot.authorityId,
    parentWorldId: state.snapshot.worldId,
    parentAuthorityId: state.snapshot.authorityId,
    checkpointHash: state.snapshot.stateHash,
    acceptedSequence: snapshot.acceptedSequence,
    snapshot: clone(branchState.snapshot),
    eye,
    material,
  };
}

/** Atomic in-process test/personal-session store; explicitly volatile, not disk persistence. */
export class MemoryAuthorityStore {
  #value = null;
  supportsCommitGuard = true;
  async load() { return clone(this.#value); }
  async compareAndSwap(expected, value, {beforeCommit} = {}) {
    if ((this.#value?.digest ?? null) !== expected) fail('STORE_CONFLICT');
    const copy=clone(value);
    if(beforeCommit) {const result=beforeCommit();if(result && typeof result.then==='function') fail('STORE_COMMIT_GUARD_ASYNC');}
    this.#value = copy;
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
  if (s.studioBindings !== undefined) {
    if (!s.studioBindings || typeof s.studioBindings !== 'object' || Array.isArray(s.studioBindings) ||
        Object.keys(s.studioBindings).length > 32) fail('INVALID_STUDIO_BINDINGS');
    for (const [bindingId, binding] of Object.entries(s.studioBindings)) {
      if (bindingId !== binding?.bindingId) fail('INVALID_STUDIO_BINDING_ID');
      try { validateStudioBinding(binding); } catch { fail('INVALID_STUDIO_BINDING'); }
      if (binding.acceptedSequence > s.acceptedSequence) fail('INVALID_STUDIO_BINDING_SEQUENCE');
      const space=s.spaces[binding.spaceId], entity=space?.entities?.[binding.entityId];
      if (!space || !entity || entity.dimension!==binding.dimension || entity.chart!==binding.chart) fail('INVALID_STUDIO_BINDING_TARGET');
    }
  }
}

// Observer state is separate from material snapshots. These coordinates still use
// the declared spatial dimension; simulationTime never becomes another axis.
function checkView(snapshot, view) {
  validateFrame(view);
  const space=snapshot.spaces[view.spaceId];
  if(!Object.hasOwn(snapshot.spaces,view.spaceId) || view.dimension!==space.dimension) fail('EYE_SPACE');
  const d=view.dimension;
  if(!Array.isArray(view.basis) || view.basis.length!==d ||
      !Array.from(view.basis).every(r=>Array.isArray(r)&&r.length===d&&Array.from(r).every(Number.isFinite))) fail('EYE_BASIS');
  for(let i=0;i<d;i++)for(let j=0;j<d;j++) {
    const dot=view.basis[i].reduce((v,x,k)=>v+x*view.basis[j][k],0);
    if(Math.abs(dot-+(i===j))>1e-8) fail('EYE_BASIS');
  }
  if(!view.slice || typeof view.slice!=='object' || Array.isArray(view.slice) ||
      Object.entries(view.slice).some(([k,v])=>!/^x[1-9][0-9]*$/.test(k)||Number(k.slice(1))>d||!Number.isFinite(v)||Math.abs(v)>1000)) fail('EYE_SLICE');
  return {spaceId:view.spaceId,chart:view.chart,dimension:d,q:[...view.q],basis:clone(view.basis),slice:clone(view.slice)};
}
function checkEyes(snapshot, eyes) {
  if(!eyes || typeof eyes!=='object' || Array.isArray(eyes) || Object.keys(eyes).length>256) fail('INVALID_EYES');
  for(const [k,e] of Object.entries(eyes)) {
    if(!validId(e.actorId)||!validId(e.eyeId)||k!==key(e.actorId,e.eyeId)||!Number.isSafeInteger(e.revision)||e.revision<0||
       !Array.isArray(e.stack)||e.stack.length>32) fail('INVALID_EYE');
    checkView(snapshot,e);
    const seen=new Set();
    for(const f of e.stack) {
      if(!validId(f.id)||seen.has(f.id)||!validId(f.portalEntityId)) fail('INVALID_RETURN');
      seen.add(f.id);checkView(snapshot,f.view);
    }
  }
}

/** Host-owned factory. attach() is privileged local admission, not remote authentication. */
export class LocalLeaseWorld {
  #state; #record; #store; #clock; #tail = Promise.resolve(); #clients = new Map();
  #ttl; #limit; #material;
  constructor(token, record, store, clock, ttl, limit, material) {
    if (token !== LocalLeaseWorld) fail('USE_CREATE');
    this.#record = record; this.#state = record.state; this.#store = store;
    this.#clock = clock; this.#ttl = ttl; this.#limit = limit; this.#material = material;
  }
  static async create({snapshot, store = new MemoryAuthorityStore(), now = () => Date.now(), leaseMs = 3000, maxEvents = 4096, materialProtocol, materialInitial}) {
    if (typeof now !== 'function' || !Number.isFinite(leaseMs) || leaseMs < 100 || leaseMs > 60000
        || !Number.isSafeInteger(maxEvents) || maxEvents < 8 || maxEvents > 65536) fail('INVALID_OPTIONS');
    let material=null;
    if(materialProtocol!==undefined) {
      const modules={'vivo.lease-material/1':'./material-authority.mjs','vivo.lease-adaptive/1':'./adaptive-material.mjs'};
      if(!Object.hasOwn(modules,materialProtocol)) fail('MATERIAL_PROTOCOL');
      if(store.supportsCommitGuard!==true) fail('MATERIAL_STORE_GUARD_REQUIRED');
      material=await import(modules[materialProtocol]);
    } else if(materialInitial!==undefined) fail('MATERIAL_PROTOCOL_REQUIRED');
    let record = await store.load();
    if (record) {
      if (record.schema !== 'vivo.lease-checkpoint/1' || record.digest !== await sha256(record.state)) fail('CHECKPOINT_HASH');
      validateSeed(record.state.snapshot);
      if(snapshot?.studioBindings) {
        validateSeed(snapshot);
        const current=record.state.snapshot.studioBindings;
        const missing=Object.keys(snapshot.studioBindings).filter(bindingId=>
          !current || !Object.hasOwn(current,bindingId));
        if(missing.length) {
          const migrated=clone(record.state);
          migrated.snapshot.studioBindings ??= {};
          for(const bindingId of missing) migrated.snapshot.studioBindings[bindingId]=clone(snapshot.studioBindings[bindingId]);
          migrated.snapshot.stateHash=await acceptedStateHash(migrated);
          const migratedRecord={schema:'vivo.lease-checkpoint/1',state:migrated,digest:await sha256(migrated)};
          await store.compareAndSwap(record.digest,migratedRecord);
          record=migratedRecord;
        }
      }
      if(Boolean(record.state.material)!==Boolean(material)) fail('MATERIAL_PROTOCOL_MISMATCH');
      if(material && record.state.material?.protocol!==materialProtocol) fail('MATERIAL_PROTOCOL_MISMATCH');
      if(materialInitial!==undefined) fail('MATERIAL_INITIAL_ON_RESTORE');
      if(material) material.validateMaterialState(record.state,materialProtocol);
      if(record.state.eyes!==undefined) checkEyes(record.state.snapshot,record.state.eyes);
      if (snapshot && (snapshot.worldId !== record.state.snapshot.worldId || snapshot.authorityId !== record.state.snapshot.authorityId)) fail('WORLD_MISMATCH');
    } else {
      validateSeed(snapshot);
      const state = {snapshot: clone(snapshot), leases: {}, epochs: {}, receipts: {}, events: [], eyes: {}};
      if(material) {
        if(!materialInitial || Object.keys(materialInitial).sort().join(',')!=='checkpoint,spaceId') fail('MATERIAL_INITIAL_REQUIRED');
        state.material={protocol:materialProtocol,spaceId:materialInitial.spaceId,checkpoint:clone(materialInitial.checkpoint)};
        material.validateMaterialState(state,materialProtocol);
      }
      state.snapshot.stateHash = await acceptedStateHash(state);
      record = {schema: 'vivo.lease-checkpoint/1', state, digest: await sha256(state)};
      await store.compareAndSwap(null, record);
    }
    const world = new LocalLeaseWorld(LocalLeaseWorld, record, store, now, leaseMs, maxEvents, material);
    if(record.state.eyes===undefined) await world.#internal('observer-state-initialized',null,s=>{s.eyes={};});
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
  /** Host-only coherent capture; never exposed by attach() or a public endpoint. */
  captureMaterial(spaceId) { return this.#queue(()=>{
    if(!this.#material) fail('MATERIAL_DISABLED');
    if(spaceId!==this.#state.material.spaceId) fail('MATERIAL_SPACE');
    this.#material.checkMaterialLeases(this.#state);
    const now=this.#time(), latest=this.#state.events.findLast(e=>e.kind==='material-step'&&e.payload.spaceId===spaceId)?.payload;
    return clone({snapshot:this.#state.snapshot,constraints:Object.values(this.#state.leases).filter(l=>l.expiresAt>now&&l.target!==null),
      authorityTimeMs:now,checkpoint:this.#state.material.checkpoint,diagnostics:latest?.diagnostics??null,fieldDiagnostics:latest?.fieldDiagnostics??[]});
  }); }
  /** Only a trusted private host solver may submit this versioned envelope. */
  applyMaterialProposal(raw) {
    if(!this.#material) return Promise.reject(Object.assign(new Error('MATERIAL_DISABLED'),{code:'MATERIAL_DISABLED'}));
    let proposal;
    try {this.#material.validateProposal(this.#state,raw,this.#time());proposal=clone(raw);} catch(error) {return Promise.reject(error);}
    return this.#queue(async()=>{
      const s=this.#state, candidate=this.#material.validateProposal(s,proposal,this.#time()), next=clone(s);
      next.snapshot=candidate;next.material.checkpoint=clone(proposal.fieldState);
      for(const l of Object.values(next.leases)) if(this.#material.coversSpace(s,l.spaceId)) {
        const e=s.snapshot.spaces[l.spaceId].entities[l.entityId];
        const accepted=candidate.spaces?.[l.spaceId]?.entities?.[l.entityId];
        if(e && accepted && l.materialCoverageRevision===e.revision && l.materialInvariant===this.#material.invariantFingerprint(s.snapshot,l.spaceId,l.entityId))
          l.materialCoverageRevision=accepted.revision;
      }
      await this.#advance(next,'material-step','authority',this.#material.materialEvent(proposal));
      await this.#save(next,()=>this.#material.checkCommitProvenance(this.#state,proposal,this.#time()));
      return this.snapshot();
    });
  }
  attach({role = 'editor', actorId = 'actor.' + uuid()} = {}) {
    if (!validId(actorId) || !['editor','viewer'].includes(role)) fail('INVALID_ADMISSION');
    const token = uuid();
    const session = Object.freeze({mode:'local',actorId,worldId:this.#state.snapshot.worldId,
      authorityId:this.#state.snapshot.authorityId,capabilities:Object.freeze(role === 'editor' ? ['grab','observe','nested'] : ['observe','nested'])});
    const state = {session, role, listeners:new Set(), closed:false}; this.#clients.set(token, state);
    let opened = false;
    return Object.freeze({
      open: async () => { this.#session(token); opened = true; return session; },
      getSnapshot: () => { this.#session(token); if (!opened) fail('NOT_OPEN'); return this.snapshot(); },
      submit: command => { if (!opened) return Promise.reject(Object.assign(new Error('NOT_OPEN'),{code:'NOT_OPEN'})); return this.#submit(token,command); },
      subscribe: listener => { this.#session(token); if (typeof listener !== 'function') fail('INVALID_LISTENER'); state.listeners.add(listener); return () => state.listeners.delete(listener); },
      inspectLease: (spaceId,entityId,criteria={}) => {
        this.#session(token);const now=this.#time();
        const matches=Object.values(this.#state.leases).filter(l=>l.session===token&&l.spaceId===spaceId&&l.entityId===entityId&&l.expiresAt>now
          && (criteria.source===undefined||l.source===criteria.source)
          && (criteria.inputEpoch===undefined||l.inputEpoch===criteria.inputEpoch)
          && (criteria.acquireCommandId===undefined||l.acquireCommandId===criteria.acquireCommandId));
        return matches.length===1?clone(matches[0]):null;
      },
      registerEye: (eyeId,view) => {
        if(!opened) return Promise.reject(Object.assign(new Error('NOT_OPEN'),{code:'NOT_OPEN'}));
        return this.#registerEye(token,eyeId,view);
      },
      getEye: eyeId => {this.#session(token);if(!opened)fail('NOT_OPEN');return clone(this.#state.eyes[key(actorId,eyeId)]??null);},
      moveEye: (eyeId,view,expectedRevision) => {
        if(!opened) return Promise.reject(Object.assign(new Error('NOT_OPEN'),{code:'NOT_OPEN'}));
        return this.#moveEye(token,eyeId,view,expectedRevision);
      },
      renewLease: leaseId => this.#renew(token, leaseId),
      reconcileLease: event => this.#reconcile(token, event),
      close: () => this.#queue(async () => {
        if (state.closed) return;
        await this.#commitInternal('session-close',token,s=>{for (const [k,l] of Object.entries(s.leases)) if(l.session===token) delete s.leases[k];});
        state.closed=true; state.listeners.clear(); this.#clients.delete(token);
      })
    });
  }
  async #save(next, beforeCommit) {
    const record={schema:'vivo.lease-checkpoint/1',state:next,digest:await sha256(next)};
    if(beforeCommit) await this.#store.compareAndSwap(this.#record.digest,record,{beforeCommit});
    else await this.#store.compareAndSwap(this.#record.digest,record);
    this.#record=record;this.#state=next;
    for(const c of this.#clients.values()) for(const listener of c.listeners) {
      try { Promise.resolve(listener(this.snapshot())).catch(()=>{}); } catch { /* Observer cannot undo acceptance. */ }
    }
  }
  async #advance(next, kind, actorId, payload) {
    if(next.events.length>=this.#limit) fail('JOURNAL_FULL');
    if(next.snapshot.acceptedSequence>=Number.MAX_SAFE_INTEGER)fail('SEQUENCE_EXHAUSTED');
    next.snapshot.acceptedSequence++;
    next.snapshot.stateHash=await acceptedStateHash(next);
    next.events.push({sequence:next.snapshot.acceptedSequence,kind,actorId,payload:clone(payload),stateHash:next.snapshot.stateHash});
  }
  async #commitInternal(kind,token,mutate,payload={}) {
    const next=clone(this.#state); mutate(next);
    await this.#advance(next,kind,token?this.#session(token).session.actorId:'authority',payload);
    await this.#save(next);return this.snapshot();
  }
  #internal(kind,token,mutate,payload={}) { return this.#queue(()=>this.#commitInternal(kind,token,mutate,payload)); }
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
      if(['space.enter','space.exit'].includes(command.kind)) return this.#navigate(token,command,fingerprint,requestKey);
      if(client.role!=='editor') return reject('VIEWER');
      if(command.kind==='world.fork') {
        if(command.spaceId!==s.snapshot.rootSpaceId) return reject('FORK_ROOT_ONLY');
        if(command.expectedRevision!==s.snapshot.acceptedSequence) return reject('STALE_WORLD');
        if(p.checkpointHash!==s.snapshot.stateHash) return reject('FORK_CHECKPOINT_MISMATCH');
        if(p.newWorldId===s.snapshot.worldId) return reject('FORK_WORLD_ID');
        const branch=await offlineBranch(s,client.session.actorId,p),next=clone(s);
        await this.#advance(next,'world-fork',client.session.actorId,{
          schema:'vivo.offline-branch/1',worldId:branch.worldId,authorityId:branch.authorityId,
          parentWorldId:branch.parentWorldId,parentAuthorityId:branch.parentAuthorityId,
          checkpointHash:branch.checkpointHash,
        });
        const receipt={...this.#receipt(command,'accepted','OFFLINE_BRANCH',null,branch),
          acceptedSequence:next.snapshot.acceptedSequence,stateHash:next.snapshot.stateHash};
        next.receipts[requestKey]={fingerprint,receipt};
        await this.#save(next);return clone(receipt);
      }
      if(command.kind==='studio.transform') {
        if(command.expectedRevision!==s.snapshot.acceptedSequence) return reject('STALE_WORLD');
        const binding=s.snapshot.studioBindings?.[p.bindingId];
        if(!binding) return reject('STUDIO_BINDING_UNAVAILABLE');
        try { validateStudioBinding(binding); } catch { return reject('STUDIO_BINDING_INVALID'); }
        if(command.spaceId!==binding.spaceId) return reject('STUDIO_BINDING_SPACE');
        if(binding.sourceModel!==p.sourceModel || binding.sourceNode!==p.sourceNode ||
            binding.entityId!==p.entityId || binding.dimension!==p.dimension || binding.chart!==p.chart ||
            binding.spaceId!==command.spaceId || binding.metadata.name!==p.metadata.name ||
            binding.metadata.kind!==p.metadata.kind) return reject('STUDIO_BINDING_IDENTITY');
        if(binding.bindingRevision>=Number.MAX_SAFE_INTEGER) return reject('STUDIO_BINDING_REVISION_EXHAUSTED');
        const next=clone(s), updated={...clone(binding),q:[...p.q],metadata:clone(p.metadata),
          bindingRevision:binding.bindingRevision+1,acceptedSequence:next.snapshot.acceptedSequence+1};
        next.snapshot.studioBindings[p.bindingId]=updated;
        await this.#advance(next,'studio-transform',client.session.actorId,command);
        const result={binding:clone(updated),entityId:p.entityId,projectionOnly:true};
        const receipt={...this.#receipt(command,'accepted','OK',null,result),
          acceptedSequence:next.snapshot.acceptedSequence,stateHash:next.snapshot.stateHash};
        next.receipts[requestKey]={fingerprint,receipt};
        await this.#save(next);return clone(receipt);
      }
      if(!['grab.begin','grab.target','grab.end'].includes(command.kind)) return reject('NOT_IMPLEMENTED');
      const space=Object.hasOwn(s.snapshot.spaces,command.spaceId)?s.snapshot.spaces[command.spaceId]:null;
      const entity=space&&Object.hasOwn(space.entities,p.entityId)?space.entities[p.entityId]:null;
      if(!entity) return reject('NO_ENTITY');
      const now=this.#time(), entityEntries=Object.entries(s.leases).filter(([,l])=>
        l.spaceId===command.spaceId&&l.entityId===p.entityId&&l.expiresAt>now);
      let entry=command.kind==='grab.begin'?null:entityEntries.find(([,l])=>l.id===p.leaseId);
      let current=entry?.[1]??null, leaseKey=entry?.[0]??null;
      const materialLease=this.#material && this.#material.coversSpace(s,command.spaceId) && current;
      const invariant=materialLease && this.#material.invariantFingerprint(s.snapshot,command.spaceId,p.entityId);
      const covered=materialLease && current.materialCoverageRevision===entity.revision && current.materialInvariant===invariant;
      if(entity.revision!==command.expectedRevision && !(command.kind!=='grab.begin' && covered && command.expectedRevision===current.inputReceiptRevision)) return reject('STALE_REVISION',entity);
      if(command.kind==='grab.target' && materialLease && !covered) return reject('LEASE_INVALIDATED',entity);
      const next=clone(s);let result;
      if(command.kind==='grab.begin') {
        const group=p.cooperativeGroup??null, cooperative=group!==null;
        if(cooperative && s.material?.protocol!=='vivo.lease-adaptive/1') return reject('COOPERATIVE_UNSUPPORTED',entity);
        if(!cooperative && entityEntries.length) return reject('LEASE_HELD',entity);
        if(cooperative) {
          if(entityEntries.some(([,l])=>l.cooperativeGroup!==group)) return reject('LEASE_HELD',entity);
          if(entityEntries.length>=4) return reject('COOPERATIVE_LIMIT',entity);
          if(entityEntries.some(([,l])=>l.session===token&&l.source===p.source)) return reject('LEASE_HELD',entity);
        }
        const ek=key(token,command.spaceId,p.entityId,p.source), previous=next.epochs[ek]??-1;
        if(p.inputEpoch<=previous) return reject('STALE_EPOCH',entity);
        const lease={id:'lease.'+uuid(),acquireCommandId:command.id,session:token,actorId:client.session.actorId,spaceId:command.spaceId,
          entityId:p.entityId,source:p.source,inputEpoch:p.inputEpoch,targetSeq:0,expiresAt:now+this.#ttl,target:null,
          ...(cooperative?{cooperativeGroup:group}:{})};
        if(this.#material && this.#material.coversSpace(s,command.spaceId)) Object.assign(lease,{
          inputReceiptRevision:entity.revision,materialCoverageRevision:entity.revision,
          materialInvariant:this.#material.invariantFingerprint(s.snapshot,command.spaceId,p.entityId)});
        leaseKey=cooperative?key(command.spaceId,p.entityId,'cooperative',lease.id):key(command.spaceId,p.entityId);
        next.leases[leaseKey]=lease;next.epochs[ek]=p.inputEpoch;
        result={leaseId:lease.id,expiresAt:lease.expiresAt,leaseMs:this.#ttl,entity:clone(entity),...(cooperative?{cooperativeGroup:group}:{})};
      } else {
        current=leaseKey===null?null:next.leases[leaseKey];
        if(!current) return reject(entityEntries.length?'LEASE_MISMATCH':'LEASE_EXPIRED',entity);
        if(current.expiresAt<=now) return reject('LEASE_EXPIRED',entity);
        if(current.session!==token || current.id!==p.leaseId || current.inputEpoch!==p.inputEpoch) return reject('LEASE_MISMATCH',entity);
        if(command.kind==='grab.target') {
          if(p.source!==current.source) return reject('SOURCE_MISMATCH',entity);
          if(p.dimension!==entity.dimension || p.chart!==entity.chart) return reject('FRAME_MISMATCH',entity);
          if(p.targetSeq<=current.targetSeq) return reject('STALE_TARGET',entity);
          if(materialLease && !this.#material.targetAllowed(s,command.spaceId,p.q)) return reject('MATERIAL_DOMAIN',entity);
          current.targetSeq=p.targetSeq;current.expiresAt=now+this.#ttl;
          if(materialLease) current.inputReceiptRevision=entity.revision;
          current.target={spaceId:command.spaceId,chart:p.chart,dimension:p.dimension,q:[...p.q]};
          result={leaseId:current.id,target:clone(current.target),targetSeq:p.targetSeq,...(current.cooperativeGroup?{cooperativeGroup:current.cooperativeGroup}:{})};
        } else { delete next.leases[leaseKey]; result={leaseId:p.leaseId,released:true}; }
      }
      await this.#advance(next,command.kind,client.session.actorId,command);
      const receipt={...this.#receipt(command,'accepted','OK',entity,result),acceptedSequence:next.snapshot.acceptedSequence,stateHash:next.snapshot.stateHash};
      next.receipts[requestKey]={fingerprint,receipt};
      await this.#save(next);return clone(receipt);
    });
  }
  #registerEye(token,eyeId,raw) {
    const view=clone(raw);
    return this.#queue(async()=>{
      const c=this.#session(token),k=key(c.session.actorId,eyeId);
      if(!validId(eyeId))fail('INVALID_EYE_ID');
      if(this.#state.eyes[k])return clone(this.#state.eyes[k]);
      if(Object.keys(this.#state.eyes).length>=256)fail('EYE_LIMIT');
      const checked=checkView(this.#state.snapshot,view);
      if(checked.spaceId!==this.#state.snapshot.rootSpaceId)fail('EYE_START_ROOT');
      const eye={...checked,actorId:c.session.actorId,eyeId,revision:0,stack:[]};
      await this.#commitInternal('eye-register',token,s=>{s.eyes[k]=eye;},{eye:clone(eye)});
      return clone(this.#state.eyes[k]);
    });
  }
  #moveEye(token,eyeId,raw,expectedRevision) {
    const view=clone(raw);
    return this.#queue(async()=>{
      const c=this.#session(token),k=key(c.session.actorId,eyeId),e=this.#state.eyes[k];
      if(!e)fail('NO_EYE');
      if(!Number.isSafeInteger(expectedRevision)||e.revision!==expectedRevision)fail('STALE_EYE');
      if(e.revision>=Number.MAX_SAFE_INTEGER)fail('EYE_REVISION_EXHAUSTED');
      const checked=checkView(this.#state.snapshot,view);
      if(checked.spaceId!==e.spaceId||checked.dimension!==e.dimension||checked.chart!==e.chart)fail('EYE_FRAME_MISMATCH');
      const updated={...clone(e),...checked,revision:e.revision+1};
      await this.#commitInternal('eye-move',token,s=>{s.eyes[k]=updated;},{eyeId,expectedRevision,view:checked});
      return clone(this.#state.eyes[k]);
    });
  }
  async #navigate(token,command,fingerprint,requestKey) {
    const c=this.#session(token),p=command.payload,k=key(c.session.actorId,p.eyeId),s=this.#state;
    const e=s.eyes[k],reject=(code,entity=null)=>clone(this.#receipt(command,'rejected',code,entity));
    if(!e)return reject('NO_EYE');
    if(e.spaceId!==command.spaceId)return reject('EYE_SPACE_MISMATCH');
    if(e.revision>=Number.MAX_SAFE_INTEGER)return reject('EYE_REVISION_EXHAUSTED');
    if(Object.values(s.leases).some(l=>l.session===token&&l.spaceId===e.spaceId&&l.expiresAt>this.#time()))return reject('GRIP_ACTIVE');
    const next=clone(s),ne=next.eyes[k];let entity=null,result;
    if(command.kind==='space.enter') {
      const space=s.snapshot.spaces[e.spaceId];
      entity=Object.hasOwn(space.entities,p.portalEntityId)?space.entities[p.portalEntityId]:null;
      if(!entity)return reject('NO_PORTAL');
      if(entity.revision!==command.expectedRevision)return reject('STALE_REVISION',entity);
      const child=entity.innerSpaceId&&s.snapshot.spaces[entity.innerSpaceId];
      if(!child)return reject('NO_INNER_SPACE',entity);
      if(ne.stack.length>=32)return reject('RETURN_DEPTH',entity);
      if(!child.entryView)return reject('NO_ENTRY_VIEW',entity);
      let view;try{view=checkView(s.snapshot,child.entryView);}catch{return reject('INVALID_ENTRY_VIEW',entity);}
      if(view.spaceId!==child.id)return reject('INVALID_ENTRY_VIEW',entity);
      const returned={id:'return.'+uuid(),portalEntityId:entity.id,view:checkView(s.snapshot,e)};
      ne.stack.push(returned);Object.assign(ne,view);ne.revision++;
      result={eye:clone(ne),returnFrameId:returned.id,portalEntityId:entity.id};
    } else {
      if(command.expectedRevision!==e.revision)return reject('STALE_EYE');
      const saved=ne.stack.at(-1);
      if(!saved||saved.id!==p.returnFrameId)return reject('RETURN_MISMATCH');
      let view;try{view=checkView(s.snapshot,saved.view);}catch{return reject('RETURN_UNAVAILABLE');}
      ne.stack.pop();Object.assign(ne,view);ne.revision++;
      result={eye:clone(ne),returnFrameId:saved.id};
    }
    await this.#advance(next,command.kind,c.session.actorId,command);
    const receipt={...this.#receipt(command,'accepted','OK',entity,result),acceptedSequence:next.snapshot.acceptedSequence,stateHash:next.snapshot.stateHash};
    next.receipts[requestKey]={fingerprint,receipt};
    await this.#save(next);return clone(receipt);
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
      const entry=Object.entries(this.#state.leases).find(([,l])=>l.id===e.leaseId&&l.spaceId===e.spaceId&&l.entityId===e.entityId);
      if(entry) {
        const [k,lease]=entry;if(lease.session!==token||lease.inputEpoch!==e.inputEpoch)fail('RECONCILE_OWNER');
        await this.#commitInternal('lease-reconciled',token,s=>{delete s.leases[k];});
      }
      return {released:!Object.values(this.#state.leases).some(l=>l.id===e.leaseId),snapshot:this.snapshot()};
    });
  }
}
