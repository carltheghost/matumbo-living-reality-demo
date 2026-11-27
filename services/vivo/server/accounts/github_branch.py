"""Explicit owner-approved creation of new development refs only.

This is not an arbitrary GitHub write proxy. The read broker and separate
branch credential have distinct responsibilities. Receipts are process-local.
"""
from __future__ import annotations
import json
import re
import secrets
import threading
import time
from urllib.parse import quote
from urllib.request import Request, build_opener
from github_agent import NoRedirect, require, normalize_repo, normalize_pull, normalize_sha, obj
from oauth import AccountError

SLUG = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?\Z")
REF = re.compile(r"refs/heads/vivo/agent/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?-[a-f0-9]{16}\Z")
TTL = 300
LIMIT = 32

class GitHubBranchHTTP:
    def __init__(self, token):
        require(isinstance(token,str) and 0<len(token)<=4096 and not any(c.isspace() for c in token),"GITHUB_BRANCH_TOKEN_INVALID")
        self._token=token
        self._opener=build_opener(NoRedirect())

    def create(self, repository, ref, sha):
        repo=normalize_repo(repository)
        require(isinstance(ref,str) and bool(REF.fullmatch(ref)),"GITHUB_BRANCH_REF_INVALID")
        sha=normalize_sha(sha)
        request=Request("https://api.github.com/repos/"+repo+"/git/refs",method="POST",
            data=json.dumps({"ref":ref,"sha":sha}).encode(),headers={
                "Accept":"application/vnd.github+json","Content-Type":"application/json",
                "Authorization":"Bearer "+self._token,"User-Agent":"Vivo-local-branch-owner",
                "X-GitHub-Api-Version":"2022-11-28"})
        # Once dispatch starts, any HTTP/transport/identity failure is treated
        # conservatively by the broker as uncertain; no retries are performed.
        with self._opener.open(request,timeout=15) as response:
            require(response.status==201,"GITHUB_BRANCH_RESPONSE_INVALID")
            raw=response.read(65537);require(len(raw)<=65536,"GITHUB_BRANCH_RESPONSE_INVALID")
            return json.loads(raw)

