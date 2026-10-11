/** Trusted-host-only phase envelope validation. This does not reimplement the FFT
 * solver: Python owns numerical semantics; Node owns identity/provenance/atomicity.
 * Loaded dynamically only when the host explicitly selects this protocol. */
import {materialDigest, verifyMaterialDigest} from '../../../vivo_material/codec.mjs';
export const MATERIAL_PROTOCOL = 'vivo.lease-material/1';
const CODEC = 'vivo.material.phase/1';
const LAW = 'vivo.phase.periodic-compliant/1';
const TEACHER = '0580e63e9a7dac96b70ffd5ed559b2ccd063f0526066fe38bafa571ca0d27947';
const fail = code => { throw Object.assign(new Error(code), {code}); };
const require = (ok, code) => { if (!ok) fail(code); };
const plain = v => v && Object.getPrototypeOf(v) === Object.prototype;
const id = v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const num = (v, lo=-Number.MAX_SAFE_INTEGER, hi=Number.MAX_SAFE_INTEGER) => typeof v==='number' && Number.isFinite(v) && v>=lo && v<=hi;
const int = (v, lo=0, hi=Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v>=lo && v<=hi;
const eq = (a,b) => materialDigest(a)===materialDigest(b);
const keys = (v, list, code) => require(plain(v) && eq(Object.keys(v).sort(), [...list].sort()), code);
const vector = (v, lo, hi) => Array.isArray(v) && v.length===4 && Array.from(v).every(x=>num(x,lo,hi));
const inDomain = (v,lengths) => vector(v,-16,16) && v.every((x,i)=>x>=-lengths[i]/2 && x<lengths[i]/2);

export function invariantFingerprint(snapshot, spaceId, entityId) {
  const space=snapshot.spaces[spaceId], {q,v,revision,...identity}=space.entities[entityId];
  const {entities,field,...structure}=space;
  const {hash:fieldHash,...fieldIdentity}=field;
  return materialDigest({worldId:snapshot.worldId,authorityId:snapshot.authorityId,identity,structure,fieldIdentity});
}
export function leaseProofs(leases, spaceId, now) {
  return Object.values(leases).filter(l=>l.spaceId===spaceId && l.expiresAt>now && l.target!==null)
    .map(l=>Object.fromEntries(['id','actorId','spaceId','entityId','source','inputEpoch','targetSeq','expiresAt','target'].map(k=>[k,structuredClone(l[k])])));
}

function fieldBytes(encoded, count, complex) {
  const size=count*(complex?16:8);
  require(typeof encoded==='string' && encoded.length===4*Math.ceil(size/3) && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded),'MATERIAL_FIELD_BYTES');
  const bytes=Buffer.from(encoded,'base64');
  require(bytes.length===size && bytes.toString('base64')===encoded,'MATERIAL_FIELD_BYTES');
  let norm=0;
  for(let offset=0;offset<size;offset+=complex?16:8) {
    const real=bytes.readDoubleLE(offset), imag=complex?bytes.readDoubleLE(offset+8):0;
    require(Number.isFinite(real)&&Number.isFinite(imag),'MATERIAL_NONFINITE_FIELD');
    if(complex) { const squared=real*real+imag*imag;require(squared<=10000,'MATERIAL_FIELD_BOUNDS');norm+=squared; }
    else require(Math.abs(real)<=1e4,'MATERIAL_FIELD_BOUNDS');
  }
  return norm;
}

