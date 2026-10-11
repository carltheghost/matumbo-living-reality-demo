import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,chmod,symlink,link} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,win32} from 'node:path';
import {execFile,spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {SQLiteAuthorityStore} from '../../server/authority/sqlite-store.mjs';
import {validateWindowsPath,validateWindowsEvidence,SQLITE_SIDECARS} from '../../server/authority/sqlite-path-policy.mjs';
import {LocalLeaseWorld} from '../../web/authority/lease-authority.mjs';
import {workshopSeed,entryView} from '../../server/application/seed.mjs';
const run=promisify(execFile);
// Node after hooks run in registration order. Register directory removal last so
// Windows never tries to delete a database still held by a successful test owner.
const directories=new WeakMap();
const test=(name,fn)=>nodeTest(name,async t=>{
 directories.set(t,[]);
 try{await fn(t);}finally{t.after(async()=>{for(const dir of directories.get(t))await rm(dir,{recursive:true,force:true});});}
});
const storeURL=new URL('../../server/authority/sqlite-store.mjs',import.meta.url).href;
const authorityURL=new URL('../../web/authority/lease-authority.mjs',import.meta.url).href;
const seedURL=new URL('../../server/application/seed.mjs',import.meta.url).href;
const code=expected=>e=>e.code===expected;
async function disk(t){const dir=await mkdtemp(join(process.env.VIVO_SQLITE_TEST_ROOT??tmpdir(),'vivo-sqlite-'));directories.get(t).push(dir);return join(dir,'checkpoint.sqlite');}
async function create(t,options={}){
  const path=options.path??await disk(t),store=await SQLiteAuthorityStore.open({path,...options});t.after(()=>store.close());
  const world=await LocalLeaseWorld.create({snapshot:workshopSeed(),store});return{path,store,world};
}
const record=async()=> (await LocalLeaseWorld.create({snapshot:workshopSeed()})).checkpoint();
const child=async(js,args=[])=>run(process.execPath,['--input-type=module','-e',js,...args],{timeout:30000});
function command(kind,payload,id='test.cmd',expectedRevision=0){return {schema:'vivo.command/1',id,worldId:'vivo.local.workshop',spaceId:'root',kind,expectedRevision,payload};}

// These tests are synthetic subprocess evidence on the executing OS, not Windows certification.
test('full checkpoint CAS, detached loads, WAL/FULL settings, exact BLOB bytes and reopen',async t=>{
 const {path,store,world}=await create(t);const a=world.attach({actorId:'local.one'});await a.open();await a.registerEye('main',entryView());
 const saved=world.checkpoint();assert.deepEqual(await store.load(),saved);
 const load=await store.load();load.state.eyes={};assert.deepEqual(await store.load(),saved);
 assert.equal(store.diagnostics.journalMode,'wal');assert.equal(store.diagnostics.synchronous,2);assert.equal(store.diagnostics.lockingMode,'exclusive');
 assert.equal(store.supportsCommitGuard,true);await store.close();await store.close();
 assert.equal(store.closed,true);await assert.rejects(store.load(),code('STORE_CLOSED'));
 const db=new DatabaseSync(path);assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 assert.equal(Buffer.from(db.prepare('SELECT payload FROM authority_checkpoint').get().payload).toString(),JSON.stringify(saved)+'\n');db.close();
 const reopened=await SQLiteAuthorityStore.open({path});t.after(()=>reopened.close());assert.deepEqual(await reopened.load(),saved);
});

test('owner survives idle between transactions; distinct process cannot read, mutate or start',async t=>{
 const {path,store}=await create(t);
 const {stdout}=await child(`import {SQLiteAuthorityStore} from ${JSON.stringify(storeURL)};
  try {const s=await SQLiteAuthorityStore.open({path:process.argv[1]});await s.close();console.log('UNEXPECTED');}
  catch(e){console.log(e.code);}`, [path]);assert.equal(stdout.trim(),'STORE_BUSY');
 for(const sql of ['SELECT * FROM authority_checkpoint',"UPDATE authority_checkpoint SET digest='"+'0'.repeat(64)+"'"]){
  const out=await child(`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1],{timeout:0});
  try{d.prepare(process.argv[2]).all();console.log('UNEXPECTED');}catch(e){console.log(e.errcode&255);}finally{d.close();}`,[path,sql]);
  assert.equal(out.stdout.trim(),'5');
 }
 await store.close();const second=await SQLiteAuthorityStore.open({path});await second.close();
});

test('CAS stale digest is fatal and never overwrites the checkpoint',async t=>{
 const {path,store,world}=await create(t),saved=world.checkpoint();
 await assert.rejects(store.compareAndSwap(null,saved),code('STORE_CONFLICT'));
 assert.equal(store.fault,'STORE_CONFLICT');await assert.rejects(store.load(),code('STORE_FAILED_CLOSED'));
 await assert.rejects(store.compareAndSwap(saved.digest,saved),code('STORE_FAILED_CLOSED'));
 await store.close();const s=await SQLiteAuthorityStore.open({path});assert.deepEqual(await s.load(),saved);await s.close();
});

test('invalid envelope, JSON values, options and pretransaction size failures are retryable',async t=>{
 const {store,world}=await create(t),saved=world.checkpoint();
 for(const bad of [null,[],{...saved,extra:1},{...saved,digest:'bad'},{...saved,state:[]},
  {...saved,state:{a:NaN}},{...saved,state:{a:undefined}},{...saved,state:{a:new Date()}},{...saved,state:{a:new Array(2)}}]){
   await assert.rejects(store.compareAndSwap(saved.digest,bad),code('STORE_RECORD'));
 }
 const cyclic={};cyclic.a=cyclic;await assert.rejects(store.compareAndSwap(saved.digest,{...saved,state:cyclic}),code('STORE_RECORD'));
 await assert.rejects(store.compareAndSwap('bad',saved),code('STORE_EXPECTED_DIGEST'));
 await assert.rejects(store.compareAndSwap(saved.digest,saved,{beforeCommit:4}),code('STORE_COMMIT_GUARD'));
 assert.equal(store.fault,null);assert.deepEqual(await store.load(),saved);
 const path=await disk(t),tiny=await SQLiteAuthorityStore.open({path,maxBytes:1024});t.after(()=>tiny.close());
 await assert.rejects(tiny.compareAndSwap(null,saved),code('STORE_SIZE_OR_TYPE'));assert.equal(await tiny.load(),null);
 const shared={x:1};await tiny.compareAndSwap(null,{schema:saved.schema,digest:saved.digest,state:{a:shared,b:shared}});
});

test('synchronous pre-COMMIT guard rejects by rollback and can retry; async guards never commit',async t=>{
 const {store,world}=await create(t),saved=world.checkpoint(),next={...saved,digest:'1'.repeat(64),state:{...saved.state,marker:1}};
 let called=0;const denied=Object.assign(Error('LEASE_EXPIRED'),{code:'LEASE_EXPIRED'});
 await assert.rejects(store.compareAndSwap(saved.digest,next,{beforeCommit(){called++;throw denied;}}),e=>e===denied);
 assert.equal(called,1);assert.equal(store.fault,null);assert.deepEqual(await store.load(),saved);
 await assert.rejects(store.compareAndSwap(saved.digest,next,{beforeCommit:async()=>{}}),code('STORE_COMMIT_GUARD_ASYNC'));
 assert.deepEqual(await store.load(),saved);
 await store.compareAndSwap(saved.digest,next,{beforeCommit(){called++;}});assert.deepEqual(await store.load(),next);
});

test('guard runs after DML and immediately before COMMIT, without an async gap',async t=>{
 const {store,world}=await create(t),saved=world.checkpoint();const events=[],original=DatabaseSync.prototype.exec;
 const mock=t.mock.method(DatabaseSync.prototype,'exec',function(sql){events.push(sql);return original.call(this,sql);});
 await store.compareAndSwap(saved.digest,saved,{beforeCommit(){events.push('guard');}});mock.mock.restore();
 assert.deepEqual(events.slice(-2),['guard','COMMIT']);
});

test('thrown COMMIT before mutation publishes nothing and latches uncertainty',async t=>{
 const {path,store,world}=await create(t),saved=world.checkpoint();const a=world.attach({actorId:'local.one'});await a.open();
 const original=DatabaseSync.prototype.exec;let armed=true;
 const mock=t.mock.method(DatabaseSync.prototype,'exec',function(sql){if(armed&&sql==='COMMIT'){armed=false;throw Object.assign(Error('disk full'),{errcode:13});}return original.call(this,sql);});
 await assert.rejects(a.registerEye('main',entryView()),code('STORE_IO_UNCERTAIN'));mock.mock.restore();
 assert.deepEqual(world.checkpoint(),saved);assert.equal(store.fault,'STORE_IO_UNCERTAIN');
 await assert.rejects(a.registerEye('main',entryView()),code('STORE_FAILED_CLOSED'));
 await store.close();const reopened=await SQLiteAuthorityStore.open({path});assert.deepEqual(await reopened.load(),saved);await reopened.close();
});

test('COMMIT succeeds then throws: memory remains old, owner fails closed, reopen recovers durable new record',async t=>{
 const {path,store,world}=await create(t),saved=world.checkpoint();const a=world.attach({actorId:'local.one'});await a.open();
 const original=DatabaseSync.prototype.exec;let armed=true;
 const mock=t.mock.method(DatabaseSync.prototype,'exec',function(sql){const r=original.call(this,sql);if(armed&&sql==='COMMIT'){armed=false;throw Object.assign(Error('uncertain I/O'),{errcode:10});}return r;});
 await assert.rejects(a.registerEye('main',entryView()),code('STORE_IO_UNCERTAIN'));mock.mock.restore();
 assert.deepEqual(world.checkpoint(),saved);await assert.rejects(store.load(),code('STORE_FAILED_CLOSED'));
 await store.close();const s=await SQLiteAuthorityStore.open({path});const newer=await s.load();assert.notEqual(newer.digest,saved.digest);
 assert.ok(newer.state.eyes[JSON.stringify(['local.one','main'])]);await LocalLeaseWorld.create({snapshot:workshopSeed(),store:s});await s.close();
});

test('rollback failure during guard rejection is fatal; shutdown still releases owner',async t=>{
 const {path,store,world}=await create(t),saved=world.checkpoint();const original=DatabaseSync.prototype.exec;
 const mock=t.mock.method(DatabaseSync.prototype,'exec',function(sql){if(sql==='ROLLBACK')throw Error('I/O');return original.call(this,sql);});
 await assert.rejects(store.compareAndSwap(saved.digest,saved,{beforeCommit(){throw Error('LEASE_EXPIRED');}}),code('STORE_IO_UNCERTAIN'));
 mock.mock.restore();assert.equal(store.fault,'STORE_IO_UNCERTAIN');await store.close();const s=await SQLiteAuthorityStore.open({path});assert.deepEqual(await s.load(),saved);await s.close();
});

test('restart preserves both Eyes/history and releases stale process leases before new admission',async t=>{
 const {path,store,world}=await create(t);const a=world.attach({actorId:'local.one'}),b=world.attach({actorId:'local.two'});
 await a.open();await b.open();await a.registerEye('main',entryView());await b.registerEye('main',entryView());
 const view=entryView();view.q[3]=4;await a.moveEye('main',view,0);
 const receipt=await a.submit(command('grab.begin',{entityId:'relic',source:'touch',inputEpoch:1}));assert.equal(receipt.status,'accepted');
 const saved=world.checkpoint();await store.close();const s=await SQLiteAuthorityStore.open({path});t.after(()=>s.close());
 const w=await LocalLeaseWorld.create({snapshot:workshopSeed(),store:s});assert.deepEqual(w.checkpoint().state.eyes,saved.state.eyes);
 assert.deepEqual(w.checkpoint().state.events.slice(0,-1),saved.state.events);assert.equal(w.checkpoint().state.events.at(-1).kind,'restart-release');
 assert.deepEqual(w.checkpoint().state.leases,{});assert.deepEqual(w.checkpoint().state.receipts,saved.state.receipts);
});

test('wrong/corrupt/empty/oversize stores fail without reseeding or replacing source bytes',async t=>{
 for(const bytes of [Buffer.alloc(0),Buffer.from('{"legacy":"json"}'),Buffer.alloc(512,77)]){
  const path=await disk(t);await writeFile(path,bytes,{mode:0o600});await assert.rejects(SQLiteAuthorityStore.open({path}));assert.deepEqual(await readFile(path),bytes);
 }
 const path=await disk(t),s=await SQLiteAuthorityStore.open({path});await s.close();await assert.rejects(SQLiteAuthorityStore.open({path}),code('STORE_EMPTY_OR_INVALID'));
 const c=await create(t);await c.store.close();await assert.rejects(SQLiteAuthorityStore.open({path:c.path,maxBytes:1024}),code('STORE_SIZE_OR_TYPE'));
 const db=new DatabaseSync(c.path);db.exec('CREATE TABLE unrelated(x TEXT)');db.close();const before=await readFile(c.path);
 await assert.rejects(SQLiteAuthorityStore.open({path:c.path}),code('STORE_SCHEMA'));assert.deepEqual(await readFile(c.path),before);
});

test('malformed UTF8/JSON/duplicate keys/digest pairing never masquerades as a valid load',async t=>{
 for(const transform of [()=>Buffer.from('bad\n'),()=>Buffer.from([0xff]),
  r=>Buffer.from(JSON.stringify(r).replace('"schema":','"schema":"forged","schema":')+'\n'),
  r=>Buffer.from(JSON.stringify({...r,digest:'1'.repeat(64)})+'\n')]){
  const {path,store,world}=await create(t);const saved=world.checkpoint();await store.close();const db=new DatabaseSync(path);
  db.prepare('UPDATE authority_checkpoint SET payload=?').run(transform(saved));db.close();
  await assert.rejects(SQLiteAuthorityStore.open({path}),code('STORE_RECORD'));
 }
});

test('valid-format wrong canonical digest is rejected by authority; no automatic world replacement',async t=>{
 const {path,store,world}=await create(t);const bad={...world.checkpoint(),digest:'0'.repeat(64)};
 await store.compareAndSwap(world.checkpoint().digest,bad);await store.close();
 const s=await SQLiteAuthorityStore.open({path});t.after(()=>s.close());
 await assert.rejects(LocalLeaseWorld.create({snapshot:workshopSeed(),store:s}),code('CHECKPOINT_HASH'));assert.deepEqual(await s.load(),bad);
});

test('strict schema rejects altered version and extra trigger',async t=>{
 for(const sql of ['PRAGMA user_version=999',"CREATE TRIGGER unauthorized AFTER UPDATE ON authority_checkpoint BEGIN DELETE FROM authority_checkpoint; END"]){
  const {path,store}=await create(t);await store.close();const db=new DatabaseSync(path);db.exec(sql);db.close();
  await assert.rejects(SQLiteAuthorityStore.open({path}),code('STORE_SCHEMA'));
 }
});

test('unsafe file paths, public parent, hardlinks, symlinks and orphan sidecars fail before SQLite writes',async t=>{
 await assert.rejects(SQLiteAuthorityStore.open({path:'checkpoint.sqlite'}),code('STORE_PRIVATE_PATH'));
 await assert.rejects(SQLiteAuthorityStore.open({path:resolve('services/vivo/data/private/checkpoint.sqlite')}),code('STORE_IN_WEB_ROOT'));
 const path=await disk(t);await writeFile(path+'-wal','stale',{mode:0o600});await assert.rejects(SQLiteAuthorityStore.open({path}),code('STORE_ORPHAN_SIDECAR'));
 if(process.platform!=='win32') {
  const other=await disk(t);await chmod(join(other,'..'),0o755);await assert.rejects(SQLiteAuthorityStore.open({path:other}),code('STORE_PRIVATE_PATH'));
 }
 const good=await create(t);await good.store.close();const sym=join(good.path,'..','alias.sqlite');
 if(process.platform!=='win32') {
  await symlink(good.path,sym);await assert.rejects(SQLiteAuthorityStore.open({path:sym}),code('STORE_SIZE_OR_TYPE'));await rm(sym);
 }
 await link(good.path,sym);await assert.rejects(SQLiteAuthorityStore.open({path:good.path}),code('STORE_SIZE_OR_TYPE'));
 const target=await disk(t),alias=join(target,'..','redirect');
 await symlink(join(good.path,'..'),alias,process.platform==='win32'?'junction':'dir');
 await assert.rejects(SQLiteAuthorityStore.open({path:join(alias,'world.sqlite')}),code('STORE_PRIVATE_PATH'));
});

function evidence(path='C:\\Users\\Owner\\AppData\\Local\\Vivo\\checkpoint.sqlite') {
 const sid='S-1-5-21-1-2-3-1001',nodes=[];
 for(let p=win32.dirname(path);;p=win32.dirname(p)){
  nodes.push({path:p,exists:true,attributes:16,owner:sid,daclPresent:true,aces:[{type:'allow',sid,mask:0x1f01ff,flags:3}]});
  if(win32.dirname(p)===p)break;
 }
 for(const p of [path,...SQLITE_SIDECARS.map(s=>path+s)])nodes.push({path:p,exists:false});
 return {schema:'vivo.windows-path/1',path,sid,driveType:'Fixed',fileSystem:'NTFS',device:'\\Device\\HarddiskVolume3',nodes};
}

test('Windows lexical path policy rejects aliases, ADS, network/device/reserved/static targets',()=>{
 const safe='C:\\Users\\Owner\\AppData\\Local\\Vivo\\checkpoint.sqlite';assert.equal(validateWindowsPath(safe),safe);
 for(const bad of ['\\\\server\\share\\c.sqlite','\\\\?\\C:\\private\\c.sqlite','C:private\\c.sqlite','C:\\private\\x:stream',
  'C:\\private\\CONIN$','C:\\private\\CONOUT$','C:\\private\\NUL.sqlite','C:\\private\\AUX','C:\\private\\COM¹.db','C:\\private\\x.','C:\\private\\..\\c.sqlite',
  'C:/private/c.sqlite','C:\\private\\x \\c.sqlite'])assert.throws(()=>validateWindowsPath(bad),code('STORE_PRIVATE_PATH'));
 assert.throws(()=>validateWindowsPath('c:\\CODE\\Web\\x.sqlite',['C:\\code']),code('STORE_IN_WEB_ROOT'));
});

test('Windows SID/DACL evidence accepts private inheritance and rejects unknown/missing/reparse/permissive evidence',()=>{
 const safe=evidence();assert.equal(validateWindowsEvidence(safe,safe.path),true);
 const alterations=[r=>r.driveType='Network',r=>r.fileSystem='FAT32',r=>r.device='\\??\\C:\\redirect',r=>r.nodes.pop(),
  r=>r.nodes[0].attributes|=0x400,r=>r.nodes[1].attributes|=0x400,r=>r.nodes[0].owner='S-1-1-0',r=>r.nodes[0].daclPresent=false,
  r=>r.nodes[0].aces[0].flags=0,
  r=>r.nodes[0].aces.push({type:'deny',sid:r.sid,mask:2,flags:0}),
  r=>r.nodes[0].aces.push({type:'allow',sid:'S-1-1-0',mask:1,flags:9}), // broad inherit-only file read leaks WAL
  r=>r.nodes[1].aces.push({type:'allow',sid:'S-1-5-11',mask:0x40,flags:0}),
  r=>r.nodes[0].aces.push({type:'unknown',sid:r.sid,mask:1,flags:0})];
 for(const alter of alterations){const r=structuredClone(safe);alter(r);assert.throws(()=>validateWindowsEvidence(r,r.path),code('STORE_PRIVATE_PATH'));}
 const readOnlyAncestor=structuredClone(safe);readOnlyAncestor.nodes[1].aces.push({type:'allow',sid:'S-1-1-0',mask:0x1200a9,flags:0});
 assert.equal(validateWindowsEvidence(readOnlyAncestor,readOnlyAncestor.path),true);
});

for(const stage of ['before-commit','after-commit','after-ack'])test(`forced termination ${stage} recovers complete old/new checkpoint and OS ownership`,async t=>{
 const {path,store,world}=await create(t),saved=world.checkpoint();await store.close();
 const js=`import {DatabaseSync} from 'node:sqlite';import {SQLiteAuthorityStore} from ${JSON.stringify(storeURL)};
 import {LocalLeaseWorld} from ${JSON.stringify(authorityURL)};import {workshopSeed,entryView} from ${JSON.stringify(seedURL)};
 const s=await SQLiteAuthorityStore.open({path:process.argv[1]});const w=await LocalLeaseWorld.create({snapshot:workshopSeed(),store:s});
 const a=w.attach({actorId:'local.one'});await a.open();const exec=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&process.argv[2]==='before-commit')process.kill(process.pid,'SIGKILL');
 const r=exec.call(this,sql);if(sql==='COMMIT'&&process.argv[2]==='after-commit')process.kill(process.pid,'SIGKILL');return r;};
 await a.registerEye('main',entryView());process.stdout.write('ACK\\n',()=>process.kill(process.pid,'SIGKILL'));`;
 let outcome;try{outcome=await child(js,[path,stage]);assert.fail('Expected forced termination');}catch(e){outcome=e;}
 if(stage==='after-ack')assert.match(outcome.stdout,/ACK/);else assert.equal(outcome.stdout,'');
 const s=await SQLiteAuthorityStore.open({path});t.after(()=>s.close());const loaded=await s.load();
 if(stage==='before-commit')assert.deepEqual(loaded,saved);
 else{assert.notEqual(loaded.digest,saved.digest);assert.equal(loaded.state.events.at(-1).kind,'eye-register');}
 await LocalLeaseWorld.create({snapshot:workshopSeed(),store:s});
});

test('byte bound includes final newline: exact size commits, one extra byte cannot mutate',async t=>{
 const path=await disk(t),s=await SQLiteAuthorityStore.open({path,maxBytes:4096});t.after(()=>s.close());
 const r={schema:'vivo.lease-checkpoint/1',digest:'a'.repeat(64),state:{padding:''}};
 r.state.padding='x'.repeat(4096-Buffer.byteLength(JSON.stringify(r)+'\n'));
 assert.equal(Buffer.byteLength(JSON.stringify(r)+'\n'),4096);await s.compareAndSwap(null,r);
 const tooLarge=structuredClone(r);tooLarge.state.padding+='x';
 await assert.rejects(s.compareAndSwap(r.digest,tooLarge),code('STORE_SIZE_OR_TYPE'));
 assert.deepEqual(await s.load(),r);assert.equal(s.fault,null);
});

test('forced termination during large BLOB writes recovers only a complete old or new record',async t=>{
 for(let iteration=0;iteration<3;iteration++) {
  const {path,store,world}=await create(t),before=world.checkpoint();await store.close();
  const js=`import {DatabaseSync,StatementSync} from 'node:sqlite';import {createHash} from 'node:crypto';
  import {SQLiteAuthorityStore} from ${JSON.stringify(storeURL)};
  const s=await SQLiteAuthorityStore.open({path:process.argv[1]});const old=await s.load(),next=structuredClone(old);
  next.state.syntheticPadding='x'.repeat(4*1024*1024);
  const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  next.digest=createHash('sha256').update(canonical(next.state)).digest('hex');
  const run=StatementSync.prototype.run;StatementSync.prototype.run=function(...args){process.stdout.write('MUTATING\\n');return run.apply(this,args);};
  await s.compareAndSwap(old.digest,next);process.stdout.write('ACK\\n');setInterval(()=>{},1000);`;
  const proc=spawn(process.execPath,['--input-type=module','-e',js,path],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(proc.exitCode===null)proc.kill('SIGKILL');});
  const exited=once(proc,'exit');let observed='',killing=false;
  await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{proc.kill('SIGKILL');reject(Error('MUTATION_TIMEOUT'));},30000);
   proc.stdout.on('data',chunk=>{observed+=chunk;if(observed.includes('MUTATING')&&!killing){killing=true;clearTimeout(timeout);setTimeout(()=>{proc.kill('SIGKILL');resolve();},iteration*4);}});
   proc.once('error',reject);proc.once('exit',()=>{if(!observed.includes('MUTATING')){clearTimeout(timeout);reject(Error('NO_MUTATION'));}});
  });await exited;
  const s=await SQLiteAuthorityStore.open({path});t.after(()=>s.close());const loaded=await s.load();
  if(loaded.digest===before.digest)assert.deepEqual(loaded,before);
  else assert.equal(loaded.state.syntheticPadding,'x'.repeat(4*1024*1024));
  await LocalLeaseWorld.create({snapshot:workshopSeed(),store:s});await s.close();
 }
});

