"""Release checks. TLS tests use verified certificates and real TCP WSS clients.
They are not public internet or native mobile browser tests.
"""
import asyncio,copy,importlib,json,os,ssl,subprocess,tempfile,time,unittest,uuid
from pathlib import Path
from unittest.mock import patch
import numpy as np
from aiohttp import web,ClientSession,WSMsgType,WSServerHandshakeError
from server.app import make_app,ROOT
from server.config import normalize_origin,validate_network_settings,public_origin
from server.readiness import inspect_assets,report
from server.geometry import Geometry
from server.adaptive import RoomRule,Guidance

class ConfigurationTests(unittest.TestCase):
 def test_https_normalization(self):self.assertEqual(normalize_origin('https://viva.example/'),'https://viva.example')
 def test_no_credential_origin(self):
  with self.assertRaises(ValueError):normalize_origin('https://user:pass@viva.example')
 def test_no_path_origin(self):
  with self.assertRaises(ValueError):normalize_origin('https://viva.example/field')
 def test_no_http_public(self):
  with self.assertRaises(ValueError):normalize_origin('http://viva.example')
 def test_no_query_origin(self):
  with self.assertRaises(ValueError):normalize_origin('https://viva.example?x=1')
 def test_local_http_allowed(self):self.assertEqual(normalize_origin('http://localhost:8765'),'http://localhost:8765')
 def test_missing_public_origin(self):
  with self.assertRaisesRegex(ValueError,'VIVA_PUBLIC_ORIGIN'):validate_network_settings('0.0.0.0',None,'x'*40,'/data/viva.sqlite',ROOT/'web')
 def test_short_public_key(self):
  with self.assertRaisesRegex(ValueError,'VIVA_CREATE_KEY'):validate_network_settings('0.0.0.0','https://viva.example','short','/data/viva.sqlite',ROOT/'web')
 def test_sample_public_key(self):
  with self.assertRaises(ValueError):validate_network_settings('0.0.0.0','https://viva.example','REPLACE_WITH_A_LONG_RANDOM_SECRET','/data/viva.sqlite',ROOT/'web')
 def test_db_not_in_web(self):
  with self.assertRaises(ValueError):validate_network_settings('127.0.0.1',None,None,ROOT/'web/private.sqlite',ROOT/'web')
 def test_safe_public_settings(self):self.assertEqual(validate_network_settings('0.0.0.0','https://viva.example','random-test-value-'*3,'/data/viva.sqlite',ROOT/'web'),'https://viva.example')
 def test_railway_domain(self):
  with patch.dict(os.environ,{'RAILWAY_PUBLIC_DOMAIN':'viva.example','VIVA_PUBLIC_ORIGIN':''}):self.assertEqual(public_origin(),'https://viva.example')
 def test_explicit_origin_takes_priority(self):
  with patch.dict(os.environ,{'RAILWAY_PUBLIC_DOMAIN':'other.example','VIVA_PUBLIC_ORIGIN':'https://viva.example'}):self.assertEqual(public_origin(),'https://viva.example')
 def test_real_probe_import_has_no_side_effect(self):
  before=(ROOT/'reports/real-model.json').exists();importlib.import_module('tests.test_real_model');self.assertEqual((ROOT/'reports/real-model.json').exists(),before)
 def test_all_required_assets(self):self.assertEqual(inspect_assets(ROOT)['missingAssets'],[])
 def test_missing_assets_are_not_ready(self):
  with tempfile.TemporaryDirectory() as d:self.assertFalse(inspect_assets(d)['assetsPresent'])
 def test_cli_refuses_public_missing_origin(self):
  env={k:v for k,v in os.environ.items() if k not in ('VIVA_PUBLIC_ORIGIN','RAILWAY_PUBLIC_DOMAIN','VIVA_CREATE_KEY')}
  p=subprocess.run(['python','-m','server','--host','0.0.0.0'],cwd=ROOT,env=env,text=True,capture_output=True,timeout=5)
  self.assertNotEqual(p.returncode,0);self.assertIn('VIVA_PUBLIC_ORIGIN',p.stderr)
 def test_old_studio_bytes_unchanged(self):
  import hashlib
  self.assertEqual(hashlib.sha256((ROOT/'web/studio-original.html').read_bytes()).hexdigest(),'fac4d035e277e54e64c381dd808586a3d07b78c2dbef95fed3e2f8956128332e')


class SettledFieldTests(unittest.TestCase):
 def new(self):
  g=Geometry('flat',4);return Guidance(g,g.sample_grid(),RoomRule())
 def test_settles(self):
  f=self.new();f.step(500);self.assertTrue(f.converged)
 def test_idle_stops_work(self):
  f=self.new();f.step(500);before=f.tick;self.assertFalse(f.step(500));self.assertEqual(f.tick,before)
 def test_changed_goal_wakes(self):
  f=self.new();f.step(500);f.goal=0;f.rebuild();self.assertFalse(f.converged);self.assertTrue(f.step(3))
 def test_obstacle_wakes_and_blocks(self):
  f=self.new();f.step(500);f.blocked.add(15);f.rebuild();f.step(500);self.assertTrue(f.converged);self.assertEqual(f.dist[15],np.inf)
 def test_settled_checkpoint_restores(self):
  f=self.new();f.step(500);s=f.state();g=self.new();g.restore(s);self.assertTrue(g.converged);self.assertFalse(g.step(10));self.assertEqual(s['potential'],g.state()['potential'])

class TLSWorkshopTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  key=self.root/'key.pem';cert=self.root/'cert.pem'
  subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  self.server_tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);self.server_tls.load_cert_chain(cert,key)
  self.client_tls=ssl.create_default_context(cafile=str(cert));self.clients=[]
  self.http=ClientSession();await self.start()
 async def start(self):
  self.app=make_app(self.root/'world.sqlite',create_key='test-key-only-not-production')
  self.runner=web.AppRunner(self.app);await self.runner.setup()
  self.site=web.TCPSite(self.runner,'127.0.0.1',0,ssl_context=self.server_tls);await self.site.start()
  self.base='https://127.0.0.1:'+str(self.site._server.sockets[0].getsockname()[1]);self.app['hub'].origin=self.base
 async def asyncTearDown(self):
  for ws in self.clients:await ws.close()
  await self.http.close();await self.runner.cleanup();self.tmp.cleanup()
 async def create(self):
  async with self.http.post(self.base+'/api/rooms',json={'createKey':'test-key-only-not-production','dimension':11},headers={'Origin':self.base},ssl=self.client_tls) as r:
   self.assertEqual(r.status,200);return await r.json()
 async def invite(self,c):
  async with self.http.post(self.base+'/api/rooms/'+c['room']+'/invite',json={'role':'editor'},headers={'Authorization':'Bearer '+c['token'],'Origin':self.base},ssl=self.client_tls) as r:
   self.assertEqual(r.status,200);return await r.json()
 async def recv(self,ws,typ,id=None):
  async def wait():
   async for raw in ws:
    if raw.type!=WSMsgType.TEXT:continue
    m=json.loads(raw.data)
    if m.get('type')==typ and (id is None or m.get('id')==id):return m
   raise AssertionError('Connection ended before '+typ)
  return await asyncio.wait_for(wait(),4)
 async def join(self,c):
  ws=await self.http.ws_connect(self.base+'/ws',headers={'Origin':self.base},ssl=self.client_tls);self.clients.append(ws)
  await ws.send_json({'type':'join','room':c['room'],'token':c['token'],'name':'TLS collaborator'})
  return ws,await self.recv(ws,'joined')
 async def command(self,ws,op,**args):
  id=str(uuid.uuid4());await ws.send_json({'type':'command','id':id,'op':op,**args});return await self.recv(ws,'ack',id)
 async def test_real_tls_readiness(self):
  async with self.http.get(self.base+'/readyz',ssl=self.client_tls) as r:
   text=await r.text();d=json.loads(text);self.assertEqual(r.status,200);self.assertTrue(d['ok']);self.assertFalse(d['deviceValidated']);self.assertNotIn('test-key-only',text)
 async def test_https_two_wss_clients_share_x11(self):
  c=await self.create();a,_=await self.join(c);b,_=await self.join(await self.invite(c))
  await self.command(a,'grab',entity='relic-0');result=await self.command(a,'move',entity='relic-0',expected=0,axis=10,distance=.24)
  for _ in range(20):
   m=await self.recv(b,'state')
   if m['state']['entities']['relic-0']['revision']==1:break
  self.assertEqual(result['entity']['q'],m['state']['entities']['relic-0']['q']);self.assertEqual(result['entity']['q'][10],.24)
 async def test_cross_origin_wss_denied(self):
  with self.assertRaises(WSServerHandshakeError):await self.http.ws_connect(self.base+'/ws',headers={'Origin':'https://attacker.example'},ssl=self.client_tls)
 async def test_motionless_grab_renewal(self):
  c=await self.create();a,j=await self.join(c);await self.command(a,'grab',entity='relic-0');room=self.app['hub'].room(c['room']);before=copy.deepcopy(room.entities)
  room.leases['relic-0']['expires']=time.time()+.2
  await a.send_json({'type':'lease_renew','entity':'relic-0'});m=await self.recv(a,'lease')
  self.assertGreater(m['expires'],time.time()+4);self.assertEqual(before,room.entities);self.assertEqual(room.leases['relic-0']['actor'],j['actor'])
 async def test_other_person_cannot_renew_grab(self):
  c=await self.create();a,_=await self.join(c);b,_=await self.join(await self.invite(c));await self.command(a,'grab',entity='relic-0')
  await b.send_json({'type':'lease_renew','entity':'relic-0'});m=await self.recv(b,'error');self.assertIn('owned',m['message'])
 async def test_expired_lease_not_resurrected(self):
  c=await self.create();a,_=await self.join(c);await self.command(a,'grab',entity='relic-0');self.app['hub'].room(c['room']).leases['relic-0']['expires']=time.time()-1
  await a.send_json({'type':'lease_renew','entity':'relic-0'});m=await self.recv(a,'error');self.assertIn('active grab',m['message'])
 async def test_tls_server_restart_persists(self):
  c=await self.create();a,_=await self.join(c);await self.command(a,'grab',entity='relic-0');await self.command(a,'move',entity='relic-0',expected=0,axis=10,distance=.24);await a.close();await self.runner.cleanup();await self.start()
  b,j=await self.join(c);self.assertEqual(j['state']['entities']['relic-0']['q'][10],.24);self.assertEqual(j['state']['leases'],{})

 async def test_idle_expired_invitation_disconnects(self):
  c=await self.create();guest=await self.invite(c)
  from server.app import digest
  with self.app['hub'].store.db:self.app['hub'].store.db.execute('UPDATE tokens SET expires=? WHERE hash=?',(time.time()+1,digest(guest['token'])))
  ws,j=await self.join(guest)
  async def wait_close():
   while True:
    m=await ws.receive()
    if m.type in (WSMsgType.CLOSE,WSMsgType.CLOSED,WSMsgType.ERROR):return
  await asyncio.wait_for(wait_close(),3)
  self.assertEqual(ws.close_code,1008)
