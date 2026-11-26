"""Vivo Agent Station v0.3: local, provider-neutral durable action broker.
The browser's native tool registry remains authoritative. No provider calls.
"""
import argparse, hashlib, hmac, json, os, secrets, sqlite3, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from memory_port import CAP as MEMORY_CAP, ApolloMissionPort, MemoryGrants
from continuity import CAP as CONTINUITY_CAP, Continuity

CAPS={'vivo.world.read':'world.read','vivo.world.edit':'world.edit'}
MAX_BODY=262144
LEASE=60

def fail(msg): raise ValueError(msg)
def digest(s): return hashlib.sha256(s.encode()).hexdigest()
def canonical(x): return json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False)
def token(): return secrets.token_urlsafe(32)
def bounded(s,n=128):
    if not isinstance(s,str) or not s.strip() or len(s)>n or any(ord(c)<32 for c in s): fail('invalid string')
    return s

def validate(tool,args,world,request_id):
    if tool not in CAPS or not isinstance(args,dict): fail('unsupported tool or arguments')
    if tool=='vivo.world.read':
        if args: fail('read takes no arguments')
        return {}
    required={'worldId','branchId','eyeId','spaceId','entityId','baseRevision','delta'}
    if set(args)!=required: fail('edit requires exact native scope, revision and delta; identity and geometry overrides prohibited')
    if args['worldId']!=world: fail('wrong world')
    for k in required-{'baseRevision','delta'}: bounded(args[k],256)
    r=args['baseRevision']; d=args['delta']
    if type(r) is not int or r<0: fail('invalid base revision')
    if not isinstance(d,list) or not 3<=len(d)<=11 or any(type(x) not in (int,float) or not -5<=x<=5 for x in d): fail('invalid delta')
    return dict(args,operationId=request_id)

