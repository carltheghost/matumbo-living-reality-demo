import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SSF_VERSION,
  barycentricCoordinates,
  breedTraits,
  contactStrength,
  createSemanticRegions,
  createSemanticSkin,
  generatePlanarUv,
  interpolateUv,
  parseSemanticSkin,
  resolveRegionAtUv,
  scoreSurfaceRegion,
  semanticLod,
  serializeSemanticSkin,
  stableHash,
} from '../src/domains/surface-semantic-field.js';

test('deterministic region layouts cover supported object families', () => {
  for (const shape of ['sphere','cylinder','capsule','torus','cube','irregular','open','disconnected']) {
    const regions = createSemanticRegions({ shape, surfaceSlots: shape === 'cube' ? 6 : 1, content: [
      { id:'a', label:'A', priority:1 }, { id:'b', label:'B' }, { id:'c', label:'C' }
    ]});
    assert.equal(regions.length, 3, shape);
    for (const r of regions) {
      assert.ok(r.rect.x >= 0 && r.rect.y >= 0 && r.rect.x + r.rect.w <= 1.000001 && r.rect.y + r.rect.h <= 1.000001);
    }
  }
});

test('cube can assign meaning to different walls', () => {
  const regions = createSemanticRegions({ shape:'cube', surfaceSlots:6, content:Array.from({length:6},(_,i)=>({id:`f${i}`})) });
  assert.deepEqual(regions.map(r=>r.surfaceSlot), [0,1,2,3,4,5]);
});

test('uv hit resolves the owning semantic region', () => {
  const regions = createSemanticRegions({ shape:'irregular', authored:[
    { id:'left', rect:{x:0,y:0,w:.5,h:1}, priority:.4 },
    { id:'right', rect:{x:.5,y:0,w:.5,h:1}, priority:.8 },
  ]});
  assert.equal(resolveRegionAtUv(regions,{x:.2,y:.7})?.id,'left');
  assert.equal(resolveRegionAtUv(regions,{x:.8,y:.7})?.id,'right');
});

test('surface score prefers visible front-facing usable area', () => {
  const good = scoreSurfaceRegion({area:.9,curvature:.1,viewCosine:1,occlusion:0,distance:3,priority:.8});
  const bad = scoreSurfaceRegion({area:.2,curvature:.9,viewCosine:.05,occlusion:.8,distance:10,priority:.2});
  assert.ok(good > bad);
});

test('semantic LOD grows with projected size and focus', () => {
  assert.equal(semanticLod({projectedPixels:12}),0);
  assert.ok(semanticLod({projectedPixels:230}) >= 2);
  assert.ok(semanticLod({projectedPixels:120,focused:true}) >= semanticLod({projectedPixels:120,focused:false}));
});

test('barycentric address interpolates surface uv', () => {
  const b = barycentricCoordinates([.25,.25,0],[0,0,0],[1,0,0],[0,1,0]);
  const uv = interpolateUv(b,[0,0],[1,0],[0,1]);
  assert.ok(Math.abs(uv.x-.25)<1e-9 && Math.abs(uv.y-.25)<1e-9);
});

test('no-uv meshes receive deterministic planar fallback chart', () => {
  const {uv,projectionAxes,fallback} = generatePlanarUv(new Float32Array([
    -1,-1,0, 1,-1,0, 1,1,0, -1,1,0,
  ]));
  assert.equal(uv.length,8);
  assert.equal(fallback,'global-planar-chart');
  assert.equal(projectionAxes.length,2);
  for (const x of uv) assert.ok(x>=0 && x<=1);
});

test('contact field rises as object surfaces approach', () => {
  assert.equal(contactStrength({distance:5,radiusA:1,radiusB:1,range:1}),0);
  assert.equal(contactStrength({distance:2,radiusA:1,radiusB:1,range:1}),1);
  assert.ok(contactStrength({distance:2.5,radiusA:1,radiusB:1,range:1}) > .4);
});

test('trait breeding is deterministic and carries provenance', () => {
  const a={roughness:.2,family:'gold',tags:['ledger']};
  const b={roughness:.8,family:'cyan',tags:['person']};
  const first=breedTraits(a,b,{seed:'tumbo'}), second=breedTraits(a,b,{seed:'tumbo'});
  assert.deepEqual(first,second);
  assert.ok(first.traits.roughness>.2 && first.traits.roughness<.8);
  assert.deepEqual(first.traits.tags,['ledger','person']);
  assert.ok(first.provenance.roughness.length>=2);
});

test('semantic skin persists with explicit version', () => {
  const skin=createSemanticSkin({id:'sphere-1',shape:'sphere',content:[{id:'status',label:'STATUS',value:'READY'}],traits:{metalness:.3}});
  const parsed=parseSemanticSkin(serializeSemanticSkin(skin));
  assert.equal(parsed.version,SSF_VERSION);
  assert.equal(parsed.id,'sphere-1');
  assert.equal(parsed.regions[0].id,'status');
});

test('stable hash stays stable',()=>{
  assert.equal(stableHash('matumbo'),stableHash('matumbo'));
  assert.notEqual(stableHash('matumbo'),stableHash('matumb0'));
});
