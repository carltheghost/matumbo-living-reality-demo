"""Versioned, bounded material adapter over the unmodified numerical teacher.

This is a dimensionless 4-spatial-dimensional Gross–Pitaevskii field on a flat
periodic torus, not liquid helium or an elastic/viscous/adaptive material. Objects
are distinct field populations; rendered centroids/tracers add no material mass.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
import struct
import numpy as np

REFERENCE_SHA256 = '0580e63e9a7dac96b70ffd5ed559b2ccd063f0526066fe38bafa571ca0d27947'
LAW_VERSION = 'vivo.phase.periodic-compliant/1'
SCHEMA = 'vivo.material.phase/1'
HASH_CODEC = 'vivo.f64-json-sha256/1'
MAX_CELLS = 262144
MAX_FIELDS = 4
MAX_DT = .02
MIN_DT = .0001
MAX_TICKS = 1_000_000
MAX_FORCE = 4.0
MAX_STIFFNESS = 4.0
_ID = re.compile(r'^[A-Za-z0-9_.:-]{1,128}$')
_REFERENCE = None


class MaterialError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def require(condition, code):
    if not condition:
        raise MaterialError(code)


def number(v, low, high):
    return type(v) in (int, float) and low <= v <= high and math.isfinite(v)


def identifier(v):
    return isinstance(v, str) and bool(_ID.fullmatch(v))


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    seen = set()
    nodes = 0
    characters = 0
    def encode(v, depth=0):
        nonlocal nodes, characters
        nodes += 1
        require(depth <= 32 and nodes <= 10000, 'HASH_BUDGET')
        if type(v) in (int, float):
            require(number(v, -(2**53-1), 2**53-1), 'HASH_NUMBER')
            return ['number', struct.pack('<d', 0. if v == 0 else float(v)).hex()]
        if v is None:
            return ['null']
        if type(v) is bool:
            return ['boolean', v]
        if isinstance(v, str):
            characters += len(v.encode('utf-16-le', 'surrogatepass')) // 2
            require(characters <= 16*1024*1024, 'HASH_BUDGET')
            return ['string', v]
        require(isinstance(v, (list, tuple, dict)), 'HASH_TYPE')
        require(id(v) not in seen, 'HASH_CYCLE')
        seen.add(id(v))
        try:
            if isinstance(v, dict):
                require(all(isinstance(k, str) and k.isascii() and len(k) <= 128 for k in v), 'HASH_KEY')
                return ['object', [[k, encode(v[k], depth+1)] for k in sorted(v)]]
            return ['array', [encode(x, depth+1) for x in v]]
        finally:
            seen.remove(id(v))
    return hashlib.sha256(canonical(encode(value)).encode()).hexdigest()


def reference():
    global _REFERENCE
    if _REFERENCE is None:
        source = Path(__file__).resolve().parents[2] / 'research/vivo-phase-fabric/viva_phase/solver.py'
        require(source.is_file(), 'REFERENCE_MISSING')
        require(hashlib.sha256(source.read_bytes()).hexdigest() == REFERENCE_SHA256, 'REFERENCE_VERSION')
        spec = importlib.util.spec_from_file_location('_vivo_material_frozen_reference', source)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        _REFERENCE = module
    return _REFERENCE


def validate_config(shape, lengths):
    require(isinstance(shape, (list, tuple)) and len(shape) == 4, 'UNSUPPORTED_DIMENSION')
    require(all(type(n) is int and 8 <= n <= 16 and n % 2 == 0 for n in shape), 'UNSUPPORTED_RESOLUTION')
    require(isinstance(lengths, (list, tuple)) and len(lengths) == 4
            and all(number(v, 4, 32) for v in lengths), 'UNSUPPORTED_DOMAIN')
    require(math.prod(shape) <= MAX_CELLS, 'CELL_BUDGET')


def frame(q, lengths):
    return isinstance(q, (list, tuple)) and len(q) == 4 and all(
        number(v, -L / 2, L / 2) and v < L / 2 for v, L in zip(q, lengths))


def wrap(q, lengths):
    return [(float(v) + L / 2) % L - L / 2 for v, L in zip(q, lengths)]


def pack_array(value, kind):
    a = np.asarray(value, dtype='<c16' if kind == 'complex' else '<f8', order='C')
    return base64.b64encode(a.tobytes()).decode('ascii')


def unpack_array(value, shape, kind):
    dtype = '<c16' if kind == 'complex' else '<f8'
    size = math.prod(shape) * np.dtype(dtype).itemsize
    require(isinstance(value, str) and len(value) == 4 * ((size + 2) // 3), 'FIELD_BYTES')
    try:
        raw = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise MaterialError('FIELD_BYTES') from exc
    require(len(raw) == size, 'FIELD_BYTES')
    a = np.frombuffer(raw, dtype=dtype).reshape(shape).copy()
    require(np.isfinite(a).all(), 'NONFINITE_FIELD')
    return a


def summary(field):
    rho, mass = field.density, field.norm()
    spectral = np.fft.fftn(field.psi, norm='ortho')
    frequencies = field.grid.frequencies()
    k2 = sum(k*k for k in frequencies)
    # Exact tangent of the semidiscrete density under the real-potential GP
    # equation. Local real potential/nonlinearity cancel in d|psi|^2/dt.
    dpsi = -.5j*np.fft.ifftn(k2*spectral, norm='ortho')
    drho = 2*np.real(np.conjugate(field.psi)*dpsi)
    centers, coherences, velocity, mean_current = [], [], [], []
    for axis, (x, L) in enumerate(zip(field.grid.coordinates(), field.grid.lengths)):
        basis = np.exp(2j*np.pi*x/L)
        moment = np.sum(rho*basis)*field.grid.dv/mass
        tangent = np.sum(drho*basis)*field.grid.dv/mass
        coherence = float(abs(moment))
        # A delocalized field has no defensible object centroid. Reject a proposal
        # rather than fabricate a position or copy the requested target.
        require(coherence >= .015, 'CENTROID_DELOCALIZED')
        centers.append(float(np.angle(moment)*L/(2*np.pi)))
        coherences.append(coherence)
        velocity.append(float(np.imag(tangent/moment)*L/(2*np.pi)))
        mean_current.append(float(np.sum(frequencies[axis]*np.abs(spectral)**2)*field.grid.dv/mass))
    edge = np.zeros(field.grid.shape, dtype=bool)
    for k, n, L in zip(frequencies, field.grid.shape, field.grid.lengths):
        edge |= np.abs(k) >= (2*np.pi/L)*(n/2-1)
    high_frequency_mass = float(np.sum(np.abs(spectral[edge])**2)*field.grid.dv/mass)
    return {'q': wrap(centers, field.grid.lengths), 'v': velocity,
            'centerCoherence': coherences, 'mass': mass,
            'meanCurrentPerMass': mean_current, 'highFrequencyMassFraction': high_frequency_mass}


class PhaseMaterialDriver:
    """Implements the frozen MaterialDriver vocabulary; step produces a proposal.

    checkpoint() is driver-local candidate state. Only the authority's committed
    fieldState is accepted. The adapter constructs a fresh driver per proposal.
    """
    def __init__(self, checkpoint=None):
        self._state = None
        if checkpoint is not None:
            self.restore(checkpoint)

    @staticmethod
    def capabilities():
        return {'lawVersion': LAW_VERSION, 'modelHashes': [], 'teacherHash': REFERENCE_SHA256,
                'profiles': ['phase'], 'modes': ['analytic'], 'spatialDimensions': [4],
                'shapeAxis': {'min': 8, 'max': 16, 'even': True},
                'maxFields': MAX_FIELDS, 'maxCells': MAX_CELLS, 'maxDt': MAX_DT,
                'minDt': MIN_DT, 'maxTicks': MAX_TICKS, 'boundary': 'periodic',
                'metric': 'Euclidean / flat torus', 'clock': 'separate',
                'coupling': 'finite-stiffness periodic potential', 'damping': False,
                'learned': False, 'spatialConvergenceEstablished': False,
                'quantitativePhysicalValidation': False}

    @classmethod
    def initialize(cls, space, *, shape=(8, 8, 8, 8), lengths=(8., 8., 8., 8.),
                   mass=1., coupling=1., simulation_time=0.):
        validate_config(shape, lengths)
        require(number(mass, .01, 100) and number(coupling, 0, 10), 'INVALID_PARAMETERS')
        require(number(simulation_time, 0, 1e9), 'INVALID_CLOCK')
        cls._validate_space(space)
        require(len(space['entities']) * math.prod(shape) <= MAX_CELLS, 'CELL_BUDGET')
        teacher = reference()
        grid = teacher.Grid(tuple(shape), tuple(lengths))
        fields = {}
        for eid, entity in sorted(space['entities'].items()):
            cls._validate_entity(entity, space, lengths)
            amplitude = np.ones(shape)
            for x, L, q in zip(grid.coordinates(), lengths, entity['q']):
                amplitude *= 1 + .4 * np.cos(2 * np.pi * (x - q) / L)
            # Band-limited real initial amplitude avoids an artificial Nyquist
            # momentum from sampling sqrt(density) on an even lattice.
            psi = (amplitude * np.sqrt(mass / (np.sum(amplitude**2) * grid.dv))).astype(complex)
            f = teacher.PhaseField(grid, psi, coupling)
            f.time = float(simulation_time)
            s = summary(f)
            require(max(abs(a-b) for a,b in zip(s['q'], entity['q'])) < 1e-8, 'INITIAL_CENTER')
            # Initial velocity must be zero: arbitrary nonperiodic phase gradients
            # would silently violate this domain's periodic momentum quantization.
            require(entity['v'] == [0, 0, 0, 0], 'INITIAL_VELOCITY_UNSUPPORTED')
            fields[eid] = {'id': eid, 'chart': entity['chart'], 'revision': entity['revision'],
                           'membership': list(entity['fieldMembership']), 'initialMass': float(mass),
                           'psi': pack_array(f.psi, 'complex'),
                           'potential': pack_array(np.zeros(shape), 'real'),
                           'q': s['q'], 'v': s['v']}
        state = {'schema': SCHEMA, 'hashCodec': HASH_CODEC, 'lawVersion': LAW_VERSION, 'teacherHash': REFERENCE_SHA256,
                 'modelHashes': [], 'spaceId': space['id'], 'shape': list(shape),
                 'lengths': list(map(float, lengths)), 'coupling': float(coupling),
                 'simulationTime': float(simulation_time), 'tick': 0, 'fields': fields}
        state['digest'] = digest(state)
        return cls(state)

    @staticmethod
    def _validate_space(space):
        require(isinstance(space, dict) and identifier(space.get('id')), 'INVALID_SPACE')
        require(space.get('dimension') == 4 and space.get('intrinsicDimension') == 4, 'UNSUPPORTED_DIMENSION')
        require(space.get('law') == {'id': 'vivo.phase.periodic-compliant', 'version': '1'}, 'LAW_MISMATCH')
        require(space.get('modelHashes') == [], 'UNSUPPORTED_MODEL')
        require(space.get('metricId') == 'metric.flat-euclidean.v1'
                and space.get('topologyId') == 'topology.periodic-torus.v1'
                and space.get('atlasId') == 'atlas.periodic-cartesian.v1', 'UNSUPPORTED_GEOMETRY')
        require(isinstance(space.get('entities'), dict) and 1 <= len(space['entities']) <= MAX_FIELDS, 'FIELD_BUDGET')
        memberships = []
        for eid, entity in space['entities'].items():
            require(isinstance(entity, dict) and entity.get('id') == eid and identifier(eid), 'ENTITY_ID')
            member = entity.get('fieldMembership')
            require(isinstance(member, list) and len(member) == 1 and identifier(member[0]), 'FIELD_MEMBERSHIP')
            memberships += member
        require(len(set(memberships)) == len(memberships), 'DUPLICATE_MASS_MEMBERSHIP')

    @staticmethod
    def _validate_entity(entity, space, lengths):
        require(entity.get('spaceId') == space['id'] and entity.get('dimension') == 4, 'ENTITY_FRAME')
        require(identifier(entity.get('chart')), 'ENTITY_FRAME')
        require(entity.get('materialProfile') == 'phase', 'UNSUPPORTED_PROFILE')
        require(type(entity.get('revision')) is int and 0 <= entity['revision'] < 2**53-1, 'ENTITY_REVISION')
        require(frame(entity.get('q'), lengths), 'DOMAIN_BOUNDS')
        require(isinstance(entity.get('v'), list) and len(entity['v']) == 4
                and all(number(v, -100, 100) for v in entity['v']), 'ENTITY_VELOCITY')

    def checkpoint(self):
        require(self._state is not None, 'NOT_INITIALIZED')
        return copy.deepcopy(self._state)

    def restore(self, checkpoint):
        require(isinstance(checkpoint, dict), 'INVALID_CHECKPOINT')
        require(set(checkpoint) == {'schema','hashCodec','lawVersion','teacherHash','modelHashes',
                'spaceId','shape','lengths','coupling','simulationTime','tick','fields','digest'}, 'CHECKPOINT_FIELDS')
        # Bounded codec validation precedes recursive copying of untrusted input.
        supplied = checkpoint.get('digest')
        body = {k:v for k,v in checkpoint.items() if k != 'digest'}
        require(supplied == digest(body), 'CHECKPOINT_HASH')
        state = copy.deepcopy(body)
        require(state.get('schema') == SCHEMA and state.get('hashCodec') == HASH_CODEC
                and state.get('lawVersion') == LAW_VERSION
                and state.get('teacherHash') == REFERENCE_SHA256 and state.get('modelHashes') == [], 'CHECKPOINT_VERSION')
        shape, lengths = state.get('shape'), state.get('lengths')
        validate_config(shape, lengths)
        fields = state.get('fields')
        require(isinstance(fields, dict) and 1 <= len(fields) <= MAX_FIELDS, 'FIELD_BUDGET')
        require(math.prod(shape) * len(fields) <= MAX_CELLS, 'CELL_BUDGET')
        require(number(state.get('simulationTime'), 0, 1e9)
                and type(state.get('tick')) is int and 0 <= state['tick'] <= MAX_TICKS, 'INVALID_CLOCK')
        require(identifier(state.get('spaceId')) and number(state.get('coupling'), 0, 10), 'INVALID_CHECKPOINT')
        memberships = []
        for eid, f in fields.items():
            require(isinstance(f, dict), 'INVALID_FIELD_RECORD')
            require(set(f) == {'id','chart','revision','membership','initialMass','psi','potential','q','v'}, 'FIELD_RECORD_KEYS')
            require(identifier(eid) and f.get('id') == eid and identifier(f.get('chart')), 'ENTITY_ID')
            require(type(f.get('revision')) is int and 0 <= f['revision'] < 2**53-1, 'ENTITY_REVISION')
            require(frame(f.get('q'), lengths), 'DOMAIN_BOUNDS')
            require(isinstance(f.get('v'), list) and len(f['v']) == 4
                    and all(number(v, -100, 100) for v in f['v']), 'ENTITY_VELOCITY')
            require(isinstance(f.get('membership'), list) and len(f['membership']) == 1
                    and identifier(f['membership'][0]), 'FIELD_MEMBERSHIP')
            memberships += f['membership']
            psi = unpack_array(f.get('psi'), shape, 'complex')
            pot = unpack_array(f.get('potential'), shape, 'real')
            require(np.max(np.abs(psi)) <= 100 and np.max(np.abs(pot)) <= 1e4, 'FIELD_BOUNDS')
            require(number(f.get('initialMass'), .01, 100), 'MASS_BOUNDS')
            actual = float(np.sum(np.abs(psi)**2) * math.prod(L/n for L,n in zip(lengths,shape)))
            require(abs(actual/f['initialMass'] - 1) < 1e-8, 'MASS_DRIFT')
            teacher = reference()
            field = teacher.PhaseField(teacher.Grid(tuple(shape), tuple(lengths)), psi, state['coupling'])
            observed = summary(field)
            require(np.allclose(observed['q'], f['q'], rtol=0, atol=1e-10)
                    and np.allclose(observed['v'], f['v'], rtol=0, atol=1e-10), 'CHECKPOINT_OBSERVABLE_MISMATCH')
        require(len(set(memberships)) == len(memberships), 'DUPLICATE_MASS_MEMBERSHIP')
        state['digest'] = supplied
        self._state = state

    def _field(self, record):
        s = self._state
        teacher = reference()
        f = teacher.PhaseField(teacher.Grid(tuple(s['shape']), tuple(s['lengths'])),
                               unpack_array(record['psi'], s['shape'], 'complex'), s['coupling'])
        f.time, f.steps = s['simulationTime'], s['tick']
        return f

    def observe(self, entity_id, axes, fixed):
        require(entity_id in self._state['fields'], 'NO_ENTITY')
        # The teacher copies its result; the JSON values returned here are also detached.
        z = self._field(self._state['fields'][entity_id]).observer_slice(tuple(axes), fixed)
        return {'entityId': entity_id, 'axes': list(axes), 'fixed': dict(fixed),
                'shape': list(z.shape), 'density': (np.abs(z)**2).tolist(),
                'phase': np.angle(z).tolist(), 'materialDigest': self._state['digest']}

    def _potential(self, field, grip):
        value = np.zeros(field.grid.shape)
        if grip is None:
            return value, 0.
        require(number(grip.get('maxForce'), 0, MAX_FORCE)
                and number(grip.get('stiffness'), 0, MAX_STIFFNESS), 'ACTUATOR_BOUNDS')
        require(grip.get('damping') == 0, 'DAMPING_UNSUPPORTED')
        target = grip.get('target', {})
        require(target.get('spaceId') == self._state['spaceId'] and target.get('dimension') == 4
                and frame(target.get('q'), field.grid.lengths), 'TARGET_FRAME')
        stiffness = float(grip['stiffness'])
        ks = [2*np.pi/L for L in field.grid.lengths]
        force_bound = math.sqrt(sum((stiffness/k)**2 for k in ks))
        scale = min(1., grip['maxForce']/force_bound) if force_bound else 1.
        for x, k, q in zip(field.grid.coordinates(), ks, target['q']):
            value += scale*stiffness/(k*k)*(1 - np.cos(k*(x-q)))
        return value, force_bound*scale

    def step(self, input):
        require(self._state is not None, 'NOT_INITIALIZED')
        require(isinstance(input, dict) and input.get('mode') == 'analytic', 'UNSUPPORTED_MODE')
        require(input.get('randomState') == 'deterministic:none', 'RANDOM_STATE')
        require(number(input.get('dt'), MIN_DT, MAX_DT), 'TIMESTEP_BOUNDS')
        require(type(input.get('tick')) is int and input['tick'] == self._state['tick']+1
                and input['tick'] <= MAX_TICKS, 'STALE_TICK')
        require(number(self._state['simulationTime'] + input['dt'], 0, 1e9), 'CLOCK_EXHAUSTED')
        require(input.get('fieldState') == self._state, 'FIELD_STATE_MISMATCH')
        space = input.get('space')
        self._validate_space(space)
        require(space['id'] == self._state['spaceId'], 'SPACE_MISMATCH')
        require(set(space['entities']) == set(self._state['fields']), 'MATERIAL_MEMBERSHIP_CHANGED')
        grips = input.get('grips')
        require(isinstance(grips, (list, tuple)) and len(grips) <= MAX_FIELDS, 'GRIP_BUDGET')
        by_id = {}
        for g in grips:
            require(isinstance(g, dict) and identifier(g.get('entityId'))
                    and g['entityId'] in space['entities'], 'GRIP_ENTITY')
            require(g['entityId'] not in by_id and identifier(g.get('leaseId')), 'DUPLICATE_GRIP')
            require(g.get('source') in ['touch', 'hand', 'eye-confirmed', 'keyboard'], 'INPUT_SOURCE')
            require(isinstance(g.get('target'), dict)
                    and g['target'].get('chart') == space['entities'][g['entityId']]['chart'], 'TARGET_FRAME')
            by_id[g['entityId']] = g
        next_state = copy.deepcopy(self._state)
        updates, field_stats = [], []
        total = {'mass': 0., 'energy': 0., 'suppliedWork': 0., 'dissipatedEnergy': 0., 'residual': 0.}
        for eid, old in sorted(self._state['fields'].items()):
            entity = space['entities'][eid]
            self._validate_entity(entity, space, self._state['lengths'])
            require(entity['revision'] == old['revision'], 'STALE_ENTITY_REVISION')
            require(old['revision'] + 1 < 2**53-1, 'REVISION_EXHAUSTED')
            require(entity['fieldMembership'] == old['membership'] and entity['chart'] == old['chart'], 'MATERIAL_MEMBERSHIP_CHANGED')
            require(np.allclose(entity['q'], old['q'], rtol=0, atol=1e-10)
                    and np.allclose(entity['v'], old['v'], rtol=0, atol=1e-10), 'ENTITY_FIELD_MISMATCH')
            f = self._field(old)
            previous_potential = unpack_array(old['potential'], self._state['shape'], 'real')
            potential, force_bound = self._potential(f, by_id.get(eid))
            before_energy = f.energy(previous_potential)
            work = float(np.sum(f.density*(potential-previous_potential))*f.grid.dv)
            f.step(float(input['dt']), potential)
            s = summary(f)
            require(abs(s['mass']/old['initialMass']-1) < 1e-8, 'MASS_DRIFT')
            require(all(abs(v) <= 100 for v in s['v']), 'VELOCITY_BOUNDS')
            energy = f.energy(potential)
            residual = energy - before_energy - work
            # A conservative local truncation guard. Refinement tests establish
            # accuracy separately; this guard must not be advertised as proof.
            require(abs(residual) <= 1e-3 * max(1., abs(energy), abs(before_energy)), 'ENERGY_RESIDUAL')
            next_state['fields'][eid] = {**old, 'revision': old['revision']+1,
                'psi': pack_array(f.psi, 'complex'), 'potential': pack_array(potential, 'real'),
                'q': s['q'], 'v': s['v']}
            updates.append({'id': eid, 'q': s['q'], 'v': s['v'], 'chart': old['chart']})
            total['mass'] += s['mass']; total['energy'] += energy
            total['suppliedWork'] += work; total['residual'] += residual
            field_stats.append({'entityId': eid, 'centerCoherence': s['centerCoherence'],
                                'mass': s['mass'], 'relativeMassError': s['mass']/old['initialMass']-1,
                                'forceBoundPerUnitMass': force_bound,
                                'meanCurrentPerMass': s['meanCurrentPerMass'],
                                'highFrequencyMassFraction': s['highFrequencyMassFraction'],
                                'resolutionWarning': s['highFrequencyMassFraction'] > .01})
        next_state['tick'] = input['tick']
        next_state['simulationTime'] += float(input['dt'])
        next_state.pop('digest')
        next_state['digest'] = digest(next_state)
        # No mutation occurs before every entity and numerical guard succeeds.
        self._state = next_state
        return {'fieldState': self.checkpoint(), 'entityUpdates': copy.deepcopy(updates),
                'diagnostics': total, 'fieldDiagnostics': field_stats,
                'lawVersion': LAW_VERSION, 'modelHashes': [], 'randomState': 'deterministic:none'}
