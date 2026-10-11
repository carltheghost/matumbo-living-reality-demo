"""CPU and async private-host evidence; no browser/device/public-network claim."""
import asyncio
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
from unittest import mock

from services.vivo.server.application.material_host import (
    MaterialHostError, PhaseApplicationHost, initialize_phase,
    validate_phase_checkpoint,
)
from services.vivo_material import AcceptedMaterialAdapter, MaterialError, PhaseMaterialDriver
from services.vivo_material.driver import digest, unpack_array

REPOSITORY = Path(__file__).resolve().parents[4]


def seed():
    return {'schema': 'vivo.snapshot/1', 'worldId': 'world.local',
            'authorityId': 'authority.local', 'acceptedSequence': 0,
            'simulationTime': 0, 'rootSpaceId': 'root', 'stateHash': '0' * 64,
            'metadata': {'name': 'Nested workshop', 'identities': ['unchanged']},
            'spaces': {
                'root': {'id': 'root', 'dimension': 4, 'intrinsicDimension': 4,
                         'atlasId': 'atlas.periodic-cartesian.v1',
                         'metricId': 'metric.flat-euclidean.v1',
                         'topologyId': 'topology.periodic-torus.v1',
                         'law': {'id': 'vivo.phase.periodic-compliant', 'version': '1'},
                         'modelHashes': [],
                         'field': {'codec': 'vivo.material.phase/1', 'handle': 'phase.root',
                                   'hash': '0' * 64, 'metadata': {'keep': True}},
                         'entryView': {'spaceId': 'root', 'q': [0, 0, 0, 0]},
                         'entities': {'relic': {
                             'id': 'relic', 'spaceId': 'root', 'dimension': 4,
                             'chart': 'flat', 'q': [.123, -.62, 1.2, -1.234],
                             'v': [0, 0, 0, 0], 'revision': 0,
                             'materialProfile': 'phase', 'fieldMembership': ['field.relic'],
                             'innerSpaceId': 'inner', 'lineage': ['origin.relic'],
                             'radius': .25, 'metadata': {'roles': ['owner']}}}},
                'inner': {'id': 'inner', 'dimension': 11,
                          'entities': {'relic': {'id': 'relic', 'q': [0] * 11}},
                          'field': {'codec': 'pending', 'hash': '0' * 64}}}}


class PrivateAuthority:
    """Fake private transport, with real driver state and explicit test acceptance."""

    def __init__(self):
        initialized = initialize_phase(seed())
        self.snapshot, self.checkpoint = initialized['snapshot'], initialized['checkpoint']
        q = list(self.snapshot['spaces']['root']['entities']['relic']['q'])
        q[3] += 1
        self.constraints = [{
            'id': 'lease.one', 'session': 'session.private.secret', 'actorId': 'actor.one',
            'spaceId': 'root', 'entityId': 'relic', 'source': 'touch', 'inputEpoch': 1,
            'targetSeq': 1, 'expiresAt': 2000.,
            'target': {'spaceId': 'root', 'chart': 'flat', 'dimension': 4, 'q': q}}]
        self.capture_count = 0
        self.proposals = []
        self.apply_errors = []
        self.capture_error = None
        self.capture_gate = None
        self.apply_result = None
        self.advance_on_race = False
        self.last_capture = None
        self.extra_capture = {}

    async def __call__(self, op, *, args):
        if op == 'materialCapture':
            assert args == {'spaceId': 'root'}
            self.capture_count += 1
            if self.capture_gate:
                await self.capture_gate.wait()
            if self.capture_error:
                raise self.capture_error
            self.last_capture = copy.deepcopy({'snapshot': self.snapshot,
                'constraints': self.constraints, 'authorityTimeMs': 1000.,
                'checkpoint': self.checkpoint, **self.extra_capture})
            return self.last_capture
        assert op == 'materialApply' and set(args) == {'proposal'}
        proposal = copy.deepcopy(args['proposal'])
        self.proposals.append(proposal)
        if self.apply_errors:
            error = self.apply_errors.pop(0)
            if self.advance_on_race:
                self.snapshot['acceptedSequence'] += 1
                self.snapshot['stateHash'] = f"{self.snapshot['acceptedSequence']:064x}"
            raise error
        if self.apply_result is not None:
            return self.apply_result
        assert proposal['baseSequence'] == self.snapshot['acceptedSequence']
        assert proposal['baseStateHash'] == self.snapshot['stateHash']
        assert proposal['baseFieldDigest'] == self.checkpoint['digest']
        # This is deliberately just a fake acceptance hook. Production authority
        # performs independent lease/schema/CAS checks and atomic persistence.
        self.checkpoint = copy.deepcopy(proposal['fieldState'])
        for entity_id, field in self.checkpoint['fields'].items():
            entity = self.snapshot['spaces']['root']['entities'][entity_id]
            entity.update({key: copy.deepcopy(field[key]) for key in ('q', 'v', 'revision')})
        self.snapshot['spaces']['root']['field']['hash'] = self.checkpoint['digest']
        self.snapshot['simulationTime'] = self.checkpoint['simulationTime']
        self.snapshot['acceptedSequence'] += 1
        self.snapshot['stateHash'] = f"{self.snapshot['acceptedSequence']:064x}"
        return copy.deepcopy(self.snapshot)


