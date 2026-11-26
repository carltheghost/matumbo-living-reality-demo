"""Mission-bound, deterministic evidence checks in the existing Station journal.

The owner defines explicit scalar predicates. An audit is a record comparison,
not proof that the label, interpretation, source or real world is true. No model,
new store, inferred semantic contradiction, or mutation authority is involved.
"""
import json
import math
import re
import time
from continuity import canonical, fields, require, sha, string
from associative import parse_record, _unique_object, _bad_constant
from experience import pending, gate as obligation_gate

SCHEMA = 'matumbo.mission.audit/1'
MAX_CHECKS = 8
MAX_SOURCES = 4
MAX_SOURCE_BYTES = 2_000_000
MAX_VALUE = 512
TERMINAL = ('closed', 'cancelled')


def scalar(value):
    # No boolean/number coercion, nonfinite floats or unbounded payloads.
    if value is None or type(value) is bool:
        return True
    if type(value) is int:
        return abs(value) <= 2**53-1
    if type(value) is float:
        return math.isfinite(value) and abs(value) <= 2**53-1
    if type(value) is str:
        try:
            return len(value) <= MAX_VALUE and len(value.encode('utf-8')) <= MAX_VALUE * 4
        except UnicodeError:
            return False
    return False


def equal(a,b):
    # JSON numbers can be represented as integers or floating point values.
    # Compare finite numeric values, but never coerce strings, booleans or null.
    if type(a) in (int,float) and type(b) in (int,float):return a == b
    return type(a) is type(b) and a == b


def pointer(path):
    string(path,256)
    require(path.startswith('/') and not re.search(r'~(?![01])',path),'invalid JSON pointer')
    parts=path[1:].split('/')
    require(len(parts)<=16 and all(len(p)<=128 for p in parts),'pointer depth or segment limit')
    return [p.replace('~1','/').replace('~0','~') for p in parts]


def lookup(document,path):
    value=document
    for token in pointer(path):
        if isinstance(value,dict):
            if token not in value:return 'missing_field',None
            value=value[token]
        elif isinstance(value,list):
            if not re.fullmatch(r'0|[1-9][0-9]{0,8}',token) or int(token)>=len(value):return 'missing_field',None
            value=value[int(token)]
        else:return 'missing_field',None
    return ('available',value) if scalar(value) else ('unsupported_value',None)


def validate(checks,grants):
    require(isinstance(checks,list) and 1<=len(checks)<=MAX_CHECKS,'select one to eight checks')
    identifiers=set()
    for check in checks:
        fields(check,'id label mode expected sources')
        cid=string(check['id'],64);require(cid not in identifiers,'duplicate check identity');identifiers.add(cid)
        string(check['label'],240,True)
        mode=check['mode'];require(mode in ('equals','agree'),'invalid comparison mode')
        require(scalar(check['expected']) and (mode!='agree' or check['expected'] is None),'invalid expected scalar')
        sources=check['sources'];require(isinstance(sources,list) and (2 if mode=='agree' else 1)<=len(sources)<=MAX_SOURCES,'invalid source count')
        seen=set()
        for src in sources:
            require(isinstance(src,dict),'invalid source reference')
            kind=src.get('kind')
            if kind=='observation':
                fields(src,'kind pointer');parts=pointer(src['pointer'])
                require(parts[0] in ('snapshot','branchId','currentEyeId','eyes','mode'),'observation path outside native envelope')
            elif kind=='evidence':
                fields(src,'kind grant_id pointer');parts=pointer(src['pointer'])
                require(string(src['grant_id'],64) in grants,'source must belong to the exact mission grant set')
                require(parts[0] in ('schema','taskId','owner','title','specialist','mode','findings','inspectedRevision','execution','reportDigest'),'evidence path outside native mission record')
            else:raise ValueError('unknown source kind')
            ref=canonical(src);require(ref not in seen,'duplicate source reference');seen.add(ref)
    return checks


def grant(c,gid):
    return c.db.execute('SELECT * FROM mission_memory_grants WHERE id=?',(gid,)).fetchone()


def pin(row):
    return {k:row[k] for k in ('id','agent','world','binding','task','fact','evidence_sha','artifact_sha')}


