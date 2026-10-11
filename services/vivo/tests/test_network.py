"""Real HTTP + TCP WebSocket tests against the production server, not mock sockets."""
import unittest, tempfile, asyncio, json, uuid, copy, time
from pathlib import Path
from aiohttp import web,ClientSession,WSMsgType
from server.app import make_app

class NetworkTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=str(Path(self.tmp.name)/'world.sqlite');self.clients=[]
  self.app=make_app(self.db,create_key='test-only');self.runner=web.AppRunner(self.app);await self.runner.setup();self.site=web.TCPSite(self.runner,'127.0.0.1',0);await self.site.start();self.base='http://127.0.0.1:'+str(self.site._server.sockets[0].getsockname()[1]);self.http=ClientSession()
 async def asyncTearDown(self):
  for c in self.clients:await c.close()
  await self.http.close();await self.runner.cleanup();self.tmp.cleanup()
 async def create(self,**extra):
  async with self.http.post(self.base+'/api/rooms',json={'createKey':'test-only',**extra}) as r:
   self.assertEqual(r.status,200,await r.text());return await r.json()
 async def join(self,c,name='Guest'):
  ws=await self.http.ws_connect(self.base+'/ws');self.clients.append(ws);await ws.send_json({'type':'join','room':c['room'],'token':c['token'],'name':name});m=await self.recv(ws,'joined');return ws,m
 async def recv(self,ws,typ,id=None):
  async def read():
   while True:
    m=await ws.receive();
    if m.type!=WSMsgType.TEXT:raise AssertionError('Socket closed: '+str(m))
    data=json.loads(m.data)
    if data.get('type')==typ and (id is None or data.get('id')==id):return data
  return await asyncio.wait_for(read(),4)
 async def cmd(self,ws,op,expect='ack',**kwargs):
  id=kwargs.pop('id',str(uuid.uuid4()));await ws.send_json({'type':'command','id':id,'op':op,**kwargs});return await self.recv(ws,expect,id)
 async def invite(self,c,role='editor'):
  async with self.http.post(self.base+'/api/rooms/'+c['room']+'/invite',headers={'Authorization':'Bearer '+c['token']},json={'role':role})as r:
   self.assertEqual(r.status,200);return await r.json()
 async def test_two_clients_same_object(self):
  c=await self.create();a,ja=await self.join(c,'A');b,jb=await self.join(await self.invite(c),'B')
  await self.cmd(a,'grab',entity='relic-0');ack=await self.cmd(a,'move',entity='relic-0',expected=0,axis=3,distance=.2)
  for _ in range(20):
   m=await self.recv(b,'state')
   if m['state']['entities']['relic-0']['revision']==1:break
  self.assertEqual(m['state']['entities']['relic-0']['q'],ack['entity']['q']);self.assertEqual(ack['entity']['q'][3],.2)
 async def test_exclusive_grab_and_handoff(self):
  c=await self.create();a,_=await self.join(c);b,_=await self.join(await self.invite(c));await self.cmd(a,'grab',entity='relic-0');m=await self.cmd(b,'grab',entity='relic-0',expect='error');self.assertIn('held',m['message']);await self.cmd(a,'release',entity='relic-0');await self.cmd(b,'grab',entity='relic-0')
 async def test_stale_revision_rejected(self):
  a,_=await self.join(await self.create());await self.cmd(a,'grab',entity='relic-0');await self.cmd(a,'move',entity='relic-0',expected=0,axis=3,distance=.1);m=await self.cmd(a,'move',entity='relic-0',expected=0,axis=3,distance=.1,expect='error');self.assertIn('Stale',m['message'])
 async def test_repeated_command_is_idempotent(self):
  a,_=await self.join(await self.create());id=str(uuid.uuid4());m=await self.cmd(a,'grab',id=id,entity='relic-0');n=await self.cmd(a,'grab',id=id,entity='relic-0');self.assertEqual(m,n)
 async def test_nonce_reuse_changed_payload_rejected(self):
  a,_=await self.join(await self.create());id=str(uuid.uuid4());await self.cmd(a,'grab',id=id,entity='relic-0');m=await self.cmd(a,'release',id=id,entity='relic-0',expect='error');self.assertIn('different payload',m['message'])
 async def test_viewer_cannot_edit(self):
  c=await self.create();v,_=await self.join(await self.invite(c,'viewer'));m=await self.cmd(v,'grab',entity='relic-0',expect='error');self.assertIn('Viewer',m['message'])
 async def test_disconnect_releases(self):
  c=await self.create();a,_=await self.join(c);b,_=await self.join(await self.invite(c));await self.cmd(a,'grab',entity='relic-0');await a.close();await asyncio.sleep(.1);await self.cmd(b,'grab',entity='relic-0')
 async def test_lease_expiry(self):
  c=await self.create();a,_=await self.join(c);b,_=await self.join(await self.invite(c));await self.cmd(a,'grab',entity='relic-0');self.app['hub'].room(c['room']).leases['relic-0']['expires']=time.time()-1;await self.cmd(b,'grab',entity='relic-0')
 async def test_invalid_invite(self):
  c=await self.create();ws=await self.http.ws_connect(self.base+'/ws');self.clients.append(ws);await ws.send_json({'type':'join','room':c['room'],'token':'wrong'});m=await self.recv(ws,'error');self.assertIn('invalid',m['message'])
 async def test_missing_creation_key(self):
  async with self.http.post(self.base+'/api/rooms',json={})as r:self.assertEqual(r.status,400)
 async def test_bad_origin(self):
  async with self.http.post(self.base+'/api/rooms',headers={'Origin':'https://attacker.test'},json={'createKey':'test-only'})as r:self.assertEqual(r.status,400)
 async def test_history_and_export_no_tokens(self):
  c=await self.create();a,_=await self.join(c);await self.cmd(a,'checkpoint');headers={'Authorization':'Bearer '+c['token']}
  async with self.http.get(self.base+'/api/rooms/'+c['room']+'/history',headers=headers)as r:
   text=await r.text();self.assertNotIn(c['token'],text);data=json.loads(text);self.assertGreaterEqual(len(data['events']),2)
  async with self.http.get(self.base+'/api/rooms/'+c['room']+'/export',headers=headers)as r:self.assertEqual(r.status,200)
 async def test_export_requires_invite(self):
  c=await self.create()
  async with self.http.get(self.base+'/api/rooms/'+c['room']+'/export')as r:self.assertEqual(r.status,400)
 async def test_invalid_move_is_atomic(self):
  c=await self.create();a,_=await self.join(c);await self.cmd(a,'grab',entity='relic-0');before=copy.deepcopy(self.app['hub'].room(c['room']).entities)
  await self.cmd(a,'move',entity='relic-0',expected=0,axis=99,distance=.2,expect='error');self.assertEqual(before,self.app['hub'].room(c['room']).entities)
 async def test_neural_model_requires_owner(self):
  c=await self.create();a,_=await self.join(await self.invite(c));await self.cmd(a,'model',mode='off',expect='error')
 async def test_model_affects_shared_field(self):
  c=await self.create();a,_=await self.join(c);await self.cmd(a,'model',mode='off');r=self.app['hub'].room(c['room']);t=r.guide.tick;await asyncio.sleep(.3);self.assertEqual(r.guide.tick,t);await self.cmd(a,'model',mode='learned');await asyncio.sleep(.3);self.assertGreater(r.guide.tick,t)
 async def test_damage_regrows_guidance(self):
  c=await self.create();a,_=await self.join(c);await self.cmd(a,'block',cell=12);r=self.app['hub'].room(c['room']);self.assertIn(12,r.guide.blocked);await self.cmd(a,'block',cell=12);self.assertNotIn(12,r.guide.blocked)
 async def test_curved_move_uses_metric(self):
  c=await self.create(geometry='sphere');a,_=await self.join(c);await self.cmd(a,'grab',entity='relic-0');m=await self.cmd(a,'move',entity='relic-0',expected=0,axis=0,distance=.2);self.assertNotAlmostEqual(m['entity']['q'][0],-1.)
 async def test_custom_metric_room(self):
  c=await self.create(geometry='custom',dimension=3,metric=[['1+q0**2',0,0],[0,1,0],[0,0,1]]);a,j=await self.join(c);self.assertEqual(j['state']['geometry']['kind'],'custom')
 async def test_publish_stable_identity(self):
  c=await self.create(dimension=9,entities=[{'id':'viva-room-S1-node-0','name':'Relic','source':'room-S1:0','q':[0]*9}]);a,j=await self.join(c);self.assertEqual(list(j['state']['entities']),['viva-room-S1-node-0'])
 async def test_revoke_guest(self):
  c=await self.create();inv=await self.invite(c);a,_=await self.join(inv)
  async with self.http.post(self.base+'/api/rooms/'+c['room']+'/revoke',headers={'Authorization':'Bearer '+c['token']},json={})as r:self.assertEqual(r.status,200)
  with self.assertRaises(ValueError):self.app['hub'].store.auth(c['room'],inv['token'])
 async def test_persistence_restart(self):
  c=await self.create();a,_=await self.join(c);await self.cmd(a,'grab',entity='relic-0');await self.cmd(a,'move',entity='relic-0',expected=0,axis=3,distance=.25);await a.close();await self.runner.cleanup()
  self.app=make_app(self.db,create_key='test-only');self.runner=web.AppRunner(self.app);await self.runner.setup();self.site=web.TCPSite(self.runner,'127.0.0.1',0);await self.site.start();self.base='http://127.0.0.1:'+str(self.site._server.sockets[0].getsockname()[1]);b,j=await self.join(c);self.assertAlmostEqual(j['state']['entities']['relic-0']['q'][3],.25);self.assertEqual(j['state']['leases'],{})
 async def test_observer_geodesic_move_for_viewer(self):
  c=await self.create(geometry='sphere');ws,_=await self.join(await self.invite(c,'viewer'));await ws.send_json({'type':'presence','q':[0]*4,'chart':'a'});await ws.send_json({'type':'observer_move','id':'observer-test','axis':0,'distance':.2});m=await self.recv(ws,'observer','observer-test');self.assertLess(m['observer']['q'][0],.11);self.assertGreater(m['observer']['q'][0],.09)
 async def test_observer_snapshot_does_not_contain_camera(self):
  c=await self.create();ws,j=await self.join(c);await ws.send_json({'type':'presence','q':[1,2,3,4],'chart':'a'});await self.cmd(ws,'checkpoint');s=self.app['hub'].room(c['room']).snapshot();self.assertEqual(s['observers'][j['actor']]['q'],[1,2,3,4]);self.assertNotIn('camera',str(s['observers']))
 async def test_observer_bad_axis_rejected(self):
  c=await self.create();ws,_=await self.join(c);await ws.send_json({'type':'observer_move','id':'bad-axis','axis':15,'distance':.2});m=await self.recv(ws,'error','bad-axis');self.assertIn('axis',m['message'])
 async def test_malformed_metric_is_clear_client_error(self):
  async with self.http.post(self.base+'/api/rooms',json={'createKey':'test-only','geometry':'custom','dimension':3,'metric':[['(',0,0],[0,1,0],[0,0,1]]})as r:
   self.assertEqual(r.status,400);self.assertIn('error',await r.json())
