import test from 'node:test';
import assert from 'node:assert/strict';
import {auditStrategyCase,reviewMissionStrategies} from '../mission-critic.mjs';
import {compareMissionStrategies as strategy} from '../mission-strategy.mjs';
import {compareMissionScenarios as compare} from '../mission-scenarios.mjs';
const t=(id,dependsOn=[],extra={})=>({id,title:id,dependsOn,steps:[],...extra});
const a=(sourceId,extra={})=>({sourceId,sessionId:'s-'+sourceId,generation:1,eligible:true,relatedCompletedTasks:0,...extra});
const rank=(candidates,reason=null)=>({candidates,reason});
const input=(tasks,rankings,unavailableSourceIds=[],taskIds=tasks.map(t=>t.id))=>({tasks,taskIds,rankings:new Map(rankings),unavailableSourceIds});
const review=q=>reviewMissionStrategies(q,strategy,compare);
const diamond=[t('a'),t('b'),t('c',['a','b'])],d=input(diamond,diamond.map(t=>[t.id,rank([a('x'),a('y')])]),['x']);
const critical=[t('a'),t('b'),t('c'),t('d',['c']),t('e',['d'])],q=input(critical,critical.map(t=>[t.id,rank([a('x'),a('y')])]));
test('independent bound certifies conditional minimum rounds',()=>{const r=review(d);assert.deepEqual([r.baseline.proofStatus,r.baseline.preferredRounds,r.alternative.preferredRounds,r.conditionalRoundDifference],['lower-bound-proven',2,3,1]);assert.equal(r.baseline.audit.assignmentsWithoutRelatedCompletedEvidence,3);});
test('exact review improves greedy four rounds to three',()=>{const r=review(q);assert.deepEqual([r.baseline.originalRounds,r.baseline.preferredRounds,r.baseline.proofStatus,r.baseline.improvementRounds],[4,3,'exact-search-proven',1]);assert.equal(r.baseline.audit.conditionalLowerBound,3);assert(r.baseline.preferredWaves[0].assignments.some(a=>a.taskId==='c'));});
test('duplicate source or task in a wave is rejected',()=>{const plan=structuredClone(strategy(d,compare).baseline);plan.waves[0].assignments.push(plan.waves[1].assignments[0]);plan.waves.pop();assert.throws(()=>auditStrategyCase({...d,unavailableSourceIds:[]},plan),{code:'CRITIC_DUPLICATE_ASSIGNMENT'});});
test('same-wave dependency is independently rejected',()=>{const q=input([t('a'),t('b',['a'])],[['a',rank([a('x')])],['b',rank([a('y')])]]);const plan=strategy(q,compare).baseline;plan.waves=[{round:1,assignments:[...plan.waves[0].assignments,...plan.waves[1].assignments],assumesSuccessfulCompletion:true}];plan.roundCount=1;assert.throws(()=>auditStrategyCase(q,plan),{code:'CRITIC_PREREQUISITE_UNMET'});});
test('excluded source and premature stop fail the audit',()=>{const q=input([t('a')],[['a',rank([a('x')])]]);assert.throws(()=>auditStrategyCase({...q,unavailableSourceIds:['x']},strategy(q,compare).baseline),{code:'CRITIC_INELIGIBLE_ASSIGNMENT'});assert.throws(()=>auditStrategyCase(q,{waves:[],unscheduled:[{taskId:'a',unmetPrerequisiteIds:[]}],roundCount:0,simulatedScheduled:0,allRemainingScheduled:false}),{code:'CRITIC_PREMATURE_STOP'});});
test('single source outages expose downstream blockers',()=>{const q=input([t('a'),t('b',['a'])],[['a',rank([a('x')])],['b',rank([a('y')])]]);const r=review(q);assert.deepEqual(r.singleSourceStress.cases.map(x=>[x.sourceId,x.additionalUnscheduled]),[['x',2],['y',1]]);assert.deepEqual(r.baseline.audit.soleSourceTasks.map(x=>x.sourceId),['x','y']);});
test('external and uncertain prerequisites never become simulated completions',()=>{const rows=[t('outside'),t('a',['outside']),t('b',[],{steps:[{state:'pending'}]})],q=input(rows,[['a',rank([a('x')])],['b',rank([],'TASK_RECONCILIATION_REQUIRED')]],[],['a','b']);const r=review(q);assert.equal(r.baseline.proofStatus,'blocked-under-fixed-snapshot');assert.equal(r.baseline.audit.unscheduled,2);assert.equal(r.baseline.audit.conditionalLowerBound,null);});
test('large mission reports unproven optimality instead of pretending to solve it',()=>{const rows=[...Array.from({length:8},(_,i)=>t('a'+i)),t('c'),t('d',['c']),t('e',['d'])];const r=review(input(rows,rows.map(t=>[t.id,rank([a('x'),a('y')])])));assert.deepEqual([r.baseline.originalRounds,r.baseline.audit.conditionalLowerBound,r.baseline.proofStatus],[7,6,'optimality-unproven-size-limit']);});
test('completed selection has zero rounds',()=>{const r=review(input([t('a',[],{completed:true,closed:true})],[]));assert.deepEqual([r.remainingTasks,r.baseline.preferredRounds,r.baseline.proofStatus],[0,0,'lower-bound-proven']);});
test('deterministic read-only review retains input',()=>{const before=JSON.stringify([q.tasks,[...q.rankings]]),r=review(q);assert.deepEqual(review({...q,tasks:q.tasks.slice().reverse(),taskIds:q.taskIds.slice().reverse()}),r);assert.equal(JSON.stringify([q.tasks,[...q.rankings]]),before);assert.deepEqual([r.readOnly,r.authorizesAction,r.predictsCompletion],[true,false,false]);});