class GitHubBranchBroker:
    def __init__(self,reader,repositories=(),token=None,http=None,now=time.monotonic):
        self.reader=reader
        self.repositories=frozenset(normalize_repo(r) for r in repositories)
        require(self.repositories.issubset(reader.repositories),"GITHUB_BRANCH_ALLOWLIST_MISMATCH")
        self.http=http if http is not None else GitHubBranchHTTP(token) if token and self.repositories else None
        self.now=now;self.lock=threading.Lock();self.rows={}
    def _enabled(self,repo):
        require(repo in self.repositories and self.http is not None and self.reader.http is not None,"GITHUB_BRANCH_WRITE_DISABLED")
    def _pr(self,repo,number,sha):
        row,actual,same_repo=self.reader._pull(repo,number,sha)
        require(same_repo and row.get("state")=="open" and row.get("merged") is not True,"GITHUB_BRANCH_SOURCE_UNAVAILABLE")
        return actual
    def _view(self,row):
        return {k:row[k] for k in ("reviewId","repository","pullNumber","headSha","ref","state","reason","observedSha")} | {
            "schema":"vivo.github-branch-receipt/1","authorizesAction":False,"codeApplied":False,
            "url":"https://github.com/"+row["repository"]+"/tree/"+quote(row["ref"][len("refs/heads/"):],safe="/")}
    def _expire(self):
        for key,row in list(self.rows.items()):
            if row["state"]=="reviewed" and self.now()>=row["expires"]:del self.rows[key]
    def status(self):
        with self.lock:
            self._expire()
            return {"schema":"vivo.github-branch-status/1","configured":bool(self.http and self.repositories and self.reader.http),
                "repositories":sorted(self.repositories),"receipts":[self._view(r) for r in self.rows.values() if r["state"]!="reviewed"],
                "authorizesAction":False,"processLocal":True}
    def preview(self,data):
        require(set(data)=={"repository","pullNumber","expectedHeadSha","slug"},"GITHUB_BRANCH_REQUEST_INVALID")
        repo=self.reader._repo(data["repository"]);self._enabled(repo)
        number=normalize_pull(data["pullNumber"]);sha=normalize_sha(data["expectedHeadSha"]);slug=data["slug"]
        require(isinstance(slug,str) and bool(SLUG.fullmatch(slug)),"GITHUB_BRANCH_SLUG_INVALID")
        self._pr(repo,number,sha)
        with self.lock:
            self._expire()
            require(len(self.rows)<LIMIT,"GITHUB_BRANCH_REVIEW_CAPACITY")
            review_id=secrets.token_urlsafe(24)
            ref="refs/heads/vivo/agent/"+slug+"-"+secrets.token_hex(8)
            row={"reviewId":review_id,"repository":repo,"pullNumber":number,"headSha":sha,"ref":ref,
                "expires":self.now()+TTL,"state":"reviewed","reason":None,"observedSha":None}
            self.rows[review_id]=row
            return self._view(row)|{"schema":"vivo.github-branch-preview/1","expiresInSeconds":TTL,
                "requiresExactRefConfirmation":True,"mayTriggerWorkflows":True}
    def execute(self,data):
        require(set(data)=={"reviewId","confirmation"} and isinstance(data["reviewId"],str),"GITHUB_BRANCH_REQUEST_INVALID")
        with self.lock:
            self._expire()
            row=self.rows.get(data["reviewId"])
            require(row is not None and row["state"]=="reviewed","GITHUB_BRANCH_REVIEW_STALE")
            require(data["confirmation"]==row["ref"],"GITHUB_BRANCH_CONFIRMATION_MISMATCH")
            self._enabled(row["repository"])
            # Claim once before leaving the lock. Competing calls cannot submit.
            row["state"]="checking"
        try:
            self._pr(row["repository"],row["pullNumber"],row["headSha"])
            require(self.now()<row["expires"],"GITHUB_BRANCH_REVIEW_STALE")
        except Exception as error:
            with self.lock:
                row["state"]="not-dispatched";row["reason"]=error.code if isinstance(error,AccountError) else "GITHUB_BRANCH_PREFLIGHT_FAILED"
                return self._view(row)
        with self.lock:row["state"]="dispatching"
        try:
            value=obj(self.http.create(row["repository"],row["ref"],row["headSha"]))
            target=obj(value.get("object"))
            require(value.get("ref")==row["ref"] and target.get("type")=="commit" and target.get("sha")==row["headSha"],"GITHUB_BRANCH_RESPONSE_IDENTITY_MISMATCH")
        except Exception:
            with self.lock:
                row["state"]="uncertain";row["reason"]="GITHUB_BRANCH_RESULT_UNCONFIRMED"
                return self._view(row)
        with self.lock:
            row["state"]="created";row["observedSha"]=row["headSha"]
            return self._view(row)
    def reconcile(self,data):
        require(set(data)=={"reviewId"} and isinstance(data["reviewId"],str),"GITHUB_BRANCH_REQUEST_INVALID")
        with self.lock:
            row=self.rows.get(data["reviewId"])
            require(row is not None and row["state"] in {"uncertain","observed-matching","observed-different"},"GITHUB_BRANCH_RECONCILE_UNAVAILABLE")
            repo,ref,expected=row["repository"],row["ref"],row["headSha"]
        try:
            # Exact GET, not matching-refs and never a write/retry. Missing ref
            # or failed read is not proof that the original request failed.
            value=obj(self.reader.http.get("/repos/"+repo+"/git/ref/"+quote(ref[len("refs/"):],safe="/")))
            target=obj(value.get("object"))
            require(value.get("ref")==ref and target.get("type")=="commit","GITHUB_BRANCH_RESPONSE_IDENTITY_MISMATCH")
            observed=normalize_sha(target.get("sha"))
        except Exception:
            with self.lock:
                row["reason"]="GITHUB_BRANCH_RECONCILIATION_UNAVAILABLE"
                return self._view(row)
        with self.lock:
            row["observedSha"]=observed;row["state"]="observed-matching" if observed==expected else "observed-different"
            row["reason"]="OBSERVATION_NOT_CREATION_PROOF"
            return self._view(row)