class InitializationTests(unittest.TestCase):
    def test_explicit_seed_materializes_actual_8_fourth_fields_only(self):
        original = seed()
        before = copy.deepcopy(original)
        result = initialize_phase(original)
        self.assertEqual(original, before)
        checkpoint = result['checkpoint']
        self.assertEqual(checkpoint['shape'], [8, 8, 8, 8])
        self.assertEqual(checkpoint['lengths'], [8.] * 4)
        self.assertEqual(checkpoint['tick'], 0)
        field = checkpoint['fields']['relic']
        psi = unpack_array(field['psi'], (8,) * 4, 'complex')
        self.assertEqual(psi.shape, (8,) * 4)
        self.assertAlmostEqual(float((abs(psi) ** 2).sum()), 1., places=12)
        expected = copy.deepcopy(original)
        root = expected['spaces']['root']
        root['entities']['relic']['q'] = field['q']
        root['entities']['relic']['v'] = field['v']
        root['field'].update(codec=checkpoint['schema'], hash=checkpoint['digest'])
        self.assertEqual(result['snapshot'], expected)
        self.assertEqual(validate_phase_checkpoint(result['snapshot'], checkpoint), checkpoint)
        result['snapshot']['spaces']['inner']['entities']['relic']['q'][10] = 2
        field['q'][0] = 3
        self.assertEqual(original, before)
        self.assertNotEqual(result['snapshot']['spaces']['root']['entities']['relic']['q'][0], 3)

    def test_unsupported_declarations_and_nonpristine_initialization_reject(self):
        for change in (
            lambda s: s['spaces']['root'].update(dimension=11),
            lambda s: s['spaces']['root'].update(law={'id': 'pending-material', 'version': '0'}),
            lambda s: s['spaces']['root']['entities']['relic'].update(materialProfile='unbound'),
            lambda s: s.update(acceptedSequence=1),
            lambda s: s.update(simulationTime=.02),
            lambda s: s['spaces']['root']['entities']['relic'].update(revision=1),
            lambda s: s['spaces']['root']['field'].update(hash='a' * 64),
        ):
            with self.subTest(change=change):
                value = seed()
                change(value)
                before = copy.deepcopy(value)
                with self.assertRaises(MaterialError):
                    initialize_phase(value)
                self.assertEqual(value, before)

    def test_restart_validation_never_repairs_invalid_state(self):
        initialized = initialize_phase(seed())
        for change in (
            lambda s: s['spaces']['root']['entities']['relic']['q'].__setitem__(0, .2),
            lambda s: s['spaces']['root']['entities']['relic'].update(revision=1),
            lambda s: s['spaces']['root']['entities']['relic'].update(fieldMembership=['other']),
            lambda s: s['spaces']['root']['field'].update(hash='a' * 64),
            lambda s: s.update(simulationTime=.02),
        ):
            with self.subTest(change=change):
                snapshot = copy.deepcopy(initialized['snapshot'])
                change(snapshot)
                before = copy.deepcopy(snapshot)
                with self.assertRaises(MaterialError):
                    validate_phase_checkpoint(snapshot, initialized['checkpoint'])
                self.assertEqual(snapshot, before)
        checkpoint = copy.deepcopy(initialized['checkpoint'])
        checkpoint['fields']['relic']['q'][0] = .2
        checkpoint['digest'] = digest({k: v for k, v in checkpoint.items() if k != 'digest'})
        snapshot = copy.deepcopy(initialized['snapshot'])
        snapshot['spaces']['root']['field']['hash'] = checkpoint['digest']
        snapshot['spaces']['root']['entities']['relic']['q'][0] = .2
        with self.assertRaisesRegex(MaterialError, 'CHECKPOINT_OBSERVABLE_MISMATCH'):
            validate_phase_checkpoint(snapshot, checkpoint)

    def test_component_import_resolves_from_supported_launcher_directory(self):
        env = dict(os.environ)
        env.pop('PYTHONPATH', None)
        process = subprocess.run([sys.executable, '-c',
            'from server.application.material_host import PhaseApplicationHost; '
            'print(PhaseApplicationHost.__name__)'], cwd=REPOSITORY / 'services/vivo',
            env=env, capture_output=True, text=True, timeout=10)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(process.stdout.strip(), 'PhaseApplicationHost')


class HostTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.authority = PrivateAuthority()
        self.host = PhaseApplicationHost(self.authority)
        self.release_events = []

    async def asyncTearDown(self):
        for event in self.release_events:
            event.set()
        await self.host.stop()

    async def until(self, condition, timeout=4):
        deadline = asyncio.get_running_loop().time() + timeout
        while not condition():
            if asyncio.get_running_loop().time() > deadline:
                self.fail('Timed out waiting for host state: ' + json.dumps(self.host.status()))
            await asyncio.sleep(.005)

    def blocking_proposal(self):
        entered, release = threading.Event(), threading.Event()
        self.release_events.append(release)
        original = AcceptedMaterialAdapter.propose
        counters = {'active': 0, 'maximum': 0, 'calls': 0, 'threads': []}

        def propose(adapter, *args, **kwargs):
            counters['active'] += 1
            counters['maximum'] = max(counters['maximum'], counters['active'])
            counters['calls'] += 1
            counters['threads'].append(threading.get_ident())
            entered.set()
            try:
                if not release.wait(5):
                    raise RuntimeError('Test did not release numerical thread')
                return original(adapter, *args, **kwargs)
            finally:
                counters['active'] -= 1
        return entered, release, counters, mock.patch.object(AcceptedMaterialAdapter, 'propose', propose)

    async def test_default_paused_start_idempotent_and_status_private(self):
        first, second = await asyncio.gather(self.host.start(), self.host.start())
        self.assertEqual(first['state'], 'paused')
        self.assertEqual(first, second)
        self.assertEqual(self.authority.capture_count, 1)
        await asyncio.sleep(.55)
        self.assertEqual(self.authority.capture_count, 1)
        self.assertEqual(self.authority.proposals, [])
        status = self.host.status()
        self.assertEqual(status['wallTickHz'], 2.)
        self.assertEqual(status['simulationStepSeconds'], .02)
        for private in ('checkpoint', 'constraints', 'session.private.secret', 'psi', 'proposal'):
            self.assertNotIn(private, json.dumps(status))
        for bad in (1, 'true', {}, None):
            with self.assertRaises(MaterialHostError):
                await self.host.set_running(bad)

    async def test_read_only_observation_projects_accepted_density_without_field_bytes(self):
        await self.host.start()
        before = copy.deepcopy(self.authority.checkpoint)
        observed = await self.host.observe('relic', [0, 1], {2: 4, 3: 4})
        self.assertEqual(observed['shape'], [8, 8])
        self.assertEqual(observed['axes'], [0, 1])
        self.assertEqual(observed['fixed'], {2: 4, 3: 4})
        self.assertEqual(observed['acceptedSequence'], 0)
        self.assertEqual(observed['materialDigest'], before['digest'])
        self.assertEqual(observed['materialDigest'], self.authority.snapshot['spaces']['root']['field']['hash'])
        self.assertEqual(len(observed['density']), 8)
        self.assertEqual(len(observed['density'][0]), 8)
        self.assertTrue(all(value >= 0 for row in observed['density'] for value in row))
        self.assertNotIn('psi', json.dumps(observed))
        self.assertEqual(self.authority.checkpoint, before)

    async def test_accepted_diagnostic_extensions_are_bounded_and_not_solver_input(self):
        self.authority.extra_capture = {'diagnostics': None, 'fieldDiagnostics': []}
        await self.host.start()
        self.authority.extra_capture = {'diagnostics': {'mass': 1., 'energy': .1},
                                        'fieldDiagnostics': [{'entityId': 'relic', 'mass': 1.}]}
        original = AcceptedMaterialAdapter.propose

        def checking(adapter, *args, **kwargs):
            self.assertEqual(set(adapter._read()), {'snapshot', 'constraints', 'authorityTimeMs'})
            return original(adapter, *args, **kwargs)

        with mock.patch.object(AcceptedMaterialAdapter, 'propose', checking):
            await self.host.set_running(True)
            await self.until(lambda: self.host.status()['acceptedSteps'] == 1)
            await self.host.set_running(False)

    async def test_actual_accepted_capture_and_solver_commit(self):
        await self.host.start()
        before = copy.deepcopy(self.authority.snapshot)
        checkpoint_before = copy.deepcopy(self.authority.checkpoint)
        await self.host.set_running(True)
        await self.until(lambda: self.host.status()['acceptedSteps'] == 1)
        await self.host.set_running(False)
        status = self.host.status()
        self.assertEqual(status['tick'], 1)
        self.assertEqual(status['simulationTime'], .02)
        self.assertEqual(status['acceptedSequence'], 1)
        proposal = self.authority.proposals[0]
        self.assertEqual(proposal['baseSequence'], 0)
        self.assertEqual(proposal['baseFieldDigest'], checkpoint_before['digest'])
        self.assertEqual(proposal['acceptedLeaseProofs'][0]['target'], self.authority.constraints[0]['target'])
        self.assertNotIn('session', proposal['acceptedLeaseProofs'][0])
        after = self.authority.snapshot
        entity = after['spaces']['root']['entities']['relic']
        self.assertGreater(entity['q'][3], before['spaces']['root']['entities']['relic']['q'][3])
        self.assertGreater(entity['v'][3], 0)
        self.assertNotEqual(entity['q'], self.authority.constraints[0]['target']['q'])
        self.assertEqual(after['spaces']['inner'], before['spaces']['inner'])
        self.assertNotEqual(self.authority.checkpoint['fields']['relic']['psi'],
                            checkpoint_before['fields']['relic']['psi'])
        validate_phase_checkpoint(after, self.authority.checkpoint)

    async def test_each_stale_code_discards_and_recaptures_without_old_retry(self):
        await self.host.start()
        self.authority.advance_on_race = True
        codes = ['MATERIAL_STALE_AUTHORITY', 'MATERIAL_STALE_FIELD',
                 'MATERIAL_STALE_REVISION', 'MATERIAL_STALE_CONSTRAINTS']
        self.authority.apply_errors = [MaterialHostError(code) for code in codes]
        await self.host.set_running(True)
        await self.until(lambda: self.host.status()['acceptedSteps'] == 1)
        await self.host.set_running(False)
        self.assertEqual(self.host.status()['discardedSteps'], 4)
        self.assertIsNone(self.host.status()['fault'])
        self.assertEqual([p['baseSequence'] for p in self.authority.proposals], list(range(5)))
        self.assertEqual(self.authority.capture_count, 6)  # startup plus every fresh attempt
        self.assertEqual(self.authority.checkpoint['tick'], 1)

    async def test_pause_during_thread_discards_candidate_and_keeps_loop_responsive(self):
        await self.host.start()
        initial = copy.deepcopy(self.authority.checkpoint)
        entered, release, counters, patch = self.blocking_proposal()
        with patch:
            await self.host.set_running(True)
            await self.until(entered.is_set)
            await self.host.set_running(False)
            await asyncio.wait_for(asyncio.sleep(.01), .2)
            self.assertEqual(counters['active'], 1)
            self.assertNotEqual(counters['threads'][0], threading.get_ident())
            release.set()
            await self.until(lambda: not self.host.status()['stepInFlight'])
        self.assertEqual(self.authority.proposals, [])
        self.assertEqual(self.authority.checkpoint, initial)
        self.assertEqual(self.host.status()['discardedSteps'], 1)
        self.assertEqual(self.host.status()['state'], 'paused')

    async def test_stop_drains_numerical_work_before_bridge_can_close(self):
        await self.host.start()
        entered, release, counters, patch = self.blocking_proposal()
        with patch:
            await self.host.set_running(True)
            await self.until(entered.is_set)
            stopped = asyncio.create_task(self.host.stop())
            await asyncio.sleep(.02)
            self.assertFalse(stopped.done())
            self.assertFalse(self.host.status()['running'])
            release.set()
            await asyncio.wait_for(stopped, 3)
        self.assertEqual(counters['active'], 0)
        self.assertEqual(self.authority.proposals, [])
        self.assertTrue(self.host._task.done())
        self.assertEqual(self.host.status()['state'], 'stopped')
        with self.assertRaises(MaterialHostError):
            await self.host.set_running(True)
        with self.assertRaises(MaterialHostError):
            await self.host.start()

    async def test_pause_resume_generations_never_overlap_threads(self):
        await self.host.start()
        entered, release, counters, patch = self.blocking_proposal()
        with patch:
            await self.host.set_running(True)
            await self.until(entered.is_set)
            for _ in range(12):
                await self.host.set_running(False)
                await self.host.set_running(True)
            await asyncio.sleep(.05)
            self.assertEqual(counters['calls'], 1)
            self.assertEqual(counters['maximum'], 1)
            release.set()
            await self.until(lambda: self.host.status()['acceptedSteps'] == 1)
            await self.host.set_running(False)
        self.assertEqual(counters['maximum'], 1)
        self.assertEqual(self.host.status()['discardedSteps'], 1)
        self.assertEqual(len(self.authority.proposals), 1)

    async def test_pause_during_capture_prevents_even_starting_numerics(self):
        await self.host.start()
        gate = asyncio.Event()
        self.authority.capture_gate = gate
        with mock.patch.object(AcceptedMaterialAdapter, 'propose') as propose:
            await self.host.set_running(True)
            await self.until(lambda: self.authority.capture_count == 2)
            await self.host.set_running(False)
            gate.set()
            await self.until(lambda: not self.host.status()['stepInFlight'])
            propose.assert_not_called()
        self.assertEqual(self.authority.proposals, [])

    async def test_private_reader_gets_detached_captured_context_only(self):
        await self.host.start()
        original = AcceptedMaterialAdapter.propose
        expected = copy.deepcopy(self.authority.constraints)

        def checking(adapter, *args, **kwargs):
            captured = adapter._read()
            self.assertEqual(set(captured), {'snapshot', 'constraints', 'authorityTimeMs'})
            captured['constraints'][0]['target']['q'][3] = 3.5
            captured['snapshot']['spaces']['root']['entities']['relic']['q'][0] = 3.5
            self.authority.last_capture['constraints'][0]['target']['q'][3] = 3.1
            self.assertEqual(adapter._read()['constraints'], expected)
            return original(adapter, *args, **kwargs)

        with mock.patch.object(AcceptedMaterialAdapter, 'propose', checking):
            await self.host.set_running(True)
            await self.until(lambda: self.host.status()['acceptedSteps'] == 1)
            await self.host.set_running(False)
        self.assertEqual(self.authority.proposals[0]['acceptedLeaseProofs'][0]['target'], expected[0]['target'])

    async def test_invalid_accepted_checkpoint_faults_startup_without_repair(self):
        self.authority.snapshot['spaces']['root']['entities']['relic']['q'][0] = 2.
        original = copy.deepcopy(self.authority.snapshot)
        with self.assertRaisesRegex(MaterialError, 'ENTITY_FIELD_MISMATCH'):
            await self.host.start()
        self.assertEqual(self.host.status()['state'], 'faulted')
        self.assertEqual(self.authority.snapshot, original)
        self.assertEqual(self.authority.proposals, [])

    async def test_storage_failure_fault_stops_without_retry_or_raw_error_exposure(self):
        await self.host.start()
        before = copy.deepcopy(self.authority.checkpoint)
        self.authority.apply_errors = [RuntimeError('private filesystem path and session.secret')]
        await self.host.set_running(True)
        await self.until(lambda: self.host.status()['state'] == 'faulted')
        count = self.authority.capture_count
        await asyncio.sleep(.55)
        status = self.host.status()
        self.assertEqual(status['fault']['code'], 'MATERIAL_APPLY_FAILED')
        self.assertNotIn('session.secret', json.dumps(status))
        self.assertNotIn('filesystem', json.dumps(status))
        self.assertEqual(self.authority.capture_count, count)
        self.assertEqual(self.authority.checkpoint, before)
        self.assertEqual(len(self.authority.proposals), 1)
        with self.assertRaises(MaterialHostError):
            await self.host.set_running(True)

    async def test_solver_failure_faults_without_submitting_any_candidate(self):
        await self.host.start()
        with mock.patch.object(AcceptedMaterialAdapter, 'propose',
                               side_effect=MaterialError('ENERGY_RESIDUAL')):
            await self.host.set_running(True)
            await self.until(lambda: self.host.status()['state'] == 'faulted')
        self.assertEqual(self.host.status()['fault']['code'], 'ENERGY_RESIDUAL')
        self.assertEqual(self.host.status()['fault']['stage'], 'proposal')
        self.assertEqual(self.authority.proposals, [])

    async def test_invalid_lease_is_a_fault_not_recoverable_race(self):
        await self.host.start()
        self.authority.apply_errors = [MaterialHostError('MATERIAL_LEASE_INVALIDATED')]
        await self.host.set_running(True)
        await self.until(lambda: self.host.status()['state'] == 'faulted')
        self.assertEqual(self.host.status()['fault']['code'], 'MATERIAL_LEASE_INVALIDATED')
        self.assertEqual(self.host.status()['discardedSteps'], 0)

    async def test_node_pause_and_capacity_stop_cleanly_without_retrying_forever(self):
        await self.host.start()
        for code in ('MATERIAL_PAUSED', 'JOURNAL_BACKPRESSURE'):
            with self.subTest(code=code):
                self.authority.apply_errors = [MaterialHostError(code)]
                await self.host.set_running(True)
                await self.until(lambda: self.host.status()['pauseReason'] == code)
                count = self.authority.capture_count
                await asyncio.sleep(.55)
                self.assertEqual(self.host.status()['state'], 'paused')
                self.assertIsNone(self.host.status()['fault'])
                self.assertEqual(self.authority.capture_count, count)

    async def test_malformed_private_apply_result_cannot_be_reported_as_accepted(self):
        await self.host.start()
        self.authority.apply_result = {'error': 'STALE_AUTHORITY', 'status': 409}
        await self.host.set_running(True)
        await self.until(lambda: self.host.status()['state'] == 'faulted')
        self.assertEqual(self.host.status()['acceptedSteps'], 0)
        self.assertEqual(self.host.status()['tick'], 0)
        self.assertEqual(self.host.status()['fault']['stage'], 'acceptance')

    async def test_stop_during_startup_drains_private_capture(self):
        gate = asyncio.Event()
        self.authority.capture_gate = gate
        starting = asyncio.create_task(self.host.start())
        await self.until(lambda: self.authority.capture_count == 1)
        stopping = asyncio.create_task(self.host.stop())
        await asyncio.sleep(.02)
        self.assertFalse(stopping.done())
        gate.set()
        with self.assertRaisesRegex(MaterialHostError, 'MATERIAL_HOST_STOPPED'):
            await starting
        await stopping
        self.assertIsNone(self.host._task)
        self.assertIsNone(self.host.status()['fault'])
        self.assertEqual(self.host.status()['state'], 'stopped')

    async def test_cancelling_startup_does_not_abandon_its_numerical_thread(self):
        entered, release = threading.Event(), threading.Event()
        self.release_events.append(release)
        original = validate_phase_checkpoint
        completed = threading.Event()

        def blocking(*args, **kwargs):
            entered.set()
            release.wait(5)
            result = original(*args, **kwargs)
            completed.set()
            return result

        with mock.patch('services.vivo.server.application.material_host.validate_phase_checkpoint', blocking):
            starting = asyncio.create_task(self.host.start())
            await self.until(entered.is_set)
            starting.cancel()
            await asyncio.sleep(.02)
            self.assertFalse(starting.done())
            stopping = asyncio.create_task(self.host.stop())
            await asyncio.sleep(.02)
            self.assertFalse(stopping.done())
            release.set()
            with self.assertRaises(asyncio.CancelledError):
                await starting
            await stopping
        self.assertTrue(completed.is_set())
        self.assertIsNone(self.host._task)

    async def test_restart_uses_accepted_field_then_removes_expired_actuation(self):
        await self.host.start()
        await self.host.set_running(True)
        await self.until(lambda: self.host.status()['acceptedSteps'] == 1)
        await self.host.stop()
        first = copy.deepcopy(self.authority.checkpoint)
        self.authority.constraints[0]['expiresAt'] = 999.
        self.host = PhaseApplicationHost(self.authority)
        await self.host.start()
        self.assertEqual(self.host.status()['tick'], 1)
        self.assertEqual(self.host.status()['state'], 'paused')
        self.assertEqual(self.authority.checkpoint, first)
        await self.host.set_running(True)
        await self.until(lambda: self.host.status()['acceptedSteps'] == 1)
        await self.host.set_running(False)
        last = self.authority.proposals[-1]
        self.assertEqual(last['baseFieldDigest'], first['digest'])
        self.assertEqual(last['acceptedLeaseProofs'], [])
        self.assertEqual(last['fieldState']['tick'], 2)
        self.assertEqual(last['fieldState']['simulationTime'], .04)
        self.assertLess(last['diagnostics']['suppliedWork'], 0)
        potential = unpack_array(last['fieldState']['fields']['relic']['potential'], (8,) * 4, 'real')
        self.assertEqual(float(abs(potential).max()), 0.)
        self.assertNotEqual(last['fieldState']['fields']['relic']['psi'], first['fields']['relic']['psi'])

    async def test_pause_run_toggles_do_not_bypass_wall_rate(self):
        await self.host.start()
        starts = []
        original = AcceptedMaterialAdapter.propose

        def timestamp(adapter, *args, **kwargs):
            starts.append(time.monotonic())
            return original(adapter, *args, **kwargs)

        with mock.patch.object(AcceptedMaterialAdapter, 'propose', timestamp):
            await self.host.set_running(True)
            for count in range(1, 4):
                await self.until(lambda: self.host.status()['acceptedSteps'] >= count)
                await self.host.set_running(False)
                if count < 3:
                    await self.host.set_running(True)
        self.assertEqual(len(starts), 3)
        self.assertGreaterEqual(starts[1] - starts[0], .47)
        self.assertGreaterEqual(starts[2] - starts[1], .47)

    async def test_wall_tick_rate_bounded_without_catchup(self):
        await self.host.start()
        starts = []
        original = AcceptedMaterialAdapter.propose

        def timestamp(adapter, *args, **kwargs):
            starts.append(time.monotonic())
            return original(adapter, *args, **kwargs)

        with mock.patch.object(AcceptedMaterialAdapter, 'propose', timestamp):
            await self.host.set_running(True)
            await self.until(lambda: self.host.status()['acceptedSteps'] >= 3)
            await self.host.set_running(False)
        self.assertEqual(len(starts), 3)
        self.assertGreaterEqual(starts[1] - starts[0], .47)
        self.assertGreaterEqual(starts[2] - starts[1], .47)


if __name__ == '__main__':
    unittest.main(verbosity=2)
