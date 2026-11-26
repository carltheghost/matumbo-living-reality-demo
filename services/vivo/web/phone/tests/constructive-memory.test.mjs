import test from 'node:test';
import assert from 'node:assert/strict';
import {ConstructiveMemory,exampleMemory,forwardBank} from '../constructive-memory.mjs';
const scope={worldId:'world',projectId:'neural-lab'};
const rnd=seed=>()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed;};
function fixture(seed,n=32){const r=rnd(seed),nodes=Array.from({length:n},(_,i)=>i*31+seed),records=[];
for(let b=0;b<4;b++)for(const node of nodes)records.push({id:`b${b}:n${node}`,bank:b,from:node,to:nodes[r()%nodes.length],revision:1});
return {records,nodes,m:new ConstructiveMemory({scope,records})};}
test('four written weight banks carry a recurrent four-hop query',()=>{
 const m=exampleMemory(scope),r=m.query({scope,start:17,path:[0,1,2,3]});
 assert.equal(r.value,7);assert.equal(r.trace.length,4);assert.equal(r.authorizesAction,false);assert.equal(m.summary().trainingSteps,0);
});
for(const seed of [1,7,19,31,47])test(`unseen graph seed ${seed}: all query results equal independent exact traversal`,()=>{
 const {m,nodes,records}=fixture(seed),r=rnd(seed+100);
 for(let i=0;i<256;i++){const start=nodes[r()%nodes.length],path=Array.from({length:1+r()%12},()=>r()%4);
 let target=start;for(const b of path)target=records.find(e=>e.bank===b&&e.from===target).to;
 assert.equal(m.query({scope,start,path}).value,target);}
});
test('key bit patterns include zero, high-bit and maximum 16-bit address',()=>{
 for(const from of [0,1,32768,65535]){const m=new ConstructiveMemory({scope,records:[{id:'x',bank:0,from,to:65535-from,revision:0}]});
 assert.equal(m.query({scope,start:from,path:[0]}).value,65535-from);}
});
test('unknown address abstains, never guesses',()=>assert.equal(exampleMemory(scope).query({scope,start:999,path:[0]}).status,'abstain'));
test('source and project scopes are checked before inference',()=>{
 for(const s of [{...scope,worldId:'other'},{...scope,projectId:'other'}])assert.throws(()=>exampleMemory(scope).query({scope:s,start:17,path:[0]}),/SCOPE_MISMATCH/);
});
test('exact records remain detached and checkpoints validate weight provenance',()=>{
 const {m}=fixture(7),p=m.checkpoint();assert.equal(ConstructiveMemory.restore(p).query({scope,start:7,path:[0]}).status,'matched');
 p.banks[0].values[0][0]*=-1;assert.throws(()=>ConstructiveMemory.restore(p),/WEIGHT_RECORD_MISMATCH/);
 assert.notDeepEqual(p.banks,m.checkpoint().banks);
});
test('conflicts, sparse paths, invalid numbers and excess capacity reject',()=>{
 const r={id:'x',bank:0,from:1,to:2,revision:0};assert.throws(()=>new ConstructiveMemory({scope,records:[r,{...r,id:'y'}]}));
 for(const start of [NaN,-1,65536,'1'])assert.throws(()=>exampleMemory(scope).query({scope,start,path:[0]}));
 assert.throws(()=>exampleMemory(scope).query({scope,start:17,path:Array(33).fill(0)}));
});
test('bank ablation forces an abstention at the removed stage',()=>{
 const p=exampleMemory(scope).checkpoint();for(let b=0;b<4;b++){
 const bank=structuredClone(p.banks[b]);bank.keys=[];bank.values=[];
 assert.equal(forwardBank(bank,p.records[b].from).status,'abstain');}
});
test('shuffled value weights are a negative control, not claimed exact recall',()=>{
 const {m,nodes}=fixture(7),b=m.checkpoint().banks[0];
 const normal=nodes.map(n=>forwardBank(b,n).value);b.values.reverse();
 const shuffled=nodes.map(n=>forwardBank(b,n).value);
 assert(normal.some((x,i)=>x!==shuffled[i]));
});
test('zero readout weights abstain instead of fabricating an address',()=>{
 const b=exampleMemory(scope).checkpoint().banks[0];b.values[0].fill(0);assert.equal(forwardBank(b,17).status,'abstain');
});
