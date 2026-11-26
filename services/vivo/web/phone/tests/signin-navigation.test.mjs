import test from 'node:test';
import assert from 'node:assert/strict';
import {mountIntelligence} from '../ai-accounts-panel.mjs';

// In-process UI handlers with a minimal DOM fixture, not browser acceptance.
class Element {
  constructor(tag,text=''){Object.assign(this,{tag,textContent:text,children:[],value:'',style:{},dataset:{},hidden:false});}
  append(...items){this.children.push(...items);}
  prepend(...items){this.children.unshift(...items);}
  replaceChildren(...items){this.children=items;}
  setAttribute(){} addEventListener(){} focus(){} scrollIntoView(){} remove(){}
  querySelector(){return null;}
}
function descendants(e){return [e,...e.children.flatMap(descendants)];}
function fixture(t,{response,resumeSignIn=false,worldEvents}={}){
  const original=globalThis.document;
  globalThis.document={createElement:tag=>new Element(tag),createTextNode:text=>new Element('#text',text)};
  t.after(()=>{globalThis.document=original;});
  const root=new Element('root'),calls=[],destinations=[];
  const request=async(path,options)=>{
    calls.push({path,options});
    const data=await (response?response(path,options):{authorizationUrl:'https://auth.openai.com/api/accounts/authorize?state=fixture'});
    return {ok:true,text:async()=>JSON.stringify(data)};
  };
  const component=mountIntelligence({root,request,navigate:url=>destinations.push(url),resumeSignIn,worldEvents});
  return {root,calls,destinations,component,
    button:text=>descendants(root).find(e=>e.tag==='button'&&e.textContent===text),
    provider:id=>descendants(root).find(e=>e.dataset.providerId===id),
    byId:id=>descendants(root).find(e=>e.id===id)};
}
test('only explicit ChatGPT sign-in navigates to validated provider; no mount or selection request',async t=>{
  const f=fixture(t);assert.equal(f.calls.length,0);
  f.provider('chatgpt-plan').onclick();assert.equal(f.calls.length,0);
  await f.button('Sign in with ChatGPT').onclick();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/vivo/accounts/login');
  assert.deepEqual(f.destinations,['https://auth.openai.com/api/accounts/authorize?state=fixture']);
  assert.match(f.byId('vivoAccountStatus').textContent,/No account is connected yet/);
});
test('invalid destination cannot navigate',async t=>{
  const f=fixture(t,{response:()=>({authorizationUrl:'https://attacker.invalid/login'})});
  f.provider('chatgpt-plan').onclick();await f.button('Sign in with ChatGPT').onclick();
  assert.equal(f.destinations.length,0);assert.match(f.byId('vivoAccountStatus').textContent,/Unexpected/);
});
for(const change of ['selection','dispose'])test(`late sign-in cannot navigate after ${change}`,async t=>{
  let resolve;
  const f=fixture(t,{response:()=>new Promise(r=>{resolve=r;})});
  f.provider('chatgpt-plan').onclick();const pending=f.button('Sign in with ChatGPT').onclick();
  if(change==='selection')f.provider('claude-native').onclick();else f.component.dispose();
  resolve({authorizationUrl:'https://auth.openai.com/api/accounts/authorize?state=fixture'});await pending;
  assert.equal(f.destinations.length,0);
});
test('return marker fetches host metadata only; never authorizes inference or invents an account',async t=>{
  const f=fixture(t,{resumeSignIn:true,response:()=>({connections:[],default:null})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/vivo/accounts');
  assert.equal(f.calls[0].options.method,'GET');assert.equal(f.destinations.length,0);
  assert.match(f.byId('vivoAccountStatus').textContent,/0 saved connection/);
});

function taskFixture(t,{inspect}={}){
  const priorHost=globalThis.VivaPhoneEngine,priorAdmin=globalThis.VivaPhoneAgentAdmin;
  let branch='main',added=0,removed=0;
  const worldEvents=new EventTarget();
  const add=worldEvents.addEventListener.bind(worldEvents),remove=worldEvents.removeEventListener.bind(worldEvents);
  worldEvents.addEventListener=(...args)=>{added++;return add(...args);};
  worldEvents.removeEventListener=(...args)=>{removed++;return remove(...args);};
  globalThis.VivaPhoneEngine={active:true,publishedSnapshot:()=>({branchId:branch,snapshot:{worldId:'world'}})};
  globalThis.VivaPhoneAgentAdmin={agents:()=>[],taskAccess:{inspect:inspect|| (async()=>({tasks:[],attachments:[]})),clear(){}}};
  t.after(()=>{globalThis.VivaPhoneEngine=priorHost;globalThis.VivaPhoneAgentAdmin=priorAdmin;});
  const f=fixture(t,{worldEvents});
  return {...f,change:next=>{branch=next;worldEvents.dispatchEvent(new Event('vivo:phone-statechange'));},
    hasText:text=>descendants(f.root).some(e=>e.textContent===text),counts:()=>({added,removed})};
}
test('task scope listeners mount and dispose with the supplied event target',async t=>{
  const f=taskFixture(t);assert.deepEqual(f.counts(),{added:2,removed:0});
  await f.button('Refresh saved tasks').onclick();assert(f.hasText('0 saved task(s) in this world/branch. Grants never resume automatically.'));
  f.change('fork');assert(f.hasText('World changed. Refresh to inspect the current world’s journal.'));
  f.component.dispose();assert.deepEqual(f.counts(),{added:2,removed:2});
});
test('a delayed task read cannot republish an obsolete result after a world round trip',async t=>{
  let resolve;const f=taskFixture(t,{inspect:()=>new Promise(r=>{resolve=r;})});
  const pending=f.button('Refresh saved tasks').onclick();
  f.change('fork');f.change('main');
  resolve({tasks:[{id:'stale',title:'Old task',sourceId:'muse',closed:false,steps:[]}],attachments:[]});await pending;
  assert(!f.hasText('Old task · muse'));assert(f.hasText('World changed. Refresh to inspect the current world’s journal.'));
  f.component.dispose();
});
test('a late task error cannot replace the status of the newly selected world',async t=>{
  let reject;const f=taskFixture(t,{inspect:()=>new Promise((_,r)=>{reject=r;})});
  const pending=f.button('Refresh saved tasks').onclick();f.change('fork');reject(Error('obsolete error'));await pending;
  assert(!f.hasText('obsolete error'));assert(f.hasText('World changed. Refresh to inspect the current world’s journal.'));
  f.component.dispose();
});
