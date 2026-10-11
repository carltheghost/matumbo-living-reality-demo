"""Actual Python launcher + Node child + loopback HTTP. Not browser/device evidence."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import sys
import tempfile
import unittest
from urllib.parse import urljoin
from aiohttp import ClientSession

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT.parents[1]


class MountedApplicationTests(unittest.IsolatedAsyncioTestCase):
    store = 'posix'

    def data_directory(self, name='data'):
        directory = self.directory / name
        if self.store == 'sqlite':
            directory.mkdir(exist_ok=True, mode=0o700)
        return directory

    def checkpoint_path(self, phase=False):
        return self.directory / 'data' / (('canonical-phase' if phase else 'canonical-world') + ('.sqlite' if self.store == 'sqlite' else '.json'))

    async def persisted_checkpoint(self, session, phase=False):
        if self.store == 'sqlite':
            # Read through the lifetime owner, never open another SQLite connection.
            exported = (await self.rpc(session, 'export'))['value']
            return {'state': {'snapshot': exported['snapshot'], 'material': exported['material']}}
        return json.loads(self.checkpoint_path(phase).read_text())

    def factory(self, name, **kwargs):
        sys.path.insert(0, str(ROOT))
        from server.local_application import make_local_app
        return make_local_app(self.data_directory(name), store=self.store, **kwargs)

    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.log = (self.directory / 'server.log').open('wb')
        self.http = ClientSession()
        self.proc = None
        await self.start()

    async def start(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        self.base = f'http://127.0.0.1:{port}'
        self.proc = await asyncio.create_subprocess_exec(sys.executable, '-m', 'server.local_application',
            '--port', str(port), '--data-dir', str(self.data_directory()), '--store', self.store, cwd=ROOT,
            stdout=self.log, stderr=self.log)
        for _ in range(100):
            if self.proc.returncode is not None:
                self.fail((self.directory / 'server.log').read_text())
            try:
                async with self.http.get(self.base + '/api/local/ready') as response:
                    if response.status == 200:
                        return
            except OSError:
                pass
            await asyncio.sleep(.1)
        self.fail('Mounted entrypoint did not become ready: ' + (self.directory / 'server.log').read_text())

    async def stop(self):
        if self.proc and self.proc.returncode is None:
            self.proc.send_signal(signal.SIGTERM)
            await asyncio.wait_for(self.proc.wait(), 12)

    async def asyncTearDown(self):
        await self.stop()
        await self.http.close()
        self.log.close()
        self.temp.cleanup()

    async def post(self, path, data, token=None, expected=200, headers=None):
        head = {'Origin': self.base, **(headers or {})}
        if token:
            head['Authorization'] = 'Bearer ' + token
        async with self.http.post(self.base + path, json=data, headers=head) as response:
            text = await response.text()
            self.assertEqual(response.status, expected, text)
            return json.loads(text) if response.content_type == 'application/json' else text

    async def open(self, seat, **extra):
        return await self.post('/api/local/open', {'seat': seat, **extra})

    async def rpc(self, session, op, args=None, **options):
        return await self.post('/api/local/rpc', {'op': op, 'args': args or {}}, session['token'], **options)

    def command(self, session, kind, payload, revision=0, space='root', ident=None):
        import uuid
        return {'schema': 'vivo.command/1', 'id': ident or str(uuid.uuid4()),
            'worldId': session['session']['worldId'], 'spaceId': space, 'kind': kind,
            'expectedRevision': revision, 'payload': payload}

    async def submit(self, session, command):
        return await self.rpc(session, 'submit', {'command': command})

    async def test_real_root_serves_preserved_studio_and_separate_accepted_preview(self):
        async with self.http.get(self.base + '/') as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.url.path, '/local/')
            text = await response.text()
            self.assertIn('id="vivoLocalEntry"', text)
            self.assertIn('href="/local/accepted/"', text)
            self.assertIn('target="_blank"', text)
            self.assertIn('rel="noopener noreferrer"', text)
            self.assertIn('id="vivoLocalAssetBridge"', text)
            self.assertIn('data-vivo-studio-authority="1"', text)
            self.assertIn('SHARED OBJECT / ECHO', text)
            self.assertIn("/services/vivo/contracts/studio-binding.mjs", text)
            self.assertIn('CameraPresence.prototype.loadVision', text)
            self.assertIn('CameraPresence.prototype.modelBytes', text)
            self.assertIn('/vendor/field-lab/vision_bundle.mjs', text)
            self.assertIn('Head unavailable · no local face model', text)
            self.assertIn('Center unavailable', text)
            self.assertIn('no face landmarker model is vendored', text)
            self.assertNotIn('<script src="/studio-bridge.js"></script>', text)
            self.assertNotIn('sharedBridge', text)
            self.assertIn('PRIMARY · FULL STUDIO', text)
            self.assertNotIn('/application/bootstrap.mjs', text)
            self.assertIn('<base href="/">', text)
            expected = hashlib.sha256((ROOT / 'web/studio-original.html').read_bytes()).hexdigest()
            self.assertEqual(response.headers['X-Vivo-Original-Studio-SHA256'], expected)
            self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
            csp = response.headers['Content-Security-Policy']
            self.assertNotIn('cdn.jsdelivr.net', csp)
            self.assertNotIn('storage.googleapis.com', csp)
        async with self.http.get(self.base + '/local/accepted/') as response:
            self.assertEqual(response.status, 200)
            text = await response.text()
            self.assertIn('/application/bootstrap.mjs', text)
            self.assertIn('data-vivo-stage="accepted-preview"', text)
            self.assertIn('data-vivo-phase="false"', text)
            self.assertIn('ACCEPTED BACKEND PREVIEW · BACKEND STAGE', text)
            expected = hashlib.sha256((ROOT / 'web/index.html').read_bytes()).hexdigest()
            self.assertEqual(response.headers['X-Vivo-Imported-Index-SHA256'], expected)
        for name in ['render.js', 'camera.js', 'shared.js', 'shared.css']:
            async with self.http.get(self.base + '/' + name) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(await response.read(), (ROOT / 'web' / name).read_bytes())
        for path in ['/studio-bridge.js', '/vendor/field-lab/vision_bundle.mjs',
                     '/vendor/field-lab/wasm/vision_wasm_internal.js',
                     '/vendor/field-lab/hand_landmarker.task']:
            async with self.http.head(self.base + path) as response:
                self.assertEqual(response.status, 200, path)
        async with self.http.get(self.base + '/legacy') as response:
            self.assertEqual(await response.read(), (ROOT / 'web/index.html').read_bytes())

    def test_runbook_distinguishes_studio_and_accepted_models(self):
        text = (ROOT / 'CANONICAL-LOCAL.md').read_text()
        self.assertIn('`http://127.0.0.1:8766/local/` for the primary **Full Studio**', text)
        self.assertIn('`http://127.0.0.1:8766/local/accepted/`', text)
        self.assertIn('intentionally separate state models', text)
        self.assertIn('session-only and resets with the server', text)
        self.assertIn('head-pointer mode is explicitly unavailable', text)
        self.assertNotIn('Open `http://127.0.0.1:8766/`. Choose Seat one.', text)

    async def test_actual_entrypoint_serves_entire_browser_esm_import_graph(self):
        queue = ['/application/bootstrap.mjs']
        seen = set()
        while queue:
            path = queue.pop()
            if path in seen:
                continue
            seen.add(path)
            async with self.http.get(self.base + path) as response:
                self.assertEqual(response.status, 200, path)
                self.assertIn(response.content_type, ('text/javascript', 'application/javascript'))
                text = await response.text()
                self.assertIn("default-src 'self'", response.headers['Content-Security-Policy'])
            for child in re.findall(r"(?:from\s*|import\s*)['\"]([^'\"]+)['\"]", text):
                queue.append(urljoin(path, child))
        self.assertIn('/research/vivo-phase-fabric/web/target-mailbox.mjs', seen)
        self.assertIn('/services/vivo/web/input/controller.mjs', seen)
        self.assertIn('/services/vivo/contracts/validate.mjs', seen)
        self.assertIn('/services/vivo/contracts/studio-binding.mjs', seen)
        self.assertGreaterEqual(len(seen), 9)

    async def test_origin_host_method_and_private_file_boundaries(self):
        for headers in [{'Origin': 'https://other.example'}, {'Origin': 'null'},
                        {'Origin': self.base, 'Host': 'evil.example'}, {'Origin': self.base + '.evil'},
                        {'Origin': self.base, 'Sec-Fetch-Site': 'cross-site'}]:
            await self.post('/api/local/open', {'seat': 'one'}, headers=headers, expected=403)
        async with self.http.post(self.base + '/api/local/open', json={'seat': 'one'}) as response:
            self.assertEqual(response.status, 403)
            self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
        async with self.http.get(self.base + '/api/local/open') as response:
            self.assertEqual(response.status, 405)
        for path in ['/.git/config', '/server/app.py', '/services/vivo/server/application/runtime.mjs',
                     '/data/canonical-world.json', '/research/vivo-phase-fabric/training-data/train.npz',
                     '/services/vivo/contracts/interfaces.d.ts']:
            async with self.http.get(self.base + path) as response:
                self.assertEqual(response.status, 404, path)
        opened = await self.open('one')
        await self.rpc(opened, '__proto__', expected=400)
        await self.post('/api/local/open', {'seat': 'two', 'actorId': 'local.one'}, expected=400)
        await self.post('/api/local/rpc', {'op': 'state'}, expected=401)

    async def test_two_http_clients_accept_constraints_without_fabricated_material_motion(self):
        a, b = await self.open('one'), await self.open('two')
        self.assertNotEqual(a['session']['actorId'], b['session']['actorId'])
        entity = a['state']['snapshot']['spaces']['root']['entities']['relic']
        begin = self.command(a, 'grab.begin', {'entityId': 'relic', 'source': 'touch', 'inputEpoch': 1})
        accepted = await self.submit(a, begin)
        self.assertEqual(accepted['value']['status'], 'accepted')
        lease = accepted['value']['result']['leaseId']
        denied = await self.submit(b, self.command(b, 'grab.begin', {'entityId': 'relic', 'source': 'touch', 'inputEpoch': 1}))
        self.assertEqual(denied['value']['code'], 'LEASE_HELD')
        target = list(entity['q']); target[3] = .35
        result = await self.submit(a, self.command(a, 'grab.target', {'entityId': 'relic', 'leaseId': lease,
            'source': 'touch', 'inputEpoch': 1, 'targetSeq': 1, 'dimension': 4,
            'chart': entity['chart'], 'q': target, 'sampleAgeMs': 0}))
        self.assertEqual(result['value']['status'], 'accepted')
        other = await self.rpc(b, 'state')
        self.assertEqual(other['state']['snapshot']['spaces']['root']['entities']['relic']['q'], entity['q'])
        self.assertEqual(other['state']['constraints'][0]['target']['q'], target)
        self.assertNotIn('session', other['state']['constraints'][0])
        self.assertFalse(other['state']['capabilities']['materialDynamics'])
        await self.rpc(b, 'renewLease', {'leaseId': lease}, expected=409)
        release = await self.submit(a, self.command(a, 'grab.end', {'entityId': 'relic', 'leaseId': lease, 'inputEpoch': 1, 'reason': 'test-release'}))
        self.assertEqual(release['state']['constraints'], [])

    async def test_nested_independent_eye_and_real_launcher_restart(self):
        a, b = await self.open('one'), await self.open('two')
        initial_b = b['state']['eye']
        eye = a['state']['eye']; eye['q'][3] = .72; eye['slice']['x4'] = .72
        moved = await self.rpc(a, 'moveEye', {'view': eye, 'expectedRevision': eye['revision']})
        saved = moved['state']['eye']
        entered = await self.submit(a, self.command(a, 'space.enter', {'eyeId': 'main', 'portalEntityId': 'portal'}))
        inner = entered['state']['eye']
        self.assertEqual(inner['dimension'], 11)
        inner['q'][10] = .41; inner['slice']['x11'] = .41
        moved_inner = await self.rpc(a, 'moveEye', {'view': inner, 'expectedRevision': inner['revision']})
        self.assertEqual((await self.rpc(b, 'state'))['state']['eye'], initial_b)
        await self.stop(); await self.start()
        await self.rpc(a, 'state', expected=409)
        restored = await self.open('one')
        self.assertEqual(restored['state']['eye']['q'][10], .41)
        self.assertEqual(restored['state']['constraints'], [])
        current = restored['state']['eye']
        returned = await self.submit(restored, self.command(restored, 'space.exit', {'eyeId': 'main', 'returnFrameId': current['stack'][-1]['id']}, current['revision'], 'inner'))
        for key in ['spaceId', 'dimension', 'q', 'basis', 'slice', 'chart']:
            self.assertEqual(returned['state']['eye'][key], saved[key])
        self.assertEqual(returned['state']['snapshot']['simulationTime'], 0)
        exported = await self.rpc(restored, 'export')
        self.assertNotIn(restored['token'], json.dumps(exported['value']))
        self.assertTrue(self.checkpoint_path().is_file())

    async def test_node_child_failure_closes_factory_readiness_and_never_replays(self):
        # Other tests launch the CLI. This fault probe uses the same app factory
        # to hold an exact child handle; it adds no debug endpoint to production.
        await self.stop()
        sys.path.insert(0, str(ROOT))
        from server.local_application import make_local_app
        from aiohttp import web
        app = self.factory('fault-data')
        runner = web.AppRunner(app)
        await runner.setup()
        try:
            site = web.TCPSite(runner, '127.0.0.1', 0)
            await site.start()
            self.base = 'http://127.0.0.1:' + str(site._server.sockets[0].getsockname()[1])
            a = await self.open('one')
            child = app['local_bridge'].process
            child.kill()
            await child.wait()
            async with self.http.get(self.base + '/readyz') as response:
                self.assertEqual(response.status, 503)
                status = await response.json()
                self.assertFalse(status['node'])
                self.assertTrue(status['python'])
            await self.rpc(a, 'state', expected=503)
        finally:
            await runner.cleanup()

    async def test_exact_host_and_controller_over_actual_http_transport(self):
        process = await asyncio.create_subprocess_exec('node', str(ROOT / 'tests/application/http-host-probe.mjs'), self.base,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await asyncio.wait_for(process.communicate(), 15)
        self.assertEqual(process.returncode, 0, stderr.decode())
        report = json.loads(stdout)
        self.assertTrue(report['ok'])
        self.assertEqual(len(report['checks']), 5)

    async def test_malformed_and_expanded_unicode_admission_preserves_authority_process(self):
        # This valid <64KiB UTF-8 body formerly expanded past the pipe cap under
        # ensure_ascii and killed the child on the uncorrelated error response.
        unicode_body = json.dumps({'seat': '\U00010000' * 10000}, ensure_ascii=False).encode('utf-8')
        self.assertLess(len(unicode_body), 64 * 1024)
        async with self.http.post(self.base + '/api/local/open', data=unicode_body, headers={'Origin': self.base, 'Content-Type': 'application/json'}) as response:
            self.assertEqual(response.status, 400)
        await self.post('/api/local/open', {'seat': 'one', 'readOnly': 1}, expected=400)
        a = await self.open('one')
        await self.rpc(a, 'moveEye', {'view': {'bad': '\ud800'}, 'expectedRevision': 0}, expected=400)
        await self.rpc(a, 'moveEye', {'view': {'bad': 'x' * 65000}, 'expectedRevision': 0}, expected=409)
        large = {'op': 'moveEye', 'args': {'view': {'bad': 'x' * 65440}, 'expectedRevision': 0}}
        body = json.dumps(large).encode()
        self.assertLess(len(body), 64 * 1024)
        async with self.http.post(self.base + '/api/local/rpc', data=body, headers={'Origin': self.base, 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + a['token']}) as response:
            self.assertEqual(response.status, 413)
        async with self.http.get(self.base + '/readyz') as response:
            self.assertEqual(response.status, 200)
            self.assertTrue((await response.json())['node'])
        self.assertEqual((await self.rpc(a, 'state'))['state']['snapshot']['acceptedSequence'], a['state']['snapshot']['acceptedSequence'])

    async def test_resume_rotates_token_and_preserves_eye(self):
        a = await self.open('one')
        resumed = await self.open('one', resumeToken=a['token'])
        self.assertNotEqual(a['token'], resumed['token'])
        self.assertEqual(a['state']['eye'], resumed['state']['eye'])
        await self.rpc(a, 'state', expected=409)
        await self.post('/api/local/open', {'seat': 'one'}, expected=409)
        fresh_epoch = (await self.rpc(resumed, 'nextEpoch'))['value']
        self.assertGreater(fresh_epoch, 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
