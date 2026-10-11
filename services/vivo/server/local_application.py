"""Canonical local mount of the original 0.8.1 application.

The original app, index, renderer, camera and solver remain exact imported bytes.
Explicit middleware dispatch precedes its catch-all static handler while retaining
its outer security middleware. The only backend transport is a private child pipe.
This launcher is loopback-only, not public multiplayer authentication.
"""
from __future__ import annotations
import argparse
import asyncio
import contextlib
import hashlib
import ipaddress
import json
import math
import re
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit
from aiohttp import web
from .app import make_app, ROOT
from .geometry import Geometry
from .readiness import report as readiness_report
from .authority.module_routes import install_module_routes


def phase_slice_index(value):
    """Map a periodic phase coordinate to the nearest 8-cell index.

    The accepted solver's existing Python ``round`` is ties-to-even. Keep
    that rule explicit and pair it with positive modulo so browser and server
    agree at half steps and negative wrapped coordinates.
    """
    normalized = (float(value) + 4.) % 8
    lower = math.floor(normalized)
    fraction = normalized - lower
    if fraction < .5:
        rounded = lower
    elif fraction > .5:
        rounded = lower + 1
    else:
        rounded = lower if lower % 2 == 0 else lower + 1
    return rounded % 8


def material_observation_view_matches(observed, expected_eye, candidate_eye, entity_id, axes):
    """Keep a root 4D density response paired with its requested Eye only."""
    return bool(
        isinstance(observed, dict)
        and observed.get('entityId') == entity_id
        and observed.get('axes') == list(axes)
        and observed.get('spaceId') == 'root'
        and observed.get('worldDimension') == 4
        and isinstance(expected_eye, dict)
        and expected_eye.get('spaceId') == 'root'
        and expected_eye.get('dimension') == 4
        and isinstance(candidate_eye, dict)
        and candidate_eye.get('spaceId') == expected_eye.get('spaceId') == 'root'
        and candidate_eye.get('dimension') == expected_eye.get('dimension') == 4
        and candidate_eye.get('chart') == expected_eye.get('chart')
        and candidate_eye.get('eyeId') == expected_eye.get('eyeId')
        and candidate_eye.get('actorId') == expected_eye.get('actorId')
        and observed.get('acceptedFieldDigest') == observed.get('materialDigest')
    )


