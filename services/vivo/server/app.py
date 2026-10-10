"""Authoritative, capability-gated WebSocket rooms with SQLite checkpoints.

Single process by design. Run behind trusted HTTPS; never scale replicas against
independent SQLite files. Invite links are bearer capabilities, not verified human
identities. No camera frames or raw gaze observations are accepted by this API.
"""
from __future__ import annotations
import asyncio, copy, hashlib, hmac, json, math, os, re, secrets, sqlite3, time
from pathlib import Path
from urllib.parse import urlsplit
from collections import defaultdict, deque
import numpy as np
from aiohttp import web, WSMsgType
from .geometry import Geometry, vec
from .adaptive import RoomRule, Guidance
from .reference import HyperBall
from .config import normalize_origin, public_origin
from .readiness import inspect_assets, report as readiness_report

ROOT=Path(__file__).resolve().parents[1]
ID=re.compile(r'^[A-Za-z0-9_-]{1,80}$')

def dumps(x):return json.dumps(x,separators=(',',':'),allow_nan=False)
def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def token():return secrets.token_urlsafe(32)
def require(ok,message):
    if not ok:raise ValueError(message)
def finite(x,low=-100,high=100):
    require(type(x) in (int,float) and math.isfinite(x) and low<=x<=high,'Invalid numeric value');return float(x)