def referenced(checks):
    return sorted({s['grant_id'] for check in checks for s in check['sources'] if s['kind']=='evidence'})


def contract(c,m):
    """Latest explicit owner contract in this assignment, or no contract.
    Journal is trusted local state; malformed last record fails closed.
    """
    row=c.db.execute("SELECT * FROM continuity_events WHERE mission=? AND assignment=? AND kind IN ('audit_set','audit_cleared') ORDER BY revision DESC LIMIT 1",(m['id'],m['assignment'])).fetchone()
    if row is None:return None
    require(c.db.execute("SELECT 1 FROM principals WHERE id=? AND role='owner'",(row['actor'],)).fetchone() is not None,'audit journal invalid')
    require(row['revision']<=m['revision'],'audit journal revision invalid')
    if row['kind']=='audit_cleared':return None
    try:
        data=json.loads(row['data'],object_pairs_hook=_unique_object,parse_constant=_bad_constant)
        fields(data,'checks pins digest')
        validate(data['checks'],json.loads(m['grants']))
        require(isinstance(data['pins'],list) and [p['id'] for p in data['pins']]==referenced(data['checks']),'audit pin list invalid')
        require(data['digest']==sha(canonical([m['id'],m['assignment'],row['revision'],data['checks'],data['pins']])),'audit contract changed')
    except (ValueError,KeyError,TypeError,UnicodeError,RecursionError):
        raise ValueError('audit contract invalid') from None
    return data|{'revision':row['revision']}


def _read_evidence(c,p,pins,now):
    mg=c.s.memory;docs={};total=0
    for expected in pins:
        gid=expected['id'];row=grant(c,gid)
        if not mg.source or not mg._active(row,p,now) or pin(row)!=expected:
            raise PermissionError('audit evidence unavailable or changed')
        r=mg._read(row['task'])
        try:
            require(r is not None and mg._pin(r)=={k:row[k] for k in ('fact','evidence_sha','artifact_sha')},'audit evidence changed')
            parse_record(r) # checks exact UTF-8 digest, native schema and identity
            raw=r['evidenceJson'];total+=len(raw.encode('utf-8'))
            if total>MAX_SOURCE_BYTES:return None
            docs[gid]=json.loads(raw,object_pairs_hook=_unique_object,parse_constant=_bad_constant)
        except (ValueError,TypeError,KeyError,UnicodeError,RecursionError):
            raise PermissionError('audit evidence unavailable or changed') from None
    return docs


def _observation(c,m,obs,now):
    if obs is None or not c._obs_ok(m,obs,now):return None,None
    # Insertion order, not wall-clock order, is the latest requested read.
    # Even a newer pending or uncertain receipt makes an older one inadequate.
    latest=c.db.execute('''SELECT a.id FROM actions a JOIN continuity_observations o ON o.action=a.id
                          WHERE o.mission=? AND o.assignment=? AND o.epoch=? ORDER BY a.rowid DESC LIMIT 1''',
                          (m['id'],m['assignment'],m['lease_epoch'])).fetchone()
    if latest is None or latest['id']!=obs:return None,None
    row=c.db.execute('SELECT id,agent,world,tool,status,result,updated FROM actions WHERE id=?',(obs,)).fetchone()
    try:
        require(row is not None and isinstance(row['result'],str) and len(row['result'].encode('utf-8'))<=MAX_SOURCE_BYTES,'observation unavailable')
        doc=json.loads(row['result'],object_pairs_hook=_unique_object,parse_constant=_bad_constant)
        require(isinstance(doc,dict),'observation unavailable')
        return doc,sha(canonical(dict(row)))
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError):return None,None


