"""Bounded GitHub broker tests with synthetic provider data; no real token."""
import base64
import json
from pathlib import Path
import sys
import unittest
from urllib.parse import urlsplit,parse_qs
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server/accounts'))
from github_agent import GitHubReadBroker,GitHubHTTP,normalize_path,normalize_repo
from oauth import AccountError

HEAD='a'*40
REPO='owner/repo'
class Fake:
    def __init__(self):
        self.calls=[];self.sha=HEAD;self.fork=False;self.wrong_run=False;self.size=8;self.binary=False;self.partial=False
    def get(self,path):
        self.calls.append(path)
        if '/pulls/' in path:
            return {'number':7,'head':{'sha':self.sha,'repo':{'full_name':'fork/repo' if self.fork else REPO}},'base':{'repo':{'full_name':REPO}},'title':'Fixture','state':'open','draft':True,'merged':False,'body':'unshared raw body'}
        if '/actions/runs?' in path:
            return {'total_count':31 if self.partial else 1,'workflow_runs':[{'id':19,'name':'Checks','head_sha':'c'*40 if self.wrong_run else self.sha,'status':'completed','conclusion':'success'}]}
        if '/contents/' in path:
            return {'type':'file','path':'src/main.py','encoding':'base64','size':self.size,'content':base64.b64encode(b'\x00'*8 if self.binary else b'print(1)').decode(),'sha':'b'*40}
        raise AssertionError(path)

class GitHubBrokerTests(unittest.TestCase):
    def setUp(self):
        self.http=Fake();self.broker=GitHubReadBroker([REPO],http=self.http);self.payload={'repository':REPO,'pullNumber':7}
    def error(self,code,fn):
        with self.assertRaises(AccountError) as e:fn()
        self.assertEqual(e.exception.code,code)
    def test_configuration_is_not_live_verification_and_default_does_not_contact_github(self):
        self.assertTrue(self.broker.status()['configured']);self.assertFalse(self.broker.status()['liveAccessVerified'])
        self.assertEqual(self.http.calls,[])
        self.assertFalse(GitHubReadBroker().status()['configured'])
        self.error('GITHUB_CONNECTOR_NOT_CONFIGURED',lambda:GitHubReadBroker([REPO]).inspect(self.payload))
    def test_review_pins_workflows_and_redacts_unused_provider_fields(self):
        r=self.broker.inspect(self.payload)
        self.assertEqual(r['headSha'],HEAD);self.assertTrue(r['draft']);self.assertFalse(r['authorizesAction'])
        self.assertEqual(parse_qs(urlsplit(self.http.calls[1]).query),{'head_sha':[HEAD],'per_page':['30'],'page':['1']})
        self.assertEqual(r['workflows'][0]['id'],19);self.assertNotIn('unshared raw body',json.dumps(r))
        self.http.partial=True;self.assertFalse(self.broker.inspect(self.payload)['workflowPageComplete'])
    def test_allowlist_and_invalid_request_fields_fail_before_network(self):
        self.error('GITHUB_REPOSITORY_NOT_ALLOWED',lambda:self.broker.inspect({**self.payload,'repository':'private/other'}))
        self.error('GITHUB_REQUEST_INVALID',lambda:self.broker.inspect({**self.payload,'url':'https://evil.invalid'}))
        self.error('GITHUB_PULL_INVALID',lambda:self.broker.inspect({**self.payload,'pullNumber':True}))
        self.assertEqual(self.http.calls,[])
    def test_exact_head_and_workflow_identity_are_checked(self):
        self.http.sha='d'*40
        self.error('GITHUB_HEAD_CHANGED',lambda:self.broker.inspect({**self.payload,'expectedHeadSha':HEAD}))
        self.assertEqual(len(self.http.calls),1)
        self.http.wrong_run=True
        self.error('GITHUB_RESPONSE_IDENTITY_MISMATCH',lambda:self.broker.inspect(self.payload))
    def test_file_returns_bounded_utf8_and_pins_commit(self):
        r=self.broker.read_file({**self.payload,'expectedHeadSha':HEAD,'path':'src/main.py'})
        self.assertEqual(r['content'],'print(1)');self.assertEqual(r['blobSha'],'b'*40)
        self.assertEqual(parse_qs(urlsplit(self.http.calls[-1]).query),{'ref':[HEAD]})
        self.http.size=32769
        self.error('GITHUB_FILE_BOUND',lambda:self.broker.read_file({**self.payload,'expectedHeadSha':HEAD,'path':'src/main.py'}))
        self.http.size=8;self.http.binary=True
        self.error('GITHUB_FILE_NOT_TEXT',lambda:self.broker.read_file({**self.payload,'expectedHeadSha':HEAD,'path':'src/main.py'}))
    def test_fork_source_and_traversal_are_denied(self):
        self.http.fork=True
        self.error('GITHUB_FORK_FILE_UNAVAILABLE',lambda:self.broker.read_file({**self.payload,'expectedHeadSha':HEAD,'path':'src/main.py'}))
        self.assertEqual(len(self.http.calls),1)
        for path in ['../secret','/root','a//b','a\\b','a/\x00']:
            self.error('GITHUB_PATH_INVALID',lambda:normalize_path(path))
        for name in ['https://github.com/owner/repo','owner/..','owner/repo/extra']:
            self.error('GITHUB_REPOSITORY_INVALID',lambda:normalize_repo(name))
    def test_http_only_uses_fixed_origin_get_and_never_returns_auth_header(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return b'{"ok":true}'
        class Opener:
            def open(self,request,timeout):
                assert request.full_url=='https://api.github.com/repos/owner/repo/pulls/7'
                assert request.get_method()=='GET' and timeout==15
                assert request.get_header('Authorization')=='Bearer fake-test-token'
                return Response()
        http=GitHubHTTP('fake-test-token');http._opener=Opener()
        self.assertEqual(http.get('/repos/owner/repo/pulls/7'),{'ok':True})
        self.error('GITHUB_ENDPOINT_INVALID',lambda:http.get('https://evil.invalid'))
if __name__=='__main__':unittest.main()
