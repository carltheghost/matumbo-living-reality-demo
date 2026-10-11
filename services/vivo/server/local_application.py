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


class LocalBridge:
    def __init__(self, path, *, phase=False, max_events=65536, store='posix'):
        self.path = str(Path(path)) if store == 'sqlite' else str(Path(path).resolve())
        self.store = store
        self.phase = phase
        self.max_events = max_events
        self.process = None
        self.lock = asyncio.Lock()
        self.sequence = 0
        self.capabilities = None

    async def start(self):
        node = shutil.which('node')
        if not node:
            raise RuntimeError('Canonical local mode requires Node.js 22+; SQLite requires Node.js 24.19+ in the Node 24 line')
        self.process = await asyncio.create_subprocess_exec(
            node, str(ROOT / 'server/application/runtime.mjs'), self.path, '--store', self.store, *(['--phase'] if self.phase else []), '--journal-events', str(self.max_events),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            # Errors go to the operator; protocol output never contains raw tokens.
            stderr=None, limit=64 * 1024 * 1024)
        try:
            ready = json.loads(await asyncio.wait_for(self.process.stdout.readline(), 15))
            if ready.get('initializePhase') and self.phase:
                from .application.material_host import initialize_phase
                initialized = await asyncio.to_thread(initialize_phase, ready['snapshot'])
                encoded = (json.dumps(initialized, allow_nan=False, ensure_ascii=False) + '\n').encode('utf-8')
                if len(encoded) > 4 * 1024 * 1024:
                    raise RuntimeError('Phase initializer exceeds private allocation bound')
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


def local_index(*, phase=False):
    source = (ROOT / 'web/index.html').read_bytes()
    marker = '<script type="module" src="shared.js"></script>'
    text = source.decode('utf-8')
    if text.count(marker) != 1:
        raise RuntimeError('Imported application bootstrap changed; review the local mount')
    text = text.replace('<head>', '<head><base href="/">', 1)
    text = text.replace(marker, '<script type="module" src="/application/bootstrap.mjs"></script>')
    text = text.replace('</head>', '<link rel="stylesheet" href="/application/local.css"></head>', 1)
    text = text.replace('SHARED WORKSHOP · 0.8.1', 'CANONICAL LOCAL · APPLICATION STAGE')
    text = text.replace('Meet inside<br>the mathematics.', 'One saved world.<br>Two independent Eyes.')
    text = text.replace('Move the same objects with another person. Explore curved spaces. Watch a learned local rule grow a guidance field.',
        'Open one of two local seats. Explore saved spatial coordinates and nested space. Grip targets are accepted constraints; material motion and learning are not connected yet.')
    text = text.replace('Checking the shared server…', 'Checking the local Python + Node application…')
    text = text.replace('Create shared space', 'Open local seat')
    if phase:
        text = text.replace('Grip targets are accepted constraints; material motion and learning are not connected yet.',
            'Experimental 4D phase material is connected. Press Run phase in Saved state to advance the bounded numerical model; 11D material and learning remain unavailable.')
    return source, text


def make_local_app(data_dir, *, phase=False, max_events=65536, store='posix'):
    if store not in ('posix', 'sqlite'):
        raise ValueError('Choose store posix or sqlite')
    if store == 'posix' and sys.platform == 'win32':
        raise RuntimeError('Native Windows persistence is unsupported: directory fsync fails. A reviewed compatible store is required; no writes were started.')
    directory = Path(data_dir) if store == 'sqlite' else Path(data_dir).resolve()
    if store == 'sqlite':
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
    checkpoint = ('canonical-phase' if phase else 'canonical-world') + ('.sqlite' if store == 'sqlite' else '.json')
    bridge = LocalBridge(directory / checkpoint, phase=phase, max_events=max_events, store=store)
    material_host = None
    if phase:
        from .application.material_host import PhaseApplicationHost
        material_host = PhaseApplicationHost(bridge.material_call)
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

    async def root(request):
        require_local(request)
        raise web.HTTPFound('/local/')

    async def index(request):
        require_local(request)
        original, html = local_index(phase=phase)
        return web.Response(text=html, content_type='text/html', headers={
            'X-Vivo-Imported-Index-SHA256': hashlib.sha256(original).hexdigest(),
            'X-Vivo-Application': 'canonical-local-1',
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
            annotate_material(detail.get('capabilities'))
        return web.json_response({**baseline, 'ok': ok, 'mode': 'canonical-local',
            'node': alive, 'python': python_ok, 'legacyComparisonPersistence': 'volatile memory' if store == 'sqlite' else 'SQLite file', 'capabilities': detail.get('capabilities') if isinstance(detail, dict) else bridge.capabilities,
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
            if set(data) - {'op', 'args'} or not isinstance(data.get('op'), str) or data['op'] not in ('state', 'submit', 'moveEye', 'inspectLease', 'renewLease', 'reconcileLease', 'close', 'export', 'nextEpoch', 'materialRun'):
                raise web.HTTPBadRequest(text='Unsupported operation')
            header = request.headers.get('Authorization', '')
            if not header.startswith('Bearer ') or not 20 <= len(header[7:]) <= 256:
                raise web.HTTPUnauthorized(text='Local session required')
            if material_host and data['op'] == 'materialRun' and isinstance(data.get('args'), dict) and data['args'].get('running') is True and material_host.status()['fault']:
                return web.json_response({'error': 'MATERIAL_HOST_RESTART_REQUIRED'}, status=409)
            result = await bridge.call(data['op'], token=header[7:], args=data.get('args', {}))
            if material_host and data['op'] == 'materialRun' and isinstance(result, dict):
                await material_host.set_running(result['value']['running'])
        if material_host and isinstance(result, dict) and isinstance(result.get('state'), dict):
            result['state']['materialHost'] = annotate_material(result['state'].get('capabilities'))
        return result if isinstance(result, web.StreamResponse) else web.json_response(result)

    mounted.router.add_get('/', root)
    mounted.router.add_get('/local/', index)
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
    parser.add_argument('--store', choices=('posix', 'sqlite'), default='posix', help='Explicit canonical backend; SQLite needs Node 24.19+ in the Node 24 line and an existing private directory outside the checkout')
    parser.add_argument('--material-phase', action='store_true', help='Explicit experimental 4D phase mode with separate checkpoint; initially paused')
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data/canonical-local')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('Port must be between 1 and 65535')
    web.run_app(make_local_app(args.data_dir, phase=args.material_phase, max_events=args.journal_events, store=args.store), host='127.0.0.1', port=args.port, access_log=None)


if __name__ == '__main__':
    main()
