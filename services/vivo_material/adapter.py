"""Host-only bridge: untrusted clients cannot supply accepted targets or snapshots.

read_authority is injected by the local server owner, never from a client body.
It returns one coherent capture of snapshot, constraints and authorityTimeMs. This
adapter proposes only. The authority MUST compare sequence/hash, current leases,
field digest and entity revisions again inside its serialized atomic commit.
"""
from __future__ import annotations
import copy
from .driver import PhaseMaterialDriver, require, number, identifier, digest


class AcceptedMaterialAdapter:
    def __init__(self, read_authority, *, world_id, authority_id, space_id,
                 max_force=2., stiffness=2.):
        require(callable(read_authority), 'AUTHORITY_READER_REQUIRED')
        require(all(identifier(v) for v in (world_id, authority_id, space_id)), 'AUTHORITY_ID')
        require(number(max_force, 0, 4) and number(stiffness, 0, 4), 'ACTUATOR_BOUNDS')
        self._read = read_authority
        self._world_id, self._authority_id, self._space_id = world_id, authority_id, space_id
        self._max_force, self._stiffness = float(max_force), float(stiffness)

    def propose(self, checkpoint, *, expected_sequence, expected_state_hash, dt, tick):
        # Capture from the trusted owner. Caller has no grip/session/actor/snapshot
        # argument and cannot turn a claimed 'accepted' receipt into authority.
        raw = self._read()
        require(isinstance(raw, dict), 'AUTHORITY_CAPTURE')
        digest(raw)  # Bounded plain-data validation before recursive copying.
        captured = copy.deepcopy(raw)
        snapshot = captured.get('snapshot')
        require(isinstance(snapshot, dict) and snapshot.get('schema') == 'vivo.snapshot/1', 'AUTHORITY_CAPTURE')
        require(snapshot.get('worldId') == self._world_id
                and snapshot.get('authorityId') == self._authority_id, 'AUTHORITY_MISMATCH')
        require(type(snapshot.get('acceptedSequence')) is int
                and type(expected_sequence) is int and 0 <= expected_sequence < 2**53
                and snapshot.get('acceptedSequence') == expected_sequence, 'STALE_AUTHORITY_SEQUENCE')
        require(isinstance(expected_state_hash, str) and len(expected_state_hash) == 64
                and snapshot.get('stateHash') == expected_state_hash, 'STALE_AUTHORITY_HASH')
        now = captured.get('authorityTimeMs')
        require(number(now, 0, 2**53-1), 'AUTHORITY_CLOCK')
        spaces = snapshot.get('spaces')
        require(isinstance(spaces, dict) and self._space_id in spaces, 'NO_SPACE')
        space = spaces[self._space_id]
        PhaseMaterialDriver._validate_space(space)
        require(isinstance(checkpoint, dict) and isinstance(space.get('field'), dict)
                and space['field'].get('codec') == 'vivo.material.phase/1'
                and space['field'].get('hash') == checkpoint.get('digest'), 'STALE_MATERIAL_FIELD')
        driver = PhaseMaterialDriver(checkpoint)
        require(driver.checkpoint()['spaceId'] == self._space_id, 'SPACE_MISMATCH')
        require(snapshot.get('simulationTime') == checkpoint['simulationTime'], 'STALE_MATERIAL_TIME')
        constraints = captured.get('constraints')
        require(isinstance(constraints, list) and len(constraints) <= 256, 'CONSTRAINT_BUDGET')
        grips, proofs, entity_ids, lease_ids = [], [], set(), set()
        for lease in constraints:
            require(isinstance(lease, dict), 'INVALID_ACCEPTED_LEASE')
            if lease.get('spaceId') != self._space_id:
                continue
            require(all(identifier(lease.get(k)) for k in ('id','session','actorId','entityId')), 'INVALID_ACCEPTED_LEASE')
            eid = lease['entityId']
            require(eid in space['entities'], 'LEASE_ENTITY')
            require(number(lease.get('expiresAt'), 0, 2**53-1), 'LEASE_EXPIRY')
            # Expiry and release mean no external potential on this step. They do
            # not remove matter or reset its velocity/density to the last target.
            if lease['expiresAt'] <= now or lease.get('target') is None:
                continue
            require(type(lease.get('inputEpoch')) is int and 0 <= lease['inputEpoch'] < 2**53
                    and type(lease.get('targetSeq')) is int and 1 <= lease['targetSeq'] < 2**53, 'STALE_ACCEPTED_TARGET')
            require(eid not in entity_ids and lease['id'] not in lease_ids, 'DUPLICATE_ACCEPTED_LEASE')
            require(lease.get('source') in ['touch','hand','eye-confirmed','keyboard'], 'INPUT_SOURCE')
            entity_ids.add(eid); lease_ids.add(lease['id'])
            grips.append({'entityId': eid, 'leaseId': lease['id'], 'source': lease.get('source'),
                          'target': copy.deepcopy(lease['target']), 'maxForce': self._max_force,
                          'stiffness': self._stiffness, 'damping': 0})
            proofs.append({k: copy.deepcopy(lease[k]) for k in
                           ('id','actorId','spaceId','entityId','source','inputEpoch','targetSeq','expiresAt','target')})
        proposal = driver.step({'space': space, 'fieldState': checkpoint, 'grips': grips,
                               'dt': dt, 'tick': tick, 'randomState': 'deterministic:none', 'mode': 'analytic'})
        return {**proposal, 'schema': 'vivo.material-proposal.local/1',
                'worldId': self._world_id, 'authorityId': self._authority_id, 'spaceId': self._space_id,
                'baseSequence': expected_sequence, 'baseStateHash': expected_state_hash,
                'baseFieldDigest': checkpoint['digest'],
                'baseEntityRevisions': {eid: e['revision'] for eid,e in space['entities'].items()},
                'dt': dt, 'tick': tick, 'capturedAtMs': now,
                'acceptedLeaseProofs': proofs, 'constraintDigest': digest(proofs)}