function oracle(tasks,rankings,excluded){
  // Independent recursive enumeration of one-round feasible assignments.
  // No reuse of the production matching algorithm or mask BFS.
  const blocked=new Set(excluded),memo=new Map(),ids=tasks.map(t=>t.id);
  const solve=done=>{
    if(done.size===tasks.length)return 0;
    const key=[...done].sort().join("|");if(memo.has(key))return memo.get(key);
    const ready=tasks.filter(t=>!done.has(t.id)&&(t.dependsOn||[]).every(d=>done.has(d)));
    let best=Infinity;
    function enumerate(i,used,picked){
      if(i===ready.length){
        if(!picked.length)return;
        best=Math.min(best,1+solve(new Set([...done,...picked])));return;
      }
      enumerate(i+1,used,picked);
      for(const a of rankings.get(ready[i].id).candidates){
        if(!a.eligible||blocked.has(a.sourceId)||used.has(a.sourceId))continue;
        const next=new Set(used);next.add(a.sourceId);enumerate(i+1,next,[...picked,ready[i].id]);
      }
    }
    enumerate(0,new Set(),[]);memo.set(key,best);return best;
  };
  return solve(new Set());
}
function oracleCheck(review){
  let seed=1907,cases=0,complete=0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let fixture=0;fixture<32;fixture++){
    const n=3+fixture%4,tasks=Array.from({length:n},(_,i)=>({id:"t"+i,title:"Task "+i,steps:[],dependsOn:Array.from({length:i},(_,j)=>"t"+j).filter(()=>random()<0.32)}));
    const rankings=new Map(tasks.map(t=>[t.id,{reason:null,candidates:["a","b","c"].filter(()=>random()<0.58).map(sourceId=>({sourceId,sessionId:"s-"+sourceId,generation:1,eligible:true,relatedCompletedTasks:0}))}]));
    const excluded=fixture%2?["b"]:[];
    const result=review({tasks,taskIds:tasks.map(t=>t.id),rankings,unavailableSourceIds:excluded});
    for(const [plan,removed] of [[result.baseline,[]],[result.alternative,excluded]]){
      const expected=oracle(tasks,rankings,removed);cases++;
      if(Number.isFinite(expected)){complete++;if(!plan.allRemainingScheduled||plan.preferredRounds!==expected)throw Error("Oracle mismatch "+JSON.stringify({fixture,expected,plan}));}
      else if(plan.allRemainingScheduled)throw Error("Oracle found blocked case");
    }
  }
  return {cases,complete};
}
test('independent recursive oracle agrees on 64 small-DAG scenarios',()=>{const r=oracleCheck(review);assert.equal(r.cases,64);assert(r.complete>0);});
test('outage coverage reports the 16-source stress bound',()=>{const q=input([t('x')],[['x',rank(Array.from({length:20},(_,i)=>a('s'+String(i).padStart(2,'0'))))]]);const r=review(q).singleSourceStress;assert.deepEqual([r.tested,r.totalEligibleSources,r.complete],[16,20,false]);});
