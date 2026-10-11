"""Actual phase CLI, private numerical pump, two HTTP seats and durable restart."""
import asyncio
import json
from pathlib import Path
import socket
import sys
import unittest
import test_entrypoint as baseline


class PhaseMountedApplicationTests(unittest.IsolatedAsyncioTestCase):
    store = 'posix'
    data_directory = baseline.MountedApplicationTests.data_directory
    checkpoint_path = baseline.MountedApplicationTests.checkpoint_path
    persisted_checkpoint = baseline.MountedApplicationTests.persisted_checkpoint
    factory = baseline.MountedApplicationTests.factory
    asyncSetUp = baseline.MountedApplicationTests.asyncSetUp
    asyncTearDown = baseline.MountedApplicationTests.asyncTearDown
    stop = baseline.MountedApplicationTests.stop
    post = baseline.MountedApplicationTests.post
    open = baseline.MountedApplicationTests.open
    rpc = baseline.MountedApplicationTests.rpc
    command = baseline.MountedApplicationTests.command
    submit = baseline.MountedApplicationTests.submit

    async def start(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        self.base = f'http://127.0.0.1:{port}'
        self.proc = await asyncio.create_subprocess_exec(sys.executable, '-m', 'server.local_application',
            '--port', str(port), '--data-dir', str(self.data_directory()), '--store', self.store, '--material-phase', '--journal-events', str(getattr(self, 'max_events', 65536)), cwd=baseline.ROOT,
            stdout=self.log, stderr=self.log)
        for _ in range(150):
            if self.proc.returncode is not None:
                self.fail((self.directory / 'server.log').read_text())
            try:
                async with self.http.get(self.base + '/api/local/ready') as response:
                    if response.status == 200:
                        data = await response.json()
                        self.assertTrue(data['capabilities']['materialDynamics'])
                        return
            except OSError:
                pass
            await asyncio.sleep(.1)
        self.fail('Phase launcher did not become ready: ' + (self.directory / 'server.log').read_text())

    async def wait_ticks(self, session, tick):
        for _ in range(100):
            state = (await self.rpc(session, 'state'))['state']
            self.assertFalse(state['materialHost']['fault'], state['materialHost'])
            if state['materialDiagnostics']['tick'] >= tick:
                return state
            await asyncio.sleep(.1)
        self.fail('No accepted numerical progress: ' + json.dumps(state['materialHost']))

    async def grip(self, session, q4):
        state = (await self.rpc(session, 'state'))['state']
        e = state['snapshot']['spaces']['root']['entities']['relic']
        epoch = (await self.rpc(session, 'nextEpoch'))['value']
        begun = (await self.submit(session, self.command(session, 'grab.begin',
            {'entityId': 'relic', 'source': 'touch', 'inputEpoch': epoch}, e['revision'])))['value']
        self.assertEqual(begun['status'], 'accepted', begun)
        q = e['q'][:]
        q[3] = q4
        target = self.command(session, 'grab.target', {'entityId': 'relic', 'leaseId': begun['result']['leaseId'],
            'source': 'touch', 'inputEpoch': epoch, 'targetSeq': 1, 'dimension': 4, 'chart': 'flat', 'q': q, 'sampleAgeMs': 0}, begun['entityRevision'])
        targeted = (await self.submit(session, target))['value']
        self.assertEqual(targeted['status'], 'accepted', targeted)
        return begun['result']['leaseId'], epoch, targeted['entityRevision'], target

    async def release(self, session, grip):
        lease, epoch, revision, _ = grip
        result = (await self.submit(session, self.command(session, 'grab.end',
            {'entityId': 'relic', 'leaseId': lease, 'inputEpoch': epoch, 'reason': 'release'}, revision)))['value']
        self.assertEqual(result['status'], 'accepted', result)

    async def test_two_people_shape_persistent_phase_with_independent_eyes_and_nested_return(self):
        one, two = await self.open('one'), await self.open('two')
        initial = one['state']['snapshot']['spaces']['root']['entities']['relic']['q'][:]
        first = await self.grip(one, .9)
        contender = (await self.submit(two, self.command(two, 'grab.begin',
            {'entityId': 'relic', 'source': 'touch', 'inputEpoch': 1})))['value']
        self.assertEqual(contender['code'], 'LEASE_HELD')
        await self.rpc(one, 'materialRun', {'running': True})
        moved = await self.wait_ticks(one, 4)
        await self.rpc(one, 'materialRun', {'running': False})
        q = moved['snapshot']['spaces']['root']['entities']['relic']['q']
        self.assertGreater(q[3] - initial[3], 1e-5)
        self.assertNotEqual(q[3], .9)
        free = moved['snapshot']['spaces']['root']['entities']['workpiece']['q'][3]
        self.assertGreater(abs(q[3] - free), 1e-5)
        self.assertGreater(moved['snapshot']['spaces']['root']['entities']['relic']['v'][3], 0)
        diagnostics = moved['materialDiagnostics']
        self.assertAlmostEqual(diagnostics['diagnostics']['mass'], 3., places=10)
        self.assertTrue(all(abs(f['relativeMassError']) < 1e-10 for f in diagnostics['fieldDiagnostics']))
        print(json.dumps({'schema': 'vivo.mounted-phase-evidence/1', 'initialQ4': initial[3],
            'drivenQ4': q[3], 'freeQ4': free, 'simulationTime': moved['snapshot']['simulationTime'],
            'tick': diagnostics['tick'], 'diagnostics': diagnostics['diagnostics']}))
        # Duplicate target receipt is replayed without reapplying its old revision.
        replay = (await self.submit(one, first[3]))['value']
        self.assertEqual(replay['entityRevision'], first[2])
        await self.release(one, first)
        for session, x4 in ((one, .5), (two, -.2)):
            eye = (await self.rpc(session, 'state'))['state']['eye']
            view = {k: eye[k] for k in ('spaceId', 'chart', 'dimension', 'q', 'basis', 'slice')}
            view['q'][3] = x4
            await self.rpc(session, 'moveEye', {'view': view, 'expectedRevision': eye['revision']})
        before = (await self.rpc(one, 'state'))['state']
        portal = before['snapshot']['spaces']['root']['entities']['portal']
        entered = (await self.submit(one, self.command(one, 'space.enter',
            {'eyeId': 'main', 'portalEntityId': 'portal'}, portal['revision'])))['value']
        self.assertEqual(entered['status'], 'accepted', entered)
        second = await self.grip(two, -.6)
        await self.rpc(two, 'materialRun', {'running': True})
        stepped = await self.wait_ticks(two, before['materialDiagnostics']['tick'] + 4)
        await self.rpc(two, 'materialRun', {'running': False})
        await self.release(two, second)
        inner = (await self.rpc(one, 'state'))['state']['eye']
        self.assertEqual(inner['dimension'], 11)
        returned = (await self.submit(one, self.command(one, 'space.exit',
            {'eyeId': 'main', 'returnFrameId': inner['stack'][-1]['id']}, inner['revision'], 'inner')))['value']
        self.assertEqual(returned['status'], 'accepted', returned)
        outer = (await self.rpc(one, 'state'))['state']
        self.assertEqual(outer['eye']['q'][3], .5)
        self.assertEqual((await self.rpc(two, 'state'))['state']['eye']['q'][3], -.2)
        final = outer['snapshot']['spaces']['root']['entities']['relic']['q'][:]
        final_velocity = outer['snapshot']['spaces']['root']['entities']['relic']['v'][:]
        self.assertNotEqual(final, q)
        exported = (await self.rpc(one, 'export'))['value']
        self.assertGreater(len(json.dumps(exported['material']['checkpoint'])), 65536)
        self.assertEqual(exported['material']['checkpoint']['digest'], outer['snapshot']['spaces']['root']['field']['hash'])
        self.assertFalse(any('psi' in json.dumps(e) for e in exported['history']['events']))
        self.assertEqual(exported['snapshot']['spaces']['inner']['entities']['relic']['revision'], 0)
        digest = exported['material']['checkpoint']['digest']
        await self.stop()
        await self.start()
        restored = await self.open('one')
        self.assertEqual(restored['state']['snapshot']['spaces']['root']['entities']['relic']['q'], final)
        self.assertEqual(restored['state']['snapshot']['spaces']['root']['entities']['relic']['v'], final_velocity)
        self.assertEqual(restored['state']['snapshot']['spaces']['root']['field']['hash'], digest)
        self.assertEqual(restored['state']['eye']['q'][3], .5)
        self.assertFalse(restored['state']['capabilities']['material']['running'])
        record = await self.persisted_checkpoint(restored, phase=True)
        self.assertEqual(record['state']['material']['checkpoint'], exported['material']['checkpoint'])
        self.assertEqual((await self.open('two'))['state']['eye']['q'][3], -.2)
        sys.path.insert(0, str(baseline.REPO))
        from services.vivo_material import PhaseMaterialDriver
        driver = PhaseMaterialDriver(record['state']['material']['checkpoint'])
        self.assertEqual(driver.checkpoint()['digest'], digest)
        self.assertFalse((self.directory / 'data/canonical-world.json').exists())

    async def test_phase_capacity_pauses_honestly_and_preserves_export_cleanup_restart(self):
        await self.stop()
        self.max_events = 18
        await self.start()
        one, two = await self.open('one'), await self.open('two')
        await self.rpc(one, 'materialRun', {'running': True})
        for _ in range(70):
            state = (await self.rpc(one, 'state'))['state']
            if state['journal']['readOnly'] and not state['capabilities']['material']['running']:
                break
            await asyncio.sleep(.1)
        self.assertTrue(state['journal']['readOnly'])
        self.assertFalse(state['capabilities']['material']['running'])
        self.assertFalse(state['materialHost']['running'])
        self.assertIsNone(state['materialHost']['fault'])
        self.assertEqual(state['journal']['retainedEvents'], 8)
        exported = (await self.rpc(one, 'export'))['value']
        digest = exported['material']['checkpoint']['digest']
        await self.rpc(one, 'materialRun', {'running': True}, expected=409)
        await self.stop()
        await self.start()
        read_only = await self.open('one', readOnly=True)
        self.assertTrue(read_only['session']['readOnly'])
        self.assertEqual(read_only['state']['snapshot']['spaces']['root']['field']['hash'], digest)
        await self.rpc(read_only, 'materialRun', {'running': True}, expected=409)
        self.assertTrue((await self.rpc(read_only, 'export'))['value']['history']['readOnly'])

    async def test_pause_fences_inflight_computed_proposal_at_private_commit(self):
        # Targeted race probe uses the same factory and real Node/HTTP, without a debug endpoint.
        await self.stop()
        sys.path.insert(0, str(baseline.ROOT))
        from server.local_application import make_local_app
        from aiohttp import web
        app = self.factory('pause-data', phase=True)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, '127.0.0.1', 0)
        await site.start()
        self.base = 'http://127.0.0.1:' + str(site._server.sockets[0].getsockname()[1])
        host = app['material_host']
        original = host._call
        computed, release = asyncio.Event(), asyncio.Event()
        async def paused_call(op, *, args):
            if op == 'materialApply':
                computed.set()
                await release.wait()
            return await original(op, args=args)
        host._call = paused_call
        try:
            one = await self.open('one')
            before = one['state']['snapshot']
            await self.rpc(one, 'materialRun', {'running': True})
            await asyncio.wait_for(computed.wait(), 5)
            await self.rpc(one, 'materialRun', {'running': False})
            release.set()
            for _ in range(30):
                if not host.status()['stepInFlight']:
                    break
                await asyncio.sleep(.02)
            state = (await self.rpc(one, 'state'))['state']
            self.assertEqual(state['snapshot'], before)
            self.assertEqual(state['materialDiagnostics']['tick'], 0)
            self.assertFalse(state['capabilities']['material']['running'])
            self.assertFalse(host.status()['fault'])
        finally:
            release.set()
            await runner.cleanup()

    async def test_actual_two_input_hosts_across_live_material_steps(self):
        probe = await asyncio.create_subprocess_exec('node', str(baseline.ROOT / 'tests/application/http-phase-host-probe.mjs'), self.base,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await asyncio.wait_for(probe.communicate(), 20)
        self.assertEqual(probe.returncode, 0, stderr.decode())
        self.assertTrue(json.loads(stdout)['ok'])

    async def test_private_proposal_boundary_public_size_and_domain_rejection_keep_ready(self):
        one = await self.open('one')
        for op in ('materialCapture', 'materialApply', 'materialInitialize'):
            await self.rpc(one, op, {'proposal': {}}, expected=400)
        await self.rpc(one, 'materialRun', {'running': 'yes'}, expected=409)
        await self.post('/api/local/rpc', {'op': 'materialRun', 'args': {'running': True}}, expected=401)
        grip = await self.grip(one, .2)
        target = grip[3].copy()
        target['id'] = 'outside.domain'
        target['payload'] = {**target['payload'], 'targetSeq': 2, 'q': [0, 0, 0, 4]}
        denied = (await self.submit(one, target))['value']
        self.assertEqual(denied['code'], 'MATERIAL_DOMAIN')
        await self.release(one, grip)
        async with self.http.post(self.base + '/api/local/rpc', json={'op': 'state', 'args': {'x': 'x' * 70000}},
                headers={'Origin': self.base, 'Authorization': 'Bearer ' + one['token']}) as response:
            self.assertEqual(response.status, 413)
        async with self.http.get(self.base + '/readyz') as response:
            self.assertEqual(response.status, 200)
