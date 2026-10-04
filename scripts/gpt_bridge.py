"""Local ChatGPT-plan OAuth and optional OpenAI Responses adapter.

Protocol: https://developers.openai.com/siwc/token-sharing-open-source
Identity validation requires PyJWT[crypto] (``python -m pip install 'PyJWT[crypto]'``).
No Codex credentials, ChatGPT cookies, backend-api routes, or remote tools are used.
Windows records use current-user DPAPI; Unix records use private directories/files.
"""
from __future__ import annotations

import base64
from collections import deque
from contextlib import contextmanager
import ctypes
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

ISSUER = "https://auth.openai.com"
AUTHORIZE = ISSUER + "/api/accounts/authorize"
TOKEN = ISSUER + "/api/accounts/oauth/token"
DISCOVERY = ISSUER + "/.well-known/openid-configuration"
JWKS = ISSUER + "/.well-known/jwks.json"
REVOKE = ISSUER + "/api/accounts/oauth/revoke"
RESOURCE = "https://api.openai.com/v1"
MODELS = RESOURCE + "/models"
RESPONSES = RESOURCE + "/responses"
SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
DEFAULT_MODEL = "gpt-6.1-sol"
MAX_BODY_BYTES = 131072
MAX_RESPONSE_BYTES = 2_000_000
MAX_OUTPUT_CHARS = 16_000
MAX_MESSAGES = 20
MODEL_RE = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}\Z")
CLIENT_RE = re.compile(r"oaiapp_[a-zA-Z0-9_-]{1,200}\Z")
TERMINAL_REFRESH = {"invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"}


def utc_now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class GPTError(Exception):
    def __init__(self, status, code, message, retry_after=None, details=None):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.retry_after, self.details = retry_after, details or {}

    def public(self):
        return {"code": self.code, "message": self.message, **self.details}


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def upstream_error(status, value, headers=None):
    """Retain safe structured diagnostics, never reflect upstream bodies or prompts."""
    value = value if isinstance(value, dict) else {}
    error = value.get("error")
    code = error.get("code") if isinstance(error, dict) else error
    code = code if isinstance(code, str) and re.fullmatch(r"[a-z_]{1,100}", code) else "upstream_error"
    details = {"upstreamStatus": status, "bodyShape": "error" if "error" in value else "detail" if "detail" in value else "other"}
    param = error.get("param") if isinstance(error, dict) else None
    if isinstance(param, str) and re.fullmatch(r"[a-zA-Z0-9_\[\].-]{1,100}", param):
        details["param"] = param
    request_id = (headers or {}).get("x-request-id") or (headers or {}).get("openai-request-id")
    if isinstance(request_id, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,160}", request_id):
        details["requestId"] = request_id
    messages = {
        "subscription_sharing_usage_limit_exceeded": "ChatGPT plan or app usage limit reached. Open Manage usage to review it.",
        "subscription_sharing_user_not_eligible": "ChatGPT plan use is unavailable for this account, workspace, or policy.",
        "subscription_sharing_usage_unavailable": "ChatGPT usage availability could not be checked. Try again later.",
        "subscription_sharing_unsupported_capability": "This ChatGPT plan route does not support part of the request.",
        "subscription_sharing_route_not_supported": "This ChatGPT account does not permit the Responses route.",
        "invalid_grant": "This authorization or renewable session is no longer valid. Continue with ChatGPT again.",
    }
    message = messages.get(code, f"OpenAI returned HTTP {status}. Check account permissions or try again later.")
    retry = 60 if status in (429, 503) else None
    return GPTError(status if 400 <= status <= 599 else 502, code, message, retry, details)


