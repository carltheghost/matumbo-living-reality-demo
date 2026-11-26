/** Constructed associative memory, not a trained language model.
 * Four relation banks and a recurrent readout. Weights are derived explicitly
 * from authorized, exact edges. No gradient descent, hidden service or authority.
 */
const SCHEMA='vivo.constructed-memory/1';
const bits=16, capacity=256;
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const ident=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(x);
const uint=x=>Number.isSafeInteger(x)&&x>=0&&x<2**bits;
const encode=id=>Array.from({length:bits},(_,i)=>(id>>>i&1)?1:-1);
const scopeKey=s=>{need(s&&ident(s.worldId)&&ident(s.projectId),'INVALID_SCOPE');return s.worldId+'|'+s.projectId;};
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
/** Numeric forward pass. Hidden ReLU units match bipolar addresses exactly:
 * relu(sum(key_i * query_i) + 1 - bits) = 1 for a match, 0 otherwise.
 * Wv then reconstructs the selected target bits; ambiguity/absence abstains.
 */
export function forwardBank(bank, address) {
  need(uint(address),'INVALID_ADDRESS');
  need(bank&&bank.width===bits&&Array.isArray(bank.keys)&&Array.isArray(bank.values)&&
    bank.keys.length===bank.values.length&&bank.keys.length<=capacity,'INVALID_TENSORS');
  const q=encode(address),hidden=bank.keys.map((row,i)=>{
    need(Array.isArray(row)&&row.length===bits+1&&row.every(Number.isFinite)&&
      Array.isArray(bank.values[i])&&bank.values[i].length===bits&&bank.values[i].every(Number.isFinite),'INVALID_TENSORS');
    let z=row[bits];for(let k=0;k<bits;k++)z+=row[k]*q[k];return Math.max(0,z);
  });
  const matches=hidden.flatMap((h,i)=>h>.5?[i]:[]);
  if(matches.length!==1||hidden[matches[0]]!==1)return {status:'abstain',reason:matches.length?'AMBIGUOUS_OR_CHANGED_WEIGHTS':'NO_MATCH'};
  const output=Array(bits).fill(0);
  for(let i=0;i<hidden.length;i++)for(let j=0;j<bits;j++)output[j]+=hidden[i]*bank.values[i][j];
  if(output.some(x=>x!==1&&x!==-1))return {status:'abstain',reason:'INVALID_READOUT'};
  let value=0;for(let i=0;i<bits;i++)if(output[i]>0)value+=2**i;
  return {status:'matched',value,row:matches[0],hidden,output};
}
export class ConstructiveMemory {
  #scope; #records; #banks; #revision;
  constructor({scope,records=[],revision=0}) {
    scopeKey(scope);need(Array.isArray(records)&&records.length<=capacity*4&&Object.keys(records).length===records.length,'MEMORY_CAPACITY');
    need(Number.isSafeInteger(revision)&&revision>=0,'INVALID_REVISION');
    const seen=new Set(),ids=new Set();
    this.#records=records.map(r=>{
      need(r&&ident(r.id)&&uint(r.from)&&uint(r.to)&&Number.isInteger(r.bank)&&r.bank>=0&&r.bank<4&&
        Number.isSafeInteger(r.revision)&&r.revision>=0&&Object.keys(r).length===5,'INVALID_RECORD');
      const key=r.bank+':'+r.from;need(!seen.has(key)&&!ids.has(r.id),'CONFLICTING_RECORD');seen.add(key);ids.add(r.id);
      return {...r};
    });
    this.#scope={worldId:scope.worldId,projectId:scope.projectId};this.#revision=revision;
    this.#banks=Array.from({length:4},(_,b)=>{
      const rows=this.#records.filter(r=>r.bank===b);need(rows.length<=capacity,'BANK_CAPACITY');
      return {width:bits,recordIds:rows.map(r=>r.id),keys:rows.map(r=>[...encode(r.from),1-bits]),values:rows.map(r=>encode(r.to))};
    });
  }
  query({scope,start,path}) {
    need(scopeKey(scope)===scopeKey(this.#scope),'SCOPE_MISMATCH');need(uint(start),'INVALID_ADDRESS');
    need(Array.isArray(path)&&path.length>0&&path.length<=32&&Array.from(path).every(b=>Number.isInteger(b)&&b>=0&&b<4),'INVALID_PATH');
    let state=start;const trace=[];
    for(const bankId of path){
      const r=forwardBank(this.#banks[bankId],state);
      if(r.status!=='matched')return freeze({status:'abstain',reason:r.reason,trace,revision:this.#revision,authorizesAction:false});
      trace.push({bank:bankId,from:state,to:r.value,recordId:this.#banks[bankId].recordIds[r.row]});state=r.value;
    }
    return freeze({status:'matched',value:state,trace,revision:this.#revision,authorizesAction:false,
      method:'explicit-weight associative circuit',learned:false});
  }
  checkpoint() {return {schema:SCHEMA,scope:{...this.#scope},revision:this.#revision,records:structuredClone(this.#records),banks:structuredClone(this.#banks)};}
  static restore(checkpoint) {
    need(checkpoint?.schema===SCHEMA,'INVALID_CHECKPOINT');
    const m=new ConstructiveMemory(checkpoint);
    need(JSON.stringify(m.#banks)===JSON.stringify(checkpoint.banks),'WEIGHT_RECORD_MISMATCH');return m;
  }
  summary() {
    return freeze({schema:SCHEMA,scope:{...this.#scope},banks:4,records:this.#records.length,revision:this.#revision,
      scalars:this.#records.length*(2*bits+1),learned:false,trainingSteps:0,
      limits:'Exact 16-bit addresses, four relations, 256 edges per relation; not semantic document memory or general intelligence.'});
  }
}
export function exampleMemory(scope) {
  return new ConstructiveMemory({scope,records:[
    {id:'cue',bank:0,from:17,to:103,revision:1},{id:'tool',bank:1,from:103,to:29,revision:1},
    {id:'constraint',bank:2,from:29,to:61,revision:1},{id:'result',bank:3,from:61,to:7,revision:1}]});
}
