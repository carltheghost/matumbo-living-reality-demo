"""No real provider credentials or writes."""
import json
from pathlib import Path
import sys
import threading
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'server/accounts'))
from github_agent import GitHubReadBroker
from github_branch import GitHubBranchBroker,GitHubBranchHTTP
from oauth import AccountError

HEAD='a'*40
REPO='owner/repo'
class Reader:
    def __init__(self):
        self.sha=HEAD;self.fork=False;self.closed=False;self.observed=None;self.calls=[]
    def get(self,path):
        self.calls.append(path)
        if '/pulls/' in path:
            return {'number':7,'head':{'sha':self.sha,'repo':{'full_name':'fork/repo' if self.fork else REPO}},'base':{'repo':{'full_name':REPO}},'state':'closed' if self.closed else 'open'}
        if '/git/ref/' in path and self.observed is not None:
            return {'ref':'refs/'+path.split('/git/ref/')[1],'object':{'type':'commit','sha':self.observed}}
        raise AccountError('GITHUB_NOT_FOUND')
class Writer:
    def __init__(self):self.calls=[];self.mode='ok';self.hold=None
    def create(self,repo,ref,sha):
        self.calls.append((repo,ref,sha))
        if self.hold:self.hold.wait(2)
        if self.mode=='lost':raise OSError('response lost')
        return {'ref':ref,'object':{'type':'commit','sha':sha if self.mode=='ok' else 'b'*40}}
class BranchTests(unittest.TestCase):
    def setUp(self):
        self.clock=100;self.read=Reader();self.write=Writer()
        self.reader=GitHubReadBroker([REPO],http=self.read)
        self.b=GitHubBranchBroker(self.reader,[REPO],http=self.write,now=lambda:self.clock)
        self.spec={'repository':REPO,'pullNumber':7,'expectedHeadSha':HEAD,'slug':'repair-tests'}
    def preview(self):return self.b.preview(self.spec)
    def run_preview(self,p):return self.b.execute({'reviewId':p['reviewId'],'confirmation':p['ref']})
    def error(self,code,fn):
        with self.assertRaises(AccountError) as e:fn()
        self.assertEqual(e.exception.code,code)
    def test_disabled_by_default_and_write_allowlist_is_subset(self):
        b=GitHubBranchBroker(self.reader)
        self.error('GITHUB_BRANCH_WRITE_DISABLED',lambda:b.preview(self.spec))
        self.error('GITHUB_BRANCH_ALLOWLIST_MISMATCH',lambda:GitHubBranchBroker(self.reader,['other/repo'],http=self.write))
        self.assertFalse(b.status()['configured']);self.assertEqual(self.read.calls,[]);self.assertEqual(self.write.calls,[])
    def test_preview_is_read_only_and_exact_confirmation_single_use(self):
        p=self.preview();self.assertRegex(p['ref'],r'^refs/heads/vivo/agent/repair-tests-[a-f0-9]{16}$')
        self.assertEqual(self.write.calls,[]);self.assertEqual(self.b.status()['receipts'],[])
        self.error('GITHUB_BRANCH_CONFIRMATION_MISMATCH',lambda:self.b.execute({'reviewId':p['reviewId'],'confirmation':'refs/heads/main'}))
        r=self.run_preview(p)
        self.assertEqual(r['state'],'created');self.assertFalse(r['codeApplied']);self.assertFalse(r['authorizesAction'])
        self.assertEqual(self.write.calls,[(REPO,p['ref'],HEAD)])
        self.error('GITHUB_BRANCH_REVIEW_STALE',lambda:self.run_preview(p))
    def test_invalid_slug_and_changed_head_are_not_dispatched(self):
        for slug in ['main/other','../x','-start','end-','a'*41]:
            self.error('GITHUB_BRANCH_SLUG_INVALID',lambda:self.b.preview({**self.spec,'slug':slug}))
        p=self.preview();self.read.sha='b'*40
        r=self.run_preview(p);self.assertEqual(r['state'],'not-dispatched');self.assertEqual(r['reason'],'GITHUB_HEAD_CHANGED')
        self.assertEqual(self.write.calls,[])
    def test_expiry_and_closed_or_fork_source_reject(self):
        p=self.preview();self.clock+=301
        self.error('GITHUB_BRANCH_REVIEW_STALE',lambda:self.run_preview(p))
        self.read.fork=True;self.error('GITHUB_BRANCH_SOURCE_UNAVAILABLE',self.preview)
        self.read.fork=False;self.read.closed=True;self.error('GITHUB_BRANCH_SOURCE_UNAVAILABLE',self.preview)
        self.assertEqual(self.write.calls,[])
    def test_lost_response_reconciles_exact_ref_without_retry(self):
        p=self.preview();self.write.mode='lost'
        r=self.run_preview(p);self.assertEqual(r['state'],'uncertain')
        self.error('GITHUB_BRANCH_REVIEW_STALE',lambda:self.run_preview(p))
        self.assertEqual(self.b.reconcile({'reviewId':p['reviewId']})['state'],'uncertain')
        self.read.observed=HEAD
        r=self.b.reconcile({'reviewId':p['reviewId']})
        self.assertEqual(r['state'],'observed-matching');self.assertEqual(r['reason'],'OBSERVATION_NOT_CREATION_PROOF')
        self.read.observed='c'*40;self.assertEqual(self.b.reconcile({'reviewId':p['reviewId']})['state'],'observed-different')
        self.assertEqual(len(self.write.calls),1)
    def test_identity_mismatch_after_post_is_uncertain(self):
        p=self.preview();self.write.mode='wrong';self.assertEqual(self.run_preview(p)['state'],'uncertain')
        self.assertEqual(len(self.write.calls),1)
    def test_concurrent_approval_claims_once(self):
        p=self.preview();self.write.hold=threading.Event();results=[]
        worker=threading.Thread(target=lambda:results.append(self.run_preview(p)));worker.start()
        try:
            for _ in range(1000):
                if self.write.calls:break
                threading.Event().wait(.001)
            self.assertTrue(self.write.calls)
            self.error('GITHUB_BRANCH_REVIEW_STALE',lambda:self.run_preview(p))
        finally:self.write.hold.set();worker.join(3)
        self.assertEqual(len(self.write.calls),1);self.assertEqual(results[0]['state'],'created')
    def test_fixed_http_endpoint_and_create_only_payload(self):
        class Response:
            status=201
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return b'{"ok":true}'
        ref='refs/heads/vivo/agent/test-'+'a'*16
        class Opener:
            def open(self,request,timeout):
                assert request.full_url=='https://api.github.com/repos/owner/repo/git/refs'
                assert request.get_method()=='POST' and timeout==15
                assert json.loads(request.data)=={'ref':ref,'sha':HEAD}
                return Response()
        http=GitHubBranchHTTP('fake-test-token');http._opener=Opener()
        self.assertEqual(http.create(REPO,ref,HEAD),{'ok':True})
        self.error('GITHUB_BRANCH_REF_INVALID',lambda:http.create(REPO,'refs/heads/main',HEAD))
if __name__=='__main__':unittest.main()
