#!/usr/bin/env python3
"""Package the existing web runtime, not a second world, for offline Android use."""
from __future__ import annotations
import argparse, hashlib, json, shutil
from pathlib import Path

EXTENSIONS = {'.js','.mjs','.css','.html','.wasm','.task','.json','.webmanifest','.svg','.png','.jpg','.jpeg','.webp','.ico','.woff2','.txt'}
EXCLUDED_DIRS = {'tests','test','node_modules','reports','__pycache__','.git'}
REQUIRED = ('phone/field-lab.html','phone/index.html','phone/bootstrap.mjs','phone/engine.mjs','phone/storage.mjs','phone/client.mjs','phone/engine-worker.mjs','phone/vendor/economy/manifest.json','vendor/field-lab/vision_bundle.mjs','vendor/field-lab/hand_landmarker.task')

def bundle(repo: Path, destination: Path):
    repo=repo.resolve(strict=True)
    source=repo/'services/vivo/web'
    destination=destination.resolve()
    # Generated build directory only; never delete or replace user storage/source.
    build_root=(repo/'services/vivo/android-companion/app/build').resolve()
    if not destination.is_relative_to(build_root) or destination==build_root:
        raise ValueError('Destination must be inside the Android app build directory')
    entries=[]; total=0
    for path in sorted(source.rglob('*')):
        relative=path.relative_to(source)
        if any(p in EXCLUDED_DIRS or p.startswith('.') for p in relative.parts): continue
        if path.is_symlink(): raise ValueError('Symlinks are not shipped: '+str(relative))
        if not path.is_file() or path.suffix.lower() not in EXTENSIONS: continue
        if any(s in path.name.lower() for s in ('credential','secret','token-cache','auth-store')):
            raise ValueError('Potential credential file: '+str(relative))
        data=path.read_bytes(); total+=len(data)
        if len(data)>24*1024*1024 or total>80*1024*1024: raise ValueError('Bundle budget exceeded')
        entries.append((relative.as_posix(),data))
    missing=sorted(set(REQUIRED)-{p for p,_ in entries})
    if missing: raise ValueError('Missing native runtime dependencies: '+', '.join(missing))
    generated=destination/'vivo'
    if generated.exists(): shutil.rmtree(generated)
    generated.mkdir(parents=True)
    hashes=[]
    for name,data in entries:
        target=generated/name; target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data)
        hashes.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    manifest={'schema':'vivo.android.bundle/1','origin':'https://carltheghost.github.io',
       'pathPrefix':'/matumbo-living-reality-demo/services/vivo/web/',
       'entry':'phone/field-lab.html','files':hashes,'bytes':total,
       'storage':'Existing WebView-origin IndexedDB; no cache/data clearing or migration',
       'liveWorld':'https://matumbo-fabric-omega-v2.tumbo.chatgpt.site/vivo/services/vivo/web/phone/'}
    (generated/'android-bundle.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'files':len(hashes),'bytes':total,'destination':str(generated)}))
    return manifest

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--destination',type=Path,required=True)
    args=p.parse_args();bundle(args.repo,args.destination)
