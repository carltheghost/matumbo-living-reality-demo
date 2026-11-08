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
function fixture(t,{response,resumeSignIn=false}={}){
  const original=globalThis.document;
  globalThis.document={createElement:tag=>new Element(tag),createTextNode:text=>new Element('#text',text)};
  t.after(()=>{globalThis.document=original;});
  const root=new Element('root'),calls=[],destinations=[];
  const request=async(path,options)=>{
    calls.push({path,options});
    const data=await (response?response(path,options):{authorizationUrl:'https://auth.openai.com/api/accounts/authorize?state=fixture'});
    return {ok:true,text:async()=>JSON.stringify(data)};
  };
  const component=mountIntelligence({root,request,navigate:url=>destinations.push(url),resumeSignIn});
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
