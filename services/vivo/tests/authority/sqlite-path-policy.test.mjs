import test from 'node:test';
import assert from 'node:assert/strict';
import {win32} from 'node:path';
import {spawnSync} from 'node:child_process';
import {nativeWindowsEvidence,validateWindowsEvidence,windowsPowerShellEnvironment} from '../../server/authority/sqlite-path-policy.mjs';

const root='C:\\Windows';
const path='C:\\Users\\Owner\\AppData\\Local\\Vivo\\checkpoint.sqlite';
const sid='S-1-5-21-1-2-3-1001';

function evidence() {
  const nodes=[];
  for(let p=win32.dirname(path);;p=win32.dirname(p)) {
    nodes.push({path:p,exists:true,attributes:16,owner:sid,daclPresent:true,aces:[{type:'allow',sid,mask:0x1f01ff,flags:3}]});
    if(win32.dirname(p)===p)break;
  }
  for(const suffix of ['','-wal','-shm','-journal'])nodes.push({path:path+suffix,exists:false});
  return {schema:'vivo.windows-path/1',path,sid,driveType:'Fixed',fileSystem:'NTFS',device:'\\Device\\HarddiskVolume3',nodes};
}

test('Windows helper strips polluted inherited PowerShell 7 module precedence',()=>{
  const inherited={SystemRoot:root,PSModulePath:'C:\\Program Files\\PowerShell\\Modules;C:\\codex\\powershell\\Modules',pSmOdUlEpAtH:'C:\\other\\modules',KEEP:'preserved'};
  const before=structuredClone(inherited);
  let seen;
  const report=nativeWindowsEvidence(path,{env:inherited,run:(executable,args,options)=>{
    seen={executable,args,options};
    return JSON.stringify({schema:'vivo.windows-path/1'});
  }});
  assert.deepEqual(report,{schema:'vivo.windows-path/1'});
  assert.equal(seen.options.env.SystemRoot,root);
  assert.equal(seen.options.env.KEEP,'preserved');
  assert.deepEqual(inherited,before);
  assert.deepEqual(Object.keys(seen.options.env).filter(key=>key.toLowerCase()==='psmodulepath'),['PSModulePath']);
  assert.equal(seen.options.env.PSModulePath,win32.join(root,'System32','WindowsPowerShell','v1.0','Modules'));
  assert.equal(seen.executable,win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe'));
});

test('unavailable Windows helper still fails closed',()=>{
  assert.throws(()=>nativeWindowsEvidence(path,{root,env:{SystemRoot:root},run:()=>{throw Error('module unavailable');}}),error=>error.code==='STORE_PATH_CHECK_UNAVAILABLE');
  assert.throws(()=>windowsPowerShellEnvironment('not-a-drive',{SystemRoot:root}),error=>error.code==='STORE_PATH_CHECK_UNAVAILABLE');
});

test('unsafe Windows evidence remains rejected',()=>{
  const report=evidence();
  report.nodes.find(node=>node.path===win32.dirname(path)).aces.push({type:'allow',sid:'S-1-1-0',mask:1,flags:0});
  assert.throws(()=>validateWindowsEvidence(report,path),error=>error.code==='STORE_PRIVATE_PATH');
});

test('malformed Windows evidence remains rejected',()=>{
  const report=evidence();
  report.nodes[0].aces[0].mask='full';
  assert.throws(()=>validateWindowsEvidence(report,path),error=>error.code==='STORE_PRIVATE_PATH');
});

test('native child passes private evidence from a polluted PowerShell environment',()=>{
  const moduleURL=new URL('../../server/authority/sqlite-path-policy.mjs',import.meta.url).href;
  const child=`import {nativeWindowsEvidence,validateWindowsEvidence} from ${JSON.stringify(moduleURL)};
    const expected=${JSON.stringify(evidence())};let seen;
    const report=nativeWindowsEvidence(expected.path,{root:${JSON.stringify(root)},env:process.env,run:(executable,args,options)=>{
      seen={executable,args,options};return JSON.stringify(expected);
    }});validateWindowsEvidence(report,expected.path);
    console.log(JSON.stringify({modulePath:seen.options.env.PSModulePath,variants:Object.keys(seen.options.env).filter(key=>key.toLowerCase()==='psmodulepath')}));`;
  const before=process.env.PSModulePath;
  const env={...process.env,PSModulePath:'C:\\Program Files\\PowerShell\\Modules;C:\\codex\\powershell\\Modules',pSmOdUlEpAtH:'C:\\other\\modules'};
  const result=spawnSync(process.execPath,['--input-type=module','-e',child],{env,encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  const output=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(output.modulePath,win32.join(root,'System32','WindowsPowerShell','v1.0','Modules'));
  assert.deepEqual(output.variants,['PSModulePath']);
  assert.equal(process.env.PSModulePath,before);
});
