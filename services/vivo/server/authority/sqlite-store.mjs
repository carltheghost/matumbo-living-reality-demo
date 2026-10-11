/** Explicit SQLite backend; FileAuthorityStore remains the POSIX default.
 * One private local file, one connection, one lifetime owner. Full checkpoints only.
 * Never changes directory security, migrates another store, or recovers by reseeding.
 */
import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,lstatSync} from 'node:fs';
import {validateSQLitePath} from './sqlite-path-policy.mjs';
const LIMIT=64*1024*1024;
const APP_ID=0x5649564f; // VIVO; paired with the exact v1 schema, not sufficient alone.
const VERSION=1;
const DDL=`CREATE TABLE authority_checkpoint (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  digest TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
  payload BLOB NOT NULL CHECK (length(payload) BETWEEN 1 AND ${LIMIT})
) STRICT`;
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const error=(code,cause)=>Object.assign(new Error(code,cause?{cause}:undefined),{code});
const fail=code=>{throw error(code);};
const busy=e=>(e?.errcode&0xff)===5||(e?.errcode&0xff)===6;
const value=(db,sql)=>Object.values(db.prepare(sql).get())[0];

// JSON.stringify would silently turn NaN into null, omit undefined, invoke getters
// or toJSON, and collapse sparse arrays. Reject those instead of changing authority.
function jsonData(root,limit) {
  const stack=[[root,0]],seen=new WeakSet();let nodes=0;
  while(stack.length) {
    const [v,depth,exit]=stack.pop();if(exit){seen.delete(v);continue;}if(++nodes>limit||depth>128)fail('STORE_RECORD');
    if(v===null||typeof v==='string'||typeof v==='boolean')continue;
    if(typeof v==='number') {if(!Number.isFinite(v))fail('STORE_RECORD');continue;}
    if(typeof v!=='object'||seen.has(v))fail('STORE_RECORD');seen.add(v);stack.push([v,depth,true]);
    if(Array.isArray(v)?Object.getPrototypeOf(v)!==Array.prototype:
      ![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('STORE_RECORD');
    const keys=Reflect.ownKeys(v);
    if(Array.isArray(v)&&keys.length!==v.length+1)fail('STORE_RECORD');
    for(const k of keys) {
      if(Array.isArray(v)&&k==='length')continue;
      const d=Object.getOwnPropertyDescriptor(v,k);
      if(typeof k!=='string'||!d.enumerable||!Object.hasOwn(d,'value'))fail('STORE_RECORD');
      if(Array.isArray(v)&&(!/^(?:0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))fail('STORE_RECORD');
      stack.push([d.value,depth+1]);
    }
  }
}
function recordShape(record) {
  if(!object(record)||Object.keys(record).length!==3||record.schema!=='vivo.lease-checkpoint/1'||
    !digest(record.digest)||!object(record.state))fail('STORE_RECORD');
}
function encode(record,limit) {
  jsonData(record,limit);recordShape(record);
  const data=Buffer.from(JSON.stringify(record)+'\n');
  if(data.length>limit)fail('STORE_SIZE_OR_TYPE');
  return data;
}
function decode(data,rowDigest,limit) {
  if(!(data instanceof Uint8Array)||data.byteLength>limit||!digest(rowDigest))fail('STORE_RECORD');
  let text,record;
  try {text=new TextDecoder('utf-8',{fatal:true}).decode(data);record=JSON.parse(text);}catch{fail('STORE_RECORD');}
  recordShape(record);
  if(record.digest!==rowDigest||!encode(record,limit).equals(data))fail('STORE_RECORD');
  // LocalLeaseWorld remains responsible for canonical state/hash validation.
  return record;
}
function schema(db) {
  if(value(db,'PRAGMA application_id')!==APP_ID||value(db,'PRAGMA user_version')!==VERSION)fail('STORE_SCHEMA');
  const rows=db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name LIMIT 2').all();
  if(rows.length!==1||rows[0].type!=='table'||rows[0].name!=='authority_checkpoint'||
    rows[0].tbl_name!=='authority_checkpoint'||rows[0].sql!==DDL)fail('STORE_SCHEMA');
}
// Read-only validation is repeated under the writer lock. A main-header-only
// probe is insufficient: a valid early-crash authority can exist entirely in WAL.
function existing(db,limit) {
  schema(db);
  if(value(db,'PRAGMA journal_mode')!=='wal'||value(db,'PRAGMA page_size')!==4096)fail('STORE_DURABILITY_MODE');
  const pageLimit=Math.ceil((2*LIMIT+4*1024*1024)/4096);
  if(value(db,'PRAGMA page_count')>pageLimit)fail('STORE_SIZE_OR_TYPE');
  if(value(db,'PRAGMA quick_check')!=='ok')fail('STORE_CORRUPT');
  const rows=db.prepare('SELECT id, digest, length(payload) AS bytes FROM authority_checkpoint LIMIT 2').all();
  if(rows.length!==1||rows[0].id!==1)fail('STORE_EMPTY_OR_INVALID');
  if(rows[0].bytes>limit)fail('STORE_SIZE_OR_TYPE');
  decode(db.prepare('SELECT payload FROM authority_checkpoint WHERE id=1').get().payload,rows[0].digest,limit);
}
function versionSafe(version) {
  const n=version.split('.').map(Number);
  return n.length===3&&n.every(Number.isInteger)&&(n[0]>3||(n[0]===3&&(n[1]>51||(n[1]===51&&n[2]>=3))));
}

export class SQLiteAuthorityStore {
  #db; #limit; #fresh; #fault=null; #closed=false; #diagnostics;
  constructor(key,db,limit,fresh,diagnostics) {
    if(key!==SQLiteAuthorityStore)fail('USE_OPEN');
    this.#db=db;this.#limit=limit;this.#fresh=fresh;this.#diagnostics=Object.freeze(diagnostics);
  }
  /** Identifies existing files read-only, then acquires EXCLUSIVE before world load. */
  static async open({path,maxBytes=LIMIT}={}) {
    const [major,minor]=process.versions.node.split('.').map(Number);
    if(major!==24||minor<19)fail('STORE_NODE_24_19_REQUIRED');
    if(!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>LIMIT)fail('INVALID_STORE_OPTIONS');
    const checked=validateSQLitePath(path),fresh=!checked.exists;
    if(fresh) {
      // A second starter cannot also treat this file as a new empty authority.
      // Windows privacy comes from validated inheritable DACLs, not this POSIX mode.
      let fd;try{fd=openSync(checked.path,'wx',0o600);}catch(e){if(e.code==='EEXIST')fail('STORE_BUSY');throw e;}
      finally{if(fd!==undefined)closeSync(fd);}
      validateSQLitePath(path);
    } else if(lstatSync(checked.path).size<512)fail('STORE_SCHEMA');
    let db,inspection;
    const options={timeout:0,defensive:true,allowExtension:false,
      enableDoubleQuotedStringLiterals:false,enableForeignKeyConstraints:true,
      limits:{length:maxBytes+4096,sqlLength:8192,attach:0}};
    try {
      if(!fresh) {
        // Opening an unidentified WAL read-write can checkpoint it on close, even
        // after a rejected schema. Keep this read-only transaction alive until a
        // writer has locked and independently identified the current database.
        // SQLite can update/create transient SHM lock/index metadata here; it
        // cannot rewrite main/WAL payloads through this read-only connection.
        inspection=new DatabaseSync(checked.path,{...options,readOnly:true});
        inspection.exec('PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; BEGIN');
        existing(inspection,maxBytes);
        validateSQLitePath(path);
      }
      db=new DatabaseSync(checked.path,options);
      if(fresh&&value(db,'PRAGMA locking_mode=EXCLUSIVE')!=='exclusive')fail('STORE_DURABILITY_MODE');
      db.exec('PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY;');
      const sqlite=value(db,'SELECT sqlite_version()');
      if(!versionSafe(sqlite))fail('STORE_SQLITE_VERSION');
      if(!fresh) {
        // BEGIN IMMEDIATE fences other SQL writers. The retained reader prevents
        // this connection's failure/close path from checkpointing an identity
        // which changed after preflight. Validate before releasing that reader.
        db.exec('BEGIN IMMEDIATE');existing(db,maxBytes);validateSQLitePath(path);
        inspection.close();inspection=null;
        if(value(db,'PRAGMA locking_mode=EXCLUSIVE')!=='exclusive')fail('STORE_DURABILITY_MODE');
        db.exec('COMMIT');
      } else if(value(db,'PRAGMA journal_mode=WAL')!=='wal')fail('STORE_DURABILITY_MODE');
      if(value(db,'PRAGMA journal_mode')!=='wal'||value(db,'PRAGMA synchronous')!==2||
        value(db,'PRAGMA locking_mode')!=='exclusive'||value(db,'PRAGMA trusted_schema')!==0||
        value(db,'PRAGMA page_size')!==4096||db.limits.length!==maxBytes+4096)fail('STORE_DURABILITY_MODE');
      // Bounds database allocation, not an assertion about DB+WAL total disk usage.
      const pageLimit=Math.ceil((2*LIMIT+4*1024*1024)/4096);
      if(value(db,'PRAGMA page_count')>pageLimit)fail('STORE_SIZE_OR_TYPE');
      db.exec(`PRAGMA max_page_count=${pageLimit}; PRAGMA wal_autocheckpoint=256; PRAGMA journal_size_limit=1048576;`);
      if(value(db,'PRAGMA max_page_count')!==pageLimit)fail('STORE_SIZE_OR_TYPE');
      if(value(db,'PRAGMA quick_check')!=='ok')fail('STORE_CORRUPT');
      const diagnostics={backend:'sqlite',node:process.versions.node,sqlite,
        sqliteSourceId:value(db,'SELECT sqlite_source_id()'),journalMode:'wal',synchronous:2,lockingMode:'exclusive',maxBytes};
      db.exec('BEGIN EXCLUSIVE');
      if(fresh)db.exec(`${DDL}; PRAGMA application_id=${APP_ID}; PRAGMA user_version=${VERSION};`);
      else {
        schema(db);
        const rows=db.prepare('SELECT id, digest, length(payload) AS bytes FROM authority_checkpoint LIMIT 2').all();
        if(rows.length!==1||rows[0].id!==1)fail('STORE_EMPTY_OR_INVALID');
        if(rows[0].bytes>maxBytes)fail('STORE_SIZE_OR_TYPE');
        decode(db.prepare('SELECT payload FROM authority_checkpoint WHERE id=1').get().payload,rows[0].digest,maxBytes);
        // Allocate the WAL before readiness so its actual inherited privacy is checked.
        // This writes the same format marker, never changes the checkpoint or migrates it.
        db.exec(`PRAGMA user_version=${VERSION}`);
      }
      validateSQLitePath(path);
      db.exec('COMMIT');
      return new SQLiteAuthorityStore(SQLiteAuthorityStore,db,maxBytes,fresh,diagnostics);
    } catch(e) {
      try {if(db?.isTransaction)db.exec('ROLLBACK');}catch{/* Startup has failed; never publish. */}
      // Close the possible writer FIRST, while the read-only transaction still
      // prevents a last-connection checkpoint. Never swap this close order.
      try {if(db?.isOpen)db.close();}catch{/* Preserve the first failure; no live runtime escapes. */}
      try {if(inspection?.isOpen)inspection.close();}catch{/* No writable handle escapes. */}
      if(busy(e))throw error('STORE_BUSY',e);
      if(e?.code?.startsWith('STORE_'))throw e;
      throw error('STORE_OPEN_FAILED',e);
    }
  }
  get supportsCommitGuard() {return true;}
  get fault() {return this.#fault;}
  get closed() {return this.#closed;}
  get diagnostics() {return this.#diagnostics;}
  #ready() {
    if(this.#closed)fail('STORE_CLOSED');
    if(this.#fault)fail('STORE_FAILED_CLOSED');
  }
  #poison(e,code='STORE_IO_UNCERTAIN') {
    this.#fault=code;
    try {if(this.#db.isTransaction)this.#db.exec('ROLLBACK');}catch{/* Ambiguity remains fatal even if rollback fails. */}
    return error(code,e);
  }
  #read() {
    schema(this.#db);
    const rows=this.#db.prepare('SELECT id, digest, length(payload) AS bytes FROM authority_checkpoint LIMIT 2').all();
    if(rows.length===0&&this.#fresh)return null;
    if(rows.length!==1||rows[0].id!==1)fail('STORE_EMPTY_OR_INVALID');
    if(rows[0].bytes>this.#limit)fail('STORE_SIZE_OR_TYPE');
    const payload=this.#db.prepare('SELECT payload FROM authority_checkpoint WHERE id=1').get().payload;
    return decode(payload,rows[0].digest,this.#limit);
  }
  async load() {
    this.#ready();
    try{return this.#read();}catch(e){throw this.#poison(e,'STORE_READ_FAILED');}
  }
  async compareAndSwap(expected,record,options={}) {
    this.#ready();
    if(expected!==null&&!digest(expected))fail('STORE_EXPECTED_DIGEST');
    if(!object(options)||Object.keys(options).some(k=>k!=='beforeCommit')||
      (Object.hasOwn(options,'beforeCommit')&&typeof options.beforeCommit!=='function'))fail('STORE_COMMIT_GUARD');
    // All caller-data failures happen before a transaction and do not poison the owner.
    const data=encode(record,this.#limit),nextDigest=record.digest;
    try {
      this.#db.exec('BEGIN IMMEDIATE');
      const current=this.#read();
      if((current?.digest??null)!==expected)throw error('STORE_CONFLICT');
      const changed=expected===null
        ?this.#db.prepare('INSERT INTO authority_checkpoint(id,digest,payload) VALUES (1,?,?)').run(nextDigest,data)
        :this.#db.prepare('UPDATE authority_checkpoint SET digest=?,payload=? WHERE id=1 AND digest=?').run(nextDigest,data,expected);
      if(changed.changes!==1)throw error('STORE_CONFLICT');
      if(options.beforeCommit) {
        try {
          const result=options.beforeCommit();
          if(result&&typeof result.then==='function') {
            Promise.resolve(result).catch(()=>{});fail('STORE_COMMIT_GUARD_ASYNC');
          }
        } catch(guardError) {
          // A known guard rejection is retryable only after a confirmed rollback.
          try {this.#db.exec('ROLLBACK');}catch(e){throw this.#poison(e);}
          throw {guardError};
        }
      }
      this.#db.exec('COMMIT');
      // No fallible disk maintenance/stat/cleanup after COMMIT and before publication.
      this.#fresh=false;
    } catch(e) {
      if(Object.hasOwn(e??{},'guardError'))throw e.guardError;
      throw this.#poison(e,e?.code==='STORE_CONFLICT'?'STORE_CONFLICT':'STORE_IO_UNCERTAIN');
    }
  }
  async close() {
    if(this.#closed)return;
    this.#closed=true;
    try {
      if(this.#db.isTransaction)this.#db.exec('ROLLBACK');
      this.#db.close();
    } catch(e) {
      this.#fault='STORE_CLOSE_FAILED';
      // Retry close even when rollback failed. Caller must terminate if close still fails.
      try{if(this.#db.isOpen)this.#db.close();}catch{}
      throw error('STORE_CLOSE_FAILED',e);
    }
  }
}
