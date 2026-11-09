"""Full original Vivo route: real worker, renderer and IndexedDB; no provider calls."""
import functools, http.server, json, os, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[5]
OUT=Path(os.environ.get('VIVO_EVIDENCE',str(ROOT/'encounter-evidence')));OUT.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/services/vivo/web/phone/field-lab.html'
checks=[];errors=[];requests=[]
def check(name,value):
    assert value,name
    checks.append(name)
try:
 with sync_playwright() as p:
  executable=os.environ.get('VIVO_CHROMIUM') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
  browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
  context=browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce')
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('request',lambda r:requests.append(r.url))
  page.goto(url,wait_until='networkidle',timeout=30000)
  page.wait_for_selector('#enterPhoneLocal',timeout=15000)
  page.select_option('#createD','11');page.click('#enterPhoneLocal')
  page.wait_for_function('window.VivaPhoneEngine?.active && window.VivoLivingEncounters.status()?.ready',timeout=25000)
  check('Actual worker and encounter module active',page.evaluate('window.VivaPhoneEngine.active'))
  check('Eleven spatial coordinates retained',page.evaluate('window.VivaPhoneEngine.publishedSnapshot().snapshot.spaces.root.dimension')==11)
  before=page.evaluate('window.VivaPhoneEngine.snapshot()')
  page.click('#phoneEncountersButton')
  check('Controls are in original phone dialog',page.locator('#panel [data-sheet=phone] #phoneEncounters').count()==1)
  check('Simulated light is labelled, not provider work',page.locator('#encounterLight').inner_text()=='Send simulated light pulse')
  selected=page.evaluate('window.VivaShared.R.selected')
  page.click('#encounterLight')
  page.wait_for_function('id=>window.VivoLivingEncounters.history(id).some(e=>e.kind==="light")',arg=selected)
  check('Light affects actual selected object',page.evaluate('id=>window.VivoLivingEncounters.effect(id).energy',selected)>0)
  check('Surface renderer reads encounter response',page.evaluate('typeof window.VivaShared.R.encounterEffect === "function"'))
  check('Reduced motion honored',page.evaluate('window.VivaShared.R.encounterReducedMotion'))
  after=page.evaluate('window.VivaPhoneEngine.snapshot()')
  check('No coordinate mutation by light',before['snapshot']['spaces']['root']['entities']==after['snapshot']['spaces']['root']['entities'])
  check('No invented authoritative operation',before['snapshot']['acceptedSequence']==after['snapshot']['acceptedSequence'])
  page.click('#encounterSave');page.wait_for_function('window.VivoLivingEncounters.status().storage === "saved"')
  saved=page.evaluate('id=>window.VivoLivingEncounters.history(id)',selected)
  check('IndexedDB trace saved',len(saved)>0)
  page.screenshot(path=str(OUT/'encounters-controls-phone.png'),full_page=True)
  page.click('#closePanel')
  page.screenshot(path=str(OUT/'encounters-world-phone.png'),full_page=True)
  # Get true screen hit point then use actual browser pointer input, not synthetic scene changes.
  hit=page.evaluate('id=>window.VivaShared.R.screen.find(p=>p.id===id)',selected)
  page.mouse.click(hit['x'],hit['y'])
  page.wait_for_function('id=>window.VivoLivingEncounters.history(id).some(e=>e.provenance==="local-touch")',arg=selected)
  check('Actual pointer contact records touch',True)
  page.click('#phoneEncountersButton');page.click('#encounterSave')
  page.wait_for_function('window.VivoLivingEncounters.status().storage === "saved"')
  saved=page.evaluate('id=>window.VivoLivingEncounters.history(id)',selected)
  page.reload(wait_until='networkidle');page.click('#enterPhoneLocal')
  page.wait_for_function('window.VivoLivingEncounters?.status()?.ready')
  check('Same canonical world returns',page.evaluate('window.VivaPhoneEngine.publishedSnapshot().snapshot.worldId')==before['snapshot']['worldId'])
  check('Same branch returns',page.evaluate('window.VivaPhoneEngine.publishedSnapshot().branchId')==before['branchId'])
  check('Exact encounter history returns',page.evaluate('id=>window.VivoLivingEncounters.history(id)',selected)==saved)
  check('Old sensory pulse is not resurrected',page.evaluate('id=>window.VivoLivingEncounters.effect(id).energy',selected)==0)
  page.click('#phoneEncountersButton');page.click('#encounterPause');page.click('#encounterLight')
  check('Pause prevents new local light events',page.evaluate('id=>window.VivoLivingEncounters.history(id)',selected)==saved)
  page.click('#encounterForget');page.wait_for_function('id=>window.VivoLivingEncounters.history(id).length===0',arg=selected)
  page.wait_for_function('window.VivoLivingEncounters.status().storage === "saved"')
  page.reload(wait_until='networkidle');page.click('#enterPhoneLocal');page.wait_for_function('window.VivoLivingEncounters?.status()?.ready')
  check('Forget persists across reload',page.evaluate('id=>window.VivoLivingEncounters.history(id).length',selected)==0)
  check('No camera started',page.evaluate('!document.querySelector("video")?.srcObject'))
  check('No external provider or network request',all(u.startswith(f'http://127.0.0.1:{server.server_port}/') or u.startswith('blob:') for u in requests))
  check('No browser page errors',not errors)
  context.close();browser.close()
finally:
 server.shutdown();server.server_close()
 (OUT/'browser-encounters.json').write_text(json.dumps({'evidenceClass':'full original Vivo app, real Chromium/worker/IndexedDB; no physical device or live providers','passed':len(checks),'checks':checks,'pageErrors':errors},indent=2)+'\n')
print(json.dumps({'passed':len(checks),'pageErrors':errors}))
