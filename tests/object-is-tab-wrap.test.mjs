import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {REALITY_TAB_FORMS} from '../src/domains/reality-tab-layout.js';
import {createLivingSurfaceMap,livingSurfaceClipPath} from '../src/domains/living-surface-layout-engine.js';

test('the readable planar surface is the object front, not an inset rectangle',()=>{
  for(const shape of ['phone','square','rectangle','wave']){
    const map=createLivingSurfaceMap(shape),form=REALITY_TAB_FORMS[shape];
    assert.equal(map.primary.width,form.width,`${shape} owns its full front width`);
    const expectedHeight=shape==='wave'?Number((form.height*1.15).toFixed(4)):form.height;
    assert.equal(map.primary.height,expectedHeight,`${shape} owns its full front silhouette`);
  }
});

test('every living-object form supplies a real clipping silhouette',()=>{
  for(const shape of Object.keys(REALITY_TAB_FORMS)){
    const clip=livingSurfaceClipPath(shape);
    assert.equal(typeof clip,'string');
    assert.ok(clip.length>8,`${shape} has a usable silhouette`);
    assert.notEqual(clip,'none');
  }
  const wave=livingSurfaceClipPath('wave');
  assert.match(wave,/^polygon\(/);
  assert.ok((wave.match(/%/g)||[]).length>60,'wave contour follows many points instead of a rounded rectangle');
  assert.equal(wave,livingSurfaceClipPath('wave'),'wave contour is deterministic');
});

test('Reality Lens renderer has no detached spatial-tab image card',async()=>{
  const scene=await readFile(new URL('../src/render/reality-assembly-scene.js',import.meta.url),'utf8');
  assert.doesNotMatch(scene,/spatial-tab\/image/);
  assert.doesNotMatch(scene,/new THREE\.PlaneGeometry\(width\*\.9,height\*\.88\)/);
  assert.match(scene,/!curved&&artMaterial\?\[artMaterial,shell\]:shell/,'planar artwork is assigned to the body cap');
});

test('live feature controls inherit the owning body silhouette',async()=>{
  const [assembly,css]=await Promise.all([
    readFile(new URL('../src/render/reality-assembly.js',import.meta.url),'utf8'),
    readFile(new URL('../src/render/reality-assembly.css',import.meta.url),'utf8'),
  ]);
  assert.match(assembly,/--lens-surface-clip/);
  assert.match(assembly,/realityObjectSurfaceEngine\.clipPath\(shape\)/);
  assert.match(css,/clip-path:var\(--lens-surface-clip/);
});


test('attached controls are only an interaction skin; the Three.js body stays the visible tab',async()=>{
  const [scene,css,assembly]=await Promise.all([
    readFile(new URL('../src/render/reality-assembly-scene.js',import.meta.url),'utf8'),
    readFile(new URL('../src/render/reality-assembly.css',import.meta.url),'utf8'),
    readFile(new URL('../src/render/reality-assembly.js',import.meta.url),'utf8'),
  ]);
  assert.match(scene,/Native object-tab contract/);
  assert.match(scene,/node\.artworkSuppressed!==reading/);
  assert.match(scene,/node\.artMaterial\.map=reading\?null:node\.artTexture/);
  assert.match(css,/Native object-tab contract/);
  assert.match(css,/background:transparent!important/);
  assert.match(css,/border:0!important/);
  assert.match(css,/box-shadow:none!important/);
  assert.match(assembly,/function activateObjectTab\(id\)/);
  assert.match(assembly,/owner\.setOpen\(id,true\)/);
  assert.match(assembly,/activateObjectTab\(previous\.objectId\)/);
});
