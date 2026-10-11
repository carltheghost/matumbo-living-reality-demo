/** Trusted-host validator for learned 3-11D adaptive graph material. */
import {materialDigest} from '../../../vivo_material/codec.mjs';

export const MATERIAL_PROTOCOL='vivo.lease-adaptive/1';
const SCHEMA='vivo.material.adaptive-graph/1';
const LAW='vivo.adaptive.graph/1';
const MODEL='9ab89f46361e397fe41845d86ecc23e38f75561032fd65ae9f8389e9780afdb0';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const require=(ok,code)=>{if(!ok)fail(code);};
const plain=v=>v&&Object.getPrototypeOf(v)===Object.prototype;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const num=(v,lo=-Number.MAX_SAFE_INTEGER,hi=Number.MAX_SAFE_INTEGER)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const int=(v,lo=0,hi=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi;
const eq=(a,b)=>materialDigest(a)===materialDigest(b);
const vector=(v,d,lo=-1e6,hi=1e6)=>Array.isArray(v)&&v.length===d&&v.every(x=>num(x,lo,hi));
function exact(v,keys,code){require(plain(v)&&eq(Object.keys(v).sort(),[...keys].sort()),code);}
function verifyDigest(cp){const{digest,...body}=cp;require(typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest)&&digest===materialDigest(body),'MATERIAL_DIGEST');}

export function coversSpace(state,spaceId){
  return state?.material?.protocol===MATERIAL_PROTOCOL&&plain(state.material.checkpoint?.spaces)&&Object.hasOwn(state.material.checkpoint.spaces,spaceId);
}
export function targetAllowed(state,spaceId,q){
  const d=state?.material?.checkpoint?.spaces?.[spaceId]?.dimension;
  return int(d,3,11)&&vector(q,d);
}
export function invariantFingerprint(snapshot,spaceId,entityId){
  const space=snapshot.spaces[spaceId],{q,v,revision,...identity}=space.entities[entityId];
  const{entities,field,...structure}=space,{hash,...fieldIdentity}=field;
  return materialDigest({worldId:snapshot.worldId,authorityId:snapshot.authorityId,identity,structure,fieldIdentity});
}
export function leaseProofs(state,now){
  return Object.values(state.leases).filter(l=>coversSpace(state,l.spaceId)&&l.expiresAt>now&&l.target!==null)
    .map(l=>Object.fromEntries(['id','actorId','spaceId','entityId','source','inputEpoch','targetSeq','expiresAt','target'].map(k=>[k,structuredClone(l[k])])));
}

