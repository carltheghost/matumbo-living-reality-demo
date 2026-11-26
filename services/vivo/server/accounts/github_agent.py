"""Opt-in GitHub repository reading through a fixed-origin, bounded local broker."""
from __future__ import annotations
import base64
import json
import re
from urllib.parse import quote, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
from oauth import AccountError

_REPO = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}\Z")
_SHA = re.compile(r"[a-f0-9]{40}\Z")
_MAX_RESPONSE = 2_000_000
_MAX_FILE = 32768

def require(ok, code):
    if not ok:
        raise AccountError(code)

def normalize_repo(value):
    require(isinstance(value, str) and bool(_REPO.fullmatch(value)) and value.split("/")[1] not in {".",".."}, "GITHUB_REPOSITORY_INVALID")
    return value.lower()

def normalize_pull(value):
    require(type(value) is int and 0 < value <= 2147483647, "GITHUB_PULL_INVALID")
    return value

def normalize_sha(value):
    require(isinstance(value, str) and bool(_SHA.fullmatch(value)), "GITHUB_SHA_INVALID")
    return value

def normalize_path(value):
    require(isinstance(value, str) and 0 < len(value) <= 512 and not any(ord(c) < 32 or ord(c) == 127 for c in value)
            and "\\" not in value and all(s not in {"", ".", ".."} for s in value.split("/")), "GITHUB_PATH_INVALID")
    return value

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise AccountError("GITHUB_REDIRECT_REJECTED")

