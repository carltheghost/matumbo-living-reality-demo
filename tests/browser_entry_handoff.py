"""Real Chromium DOM checks; injected engine/URL, not a full application test."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'evidence'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = (ROOT/'src/vivo-phone-engine/boot.mjs').read_text()
HTML = '''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{color-scheme:dark;background:#09151c;color:#e8fff6;font:16px/1.6 system-ui}body{margin:0;padding:20px}main{max-width:610px;margin:auto}.panel{padding:20px;margin:20px 0;background:#10222b;border:1px solid #375863;border-radius:19px}p{color:#bbd3d5}button{width:100%;min-height:54px;border:1px solid #6a9991;border-radius:12px;margin:6px 0;background:#142a33;color:#e8fff6}.badge{font:11px monospace;color:#a4eedc}[hidden]{display:none!important}</style></head><body><main>
<h1>Viva Studio 0.7</h1><p>Legacy launcher fixture, retained below.</p><button id="saved">Open saved Field Lab with Viva 0.7</button><button id="choose">Choose original Field Lab 0.4 file</button><input type="file" id="file" hidden><p id="status">Your saved original app was found.</p></main></body></html>'''
STUB = '''class TestEngine {
 constructor(){this.native={available:()=>false};this.xr={capabilities:()=>({sessionActive:false})};}
 addEventListener(){} async xrCapabilities(){return {apiAvailable:false,supported:{}};}
 async start(){return {webgpu:false};} async checkpoint(){} close(){}
};globalThis.__TestEngine=TestEngine;'''
checks = []
def check(label, condition):
    assert condition, label
    checks.append(label)
with sync_playwright() as p:
    executable=os.environ.get('VIVO_CHROMIUM') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(HTML)
    page.evaluate('() => {' + STUB + '}')
    transformed=SOURCE.replace("import{VivoPhoneEngine}from'./engine.mjs';",'const VivoPhoneEngine=globalThis.__TestEngine;').replace('import.meta.url',json.dumps('https://example.test/matumbo-living-reality-demo/src/vivo-phone-engine/boot.mjs')).replace('location.href',json.dumps('https://example.test/matumbo-living-reality-demo/field-lab-studio.html'))
    page.evaluate('(source) => { new Function(source)(); }',transformed)
    link=page.get_by_role('link',name='Open current Vivo Field Lab')
    check('Current-entry link visible in real Chromium',link.is_visible())
    check('Same-origin repository prefix retained',link.get_attribute('href')=='https://example.test/matumbo-living-reality-demo/services/vivo/web/phone/field-lab.html')
    check('Navigation card is first in main',page.locator('main > :first-child').get_attribute('id')=='vivoCurrentFieldLab')
    check('Old saved and file-picker controls remain',page.locator('#saved').count()==1 and page.locator('#choose').count()==1)
    check('Ordinary accessible link, not a scripted button',link.evaluate('(el)=>el.tagName')=='A')
    box=link.bounding_box();check('Touch target at least 44px high',box['height']>=44)
    check('No mobile horizontal overflow',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    link.focus();check('Keyboard focus visible on entry link',link.evaluate('(el)=>el===document.activeElement && getComputedStyle(el).outlineStyle!=="none"'))
    page.evaluate('''() => { window.__clicked=[];document.querySelector('#vivoCurrentFieldLabLink').addEventListener('click',e=>{e.preventDefault();window.__clicked.push(e.currentTarget.href);}); }''')
    link.press('Enter');check('Keyboard activation selects expected destination',len(page.evaluate('window.__clicked'))==1)
    link.click();check('Pointer activation selects the same destination',page.evaluate('window.__clicked[0]===window.__clicked[1]'))
    check('Migration boundary is displayed',page.get_by_text('Its worlds stay separate',exact=False).is_visible())
    page.screenshot(path=str(OUT/'entry-mobile-component.png'),full_page=True)
    page.set_viewport_size({'width':1280,'height':900})
    check('No desktop horizontal overflow',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    page.screenshot(path=str(OUT/'entry-desktop-component.png'),full_page=True)
    check('No page errors',not errors)
    browser.close()
(OUT/'browser-component.json').write_text(json.dumps({'evidenceClass':'Chromium component, real boot source with injected engine and URL, mocked navigation; not full-app/live/Samsung acceptance','passed':len(checks),'failed':0,'checks':checks,'pageErrors':errors},indent=2)+'\n')
print(json.dumps({'passed':len(checks),'failed':0,'pageErrors':errors}))
