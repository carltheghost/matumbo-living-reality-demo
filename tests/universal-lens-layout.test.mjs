import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveUniversalLensLayout} from '../src/domains/universal-lens-layout.js';

const features=['contract-atelier','agent','arena','rooms','youtube','ledger','block-world']
  .map(id=>({id,label:id.replaceAll('-',' ')}));

test('the five XR lenses are feature objects in one shared spatial arrangement',()=>{
  const layout=resolveUniversalLensLayout(features,'?feature=arena');
  assert.equal(layout.active,true);
  assert.equal(layout.model,'one-universe-v1');
  assert.equal(layout.centerId,'arena');
  assert.deepEqual(layout.lenses.map(lens=>[lens.role,lens.id]),[
    ['left','contract-atelier'],['right','agent'],['center','arena'],
    ['lowerLeft','rooms'],['lowerRight','youtube'],
  ]);
  assert.equal(new Set(layout.lenses.map(lens=>lens.position.join(','))).size,5);
  assert.ok(layout.lenses.every(lens=>lens.shape==='sphere'));
  assert.ok(layout.lenses.every(lens=>lens.position[2]<0));
});

test('query-selected lenses are validated against real feature IDs and remain unique',()=>{
  const layout=resolveUniversalLensLayout(features,
    '?model=one-universe-v1&left=ledger&right=missing&center=arena&lowerLeft=rooms&lowerRight=youtube');
  assert.equal(layout.active,true);
  assert.equal(layout.lenses[0].id,'ledger');
  assert.notEqual(layout.lenses[1].id,'missing');
  assert.equal(new Set(layout.ids).size,5);
  assert.ok(!layout.ids.includes('block-world'));
});

test('ordinary feature pages keep their existing layout when the universe is not requested',()=>{
  assert.deepEqual(resolveUniversalLensLayout(features,'?feature=contracts'),{
    active:false,model:null,centerId:null,ids:[],lenses:[],
  });
});

test('the route stays inside the existing Three.js and WebXR input path without DOM lens frames',()=>{
  const assembly=readFileSync(new URL('../src/render/reality-assembly.js',import.meta.url),'utf8');
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../src/render/reality-assembly.css',import.meta.url),'utf8');
  const xr=readFileSync(new URL('../src/render/immersive-session.js',import.meta.url),'utf8');
  assert.match(main,/renderer\.setAnimationLoop\(animate\)/,'the app keeps its single shared render clock');
  assert.match(main,/worldGrid:grid/,'the assembly can suppress the page floor only while this XR scene is active');
  assert.match(main,/worldHorizonRings:blockWorldHorizonRings/,'the assembly receives the page horizon decoration for lifecycle-safe hiding');
  assert.match(assembly,/if\(worldGrid\)worldGrid\.visible=false;worldHorizonRings\.forEach/,'the five-lens scene hides unrelated floor and horizon geometry');
  assert.match(main,/realityAssembly\.isUniversalLensLayout/,'the boot route does not open a floating feature panel over the lens objects');
  assert.match(main,/if\(realityAssembly\?\.active\s*&&\s*realityAssembly\.selectObject\(object\)\)return/,'the existing XR raycaster sends controller hits to Reality Assembly');
  assert.match(xr,/controller\.addEventListener\("select", onSelect\)/,'an XR controller trigger reaches the existing raycast');
  assert.match(assembly,/selectObject\(object\)\{const id=spatial\.resolve\(object\);if\(!id\)return false;if\(activeUniversalLensScene\)return enter\(id\)/,'selecting a lens enters that feature rather than opening an HTML inspector');
  assert.match(css,/\.universe-lens-mode>\*\{display:none!important\}/,'the universal view renders no HTML panel frames');
});