// Only main and WAL hold durable database content. SQLite's read-only WAL reader
// may create/update the SHM lock/index; refusal never promises immutable SHM bytes.
const durableBytes=path=>Object.fromEntries(['','-wal','-journal'].map(suffix=>
  [suffix,existsSync(path+suffix)?readFileSync(path+suffix):null]));

for(const mode of ['foreign','foreign-without-shm','wrong-version','extra-table'])test(`rejected crash-left ${mode} preserves exact main/WAL payloads`,async t=>{
 const path=await disk(t);
 let prefix=`import {DatabaseSync} from 'node:sqlite';import {openSync,closeSync} from 'node:fs';
  closeSync(openSync(process.argv[1],'wx',0o600));const db=new DatabaseSync(process.argv[1]);
  db.exec("PRAGMA journal_mode=WAL;CREATE TABLE unrelated(x TEXT);INSERT INTO unrelated VALUES('foreign authority')");`;
 if(mode==='wrong-version'||mode==='extra-table') {
  const made=await create(t,{path});await made.store.close();
  prefix=`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec(${JSON.stringify(mode==='wrong-version'?'PRAGMA user_version=999':'CREATE TABLE unrelated(x TEXT)')});`;
 }
 try{await child(prefix+"process.kill(process.pid,'SIGKILL');",[path]);assert.fail('Expected crash');}catch(e){assert.equal(e.signal,'SIGKILL');}
 if(mode==='foreign-without-shm')await rm(path+'-shm');
 const before=durableBytes(path);assert.ok(before['-wal']?.length>0);
 await assert.rejects(SQLiteAuthorityStore.open({path}),code('STORE_SCHEMA'));
 assert.deepEqual(durableBytes(path),before);
});

