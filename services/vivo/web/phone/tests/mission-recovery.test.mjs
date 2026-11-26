import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseMissionTask,recoverySnapshot,reopenReviewedTask,validateRecoveryHistory,MAX_RECOVERIES} from '../mission-recovery.mjs';
const step=(state='confirmed',operationId='op')=>({operationId,entityId:'relic',sourceId:'muse',state,sha256:'a'.repeat(64),revision:1,changed:true});
const task=(id,extra={})=>({id,title:id,sourceId:'muse',epoch:1,closed:false,steps:[],dependsOn:[],...extra});
const graph=(...tasks)=>({tasks});
const code=x=>({code:x});
const diag=(tasks,id)=>diagnoseMissionTask(graph(...tasks),id);

test('diamond graph deduplicates the common archived root and ignores unrelated tasks',()=>{
 const a=task('a',{closed:true}),b=task('b',{dependsOn:['a']}),c=task('c',{dependsOn:['a']}),d=task('d',{dependsOn:['b','c']});
 const r=diag([a,b,c,d,task('private',{closed:true})],'d');
 assert.equal(r.target.state,'waiting-prerequisites');assert.deepEqual(r.roots.map(x=>x.taskId),['a']);assert(r.roots[0].canReopen);assert.equal(r.authorizesAction,false);
});
test('a closed root with incomplete prerequisites reports its archive and upstream work',()=>{
 const a=task('a'),b=task('b',{closed:true,dependsOn:['a']}),c=task('c',{dependsOn:['b']});
 assert.deepEqual(diag([a,b,c],'c').roots.map(x=>[x.taskId,x.state]),[['b','closed-incomplete'],['a','ready-for-work']]);
});
test('pending and conflicting receipts outrank archive status and cannot reopen',()=>{
 for(const state of ['pending','conflict']){const a=task('a',{closed:true,steps:[step(state)]}),r=diag([a],'a');assert.equal(r.target.state,'receipt-'+state);assert.equal(r.target.canReopen,false);assert.throws(()=>reopenReviewedTask(a,'review'),code('TASK_RECONCILIATION_REQUIRED'));}
});
test('completed dependencies are not returned as blockers; confirmed open tasks require explicit review',()=>{
 const a=task('a',{completed:true,closed:true,steps:[step()]}),b=task('b',{dependsOn:['a'],steps:[step()]});
 const r=diag([a,b],'b');assert.equal(r.target.state,'review-completion');assert.deepEqual(r.roots.map(x=>x.taskId),['b']);assert.equal(diag([a,b],'a').roots.length,0);
});
test('reopen preserves original task, dependencies and receipts while increasing its epoch',()=>{
 const a=task('a',{closed:true,steps:[step(),step('not-dispatched','op2')],dependsOn:['up']});const before=structuredClone(a),r=reopenReviewedTask(a,'  Replacement agent  ');
 assert.deepEqual(r,{epoch:2,sourceId:'muse',reason:'Replacement agent',steps:2,confirmed:1});assert.equal(a.closed,false);assert.equal(a.epoch,2);assert.deepEqual(a.steps,before.steps);assert.deepEqual(a.dependsOn,before.dependsOn);assert.equal(a.sourceId,before.sourceId);assert.equal(validateRecoveryHistory(graph(a)).tasks[0],a);
});
test('reopening never completes a prerequisite or unlocks downstream work',()=>{
 const a=task('a',{closed:true,steps:[step()]}),b=task('b',{dependsOn:['a']});reopenReviewedTask(a,'continue');
 const r=diag([a,b],'b');assert.equal(r.target.state,'waiting-prerequisites');assert.equal(r.roots[0].state,'review-completion');assert.equal(a.completed,undefined);
});
test('invalid reasons, completed tasks, open tasks and exhausted epochs are rejected without mutation',()=>{
 for(const reason of ['', ' ', 'x'.repeat(161), 'bad\nreason',null]){const a=task('a',{closed:true}),before=structuredClone(a);assert.throws(()=>reopenReviewedTask(a,reason),code('RECOVERY_REASON_REQUIRED'));assert.deepEqual(a,before);}
 for(const a of [task('a'),task('a',{closed:true,completed:true}),task('a',{closed:true,epoch:Number.MAX_SAFE_INTEGER})]){const old=structuredClone(a);assert.throws(()=>reopenReviewedTask(a,'review'));assert.deepEqual(a,old);}
});
test('history remains bounded across repeated archival and recovery',()=>{
 const a=task('a',{closed:true});for(let i=0;i<MAX_RECOVERIES;i++){reopenReviewedTask(a,'review '+i);a.closed=true;}
 assert.equal(validateRecoveryHistory(graph(a)).tasks[0].recoveries.length,MAX_RECOVERIES);assert.equal(diag([a],'a').target.state,'recovery-unavailable');assert.throws(()=>reopenReviewedTask(a,'again'),code('RECOVERY_CAPACITY'));
});
test('history validates source attribution across handoffs before and after reopening',()=>{
 const a=task('a',{closed:true,epoch:2,sourceId:'codex',handoffs:[{from:'muse',to:'codex',epoch:2}]});reopenReviewedTask(a,'continue');
 a.epoch=4;a.sourceId='dot';a.handoffs.push({from:'codex',to:'dot',epoch:4});assert.equal(validateRecoveryHistory(graph(a)).tasks[0].recoveries[0].sourceId,'codex');
 a.recoveries[0].sourceId='dot';assert.throws(()=>validateRecoveryHistory(graph(a)),code('RECOVERY_STORAGE_INVALID'));
});
test('forged recovery counts, epoch collisions and unresolved historical receipts fail closed',()=>{
 const a=task('a',{closed:true,steps:[step()]});reopenReviewedTask(a,'review');
 for(const mutate of [x=>{x.recoveries[0].confirmed=0;},x=>{x.recoveries[0].epoch=1;},x=>{x.steps[0].state='pending';},x=>{x.recoveries[0].reason=null;},x=>{x.recoveries[0].steps=2;},x=>{x.handoffs=[{from:'muse',to:'muse',epoch:2}];}]){const x=structuredClone(a);mutate(x);assert.throws(()=>validateRecoveryHistory(graph(x)),code('RECOVERY_STORAGE_INVALID'));}
});
test('snapshot changes when evidence, identity, or task state changes',()=>{
 const a=task('a',{closed:true,steps:[step('pending')]});const old=recoverySnapshot(a);a.steps[0].state='confirmed';assert.notEqual(recoverySnapshot(a),old);const next=recoverySnapshot(a);reopenReviewedTask(a,'review');assert.notEqual(recoverySnapshot(a),next);
});
test('invalid graph cycles or missing references fail rather than yielding a recovery decision',()=>{
 assert.throws(()=>diag([task('a',{dependsOn:['b']}),task('b',{dependsOn:['a']})],'a'),code('RECOVERY_GRAPH_INVALID'));assert.throws(()=>diag([task('a',{dependsOn:['missing']})],'a'),code('RECOVERY_GRAPH_INVALID'));assert.throws(()=>diag([],'a'),code('TASK_NOT_FOUND'));
});
