"""Reviewed experience links in Station's existing continuity event journal.

No new DB, autonomous learning, native write, or evidence import. The owner
shares explicit text from a terminal mission's context; it is an assertion,
not a verified procedure or outcome. Target grants must pin the same evidence.
All calls run inside Station's existing locked transaction.
"""
import json
import time
from continuity import canonical, fields, require, sha, string

SCHEMA = 'matumbo.mission.experience/1'
MAX_LINKS = 8
MAX_CANDIDATE_SCAN = 128
MAX_CANDIDATES = 12
KINDS = frozenset(('procedure', 'caution', 'obligation'))
PIN_KEYS = ('world', 'binding', 'task', 'fact', 'evidence_sha', 'artifact_sha')
TERMINAL = {'closed': 'accepted', 'cancelled': 'cancelled'}


def events(c, m):
    """Only this mission's current assignment. Prior assignments stay owner-only."""
    rows = c.db.execute('''SELECT revision,kind,data FROM continuity_events
       WHERE mission=? AND assignment=? AND kind IN
       ('experience_linked','experience_revoked','experience_acknowledged')
       ORDER BY revision''', (m['id'], m['assignment']))
    links, acks = {}, {}
    for row in rows:
        data = json.loads(row['data'])
        if row['kind'] == 'experience_linked':
            lid = str(row['revision'])
            if data['link_id'] != lid or lid in links:
                raise ValueError('invalid experience journal')
            links[lid] = data
        elif row['kind'] == 'experience_revoked':
            links.pop(data['link_id'], None)
            acks.pop(data['link_id'], None)
        elif data['link_id'] in links:
            acks[data['link_id']] = data
    require(len(links) <= MAX_LINKS, 'experience link limit')
    return links, acks


def terminal(c, target, source_id, revision):
    source = c._mission(source_id)
    require(source['id'] != target['id'] and source['world'] == target['world'],
            'experience source must be another mission in this world')
    require(source['phase'] in TERMINAL and type(revision) is int and revision == source['revision'],
            'experience source must be the exact terminal revision')
    event = c.db.execute('SELECT * FROM continuity_events WHERE mission=? AND revision=?',
                         (source['id'], revision)).fetchone()
    require(event is not None and event['kind'] == TERMINAL[source['phase']]
            and event['assignment'] == source['assignment'], 'terminal event unavailable')
    owner = c.db.execute('SELECT role FROM principals WHERE id=?', (event['actor'],)).fetchone()
    require(owner is not None and owner['role'] == 'owner', 'terminal event not owner-reviewed')
    # This pins the existing journal row; it is not a digital signature.
    return source, {'mission_id': source['id'], 'revision': revision, 'assignment': source['assignment'],
                    'terminal_event': event['kind'], 'event_sha256': sha(canonical(dict(event)))}


def grant(c, gid):
    return c.db.execute('SELECT * FROM mission_memory_grants WHERE id=?', (gid,)).fetchone()


def pin(g):
    return tuple(g[k] for k in PIN_KEYS)


def shared_pins(c, source, target, ids):
    """Source historical grants need not still be active. Target grants must be
    independently owner-issued and current; no implicit transfer of access."""
    require(isinstance(ids, list) and 1 <= len(ids) <= 4, 'select one to four shared evidence grants')
    ids = [string(x,64) for x in ids]
    require(len(set(ids)) == len(ids) and set(ids) <= set(json.loads(target['grants'])),
            'experience evidence must belong to the target mission')
    src = [grant(c, x) for x in json.loads(source['grants'])]
    pins = {pin(g) for g in src if g is not None and g['agent'] == source['agent'] and g['world'] == source['world']}
    result = []
    for gid in sorted(ids):
        g = grant(c, gid)
        require(g is not None and g['agent'] == target['agent'] and g['world'] == target['world']
                and pin(g) in pins, 'no matching shared evidence pin')
        result.append({'grant_id': gid, 'fact_id': g['fact'], 'evidence_sha256': g['evidence_sha'],
                       'artifact_sha256': g['artifact_sha'], 'task_id': g['task']})
    return result


def sources_ok(c, m):
    """Cheap journal/pin check after continuity validates actual Apollo bytes.
    Use one final time for all grants to avoid expiry during a sequential scan.
    Existing missions with no experience cards retain their original behavior.
    """
    try:
        links, _ = events(c, m)
        if not links:
            return True
        p = c._agent(m['agent'], m['world'])
        for link in links.values():
            source, ref = terminal(c, m, link['source']['mission_id'], link['source']['revision'])
            if ref != link['source']:
                return False
            if shared_pins(c, source, m, [e['grant_id'] for e in link['evidence']]) != link['evidence']:
                return False
        now = time.time()
        return all(c.s.memory._active(grant(c, gid), p, now) for gid in json.loads(m['grants']))
    except (PermissionError, ValueError, TypeError, KeyError, OverflowError):
        return False


