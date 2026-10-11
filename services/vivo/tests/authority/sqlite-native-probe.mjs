/** Synthetic native gate. Usage: node sqlite-native-probe.mjs --native --directory ABSOLUTE_PRIVATE_EXISTING_DIR
 * --synthetic permits non-Windows execution and labels it accordingly. Does not
 * repair ACLs, read real worlds, install software, or use any network endpoint.
 */
import {SQLiteAuthorityStore} from '../../server/authority/sqlite-store.mjs';
import {validateSQLitePath} from '../../server/authority/sqlite-path-policy.mjs';
import {LocalLeaseWorld} from '../../web/authority/lease-authority.mjs';
import {workshopSeed} from '../../server/application/seed.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const run=promisify(execFile),say=v=>process.stdout.write(JSON.stringify(v)+'\n');
let stage='arguments',folder,store;
const report={schema:'vivo.sqlite-native-probe/1',platform:process.platform,arch:process.arch,node:process.versions.node,
  evidence:process.platform==='win32'?'native-Windows synthetic':'non-Windows synthetic',passed:false};
try {
  const args=process.argv.slice(2);
  if(args.length!==3||!['--native','--synthetic'].includes(args[0])||args[1]!=='--directory'||!isAbsolute(args[2]))throw Object.assign(Error(),{code:'PROBE_ARGUMENTS'});
  if(args[0]==='--native'&&process.platform!=='win32')throw Object.assign(Error(),{code:'PROBE_REQUIRES_WINDOWS'});
  stage='existing-directory-privacy';
  validateSQLitePath(join(args[2],'vivo-probe-check-'+randomUUID()+'.sqlite'));
  // Creation is confined to the authorized directory after its privacy check.
  folder=await mkdtemp(join(args[2],'vivo-sqlite-native-'));
  const path=join(folder,'probe.sqlite');stage='settings-and-exact-reopen';
  store=await SQLiteAuthorityStore.open({path});const world=await LocalLeaseWorld.create({snapshot:workshopSeed(),store});
  const saved=JSON.stringify(world.checkpoint());report.settings=store.diagnostics;
  await store.close();store=null;
  const db=new DatabaseSync(path,{readOnly:true,allowExtension:false,defensive:true});
  try {
    report.integrity=db.prepare('PRAGMA quick_check').get().quick_check;
    report.compileOptions=db.prepare('PRAGMA compile_options').all().map(v=>v.compile_options);
  } finally{db.close();}
  store=await SQLiteAuthorityStore.open({path});report.exactReopen=JSON.stringify(await store.load())===saved;
  if(report.integrity!=='ok'||!report.exactReopen)throw Object.assign(Error(),{code:'PROBE_ROUNDTRIP'});
  await store.close();store=null;say({stage,passed:true,platform:report.platform,settings:report.settings});
  stage='synthetic-store-subprocess-suite';
  const suite=fileURLToPath(new URL('./sqlite-store.test.mjs',import.meta.url));
  const cwd=fileURLToPath(new URL('../../../../',import.meta.url));
  const result=await run(process.execPath,['--test','--test-reporter=tap',suite],
    {cwd,env:{...process.env,VIVO_SQLITE_TEST_ROOT:folder},timeout:240000,maxBuffer:4*1024*1024,windowsHide:true});
  report.tests={total:Number(result.stdout.match(/^# tests (\d+)$/m)?.[1]),
    passed:Number(result.stdout.match(/^# pass (\d+)$/m)?.[1]),failed:Number(result.stdout.match(/^# fail (\d+)$/m)?.[1]),
    skipped:Number(result.stdout.match(/^# skipped (\d+)$/m)?.[1])};
  if(!(report.tests.total>=20)||report.tests.total!==report.tests.passed||report.tests.failed!==0||report.tests.skipped!==0)
    throw Object.assign(Error(),{code:'PROBE_TEST_REPORT'});
  stage='cleanup';await rm(folder,{recursive:true,force:true});folder=null;report.cleanedSyntheticFiles=true;report.passed=true;
} catch(e) {
  report.passed=false;
  report.blocker={stage,code:typeof e?.code==='string'?e.code:'PROBE_FAILED'};
  if(e?.stdout) {
    // Only numbered test titles/codes, never stack traces, private paths or payloads.
    report.failedTests=String(e.stdout).split('\n').filter(line=>/^not ok \d+ - /.test(line));
  }
  process.exitCode=1;
} finally {
  if(store)try{await store.close();}catch{report.closeFailed=true;report.passed=false;process.exitCode=1;}
  // Preserve failed synthetic files for authorized inspection rather than automatic repair.
  if(folder)report.syntheticFilesRetained=true;
  say(report);
}