export function validateCheckpoint(snapshot, spaceId, cp) {
  keys(cp,['schema','hashCodec','lawVersion','teacherHash','modelHashes','spaceId','shape','lengths','coupling','simulationTime','tick','fields','digest'],'MATERIAL_CHECKPOINT_KEYS');
  verifyMaterialDigest(cp);
  const space=snapshot.spaces[spaceId];
  require(id(spaceId)&&plain(space)&&space.id===spaceId && cp.spaceId===spaceId,'MATERIAL_SPACE');
  require(space.dimension===4&&space.intrinsicDimension===4,'MATERIAL_DIMENSION');
  require(eq(space.law,{id:'vivo.phase.periodic-compliant',version:'1'}) && cp.lawVersion===LAW && cp.teacherHash===TEACHER,'MATERIAL_LAW');
  require(space.atlasId==='atlas.periodic-cartesian.v1'&&space.metricId==='metric.flat-euclidean.v1'&&space.topologyId==='topology.periodic-torus.v1','MATERIAL_GEOMETRY');
  require(eq(space.modelHashes,[])&&eq(cp.modelHashes,[]),'MATERIAL_MODELS');
  require(plain(space.field)&&space.field.codec===CODEC&&space.field.hash===cp.digest,'MATERIAL_FIELD_HASH');
  require(Array.isArray(cp.shape)&&cp.shape.length===4&&cp.shape.every(n=>int(n,8,16)&&n%2===0),'MATERIAL_RESOLUTION');
  require(vector(cp.lengths,4,32)&&num(cp.coupling,0,10),'MATERIAL_DOMAIN');
  require(int(cp.tick,0,1000000)&&num(cp.simulationTime,0,1e9)&&cp.simulationTime===snapshot.simulationTime,'MATERIAL_TIME');
  require(plain(cp.fields)&&plain(space.entities),'MATERIAL_FIELDS');
  const eids=Object.keys(space.entities), cells=cp.shape.reduce((v,n)=>v*n,1);
  require(eids.length>=1&&eids.length<=4&&cells*eids.length<=262144&&eq(eids.sort(),Object.keys(cp.fields).sort()),'MATERIAL_MEMBERSHIP');
  const members=new Set(), masses=Object.create(null);
  for(const eid of eids) {
    const e=space.entities[eid],f=cp.fields[eid];
    keys(f,['id','chart','revision','membership','initialMass','psi','potential','q','v'],'MATERIAL_FIELD_KEYS');
    require(id(eid)&&e.id===eid&&f.id===eid&&e.spaceId===spaceId&&e.dimension===4&&id(e.chart)&&f.chart===e.chart,'MATERIAL_ENTITY_ID');
    require(e.materialProfile==='phase','MATERIAL_PROFILE');
    require(int(e.revision,0,Number.MAX_SAFE_INTEGER-1)&&f.revision===e.revision,'MATERIAL_REVISION');
    require(Array.isArray(e.fieldMembership)&&e.fieldMembership.length===1&&id(e.fieldMembership[0])&&eq(e.fieldMembership,f.membership)&&!members.has(e.fieldMembership[0]),'MATERIAL_MEMBERSHIP');
    members.add(e.fieldMembership[0]);
    require(inDomain(e.q,cp.lengths)&&inDomain(f.q,cp.lengths)&&eq(e.q,f.q)&&vector(e.v,-100,100)&&vector(f.v,-100,100)&&eq(e.v,f.v),'MATERIAL_ENTITY_FIELD');
    require(num(f.initialMass,.01,100),'MATERIAL_MASS');
    const mass=fieldBytes(f.psi,cells,true)*cp.lengths.reduce((v,L,i)=>v*L/cp.shape[i],1);
    fieldBytes(f.potential,cells,false);
    require(num(mass,.009,101)&&Math.abs(mass/f.initialMass-1)<1e-8,'MATERIAL_MASS');
    masses[eid]=mass;
  }
  return masses;
}

export function validateMaterialState(state, protocol) {
  require(protocol===MATERIAL_PROTOCOL,'MATERIAL_PROTOCOL');
  keys(state.material,['protocol','spaceId','checkpoint'],'MATERIAL_STATE');
  require(state.material.protocol===protocol,'MATERIAL_PROTOCOL');
  validateCheckpoint(state.snapshot,state.material.spaceId,state.material.checkpoint);
  for(const lease of Object.values(state.leases)) if(lease.spaceId===state.material.spaceId) {
    require(int(lease.inputReceiptRevision)&&int(lease.materialCoverageRevision)&&lease.inputReceiptRevision<=lease.materialCoverageRevision&&hash(lease.materialInvariant),'MATERIAL_LEASE_CURSOR');
  }
}