def pending(c, m, observation):
    links, acks = events(c, m)
    return [lid for lid, link in links.items() if link['kind'] == 'obligation' and
            (not observation or acks.get(lid, {}).get('observation') != observation or
             acks.get(lid, {}).get('epoch') != m['lease_epoch'])]


def gate(c, m, observation):
    # No change to older missions without active obligations.
    require(not pending(c, m, observation), 'acknowledge all reviewed obligations against this observation before review')


def candidates(c, m, limit):
    """Owner-only discovery over terminal missions that share exact evidence pins.
    A bounded candidate list is not a global search or an automatic lesson.
    """
    require(type(limit) is int and 1 <= limit <= MAX_CANDIDATES, 'invalid candidate limit')
    require(c._evidence_ok(m), 'target evidence unavailable or changed')
    target = [grant(c,gid) for gid in json.loads(m['grants'])]
    target = [g for g in target if g is not None]
    rows = c.db.execute("""SELECT * FROM continuity_missions WHERE world=? AND id<>?
             AND phase IN ('closed','cancelled') ORDER BY updated DESC,id LIMIT ?""",
             (m['world'],m['id'],MAX_CANDIDATE_SCAN+1)).fetchall()
    ranked=[]
    for source in rows[:MAX_CANDIDATE_SCAN]:
        try:
            _,ref=terminal(c,m,source['id'],source['revision'])
            pins={pin(g) for gid in json.loads(source['grants']) if (g:=grant(c,gid)) is not None
                  and g['agent']==source['agent'] and g['world']==source['world']}
            matches=sorted(g['id'] for g in target if pin(g) in pins)
            if not matches:continue
            task=c.db.execute('SELECT text FROM tasks WHERE id=?',(source['id'],)).fetchone()
            ranked.append((len(matches),source['updated'],source['id'],{
               'source':ref,'objective_preview':task['text'][:240],
               'matching_target_grant_ids':matches,'shared_pin_count':len(matches),
               'assertion':'candidate for explicit owner review, not a verified lesson'}))
        except (PermissionError,ValueError,TypeError,KeyError,OverflowError):
            continue
    ranked.sort(key=lambda r:(-r[0],-r[1],r[2]))
    require(c._evidence_ok(m), 'target evidence unavailable or changed')
    return {'schema':SCHEMA,'mission_id':m['id'],'revision':m['revision'],
            'scanned':min(len(rows),MAX_CANDIDATE_SCAN),'scan_truncated':len(rows)>MAX_CANDIDATE_SCAN,
            'matches_truncated':len(ranked)>limit,'linkable':m['phase']=='assigned' and m['lease_hash'] is None,
            'candidates':[r[3] for r in ranked[:limit]],'authority':'owner-only discovery; no disclosure to agent'}