test('canonical first-checkpoint identity existing only in WAL recovers without reseeding',async t=>{
 const path=await disk(t),saved=await record();
 const js=`import {SQLiteAuthorityStore} from ${JSON.stringify(storeURL)};
 import {LocalLeaseWorld} from ${JSON.stringify(authorityURL)};import {workshopSeed} from ${JSON.stringify(seedURL)};
 const s=await SQLiteAuthorityStore.open({path:process.argv[1]});await LocalLeaseWorld.create({snapshot:workshopSeed(),store:s});
 process.kill(process.pid,'SIGKILL');`;
 try{await child(js,[path]);assert.fail('Expected crash');}catch(e){assert.equal(e.signal,'SIGKILL');}
 assert.equal(readFileSync(path).readUInt32BE(68),0,'main header has no VIVO application id yet');
 assert.ok(readFileSync(path+'-wal').length>0);
 const reopened=await SQLiteAuthorityStore.open({path});t.after(()=>reopened.close());
 assert.deepEqual(await reopened.load(),saved);
});

test('identity change after read-only preflight is rejected under writer lock without checkpointing it',async t=>{
 const {path,store}=await create(t);await store.close();
 const original=DatabaseSync.prototype.exec;let armed=true,before;
 const mock=t.mock.method(DatabaseSync.prototype,'exec',function(sql){
  if(armed&&sql==='BEGIN IMMEDIATE') {
   armed=false;
   // A legitimate separate SQL writer can commit while our read-only snapshot
   // is held. Its close cannot checkpoint while that guard reader remains alive.
   const result=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1]);
    d.exec('PRAGMA user_version=999');d.close();`,path],{timeout:10000,encoding:'utf8'});
   assert.equal(result.status,0);before=durableBytes(path);assert.ok(before['-wal']?.length>0);
  }
  return original.call(this,sql);
 });
 await assert.rejects(SQLiteAuthorityStore.open({path}),code('STORE_SCHEMA'));mock.mock.restore();
 assert.equal(armed,false);assert.deepEqual(durableBytes(path),before);
});

test('inherited array toJSON cannot transform persisted authority bytes',async t=>{
 const {store,world}=await create(t),saved=world.checkpoint();let called=0;
 class ChangingArray extends Array {toJSON(){called++;return ['substituted'];}}
 const bad={...saved,state:{a:new ChangingArray('original')}};
 await assert.rejects(store.compareAndSwap(saved.digest,bad),code('STORE_RECORD'));
 assert.equal(called,0);assert.equal(store.fault,null);assert.deepEqual(await store.load(),saved);
});

test('foreign hot rollback journal is refused without recovery writes',async t=>{
 const path=await disk(t);
 const js=`import {DatabaseSync} from 'node:sqlite';import {openSync,closeSync} from 'node:fs';
 closeSync(openSync(process.argv[1],'wx',0o600));const d=new DatabaseSync(process.argv[1]);
 d.exec("PRAGMA journal_mode=DELETE;PRAGMA cache_size=5;CREATE TABLE unrelated(x BLOB);INSERT INTO unrelated VALUES(zeroblob(1048576));BEGIN IMMEDIATE;UPDATE unrelated SET x=randomblob(1048576)");
 process.kill(process.pid,'SIGKILL');`;
 try{await child(js,[path]);assert.fail('Expected crash');}catch(e){assert.equal(e.signal,'SIGKILL');}
 const before=durableBytes(path);assert.ok(before['-journal']?.length>0);
 await assert.rejects(SQLiteAuthorityStore.open({path}));assert.deepEqual(durableBytes(path),before);
});
