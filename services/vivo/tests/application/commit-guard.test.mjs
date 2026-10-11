import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileAuthorityStore} from '../../server/authority/file-store.mjs';
const record=n=>({schema:'vivo.lease-checkpoint/1',digest:String(n).repeat(64),state:{n}});
test('POSIX final synchronous commit guard rejects without replacing durable state or leaving locks',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'vivo-guard-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=new FileAuthorityStore({path:join(directory,'world.json')});assert.equal(store.supportsCommitGuard,true);
 await store.compareAndSwap(null,record(1));let guarded=0;
 await assert.rejects(store.compareAndSwap(record(1).digest,record(2),{beforeCommit:()=>{guarded++;throw Error('lease expired');}}),/lease expired/);
 assert.equal(guarded,1);assert.deepEqual(await store.load(),record(1));assert.deepEqual(await readdir(directory),['world.json']);
 await store.compareAndSwap(record(1).digest,record(2),{beforeCommit:()=>{guarded++;}});
 assert.equal(guarded,2);assert.deepEqual(await store.load(),record(2));
});
test('POSIX guard rejects promise-returning hooks before replacing state',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'vivo-guard-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const store=new FileAuthorityStore({path:join(directory,'world.json')});await store.compareAndSwap(null,record(1));
 await assert.rejects(store.compareAndSwap(record(1).digest,record(2),{beforeCommit:async()=>{throw Error('invalid asynchronous guard');}}),{code:'STORE_ASYNC_COMMIT_GUARD'});
 assert.deepEqual(await store.load(),record(1));
});
