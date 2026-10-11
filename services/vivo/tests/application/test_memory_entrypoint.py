"""Real loopback coverage for the explicit process-local preview backend."""
import asyncio
import json
from pathlib import Path
import os
import signal
import socket
import sys
import tempfile
import unittest

from aiohttp import ClientSession


ROOT = Path(__file__).resolve().parents[2]


class MemoryApplicationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.http = ClientSession()
        self.proc = None
        self.log = (Path(self.temp.name) / 'memory-server.log').open('wb')
        data_root = ROOT / 'data'
        self.data_before = (data_root.exists(), sorted(p.name for p in data_root.iterdir()) if data_root.exists() else [])
        await self.start()

    async def start(self, *, phase=False):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        self.base = f'http://127.0.0.1:{port}'
        command = [sys.executable, '-m', 'server.local_application', '--port', str(port), '--store', 'memory']
        if phase:
            command.append('--material-phase')
        env = os.environ.copy()
        env['PYTHONDONTWRITEBYTECODE'] = '1'
        self.proc = await asyncio.create_subprocess_exec(
            *command, cwd=ROOT, env=env, stdout=self.log, stderr=self.log,
        )
        for _ in range(180):
            if self.proc.returncode is not None:
                self.fail((Path(self.temp.name) / 'memory-server.log').read_text())
            try:
                async with self.http.get(self.base + '/api/local/ready') as response:
                    if response.status == 200:
                        self.ready = await response.json()
                        return
            except OSError:
                pass
            await asyncio.sleep(.1)
        self.fail('Memory launcher did not become ready: ' + (Path(self.temp.name) / 'memory-server.log').read_text())

    async def stop(self):
        if self.proc and self.proc.returncode is None:
            self.proc.send_signal(signal.SIGTERM)
            await asyncio.wait_for(self.proc.wait(), 12)

    async def asyncTearDown(self):
        await self.stop()
        await self.http.close()
        self.log.close()
        data_root = ROOT / 'data'
        after = (data_root.exists(), sorted(p.name for p in data_root.iterdir()) if data_root.exists() else [])
        self.assertEqual(after, self.data_before, 'memory preview changed the repository data directory')
        self.temp.cleanup()

    async def post(self, path, data, token=None, expected=200):
        headers = {'Origin': self.base}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        async with self.http.post(self.base + path, json=data, headers=headers) as response:
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
                'worldId': session['session']['worldId'], 'spaceId': space,
                'kind': kind, 'expectedRevision': revision, 'payload': payload}

    async def submit(self, session, command):
        return await self.rpc(session, 'submit', {'command': command})

    async def wait_tick(self, session, target):
        for _ in range(120):
            state = (await self.rpc(session, 'state'))['state']
            self.assertFalse(state['materialHost']['fault'], state['materialHost'])
            if state['materialDiagnostics']['tick'] >= target:
                return state
            await asyncio.sleep(.1)
        self.fail('memory phase made no accepted progress: ' + json.dumps(state['materialHost']))

    async def test_session_only_labels_and_zero_backend_writes(self):
        from server.local_application import make_local_app
        with self.assertRaisesRegex(ValueError, 'does not accept --data-dir'):
            make_local_app(Path(self.temp.name) / 'must-not-be-used', store='memory')
        self.assertEqual(self.ready['canonicalPersistence'], 'session-only volatile memory')
        self.assertEqual(self.ready['legacyComparisonPersistence'], 'volatile memory')
        capabilities = self.ready['capabilities']
        self.assertTrue(capabilities['sessionOnly'])
        self.assertEqual(capabilities['persistenceMode'], 'session-only')
        self.assertIn('no backend world/checkpoint/database file', capabilities['persistence'])
        async with self.http.get(self.base + '/local/accepted/') as response:
            html = await response.text()
        self.assertIn('data-vivo-store="memory"', html)
        self.assertIn('session-only', html.lower())
        one, two = await self.open('one'), await self.open('two')
        self.assertEqual(one['state']['capabilities']['persistenceMode'], 'session-only')
        self.assertEqual(one['state']['snapshot']['worldId'], two['state']['snapshot']['worldId'])

    async def test_restart_starts_fresh_world_and_rejects_old_tab_tokens(self):
        first = await self.open('one')
        old_token = first['token']
        view = first['state']['eye']
        view['q'][3] = .72
        view['slice']['x4'] = .72
        moved = await self.rpc(first, 'moveEye', {'view': view, 'expectedRevision': view['revision']})
        self.assertEqual(moved['state']['eye']['q'][3], .72)
        await self.stop()
        await self.start()
        await self.post('/api/local/rpc', {'op': 'state'}, old_token, expected=409)
        expired = await self.post('/api/local/open', {'seat': 'one', 'resumeToken': old_token}, expected=409)
        self.assertEqual(expired['error'], 'SESSION_EXPIRED')
        fresh = await self.open('one')
        self.assertEqual(fresh['state']['eye']['q'], [0, 0, 0, 0])
        self.assertEqual(fresh['state']['snapshot']['simulationTime'], 0)

    async def test_phase_progress_sharing_guards_and_nested_eyes(self):
        await self.stop()
        await self.start(phase=True)
        one, two = await self.open('one'), await self.open('two')
        self.assertTrue(one['state']['capabilities']['materialDynamics'])
        self.assertTrue(one['state']['capabilities']['sessionOnly'])
        entity = one['state']['snapshot']['spaces']['root']['entities']['relic']
        epoch = (await self.rpc(one, 'nextEpoch'))['value']
        begun = (await self.submit(one, self.command(one, 'grab.begin',
            {'entityId': 'relic', 'source': 'touch', 'inputEpoch': epoch}, entity['revision'])))['value']
        self.assertEqual(begun['status'], 'accepted', begun)
        contender = (await self.submit(two, self.command(two, 'grab.begin',
            {'entityId': 'relic', 'source': 'touch', 'inputEpoch': 1})))['value']
        self.assertEqual(contender['code'], 'LEASE_HELD')
        target = entity['q'][:]
        target[3] = .8
        targeted = (await self.submit(one, self.command(one, 'grab.target', {
            'entityId': 'relic', 'leaseId': begun['result']['leaseId'], 'source': 'touch',
            'inputEpoch': epoch, 'targetSeq': 1, 'dimension': 4, 'chart': 'flat',
            'q': target, 'sampleAgeMs': 0}, begun['entityRevision'])))['value']
        self.assertEqual(targeted['status'], 'accepted', targeted)
        await self.rpc(one, 'materialRun', {'running': True})
        moved = await self.wait_tick(one, 4)
        await self.rpc(one, 'materialRun', {'running': False})
        self.assertNotEqual(moved['snapshot']['spaces']['root']['entities']['relic']['q'], target)
        self.assertGreater(moved['snapshot']['spaces']['root']['entities']['relic']['v'][3], 0)
        diagnostics = moved['materialDiagnostics']['diagnostics']
        self.assertAlmostEqual(diagnostics['mass'], 3., places=10)
        invalid = self.command(one, 'grab.target', {
            'entityId': 'relic', 'leaseId': begun['result']['leaseId'], 'source': 'touch',
            'inputEpoch': epoch, 'targetSeq': 2, 'dimension': 4, 'chart': 'flat',
            'q': [0, 0, 0, 4], 'sampleAgeMs': 0},
            moved['snapshot']['spaces']['root']['entities']['relic']['revision'])
        rejected = (await self.submit(one, invalid))['value']
        self.assertEqual(rejected['code'], 'MATERIAL_DOMAIN')
        await self.submit(one, self.command(one, 'grab.end', {
            'entityId': 'relic', 'leaseId': begun['result']['leaseId'],
            'inputEpoch': epoch, 'reason': 'test-release'},
            moved['snapshot']['spaces']['root']['entities']['relic']['revision']))
        await self.post('/api/local/rpc', {'op': 'materialApply', 'args': {'proposal': {}}}, expected=400)
        await self.rpc(one, 'materialRun', {'running': 'yes'}, expected=409)

        one_eye = (await self.rpc(one, 'state'))['state']['eye']
        two_eye = (await self.rpc(two, 'state'))['state']['eye']
        one_eye['q'][3] = .5
        await self.rpc(one, 'moveEye', {'view': one_eye, 'expectedRevision': one_eye['revision']})
        two_eye['q'][3] = -.2
        await self.rpc(two, 'moveEye', {'view': two_eye, 'expectedRevision': two_eye['revision']})
        state = (await self.rpc(one, 'state'))['state']
        portal = state['snapshot']['spaces']['root']['entities']['portal']
        entered_response = await self.submit(one, self.command(one, 'space.enter',
            {'eyeId': 'main', 'portalEntityId': 'portal'}, portal['revision']))
        entered = entered_response['value']
        self.assertEqual(entered['status'], 'accepted')
        inner = entered_response['state']['eye']
        self.assertEqual(inner['dimension'], 11)
        inner['q'][10] = .41
        inner['slice']['x11'] = .41
        await self.rpc(one, 'moveEye', {'view': inner, 'expectedRevision': inner['revision']})
        self.assertEqual((await self.rpc(two, 'state'))['state']['eye']['q'][3], -.2)
        current = (await self.rpc(one, 'state'))['state']['eye']
        returned_response = await self.submit(one, self.command(one, 'space.exit', {
            'eyeId': 'main', 'returnFrameId': current['stack'][-1]['id']}, current['revision'], 'inner'))
        returned = returned_response['value']
        self.assertEqual(returned['status'], 'accepted')
        self.assertEqual(returned_response['state']['eye']['q'][3], .5)


if __name__ == '__main__':
    unittest.main(verbosity=2)