class LocalBridge:
    def __init__(self, path=None, *, phase=False, adaptive=False, remote_actors=False, max_events=65536, store='posix'):
        if store == 'memory':
            if path is not None:
                raise ValueError('Memory store does not accept a data path; session state is process-local only')
            self.path = None
        else:
            self.path = str(Path(path)) if store == 'sqlite' else str(Path(path).resolve())
        self.store = store
        if phase and adaptive: raise ValueError('Choose one material mode')
        self.phase = phase
        self.adaptive = adaptive
        self.remote_actors = bool(remote_actors)
        self.max_events = max_events
        self.process = None
        self.lock = asyncio.Lock()
        self.sequence = 0
        self.capabilities = None

    async def start(self):
        node = shutil.which('node')
        if not node:
            raise RuntimeError('Canonical local mode requires Node.js 22+; SQLite requires Node.js 24.19+ in the Node 24 line')
        command = [node, str(ROOT / 'server/application/runtime.mjs')]
        if self.path is not None:
            command.append(self.path)
        command.extend(['--store', self.store, *(['--phase'] if self.phase else ['--adaptive'] if self.adaptive else []), *(['--remote-actors'] if self.remote_actors else []), '--journal-events', str(self.max_events)])
        self.process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            # Errors go to the operator; protocol output never contains raw tokens.
            stderr=None, limit=64 * 1024 * 1024)
        try:
            ready = json.loads(await asyncio.wait_for(self.process.stdout.readline(), 15))
            if ready.get('initializeMaterial'):
                mode = ready['initializeMaterial']
                if mode == 'phase' and self.phase:
                    from .application.material_host import initialize_phase
                    initializer = initialize_phase
                elif mode == 'adaptive' and self.adaptive:
                    from .application.adaptive_host import initialize_adaptive
                    initializer = initialize_adaptive
                else:
                    raise RuntimeError('Material initializer mode mismatch')
                initialized = await asyncio.to_thread(initializer, ready['snapshot'])
                encoded = (json.dumps(initialized, allow_nan=False, ensure_ascii=False) + '\n').encode('utf-8')
                if len(encoded) > 4 * 1024 * 1024:
                    raise RuntimeError('Material initializer exceeds private allocation bound')
                self.process.stdin.write(encoded)
                await asyncio.wait_for(self.process.stdin.drain(), 15)
                ready = json.loads(await asyncio.wait_for(self.process.stdout.readline(), 15))
            if not ready.get('ready'):
                raise RuntimeError('Canonical authority did not become ready')
            self.capabilities = ready['capabilities']
        except BaseException:
            await self.stop()
            raise

    async def call(self, op, *, token=None, args=None, timeout=12, _material=False):
        if _material and (op not in ('materialCapture', 'materialApply') or token is not None):
            raise RuntimeError('Invalid private material operation')
        received = time.monotonic()
        async with self.lock:
            if not self.process or self.process.returncode is not None:
                raise web.HTTPServiceUnavailable(text='Canonical authority unavailable; restart the local app')
            self.sequence += 1
            ident = self.sequence
            message = {'id': ident, 'op': op, 'args': args or {}, 'queueAgeMs': (time.monotonic() - received) * 1000}
            if token is not None:
                message['token'] = token
            try:
                encoded = (json.dumps(message, allow_nan=False, ensure_ascii=False) + '\n').encode('utf-8')
            except (ValueError, UnicodeError, TypeError):
                raise web.HTTPBadRequest(text='Invalid private-pipe JSON data')
            limit = 4 * 1024 * 1024 if _material else 64 * 1024
            if len(encoded) > limit:
                raise web.HTTPRequestEntityTooLarge(max_size=limit, actual_size=len(encoded))
            async def exchange():
                self.process.stdin.write(encoded)
                await self.process.stdin.drain()
                return await self.process.stdout.readline()
            try:
                raw = await asyncio.wait_for(exchange(), timeout)
                response = json.loads(raw)
                if response.get('id') != ident:
                    raise RuntimeError('Authority response mismatch')
            except asyncio.CancelledError:
                # Cancellation while an exchange is in flight can leave its reply
                # unread. Never let a later request consume that stale receipt.
                if self.process.returncode is None:
                    self.process.kill()
                    await self.process.wait()
                raise
            except (ValueError, RuntimeError, BrokenPipeError, ConnectionError, asyncio.TimeoutError):
                # Never read a late response as another request's receipt. Kill this
                # uncertain process; a restart invalidates process-local capabilities.
                if self.process.returncode is None:
                    self.process.kill()
                    await self.process.wait()
                raise web.HTTPServiceUnavailable(text='Authority outcome uncertain; restart and inspect saved state')
            if not response.get('ok'):
                error = response.get('error', {})
                return web.json_response({'error': error.get('code', 'AUTHORITY_FAILED')}, status=409)
            return response['result']

    async def material_call(self, op, *, args):
        result = await self.call(op, args=args, _material=True)
        if isinstance(result, web.StreamResponse):
            code = json.loads(result.text)['error']
            error = RuntimeError(code)
            error.code = code
            raise error
        return result

    async def stop(self):
        proc = self.process
        if not proc or proc.returncode is not None:
            return
        # No new HTTP work is admitted during shutdown. Let accepted writes finish.
        try:
            await self.call('shutdown')
            await asyncio.wait_for(proc.wait(), 5)
        except BaseException:
            if proc.returncode is None:
                proc.terminate()
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(proc.wait(), 3)
            if proc.returncode is None:
                proc.kill()
                await proc.wait()


def require_local(request, *, mutation=False):
    try:
        peer = ipaddress.ip_address(request.remote or '')
        host = urlsplit('http://' + request.host).hostname
        host_ok = host == 'localhost' or ipaddress.ip_address(host).is_loopback
    except ValueError:
        host_ok = host == 'localhost' if 'host' in locals() else False
        peer = None
    if peer is None or not peer.is_loopback or not host_ok:
        raise web.HTTPForbidden(text='Canonical mode is available only on this computer through localhost')
    expected = request.scheme + '://' + request.host
    origin = request.headers.get('Origin')
    if (mutation and origin != expected) or (origin is not None and origin != expected):
        raise web.HTTPForbidden(text='Same-origin localhost request required')
    if request.headers.get('Sec-Fetch-Site') == 'cross-site':
        raise web.HTTPForbidden(text='Cross-site access refused')


