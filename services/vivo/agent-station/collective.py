"""Owner-configured multi-principal review of an explicit native scalar.
Separate missions, leases and observations; no peer notes, grants or credentials.
Agreement is not independent sensor corroboration, or proof of truth.
"""
import json
import time
from continuity import canonical, fields, require, sha, string
from metacognition import _observation, equal, lookup, pointer, scalar

SCHEMA='matumbo.mission.collective/1'
MIN_REVIEWERS=2
MAX_REVIEWERS=4
MAX_SPREAD=30
TERMINAL=('closed','cancelled')


def panel(c,m):
    row=c.db.execute("SELECT * FROM continuity_events WHERE mission=? AND assignment=? AND kind IN ('collective_set','collective_cleared') ORDER BY revision DESC LIMIT 1",(m['id'],m['assignment'])).fetchone()
    if row is None:return None
    require(row['revision']<=m['revision'] and c.db.execute("SELECT 1 FROM principals WHERE id=? AND role='owner'",(row['actor'],)).fetchone(),'collective journal invalid')
    if row['kind']=='collective_cleared':return None
    try:
        data=json.loads(row['data']);fields(data,'label pointer expected branch eye reviewers digest')
        validate_spec(data)
        require(isinstance(data['reviewers'],list) and MIN_REVIEWERS<=len(data['reviewers'])<=MAX_REVIEWERS,'invalid reviewer count')
        for r in data['reviewers']:
            fields(r,'id agent assignment');string(r['id'],64);string(r['agent'],64);require(type(r['assignment']) is int and r['assignment']>=1,'invalid reviewer assignment')
        require(len({r['id'] for r in data['reviewers']})==len(data['reviewers']) and len({r['agent'] for r in data['reviewers']})==len(data['reviewers']) and all(r['id']!=m['id'] and r['agent']!=m['agent'] for r in data['reviewers']),'invalid reviewer identities')
        digest=sha(canonical([m['id'],m['world'],m['assignment'],row['revision'],{k:v for k,v in data.items() if k!='digest'}]))
        require(digest==data['digest'],'collective panel changed')
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError):raise ValueError('collective panel invalid') from None
    return data|{'revision':row['revision'],'created':row['created']}


def validate_spec(b):
    string(b['label'],240,True);parts=pointer(b['pointer']);require(len(parts)>=2 and parts[0]=='snapshot','collective path must be within native snapshot')
    require(scalar(b['expected']),'invalid collective expected scalar')
    string(b['branch'],256);string(b['eye'],256)


def latest(c,m):
    row=c.db.execute('''SELECT a.id FROM actions a JOIN continuity_observations o ON o.action=a.id
       WHERE o.mission=? AND o.assignment=? AND o.epoch=? ORDER BY a.rowid DESC LIMIT 1''',(m['id'],m['assignment'],m['lease_epoch'])).fetchone()
    return row['id'] if row else None


def active(m,now):
    return bool(m['phase'] in ('active','ready') and m['lease_hash'] and m['lease_until'] and m['lease_until']>now)


def evidence(c,m,spec,obs,now):
    if not active(m,now) or obs is None:return 'pending',None,None
    doc,digest=_observation(c,m,obs,now)
    if doc is None:return 'pending',None,None
    row=c.db.execute('SELECT created,updated FROM actions WHERE id=?',(obs,)).fetchone()
    if row['created']<spec['created']:return 'pending',None,None
    if doc.get('branchId')!=spec['branch'] or doc.get('currentEyeId')!=spec['eye']:
        return 'uncertain',digest,row['updated']
    status,value=lookup(doc,spec['pointer'])
    if status!='available':return 'uncertain',digest,row['updated']
    return ('support' if equal(value,spec['expected']) else 'challenge'),digest,row['updated']


def member(c,lead,spec,m):
    require(lead['world']==m['world'],'collective panel unavailable')
    selected=next((r for r in spec['reviewers'] if r['id']==m['id'] and r['agent']==m['agent'] and r['assignment']==m['assignment']),None)
    if not selected:raise PermissionError('collective panel unavailable')
    return selected


def contribution(c,m,lead,spec):
    # Bounded by the existing mission event quota. The latest submission for the
    # exact panel/assignment is authoritative; no reuse across new leases.
    rows=c.db.execute("SELECT * FROM continuity_events WHERE mission=? AND assignment=? AND kind='collective_contributed' ORDER BY revision DESC LIMIT 512",(m['id'],m['assignment']))
    for row in rows:
        data=json.loads(row['data'])
        if data.get('lead')!=lead['id'] or data.get('panel')!=spec['digest']:continue
        fields(data,'lead panel epoch observation receipt verdict')
        require(row['actor']==m['agent'] and row['revision']<=m['revision'] and data['verdict'] in ('support','challenge','abstain'),'collective contribution invalid')
        return data|{'event_revision':row['revision']}
    return None


