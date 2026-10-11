"""Test-only real Python solver fixture for the Node acceptance boundary."""
import json
import sys
from services.vivo_material import PhaseMaterialDriver, AcceptedMaterialAdapter
from services.vivo_material.tests.test_material import space

request = json.load(sys.stdin)
if request['op'] == 'seed':
    s = space(request.get('count', 1))
    cp = PhaseMaterialDriver.initialize(s).checkpoint()
    s['field']['hash'] = cp['digest']
    for eid, f in cp['fields'].items():
        s['entities'][eid]['q'], s['entities'][eid]['v'] = f['q'], f['v']
    snapshot = {'schema':'vivo.snapshot/1','worldId':'world.1','authorityId':'authority.1',
                'acceptedSequence':0,'simulationTime':cp['simulationTime'],'rootSpaceId':s['id'],
                'stateHash':'0'*64,'spaces':{s['id']:s}}
    print(json.dumps({'snapshot':snapshot,'checkpoint':cp}))
else:
    captured = request['capture']
    snapshot = captured['snapshot']
    adapter = AcceptedMaterialAdapter(lambda: captured, world_id=snapshot['worldId'],
                                      authority_id=snapshot['authorityId'], space_id='space.phase')
    print(json.dumps(adapter.propose(captured['checkpoint'],
                     expected_sequence=snapshot['acceptedSequence'],
                     expected_state_hash=snapshot['stateHash'], dt=.02,
                     tick=captured['checkpoint']['tick']+1)))
