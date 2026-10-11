"""Private, opt-in phase-material pump for the mounted local application.

The injected callable is a trusted private-pipe capability, never an HTTP body:
``await private_call(op, args={...})`` returns data or raises a code-bearing error.
Only the Node authority accepts/persists a proposal. No checkpoint or proposal is
included in public status. This is a bounded 2 Hz wall-clock service with a .02
simulation-second step, not a real-time or physical-accuracy guarantee.
"""
from __future__ import annotations

import asyncio
import copy
from pathlib import Path
import re
import sys

# The supported launcher runs ``python -m server.local_application`` from
# services/vivo. Resolve the component from this checkout without PYTHONPATH or
# cwd assumptions. This does not add any HTTP/static-file route.
_REPOSITORY = Path(__file__).resolve().parents[4]
if str(_REPOSITORY) not in sys.path:
    sys.path.insert(0, str(_REPOSITORY))

from services.vivo_material import AcceptedMaterialAdapter, PhaseMaterialDriver
from services.vivo_material.driver import digest, identifier, number, require


WALL_TICK_HZ = 2.0
SIMULATION_STEP_SECONDS = .02
_RACE_CODES = frozenset({
    'MATERIAL_STALE_AUTHORITY', 'MATERIAL_STALE_FIELD',
    'MATERIAL_STALE_REVISION', 'MATERIAL_STALE_CONSTRAINTS',
})


