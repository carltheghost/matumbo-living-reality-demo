"""Actual browser components, using the disclosed test-only network relay.
Generated video and controlled workers verify failure recovery, NOT hand accuracy.
"""
import asyncio,json
from playwright.async_api import async_playwright
from browser_harness import mount,ROOT

async def main():
 checks=[];errors=[]
 def check(name,ok):
  checks.append({'name':name,'passed':bool(ok)})
  if not ok:raise AssertionError(name)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=await browser.new_page(viewport={'width':430,'height':932},has_touch=True,is_mobile=True)
  page.on('pageerror',lambda e:errors.append(str(e)))
  cleanup=await mount(page)
  try:
   await page.wait_for_function("document.querySelector('#serviceReady').textContent.includes('SERVER READY')")
   check('Readiness names the actual server release','0.8.1' in await page.locator('#serviceReady').inner_text())
   await page.click('#createRoom');await page.wait_for_function('VivaShared.S.actor')
   check('Camera remains off after creating a real room',await page.evaluate('!VivaShared.camera.stream'))
   await page.evaluate("VivaShared.select('relic-0')")
   pos=await page.evaluate("VivaShared.R.screen.find(p=>p.id==='relic-0')")
   await page.mouse.move(pos['x'],pos['y']);await page.mouse.down();await page.wait_for_function("VivaShared.S.held==='relic-0'")
   await page.wait_for_timeout(5700)
   check('Motionless touch hold lasts beyond the five-second lease',await page.evaluate("VivaShared.S.held==='relic-0'"))
   await page.evaluate('''async()=>{
    const c=document.createElement('canvas');c.width=640;c.height=480;const x=c.getContext('2d');x.fillStyle='rgb(120,120,120)';x.fillRect(0,0,640,480);
    const stream=c.captureStream(15);window.testTrack=stream.getVideoTracks()[0];
    const cam=VivaShared.camera;cam.stream=stream;cam.video.srcObject=stream;await cam.video.play();document.body.classList.add('camera-live');
    cam.worker={terminate(){window.workerTerminated=true;}};cam.ready=true;
    cam.keepPreview('TEST WORKER FAILURE · camera and touch only');
   }''')
   check('Worker failure retains live generated video',await page.evaluate("testTrack.readyState==='live'&&VivaShared.camera.video.readyState>=2"))
   check('Failed worker is terminated and model is marked off',await page.evaluate('workerTerminated&&!VivaShared.camera.worker&&!VivaShared.camera.ready'))
   check('Camera fallback does not steal touch ownership',await page.evaluate("VivaShared.S.held==='relic-0'&&VivaShared.S.heldSource==='touch'"))
   check('Fallback visibly identifies touch-only state','camera and touch only' in await page.locator('#cameraState').inner_text())
   await page.mouse.up();await page.wait_for_timeout(150)
   await page.evaluate("VivaShared.camera.stop('Explicit stop')")
   check('Explicit stop still releases the camera track',await page.evaluate("testTrack.readyState==='ended'&&!VivaShared.camera.stream"))
   await page.screenshot(path=str(ROOT/'reports/release-mobile.png'))
   await page.set_viewport_size({'width':1280,'height':800});await page.screenshot(path=str(ROOT/'reports/release-desktop.png'))
   check('No uncaught application error',not errors)
   report={'suite':'release-browser','passed':sum(c['passed']for c in checks),'checks':checks,'actual_video':'generated Canvas MediaStream','transport':'test relay to real HTTP/TCP server','physical_camera':False,'physical_phone':False,'model_inference_tested':False}
   (ROOT/'reports/browser-release.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
  finally:
   await cleanup();await browser.close()
if __name__=='__main__':asyncio.run(main())
