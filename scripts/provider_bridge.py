"""Serve Reality Lens and a bounded NVIDIA prototype bridge on loopback.

Only this server process sees NVIDIA_API_KEY. The static site and status API
receive configuration state, never the key. No third-party packages are needed.
Run: py -3 scripts/provider_bridge.py
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import threading
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

# Load the sibling module even when tests import this file directly by path.
_gpt_spec = importlib.util.spec_from_file_location("matumbo_gpt_bridge", Path(__file__).with_name("gpt_bridge.py"))
gpt_bridge = importlib.util.module_from_spec(_gpt_spec)
_gpt_spec.loader.exec_module(gpt_bridge)

UPSTREAM = "https://integrate.api.nvidia.com/v1/chat/completions"
DEFAULT_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
MAX_BODY_BYTES = 20_000
BODY_TIMEOUT_SECONDS = 10
MAX_REJECTED_BODY_DRAIN_BYTES = 256 * 1024
MAX_PROMPT_LENGTH = 4_000
MAX_RESPONSE_BYTES = 1_000_000
REQUEST_TIMEOUT_SECONDS = 45
PUBLIC_ORIGIN = "https://carltheghost.github.io"
LOCAL_LIMIT_PER_MINUTE = 6
STATIC_PREFIXES = ("src/", "vendor/three-r179.1/", "assets/", "public/")
ROOT_FILES = frozenset({
    "index.html", "favicon.svg", "mobile-chrome.js", "mobile-layout.css",
    "mobile-polish.css", "token-mobile.css", "paper.html", "paper-live.html",
    "surface-field.html", "token-lifecycle.html",
})
STATIC_TYPES = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
    ".wasm": "application/wasm", ".json": "application/json",
    ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream",
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
    ".mp4": "video/mp4", ".webm": "video/webm",
}


class LoopbackThreadingHTTPServer(ThreadingHTTPServer):
    # Browser module graphs can create a burst of pending local connections.
    # Binding and per-request authority checks remain in create_server/Handler.
    request_queue_size = 128


def discard_rejected_body(stream, connection, headers):
    """Discard a bounded framed body before closing an early error response.

    Closing with unread POST bytes can reset the response on Windows. This never
    parses or accepts rejected data, and a single total deadline bounds trickles.
    Ambiguous framing or very large bodies are closed without draining.
    """
    if headers.get("Transfer-Encoding"):
        return
    try:
        remaining_bytes = int(headers.get("Content-Length", "0"))
    except (TypeError, ValueError):
        return
    if not 0 < remaining_bytes <= MAX_REJECTED_BODY_DRAIN_BYTES:
        return
    previous_timeout = connection.gettimeout()
    budget = min(BODY_TIMEOUT_SECONDS, previous_timeout) if previous_timeout is not None else BODY_TIMEOUT_SECONDS
    deadline = time.monotonic() + budget
    try:
        while remaining_bytes:
            remaining_seconds = deadline - time.monotonic()
            if remaining_seconds <= 0:
                return
            connection.settimeout(remaining_seconds)
            chunk = stream.read1(min(8192, remaining_bytes))
            if not chunk:
                return
            remaining_bytes -= len(chunk)
    except OSError:
        # A rejected request is still rejected when its sender disconnects or stalls.
        pass
    finally:
        try:
            connection.settimeout(previous_timeout)
        except OSError:
            pass


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class BridgeError(Exception):
    def __init__(self, status, code, message, retry_after=None):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.retry_after = retry_after


class NoRedirects(HTTPRedirectHandler):
    """Never forward a bearer key through an upstream redirect."""

    def redirect_request(self, *args, **kwargs):
        return None


def nvidia_request(prompt, api_key, model):
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": (
                "You are a concise advisory assistant for maTumbo Reality Lens. "
                "Explain and suggest; do not claim to operate tools, accounts, "
                "wallets, trades, payments, or the demo. State uncertainty."
            )},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 2_048, "temperature": 0.6, "stream": False,
    }
    if model == DEFAULT_MODEL:
        payload["reasoning_budget"] = 256
    request = Request(UPSTREAM, data=json.dumps(payload).encode("utf-8"), headers={
        "Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
        "Accept": "application/json", "User-Agent": "maTumbo-RealityLens-Prototype/1.0",
    }, method="POST")
    try:
        with build_opener(NoRedirects()).open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise BridgeError(502, "response_too_large", "NVIDIA returned an oversized response.")
            return json.loads(raw)
    except HTTPError as error:
        # Upstream response bodies may echo supplied data. Do not relay or log them.
        if error.code in (401, 403):
            raise BridgeError(502, "key_rejected", "NVIDIA rejected this key or account entitlement.") from None
        if error.code == 429:
            retry = error.headers.get("Retry-After", "60")
            retry = int(retry) if retry.isdigit() else 60
            raise BridgeError(429, "provider_rate_limited", "NVIDIA rate-limited this request. Try again later.", min(max(retry, 1), 600)) from None
        if error.code in (400, 404, 410, 422):
            raise BridgeError(502, "model_unavailable", "NVIDIA could not serve the configured model. Check its current catalog availability.") from None
        raise BridgeError(502, "provider_error", f"NVIDIA returned HTTP {error.code}.") from None
    except (URLError, TimeoutError, OSError):
        raise BridgeError(504, "provider_unreachable", "NVIDIA could not be reached within the request timeout.") from None
    except (ValueError, UnicodeError):
        raise BridgeError(502, "invalid_provider_response", "NVIDIA returned an unreadable response.") from None


class ProviderState:
    def __init__(self, api_key="", model=DEFAULT_MODEL, requester=nvidia_request, clock=time.monotonic):
        self.api_key = api_key.strip()
        self.model = model.strip()
        if not re.fullmatch(r"[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+", self.model):
            raise ValueError("NVIDIA_MODEL must be a catalog model id, for example vendor/model-name.")
        self.requester, self.clock = requester, clock
        self.lock = threading.Lock()
        self.requests = deque()
        self.in_flight = False
        self.verified_at = None
        self.last_error = None
        self.retry_until = 0

    def status(self):
        with self.lock:
            state = "key_needed" if not self.api_key else "configured"
            if self.api_key and self.verified_at:
                state = "verified"
            if self.last_error:
                state = "error"
            return {
                "service": "matumbo-provider-bridge", "version": 1,
                "checkedAt": utc_now(), "credentialsInBrowser": False,
                "providers": [{"id": "nvidia", "label": "NVIDIA NIM", "state": state,
                    "configured": bool(self.api_key), "model": self.model,
                    "verifiedAt": self.verified_at, "error": self.last_error,
                    "retryAfter": max(0, int(self.retry_until - self.clock() + 0.999)),
                    "keySetupUrl": "https://build.nvidia.com/",
                    "terms": "Developer/prototyping access; provider limits and model availability apply.",
                    "inferenceRequiresSend": True, "advisory": True}],
            }

    def chat(self, value):
        if not isinstance(value, dict) or set(value) != {"prompt"}:
            raise BridgeError(400, "invalid_request", "Send an object containing only a prompt string.")
        prompt = value.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_LENGTH:
            raise BridgeError(400, "invalid_prompt", "Enter a prompt of 1 to 4000 characters.")
        with self.lock:
            if not self.api_key:
                raise BridgeError(503, "key_needed", "Set NVIDIA_API_KEY in the server environment and restart the bridge.")
            if self.in_flight:
                raise BridgeError(409, "request_in_progress", "One NVIDIA request is already in progress.")
            now = self.clock()
            if now < self.retry_until:
                raise BridgeError(429, "provider_cooldown", "NVIDIA requested a cooldown. Try again later.", max(1, int(self.retry_until - now + 0.999)))
            while self.requests and now - self.requests[0] >= 60:
                self.requests.popleft()
            if len(self.requests) >= LOCAL_LIMIT_PER_MINUTE:
                raise BridgeError(429, "local_rate_limit", "The local bridge permits six requests per minute.", max(1, int(60 - (now - self.requests[0]) + 0.999)))
            self.requests.append(now)
            self.in_flight = True
        try:
            response = self.requester(prompt.strip(), self.api_key, self.model)
            if not isinstance(response, dict):
                raise BridgeError(502, "invalid_provider_response", "NVIDIA returned an invalid response.")
            choices = response.get("choices")
            message = choices[0].get("message", {}) if isinstance(choices, list) and choices and isinstance(choices[0], dict) else {}
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, str) or not content.strip():
                raise BridgeError(502, "empty_provider_response", "NVIDIA returned no answer within the bounded output budget. Try a shorter prompt or another configured model.")
            usage = response.get("usage", {})
            safe_usage = {name: usage[name] for name in ("prompt_tokens", "completion_tokens", "total_tokens")
                          if isinstance(usage, dict) and type(usage.get(name)) is int and usage[name] >= 0}
            verified = utc_now()
            with self.lock:
                self.verified_at, self.last_error = verified, None
            return {"provider": "nvidia", "model": self.model,
                "content": content[:16_000].replace(self.api_key, "[redacted]"),
                "usage": safe_usage, "verifiedAt": verified, "advisory": True}
        except BridgeError as error:
            with self.lock:
                self.last_error = {"code": error.code, "message": error.message}
                if error.retry_after:
                    self.retry_until = self.clock() + error.retry_after
            raise
        except Exception:
            # Do not print arbitrary exception text: libraries may include headers.
            with self.lock:
                self.last_error = {"code": "provider_error", "message": "NVIDIA returned an unexpected response."}
            raise BridgeError(502, "provider_error", "NVIDIA returned an unexpected response.") from None
        finally:
            with self.lock:
                self.in_flight = False


def allowed_origin(origin, port):
    if origin == PUBLIC_ORIGIN:
        return True
    try:
        url = urlsplit(origin)
        return (url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1")
                and not url.username and not url.password and not url.path and not url.query and not url.fragment
                and 1 <= (url.port or 80) <= 65535)
    except ValueError:
        return False


def static_path(root, raw_path):
    """Expose only deployable site assets; resolve symlinks before containment."""
    try:
        raw = unquote(raw_path)
        if "\\" in raw or "\0" in raw or not raw.startswith("/"):
            return None
        relative = "index.html" if raw == "/" else raw[1:]
        if any(part in ("", ".", "..") or part.startswith(".") or ":" in part for part in relative.split("/")):
            return None
        if relative not in ROOT_FILES and not relative.startswith(STATIC_PREFIXES):
            return None
        if Path(relative).suffix.lower() not in STATIC_TYPES:
            return None
        resolved = (root / relative).resolve()
        if not resolved.is_relative_to(root) or not resolved.is_file():
            return None
        return resolved
    except (OSError, ValueError):
        return None


def create_server(root, port=8082, state=None, gpt_state=None):
    root = Path(root).resolve()
    state = state or ProviderState(os.environ.get("NVIDIA_API_KEY", ""), os.environ.get("NVIDIA_MODEL", DEFAULT_MODEL))
    gpt_state = gpt_state or gpt_bridge.GPTState(os.environ.get("OPENAI_API_KEY", ""), os.environ.get("OPENAI_MODEL", gpt_bridge.DEFAULT_MODEL))
    root_fingerprint = hashlib.sha256(str(root).replace('\\', '/').lower().rstrip('/').encode('utf-8')).hexdigest()
    instance_id = uuid.uuid4().hex

    def health():
        # The launcher can prove checkout and process identity without publishing local paths.
        navigator = root / 'src' / 'render' / 'feature-navigator.js'
        text = navigator.read_text(encoding='utf-8') if navigator.is_file() else ''
        definitions = text.split('FEATURE_DEFINITIONS', 1)[-1].split(']);', 1)[0]
        feature_count = len(re.findall(r'^\s+id:\s*["\'][^"\']+["\']', definitions, re.M))
        return {'service':'matumbo-provider-bridge','version':1,'instanceId':instance_id,
            'rootFingerprint':root_fingerprint,'featureCount':feature_count,
            'healthy':(root / 'index.html').is_file() and (root / 'src' / 'main.js').is_file(),
            'localOnly':True,'credentialsInBrowser':False,'externalDeployment':False,
            'storage':'browser-local-projection','checkedAt':utc_now()}

    class Handler(BaseHTTPRequestHandler):
        server_version = "maTumboBridge/1"

        def log_message(self, *args):
            # Avoid recording prompts, URL query data, credentials, or exceptions.
            return

        def permitted(self):
            expected = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            if self.headers.get("Host", "") not in expected:
                self.send_json(403, {"error": {"code": "host_rejected", "message": "Loopback host required."}})
                return False
            origin = self.headers.get("Origin")
            if origin and not allowed_origin(origin, self.server.server_port):
                self.send_json(403, {"error": {"code": "origin_rejected", "message": "This page origin is not permitted."}})
                return False
            self.connection.settimeout(BODY_TIMEOUT_SECONDS)
            return True

        def gpt_permitted(self, mutation=False):
            # GPT credentials are usable only from this exact local page origin.
            expected = "http://" + self.headers.get("Host", "")
            origin = self.headers.get("Origin")
            if ((origin and origin != expected) or
                    (self.headers.get("Sec-Fetch-Site") == "cross-site") or
                    (mutation and (origin != expected or self.headers.get("X-Matumbo-Gpt") != "1"))):
                self.send_json(403, {"error": {"code": "local_page_required", "message": "Open the local Reality Lens page to use GPT account access."}})
                return False
            return True

        def send_data(self, status, body, content_type="application/json", retry_after=None):
            if self.command == "POST" and status >= 400 and not getattr(self, "_body_read_started", False):
                self._body_read_started = True
                discard_rejected_body(self.rfile, self.connection, self.headers)
            self.send_response(status)
            self.send_header("Content-Type", content_type + ("; charset=utf-8" if content_type.startswith("text/") or content_type == "application/json" else ""))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Vary", "Origin")
            origin = self.headers.get("Origin")
            is_gpt = urlsplit(self.path).path.startswith("/api/gpt/")
            if origin and allowed_origin(origin, self.server.server_port) and (not is_gpt or origin == "http://" + self.headers.get("Host", "")):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Matumbo-Gpt" if is_gpt else "Content-Type")
                if self.headers.get("Access-Control-Request-Private-Network") == "true":
                    self.send_header("Access-Control-Allow-Private-Network", "true")
            if retry_after:
                self.send_header("Retry-After", str(retry_after))
            self.end_headers()
            if self.command != "HEAD":
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

        def send_json(self, status, value, retry_after=None):
            self.send_data(status, json.dumps(value, ensure_ascii=False).encode("utf-8"), retry_after=retry_after)

        def do_OPTIONS(self):
            if self.permitted():
                route = urlsplit(self.path).path
                if route.startswith("/api/gpt/") and not self.gpt_permitted():
                    return
                if route not in ("/api/providers", "/api/health", "/api/nvidia/chat", "/api/gpt/status", "/api/gpt/models", "/api/gpt/chat", "/api/gpt/sign-in", "/api/gpt/disconnect"):
                    return self.send_json(404, {"error": {"message": "Not found."}})
                self.send_data(204, b"")

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            if not self.permitted():
                return
            route = urlsplit(self.path)
            if route.path.startswith("/api/gpt/"):
                if route.path != "/api/gpt/callback" and not self.gpt_permitted():
                    return
                try:
                    if route.path == "/api/gpt/status" and not route.query:
                        return self.send_json(200, gpt_state.status())
                    if route.path == "/api/gpt/models" and not route.query:
                        return self.send_json(200, gpt_state.models())
                    if route.path == "/api/gpt/callback" and self.command == "GET":
                        gpt_state.callback(route.query)
                        # Replace the code-bearing address before rendering any app assets.
                        self.send_response(303)
                        self.send_header("Location", "/?feature=web-ai&gpt_connected=1")
                        self.send_header("Content-Length", "0")
                        self.send_header("Cache-Control", "no-store")
                        self.send_header("Referrer-Policy", "no-referrer")
                        return self.end_headers()
                    return self.send_json(404, {"error": {"code": "not_found", "message": "Not found."}})
                except gpt_bridge.GPTError as error:
                    if route.path == "/api/gpt/callback":
                        gpt_state.errors["chatgpt"] = error.public()
                        self.send_response(303)
                        self.send_header("Location", "/?feature=web-ai&gpt_error=" + error.code)
                        self.send_header("Content-Length", "0")
                        self.send_header("Cache-Control", "no-store")
                        self.send_header("Referrer-Policy", "no-referrer")
                        return self.end_headers()
                    return self.send_json(error.status, {"error": error.public()}, error.retry_after)
                except (OSError, ValueError):
                    return self.send_json(503, {"error": {"code": "credential_storage_unavailable", "message": "Protected local GPT account storage could not be read."}})
            if route.path == "/api/providers" and not route.query:
                return self.send_json(200, state.status())
            if route.path == "/api/health" and not route.query:
                return self.send_json(200, health())
            file = static_path(root, route.path)
            if not file:
                return self.send_json(404, {"error": {"code": "not_found", "message": "Not found."}})
            try:
                self.send_data(200, file.read_bytes(), STATIC_TYPES[file.suffix.lower()])
            except OSError:
                self.send_json(404, {"error": {"code": "not_found", "message": "Not found."}})

        def do_POST(self):
            self._body_read_started = False
            self.connection.settimeout(BODY_TIMEOUT_SECONDS)
            if not self.permitted():
                return
            gpt_routes = {"/api/gpt/sign-in", "/api/gpt/disconnect", "/api/gpt/chat"}
            is_gpt = self.path in gpt_routes
            if is_gpt and not self.gpt_permitted(mutation=True):
                return
            if self.path != "/api/nvidia/chat" and not is_gpt:
                return self.send_json(404, {"error": {"code": "not_found", "message": "Not found."}})
            if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
                return self.send_json(415, {"error": {"code": "json_required", "message": "JSON content required."}})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > (gpt_bridge.MAX_BODY_BYTES if is_gpt else MAX_BODY_BYTES) or self.headers.get("Transfer-Encoding"):
                    raise BridgeError(413, "invalid_body_length", "Request body is missing or too large.")
                self._body_read_started = True
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise BridgeError(400, "incomplete_body", "Request body is incomplete.")
                value = json.loads(raw.decode("utf-8"))
                if self.path == "/api/gpt/sign-in":
                    result = gpt_state.sign_in(value, self.server.server_port)
                elif self.path == "/api/gpt/disconnect":
                    result = gpt_state.disconnect(value)
                elif self.path == "/api/gpt/chat":
                    result = gpt_state.chat(value)
                else:
                    result = state.chat(value)
                self.send_json(200, result)
            except gpt_bridge.GPTError as error:
                self.send_json(error.status, {"error": error.public()}, error.retry_after)
            except BridgeError as error:
                self.send_json(error.status, {"error": {"code": error.code, "message": error.message}}, error.retry_after)
            except (ValueError, UnicodeError):
                self.send_json(400, {"error": {"code": "invalid_json", "message": "Valid JSON is required."}})
            except (TimeoutError, OSError):
                self.send_json(408, {"error": {"code": "request_timeout", "message": "Request body timed out."}})

    server = LoopbackThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8082)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port must be from 1 to 65535.")
    try:
        bridge = create_server(Path(__file__).resolve().parent.parent, args.port)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Provider bridge could not start: {type(error).__name__}. Check port and NVIDIA_MODEL.\n")
    print(f"Reality Lens + provider bridge: http://127.0.0.1:{bridge.server_port}", flush=True)
    print("NVIDIA status is configuration only until an explicit Send succeeds.", flush=True)
    try:
        bridge.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        bridge.server_close()
