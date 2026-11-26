import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleMemory} from '../constructive-memory.mjs';
import {selectMissionEvidence,normalizeMissionRecall,recallMissionEvidence} from '../mission-recall.mjs';
const scope={worldId:'world',projectId:'branch'};
const step=(operationId,extra={})=>({operationId,spaceId:'root',entityId:'relic',sourceId:'muse',sha256:'a'.repeat(64),revision:2,changed:true,state:'confirmed',...extra});
const task=(id,steps,extra={})=>({id,sourceId:'codex',closed:true,completed:true,steps,...extra});
const query={spaceId:'root',entityId:'relic'};
const recall=(tasks,args=query)=>recallMissionEvidence({scope,tasks,args});
test('grant selection admits only selected completed tasks, never target, unknown or unresolved source',()=>{
 const a=task('a',[step('one')]),b=task('b',[step('two')],{closed:false}),c=task('c',[step('three',{state:'pending'})]);
 assert.deepEqual(selectMissionEvidence([a,b,c],'target',['a']),[a]);
 for(const ids of [['target'],['b'],['c'],['missing'],['a','a'],[],Array(2)])assert.throws(()=>selectMissionEvidence([a,b,c],'target',ids));
});
test('actual numeric circuit returns exact object receipts, original source, and read-only traces',()=>{
 const a=task('a',[step('one'),step('two',{sourceId:'dot',revision:7,changed:false}),step('three',{spaceId:'inner'})]);
 const result=recall([a]);assert.equal(result.status,'matched');assert.equal(result.total,2);assert.equal(result.authorizesAction,false);assert.equal(result.learned,false);
 assert.deepEqual(result.matches.map(r=>[r.operationId,r.sourceId,r.changed,r.revision]),[['one','muse',true,2],['two','dot',false,7]]);
 for(const r of result.matches){assert.match(r.circuit.head,/^p0:b0:/);assert.match(r.circuit.source,/^p0:b2:/);assert.match(r.circuit.receipt,/^p0:b3:/);assert(!('delta' in r));}
});
test('same entity in another space never matches, and unknown space is omitted',()=>{
 const a=task('a',[step('one',{spaceId:'inner'}),step('legacy',{spaceId:undefined,sourceId:undefined})]);const r=recall([a]);
 assert.equal(r.status,'abstain');assert.equal(r.total,0);assert.equal(r.omittedUnknownSpace,1);assert.deepEqual(r.matches,[]);
 assert.equal(recall([a],{spaceId:'inner',entityId:'relic'}).matches[0].operationId,'one');
});
test('retrieval cannot request a foreign scope, task, source, oversized page or malformed address',()=>{
 for(const args of [{...query,worldId:'other'},{...query,taskId:'a'},{...query,sourceId:'a'},{...query,limit:33},{...query,offset:-1},{...query,limit:null},{spaceId:'',entityId:'relic'},null])assert.throws(()=>normalizeMissionRecall(args),{code:'MISSION_RECALL_ARGUMENTS_INVALID'});
});
test('all four banks stay within capacity across multiple pages without truncation',()=>{
 const rows=Array.from({length:9},(_,i)=>task('t'+i,Array.from({length:64},(_,j)=>step(i+':'+j))));
 const r=recall(rows,{...query,offset:250,limit:16});assert.equal(r.total,576);assert.equal(r.pages,3);assert.equal(r.nextOffset,266);assert.equal(r.matches.length,16);assert.equal(r.matches[0].circuit.page,0);assert.equal(r.matches[6].circuit.page,1);assert.equal(r.matches[6].operationId,'4:0');
 assert.equal(recall(rows,{...query,offset:576}).reason,'OFFSET_OUT_OF_RANGE');
});
test('full pages with distinct object cues and distinct sources also fit',()=>{
 const rows=Array.from({length:4},(_,i)=>task('t'+i,Array.from({length:64},(_,j)=>step(i+':'+j,{entityId:'obj'+(i*64+j),sourceId:'agent'+(i*64+j)}))));
 const r=recall(rows,{spaceId:'root',entityId:'obj255'});assert.equal(r.total,1);assert.equal(r.matches[0].sourceId,'agent255');assert.equal(r.pages,1);
});
test('uncertain or duplicate evidence fails closed, and not-dispatched work is not recalled',()=>{
 const a=task('a',[step('one'),step('skip',{state:'not-dispatched'})]);assert.equal(recall([a]).total,1);
 assert.throws(()=>recall([task('b',[step('one'),step('one')])]),{code:'MISSION_RECALL_EVIDENCE_INVALID'});
 assert.throws(()=>recall([task('c',[step('pending',{state:'pending'})])]),{code:'MISSION_RECALL_SOURCE_UNAVAILABLE'});
});
test('derived circuits do not mutate journal evidence or replace the existing lab circuit',()=>{
 const a=task('a',[step('one')]),old=structuredClone(a),lab=exampleMemory(scope),before=lab.checkpoint();
 const r=recall([a]);r.matches[0].revision=99;assert.deepEqual(a,old);assert.deepEqual(lab.checkpoint(),before);assert.equal(lab.query({scope,start:17,path:[0,1,2,3]}).value,7);
});
