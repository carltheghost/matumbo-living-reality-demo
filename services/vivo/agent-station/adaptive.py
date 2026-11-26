"""Bounded investigation of declared mission checks, in Station's transaction.

No model calls, automatic action, new store, authority or claim of world truth.
The three-read budget is enforced on *assisted* queueing; ordinary explicit
mission_observe remains available for a separately considered investigation.
"""
import json
import re
import time

from continuity import canonical, fields, require, sha, string
from metacognition import (
    contract, evaluate, lookup, equal, _unique_object, _bad_constant,
    _observation, MAX_SOURCE_BYTES,
)

SCHEMA = 'matumbo.mission.investigation/1'
PREFIX = 'investigation-'
READ_LIMIT = 3
MIN_LEASE_SECONDS = 10
HOST_AGE = 15


def observations(c,m):
    # Assignment budget survives process restart, lease renewal/reclaim and
    # audit contract changes. Only the latest epoch supplies current evidence.
    count = c.db.execute('SELECT count(*) FROM continuity_observations WHERE mission=? AND assignment=?',
                         (m['id'],m['assignment'])).fetchone()[0]
    rows = c.db.execute('''SELECT a.id,a.agent,a.world,a.tool,a.status,a.updated,a.result,o.request_id
                            FROM continuity_observations o JOIN actions a ON a.id=o.action
                            WHERE o.mission=? AND o.assignment=? AND o.epoch=?
                            ORDER BY a.rowid DESC LIMIT 2''',
                        (m['id'],m['assignment'],m['lease_epoch'])).fetchall()
    for row in rows:
        require(row['agent']==m['agent'] and row['world']==m['world'] and row['tool']=='vivo.world.read',
                'investigation receipt scope invalid')
    return count, rows


def host_online(c,m,now):
    row=c.db.execute('''SELECT last_seen FROM presence JOIN principals p ON p.id=presence.host
                      WHERE presence.world=? AND p.world=? AND p.role='host' AND p.active=1''',
                     (m['world'],m['world'])).fetchone()
    return bool(row and 0<=now-row['last_seen']<HOST_AGE)


def historical_blocker(check):
    """A new native read cannot fix missing or conflicting pinned history."""
    sources=[s for s in check['sources'] if s['kind']=='evidence']
    if not sources:return False
    if any(s['status']!='available' for s in sources):return True
    values=[s['value'] for s in sources]
    if check['mode']=='equals' and any(not equal(check['expected'],v) for v in values):return True
    return any(not equal(values[0],v) for v in values[1:])


def projection(m,row,pointers):
    if row is None or row['status']!='completed':return None
    try:
        raw=row['result']
        if not isinstance(raw,str) or len(raw.encode('utf-8'))>MAX_SOURCE_BYTES:return None
        doc=json.loads(raw,object_pairs_hook=_unique_object,parse_constant=_bad_constant)
        if doc['snapshot']['worldId']!=m['world']:return None
        return [lookup(doc,path) for path in pointers]
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError):return None


def repeated_projection(m,rows,checks):
    if len(rows)!=2:return False
    # A resolved check is genuine progress too. Compare every declared live
    # field, not just the still-failing subset; ignore unrelated telemetry.
    paths=sorted({s['pointer'] for check in checks
                  for s in check['sources'] if s['kind']=='observation'})
    if not paths:return False
    a,b=(projection(m,row,paths) for row in rows)
    return bool(a is not None and b is not None and all(x[0]==y[0] and equal(x[1],y[1]) for x,y in zip(a,b)))


