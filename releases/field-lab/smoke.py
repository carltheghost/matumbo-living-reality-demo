"""Bounded Chromium checks of the release alias; not physical-device acceptance."""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright


def bounded(page, expression):
    return page.evaluate("async () => Promise.race([(" + expression + ")(), new Promise((_, reject) => setTimeout(() => reject(Error('release probe deadline')), 15000))])")


def main(base, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    with sync_playwright() as p:
        options = {'headless': True}
        if os.environ.get('VIVO_TEST_CHROMIUM'):
            options['executable_path'] = os.environ['VIVO_TEST_CHROMIUM']
        browser = p.chromium.launch(**options)
        for label, viewport in [('phone', {'width': 390, 'height': 844}), ('desktop', {'width': 1440, 'height': 900})]:
            ctx = browser.new_context(viewport=viewport)
            ctx.set_default_timeout(15000)
            ctx.add_init_script("window.cameraCalls=0;navigator.mediaDevices.getUserMedia=async()=>{window.cameraCalls++;throw Error('camera stays off in release smoke')};")
            page = ctx.new_page()
            errors, failed = [], []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('response', lambda r: failed.append(r.url) if r.status >= 400 and not r.url.endswith('/favicon.ico') else None)
            row = {'viewport': label, 'passed': False}
            try:
                print(json.dumps({'viewport': label, 'step': 'open-release'}), flush=True)
                page.goto(base.rstrip('/') + '/Field-Lab.html', wait_until='domcontentloaded')
                page.wait_for_url('**/phone/field-lab-unified.html')
                page.locator('#enterPhoneLocal').click()
                page.wait_for_function('Boolean(window.VivaPhoneEngine?.active)')
                page.wait_for_function("document.querySelector('#phoneFieldStatus').textContent.includes('coordinate planes')")
                assert page.locator('meta[name="vivo-release"]').get_attribute('content') == '2026.10.22'
                assert page.evaluate('window.cameraCalls') == 0
                assert page.locator('text=Choose original Field Lab').count() == 0
                snapshot = bounded(page, 'async () => await window.VivaPhoneEngine.snapshot()')
                assert snapshot['snapshot']['spaces']['root']['entities']['relic']
                print(json.dumps({'viewport': label, 'step': 'worker-ready'}), flush=True)
                page.screenshot(path=str(output / f'{label}-field-lab.png'), full_page=True)
                bounded(page, "async () => {await navigator.serviceWorker.register('../vivo-sw.js',{scope:'../'});await navigator.serviceWorker.ready;return true;}")
                page.wait_for_function('Boolean(navigator.serviceWorker.controller)')
                cached = bounded(page, "async () => {let found=false;for(const k of await caches.keys()){if(k.startsWith('vivo-phone-shell-unified-'))found=Boolean(await (await caches.open(k)).match(location.href));}return found;}")
                assert cached, 'new application alias is not in the offline shell'
                ctx.set_offline(True)
                page.reload(wait_until='domcontentloaded')
                page.locator('#enterPhoneLocal').click()
                page.wait_for_function('Boolean(window.VivaPhoneEngine?.active)')
                assert page.evaluate('window.cameraCalls') == 0
                assert not errors, errors
                assert not failed, failed
                row.update(passed=True, realWorkerStarted=True, newAlias=True, oldFileNotRequired=True, offlineReopen=True, cameraCalls=0)
            except Exception as error:
                row['error'] = str(error)
                try:
                    (output / f'{label}-failure.html').write_text(page.content(), encoding='utf-8')
                    page.screenshot(path=str(output / f'{label}-failure.png'), full_page=True)
                except Exception:
                    pass
            finally:
                row.update(pageErrors=errors, httpFailures=failed)
                rows.append(row)
                print(json.dumps(row), flush=True)
                ctx.close()
        browser.close()
    report = {'scope': 'synthetic Chromium / static browser runtime; not real phone, camera, remote authority or deployment', 'cases': rows}
    (output / 'alias-smoke.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    if not all(row['passed'] for row in rows):
        raise SystemExit('Release alias browser acceptance failed; inspect retained evidence')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
