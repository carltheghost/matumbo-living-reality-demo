/** Actual HTTP transport + exact input controller/host. No browser is substituted. */
import assert from 'node:assert/strict';
import {LocalTransport} from '../../web/application/transport.mjs';
import {GripHost} from '../../web/authority/grip-host.mjs';
const base=process.argv[2];
const request=(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:base}});
const client=new LocalTransport({base,fetch:request});
await client.admit('one');
const host=await GripHost.open(client,{requestTimeoutMs:500,cleanupTimeoutMs:1000});
const entity=id=>client.getSnapshot().spaces.root.entities[id];
const frame=(q,id='relic')=>{const e=entity(id);return{spaceId:e.spaceId,chart:e.chart,dimension:e.dimension,q};};
const original=entity('relic').q;
try{
  await host.begin('touch',{entity:entity('relic'),source:'touch',inputEpoch:await client.nextEpoch()});
  const q=[...original];q[3]=.37;
  host.offer('touch',frame(q),performance.now());
  q[3]=.41;
  await host.end('touch','pointerup',{frame:frame(q),observedAt:performance.now()});
  const exported=await client.export();
  const targets=exported.history.events.filter(e=>e.kind==='grab.target');
  assert.equal(targets.at(-1).payload.payload.q[3],.41);
  assert.deepEqual(entity('relic').q,original);
  assert.equal(await client.inspectLease('root','relic'),null);

  await host.begin('touch',{entity:entity('relic'),source:'touch',inputEpoch:await client.nextEpoch()});
  await host.begin('hand',{entity:entity('workpiece'),source:'hand',inputEpoch:await client.nextEpoch()});
  await host.cancelSource('hand','hand-source-lost');
  assert.equal(await client.inspectLease('root','workpiece'),null);
  assert.ok(await client.inspectLease('root','relic'));
  await host.end('touch','pointerup',{frame:frame(original),observedAt:performance.now()});

  await host.begin('touch',{entity:entity('relic'),source:'touch',inputEpoch:await client.nextEpoch()});
  await assert.rejects(host.end('touch','pointerup',{frame:frame(original),observedAt:performance.now()-1000}),/FINAL_SAMPLE_REJECTED/);
  assert.equal(await client.inspectLease('root','relic'),null);

  // Lose a real response after the server accepted it, not before submission.
  const normal=client.fetch;
  client.fetch=async(url,options)=>{
    const body=JSON.parse(options.body),response=await normal(url,options);
    if(body.op==='submit'&&body.args.command.kind==='grab.begin'){
      client.fetch=normal;await response.text();throw Error('test: accepted acquisition response lost');
    }
    return response;
  };
  await assert.rejects(host.begin('lost',{entity:entity('relic'),source:'touch',inputEpoch:await client.nextEpoch()}),/ACQUIRE_UNCERTAIN/);
  assert.equal(await client.inspectLease('root','relic'),null);
  assert.equal(host.state('lost').cleanupConfirmed,true);
  console.log(JSON.stringify({ok:true,checks:['final-sample-over-real-HTTP','separate-hand-touch-cleanup','stale-final-cancel','lost-acquire-reply-owner-correlated-reconcile','constraints-not-material']}));
}finally{await host.close();await client.close();}
