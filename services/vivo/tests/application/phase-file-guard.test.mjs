import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {FileAuthorityStore} from '../../server/authority/file-store.mjs';
import {LocalLeaseWorld} from '../../web/authority/lease-authority.mjs';
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
const py=input=>{const r=spawnSync('python',['services/vivo/tests/material-authority/fixture.py'],{cwd:repo,env:{...process.env,PYTHONPATH:repo},input:JSON.stringify(input),encoding:'utf8',maxBuffer:4*1024*1024});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
test('actual POSIX material write rechecks lease expiry after temp fsync and never publishes rejected candidate',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'vivo-phase-guard-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let now=1000,expireDuringWrite=false;
 class Store extends FileAuthorityStore{async compareAndSwap(expected,record,options){return super.compareAndSwap(expected,record,{beforeCommit:()=>{
   if(expireDuringWrite)now=4001;return options?.beforeCommit?.();
 }});}}
 const store=new Store({path:join(dir,'world.json')}),{snapshot,checkpoint}=py({op:'seed',count:1});
 const world=await LocalLeaseWorld.create({snapshot,store,now:()=>now,materialProtocol:'vivo.lease-material/1',materialInitial:{spaceId:'space.phase',checkpoint}});
 const client=world.attach({actorId:'guard-test'});await client.open();let sequence=0;
 const command=(kind,payload)=>({schema:'vivo.command/1',id:'guard.'+(++sequence),worldId:snapshot.worldId,spaceId:'space.phase',kind,expectedRevision:0,payload});
 const begin=await client.submit(command('grab.begin',{entityId:'entity.0',source:'touch',inputEpoch:1}));
 await client.submit(command('grab.target',{entityId:'entity.0',leaseId:begin.result.leaseId,source:'touch',inputEpoch:1,targetSeq:1,dimension:4,chart:'chart.periodic',q:[0,0,0,1],sampleAgeMs:0}));
 const proposal=py({op:'propose',capture:await world.captureMaterial('space.phase')}),before=world.checkpoint();let observed=0;
 client.subscribe(()=>observed++);expireDuringWrite=true;
 await assert.rejects(world.applyMaterialProposal(proposal),{code:'MATERIAL_STALE_CONSTRAINTS'});
 assert.deepEqual(world.checkpoint(),before);assert.deepEqual(await store.load(),before);assert.equal(observed,0);
 assert.deepEqual(await readdir(dir),['world.json']);
});