class Transport:
    """Fixed upstream endpoints and bounded JSON/SSE; redirects never receive secrets."""
    def _open(self, url, *, data=None, bearer=None, form=False):
        if url not in {TOKEN, DISCOVERY, JWKS, REVOKE, MODELS, RESPONSES}:
            raise GPTError(400, "endpoint_rejected", "This upstream endpoint is not permitted.")
        headers = {"Accept": "application/json", "User-Agent": "maTumbo-GPT-Bridge/1"}
        if bearer:
            headers["Authorization"] = "Bearer " + bearer
        if data is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
            data = (urlencode(data) if form else json.dumps(data)).encode()
        if url == RESPONSES:
            headers["Accept"] = "text/event-stream"
        try:
            return build_opener(NoRedirects()).open(Request(url, data=data, headers=headers), timeout=45)
        except HTTPError as error:
            try:
                value = json.loads(error.read(65536))
            except (ValueError, OSError):
                value = {}
            raise upstream_error(error.code, value, error.headers) from None
        except (URLError, TimeoutError, OSError):
            raise GPTError(504, "upstream_unreachable", "OpenAI could not be reached within the request timeout.") from None

    def json(self, url, *, data=None, bearer=None, form=False):
        try:
            with self._open(url, data=data, bearer=bearer, form=form) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise GPTError(502, "response_too_large", "OpenAI returned an oversized response.")
                value = json.loads(raw) if raw else {}
                if not isinstance(value, dict):
                    raise ValueError()
                return value
        except (ValueError, UnicodeError):
            raise GPTError(502, "invalid_response", "OpenAI returned an unreadable response.") from None

    def infer(self, payload, bearer, cancelled):
        text, total, started, completed, usage = [], 0, time.monotonic(), False, {}
        try:
            with self._open(RESPONSES, data=payload, bearer=bearer) as response:
                if not response.headers.get("Content-Type", "").startswith("text/event-stream"):
                    raise GPTError(502, "invalid_stream", "OpenAI did not return a Responses event stream.")
                event_data = []
                while True:
                    if cancelled.is_set():
                        raise GPTError(409, "request_cancelled", "The account was disconnected during this request.")
                    if time.monotonic() - started > 90:
                        raise GPTError(504, "stream_timeout", "The answer exceeded the local 90-second stream limit.")
                    line = response.readline(65537)
                    total += len(line)
                    if len(line) > 65536 or total > MAX_RESPONSE_BYTES:
                        raise GPTError(502, "response_too_large", "The answer exceeded the local output limit.")
                    if not line:
                        break
                    line = line.decode("utf-8").rstrip("\r\n")
                    if line.startswith("data:"):
                        event_data.append(line[5:].lstrip())
                    if line or not event_data:
                        continue
                    raw = "\n".join(event_data)
                    event_data = []
                    if raw == "[DONE]":
                        break
                    event = json.loads(raw)
                    kind = event.get("type")
                    if kind == "response.output_text.delta":
                        delta = event.get("delta")
                        if not isinstance(delta, str):
                            raise ValueError()
                        text.append(delta)
                        if sum(map(len, text)) > MAX_OUTPUT_CHARS:
                            raise GPTError(502, "output_limit", "The answer exceeded the local 16000-character limit. Ask for a shorter answer.")
                    elif kind in ("response.failed", "error"):
                        err = event.get("response", event)
                        error = err.get("error", {}) if isinstance(err, dict) else {}
                        status = 429 if error.get("code") == "subscription_sharing_usage_limit_exceeded" else 503 if error.get("code") == "subscription_sharing_usage_unavailable" else 502
                        raise upstream_error(status, {"error": error}, response.headers)
                    elif kind == "response.incomplete":
                        raise GPTError(502, "incomplete_response", "OpenAI stopped before completing the answer.")
                    elif kind == "response.completed":
                        completed = True
                        usage = event.get("response", {}).get("usage", {})
                        break
        except (ValueError, UnicodeError, AttributeError, TypeError):
            raise GPTError(502, "invalid_stream", "OpenAI returned an unreadable Responses stream.") from None
        except (TimeoutError, OSError):
            raise GPTError(504, "stream_interrupted", "The OpenAI stream was interrupted before completion.") from None
        if not completed or not "".join(text).strip():
            raise GPTError(502, "incomplete_response", "The stream ended without a completed text answer.")
        return {"content": "".join(text), "usage": usage}


