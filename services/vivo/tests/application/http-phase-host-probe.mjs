/** Real canonical host/controllers over the actual mounted material HTTP app. */
import assert from 'node:assert/strict';
import {LocalTransport} from '../../web/application/transport.mjs';
import {GripHost} from '../../web/authority/grip-host.mjs';
const base=process.argv[2],sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fetcher=(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:base}});
const one=new LocalTransport({base,fetch:fetcher}),two=new LocalTransport({base,fetch:fetcher});
await one.admit('one');await two.admit('two');
const receipts=[];
const a=await GripHost.open(one,{onReceipt:(key,x)=>receipts.push({key,...x}),requestTimeoutMs:3000});
const b=await GripHost.open(two,{onReceipt:(key,x)=>receipts.push({key,...x}),requestTimeoutMs:3000});
const entity=(client,id)=>client.getSnapshot().spaces.root.entities[id];
const frame=(client,id,x4)=>{const e=entity(client,id),q=[...e.q];q[3]=x4;return{spaceId:'root',chart:'flat',dimension:4,q};};
try{
 const initial=entity(one,'relic').q;
 await a.begin('touch',{entity:entity(one,'relic'),source:'touch',inputEpoch:await one.nextEpoch()});
 await b.begin('hand',{entity:entity(two,'workpiece'),source:'hand',inputEpoch:await two.nextEpoch()});
 await one.call('materialRun',{running:true});
 let state;
 for(let i=0;i<80;i++){
  a.offer('touch',frame(one,'relic',.8),performance.now());
  b.offer('hand',frame(two,'workpiece',-.7),performance.now());
  await sleep(100);await one.refresh();await two.refresh();state=one.current;
  if(state.materialDiagnostics.tick>=4)break;
 }
 assert.ok(state.materialDiagnostics.tick>=4,JSON.stringify(state.materialHost));
 await one.call('materialRun',{running:false});
 assert.notDeepEqual(entity(one,'relic').q,initial);
 assert.ok(receipts.some(x=>x.command.kind==='grab.target'&&x.receipt.status==='accepted'&&x.receipt.entityRevision>0));
 await a.end('touch','pointerup',{frame:frame(one,'relic',.82),observedAt:performance.now()});
 await b.cancelSource('hand','source-lost');
 assert.equal(await one.inspectLease('root','relic'),null);assert.equal(await two.inspectLease('root','workpiece'),null);
 await two.refresh();await b.begin('touch.second',{entity:entity(two,'relic'),source:'touch',inputEpoch:await two.nextEpoch()});
 b.offer('touch.second',frame(two,'relic',-.6),performance.now());
 await b.end('touch.second','pointerup',{frame:frame(two,'relic',-.61),observedAt:performance.now()});
 assert.equal(await two.inspectLease('root','relic'),null);
 assert.ok(!receipts.some(x=>x.receipt.code==='STALE_REVISION'));
 console.log(JSON.stringify({ok:true,checks:['two-actual-input-hosts-during-material-steps','material-relative-receipts','final-sample-after-ticks','independent-source-loss','same-object-second-actor-acquisition'],tick:state.materialDiagnostics.tick}));
}finally{await one.call('materialRun',{running:false}).catch(()=>{});await a.close();await b.close();await one.close();await two.close();}