class Store:
    def __init__(self,path):
        self.db=sqlite3.connect(str(path));self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,state TEXT NOT NULL,updated REAL);
        CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY,room TEXT,role TEXT,expires REAL);
        CREATE TABLE IF NOT EXISTS events(room TEXT,seq INTEGER,kind TEXT,actor TEXT,payload TEXT,state TEXT,created REAL,PRIMARY KEY(room,seq));
        CREATE TABLE IF NOT EXISTS receipts(room TEXT,credential TEXT,id TEXT,bodyhash TEXT,response TEXT,PRIMARY KEY(room,credential,id));''')
        self.db.commit()
    def grant(self,room,role,lifetime=86400):
        value=token();self.db.execute('INSERT INTO tokens VALUES(?,?,?,?)',(digest(value),room,role,time.time()+lifetime));self.db.commit();return value
    def auth(self,room,value):
        require(isinstance(value,str) and len(value)<200,'Invalid invitation')
        row=self.db.execute('SELECT role,expires FROM tokens WHERE hash=? AND room=?',(digest(value),room)).fetchone()
        require(row is not None and row[1]>time.time(),'Invitation expired, revoked or invalid')
        return row[0]
    def persist(self,room,kind,actor,payload,receipt=None):
        state=dumps(room.snapshot());now=time.time()
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO rooms VALUES(?,?,?)',(room.id,state,now))
            self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?)',(room.id,room.sequence,kind,actor,dumps(payload),state,now))
            if receipt:self.db.execute('INSERT INTO receipts VALUES(?,?,?,?,?)',(room.id,*receipt))
            # Bounded retained history; sequence never rewinds. User can export earlier.
            self.db.execute('DELETE FROM events WHERE room=? AND seq < ?',(room.id,room.sequence-300))
            self.db.execute('DELETE FROM receipts WHERE room=? AND rowid NOT IN (SELECT rowid FROM receipts WHERE room=? ORDER BY rowid DESC LIMIT 1200)',(room.id,room.id))

class Room:
    def __init__(self,id,geometry,rule,name='Shared workshop',seed=None):
        self.id,self.name,self.geometry=id,name,geometry;self.rule=rule
        self.grid=geometry.sample_grid();self.guide=Guidance(geometry,self.grid,rule)
        d=geometry.d
        self.entities={}
        for i,label in enumerate(['Relic','Workpiece','Portal marker']):
            q=np.zeros(d);q[:3]=[-1.2+i*1.15,.25+(-1)**i*.4,.25]
            p,_=geometry.canonical(q)
            self.entities['relic-'+str(i)]={'id':'relic-'+str(i),'name':label,'q':p.q.tolist(),'chart':p.chart,'radius':.25,'revision':0,'source':None}
        if seed:
            require(geometry.kind=='flat','Publish existing objects only to a flat space; use explicit transport for curved spaces')
            require(isinstance(seed,list) and 0<len(seed)<=32,'Publish 1–32 named objects')
            ents={}
            for e in seed:
                name=e.get('id');require(isinstance(name,str) and ID.fullmatch(name),'Invalid source object identity')
                require(name not in ents,'Duplicate source identity')
                q=vec(e.get('q'),d);p,_=geometry.canonical(q)
                ents[name]={'id':name,'name':str(e.get('name','Object'))[:48],'q':p.q.tolist(),'chart':p.chart,'radius':finite(e.get('radius',.25),.02,2),'revision':0,'source':e.get('source') if isinstance(e.get('source'),str) else None}
            self.entities=ents
        self.sequence=0;self.leases={};self.sessions={};self.observer_history={};self.updated=False
    def snapshot(self):
        return {'schema':'viva-shared/1','room':self.id,'name':self.name,'geometry':self.geometry.describe(),'sequence':self.sequence,
                'entities':copy.deepcopy(self.entities),'guide':self.guide.state(),'observers':copy.deepcopy(self.observer_history)}
    @classmethod
    def restore(cls,s,rule):
        g=s['geometry'];r=cls(s['room'],Geometry(g['kind'],g['dimension'],g.get('metric')),rule,s['name'])
        r.entities=s['entities'];r.sequence=s['sequence'];r.guide.restore(s['guide']);r.observer_history=s.get('observers',{});return r
    def public(self,grid=False):
        s=self.snapshot();s['leases']={k:{'actor':v['actor'],'expires':v['expires']} for k,v in self.leases.items()}
        s['participants']=[{'id':sid,'name':x['name'],'role':x['role'],'observer':x.get('observer')} for sid,x in self.sessions.items()]
        if grid:s['grid']=self.grid
        return s

class Hub:
    def __init__(self,db,origin=None,create_key=None):
        self.store=Store(db);self.rule=RoomRule();self.rooms={};self.origin=normalize_origin(origin);self.create_key=create_key;self.rate=defaultdict(deque);self.task=None
    def room(self,id):
        if id not in self.rooms:
            row=self.store.db.execute('SELECT state FROM rooms WHERE id=?',(id,)).fetchone();require(row is not None,'No such room')
            self.rooms[id]=Room.restore(json.loads(row[0]),self.rule)
        return self.rooms[id]
    def check_rate(self,key,limit,seconds):
        now=time.monotonic();q=self.rate[key]
        while q and q[0]<now-seconds:q.popleft()
        require(len(q)<limit,'Too many requests; pause and retry');q.append(now)
        if len(self.rate)>5000:
            for k in list(self.rate):
                if not self.rate[k] or self.rate[k][-1]<now-120:del self.rate[k]
    def origin_ok(self,request):
        origin=request.headers.get('Origin')
        allowed=self.origin or (request.scheme+'://'+request.host)
        return not origin or origin==allowed
    async def send(self,ws,obj):
        try:await asyncio.wait_for(ws.send_str(dumps(obj)),timeout=2)
        except (ConnectionError,RuntimeError,asyncio.TimeoutError):await ws.close(code=1013,message=b'Slow client; reconnect for current state')
    async def broadcast(self,r,grid=False):
        message={'type':'state','state':r.public(grid)}
        await asyncio.gather(*(self.send(x['ws'],message) for x in list(r.sessions.values())),return_exceptions=True)
    def commit(self,r,kind,actor,payload,receipt=None):
        r.sequence+=1;self.store.persist(r,kind,actor,payload,receipt)
    async def loop(self):
        checkpoint=0
        while True:
            await asyncio.sleep(.12);checkpoint+=1
            for r in list(self.rooms.values()):
                if not r.sessions:continue
                now=time.time()
                for session in list(r.sessions.values()):
                    if session['expires']<=now:
                        await session['ws'].close(code=1008,message=b'Invitation expired')
                lost=[id for id,l in r.leases.items() if l['expires']<=now]
                for id in lost:del r.leases[id]
                if lost:self.commit(r,'lease-expired','server',{'entities':lost})
                changed=r.guide.step(3)
                if changed:r.updated=True
                if checkpoint%16==0 and r.updated:
                    self.commit(r,'field-checkpoint','server',{'tick':r.guide.tick,'model':r.rule.version})
                    r.updated=False
                # Slow presence heartbeat remains; no endless dense idle-field broadcasts.
                if changed or lost or checkpoint%16==0:await self.broadcast(r)
    async def create(self,request):
        self.check_rate('create:'+(request.remote or '?'),10,60)
        require(self.origin_ok(request),'Origin not allowed')
        data=await request.json(loads=lambda s:json.loads(s,parse_constant=lambda x:(_ for _ in ()).throw(ValueError('Nonfinite JSON'))))
        require(isinstance(data,dict),'Expected JSON object')
        if self.create_key:require(hmac.compare_digest(str(data.get('createKey','')),self.create_key),'Server creation key required')
        count=self.store.db.execute('SELECT COUNT(*) FROM rooms').fetchone()[0];require(count<64,'Server room capacity reached')
        d=data.get('dimension',4);g=Geometry(data.get('geometry','flat'),d,data.get('metric'))
        name=data.get('name','Shared workshop');require(isinstance(name,str) and 1<=len(name)<=60,'Room name must be 1–60 characters')
        r=Room(secrets.token_urlsafe(12),g,self.rule,name,data.get('entities'));self.rooms[r.id]=r
        self.commit(r,'created','owner',{'dimension':d,'geometry':g.kind})
        owner=self.store.grant(r.id,'owner',30*86400)
        return web.json_response({'room':r.id,'token':owner,'role':'owner','expires_days':30})
    def request_auth(self,request):
        value=request.headers.get('Authorization','');require(value.startswith('Bearer '),'Invitation required')
        id=request.match_info['room'];role=self.store.auth(id,value[7:]);return self.room(id),role
    async def history(self,request):
        r,role=self.request_auth(request)
        rows=self.store.db.execute('SELECT seq,kind,actor,payload,state,created FROM events WHERE room=? ORDER BY seq',(r.id,)).fetchall()
        return web.json_response({'schema':'viva-history/1','retention':'latest 301 checkpoints/accepted events','firstSequence':rows[0][0] if rows else None,
          'events':[{'sequence':a,'kind':b,'actor':c,'payload':json.loads(d),'state':json.loads(e),'created':f} for a,b,c,d,e,f in rows]})
    async def export(self,request):
        r,_=self.request_auth(request);return web.json_response(r.snapshot())
    async def invite(self,request):
        require(self.origin_ok(request),'Origin not allowed');r,role=self.request_auth(request);require(role=='owner','Only the owner can issue invitations')
        data=await request.json();target=data.get('role','editor');require(target in ('editor','viewer'),'Choose editor or viewer')
        value=self.store.grant(r.id,target,86400)
        return web.json_response({'room':r.id,'token':value,'role':target,'expires_hours':24})
    async def revoke(self,request):
        require(self.origin_ok(request),'Origin not allowed');r,role=self.request_auth(request);require(role=='owner','Only the owner can revoke invitations')
        with self.store.db:self.store.db.execute('DELETE FROM tokens WHERE room=? AND role != ?',(r.id,'owner'))
        for x in list(r.sessions.values()):
            if x['role']!='owner':await x['ws'].close(code=1008,message=b'Invitation revoked')
        return web.json_response({'revoked':True})
    async def socket(self,request):
        require(self.origin_ok(request),'Origin not allowed')
        ws=web.WebSocketResponse(max_msg_size=32768,heartbeat=20,compress=False)
        await ws.prepare(request);r=None;actor=None
        try:
            first=await asyncio.wait_for(ws.receive_json(),8)
            require(isinstance(first,dict) and first.get('type')=='join','Explicit join required')
            rid=first.get('room');require(isinstance(rid,str) and ID.fullmatch(rid),'Invalid room')
            credential=first.get('token','');role=self.store.auth(rid,credential);key=digest(credential)
            r=self.room(rid);require(len(r.sessions)<12,'This room is full')
            actor=secrets.token_urlsafe(9);name=first.get('name','Guest');require(isinstance(name,str) and 1<=len(name)<=32,'Name must be 1–32 characters')
            r.sessions[actor]={'ws':ws,'name':name,'role':role,'observer':None,'credential':key,'expires':self.store.db.execute('SELECT expires FROM tokens WHERE hash=?',(key,)).fetchone()[0]}
            await self.send(ws,{'type':'joined','actor':actor,'role':role,'state':r.public(True)})
            await self.broadcast(r)
            async for raw in ws:
                if raw.type!=WSMsgType.TEXT:
                    if raw.type==WSMsgType.ERROR:break
                    continue
                msg={}
                try:
                    self.check_rate('socket:'+actor,80,1)
                    msg=json.loads(raw.data,parse_constant=lambda x:(_ for _ in ()).throw(ValueError('Invalid nonfinite JSON')))
                    require(isinstance(msg,dict),'Expected an object')
                    # Revalidate revocation/expiry on every command, not just at join.
                    self.store.auth(r.id,credential)
                    if msg.get('type') in ('presence','observer_move'):
                        if msg['type']=='presence':
                            q=vec(msg.get('q'),r.geometry.d);p,_=r.geometry.canonical(q,chart=msg.get('chart','a'))
                        else:
                            axis=msg.get('axis');require(type(axis)is int and 0<=axis<r.geometry.d,'Choose an active spatial axis')
                            old=r.sessions[actor].get('observer') or {'q':[0.]*r.geometry.d,'chart':'a'}
                            direction=np.zeros(r.geometry.d);direction[axis]=1
                            p=r.geometry.move(old['q'],direction,finite(msg.get('distance'),-.5,.5),old['chart'])
                        observer={'q':p.q.tolist(),'chart':p.chart}
                        r.sessions[actor]['observer']=observer
                        r.observer_history[actor]={'name':r.sessions[actor]['name'],**observer}
                        while len(r.observer_history)>32:del r.observer_history[next(iter(r.observer_history))]
                        if msg['type']=='observer_move':await self.send(ws,{'type':'observer','id':msg.get('id'),'observer':observer})
                        continue
                    if msg.get('type')=='lease_renew':
                        require(role in ('owner','editor'),'Viewer has no edit capability')
                        eid=msg.get('entity');lease=r.leases.get(eid)
                        require(lease is not None and lease['actor']==actor and lease['expires']>time.time(),
                                'No active grab owned by this participant')
                        lease['expires']=time.time()+5
                        await self.send(ws,{'type':'lease','entity':eid,'expires':lease['expires']})
                        continue
                    if msg.get('type')=='ping':await self.send(ws,{'type':'pong','sent':msg.get('sent')});continue
                    require(msg.get('type')=='command','Unknown message')
                    response=self.command(r,actor,role,key,msg)
                    await self.send(ws,response);await self.broadcast(r)
                except (ValueError,TypeError,KeyError,ArithmeticError,np.linalg.LinAlgError) as e:
                    await self.send(ws,{'type':'error','id':msg.get('id') if isinstance(msg,dict) else None,'message':str(e)[:180]})
        except (ValueError,TypeError,KeyError,asyncio.TimeoutError) as e:
            await self.send(ws,{'type':'error','message':str(e)[:180]});await ws.close(code=1008)
        finally:
            if r is not None and actor in r.sessions:
                del r.sessions[actor];released=[id for id,l in r.leases.items() if l['actor']==actor]
                for id in released:del r.leases[id]
                if released:self.commit(r,'disconnected-release',actor,{'entities':released})
                await self.broadcast(r)
        return ws
    def command(self,r,actor,role,key,msg):
        require(role in ('owner','editor'),'Viewer has no edit capability')
        nonce=msg.get('id');require(isinstance(nonce,str) and ID.fullmatch(nonce),'Command ID required')
        bodyhash=digest(dumps(msg));old=self.store.db.execute('SELECT bodyhash,response FROM receipts WHERE room=? AND credential=? AND id=?',(r.id,key,nonce)).fetchone()
        if old:
            require(old[0]==bodyhash,'Command ID reused with a different payload');return json.loads(old[1])
        op=msg.get('op');before=r.snapshot();leases=copy.deepcopy(r.leases)
        try:
            if op in ('grab','move','release'):
                eid=msg.get('entity');require(eid in r.entities,'Unknown entity');e=r.entities[eid];lease=r.leases.get(eid)
                if lease and lease['expires']<=time.time():r.leases.pop(eid);lease=None
                if op=='grab':
                    require(not lease or lease['actor']==actor,'Object is held by another collaborator')
                    r.leases[eid]={'actor':actor,'expires':time.time()+5}
                elif op=='release':
                    require(not lease or lease['actor']==actor,'You do not hold this object');r.leases.pop(eid,None)
                else:
                    require(lease and lease['actor']==actor,'Grab this object before moving it')
                    require(type(msg.get('expected'))is int and msg['expected']==e['revision'],'Stale object revision; reconcile before retry')
                    axis=msg.get('axis');direction=np.zeros(r.geometry.d)
                    if axis is not None:
                        require(type(axis)is int and 0<=axis<r.geometry.d,'Choose an active spatial axis');direction[axis]=1
                    else:direction=vec(msg.get('direction'),r.geometry.d)
                    distance=finite(msg.get('distance'),-.5,.5)
                    p=r.geometry.move(e['q'],direction,distance,e['chart'])
                    # Exact full-D sphere overlap rejection in the flat test world.
                    if r.geometry.kind=='flat':
                        target=HyperBall(eid,p.q,e['radius'])
                        for oid,o in r.entities.items():
                            if oid!=eid:require(not target.overlaps(HyperBall(oid,np.array(o['q']),o['radius'])),'Contact with '+o['name']+' in full-dimensional space')
                    e['q']=p.q.tolist();e['chart']=p.chart;e['revision']+=1;lease['expires']=time.time()+5
            elif op=='goal':
                i=msg.get('cell');require(type(i)is int and 0<=i<r.guide.n and i not in r.guide.blocked,'Invalid guide destination');r.guide.goal=i;r.guide.rebuild()
            elif op=='block':
                i=msg.get('cell');require(type(i)is int and 0<=i<r.guide.n and i!=r.guide.goal,'Invalid blocked cell')
                if i in r.guide.blocked:r.guide.blocked.remove(i)
                else:r.guide.blocked.add(i)
                r.guide.rebuild()
            elif op=='crowd':
                i=msg.get('cell');require(type(i)is int and 0<=i<r.guide.n,'Invalid cell');r.guide.features[i,1]=finite(msg.get('value'),0,1);r.guide.rebuild()
            elif op=='model':
                require(role=='owner','Only the owner can change the running rule')
                mode=msg.get('mode');require(mode in ('learned','analytic','off'),'Unknown rule mode');r.guide.mode=mode;r.guide.rebuild()
            elif op=='checkpoint':pass
            else:raise ValueError('Unknown operation')
            response={'type':'ack','id':nonce,'op':op,'sequence':r.sequence+1}
            if msg.get('entity') in r.entities:response['entity']=copy.deepcopy(r.entities[msg['entity']])
            r.sequence+=1;self.store.persist(r,op,actor,{k:v for k,v in msg.items() if k not in ('token',)},(key,nonce,bodyhash,dumps(response)))
            return response
        except Exception:
            restored=Room.restore(before,self.rule);r.entities=restored.entities;r.sequence=before['sequence'];r.guide=restored.guide;r.leases=leases
            raise

@web.middleware
async def security(request,handler):
    try:response=await handler(request)
    except web.HTTPException as e:response=e
    except (ValueError,TypeError,KeyError,SyntaxError,ArithmeticError,np.linalg.LinAlgError,json.JSONDecodeError) as e:response=web.json_response({'error':str(e)[:180]},status=400)
    response.headers['X-Content-Type-Options']='nosniff';response.headers['Referrer-Policy']='no-referrer';response.headers['Cache-Control']='no-store'
    response.headers['Permissions-Policy']='camera=(self), microphone=(), geolocation=()'
    response.headers['X-Frame-Options']='SAMEORIGIN'
    # Existing 0.7 uses inline scripts/styles and same-origin blob workers. No external origins.
    response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'"
    if request.path in ('/studio.html','/studio-original.html'):
        # Retained legacy head-pointer mode explicitly downloads its original assets.
        response.headers['Content-Security-Policy']=response.headers['Content-Security-Policy'].replace("'wasm-unsafe-eval' blob:","'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net").replace("connect-src 'self' ws: wss:","connect-src 'self' ws: wss: https://cdn.jsdelivr.net https://storage.googleapis.com")
    return response

def make_app(db=None,origin=None,create_key=None):
    db=db or os.getenv('VIVA_DB',str(ROOT/'data'/'viva.sqlite'));Path(db).parent.mkdir(parents=True,exist_ok=True)
    require(not Path(db).resolve().is_relative_to((ROOT/'web').resolve()),'Database must be outside the web directory')
    hub=Hub(db,origin or public_origin(),create_key or os.getenv('VIVA_CREATE_KEY'))
    app=web.Application(middlewares=[security],client_max_size=64*1024);app['hub']=hub
    async def health(req):return web.json_response({'ok':True,'release':'0.8.1','model':hub.rule.version,'creationKeyRequired':bool(hub.create_key),'persistence':'SQLite, single process','cameraFramesUploaded':False})
    assets=inspect_assets(ROOT)
    async def ready(req):
        data=readiness_report(hub,ROOT,assets)
        return web.json_response(data,status=200 if data['ok'] else 503)
    app.router.add_get('/readyz',ready)
    app.router.add_get('/health',health);app.router.add_post('/api/rooms',hub.create)
    app.router.add_get('/api/rooms/{room}/history',hub.history);app.router.add_get('/api/rooms/{room}/export',hub.export)
    app.router.add_post('/api/rooms/{room}/invite',hub.invite);app.router.add_post('/api/rooms/{room}/revoke',hub.revoke)
    app.router.add_get('/ws',hub.socket)
    async def index(req):return web.FileResponse(ROOT/'web'/'index.html')
    app.router.add_get('/',index);app.router.add_static('/',ROOT/'web',show_index=False,follow_symlinks=False)
    async def start(app):hub.task=asyncio.create_task(hub.loop())
    async def stop(app):
        hub.task.cancel()
        try:await hub.task
        except asyncio.CancelledError:pass
        for r in hub.rooms.values():
            hub.commit(r,'server-checkpoint','server',{})
            for x in list(r.sessions.values()):await x['ws'].close(code=1001,message=b'Server shutting down')
        hub.store.db.close()
    app.on_startup.append(start);app.on_shutdown.append(stop)
    return app
