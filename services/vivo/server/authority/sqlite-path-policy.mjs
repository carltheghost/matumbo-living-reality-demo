/** Read-only path/privacy checks. Never creates parents or changes an ACL. */
import {lstatSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve,sep,win32} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const checkoutRoot=fileURLToPath(new URL('../../../../',import.meta.url));
const probe=fileURLToPath(new URL('./sqlite-windows-path.ps1',import.meta.url));
const sidPattern=/^S-1-(?:\d+-)+\d+$/;
const system='S-1-5-18',admins='S-1-5-32-544';
const installer='S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';
const full=0x1f01ff;
const mutations=0x500d0040; // DELETE, DELETE_CHILD, WRITE_DAC, WRITE_OWNER, generic all/write
export const SQLITE_SIDECARS=Object.freeze(['-wal','-shm','-journal']);
const within=(path,root,api)=>{const r=api.relative(root,path);return r===''||(!api.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+api.sep));};

/** Pure lexical policy, also exercised by non-Windows tests; no platform spoof. */
export function validateWindowsPath(path,staticRoots=[]) {
  if(typeof path!=='string'||path.length>240||! /^[A-Za-z]:\\/.test(path)||path.includes('/'))fail('STORE_PRIVATE_PATH');
  const parts=path.slice(3).split('\\');
  if(parts.length<2||parts.some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||
    /^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(p)))fail('STORE_PRIVATE_PATH');
  if(staticRoots.some(root=>within(path,root,win32)))fail('STORE_IN_WEB_ROOT');
  return path;
}

/** Validate raw SID/ACE evidence, without changing Windows security settings. */
export function validateWindowsEvidence(report,path) {
  if(!report||report.schema!=='vivo.windows-path/1'||typeof report.sid!=='string'||!sidPattern.test(report.sid)||
    typeof report.path!=='string'||report.path.toLowerCase()!==path.toLowerCase()||report.driveType!=='Fixed'||
    report.fileSystem!=='NTFS'||typeof report.device!=='string'||!/^\\Device\\HarddiskVolume[0-9]+$/i.test(report.device)||
    !Array.isArray(report.nodes)||!report.nodes.length)fail('STORE_PRIVATE_PATH');
  const trusted=new Set([report.sid,system,admins]),ancestorTrusted=new Set([...trusted,installer]);
  const parent=win32.dirname(path).toLowerCase(),expected=new Map();
  for(let p=win32.dirname(path);;p=win32.dirname(p)) {
    expected.set(p.toLowerCase(),p.toLowerCase()===parent?'private-directory':'ancestor');
    if(win32.dirname(p)===p)break;
  }
  for(const p of [path,...SQLITE_SIDECARS.map(s=>path+s)])expected.set(p.toLowerCase(),'file');
  const seen=new Set();
  for(const node of report.nodes) {
    if(!node||typeof node.path!=='string')fail('STORE_PRIVATE_PATH');
    const name=node.path.toLowerCase(),kind=expected.get(name);
    if(!kind||seen.has(name)||typeof node.exists!=='boolean')fail('STORE_PRIVATE_PATH');seen.add(name);
    if(!node.exists) {if(kind!=='file')fail('STORE_PRIVATE_PATH');continue;}
    if(!Number.isInteger(node.attributes)||(node.attributes&0x400)|| // any reparse tag, including junctions/cloud placeholders
      Boolean(node.attributes&0x10)!==(kind!=='file')||!node.daclPresent||!Array.isArray(node.aces)||!node.aces.length||
      !sidPattern.test(node.owner??'')||!(kind==='ancestor'?ancestorTrusted:trusted).has(node.owner))fail('STORE_PRIVATE_PATH');
    let effective=0,child=0;
    for(const ace of node.aces) {
      if(!ace||!['allow','deny'].includes(ace.type)||typeof ace.sid!=='string'||!sidPattern.test(ace.sid)||
        !Number.isInteger(ace.mask)||ace.mask<0||!Number.isInteger(ace.flags)||ace.flags<0||ace.flags>31)fail('STORE_PRIVATE_PATH');
      if(ace.type==='deny') {if(kind!=='ancestor')fail('STORE_PRIVATE_PATH');continue;}
      if(kind==='ancestor') {
        if(!(ace.flags&8)&&!ancestorTrusted.has(ace.sid)&&(ace.mask&mutations))fail('STORE_PRIVATE_PATH');
      } else {
        // Check even inherit-only entries: a private directory must not create public sidecars.
        if(!trusted.has(ace.sid)&&ace.mask!==0)fail('STORE_PRIVATE_PATH');
        if(ace.sid===report.sid) {
          if(!(ace.flags&8))effective|=ace.mask;
          if((ace.flags&3)===3&&!(ace.flags&4))child|=ace.mask;
        }
      }
    }
    if(kind!=='ancestor'&&((effective&full)!==full||(kind==='private-directory'&&(child&full)!==full)))fail('STORE_PRIVATE_PATH');
  }
  if(seen.size!==expected.size)fail('STORE_PRIVATE_PATH');
  return true;
}

function nativeWindowsEvidence(path) {
  const root=process.env.SystemRoot;
  if(typeof root!=='string'||! /^[A-Za-z]:\\[^\x00-\x1f]*$/.test(root))fail('STORE_PATH_CHECK_UNAVAILABLE');
  let result;
  try {
    result=execFileSync(win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-File',probe,'-TargetPath',path],
      {encoding:'utf8',timeout:15000,maxBuffer:1024*1024,windowsHide:true});
  } catch {fail('STORE_PATH_CHECK_UNAVAILABLE');}
  try {return JSON.parse(result.replace(/^\uFEFF/,''));}catch{fail('STORE_PATH_CHECK_UNAVAILABLE');}
}

/** A supported SQLite path is outside the entire potentially static checkout. */
export function validateSQLitePath(path,{maxPhysicalBytes=512*1024*1024}={}) {
  if(typeof path!=='string'||!path||!isAbsolute(path)||path.includes('\0'))fail('STORE_PRIVATE_PATH');
  if(process.platform==='win32')validateWindowsPath(path,[checkoutRoot]);
  else if(within(resolve(path),resolve(checkoutRoot),{relative,isAbsolute,sep}))fail('STORE_IN_WEB_ROOT');
  const parent=dirname(path);
  for(let p=parent;;p=dirname(p)) {
    const info=lstatSync(p);
    if(!info.isDirectory()||info.isSymbolicLink())fail('STORE_PRIVATE_PATH');
    if(dirname(p)===p)break;
  }
  const actual=realpathSync(parent),intended=resolve(parent);
  if(process.platform==='win32'?actual.toLowerCase()!==intended.toLowerCase():actual!==intended)fail('STORE_PRIVATE_PATH');
  if(process.platform!=='win32') {
    const info=lstatSync(parent);
    if(typeof process.getuid!=='function'||info.uid!==process.getuid()||(info.mode&0o077)!==0)fail('STORE_PRIVATE_PATH');
  }
  let exists=false;
  for(const p of [path,...SQLITE_SIDECARS.map(s=>path+s)]) {
    let info;
    try {info=lstatSync(p);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>maxPhysicalBytes)fail('STORE_SIZE_OR_TYPE');
    if(process.platform!=='win32'&&(info.uid!==process.getuid()||(info.mode&0o077)!==0))fail('STORE_PRIVATE_PATH');
    if(p===path)exists=true;
    else if(!exists)fail('STORE_ORPHAN_SIDECAR');
  }
  if(process.platform==='win32')validateWindowsEvidence(nativeWindowsEvidence(path),path);
  return {path:resolve(path),exists};
}
