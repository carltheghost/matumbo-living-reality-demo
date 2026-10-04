/** Durable manual contract rehearsals. This journal replays the existing atelier
 * engine; it cannot change the shared outcome desk, token owner, or real funds.
 * The digest detects damaged state, not authenticated authorship or chain proof. */
import { createContractAtelier, CONTRACT_ATELIER_BOUNDARY, CONTRACT_ATELIER_SOURCE } from './contract-atelier.js?v=20261003-skin360';
import { sha256Hex } from './token-sha256.js?v=20261003-skin360';

export const CONTRACT_ATELIER_STORAGE_KEY = 'matumbo.contract-atelier.v1';
export const CONTRACT_ATELIER_MAX_COMMANDS = 1000;
export const CONTRACT_ATELIER_MAX_BACKUP_CHARS = 2_000_000;
const FORMAT = 'matumbo-manual-contract-atelier-v1';
const FIELDS = Object.freeze({
  createContract:['key','type','role','topic','title','logic','outcomes','houseMode','feeBps','liquidityB','houseCapital'],
  placeStake:['contractId','side','amount','participant'],
  registerHouse:['contractId','participant','house','amount','capital'],
  joinHousePool:['contractId','participant','house','amount','capital'],
  sellPosition:['contractId','positionId','shares','participant'],
  resolveContract:['contractId','facts','winner'],
});
function browserStorage() { try { return globalThis.localStorage ?? null; } catch { return null; } }
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) { if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; }
function plain(value, fields, label, exact=false) {
  if(!value || typeof value!=='object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key=>!fields.includes(key)) || (exact && fields.some(key=>!Object.hasOwn(value,key))))throw new TypeError(`${label} has unsupported or missing fields`);
}
function json(value, depth=0) {
  if(depth>16)throw new TypeError('Manual contract input is too deeply nested');
  if(value===null || typeof value==='boolean' || (typeof value==='number' && Number.isFinite(value)))return;
  if(typeof value==='string' && value.length<=4000)return;
  if(Array.isArray(value) && value.length<=128){value.forEach(row=>json(row,depth+1));return;}
  if(value && typeof value==='object' && [Object.prototype,null].includes(Object.getPrototypeOf(value)) && Object.keys(value).length<=128){
    for(const [key,row]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))throw new TypeError('Manual contract input contains an unsafe key');json(row,depth+1);}return;
  }
  throw new TypeError('Manual contract input requires bounded plain JSON');
}
function parameters(method,input={}) {
  const fields=FIELDS[method];if(!fields)throw new TypeError('Unsupported manual contract command');
  plain(input,fields,'Manual contract command');
  const normalized=Object.fromEntries(Object.entries(input).filter(([,value])=>value!==undefined));json(normalized);return clone(normalized);
}
function iso(value) {
  const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new TypeError('Invalid manual contract clock');return date.toISOString();
}
const digest = studio => sha256Hex(JSON.stringify({contracts:studio.list(),trace:studio.getSnapshot().trace}));
function envelope(seed,at) {
  const holder={at},studio=createContractAtelier({seed,now:()=>holder.at});
  return {journal:{format:FORMAT,schemaVersion:1,seed,createdAt:at,simulation:true,commands:[],stateDigest:digest(studio)},studio,holder};
}
function replay(journal) {
  plain(journal,['format','schemaVersion','seed','createdAt','simulation','commands','stateDigest'],'Manual contract backup',true);
  if(journal.format!==FORMAT || journal.schemaVersion!==1 || journal.simulation!==true || typeof journal.seed!=='string' || !journal.seed || journal.seed.length>200 || typeof journal.createdAt!=='string' || iso(journal.createdAt)!==journal.createdAt || !Array.isArray(journal.commands) || journal.commands.length>CONTRACT_ATELIER_MAX_COMMANDS)throw new TypeError('Unsupported manual contract backup');
  const result=envelope(journal.seed,journal.createdAt);let at=journal.createdAt;
  for(const command of journal.commands){
    plain(command,['method','input','at'],'Manual contract journal command',true);
    if(typeof command.at!=='string' || iso(command.at)!==command.at || command.at<at)throw new TypeError('Manual contract command clock moved backwards');
    const input=parameters(command.method,command.input);result.holder.at=at=command.at;
    result.studio[command.method](input);
  }
  if(digest(result.studio)!==journal.stateDigest)throw new TypeError('Manual contract replay does not match the saved state digest');
  result.journal=clone(journal);return result;
}

