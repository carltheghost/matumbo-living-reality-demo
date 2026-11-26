// A bounded tab-local evidence journal, not a neural model or a billing ledger.
// The original council envelope is retained and revalidated on every recall.
// SHA-256 detects inconsistent bytes, not provider authentication.
import {parseCouncilReport,summarizeCouncilMission,COUNCIL_MISSION_SCHEMA} from "./provider-council-evidence.js";
export const COUNCIL_MEMORY_KEY="matumbo.neural-memory.council.v1";
export const COUNCIL_MEMORY_LIMIT=64;
export const COUNCIL_MEMORY_MAX_BYTES=524288;
export const COUNCIL_CAPSULE_SCHEMA="matumbo.neural-memory-capsule/1";
export const COUNCIL_CAPSULE_MAX_BYTES=2*COUNCIL_MEMORY_MAX_BYTES+4096;
const byteLength=value=>new TextEncoder().encode(value).length;
const exact=(value,keys)=>value!==null&&typeof value==="object"&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hex=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
async function digest(value,cryptoApi){
  if(!cryptoApi?.subtle)throw Error("Neural Memory integrity check unavailable.");
  return Array.from(new Uint8Array(await cryptoApi.subtle.digest("SHA-256",new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,"0")).join("");
}
async function validateJournal(raw,cryptoApi,{canonical=false}={}){
  if(typeof raw!=="string"||raw.length>COUNCIL_MEMORY_MAX_BYTES||byteLength(raw)>COUNCIL_MEMORY_MAX_BYTES)throw invalid();
  const envelopes=JSON.parse(raw);
  if(!Array.isArray(envelopes)||envelopes.length>COUNCIL_MEMORY_LIMIT||
    (canonical&&JSON.stringify(envelopes)!==raw))throw invalid();
  const ids=new Set(),entries=[];
  for(const envelope of envelopes){
    const report=await parseCouncilReport(envelope,{cryptoApi});
    if(ids.has(report.runId))throw invalid();
    ids.add(report.runId);
    entries.push({envelope,report,record:project(envelope,report)});
  }
  return entries;
}
function capsuleCopy(capsule){
  // Copy before yielding and bound both the inner and escaped outer bytes.
  if(!exact(capsule,["schema","journalJson","journalSha256"])||capsule.schema!==COUNCIL_CAPSULE_SCHEMA||
    typeof capsule.journalJson!=="string"||capsule.journalJson.length>COUNCIL_MEMORY_MAX_BYTES||
    !hex(capsule.journalSha256)||byteLength(JSON.stringify(capsule))>COUNCIL_CAPSULE_MAX_BYTES)
    throw Error("Invalid Neural Memory capsule.");
  return {schema:capsule.schema,journalJson:capsule.journalJson,journalSha256:capsule.journalSha256};
}
async function validateCapsule(capsule,cryptoApi){
  if(await digest(capsule.journalJson,cryptoApi)!==capsule.journalSha256)throw Error("Neural Memory capsule digest mismatch.");
  try{return await validateJournal(capsule.journalJson,cryptoApi,{canonical:true});}
  catch{throw Error("Invalid Neural Memory capsule; no evidence was changed.");}
}
function mergeJournal(current,incoming){
  const known=new Map(current.map(entry=>[entry.report.runId,entry]));
  const added=[];
  let duplicates=0;
  for(const entry of incoming){
    const previous=known.get(entry.report.runId);
    if(previous){
      if(previous.envelope.reportSha256!==entry.envelope.reportSha256)
        throw Error("Capsule conflicts with saved Neural Memory evidence; nothing was changed.");
      duplicates++;
    }else{
      known.set(entry.report.runId,entry);added.push(entry);
    }
  }
  const entries=[...current,...added];
  const bytes=JSON.stringify(entries.map(entry=>entry.envelope));
  if(entries.length>COUNCIL_MEMORY_LIMIT||byteLength(bytes)>COUNCIL_MEMORY_MAX_BYTES)
    throw Error("Neural Memory is full; no evidence was removed.");
  return {entries,bytes,added:added.length,duplicates};
}
const tails=new WeakMap();
const invalid=()=>new Error("Neural Memory evidence is invalid; nothing was changed.");
const unavailable=()=>new Error("Neural Memory tab storage is unavailable.");
const freeze=value=>{
  if(value&&typeof value==="object"&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
};
function validStore(storage){
  return storage&&typeof storage==="object"&&typeof storage.getItem==="function"&&typeof storage.setItem==="function";
}
function serialize(storage,operation){
  if(!validStore(storage))return Promise.reject(unavailable());
  const next=(tails.get(storage)??Promise.resolve()).then(operation);
  // A rejected operation must not poison subsequent recall or archive.
  const tail=next.catch(()=>{});
  tails.set(storage,tail);
  void tail.then(()=>{if(tails.get(storage)===tail)tails.delete(storage);});
  return next;
}
function readRaw(storage){
  try{return storage.getItem(COUNCIL_MEMORY_KEY);}catch{throw unavailable();}
}
function project(envelope,report){
  const mission=report.schema===COUNCIL_MISSION_SCHEMA?summarizeCouncilMission(report):null;
  const rows=report.rows.map(row=>{
    const judged=mission?.rows.find(item=>item.provider===row.provider);
    return {provider:row.provider,model:row.resolvedModel??row.requestedModel,
      status:row.status,verdict:judged?.verdict??(row.answerCorrect===null?"unknown":row.answerCorrect?"correct":"incorrect"),
      candidate:judged?.plan?.candidate??null,plan:judged?.plan??null,usage:row.usage};
  });
  return freeze({memoryId:"council:"+envelope.reportSha256,evidenceDigest:envelope.reportSha256,
    runId:report.runId,reportedAt:report.createdAt,mode:report.mode,task:report.task,
    provenance:report.mode==="fixture"?"synthetic-fixture":"host-reported-unverified",
    authority:"evidence-only",providerAuthenticated:false,postedChargesUsd:null,worldActionExecuted:false,
    localOptimum:mission?.optimum??null,rows});
}
export function filterCouncilMemory(records,{query="",mode="all"}={}){
  if(!Array.isArray(records)||typeof query!=="string"||query.length>128||!["all","fixture","live"].includes(mode))throw Error("Invalid memory search.");
  const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return Object.freeze(records.filter(record=>{
    if(mode!=="all"&&record.mode!==mode)return false;
    const searchable=[record.memoryId,record.runId,record.task,record.mode,record.provenance,
      ...record.rows.flatMap(row=>[row.provider,row.model,row.status,row.verdict,row.candidate])].join(" ").toLowerCase();
    return terms.every(term=>searchable.includes(term));
  }));
}
export function createCouncilMemory({storage,cryptoApi=globalThis.crypto}={}){
  async function load(){
    const raw=readRaw(storage);
    if(raw===null)return {raw,entries:[]};
    try{return {raw,entries:await validateJournal(raw,cryptoApi)};}
    catch{throw invalid();}
  }
  function writeJournal(raw,bytes){
    // Web Storage's single setItem is the only mutation. It is not a
    // distributed transaction, and cannot make browser storage tamper-proof.
    if(readRaw(storage)!==raw)throw Error("Neural Memory changed; recall before saving again.");
    try{
      storage.setItem(COUNCIL_MEMORY_KEY,bytes);
      if(readRaw(storage)!==bytes)throw Error();
    }catch{throw Error("Neural Memory could not be saved; check tab storage.");}
  }
  function archive(envelope){
    // Snapshot the exact supplied envelope before yielding to async hashing.
    let copy;try{copy=JSON.parse(JSON.stringify(envelope));}catch{return Promise.reject(invalid());}
    return serialize(storage,async()=>{
      const report=await parseCouncilReport(copy,{cryptoApi});
      const record=project(copy,report);
      const {raw,entries}=await load();
      const previous=entries.find(entry=>entry.report.runId===report.runId);
      if(previous){
        if(previous.envelope.reportSha256!==copy.reportSha256)throw Error("This run conflicts with saved Neural Memory evidence.");
        return freeze({status:"duplicate",record:previous.record});
      }
      if(entries.length>=COUNCIL_MEMORY_LIMIT)throw Error("Neural Memory is full; no evidence was removed.");
      const bytes=JSON.stringify([...entries.map(entry=>entry.envelope),copy]);
      if(new TextEncoder().encode(bytes).length>COUNCIL_MEMORY_MAX_BYTES)throw Error("Neural Memory is full; no evidence was removed.");
      // Recheck after async validation. Same-document writes are serialized;
      // this is not a cross-document transactional or tamper-proof store.
      writeJournal(raw,bytes);
      return freeze({status:"recorded",record});
    });
  }
  const snapshot=()=>serialize(storage,async()=>freeze((await load()).entries.map(entry=>entry.record).reverse()));
  const search=options=>snapshot().then(records=>filterCouncilMemory(records,options));
  const getEvidence=memoryId=>serialize(storage,async()=>{
    const entry=(await load()).entries.find(item=>item.record.memoryId===memoryId);
    return entry?freeze(entry.envelope):null;
  });
  const exportCapsule=()=>serialize(storage,async()=>{
    const {entries}=await load();
    const journalJson=JSON.stringify(entries.map(entry=>entry.envelope));
    const capsule={schema:COUNCIL_CAPSULE_SCHEMA,journalJson,journalSha256:await digest(journalJson,cryptoApi)};
    return freeze(capsuleCopy(capsule));
  });
  function previewCapsule(capsule){
    let copy;try{copy=capsuleCopy(capsule);}catch(error){return Promise.reject(error);}
    return serialize(storage,async()=>{
      const incoming=await validateCapsule(copy,cryptoApi),{raw,entries}=await load();
      const merged=mergeJournal(entries,incoming);
      return freeze({capsuleDigest:copy.journalSha256,baseRevision:await digest(JSON.stringify(raw),cryptoApi),
        current:entries.length,incoming:incoming.length,added:merged.added,duplicates:merged.duplicates,
        resulting:merged.entries.length,fixture:incoming.filter(e=>e.report.mode==="fixture").length,
        liveClaims:incoming.filter(e=>e.report.mode==="live").length});
    });
  }
  function restoreCapsule(capsule,review){
    let copy,expectedRevision,expectedDigest;
    try{
      copy=capsuleCopy(capsule);
      expectedRevision=review?.baseRevision;expectedDigest=review?.capsuleDigest;
      if(!hex(expectedRevision)||expectedDigest!==copy.journalSha256)
        throw Error("Preview this exact capsule before restoring.");
    }catch(error){return Promise.reject(error);}
    return serialize(storage,async()=>{
      const incoming=await validateCapsule(copy,cryptoApi),{raw,entries}=await load();
      if(await digest(JSON.stringify(raw),cryptoApi)!==expectedRevision)
        throw Error("Neural Memory changed; preview the capsule again.");
      const merged=mergeJournal(entries,incoming);
      if(merged.added)writeJournal(raw,merged.bytes);
      else if(readRaw(storage)!==raw)throw Error("Neural Memory changed; preview the capsule again.");
      return freeze({status:merged.added?"restored":"unchanged",added:merged.added,duplicates:merged.duplicates,total:merged.entries.length});
    });
  }
  return Object.freeze({archive,snapshot,search,getEvidence,exportCapsule,previewCapsule,restoreCapsule});
}
