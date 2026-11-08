"""Serve the EXISTING Vivo web tree with opt-in local account endpoints.

Usage: python services/vivo/server/accounts/host.py --repo .
No global CLI credential files or user worlds are modified. This is a local
host integration, not a public Pages deployment or browser-policy workaround.
"""
from __future__ import annotations
import argparse
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json
import mimetypes
import os
from pathlib import Path
import secrets
import time
from urllib.parse import urlsplit, parse_qs, unquote
import webbrowser
from oauth import AccountManager, AccountError, PrivateStore

PHONE='/services/vivo/web/phone/index.html'
API='/api/vivo/accounts'
ALLOWED_PREFIXES=('services/vivo/web/','services/vivo/contracts/','research/vivo-phase-fabric/web/','vendor/field-lab/')
ALLOWED_SUFFIXES={'.html','.css','.js','.mjs','.json','.png','.jpg','.svg','.webp','.wasm','.task'}

class AccountHost(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,repo,manager,port=0):
        self.repo=Path(repo).resolve(strict=True);self.manager=manager
        self.launch=secrets.token_urlsafe(32);self.cookie=secrets.token_urlsafe(32);self.launch_expires=time.monotonic()+300
        super().__init__(('127.0.0.1',port),Handler)
        self.origin=f'http://127.0.0.1:{self.server_port}'
    @property
    def launch_url(self):return self.origin+'/vivo-session?token='+self.launch

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass  # callback codes, tokens, and launch capabilities never enter access logs
    def send(self,status,body,ctype='application/json',headers=None):
        data=body if isinstance(body,bytes) else json.dumps(body).encode()
        self.send_response(status);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer');self.send_header('X-Frame-Options','DENY')
        for k,v in (headers or {}).items():self.send_header(k,v)
        self.end_headers();self.wfile.write(data)
    def valid_host(self):return self.headers.get('Host')==urlsplit(self.server.origin).netloc
    def authorized(self):
        try:
            cookies=SimpleCookie(self.headers.get('Cookie',''));value=cookies['vivo_account_host'].value
            return secrets.compare_digest(value,self.server.cookie)
        except Exception:return False
    def fail(self,code,status=400):self.send(status,{'error':code})
    def do_GET(self):
        if not self.valid_host():return self.fail('HOST_MISMATCH',403)
        parts=urlsplit(self.path)
        if parts.path=='/vivo-session':
            values=parse_qs(parts.query)
            supplied=values.get('token',[''])[0]
            if not self.server.launch or time.monotonic()>self.server.launch_expires or not secrets.compare_digest(supplied,self.server.launch):
                return self.fail('INVALID_LAUNCH_SESSION',403)
            self.server.launch=None
            return self.send(303,b'',headers={'Location':PHONE,'Set-Cookie':f'vivo_account_host={self.server.cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800'})
        if parts.path=='/auth/callback':
            if not self.authorized():return self.fail('LOCAL_SESSION_REQUIRED',403)
            try:
                values=parse_qs(parts.query,keep_blank_values=True)
                if any(len(v)!=1 for v in values.values()):raise AccountError('DUPLICATE_CALLBACK_PARAMETER')
                self.server.manager.complete({k:v[0] for k,v in values.items()})
                return self.send(303,b'',headers={'Location':PHONE+'?vivo-signin=complete#vivo-ai-accounts'})
            except AccountError as e:
                return self.send(400,('Sign-in was not accepted: '+e.code+'. Return to Vivo and start a fresh attempt.').encode(),'text/plain; charset=utf-8')
            except Exception:return self.fail('SIGN_IN_FAILED')
        if parts.path==API:
            if not self.authorized():return self.fail('LOCAL_SESSION_REQUIRED',401)
            return self.send(200,self.server.manager.public())
        if parts.path.startswith('/api/') or parts.path.startswith('/auth/'):
            return self.fail('NOT_FOUND',404)
        # Never serve credential files, .git, server sources, or arbitrary filesystem paths.
        relative=unquote(parts.path).lstrip('/')
        if relative=='':relative=PHONE.lstrip('/')
        path=(self.server.repo/relative).resolve()
        if not any(relative.startswith(p) for p in ALLOWED_PREFIXES) or path.suffix not in ALLOWED_SUFFIXES or not path.is_relative_to(self.server.repo) or not path.is_file():
            return self.fail('NOT_FOUND',404)
        ctype='text/javascript' if path.suffix in {'.js','.mjs'} else mimetypes.guess_type(path)[0] or 'application/octet-stream'
        self.send(200,path.read_bytes(),ctype)
    def do_POST(self):
        if not self.valid_host() or not self.authorized():return self.fail('LOCAL_SESSION_REQUIRED',403)
        if self.headers.get('Origin')!=self.server.origin or self.headers.get('X-Vivo-Action')!='user' or self.headers.get('Content-Type')!='application/json':
            return self.fail('ORIGIN_OR_ACTION_MISMATCH',403)
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=8192:raise AccountError('REQUEST_BOUND')
            data=json.loads(self.rfile.read(size))
            if not isinstance(data,dict):raise AccountError('INVALID_REQUEST')
            path=urlsplit(self.path).path;manager=self.server.manager
            if path==API+'/login':
                result=manager.begin(self.server.origin+'/auth/callback',data.get('label'),data.get('connectionId'))
            elif path==API+'/default':
                manager.select_default(data.get('connectionId'));result=manager.public()
            elif path==API+'/models':result={'models':manager.models(data.get('connectionId'))}
            elif path==API+'/verify':
                if data.get('consent') is not True:raise AccountError('EXECUTION_CONSENT_REQUIRED')
                result=manager.verify_execution(data.get('connectionId'),data.get('model'))
            elif path==API+'/disconnect':result=manager.disconnect(data.get('connectionId'))
            else:return self.fail('NOT_FOUND',404)
            self.send(200,result)
        except AccountError as e:self.fail(e.code)
        except (ValueError,TypeError):self.fail('INVALID_REQUEST')
        except Exception:self.fail('ACCOUNT_OPERATION_FAILED')

def main():
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[4])
    p.add_argument('--state',type=Path,default=Path.home()/'.vivo-account-host');p.add_argument('--port',type=int,default=0)
    p.add_argument('--no-open',action='store_true');args=p.parse_args()
    repo=args.repo.resolve(strict=True);state=args.state.absolute()
    if state.resolve().is_relative_to(repo):raise AccountError('CREDENTIALS_MUST_BE_OUTSIDE_WEB_REPOSITORY')
    store=PrivateStore(state)
    try:
        manager=AccountManager(store);server=AccountHost(repo,manager,args.port)
        print('Vivo local accounts host. User sign-in remains on the official provider page.')
        print('Open this one-time local session link in your browser (do not share it):',server.launch_url,flush=True)
        if not args.no_open:webbrowser.open(server.launch_url)
        try:server.serve_forever()
        finally:server.server_close()
    finally:store.close()
if __name__=='__main__':main()
