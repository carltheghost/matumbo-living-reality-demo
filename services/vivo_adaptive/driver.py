"""Deterministic learned graph material for 3-11 spatial dimensions.

This is an explicit software material law, not a claim about real matter. It uses
the frozen pretrained NeuralEdgeLaw already recovered with Vivo. The authority
still owns identity, permissions, accepted history, persistence and Eyes.
"""
from __future__ import annotations

import copy
import hashlib
import math
from pathlib import Path

import numpy as np

from services.vivo.server.reference import NeuralEdgeLaw
from services.vivo_material.driver import digest, identifier, number

MODEL_SHA256 = "9ab89f46361e397fe41845d86ecc23e38f75561032fd65ae9f8389e9780afdb0"
LAW_VERSION = "vivo.adaptive.graph/1"
SCHEMA = "vivo.material.adaptive-graph/1"
HASH_CODEC = "vivo.f64-json-sha256/1"
MODEL_PATH = Path(__file__).resolve().parents[1] / "vivo" / "models" / "neural-edge-law.npz"
MIN_D = 3
MAX_D = 11
MAX_DT = 0.02
MAX_TICKS = 1_000_000
MAX_ENTITIES = 64
MAX_GRIPS = 8
MAX_FORCE = 4.0
MAX_STIFFNESS = 4.0
MAX_SPEED = 100.0
DAMPING = 0.08


class AdaptiveMaterialError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def require(ok, code):
    if not ok:
        raise AdaptiveMaterialError(code)


def finite_vector(value, dimension, low=-1e6, high=1e6):
    return (
        isinstance(value, (list, tuple))
        and len(value) == dimension
        and all(number(v, low, high) for v in value)
    )


def _model():
    require(MODEL_PATH.is_file(), "MODEL_MISSING")
    require(hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest() == MODEL_SHA256, "MODEL_HASH")
    return NeuralEdgeLaw.load(MODEL_PATH)


def _snapshot_space(snapshot, space_id):
    require(isinstance(snapshot, dict) and snapshot.get("schema") == "vivo.snapshot/1", "SNAPSHOT")
    spaces = snapshot.get("spaces")
    require(isinstance(spaces, dict) and space_id in spaces, "SPACE")
    space = spaces[space_id]
    d = space.get("dimension")
    require(type(d) is int and MIN_D <= d <= MAX_D and space.get("intrinsicDimension") == d, "DIMENSION")
    require(space.get("law") == {"id": "vivo.adaptive.graph", "version": "1"}, "LAW")
    require(space.get("modelHashes") == [MODEL_SHA256], "MODEL_VERSION")
    require(space.get("metricId") == "euclidean" and space.get("topologyId") == "open", "GEOMETRY")
    entities = space.get("entities")
    require(isinstance(entities, dict) and 1 <= len(entities) <= MAX_ENTITIES, "ENTITY_BUDGET")
    for eid, entity in entities.items():
        require(identifier(eid) and isinstance(entity, dict) and entity.get("id") == eid, "ENTITY_ID")
        require(entity.get("spaceId") == space_id and entity.get("dimension") == d, "ENTITY_FRAME")
        require(entity.get("materialProfile") == "adaptive-graph", "PROFILE")
        require(finite_vector(entity.get("q"), d) and finite_vector(entity.get("v"), d, -MAX_SPEED, MAX_SPEED), "ENTITY_STATE")
        require(type(entity.get("revision")) is int and 0 <= entity["revision"] < 2**53 - 2, "REVISION")
    return space


def _edge_records(space):
    ids = sorted(space["entities"])
    configured = space.get("adaptiveEdges")
    pairs = []
    if configured is None:
        pairs = list(zip(ids, ids[1:]))
    else:
        require(isinstance(configured, list) and len(configured) <= MAX_ENTITIES * 4, "EDGE_BUDGET")
        seen = set()
        for edge in configured:
            require(isinstance(edge, list) and len(edge) == 2 and all(identifier(v) for v in edge), "EDGE")
            a, b = edge
            require(a != b and a in space["entities"] and b in space["entities"], "EDGE")
            key = tuple(sorted((a, b)))
            require(key not in seen, "EDGE_DUPLICATE")
            seen.add(key)
            pairs.append((a, b))
    out = []
    for a, b in pairs:
        qa = np.asarray(space["entities"][a]["q"], dtype=float)
        qb = np.asarray(space["entities"][b]["q"], dtype=float)
        rest = float(np.linalg.norm(qb - qa))
        require(math.isfinite(rest) and rest > 1e-9, "EDGE_REST")
        out.append({"a": a, "b": b, "rest": rest})
    return out


def _checkpoint_digest(state):
    body = {k: v for k, v in state.items() if k != "digest"}
    return digest(body)