class MaterialHostError(RuntimeError):
    """Safe machine-readable failure for a private host lifecycle operation."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _space(snapshot, space_id):
    require(isinstance(snapshot, dict), 'AUTHORITY_CAPTURE')
    digest(snapshot)  # Bound and validate plain data before recursive copying.
    require(snapshot.get('schema') == 'vivo.snapshot/1', 'AUTHORITY_CAPTURE')
    require(identifier(snapshot.get('worldId'))
            and identifier(snapshot.get('authorityId')), 'AUTHORITY_ID')
    require(type(snapshot.get('acceptedSequence')) is int
            and 0 <= snapshot['acceptedSequence'] < 2**53, 'AUTHORITY_SEQUENCE')
    require(isinstance(snapshot.get('stateHash'), str)
            and re.fullmatch(r'[0-9a-f]{64}', snapshot['stateHash']), 'AUTHORITY_HASH')
    require(number(snapshot.get('simulationTime'), 0, 1e9), 'AUTHORITY_CLOCK')
    require(snapshot.get('rootSpaceId') == space_id, 'MATERIAL_ROOT_REQUIRED')
    spaces = snapshot.get('spaces')
    require(isinstance(spaces, dict) and space_id in spaces, 'NO_SPACE')
    space = spaces[space_id]
    PhaseMaterialDriver._validate_space(space)
    require(space['id'] == space_id, 'SPACE_MISMATCH')
    require(isinstance(space.get('field'), dict), 'STALE_MATERIAL_FIELD')
    return space


def initialize_phase(snapshot):
    """Materialize only an explicit, pristine Node phaseWorkshopSeed declaration.

    The authority owner must commit the returned pair atomically. Initial q/v
    come from the actual 8^4 field observables, including floating-point roundoff.
    Existing identity, nested-space handles, Eyes and metadata are left untouched.
    """
    space = _space(snapshot, 'root')
    require(snapshot['acceptedSequence'] == 0 and snapshot['simulationTime'] == 0
            and space['field'].get('hash') == '0' * 64
            and all(e.get('revision') == 0 for e in space['entities'].values()),
            'INITIALIZATION_REQUIRES_SEED')
    checkpoint = PhaseMaterialDriver.initialize(
        space, shape=(8, 8, 8, 8), lengths=(8., 8., 8., 8.),
        simulation_time=snapshot['simulationTime']).checkpoint()
    result = copy.deepcopy(snapshot)
    root = result['spaces']['root']
    root['field'].update(codec=checkpoint['schema'], hash=checkpoint['digest'])
    for entity_id, record in checkpoint['fields'].items():
        root['entities'][entity_id]['q'] = copy.deepcopy(record['q'])
        root['entities'][entity_id]['v'] = copy.deepcopy(record['v'])
    validate_phase_checkpoint(result, checkpoint)
    return {'snapshot': result, 'checkpoint': checkpoint}


def validate_phase_checkpoint(snapshot, checkpoint, *, space_id='root'):
    """Validate accepted field bytes and exact canonical/checkpoint coherence.

    This does not evolve the field, accept a proposal, repair state or change the
    supplied objects. The return value is a detached, validated checkpoint.
    """
    space = _space(snapshot, space_id)
    accepted = PhaseMaterialDriver(checkpoint).checkpoint()
    require(accepted['spaceId'] == space_id, 'SPACE_MISMATCH')
    require(space['field'].get('codec') == accepted['schema']
            and space['field'].get('hash') == accepted['digest'], 'STALE_MATERIAL_FIELD')
    require(snapshot['simulationTime'] == accepted['simulationTime'], 'STALE_MATERIAL_TIME')
    require(set(space['entities']) == set(accepted['fields']), 'MATERIAL_MEMBERSHIP_CHANGED')
    for entity_id, record in accepted['fields'].items():
        entity = space['entities'][entity_id]
        PhaseMaterialDriver._validate_entity(entity, space, accepted['lengths'])
        require(entity['revision'] == record['revision'], 'STALE_ENTITY_REVISION')
        require(entity['chart'] == record['chart']
                and entity['fieldMembership'] == record['membership'], 'MATERIAL_MEMBERSHIP_CHANGED')
        require(entity['q'] == record['q'] and entity['v'] == record['v'], 'ENTITY_FIELD_MISMATCH')
    return accepted


class PhaseApplicationHost:
    """One opt-in capture -> threaded proposal -> atomic authority commit loop.

    Pause/stop invalidate pending capture/computation by generation. The private
    authority must also reject materialApply after its own Pause fence; an already
    transmitted commit cannot be recalled by cancelling a Python coroutine.
    stop() drains in-flight work before returning, and must precede bridge.stop().
    A fault is terminal until application restart; enabling run never clears one.
    """

    def __init__(self, private_call, *, space_id='root'):
        if not callable(private_call) or not identifier(space_id):
            raise MaterialHostError('MATERIAL_HOST_CONFIGURATION')
        self._call = private_call
        self._space_id = space_id
        self._task = None
        self._running = False
        self._started = False
        self._stopped = False
        self._generation = 0
        self._wake = asyncio.Event()
        self._lifecycle_lock = asyncio.Lock()
        self._pause_reason = None
        self._in_flight = False
        self._fault = None
        self._world_id = None
        self._authority_id = None
        self._accepted_steps = 0
        self._discarded_steps = 0
        self._last_sequence = None
        self._last_tick = None
        self._simulation_time = None
        self._next_tick_at = 0.

    def status(self):
        state = ('faulted' if self._fault else 'stopped' if self._stopped else
                 'running' if self._running else 'paused' if self._started else 'not-started')
        return {'state': state, 'running': self._running,
                'wallTickHz': WALL_TICK_HZ,
                'simulationStepSeconds': SIMULATION_STEP_SECONDS,
                'stepInFlight': self._in_flight,
                'acceptedSteps': self._accepted_steps, 'discardedSteps': self._discarded_steps,
                'acceptedSequence': self._last_sequence, 'tick': self._last_tick,
                'simulationTime': self._simulation_time, 'pauseReason': self._pause_reason,
                'fault': copy.deepcopy(self._fault)}

    def _fail(self, error, stage):
        code = getattr(error, 'code', None)
        if not isinstance(code, str) or not re.fullmatch(r'[A-Z][A-Z0-9_]{0,63}', code):
            code = 'MATERIAL_' + stage.upper() + '_FAILED'
        self._fault = {'code': code, 'stage': stage,
                       'message': 'Material evolution stopped. Inspect the local service before restarting.'}
        self._running = False
        self._generation += 1
        self._wake.set()

    def _capture_copy(self, capture, *, validate=False):
        require(isinstance(capture, dict), 'AUTHORITY_CAPTURE')
        digest(capture)
        required = {'snapshot', 'constraints', 'authorityTimeMs', 'checkpoint'}
        require(required <= set(capture) <= required | {'diagnostics', 'fieldDiagnostics'},
                'AUTHORITY_CAPTURE')
        require(capture.get('diagnostics') is None or isinstance(capture['diagnostics'], dict),
                'AUTHORITY_DIAGNOSTICS')
        require(isinstance(capture.get('fieldDiagnostics', []), list)
                and len(capture.get('fieldDiagnostics', [])) <= 4, 'AUTHORITY_DIAGNOSTICS')
        # Accepted diagnostics are bounded above but are not proposal input.
        detached = copy.deepcopy({key: capture[key] for key in required})
        snapshot = detached['snapshot']
        _space(snapshot, self._space_id)
        require(isinstance(detached['constraints'], list)
                and len(detached['constraints']) <= 256, 'CONSTRAINT_BUDGET')
        require(number(detached['authorityTimeMs'], 0, 2**53 - 1), 'AUTHORITY_CLOCK')
        if self._world_id is not None:
            require(snapshot['worldId'] == self._world_id
                    and snapshot['authorityId'] == self._authority_id, 'AUTHORITY_MISMATCH')
        if validate:
            validate_phase_checkpoint(snapshot, detached['checkpoint'], space_id=self._space_id)
        return detached

    async def _compute(self, function, *args, **kwargs):
        # Cancellation cannot stop a running executor thread. Keep its task alive
        # and drain it before cancellation releases lifecycle ownership.
        work = asyncio.create_task(asyncio.to_thread(function, *args, **kwargs))
        try:
            return await asyncio.shield(work)
        except asyncio.CancelledError:
            try:
                await asyncio.shield(work)
            except Exception:
                pass
            raise

    async def start(self):
        async with self._lifecycle_lock:
            if self._stopped or self._fault:
                raise MaterialHostError('MATERIAL_HOST_RESTART_REQUIRED')
            if self._started:
                return self.status()
            try:
                capture = await self._call('materialCapture', args={'spaceId': self._space_id})
                capture = await self._compute(self._capture_copy, capture, validate=True)
                if self._stopped:
                    raise MaterialHostError('MATERIAL_HOST_STOPPED')
                snapshot, checkpoint = capture['snapshot'], capture['checkpoint']
                self._world_id, self._authority_id = snapshot['worldId'], snapshot['authorityId']
                self._last_sequence, self._last_tick = snapshot['acceptedSequence'], checkpoint['tick']
                self._simulation_time = checkpoint['simulationTime']
                self._started = True
                self._task = asyncio.create_task(self._loop(), name='vivo-phase-material')
            except asyncio.CancelledError:
                self._stopped = True
                self._generation += 1
                raise
            except Exception as error:
                if not self._stopped:
                    self._fail(error, 'startup')
                raise
            return self.status()

    async def set_running(self, running):
        if type(running) is not bool:
            raise MaterialHostError('MATERIAL_RUN_FLAG')
        if running and (not self._started or self._stopped or self._fault):
            raise MaterialHostError('MATERIAL_HOST_RESTART_REQUIRED')
        if running != self._running:
            self._running = running
            self._pause_reason = None
            self._generation += 1
            self._wake.set()
        return self.status()

    async def observe(self, entity_id, axes, fixed):
        """Return a bounded read-only slice of the currently accepted field.

        Observation captures the authority checkpoint through the same private
        pipe used by the material pump, then asks the frozen solver to derive a
        slice.  It never accepts a proposal, mutates the checkpoint, or exposes
        the serialized field bytes to the browser.
        """
        require(identifier(entity_id), 'MATERIAL_ENTITY')
        require(isinstance(axes, (list, tuple)) and len(axes) == 2
                and len(set(axes)) == 2
                and all(type(axis) is int and 0 <= axis < 4 for axis in axes),
                'MATERIAL_VIEW_AXES')
        require(isinstance(fixed, dict)
                and set(fixed) == set(range(4)) - set(axes)
                and all(type(index) is int and 0 <= index < 8 for index in fixed.values()),
                'MATERIAL_VIEW_FIXED')
        capture = await self._call('materialCapture', args={'spaceId': self._space_id})
        capture = await self._compute(self._capture_copy, capture, validate=True)
        snapshot, checkpoint = capture['snapshot'], capture['checkpoint']
        space = _space(snapshot, self._space_id)
        require(entity_id in space['entities'], 'NO_ENTITY')
        result = await self._compute(PhaseMaterialDriver(checkpoint).observe,
                                     entity_id, tuple(axes), dict(fixed))
        require(space['field'].get('hash') == result['materialDigest'],
                'MATERIAL_DIGEST_MISMATCH')
        shape = tuple(checkpoint['shape'])
        lengths = tuple(checkpoint['lengths'])
        fixed_coordinates = {str(axis): -lengths[axis] / 2
                             + index * lengths[axis] / shape[axis]
                             for axis, index in fixed.items()}
        return {**result, 'projectionSchema': 'vivo.material-observation/1',
                'spaceId': self._space_id, 'worldDimension': len(shape),
                'resolution': list(shape), 'densityDefinition': 'abs(psi)**2',
                'sampling': 'exact-lattice; no interpolation',
                'fixedCoordinates': fixed_coordinates,
                'acceptedStateHash': snapshot['stateHash'],
                'acceptedFieldDigest': space['field']['hash'],
                'acceptedSequence': snapshot['acceptedSequence'],
                'simulationTime': snapshot['simulationTime'],
                'tick': checkpoint['tick']}

    async def stop(self):
        self._running = False
        self._stopped = True
        self._generation += 1
        self._wake.set()
        async with self._lifecycle_lock:
            task = self._task
        if task is not None:
            # Do not cancel to_thread and pretend its CPU work stopped. Drain the
            # single worker; generation prevents its result from being submitted.
            await asyncio.shield(task)
        return self.status()

    def _current(self, generation):
        return self._running and not self._stopped and generation == self._generation

    def _propose(self, capture):
        captured = self._capture_copy(capture)
        checkpoint = captured.pop('checkpoint')
        snapshot = captured['snapshot']
        adapter = AcceptedMaterialAdapter(
            lambda: copy.deepcopy(captured), world_id=self._world_id,
            authority_id=self._authority_id, space_id=self._space_id)
        return adapter.propose(checkpoint, expected_sequence=snapshot['acceptedSequence'],
                               expected_state_hash=snapshot['stateHash'],
                               dt=SIMULATION_STEP_SECONDS, tick=checkpoint['tick'] + 1)

    async def _step(self, generation):
        stage = 'capture'
        self._in_flight = True
        try:
            capture = await self._call('materialCapture', args={'spaceId': self._space_id})
            if not self._current(generation):
                self._discarded_steps += 1
                return
            stage = 'proposal'
            proposal = await self._compute(self._propose, capture)
            if not self._current(generation):
                self._discarded_steps += 1
                return
            stage = 'apply'
            accepted = await self._call('materialApply', args={'proposal': proposal})
            # A private apply must return the actual committed snapshot, never a
            # receipt-shaped error or an HTTP StreamResponse. No fabricated state.
            stage = 'acceptance'
            await self._compute(validate_phase_checkpoint, accepted, proposal['fieldState'],
                                    space_id=self._space_id)
            require(accepted['worldId'] == self._world_id
                    and accepted['authorityId'] == self._authority_id, 'AUTHORITY_MISMATCH')
            require(accepted['acceptedSequence'] == proposal['baseSequence'] + 1,
                    'MATERIAL_ACCEPTANCE_SEQUENCE')
            self._last_sequence = accepted['acceptedSequence']
            self._last_tick = proposal['fieldState']['tick']
            self._simulation_time = accepted['simulationTime']
            self._accepted_steps += 1
        except Exception as error:
            code = getattr(error, 'code', None)
            if stage in ('capture', 'apply') and code in ('MATERIAL_PAUSED', 'JOURNAL_BACKPRESSURE'):
                self._discarded_steps += 1
                if self._current(generation):
                    self._running = False
                    self._pause_reason = code
                    self._generation += 1
                    self._wake.set()
            elif stage == 'apply' and code in _RACE_CODES:
                self._discarded_steps += 1
            else:
                self._fail(error, stage)
        finally:
            self._in_flight = False

    async def _loop(self):
        loop = asyncio.get_running_loop()
        try:
            while not self._stopped:
                if not self._running:
                    self._wake.clear()
                    await self._wake.wait()
                    continue
                # Preserve the rate limit across repeated Pause/Run transitions.
                # Slow computation never creates a queue of catch-up ticks.
                delay = self._next_tick_at - loop.time()
                if delay > 0:
                    self._wake.clear()
                    try:
                        await asyncio.wait_for(self._wake.wait(), delay)
                    except asyncio.TimeoutError:
                        pass
                    continue
                generation = self._generation
                self._next_tick_at = loop.time() + 1. / WALL_TICK_HZ
                await self._step(generation)
        finally:
            self._running = False
            self._stopped = True
            self._generation += 1
            self._wake.set()