export function checkMaterialLeases(state) {
  for(const lease of Object.values(state.leases)) if(lease.spaceId===state.material.spaceId) {
    const entity=state.snapshot.spaces[lease.spaceId].entities[lease.entityId];
    require(entity && lease.materialCoverageRevision===entity.revision && lease.materialInvariant===invariantFingerprint(state.snapshot,lease.spaceId,lease.entityId),'MATERIAL_LEASE_INVALIDATED');
  }
}

export function validateProposal(state, p, now) {
  checkMaterialLeases(state);
  // Hash traversal supplies independent size/type/cycle/depth bounds before cloning.
  materialDigest(p);
  keys(p,['fieldState','entityUpdates','diagnostics','fieldDiagnostics','lawVersion','modelHashes','randomState','schema','worldId','authorityId','spaceId','baseSequence','baseStateHash','baseFieldDigest','baseEntityRevisions','dt','tick','capturedAtMs','acceptedLeaseProofs','constraintDigest'],'MATERIAL_PROPOSAL_KEYS');
  const snapshot=state.snapshot, material=state.material, old=material.checkpoint, space=snapshot.spaces[material.spaceId];
  require(p.schema==='vivo.material-proposal.local/1'&&p.worldId===snapshot.worldId&&p.authorityId===snapshot.authorityId&&p.spaceId===material.spaceId,'MATERIAL_IDENTITY');
  require(p.baseSequence===snapshot.acceptedSequence&&p.baseStateHash===snapshot.stateHash,'MATERIAL_STALE_AUTHORITY');
  require(p.baseFieldDigest===old.digest&&space.field.hash===old.digest,'MATERIAL_STALE_FIELD');
  require(eq(p.baseEntityRevisions,Object.fromEntries(Object.entries(space.entities).map(([id,e])=>[id,e.revision]))),'MATERIAL_STALE_REVISION');
  require(num(now,0)&&num(p.capturedAtMs,0,now),'MATERIAL_CAPTURE_TIME');
  const proofs=leaseProofs(state.leases,material.spaceId,now);
  require(eq(p.acceptedLeaseProofs,proofs)&&p.constraintDigest===materialDigest(proofs),'MATERIAL_STALE_CONSTRAINTS');
  require(num(p.dt,.0001,.02)&&int(p.tick,1,1000000)&&p.tick===old.tick+1&&p.fieldState.tick===p.tick&&p.fieldState.simulationTime===old.simulationTime+p.dt,'MATERIAL_TICK');
  require(p.lawVersion===LAW&&eq(p.modelHashes,[])&&p.randomState==='deterministic:none','MATERIAL_VERSION');
  require(Array.isArray(p.entityUpdates)&&p.entityUpdates.length===Object.keys(space.entities).length,'MATERIAL_UPDATES');
  const candidate=structuredClone(snapshot),updated=candidate.spaces[material.spaceId],seen=new Set();
  for(const u of p.entityUpdates) {
    keys(u,['id','q','v','chart'],'MATERIAL_UPDATE_KEYS');
    require(Object.hasOwn(space.entities,u.id)&&!seen.has(u.id)&&u.chart===space.entities[u.id].chart,'MATERIAL_UPDATE_ID');seen.add(u.id);
    require(space.entities[u.id].revision<Number.MAX_SAFE_INTEGER-2,'MATERIAL_REVISION_EXHAUSTED');
    Object.assign(updated.entities[u.id],{q:u.q,v:u.v,revision:space.entities[u.id].revision+1});
  }
  updated.field.hash=p.fieldState.digest;candidate.simulationTime=p.fieldState.simulationTime;
  const masses=validateCheckpoint(candidate,material.spaceId,p.fieldState);
  for(const name of ['schema','hashCodec','lawVersion','teacherHash','modelHashes','spaceId','shape','lengths','coupling']) require(eq(p.fieldState[name],old[name]),'MATERIAL_DOMAIN_CHANGED');
  for(const [eid,f] of Object.entries(old.fields)) require(p.fieldState.fields[eid].initialMass===f.initialMass,'MATERIAL_MASS_CHANGED');
  keys(p.diagnostics,['mass','energy','suppliedWork','dissipatedEnergy','residual'],'MATERIAL_DIAGNOSTICS');
  require(Object.values(p.diagnostics).every(v=>num(v))&&p.diagnostics.dissipatedEnergy===0&&Math.abs(p.diagnostics.mass-Object.values(masses).reduce((a,b)=>a+b,0))<1e-7,'MATERIAL_DIAGNOSTICS');
  require(Array.isArray(p.fieldDiagnostics)&&p.fieldDiagnostics.length===seen.size,'MATERIAL_DIAGNOSTICS');
  const diagnosed=new Set();
  for(const d of p.fieldDiagnostics) {
    keys(d,['entityId','centerCoherence','mass','relativeMassError','forceBoundPerUnitMass','meanCurrentPerMass','highFrequencyMassFraction','resolutionWarning'],'MATERIAL_DIAGNOSTICS');
    require(seen.has(d.entityId)&&!diagnosed.has(d.entityId),'MATERIAL_DIAGNOSTICS');diagnosed.add(d.entityId);
    require(vector(d.centerCoherence,.015,1+1e-8)&&num(d.mass,.009,101)&&Math.abs(d.mass-masses[d.entityId])<1e-7&&num(d.relativeMassError,-1e-8,1e-8)&&num(d.forceBoundPerUnitMass,0,2+1e-12)&&vector(d.meanCurrentPerMass,-1e5,1e5)&&num(d.highFrequencyMassFraction,0,1+1e-8)&&typeof d.resolutionWarning==='boolean'&&d.resolutionWarning===(d.highFrequencyMassFraction>.01),'MATERIAL_DIAGNOSTICS');
  }
  return candidate;
}