class AdaptiveGraphDriver:
    """Learned local graph material. step() proposes state; it does not accept it."""

    def __init__(self, checkpoint=None):
        self._state = None
        self._model = _model()
        if checkpoint is not None:
            self.restore(checkpoint)

    @staticmethod
    def capabilities():
        return {
            "lawVersion": LAW_VERSION,
            "modelHashes": [MODEL_SHA256],
            "profiles": ["adaptive-graph"],
            "modes": ["learned"],
            "spatialDimensions": list(range(MIN_D, MAX_D + 1)),
            "multiGrip": True,
            "clock": "separate",
            "learned": True,
            "modelRole": "bounded edge stiffness",
            "authorityOwnsAcceptance": True,
            "physicalValidation": False,
        }

    @classmethod
    def initialize(cls, snapshot):
        require(isinstance(snapshot, dict), "SNAPSHOT")
        spaces = {}
        for sid, candidate in snapshot.get("spaces", {}).items():
            if candidate.get("law") == {"id": "vivo.adaptive.graph", "version": "1"}:
                space = _snapshot_space(snapshot, sid)
                spaces[sid] = {
                    "dimension": space["dimension"],
                    "edges": _edge_records(space),
                    "entities": {
                        eid: {
                            "q": list(map(float, entity["q"])),
                            "v": list(map(float, entity["v"])),
                            "mass": 1.0,
                            "revision": entity["revision"],
                        }
                        for eid, entity in sorted(space["entities"].items())
                    },
                }
        require(spaces, "NO_ADAPTIVE_SPACE")
        state = {
            "schema": SCHEMA,
            "hashCodec": HASH_CODEC,
            "lawVersion": LAW_VERSION,
            "modelHashes": [MODEL_SHA256],
            "simulationTime": float(snapshot.get("simulationTime", 0)),
            "tick": 0,
            "spaces": spaces,
        }
        state["digest"] = _checkpoint_digest(state)
        return cls(state)

    def checkpoint(self):
        require(self._state is not None, "NOT_INITIALIZED")
        return copy.deepcopy(self._state)

    def restore(self, checkpoint):
        require(isinstance(checkpoint, dict), "CHECKPOINT")
        required = {"schema", "hashCodec", "lawVersion", "modelHashes", "simulationTime", "tick", "spaces", "digest"}
        require(set(checkpoint) == required, "CHECKPOINT_FIELDS")
        require(checkpoint["digest"] == _checkpoint_digest(checkpoint), "CHECKPOINT_HASH")
        require(
            checkpoint["schema"] == SCHEMA
            and checkpoint["hashCodec"] == HASH_CODEC
            and checkpoint["lawVersion"] == LAW_VERSION
            and checkpoint["modelHashes"] == [MODEL_SHA256],
            "CHECKPOINT_VERSION",
        )
        require(number(checkpoint["simulationTime"], 0, 1e12), "CLOCK")
        require(type(checkpoint["tick"]) is int and 0 <= checkpoint["tick"] <= MAX_TICKS, "TICK")
        spaces = checkpoint["spaces"]
        require(isinstance(spaces, dict) and spaces, "SPACES")
        for sid, space in spaces.items():
            require(identifier(sid) and isinstance(space, dict), "SPACE")
            d = space.get("dimension")
            require(type(d) is int and MIN_D <= d <= MAX_D, "DIMENSION")
            require(isinstance(space.get("entities"), dict) and 1 <= len(space["entities"]) <= MAX_ENTITIES, "ENTITY_BUDGET")
            for eid, entity in space["entities"].items():
                require(identifier(eid), "ENTITY_ID")
                require(set(entity) == {"q", "v", "mass", "revision"}, "ENTITY_FIELDS")
                require(finite_vector(entity["q"], d) and finite_vector(entity["v"], d, -MAX_SPEED, MAX_SPEED), "ENTITY_STATE")
                require(number(entity["mass"], 0.01, 1000), "MASS")
                require(type(entity["revision"]) is int and 0 <= entity["revision"] < 2**53 - 2, "REVISION")
            require(isinstance(space.get("edges"), list), "EDGES")
            for edge in space["edges"]:
                require(set(edge) == {"a", "b", "rest"}, "EDGE")
                require(edge["a"] in space["entities"] and edge["b"] in space["entities"] and edge["a"] != edge["b"], "EDGE")
                require(number(edge["rest"], 1e-9, 1e9), "EDGE_REST")
        self._state = copy.deepcopy(checkpoint)

    def _learned_internal(self, space):
        d = space["dimension"]
        forces = {eid: np.zeros(d) for eid in space["entities"]}
        diagnostics = []
        for edge in space["edges"]:
            a, b = edge["a"], edge["b"]
            qa = np.asarray(space["entities"][a]["q"], dtype=float)
            qb = np.asarray(space["entities"][b]["q"], dtype=float)
            delta = qb - qa
            r = float(np.linalg.norm(delta))
            if r <= 1e-12:
                continue
            strain = r - edge["rest"]
            k = float(self._model.forward([strain])[0, 0])
            magnitude = k * strain
            f = magnitude * delta / r
            forces[a] += f
            forces[b] -= f
            diagnostics.append({"a": a, "b": b, "strain": strain, "stiffness": k, "force": abs(magnitude)})
        return forces, diagnostics

    @staticmethod
    def _grip_force(entity, grips):
        q = np.asarray(entity["q"], dtype=float)
        force = np.zeros(len(q))
        supplied = 0.0
        for grip in grips:
            stiffness = grip.get("stiffness", 2.0)
            maximum = grip.get("maxForce", 2.0)
            require(number(stiffness, 0, MAX_STIFFNESS) and number(maximum, 0, MAX_FORCE), "GRIP_BOUNDS")
            target = grip.get("target")
            require(isinstance(target, dict) and finite_vector(target.get("q"), len(q)), "TARGET")
            delta = np.asarray(target["q"], dtype=float) - q
            f = stiffness * delta
            norm = float(np.linalg.norm(f))
            if norm > maximum and norm > 0:
                f *= maximum / norm
                norm = maximum
            force += f
            supplied += norm
        return force, supplied

    def step(self, payload):
        require(self._state is not None and isinstance(payload, dict), "NOT_INITIALIZED")
        require(payload.get("mode") == "learned" and payload.get("randomState") == "deterministic:none", "MODE")
        dt = payload.get("dt")
        require(number(dt, 0.0001, MAX_DT), "TIMESTEP")
        require(type(payload.get("tick")) is int and payload["tick"] == self._state["tick"] + 1, "TICK")
        require(payload["tick"] <= MAX_TICKS, "TICK")
        require(payload.get("fieldState") == self._state, "FIELD_STATE")
        snapshot = payload.get("snapshot")
        require(isinstance(snapshot, dict), "SNAPSHOT")
        grips = payload.get("grips", [])
        require(isinstance(grips, list) and len(grips) <= MAX_GRIPS, "GRIP_BUDGET")

        next_state = copy.deepcopy(self._state)
        updates = []
        all_edge_diagnostics = []
        total_mass = 0.0
        kinetic = 0.0
        supplied_work = 0.0
        dissipated = 0.0

        grouped = {}
        for grip in grips:
            require(isinstance(grip, dict), "GRIP")
            sid, eid = grip.get("spaceId"), grip.get("entityId")
            require(sid in self._state["spaces"] and eid in self._state["spaces"][sid]["entities"], "GRIP_ENTITY")
            require(grip.get("source") in ("touch", "hand", "eye-confirmed", "keyboard"), "GRIP_SOURCE")
            target = grip.get("target")
            require(
                isinstance(target, dict)
                and target.get("spaceId") == sid
                and target.get("dimension") == self._state["spaces"][sid]["dimension"],
                "TARGET_FRAME",
            )
            grouped.setdefault((sid, eid), []).append(grip)

        for sid, state_space in self._state["spaces"].items():
            canonical = _snapshot_space(snapshot, sid)
            for eid, record in state_space["entities"].items():
                entity = canonical["entities"][eid]
                require(entity["revision"] == record["revision"], "STALE_REVISION")
                require(entity["q"] == record["q"] and entity["v"] == record["v"], "STATE_MISMATCH")

            forces, edge_diag = self._learned_internal(state_space)
            all_edge_diagnostics.extend({"spaceId": sid, **d} for d in edge_diag)
            for eid, old in state_space["entities"].items():
                q = np.asarray(old["q"], dtype=float)
                v = np.asarray(old["v"], dtype=float)
                mass = float(old["mass"])
                gforce, effort = self._grip_force(old, grouped.get((sid, eid), []))
                force = forces[eid] + gforce - DAMPING * v
                acceleration = force / mass
                v2 = v + dt * acceleration
                speed = float(np.linalg.norm(v2))
                if speed > MAX_SPEED:
                    v2 *= MAX_SPEED / speed
                q2 = q + dt * v2
                require(np.isfinite(q2).all() and np.isfinite(v2).all(), "NONFINITE")
                supplied_work += effort * dt
                dissipated += DAMPING * float(np.dot(v, v)) * dt
                total_mass += mass
                kinetic += 0.5 * mass * float(np.dot(v2, v2))
                updated = {
                    "q": q2.tolist(),
                    "v": v2.tolist(),
                    "mass": mass,
                    "revision": old["revision"] + 1,
                }
                next_state["spaces"][sid]["entities"][eid] = updated
                updates.append({"spaceId": sid, "id": eid, "q": updated["q"], "v": updated["v"], "revision": updated["revision"]})

        next_state["simulationTime"] = float(self._state["simulationTime"] + dt)
        next_state["tick"] = payload["tick"]
        next_state["digest"] = _checkpoint_digest(next_state)
        proposal = {
            "schema": "vivo.material-proposal.adaptive-graph/1",
            "fieldState": next_state,
            "entityUpdates": updates,
            "diagnostics": {
                "mass": total_mass,
                "energy": kinetic,
                "suppliedWork": supplied_work,
                "dissipatedEnergy": dissipated,
                "residual": 0.0,
            },
            "edgeDiagnostics": all_edge_diagnostics,
            "lawVersion": LAW_VERSION,
            "modelHashes": [MODEL_SHA256],
            "randomState": "deterministic:none",
        }
        self._state = next_state
        return proposal
