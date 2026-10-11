import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {materialDigest,verifyMaterialDigest} from '../codec.mjs';

test('numeric codec matches Python golden fixtures including exponents and negative zero', () => {
  const source = `import json\nfrom services.vivo_material.driver import digest\nv={'zero':-0.0,'tiny':1e-9,'large':1000000000.0,'a':[1,1.0,True,None],'unicode':'é→😀','numericKeys':{'2':'two','10':'ten'}}\nprint(json.dumps({'value':v,'digest':digest(v)}))`;
  const fixture=JSON.parse(execFileSync('python',['-c',source],{encoding:'utf8'}));
  assert.equal(materialDigest(fixture.value),fixture.digest);
  assert.equal(materialDigest({a:1,b:2}),materialDigest({b:2,a:1}));
  assert.equal(materialDigest([-0]),materialDigest([0]));
  assert.throws(()=>materialDigest([NaN]),/HASH_NUMBER/);
});

test('real initial and stepped checkpoints verify after Node persistence and Python restore', () => {
  const source = `import json\nfrom services.vivo_material import PhaseMaterialDriver\nfrom services.vivo_material.tests.test_material import space,grip,tick\ns=space();d=PhaseMaterialDriver.initialize(s);tick(d,s,[grip()]);print(json.dumps(d.checkpoint()))`;
  const checkpoint=JSON.parse(execFileSync('python',['-c',source],{encoding:'utf8',maxBuffer:4*1024*1024}));
  assert.equal(verifyMaterialDigest(checkpoint),true);
  const restore=`import json,sys\nfrom services.vivo_material import PhaseMaterialDriver\nv=json.load(sys.stdin);d=PhaseMaterialDriver(v);print(d.checkpoint()['digest'])`;
  assert.equal(execFileSync('python',['-c',restore],{input:JSON.stringify(checkpoint),encoding:'utf8'}).trim(),checkpoint.digest);
  checkpoint.fields['entity.0'].q[3]+=1;
  assert.throws(()=>verifyMaterialDigest(checkpoint),/MATERIAL_DIGEST/);
});


test('codec has unambiguous type tags and bounded common inputs', () => {
  assert.notEqual(materialDigest(1),materialDigest({$f64:'000000000000f03f'}));
  assert.throws(()=>materialDigest({'\u{10000}':1,'\ue000':2}),/HASH_KEY/);
  assert.throws(()=>materialDigest(1e16),/HASH_NUMBER/);
  const cyclic=[];cyclic.push(cyclic);
  assert.throws(()=>materialDigest(cyclic),/HASH_CYCLE/);
  let nested=1;for(let i=0;i<34;i++)nested=[nested];
  assert.throws(()=>materialDigest(nested),/HASH_BUDGET/);
  assert.throws(()=>materialDigest(new Array(10001)),/HASH_BUDGET/);
  assert.throws(()=>materialDigest(new Array(2)),/HASH_TYPE/);
});