def evaluate(c,m,obs,*,disclose=False,probes=None,details=False):
    """Called under the Station lock/write transaction. Gate calls reveal no values.
    Agent calls charge each distinct inspected historical grant once, even a miss.
    Freshness is checked at the final shared time, not just at receipt fetch.
    details=True is for internal planning only; never forward those raw values.
    """
    p=c._agent(m['agent'],m['world']);require(c._evidence_ok(m),'required mission evidence unavailable or changed')
    selected=contract(c,m);exploratory=probes is not None
    if exploratory:
        checks=validate(probes,json.loads(m['grants']))
        pins=[pin(grant(c,gid)) for gid in referenced(checks)]
    else:
        checks=selected['checks'] if selected else []
        pins=selected['pins'] if selected else []
    now=time.time()
    docs=_read_evidence(c,p,pins,now)
    native,receipt_sha=_observation(c,m,obs,now)
    results=[]
    if docs is not None:
        for check in checks:
            values=[];sources=[]
            for src in check['sources']:
                if src['kind']=='observation':
                    state,value=('observation_required',None) if native is None else lookup(native,src['pointer'])
                    provenance={'receipt_id':obs,'receipt_sha256':receipt_sha,'source_class':'confirmed_host_receipt_not_physical_truth'} if native is not None else {'source_class':'observation_unavailable'}
                else:
                    gid=src['grant_id'];source_pin=next(r for r in pins if r['id']==gid)
                    state,value=lookup(docs[gid],src['pointer'])
                    provenance={'fact_id':source_pin['fact'],'evidence_sha256':source_pin['evidence_sha'],'artifact_sha256':source_pin['artifact_sha'],'source_class':'historical_digest_matched_authentication_unverified'}
                entry=src|provenance|{'status':state}
                if state=='available':values.append(value);entry['value']=value
                sources.append(entry)
            complete=len(values)==len(sources)
            disagreement=len(values)>1 and any(not equal(values[0],x) for x in values[1:])
            mismatch=check['mode']=='equals' and any(not equal(check['expected'],x) for x in values)
            # Missing facts never become a passing result. Different available
            # values are a disagreement only within the explicit comparison.
            status='disagreement' if disagreement else 'incomplete' if not complete else 'mismatch' if mismatch else 'matched'
            results.append({'id':check['id'],'label':check['label'],'mode':check['mode'],'expected':check['expected'],'status':status,'complete':complete,'expected_mismatch':mismatch,'sources':sources})
    # Independent revalidation of exact pins and the rest of mission evidence.
    if docs is not None:require(_read_evidence(c,p,pins,time.time()) is not None,'audit evidence budget changed')
    require(c._evidence_ok(m),'required mission evidence unavailable or changed')
    later=time.time()
    # This is the final time for grant eligibility and observation validity.
    for gid in json.loads(m['grants']):
        if not c.s.memory.source or not c.s.memory._active(grant(c,gid),p,later):raise PermissionError('required mission evidence unavailable or changed')
    if native is not None:
        final_doc,final_sha=_observation(c,m,obs,later)
        require(final_doc is not None and final_sha==receipt_sha,'mission observation changed or expired during audit')
    if selected is not None:
        require(contract(c,m)==selected,'audit contract changed')
    if disclose and docs is not None:
        for item in pins:c.db.execute('UPDATE mission_memory_grants SET reads=reads+1,last_read=? WHERE id=?',(later,item['id']))
    exhausted=bool(disclose and docs is not None and any(not c.s.memory._active(grant(c,item['id']),p,later) for item in pins))
    remaining=pending(c,m,obs if native is not None else None)
    blockers=[]
    if native is None:blockers.append('latest_confirmed_native_observation')
    if exhausted:blockers.append('owner_evidence_review_read_budget_exhausted')
    if remaining:blockers.append('review_obligations')
    if docs is None:blockers.append('audit_source_budget_exceeded')
    if any(r['status']!='matched' for r in results):blockers.append('resolve_explicit_checks')
    if exploratory:blockers.append('exploratory_checks_do_not_replace_required_audit')
    return {'schema':SCHEMA,'mode':'exploratory' if exploratory else 'required','mission_id':m['id'],'assignment':m['assignment'],'revision':m['revision'],'lease_epoch':m['lease_epoch'],
            'contract_revision':selected['revision'] if selected else None,'contract_sha256':selected['digest'] if selected else None,
            'observation':obs if native is not None else None,'receipt_sha256':receipt_sha,
            'checks':results if disclose or details else [],'check_count':len(checks),'matched_count':sum(r['status']=='matched' for r in results),
            'pending_obligations':remaining,'blockers':blockers,'status':'exploratory_only' if exploratory else 'blocked' if blockers else 'checks_matched' if selected else 'no_contract',
            'ready_checks_satisfied':not blockers,'next_gate':'mission_audit' if exploratory else blockers[0] if blockers else 'prepare_checkpoint_or_owner_review',
            'authority':'record comparison only; labels and comparability are '+('agent hypotheses' if exploratory else 'owner assertions')+'; no truth certification, model confidence, mutation or completion authority'}


