"""Trusted authority adapter for the learned 3-11D graph material."""
from __future__ import annotations
import copy

from .driver import AdaptiveGraphDriver, AdaptiveMaterialError, MODEL_SHA256
from services.vivo_material.driver import digest, identifier, number


def require(ok, code):
    if not ok:
        raise AdaptiveMaterialError(code)


class AcceptedAdaptiveAdapter:
    def __init__(self, read_authority, *, world_id, authority_id,
                 max_force=2.0, stiffness=2.0):
        require(callable(read_authority), "AUTHORITY_READER_REQUIRED")
        require(identifier(world_id) and identifier(authority_id), "AUTHORITY_ID")
        require(number(max_force, 0, 4) and number(stiffness, 0, 4), "ACTUATOR_BOUNDS")
        self._read = read_authority
        self._world_id = world_id
        self._authority_id = authority_id
        self._max_force = float(max_force)
        self._stiffness = float(stiffness)

    def propose(self, checkpoint, *, expected_sequence, expected_state_hash, dt, tick):
        raw = self._read()
        require(isinstance(raw, dict), "AUTHORITY_CAPTURE")
        digest(raw)
        capture = copy.deepcopy(raw)
        snapshot = capture.get("snapshot")
        require(isinstance(snapshot, dict) and snapshot.get("schema") == "vivo.snapshot/1", "AUTHORITY_CAPTURE")
        require(snapshot.get("worldId") == self._world_id and snapshot.get("authorityId") == self._authority_id, "AUTHORITY_MISMATCH")
        require(type(expected_sequence) is int and snapshot.get("acceptedSequence") == expected_sequence, "STALE_AUTHORITY_SEQUENCE")
        require(isinstance(expected_state_hash, str) and snapshot.get("stateHash") == expected_state_hash, "STALE_AUTHORITY_HASH")
        now = capture.get("authorityTimeMs")
        require(number(now, 0, 2**53 - 1), "AUTHORITY_CLOCK")

        driver = AdaptiveGraphDriver(checkpoint)
        restored = driver.checkpoint()
        require(snapshot.get("simulationTime") == restored["simulationTime"], "STALE_MATERIAL_TIME")
        for sid in restored["spaces"]:
            space = snapshot.get("spaces", {}).get(sid)
            require(isinstance(space, dict), "NO_SPACE")
            require(space.get("field", {}).get("codec") == "vivo.material.adaptive-graph/1"
                    and space["field"].get("hash") == restored["digest"], "STALE_MATERIAL_FIELD")

        constraints = capture.get("constraints")
        require(isinstance(constraints, list) and len(constraints) <= 256, "CONSTRAINT_BUDGET")
        grips, proofs, lease_ids = [], [], set()
        for lease in constraints:
            require(isinstance(lease, dict), "INVALID_ACCEPTED_LEASE")
            sid = lease.get("spaceId")
            if sid not in restored["spaces"]:
                continue
            require(all(identifier(lease.get(k)) for k in ("id", "session", "actorId", "entityId")), "INVALID_ACCEPTED_LEASE")
            require(lease["entityId"] in restored["spaces"][sid]["entities"], "LEASE_ENTITY")
            require(number(lease.get("expiresAt"), 0, 2**53 - 1), "LEASE_EXPIRY")
            if lease["expiresAt"] <= now or lease.get("target") is None:
                continue
            require(type(lease.get("inputEpoch")) is int and 0 <= lease["inputEpoch"] < 2**53, "STALE_ACCEPTED_TARGET")
            require(type(lease.get("targetSeq")) is int and 1 <= lease["targetSeq"] < 2**53, "STALE_ACCEPTED_TARGET")
            require(lease["id"] not in lease_ids, "DUPLICATE_ACCEPTED_LEASE")
            require(lease.get("source") in ("touch", "hand", "eye-confirmed", "keyboard"), "INPUT_SOURCE")
            lease_ids.add(lease["id"])
            grips.append({
                "spaceId": sid, "entityId": lease["entityId"], "leaseId": lease["id"],
                "source": lease["source"], "target": copy.deepcopy(lease["target"]),
                "maxForce": self._max_force, "stiffness": self._stiffness,
            })
            proofs.append({k: copy.deepcopy(lease[k]) for k in
                           ("id","actorId","spaceId","entityId","source","inputEpoch","targetSeq","expiresAt","target")})

        proposal = driver.step({
            "snapshot": snapshot, "fieldState": restored, "grips": grips,
            "dt": dt, "tick": tick, "randomState": "deterministic:none", "mode": "learned",
        })
        revisions = {
            sid: {eid: snapshot["spaces"][sid]["entities"][eid]["revision"]
                  for eid in restored["spaces"][sid]["entities"]}
            for sid in restored["spaces"]
        }
        return {
            **proposal,
            "worldId": self._world_id, "authorityId": self._authority_id, "spaceId": "root",
            "baseSequence": expected_sequence, "baseStateHash": expected_state_hash,
            "baseFieldDigest": restored["digest"], "baseEntityRevisions": revisions,
            "dt": dt, "tick": tick, "capturedAtMs": now,
            "acceptedLeaseProofs": proofs, "constraintDigest": digest(proofs),
        }
