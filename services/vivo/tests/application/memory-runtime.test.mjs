import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MountedRuntime} from '../../server/application/runtime.mjs';
import {entryView} from '../../server/application/seed.mjs';

let serial=0;
const command=(kind,payload,spaceId='root',expectedRevision=0,id='memory.'+(++serial))=>({
  schema:'vivo.command/1',id,worldId:'vivo.local.workshop',spaceId,kind,expectedRevision,payload});
const submit=(runtime,session,c)=>runtime.dispatch({op:'submit',token:session.token,args:{command:c}});
const begin=(runtime,session,entityId='relic')=>submit(runtime,session,
  command('grab.begin',{entityId,source:'touch',inputEpoch:1}));

test('explicit memory mode is session-only, shares one authority, and writes no backend files',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'vivo-memory-runtime-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const runtime=await MountedRuntime.open({store:'memory'});
 t.after(async()=>{if(!runtime.closed)await runtime.dispatch({op:'shutdown'});});
 const ready=await runtime.dispatch({op:'ready'});
 assert.equal(ready.capabilities.persistenceMode,'session-only');
 assert.equal(ready.capabilities.sessionOnly,true);
 assert.match(ready.capabilities.persistence,/Session-only volatile memory/);
 assert.match(ready.capabilities.sessionOnlyGuarantee,/only while this local server process runs/);
 const one=await runtime.dispatch({op:'open',args:{seat:'one'}});
 const two=await runtime.dispatch({op:'open',args:{seat:'two'}});
 assert.equal(one.state.snapshot.worldId,two.state.snapshot.worldId);
 const accepted=await begin(runtime,one);
 assert.equal(accepted.value.status,'accepted');
 const denied=await begin(runtime,two);
 assert.equal(denied.value.code,'LEASE_HELD');
 assert.equal((await runtime.dispatch({op:'inspectLease',token:two.token,args:{spaceId:'root',entityId:'relic'}})).value,null);
 assert.equal((await runtime.dispatch({op:'export',token:two.token})).value.snapshot.worldId,one.state.snapshot.worldId);
 await runtime.dispatch({op:'shutdown'});
 assert.deepEqual(await readdir(directory),[]);
});

test('memory mode rejects a checkpoint path and every fresh process starts with fresh state',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'vivo-memory-fresh-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 await assert.rejects(MountedRuntime.open({path:join(directory,'checkpoint.json'),store:'memory'}),{code:'INVALID_RUNTIME_OPTIONS'});
 const first=await MountedRuntime.open({store:'memory'});
 const opened=await first.dispatch({op:'open',args:{seat:'one'}});
 const oldToken=opened.token;
 const view=entryView();view.q[3]=.72;view.slice.x4=.72;
 await first.dispatch({op:'moveEye',token:oldToken,args:{view,expectedRevision:opened.state.eye.revision}});
 await first.dispatch({op:'shutdown'});
 const second=await MountedRuntime.open({store:'memory'});
 t.after(async()=>{if(!second.closed)await second.dispatch({op:'shutdown'});});
 await assert.rejects(second.dispatch({op:'state',token:oldToken}),/SESSION_EXPIRED/);
 await assert.rejects(second.dispatch({op:'open',args:{seat:'one',resumeToken:oldToken}}),/SESSION_EXPIRED/);
 const fresh=await second.dispatch({op:'open',args:{seat:'one'}});
 assert.deepEqual(fresh.state.eye.q,[0,0,0,0]);
 assert.equal(fresh.state.snapshot.simulationTime,0);
 assert.equal(fresh.state.snapshot.acceptedSequence,1);
 assert.deepEqual(await readdir(directory),[]);
});
