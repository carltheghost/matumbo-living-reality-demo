import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGitHubReview,createGitHubAgentBridge} from '../github-agent.mjs';
const head='a'.repeat(40),repository='owner/repo',spec={repository,pullNumber:12,filePath:'src/main.py'};
const snapshot={schema:'vivo.github-pull-review/1',repository,pullNumber:12,headSha:head,sameRepositoryHead:true,title:'Review',workflows:[],readOnly:true,authorizesAction:false};
const file={schema:'vivo.github-file/1',repository,pullNumber:12,headSha:head,path:spec.filePath,content:'print(1)',size:8,blobSha:'b'.repeat(40),readOnly:true,authorizesAction:false};
function fixture(){
 let scope={worldId:'world',projectId:'branch'},delayed=null,responseOverride=null;
 const sessions=new Map([['a',{sessionId:'a',sourceId:'github',generation:1}],['b',{sessionId:'b',sourceId:'muse',generation:1}]]),calls=[];
 const registry={agentController:{assertActive(ref){const a=sessions.get(typeof ref==='string'?ref:ref?.sessionId);if(!a||typeof ref==='object'&&ref.generation!==a.generation)throw Error('inactive');return a;}}};
 const downstream={listFor:()=>[{name:'task.progress'}],invokeFor:async()=>({native:true})};
 const request=async(url,options)=>{calls.push({url,body:JSON.parse(options.body),options});if(delayed)await delayed;const value=responseOverride|| (url.endsWith('/file')?file:snapshot);return {ok:true,text:async()=>JSON.stringify(value)};};
 const bridge=createGitHubAgentBridge({registry,downstream,getScope:()=>scope,request});
 return {bridge,sessions,calls,scope:s=>{scope=s;bridge.syncScope();},override:x=>responseOverride=x,hold:()=>{let release;delayed=new Promise(r=>release=r);return release;}};
}
test('mount is offline, native tools are unchanged, and exact explicit review is required',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);assert.deepEqual(f.bridge.tools.listFor('a'),[{name:'task.progress'}]);
 await assert.rejects(f.bridge.tools.invokeFor('a','github.pull.read'),{code:'GITHUB_AGENT_NOT_GRANTED'});
 const v=await f.bridge.admin.preview(spec);assert.equal(v.reviewed.headSha,head);assert.equal(f.calls.length,1);
 f.bridge.admin.grant('a',v.token);assert.equal(f.calls.length,1);
 assert.deepEqual(f.bridge.tools.listFor('a').map(x=>x.name),['task.progress','github.pull.read','github.file.read']);
 assert.deepEqual(f.bridge.tools.listFor('b').map(x=>x.name),['task.progress']);
 assert.deepEqual(await f.bridge.tools.invokeFor('a','task.progress'),{native:true});
});
test('owner-reviewed exact SHA, file and identity are pinned and caller overrides rejected',async()=>{
 const f=fixture(),v=await f.bridge.admin.preview(spec);v.reviewed.filePath='private.txt';f.bridge.admin.grant('a',v.token);
 const r=await f.bridge.tools.invokeFor('a','github.file.read');assert.equal(r.content,'print(1)');
 assert.deepEqual(f.calls[1].body,{repository,pullNumber:12,expectedHeadSha:head,path:'src/main.py'});
 assert.equal(f.calls[1].options.redirect,'error');
 await assert.rejects(f.bridge.tools.invokeFor('a','github.file.read',{path:'private.txt'}),{code:'GITHUB_ARGUMENTS_INVALID'});
 assert.throws(()=>f.bridge.admin.grant('b',v.token),{code:'GITHUB_REVIEW_STALE'});
});
test('review without file grants only PR inspection and fork files are denied',async()=>{
 const f=fixture(),v=await f.bridge.admin.preview({repository,pullNumber:12});f.bridge.admin.grant('a',v.token);
 await assert.rejects(f.bridge.tools.invokeFor('a','github.file.read'),{code:'GITHUB_FILE_NOT_GRANTED'});
 f.override({...snapshot,sameRepositoryHead:false});await assert.rejects(f.bridge.admin.preview(spec),{code:'GITHUB_FORK_FILE_UNAVAILABLE'});
});
test('revocation during a read fences the returned content',async()=>{
 const f=fixture(),v=await f.bridge.admin.preview(spec);f.bridge.admin.grant('a',v.token);
 const release=f.hold(),pending=f.bridge.tools.invokeFor('a','github.file.read');f.bridge.admin.revoke('a');release();
 await assert.rejects(pending,{code:'GITHUB_GRANT_STALE'});
});
test('scope round trips, generation replacement and changed head do not preserve access',async()=>{
 const f=fixture(),v=await f.bridge.admin.preview(spec);f.bridge.admin.grant('a',v.token);
 f.scope({worldId:'other',projectId:'branch'});f.scope({worldId:'world',projectId:'branch'});
 await assert.rejects(f.bridge.tools.invokeFor('a','github.pull.read'),{code:'GITHUB_AGENT_NOT_GRANTED'});
 const next=await f.bridge.admin.preview(spec);f.bridge.admin.grant('a',next.token);
 f.sessions.get('a').generation=2;assert(!f.bridge.tools.listFor('a').some(t=>t.name.startsWith('github.')));
 const fresh=await f.bridge.admin.preview(spec);f.bridge.admin.grant('a',fresh.token);
 f.override({...snapshot,headSha:'c'.repeat(40)});
 await assert.rejects(f.bridge.tools.invokeFor('a','github.pull.read'),{code:'GITHUB_RESPONSE_IDENTITY_MISMATCH'});
});
test('superseded preview and path/repository traversal reject without authority',async()=>{
 const f=fixture(),v=await f.bridge.admin.preview(spec),w=await f.bridge.admin.preview(spec);
 assert.throws(()=>f.bridge.admin.grant('a',v.token),{code:'GITHUB_REVIEW_STALE'});
 f.bridge.admin.discard(w.token);assert.throws(()=>f.bridge.admin.grant('a',w.token),{code:'GITHUB_REVIEW_STALE'});
 for(const input of [{...spec,repository:'https://github.com/owner/repo'},{...spec,filePath:'../secret'},{...spec,filePath:'/secret'},{...spec,pullNumber:0},{...spec,sha:head}])assert.throws(()=>normalizeGitHubReview(input));
});
