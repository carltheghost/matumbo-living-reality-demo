"""Viva dimensional/neural reference experiment, not the phone application.

All geometry and forces use D coordinates. No renderer is needed to run the tests.
The learned edge law is a small MLP applied to invariant distances. Its equal and
opposite pair forces are translation/rotation equivariant by construction.

Units and the constitutive law are invented for this experiment. This is neither
a reconstruction of natural higher-dimensional physics nor a multiplayer server.
Requires Python 3.10+ and NumPy. Training uses only NumPy, with analytic gradients.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import copy
import hashlib
import json
import math
import numpy as np


def vector(x, d: int | None = None) -> np.ndarray:
    a = np.asarray(x, dtype=np.float64)
    if a.ndim != 1 or not np.isfinite(a).all():
        raise ValueError('Expected a finite one-dimensional coordinate vector')
    if not 3 <= len(a) <= 11 or (d is not None and len(a) != d):
        raise ValueError('Expected matching coordinates in 3 through 11 dimensions')
    return a.copy()


def dimension_contract(d: int) -> dict:
    if type(d) is not int or not 3 <= d <= 11:
        raise ValueError('Spatial dimension must be an integer from 3 to 11')
    return {'spatial_dimension': d, 'clock_dimension': 1,
            'hypercube_vertices': 2 ** d, 'hypercube_edges': d * 2 ** (d - 1),
            'hypercube_boundary_cells': 2 * d,
            'boundary_cell_dimension': d - 1,
            'rotation_parameters': d * (d - 1) // 2,
            'ray_direction_manifold_dimension': d - 1}


def plane_rotation(d: int, a: int, b: int, angle: float) -> np.ndarray:
    dimension_contract(d)
    if a == b or not 0 <= a < d or not 0 <= b < d or not math.isfinite(angle):
        raise ValueError('Rotation requires two distinct active axes and a finite angle')
    r = np.eye(d)
    c, s = math.cos(angle), math.sin(angle)
    r[a, a], r[b, b], r[a, b], r[b, a] = c, c, -s, s
    return r


@dataclass
class HyperBall:
    entity_id: str
    center: np.ndarray
    radius: float

    def __post_init__(self):
        self.center = vector(self.center)
        if not self.entity_id or not math.isfinite(self.radius) or self.radius <= 0:
            raise ValueError('A ball needs an ID and a positive finite radius')

    def contains(self, point) -> bool:
        return bool(np.linalg.norm(vector(point, len(self.center)) - self.center) <= self.radius)

    def overlaps(self, other: 'HyperBall') -> bool:
        if len(self.center) != len(other.center):
            raise ValueError('Collision requires a common ambient space')
        return bool(np.linalg.norm(self.center - other.center) < self.radius + other.radius)

    def slice3_radius(self, hidden_coordinates) -> float | None:
        """Radius of intersection with x4..xD fixed. None means empty, zero tangent."""
        h = np.asarray(hidden_coordinates, dtype=float)
        if h.shape != (len(self.center) - 3,) or not np.isfinite(h).all():
            raise ValueError('Slice must specify every hidden coordinate')
        r2 = self.radius ** 2 - float(np.sum((h - self.center[3:]) ** 2))
        return None if r2 < 0 else math.sqrt(r2)

    def ray_hit(self, origin, direction) -> float | None:
        """Nearest nonnegative ray intersection in full D, not a projected ray."""
        d = len(self.center)
        o, v = vector(origin, d), vector(direction, d)
        n = float(np.linalg.norm(v))
        if n < 1e-12:
            raise ValueError('Ray direction must be nonzero')
        v /= n
        rel = o - self.center
        b = float(np.dot(rel, v))
        discr = b * b - float(np.dot(rel, rel)) + self.radius ** 2
        if discr < 0:
            return None
        roots = (-b - math.sqrt(discr), -b + math.sqrt(discr))
        return next((float(t) for t in roots if t >= 0), None)


@dataclass
class RigidPortal:
    """Same-dimensional isometry. Different-dimensional transport is rejected."""
    rotation: np.ndarray
    offset: np.ndarray

    def __post_init__(self):
        self.offset = vector(self.offset)
        self.rotation = np.asarray(self.rotation, dtype=float).copy()
        d = len(self.offset)
        if (self.rotation.shape != (d, d) or not np.isfinite(self.rotation).all()
            or not np.allclose(self.rotation.T @ self.rotation, np.eye(d), atol=1e-10)):
            raise ValueError('Portal map must be a finite same-dimensional isometry')

    def transport(self, position, velocity):
        d = len(self.offset)
        return (self.rotation @ vector(position, d) + self.offset,
                self.rotation @ vector(velocity, d))

    def inverse(self) -> 'RigidPortal':
        r = self.rotation.T
        return RigidPortal(r, -r @ self.offset)


class SharedWorld:
    """In-process authoritative command model; no sockets/authentication layer.

    Actor identity is supplied by the caller, so it is not a security boundary.
    Tests exercise command/revision semantics, not deployed remote collaboration.
    """
    def __init__(self, d=4):
        dimension_contract(d)
        self.d, self.revision = d, 0
        self.entities: dict[str, HyperBall] = {}
        self.editors: set[str] = set()
        self.events: list[dict] = []

    def move(self, actor, entity_id, target, expected_revision):
        if actor not in self.editors:
            raise PermissionError('No edit capability')
        if expected_revision != self.revision:
            raise ValueError('Stale revision: reconcile before resubmitting')
        point = vector(target, self.d)
        entity = self.entities[entity_id]
        before = entity.center.tolist()
        entity.center = point
        self.revision += 1
        self.events.append({'revision': self.revision, 'actor': actor,
                            'entity_id': entity_id, 'before': before, 'after': point.tolist()})

    def snapshot(self):
        return {'dimension': self.d, 'revision': self.revision,
                'editors': sorted(self.editors),
                'entities': {k: {'center': v.center.tolist(), 'radius': v.radius}
                             for k, v in sorted(self.entities.items())},
                'events': copy.deepcopy(self.events)}

    @classmethod
    def restore(cls, state):
        w = cls(state['dimension'])
        revision = state['revision']
        if type(revision) is not int or revision < 0:
            raise ValueError('Invalid revision')
        w.revision = revision
        w.editors = set(state['editors'])
        for name, body in state['entities'].items():
            w.entities[name] = HyperBall(name, vector(body['center'], w.d), body['radius'])
        w.events = copy.deepcopy(state['events'])
        return w

    def digest(self):
        return hashlib.sha256(json.dumps(self.snapshot(), sort_keys=True,
                                        separators=(',', ':'), allow_nan=False).encode()).hexdigest()


class NeuralEdgeLaw:
    """1-16-16-1 tanh MLP; output bounds stiffness to [0.5,2.0].

    Features: pair distance minus unit rest length. No absolute coordinate appears.
    This is an invariant local learned edge function, not the full published EGNN.
    """
    def __init__(self, seed=713):
        rng = np.random.default_rng(seed)
        self.p = {'w1': rng.normal(0, .45, (1, 16)), 'b1': np.zeros((1, 16)),
                  'w2': rng.normal(0, .20, (16, 16)), 'b2': np.zeros((1, 16)),
                  'w3': rng.normal(0, .20, (16, 1)), 'b3': np.zeros((1, 1))}

    def forward(self, strain, cache=False):
        x = np.asarray(strain, dtype=float).reshape(-1, 1)
        h1 = np.tanh(x @ self.p['w1'] + self.p['b1'])
        h2 = np.tanh(h1 @ self.p['w2'] + self.p['b2'])
        z = np.clip(h2 @ self.p['w3'] + self.p['b3'], -30, 30)
        s = 1 / (1 + np.exp(-z))
        k = .5 + 1.5 * s
        return (k, (x, h1, h2, s)) if cache else k

    def loss_and_grads(self, strain):
        k, (x, h1, h2, s) = self.forward(strain, cache=True)
        target = teacher_force(x)
        error = k * x - target
        dz = 2 / len(x) * error * x * 1.5 * s * (1 - s)
        g = {'w3': h2.T @ dz, 'b3': dz.sum(0, keepdims=True)}
        dh2 = (dz @ self.p['w3'].T) * (1 - h2 ** 2)
        g.update(w2=h1.T @ dh2, b2=dh2.sum(0, keepdims=True))
        dh1 = (dh2 @ self.p['w2'].T) * (1 - h1 ** 2)
        g.update(w1=x.T @ dh1, b1=dh1.sum(0, keepdims=True))
        return float(np.mean(error ** 2)), g

    def save(self, path):
        np.savez(path, **self.p)

    @classmethod
    def load(cls, path):
        obj = cls()
        with np.load(path, allow_pickle=False) as state:
            for k, v in obj.p.items():
                candidate = state[k]
                if candidate.shape != v.shape or not np.isfinite(candidate).all():
                    raise ValueError('Invalid neural weights')
                obj.p[k] = candidate.copy()
        return obj


def teacher_force(strain):
    """Deliberately specified synthetic material law, NOT an empirical discovery."""
    x = np.asarray(strain, dtype=float)
    return x + .6 * x ** 3


def graph_forces(positions, edges, model: NeuralEdgeLaw | None = None):
    q = np.asarray(positions, dtype=float)
    if q.ndim != 2 or not 3 <= q.shape[1] <= 11 or not np.isfinite(q).all():
        raise ValueError('Expected finite N by D state')
    out = np.zeros_like(q)
    for i, j in edges:
        delta = q[j] - q[i]
        r = float(np.linalg.norm(delta))
        if r < 1e-12:
            continue
        strain = r - 1
        k = 1.0 if model is None else float(model.forward([strain])[0, 0])
        f = k * strain * delta / r
        out[i] += f
        out[j] -= f
    return out


class NeuralWaveField:
    """Small finite spring/oscillator graph in D-space, not a continuum PDE solver.

    Mechanical edge stiffness is learned; the same positive edge weights couple
    scalar oscillators. Restoring frequency, damping and integrator are explicit.
    Coupling depends on moving positions; no total-energy conservation is claimed.
    """
    def __init__(self, positions, edges, model):
        self.q = np.asarray(positions, dtype=float).copy()
        graph_forces(self.q, edges, model)  # validate geometry
        self.v = np.zeros_like(self.q)
        self.edges = list(edges)
        self.model = model
        self.u = np.zeros(len(self.q))
        self.du = np.zeros(len(self.q))
        self.memory = np.zeros(len(self.q))
        self.time = 0.0

    def step(self, dt=.002):
        if not math.isfinite(dt) or not 0 < dt <= .01:
            raise ValueError('Reference timestep must be in (0,0.01]')
        f = graph_forces(self.q, self.edges, self.model) - .1 * self.v
        a = -self.u - .05 * self.du
        for i, j in self.edges:
            r = float(np.linalg.norm(self.q[j] - self.q[i]))
            k = float(self.model.forward([r - 1])[0, 0])
            transfer = k * (self.u[j] - self.u[i])
            a[i] += transfer
            a[j] -= transfer
        self.v += dt * f
        self.q += dt * self.v
        self.du += dt * a
        self.u += dt * self.du
        self.memory += dt * (.4 * self.u - .2 * self.memory)
        self.time += dt


def train_experiment(outdir: Path):
    outdir.mkdir(parents=True, exist_ok=True)
    train = np.random.default_rng(120).uniform(-.45, .8, 2048)
    valid = np.random.default_rng(121).uniform(-.45, .8, 512)
    test = np.random.default_rng(122).uniform(-.45, .8, 1024)
    model = NeuralEdgeLaw()
    m = {k: np.zeros_like(v) for k, v in model.p.items()}
    v = copy.deepcopy(m)
    best, best_p, best_step = math.inf, None, None
    rng = np.random.default_rng(123)
    for step in range(1, 1801):
        batch = train[rng.integers(0, len(train), 128)]
        _, g = model.loss_and_grads(batch)
        for k in model.p:
            m[k] = .9 * m[k] + .1 * g[k]
            v[k] = .999 * v[k] + .001 * g[k] ** 2
            model.p[k] -= .006 * (m[k] / (1 - .9 ** step)) / (np.sqrt(v[k] / (1 - .999 ** step)) + 1e-8)
        if step % 25 == 0:
            err = float(np.mean((model.forward(valid)[:, 0] * valid - teacher_force(valid)) ** 2))
            if err < best:
                best, best_p, best_step = err, copy.deepcopy(model.p), step
    model.p = best_p
    model.save(outdir / 'neural-edge-law.npz')
    pred = model.forward(test)[:, 0] * test
    true = teacher_force(test)
    hooke = test
    coeffs = np.polyfit(train, teacher_force(train), 3)
    polynomial = np.polyval(coeffs, test)
    report = {
        'task': 'Learn a specified synthetic nonlinear spring force F=s+0.6*s^3; s=r-1.',
        'scope': 'MLP local edge operator; explicit D-dimensional graph aggregation, not full EGNN reproduction.',
        'split': {'train': 2048, 'validation': 512, 'test': 1024,
                  'method': 'Independent seeded draws, same distance distribution; validation selects checkpoint; test does not train or select.',
                  'strain_interval': [-.45, .8]},
        'selected_step': best_step,
        'validation_mse': best,
        'test_neural_mse': float(np.mean((pred - true) ** 2)),
        'test_hooke_mse': float(np.mean((hooke - true) ** 2)),
        'test_fitted_cubic_mse': float(np.mean((polynomial - true) ** 2)),
        'parameter_count': int(sum(x.size for x in model.p.values())),
        'truth_boundary': 'The cubic baseline is essentially exact and better. This demonstrates learned dynamics, not superiority to the known law, general intelligence, or discovery of physics.',
        'not_tested': ['Phone or headset', 'Real hand or gaze tracking', 'Network multiplayer',
                       'Curved-manifold dynamics', 'Long-horizon stability guarantee', 'Emergent objects or adaptive rooms']}
    (outdir / 'neural-training-report.json').write_text(json.dumps(report, indent=2))
    return model, report


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--output', type=Path, default=Path(__file__).parent / 'results')
    args = p.parse_args()
    _, report = train_experiment(args.output)
    print(json.dumps(report, indent=2))