class Station:
    def __init__(self,path,memory=None):
        self.db=sqlite3.connect(path,check_same_thread=False,isolation_level=None);self.db.row_factory=sqlite3.Row;self.lock=threading.RLock()
        self.db.executescript('''PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS principals(id TEXT PRIMARY KEY,role TEXT,token_hash TEXT UNIQUE,world TEXT,label TEXT,caps TEXT,active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY,agent TEXT,world TEXT,request_id TEXT,tool TEXT,args TEXT,fingerprint TEXT,status TEXT,claim TEXT,deadline REAL,result TEXT,created REAL,updated REAL,UNIQUE(agent,request_id));
        CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,agent TEXT,text TEXT,status TEXT,answer TEXT,created REAL);
        CREATE TABLE IF NOT EXISTS presence(world TEXT PRIMARY KEY,last_seen REAL,host TEXT);
        ''')
        self.memory=MemoryGrants(self,memory)
        self.continuity=Continuity(self)
    def enroll(self,role,label,world='',caps=()):
        if role not in ('owner','host','agent'): fail('invalid role')
        bounded(label,100)
        if role!='owner': bounded(world,256)
        if any(c not in (*CAPS.values(),MEMORY_CAP,CONTINUITY_CAP) for c in caps) or (any(c in caps for c in (MEMORY_CAP,CONTINUITY_CAP)) and role!='agent'): fail('invalid capability')
        if CONTINUITY_CAP in caps and 'world.read' not in caps:fail('continuity requires world.read')
        with self.lock:
            self.db.execute('BEGIN IMMEDIATE')
            try:
                if role=='host' and self.db.execute("SELECT 1 FROM principals WHERE role='host' AND world=? AND active=1",(world,)).fetchone(): fail('world already has an active host credential')
                key=token(); pid=uuid.uuid4().hex
                self.db.execute('INSERT INTO principals VALUES(?,?,?,?,?,?,1)',(pid,role,digest(key),world,label,canonical(sorted(set(caps)))))
                self.db.execute('COMMIT')
                return {'id':pid,'role':role,'world':world,'token':key,'capabilities':list(caps)}
            except BaseException:
                if self.db.in_transaction:self.db.execute('ROLLBACK')
                raise
    def auth(self,key,role=None):
        p=self.db.execute('SELECT * FROM principals WHERE token_hash=? AND active=1',(digest(key),)).fetchone()
        if not p or (role and p['role']!=role): raise PermissionError('invalid or insufficient credential')
        return p
    def expire(self):
        # Never automatically replay a potentially submitted mutation.
        self.db.execute("UPDATE actions SET status='uncertain',updated=? WHERE status='running' AND deadline<?",(time.time(),time.time()))
    def action(self,id):
        a=self.db.execute('SELECT * FROM actions WHERE id=?',(id,)).fetchone()
        if not a: fail('unknown action')
        return a
    def public(self,a):
        return {k:a[k] for k in ('id','agent','world','request_id','tool','status','created','updated')} | {'result':json.loads(a['result']) if a['result'] else None,'confirmed':a['status']=='completed'}
    def route(self,key,method,path,body):
        with self.lock:
            if path.startswith(('/v1/memory/','/v1/owner/memory/')):
                return self.memory.route(key,method,path,body)
            self.db.execute('BEGIN IMMEDIATE')
            try:
                p=self.auth(key)
                self.expire();self.continuity.expire()
                self.db.execute('SAVEPOINT requested_operation')
                if path.startswith(('/v1/continuity/','/v1/owner/continuity/')):
                    result=self.continuity.route(p,method,path,body)
                else:
                    result=self._legacy_route(p,method,path,body)
                self.db.execute('RELEASE requested_operation');self.db.execute('COMMIT');return result
            except BaseException:
                if self.db.in_transaction:
                    try:
                        self.db.execute('ROLLBACK TO requested_operation');self.db.execute('RELEASE requested_operation');self.db.execute('COMMIT')
                    except sqlite3.Error:
                        self.db.execute('ROLLBACK')
                raise
    def _legacy_route(self,p,method,path,body):
            role=p['role'];pid=p['id'];world=p['world'];caps=json.loads(p['caps'])
            if path=='/v1/info' and method=='GET':
                last=self.db.execute('SELECT last_seen FROM presence WHERE world=?',(world,)).fetchone()
                return {'id':pid,'role':role,'world':world,'label':p['label'],'capabilities':caps,'memory_available':self.memory.available(p),'continuity_available':role=='owner' or (CONTINUITY_CAP in caps and 'world.read' in caps),'host_online':bool(last and time.time()-last[0]<15)}
            if path=='/v1/actions' and method=='POST' and role=='agent':
                rid=bounded(body.get('request_id'),100);tool=body.get('tool');
                if rid.startswith('continuity-'):fail('reserved request identity prefix')
                if tool not in CAPS or CAPS[tool] not in caps: raise PermissionError('tool not granted')
                aid=uuid.uuid4().hex; raw=body.get('args',{});args=validate(tool,raw,world,'station-'+pid+'-'+rid);fp=digest(canonical([tool,args]))
                old=self.db.execute('SELECT * FROM actions WHERE agent=? AND request_id=?',(pid,rid)).fetchone()
                if old:
                    if old['fingerprint']!=fp: fail('request identity conflict')
                    return self.public(old)
                count=self.db.execute("SELECT count(*) FROM actions WHERE agent=? AND status IN ('queued','awaiting_approval','running')",(pid,)).fetchone()[0]
                if count>=32: fail('pending action limit')
                now=time.time();status='queued' if tool=='vivo.world.read' else 'awaiting_approval'
                self.db.execute('INSERT INTO actions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(aid,pid,world,rid,tool,canonical(args),fp,status,None,None,None,now,now));return self.public(self.action(aid))
            if path.startswith('/v1/actions/') and method=='GET':
                a=self.action(path.rsplit('/',1)[-1]);
                if role!='owner' and not(role=='agent' and a['agent']==pid): raise PermissionError('action not owned')
                return self.public(a)
            if path=='/v1/owner/actions' and role=='owner' and method=='GET':
                return [self.public(a)|{'args':json.loads(a['args'])} for a in self.db.execute('SELECT * FROM actions ORDER BY created DESC LIMIT 100')]
            if path=='/v1/owner/agents' and role=='owner' and method=='GET':
                return [{k:x[k] for k in ('id','role','world','label','active')}|{'capabilities':json.loads(x['caps'])} for x in self.db.execute("SELECT * FROM principals WHERE role!='owner'")]
            if path=='/v1/owner/decision' and role=='owner' and method=='POST':
                a=self.action(body.get('id'));decision=body.get('decision')
                if a['status']!='awaiting_approval' or decision not in ('approve','reject'): fail('not pending approval')
                self.db.execute('UPDATE actions SET status=?,updated=? WHERE id=?',('queued' if decision=='approve' else 'rejected',time.time(),a['id']));return self.public(self.action(a['id']))
            if path=='/v1/owner/stop' and role=='owner' and method=='POST':
                target=body.get('id');r=self.db.execute("SELECT * FROM principals WHERE id=? AND role='agent'",(target,)).fetchone()
                if not r: fail('unknown agent')
                self.db.execute('UPDATE principals SET active=0 WHERE id=?',(target,));self.continuity.expire();self.db.execute('UPDATE mission_memory_grants SET revoked=1 WHERE agent=?',(target,));self.db.execute("UPDATE actions SET status=CASE WHEN status='running' THEN 'uncertain' ELSE 'cancelled' END,updated=? WHERE agent=? AND status IN ('queued','awaiting_approval','running')",(time.time(),target));return {'stopped':target,'note':'Native stop is applied by connected host; submitted work may require reconciliation.'}
            if path=='/v1/host/poll' and role=='host' and method=='POST':
                if body.get('world')!=world: fail('wrong host world')
                self.db.execute('INSERT OR REPLACE INTO presence VALUES(?,?,?)',(world,time.time(),pid));
                stopped=[r[0] for r in self.db.execute("SELECT id FROM principals WHERE world=? AND role='agent' AND active=0",(world,))]
                ready=body.get('ready_agents',[])
                if not isinstance(ready,list) or len(ready)>16 or any(not isinstance(x,str) or len(x)>64 for x in ready):fail('invalid ready agent list')
                if not ready:return {'job':None,'stopped':stopped}
                placeholders=','.join('?' for _ in ready)
                a=self.db.execute("SELECT a.*,p.label,p.caps FROM actions a JOIN principals p ON p.id=a.agent WHERE a.world=? AND a.status='queued' AND p.active=1 AND a.agent IN ("+placeholders+") ORDER BY a.created LIMIT 1",(world,*ready)).fetchone()
                if not a:return {'job':None,'stopped':stopped}
                if not self.continuity.permit_observation_dispatch(a['id']):
                    self.db.execute("UPDATE actions SET status='cancelled',updated=? WHERE id=?",(time.time(),a['id']));return {'job':None,'stopped':stopped}
                claim=token();self.db.execute("UPDATE actions SET status='running',claim=?,deadline=?,updated=? WHERE id=?",(digest(claim),time.time()+LEASE,time.time(),a['id']))
                return {'job':{'id':a['id'],'agent':a['agent'],'label':a['label'],'capabilities':json.loads(a['caps']),'tool':a['tool'],'args':json.loads(a['args']),'claim':claim},'stopped':stopped}
            if path=='/v1/host/result' and role=='host' and method=='POST':
                a=self.action(body.get('id'))
                if a['world']!=world or not a['claim'] or not hmac.compare_digest(a['claim'],digest(str(body.get('claim','')))):raise PermissionError('wrong claim')
                if a['status']!='running':fail('action no longer running; reconcile manually')
                outcome=body.get('outcome');result=body.get('result')
                if outcome not in ('completed','rejected','uncertain'):fail('invalid outcome')
                # A native edit may be submitted but not accepted. Only explicit native acceptance counts.
                if outcome=='completed' and a['tool']=='vivo.world.edit' and not(isinstance(result,dict) and result.get('status')=='accepted'):fail('missing native acceptance receipt')
                if outcome=='completed' and a['tool']=='vivo.world.read' and not(isinstance(result,dict) and isinstance(result.get('snapshot'),dict) and result['snapshot'].get('worldId')==world):fail('missing scoped native snapshot')
                self.db.execute('UPDATE actions SET status=?,result=?,updated=? WHERE id=?',(outcome,canonical(result),time.time(),a['id']));return self.public(self.action(a['id']))
            if path=='/v1/owner/tasks' and role=='owner' and method=='POST':
                agent=body.get('agent');r=self.db.execute("SELECT id FROM principals WHERE role='agent' AND active=1 AND id=?",(agent,)).fetchone()
                if not r:fail('unknown agent');
                tid=uuid.uuid4().hex;msg=bounded(body.get('text'),8000);self.db.execute("INSERT INTO tasks VALUES(?,?,?,'pending',NULL,?)",(tid,agent,msg,time.time()));return {'id':tid,'status':'pending'}
            if path=='/v1/owner/tasks' and role=='owner' and method=='GET':return [dict(r) for r in self.db.execute('SELECT * FROM tasks WHERE id NOT IN (SELECT id FROM continuity_missions) ORDER BY created DESC LIMIT 100')]
            if path=='/v1/tasks' and role=='agent' and method=='GET':return [dict(r) for r in self.db.execute("SELECT * FROM tasks WHERE agent=? AND status IN ('pending','claimed') AND id NOT IN (SELECT id FROM continuity_missions) ORDER BY created LIMIT 32",(pid,))]
            if path=='/v1/tasks/claim' and role=='agent' and method=='POST':
                if self.continuity.is_managed(body.get('id')):raise PermissionError('use managed mission continuity protocol')
                r=self.db.execute('SELECT * FROM tasks WHERE id=? AND agent=?',(body.get('id'),pid)).fetchone()
                if not r or r['status'] not in ('pending','claimed'):fail('task unavailable')
                self.db.execute("UPDATE tasks SET status='claimed' WHERE id=?",(r['id'],));return dict(self.db.execute('SELECT * FROM tasks WHERE id=?',(r['id'],)).fetchone())
            if path=='/v1/tasks/reply' and role=='agent' and method=='POST':
                if self.continuity.is_managed(body.get('id')):raise PermissionError('use managed mission continuity protocol')
                r=self.db.execute('SELECT * FROM tasks WHERE id=? AND agent=?',(body.get('id'),pid)).fetchone();answer=bounded(body.get('answer'),8000)
                if not r or r['status'] not in ('claimed','completed'):fail('claim task first')
                if r['status']=='completed' and r['answer']!=answer:fail('reply conflict')
                self.db.execute("UPDATE tasks SET status='completed',answer=? WHERE id=?",(answer,r['id']));return {'id':r['id'],'status':'completed'}
            raise PermissionError('route not available to credential')

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*a):pass # avoid secrets and task text in access logs
    def respond(self,status,obj):
        data=canonical(obj).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)))
        if self.headers.get('Origin') in self.server.origins:self.send_header('Access-Control-Allow-Origin',self.headers['Origin']);self.send_header('Vary','Origin')
        self.end_headers();self.wfile.write(data)
    def host_allowed(self):
        return self.headers.get('Host') == '127.0.0.1:'+str(self.server.server_port)
    def do_OPTIONS(self):
        if not self.host_allowed():return self.respond(403,{'error':'host not allowed'})
        if self.headers.get('Origin') not in self.server.origins:return self.respond(403,{'error':'origin not allowed'})
        self.send_response(204);self.send_header('Access-Control-Allow-Origin',self.headers['Origin']);self.send_header('Access-Control-Allow-Headers','Authorization, Content-Type');self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS');self.send_header('Access-Control-Allow-Private-Network','true');self.end_headers()
    def request(self):
        try:
            if not self.host_allowed():raise PermissionError('host not allowed')
            if self.headers.get('Origin') and self.headers['Origin'] not in self.server.origins:raise PermissionError('origin not allowed')
            auth=self.headers.get('Authorization','');
            if not auth.startswith('Bearer '):raise PermissionError('bearer required')
            n=int(self.headers.get('Content-Length','0'))
            if not 0<=n<=MAX_BODY:fail('body too large')
            body=json.loads(self.rfile.read(n)) if n else {}
            if not isinstance(body,dict):fail('expected object')
            self.respond(200,self.server.station.route(auth[7:],self.command,urlparse(self.path).path,body))
        except PermissionError as e:self.respond(403,{'error':str(e)})
        except (ValueError,TypeError,KeyError) as e:self.respond(400,{'error':str(e)})
        except Exception:self.respond(500,{'error':'station failure; inspect local server'})
    do_GET=request;do_POST=request

