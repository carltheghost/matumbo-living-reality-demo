import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPreviewServer} from '../scripts/public-preview.mjs';

test('public preview allowlist, read-only routes, context and live revisions', async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'matumbo-preview-test-'));
  await mkdir(path.join(root,'src'));
  await writeFile(path.join(root,'index.html'),'<body><a href="?feature=contracts">Contracts</a><a href="?feature=t402">T402</a><a href="?panel=runtime-sync&amp;world=demo">Runtime Sync</a></body>');
  await writeFile(path.join(root,'src','main.js'),'export const revision=1;');
  await mkdir(path.join(root,'assets','avatar'), {recursive:true});
  await mkdir(path.join(root,'public','models'), {recursive:true});
  await writeFile(path.join(root,'mobile-chrome.js'),'export const mobile=true;');
  await writeFile(path.join(root,'mobile-layout.css'),'body{margin:0}');
  await writeFile(path.join(root,'assets','avatar','avatar.webp'),Buffer.from([82,73,70,70]));
  await writeFile(path.join(root,'assets','avatar','manifest.json'),'{}');
  await writeFile(path.join(root,'public','models','avatar.glb'),Buffer.from([103,108,84,70]));
  await mkdir(path.join(root,'vendor','mediapipe-tasks-vision-1.0.1','wasm'),{recursive:true});
  await writeFile(path.join(root,'vendor','mediapipe-tasks-vision-1.0.1','vision_bundle.mjs'),'export const fixture=true;');
  await writeFile(path.join(root,'vendor','mediapipe-tasks-vision-1.0.1','wasm','vision_wasm_internal.wasm'),Buffer.from([0,97,115,109]));
  await writeFile(path.join(root,'assets','face_landmarker.task'),'fixture');
  await writeFile(path.join(root,'vite.config.js'),'PRIVATE CONFIG');
  await writeFile(path.join(root,'internal.js'),'PRIVATE SCRIPT');
  await writeFile(path.join(root,'.env'),'PRIVATE');
  const server=await createPreviewServer(root);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const rootResponse=await fetch(base); assert.equal(rootResponse.status,200);
  assert.match(await rootResponse.text(),/__preview\/client.js/);
  for(const p of ['/.env','/.git/config','/package.json','/README.md','/runtime/merge4/server.js','/scripts/public-preview.mjs','/vite.config.js','/internal.js','/src/%2e%2e%5c.env','/src/../.env','/src/not.js','/assets/.env','/public/../.env','/api/world'])assert.equal((await fetch(base+p)).status,404,p);
  assert.equal((await fetch(base+'/src/main.js')).status,200,'src assets remain public');
  for (const [asset, type] of [
    ['/mobile-chrome.js?v=20261003-calm6','text/javascript'],
    ['/mobile-layout.css?v=mobile1','text/css'],
    ['/assets/avatar/avatar.webp','image/webp'],
    ['/assets/avatar/manifest.json','application/json'],
    ['/public/models/avatar.glb','model/gltf-binary'],
    ['/vendor/mediapipe-tasks-vision-1.0.1/vision_bundle.mjs','text/javascript'],
    ['/vendor/mediapipe-tasks-vision-1.0.1/wasm/vision_wasm_internal.wasm','application/wasm'],
    ['/assets/face_landmarker.task','application/octet-stream'],
  ]) {
    const response = await fetch(base+asset);
    assert.equal(response.status,200,asset);
    assert.equal(response.headers.get('content-type').split(';')[0],type,asset);
  }
  assert.equal((await fetch(base+'/context',{method:'POST'})).status,405);
  const before=await (await fetch(base+'/context.json')).json();
  assert.deepEqual(before.features,['contracts','t402','runtime-sync']); assert.ok(!JSON.stringify(before).includes(root));
  assert.match(await (await fetch(base+'/context')).text(),/Source revision/);
  await writeFile(path.join(root,'mobile-chrome.js'),'export const mobile=false;');
  await new Promise(resolve=>setTimeout(resolve,1600));
  const after=await (await fetch(base+'/__preview/revision')).json();
  assert.notEqual(before.revision,after.revision,'root browser changes enter the live revision');
  await writeFile(path.join(root,'assets','avatar','manifest.json'),'{"version":2}');
  await new Promise(resolve=>setTimeout(resolve,1600));
  const afterAsset=await (await fetch(base+'/__preview/revision')).json();
  assert.notEqual(after.revision,afterAsset.revision,'asset changes enter the live revision');
});

test('public preview rejects an allowed asset path that escapes through a directory link', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(),'matumbo-preview-link-'));
  const outside = await mkdtemp(path.join(os.tmpdir(),'matumbo-preview-private-'));
  await writeFile(path.join(root,'index.html'),'<body></body>');
  await writeFile(path.join(outside,'private.js'),'PRIVATE');
  await mkdir(path.join(root,'assets'));
  t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});});
  try { await symlink(outside,path.join(root,'assets','linked'),process.platform==='win32'?'junction':'dir'); }
  catch (error) { t.skip('Directory links unavailable: '+error.code); return; }
  const server = await createPreviewServer(root);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/assets/linked/private.js')).status,404);
  const context = await (await fetch(base+'/context.json')).json();
  assert.equal(context.publicFiles,1,'the revision scan also excludes linked private files');
});
