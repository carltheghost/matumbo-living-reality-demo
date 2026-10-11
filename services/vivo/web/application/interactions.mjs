/** Connection-bound mounted input lifecycle. UI conversion errors cannot bypass
 * lease cleanup, and uncertain source keys remain addressable for reconciliation.
 */
import {frameOf} from './adapters.mjs';
const copy=structuredClone;
const failure=(message,cause)=>Object.assign(new Error(message,{cause}),{code:message});
export class ApplicationInputs {
  constructor({host,nextEpoch,project,onRemove=()=>{}}){
    this.host=host;this.nextEpoch=nextEpoch;this.project=project;this.onRemove=onRemove;
    this.records=new Map();this.known=new Set();this.closed=false;
  }
  get(key){return this.records.get(key);}
  keys(){return [...this.records.keys()];}
  uncertainKeys(){return [...this.known].filter(key=>!this.host.state(key)?.cleanupConfirmed);}
  #forget(key,record){
    if(this.records.get(key)===record)this.records.delete(key);
    if(!this.host.state(key)||this.host.state(key).cleanupConfirmed)this.known.delete(key);
    this.onRemove(key);
  }
  async begin(key,{entity,source,point,observedAt,cooperativeGroup=null}){
    if(this.closed)throw failure('INPUT_CONNECTION_CLOSED');
    if(this.records.has(key))throw failure('INPUT_SOURCE_ACTIVE');
    if(this.known.has(key)&&!this.host.state(key)?.cleanupConfirmed)throw failure('INPUT_RECONCILIATION_REQUIRED');
    const record={key,source,entity:copy(entity),anchor:[...point],latest:{frame:frameOf(entity),observedAt},cooperativeGroup,ended:false,started:false,terminal:null};
    this.records.set(key,record);
    record.ready=(async()=>{
      const inputEpoch=await this.nextEpoch();if(record.ended||this.closed)return;
      record.started=true;this.known.add(key);
      await this.host.begin(key,{entity:record.entity,source,inputEpoch,cooperativeGroup:record.cooperativeGroup});
      if(!record.ended&&record.latest)this.host.offer(key,record.latest.frame,record.latest.observedAt);
    })();
    try{await record.ready;return record;}
    catch(error){this.#forget(key,record);throw error;}
  }
  move(key,point,observedAt){
    const record=this.records.get(key);if(!record||record.ended)return false;
    const frame=this.project(record.entity,record.anchor,point);
    record.latest={frame,observedAt};
    return record.started?this.host.offer(key,frame,observedAt):false;
  }
  offer(key,frame,observedAt){
    const record=this.records.get(key);if(!record||record.ended)return false;
    record.latest={frame:copy(frame),observedAt};
    return record.started?this.host.offer(key,record.latest.frame,observedAt):false;
  }
  async #cleanup(key,record,reason){
    record.ended=true;
    // Before nextEpoch returns, no acquisition exists. Fence the continuation
    // immediately without waiting for an unrelated hung read request.
    if(!record.started)return;
    const first=this.host.cancel(key,reason);
    await Promise.allSettled([first,record.ready]);
    if(!this.host.state(key)?.cleanupConfirmed)await this.host.cancel(key,reason);
    if(this.host.state(key)&&!this.host.state(key).cleanupConfirmed)throw failure('INPUT_CLEANUP_UNCONFIRMED');
  }
  end(key,{point=null,observedAt=null}={}){
    const record=this.records.get(key);if(!record)return Promise.resolve();
    if(record.terminal)return record.terminal;
    record.ended=true;
    record.terminal=(async()=>{
      try{
        // Capture conversion is inside the cleanup boundary. Never re-stamp a
        // sample because acquisition, conversion or transport took time.
        const finalSample=point?{frame:this.project(record.entity,record.anchor,point),observedAt}:null;
        if(!record.started)return;
        await record.ready;
        await this.host.end(key,'input-release',finalSample);
      }catch(error){
        try{await this.#cleanup(key,record,'invalid-or-uncertain-final-input');}
        catch(cleanup){throw failure('INPUT_CLEANUP_UNCONFIRMED',cleanup);}
        throw error;
      }finally{this.#forget(key,record);}
    })();
    return record.terminal;
  }
  async cancel(key,reason){
    const record=this.records.get(key);
    if(!record){if(this.known.has(key)){await this.host.cancel(key,reason);if(this.host.state(key)?.cleanupConfirmed)this.known.delete(key);}return;}
    try{await this.#cleanup(key,record,reason);}finally{this.#forget(key,record);}
  }
  async cancelAll(reason){
    const keys=new Set([...this.records.keys(),...this.known]);
    const results=await Promise.allSettled([...keys].map(key=>this.cancel(key,reason)));
    if(results.some(r=>r.status==='rejected'))throw failure('INPUT_CLEANUP_UNCONFIRMED');
  }
  async releaseAll(){const results=await Promise.allSettled(this.keys().map(key=>this.end(key)));if(results.some(r=>r.status==='rejected'))throw failure('INPUT_END_UNCONFIRMED');}
  async reconcileAll(){
    await this.cancelAll('explicit-reconcile').catch(()=>{});
    const results=await Promise.allSettled([...this.known].map(async key=>{
      await this.host.reconcile(key);
      if(!this.host.state(key)?.cleanupConfirmed)throw failure('INPUT_CLEANUP_UNCONFIRMED');
      this.known.delete(key);
    }));
    if(results.some(r=>r.status==='rejected')||this.known.size)throw failure('INPUT_RECONCILIATION_UNCONFIRMED');
  }
  async close(){
    this.closed=true;
    await this.cancelAll('input-connection-closed').catch(()=>{});
    await this.host.close();
    this.known.clear();this.records.clear();
  }
}