export function checkCommitProvenance(state,p,now) {
  require(num(now,0)&&now>=p.capturedAtMs,'MATERIAL_CAPTURE_TIME');
  require(state.snapshot.acceptedSequence===p.baseSequence&&state.snapshot.stateHash===p.baseStateHash&&state.material.checkpoint.digest===p.baseFieldDigest,'MATERIAL_STALE_AUTHORITY');
  require(eq(leaseProofs(state.leases,p.spaceId,now),p.acceptedLeaseProofs),'MATERIAL_STALE_CONSTRAINTS');
}
export function materialEvent(p) {
  const event={schema:'vivo.material-accepted/1',proposalDigest:materialDigest(p),solverProfile:'vivo.phase.adapter-default/1',actuator:{maxForce:2,stiffness:2,damping:0},spaceId:p.spaceId,baseSequence:p.baseSequence,baseStateHash:p.baseStateHash,
    baseFieldDigest:p.baseFieldDigest,fieldDigest:p.fieldState.digest,baseEntityRevisions:structuredClone(p.baseEntityRevisions),
    entityUpdates:p.entityUpdates.map(u=>({...structuredClone(u),revision:p.baseEntityRevisions[u.id]+1})),
    acceptedLeaseProofs:structuredClone(p.acceptedLeaseProofs),constraintDigest:p.constraintDigest,capturedAtMs:p.capturedAtMs,
    dt:p.dt,tick:p.tick,simulationTime:p.fieldState.simulationTime,lawVersion:p.lawVersion,teacherHash:p.fieldState.teacherHash,
    modelHashes:[],randomState:p.randomState,diagnostics:structuredClone(p.diagnostics),fieldDiagnostics:structuredClone(p.fieldDiagnostics)};
  require(Buffer.byteLength(JSON.stringify(event),'utf8')<64*1024,'MATERIAL_EVENT_BUDGET');
  return event;
}
