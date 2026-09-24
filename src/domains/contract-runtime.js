import {createContractAutomation} from './contract-automation.js';
import {createPersistentContractWorkspace} from './outcome-persistence.js';
import {createContractFlow} from './contract-flow.js';
import {createFrozenRelics} from './frozen-relics.js';
import {createOutcomeContracts} from './outcome-contracts.js';

/** Storage access belongs to the domain boundary, never the renderer. An
 * unavailable store fails visibly rather than silently losing contract history. */
function browserStorage() {
  let storage;
  try { storage = globalThis.localStorage; }
  catch(error) { throw new Error(`Contract storage unavailable: ${error.message}`); }
  if (!storage) throw new Error('Durable contract storage is unavailable in this browser');
  return storage;
}

export function createBrowserContractAutomation(options = {}) {
  return createContractAutomation({...options, storage:browserStorage()});
}
export function createBrowserContractWorkspace(options = {}) {
  return createPersistentContractWorkspace({...options,storage:browserStorage()});
}
export function createBrowserContractFlow(options = {}) {
  return createContractFlow({...options,storage:browserStorage()});
}

/** Keeps the rest of the world navigable when this store cannot restore.
 * This is an EMPTY held projection, never a replacement writable workspace.
 * All mutation entrypoints throw the same actionable storage error. */
export function createUnavailableContractWorkspace(error) {
  const message=String(error?.message??error);
  const persistence=Object.freeze({mode:'unavailable',status:'held',error:message});
  const deny=()=>{throw new Error(`Contract workspace unavailable: ${message}. Saved data has not been changed.`);};
  const empty=api=>{
    const result={};
    for(const [name,value] of Object.entries(api))result[name]=typeof value==='function'?deny:value;
    // Domain snapshots are immutable; construct a fresh empty serializable view.
    result.getSnapshot=()=>Object.freeze(Object.fromEntries(Object.entries({...api.getSnapshot(),persistence,unavailable:true}).map(([key,value])=>[key,Array.isArray(value)?[]:typeof value==='number'&&!['schemaVersion'].includes(key)?0:value])));
    for(const name of ['list','listRelics','listNfts','listEscrows','getLifecycle','claimableFor'])if(name in api)result[name]=()=>[];
    for(const name of ['get','getRelic','getNft'])if(name in api)result[name]=()=>null;
    result.createContribution=()=>{const contribution=api.createContribution();return {...contribution,entities:[],evidence:[{id:`${contribution.source}:unavailable`,kind:'storage-error',status:'unavailable',message}],capabilities:[]};};
    result.getPersistenceStatus=()=>persistence;
    return Object.freeze(result);
  };
  return Object.freeze({vault:empty(createFrozenRelics()),outcomeDesk:empty(createOutcomeContracts()),getPersistenceStatus:()=>persistence,subscribe:()=>()=>{},exportState:deny,reloadFromStorage:deny});
}
