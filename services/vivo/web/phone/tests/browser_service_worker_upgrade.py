"""Retain exact historical v13->v23 assertions, then test v23->v25 on one origin.

The historical test is run unmodified from the pinned parent in an isolated,
temporary Git worktree. The second stage uses its helpers, not copied assertions.
No user storage, existing worktree or running job is touched by this test.
"""
from __future__ import annotations
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
from playwright.sync_api import sync_playwright

BASELINE = '2e25e258021c6b16d2892e98a2b13d40b1e5f5d1'
SCRIPT = 'services/vivo/web/phone/tests/browser_service_worker_upgrade.py'
CURRENT_CACHE = 'vivo-phone-shell-2026-11-08-v25'
NEW_MODULES = ['phone/client.mjs', 'phone/living-encounters.mjs', 'phone/encounter-store.mjs', 'phone/encounter-runtime.mjs']


def run():
    repo = Path(__file__).resolve().parents[5]
    with tempfile.TemporaryDirectory(prefix='vivo-encounter-upgrade-') as temporary:
        old = Path(temporary) / 'v23'
        exists = subprocess.run(['git', 'cat-file', '-e', BASELINE+'^{commit}'], cwd=repo, capture_output=True)
        if exists.returncode:
            subprocess.run(['git', 'fetch', '--no-tags', 'origin', BASELINE], cwd=repo, check=True, capture_output=True)
        subprocess.run(['git', 'worktree', 'add', '--detach', str(old), BASELINE], cwd=repo, check=True, capture_output=True)
        try:
            # This invokes every original historical assertion, not a summary/count substitute.
            historical_run = subprocess.run([sys.executable, str(old / SCRIPT)], cwd=old,
                capture_output=True, text=True, timeout=420)
            if historical_run.returncode:
                raise AssertionError('Historical upgrade failed:\n'+historical_run.stdout+'\n'+historical_run.stderr)
            historical = json.loads(historical_run.stdout)
            spec = importlib.util.spec_from_file_location('vivo_v23_upgrade', old / SCRIPT)
            legacy = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(legacy)
            server = legacy.DeploymentServer(('127.0.0.1', 0), legacy.DeploymentHandler)
            legacy.set_deployment(server, old/'services/vivo/web')
            threading.Thread(target=server.serve_forever, daemon=True).start()
            errors=[]
            try:
                with sync_playwright() as p:
                    executable=os.environ.get('VIVO_CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
                    browser=p.chromium.launch(headless=True, **({'executable_path':executable} if executable else {}))
                    context=browser.new_context()
                    page=context.new_page();page.on('pageerror', lambda e:errors.append(str(e)))
                    route=f'http://127.0.0.1:{server.server_port}{legacy.SCOPE_PATH}phone/'
                    page.goto(route,wait_until='domcontentloaded')
                    page.wait_for_selector('#enterPhoneLocal')
                    page.evaluate('''async()=>{await navigator.serviceWorker.register(new URL('../vivo-sw.js',location.href),{scope:new URL('../',location.href).pathname});await navigator.serviceWorker.ready;}''')
                    page.reload(wait_until='domcontentloaded')
                    page.wait_for_function('!!navigator.serviceWorker.controller')
                    legacy.wait_for_local(page,route)
                    before=legacy.open_and_create_pool(page)
                    initial=legacy.cache_snapshot(page,legacy.V23_CACHE,legacy.V18_TO_V23_ASSERT_PATHS)
                    legacy.assert_exact_cached_assets(initial,legacy.expected_cached_assets(old/'services/vivo/web',legacy.V18_TO_V23_ASSERT_PATHS))
                    legacy.mark_legacy_cache(page,legacy.V23_CACHE,'/* retired v23 client */',['phone/client.mjs'])
                    legacy.set_deployment(server,repo/'services/vivo/web')
                    paths=[*legacy.V18_TO_V23_ASSERT_PATHS,*NEW_MODULES]
                    upgraded=legacy.wait_for_upgrade(page,legacy.V23_CACHE,CURRENT_CACHE,paths)
                    legacy.assert_exact_cached_assets(upgraded,legacy.expected_cached_assets(repo/'services/vivo/web',paths))
                    context.set_offline(True)
                    after=legacy.reopen_pool_offline(page,route,before)
                    for key in ['worldId','eyeId','branchId','availableTumbo','pool']:
                        assert after[key]==before[key],key
                    assert set(before['receiptIds']).issubset(after['receiptIds'])
                    page.wait_for_function('window.VivoLivingEncounters?.status()?.ready')
                    assert page.locator('#phoneEncountersButton').count()==1
                    assert not errors,errors
                    historical['v23ToV25']={'oldCacheRetired':legacy.V23_CACHE not in upgraded['names'],
                        'newCachePresent':CURRENT_CACHE in upgraded['names'],'encounterModulesExact':True,
                        'encountersReadyOffline':True,'worldEyeBranchBalancePoolReceiptsPreserved':True,
                        'historicalSource':BASELINE,'pageErrors':errors}
                    context.close();browser.close()
            finally:
                server.shutdown();server.server_close()
            return historical
        finally:
            # The only removed tree is the temporary detached fixture created above.
            subprocess.run(['git','worktree','remove','--force',str(old)],cwd=repo,check=True,capture_output=True)

if __name__=='__main__':
    print(json.dumps(run(),indent=2))