def grants_current(c,m,now):
    try:p=c._agent(m['agent'],m['world'])
    except PermissionError:return False
    mg=c.s.memory
    for gid in json.loads(m['grants']):
        row=c.db.execute('SELECT * FROM mission_memory_grants WHERE id=?',(gid,)).fetchone()
        if not mg.source or not mg._active(row,p,now):return False
    return True


def inspect(c,m,spec,obs,*,owner_detail=False):
    """Only aggregate counters are disclosed to the lead. No raw peer values,
    receipt bodies/IDs, grants, objectives, notes, identities, or derived digests.
    Pin exact observations internally for checkpoint/acceptance CAS.
    """
    # First validate each selected principal and its existing evidence. No new
    # access grant is issued and no evidence text is returned by this operation.
    reviewers=[]
    for ref in spec['reviewers']:
        r=c._mission(ref['id']);valid=False
        if r['agent']==ref['agent'] and r['assignment']==ref['assignment'] and r['world']==m['world']:
            try:valid=c._evidence_ok(r)
            except (ValueError,PermissionError,KeyError,TypeError):valid=False
        reviewers.append((r,valid))
    now=time.time()
    own,own_hash,own_time=evidence(c,m,spec,obs,now)
    totals={k:0 for k in ('support','challenge','uncertain','pending')};pins=[];times=[];diagnostics=[]
    for r,valid in reviewers:
        decision='pending';pinned=None
        if valid and active(r,now):
            sub=contribution(c,r,m,spec)
            if sub and sub['epoch']==r['lease_epoch']:
                actual,receipt,at=evidence(c,r,spec,sub['observation'],now)
                if receipt and receipt==sub['receipt']:
                    verdict=sub['verdict']
                    if verdict=='abstain':decision='uncertain'
                    elif actual==verdict:decision=verdict
                    else:decision='uncertain'
                    pinned=[r['id'],r['agent'],r['assignment'],r['lease_epoch'],sub['event_revision'],sub['observation'],receipt,decision]
                    if at is not None:times.append(at)
        totals[decision]+=1
        if pinned:pins.append(pinned)
        diagnostics.append({'mission_id':r['id'],'agent_id':r['agent'],'assignment':r['assignment'],'status':decision,'observation':pinned[5] if pinned else None})
    if own_time is not None:times.append(own_time)
    # Shared final time check: all pinned receipts remain current; no unpinned
    # or expired submission can accidentally complete a panel.
    final=time.time()
    for r,valid in reviewers:
        if valid and any(pin[0]==r['id'] for pin in pins):
            pin=next(pin for pin in pins if pin[0]==r['id'])
            _,digest,_=evidence(c,r,spec,pin[5],final)
            if digest!=pin[6] or not grants_current(c,r,final):
                totals[pin[7]]-=1;totals['pending']+=1;pin[7]='pending'
                entry=next(d for d in diagnostics if d['mission_id']==r['id']);entry.update(status='pending',observation=None)
    require(grants_current(c,m,final),'required mission evidence unavailable or changed')
    own,own_hash,own_time=evidence(c,m,spec,obs,final)
    spread=(max(times)-min(times)) if times else None
    if own=='challenge' or totals['challenge']:status='disagreement'
    elif own=='uncertain' or totals['uncertain']:status='uncertain'
    elif own!='support':status='awaiting_lead_observation'
    elif totals['pending']:status='awaiting_reviews'
    elif spread is None or spread>MAX_SPREAD:status='observation_window_mismatch'
    else:status='agreed'
    binding=None
    if status=='agreed':
        binding={'panel_sha256':spec['digest'],'review_sha256':sha(canonical([spec['digest'],obs,own_hash,pins])),'observation':obs}
    public={'schema':SCHEMA,'panel_id':spec['digest'],'mission_id':m['id'],'status':status,
            'reviewers_required':len(reviewers),'counts':totals,'lead_status':own,
            'max_observation_spread_seconds':MAX_SPREAD,
            'ready':status=='agreed','authority':'reviewed agreement only; not independent sensor truth or action authority'}
    if owner_detail:public['reviewers']=diagnostics
    return public,binding


def status(c,m,obs=None):
    spec=panel(c,m)
    if spec is None:return None,None
    require(c._evidence_ok(m),'required mission evidence unavailable or changed')
    return inspect(c,m,spec,obs)


def gate(c,m,obs):
    result,binding=status(c,m,obs)
    if result is None:return None
    require(result['ready'] and binding is not None,'collective review unresolved; obtain current independent reviewer submissions')
    return binding


