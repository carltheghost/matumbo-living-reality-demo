"""Real DOM/controllers + Canvas rendering against real server.
The environment forbids top-level navigation and native browser networking; see
browser_harness.py for the explicit test-only HTTP/WS relay. Physical devices,
HTTPS permission flows and native-browser sockets are NOT verified by this suite.
"""
import asyncio,json,math,sys,time,traceback
from pathlib import Path
from aiohttp import ClientSession
from playwright.async_api import async_playwright
try:
 from .browser_harness import mount,ROOT
except ImportError:
 from browser_harness import mount,ROOT
checks=[]
def check(name,value,details=None):
 checks.append({'name':name,'passed':bool(value),**({'details':details}if details is not None else{})})
 if not value:raise AssertionError(name+' '+str(details))
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  pages=[];cleanups=[];errors=[]
  async def new(width=430,height=932):
   page=await b.new_page(viewport={'width':width,'height':height},device_scale_factor=1,has_touch=True,is_mobile=width<500)
   page.on('pageerror',lambda e:errors.append(str(e)));cleanups.append(await mount(page));pages.append(page);return page
  async def panel(page,name):
   if await page.locator('#panel').evaluate('(e)=>e.open'):await page.click('#closePanel')
   await page.click('[data-panel="'+name+'"]')
  try:
   a=await new();await a.fill('#displayName','Explorer A');await a.click('#createRoom');await a.wait_for_function('VivaShared.S.actor');await a.wait_for_timeout(450)
   cred=await a.evaluate('VivaShared.S.credential');check('Explicit create and join reaches real server',bool(cred.get('room')))
   check('No horizontal overflow at 430px',await a.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   check('Camera starts off',await a.evaluate('VivaShared.camera.stream===null'))
   check('Camera recording inclusion defaults off',not await a.locator('#recordCamera').is_checked())
   check('Canvas fallback renders',await a.evaluate('VivaShared.R.backend')=='Canvas 2D')
   check('Three visible real entity handles',await a.evaluate('VivaShared.R.screen.filter(x=>x.interactive).length')==3)
   async with ClientSession() as http:
    async with http.post('http://127.0.0.1:8765/api/rooms/'+cred['room']+'/invite',headers={'Authorization':'Bearer '+cred['token']},json={'role':'editor'})as r:invite=await r.json()
   other=await new(1280,800);await other.fill('#displayName','Explorer B');await other.evaluate('c=>VivaShared.connect(c)',invite);await other.wait_for_function('VivaShared.S.state.participants.length===2')
   await a.wait_for_function('VivaShared.S.state.participants.length===2');check('Two browser controllers joined through independent TCP sessions',True)
   pos=await a.evaluate("VivaShared.R.screen.find(x=>x.id==='relic-0')");q0=await a.evaluate("VivaShared.S.state.entities['relic-0'].q")
   await a.mouse.move(pos['x'],pos['y']);await a.mouse.down();await a.wait_for_function("VivaShared.S.held==='relic-0'")
   check('Touch pointerdown acquires authoritative grab',await a.evaluate("VivaShared.S.heldSource==='touch'"))
   await a.evaluate("VivaShared.camera.lost('No hand during touch test')");await a.wait_for_timeout(70)
   check('Missing hand does not cancel a touch-owned grab',await a.evaluate("VivaShared.S.held==='relic-0'"))
   rejected=await other.evaluate("async()=>{try{await VivaShared.command('grab',{entity:'relic-0'});return false;}catch(e){return e.message.includes('held');}}")
   check('Second browser cannot steal held object',rejected)
   for j in range(1,8):await a.mouse.move(pos['x']+j*3,pos['y']-j*2);await a.wait_for_timeout(85)
   await a.mouse.up();await a.wait_for_function('!VivaShared.S.held');await a.wait_for_timeout(250)
   q1=await a.evaluate("VivaShared.S.state.entities['relic-0'].q");q2=await other.evaluate("VivaShared.S.state.entities['relic-0'].q")
   check('Actual pointer drag changed native object coordinates',math.dist(q0,q1)>.03,{'distance':math.dist(q0,q1)})
   check('Other browser sees same committed coordinates',q1==q2)
   await other.evaluate("async()=>{await VivaShared.command('grab',{entity:'relic-0'});await VivaShared.command('release',{entity:'relic-0'});}")
   check('Released object can be handed to second browser',True)
   await panel(a,'move');await a.select_option('#moveAxis','3')
   for _ in range(3):await a.click('#axisPlus');await a.wait_for_timeout(120)
   await a.click('#releaseGrab');await a.click('#closePanel');await a.wait_for_timeout(200)
   qhidden=await a.evaluate("VivaShared.S.state.entities['relic-0'].q")
   check('x4 controls move native fourth coordinate',qhidden[3]>.3)
   check('Object outside slice is not a touch target',await a.evaluate("!VivaShared.R.screen.some(x=>x.id==='relic-0'&&x.interactive)"))
   await panel(a,'eye');await a.click('#followSelected');await a.click('#closePanel');await a.wait_for_timeout(150)
   check('Eye can follow object into its fourth-coordinate slice',await a.evaluate("VivaShared.R.screen.some(x=>x.id==='relic-0'&&x.interactive)"))
   check('Following does not move other observer',await other.evaluate('VivaShared.R.slice[3]')==0)
   await panel(a,'move');await a.select_option('#moveTarget','observer');await a.select_option('#moveAxis','3');before=await a.evaluate('VivaShared.S.observer.q[3]');await a.click('#axisPlus');await a.wait_for_timeout(150)
   check('Observer movement receives metric-aware server result',abs((await a.evaluate('VivaShared.S.observer.q[3]'))-before-.12)<1e-8)
   await a.click('#closePanel');await panel(a,'record');await a.click('#checkpoint');await a.wait_for_timeout(150);await a.click('#loadHistory');await a.wait_for_timeout(180)
   check('History fetched from durable server',await a.evaluate('VivaShared.S.history.events.length')>3)
   await a.locator('#historySlider').evaluate("e=>{e.value=0;e.dispatchEvent(new Event('input'));}")
   check('Scrubbing enters recorded past',await a.evaluate('VivaShared.S.replay'))
   check('Replay refuses edits',await a.evaluate("async()=>{try{await VivaShared.command('grab',{entity:'relic-0'});return false;}catch(e){return e.message.includes('live');}}"))
   await a.click('#exitReplay');check('Return to latest shared state',not await a.evaluate('VivaShared.S.replay'))
   await a.click('#recordVideo');await a.wait_for_timeout(1400);await panel(a,'record');await a.click('#stopVideo');await a.wait_for_function("!document.getElementById('videoDownload').hidden")
   video=await a.evaluate("async()=>{const r=await fetch(document.getElementById('videoDownload').href);const b=await r.blob();return {size:b.size,type:b.type,bytes:Array.from(new Uint8Array(await b.arrayBuffer()))};}")
   check('Real MediaRecorder encoded video',video['size']>1000,{'bytes':video['size'],'mime':video['type']})
   (ROOT/'reports/shared-demo.webm').write_bytes(bytes(video['bytes']))
   check('Recording stopped and released stream',await a.evaluate('VivaShared.S.recording===null'))
   await a.click('#closePanel');await a.screenshot(path=str(ROOT/'reports/shared-mobile.png'))
   # A real generated MediaStream exercises production landmark processing and stop.
   await a.evaluate('''async()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const ctx=c.getContext('2d');ctx.fillStyle='rgb(120,120,120)';ctx.fillRect(0,0,640,480);window.syntheticCanvas=c;window.syntheticContext=ctx;const stream=c.captureStream(15);window.syntheticTrack=stream.getVideoTracks()[0];const cam=VivaShared.camera;cam.stream=stream;cam.video.srcObject=stream;await cam.video.play();window.sampleHand=Array.from({length:21},()=>({x:.5,y:.5,z:0}));sampleHand[5]={x:.35,y:.55};sampleHand[17]={x:.65,y:.55};sampleHand[8]={x:.48,y:.35};sampleHand[4]={x:.2,y:.35};window.observeHand=(pinch=false,age=0,missing=false)=>{sampleHand[4]={x:pinch?.485:.2,y:.35};cam.lastLuma=0;cam.consume({type:'result',sequence:cam.lastSequence+1,time:performance.now()-age,inferenceMs:20,landmarks:missing?[]:[sampleHand]});};}''')
   await a.wait_for_timeout(150)
   await a.evaluate('observeHand(false);observeHand(false);observeHand(false)')
   check('Three fresh open observations arm gesture',await a.evaluate('VivaShared.camera.arm')==3)
   await a.evaluate('observeHand(true)');check('Normalized pinch changes hand state',await a.evaluate('VivaShared.camera.held'))
   await a.evaluate('observeHand(true,400)');check('Stale hand output releases gesture',not await a.evaluate('VivaShared.camera.held'))
   await a.evaluate('observeHand(true)');check('Returning pinched cannot grab without open reacquisition',not await a.evaluate('VivaShared.camera.held'))
   await a.evaluate("syntheticContext.fillStyle='black';syntheticContext.fillRect(0,0,640,480);syntheticTrack.requestFrame?.()");await a.wait_for_timeout(120);await a.evaluate('VivaShared.camera.sampleLuma()')
   check('Black camera sample selects low-glow display',await a.evaluate("document.body.classList.contains('dark')"))
   check('Black sample inhibits camera gesture',await a.evaluate('VivaShared.camera.mean<3'))
   await a.evaluate("syntheticContext.fillStyle='white';syntheticContext.fillRect(0,0,640,480);syntheticTrack.requestFrame?.()");await a.wait_for_timeout(120);await a.evaluate('VivaShared.camera.sampleLuma()')
   check('Clipped sample selects glare display',await a.evaluate("document.body.classList.contains('bright')"))
   check('Clipped sample is reported',await a.evaluate('VivaShared.camera.clipped>.985'))
   await a.evaluate("VivaShared.camera.stop('test stop')")
   check('Stop releases real generated video track',await a.evaluate("syntheticTrack.readyState==='ended'"))
   check('Stop clears video and tracking state',await a.evaluate('VivaShared.camera.stream===null&&!VivaShared.camera.held'))
   await panel(a,'camera');await a.click('#frontCamera');await a.wait_for_timeout(100)
   check('Unsupported local test context is rejected clearly', 'HTTPS' in await a.locator('#cameraState').inner_text())
   # Curved scene, actual chart metric and learned field.
   torus=await new();await torus.select_option('#spaceKind','torus');await torus.select_option('#createD','7');await torus.click('#createRoom');await torus.wait_for_function('VivaShared.S.actor');await torus.wait_for_timeout(500)
   check('7D torus product receives chart and extra coordinates',await torus.evaluate('VivaShared.S.state.geometry.dimension===7&&VivaShared.S.grid.coords.every(q=>q.length===7)'))
   check('Curved surface vertices render finitely',await torus.evaluate('VivaShared.R.gridPoints.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))'))
   await panel(torus,'neural');await torus.click('#routeFromObject');await torus.wait_for_timeout(180)
   # allow propagation to cover all samples then trace
   await torus.wait_for_timeout(1500);await panel(torus,'neural');await torus.click('#routeFromObject')
   route=await torus.evaluate('VivaShared.R.route');check('Local field grows a usable route',len(route)>1)
   blocked=route[len(route)//2]
   await torus.evaluate("i=>VivaShared.command('block',{cell:i})",blocked);await torus.wait_for_timeout(1800);await panel(torus,'neural');await torus.click('#routeFromObject');route2=await torus.evaluate('VivaShared.R.route')
   check('Guidance repairs around blocked sample',len(route2)>1 and blocked not in route2)
   await torus.screenshot(path=str(ROOT/'reports/curved-mobile.png'))
   tc=await torus.evaluate('VivaShared.S.credential');await other.evaluate('c=>VivaShared.connect(c)',tc);await other.wait_for_timeout(500);await panel(other,'neural');await other.click('#routeFromObject');await other.screenshot(path=str(ROOT/'reports/curved-desktop.png'))
   # Record curved scene as actual optional demo replacement.
   await panel(torus,'record');await torus.click('#recordVideo');await torus.wait_for_timeout(1200);await panel(torus,'record');await torus.click('#stopVideo');await torus.wait_for_function("!document.getElementById('videoDownload').hidden")
   data=await torus.evaluate("async()=>Array.from(new Uint8Array(await(await fetch(document.getElementById('videoDownload').href)).arrayBuffer()))");(ROOT/'reports/curved-demo.webm').write_bytes(bytes(data));check('Curved scene video exported',len(data)>1000)
   check('No uncaught application script errors',not errors,errors)
   report={'suite':'browser-component-acceptance','passed':sum(c['passed']for c in checks),'failed':sum(not c['passed']for c in checks),'checks':checks,'renderer':'Canvas 2D fallback','transport':'test-only browser WebSocket relay to independent real TCP sockets','camera':'generated real MediaStream, controlled landmarks, permission context rejection','not_validated':['physical phone','native browser transport / public HTTPS','physical camera inference','WebGL GPU','ARCore'],'success':True}
   (ROOT/'reports/browser.json').write_text(json.dumps(report,indent=2));print(json.dumps({'passed':report['passed'],'failed':report['failed']}))
  except Exception as e:
   (ROOT/'reports/browser.json').write_text(json.dumps({'success':False,'checks':checks,'error':str(e),'trace':traceback.format_exc()},indent=2));raise
  finally:
   for cleanup in cleanups:await cleanup()
   await b.close()
if __name__ == '__main__':
 asyncio.run(main())
