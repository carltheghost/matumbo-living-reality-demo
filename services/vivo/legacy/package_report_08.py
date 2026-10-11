"""Collect explicit evidence. Does not convert a blocked hardware probe into a pass."""
from pathlib import Path
from importlib.metadata import version
import hashlib,json,platform,re,subprocess,sys,datetime
ROOT=Path(__file__).resolve().parents[1]
def load(p):return json.loads((ROOT/p).read_text())
new=(ROOT/'reports/core-network-packaging.log').read_text();old=(ROOT/'reports/legacy-numerical.log').read_text()
assert '\nOK\n' in new and '\nOK\n' in old
cases=re.findall(r'^(test_\w+) \((.*?)\) \.\.\.',new,re.M)
assert len(cases)==66,len(cases)
script_results=[]
for f in sorted((ROOT/'web').glob('*.js')):
 result=subprocess.run(['node','--check',str(f)],capture_output=True,text=True)
 script_results.append({'path':str(f.relative_to(ROOT)),'passed':result.returncode==0,'error':result.stderr})
assert all(r['passed']for r in script_results)
suites=[{'name':'New geometry/neural/protocol/package tests','passed':66,'failed':0,'evidence':'reports/core-network-packaging.log','cases':[a+' ('+b+')' for a,b in cases]},
 {'name':'Original numerical reference regression','passed':26,'failed':0,'evidence':'reports/legacy-numerical.log'},
 {'name':'Original Studio core regression','passed':load('legacy/studio/reports/core.json')['passed'],'failed':0,'evidence':'legacy/studio/reports/core.json'},
 {'name':'Original Viva core regression','passed':load('legacy/studio/reports/viva-core.json')['passed'],'failed':0,'evidence':'legacy/studio/reports/viva-core.json'},
 {'name':'Browser component acceptance','passed':load('reports/browser.json')['passed'],'failed':0,'evidence':'reports/browser.json'},
 {'name':'Original app + additive bridge','passed':load('reports/bridge.json')['passed'],'failed':0,'evidence':'reports/bridge.json'}]
for f in ['reports/browser.json','reports/bridge.json']:assert load(f)['success']
report={'release':'Viva Shared Workshop 0.8','generated_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'status':'Runnable server/client package, not deployed. Passing component/protocol checks do not establish physical-device acceptance.',
 'automated_checks_passed':sum(s['passed']for s in suites),'automated_suites':suites,'javascript_syntax':script_results,
 'real_model_probe':load('reports/real-model.json'),'neural_evaluation':load('reports/room-training.json'),
 'runtime':{'python':sys.version,'platform':platform.platform(),'aiohttp':version('aiohttp'),'numpy':version('numpy'),'playwright':version('playwright'),'torch_training':version('torch')},
 'network_test_scope':'Real HTTP/TCP WebSocket sockets and actual server restart on loopback. Browser test uses a disclosed relay instead of native WebSocket transport because navigation/network policies block it.',
 'render_test_scope':'Actual Canvas 2D fallback rendering at phone and desktop viewport sizes. No WebGL GPU acceptance.',
 'camera_test_scope':'Generated real MediaStream plus controlled landmarks tested processing and lifecycle. Real pinned model initialized; real image inference failed due unavailable WebGL preprocessing.',
 'deployment':{'live_url':None,'github_changes':False,'pull_request_created':False,'docker_tested':False,'https_tested':False},
 'remaining_acceptance':['Physical phone touch + hand end-to-end responsiveness','Actual camera tracking in bright/dim lighting','Real model image inference on supported WebGL runtime','Native browser HTTP/WSS same-origin permission and reconnection','Public HTTPS hosting and persistent volume','WebGL renderer and recovery','ARCore/world anchoring in the NEW shared mode is not implemented','Arbitrary global manifold/atlas inference is not implemented','Open-ended emergent intelligent room construction is not implemented'],
 'security_scope':'Prototype bearer capabilities, TTL, revocation, bounded messages/history, exclusive leases. Not audited, not identity verification, not E2EE.',
 'evidence_assets':{'phone':'reports/curved-mobile.png','desktop':'reports/curved-desktop.png','recorded_scene':'reports/curved-demo.webm','recording_includes_camera':False}}
(ROOT/'verification.json').write_text(json.dumps(report,indent=2))
# Hash source and original bytes, not private test stores, caches or this report generator's output.
files={}
for base in ['server','web','models','scripts','docs','legacy']:
 for p in (ROOT/base).rglob('*'):
  if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc':files[str(p.relative_to(ROOT))]=hashlib.sha256(p.read_bytes()).hexdigest()
(ROOT/'integrity.json').write_text(json.dumps({'algorithm':'SHA-256','files':files},indent=2))
print(json.dumps({'checks':report['automated_checks_passed'],'scripts_checked':len(script_results),'file_hashes':len(files)},indent=2))
