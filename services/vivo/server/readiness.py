"""Readiness is service/asset readiness, not physical-device certification."""
from pathlib import Path
import hashlib,json

REQUIRED=('web/index.html','web/shared.js','web/render.js','web/camera.js',
          'web/hand-worker.js','web/vendor/field-lab/vision_bundle.mjs',
          'web/vendor/field-lab/hand_landmarker.task',
          'web/vendor/field-lab/wasm/vision_wasm_internal.wasm',
          'web/vendor/field-lab/wasm/vision_wasm_nosimd_internal.wasm',
          'models/room-rule.json')

def inspect_assets(root):
    root=Path(root)
    out={}
    for name in REQUIRED:
        p=root/name
        out[name]=p.is_file() and p.stat().st_size>0
    model_ok=False
    try:
        value=json.loads((root/'models/room-rule.json').read_text())
        model_ok=all(k in value['weights'] for k in ('w1','b1','w2','b2','w3','b3'))
    except (OSError,ValueError,KeyError,TypeError):pass
    return {'assetsPresent':all(out.values()),'modelReadable':model_ok,
            'missingAssets':[k for k,v in out.items() if not v]}

def report(hub,root,assets=None):
    checks=dict(assets or inspect_assets(root))
    try:checks['databaseOpen']=hub.store.db.execute('SELECT 1').fetchone()==(1,)
    except Exception:checks['databaseOpen']=False
    return {'ok':bool(checks['assetsPresent'] and checks['modelReadable'] and checks['databaseOpen']),
            'release':'0.8.1','checks':checks,'creationKeyRequired':bool(hub.create_key),
            'publicOriginConfigured':bool(hub.origin),
            'deviceValidated':False,'publicDeploymentVerified':False,
            'note':'Readiness verifies server and assets only. Validate persistence after redeploy and tracking on real devices.'}