export function createPersistentContractAtelier({seed='local-contracts',now=()=>Date.now(),storage=browserStorage(),restore=true}={}) {
  const clock=()=>iso((typeof now==='function'?now():now)??Date.now());
  let current=envelope(String(seed).slice(0,200)||'local-contracts',clock()),savedRaw=null;
  let persistence={mode:storage?'browser':'memory',status:storage?'new':'session-only',error:null};
  function assertCurrent({recover=false}={}) {
    if(persistence.status==='held' && !recover)throw new Error(`Manual contract history is held: ${persistence.error}. Reload, import a valid backup, or explicitly reset the manual atelier.`);
    if(!storage)return;
    let raw;try{raw=storage.getItem(CONTRACT_ATELIER_STORAGE_KEY);}catch(error){persistence={mode:'browser',status:'held',error:`Saved manual contracts cannot be read: ${error?.message??error}`};throw new Error(persistence.error);}
    if(raw!==savedRaw){persistence={mode:'browser',status:'held',error:'Another tab changed manual contracts; reload before editing'};throw new Error(persistence.error);}
  }
  function adopt(candidate) {
    const raw=JSON.stringify(candidate.journal);
    if(raw.length>CONTRACT_ATELIER_MAX_BACKUP_CHARS)throw new Error('Manual contract backup capacity reached; export before starting another rehearsal');
    if(storage){
      try{storage.setItem(CONTRACT_ATELIER_STORAGE_KEY,raw);}
      catch(error){persistence={mode:'browser',status:'save-failed',error:String(error?.message??error)};throw new Error(`Manual contract was not changed because saving failed: ${persistence.error}`);}
      savedRaw=raw;
    }
    current=candidate;persistence={mode:storage?'browser':'memory',status:storage?'saved':'session-only',error:null};
  }
  function execute(method,input) {
    assertCurrent();const normalized=parameters(method,input);
    if(current.journal.commands.length>=CONTRACT_ATELIER_MAX_COMMANDS)throw new Error('Manual contract history is full; export before resetting this rehearsal');
    const candidate=replay(current.journal),at=clock();
    if(at<candidate.holder.at)throw new Error('Manual contract clock moved backwards');
    candidate.holder.at=at;const result=candidate.studio[method](normalized);
    candidate.journal.commands.push({method,input:normalized,at});candidate.journal.stateDigest=digest(candidate.studio);
    adopt(candidate);return result;
  }
  function importState(raw) {
    if(typeof raw!=='string' || raw.length>CONTRACT_ATELIER_MAX_BACKUP_CHARS)throw new TypeError('Manual contract backup exceeds its JSON limit');
    let journal;try{journal=JSON.parse(raw);}catch{throw new TypeError('Manual contract backup is not valid JSON');}
    const candidate=replay(journal);assertCurrent({recover:true});adopt(candidate);return getSnapshot();
  }
  function getSnapshot(){return freeze({...current.studio.getSnapshot(),persistence:{...persistence},commandCount:current.journal.commands.length});}
  if(storage && restore){
    try{savedRaw=storage.getItem(CONTRACT_ATELIER_STORAGE_KEY);if(savedRaw){if(savedRaw.length>CONTRACT_ATELIER_MAX_BACKUP_CHARS)throw new TypeError('Manual contract backup exceeds its JSON limit');current=replay(JSON.parse(savedRaw));persistence={mode:'browser',status:'restored',error:null};}}
    catch(error){persistence={mode:'browser',status:'held',error:String(error?.message??error)};}
  }else if(storage){try{savedRaw=storage.getItem(CONTRACT_ATELIER_STORAGE_KEY);}catch(error){persistence={mode:'browser',status:'held',error:String(error?.message??error)};}}
  const api={
    get: id=>current.studio.get(id),list: options=>current.studio.list(options),getSnapshot,
    createContribution:()=>current.studio.createContribution(),
    exportState:()=>JSON.stringify(current.journal),importState,
    reloadFromStorage(){
      if(!storage)return getSnapshot();const raw=storage.getItem(CONTRACT_ATELIER_STORAGE_KEY);
      if(!raw)throw new Error('No saved manual contract collection to reload');
      if(raw.length>CONTRACT_ATELIER_MAX_BACKUP_CHARS)throw new TypeError('Manual contract backup exceeds its JSON limit');
      const candidate=replay(JSON.parse(raw));current=candidate;savedRaw=raw;persistence={mode:'browser',status:'restored',error:null};return getSnapshot();
    },
    reset(){assertCurrent({recover:true});adopt(envelope(current.journal.seed,clock()));return getSnapshot();},
    source:CONTRACT_ATELIER_SOURCE,boundary:CONTRACT_ATELIER_BOUNDARY,
  };
  for(const method of Object.keys(FIELDS))api[method]=input=>execute(method,input);
  return Object.freeze(api);
}
