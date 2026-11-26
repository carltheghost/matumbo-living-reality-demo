"""Signed issuer fixtures, never represented as real provider login evidence."""
import base64
import json
import os
from pathlib import Path
import secrets
import stat
import sys
import tempfile
import time
import unittest
from urllib.parse import parse_qs, urlsplit
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server/accounts'))
from oauth import AccountManager, AccountError, OpenAIIdentity, PrivateStore, TOKEN, ISSUER, RESOURCE

def b64(n):return base64.urlsafe_b64encode(n.to_bytes((n.bit_length()+7)//8,'big')).rstrip(b'=').decode()
KEY=rsa.generate_private_key(public_exponent=65537,key_size=2048)
NUM=KEY.public_key().public_numbers()
JWK={'kty':'RSA','kid':'test-only','use':'sig','alg':'RS256','n':b64(NUM.n),'e':b64(NUM.e)}
class FakeHTTP:
    def __init__(self):self.codes={};self.calls=[];self.events=[{'type':'response.completed'}];self.fail=None;self.hook=None
    def request(self,method,url,**kwargs):
        self.calls.append((method,url,kwargs))
        if self.hook:self.hook(method,url,kwargs)
        if url.endswith('openid-configuration'):return {'issuer':ISSUER,'jwks_uri':ISSUER+'/jwks','revocation_endpoint':ISSUER+'/revoke'}
        if url.endswith('/jwks'):return {'keys':[JWK]}
        if url==TOKEN:
            if kwargs['form']['grant_type']=='refresh_token':return {'access_token':'rotated-fake','refresh_token':'rotated-refresh-fake','expires_in':3600,'token_type':'Bearer'}
            return self.codes[kwargs['form']['code']]
        if url.endswith('/models'):return {'models':[{'visibility':'list','slug':'test-model','display_name':'Fake test model'}]}
        if url.endswith('/responses'):
            if self.fail:raise AccountError(self.fail)
            return self.events
        if url.endswith('/revoke'):return {}
        raise AssertionError(url)
class OAuthTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)/'private'
        self.store=PrivateStore(self.root);self.http=FakeHTTP();self.clock=time.time()
        self.m=AccountManager(self.store,self.http,now=lambda:self.clock)
    def tearDown(self):self.store.close();self.temp.cleanup()
    def attempt(self,label='Personal',id=None):
        result=self.m.begin('http://127.0.0.1:54321/auth/callback',label,id)
        return {k:v[0] for k,v in parse_qs(urlsplit(result['authorizationUrl']).query).items()}
    def callback(self,p,client='oaiapp_test',subject='alice',changes=None,scopes=None):
        now=int(time.time());claims={'iss':ISSUER,'aud':client,'sub':subject,'nonce':p['nonce'],'iat':now,'exp':now+600}
        claims.update(changes or {});code=secrets.token_hex(8)
        self.http.codes[code]={'access_token':'FAKE-ACCESS-'+code,'refresh_token':'FAKE-REFRESH-'+code,
            'id_token':jwt.encode(claims,KEY,algorithm='RS256',headers={'kid':'test-only'}),
            'scope':scopes or 'openid profile email resource.invoke chatgpt.tokens.use.direct','token_type':'Bearer','expires_in':3600}
        return {'state':p['state'],'code':code,'client_id':client}
    def connect(self,client='oaiapp_test',subject='alice',label='Personal'):
        p=self.attempt(label);return self.m.complete(self.callback(p,client,subject))
    def test_pkce_nonce_and_stable_host(self):
        a,b=self.attempt(),self.attempt();self.assertNotEqual(a['state'],b['state']);self.assertNotEqual(a['nonce'],b['nonce'])
        self.assertEqual(a['ext_agent_host_id'],b['ext_agent_host_id']);self.assertEqual(a['client_id'],'dynamic_agent_client')
        self.assertEqual(a['code_challenge_method'],'S256');self.assertNotIn('client_secret',a)
    def test_signed_login_is_not_execution_success(self):
        id=self.connect();r=self.m.public()['connections'][0];self.assertEqual(r['id'],id);self.assertEqual(r['status'],'authenticated')
        self.assertEqual(r['lastVerified'],None);self.assertFalse(any(x[1].endswith('/responses') for x in self.http.calls))
    def test_state_replay_and_wrong_state_rejected(self):
        p=self.attempt();c=self.callback(p);self.m.complete(c)
        for cb in [c,{**c,'state':'wrong'}]:
            with self.assertRaisesRegex(AccountError,'STATE'):self.m.complete(cb)
    def test_expired_state_and_denied_consent_no_exchange(self):
        p=self.attempt();self.clock+=301
        with self.assertRaisesRegex(AccountError,'STATE'):self.m.complete(self.callback(p))
        p=self.attempt()
        with self.assertRaisesRegex(AccountError,'DENIED'):self.m.complete({'state':p['state'],'error':'access_denied'})
        self.assertFalse(any(url==TOKEN for _,url,_ in self.http.calls))
    def test_invalid_id_signature(self):
        p=self.attempt();c=self.callback(p);other=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        claims=jwt.decode(self.http.codes[c['code']]['id_token'],options={'verify_signature':False})
        self.http.codes[c['code']]['id_token']=jwt.encode(claims,other,algorithm='RS256',headers={'kid':'test-only'})
        with self.assertRaisesRegex(AccountError,'SIGNED_IDENTITY'):self.m.complete(c)
    def test_issuer_audience_nonce_and_expiry_checked(self):
        for changes in [{'iss':'https://evil.invalid'},{'aud':'other'},{'nonce':'wrong'},{'exp':int(time.time())-10}]:
            p=self.attempt()
            with self.assertRaises(AccountError):self.m.complete(self.callback(p,changes=changes))
    def test_dynamic_placeholder_not_used_for_exchange(self):
        p=self.attempt()
        with self.assertRaisesRegex(AccountError,'ISSUED'):self.m.complete(self.callback(p,client='dynamic_agent_client'))
        self.assertEqual(len(self.http.calls),0)
    def test_two_accounts_and_overlapping_callbacks_stay_separate(self):
        a,b=self.attempt('Personal'),self.attempt('Work')
        second=self.m.complete(self.callback(b,'oaiapp_work','bob'));first=self.m.complete(self.callback(a,'oaiapp_personal','alice'))
        self.assertNotEqual(first,second);self.assertEqual(len(self.m.public()['connections']),2)
        self.assertEqual(self.m.data['connections'][first]['subject'],'alice')
        self.assertEqual(self.m.data['connections'][second]['label'],'Work')
    def test_duplicate_exact_registration_is_not_another_account(self):
        self.connect();p=self.attempt()
        with self.assertRaisesRegex(AccountError,'ALREADY_ADDED'):self.m.complete(self.callback(p))
        self.assertEqual(len(self.m.public()['connections']),1)
    def test_same_subject_different_registered_workspace_is_distinct(self):
        a=self.connect('oaiapp_personal');b=self.connect('oaiapp_work');self.assertNotEqual(a,b)
    def test_reconnect_must_match_saved_identity_and_client(self):
        id=self.connect();p=self.attempt(id=id)
        self.assertEqual(p['client_id'],'oaiapp_test');self.assertNotIn('agent_name_hint',p)
        with self.assertRaisesRegex(AccountError,'IDENTITY_MISMATCH'):self.m.complete(self.callback(p,subject='bob'))
        p=self.attempt(id=id)
        with self.assertRaisesRegex(AccountError,'REGISTRATION_MISMATCH'):self.m.complete(self.callback(p,client='changed'))
    def test_reconnect_may_omit_client_id(self):
        id=self.connect();p=self.attempt(id=id);c=self.callback(p);del c['client_id']
        self.assertEqual(self.m.complete(c),id)
    def test_disconnect_invalidates_pending_reconnect(self):
        id=self.connect();p=self.attempt(id=id);self.m.disconnect(id)
        with self.assertRaisesRegex(AccountError,'STATE'):self.m.complete(self.callback(p))
    def test_default_changes_do_not_move_selected_connection(self):
        a=self.connect();b=self.connect('oaiapp_work','bob');self.m.select_default(a);self.m.models(b)
        self.assertEqual(self.m.public()['default'],a)
        token=self.http.calls[-1][2]['token'];self.assertEqual(token,self.m.data['connections'][b]['access_token'])
    def test_scopes_not_callback_claims_gate_inference(self):
        p=self.attempt();c=self.callback(p,scopes='openid profile email');c['scope']='chatgpt.tokens.use.direct'
        id=self.m.complete(c);self.assertEqual(self.m.public()['connections'][0]['status'],'consent_required')
        with self.assertRaises(AccountError):self.m.models(id)
    def test_complete_stream_marks_only_selected_account(self):
        a=self.connect();b=self.connect('oaiapp_work','bob');result=self.m.verify_execution(a,'test-model')
        self.assertEqual(result['status'],'execution_verified');self.assertEqual(self.m.data['connections'][b]['status'],'authenticated')
        call=next(x for x in self.http.calls if x[1].endswith('/responses'));self.assertFalse(call[2]['body']['store']);self.assertTrue(call[2]['body']['stream'])
    def test_catalogue_is_not_success_and_unknown_model_not_called(self):
        id=self.connect();self.m.models(id);self.assertEqual(self.m.data['connections'][id]['status'],'authenticated')
        with self.assertRaisesRegex(AccountError,'CATALOG'):self.m.verify_execution(id,'invented-model')
        self.assertFalse(any(x[1].endswith('/responses') for x in self.http.calls))
    def test_missing_completed_and_stream_failure_do_not_report_success(self):
        id=self.connect()
        for events in [[{'type':'response.output_text.delta','delta':'hello'}],[{'type':'response.incomplete'}],[{'type':'response.failed','response':{'error':{'code':'x'}}}]]:
            self.http.events=events
            with self.assertRaises(AccountError):self.m.verify_execution(id,'test-model')
            self.assertNotEqual(self.m.data['connections'][id]['status'],'execution_verified')
    def test_quota_blocks_only_one_account_without_retry(self):
        a=self.connect();b=self.connect('oaiapp_work','bob');self.http.fail='QUOTA_BLOCKED'
        with self.assertRaises(AccountError):self.m.verify_execution(a,'test-model')
        self.assertEqual(self.m.data['connections'][a]['status'],'quota_blocked');self.assertEqual(self.m.data['connections'][b]['status'],'authenticated')
        self.assertEqual(sum(u.endswith('/responses') for _,u,_ in self.http.calls),1)
    def test_disconnect_fences_late_inference_result(self):
        id=self.connect()
        def hook(method,url,args):
            if url.endswith('/responses'):self.m.disconnect(id)
        self.http.hook=hook
        with self.assertRaisesRegex(AccountError,'CONNECTION_CHANGED'):self.m.verify_execution(id,'test-model')
        self.assertEqual(self.m.data['connections'][id]['status'],'disconnected')
    def test_disconnect_removes_secrets_and_preserves_other_accounts(self):
        a=self.connect();b=self.connect('oaiapp_work','bob');self.m.disconnect(a)
        for key in ['access_token','refresh_token','id_token']:self.assertNotIn(key,self.m.data['connections'][a])
        self.assertIn('access_token',self.m.data['connections'][b])
    def test_atomic_refresh_rotates_selected_credentials(self):
        id=self.connect();self.clock+=3600;self.m.models(id)
        row=self.m.data['connections'][id];self.assertEqual(row['access_token'],'rotated-fake');self.assertEqual(row['refresh_token'],'rotated-refresh-fake')
    def test_browser_metadata_never_exposes_credentials_or_subject(self):
        self.connect();public=json.dumps(self.m.public())
        for s in ['access_token','refresh_token','id_token','FAKE-','alice','client_id']:self.assertNotIn(s,public)
    def test_restart_preserves_identity_but_not_verified_execution(self):
        id=self.connect();self.m.verify_execution(id,'test-model');host=self.m.data['hostId'];self.store.close()
        self.store=PrivateStore(self.root);m=AccountManager(self.store,self.http)
        self.assertEqual(m.data['hostId'],host);self.assertEqual(m.data['connections'][id]['status'],'authenticated');self.assertEqual(m.pending,{})
    def test_second_process_and_unsafe_store_rejected(self):
        with self.assertRaisesRegex(AccountError,'ALREADY_RUNNING'):PrivateStore(self.root)
        if os.name!='nt':
            self.assertEqual(stat.S_IMODE(self.store.path.stat().st_mode),0o600)
            other=Path(self.temp.name)/'unsafe';other.mkdir(mode=0o755)
            with self.assertRaisesRegex(AccountError,'PERMISSIONS'):PrivateStore(other)
    def test_nonloopback_callbacks_and_blank_labels_rejected(self):
        for uri in ['http://localhost:1234/auth/callback','https://example.org/auth/callback','http://127.0.0.1:1234/callback']:
            with self.assertRaises(AccountError):self.m.begin(uri,'test')
        with self.assertRaises(AccountError):self.attempt('')
if __name__=='__main__':unittest.main()