def dpapi(value, decrypt=False):
    """Current Windows user protection; UI prompts and machine-wide scope are disabled."""
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]
    buf = ctypes.create_string_buffer(value)
    source = Blob(len(value), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    dest = Blob()
    crypt32, kernel32 = ctypes.WinDLL("crypt32", use_last_error=True), ctypes.WinDLL("kernel32", use_last_error=True)
    fn = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    fn.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes, kernel32.LocalFree.restype = [ctypes.c_void_p], ctypes.c_void_p
    if not fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(dest)):
        raise OSError("Windows credential protection failed.")
    try:
        return ctypes.string_at(dest.pbData, dest.cbData)
    finally:
        kernel32.LocalFree(dest.pbData)


class MemoryStore:
    mode = "session_only"
    def __init__(self):
        self.value = None
        self.lock = threading.RLock()

    @contextmanager
    def transaction(self):
        with self.lock:
            yield

    def load(self):
        return json.loads(json.dumps(self.value)) if self.value else None

    def save(self, value):
        self.value = json.loads(json.dumps(value))


class ProtectedStore:
    def __init__(self, directory=None):
        self.directory = Path(directory) if directory else (Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "maTumbo" / "gpt-bridge" if os.name == "nt" else Path.home() / ".config" / "matumbo-gpt-bridge")
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.directory / "credentials.bin"
        self.mode = "windows_dpapi" if os.name == "nt" else "owner_only_file"
        if os.name != "nt":
            os.chmod(self.directory, 0o700)
        self.lock = threading.RLock()

    @contextmanager
    def transaction(self):
        # A process-shared lock protects rotating refresh tokens and atomic account updates.
        with self.lock:
            with open(self.directory / "credentials.lock", "a+b") as handle:
                if handle.tell() == 0:
                    handle.write(b"0")
                    handle.flush()
                handle.seek(0)
                try:
                    if os.name == "nt":
                        import msvcrt
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError:
                    raise GPTError(409, "credentials_busy", "Another local bridge is updating this account. Try again shortly.") from None
                try:
                    yield
                finally:
                    handle.seek(0)
                    if os.name == "nt":
                        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def load(self):
        if not self.path.exists():
            return None
        raw = self.path.read_bytes()
        return json.loads(dpapi(raw, decrypt=True) if os.name == "nt" else raw)

    def save(self, value):
        raw = json.dumps(value).encode()
        raw = dpapi(raw) if os.name == "nt" else raw
        temporary = self.directory / ("credentials-" + secrets.token_hex(8) + ".tmp")
        try:
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(raw)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)


class IdentityVerifier:
    def __init__(self, transport):
        self.transport, self.keys, self.cached_at = transport, {}, 0

    @staticmethod
    def available():
        try:
            import jwt
            import cryptography
            return bool(jwt and cryptography)
        except ImportError:
            return False

    def verify(self, token, client_id, nonce=None):
        try:
            import jwt
            header = jwt.get_unverified_header(token)
            if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str) or any(name in header for name in ("jku", "jwk", "x5u")):
                raise ValueError()
            if header["kid"] not in self.keys or time.time() - self.cached_at > 3600:
                discovery = self.transport.json(DISCOVERY)
                if any(discovery.get(k) != v for k, v in {"issuer": ISSUER, "authorization_endpoint": AUTHORIZE, "token_endpoint": TOKEN, "jwks_uri": JWKS}.items()):
                    raise ValueError()
                keys = self.transport.json(JWKS).get("keys", [])
                self.keys = {key["kid"]: key for key in keys if isinstance(key, dict) and key.get("kty") == "RSA" and key.get("use", "sig") == "sig" and key.get("alg", "RS256") == "RS256" and isinstance(key.get("kid"), str)}
                self.cached_at = time.time()
            key = jwt.PyJWK.from_dict(self.keys[header["kid"]], algorithm="RS256").key
            claims = jwt.decode(token, key, algorithms=["RS256"], issuer=ISSUER, audience=client_id, leeway=5,
                                options={"require": ["sub", "exp", "iat", "iss", "aud"]})
            if not isinstance(claims.get("sub"), str) or not claims["sub"] or (nonce is not None and not hmac.compare_digest(str(claims.get("nonce", "")), nonce)):
                raise ValueError()
            if claims.get("azp", client_id) != client_id:
                raise ValueError()
            if isinstance(claims["aud"], list) and len(claims["aud"]) > 1 and claims.get("azp") != client_id:
                raise ValueError()
            return claims
        except ImportError:
            raise GPTError(503, "auth_dependency_missing", "Install PyJWT[crypto] in the bridge Python environment to validate ChatGPT sign-in.") from None
        except GPTError:
            raise
        except Exception:
            raise GPTError(400, "identity_rejected", "ChatGPT identity signature, issuer, audience, expiration, or nonce validation failed.") from None


