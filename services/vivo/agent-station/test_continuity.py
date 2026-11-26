"""Regression tests for the actual Station broker, not a second mission store."""
import json, os, secrets, tempfile, time, unittest, threading, subprocess, sys
from pathlib import Path
from unittest.mock import patch
from station import Station,serve
from client import call
from continuity import CAP
from memory_port import CAP as MEMORY_CAP
from test_memory_port import FixturePort

class ContinuityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'station.db';self.src=FixturePort();self.s=Station(self.path,memory=self.src)
        self.o=self.s.enroll('owner','Owner');self.a=self.s.enroll('agent','Worker A','w',[CAP,'world.read',MEMORY_CAP]);self.b=self.s.enroll('agent','Worker B','w',[CAP,'world.read',MEMORY_CAP]);self.c=self.s.enroll('agent','Legacy','w',['world.read']);self.other=self.s.enroll('agent','Other','w2',[CAP,'world.read']);self.host=self.s.enroll('host','Native host','w');self.key=secrets.token_urlsafe(32)
    def tearDown(self):self.s.db.close()
    def request(self,p,path,b=None):return self.s.route(p['token'],'POST' if b is not None else 'GET',path,b or {})
    def own(self,op,b=None):return self.request(self.o,'/v1/owner/continuity/'+op,b)
    def agent(self,op,b=None,p=None):return self.request(p or self.a,'/v1/continuity/'+op,b)
    def grant(self,p=None,task='mission-1'):
        p=p or self.a;v=self.request(self.o,'/v1/owner/memory/preview',{'agent':p['id'],'task':task});return self.request(self.o,'/v1/owner/memory/grant',{k:v[k] for k in ('agent','task','fact','evidence_sha','artifact_sha')}|{'ttl_seconds':600})['id']
    def create(self,grants=None,p=None,rid='create',objective='Inspect native object'):
        return self.own('create',{'request_id':rid,'agent':(p or self.a)['id'],'objective':objective,'grants':grants or []})['id']
    def state(self,mid,p=None):return self.agent('state',{'id':mid},p)
    def claim(self,mid,key=None,p=None,ttl=180,rev=None):
        return self.agent('claim',{'id':mid,'expected_revision':rev if rev is not None else self.state(mid,p)['revision'],'lease':key or self.key,'ttl_seconds':ttl},p)
    def bound(self,mid,key=None,p=None):
        m=self.state(mid,p);return {'id':mid,'epoch':m['lease_epoch'],'lease':key or self.key}
    def observe(self,mid,rid='obs',key=None,p=None):return self.agent('observe',self.bound(mid,key,p)|{'request_id':rid},p)
    def poll(self,p=None):return self.request(self.host,'/v1/host/poll',{'world':'w','ready_agents':[(p or self.a)['id']]})['job']
    def finish(self,job,world='w',outcome='completed'):
        return self.request(self.host,'/v1/host/result',{'id':job['id'],'claim':job['claim'],'outcome':outcome,'result':{'snapshot':{'worldId':world,'revision':7}}})
    def ready(self,mid,key=None,p=None):
        a=self.observe(mid,key=key,p=p);job=self.poll(p);self.assertEqual(job['id'],a['id']);self.finish(job);self.cp(mid,obs=a['id'],ready=True,key=key,p=p);return a['id']
    def cp(self,mid,obs=None,ready=False,progress='Private working note',rid='cp',key=None,p=None,rev=None):
        return self.agent('checkpoint',self.bound(mid,key,p)|{'expected_revision':rev if rev is not None else self.state(mid,p)['revision'],'request_id':rid,'progress':progress,'next_step':'Review fresh snapshot; do not execute automatically','observation':obs,'ready':ready},p)
    def handoff(self,mid,grants=None,p=None,rev=None):
        return self.own('handoff',{'id':mid,'expected_revision':rev or self.own('state',{'id':mid})['revision'],'request_id':'handoff','agent':(p or self.b)['id'],'grants':grants or [],'note':'Owner reviewed: inspect current object independently.'})
    def accept(self,mid):return self.own('accept',{'id':mid,'expected_revision':self.own('state',{'id':mid})['revision'],'request_id':'accept','note':'Owner accepted the checkpoint, not certified physical truth.'})
    def restart(self):self.s.db.close();self.s=Station(self.path,memory=self.src)
    def denied(self,fn,*a,**kw):
        with self.assertRaises((ValueError,PermissionError)):fn(*a,**kw)
    def test_01_create_idempotent_and_one_task(self):
        m=self.create();self.assertEqual(m,self.create());self.assertEqual(self.s.db.execute('SELECT count(*) FROM tasks').fetchone()[0],1);self.denied(self.create,objective='changed')
    def test_02_old_task_paths_cannot_complete_managed(self):
        m=self.create();self.assertEqual(self.request(self.a,'/v1/tasks'),[]);self.denied(self.request,self.a,'/v1/tasks/claim',{'id':m});self.denied(self.request,self.a,'/v1/tasks/reply',{'id':m,'answer':'forged'})
    def test_03_legacy_capability_denied(self):
        self.denied(self.create,p=self.c);self.denied(self.agent,'list',p=self.c)
    def test_04_other_agent_and_world_denied(self):
        m=self.create();self.assertEqual(self.agent('list',p=self.b),[]);self.denied(self.state,m,self.b);self.denied(self.state,m,self.other);self.denied(self.handoff,m,p=self.other)
    def test_05_no_implicit_memory_authority(self):
        g=self.grant();self.denied(self.create,grants=[g],p=self.b);m=self.create([g]);self.assertEqual(self.state(m)['grants'],[g]);self.assertEqual(self.request(self.b,'/v1/memory/list'),[])
    def test_06_lease_conflict_and_same_secret_retry(self):
        m=self.create();a=self.claim(m);b=self.claim(m,rev=1);self.assertEqual(a['revision'],b['revision']);self.assertEqual(a['lease_until'],b['lease_until']);self.denied(self.claim,m,secrets.token_urlsafe(32));self.assertNotIn(self.key,'\n'.join(self.s.db.iterdump()))
    def test_07_checkpoint_cas_and_retry(self):
        m=self.create();a=self.claim(m);b=self.cp(m,rev=a['revision']);self.assertEqual(self.cp(m,rev=a['revision'])['applied_revision'],b['applied_revision']);self.denied(self.cp,m,rev=a['revision'],progress='change');self.denied(self.cp,m,rev=a['revision'],rid='stale');self.assertEqual(self.state(m)['checkpoint']['progress'],'Private working note')
    def test_08_resume_preserves_checkpoint_requires_observation(self):
        m=self.create();self.claim(m);self.cp(m);self.restart();self.assertEqual(self.state(m)['checkpoint']['progress'],'Private working note');self.s.db.execute('UPDATE continuity_missions SET lease_until=0 WHERE id=?',(m,));s=self.state(m);self.assertEqual(s['phase'],'assigned');self.assertEqual(s['checkpoint']['progress'],'Private working note');self.denied(self.claim,m);new=secrets.token_urlsafe(32);q=self.claim(m,new);self.assertEqual(q['lease_epoch'],2);self.denied(self.cp,m,rid='old');self.assertFalse(q['observation_current'])
    def test_09_unconfirmed_observation_no_review(self):
        m=self.create();self.claim(m);a=self.observe(m);self.denied(self.cp,m,obs=a['id'],ready=True);self.denied(self.accept,m);self.assertEqual(self.observe(m)['id'],a['id']);self.denied(self.observe,m,'new')
    def test_10_actual_confirmed_receipt_and_owner_review(self):
        m=self.create();self.claim(m);self.ready(m);self.assertEqual(self.state(m)['phase'],'ready');self.assertTrue(self.state(m)['observation_current']);self.accept(m);self.assertEqual(self.state(m)['phase'],'closed');self.denied(self.observe,m,'after');self.assertEqual(self.s.db.execute('SELECT status FROM tasks WHERE id=?',(m,)).fetchone()[0],'completed')
    def test_11_non_mission_receipt_cannot_be_attached(self):
        m=self.create();self.claim(m);a=self.request(self.a,'/v1/actions',{'request_id':'outside','tool':'vivo.world.read','args':{}});self.finish(self.poll());self.denied(self.cp,m,obs=a['id'],ready=True)
    def test_12_stale_native_observation_blocks_accept(self):
        m=self.create();self.claim(m);a=self.ready(m);self.s.db.execute('UPDATE actions SET updated=? WHERE id=?',(time.time()-121,a));self.assertFalse(self.state(m)['observation_current']);self.denied(self.accept,m)
    def test_13_wrong_world_host_receipt_rejected(self):
        m=self.create();self.claim(m);a=self.observe(m);j=self.poll();self.denied(self.finish,j,'w2');self.denied(self.cp,m,obs=a['id'],ready=True)
    def test_14_handoff_does_not_copy_checkpoint_or_grant(self):
        ga=self.grant();gb=self.grant(self.b);m=self.create([ga]);self.claim(m);self.cp(m);self.handoff(m,[gb]);self.denied(self.state,m);v=self.state(m,self.b);self.assertEqual(v['grants'],[gb]);self.assertIsNone(v['checkpoint']);self.assertNotIn('Private working note',json.dumps(v));self.assertEqual(v['assignment'],2);history=self.own('history',{'id':m});self.assertIn('Private working note',json.dumps(history));self.assertIn('Owner reviewed',v['handoff'])
    def test_15_handoff_fences_running_read_and_late_receipt(self):
        m=self.create();self.claim(m);a=self.observe(m);j=self.poll();self.handoff(m);self.assertEqual(self.request(self.o,'/v1/actions/'+a['id'])['status'],'uncertain');self.denied(self.finish,j);new=secrets.token_urlsafe(32);self.claim(m,new,self.b);self.denied(self.cp,m,obs=a['id'],ready=True,key=new,p=self.b)
    def test_16_expired_lease_cancels_queued_read_before_poll(self):
        m=self.create();self.claim(m);a=self.observe(m);self.s.db.execute('UPDATE continuity_missions SET lease_until=0 WHERE id=?',(m,));self.assertIsNone(self.poll());self.assertEqual(self.request(self.a,'/v1/actions/'+a['id'])['status'],'cancelled')
    def test_17_denied_late_request_still_persists_expiry(self):
        m=self.create();self.claim(m);a=self.observe(m);self.s.db.execute('UPDATE continuity_missions SET lease_until=0 WHERE id=?',(m,));self.denied(self.agent,'observe',{'id':m,'epoch':1,'lease':self.key,'request_id':'late'});self.assertEqual(self.s.db.execute('SELECT status FROM actions WHERE id=?',(a['id'],)).fetchone()[0],'cancelled')
    def test_18_revoke_grant_hides_checkpoint_and_blocks_review(self):
        g=self.grant();m=self.create([g]);self.claim(m);self.ready(m);self.request(self.o,'/v1/owner/memory/revoke',{'id':g});v=self.state(m);self.assertFalse(v['evidence_current']);self.assertIsNone(v['checkpoint']);self.assertEqual(v['grants'],[]);self.denied(self.accept,m)
    def test_19_grant_change_cancels_queued_read(self):
        g=self.grant();m=self.create([g]);self.claim(m);a=self.observe(m);self.src.put('mission-1','changed');self.assertIsNone(self.poll());self.assertEqual(self.request(self.a,'/v1/actions/'+a['id'])['status'],'cancelled');self.denied(self.cp,m)
    def test_20_revoked_agent_suspended_and_owner_can_handoff(self):
        m=self.create();self.claim(m);a=self.observe(m);self.request(self.o,'/v1/owner/stop',{'id':self.a['id']});self.denied(self.state,m);s=self.own('state',{'id':m});self.assertEqual(s['phase'],'suspended');self.assertEqual(self.request(self.o,'/v1/actions/'+a['id'])['status'],'cancelled');self.handoff(m);self.assertEqual(self.state(m,self.b)['phase'],'assigned')
    def test_21_cross_connection_claim_and_checkpoint_race(self):
        m=self.create();s2=Station(self.path,memory=self.src);self.addCleanup(s2.db.close);barrier=threading.Barrier(2);results=[];keys=[self.key,secrets.token_urlsafe(32)]
        def go(s,key):
            barrier.wait()
            try:results.append(('ok',s.route(self.a['token'],'POST','/v1/continuity/claim',{'id':m,'expected_revision':1,'lease':key,'ttl_seconds':180})))
            except (ValueError,PermissionError):results.append(('denied',None))
        t=[threading.Thread(target=go,args=(s,k)) for s,k in zip((self.s,s2),keys)];[x.start() for x in t];[x.join() for x in t];self.assertEqual(sorted(x[0] for x in results),['denied','ok']);self.assertEqual(self.state(m)['revision'],2)
    def test_22_renew_is_idempotent_and_requires_revision(self):
        m=self.create();v=self.claim(m,ttl=60);req=self.bound(m)|{'expected_revision':v['revision'],'ttl_seconds':180,'request_id':'renew'};r=self.agent('renew',req);until=self.state(m)['lease_until'];self.assertEqual(self.agent('renew',req)['applied_revision'],r['applied_revision']);self.assertEqual(self.state(m)['lease_until'],until);self.denied(self.agent,'renew',req|{'ttl_seconds':190})
    def test_23_request_replay_does_not_return_old_checkpoint(self):
        m=self.create();v=self.claim(m);r=self.cp(m,rev=v['revision']);self.cp(m,rid='later',progress='second');again=self.cp(m,rev=v['revision']);self.assertEqual(again['applied_revision'],r['applied_revision']);self.assertNotIn('progress',again);self.assertEqual(self.state(m)['checkpoint']['progress'],'second')
    def test_24_list_does_not_read_or_disclose_checkpoint(self):
        g=self.grant();m=self.create([g]);self.claim(m);self.cp(m);with_reader=self.src.read
        with patch.object(self.src,'read',side_effect=AssertionError('list must not fetch facts')):v=self.agent('list')
        self.assertNotIn('checkpoint',v[0]);self.assertNotIn('grants',v[0]);self.assertEqual(v[0]['id'],m)
    def test_25_cancel_idempotent_and_no_new_action(self):
        m=self.create();self.claim(m);self.observe(m);req={'id':m,'expected_revision':self.state(m)['revision'],'request_id':'cancel','note':'Stop task'};r=self.own('cancel',req);self.assertEqual(self.own('cancel',req)['applied_revision'],r['applied_revision']);self.assertIsNone(self.poll());self.denied(self.observe,m,'later')
    def test_26_reserved_action_id_and_payload_rejected(self):
        self.denied(self.request,self.a,'/v1/actions',{'request_id':'continuity-forged','tool':'vivo.world.read','args':{}});m=self.create();self.claim(m);self.denied(self.agent,'observe',self.bound(m)|{'request_id':'x','tool':'vivo.world.edit'})
    def test_27_mcp_private_lease_and_tool_discovery(self):
        m=self.create();api=serve(self.s,0,[]);t=threading.Thread(target=api.serve_forever,daemon=True);t.start()
        try:
            env=os.environ|{'VIVO_STATION_TOKEN':self.a['token'],'VIVO_STATION_URL':'http://127.0.0.1:'+str(api.server_port)}
            calls=[{'jsonrpc':'2.0','id':1,'method':'tools/list'},{'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'mission_claim','arguments':{'id':m,'expected_revision':1,'ttl_seconds':180}}},{'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'mission_checkpoint','arguments':{'id':m,'expected_revision':2,'request_id':'mcp','progress':'Agent checkpoint','next_step':'observe','observation':None,'ready':False}}}]
            p=subprocess.run([sys.executable,'client.py','mcp'],input='\n'.join(map(json.dumps,calls))+'\n',env=env,text=True,capture_output=True,check=True,timeout=15);rows=list(map(json.loads,p.stdout.splitlines()));self.assertIn('mission_claim',[x['name'] for x in rows[0]['result']['tools']]);claim=json.loads(rows[1]['result']['content'][0]['text']);self.assertNotIn('lease',claim);self.assertNotIn('lease_hash',claim);self.assertEqual(claim['lease_epoch'],1);self.assertFalse(rows[2]['result'].get('isError',False));self.assertEqual(self.state(m)['checkpoint']['progress'],'Agent checkpoint')
            legacy=subprocess.run([sys.executable,'client.py','mcp'],input=json.dumps(calls[0])+'\n',env=env|{'VIVO_STATION_TOKEN':self.c['token']},text=True,capture_output=True,check=True,timeout=15);self.assertNotIn('mission_claim',[x['name'] for x in json.loads(legacy.stdout)['result']['tools']])
        finally:api.shutdown();api.server_close();t.join()

if __name__=='__main__':unittest.main(verbosity=2)
