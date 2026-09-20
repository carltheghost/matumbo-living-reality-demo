import test from 'node:test';import assert from 'node:assert/strict';
import {CITY_DISTRICTS,resolveCityRoute} from '../src/render/city-journey.js';
import {FEATURE_DEFINITIONS} from '../src/render/feature-navigator.js';
test('City maps seven districts exclusively to existing canonical features',()=>{assert.equal(CITY_DISTRICTS.length,7);for(const district of CITY_DISTRICTS){assert.ok(FEATURE_DEFINITIONS.some(feature=>feature.id===district.feature));assert.equal(resolveCityRoute(`?city=${district.id}&feature=${district.feature}`).district,district);}});
test('City rejects malformed, duplicate, unknown and mixed-authority routes',()=>{for(const query of ['city=unknown&feature=rooms','city=%ZZ&feature=rooms','city=rooms&feature=contracts','city=rooms&city=rooms&feature=rooms','city=rooms&feature=rooms&feature=rooms','city=rooms','city=rooms&feature=rooms&live=all','city=rooms&feature=rooms&draft=x'])assert.equal(resolveCityRoute(query).status,'rejected');assert.equal(resolveCityRoute('?feature=rooms').status,'absent');});
import {mountCityJourney} from '../src/render/city-journey.js';
function makeHarness(href){
  const created=[];
  function makeEl(){
    const el={children:[],dataset:{},style:{},textContent:'',open:false,onclick:null,
      setAttribute(){},append(...nodes){this.children.push(...nodes);return this;}};
    created.push(el);return el;
  }
  const calls={pushState:[],replaceState:[]};
  const doc={created,createElement:()=>makeEl(),body:{append(){}}};
  const win={location:new URL(href),
    history:{pushState:(...args)=>calls.pushState.push(String(args[2])),
             replaceState:(...args)=>calls.replaceState.push(String(args[2]))},
    addEventListener(){},removeEventListener(){}};
  return {doc,win,calls};
}
test('legacy city URLs resolve but are rewritten to clean ?feature= form',()=>{
  const {doc,win,calls}=makeHarness('http://localhost/?city=t402&feature=t402');
  const seen=[];
  mountCityJourney({navigate:(id)=>seen.push(id),documentRoot:doc,windowRoot:win});
  assert.deepEqual(seen,['t402']);
  assert.equal(calls.pushState.length,0);
  assert.equal(calls.replaceState.length,1);
  const url=new URL(calls.replaceState[0]);
  assert.equal(url.searchParams.get('feature'),'t402');
  assert.ok(!url.searchParams.has('city'),`city param must be gone, got ${url.search}`);
});
test('district buttons navigate through the feature channel with no city URL',()=>{
  const {doc,win,calls}=makeHarness('http://localhost/?feature=person');
  const seen=[];
  mountCityJourney({navigate:(id,method)=>seen.push([id,method]),documentRoot:doc,windowRoot:win});
  const t402Button=doc.created.find((el)=>el.dataset.district==='t402');
  assert.ok(t402Button,'t402 district button exists');
  t402Button.onclick();
  assert.deepEqual(seen,[['t402','button']]);
  assert.equal(calls.pushState.length,0,'district click must not pushState a legacy city URL');
  assert.equal(calls.replaceState.length,0);
});
test('plain ?feature= URLs are left untouched',()=>{
  const {doc,win,calls}=makeHarness('http://localhost/?feature=person');
  const seen=[];
  mountCityJourney({navigate:(id)=>seen.push(id),documentRoot:doc,windowRoot:win});
  assert.deepEqual(seen,[]);
  assert.equal(calls.pushState.length,0);
  assert.equal(calls.replaceState.length,0);
});
