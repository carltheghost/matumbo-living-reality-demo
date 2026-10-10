import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('same-origin vision runtime and model bytes match the checked-in provenance',async()=>{
  const root=new URL('../',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('assets/models/vision/provenance.json',root),'utf8'));
  const required=['vision_bundle.mjs','wasm/vision_wasm_internal.js','wasm/vision_wasm_internal.wasm',
    'wasm/vision_wasm_nosimd_internal.js','wasm/vision_wasm_nosimd_internal.wasm','LICENSE']
    .map(path=>`vendor/mediapipe-tasks-vision-1.0.1/${path}`)
    .concat(['assets/models/vision/hand_landmarker.task','assets/models/vision/face_landmarker.task']);
  const paths=new Set(manifest.files.map(file=>file.path));
  assert.equal(paths.size,manifest.files.length,'every recorded asset has a unique path');
  for(const path of required)assert.ok(paths.has(path),`missing deployment asset: ${path}`);
  for(const file of manifest.files){
    assert.match(file.path,/^(vendor\/mediapipe-tasks-vision-1\.0\.1\/|assets\/models\/vision\/)/);
    assert.ok(!file.path.split('/').includes('..'));
    const bytes=await readFile(new URL(file.path,root));
    assert.equal(bytes.length,file.bytes,file.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);
  }
});