def local_index(*, phase=False, adaptive=False, store='posix'):
    source = (ROOT / 'web/index.html').read_bytes()
    marker = '<script type="module" src="shared.js"></script>'
    text = source.decode('utf-8')
    if text.count(marker) != 1:
        raise RuntimeError('Imported application bootstrap changed; review the local mount')
    text = text.replace('<head>', '<head><base href="/">', 1)
    text = text.replace('</head>', '<link rel="icon" href="data:,"></head>', 1)
    text = text.replace('<html lang="en">',
                        f'<html lang="en" data-vivo-store="{store}" data-vivo-stage="accepted-preview" data-vivo-phase="{str(phase).lower()}">', 1)
    text = text.replace(marker, '<script type="module" src="/application/bootstrap.mjs"></script>')
    text = text.replace('</head>', '<link rel="stylesheet" href="/application/local.css"></head>', 1)
    stage_label = 'ACCEPTED PHASE PREVIEW · BACKEND STAGE' if phase else 'ACCEPTED BACKEND PREVIEW · BACKEND STAGE'
    text = text.replace('SHARED WORKSHOP · 0.8.1', stage_label)
    text = text.replace('Meet inside<br>the mathematics.', 'One saved world.<br>Two independent Eyes.')
    text = text.replace('Move the same objects with another person. Explore curved spaces. Watch a learned local rule grow a guidance field.',
        'Open one of two local seats. Explore saved spatial coordinates and nested space. Grip targets are accepted constraints; material motion and learning are not connected yet.')
    text = text.replace('Create a room or join with an invitation.', 'Accepted backend preview. Open one of two local seats.')
    text = text.replace('Checking the shared server…', 'Checking the local Python + Node application…')
    text = text.replace('Create shared space', 'Open local seat')
    if store == 'memory':
        text = text.replace('One saved world.<br>Two independent Eyes.', 'One session-only world.<br>Two independent Eyes.')
        text = text.replace('Explore saved spatial coordinates and nested space.', 'Explore session coordinates and nested space.')
        text = text.replace('Open local seat', 'Open session-only seat')
    if phase:
        text = text.replace('Grip targets are accepted constraints; material motion and learning are not connected yet.',
            'Experimental 4D phase material is connected. Press Run phase in '+('Session state' if store == 'memory' else 'Saved state')+' to advance the bounded numerical model; 11D material and learning remain unavailable.')
    elif adaptive:
        text = text.replace('Grip targets are accepted constraints; material motion and learning are not connected yet.',
            'Learned adaptive graph material is connected in the 4D root and 11D inner world. Accepted grips drive the versioned neural edge law; time remains separate.')
    return source, text


