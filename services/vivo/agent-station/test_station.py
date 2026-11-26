import json, os, sqlite3, tempfile, threading, time, unittest, subprocess
from station import Station,serve
from client import call
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.file=os.path.join(self.tmp.name,'s.db');self.s=Station(self.file)
  self.o=self.s.enroll('owner','Owner');self.h=self.s.enroll('host','World host','w');self.a=self.s.enroll('agent','Agent A','w',['world.read','world.edit']);self.b=self.s.enroll('agent','Agent B','w',['world.read']);self.h2=self.s.enroll('host','Other host','w2');self.agent=self.a['id']
  self.http=serve(self.s,0,['http://localhost:8000']);self.base='http://127.0.0.1:'+str(self.http.server_port);self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
 def tearDown(self):self.http.shutdown();self.http.server_close();self.s.db.close();self.tmp.cleanup()
 def c(self,p,path,b=None):return call(path,b,p['token'],self.base)
 def r(self,rid='read'):return self.c(self.a,'/v1/actions',{'request_id':rid,'tool':'vivo.world.read','args':{}})
 def edit(self,rid='edit',**kw):return self.c(self.a,'/v1/actions',{'request_id':rid,'tool':'vivo.world.edit','args':dict(worldId='w',branchId='branch',eyeId='eye',spaceId='space',entityId='entity',baseRevision=0,delta=[1,0,0])|kw})
 def poll(self,h=None,ready=None):return self.c(h or self.h,'/v1/host/poll',{'world':(h or self.h)['world'],'ready_agents':[self.agent] if ready is None else ready})
 def result(self,j,out='completed',r=None):return self.c(self.h,'/v1/host/result',{'id':j['id'],'claim':j['claim'],'outcome':out,'result':r})
 def test_offline_queue(self):
  self.assertFalse(self.c(self.a,'/v1/info')['host_online']);a=self.r();self.assertEqual(a['status'],'queued');self.assertFalse(a['confirmed']);self.assertIsNone(self.poll(ready=[])['job']);self.assertTrue(self.c(self.a,'/v1/info')['host_online'])
 def test_read_confirmed(self):
  a=self.r();j=self.poll()['job'];self.assertEqual(j['id'],a['id']);r=self.result(j,r={'snapshot':{'worldId':'w','spaces':{}}});self.assertTrue(r['confirmed']);self.assertIsNone(self.poll()['job'])
 def test_wrong_world_receipt(self):
  j=(self.r(),self.poll()['job'])[1];self.assertRaises(RuntimeError,self.result,j,'completed',{'snapshot':{'worldId':'wrong'}})
 def test_idempotence(self):
  a=self.r();self.assertEqual(a['id'],self.r()['id']);self.assertRaises(RuntimeError,self.edit,'read')
 def test_scope_validation(self):
  for args in [{'worldId':'w2'},{'agentId':'b'},{'delta':[100,0,0]},{'baseRevision':-1},{'geometry':{}}]:
   with self.subTest(args=args):self.assertRaises(RuntimeError,self.edit,'bad',**args)
 def test_approval(self):
  a=self.edit();self.assertEqual(a['status'],'awaiting_approval');self.assertIsNone(self.poll()['job']);self.c(self.o,'/v1/owner/decision',{'id':a['id'],'decision':'approve'});j=self.poll()['job'];self.assertEqual(j['args']['operationId'],'station-'+self.agent+'-edit');self.assertRaises(RuntimeError,self.result,j,'completed',{'status':'queued'});self.assertTrue(self.result(j,r={'status':'accepted'})['confirmed'])
 def test_denied(self):
  a=self.edit();self.c(self.o,'/v1/owner/decision',{'id':a['id'],'decision':'reject'});self.assertIsNone(self.poll()['job']);self.assertEqual(self.c(self.a,'/v1/actions/'+a['id'])['status'],'rejected')
 def test_agent_isolation(self):
  a=self.r();self.assertRaises(RuntimeError,self.c,self.b,'/v1/actions/'+a['id']);self.assertRaises(RuntimeError,self.c,self.a,'/v1/owner/actions');self.assertRaises(RuntimeError,self.c,self.b,'/v1/actions',{'request_id':'bad','tool':'vivo.world.edit','args':{}})
 def test_wrong_host(self):
  self.r();self.assertIsNone(self.poll(self.h2)['job']);j=self.poll()['job'];self.assertRaises(RuntimeError,self.c,self.h2,'/v1/host/result',{'id':j['id'],'claim':j['claim'],'outcome':'rejected','result':None})
 def test_wrong_claim(self):
  self.r();j=self.poll()['job'];self.assertRaises(RuntimeError,self.result,j|{'claim':'wrong'},'rejected',None)
 def test_no_replay_after_timeout(self):
  a=self.edit();self.c(self.o,'/v1/owner/decision',{'id':a['id'],'decision':'approve'});j=self.poll()['job'];self.s.db.execute('UPDATE actions SET deadline=0 WHERE id=?',(a['id'],));self.assertIsNone(self.poll()['job']);self.assertEqual(self.c(self.a,'/v1/actions/'+a['id'])['status'],'uncertain');self.assertRaises(RuntimeError,self.result,j,'completed',{'status':'accepted'})
 def test_revocation(self):
  a=self.edit();self.c(self.o,'/v1/owner/stop',{'id':self.agent});self.assertRaises(RuntimeError,self.r);self.assertIn(self.agent,self.poll()['stopped']);self.assertEqual(self.c(self.o,'/v1/actions/'+a['id'])['status'],'cancelled')
 def test_revoke_inflight(self):
  a=self.r();j=self.poll()['job'];self.c(self.o,'/v1/owner/stop',{'id':self.agent});self.assertEqual(self.c(self.o,'/v1/actions/'+a['id'])['status'],'uncertain');self.assertRaises(RuntimeError,self.result,j,'completed',{'snapshot':{'worldId':'w'}})
 def test_inbox(self):
  t=self.c(self.o,'/v1/owner/tasks',{'agent':self.agent,'text':'Inspect actual object'});self.assertEqual(self.c(self.b,'/v1/tasks'),[]);self.assertRaises(RuntimeError,self.c,self.b,'/v1/tasks/claim',{'id':t['id']});self.c(self.a,'/v1/tasks/claim',{'id':t['id']});p={'id':t['id'],'answer':'Observed result'};self.c(self.a,'/v1/tasks/reply',p);self.c(self.a,'/v1/tasks/reply',p);self.assertRaises(RuntimeError,self.c,self.a,'/v1/tasks/reply',p|{'answer':'Changed'});self.assertEqual(self.c(self.o,'/v1/owner/tasks')[0]['answer'],'Observed result')
 def test_persistence(self):
  a=self.r();s2=Station(self.file);self.assertEqual(s2.route(self.a['token'],'GET','/v1/actions/'+a['id'],{})['status'],'queued');s2.db.close()
 def test_mcp(self):
  env=os.environ|{'VIVO_STATION_TOKEN':self.b['token'],'VIVO_STATION_URL':self.base};msgs=[{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-06-18'}},{'jsonrpc':'2.0','id':2,'method':'tools/list'},{'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'vivo_read','arguments':{'request_id':'mcp'}}}];p=subprocess.run([os.sys.executable,'client.py','mcp'],input='\n'.join(map(json.dumps,msgs))+'\n',capture_output=True,text=True,env=env,check=True);out=list(map(json.loads,p.stdout.splitlines()));self.assertNotIn('vivo_edit',[t['name'] for t in out[1]['result']['tools']]);self.assertEqual(json.loads(out[2]['result']['content'][0]['text'])['status'],'queued')
 def test_native_adapter_real_http(self):
  a=self.r();b=self.edit();self.c(self.o,'/v1/owner/decision',{'id':b['id'],'decision':'approve'});env=os.environ|{'BASE':self.base,'HOST':self.h['token'],'AGENT':self.agent};p=subprocess.run(['node','test-host.mjs'],env=env,capture_output=True,text=True,check=True);self.assertIn('native contract fixture passed',p.stdout);self.assertTrue(self.c(self.a,'/v1/actions/'+a['id'])['confirmed']);self.assertEqual(self.c(self.a,'/v1/actions/'+b['id'])['result']['revision'],1)
if __name__=='__main__':unittest.main(verbosity=2)
