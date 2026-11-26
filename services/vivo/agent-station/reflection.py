"""Owner-reviewed, evidence-pinned reflection in the original continuity journal.

Ratings describe an owner's assessment of a specific experience card, not causal
proof. No training, native mutation, new store, or agent-wide history access.
A historical review is eligible only when followed immediately by owner acceptance
of that same mission checkpoint. Historical details remain owner-only. An agent
receives only a deliberately shared aggregate snapshot in its assigned mission.
"""
import json
import math
import time
from continuity import canonical, fields, require, sha, string, MAX_EVENTS
from experience import events, gate, grant, pin, shared_pins, terminal

SCHEMA = 'matumbo.mission.reflection/1'
MAX_SCAN = 128
MAX_CARDS = 8
MIN_RATED = 5
OUTCOMES = ('helpful', 'unhelpful', 'inconclusive', 'not_used')


def row_digest(row):
    return sha(canonical(dict(row)))


def event(c, mid, rev):
    return c.db.execute('SELECT * FROM continuity_events WHERE mission=? AND revision=?', (mid,rev)).fetchone()


def owner_event(c, row):
    return row is not None and c.db.execute("SELECT 1 FROM principals WHERE id=? AND role='owner'", (row['actor'],)).fetchone() is not None


def identity(c, m, card):
    """Exact card version across independently granted copies; never merge by title.
    The group also binds the exact condition, source terminal event, and evidence
    identities. Card text is not normalized and no semantic equality is inferred.
    """
    source, ref = terminal(c,m,card['source']['mission_id'],card['source']['revision'])
    require(ref==card['source'],'experience source changed')
    ids=[e['grant_id'] for e in card['evidence']]
    require(shared_pins(c,source,m,ids)==card['evidence'],'experience evidence pin changed')
    group=sha(canonical([m['world'],ref,card['condition'], sorted(pin(grant(c,gid)) for gid in ids)]))
    version=sha(canonical([group,card['kind'],card['summary'],card['next_check']]))
    return version,group


def selected(c,m,ids):
    require(isinstance(ids,list) and 1<=len(ids)<=MAX_CARDS,'select one to eight active experience cards')
    ids=[string(x,64) for x in ids]
    require(len(ids)==len(set(ids)),'duplicate experience card')
    links,_=events(c,m)
    result=[]
    for lid in sorted(ids):
        require(lid in links,'experience card unavailable')
        card=links[lid]
        version,group=identity(c,m,card)
        result.append({'link_id':lid,'version':version,'group':group,'kind':card['kind']})
    require(len({x['version'] for x in result})==len(result),'duplicate procedure version')
    return result


def receipt(c,m,obs,now):
    require(c._obs_ok(m,obs,now),'review requires a confirmed mission observation')
    action=c.db.execute('SELECT id,agent,world,tool,status,result,updated FROM actions WHERE id=?',(obs,)).fetchone()
    require(action is not None,'observation unavailable')
    return row_digest(action)


def review(c,p,m,b):
    fields(b,'id expected_revision request_id observation ratings')
    req=c._replay(p,b,'reflection_review')
    if isinstance(req,dict):return req
    c._rev(m,b['expected_revision'])
    require(m['revision']<MAX_EVENTS-1,'leave room for separate owner acceptance')
    require(m['phase']=='ready' and m['lease_until'] and m['lease_until']>time.time(),'review a ready, leased mission')
    obs=string(b['observation'],64)
    require(obs==m['observation'] and m['checkpoint'] is not None,'review the exact ready checkpoint observation')
    require(c._evidence_ok(m),'required mission evidence unavailable or changed')
    gate(c,m,obs)
    ratings=b['ratings']
    require(isinstance(ratings,list) and 1<=len(ratings)<=MAX_CARDS,'select one to eight ratings')
    for r in ratings:
        fields(r,'link_id outcome note')
        require(isinstance(r['outcome'],str) and r['outcome'] in OUTCOMES,'invalid reviewed outcome')
        string(r['note'],1600,True)
    cards=selected(c,m,[r['link_id'] for r in ratings])
    byid={r['link_id']:r for r in ratings}
    data={'observation':obs,'epoch':m['lease_epoch'],'checkpoint_sha256':sha(m['checkpoint']),
          'receipt_sha256':receipt(c,m,obs,time.time()),
          'ratings':[card|{'outcome':byid[card['link_id']]['outcome'],'note':byid[card['link_id']]['note']} for card in cards],
          'assertion':'owner assessment, not causal proof or automatic success'}
    require(c._evidence_ok(m) and m['lease_until']>time.time() and c._obs_ok(m,obs),'review evidence or observation changed')
    m=c._event(m,'reflection_reviewed',p['id'],data)
    return c._record(p,m,req)


