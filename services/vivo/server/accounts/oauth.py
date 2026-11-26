"""Vivo-owned, local OSS ChatGPT login. Never serves credentials to the browser.

Follows the documented public-client flow; does not reuse Codex CLI auth files,
collect passwords, impersonate another client, or pool accounts to evade limits.
"""
from __future__ import annotations
import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import threading
import time
import uuid
from urllib.parse import urlencode, urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
import jwt

ISSUER = 'https://auth.openai.com'
AUTHORIZE = ISSUER + '/api/accounts/authorize'
TOKEN = ISSUER + '/api/accounts/oauth/token'
DISCOVERY = ISSUER + '/.well-known/openid-configuration'
RESOURCE = 'https://api.openai.com/v1'
SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'

class AccountError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code

def require(ok, code):
    if not ok:
        raise AccountError(code)

def dpapi(data: bytes, decrypt=False) -> bytes:
    """Current-user Windows DPAPI; password-free and not a portable token file."""
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    source, dest = Blob(len(data), buffer), Blob()
    fn = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(dest)):
        raise AccountError('OS_CREDENTIAL_PROTECTION_FAILED')
    try:
        return ctypes.string_at(dest.data, dest.size)
    finally:
        ctypes.windll.kernel32.LocalFree(dest.data)

class PrivateStore:
    """One local user, one host process. Refuses unsafe files instead of repairing permissions."""
    def __init__(self, root: Path):
        root = Path(root).absolute()
        require(not any(p.is_symlink() for p in [root, *root.parents]), 'SYMLINK_STORE')
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if os.name != 'nt':
            require(root.stat().st_uid == os.getuid() and stat.S_IMODE(root.stat().st_mode) & 0o077 == 0, 'UNSAFE_STORE_PERMISSIONS')
        self.root, self.path = root, root / 'accounts.private'
        self.lock_path = root / 'host.lock'
        try:
            fd = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            raise AccountError('ACCOUNT_HOST_ALREADY_RUNNING_OR_STALE_LOCK') from None
        with os.fdopen(fd, 'w') as f:
            f.write(str(os.getpid()))
        self.closed = False

    def load(self):
        if not self.path.exists():
            return {'version': 1, 'hostId': 'urn:uuid:' + str(uuid.uuid4()), 'connections': {}, 'default': None}
        require(not self.path.is_symlink() and self.path.stat().st_size <= 2_000_000, 'INVALID_STORE')
        if os.name != 'nt':
            require(self.path.stat().st_uid == os.getuid() and stat.S_IMODE(self.path.stat().st_mode) & 0o077 == 0, 'UNSAFE_STORE_PERMISSIONS')
        data = self.path.read_bytes()
        data = dpapi(data, True) if os.name == 'nt' else data
        result = json.loads(data)
        require(result.get('version') == 1 and isinstance(result.get('connections'), dict) and
                str(uuid.UUID(result.get('hostId', '')[9:])) == result['hostId'][9:] and result['hostId'].startswith('urn:uuid:'), 'INVALID_STORE')
        return result

    def save(self, value):
        data = json.dumps(value, allow_nan=False, separators=(',', ':')).encode()
        if os.name == 'nt':
            data = dpapi(data)
        path = self.root / ('write.' + secrets.token_hex(12))
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, 'wb') as f:
                f.write(data); f.flush(); os.fsync(f.fileno())
            os.replace(path, self.path)
        finally:
            path.unlink(missing_ok=True)

    def close(self):
        if not self.closed:
            self.lock_path.unlink(missing_ok=True); self.closed = True

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise AccountError('UNEXPECTED_PROVIDER_REDIRECT')

