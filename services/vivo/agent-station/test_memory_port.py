"""Station tests with real loopback HTTP/MCP and explicit Apollo reader fixture.
The separate test_apollo_roundtrip uses the actual pinned Apollo implementation.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from station import Station, serve
from client import call
from memory_port import CAP

class FixturePort:
    world='w';binding='local-binding-1';scope='fabric:world-root';owner='tumbo'
    def __init__(self):
        self.records={}
        self.put('mission-1','exact evidence from native mission')
        self.put('mission-2','private other evidence')
    def put(self,task,content):
        self.records[task]={'id':'fact-'+task,'scope':self.scope,'owner':self.owner,'taskId':task,
            'evidenceJson':content,'evidenceSha256':hashlib.sha256(content.encode()).hexdigest(),
            'provenance':{'source':'fixture:'+task,'artifact_sha256':'a'*64},
            'integrity':'digest-matched','authentication':'unverified'}
    def read(self,task):return self.records.get(task)

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.db=Path(self.tmp.name)/'s.db';self.src=FixturePort();self.s=Station(self.db,memory=self.src)
        self.o=self.s.enroll('owner','Owner');self.h=self.s.enroll('host','Host','w');self.a=self.s.enroll('agent','A','w',[CAP,'world.read']);self.b=self.s.enroll('agent','B','w',[CAP]);self.c0=self.s.enroll('agent','C','w',['world.read']);self.d=self.s.enroll('agent','D','other',[CAP]);self.start()
    def start(self):
        self.http=serve(self.s,0,['http://127.0.0.1:8080']);self.base='http://127.0.0.1:'+str(self.http.server_port);self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
    def stop(self):self.http.shutdown();self.http.server_close();self.thread.join();self.s.db.close()
    def tearDown(self):self.stop();self.tmp.cleanup()
    def c(self,p,path,b=None):return call(path,b,p['token'],self.base)
    def preview(self,agent=None,task='mission-1'):return self.c(self.o,'/v1/owner/memory/preview',{'agent':(agent or self.a)['id'],'task':task})
    def payload(self,agent=None,task='mission-1',ttl=120):
        r=self.preview(agent,task);return {k:r[k] for k in ('agent','task','fact','evidence_sha','artifact_sha')}|{'ttl_seconds':ttl}
    def grant(self,agent=None,task='mission-1',ttl=120):return self.c(self.o,'/v1/owner/memory/grant',self.payload(agent,task,ttl))
    def read(self,g,agent=None,**kw):return self.c(agent or self.a,'/v1/memory/read',{'id':g['id']}|kw)
    def deny(self,fn,*args,**kwargs):
        with self.assertRaises(RuntimeError):fn(*args,**kwargs)
    def test_capability_not_global_search(self):
        self.assertTrue(self.c(self.a,'/v1/info')['memory_available']);self.assertFalse(self.c(self.c0,'/v1/info')['memory_available']);self.assertFalse(self.c(self.d,'/v1/info')['memory_available']);self.assertEqual(self.c(self.a,'/v1/memory/list'),[])
        self.deny(self.c,self.a,'/v1/memory/read',{'task':'mission-1'});self.deny(self.c,self.a,'/v1/owner/memory/preview',{'agent':self.a['id'],'task':'mission-1'})
    def test_grant_exact_fact_and_audit(self):
        g=self.grant();r=self.read(g);self.assertEqual(r['fact'],self.src.records['mission-1']);self.assertEqual(r['authority'],'evidence-only');self.assertTrue(r['historical']);self.assertEqual(self.c(self.a,'/v1/memory/list')[0]['reads'],1);self.assertEqual(self.c(self.o,'/v1/owner/memory/grants')[0]['reads'],1)
        # No copied report text in broker DB rows or action receipts.
        dump='\n'.join(self.s.db.iterdump());self.assertNotIn(self.src.records['mission-1']['evidenceJson'],dump);self.assertEqual(self.c(self.o,'/v1/owner/actions'),[])
    def test_other_agent_same_world_cannot_recall(self):
        g=self.grant();self.assertEqual(self.c(self.b,'/v1/memory/list'),[]);self.deny(self.read,g,self.b);self.deny(self.read,g,self.c0);self.deny(self.read,g,self.d);self.deny(self.read,g,self.h)
    def test_grant_targets_eligible_agent(self):
        for agent in (self.c0,self.d,self.h,self.o):self.deny(self.preview,agent)
    def test_owner_preview_is_not_a_grant(self):
        self.preview();self.assertEqual(self.c(self.a,'/v1/memory/list'),[])
    def test_exact_pinning_rejects_changed_after_review(self):
        p=self.payload();self.src.put('mission-1','changed');self.deny(self.c,self.o,'/v1/owner/memory/grant',p);self.assertEqual(self.c(self.a,'/v1/memory/list'),[])
    def test_exact_pinning_rejects_changed_after_grant(self):
        g=self.grant();self.src.put('mission-1','changed');self.deny(self.read,g)
    def test_artifact_pin_even_if_inner_digest_matches(self):
        g=self.grant();self.src.records['mission-1']['provenance']['artifact_sha256']='b'*64;self.deny(self.read,g)
    def test_revoke_one_grant_only(self):
        g=self.grant();h=self.grant(task='mission-2');self.c(self.o,'/v1/owner/memory/revoke',{'id':g['id']});self.deny(self.read,g);self.assertEqual(self.read(h)['fact']['taskId'],'mission-2')
    def test_revoke_agent_stops_all_future_reads(self):
        g=self.grant();self.c(self.o,'/v1/owner/stop',{'id':self.a['id']});self.deny(self.read,g);self.assertEqual(self.c(self.o,'/v1/owner/memory/grants')[0]['revoked'],1)
    def test_expiration_and_read_limit(self):
        g=self.grant();self.s.db.execute('UPDATE mission_memory_grants SET expires=? WHERE id=?',(time.time()-1,g['id']));self.deny(self.read,g);self.assertEqual(self.c(self.a,'/v1/memory/list'),[])
        h=self.grant();self.s.db.execute('UPDATE mission_memory_grants SET reads=256 WHERE id=?',(h['id'],));self.deny(self.read,h)
    def test_grant_retry_does_not_extend(self):
        a=self.grant(ttl=60);b=self.grant(ttl=120);self.assertEqual(a['id'],b['id']);self.assertEqual(a['expires'],b['expires'])
    def test_persisted_grant_after_restart(self):
        g=self.grant();self.stop();self.s=Station(self.db,memory=self.src);self.start();self.assertEqual(self.read(g)['fact']['id'],'fact-mission-1')
    def test_changed_binding_cannot_replay(self):
        g=self.grant();self.stop();self.src.binding='changed';self.s=Station(self.db,memory=self.src);self.start();self.deny(self.read,g);self.assertEqual(self.c(self.a,'/v1/memory/list'),[])
    def test_disconnected_source_fails_closed(self):
        g=self.grant();self.stop();self.s=Station(self.db);self.start();self.assertFalse(self.c(self.a,'/v1/info')['memory_available']);self.deny(self.read,g)
    def test_path_override_denied(self):
        g=self.grant();self.deny(self.read,g,scope='other');self.deny(self.read,g,path='anything');self.deny(self.read,g,task='mission-2')
    def test_mcp_capability_discovery_and_exact_read(self):
        g=self.grant();msgs=[{'jsonrpc':'2.0','id':1,'method':'tools/list'},{'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'memory_recall','arguments':{'id':g['id']}}}]
        def run(agent):
            env=os.environ|{'VIVO_STATION_TOKEN':agent['token'],'VIVO_STATION_URL':self.base};p=subprocess.run([os.sys.executable,'client.py','mcp'],input='\n'.join(map(json.dumps,msgs))+'\n',capture_output=True,text=True,env=env,check=True);return [json.loads(x)['result'] for x in p.stdout.splitlines()]
        a=run(self.a);self.assertIn('memory_recall',[t['name'] for t in a[0]['tools']]);self.assertEqual(json.loads(a[1]['content'][0]['text'])['fact']['id'],'fact-mission-1');b=run(self.c0);self.assertNotIn('memory_recall',[t['name'] for t in b[0]['tools']]);self.assertTrue(b[1]['isError'])
    def test_wrong_host_and_origin(self):
        import urllib.request,urllib.error
        for headers in ({'Host':'evil.test'},{'Origin':'https://evil.test'}):
            q=urllib.request.Request(self.base+'/v1/info',headers=headers|{'Authorization':'Bearer '+self.a['token']})
            with self.assertRaises(urllib.error.HTTPError) as cm:urllib.request.urlopen(q,timeout=5)
            self.assertEqual(cm.exception.code,403)
    def test_memory_cap_does_not_authorize_world_edit(self):
        self.deny(self.c,self.b,'/v1/actions',{'request_id':'no','tool':'vivo.world.edit','args':{}})
    def test_backend_error_redacted(self):
        g=self.grant();self.src.read=lambda task: (_ for _ in ()).throw(OSError('C:/secret/store.json'))
        with self.assertRaisesRegex(RuntimeError,'mission evidence unavailable or changed') as cm:self.read(g)
        self.assertNotIn('secret',str(cm.exception))
if __name__=='__main__':unittest.main(verbosity=2)
