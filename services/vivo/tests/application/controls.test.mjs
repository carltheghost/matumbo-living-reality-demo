/** Execute the actual mounted handlers with controlled UI ports; not a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../web/application/bootstrap.mjs',import.meta.url),'utf8');
const capture=source.slice(source.indexOf('function captureConnection(){'),source.indexOf('async function showPanel('));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
for(const name of['saveButton','exportButton','reconcileButton'])test(`${name} cannot retarget a pending action into a replacement session`,async()=>{
 const gate=deferred(),requests=[],downloads=[],said=[];
 const client=seat=>({closed:false,current:{snapshot:{acceptedSequence:1}},refresh:async()=>requests.push(['refresh',seat]),export:async()=>{requests.push(['export',seat]);return{eye:{actorId:seat}};}});
 const context=vm.createContext({connecting:false,connectionGeneration:1,transport:client('local.one'),inputs:{releaseAll:()=>gate.promise,reconcileAll:()=>gate.promise},
  [name]:{},safe:f=>f,Blob:class{constructor(parts){downloads.push(parts.join(''));}},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},element:()=>({click:()=>{}}),setTimeout:()=>{},say:x=>said.push(x)});
 vm.runInContext(capture+'\n'+source.split('\n').find(l=>l.startsWith(name+'.onclick=')),context);
 const pending=context[name].onclick();context.transport=client('local.two');context.inputs={};context.connectionGeneration=2;gate.resolve();
 await assert.rejects(pending,/connection changed/);assert.deepEqual(requests,[]);assert.deepEqual(downloads,[]);assert.deepEqual(said,[]);
});
test('a pending controls panel cannot open after connection replacement',async()=>{
 const gate=deferred();let shown=0;
 const context=vm.createContext({connecting:false,connectionGeneration:1,transport:{closed:false},inputs:{releaseAll:()=>gate.promise},panelNames:{record:'record'},
  $:()=>({showModal:()=>shown++}),document:{querySelectorAll:()=>[]},say:()=>{}});
 const show=source.slice(source.indexOf('async function showPanel('),source.indexOf('\ndocument.querySelectorAll',source.indexOf('async function showPanel(')));
 vm.runInContext(capture+'\n'+show,context);const pending=context.showPanel('record');context.connectionGeneration++;gate.resolve();
 await assert.rejects(pending,/connection changed/);assert.equal(shown,0);
});
test('uncertain cleanup leaves controls accessible for explicit reconciliation',async()=>{
 let shown=0;const said=[];
 const context=vm.createContext({connecting:false,connectionGeneration:1,transport:{closed:false},inputs:{releaseAll:async()=>{throw Error('cleanup uncertain');}},panelNames:{record:'record'},
  $:()=>({showModal:()=>shown++}),document:{querySelectorAll:()=>[]},say:x=>said.push(x)});
 const show=source.slice(source.indexOf('async function showPanel('),source.indexOf('\ndocument.querySelectorAll',source.indexOf('async function showPanel(')));
 vm.runInContext(capture+'\n'+show,context);await context.showPanel('record');assert.equal(shown,1);assert.match(said[0],/uncertain/);
});
test('old polling failure cannot mark new session offline or schedule another old poll',async()=>{
 const gate=deferred();let updates=0,schedules=0;const old={closed:false,refresh:()=>gate.promise};
 const context=vm.createContext({transport:old,connectionGeneration:1,online:true,poll:null,updateUI:()=>updates++,say:()=>updates++,setTimeout:()=>schedules++});
 const loop=source.slice(source.indexOf('async function refreshLoop('),source.indexOf('async function beginGesture('));vm.runInContext(loop,context);
 const pending=context.refreshLoop(old,1);context.transport={closed:false};context.connectionGeneration=2;gate.reject(Error('old connection failed'));await pending;
 assert.equal(context.online,true);assert.equal(updates,0);assert.equal(schedules,0);
});

test('camera completion wrappers remain promises before admission and during disconnect',async()=>{
 const context=vm.createContext({inputs:null});
 vm.runInContext(source.split('\n').filter(l=>l.startsWith('async function endGesture(')||l.startsWith('async function cancelGesture(')).join('\n'),context);
 await context.endGesture('hand').catch(assert.fail);await context.cancelGesture('hand','lost').catch(assert.fail);
});

test('late status response cannot reverse paused state at the same canonical sequence',async()=>{
 const {LocalTransport}=await import('../../web/application/transport.mjs');const received=[];
 const client=new LocalTransport({onState:s=>received.push(s)});
 const state=(revision,running)=>({runtimeRevision:revision,snapshot:{acceptedSequence:5},capabilities:{material:{running}}});
 client.receive(state(9,true));client.receive(state(11,false));client.receive(state(10,true));
 assert.equal(client.current.capabilities.material.running,false);assert.equal(received.length,2);
});