export function validateCheckpoint(snapshot,cp){
  exact(cp,['schema','hashCodec','lawVersion','modelHashes','simulationTime','tick','spaces','digest'],'MATERIAL_CHECKPOINT_KEYS');
  require(cp.schema===SCHEMA&&cp.hashCodec==='vivo.f64-json-sha256/1'&&cp.lawVersion===LAW&&eq(cp.modelHashes,[MODEL]),'MATERIAL_VERSION');
  verifyDigest(cp);require(num(cp.simulationTime,0,1e12)&&int(cp.tick,0,1000000),'MATERIAL_CLOCK');
  require(plain(cp.spaces)&&Object.keys(cp.spaces).length>0,'MATERIAL_SPACES');
  for(const[sid,cs]of Object.entries(cp.spaces)){
    const space=snapshot.spaces?.[sid];require(id(sid)&&plain(space)&&space.id===sid,'MATERIAL_SPACE');
    require(int(cs.dimension,3,11)&&space.dimension===cs.dimension&&space.intrinsicDimension===cs.dimension,'MATERIAL_DIMENSION');
    require(eq(space.law,{id:'vivo.adaptive.graph',version:'1'})&&eq(space.modelHashes,[MODEL]),'MATERIAL_LAW');
    require(space.metricId==='euclidean'&&space.topologyId==='open','MATERIAL_GEOMETRY');
    require(space.field?.codec===SCHEMA&&space.field.hash===cp.digest,'MATERIAL_FIELD_HASH');
    exact(cs,['dimension','edges','entities'],'MATERIAL_SPACE_STATE');
    require(Array.isArray(cs.edges)&&plain(cs.entities)&&Object.keys(cs.entities).length>0&&Object.keys(cs.entities).length<=64,'MATERIAL_ENTITY_BUDGET');
    const edges=new Set();
    for(const edge of cs.edges){
      exact(edge,['a','b','rest'],'MATERIAL_EDGE');require(edge.a!==edge.b&&Object.hasOwn(cs.entities,edge.a)&&Object.hasOwn(cs.entities,edge.b)&&num(edge.rest,1e-9,1e9),'MATERIAL_EDGE');
      const k=[edge.a,edge.b].sort().join('\0');require(!edges.has(k),'MATERIAL_EDGE_DUPLICATE');edges.add(k);
    }
    require(eq(Object.keys(cs.entities).sort(),Object.keys(space.entities).sort()),'MATERIAL_MEMBERSHIP');
    for(const[eid,ce]of Object.entries(cs.entities)){
      exact(ce,['q','v','mass','revision'],'MATERIAL_ENTITY_STATE');
      const e=space.entities[eid];require(id(eid)&&e?.id===eid&&e.spaceId===sid&&e.dimension===cs.dimension,'MATERIAL_ENTITY_ID');
      require(e.materialProfile==='adaptive-graph','MATERIAL_PROFILE');
      require(vector(ce.q,cs.dimension)&&vector(ce.v,cs.dimension,-100,100)&&num(ce.mass,.01,1000)&&int(ce.revision,0,Number.MAX_SAFE_INTEGER-2),'MATERIAL_ENTITY_STATE');
      require(eq(e.q,ce.q)&&eq(e.v,ce.v)&&e.revision===ce.revision,'MATERIAL_ENTITY_FIELD');
    }
  }
}
export function validateMaterialState(state,protocol){
  require(protocol===MATERIAL_PROTOCOL&&state.material?.protocol===protocol,'MATERIAL_PROTOCOL');
  exact(state.material,['protocol','spaceId','checkpoint'],'MATERIAL_STATE');
  require(state.material.spaceId==='root'&&coversSpace(state,'root'),'MATERIAL_ROOT');
  validateCheckpoint(state.snapshot,state.material.checkpoint);
  for(const lease of Object.values(state.leases))if(coversSpace(state,lease.spaceId))
    require(int(lease.inputReceiptRevision)&&int(lease.materialCoverageRevision)&&lease.inputReceiptRevision<=lease.materialCoverageRevision&&typeof lease.materialInvariant==='string','MATERIAL_LEASE_CURSOR');
}
export function checkMaterialLeases(state){
  for(const lease of Object.values(state.leases))if(coversSpace(state,lease.spaceId)){
    const e=state.snapshot.spaces[lease.spaceId].entities[lease.entityId];
    require(e&&lease.materialCoverageRevision===e.revision&&lease.materialInvariant===invariantFingerprint(state.snapshot,lease.spaceId,lease.entityId),'MATERIAL_LEASE_INVALIDATED');
  }
}
export function validateProposal(state,p,now){
  checkMaterialLeases(state);materialDigest(p);
  exact(p,['schema','fieldState','entityUpdates','diagnostics','edgeDiagnostics','lawVersion','modelHashes','randomState','worldId','authorityId','spaceId','baseSequence','baseStateHash','baseFieldDigest','baseEntityRevisions','dt','tick','capturedAtMs','acceptedLeaseProofs','constraintDigest'],'MATERIAL_PROPOSAL_KEYS');
  const snap=state.snapshot,old=state.material.checkpoint;
  require(p.schema==='vivo.material-proposal.adaptive-graph/1'&&p.worldId===snap.worldId&&p.authorityId===snap.authorityId&&p.spaceId===state.material.spaceId,'MATERIAL_IDENTITY');
  require(p.baseSequence===snap.acceptedSequence&&p.baseStateHash===snap.stateHash&&p.baseFieldDigest===old.digest,'MATERIAL_STALE_AUTHORITY');
  const revisions=Object.fromEntries(Object.keys(old.spaces).map(sid=>[sid,Object.fromEntries(Object.keys(old.spaces[sid].entities).map(eid=>[eid,snap.spaces[sid].entities[eid].revision]))]));
  require(eq(p.baseEntityRevisions,revisions),'MATERIAL_STALE_REVISION');
  require(num(now,0)&&num(p.capturedAtMs,0,now),'MATERIAL_CAPTURE_TIME');
  const proofs=leaseProofs(state,now);require(eq(p.acceptedLeaseProofs,proofs)&&p.constraintDigest===materialDigest(proofs),'MATERIAL_STALE_CONSTRAINTS');
  require(num(p.dt,.0001,.02)&&int(p.tick,1,1000000)&&p.tick===old.tick+1&&p.fieldState.tick===p.tick,'MATERIAL_TICK');
  require(p.lawVersion===LAW&&eq(p.modelHashes,[MODEL])&&p.randomState==='deterministic:none','MATERIAL_VERSION');
  const candidate=structuredClone(snap),expected=[];
  for(const[sid,space]of Object.entries(old.spaces))for(const eid of Object.keys(space.entities))expected.push(sid+'\0'+eid);
  require(Array.isArray(p.entityUpdates)&&p.entityUpdates.length===expected.length,'MATERIAL_UPDATES');
  const seen=new Set();
  for(const u of p.entityUpdates){
    exact(u,['spaceId','id','q','v','revision'],'MATERIAL_UPDATE_KEYS');
    const key=u.spaceId+'\0'+u.id,base=snap.spaces?.[u.spaceId]?.entities?.[u.id],cs=old.spaces?.[u.spaceId];
    require(expected.includes(key)&&!seen.has(key)&&base&&cs,'MATERIAL_UPDATE_ID');seen.add(key);
    require((u.revision===base.revision||u.revision===base.revision+1)&&vector(u.q,cs.dimension)&&vector(u.v,cs.dimension,-100,100),'MATERIAL_UPDATE');
    const changed=!eq(u.q,base.q)||!eq(u.v,base.v);
    require((changed&&u.revision===base.revision+1)||(!changed&&u.revision===base.revision),'MATERIAL_REVISION_SEMANTICS');
    Object.assign(candidate.spaces[u.spaceId].entities[u.id],{q:structuredClone(u.q),v:structuredClone(u.v),revision:u.revision});
  }
  candidate.simulationTime=p.fieldState.simulationTime;
  for(const sid of Object.keys(old.spaces))candidate.spaces[sid].field.hash=p.fieldState.digest;
  validateCheckpoint(candidate,p.fieldState);
  require(eq(Object.keys(p.fieldState.spaces).sort(),Object.keys(old.spaces).sort()),'MATERIAL_DOMAIN_CHANGED');
  exact(p.diagnostics,['mass','energy','suppliedWork','dissipatedEnergy','residual'],'MATERIAL_DIAGNOSTICS');
  require(Object.values(p.diagnostics).every(v=>num(v)),'MATERIAL_DIAGNOSTICS');
  require(Array.isArray(p.edgeDiagnostics)&&p.edgeDiagnostics.length<=256,'MATERIAL_DIAGNOSTICS');
  for(const d of p.edgeDiagnostics){
    exact(d,['spaceId','a','b','strain','stiffness','force'],'MATERIAL_DIAGNOSTICS');
    require(Object.hasOwn(old.spaces,d.spaceId)&&num(d.strain,-1e6,1e6)&&num(d.stiffness,.5,2)&&num(d.force,0,1e9),'MATERIAL_DIAGNOSTICS');
  }
  return candidate;
}
export function checkCommitProvenance(state,p,now){
  require(state.snapshot.acceptedSequence===p.baseSequence&&state.snapshot.stateHash===p.baseStateHash&&state.material.checkpoint.digest===p.baseFieldDigest,'MATERIAL_STALE_AUTHORITY');
  require(eq(leaseProofs(state,now),p.acceptedLeaseProofs),'MATERIAL_STALE_CONSTRAINTS');
}
export function materialEvent(p){
  const event={schema:'vivo.material-adaptive-accepted/1',proposalDigest:materialDigest(p),spaceId:p.spaceId,
    baseSequence:p.baseSequence,baseStateHash:p.baseStateHash,baseFieldDigest:p.baseFieldDigest,fieldDigest:p.fieldState.digest,
    entityUpdates:structuredClone(p.entityUpdates),acceptedLeaseProofs:structuredClone(p.acceptedLeaseProofs),
    constraintDigest:p.constraintDigest,capturedAtMs:p.capturedAtMs,dt:p.dt,tick:p.tick,simulationTime:p.fieldState.simulationTime,
    lawVersion:p.lawVersion,modelHashes:[MODEL],diagnostics:structuredClone(p.diagnostics),edgeDiagnostics:structuredClone(p.edgeDiagnostics)};
  require(Buffer.byteLength(JSON.stringify(event),'utf8')<64*1024,'MATERIAL_EVENT_BUDGET');return event;
}