def studio_index():
    """Return the preserved Studio as the primary local surface.

    The imported Studio bytes remain untouched on disk.  Only the local mount
    adds a base URL and an explicit link to the separate accepted-phase
    backend preview; neither route silently synchronizes the two state models.
    """
    source = (ROOT / 'web/studio-original.html').read_bytes()
    text = source.decode('utf-8')
    if not text.startswith('<!DOCTYPE html>') or text.count('</body>') != 1:
        raise RuntimeError('Imported Studio changed; review the local mount')
    text = text.replace('<head>', '<head><base href="/">', 1)
    text = text.replace('</head>', '<link rel="icon" href="data:,"></head>', 1)
    bridge_style = '''<style id="vivoLocalEntryStyle">
#vivoLocalEntry{position:fixed;right:180px;top:80px;z-index:120;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 24px);padding:6px 8px;border:1px solid rgba(148,235,220,.30);border-radius:9px;background:rgba(8,19,25,.88);backdrop-filter:blur(14px);font:10px ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.04em;color:#9db8b9;box-shadow:0 8px 24px rgba(0,0,0,.18)}
#vivoLocalEntry span{color:#a9eadc}
#vivoLocalEntry a{color:#c9eee6;text-decoration:none;border:1px solid rgba(148,235,220,.32);border-radius:6px;padding:6px 8px;white-space:nowrap}
#vivoLocalEntry a:hover,#vivoLocalEntry a:focus-visible{background:#173a3a;color:#fff;outline:2px solid #94ebdc;outline-offset:2px}
#vivoStudioTools,#vivoStudioToolsDrawer{display:none}
@media(max-width:820px){#vivoLocalEntry{top:122px;right:12px;font-size:9px}#vivoLocalEntry span{display:none}#vivoLocalEntry a{padding:4px 6px}}
@media(max-width:820px) and (orientation:portrait){
 #vivaLightHud{left:12px!important;right:12px!important;bottom:calc(245px + 58px + 10px + env(safe-area-inset-bottom))!important;max-width:none!important}
}
@media(min-width:821px) and (max-height:610px){
 #vivoLocalEntry{top:70px;right:180px}
 #studioOpen{top:70px!important;right:12px!important}
 #studioBadge{top:74px!important;left:12px!important}
 .experiment{display:none!important}
 .left-head{left:12px!important;top:112px!important;width:220px!important}
 .left-head h1,.left-head>p,.left-head .search-box,.left-head .side-tabs,.left-head .view-lenses,.left-head .parent-button{display:none!important}
 .left-head .eyebrow{display:none!important}
 #vivaBar{left:12px!important;right:auto!important;top:112px!important;width:225px!important;max-width:225px!important;flex-wrap:wrap}
 #vivaBar button{flex:1 1 45%;min-height:34px!important;padding:6px 7px!important;font-size:10px!important}
 #vivaMessage{display:none!important}
 #vivaLightOpen{left:12px!important;right:auto!important;top:254px!important;min-height:34px!important}
 #cameraLaunch{left:250px!important;right:auto!important;top:216px!important;bottom:auto!important;transform:none!important;min-width:174px}
 #vivaLightHud{left:250px!important;right:12px!important;top:280px!important;bottom:auto!important;max-width:390px!important}
 .touch-state{left:250px!important;right:auto!important;top:103px!important;transform:none!important;max-width:390px!important}
 .touch-bar{left:12px!important;right:auto!important;bottom:16px!important;width:230px!important}
 .bottom-stats,.system-note{display:none!important}
 .bottom-center{left:250px!important;right:12px!important;transform:none!important;bottom:24px!important}
 .bottom-center .toolbar{justify-content:flex-start;gap:2px}
 .bottom-center .toolbar button{padding:7px 8px!important;font-size:10px!important}
 .bottom-center .toolbar .optional{display:none!important}
 .inspector{top:120px!important;right:12px!important;width:232px!important;height:190px!important;max-height:190px!important;overflow-y:auto!important}
 #vivoStudioTools{display:block;position:fixed;left:12px;top:300px;z-index:35;min-height:38px;padding:7px 10px;border:1px solid #6e9f98;border-radius:9px;background:#102b34;color:#d6f1e8;font:11px ui-monospace,SFMono-Regular,Consolas,monospace}
 #vivoStudioToolsDrawer{display:block;position:fixed;left:12px;top:92px;z-index:36;width:225px;max-height:290px;overflow:auto;padding:10px;border:1px solid #6e9f98;border-radius:11px;background:#081820f5;box-shadow:0 14px 40px #0009;font:11px system-ui;color:#d6ebe5}
 #vivoStudioToolsDrawer[hidden]{display:none!important}
 #vivoStudioToolsDrawer .vivo-tools-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;color:#a9eadc;font-weight:600}
 #vivoStudioToolsDrawer .vivo-tools-head button{min-height:28px;padding:3px 8px}
 #vivoStudioToolsDrawer input{width:100%;min-height:34px;padding:6px 8px;margin-bottom:7px;border:1px solid #405e64;border-radius:7px;background:#102730;color:#e1f1eb;font:11px system-ui}
 #vivoStudioToolsDrawer .vivo-tools-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:5px 0}
 #vivoStudioToolsDrawer button{min-height:32px;padding:5px 6px;border:1px solid #405e64;border-radius:7px;background:#102b34;color:#d6ebe5;font:10px system-ui}
 #vivoStudioToolsDrawer button:hover,#vivoStudioToolsDrawer button:focus-visible{border-color:#94ebdc;outline:2px solid #94ebdc;outline-offset:1px}
 #vivoStudioToolsDrawer .vivo-tools-wide{width:100%;margin-top:5px}
}
@media(min-width:821px) and (min-height:611px){
 #vivaBar{left:37px!important;right:auto!important;top:470px!important;max-width:250px!important;flex-wrap:wrap}
 #vivaBar button{flex:1 1 45%;min-height:36px!important;padding:7px 8px!important;font-size:11px!important}
 #vivaMessage{display:none!important}
 #vivaLightHud{left:37px!important;right:auto!important;top:566px!important;bottom:auto!important;max-width:250px!important}
}
</style>'''
    asset_bridge = '''<script id="vivoLocalAssetBridge">(function(){
  const origin=location.origin,assets=Object.freeze({bundle:new URL('/vendor/field-lab/vision_bundle.mjs',origin).href,wasm:new URL('/vendor/field-lab/wasm',origin).href,model:new URL('/vendor/field-lab/hand_landmarker.task',origin).href});
  window.FieldHandAssets=assets;
  const trace=window.__vivoCameraAssetTrace={loadVisionCalls:0,modelBytesCalls:[],cameraPresencePatched:false};
  const headMessage='Head pointer unavailable on the local Studio route: no face landmarker model is vendored.';
  const CameraPresence=window.CameraPresence;
  if(CameraPresence?.prototype){
   trace.cameraPresencePatched=true;
   const originalModelBytes=CameraPresence.prototype.modelBytes;
   const originalUpdateButtons=CameraPresence.prototype.updateButtons;
   const gateHead=()=>{const button=document.getElementById('trackHead'),center=document.getElementById('centerHead');if(button){button.disabled=true;button.textContent='Head unavailable · no local face model';button.title=headMessage;button.setAttribute('aria-label',headMessage);}if(center){center.disabled=true;center.textContent='Center unavailable';center.title=headMessage;center.setAttribute('aria-label',headMessage);}};
   CameraPresence.prototype.updateButtons=function(){originalUpdateButtons.call(this);gateHead();};
   gateHead();
   CameraPresence.prototype.loadVision=async function(){
    trace.loadVisionCalls++;
    const response=await fetch(assets.bundle,{method:'HEAD',signal:AbortSignal.timeout(2500)});
    if(!response.ok||!/javascript|ecmascript/.test(response.headers.get('content-type')||''))throw Error('Local vision runtime returned HTTP '+response.status+'.');
    const vision=await import(assets.bundle);this.assetSource='vendored field-lab';return{vision,wasm:assets.wasm,local:'field-lab'};
   };
   CameraPresence.prototype.modelBytes=async function(kind,local,signal){
    trace.modelBytesCalls.push(kind);
    if(local==='field-lab'){
     if(kind!=='hand')throw Error(headMessage);
     const response=await fetch(assets.model,{signal});
     if(!response.ok)throw Error('Local hand model returned HTTP '+response.status+'.');
     if((response.headers.get('content-type')||'').includes('text/html'))throw Error('Local hand model returned a webpage.');
     const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>32*1024*1024)throw Error('Unexpected local model size.');return bytes;
    }
    return originalModelBytes.call(this,kind,local,signal);
   };
  }
 })();</script>'''
    entry = '''<nav id="vivoLocalEntry" aria-label="Vivo local surfaces">
  <span>PRIMARY · FULL STUDIO</span>
  <a href="/local/accepted/" target="_blank" rel="noopener noreferrer" aria-label="Open accepted phase preview in a new tab">Accepted phase preview ↗</a>
 </nav>
 <button id="vivoStudioTools" type="button" aria-expanded="false">Studio tools</button>
 <aside id="vivoStudioToolsDrawer" hidden aria-label="Compact Studio tools">
  <div class="vivo-tools-head"><span>STUDIO TOOLS</span><button id="vivoStudioToolsClose" type="button">Close</button></div>
  <input id="vivoStudioSearch" type="search" placeholder="Find a pattern…" aria-label="Find a landmark">
  <div class="vivo-tools-grid" aria-label="Field visualization">
   <button type="button" data-vivo-mode="field">Field</button><button type="button" data-vivo-mode="network">Network</button><button type="button" data-vivo-mode="memory">Memory</button>
  </div>
  <div class="vivo-tools-grid" aria-label="Camera projection">
   <button type="button" data-vivo-lens="2">2D</button><button type="button" data-vivo-lens="3">3D</button><button type="button" data-vivo-lens="all">All axes</button>
  </div>
  <button id="vivoStudioParent" class="vivo-tools-wide" type="button">↶ Return to parent checkpoint</button>
  <button id="vivoStudioExperiment" class="vivo-tools-wide" type="button">Run learning experiment ↗</button>
 </aside>
 <script>(function(){const toggle=document.getElementById('vivoStudioTools'),drawer=document.getElementById('vivoStudioToolsDrawer'),close=document.getElementById('vivoStudioToolsClose');if(!toggle||!drawer)return;const setOpen=open=>{drawer.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'Close tools':'Studio tools';};toggle.addEventListener('click',()=>setOpen(drawer.hidden));close?.addEventListener('click',()=>setOpen(false));const click=selector=>document.querySelector(selector)?.click();document.querySelectorAll('[data-vivo-mode]').forEach(button=>button.addEventListener('click',()=>{click('[data-mode="'+button.dataset.vivoMode+'"]');}));document.querySelectorAll('[data-vivo-lens]').forEach(button=>button.addEventListener('click',()=>{click('[data-lens="'+button.dataset.vivoLens+'"]');}));document.getElementById('vivoStudioParent')?.addEventListener('click',()=>click('#parentBranch'));document.getElementById('vivoStudioExperiment')?.addEventListener('click',()=>{click('#experimentButton');setOpen(false);});const original=document.getElementById('search'),search=document.getElementById('vivoStudioSearch');search?.addEventListener('input',()=>{if(!original)return;original.value=search.value;original.dispatchEvent(new Event('input',{bubbles:true}));});})();</script>'''
    text = text.replace('</head>', bridge_style + '</head>', 1)
    text = text.replace('</body>', asset_bridge + entry + '</body>', 1)
    return source, text