def route(c,p,path,b):
    role=p['role'];owner=role=='owner';agent=role=='agent'
    if not (owner and path.startswith('/v1/owner/continuity/collective/') or agent and path in ('/v1/continuity/collective','/v1/continuity/contribute')):
        raise PermissionError('collective route unavailable to credential')
    m=c._mission(b.get('id'))
    if owner:
        if path.endswith('/get'):
            fields(b,'id');spec=panel(c,m)
            return {'schema':SCHEMA,'id':m['id'],'revision':m['revision'],'panel':spec}
        if path.endswith('/inspect'):
            fields(b,'id');spec=panel(c,m)
            require(spec is not None and c._evidence_ok(m),'collective panel unavailable')
            return inspect(c,m,spec,latest(c,m),owner_detail=True)[0]
        if path.endswith('/set'):
            fields(b,'id expected_revision request_id label pointer expected branch eye reviewers');req=c._replay(p,b,'collective_set')
            if isinstance(req,dict):return req
            c._rev(m,b['expected_revision']);require(m['phase']=='assigned' and m['lease_hash'] is None and panel(c,m) is None,'define one collective panel before claiming; explicitly clear old panel')
            require(c._evidence_ok(m),'required mission evidence unavailable');validate_spec(b)
            require(isinstance(b['reviewers'],list) and MIN_REVIEWERS<=len(b['reviewers'])<=MAX_REVIEWERS,'select two to four reviewer missions')
            refs=[];agents={m['agent']};ids={m['id']}
            for mid in b['reviewers']:
                r=c._mission(mid);require(r['id'] not in ids and r['agent'] not in agents and r['world']==m['world'] and r['phase']=='assigned' and r['lease_hash'] is None,'reviewers must be distinct unleased same-world missions and principals')
                from organization import link
                require(link(c,r) is None,'organization members cannot be collective reviewers')
                require(c._evidence_ok(r),'reviewer mission evidence unavailable');c._agent(r['agent'],r['world']);ids.add(r['id']);agents.add(r['agent']);refs.append({'id':r['id'],'agent':r['agent'],'assignment':r['assignment']})
            data={k:b[k] for k in ('label','pointer','expected','branch','eye')}|{'reviewers':refs}
            data['digest']=sha(canonical([m['id'],m['world'],m['assignment'],m['revision']+1,data]))
            m=c._event(m,'collective_set',p['id'],data,checkpoint=None,observation=None);return c._record(p,m,req)
        if path.endswith('/clear'):
            fields(b,'id expected_revision request_id note');req=c._replay(p,b,'collective_clear')
            if isinstance(req,dict):return req
            c._rev(m,b['expected_revision']);require(m['phase'] not in TERMINAL and panel(c,m) is not None,'active collective panel unavailable')
            note=string(b['note'],1600,True);c._fence(m);phase='suspended' if m['phase']=='suspended' else 'assigned'
            m=c._event(m,'collective_cleared',p['id'],{'note':note},phase=phase,lease_hash=None,lease_until=None,checkpoint=None,observation=None)
            if phase=='assigned':c.db.execute("UPDATE tasks SET status='pending' WHERE id=?",(m['id'],))
            return c._record(p,m,req)
        raise PermissionError('collective route unavailable')
    c._lease(p,m,b)
    require(c._evidence_ok(m),'required mission evidence unavailable or changed')
    if path.endswith('/collective'):
        fields(b,'id epoch lease lead_id')
    else:fields(b,'id epoch lease lead_id panel_id observation verdict expected_revision request_id')
    lead=c._mission(b['lead_id']);spec=panel(c,lead)
    if spec is None or lead['phase'] in TERMINAL or lead['world']!=m['world']:raise PermissionError('collective panel unavailable')
    if m['id']==lead['id']:
        if not path.endswith('/collective'):raise PermissionError('reviewer mission required')
        result,_=inspect(c,m,spec,latest(c,m));c._lease(p,m,b);return result
    member(c,lead,spec,m)
    # Explicit panel link authorizes only this proposition, not the lead mission.
    if not c._evidence_ok(lead):raise PermissionError('collective panel unavailable')
    if path.endswith('/collective'):
        c._lease(p,m,b)
        return {'schema':SCHEMA,'role':'reviewer','panel_id':spec['digest'],'label':spec['label'],'pointer':spec['pointer'],'expected':spec['expected'],'branch':spec['branch'],'eye':spec['eye'],'authority':'submit only your own confirmed observation; no peer access'}
    require(b['panel_id']==spec['digest'],'collective panel changed')
    require(b['verdict'] in ('support','challenge','abstain'),'invalid collective verdict')
    req=c._replay(p,b,'collective_contribute')
    if isinstance(req,dict):return req
    c._rev(m,b['expected_revision']);obs=string(b['observation'],64)
    actual,receipt,_=evidence(c,m,spec,obs,time.time())
    require(receipt is not None and (b['verdict']=='abstain' or b['verdict']==actual),'verdict must match latest confirmed scoped observation; abstain if uncertain')
    c._lease(p,m,b)
    require(grants_current(c,m,time.time()) and grants_current(c,lead,time.time()),'required mission evidence unavailable or changed')
    previous=contribution(c,m,lead,spec)
    if previous and previous['epoch']==m['lease_epoch'] and previous['observation']==obs and previous['receipt']==receipt and previous['verdict']==b['verdict']:
        return c._record(p,m,req) # same observation and verdict; no new contribution
    m=c._event(m,'collective_contributed',p['id'],{'lead':lead['id'],'panel':spec['digest'],'epoch':m['lease_epoch'],'observation':obs,'receipt':receipt,'verdict':b['verdict']})
    return c._record(p,m,req)
