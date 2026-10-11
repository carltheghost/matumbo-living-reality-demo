"""Old assembled app + additive adapter; test memory storage, not browser durability."""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def main():
 checks=[]
 def ok(name,v):
  checks.append({'name':name,'passed':bool(v)})
  if not v:raise AssertionError(name)
 async with async_playwright()as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=await b.new_page(viewport={'width':430,'height':932});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await page.evaluate('''()=>{window.__storage=new Map();Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>__storage.get(k)||null,setItem:(k,v)=>__storage.set(k,String(v)),removeItem:k=>__storage.delete(k)}});window.__alerts=[];window.alert=m=>__alerts.push(String(m));window.confirm=()=>true;}''')
  await page.set_content((ROOT/'web/studio-original.html').read_text(),wait_until='domcontentloaded')
  await page.wait_for_function('FieldApp?.viva&&FieldApp?.studio',timeout=15000)
  ok('Original Viva and Studio both boot',await page.evaluate('!!FieldApp.viva&&!!FieldApp.studio'))
  await page.evaluate("FieldApp.setPause(true);FieldApp.viva.enter('circuit');FieldApp.viva.enter('room-S1')")
  ok('Original nested entry still works',await page.evaluate("FieldApp.viva.active==='room-S1'"))
  await page.add_script_tag(content=(ROOT/'web/studio-bridge.js').read_text())
  ok('Additive bridge is present',await page.locator('#sharedBridge').count()==1)
  await page.get_by_text('Publish this place ↗',exact=True).click()
  state=await page.evaluate("JSON.parse(sessionStorage.getItem('viva-publish'))")
  ok('Explicit publication produces native 9D objects',state['dimension']==9 and len(state['entities'])>0 and all(len(e['q'])==9for e in state['entities']))
  ok('Published IDs carry original provenance',all(e['source'].startswith('room-S1:')for e in state['entities']))
  ok('Original visited universe checkpoint is retained',await page.evaluate("JSON.parse(sessionStorage.getItem('viva-bridge-universe')).worlds.length>=3"))
  first=state['entities'][0];first['q'][0]+=.1
  export={'geometry':{'kind':'flat','dimension':9},'entities':{e['id']:e for e in state['entities']}}
  await page.evaluate("s=>sessionStorage.setItem('viva-return-state',JSON.stringify(s))",export)
  await page.locator('#sharedBridge').evaluate('(e)=>e.remove()')
  await page.add_script_tag(content=(ROOT/'web/studio-bridge.js').read_text());await page.wait_for_function('!FieldApp.viva.importing')
  await page.get_by_text('Apply exported shared positions',exact=True).click()
  node=int(first['source'].split(':')[-1]);q=await page.evaluate('node=>Array.from(FieldApp.engine.q.slice(node*9,node*9+9))',node)
  ok('Returned shared position updates original node',abs(q[0]-first['q'][0])<1e-10 and abs(q[1]-first['q'][2])<1e-10)
  ok('Original place remains paused after handoff',await page.evaluate('FieldApp.paused'))
  ok('Other visited places survive handoff',await page.evaluate('FieldApp.viva.worlds.size>=3'))
  ok('Return marker removed only after successful application',await page.evaluate("sessionStorage.getItem('viva-return-state')===null"))
  ok('No uncaught script errors',not errors)
  report={'passed':sum(c['passed']for c in checks),'failed':sum(not c['passed']for c in checks),'checks':checks,'limits':'Real original app and adapter, Canvas renderer, controlled in-memory sessionStorage; no public-origin storage or navigation test','success':True}
  (ROOT/'reports/bridge.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));await b.close()
if __name__ == '__main__':
 asyncio.run(main())
