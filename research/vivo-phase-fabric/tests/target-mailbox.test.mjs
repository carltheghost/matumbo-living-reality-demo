import test from 'node:test';
import assert from 'node:assert/strict';
import {TargetMailbox} from '../web/target-mailbox.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const sent=[],resolvers=[],views=[],statuses=[];let clock=100;
 const m=new TargetMailbox({send:x=>{sent.push(x);return new Promise((resolve,reject)=>resolvers.push({resolve,reject}));},preview:x=>views.push(x),status:x=>statuses.push(x),now:()=>clock});
 m.begin({entity:'relic',dimension:4,revision:10});
 return{m,sent,resolvers,views,statuses,advance:x=>clock+=x};
}
test('fast input is retained as latest target during a network round trip',async()=>{
 const f=fixture();f.m.offer([1,0,0,0]);await flush();
 for(let x=2;x<=20;x++)f.m.offer([x,0,0,0]);
 assert.equal(f.sent.length,1);assert.equal(f.views.length,20);
 f.resolvers[0].resolve({revision:11});await flush();
 assert.equal(f.sent.length,2);assert.deepEqual(f.sent[1].position,[20,0,0,0]);assert.equal(f.sent[1].expectedRevision,11);
 f.resolvers[1].resolve({revision:12});await flush();assert.equal(f.m.pending,null);
});
test('reversing a hand replaces the pending target, not a backlog of old frames',async()=>{
 const f=fixture();f.m.offer([1,0,0,0]);await flush();f.m.offer([10,0,0,0]);f.m.offer([0,0,0,0]);
 f.resolvers[0].resolve({revision:11});await flush();assert.deepEqual(f.sent[1].position,[0,0,0,0]);
});
test('stale pending observation cannot initiate new motion',async()=>{
 const f=fixture();f.m.offer([1,0,0,0]);await flush();f.m.offer([4,0,0,0]);f.advance(200);
 f.resolvers[0].resolve({revision:11});await flush();assert.equal(f.sent.length,1);assert.equal(f.m.pending,null);
});
test('cancel does not replay unacknowledged target after release',async()=>{
 const f=fixture();f.m.offer([1,0,0,0]);await flush();f.m.offer([5,0,0,0]);f.m.cancel();
 f.resolvers[0].resolve({revision:11});await flush();assert.equal(f.sent.length,1);assert.equal(f.m.active,false);
});
test('uncertain result blocks sends instead of blindly retrying',async()=>{
 const f=fixture();f.m.offer([1,0,0,0]);await flush();f.m.offer([5,0,0,0]);f.resolvers[0].reject(Error('timeout'));await flush();
 assert.equal(f.m.blocked,true);assert.equal(f.m.offer([6,0,0,0]),false);assert.equal(f.sent.length,1);
});
test('older ACK cannot authorize a new grab',async()=>{
 const f=fixture();f.m.offer([1,0,0,0]);await flush();f.m.cancel();
 assert.throws(()=>f.m.begin({entity:'new',dimension:4,revision:10}));
 f.resolvers[0].resolve({revision:11});await flush();f.m.begin({entity:'new',dimension:4,revision:11});assert.equal(f.m.entity,'new');
});
test('all eleven coordinates are retained',async()=>{
 const f=fixture();f.m.cancel();f.m.begin({entity:'nD',dimension:11,revision:10});const p=Array(11).fill(0);p[10]=2;
 f.m.offer(p);p[10]=99;await flush();assert.equal(f.sent[0].position[10],2);assert.equal(f.sent[0].position.length,11);
});
test('future and stale samples rejected, coordinate count validated',()=>{
 const f=fixture();assert.equal(f.m.offer([0,0,0,0],-200),false);assert.equal(f.m.offer([0,0,0,0],999),false);
 assert.throws(()=>f.m.offer([0,0,0]));assert.throws(()=>f.m.offer([0,NaN,0,0]));
});
test('unknown or stale ACK requires explicit reconciliation',async()=>{
 const f=fixture();f.m.offer([1,0,0,0]);await flush();f.resolvers[0].resolve({revision:10});await flush();assert.equal(f.m.blocked,true);
});