def route(c, p, path, b):
    role = p['role']
    if path == '/v1/owner/continuity/experience/candidates' and role == 'owner':
        fields(b,'id limit'); return candidates(c,c._mission(b['id']),b['limit'])
    if path == '/v1/owner/continuity/experience/link' and role == 'owner':
        fields(b,'id expected_revision request_id source_id source_revision kind summary condition next_check grants')
        m = c._mission(b['id']); req = c._replay(p,b,'experience_link')
        if isinstance(req,dict): return req | {'link_id': str(req['applied_revision'])}
        c._rev(m,b['expected_revision'])
        require(m['phase'] == 'assigned' and m['lease_hash'] is None, 'link experience before claiming the mission')
        require(b['kind'] in KINDS if isinstance(b['kind'],str) else False, 'invalid experience kind')
        links,_ = events(c,m); require(len(links)<MAX_LINKS,'active experience link limit')
        source, ref = terminal(c,m,b['source_id'],b['source_revision'])
        evidence = shared_pins(c,source,m,b['grants'])
        require(c._evidence_ok(m),'target evidence unavailable or changed')
        link = {'link_id':str(m['revision']+1),'kind':b['kind'],
                'summary':string(b['summary'],1600,True),'condition':string(b['condition'],1000,True),
                'next_check':string(b['next_check'],1000,True),'source':ref,'evidence':evidence,
                'assertion':'owner-reviewed note; terminal event is not proof of success or failure'}
        # Even an assigned mission can have an old checkpoint after lease expiry.
        # Changes to shared context require a new checkpoint/observation.
        c._fence(m)
        m = c._event(m,'experience_linked',p['id'],link,checkpoint=None,observation=None)
        return c._record(p,m,req) | {'link_id':link['link_id']}
    if path == '/v1/owner/continuity/experience/revoke' and role == 'owner':
        fields(b,'id expected_revision request_id link_id')
        m = c._mission(b['id']); req = c._replay(p,b,'experience_revoke')
        if isinstance(req,dict):return req
        c._rev(m,b['expected_revision']); require(m['phase'] not in TERMINAL, 'mission already terminal')
        links,_ = events(c,m); lid = string(b['link_id'],64)
        require(lid in links,'active experience link unavailable')
        # Safety revocation must not be blocked by an exhausted event quota.
        # Clear private derivative checkpoint, retain only owner history.
        c._fence(m)
        phase = 'suspended' if m['phase'] == 'suspended' else 'assigned'
        m = c._event(m,'experience_revoked',p['id'],{'link_id':lid},phase=phase,
                     lease_hash=None,lease_until=None,checkpoint=None,observation=None)
        if phase == 'assigned':c.db.execute("UPDATE tasks SET status='pending' WHERE id=?",(m['id'],))
        return c._record(p,m,req)
    if path == '/v1/owner/continuity/experience/list' and role == 'owner':
        fields(b,'id'); m = c._mission(b['id']); links,acks = events(c,m)
        return {'schema':SCHEMA,'mission_id':m['id'],'assignment':m['assignment'],'revision':m['revision'],
                'links':list(links.values()),'acknowledgements':list(acks.values()),'evidence_current':c._evidence_ok(m),
                'pending_obligations':pending(c,m,m['observation'] if c._obs_ok(m,m['observation']) else None)}
    if path == '/v1/continuity/resume' and role == 'agent':
        fields(b,'id epoch lease observation'); m = c._mission(b['id']); c._lease(p,m,b)
        require(c._evidence_ok(m),'required mission evidence unavailable or changed')
        links,acks = events(c,m)
        # Only explicitly supplied mission receipt may make the brief actionable.
        # Invalid provided IDs fail closed, rather than silently returning a plan.
        obs = b['observation']
        if obs is not None: require(c._obs_ok(m,string(obs,64)), 'fresh mission observation required')
        todo = pending(c,m,obs)
        c._lease(p,m,b)
        if obs is not None:require(c._obs_ok(m,obs),'fresh mission observation required')
        task = c.db.execute('SELECT text FROM tasks WHERE id=?',(m['id'],)).fetchone()
        return {'schema':SCHEMA,'mission_id':m['id'],'assignment':m['assignment'],'revision':m['revision'],
                'lease_epoch':m['lease_epoch'],'objective':task['text'],'handoff':m['handoff'],
                'checkpoint':json.loads(m['checkpoint']) if m['checkpoint'] else None,
                'links':list(links.values()),'observation':obs,
                'acknowledgements':[a for lid,a in acks.items() if obs is not None and lid in links and a['epoch']==m['lease_epoch'] and a['observation']==obs],
                'pending_obligations':todo,
                'next_gate':'fresh_native_observation' if obs is None else 'review_obligations' if todo else 'owner_review' if m['phase']=='ready' and m['observation']==obs else 'prepare_checkpoint',
                'authority':'advisory context only; no action, truth certification, or completion authority',
                'historical':True}
    if path == '/v1/continuity/acknowledge' and role == 'agent':
        fields(b,'id epoch lease expected_revision request_id link_id observation note')
        m = c._mission(b['id']); c._lease(p,m,b)
        req = c._replay(p,b,'experience_acknowledge')
        if isinstance(req,dict):return req
        c._rev(m,b['expected_revision']); require(c._evidence_ok(m),'required mission evidence unavailable or changed')
        links,_ = events(c,m); lid = string(b['link_id'],64); obs = string(b['observation'],64)
        require(lid in links and links[lid]['kind']=='obligation','active obligation unavailable')
        require(c._obs_ok(m,obs),'fresh mission observation required')
        data={'link_id':lid,'epoch':m['lease_epoch'],'observation':obs,
              'note':string(b['note'],1600,True),'agent_assertion':True}
        c._lease(p,m,b);require(c._obs_ok(m,obs),'fresh mission observation required')
        # Recording an acknowledgement never accepts the mission. A new checkpoint
        # must follow; a different observation requires new acknowledgement.
        m = c._event(m,'experience_acknowledged',p['id'],data,phase='active',observation=None)
        return c._record(p,m,req)
    raise PermissionError('experience route unavailable to credential')
