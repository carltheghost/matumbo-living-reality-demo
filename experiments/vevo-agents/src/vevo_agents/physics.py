"""Small mechanically coupled oscillator field for the Vevo proof.

The edge energy is the central contract. Both scalar oscillator exchange and
mechanical pair forces are derived from it; they are not two unrelated
animations. This module is a fresh, bounded reconstruction of the delegated
mathematics, not a copy of the prior Vivo implementation.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math

import numpy as np


def _finite_array(value, shape, name, bound=1e6) -> np.ndarray:
    out = np.asarray(value, dtype=np.float64)
    if out.shape != shape or not np.isfinite(out).all() or np.max(np.abs(out), initial=0.0) > bound:
        raise ValueError(f"invalid {name}")
    return out.copy()


@dataclass(frozen=True)
class Edge:
    a: int
    b: int
    r0: float
    k: float
    w: float


class ResonantWorld:
    """Four-node local field with two calibrated candidate resonators."""

    NODES = 4
    DT = 0.035
    CUE_TICKS = 3

    def __init__(self, *, seed: int = 1, target: int | None = None, calibration=None):
        if type(seed) is not int or seed < 0:
            raise ValueError("seed must be a non-negative integer")
        self.seed = seed
        rng = np.random.default_rng(seed)
        self.target = int(rng.integers(0, 2) if target is None else target)
        if self.target not in (0, 1):
            raise ValueError("target must be candidate slot 0 or 1")
        if calibration is None:
            calibration = {
                "frequency_a": float(rng.uniform(0.42, 0.58)),
                "frequency_b": float(rng.uniform(0.68, 0.84)),
                "phase": float(rng.uniform(-0.45, 0.45)),
            }
        self.calibration = {str(k): float(v) for k, v in calibration.items()}
        if not (0.3 < self.calibration["frequency_a"] < 0.65):
            raise ValueError("frequency_a outside proof range")
        if not (0.62 < self.calibration["frequency_b"] < 0.92):
            raise ValueError("frequency_b outside proof range")
        if not -math.pi <= self.calibration["phase"] <= math.pi:
            raise ValueError("phase outside proof range")

        self.base_q = np.arange(self.NODES, dtype=np.float64)
        self.q = self.base_q.copy()
        self.v = np.zeros(self.NODES, dtype=np.float64)
        self.u = np.zeros(self.NODES, dtype=np.float64)
        self.du = np.zeros(self.NODES, dtype=np.float64)
        self.omega = np.array(
            [
                2.0 * math.pi * self.calibration["frequency_a"],
                2.0 * math.pi * self.calibration["frequency_b"],
                2.0 * math.pi * rng.uniform(0.92, 1.08),
                2.0 * math.pi * rng.uniform(1.12, 1.28),
            ],
            dtype=np.float64,
        )
        self.edges = (
            Edge(0, 1, 1.0, 1.15, 0.82),
            Edge(1, 2, 1.0, 0.95, 0.66),
            Edge(2, 3, 1.0, 1.05, 0.74),
        )
        self.kappa = 0.9
        self.alpha = 0.38
        self.quartic = 0.03
        self.damping = 0.055
        self.geometry_damping = 0.035
        self.tick = 0
        self.work = 0.0
        self.dissipated = 0.0
        self.initial_energy = self.energy()
        self.events: list[dict] = []

    @property
    def candidate_frequencies(self) -> tuple[float, float]:
        return (self.calibration["frequency_a"], self.calibration["frequency_b"])

    def coefficient(self, edge: Edge, distance: float) -> float:
        return self.kappa * edge.w * math.exp(-self.alpha * (distance - edge.r0))

    def edge_energy(self, edge: Edge) -> float:
        distance = abs(float(self.q[edge.b] - self.q[edge.a]))
        du = float(self.u[edge.b] - self.u[edge.a])
        coefficient = self.coefficient(edge, distance)
        return 0.5 * edge.k * edge.w * (distance - edge.r0) ** 2 + 0.5 * coefficient * du**2

    def energy(self) -> float:
        value = 0.5 * float(np.sum(self.v**2 + self.du**2))
        value += float(np.sum(0.5 * self.omega**2 * self.u**2 + self.quartic * self.u**4 / 4.0))
        value += sum(self.edge_energy(edge) for edge in self.edges)
        return float(value)

    def edge_forces(self) -> tuple[np.ndarray, np.ndarray]:
        """Return geometry and oscillator forces from the shared edge energy."""

        geometry = np.zeros(self.NODES, dtype=np.float64)
        oscillator = np.zeros(self.NODES, dtype=np.float64)
        for edge in self.edges:
            delta = float(self.q[edge.b] - self.q[edge.a])
            distance = max(abs(delta), 1e-12)
            direction = delta / distance
            du = float(self.u[edge.b] - self.u[edge.a])
            coefficient = self.coefficient(edge, distance)
            d_energy_dr = edge.k * edge.w * (distance - edge.r0) - 0.5 * self.alpha * coefficient * du**2
            pair_force = d_energy_dr * direction
            geometry[edge.a] += pair_force
            geometry[edge.b] -= pair_force

            exchange = coefficient * du
            oscillator[edge.a] += exchange
            oscillator[edge.b] -= exchange
        return geometry, oscillator

    def _external_drive(self, *, include_cue: bool = True) -> np.ndarray:
        drive = np.zeros(self.NODES, dtype=np.float64)
        if include_cue and self.tick < self.CUE_TICKS:
            frequency = self.candidate_frequencies[self.target]
            phase = self.calibration["phase"]
            drive[self.target] += 3.0 * math.sin(2.0 * math.pi * frequency * (self.tick + 1) * self.DT + phase)
        # A repeatable, lower-energy distractor after the cue has disappeared.
        if 5 <= self.tick <= 16:
            drive[2] += 0.42 * math.sin(0.61 * self.tick + 0.2)
            drive[3] += 0.35 * math.cos(0.47 * self.tick - 0.4)
            drive[1 - self.target] += 0.16 * math.sin(0.37 * self.tick + 1.0)
        return drive

    def step(self, port_drives=None, *, external=None, include_cue: bool = True) -> dict:
        """Advance one bounded step and return diagnostic accounting."""

        if port_drives is None:
            port_drives = np.zeros(self.NODES, dtype=np.float64)
        ports = _finite_array(port_drives, (self.NODES,), "port drives", 0.2)
        ext = np.zeros(self.NODES, dtype=np.float64) if external is None else _finite_array(
            external, (self.NODES,), "external drive", 2.0
        )
        ext = ext + self._external_drive(include_cue=include_cue)
        before = self.energy()
        geometry_force, oscillator_force = self.edge_forces()
        oscillator_accel = oscillator_force - self.omega**2 * self.u - self.quartic * self.u**3
        oscillator_accel -= self.damping * self.du
        oscillator_accel += ports + ext
        geometry_accel = geometry_force - self.geometry_damping * self.v

        # Semi-implicit Euler keeps the small proof stable and exposes all
        # state transitions for checkpoint/replay.
        self.du += self.DT * oscillator_accel
        self.u += self.DT * self.du
        self.v += self.DT * geometry_accel
        self.q += self.DT * self.v
        self.work += float(np.dot(ports + ext, self.du) * self.DT)
        self.dissipated += float(
            self.DT * (self.damping * np.dot(self.du, self.du) + self.geometry_damping * np.dot(self.v, self.v))
        )
        self.tick += 1
        after = self.energy()
        self.events.append(
            {
                "tick": self.tick,
                "type": "world.step",
                "port_norm": float(np.linalg.norm(ports)),
                "external_norm": float(np.linalg.norm(ext)),
                "energy": after,
            }
        )
        return {
            "energy_before": before,
            "energy_after": after,
            "work": self.work,
            "dissipated": self.dissipated,
            "residual": self.residual,
        }

    @property
    def residual(self) -> float:
        return float(self.energy() - self.initial_energy - self.work + self.dissipated)

    def observe(self) -> np.ndarray:
        """Return four local observations; target is intentionally absent."""

        features = np.zeros((self.NODES, 6), dtype=np.float64)
        for node in range(self.NODES):
            neighbors = []
            if node > 0:
                neighbors.append(self.u[node - 1])
            if node + 1 < self.NODES:
                neighbors.append(self.u[node + 1])
            local_energy = 0.5 * (self.du[node] ** 2 + self.omega[node] ** 2 * self.u[node] ** 2)
            features[node] = (
                self.u[node],
                self.du[node],
                self.q[node] - self.base_q[node],
                self.v[node],
                local_energy,
                float(np.mean(neighbors) if neighbors else 0.0),
            )
        return np.clip(features, -10.0, 10.0)

    def apply_probe(self, slot: int) -> dict:
        """Run the only allowlisted tool mutation; never returns the target."""

        if type(slot) is not int or slot not in (0, 1):
            raise ValueError("probe slot must be 0 or 1")
        before = self.energy()
        frequency = self.candidate_frequencies[slot]
        for _ in range(8):
            drive = np.zeros(self.NODES, dtype=np.float64)
            drive[slot] = 1.15 * math.sin(2.0 * math.pi * frequency * (self.tick + 1) * self.DT)
            self.step(np.zeros(self.NODES), external=drive, include_cue=False)
        after = self.energy()
        response = float(np.mean(np.abs(self.u[[slot]])) + 0.35 * np.mean(np.abs(self.du[[slot]])))
        result = {
            "schema": "vevo.tool.resonance.v1",
            "tool": "resonance_probe",
            "accepted": True,
            "probe_slot": slot,
            "calibrated_frequency": frequency,
            "response_gain": response,
            "energy_delta": float(after - before),
            "world_tick": self.tick,
            "world_digest": self.digest(),
        }
        self.events.append({"tick": self.tick, "type": "tool.resonance_probe", **result})
        return result

    def snapshot(self) -> dict:
        return {
            "schema": "vevo.resonant-world.v1",
            "seed": self.seed,
            "target": self.target,
            "calibration": dict(self.calibration),
            "q": self.q.tolist(),
            "v": self.v.tolist(),
            "u": self.u.tolist(),
            "du": self.du.tolist(),
            "omega": self.omega.tolist(),
            "tick": self.tick,
            "work": self.work,
            "dissipated": self.dissipated,
            "initial_energy": self.initial_energy,
            "events": list(self.events[-256:]),
        }

    @classmethod
    def restore(cls, state: dict) -> "ResonantWorld":
        if state.get("schema") != "vevo.resonant-world.v1":
            raise ValueError("unsupported world schema")
        obj = cls(seed=int(state["seed"]), target=int(state["target"]), calibration=state["calibration"])
        for name in ("q", "v", "u", "du", "omega"):
            setattr(obj, name, _finite_array(state[name], (cls.NODES,), name, 1e4))
        if not (type(state["tick"]) is int and state["tick"] >= 0):
            raise ValueError("invalid world tick")
        obj.tick = state["tick"]
        obj.work = float(state["work"])
        obj.dissipated = float(state["dissipated"])
        obj.initial_energy = float(state["initial_energy"])
        if not all(math.isfinite(x) for x in (obj.work, obj.dissipated, obj.initial_energy)):
            raise ValueError("invalid energy accounting")
        obj.events = list(state.get("events", []))[-256:]
        return obj

    def digest(self) -> str:
        payload = json.dumps(self.snapshot(), sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        return hashlib.sha256(payload).hexdigest()


def make_episode_observations(seed: int, *, horizon: int = 25) -> tuple[np.ndarray, int, dict]:
    """Generate fixed observations for training without exposing the target."""

    world = ResonantWorld(seed=seed)
    observations = []
    for _ in range(horizon):
        world.step(np.zeros(world.NODES), include_cue=True)
        observations.append(world.observe())
    return np.asarray(observations, dtype=np.float64), world.target, world.snapshot()


def finite_difference_force_error(world: ResonantWorld, epsilon: float = 1e-6) -> float:
    """Compare analytic geometry forces with central differences of energy."""

    analytic, _ = world.edge_forces()
    numeric = np.zeros(world.NODES, dtype=np.float64)
    original = world.q.copy()
    for index in range(world.NODES):
        world.q[index] = original[index] + epsilon
        plus = world.energy()
        world.q[index] = original[index] - epsilon
        minus = world.energy()
        world.q[index] = original[index]
        numeric[index] = -(plus - minus) / (2.0 * epsilon)
    # edge_forces returns force on the lower-index endpoint, which is the
    # negative energy gradient with the sign convention used by integration.
    return float(np.max(np.abs(analytic - numeric)))