def plan(c,p,m,b):
    """Compute a deterministic plan; no queueing or value disclosure here.

    Internal audit detail is used only to classify fixed owner checks. No raw
    source values or text are copied to the response or investigation journal.
    Existing grant validity and budgets are checked by the audit evaluator.
    """
    c._lease(p,m,b)
    count,rows=observations(c,m)
    latest=rows[0] if rows else None
    obs=latest['id'] if latest is not None else None
    now=time.time();online=host_online(c,m,now)
    # Only existing current mission grants are inspected. If any are unavailable,
    # do not return derived checkpoint/receipt/evidence details.
    require(c._evidence_ok(m),'required mission evidence unavailable or changed; owner evidence review required')
    selected=contract(c,m)
    audit=evaluate(c,m,obs,details=True)
    c._lease(p,m,b)
    now=time.time();online=host_online(c,m,now)
    current=audit['observation']
    # Don't recommend work from a receipt that expired during planning.
    if current is not None:
        doc,receipt_sha=_observation(c,m,current,now)
        require(doc is not None and receipt_sha==audit['receipt_sha256'],'investigation observation changed; recompute plan')
    checks=audit['checks']
    blocked=[q for q in checks if q['status']!='matched']
    static=any(historical_blocker(q) for q in blocked)
    repeat=bool(current and blocked and repeated_projection(m,rows,checks))
    pending=audit['pending_obligations']
    remaining=max(0,READ_LIMIT-count)
    next_gate=None;reason=None;collective=None
    if static or 'audit_source_budget_exceeded' in audit['blockers']:
        next_gate='owner_review_evidence';reason='Pinned historical data or the audit source budget needs owner review; another native read cannot resolve it.'
    elif latest is not None and latest['status'] in ('queued','running'):
        next_gate='poll_observation';reason='A mission observation is already pending. Poll its receipt; do not queue another.'
    elif latest is not None and latest['status']=='uncertain':
        next_gate='owner_review_uncertain';reason='The latest read has an uncertain outcome. Reconcile it before another assisted read.'
    elif current is not None and not blocked:
        if pending:
            next_gate='review_obligations';reason='The latest observation is confirmed and checks match; review each remaining obligation against this receipt.'
        else:
            binding={'contract_sha256':audit['contract_sha256'],'receipt_sha256':audit['receipt_sha256'],
                     'contract_revision':audit['contract_revision'],'observation':current}
            cp=json.loads(m['checkpoint']) if m['checkpoint'] else {}
            reviewed=(m['phase']=='ready' and m['observation']==current and
                      (selected is None or cp.get('audit')==binding))
            from collective import status as collective_status
            collective,collective_binding=collective_status(c,m,current)
            if collective is not None and not collective['ready']:
                next_gate='await_collective_review' if collective['status']=='awaiting_reviews' else 'owner_review_collective'
                reason='Collective review is unresolved; reconcile the current independent reviewer observations. No automatic retry or acceptance.'
            else:
                reviewed=reviewed and (collective_binding is None or cp.get('collective')==collective_binding)
                next_gate='owner_review' if reviewed else 'prepare_checkpoint'
                reason='Current declared checks match. Use the existing checkpoint and owner review gates; no automatic acceptance.'
    elif repeat:
        next_gate='owner_review_stalled';reason='Two consecutive confirmed reads agree on all declared native check fields. Unrelated revision or tick changes do not establish progress.'
    elif not remaining:
        next_gate='owner_review_budget';reason='The assisted investigation read budget is exhausted for this assignment. An explicitly reviewed alternative is needed.'
    elif m['lease_until']-now<MIN_LEASE_SECONDS:
        next_gate='renew_lease';reason='Too little lease time remains to start another assisted read.'
    elif not online:
        next_gate='connect_host';reason='No recent heartbeat from an active host for this exact world.'
    else:
        next_gate='observe';reason='A bounded fresh native read can test the unresolved live-state requirement.'
    # Hash every relevant plan input, not wall time, so the same still-valid
    # plan is replayable. A new receipt, revision, assignment or next gate changes it.
    latest_meta=None if latest is None else {'id':obs,'status':latest['status'],'updated':latest['updated']}
    public={'schema':SCHEMA,'mission_id':m['id'],'assignment':m['assignment'],'revision':m['revision'],
            'lease_epoch':m['lease_epoch'],'contract_sha256':audit['contract_sha256'],
            'latest':latest_meta,'confirmed_observation':current,'receipt_sha256':audit['receipt_sha256'],
            'read_budget':{'limit':READ_LIMIT,'used':count,'remaining':remaining,'scope':'assignment; all mission observations count; enforced only by mission_investigate'},
            'host_recent':online,'checks':[{'id':q['id'],'status':q['status']} for q in checks],
            'pending_obligations':pending,'repeated_relevant_state':repeat,
            'next_gate':next_gate,'reason':reason,'can_queue_read':next_gate=='observe',
            'authority':'advisory investigation only; no world edit, memory grant, checkpoint or acceptance authority'}
    if collective is not None:public['collective']=collective
    public['plan_id']=sha(canonical(public))
    return public


def route(c,p,path,b):
    if p['role']!='agent':raise PermissionError('investigation route unavailable to credential')
    fields(b,'id epoch lease' if path.endswith('/plan') else 'id epoch lease plan_id')
    m=c._mission(b['id']);c._lease(p,m,b)
    if path.endswith('/plan'):return plan(c,p,m,b)
    plan_id=string(b['plan_id'],64);require(re.fullmatch(r'[a-f0-9]{64}',plan_id) is not None,'invalid investigation plan identity')
    rid=PREFIX+plan_id
    # Retry of a committed queue request returns its identity/status only.
    # It cannot enqueue a second read even if a new plan is available now.
    existing=c.db.execute('''SELECT a.id,a.status,a.agent,a.world,a.tool FROM continuity_observations o JOIN actions a ON a.id=o.action
                              WHERE o.mission=? AND o.assignment=? AND o.epoch=? AND o.request_id=?''',
                          (m['id'],m['assignment'],m['lease_epoch'],rid)).fetchone()
    if existing:
        require(c._evidence_ok(m),'required mission evidence unavailable or changed');c._lease(p,m,b)
        require(existing['agent']==p['id'] and existing['world']==m['world'] and existing['tool']=='vivo.world.read','investigation receipt scope invalid')
        return {'plan_id':plan_id,'action_id':existing['id'],'status':existing['status'],'replayed':True,'confirmed':existing['status']=='completed'}
    current=plan(c,p,m,b)
    require(current['plan_id']==plan_id,'investigation plan changed; recompute')
    require(current['can_queue_read'],'plan does not permit another assisted read')
    # Queue via the exact original mission observation authority. Never invoke
    # the host directly or submit a mutation. Both operations share one DB txn.
    r=c._queue_observation(p,m,{k:b[k] for k in ('id','epoch','lease')}|{'request_id':rid},assisted=True)
    return {'plan_id':plan_id,'action_id':r['id'],'status':r['status'],'replayed':False,'confirmed':r['confirmed']}