def trial(c,target,mid,rev):
    """Validate a historical trial without requiring its old agent/grant to be
    active. Target grants independently authorize the same evidence. Review must
    immediately precede the exact accepted terminal event. No terminal rewrite.
    """
    m,ref=terminal(c,target,mid,rev)
    require(m['phase']=='closed','only explicitly reviewed accepted checkpoints qualify')
    accepted=event(c,mid,rev); reviewed=event(c,mid,rev-1)
    require(owner_event(c,reviewed) and reviewed['kind']=='reflection_reviewed' and reviewed['assignment']==m['assignment'],'no adjacent reflection review')
    d=json.loads(reviewed['data'])
    require(d['observation']==m['observation'] and d['epoch']==m['lease_epoch'] and isinstance(m['checkpoint'],str) and d['checkpoint_sha256']==sha(m['checkpoint']),'reviewed checkpoint changed')
    require(reviewed['created']<=accepted['created'],'invalid review ordering')
    require(d['receipt_sha256']==receipt(c,m,m['observation'],reviewed['created'])==receipt(c,m,m['observation'],accepted['created']),'reviewed receipt changed')
    # Acceptance already required the obligation gate. Recheck the historical journal.
    gate(c,m,m['observation'])
    rr=d['ratings'];require(isinstance(rr,list) and 1<=len(rr)<=MAX_CARDS,'invalid reviewed ratings')
    cards=selected(c,m,[x['link_id'] for x in rr]);byid={x['link_id']:x for x in rr}
    for card in cards:
        r=byid[card['link_id']]
        require(set(r)==set(card)|{'outcome','note'} and all(r[k]==v for k,v in card.items()) and r['outcome'] in OUTCOMES,'reviewed card changed')
    return {'source':ref,'review_sha256':row_digest(reviewed),'receipt_sha256':d['receipt_sha256'],
            'ratings':{r['version']:r['outcome'] for r in rr}}


def interval(helpful,unhelpful):
    """Wilson descriptive interval (not calibrated uncertainty for these selected trials)."""
    n=helpful+unhelpful
    if not n:return [0.0,1.0]
    z=1.959963984540054;p=helpful/n;den=1+z*z/n
    center=(p+z*z/(2*n))/den;half=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den
    return [max(0.0,center-half),min(1.0,center+half)]


def summarize(cards,trials,complete):
    """Counts and a conservative descriptive separation rule. No physical truth,
    confidence, generalization or action authorization inferred from ratings.
    """
    results=[]
    for card in cards:
        counts={o:0 for o in OUTCOMES}
        for t in trials:
            if card['version'] in t['ratings']:counts[t['ratings'][card['version']]]+=1
        n=counts['helpful']+counts['unhelpful'];total=sum(counts.values())
        band=interval(counts['helpful'],counts['unhelpful'])
        status=('repeated_caution' if counts['unhelpful']>=2 and counts['unhelpful']>counts['helpful'] else
                'favorable_history' if n>=MIN_RATED and counts['unhelpful']==0 else
                'insufficient_ratings' if n<MIN_RATED else 'mixed_history')
        results.append(card|{'counts':counts,'rated':n,'total':total,'rating_interval':band,'pattern':status if complete else 'incomplete_history'})
    decision='abstain';preferred=None;reason='no comparable alternatives'
    if not complete:reason='bounded or invalid history; do not rank'
    elif len(results)>=2 and all(r['kind']=='procedure' for r in results) and len({r['group'] for r in results})==1:
        if any(r['rated']<MIN_RATED or r['rated']*2<r['total'] for r in results):reason='insufficient or predominantly unrated history'
        else:
            # Strict separation from EVERY alternative. Never infer ties by order.
            winners=[r for r in results if all(r is s or r['rating_interval'][0]>s['rating_interval'][1] for s in results)]
            if len(winners)==1 and winners[0]['counts']['helpful']>winners[0]['counts']['unhelpful']:
                decision='consider_preferred';preferred=winners[0]['link_id'];reason='descriptive rating intervals separate for the same exact condition and evidence'
            else:reason='mixed or overlapping reviewed outcomes'
    return {'cards':results,'decision':decision,'preferred_link_id':preferred,'reason':reason,
            'authority':'advisory owner ratings only; verify current conditions; not causal or probabilistic confidence; no action or obligation override'}


