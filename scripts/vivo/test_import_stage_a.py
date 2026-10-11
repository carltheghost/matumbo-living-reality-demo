"""Import-only tests for the original 0.8.1 backend, not integrated Vivo acceptance."""
import asyncio, hashlib, json, sys, tempfile, unittest, uuid
from unittest.mock import patch
from pathlib import Path
import numpy as np
from aiohttp import ClientSession, web, WSMsgType

ROOT=Path(sys.argv.pop(1)).resolve() if len(sys.argv)>1 and not sys.argv[1].startswith('-') else Path(__file__).resolve().parents[2]/'services/vivo'
sys.path.insert(0,str(ROOT))
from server.app import make_app
from server.readiness import inspect_assets
from server.geometry import Geometry
from server.reference import HyperBall,dimension_contract
from server.adaptive import RoomRule,teacher
MANIFEST=ROOT/'source-import-stage-a.json'

class SourceImport(unittest.TestCase):
 def test_01_original_bytes(self):
  data=json.loads(MANIFEST.read_text())
  self.assertEqual(len(data['sha256']),13)
  for path,expected in data['sha256'].items():
   with self.subTest(path=path):self.assertEqual(hashlib.sha256((ROOT/path).read_bytes()).hexdigest(),expected)
 def test_02_all_spatial_axes(self):
  for d in range(3,12):
   g=Geometry('flat',d);q=np.zeros(d);v=np.zeros(d);v[-1]=1
   self.assertAlmostEqual(g.move(q,v,.3).q[-1],.3)
   self.assertEqual(dimension_contract(d)['clock_dimension'],1)
 def test_03_hidden_axis_intersection(self):
  q=np.zeros(11);q[-1]=2;a=HyperBall('a',np.zeros(11),.25);b=HyperBall('b',q,.25)
  self.assertFalse(a.overlaps(b));self.assertIsNone(b.slice3_radius(np.zeros(8)))
  v=np.zeros(11);v[-1]=1;self.assertAlmostEqual(b.ray_hit(np.zeros(11),v),1.75)
 def test_04_mobius_seam(self):
  g=Geometry('mobius',4);q=np.array([np.pi+.02,.3,.1,.4]);p,v=g.canonical(q,[1,2,3,4])
  self.assertAlmostEqual(p.q[1],-.3);self.assertEqual(v[1],-2)
  np.testing.assert_allclose(g.display(p.q),g.display(q),atol=1e-10)
 def test_05_original_trained_model(self):
  x=np.random.default_rng(555).uniform(0,1,(300,4));rule=RoomRule();pred=rule.predict(x)
  self.assertLess(float(np.mean((pred-teacher(x))**2)),.003)
  self.assertEqual(rule.version,'1f5592c4dd9e5e9f')

