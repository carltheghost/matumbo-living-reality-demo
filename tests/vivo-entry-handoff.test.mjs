import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const boot=await readFile(new URL('../src/vivo-phone-engine/boot.mjs',import.meta.url),'utf8');
const sw=await readFile(new URL('../vivo-phone-sw.js',import.meta.url),'utf8');

// Execute the actual boot source with only its engine/DOM/host APIs replaced.
// This is a component harness, not a browser or live-deployment assertion.
class Element {
  constructor(tag){this.tagName=tag;this.id='';this.children=[];this.attributes={};this.listeners={};this.textContent='';}
  append(...nodes){this.children.push(...nodes);}
  prepend(node){this.children.unshift(node);}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(name,fn){this.listeners[name]=fn;}
  querySelector(selector){const key=selector.slice(1);return this.find(key);}
  find(id){if(this.id===id)return this;for(const c of this.children){const v=c.find(id);if(v)return v;}return null;}
  set innerHTML(html){this.html=html;for(const [,tag,id]of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)){const c=new Element(tag);c.id=id;this.append(c);}}
}
async function fixture({base='https://example.test/repository/',page='field-lab-studio.html',startFails=false,xrFails=false}={}){
  const body=new Element('body'),head=new Element('head'),main=new Element('main');body.append(main);
  const saved=new Element('button');saved.id='saved';saved.textContent='Open saved Field Lab with Viva 0.7';
  const choose=new Element('button');choose.id='choose';choose.textContent='Choose original Field Lab 0.4 file';
  const file=new Element('input');file.id='file';file.value='unchanged';main.append(saved,choose,file);
  const calls={starts:0,registrations:0,checkpoints:0,closed:0};
  const doc={body,head,hidden:false,events:{},getElementById:id=>body.find(id)||head.find(id),
    createElement:tag=>new Element(tag),querySelector:s=>s==='main'?main:doc.getElementById(s.slice(1)),
    addEventListener:(n,f)=>{doc.events[n]=f;}};
  class Engine {
    constructor(options){this.options=options;this.native={available:()=>false};this.xr={capabilities:()=>({sessionActive:false})};}
    addEventListener(){}
    async xrCapabilities(){if(xrFails)throw Error('XR unavailable');return {apiAvailable:false,supported:{}};}
    async start(){calls.starts++;if(startFails)throw Error('engine unavailable');return {webgpu:false};}
    async checkpoint(){calls.checkpoints++;}
    close(){calls.closed++;}
  }
  const loc=Object.freeze({href:new URL(page,base).href});
  const context=vm.createContext({URL,Promise,document:doc,location:loc,VivoPhoneEngine:Engine,
    navigator:{serviceWorker:{register:async()=>{calls.registrations++;}}},isSecureContext:true,
    __moduleURL:new URL('src/vivo-phone-engine/boot.mjs',base).href,addEventListener:()=>{}});
  vm.runInContext(boot.replace("import{VivoPhoneEngine}from'./engine.mjs';",'').replaceAll('import.meta.url','__moduleURL'),context);
  await new Promise(setImmediate);
  return {doc,main,context,calls,saved,choose,file,base,loc};
}
for(const base of ['https://example.test/','https://example.test/matumbo-living-reality-demo/','http://localhost:8080/nested/project/']){
  test(`current entry preserves deployed prefix: ${base}`,async()=>{
    const f=await fixture({base}),link=f.doc.getElementById('vivoCurrentFieldLabLink');
    assert.ok(link);assert.equal(link.tagName,'a');
    assert.equal(link.href,new URL('services/vivo/web/phone/field-lab.html',base).href);
    assert.equal(link.textContent,'Open current Vivo Field Lab');
  });
}
test('handoff is before the old engine panel and file picker',async()=>{
  const f=await fixture();assert.equal(f.main.children[0].id,'vivoCurrentFieldLab');
  assert.equal(f.main.children[1].id,'vivoPhoneEnginePanel');
  assert.ok(f.main.children.indexOf(f.saved)>1);
});
test('saved application and original picker remain the same DOM objects',async()=>{
  const f=await fixture();assert.equal(f.doc.getElementById('saved'),f.saved);
  assert.equal(f.doc.getElementById('choose'),f.choose);assert.equal(f.file.value,'unchanged');
});
test('navigation never redirects, opens another world, or creates another engine',async()=>{
  const f=await fixture();assert.equal(f.loc.href,new URL('field-lab-studio.html',f.base).href);
  assert.equal(f.calls.starts,1);assert.equal(f.calls.registrations,1);assert.equal(f.calls.checkpoints,0);
  assert.equal(f.context.VivoPhoneEngine.options.worldId,'field-lab-studio.phone');
});
test('newer entry is not gated on saved-file or camera detection',async()=>{
  const f=await fixture();const link=f.doc.getElementById('vivoCurrentFieldLabLink');
  assert.equal(link.disabled,undefined);assert.equal(link.onclick,undefined);
  assert.match(f.doc.getElementById('vivoCurrentFieldLabNote').textContent,/No original HTML download/);
});
test('new entry remains usable after existing engine startup rejects',async()=>{
  const f=await fixture({startFails:true});assert.ok(f.doc.getElementById('vivoCurrentFieldLabLink'));
  assert.match(f.doc.getElementById('vivoPhoneEngineState').textContent,/start failed/);
});
test('new entry remains usable after XR capability check rejects',async()=>{
  const f=await fixture({xrFails:true});assert.ok(f.doc.getElementById('vivoCurrentFieldLabLink'));
  assert.match(f.doc.getElementById('vivoXRState').textContent,/check failed/);
});
test('handoff is idempotent, including its scoped style',async()=>{
  const f=await fixture();f.context.installFieldLabHandoff(f.main);f.context.installFieldLabHandoff(f.main);
  assert.equal(f.main.children.filter(n=>n.id==='vivoCurrentFieldLab').length,1);
  assert.equal(f.doc.head.children.filter(n=>n.id==='vivoCurrentFieldLabStyle').length,1);
});
test('existing root route is not redesigned',async()=>{
  const f=await fixture({page:'index.html'});assert.equal(f.doc.getElementById('vivoCurrentFieldLab'),null);
});
test('current phone entry is not decorated as a legacy app',async()=>{
  const f=await fixture({page:'services/vivo/web/phone/field-lab.html'});assert.equal(f.doc.getElementById('vivoCurrentFieldLab'),null);
});
test('query parameters and fragments cannot change the destination',async()=>{
  const f=await fixture({page:'field-lab-studio.html?next=https://evil.invalid/#return'});
  assert.equal(f.doc.getElementById('vivoCurrentFieldLabLink').href,new URL('services/vivo/web/phone/field-lab.html',f.base).href);
});
test('a cross-origin module embedding does not install the handoff',async()=>{
  const f=await fixture({page:'https://another.test/repository/field-lab-studio.html'});
  assert.equal(f.doc.getElementById('vivoCurrentFieldLab'),null);
});
test('accessible section and ordinary keyboard link carry the migration warning',async()=>{
  const f=await fixture(),section=f.doc.getElementById('vivoCurrentFieldLab'),link=f.doc.getElementById('vivoCurrentFieldLabLink');
  assert.equal(section.attributes['aria-labelledby'],'vivoCurrentFieldLabTitle');
  assert.equal(link.attributes['aria-describedby'],'vivoCurrentFieldLabNote');
  assert.match(section.children.at(-1).textContent,/not automatically migrated/);
  assert.match(f.doc.getElementById('vivoCurrentFieldLabStyle').textContent,/:focus-visible/);
});
test('new text does not promise account activation or backend integration',async()=>{
  const f=await fixture(),section=f.doc.getElementById('vivoCurrentFieldLab');
  assert.doesNotMatch(section.children.map(n=>n.textContent).join(' '),/accounts connected|agents online|subscription active/i);
});
function worker(){
  const handlers={},calls={opened:[],removed:[],added:[],claim:0,skip:0};
  const current='vivo-phone-engine-v2';
  const cache={addAll:async paths=>{calls.added.push(...paths);}};
  vm.runInNewContext(sw,{URL,location:{origin:'https://example.test'},
    self:{addEventListener:(type,fn)=>{handlers[type]=fn;},skipWaiting:()=>{calls.skip++;},clients:{claim:()=>{calls.claim++;}}},
    caches:{open:async name=>{calls.opened.push(name);return cache;},keys:async()=>['vivo-phone-engine-v1',current,'vivo-world-cache','vivo-phone-v24'],delete:async name=>{calls.removed.push(name);}},
  });
  return {handlers,calls};
}
test('cache revision installs updated boot while retaining legacy cached assets',async()=>{
  const f=worker();let done;f.handlers.install({waitUntil:p=>{done=p;}});await done;
  assert.deepEqual(f.calls.opened,['vivo-phone-engine-v2']);
  assert.ok(f.calls.added.includes('./src/vivo-phone-engine/boot.mjs'));
  assert.ok(f.calls.added.includes('./field-lab-studio.html'));assert.equal(f.calls.skip,1);
});
test('cache activation removes only old legacy-engine caches',async()=>{
  const f=worker();let done;f.handlers.activate({waitUntil:p=>{done=p;}});await done;
  assert.deepEqual(f.calls.removed,['vivo-phone-engine-v1']);assert.equal(f.calls.claim,1);
});
test('neither migration data nor provider credentials are touched by the cache bump',()=>{
  assert.doesNotMatch(sw,/indexedDB|localStorage|sessionStorage|credentials|deleteDatabase/);
  assert.match(sw,/vivo-phone-engine-v2/);
});