def compare(c,m,ids):
    require(c._evidence_ok(m),'target evidence unavailable or changed')
    cards=selected(c,m,ids);wanted={x['version'] for x in cards}
    # Inspect only terminal missions with an explicit adjacent review, newest first.
    rows=c.db.execute("""SELECT m.id,m.revision FROM continuity_missions m JOIN continuity_events e
        ON e.mission=m.id AND e.revision=m.revision-1 AND e.kind='reflection_reviewed'
        WHERE m.world=? AND m.id<>? AND m.phase='closed' ORDER BY m.updated DESC,m.id LIMIT ?""",(m['world'],m['id'],MAX_SCAN+1)).fetchall()
    trials=[];invalid=0
    for row in rows[:MAX_SCAN]:
        try:
            t=trial(c,m,row['id'],row['revision'])
            # Pin and expose only matching ratings, not unrelated cards in the same trial.
            relevant={k:v for k,v in t['ratings'].items() if k in wanted}
            if relevant:trials.append(t|{'ratings':relevant})
        except (ValueError,PermissionError,TypeError,KeyError,OverflowError,RecursionError):
            invalid+=1
    complete=len(rows)<=MAX_SCAN and invalid==0
    require(c._evidence_ok(m),'target evidence unavailable or changed')
    return {'schema':SCHEMA,'mission_id':m['id'],'assignment':m['assignment'],'revision':m['revision'],
            'scanned':min(len(rows),MAX_SCAN),'scan_truncated':len(rows)>MAX_SCAN,'invalid_trials':invalid,
            'complete':complete,'trials':trials,'summary':summarize(cards,trials,complete)}


def shared(c,m):
    row=c.db.execute("SELECT * FROM continuity_events WHERE mission=? AND assignment=? AND kind IN ('reflection_shared','reflection_revoked') ORDER BY revision DESC LIMIT 1",(m['id'],m['assignment'])).fetchone()
    if row is None:return None
    require(owner_event(c,row),'reflection unavailable')
    if row['kind']=='reflection_revoked':return None
    data=json.loads(row['data']);snapshot=data['comparison']
    require(data['comparison_sha256']==sha(canonical(snapshot)) and snapshot['mission_id']==m['id'] and snapshot['assignment']==m['assignment'] and snapshot['revision']==row['revision']-1,'reflection unavailable')
    # Explicitly shared snapshot only. New unrelated reviews are never discovered
    # on the agent route. Validate every pinned historical trial and current card.
    cards=selected(c,m,[x['link_id'] for x in snapshot['summary']['cards']]);wanted={x['version'] for x in cards}
    refs=snapshot['trials'];require(isinstance(refs,list) and len(refs)<=MAX_SCAN,'reflection unavailable')
    require(len({t['source']['mission_id'] for t in refs})==len(refs),'reflection unavailable')
    for t in refs:
        src=t['source'];actual=trial(c,m,src['mission_id'],src['revision'])
        actual['ratings']={k:v for k,v in actual['ratings'].items() if k in wanted}
        require(actual==t,'reflection unavailable or changed')
    require(snapshot['summary']==summarize(cards,refs,snapshot['complete']),'reflection unavailable or changed')
    # Exclude historical mission IDs, ratings notes, private checkpoints and
    # source trial receipts. Aggregate sharing is explicit, not anonymous.
    return {'shared_revision':row['revision'],'reviewed_at':row['created'],'comparison_sha256':data['comparison_sha256'],
            'summary':snapshot['summary'],'complete':snapshot['complete'],
            'scope':'owner-shared historical aggregate; new history not included; not anonymous'}


