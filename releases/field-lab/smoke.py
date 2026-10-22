"""Browser checks of the assembled alias, not a camera/device acceptance test."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

def main(base, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for label, viewport in [('phone', {'width':390,'height':844}), ('desktop', {'width':1440,'height':900})]:
            ctx = browser.new_context(viewport=viewport)
            ctx.set_default_timeout(15000)
            ctx.add_init_script("navigator.mediaDevices.getUserMedia=async()=>{window.cameraCalls=(window.cameraCalls||0)+1;throw Error('camera stays off in release smoke')};window.cameraCalls=0;")
            page = ctx.new_page()
            errors, failed = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: failed.append(r.url) if r.status>=400 and not r.url.endswith('/favicon.ico') else None)
            print(json.dumps({'viewport': label, 'step': 'open-release'}), flush=True)
            response = page.goto(base.rstrip('/') + '/Field-Lab.html', wait_until='domcontentloaded')
            page.wait_for_url('**/phone/field-lab-unified.html')
            page.locator('#enterPhoneLocal').click()
            page.wait_for_function('Boolean(window.VivaPhoneEngine?.active)')
            page.wait_for_function("document.querySelector('#phoneFieldStatus').textContent.includes('coordinate planes')")
            assert page.locator('meta[name="vivo-release"]').get_attribute('content') == '2026.10.22'
            assert page.evaluate('window.cameraCalls') == 0
            assert page.locator('text=Choose original Field Lab').count() == 0
            snapshot = page.evaluate('async () => await window.VivaPhoneEngine.snapshot()')
            assert snapshot['snapshot']['spaces']['root']['entities']['relic']
            print(json.dumps({'viewport': label, 'step': 'worker-ready'}), flush=True)
            page.screenshot(path=str(output / f'{label}-field-lab.png'), full_page=True)
            page.evaluate("async () => {await navigator.serviceWorker.register('../vivo-sw.js',{scope:'../'});await navigator.serviceWorker.ready;}")
            page.wait_for_function('Boolean(navigator.serviceWorker.controller)')
            cached = page.evaluate("async () => {let found=false;for(const k of await caches.keys()){if(k.startsWith('vivo-phone-shell-unified-'))found=Boolean(await (await caches.open(k)).match(location.href));}return found;}")
            assert cached, 'new application alias is not in the offline shell'
            ctx.set_offline(True)
            page.reload(wait_until='domcontentloaded')
            page.locator('#enterPhoneLocal').click()
            page.wait_for_function('Boolean(window.VivaPhoneEngine?.active)')
            assert page.evaluate('window.cameraCalls') == 0
            assert not errors, errors
            assert not failed, failed
            rows.append({'viewport':label,'realWorkerStarted':True,'newAlias':True,'oldFileNotRequired':True,'offlineReopen':True,'cameraCalls':0,'pageErrors':errors,'httpFailures':failed})
            ctx.close()
        browser.close()
    report = {'scope':'synthetic Chromium / static browser runtime; not real phone, camera, remote authority or deployment','cases':rows}
    (output / 'alias-smoke.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report), flush=True)

if __name__ == '__main__': main(sys.argv[1], sys.argv[2])
