/** Separate, device-local sensory history. Never rewrites canonical world/agent data. */
export class EncounterStore {
  constructor(indexedDB=globalThis.indexedDB){this.indexedDB=indexedDB;this.db=null;this.opening=null;}
  open(){
    if(!this.indexedDB)return Promise.reject(new Error('ENCOUNTER_STORAGE_UNAVAILABLE'));
    if(this.db)return Promise.resolve(this.db);if(this.opening)return this.opening;
    this.opening=new Promise((resolve,reject)=>{
      const request=this.indexedDB.open('vivo-object-encounters',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('history');
      request.onerror=()=>reject(request.error||new Error('ENCOUNTER_STORAGE_FAILED'));
      request.onblocked=()=>reject(new Error('ENCOUNTER_STORAGE_BLOCKED'));
      request.onsuccess=()=>{this.db=request.result;this.db.onversionchange=()=>{this.db.close();this.db=null;};resolve(this.db);};
    }).finally(()=>{this.opening=null;});return this.opening;
  }
  async load(key){
    const db=await this.open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('history','readonly'),r=tx.objectStore('history').get(key);
      tx.oncomplete=()=>resolve(r.result?structuredClone(r.result):{revision:0,value:null});
      tx.onerror=tx.onabort=()=>reject(tx.error||new Error('ENCOUNTER_READ_FAILED'));
    });
  }
  async save(key,value,expectedRevision){
    const copy=structuredClone(value),db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('history','readwrite'),store=tx.objectStore('history'),r=store.get(key);let conflict=false;
      r.onsuccess=()=>{if((r.result?.revision??0)!==expectedRevision){conflict=true;tx.abort();return;}store.put({revision:expectedRevision+1,value:copy},key);};
      tx.oncomplete=()=>resolve(expectedRevision+1);
      tx.onerror=tx.onabort=()=>reject(new Error(conflict?'ENCOUNTER_OTHER_TAB_CHANGED':'ENCOUNTER_SAVE_FAILED'));
    });
  }
}
