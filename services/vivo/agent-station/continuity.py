"""Mission continuity for the original Station task inbox.

A lease is a worker fence, not an extra identity or world-edit grant. The
Station stores task checkpoints and evidence references; Apollo owns facts and
Vivo owns native state. All methods execute under the Station write transaction.
"""
import hashlib
import hmac
import json
import secrets
import time
import uuid

CAP = 'mission.continue'
MAX_LEASE = 300
MAX_AGE = 120
MAX_GRANTS = 16
MAX_EVENTS = 512


def canonical(x):
    return json.dumps(x, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False)


def sha(x):
    return hashlib.sha256(x.encode('utf-8')).hexdigest()


def require(ok, msg='invalid continuity request'):
    if not ok:
        raise ValueError(msg)


def string(x, n=128, multiline=False):
    require(isinstance(x, str) and bool(x.strip()) and len(x) <= n
            and all(ord(c) >= 32 or (multiline and c in '\n\t\r') for c in x)
            and '\x7f' not in x, 'invalid continuity text or reference')
    try:
        x.encode('utf-8')
    except UnicodeError:
        raise ValueError('invalid continuity Unicode') from None
    return x


def fields(body, keys):
    require(isinstance(body, dict) and set(body) == set(keys.split()), 'unexpected continuity request fields')