class SourceNetwork(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=str(Path(self.tmp.name)/'world.sqlite');self.clients=[]
  await self.start();self.http=ClientSession()
 async def start(self):
  self.app=make_app(self.db,create_key='test-only');self.runner=web.AppRunner(self.app);await self.runner.setup()
  self.site=web.TCPSite(self.runner,'127.0.0.1',0);await self.site.start();self.base='http://127.0.0.1:'+str(self.site._server.sockets[0].getsockname()[1])
 async def asyncTearDown(self):
  for ws in self.clients:await ws.close()
  await self.http.close();await self.runner.cleanup();self.tmp.cleanup()
 async def create(self):
  async with self.http.post(self.base+'/api/rooms',json={'createKey':'test-only','dimension':11}) as r:
   self.assertEqual(r.status,200,await r.text());return await r.json()
 async def recv(self,ws,kind,id=None):
  async def wait():
   while True:
    m=await ws.receive()
    self.assertEqual(m.type,WSMsgType.TEXT,str(m));x=json.loads(m.data)
    if x.get('type')==kind and (id is None or x.get('id')==id):return x
  return await asyncio.wait_for(wait(),5)
 async def join(self,c):
  ws=await self.http.ws_connect(self.base+'/ws');self.clients.append(ws)
  await ws.send_json({'type':'join','room':c['room'],'token':c['token'],'name':'import-test'})
  return ws,await self.recv(ws,'joined')
 async def cmd(self,ws,op,kind='ack',**kw):
  id=str(uuid.uuid4());await ws.send_json({'type':'command','id':id,'op':op,**kw});return await self.recv(ws,kind,id)
 async def test_06_actual_tcp_handoff_and_restart(self):
  owner=await self.create()
  async with self.http.post(self.base+'/api/rooms/'+owner['room']+'/invite',headers={'Authorization':'Bearer '+owner['token']},json={'role':'editor'}) as r:
   self.assertEqual(r.status,200);editor=await r.json()
  a,initial=await self.join(owner);b,_=await self.join(editor);eid='relic-0'
  await self.cmd(a,'grab',entity=eid)
  denied=await self.cmd(b,'grab',kind='error',entity=eid);self.assertIn('held',denied['message'])
  moved=await self.cmd(a,'move',entity=eid,axis=10,distance=.2,expected=0)
  self.assertAlmostEqual(moved['entity']['q'][10],.2)
  await self.cmd(a,'release',entity=eid);await self.cmd(b,'grab',entity=eid)
  stale=await self.cmd(b,'move',kind='error',entity=eid,axis=10,distance=.1,expected=0);self.assertIn('Stale',stale['message'])
  moved=await self.cmd(b,'move',entity=eid,axis=10,distance=.1,expected=1)
  self.assertAlmostEqual(moved['entity']['q'][10],.3);await self.cmd(b,'release',entity=eid)
  for ws in self.clients:await ws.close()
  self.clients=[];await self.runner.cleanup();await self.start()
  _,restored=await self.join(owner);self.assertAlmostEqual(restored['state']['entities'][eid]['q'][10],.3)
  self.assertEqual(restored['state']['entities'][eid]['revision'],2)
 async def test_07_observers_are_independent(self):
  c=await self.create();a,aa=await self.join(c);b,bb=await self.join(c)
  await a.send_json({'type':'observer_move','id':'eye-step','axis':10,'distance':.2})
  eye=await self.recv(a,'observer','eye-step');self.assertAlmostEqual(eye['observer']['q'][10],.2)
  room=self.app['hub'].room(c['room']);self.assertIsNone(room.sessions[bb['actor']]['observer'])
  self.assertEqual(room.entities['relic-0']['q'][10],0)
 async def test_08_complete_assets_are_ready(self):
  async with self.http.get(self.base+'/readyz') as r:
   self.assertEqual(r.status,200);status=await r.json()
   self.assertTrue(status['ok']);self.assertTrue(status['checks']['assetsPresent'])
   self.assertTrue(status['checks']['modelReadable']);self.assertTrue(status['checks']['databaseOpen'])
   self.assertEqual(status['checks']['missingAssets'],[])
   self.assertFalse(status['deviceValidated']);self.assertFalse(status['publicDeploymentVerified'])
 async def test_09_missing_assets_fixture_is_not_ready(self):
  # Readiness is captured at app construction. Build the negative fixture from
  # an empty asset root, never remove or rewrite the actual imported originals.
  missing=inspect_assets(Path(self.tmp.name)/'missing-assets')
  await self.runner.cleanup()
  with patch('server.app.inspect_assets',return_value=missing):await self.start()
  async with self.http.get(self.base+'/readyz') as r:
   self.assertEqual(r.status,503);status=await r.json()
   self.assertFalse(status['ok']);self.assertFalse(status['checks']['assetsPresent'])
   self.assertTrue(status['checks']['databaseOpen']);self.assertFalse(status['deviceValidated'])
   self.assertIn('web/vendor/field-lab/hand_landmarker.task',status['checks']['missingAssets'])

if __name__=='__main__':unittest.main(verbosity=2)