def make_local_app(data_dir=None, *, phase=False, adaptive=False, max_events=65536, store='posix'):
    if phase and adaptive: raise ValueError('Choose one material mode')
    if store not in ('posix', 'sqlite', 'memory'):
        raise ValueError('Choose store posix, sqlite or memory')
    if store == 'memory' and data_dir is not None:
        raise ValueError('Memory store does not accept --data-dir; session state is process-local only')
    if store == 'posix' and sys.platform == 'win32':
        raise RuntimeError('Native Windows persistence is unsupported: directory fsync fails. A reviewed compatible store is required; no writes were started.')
    directory = None if store == 'memory' else (Path(data_dir) if store == 'sqlite' else Path(data_dir if data_dir is not None else ROOT / 'data/canonical-local').resolve())
    if store == 'memory':
        app = make_app(':memory:')
    elif store == 'sqlite':
        if not directory.is_absolute() or not directory.is_dir():
            raise ValueError('SQLite requires an existing absolute private directory outside the checkout')
        # Keep the supplied path intact: Node must inspect every ancestor/reparse
        # point and the strict Windows DACL BEFORE any persistent write.
        if directory.is_relative_to(ROOT.parents[1].resolve()):
            raise ValueError('SQLite data must stay outside the entire checkout')
        app = make_app(':memory:')
    else:
        if directory.is_relative_to((ROOT / 'web').resolve()):
            raise ValueError('Local data must stay outside the web directory')
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        app = make_app(directory / 'comparison.sqlite')
    label = 'phase' if phase else 'adaptive' if adaptive else 'world'
    checkpoint = None if store == 'memory' else ('canonical-' + label) + ('.sqlite' if store == 'sqlite' else '.json')
    bridge = LocalBridge(None if checkpoint is None else directory / checkpoint, phase=phase, adaptive=adaptive, max_events=max_events, store=store)
    material_host = None
    if phase:
        from .application.material_host import PhaseApplicationHost
        material_host = PhaseApplicationHost(bridge.material_call)
    elif adaptive:
        from .application.adaptive_host import AdaptiveApplicationHost
        material_host = AdaptiveApplicationHost(bridge.material_call)
    app['local_bridge'] = bridge
    app['local_data_dir'] = directory
    app['material_host'] = material_host
    mounted = web.Application()
    install_module_routes(mounted, ROOT.parents[1])

    def annotate_material(capabilities):
        status = material_host.status() if material_host else None
        if status and isinstance(capabilities, dict) and isinstance(capabilities.get('material'), dict):
            requested = capabilities['material']['running']
            capabilities['material']['requestedRunning'] = requested
            capabilities['material']['running'] = requested and status['running']
        return status

    async def synchronize_material_host(result):
        """Fence the private Python pump when Node observes the last seat gone.

        The Node authority owns the accepted running flag and its idle/session
        sweep can change that flag without an HTTP materialRun request. Keep
        the Python host in the same paused state before exposing a response;
        the host also treats a private MATERIAL_PAUSED reply as this normal
        lifecycle transition for the interval between requests.
        """
        if not material_host or not isinstance(result, dict):
            return
        state = result.get('state')
        capabilities = state.get('capabilities') if isinstance(state, dict) else result.get('capabilities')
        material = capabilities.get('material') if isinstance(capabilities, dict) else None
        if isinstance(material, dict) and material.get('running') is False and material_host.status()['running']:
            await material_host.set_running(False)

    async def root(request):
        require_local(request)
        raise web.HTTPFound('/local/')

    async def index(request):
        require_local(request)
        original, html = studio_index()
        return web.Response(text=html, content_type='text/html', headers={
            'X-Vivo-Original-Studio-SHA256': hashlib.sha256(original).hexdigest(),
            'X-Vivo-Application': 'canonical-local-studio-1',
        })

    async def accepted_preview(request):
        require_local(request)
        original, html = local_index(phase=phase, adaptive=adaptive, store=store)
        return web.Response(text=html, content_type='text/html', headers={
            'X-Vivo-Imported-Index-SHA256': hashlib.sha256(original).hexdigest(),
            'X-Vivo-Application': 'canonical-local-accepted-preview-1',
        })

    async def legacy(request):
        return web.FileResponse(ROOT / 'web/index.html')

    async def ready(request):
        require_local(request)
        alive = bridge.process is not None and bridge.process.returncode is None
        detail = None
        if alive:
            try:
                detail = await bridge.call('ready', timeout=2)
                alive = isinstance(detail, dict) and detail.get('ok') is True
            except web.HTTPException:
                alive = False
        try:
            python_ok = app['hub'].store.db.execute('SELECT 1').fetchone() == (1,)
        except Exception:
            python_ok = False
        # Service readiness is never material, physical-device or public certification.
        baseline = readiness_report(app['hub'], ROOT)
        ok = alive and python_ok and baseline['ok']
        if isinstance(detail, dict):
            await synchronize_material_host(detail)
            annotate_material(detail.get('capabilities'))
        return web.json_response({**baseline, 'ok': ok, 'mode': 'canonical-local',
            'node': alive, 'python': python_ok, 'legacyComparisonPersistence': 'volatile memory' if store in ('sqlite', 'memory') else 'SQLite file',
            'canonicalPersistence': 'session-only volatile memory' if store == 'memory' else 'durable checkpoint',
            'capabilities': detail.get('capabilities') if isinstance(detail, dict) else bridge.capabilities,
            'materialHost': material_host.status() if material_host else None,
            'journal': detail.get('journal') if isinstance(detail, dict) else None,
            'physicalDeviceValidated': False, 'publicDeploymentVerified': False,
            'importedIndexSHA256': hashlib.sha256((ROOT / 'web/index.html').read_bytes()).hexdigest()},
            status=200 if ok else 503)

    grids = {d: Geometry('flat', d).sample_grid() for d in (4, 11)}

    async def grid(request):
        require_local(request)
        try:
            dimension = int(request.query.get('dimension', '4'))
            value = grids[dimension]
        except (ValueError, KeyError):
            raise web.HTTPBadRequest(text='This mounted stage supports flat 4D and 11D spaces')
        return web.json_response(value)

    async def rpc(request):
        require_local(request, mutation=True)
        if request.content_type != 'application/json':
            raise web.HTTPUnsupportedMediaType(text='Use JSON')
        data = await request.json(loads=lambda text: json.loads(text, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON'))))
        if not isinstance(data, dict):
            raise web.HTTPBadRequest(text='Expected JSON object')
        if request.path.endswith('/open'):
            if set(data) - {'seat', 'resumeToken', 'readOnly'}:
                raise web.HTTPBadRequest(text='Unexpected admission fields')
            if data.get('seat') not in ('one', 'two'):
                raise web.HTTPBadRequest(text='Choose local seat one or two')
            if 'readOnly' in data and type(data['readOnly']) is not bool:
                raise web.HTTPBadRequest(text='readOnly must be boolean')
            if 'resumeToken' in data and (not isinstance(data['resumeToken'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', data['resumeToken'])):
                raise web.HTTPBadRequest(text='Invalid local resume token')
            result = await bridge.call('open', args=data)
        else:
            if set(data) - {'op', 'args'} or not isinstance(data.get('op'), str) or data['op'] not in ('state', 'submit', 'moveEye', 'inspectLease', 'renewLease', 'reconcileLease', 'close', 'export', 'nextEpoch', 'materialRun', 'materialObserve'):
                raise web.HTTPBadRequest(text='Unsupported operation')
            header = request.headers.get('Authorization', '')
            if not header.startswith('Bearer ') or not 20 <= len(header[7:]) <= 256:
                raise web.HTTPUnauthorized(text='Local session required')
            if data['op'] == 'materialObserve':
                if material_host is None:
                    return web.json_response({'error': 'MATERIAL_UNAVAILABLE'}, status=409)
                args = data.get('args', {})
                if not isinstance(args, dict) or set(args) != {'entityId', 'axes'}:
                    raise web.HTTPBadRequest(text='materialObserve requires entityId and axes')
                entity_id, axes = args['entityId'], args['axes']
                if (not isinstance(entity_id, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', entity_id)
                        or not isinstance(axes, list) or len(axes) != 2
                        or any(type(axis) is not int or not 0 <= axis < 4 for axis in axes)
                        or len(set(axes)) != 2):
                    raise web.HTTPBadRequest(text='materialObserve expects two distinct phase axes')
                current = await bridge.call('state', token=header[7:], args={})
                if isinstance(current, web.StreamResponse):
                    return current
                current_state = current.get('state') if isinstance(current, dict) else None
                eye = current_state.get('eye') if isinstance(current_state, dict) else None
                snapshot = current_state.get('snapshot') if isinstance(current_state, dict) else None
                capabilities = current_state.get('capabilities') if isinstance(current_state, dict) else None
                phase = capabilities.get('material') if isinstance(capabilities, dict) else None
                if (not isinstance(eye, dict) or eye.get('spaceId') != 'root'
                        or not isinstance(snapshot, dict) or not isinstance(phase, dict)
                        or phase.get('dimension') != 4 or phase.get('resolution') != [8, 8, 8, 8]):
                    raise web.HTTPConflict(text='Material density is only available in the accepted root phase space')
                try:
                    root_space = snapshot['spaces']['root']
                    entity = root_space['entities'][entity_id]
                    if not isinstance(entity, dict):
                        raise KeyError(entity_id)
                    q = eye.get('q')
                    eye_slice = eye.get('slice', {})
                    if not isinstance(q, list) or len(q) != 4 or not isinstance(eye_slice, dict):
                        raise ValueError('MATERIAL_VIEW_FIXED')
                    fixed = {}
                    for axis in range(4):
                        if axis in axes:
                            continue
                        value = eye_slice.get('x'+str(axis + 1), q[axis])
                        if type(value) not in (int, float) or not (value == value and abs(value) < 1e9):
                            raise ValueError('MATERIAL_VIEW_FIXED')
                        fixed[axis] = phase_slice_index(value)
                    aligned_state = None
                    for _ in range(3):
                        observed = await material_host.observe(entity_id, axes, fixed)
                        aligned = await bridge.call('state', token=header[7:], args={})
                        if isinstance(aligned, web.StreamResponse):
                            return aligned
                        candidate = aligned.get('state') if isinstance(aligned, dict) else None
                        candidate_hash = (candidate.get('snapshot', {}).get('spaces', {}).get('root', {})
                                          .get('field', {}).get('hash')) if isinstance(candidate, dict) else None
                        candidate_snapshot = candidate.get('snapshot') if isinstance(candidate, dict) else None
                        candidate_eye = candidate.get('eye') if isinstance(candidate, dict) else None
                        candidate_fixed = {}
                        if isinstance(candidate_eye, dict) and isinstance(candidate_eye.get('q'), list):
                            candidate_slice = candidate_eye.get('slice', {})
                            for axis in range(4):
                                if axis in axes:
                                    continue
                                value = candidate_slice.get('x'+str(axis + 1), candidate_eye['q'][axis])
                                candidate_fixed[axis] = phase_slice_index(value)
                        consistent = (isinstance(candidate_snapshot, dict)
                                      and observed.get('acceptedSequence') == candidate_snapshot.get('acceptedSequence')
                                      and observed.get('acceptedStateHash') == candidate_snapshot.get('stateHash')
                                      and material_observation_view_matches(observed, eye, candidate_eye, entity_id, axes)
                                      and candidate_fixed == fixed)
                        if candidate_hash == observed.get('materialDigest') and consistent:
                            aligned_state = candidate
                            break
                    if aligned_state is None:
                        return web.json_response({'error': 'MATERIAL_VIEW_RACE'}, status=409)
                except KeyError as error:
                    raise web.HTTPBadRequest(text='Unknown accepted phase entity') from error
                except Exception as error:
                    code = getattr(error, 'code', None)
                    if code:
                        return web.json_response({'error': code}, status=409)
                    if isinstance(error, ValueError):
                        raise web.HTTPBadRequest(text='Invalid accepted phase observation') from error
                    raise
                result = {'value': observed, 'state': aligned_state}
                result['state']['materialHost'] = annotate_material(result['state'].get('capabilities'))
                return web.json_response(result)
            if material_host and data['op'] == 'materialRun' and isinstance(data.get('args'), dict) and data['args'].get('running') is True and material_host.status()['fault']:
                return web.json_response({'error': 'MATERIAL_HOST_RESTART_REQUIRED'}, status=409)
            result = await bridge.call(data['op'], token=header[7:], args=data.get('args', {}))
            if material_host and data['op'] == 'materialRun' and isinstance(result, dict):
                try:
                    await material_host.set_running(result['value']['running'])
                except Exception:
                    # The authority flag may have been accepted before the
                    # private host rejected it. Restore the node-side flag so
                    # a fault cannot leave the two runtimes disagreeing.
                    if result['value'].get('running') is True:
                        with contextlib.suppress(Exception):
                            await bridge.call('materialRun', token=header[7:], args={'running': False})
                    raise
        if material_host and isinstance(result, dict) and isinstance(result.get('state'), dict):
            await synchronize_material_host(result)
            result['state']['materialHost'] = annotate_material(result['state'].get('capabilities'))
        return result if isinstance(result, web.StreamResponse) else web.json_response(result)

    mounted.router.add_get('/', root)
    mounted.router.add_get('/local/', index)
    mounted.router.add_get('/local/accepted/', accepted_preview)
    mounted.router.add_get('/legacy', legacy)
    mounted.router.add_get('/api/local/ready', ready)
    mounted.router.add_get('/readyz', ready)
    mounted.router.add_get('/api/local/grid', grid)
    mounted.router.add_post('/api/local/open', rpc)
    mounted.router.add_post('/api/local/rpc', rpc)
    reserved = {resource.canonical for resource in mounted.router.resources()}
    mounted.router.freeze()

    @web.middleware
    async def dispatch(request, handler):
        if request.path not in reserved:
            return await handler(request)
        match = await mounted.router.resolve(request)
        if match.http_exception:
            raise match.http_exception
        return await match.handler(request)

    # make_app's security middleware stays first/outermost and wraps this dispatcher.
    app.middlewares.append(dispatch)
    async def start(_):
        await bridge.start()
        try:
            if material_host:
                await material_host.start()
        except BaseException:
            await bridge.stop()
            raise
    async def stop(_):
        if material_host:
            await material_host.stop()
        await bridge.stop()
    app.on_startup.append(start)
    app.on_shutdown.append(stop)
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--journal-events', type=int, default=65536, help='Retained event capacity (12–65536); default 65536 with cleanup reserve')
    parser.add_argument('--store', choices=('posix', 'sqlite', 'memory'), default='posix', help='Explicit canonical backend; memory is session-only and rejects --data-dir; SQLite needs Node 24.19+ in the Node 24 line and an existing private directory outside the checkout')
    parser.add_argument('--material-phase', action='store_true', help='Explicit experimental 4D phase mode with separate checkpoint; initially paused')
    parser.add_argument('--material-adaptive', action='store_true', help='Learned adaptive graph material across the 4D root and 11D inner space; initially paused')
    parser.add_argument('--data-dir', type=Path, default=None)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('Port must be between 1 and 65535')
    web.run_app(make_local_app(args.data_dir, phase=args.material_phase, adaptive=args.material_adaptive, max_events=args.journal_events, store=args.store), host='127.0.0.1', port=args.port, access_log=None)


if __name__ == '__main__':
    main()
