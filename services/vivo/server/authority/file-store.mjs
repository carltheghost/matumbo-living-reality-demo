/** POSIX single-writer durable checkpoint store. Not browser storage or authentication.
 * A failed/uncertain write never becomes an accepted in-memory authority receipt.
 * Crash-left lock directories require operator inspection; never steal a live lock.
 */
import {mkdir,open,unlink,rmdir,lstat} from 'node:fs/promises';
import {constants,renameSync} from 'node:fs';
import {dirname,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const webRoot=fileURLToPath(new URL('../../web/',import.meta.url));

export class FileAuthorityStore {
  #path; #limit;
  supportsCommitGuard = true;
  constructor({path,maxBytes=20*1024*1024}) {
    if(typeof path!=='string'||!path.length||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>64*1024*1024)fail('INVALID_STORE_OPTIONS');
    this.#path=resolve(path);this.#limit=maxBytes;
    const r=relative(webRoot,this.#path);
    if(r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!r.startsWith(sep)))fail('STORE_IN_WEB_ROOT');
  }
  async #parent() {
    const parent=dirname(this.#path);
    await mkdir(parent,{recursive:true,mode:0o700});
    for(let p=parent;;p=dirname(p)) {
      const info=await lstat(p);
      if(info.isSymbolicLink()||!info.isDirectory())fail('STORE_PARENT_UNSAFE');
      if(dirname(p)===p)break;
    }
  }
  async load() {
    await this.#parent();let f;
    try {f=await open(this.#path,constants.O_RDONLY|constants.O_NOFOLLOW);}
    catch(e) {if(e.code==='ENOENT')return null;throw e;}
    try {
      const info=await f.stat();
      if(!info.isFile()||info.size>this.#limit)fail('STORE_SIZE_OR_TYPE');
      const text=await f.readFile({encoding:'utf8'});
      if(Buffer.byteLength(text)>this.#limit)fail('STORE_SIZE_OR_TYPE');
      const v=JSON.parse(text);
      if(v?.schema!=='vivo.lease-checkpoint/1'||typeof v.digest!=='string'||!/^[a-f0-9]{64}$/.test(v.digest)||!v.state)fail('STORE_RECORD');
      return v;
    } finally {await f.close();}
  }
  async compareAndSwap(expected,value,{beforeCommit}={}) {
    if(beforeCommit!==undefined&&typeof beforeCommit!=='function')fail('STORE_COMMIT_GUARD');
    if(expected!==null&&(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)))fail('STORE_EXPECTED_DIGEST');
    if(value?.schema!=='vivo.lease-checkpoint/1'||!/^[a-f0-9]{64}$/.test(value.digest)||!value.state)fail('STORE_RECORD');
    const data=Buffer.from(JSON.stringify(value)+'\n');
    if(data.length>this.#limit)fail('STORE_SIZE_OR_TYPE');
    await this.#parent();const lock=this.#path+'.lock';
    try {await mkdir(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')fail('STORE_BUSY');throw e;}
    const tmp=this.#path+'.'+randomUUID()+'.tmp';let file;
    try {
      const current=await this.load();
      if((current?.digest??null)!==expected)fail('STORE_CONFLICT');
      file=await open(tmp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
      await file.writeFile(data);await file.sync();await file.close();file=null;
      // Final authorization/expiry check and rename share a synchronous boundary.
      // The following directory fsync still must succeed before acceptance.
      if(beforeCommit){const result=beforeCommit();if(result?.then){Promise.resolve(result).catch(()=>{});fail('STORE_ASYNC_COMMIT_GUARD');}}
      renameSync(tmp,this.#path);
      const directory=await open(dirname(this.#path),constants.O_RDONLY|constants.O_DIRECTORY);
      try{await directory.sync();}finally{await directory.close();}
    } finally {
      if(file)await file.close();
      await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});
      await rmdir(lock);
    }
  }
}