def serve(st,port,origins):
    s=ThreadingHTTPServer(('127.0.0.1',port),Handler);s.station=st;s.origins=set(origins);return s

def main():
    p=argparse.ArgumentParser();p.add_argument('--db',default='station.sqlite');sub=p.add_subparsers(dest='cmd',required=True)
    e=sub.add_parser('enroll');e.add_argument('role',choices=['owner','host','agent']);e.add_argument('label');e.add_argument('--world',default='');e.add_argument('--cap',action='append',default=[])
    s=sub.add_parser('serve');s.add_argument('--port',type=int,default=18761);s.add_argument('--origin',action='append',default=[])
    s.add_argument('--memory',type=Path,help='existing NATIVE-01 Apollo JSON store')
    s.add_argument('--memory-world');s.add_argument('--memory-scope');s.add_argument('--memory-owner')
    a=p.parse_args();memory=None
    if a.cmd=='serve':
        values=(a.memory,a.memory_world,a.memory_scope,a.memory_owner)
        if any(values) and not all(values):p.error('memory requires all four explicit binding arguments')
        if all(values):memory=ApolloMissionPort(a.memory,world=a.memory_world,scope=a.memory_scope,owner=a.memory_owner)
    st=Station(a.db,memory=memory)
    if a.cmd=='enroll':print(json.dumps(st.enroll(a.role,a.label,a.world,a.cap),indent=2));return
    print(f'Vivo Agent Station listening on http://127.0.0.1:{a.port}',flush=True);serve(st,a.port,a.origin).serve_forever()
if __name__=='__main__':main()