class Continuity:
    def __init__(self, station):
        self.s = station
        self.db = station.db
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS continuity_missions(
            id TEXT PRIMARY KEY REFERENCES tasks(id), world TEXT NOT NULL,
            agent TEXT NOT NULL REFERENCES principals(id), assignment INTEGER NOT NULL,
            revision INTEGER NOT NULL, phase TEXT NOT NULL, lease_epoch INTEGER NOT NULL,
            lease_hash TEXT, lease_until REAL, grants TEXT NOT NULL, handoff TEXT NOT NULL,
            checkpoint TEXT, observation TEXT, updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS continuity_events(
            mission TEXT NOT NULL REFERENCES continuity_missions(id), revision INTEGER NOT NULL,
            assignment INTEGER NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL,
            data TEXT NOT NULL, created REAL NOT NULL, PRIMARY KEY(mission,revision));
        CREATE TABLE IF NOT EXISTS continuity_lease_history(
            mission TEXT NOT NULL REFERENCES continuity_missions(id), secret_hash TEXT NOT NULL,
            PRIMARY KEY(mission,secret_hash));
        CREATE TABLE IF NOT EXISTS continuity_observations(
            action TEXT PRIMARY KEY REFERENCES actions(id), mission TEXT NOT NULL REFERENCES continuity_missions(id),
            assignment INTEGER NOT NULL, epoch INTEGER NOT NULL, request_id TEXT NOT NULL,
            UNIQUE(mission,assignment,epoch,request_id));
        CREATE TABLE IF NOT EXISTS continuity_requests(
            actor TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
            mission TEXT NOT NULL REFERENCES continuity_missions(id), revision INTEGER NOT NULL,
            PRIMARY KEY(actor,request_id));
        CREATE INDEX IF NOT EXISTS continuity_agent_idx ON continuity_missions(agent,phase);
        ''')

    def is_managed(self, mid):
        return self.db.execute('SELECT 1 FROM continuity_missions WHERE id=?', (mid,)).fetchone() is not None

    def _mission(self, mid):
        m = self.db.execute('SELECT * FROM continuity_missions WHERE id=?', (string(mid,64),)).fetchone()
        if not m:
            raise PermissionError('mission unavailable')
        return m

    def _agent(self, aid, world=None):
        p = self.db.execute('SELECT * FROM principals WHERE id=?', (string(aid,64),)).fetchone()
        if not p or p['role'] != 'agent' or not p['active'] or (world is not None and p['world'] != world):
            raise PermissionError('mission recipient unavailable')
        if not {CAP, 'world.read'}.issubset(json.loads(p['caps'])):
            raise PermissionError('mission requires continuity and native read capabilities')
        return p

    def _authorize(self, p, m):
        if p['role'] == 'owner':
            return
        if p['role'] != 'agent' or p['id'] != m['agent'] or p['world'] != m['world']:
            raise PermissionError('mission unavailable')
        self._agent(p['id'],m['world'])

    def _grant_check(self, gid, p):
        mg = self.s.memory
        row = self.db.execute('SELECT * FROM mission_memory_grants WHERE id=?', (gid,)).fetchone()
        if not mg.source or not mg._active(row,p,time.time()):
            return False
        try:
            r = mg._read(row['task'])
            return bool(r and mg._pin(r) == {k:row[k] for k in ('fact','evidence_sha','artifact_sha')}
                        and mg._active(row,p,time.time()))
        except (PermissionError, ValueError, TypeError, KeyError):
            return False

    def _grants(self, ids, p):
        require(isinstance(ids,list) and len(ids) <= MAX_GRANTS, 'too many mission grants')
        ids = [string(i,64) for i in ids]
        require(len(set(ids)) == len(ids), 'duplicate mission grants')
        if not all(self._grant_check(i,p) for i in ids):
            raise PermissionError('mission evidence grant unavailable or changed')
        return sorted(ids)

    def _evidence_ok(self, m):
        try:
            p = self._agent(m['agent'],m['world'])
            from experience import sources_ok
            return all(self._grant_check(i,p) for i in json.loads(m['grants'])) and sources_ok(self,m)
        except PermissionError:
            return False

    def _obs_ok(self,m,aid,now=None):
        if not aid:
            return False
        now = time.time() if now is None else now
        row = self.db.execute('''SELECT a.*, o.epoch, o.assignment FROM actions a
            JOIN continuity_observations o ON o.action=a.id WHERE o.mission=? AND a.id=?''', (m['id'],aid)).fetchone()
        if not row or row['agent'] != m['agent'] or row['world'] != m['world'] or row['tool'] != 'vivo.world.read' or row['status'] != 'completed' or row['assignment'] != m['assignment'] or row['epoch'] != m['lease_epoch']:
            return False
        if not 0 <= now-row['updated'] <= MAX_AGE:
            return False
        try:
            return json.loads(row['result'])['snapshot']['worldId'] == m['world']
        except (TypeError, KeyError, ValueError):
            return False

    def _view(self,m,p):
        self._authorize(p,m)
        valid=self._evidence_ok(m)
        visible = p['role']=='owner' or valid
        observed=self._obs_ok(m,m['observation'])
        phase=m['phase']
        next_gate=('terminal' if phase in ('closed','cancelled') else 'owner_handoff' if phase=='suspended' else 'owner_evidence_review' if not valid else 'claim' if phase=='assigned' else 'owner_review' if phase=='ready' and observed else 'fresh_native_observation' if not observed else 'checkpoint')
        task=self.db.execute('SELECT text FROM tasks WHERE id=?',(m['id'],)).fetchone()
        from metacognition import contract
        audit=contract(self,m)
        from collective import panel
        from organization import status as organization_status
        organization,_=organization_status(self,m)
        if organization and phase not in ('closed','cancelled','suspended') and not organization['dependencies_satisfied']:
            next_gate='owner_dependency_review' if organization['status']=='blocked' else 'await_dependencies'
        return {'organization':organization,'collective_required':panel(self,m) is not None,'audit_required':audit is not None,'audit_contract_revision':audit['revision'] if audit and visible else None,'id':m['id'],'world':m['world'],'agent':m['agent'],'assignment':m['assignment'],
                'revision':m['revision'],'phase':m['phase'],'lease_epoch':m['lease_epoch'],
                'lease_until':m['lease_until'], 'objective':task['text'],
                'grants':json.loads(m['grants']) if visible else [],
                'handoff':m['handoff'] if visible else None,
                'checkpoint':json.loads(m['checkpoint']) if visible and m['checkpoint'] else None,
                'observation':m['observation'] if visible else None,
                'evidence_current':valid,'observation_current':observed,'next_gate':next_gate,
                'authority':'checkpoint-only; native mutations require their existing approval path',
                'blockers':([] if valid else ['Required evidence unavailable or changed'])+
                           ([] if observed or phase in ('closed','cancelled') else ['Fresh confirmed native observation required'])}

    def _list_item(self,m,p):
        self._authorize(p,m)
        task=self.db.execute('SELECT text FROM tasks WHERE id=?',(m['id'],)).fetchone()
        # Lists never resolve the entire evidence store or copy checkpoint text.
        return {k:m[k] for k in ('id','world','agent','assignment','revision','phase','lease_epoch','lease_until')} | {'objective':task['text']}

    def permit_observation_dispatch(self,aid):
        link=self.db.execute('SELECT * FROM continuity_observations WHERE action=?',(aid,)).fetchone()
        if not link:return True
        m=self._mission(link['mission'])
        return (m['phase'] in ('active','ready') and m['lease_until'] and m['lease_until']>time.time()
                and m['assignment']==link['assignment'] and m['lease_epoch']==link['epoch']
                and self._evidence_ok(m) and m['lease_until']>time.time() and self._organization_dispatchable(m))

    def _organization_dispatchable(self,m):
        from organization import dispatchable
        return dispatchable(self,m)

    def _rev(self,m,expected):
        require(type(expected) is int and expected == m['revision'], 'mission revision conflict; re-observe')

    def _lease(self,p,m,body):
        self._authorize(p,m)
        if p['role']!='agent' or m['phase'] not in ('active','ready') or not m['lease_hash'] or m['lease_until']<=time.time() or type(body.get('epoch')) is not int or body['epoch']!=m['lease_epoch'] or not hmac.compare_digest(m['lease_hash'],sha(string(body.get('lease'),128))):
            raise PermissionError('mission lease unavailable or fenced')
        from organization import gate
        gate(self,m)

    def _event(self,m,kind,actor,data,**changes):
        # Automatic expiration/stop must never be blocked by a user event quota.
        if kind not in ('expired','stopped','cancelled','experience_revoked','reflection_revoked','audit_cleared','collective_cleared'):
            require(m['revision'] < MAX_EVENTS, 'mission event limit; owner may cancel')
        rev=m['revision']+1
        changes.update(revision=rev,updated=time.time())
        self.db.execute('UPDATE continuity_missions SET '+','.join(k+'=?' for k in changes)+' WHERE id=?',(*changes.values(),m['id']))
        current=self._mission(m['id'])
        self.db.execute('INSERT INTO continuity_events VALUES(?,?,?,?,?,?,?)',
                        (m['id'],rev,current['assignment'],kind,actor,canonical(data),time.time()))
        return current

    def _fence(self,m):
        self.db.execute('''UPDATE actions SET status=CASE WHEN status='running' THEN 'uncertain' ELSE 'cancelled' END, updated=?
            WHERE status IN ('queued','running') AND id IN (SELECT action FROM continuity_observations WHERE mission=?)''', (time.time(),m['id']))

    def expire(self):
        now=time.time()
        rows=self.db.execute('''SELECT m.*,p.active AS agent_active FROM continuity_missions m JOIN principals p ON p.id=m.agent
            WHERE m.phase IN ('active','ready','assigned') AND (p.active=0 OR (m.lease_until IS NOT NULL AND m.lease_until<=?))''',(now,)).fetchall()
        for m in rows:
            self._fence(m)
            self._event(m,'expired' if m['agent_active'] else 'stopped','station',{},phase='assigned' if m['agent_active'] else 'suspended',lease_hash=None,lease_until=None,observation=None)

    def _replay(self,p,body,kind):
        rid=string(body['request_id'],100)
        # Lease secrets never enter the DB; retain only a fingerprint.
        fingerprint=sha(canonical([kind,body]))
        row=self.db.execute('SELECT * FROM continuity_requests WHERE actor=? AND request_id=?',(p['id'],rid)).fetchone()
        if row:
            require(row['fingerprint']==fingerprint,'continuity request identity conflict')
            m=self._mission(row['mission']);self._authorize(p,m)
            return {'id':m['id'],'applied_revision':row['revision'],'replayed':True}
        return rid,fingerprint

    def _record(self,p,m,req):
        self.db.execute('INSERT INTO continuity_requests VALUES(?,?,?,?,?)',(p['id'],*req,m['id'],m['revision']))
        return {'id':m['id'],'applied_revision':m['revision'],'replayed':False}

    def _queue_observation(self,p,m,b,*,assisted=False):
        self._lease(p,m,b)
        rid=string(b['request_id'],100)
        require(assisted or not rid.startswith('investigation-'),'reserved investigation request prefix')
        existing=self.db.execute('SELECT action FROM continuity_observations WHERE mission=? AND assignment=? AND epoch=? AND request_id=?',(m['id'],m['assignment'],m['lease_epoch'],rid)).fetchone()
        if existing:return self.s.public(self.s.action(existing['action']))
        require(self._evidence_ok(m),'required mission evidence unavailable');self._lease(p,m,b)
        require(not self.db.execute("SELECT 1 FROM continuity_observations o JOIN actions a ON a.id=o.action WHERE o.mission=? AND a.status IN ('queued','running')",(m['id'],)).fetchone(),'mission observation already pending')
        if assisted:
            from adaptive import READ_LIMIT,MIN_LEASE_SECONDS,host_online
            now=time.time()
            require(m['lease_until']-now>=MIN_LEASE_SECONDS and host_online(self,m,now),'investigation host or lease changed; recompute')
            count=self.db.execute('SELECT count(*) FROM continuity_observations WHERE mission=? AND assignment=?',(m['id'],m['assignment'])).fetchone()[0]
            require(count<READ_LIMIT,'assisted investigation read budget exhausted')
        pending=self.db.execute("SELECT count(*) FROM actions WHERE agent=? AND status IN ('queued','awaiting_approval','running')",(p['id'],)).fetchone()[0]
        require(pending<32,'pending action limit')
        n=self.db.execute('SELECT count(*) FROM continuity_observations WHERE mission=?',(m['id'],)).fetchone()[0]
        require(n<MAX_EVENTS,'mission observation limit')
        aid=uuid.uuid4().hex;now=time.time();request='continuity-'+sha(canonical([m['id'],m['assignment'],m['lease_epoch'],rid]))
        self.db.execute('INSERT INTO actions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(aid,p['id'],m['world'],request,'vivo.world.read','{}',sha(canonical(['vivo.world.read',{}])),'queued',None,None,None,now,now))
        self.db.execute('INSERT INTO continuity_observations VALUES(?,?,?,?,?)',(aid,m['id'],m['assignment'],m['lease_epoch'],rid))
        return self.s.public(self.s.action(aid))

    def route(self,p,method,path,b):
        role=p['role']; owner=role=='owner'; agent=role=='agent'; pid=p['id']
        if not owner and (not agent or CAP not in json.loads(p['caps'])):
            raise PermissionError('continuity capability unavailable')
        if path=='/v1/owner/continuity/create' and method=='POST' and owner:
            fields(b,'request_id agent objective grants')
            req=self._replay(p,b,'create')
            if isinstance(req,dict):return req
            target=self._agent(b['agent']); grants=self._grants(b['grants'],target); objective=string(b['objective'],8000,True)
            count=self.db.execute("SELECT count(*) FROM continuity_missions WHERE agent=? AND phase NOT IN ('closed','cancelled')",(target['id'],)).fetchone()[0]
            require(count<64,'active mission limit')
            mid=uuid.uuid4().hex;now=time.time()
            self.db.execute("INSERT INTO tasks VALUES(?,?,?,'pending',NULL,?)",(mid,target['id'],objective,now))
            self.db.execute('''INSERT INTO continuity_missions VALUES(?,?,?,1,1,'assigned',0,NULL,NULL,?,'',NULL,NULL,?)''',(mid,target['world'],target['id'],canonical(grants),now))
            m=self._mission(mid)
            self.db.execute('INSERT INTO continuity_events VALUES(?,?,?,?,?,?,?)',(mid,1,1,'created',pid,canonical({'grants':grants,'agent':target['id']}),now))
            return self._record(p,m,req)
        if method=='GET' and path in ('/v1/owner/continuity/list','/v1/continuity/list'):
            fields(b,'')
            if owner and path.startswith('/v1/owner/'):
                rows=self.db.execute('SELECT * FROM continuity_missions ORDER BY updated DESC LIMIT 100')
            elif agent and path=='/v1/continuity/list':
                rows=self.db.execute('SELECT * FROM continuity_missions WHERE agent=? AND world=? ORDER BY updated DESC LIMIT 64',(pid,p['world']))
            else:raise PermissionError('continuity route unavailable')
            return [self._list_item(m,p) for m in rows]
        if method!='POST':raise PermissionError('continuity route unavailable')
        if path=='/v1/continuity/state' or path=='/v1/owner/continuity/state':
            fields(b,'id');m=self._mission(b['id']);self._authorize(p,m)
            if (owner and path.startswith('/v1/owner/')) or (agent and path=='/v1/continuity/state'):return self._view(m,p)
            raise PermissionError('continuity route unavailable')
        if path=='/v1/owner/continuity/history' and owner:
            fields(b,'id');m=self._mission(b['id']);self._authorize(p,m)
            return [{'revision':r['revision'],'assignment':r['assignment'],'kind':r['kind'],'actor':r['actor'],'data':json.loads(r['data']),'created':r['created']} for r in self.db.execute('SELECT * FROM continuity_events WHERE mission=? ORDER BY revision',(m['id'],))]
        if path=='/v1/continuity/claim' and agent:
            fields(b,'id expected_revision lease ttl_seconds');m=self._mission(b['id']);self._authorize(p,m)
            from organization import gate
            gate(self,m)
            secret=string(b['lease'],128); require(len(secret)>=32,'use a random worker lease secret of at least 32 characters')
            ttl=b['ttl_seconds'];require(type(ttl) is int and 1<=ttl<=MAX_LEASE,'invalid lease duration')
            if m['phase'] in ('active','ready') and m['lease_hash'] and hmac.compare_digest(m['lease_hash'],sha(secret)):
                return self._view(m,p) # lost response; do not silently renew
            self._rev(m,b['expected_revision']);require(m['phase']=='assigned','mission already leased or not assignable')
            require(not self.db.execute('SELECT 1 FROM continuity_lease_history WHERE mission=? AND secret_hash=?',(m['id'],sha(secret))).fetchone(),'expired lease secret cannot be reused')
            require(self._evidence_ok(m),'required mission evidence unavailable')
            self.db.execute('INSERT INTO continuity_lease_history VALUES(?,?)',(m['id'],sha(secret)))
            m=self._event(m,'claimed',pid,{},phase='active',lease_hash=sha(secret),lease_until=time.time()+ttl,lease_epoch=m['lease_epoch']+1,observation=None)
            self.db.execute("UPDATE tasks SET status='claimed' WHERE id=?",(m['id'],))
            return self._view(m,p)
        if path=='/v1/continuity/renew' and agent:
            fields(b,'id epoch lease expected_revision ttl_seconds request_id');m=self._mission(b['id']);self._lease(p,m,b)
            req=self._replay(p,b,'renew')
            if isinstance(req,dict):return req
            self._rev(m,b['expected_revision']);ttl=b['ttl_seconds'];require(type(ttl) is int and 1<=ttl<=MAX_LEASE,'invalid lease duration')
            require(self._evidence_ok(m),'required mission evidence unavailable');self._lease(p,m,b)
            m=self._event(m,'renewed',pid,{},lease_until=time.time()+ttl)
            return self._record(p,m,req)
        if path in ('/v1/continuity/audit','/v1/continuity/probe','/v1/owner/continuity/audit/get','/v1/owner/continuity/audit/set','/v1/owner/continuity/audit/clear'):
            from metacognition import route
            return route(self,p,path,b)
        if path in ('/v1/continuity/reflect','/v1/owner/continuity/reflection/review','/v1/owner/continuity/reflection/compare','/v1/owner/continuity/reflection/share','/v1/owner/continuity/reflection/revoke'):
            from reflection import route
            return route(self,p,path,b)
        if path in ('/v1/continuity/resume','/v1/continuity/acknowledge','/v1/owner/continuity/experience/link','/v1/owner/continuity/experience/revoke','/v1/owner/continuity/experience/list','/v1/owner/continuity/experience/candidates'):
            from experience import route
            result=route(self,p,path,b)
            if path=='/v1/continuity/resume':
                from metacognition import contract
                result['audit_required']=contract(self,self._mission(b['id'])) is not None
                if result['audit_required']:result['audit_tool']='mission_audit'
            return result
        if path=='/v1/continuity/context' and agent:
            from associative import context
            return context(self,p,self._mission(b.get('id')),b)
        if path in ('/v1/continuity/collective','/v1/continuity/contribute','/v1/owner/continuity/collective/set','/v1/owner/continuity/collective/get','/v1/owner/continuity/collective/inspect','/v1/owner/continuity/collective/clear'):
            from collective import route
            return route(self,p,path,b)
        if path=='/v1/owner/continuity/strategy/compare':
            from strategy import compare
            return compare(self,p,b)
        if path in ('/v1/continuity/workflow','/v1/owner/continuity/organization/get','/v1/owner/continuity/organization/set'):
            from organization import route
            return route(self,p,path,b)
        if path in ('/v1/continuity/plan','/v1/continuity/investigate'):
            from adaptive import route
            return route(self,p,path,b)
        if path=='/v1/continuity/observe' and agent:
            fields(b,'id epoch lease request_id');m=self._mission(b['id']);return self._queue_observation(p,m,b)
        if path=='/v1/continuity/checkpoint' and agent:
            fields(b,'id epoch lease expected_revision request_id progress next_step observation ready');m=self._mission(b['id']);self._lease(p,m,b)
            req=self._replay(p,b,'checkpoint')
            if isinstance(req,dict):return req
            self._rev(m,b['expected_revision']);require(type(b['ready']) is bool,'ready must be boolean')
            require(self._evidence_ok(m),'required mission evidence unavailable');self._lease(p,m,b)
            progress=string(b['progress'],4000,True); next_step=string(b['next_step'],1000,True)
            obs=b['observation'];require(obs is None or self._obs_ok(m,string(obs,64)),'observation not confirmed, current and mission-bound')
            audit_binding=None;collective_binding=None;organization_binding=None
            if b['ready']:
                require(obs is not None,'fresh confirmed native observation required for review')
                from experience import gate
                gate(self,m,obs)
                from metacognition import gate as audit_gate
                audit_binding=audit_gate(self,m,obs)
                from collective import gate as collective_gate
                collective_binding=collective_gate(self,m,obs)
                from organization import gate as organization_gate, latest_required
                organization_binding=organization_gate(self,m)
                if organization_binding is not None:latest_required(self,m,obs)
                self._lease(p,m,b);require(self._obs_ok(m,obs),'fresh confirmed native observation required for review')
            cp={'progress':progress,'next_step':next_step,'observation':obs,'agent_assertion':True,'saved_at':time.time()}
            if audit_binding is not None:cp['audit']=audit_binding
            if collective_binding is not None:cp['collective']=collective_binding
            if organization_binding is not None:cp['organization']=organization_binding
            m=self._event(m,'checkpoint',pid,cp,checkpoint=canonical(cp),observation=obs,phase='ready' if b['ready'] else 'active')
            return self._record(p,m,req)
        if path=='/v1/owner/continuity/handoff' and owner:
            fields(b,'id expected_revision request_id agent grants note');m=self._mission(b['id']);req=self._replay(p,b,'handoff')
            if isinstance(req,dict):return req
            self._rev(m,b['expected_revision']);require(m['phase'] not in ('closed','cancelled'),'mission already terminal')
            from metacognition import contract
            require(contract(self,m) is None,'review and explicitly clear the audit contract before handoff')
            from collective import panel
            require(panel(self,m) is None,'review and explicitly clear the collective panel before handoff')
            target=self._agent(b['agent'],m['world']);require(target['id']!=m['agent'],'handoff requires a different recipient')
            require(self.db.execute("SELECT count(*) FROM continuity_missions WHERE agent=? AND phase NOT IN ('closed','cancelled')",(target['id'],)).fetchone()[0]<64,'active mission limit')
            grants=self._grants(b['grants'],target);note=string(b['note'],4000,True)
            self._fence(m)
            m=self._event(m,'handoff',pid,{'from':m['agent'],'to':target['id'],'grants':grants,'note':note},agent=target['id'],assignment=m['assignment']+1,grants=canonical(grants),handoff=note,checkpoint=None,observation=None,lease_hash=None,lease_until=None,phase='assigned')
            self.db.execute("UPDATE tasks SET agent=?,status='pending',answer=NULL WHERE id=?",(target['id'],m['id']))
            return self._record(p,m,req)
        if path in ('/v1/owner/continuity/accept','/v1/owner/continuity/cancel') and owner:
            fields(b,'id expected_revision request_id note');m=self._mission(b['id']);kind=path.rsplit('/',1)[-1];req=self._replay(p,b,kind)
            if isinstance(req,dict):return req
            self._rev(m,b['expected_revision']);require(m['phase'] not in ('closed','cancelled'),'mission already terminal')
            note=string(b['note'],4000,True);event_data={'note':note}
            if kind=='accept':
                require(m['phase']=='ready' and m['lease_until'] and m['lease_until']>time.time() and self._obs_ok(m,m['observation']) and self._evidence_ok(m) and m['lease_until']>time.time() and self._obs_ok(m,m['observation']),'review requires current evidence and a fresh confirmed observation')
                from experience import gate
                gate(self,m,m['observation'])
                from metacognition import gate as audit_gate
                audit_binding=audit_gate(self,m,m['observation'])
                if audit_binding is not None:
                    require(isinstance(m['checkpoint'],str) and json.loads(m['checkpoint']).get('audit')==audit_binding,'audited checkpoint source changed; prepare a new checkpoint')
                from collective import gate as collective_gate
                collective_binding=collective_gate(self,m,m['observation'])
                if collective_binding is not None:
                    require(isinstance(m['checkpoint'],str) and json.loads(m['checkpoint']).get('collective')==collective_binding,'collective checkpoint source changed; prepare a new checkpoint')
                from organization import gate as organization_gate, completion as organization_completion, latest_required
                organization_binding=organization_gate(self,m)
                if organization_binding is not None:
                    latest_required(self,m,m['observation'])
                    require(isinstance(m['checkpoint'],str) and json.loads(m['checkpoint']).get('organization')==organization_binding,'organization checkpoint source changed; prepare a new checkpoint')
                    event_data['organization']=organization_completion(self,m,organization_binding)
                require(m['lease_until']>time.time() and self._obs_ok(m,m['observation']),'review requires a fresh confirmed observation')
            self._fence(m);m=self._event(m,'accepted' if kind=='accept' else 'cancelled',pid,event_data,phase='closed' if kind=='accept' else 'cancelled',lease_hash=None,lease_until=None)
            self.db.execute("UPDATE tasks SET status=?,answer=? WHERE id=?",('completed' if kind=='accept' else 'cancelled',note,m['id']))
            return self._record(p,m,req)
        raise PermissionError('continuity route unavailable to credential')
