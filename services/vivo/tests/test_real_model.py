"""Real pinned MediaPipe worker on a provided still image. Not a webcam test.
The image is supplied outside the package and is never copied into reports.
"""
import asyncio,json,base64,sys,time
from pathlib import Path
try:
 from .browser_harness import mount,ROOT
except ImportError:
 from browser_harness import mount,ROOT
async def main():
 from playwright.async_api import async_playwright
 source=Path(sys.argv[1]);assert source.exists()
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=await b.new_page();cleanup=await mount(page)
  worker=(ROOT/'web/hand-worker.js').read_text();uri='data:image/jpeg;base64,'+base64.b64encode(source.read_bytes()).decode()
  page.on('console',lambda e:print(e.text[:250]) if e.type=='error' else None)
  await page.evaluate('''src=>{window.modelResult={};window.testWorker=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'})));testWorker.onmessage=({data})=>{modelResult[data.type]=data;};testWorker.onerror=e=>modelResult.error={message:e.message};testWorker.postMessage({type:'init',bundle:'https://viva.test/vendor/field-lab/vision_bundle.mjs',wasm:'https://viva.test/vendor/field-lab/wasm',model:'https://viva.test/vendor/field-lab/hand_landmarker.task'});}''',worker)
  await page.wait_for_function('modelResult.ready||modelResult.error',timeout=60000)
  print('INIT',await page.evaluate('modelResult'))
  assert await page.evaluate('!!modelResult.ready'),await page.evaluate('modelResult')
  await page.evaluate('''async uri=>{const img=new Image();img.src=uri;await img.decode();const bitmap=await createImageBitmap(img);testWorker.postMessage({type:'frame',image:bitmap,sequence:1,time:1000},[bitmap]);}''',uri)
  await page.wait_for_function('modelResult.result||modelResult.error',timeout=30000)
  result=await page.evaluate('({hands:modelResult.result?.landmarks?.length,landmarks:modelResult.result?.landmarks?.[0]?.length,inferenceMs:modelResult.result?.inferenceMs,error:modelResult.error})')
  assert result['hands']==1 and result['landmarks']==21,result
  await page.evaluate('''async()=>{modelResult.result=null;const c=new OffscreenCanvas(358,460);c.getContext('2d').fillRect(0,0,358,460);const bitmap=await createImageBitmap(c);testWorker.postMessage({type:'frame',image:bitmap,sequence:2,time:2000},[bitmap]);}''')
  await page.wait_for_function('modelResult.result?.sequence===2',timeout=30000)
  blank=await page.evaluate('modelResult.result.landmarks.length');assert blank==0
  report={'test':'actual pinned MediaPipe 0.10.14 CPU worker','hand_image':{'source':'user-provided still image, NOT retained in package',**result},'blank_hands':blank,'physical_camera':False,'http_assets':'served from local packaged files through test route','webgl':False,'success':True}
  (ROOT/'reports/real-model.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));await b.close();await cleanup()
if __name__ == '__main__':
 asyncio.run(main())