def gate(c,m,obs):
    if contract(c,m) is None:return # unchanged behavior for existing missions
    r=evaluate(c,m,obs)
    require(r['ready_checks_satisfied'] and r['status']=='checks_matched','required audit checks unresolved; run mission_audit and obtain the latest confirmed observation')
    return {'contract_sha256':r['contract_sha256'],'receipt_sha256':r['receipt_sha256'],'contract_revision':r['contract_revision'],'observation':r['observation']}


def route(c,p,path,b):
    role=p['role']
    if not (role=='agent' and path in ('/v1/continuity/audit','/v1/continuity/probe') or role=='owner' and path.startswith('/v1/owner/continuity/audit/')):
        raise PermissionError('audit route unavailable to credential')
    m=c._mission(b.get('id'))
    if path in ('/v1/continuity/audit','/v1/continuity/probe') and role=='agent':
        exploratory=path.endswith('/probe')
        fields(b,'id epoch lease observation checks' if exploratory else 'id epoch lease observation');c._lease(p,m,b)
        if exploratory:validate(b['checks'],json.loads(m['grants']))
        obs=b['observation']
        if obs is not None:string(obs,64)
        result=evaluate(c,m,obs,disclose=True,probes=b['checks'] if exploratory else None);c._lease(p,m,b)
        if result['observation'] is not None:require(c._obs_ok(m,obs),'mission observation changed or expired during audit')
        return result
    if role!='owner':raise PermissionError('audit route unavailable to credential')
    if path=='/v1/owner/continuity/audit/get':
        fields(b,'id');return {'schema':SCHEMA,'mission_id':m['id'],'revision':m['revision'],'contract':contract(c,m)}
    if path=='/v1/owner/continuity/audit/set':
        fields(b,'id expected_revision request_id checks');req=c._replay(p,b,'audit_set')
        if isinstance(req,dict):return req
        c._rev(m,b['expected_revision']);require(m['phase']=='assigned' and m['lease_hash'] is None,'define audit before claiming the mission')
        checks=validate(b['checks'],json.loads(m['grants']));require(c._evidence_ok(m),'required mission evidence unavailable or changed')
        pins=[pin(grant(c,gid)) for gid in referenced(checks)]
        # Validate selected records against the actual reader before accepting a contract.
        require(_read_evidence(c,c._agent(m['agent'],m['world']),pins,time.time()) is not None,'audit source budget exceeded')
        require(c._evidence_ok(m),'required mission evidence unavailable or changed')
        data={'checks':checks,'pins':pins,'digest':sha(canonical([m['id'],m['assignment'],m['revision']+1,checks,pins]))}
        c._fence(m);m=c._event(m,'audit_set',p['id'],data,checkpoint=None,observation=None)
        return c._record(p,m,req)
    if path=='/v1/owner/continuity/audit/clear':
        fields(b,'id expected_revision request_id note');req=c._replay(p,b,'audit_clear')
        if isinstance(req,dict):return req
        c._rev(m,b['expected_revision']);require(m['phase'] not in TERMINAL and contract(c,m) is not None,'active audit contract unavailable')
        note=string(b['note'],1600,True);c._fence(m);phase='suspended' if m['phase']=='suspended' else 'assigned'
        m=c._event(m,'audit_cleared',p['id'],{'note':note},phase=phase,lease_hash=None,lease_until=None,checkpoint=None,observation=None)
        if phase=='assigned':c.db.execute("UPDATE tasks SET status='pending' WHERE id=?",(m['id'],))
        return c._record(p,m,req)
    raise PermissionError('audit route unavailable to credential')
