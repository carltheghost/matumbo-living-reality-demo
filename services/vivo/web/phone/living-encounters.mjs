/** Local sensory state over existing objects, never material, ledger or job authority. */
export const ENCOUNTER_SCHEMA = 'vivo.encounters/1';
export const KINDS = Object.freeze(['touch', 'light', 'proximity', 'message']);
export const LIMITS = Object.freeze({objects:128, history:32, seen:256, decayMs:2400});
const clone = value => structuredClone(value);
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), {code}); };
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const unit = n => Math.min(1, Math.max(0, n));
const PROVENANCE = Object.freeze({touch:['local-touch','local-hand'],light:['simulated-light'],proximity:['accepted-world'],message:['local-message','confirmed-message']});
// Different local sensing profiles; not trained weights or physical material laws.
const PROFILES = Object.freeze({relic:{touch:.8,light:1,proximity:.65,message:1},workpiece:{touch:1,light:.5,proximity:.85,message:.75},portal:{touch:.7,light:.7,proximity:1,message:.9}});
export function encounterScope(envelope) {
  const s=envelope?.snapshot, eye=envelope?.eyes?.[envelope?.currentEyeId], space=s?.spaces?.[eye?.spaceId];
  need(s && space && [s.worldId,envelope.branchId,space.id].every(identifier),'INVALID_ENCOUNTER_SCOPE');
  need(Number.isInteger(space.dimension)&&space.dimension>=3&&space.dimension<=11,'INVALID_DIMENSION');
  return {worldId:s.worldId,branchId:envelope.branchId,spaceId:space.id,dimension:space.dimension};
}
export const encounterKey = scope => JSON.stringify([scope.worldId,scope.branchId,scope.spaceId,scope.dimension]);
export class LivingEncounters {
  constructor({scope, now=()=>Date.now()}={}) {
    need(scope && [scope.worldId,scope.branchId,scope.spaceId].every(identifier) && Number.isInteger(scope.dimension)&&scope.dimension>=3&&scope.dimension<=11,'INVALID_ENCOUNTER_SCOPE');
    this.scope=clone(scope);this.now=now;this.objects=new Map();this.records=new Map();
    this.near=new Set();this.seen=new Map();this.cooldowns=new Map();this.sequence=-1;this.version=0;this.paused=false;this.truncated=0;
  }
  time() {const t=this.now();need(finite(t)&&t>=0,'INVALID_CLOCK');return t;}
  sync(envelope) {
    need(same(encounterScope(envelope),this.scope),'ENCOUNTER_SCOPE_CHANGED');
    const s=envelope.snapshot, space=s.spaces[this.scope.spaceId];
    need(Number.isSafeInteger(s.acceptedSequence)&&s.acceptedSequence>=0,'INVALID_SEQUENCE');
    if(s.acceptedSequence<this.sequence)return false;
    const entries=Object.entries(space.entities).sort(([a],[b])=>a.localeCompare(b));
    const objects=new Map();
    for(const [id,e] of entries.slice(0,LIMITS.objects)){
      need(identifier(id)&&e.id===id&&e.spaceId===space.id&&identifier(e.chart)&&Array.isArray(e.q)&&e.q.length===this.scope.dimension&&Array.from(e.q).every(x=>finite(x)&&Math.abs(x)<=1e6)&&finite(e.radius)&&e.radius>0,'INVALID_ENCOUNTER_ENTITY');
      objects.set(id,{id,q:[...e.q],chart:e.chart,radius:e.radius});
    }
    this.objects=objects;this.truncated=Math.max(0,entries.length-LIMITS.objects);this.sequence=s.acceptedSequence;
    this.metric=space.metricId==='euclidean'?'euclidean':null;
    for(const id of this.records.keys())if(!objects.has(id)){this.records.delete(id);this.version++;}
    return true;
  }
  record(entityId){
    need(this.objects.has(entityId),'UNKNOWN_ENCOUNTER_OBJECT');
    if(!this.records.has(entityId))this.records.set(entityId,{entityId,channels:{},history:[],count:0,lastKind:null});
    return this.records.get(entityId);
  }
  observe({id,entityId,kind,intensity=1,provenance,receiptId=null}) {
    need(identifier(id)&&KINDS.includes(kind)&&finite(intensity)&&intensity>0&&intensity<=1,'INVALID_ENCOUNTER');
    need(PROVENANCE[kind].includes(provenance),'INVALID_PROVENANCE');
    need(provenance!=='confirmed-message'||identifier(receiptId),'MESSAGE_RECEIPT_REQUIRED');
    need(this.objects.has(entityId),'UNKNOWN_ENCOUNTER_OBJECT');
    if(this.paused)return {changed:false,reason:'paused'};
    const body=JSON.stringify([entityId,kind,intensity,provenance,receiptId]);
    if(this.seen.has(id)){need(this.seen.get(id)===body,'ENCOUNTER_ID_REUSE');return {changed:false,reason:'duplicate'};}
    const time=this.time(), key=JSON.stringify([entityId,kind,provenance]);
    const previous=this.cooldowns.get(key);
    if(previous!==undefined&&time-previous<250)return {changed:false,reason:'coalesced'};
    const r=this.record(entityId),old=r.channels[kind];
    const decayed=old?old.energy*Math.exp(-Math.max(0,time-old.at)/LIMITS.decayMs):0;
    const energy=unit(decayed+intensity*(PROFILES[entityId]?.[kind]??.8));
    r.channels[kind]={energy,at:time};r.lastKind=kind;r.count=Math.min(Number.MAX_SAFE_INTEGER,r.count+1);
    this.seen.set(id,body);if(this.seen.size>LIMITS.seen)this.seen.delete(this.seen.keys().next().value);
    this.cooldowns.set(key,time);if(this.cooldowns.size>LIMITS.objects*KINDS.length*2)this.cooldowns.delete(this.cooldowns.keys().next().value);
    // Weak encounters can accumulate; insignificant isolated events are not a permanent log.
    if(energy>=.55){
      r.history.push({id,at:time,kind,intensity,provenance,receiptId:provenance==='confirmed-message'?receiptId:null});
      r.history=r.history.slice(-LIMITS.history);
    }
    this.version++;
    return {changed:true,retained:energy>=.55,energy};
  }
  proximity(){
    if(this.paused||!this.metric)return 0;
    const objects=[...this.objects.values()],next=new Set();let events=0;
    for(let i=0;i<objects.length;i++)for(let j=i+1;j<objects.length;j++){
      const a=objects[i],b=objects[j];if(a.chart!==b.chart)continue;
      const pair=JSON.stringify([a.id,b.id]),gap=Math.hypot(...a.q.map((x,k)=>x-b.q[k]))-a.radius-b.radius;
      if(gap<=(this.near.has(pair)?.65:.4)){
        next.add(pair);
        if(!this.near.has(pair))for(const target of [a,b]){
          const result=this.observe({id:'near.'+crypto.randomUUID(),entityId:target.id,kind:'proximity',intensity:unit(.65-gap*.1),provenance:'accepted-world'});
          events+=Number(result.changed);
        }
      }
    }
    this.near=next;return events;
  }
  light(entityId){
    need(this.objects.has(entityId),'UNKNOWN_ENCOUNTER_OBJECT');
    need(this.metric==='euclidean','UNSUPPORTED_LIGHT_METRIC');
    const source=this.objects.get(entityId);let events=0;
    for(const target of this.objects.values()){
      if(target.chart!==source.chart)continue;
      const distance=Math.hypot(...source.q.map((x,k)=>x-target.q[k]));
      const intensity=Math.exp(-distance);if(intensity<.04)continue;
      events+=Number(this.observe({id:'light.'+crypto.randomUUID(),entityId:target.id,kind:'light',intensity,provenance:'simulated-light'}).changed);
    }
    return events;
  }
  effect(entityId){
    const r=this.records.get(entityId);if(!r)return {energy:0,channels:{},memory:0,lastKind:null};
    const time=this.time(),channels={};
    for(const kind of KINDS){const c=r.channels[kind];channels[kind]=this.paused?0:c?unit(c.energy*Math.exp(-Math.max(0,time-c.at)/LIMITS.decayMs)):0;}
    return {energy:Math.max(0,...Object.values(channels)),channels,memory:Math.min(1,r.history.length/12),lastKind:r.lastKind};
  }
  history(entityId){return clone(this.records.get(entityId)?.history??[]);}
  pause(value=true){need(typeof value==='boolean','INVALID_PAUSE');this.paused=value;this.near.clear();if(value)for(const r of this.records.values())r.channels={};}
  forget(entityId){need(this.objects.has(entityId),'UNKNOWN_ENCOUNTER_OBJECT');this.records.delete(entityId);this.cooldowns.clear();this.version++;}
  export(){return {schema:ENCOUNTER_SCHEMA,scope:clone(this.scope),records:[...this.records.values()].map(r=>({entityId:r.entityId,history:clone(r.history)}))};}
  restore(value){
    need(value?.schema===ENCOUNTER_SCHEMA&&same(value.scope,this.scope)&&Array.isArray(value.records)&&value.records.length<=LIMITS.objects,'INVALID_ENCOUNTER_CHECKPOINT');
    const records=new Map();
    for(const r of value.records){
      need(identifier(r.entityId)&&!records.has(r.entityId)&&Array.isArray(r.history)&&r.history.length<=LIMITS.history,'INVALID_MEMORY_RECORD');
      const ids=new Set();
      const history=r.history.map(e=>{
        need(identifier(e.id)&&!ids.has(e.id)&&finite(e.at)&&e.at>=0&&KINDS.includes(e.kind)&&PROVENANCE[e.kind].includes(e.provenance)&&finite(e.intensity)&&e.intensity>0&&e.intensity<=1,'INVALID_MEMORY_EVENT');
        need(e.provenance!=='confirmed-message'||identifier(e.receiptId),'MESSAGE_RECEIPT_REQUIRED');ids.add(e.id);
        return {id:e.id,at:e.at,kind:e.kind,intensity:e.intensity,provenance:e.provenance,receiptId:e.provenance==='confirmed-message'?e.receiptId:null};
      });
      // Loading history never restores sensing, an in-flight message, or a running task.
      if(this.objects.has(r.entityId))records.set(r.entityId,{entityId:r.entityId,history,channels:{},count:0,lastKind:null});
    }
    this.records=records;this.near.clear();this.seen.clear();this.cooldowns.clear();
    for(const r of records.values())for(const e of r.history){this.seen.set(e.id,JSON.stringify([r.entityId,e.kind,e.intensity,e.provenance,e.receiptId]));if(this.seen.size>LIMITS.seen)this.seen.delete(this.seen.keys().next().value);}
    this.version++;
  }
}
