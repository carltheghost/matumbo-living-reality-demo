// A bounded tab-local evidence journal, not a neural model or a billing ledger.
// The original council envelope is retained and revalidated on every recall.
// SHA-256 detects inconsistent bytes, not provider authentication.
import {parseCouncilReport,summarizeCouncilMission,COUNCIL_MISSION_SCHEMA} from "./provider-council-evidence.js";
export const COUNCIL_MEMORY_KEY="matumbo.neural-memory.council.v1";
export const COUNCIL_MEMORY_LIMIT=64;
export const COUNCIL_MEMORY_MAX_BYTES=524288;
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
    try{
      if(typeof raw!=="string"||new TextEncoder().encode(raw).length>COUNCIL_MEMORY_MAX_BYTES)throw invalid();
      const envelopes=JSON.parse(raw);
      if(!Array.isArray(envelopes)||envelopes.length>COUNCIL_MEMORY_LIMIT)throw invalid();
      const ids=new Set(),entries=[];
      for(const envelope of envelopes){
        const report=await parseCouncilReport(envelope,{cryptoApi});
        if(ids.has(report.runId))throw invalid();
        ids.add(report.runId);entries.push({envelope,report,record:project(envelope,report)});
      }
      return {raw,entries};
    }catch{throw invalid();}
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
      if(readRaw(storage)!==raw)throw Error("Neural Memory changed; recall before saving again.");
      try{
        storage.setItem(COUNCIL_MEMORY_KEY,bytes);
        if(readRaw(storage)!==bytes)throw Error();
      }catch{throw Error("Neural Memory could not be saved; check tab storage.");}
      return freeze({status:"recorded",record});
    });
  }
  const snapshot=()=>serialize(storage,async()=>freeze((await load()).entries.map(entry=>entry.record).reverse()));
  const search=options=>snapshot().then(records=>filterCouncilMemory(records,options));
  const getEvidence=memoryId=>serialize(storage,async()=>{
    const entry=(await load()).entries.find(item=>item.record.memoryId===memoryId);
    return entry?freeze(entry.envelope):null;
  });
  return Object.freeze({archive,snapshot,search,getEvidence});
}