class ProviderHTTP:
    """Fixed official hosts only; no browser token exposure and no automatic retries."""
    def __init__(self):
        self.opener = build_opener(NoRedirect())

    def request(self, method, url, *, form=None, body=None, token=None, stream=False):
        parsed = urlparse(url)
        require(parsed.scheme == 'https' and parsed.netloc in {'auth.openai.com', 'api.openai.com'} and
                not parsed.fragment and not parsed.username, 'UNTRUSTED_PROVIDER_URL')
        headers = {'Accept': 'text/event-stream' if stream else 'application/json'}
        data = None
        if form is not None:
            data = urlencode(form).encode(); headers['Content-Type'] = 'application/x-www-form-urlencoded'
        if body is not None:
            data = json.dumps(body).encode(); headers['Content-Type'] = 'application/json'
        if token:
            headers['Authorization'] = 'Bearer ' + token
        req = Request(url, method=method, data=data, headers=headers)
        try:
            with self.opener.open(req, timeout=20) as response:
                if stream:
                    events, size, deadline = [], 0, time.monotonic() + 45
                    for raw in response:
                        size += len(raw)
                        require(size <= 1_000_000 and time.monotonic() < deadline, 'PROVIDER_RESPONSE_BOUND')
                        line = raw.decode('utf8').strip()
                        if not line.startswith('data:') or line[5:].strip() == '[DONE]':
                            continue
                        event = json.loads(line[5:]); events.append(event)
                        if event.get('type') in {'response.completed', 'response.failed', 'response.incomplete', 'error'}:
                            break
                    return events
                raw = response.read(1_000_001)
                require(len(raw) <= 1_000_000, 'PROVIDER_RESPONSE_BOUND')
                return json.loads(raw) if raw else {}
        except HTTPError as e:
            raise AccountError({401:'REAUTH_REQUIRED',403:'ENTITLEMENT_UNAVAILABLE',429:'QUOTA_BLOCKED'}.get(e.code,'PROVIDER_HTTP_ERROR')) from None
        except (URLError, OSError, TimeoutError):
            raise AccountError('PROVIDER_NETWORK_UNAVAILABLE') from None
        except (ValueError, UnicodeError):
            raise AccountError('MALFORMED_PROVIDER_RESPONSE') from None

class OpenAIIdentity:
    def __init__(self, http): self.http = http
    def metadata(self):
        m = self.http.request('GET', DISCOVERY)
        require(m.get('issuer') == ISSUER, 'ISSUER_MISMATCH')
        for key in ['jwks_uri', 'revocation_endpoint']:
            p = urlparse(m.get(key, ''))
            require(p.scheme == 'https' and p.netloc == 'auth.openai.com' and not p.fragment, 'UNTRUSTED_IDENTITY_METADATA')
        return m
    def verify(self, encoded, client_id, nonce):
        try:
            header = jwt.get_unverified_header(encoded)
            require(header.get('alg') in {'RS256', 'ES256'}, 'UNSUPPORTED_SIGNATURE')
            keys = self.http.request('GET', self.metadata()['jwks_uri'])
            key = next(k for k in keys['keys'] if k.get('kid') == header.get('kid'))
            claims = jwt.decode(encoded, jwt.PyJWK.from_dict(key).key, algorithms=[header['alg']], audience=client_id,
                                issuer=ISSUER, options={'require':['exp','iat','iss','aud','sub','nonce']})
            require(isinstance(claims['sub'], str) and 0 < len(claims['sub']) <= 256 and
                    isinstance(claims['nonce'], str) and secrets.compare_digest(claims['nonce'], nonce), 'IDENTITY_NONCE_MISMATCH')
            if isinstance(claims['aud'],list) and len(claims['aud']) > 1:
                require(claims.get('azp') == client_id, 'AUTHORIZED_PARTY_MISMATCH')
            return claims
        except AccountError: raise
        except Exception: raise AccountError('INVALID_SIGNED_IDENTITY') from None