class GPTState:
    def __init__(self, api_key="", model=DEFAULT_MODEL, transport=None, store=None, verifier=None, clock=time.time):
        if not MODEL_RE.fullmatch(model):
            raise ValueError("OPENAI_MODEL must be a model ID.")
        self.api_key, self.model, self.clock = api_key.strip(), model, clock
        self.transport = transport or Transport()
        self.verifier = verifier or IdentityVerifier(self.transport)
        self.storage_warning = None
        try:
            self.store = store if store is not None else ProtectedStore()
            with self.store.transaction():
                self.data = self.store.load() or {"host_id": "urn:uuid:" + str(uuid.uuid4()), "accounts": {}, "active": None}
                self.store.save(self.data)
        except (OSError, ValueError, GPTError):
            if store is not None:
                raise
            self.store = MemoryStore()
            self.data = {"host_id": "urn:uuid:" + str(uuid.uuid4()), "accounts": {}, "active": None}
            self.store.save(self.data)
            self.storage_warning = "Protected storage is unavailable. This session will not survive a bridge restart. Existing protected files were preserved."
        self.lock = threading.RLock()
        self.pending, self.catalogs, self.requests = {}, {}, deque()
        self.retry_registration = None
        self.in_flight, self.cancelled = False, threading.Event()
        self.verified = {"chatgpt": None, "openai": None}
        self.verified_account = None
        self.errors, self.retry_until = {}, {}

    def _reload(self):
        self.data = self.store.load() or self.data

    def _save(self):
        self.store.save(self.data)

    def _active(self):
        return self.data["accounts"].get(self.data["active"])

    def _account_state(self, account):
        if not account or not account.get("access_token"):
            return "reauth_required" if account and account.get("reauth_required") else "signed_out"
        return "signed_in" if "chatgpt.tokens.use.direct" in account.get("scopes", []) else "plan_disabled"

    def status(self):
        with self.lock, self.store.transaction():
            self._reload()
            account = self._active()
            state = self._account_state(account)
            account_verified = self.verified["chatgpt"] if self.verified_account == self.data["active"] else None
            if state == "signed_in" and account_verified:
                state = "verified"
            return {"service": "matumbo-gpt-bridge", "version": 1, "credentialsInBrowser": False,
                    "credentialStorage": self.store.mode, "storageWarning": self.storage_warning, "checkedAt": utc_now(),
                    "chatgpt": {"state": state, "accountLabel": account.get("label") if account else None,
                        "activeAccountId": self.data["active"], "authAvailable": self.verifier.available(),
                        "dependencyState": "ready" if self.verifier.available() else "dependency_needed",
                        "accounts": [{"id": key, "label": value["label"], "state": self._account_state(value), "active": key == self.data["active"]} for key, value in self.data["accounts"].items()],
                        "planUsage": state in ("signed_in", "verified"), "verifiedAt": account_verified,
                        "error": self.errors.get("chatgpt"), "usageUrl": "https://chatgpt.com/settings/usage",
                        "historySync": False, "customGPTSync": False},
                    "openai": {"state": "verified" if self.verified["openai"] else "configured" if self.api_key else "key_needed", "model": self.model,
                        "verifiedAt": self.verified["openai"], "error": self.errors.get("openai"), "billing": "OpenAI API billing"},
                    "models": self.catalogs.get(self.data["active"], []) + [{"id": self.model, "label": self.model, "provider": "openai"}]}

    def sign_in(self, value, port):
        if not isinstance(value, dict) or set(value) - {"accountId", "newAccount", "enablePlan"} or ("newAccount" in value and type(value["newAccount"]) is not bool) or ("enablePlan" in value and type(value["enablePlan"]) is not bool):
            raise GPTError(400, "invalid_request", "Choose a saved account or add an account.")
        if not self.verifier.available():
            raise GPTError(503, "auth_dependency_missing", "Install PyJWT[crypto] in the bridge Python environment before sign-in.")
        with self.lock, self.store.transaction():
            self._reload()
            if self.in_flight:
                raise GPTError(409, "request_in_progress", "Wait for the current answer before changing accounts.")
            account_id = None if value.get("newAccount") else value.get("accountId", self.data["active"])
            if account_id is not None and (not isinstance(account_id, str) or account_id not in self.data["accounts"]):
                raise GPTError(400, "unknown_account", "Choose an existing local account registration.")
            account = self.data["accounts"].get(account_id)
            if account_id is None and not value.get("newAccount") and self.retry_registration:
                account_id = self.retry_registration
            state, nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(64)
            redirect = f"http://127.0.0.1:{port}/api/gpt/callback"
            self.pending = {state: {"nonce": nonce, "verifier": verifier, "redirect": redirect, "expires": self.clock() + 600,
                                    "client_id": account_id, "subject": account.get("subject") if account else None}}
            args = {"client_id": account_id or "dynamic_agent_client", "ext_agent_host_id": self.data["host_id"], "response_type": "code",
                    "redirect_uri": redirect, "scope": SCOPES, "resource": RESOURCE, "state": state, "nonce": nonce,
                    "code_challenge_method": "S256", "code_challenge": base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")}
            if account_id is None:
                args["agent_name_hint"] = "maTumbo Reality Lens"
            # Deliberately omit optional token/login hints: tokens never enter browser JS.
            if value.get("enablePlan"):
                args["prompt"] = "consent"
            return {"authorizationUrl": AUTHORIZE + "?" + urlencode(args), "expiresIn": 600}

    def _token_record(self, tokens, client_id, claims, previous=None):
        previous = previous or {}
        if not isinstance(tokens, dict) or not isinstance(tokens.get("token_type"), str) or tokens["token_type"].lower() != "bearer" or not isinstance(tokens.get("access_token"), str) or not tokens["access_token"] or type(tokens.get("expires_in")) not in (int, float) or not 0 < tokens["expires_in"] <= 86400:
            raise GPTError(502, "invalid_token_response", "OpenAI did not return a usable credential set.")
        scopes = tokens.get("scope")
        if not isinstance(scopes, str):
            raise GPTError(502, "missing_granted_scopes", "OpenAI did not return granted permission scopes.")
        refresh = tokens.get("refresh_token")
        for name in ("access_token", "refresh_token", "id_token"):
            if name in tokens and (not isinstance(tokens[name], str) or not 1 <= len(tokens[name]) <= 32768 or any(char.isspace() for char in tokens[name])):
                raise GPTError(502, "invalid_token_response", "OpenAI returned an invalid credential value.")
        if "offline_access" in scopes.split() and (not isinstance(refresh, str) or not refresh):
            raise GPTError(502, "missing_refresh_token", "OpenAI did not return a renewable session.")
        email = claims.get("email", previous.get("email", "ChatGPT account"))
        email = email[:160] if isinstance(email, str) else "ChatGPT account"
        return {"client_id": client_id, "issuer": ISSUER, "subject": claims["sub"], "email": email,
                "label": email + " · " + hashlib.sha256(client_id.encode()).hexdigest()[:6],
                "id_token": tokens.get("id_token", previous.get("id_token")), "access_token": tokens["access_token"],
                "refresh_token": refresh, "scopes": scopes.split(), "expires_at": self.clock() + tokens["expires_in"],
                "earliest_refresh_at": tokens.get("earliest_refresh_at"), "saved_at": utc_now()}

    def callback(self, query):
        if len(query) > 16384:
            raise GPTError(400, "invalid_callback", "The sign-in callback was too large.")
        params = parse_qs(query, keep_blank_values=True)
        if any(len(v) != 1 for v in params.values()):
            raise GPTError(400, "invalid_callback", "Duplicate sign-in callback values were rejected.")
        state = params.get("state", [""])[0]
        with self.lock, self.store.transaction():
            pending = self.pending.pop(state, None)
            if not pending or pending["expires"] <= self.clock():
                raise GPTError(400, "invalid_state", "This sign-in attempt is missing, expired, or already used. Continue with ChatGPT again.")
            if self.in_flight:
                raise GPTError(409, "request_in_progress", "Wait for the current answer before completing account sign-in.")
            if "error" in params:
                raise GPTError(400, "authorization_declined", "ChatGPT authorization was not completed. You can continue again when ready.")
            client_id = params.get("client_id", [pending["client_id"]])[0]
            if not isinstance(client_id, str) or not CLIENT_RE.fullmatch(client_id) or (pending["client_id"] and client_id != pending["client_id"]):
                raise GPTError(400, "client_rejected", "The returned account registration did not match this sign-in.")
            code = params.get("code", [""])[0]
            if not code or len(code) > 8192:
                raise GPTError(400, "code_missing", "The callback did not include a valid authorization code.")
            self._reload()
            # Keep the issued mapping when exchange needs a fresh authorization code.
            try:
                tokens = self.transport.json(TOKEN, data={"grant_type": "authorization_code", "client_id": client_id, "code": code,
                        "code_verifier": pending["verifier"], "redirect_uri": pending["redirect"], "resource": RESOURCE}, form=True)
            except GPTError as error:
                if error.code == "invalid_grant":
                    self.retry_registration = client_id
                # Retain the issued registration only for retry; it is not a signed-in identity.
                raise
            claims = self.verifier.verify(tokens.get("id_token", ""), client_id, pending["nonce"])
            existing = self.data["accounts"].get(client_id)
            expected = pending["subject"] or (existing.get("subject") if existing else None)
            if expected and claims["sub"] != expected:
                raise GPTError(400, "account_mismatch", "The verified identity did not match the saved account registration.")
            self.data["accounts"][client_id] = self._token_record(tokens, client_id, claims)
            self.data["active"] = client_id
            self.retry_registration = None
            self.verified["chatgpt"] = None
            self.errors.pop("chatgpt", None)
            self.catalogs.pop(client_id, None)
            self._save()
        return {"connected": True}

    def _access(self):
        """Caller owns the process and store lock; reload before any token refresh."""
        self._reload()
        account = self._active()
        if not account or not account.get("access_token"):
            raise GPTError(401, "sign_in_required", "Continue with ChatGPT before using your plan.")
        if "chatgpt.tokens.use.direct" not in account.get("scopes", []):
            raise GPTError(403, "plan_disabled", "Enable ChatGPT plan usage for this app or select the OpenAI API provider.")
        if account["expires_at"] - self.clock() < 60:
            try:
                if not account.get("refresh_token"):
                    raise GPTError(401, "invalid_refresh_token", "Continue with ChatGPT to renew this session.")
                earliest = account.get("earliest_refresh_at")
                if isinstance(earliest, (int, float)) and earliest > self.clock():
                    if account["expires_at"] <= self.clock():
                        raise GPTError(503, "refresh_not_ready", "OpenAI has not yet allowed session renewal. Try again shortly.")
                    return account["access_token"]
                tokens = self.transport.json(TOKEN, data={"grant_type": "refresh_token", "client_id": account["client_id"], "refresh_token": account["refresh_token"], "resource": RESOURCE}, form=True)
                claims = self.verifier.verify(tokens["id_token"], account["client_id"]) if tokens.get("id_token") else {"sub": account["subject"], "email": account["email"]}
                if claims["sub"] != account["subject"]:
                    raise GPTError(400, "account_mismatch", "Session renewal returned another account identity.")
                account = self._token_record(tokens, account["client_id"], claims, account)
                self.data["accounts"][account["client_id"]] = account
                self._save()
            except GPTError as error:
                if error.code in TERMINAL_REFRESH:
                    for name in ("access_token", "refresh_token", "id_token"):
                        account.pop(name, None)
                    account["reauth_required"] = True
                    self.verified["chatgpt"] = None
                    self._save()
                raise
        if "chatgpt.tokens.use.direct" not in account.get("scopes", []):
            raise GPTError(403, "plan_disabled", "ChatGPT plan permission is no longer enabled for this app.")
        return account["access_token"]

    def models(self):
        with self.lock, self.store.transaction():
            token = self._access()
            result = self.transport.json(MODELS, bearer=token)
            entries = result.get("models")
            if not isinstance(entries, list):
                raise GPTError(502, "invalid_model_catalog", "OpenAI did not return the account model catalog.")
            models = [{"id": item["slug"], "label": str(item.get("display_name", item["slug"]))[:160], "provider": "chatgpt"}
                      for item in entries[:200] if isinstance(item, dict) and item.get("visibility") == "list" and isinstance(item.get("slug"), str) and MODEL_RE.fullmatch(item["slug"])]
            self.catalogs[self.data["active"]] = models
            return {"models": models}

    def disconnect(self, value):
        if not isinstance(value, dict) or set(value) - {"accountId"}:
            raise GPTError(400, "invalid_request", "Choose an account to disconnect.")
        with self.lock, self.store.transaction():
            self._reload()
            account_id = value.get("accountId", self.data["active"])
            if account_id is not None and (not isinstance(account_id, str) or account_id not in self.data["accounts"]):
                raise GPTError(400, "unknown_account", "The local account registration was not found.")
            account = self.data["accounts"].get(account_id)
            self.cancelled.set()
            self.pending.clear()
            self.retry_registration = None
            confirmed = not account or not account.get("refresh_token")
            if account and account.get("refresh_token"):
                try:
                    discovery = self.transport.json(DISCOVERY)
                    if discovery.get("revocation_endpoint") != REVOKE:
                        raise GPTError(502, "revocation_endpoint_rejected", "OpenAI revocation discovery could not be validated.")
                    for attempt in range(2):
                        try:
                            self.transport.json(REVOKE, data={"token": account["refresh_token"], "token_type_hint": "refresh_token", "client_id": account_id}, form=True)
                            break
                        except GPTError as error:
                            if attempt or error.status < 500:
                                raise
                            time.sleep(0.2)
                    confirmed = True
                except GPTError:
                    confirmed = False
            if account:
                for name in ("access_token", "refresh_token", "id_token"):
                    account.pop(name, None)
                account.pop("reauth_required", None)
                self.catalogs.pop(account_id, None)
                self._save()
            self.verified["chatgpt"] = None
            return {"disconnected": True, "remoteRevocationConfirmed": confirmed,
                    "message": "Signed out." if confirmed else "Signed out locally. Remote revocation was not confirmed; disconnect the app in ChatGPT Settings.",
                    "usageUrl": "https://chatgpt.com/settings/usage"}

    def chat(self, value):
        if not isinstance(value, dict) or set(value) - {"provider", "model", "instructions", "messages", "accountId"}:
            raise GPTError(400, "invalid_request", "Send provider, model, instructions, and text messages only.")
        provider, model = value.get("provider"), value.get("model", "")
        instructions, messages = value.get("instructions", ""), value.get("messages")
        if provider not in ("chatgpt", "openai") or not isinstance(model, str) or (model and not MODEL_RE.fullmatch(model)):
            raise GPTError(400, "invalid_provider_model", "Choose a supported provider and model.")
        if not isinstance(instructions, str) or len(instructions) > 20000 or not isinstance(messages, list) or not 1 <= len(messages) <= MAX_MESSAGES:
            raise GPTError(400, "invalid_context", "Use up to 20 messages and 20000 instruction characters.")
        for item in messages:
            if not isinstance(item, dict) or set(item) != {"role", "content"} or item.get("role") not in ("user", "assistant") or not isinstance(item.get("content"), str) or not item["content"].strip() or len(item["content"]) > 16000:
                raise GPTError(400, "invalid_message", "Each message must contain a user or assistant role and 1–16000 text characters.")
        if len(messages[-1]["content"]) > 8000:
            raise GPTError(400, "invalid_prompt", "The current prompt must be within 8000 characters.")
        if messages[-1]["role"] != "user" or sum(len(item["content"]) for item in messages) > 24000:
            raise GPTError(400, "invalid_history", "End with a user message and keep total history within 24000 characters.")
        with self.lock:
            if self.in_flight:
                raise GPTError(409, "request_in_progress", "One GPT request is already in progress.")
            now = self.clock()
            if self.retry_until.get(provider, 0) > now:
                raise GPTError(429, "provider_cooldown", "Wait before trying this provider again.", max(1, int(self.retry_until[provider] - now)))
            while self.requests and now - self.requests[0] >= 60:
                self.requests.popleft()
            if len(self.requests) >= 6:
                raise GPTError(429, "local_rate_limit", "The local GPT bridge permits six requests per minute.", 60)
            with self.store.transaction():
                if provider == "openai":
                    if not self.api_key:
                        raise GPTError(503, "key_needed", "Set OPENAI_API_KEY in the bridge environment and restart it.")
                    if model and model != self.model:
                        raise GPTError(400, "model_rejected", "Choose the API model configured by OPENAI_MODEL.")
                    token, model = self.api_key, self.model
                else:
                    self._reload()
                    if not isinstance(value.get("accountId"), str) or value["accountId"] != self.data["active"]:
                        raise GPTError(409, "account_changed", "The active ChatGPT account changed. Refresh connection status before sending.")
                    token = self._access()
                    catalog = self.catalogs.get(self.data["active"], [])
                    if not model and catalog:
                        model = catalog[0]["id"]
                    if model not in {item["id"] for item in catalog}:
                        raise GPTError(400, "model_catalog_required", "Refresh the signed-in account model list, then choose an available model.")
            self.in_flight, self.cancelled = True, threading.Event()
            self.requests.append(now)
        try:
            # Plan OAuth forbids max_output_tokens; transport bounds bytes, time, and text instead.
            payload = {"model": model, "input": messages, "instructions": "You are an advisory assistant in maTumbo Reality Lens. You can explain and suggest, but have no tools or account, wallet, trading, payment, or computer execution authority.\n" + instructions, "store": False, "stream": True}
            if provider == "openai":
                payload["max_output_tokens"] = 4096
            result = self.transport.infer(payload, token, self.cancelled)
            content = result.get("content")
            if self.cancelled.is_set():
                raise GPTError(409, "request_cancelled", "The account was disconnected during this request.")
            if not isinstance(content, str) or not content.strip() or len(content) > MAX_OUTPUT_CHARS:
                raise GPTError(502, "invalid_response", "OpenAI did not complete a bounded text answer.")
            content = content.replace(token, "[redacted]")
            usage = result.get("usage", {})
            usage = {key: usage[key] for key in ("input_tokens", "output_tokens", "total_tokens") if isinstance(usage, dict) and type(usage.get(key)) is int and usage[key] >= 0}
            verified = utc_now()
            with self.lock:
                self.verified[provider] = verified
                if provider == "chatgpt":
                    self.verified_account = value["accountId"]
                self.errors.pop(provider, None)
            return {"content": content, "provider": provider, "model": model, "usage": usage, "verifiedAt": verified, "advisory": True}
        except GPTError as error:
            with self.lock:
                self.errors[provider] = error.public()
                if error.retry_after:
                    self.retry_until[provider] = self.clock() + error.retry_after
            raise
        except Exception:
            raise GPTError(502, "provider_error", "OpenAI returned an unexpected response.") from None
        finally:
            with self.lock:
                self.in_flight = False
