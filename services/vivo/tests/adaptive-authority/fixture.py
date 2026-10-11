import json,sys
from services.vivo_adaptive import AdaptiveGraphDriver
from services.vivo_adaptive.adapter import AcceptedAdaptiveAdapter, MODEL_SHA256

def ent(eid,sid,d,q):
    return {'id':eid,'spaceId':sid,'dimension':d,'chart':'flat','q':q,'v':[0.0]*d,'revision':0,
            'name':eid,'radius':.2,'materialProfile':'adaptive-graph','fieldMembership':['field.'+eid],
            'innerSpaceId':None,'lineage':[]}
def space(sid,d,entities):
    return {'id':sid,'dimension':d,'intrinsicDimension':d,'atlasId':'flat','metricId':'euclidean','topologyId':'open',
            'law':{'id':'vivo.adaptive.graph','version':'1'},'modelHashes':[MODEL_SHA256],
            'field':{'codec':'vivo.material.adaptive-graph/1','handle':'adaptive.'+sid,'hash':'0'*64},
            'adaptiveEdges':[list(x) for x in zip(list(entities)[:-1],list(entities)[1:])],
            'entryView':{'spaceId':sid,'chart':'flat','dimension':d,'q':[0]*d,'basis':[],'slice':{}},'entities':entities}
def seed():
    root=space('root',4,{'a':ent('a','root',4,[0,0,0,0]),'b':ent('b','root',4,[1,0,0,0])})
    inner=space('inner',11,{'i':ent('i','inner',11,[0]*11)})
    snap={'schema':'vivo.snapshot/1','worldId':'adaptive.world','authorityId':'adaptive.authority','acceptedSequence':0,
          'simulationTime':0.0,'rootSpaceId':'root','stateHash':'0'*64,'spaces':{'root':root,'inner':inner}}
    cp=AdaptiveGraphDriver.initialize(snap).checkpoint()
    for sid in cp['spaces']:
        snap['spaces'][sid]['field']['hash']=cp['digest']
    return {'snapshot':snap,'checkpoint':cp}
request=json.load(sys.stdin)
if request['op']=='seed': print(json.dumps(seed()))
else:
    capture=request['capture'];snap=capture['snapshot']
    adapter=AcceptedAdaptiveAdapter(lambda:capture,world_id=snap['worldId'],authority_id=snap['authorityId'])
    cp=capture['checkpoint']
    print(json.dumps(adapter.propose(cp,expected_sequence=snap['acceptedSequence'],expected_state_hash=snap['stateHash'],dt=.01,tick=cp['tick']+1)))