class AccountManager:
    def __init__(self, store, http=None, now=time.time):
        self.store, self.http, self.now = store, http or ProviderHTTP(), now
        self.identity = OpenAIIdentity(self.http)
        self.lock, self.pending, self.running = threading.RLock(), {}, set()
        self.data = store.load()
        # Restored tokens are credentials, not proof that a job or entitlement is still live.
        for c in self.data['connections'].values():
            if c.get('status') == 'execution_verified': c['status'] = 'authenticated'
        self.store.save(self.data)

    def _row(self, id):
        require(id in self.data['connections'], 'UNKNOWN_CONNECTION'); return self.data['connections'][id]
    def _save(self): self.store.save(self.data)
    def public(self):
        with self.lock:
            return {'schema':'vivo.accounts/1','default':self.data['default'], 'connections':[
                {k:c.get(k) for k in ['id','label','provider','status','generation','lastVerified','message','accountHint','registrationHint']}
                for c in self.data['connections'].values()]}
    def begin(self, redirect_uri, label, connection_id=None):
        p=urlparse(redirect_uri)
        require(p.scheme=='http' and p.hostname=='127.0.0.1' and p.port and p.path=='/auth/callback' and not p.query and not p.fragment, 'INVALID_CALLBACK')
        require(isinstance(label,str) and 1 <= len(label.strip()) <= 60 and all(ord(x)>=32 for x in label), 'INVALID_LABEL')
        with self.lock:
            self.pending={k:v for k,v in self.pending.items() if v['expires']>self.now()}
            require(len(self.pending)<8 and len(self.data['connections'])<32, 'CONNECTION_BOUND')
            old=self._row(connection_id) if connection_id else None
            if old:
                require(not any(v['id']==connection_id for v in self.pending.values()),'LOGIN_ALREADY_PENDING')
            state,nonce,verifier=secrets.token_urlsafe(32),secrets.token_urlsafe(32),secrets.token_urlsafe(48)
            self.pending[state]={'id':connection_id,'generation':old['generation'] if old else None,'label':label.strip(),
                'client':old['client_id'] if old else None,'nonce':nonce,'verifier':verifier,'redirect':redirect_uri,'expires':self.now()+300}
            params={'client_id':old['client_id'] if old else 'dynamic_agent_client','ext_agent_host_id':self.data['hostId'],
                'response_type':'code','redirect_uri':redirect_uri,'scope':SCOPES,'resource':RESOURCE,
                'state':state,'nonce':nonce,'code_challenge_method':'S256',
                'code_challenge':base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()}
            if not old: params['agent_name_hint']='Vivo'
            return {'authorizationUrl':AUTHORIZE+'?'+urlencode(params),'expiresIn':300,'status':'awaiting_user_login'}
    def complete(self, params):
        with self.lock:
            state=params.get('state'); attempt=self.pending.pop(state,None) if isinstance(state,str) else None
            require(attempt is not None and attempt['expires']>self.now(),'INVALID_EXPIRED_OR_REPLAYED_STATE')
        require(not params.get('error'),'PROVIDER_CONSENT_DENIED')
        client=params.get('client_id',attempt['client'])
        require(isinstance(client,str) and 1<len(client)<=256 and client!='dynamic_agent_client','MISSING_ISSUED_CLIENT')
        require(not attempt['client'] or client==attempt['client'],'REGISTRATION_MISMATCH')
        code=params.get('code');require(isinstance(code,str) and 0<len(code)<8192,'MISSING_CODE')
        token=self.http.request('POST',TOKEN,form={'grant_type':'authorization_code','client_id':client,'code':code,
            'code_verifier':attempt['verifier'],'redirect_uri':attempt['redirect'],'resource':RESOURCE})
        require(isinstance(token,dict) and isinstance(token.get('id_token'),str),'MISSING_ID_TOKEN')
        claims=self.identity.verify(token['id_token'],client,attempt['nonce'])
        require(isinstance(token.get('access_token'),str) and token.get('token_type','').lower()=='bearer','INVALID_ACCESS_TOKEN')
        lifetime=token.get('expires_in');require(type(lifetime) in (int,float) and 0<lifetime<=86400,'INVALID_TOKEN_EXPIRY')
        require(isinstance(token.get('scope'),str),'MISSING_GRANTED_SCOPE')
        scopes=token['scope'].split()
        with self.lock:
            if attempt['id']:
                old=self._row(attempt['id']);require(old['generation']==attempt['generation'],'CONNECTION_CHANGED_DURING_LOGIN')
                require(old['subject']==claims['sub'] and old['client_id']==client,'ACCOUNT_IDENTITY_MISMATCH')
                id=old['id'];generation=old['generation']+1
            else:
                # Subject AND issued client distinguish workspaces. Email is never identity.
                duplicate=next((c for c in self.data['connections'].values() if c['subject']==claims['sub'] and c['client_id']==client),None)
                require(duplicate is None,'ACCOUNT_ALREADY_ADDED_USE_RECONNECT')
                id='account.'+uuid.uuid4().hex;generation=1
            self.data['connections'][id]={'id':id,'label':attempt['label'],'provider':'openai','subject':claims['sub'],
                'client_id':client,'accountHint':('account '+hashlib.sha256(claims['sub'].encode()).hexdigest()[:8]),
                'registrationHint':hashlib.sha256(client.encode()).hexdigest()[:8],'generation':generation,'access_token':token['access_token'],'refresh_token':token.get('refresh_token'),
                'id_token':token['id_token'],'expiresAt':self.now()+lifetime,'scopes':scopes,
                'status':'authenticated' if {'resource.invoke','chatgpt.tokens.use.direct'}.issubset(scopes) else 'consent_required',
                'lastVerified':None,'message':'Login validated; execution not yet tested.'}
            self._save();return id
    def select_default(self,id):
        with self.lock: self._row(id);self.data['default']=id;self._save()
    def _credential(self,id):
        with self.lock:
            c=self._row(id); require(c['status'] not in {'disconnected','consent_required'},'CONNECTION_NOT_AUTHORIZED')
            require({'resource.invoke','chatgpt.tokens.use.direct'}.issubset(c['scopes']),'CONSENT_REQUIRED')
            require(id not in self.running,'CONNECTION_BUSY'); self.running.add(id)
            return dict(c)
    def _current(self,c):
        return self._row(c['id'])['generation']==c['generation'] and self._row(c['id'])['status']!='disconnected'
    def _token(self,c):
        if c['expiresAt']>self.now()+30:return c['access_token']
        require(isinstance(c.get('refresh_token'),str),'REAUTH_REQUIRED')
        tokens=self.http.request('POST',TOKEN,form={'grant_type':'refresh_token','client_id':c['client_id'],
            'refresh_token':c['refresh_token'],'resource':RESOURCE})
        require(isinstance(tokens.get('access_token'),str) and tokens.get('token_type','').lower()=='bearer' and
                type(tokens.get('expires_in')) in (int,float) and 0<tokens['expires_in']<=86400,'INVALID_REFRESH')
        with self.lock:
            require(self._current(c),'CONNECTION_CHANGED')
            row=self._row(c['id']);row.update(access_token=tokens['access_token'],expiresAt=self.now()+tokens['expires_in'])
            if 'refresh_token' in tokens:
                require(isinstance(tokens['refresh_token'],str),'INVALID_REFRESH');row['refresh_token']=tokens['refresh_token']
            if 'scope' in tokens:
                require(isinstance(tokens['scope'],str),'INVALID_REFRESH');row['scopes']=tokens['scope'].split()
            self._save();c.update(row)
        require({'resource.invoke','chatgpt.tokens.use.direct'}.issubset(c['scopes']),'CONSENT_REQUIRED')
        return c['access_token']
    def models(self,id):
        c=self._credential(id)
        try:
            data=self.http.request('GET',RESOURCE+'/models',token=self._token(c))
            with self.lock:require(self._current(c),'CONNECTION_CHANGED')
            require(isinstance(data.get('models'),list),'INVALID_MODEL_CATALOG')
            return [{'id':m['slug'],'label':m.get('display_name',m['slug'])} for m in data['models']
                if m.get('visibility')=='list' and isinstance(m.get('slug'),str)][:100]
        finally:
            with self.lock:self.running.discard(id)
    def verify_execution(self,id,model):
        require(isinstance(model,str) and 0<len(model)<128,'INVALID_MODEL')
        c=self._credential(id)
        try:
            token=self._token(c)
            catalogue=self.http.request('GET',RESOURCE+'/models',token=token)
            require(any(m.get('visibility')=='list' and m.get('slug')==model for m in catalogue.get('models',[])),'MODEL_NOT_IN_ACCOUNT_CATALOG')
            with self.lock:require(self._current(c),'CONNECTION_CHANGED')
            events=self.http.request('POST',RESOURCE+'/responses',token=token,stream=True,
                body={'model':model,'input':[{'role':'user','content':'Reply exactly VIVO_READY.'}],
                      'store':False,'stream':True,'max_output_tokens':64})
            completed=False
            for event in events:
                type_=event.get('type')
                if type_ in {'response.failed','error'}:
                    code=(event.get('response',{}).get('error') or event.get('error') or {}).get('code','')
                    raise AccountError('QUOTA_BLOCKED' if code in {'subscription_sharing_usage_limit_exceeded','subscription_sharing_usage_unavailable'} else 'PROVIDER_INFERENCE_FAILED')
                if type_=='response.incomplete':raise AccountError('INFERENCE_INCOMPLETE')
                if type_=='response.completed':completed=True
            require(completed,'INFERENCE_NOT_COMPLETED')
            with self.lock:
                require(self._current(c),'CONNECTION_CHANGED')
                row=self._row(id);row['status']='execution_verified';row['lastVerified']=self.now();row['message']='One explicit inference completed.';self._save()
            return {'status':'execution_verified','model':model,'automaticRetries':0}
        except AccountError as e:
            with self.lock:
                if self._current(c):
                    row=self._row(id);row['status']={'QUOTA_BLOCKED':'quota_blocked','REAUTH_REQUIRED':'reauth_required'}.get(e.code,'authenticated')
                    row['message']=e.code;self._save()
            raise
        finally:
            with self.lock:self.running.discard(id)
    def disconnect(self,id):
        with self.lock:
            row=self._row(id);old=dict(row);row['generation']+=1;row['status']='disconnected'
            row['message']='Disconnected locally; remote revocation pending.'
            for key in ['access_token','refresh_token','id_token']:row.pop(key,None)
            self.pending={s:a for s,a in self.pending.items() if a['id']!=id}
            self._save()
        remote=False
        if old.get('refresh_token'):
            try:
                self.http.request('POST',self.identity.metadata()['revocation_endpoint'],form={
                    'token':old['refresh_token'],'token_type_hint':'refresh_token','client_id':old['client_id']})
                remote=True
            except Exception:pass
        with self.lock:
            self._row(id)['message']='Provider revocation confirmed.' if remote else 'Local tokens removed; provider revocation unconfirmed.';self._save()
        return {'status':'disconnected','remoteRevocationConfirmed':remote}
