import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScenario,compareMissionScenarios} from '../mission-scenarios.mjs';
const a=(sourceId,extra={})=>({sourceId,sessionId:'session-'+sourceId,generation:1,eligible:true,...extra});
const t=id=>({id,title:id});
const r=(candidates,reason=null)=>({candidates,reason});
const compare=(tasks,rankings,unavailableSourceIds=[])=>compareMissionScenarios({tasks,rankings:new Map(rankings),unavailableSourceIds});
test('maximum matching handles a constrained task instead of greedy collision',()=>{
 const x=compare([t('a'),t('b')],[['a',r([a('one'),a('two')])],['b',r([a('one')])]],['one']);
 assert.deepEqual(x.baseline.rows.map(r=>r.assignment.sourceId),['two','one']);assert.equal(x.baseline.assignable,2);assert.equal(x.alternative.assignable,1);assert.equal(x.lostCapacity,1);
});
test('duplicate sessions for a source cannot inflate capacity',()=>{
 const x=compare([t('a'),t('b')],[['a',r([a('one'),a('one',{sessionId:'other'})])],['b',r([a('one')])]]);
 assert.equal(x.baseline.assignable,1);assert.equal(x.baseline.rows[0].candidateCount,1);
});
test('dependencies, unresolved evidence and missing grants are not relaxed',()=>{
 const reasons=['TASK_PREREQUISITES_INCOMPLETE','TASK_RECONCILIATION_REQUIRED','TASK_ALREADY_ATTACHED','TASK_CLOSED'];
 const tasks=reasons.map(t),x=compare([...tasks,t('denied')],[...reasons.map(id=>[id,r([],id)]),['denied',r([a('one',{eligible:false})],'NO_ELIGIBLE_AGENT')]]);
 assert.equal(x.baseline.assignable,0);for(const row of x.baseline.rows)assert.equal(row.status,row.taskId==='denied'?'NO_ELIGIBLE_AGENT':row.taskId);
});
test('no assignment can appear when all eligible sources are excluded',()=>{
 const x=compare([t('a')],[['a',r([a('one')])]],['one']);
 assert.equal(x.alternative.rows[0].assignment,null);assert.equal(x.authorizesAction,false);assert.equal(x.predictsCompletion,false);
});
test('comparison is stable and does not change inputs',()=>{
 const tasks=[t('b'),t('a')],rankings=tasks.map(t=>[t.id,r([a('one'),a('two')])]),before=JSON.stringify(rankings);
 assert.deepEqual(compare(tasks,rankings),compare([...tasks].reverse(),rankings));assert.equal(JSON.stringify(rankings),before);
});
test('scenario input is bounded and rejects malformed or foreign fields',()=>{
 for(const input of [{taskIds:['a','a']},{taskIds:[]},{taskIds:['a'],unavailableSourceIds:['b','b']},{taskIds:['a'],worldId:'foreign'},{taskIds:Array(2)},{taskIds:['a'],unavailableSourceIds:null}])assert.throws(()=>validateScenario(input));
 assert.deepEqual(validateScenario({taskIds:['a']}),{taskIds:['a'],unavailableSourceIds:[]});
});
test('maximum journal capacity has unique source assignments',()=>{
 const tasks=Array.from({length:16},(_,i)=>t('task'+i)),rows=tasks.map(t=>[t.id,r(Array.from({length:16},(_,i)=>a('source'+i)))]),x=compare(tasks,rows,['source0','source1']);
 assert.deepEqual([x.baseline.assignable,x.alternative.assignable],[16,14]);assert.equal(new Set(x.alternative.rows.filter(r=>r.assignment).map(r=>r.assignment.sourceId)).size,14);
});
test('exclusion of an unused source leaves assignments unchanged',()=>{
 const x=compare([t('a')],[['a',r([a('one')])]],['absent']);assert.deepEqual(x.baseline,x.alternative);assert.equal(x.lostCapacity,0);
});
