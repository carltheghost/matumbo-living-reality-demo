"""Vendor pinned optional hand-tracking assets into the deployed site, not Git."""
import hashlib,json,pathlib,time,urllib.request
root=pathlib.Path('dist/vendor/field-lab');root.mkdir(parents=True,exist_ok=True)
package='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/'
items={
 'vision_bundle.mjs':package+'vision_bundle.mjs',
 'wasm/vision_wasm_internal.js':package+'wasm/vision_wasm_internal.js',
 'wasm/vision_wasm_internal.wasm':package+'wasm/vision_wasm_internal.wasm',
 'wasm/vision_wasm_nosimd_internal.js':package+'wasm/vision_wasm_nosimd_internal.js',
 'wasm/vision_wasm_nosimd_internal.wasm':package+'wasm/vision_wasm_nosimd_internal.wasm',
 'hand_landmarker.task':'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
 'package.json':package+'package.json'
}
manifest={}
for name,url in items.items():
 for attempt in range(3):
  try:
   with urllib.request.urlopen(url,timeout=60) as r:
    assert r.status==200
    data=r.read(50*1024*1024)
   assert data and not data[:100].lstrip().lower().startswith(b'<!doctype html'),name
   if name.endswith('.wasm'):assert data[:4]==b'\0asm'
   if name.endswith('.task'):assert len(data)>1000000
   out=root/name;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(data)
   manifest[name]={'url':url,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
   print(name,len(data),flush=True);break
  except Exception:
   if attempt==2:raise
   time.sleep(2)
(root/'manifest.json').write_text(json.dumps(manifest,indent=2))
(root/'NOTICE.txt').write_text('MediaPipe Tasks Vision 0.10.14, Google. Runtime package metadata and source URLs are included.\nHand Landmarker float16 model version 1 from Google MediaPipe.\nNo user images are included. These are unmodified runtime/model downloads.\n')
# Public documentation image is used only by the CI test; never deployed.
url='https://developers.google.com/static/mediapipe/images/solutions/gesture-recognizer.png'
with urllib.request.urlopen(url,timeout=40) as r:pathlib.Path('/tmp/field-hand-fixture.png').write_bytes(r.read())