def route(c,p,path,b):
    role=p['role']
    if role=='owner' and path=='/v1/owner/continuity/reflection/review':
        return review(c,p,c._mission(b.get('id')),b)
    if role=='owner' and path=='/v1/owner/continuity/reflection/compare':
        fields(b,'id link_ids');m=c._mission(b['id']);result=compare(c,m,b['link_ids'])
        return result|{'comparison_sha256':sha(canonical(result))}
    if role=='owner' and path=='/v1/owner/continuity/reflection/share':
        fields(b,'id expected_revision request_id link_ids comparison_sha256');m=c._mission(b['id']);req=c._replay(p,b,'reflection_share')
        if isinstance(req,dict):return req
        c._rev(m,b['expected_revision']);require(m['phase']=='assigned' and m['lease_hash'] is None,'share reflection before claiming')
        snap=compare(c,m,b['link_ids']);digest=sha(canonical(snap))
        require(digest==b['comparison_sha256'],'comparison changed; review exact aggregate again')
        c._fence(m)
        m=c._event(m,'reflection_shared',p['id'],{'comparison':snap,'comparison_sha256':digest},checkpoint=None,observation=None)
        return c._record(p,m,req)
    if role=='owner' and path=='/v1/owner/continuity/reflection/revoke':
        fields(b,'id expected_revision request_id');m=c._mission(b['id']);req=c._replay(p,b,'reflection_revoke')
        if isinstance(req,dict):return req
        c._rev(m,b['expected_revision']);require(m['phase'] not in ('closed','cancelled'),'mission already terminal')
        row=c.db.execute("SELECT kind FROM continuity_events WHERE mission=? AND assignment=? AND kind IN ('reflection_shared','reflection_revoked') ORDER BY revision DESC LIMIT 1",(m['id'],m['assignment'])).fetchone()
        require(row is not None and row['kind']=='reflection_shared','no shared reflection to revoke')
        c._fence(m)
        phase='suspended' if m['phase']=='suspended' else 'assigned'
        m=c._event(m,'reflection_revoked',p['id'],{},phase=phase,lease_hash=None,lease_until=None,checkpoint=None,observation=None)
        if phase=='assigned':c.db.execute("UPDATE tasks SET status='pending' WHERE id=?",(m['id'],))
        return c._record(p,m,req)
    if role=='agent' and path=='/v1/continuity/reflect':
        fields(b,'id epoch lease observation');m=c._mission(b['id']);c._lease(p,m,b)
        require(c._evidence_ok(m),'required mission evidence unavailable or changed')
        obs=b['observation']
        if obs is not None:require(c._obs_ok(m,string(obs,64)),'fresh mission observation required')
        try:brief=shared(c,m)
        except (ValueError,PermissionError,TypeError,KeyError,OverflowError,RecursionError):
            raise PermissionError('shared reflection unavailable or changed') from None
        require(c._evidence_ok(m),'required mission evidence unavailable or changed');c._lease(p,m,b)
        if obs is not None:require(c._obs_ok(m,obs),'fresh mission observation required')
        return {'schema':SCHEMA,'mission_id':m['id'],'assignment':m['assignment'],'revision':m['revision'],
                'status':'not_shared' if brief is None else 'historical_only' if obs is None else 'review_current_conditions',
                'observation':obs,'brief':brief,'next_gate':'fresh_native_observation' if obs is None else 'review_obligations_and_conditions',
                'authority':'advisory only; no native actions, automatic procedure application, or obligation waiver'}
    raise PermissionError('reflection route unavailable to credential')
