import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createStrategyFace} from '../strategy-face.mjs';

// A deliberately small DOM unit fixture: no browser, no native authority, no backend claim.
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.style={};this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.isConnected=true;}
  set textContent(v){this.text=String(v);this.children=[];}
  get textContent(){return (this.text||'')+this.children.map(c=>c.textContent).join('');}
  append(...children){this.children.push(...children);}
  prepend(...children){this.children.unshift(...children);}
  replaceChildren(...children){for(const x of this.children)x.detach();this.children=children;}
  detach(){this.isConnected=false;for(const x of this.children)x.detach();}
  setAttribute(k,v){this.attrs[k]=v;}
  focus(){}
  querySelectorAll(selector){const match=e=>selector==='input:checked'?e.tag==='input'&&e.checked:selector==='[data-strategy-review]'?e.dataset.strategyReview!==undefined:false;return this.children.flatMap(c=>[...(match(c)?[c]:[]),...c.querySelectorAll(selector)]);}
  find(predicate){if(predicate(this))return this;for(const c of this.children){const n=c.find(predicate);if(n)return n;}return null;}
}
const doc={createElement:tag=>new Element(tag),defaultView:{crypto:globalThis.crypto}};
const button=(root,label)=>root.find(e=>e.tag==='button'&&e.textContent===label);
const editor=root=>root.find(e=>e.tag==='textarea');
const missions=[{id:'a',objective:'Inspect',world:'w',agent:'x',phase:'assigned',lease_epoch:0,lease_until:null,revision:1},{id:'b',objective:'Review',world:'w',agent:'y',phase:'assigned',lease_epoch:0,lease_until:null,revision:1}];
const agents=[{id:'x',label:'A',active:true},{id:'y',label:'B',active:true}];
const body={id:'b',tasks:missions.map(m=>({id:m.id,expected_revision:m.revision})),alternatives:[],availability:[],deadline_minutes:10,budget_units:3};
const graph={id:'b',nodes:[{id:'a',expected_revision:1,requires:[]},{id:'b',expected_revision:1,requires:['a']}]};
const response={schema:'matumbo.mission.strategy/1',root:'b',plan_sha256:'a'.repeat(64),decision:'unique_nondominated',recommended:'A',assumptions:[],plans:[{name:'A',status:'fits_all_scenarios',estimated_units:3,scenarios:Object.fromEntries(['optimistic','nominal','conservative'].map(k=>[k,{finish_minutes:2}])),organization_setup:graph}]};
function fixture(){const calls=[],messages=[];const face=createStrategyFace({doc,request:async(path,data)=>{calls.push({path,data});return path.endsWith('/compare')?response:{applied_revision:2};},refresh:async()=>{},report:m=>messages.push(m)});face.render({world:'w',agents,missions});return {face,calls,messages};}

test('strategy preview and inline review do not configure a graph until explicit confirmation',async()=>{const {face,calls}=fixture();editor(face.element).value=JSON.stringify(body);await button(face.element,'Compare strategy with Station').onclick();assert.equal(calls.length,1);button(face.element,'Review A').onclick();assert.equal(calls.length,1);await button(face.element,'Configure reviewed graph').onclick();assert.equal(calls.length,2);assert.equal(calls[1].path,'/v1/owner/continuity/organization/set');assert.deepEqual(calls[1].data.nodes,graph.nodes);assert.equal(calls[1].data.id,'b');assert.ok(calls[1].data.request_id);});
test('editing or disconnecting invalidates a staged strategy without a write',async()=>{const {face,calls}=fixture();editor(face.element).value=JSON.stringify(body);await button(face.element,'Compare strategy with Station').onclick();button(face.element,'Review A').onclick();const stale=button(face.element,'Configure reviewed graph');editor(face.element).value+=' ';editor(face.element).oninput();await stale.onclick();assert.equal(calls.length,1);await button(face.element,'Compare strategy with Station').onclick();button(face.element,'Review A').onclick();const stale2=button(face.element,'Configure reviewed graph');face.clear();await stale2.onclick();assert.equal(calls.length,2);});
test('runtime files retain the exact verified v0.12 source hashes',()=>{const root=new URL('../../../agent-station/',import.meta.url);const manifest=JSON.parse(readFileSync(new URL('RUNTIME-HASHES.json',root),'utf8'));for(const [name,sha] of Object.entries(manifest.runtime_sha256))assert.equal(createHash('sha256').update(readFileSync(new URL(name,root))).digest('hex'),sha,name);});