class GitHubHTTP:
    def __init__(self, token):
        self._token = token
        self._opener = build_opener(NoRedirect())
    def get(self, path):
        # Only internally constructed relative REST endpoints reach this method.
        require(path.startswith("/repos/") and not path.startswith("//"), "GITHUB_ENDPOINT_INVALID")
        request = Request("https://api.github.com" + path, method="GET", headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + self._token,
            "User-Agent": "Vivo-local-repository-agent",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        try:
            with self._opener.open(request, timeout=15) as response:
                raw = response.read(_MAX_RESPONSE + 1)
                require(len(raw) <= _MAX_RESPONSE, "GITHUB_RESPONSE_BOUND")
                return json.loads(raw)
        except HTTPError as error:
            raise AccountError({401:"GITHUB_AUTH_REQUIRED",403:"GITHUB_ACCESS_DENIED_OR_RATE_LIMIT",404:"GITHUB_NOT_FOUND",429:"GITHUB_RATE_LIMIT"}.get(error.code,"GITHUB_HTTP_ERROR")) from None
        except (URLError, TimeoutError, OSError):
            raise AccountError("GITHUB_NETWORK_UNAVAILABLE") from None
        except (ValueError, TypeError):
            raise AccountError("GITHUB_RESPONSE_INVALID") from None

def text(value, limit=160):
    return value[:limit] if isinstance(value,str) else None

def obj(value):
    require(isinstance(value,dict), "GITHUB_RESPONSE_INVALID")
    return value

class GitHubReadBroker:
    """The repository allowlist is a host boundary; the browser agent grant is local role separation."""
    def __init__(self, repositories=(), token=None, http=None):
        require(len(repositories) <= 8, "GITHUB_REPOSITORY_LIMIT")
        self.repositories = frozenset(normalize_repo(r) for r in repositories)
        require(token is None or (isinstance(token,str) and 0 < len(token) <= 4096 and not any(c.isspace() for c in token)), "GITHUB_TOKEN_INVALID")
        self.http = http if http is not None else GitHubHTTP(token) if token and self.repositories else None
    def status(self):
        return {"schema":"vivo.github-connector/1","configured":bool(self.http and self.repositories),
                "repositories":sorted(self.repositories),"liveAccessVerified":False,"readOnly":True}
    def _repo(self, repository):
        repo = normalize_repo(repository)
        require(repo in self.repositories, "GITHUB_REPOSITORY_NOT_ALLOWED")
        require(self.http is not None, "GITHUB_CONNECTOR_NOT_CONFIGURED")
        return repo
    def _pull(self, repo, number, expected=None):
        row=obj(self.http.get("/repos/"+repo+"/pulls/"+str(number)))
        head=obj(row.get("head"));base=obj(row.get("base"))
        require(type(row.get("number")) is int and row["number"]==number and normalize_repo(obj(base.get("repo")).get("full_name"))==repo,"GITHUB_RESPONSE_IDENTITY_MISMATCH")
        sha=normalize_sha(head.get("sha"))
        if expected is not None:
            require(sha==normalize_sha(expected),"GITHUB_HEAD_CHANGED")
        head_repo=head.get("repo")
        same_repo=isinstance(head_repo,dict) and isinstance(head_repo.get("full_name"),str) and head_repo["full_name"].lower()==repo
        return row,sha,same_repo
    def inspect(self, data):
        require(set(data) in ({"repository","pullNumber"},{"repository","pullNumber","expectedHeadSha"}),"GITHUB_REQUEST_INVALID")
        repo=self._repo(data["repository"]);number=normalize_pull(data["pullNumber"])
        expected=normalize_sha(data["expectedHeadSha"]) if "expectedHeadSha" in data else None
        row,sha,same_repo=self._pull(repo,number,expected)
        workflows=obj(self.http.get("/repos/"+repo+"/actions/runs?"+urlencode({"head_sha":sha,"per_page":30,"page":1})))
        runs=workflows.get("workflow_runs");total=workflows.get("total_count")
        require(isinstance(runs,list) and len(runs)<=30 and type(total) is int and total>=len(runs),"GITHUB_RESPONSE_INVALID")
        results=[]
        for run in runs:
            run=obj(run);require(run.get("head_sha")==sha and type(run.get("id")) is int and run["id"]>0,"GITHUB_RESPONSE_IDENTITY_MISMATCH")
            results.append({"id":run["id"],"name":text(run.get("name")),"status":text(run.get("status"),32),"conclusion":text(run.get("conclusion"),32),
                            "url":"https://github.com/"+repo+"/actions/runs/"+str(run["id"])})
        return {"schema":"vivo.github-pull-review/1","repository":repo,"pullNumber":number,"headSha":sha,
                "sameRepositoryHead":same_repo,"title":text(row.get("title"),256),"state":text(row.get("state"),20),
                "draft":row.get("draft") is True,"merged":row.get("merged") is True,
                "url":"https://github.com/"+repo+"/pull/"+str(number),"workflowTotal":total,
                "workflowPageComplete":total==len(results),"workflows":results,"readOnly":True,"authorizesAction":False}
    def read_file(self,data):
        require(set(data)=={"repository","pullNumber","expectedHeadSha","path"},"GITHUB_REQUEST_INVALID")
        repo=self._repo(data["repository"]);number=normalize_pull(data["pullNumber"]);sha=normalize_sha(data["expectedHeadSha"]);path=normalize_path(data["path"])
        _,_,same_repo=self._pull(repo,number,sha)
        require(same_repo,"GITHUB_FORK_FILE_UNAVAILABLE")
        row=obj(self.http.get("/repos/"+repo+"/contents/"+quote(path,safe="/")+"?"+urlencode({"ref":sha})))
        require(row.get("type")=="file" and row.get("path")==path and row.get("encoding")=="base64","GITHUB_FILE_NOT_TEXT")
        size=row.get("size");encoded=row.get("content")
        require(type(size) is int and 0<=size<=_MAX_FILE and isinstance(encoded,str) and len(encoded)<=_MAX_FILE*2,"GITHUB_FILE_BOUND")
        try:
            raw=base64.b64decode("".join(encoded.split()),validate=True)
            require(len(raw)==size and b"\0" not in raw,"GITHUB_FILE_NOT_TEXT")
            content=raw.decode("utf-8")
        except (ValueError,UnicodeError):
            raise AccountError("GITHUB_FILE_NOT_TEXT") from None
        return {"schema":"vivo.github-file/1","repository":repo,"pullNumber":number,"headSha":sha,"path":path,"size":size,
                "blobSha":normalize_sha(row.get("sha")),"content":content,"readOnly":True,"authorizesAction":False}
