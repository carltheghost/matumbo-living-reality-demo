"""Real loopback HTTP, signed provider fixture; not a live OpenAI login."""
import http.client
import json
from pathlib import Path
import secrets
import sys
import tempfile
import threading
import unittest
from urllib.parse import urlsplit, urlencode
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server/accounts'))
from host import AccountHost, API, PHONE
from oauth import AccountManager,PrivateStore
from test_oauth import FakeHTTP, KEY, ISSUER
import jwt,time
class HostTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=PrivateStore(Path(self.temp.name)/'private')
        self.http=FakeHTTP();self.manager=AccountManager(self.store,self.http)
        repo=Path(__file__).resolve().parents[4]
        self.server=AccountHost(repo,self.manager);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.cookie=None
    def tearDown(self):
        self.server.shutdown();self.thread.join();self.server.server_close();self.store.close();self.temp.cleanup()
    def req(self,method,path,data=None,headers=None):
        h={};body=None
        if self.cookie:h['Cookie']=self.cookie
        if data is not None:body=json.dumps(data);h.update({'Content-Type':'application/json','Origin':self.server.origin,'X-Vivo-Action':'user'})
        h.update(headers or {})
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=4)
        try:
            c.request(method,path,body=body,headers=h);r=c.getresponse();return r.status,dict(r.getheaders()),r.read()
        finally:c.close()
    def login_local(self):
        token=self.server.launch
        code,h,b=self.req('GET','/vivo-session?token='+token);self.assertEqual(code,303)
        self.cookie=h['Set-Cookie'].split(';')[0];return token
    def test_one_time_launcher_httponly_cookie_and_replay(self):
        token=self.login_local();status,h,b=self.req('GET',API);self.assertEqual(status,200);self.assertEqual(json.loads(b)['connections'],[])
        self.assertEqual(self.req('GET','/vivo-session?token='+token)[0],403)
        self.assertEqual(h['Cache-Control'],'no-store')
    def test_no_session_and_foreign_host_denied(self):
        self.assertEqual(self.req('GET',API)[0],401);self.login_local()
        self.assertEqual(self.req('GET',API,headers={'Host':'attacker.invalid'})[0],403)
    def test_cross_origin_and_missing_user_action_rejected(self):
        self.login_local()
        for h in [{'Origin':'https://evil.invalid'},{'X-Vivo-Action':''},{'Content-Type':'text/plain'}]:
            self.assertEqual(self.req('POST',API+'/login',{'label':'Personal'},h)[0],403)
        self.assertEqual(self.manager.pending,{})
    def test_private_files_server_sources_and_traversal_are_not_served(self):
        self.login_local()
        for path in ['/services/vivo/server/accounts/oauth.py','/.git/config','/services/vivo/web/../../../AGENTS.md','/services/vivo/web/%2e%2e/%2e%2e/%2e%2e/README.md','/api/other']:
            self.assertEqual(self.req('GET',path)[0],404,path)
    def test_existing_vivo_page_mount_and_modules_serve_exact_bytes(self):
        for relative in [PHONE,'/services/vivo/web/phone/ai-accounts-panel.mjs','/services/vivo/web/phone/constructive-memory.mjs','/services/vivo/web/phone/field-lab.html']:
            status,h,b=self.req('GET',relative);self.assertEqual(status,200)
            self.assertEqual(b,(self.server.repo/relative.lstrip('/')).read_bytes())
        status,h,b=self.req('GET',PHONE);self.assertIn(b'vivoIntelligenceMount',b);self.assertIn(b'./bootstrap.mjs',b)
    def test_full_callback_bound_to_session_and_followup_list_redacted(self):
        self.login_local();status,_,body=self.req('POST',API+'/login',{'label':'Personal'});self.assertEqual(status,200)
        from urllib.parse import parse_qs
        p={k:v[0] for k,v in parse_qs(urlsplit(json.loads(body)['authorizationUrl']).query).items()}
        code=secrets.token_hex(8);client='oaiapp_localtest';now=int(time.time())
        self.http.codes[code]={'access_token':'secret-access','refresh_token':'secret-refresh','token_type':'Bearer','expires_in':3600,
            'scope':'openid profile email resource.invoke chatgpt.tokens.use.direct','id_token':jwt.encode({'iss':ISSUER,'aud':client,'sub':'actual-test-user',
            'nonce':p['nonce'],'iat':now,'exp':now+600},KEY,algorithm='RS256',headers={'kid':'test-only'})}
        callback='/auth/callback?'+urlencode({'state':p['state'],'code':code,'client_id':client})
        status,h,_=self.req('GET',callback);self.assertEqual(status,303);self.assertEqual(h['Location'],PHONE+'?vivo-signin=complete#vivo-ai-accounts')
        status,h,body=self.req('GET',API);self.assertEqual(status,200);self.assertNotIn(b'secret-',body)
        row=json.loads(body)['connections'][0];self.assertEqual(row['status'],'authenticated')
        status,h,_=self.req('POST',API+'/verify',{'connectionId':row['id'],'model':'test-model','consent':False});self.assertEqual(status,400)
        status,h,body=self.req('POST',API+'/verify',{'connectionId':row['id'],'model':'test-model','consent':True});self.assertEqual(status,200)
    def test_duplicate_callback_keys_rejected(self):
        self.login_local();self.assertEqual(self.req('GET','/auth/callback?state=a&state=b&code=x')[0],400)
    def test_unsupported_provider_endpoint_is_not_faked(self):
        self.login_local();self.assertEqual(self.req('POST',API+'/claude-login',{})[0],404)
if __name__=='__main__':unittest.main()
