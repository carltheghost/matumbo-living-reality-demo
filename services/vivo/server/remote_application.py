"""Canonical two-person Vivo WebSocket gateway.

This gateway never owns world state. One private MountedRuntime remains the
authority. Public clients receive no private runtime token, no camera frames and
no direct material proposal endpoint.
"""
from __future__ import annotations

import argparse
import asyncio
from collections import deque
import contextlib
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import secrets
import sqlite3
import ssl
import stat
import time
import uuid

from aiohttp import WSMsgType, web

from .local_application import LocalBridge
from .application.adaptive_host import AdaptiveApplicationHost
from .authority.module_routes import install_module_routes
from .geometry import Geometry

WEB_ROOT = Path(__file__).resolve().parents[1] / "web"
REPOSITORY = WEB_ROOT.parents[2]

MAX_MESSAGE = 64 * 1024
MAX_CONNECTIONS = 2
POLL_SECONDS = 0.10
RATE_WINDOW = 10.0
RATE_LIMIT = 120
OWNER_ACTOR = "remote.owner"
_ID_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:-")
RELEASE_FILES = (
    "application/device-check.html",
    "application/device-check.mjs",
    "application/device-check.css",
    "application/camera-compat.mjs",
    "camera.js",
    "hand-worker.js",
)


def release_digest():
    """Return an immutable digest for the browser evidence surface."""
    hasher = hashlib.sha256()
    for relative in RELEASE_FILES:
        path = WEB_ROOT / relative
        require(path.is_file(), "RELEASE_FILE_MISSING")
        hasher.update(relative.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(path.read_bytes())
        hasher.update(b"\0")
    return "sha256:" + hasher.hexdigest()

class RemoteError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def require(ok, code):
    if not ok:
        raise RemoteError(code)


RELEASE_DIGEST = release_digest()


def identifier(value, limit=128):
    return isinstance(value, str) and 1 <= len(value) <= limit and all(c in _ID_CHARS for c in value)


def token_hash(token):
    require(isinstance(token, str) and 20 <= len(token) <= 256, "AUTH_TOKEN")
    return hashlib.sha256(token.encode("utf-8")).digest()


def private_dir(path: Path):
    path = path.resolve()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name != "nt":
        path.chmod(0o700)
        require(stat.S_IMODE(path.stat().st_mode) & 0o077 == 0, "REMOTE_PRIVATE_DIRECTORY")
    else:
        raise RemoteError("REMOTE_WINDOWS_ACL_UNVERIFIED")
    return path


class InvitationStore:
    """Durable invitation metadata. Plain invitation tokens are never stored."""

    def __init__(self, path: Path):
        self.path = path
        self.db = sqlite3.connect(path, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS invitations(
            id TEXT PRIMARY KEY,
            token_hash BLOB UNIQUE NOT NULL,
            actor_id TEXT UNIQUE NOT NULL,
            seat TEXT NOT NULL CHECK(seat IN ('two')),
            role TEXT NOT NULL CHECK(role IN ('editor')),
            expires_at INTEGER NOT NULL,
            revoked INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )""")

    def create(self, ttl_seconds=3600):
        require(type(ttl_seconds) is int and 60 <= ttl_seconds <= 7 * 24 * 3600, "INVITE_TTL")
        # Revocation and expiry are intentionally durable. Counting only active
        # rows would let an owner create unbounded actor identities over time.
        durable = self.db.execute("SELECT COUNT(*) FROM invitations").fetchone()[0]
        require(durable < 32, "INVITE_LIMIT")
        ident = uuid.uuid4().hex
        token = secrets.token_urlsafe(32)
        actor = "remote.invite." + ident
        now = int(time.time())
        expires = now + ttl_seconds
        self.db.execute(
            "INSERT INTO invitations(id,token_hash,actor_id,seat,role,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
            (ident, token_hash(token), actor, "two", "editor", expires, now),
        )
        return {"id": ident, "token": token, "actorId": actor, "seat": "two",
                "role": "editor", "expiresAt": expires}

    def lookup(self, token):
        digest = token_hash(token)
        row = self.db.execute(
            "SELECT id,actor_id,seat,role,expires_at,revoked FROM invitations WHERE token_hash=?",
            (digest,),
        ).fetchone()
        require(row is not None, "AUTH_FAILED")
        ident, actor, seat, role, expires, revoked = row
        require(not revoked and expires > int(time.time()), "AUTH_FAILED")
        return {"id": ident, "actorId": actor, "seat": seat, "role": role, "expiresAt": expires}

    def revoke(self, ident):
        require(identifier(ident, 64), "INVITE_ID")
        changed = self.db.execute("UPDATE invitations SET revoked=1 WHERE id=?", (ident,)).rowcount
        require(changed == 1, "NO_INVITE")
        return {"id": ident, "revoked": True}

    def list(self):
        rows = self.db.execute(
            "SELECT id,actor_id,seat,role,expires_at,revoked FROM invitations ORDER BY created_at"
        ).fetchall()
        return [{"id": r[0], "actorId": r[1], "seat": r[2], "role": r[3],
                 "expiresAt": r[4], "revoked": bool(r[5])} for r in rows]

    def close(self):
        self.db.close()


class Principal:
    def __init__(self, role, actor_id, seat, invitation_id=None):
        self.role, self.actor_id, self.seat, self.invitation_id = role, actor_id, seat, invitation_id


class RemoteGateway:
    def __init__(self, data_dir: Path, owner_token: str, origin: str, *, store="posix"):
        self.data_dir = private_dir(data_dir)
        self.owner_hash = token_hash(owner_token)
        self.origin = origin
        self.invites = InvitationStore(self.data_dir / "remote-invitations.sqlite")
        suffix = ".sqlite" if store == "sqlite" else ".json"
        self.bridge = LocalBridge(self.data_dir / ("canonical-remote" + suffix),
                                  adaptive=True, remote_actors=True, store=store)
        self.material = AdaptiveApplicationHost(self.bridge.material_call)
        self.connections = set()
        self.active = {}
        self.started = False

    async def start(self):
        await self.bridge.start()
        try:
            await self.material.start()
        except BaseException:
            await self.bridge.stop()
            raise
        self.started = True

    async def stop(self):
        for ws in list(self.connections):
            with contextlib.suppress(Exception):
                await ws.close(code=1001, message=b"server shutdown")
        with contextlib.suppress(Exception):
            await self.material.stop()
        with contextlib.suppress(Exception):
            await self.bridge.stop()
        self.invites.close()
        self.started = False

    def authenticate(self, token):
        digest = token_hash(token)
        if hmac.compare_digest(digest, self.owner_hash):
            return Principal("owner", OWNER_ACTOR, "one")
        invite = self.invites.lookup(token)
        return Principal(invite["role"], invite["actorId"], invite["seat"], invite["id"])

    async def _pause_material_if_last(self):
        """Keep the private Python pump paused when no admitted session remains."""
        if any(connection.get("node_token") for connection in self.active.values()):
            return
        with contextlib.suppress(Exception):
            await self.material.set_running(False)

    async def revoke_active_invitation(self, invitation_id):
        """Disconnect already-admitted editors whose durable invite was revoked."""
        for ws, connection in list(self.active.items()):
            principal = connection.get("principal")
            if not principal or principal.invitation_id != invitation_id:
                continue
            connection["closed_by_gateway"] = True
            node_token = connection.get("node_token")
            connection["node_token"] = None
            connection["stop"].set()
            if connection.get("poll_task"):
                with contextlib.suppress(Exception):
                    await connection["poll_task"]
            if node_token:
                with contextlib.suppress(Exception):
                    await self.node("close", token=node_token)
            with contextlib.suppress(Exception):
                await ws.close(code=4003, message=b"INVITE_REVOKED")
        await self._pause_material_if_last()

    async def node(self, op, *, token=None, args=None):
        result = await self.bridge.call(op, token=token, args=args or {})
        if isinstance(result, web.StreamResponse):
            try:
                body = json.loads(result.text)
            except Exception:
                body = {}
            raise RemoteError(body.get("error", "AUTHORITY_FAILED"))
        return result

    def decorate(self, state):
        value = json.loads(json.dumps(state))
        caps = value.get("capabilities")
        if isinstance(caps, dict):
            caps["remoteMultiplayer"] = True
            caps["remoteTransport"] = "websocket"
            caps["maxRemoteParticipants"] = MAX_CONNECTIONS
        value["materialHost"] = self.material.status()
        return value

    @staticmethod
    def state_signature(state):
        snap = state.get("snapshot", {})
        eye = state.get("eye") or {}
        participants = tuple(
            sorted((p.get("seat"), p.get("actorId"), bool(p.get("online")))
                   for p in state.get("participants", []))
        )
        material = state.get("capabilities", {}).get("material") or {}
        host = state.get("materialHost") or {}
        return (snap.get("stateHash"), snap.get("acceptedSequence"), snap.get("simulationTime"),
                eye.get("revision"), eye.get("spaceId"), state.get("journal", {}).get("readOnly"),
                participants, bool(material.get("running")), host.get("state"), host.get("acceptedSteps"))

    async def poll(self, ws, node_token, stop):
        previous = None
        while not stop.is_set() and not ws.closed:
            try:
                result = await self.node("state", token=node_token)
                state = self.decorate(result["state"])
                signature = self.state_signature(state)
                if previous is not None and signature != previous:
                    await ws.send_json({"type": "state", "state": state})
                previous = signature
            except Exception:
                if not ws.closed:
                    with contextlib.suppress(Exception):
                        await ws.send_json({"type": "error", "code": "AUTHORITY_UNAVAILABLE"})
                return
            try:
                await asyncio.wait_for(stop.wait(), POLL_SECONDS)
            except asyncio.TimeoutError:
                pass

    async def websocket(self, request):
        if request.headers.get("Origin") != self.origin:
            raise web.HTTPForbidden(text="Exact configured Origin required")
        if len(self.connections) >= MAX_CONNECTIONS:
            raise web.HTTPServiceUnavailable(text="Two-person remote stage is full")
        ws = web.WebSocketResponse(max_msg_size=MAX_MESSAGE, heartbeat=20, compress=False)
        await ws.prepare(request)
        self.connections.add(ws)
        node_token = None
        poll_task = None
        stop = asyncio.Event()
        principal = None
        connection = None
        try:
            try:
                first = await asyncio.wait_for(ws.receive(), 5)
            except asyncio.TimeoutError:
                await ws.send_json({"type": "error", "code": "AUTH_TIMEOUT"})
                return ws
            if first.type != WSMsgType.TEXT or len(first.data.encode("utf-8")) > MAX_MESSAGE:
                await ws.send_json({"type": "error", "code": "AUTH_MESSAGE"})
                return ws
            try:
                data = json.loads(first.data)
                require(isinstance(data, dict) and set(data) == {"type", "token"}
                        and data["type"] == "join", "AUTH_MESSAGE")
                principal = self.authenticate(data["token"])
                admitted = await self.node("open", args={"seat": principal.seat,
                    "actorId": principal.actor_id, "readOnly": False})
                node_token = admitted["token"]
                connection = {
                    "principal": principal,
                    "node_token": node_token,
                    "stop": stop,
                    "closed_by_gateway": False,
                }
                self.active[ws] = connection
                state = self.decorate(admitted["state"])
                await ws.send_json({"type": "joined", "role": principal.role,
                    "actorId": principal.actor_id, "session": admitted["session"], "state": state})
            except RemoteError as exc:
                await ws.send_json({"type": "error", "code": exc.code})
                return ws
            except Exception:
                await ws.send_json({"type": "error", "code": "AUTH_FAILED"})
                return ws

            poll_task = asyncio.create_task(self.poll(ws, node_token, stop))
            connection["poll_task"] = poll_task
            times = deque()
            async for message in ws:
                if message.type == WSMsgType.ERROR:
                    break
                if message.type != WSMsgType.TEXT:
                    continue
                now = time.monotonic()
                while times and now - times[0] > RATE_WINDOW:
                    times.popleft()
                if len(times) >= RATE_LIMIT:
                    await ws.send_json({"type": "error", "code": "RATE_LIMIT"})
                    continue
                times.append(now)
                try:
                    require(len(message.data.encode("utf-8")) <= MAX_MESSAGE, "REQUEST_TOO_LARGE")
                    body = json.loads(message.data)
                    require(isinstance(body, dict) and set(body) == {"id", "op", "args"}, "INVALID_MESSAGE")
                    ident, op, args = body["id"], body["op"], body["args"]
                    require(identifier(ident, 64) and isinstance(op, str) and isinstance(args, dict), "INVALID_MESSAGE")

                    if op == "invite.create":
                        require(principal.role == "owner", "FORBIDDEN")
                        require(set(args) <= {"ttlSeconds"}, "INVALID_ARGUMENT")
                        value = self.invites.create(args.get("ttlSeconds", 3600))
                        await ws.send_json({"type": "reply", "id": ident, "value": value})
                        continue
                    if op == "invite.revoke":
                        require(principal.role == "owner" and set(args) == {"id"}, "FORBIDDEN")
                        value = self.invites.revoke(args["id"])
                        await self.revoke_active_invitation(args["id"])
                        await ws.send_json({"type": "reply", "id": ident, "value": value})
                        continue
                    if op == "invite.list":
                        require(principal.role == "owner" and not args, "FORBIDDEN")
                        await ws.send_json({"type": "reply", "id": ident, "value": self.invites.list()})
                        continue

                    allowed = {"state","submit","moveEye","inspectLease","renewLease",
                               "reconcileLease","nextEpoch","export","close"}
                    if principal.role == "owner":
                        allowed.add("materialRun")
                    require(op in allowed, "FORBIDDEN")
                    if op == "materialRun" and args.get("running") is True:
                        require(not self.material.status().get("fault"), "MATERIAL_HOST_RESTART_REQUIRED")
                    result = await self.node(op, token=node_token, args=args)
                    if op == "materialRun":
                        running = bool(result["value"]["running"])
                        try:
                            await self.material.set_running(running)
                        except Exception as error:
                            # The authority may already have accepted the node
                            # flag. Roll it back if the private host rejects it.
                            if running:
                                with contextlib.suppress(Exception):
                                    await self.node("materialRun", token=node_token, args={"running": False})
                            raise RemoteError(getattr(error, "code", "MATERIAL_HOST_RESTART_REQUIRED"))
                    state = self.decorate(result["state"]) if result.get("state") else None
                    await ws.send_json({"type": "reply", "id": ident,
                                        "value": result.get("value"), "state": state})
                    if op == "close":
                        node_token = None
                        connection["node_token"] = None
                        break
                except RemoteError as exc:
                    await ws.send_json({"type": "reply", "id": body.get("id") if isinstance(locals().get("body"), dict) else None,
                                        "error": exc.code})
                except Exception:
                    await ws.send_json({"type": "reply", "id": body.get("id") if isinstance(locals().get("body"), dict) else None,
                                        "error": "INVALID_REQUEST"})
        finally:
            stop.set()
            if poll_task:
                # Do not cancel an in-flight private-pipe state read: cancellation
                # could strand a valid reply and desynchronize the next request.
                with contextlib.suppress(Exception):
                    await poll_task
            if node_token and not (connection and connection.get("closed_by_gateway")):
                with contextlib.suppress(Exception):
                    await self.node("close", token=node_token)
            if connection:
                self.active.pop(ws, None)
            self.connections.discard(ws)
            await self._pause_material_if_last()
        return ws


def remote_index():
    source = (WEB_ROOT / "index.html").read_text(encoding="utf-8")
    marker = '<script type="module" src="shared.js"></script>'
    require(source.count(marker) == 1, "REMOTE_INDEX_CHANGED")
    source = source.replace("<head>", '<head><base href="/">', 1)
    source = source.replace("</head>", '<link rel="stylesheet" href="/application/remote.css"></head>', 1)
    source = source.replace(marker, '<script type="module" src="/application/remote-bootstrap.mjs"></script>')
    source = source.replace("maTumbo Viva · Shared Workshop", "Vivo · Canonical Remote")
    source = source.replace("SHARED WORKSHOP · 0.8.1", "CANONICAL REMOTE · TWO PERSON")
    source = source.replace("Meet inside<br>the mathematics.", "One world.<br>Different places.")
    source = source.replace(
        "Move the same objects with another person. Explore curved spaces. Watch a learned local rule grow a guidance field.",
        "Shape one persistent learned material with another person, keep independent Eyes, and enter the same nested higher-dimensional world."
    )
    return source


async def make_remote_app(data_dir, owner_token, origin, *, store="posix"):
    gateway = RemoteGateway(Path(data_dir), owner_token, origin, store=store)

    @web.middleware
    async def security(request, handler):
        response = await handler(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            "media-src 'self' blob:; connect-src 'self' ws: wss:; "
            "worker-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'"
        )
        return response

    app = web.Application(client_max_size=MAX_MESSAGE, middlewares=[security])
    app["gateway"] = gateway
    install_module_routes(app, REPOSITORY)
    grids = {d: Geometry("flat", d).sample_grid() for d in (4, 11)}

    async def health(_request):
        try:
            ready = await gateway.node("ready")
            ok = bool(ready.get("ok"))
        except Exception:
            ok = False
        return web.json_response({"ok": ok, "transport": "websocket",
                                  "material": "adaptive-graph",
                                  "physicalDeviceValidated": False,
                                  "publicDeploymentVerified": False},
                                 status=200 if ok else 503)

    async def index(_request):
        return web.Response(text=remote_index(), content_type="text/html",
                            headers={"Cache-Control": "no-cache", "X-Vivo-Application": "canonical-remote-1"})

    async def device_check(_request):
        return web.FileResponse(WEB_ROOT / "application" / "device-check.html",
                                headers={"Cache-Control": "no-cache", "X-Vivo-Application": "physical-device-evidence-1",
                                         "X-Vivo-Release-Origin": origin,
                                         "X-Vivo-Release-Digest": RELEASE_DIGEST})

    async def grid(request):
        try:
            dimension = int(request.query.get("dimension", "4"))
            value = grids[dimension]
        except (ValueError, KeyError):
            raise web.HTTPBadRequest(text="Remote Vivo supports the canonical 4D root and 11D inner world")
        return web.json_response(value)

    async def asset(_request, name):
        data = (WEB_ROOT / name).read_bytes()
        content_type = "text/css" if name.endswith(".css") else "text/javascript"
        return web.Response(body=data, content_type=content_type,
                            headers={"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"})

    app.router.add_get("/", index)
    app.router.add_get("/remote/", index)
    app.router.add_get("/device-check", device_check)
    app.router.add_get("/healthz", health)
    app.router.add_get("/api/remote/grid", grid)
    app.router.add_get("/ws", gateway.websocket)
    for name in ("shared.css","render.js","camera.js","geometry.js","hand-worker.js"):
        app.router.add_get("/" + name, lambda request, n=name: asset(request, n))
    for name in ("remote-bootstrap.mjs","remote-transport.mjs","interactions.mjs","adapters.mjs","camera-compat.mjs","remote.css","device-check.mjs","device-check.css"):
        app.router.add_get("/application/" + name,
                           lambda request, n=name: asset(request, "application/" + n))
    app.router.add_static("/vendor/", WEB_ROOT / "vendor", show_index=False, follow_symlinks=False)
    app.on_startup.append(lambda _app: gateway.start())
    app.on_shutdown.append(lambda _app: gateway.stop())
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8768)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--owner-token-env", default="VIVO_OWNER_TOKEN")
    parser.add_argument("--store", choices=("posix","sqlite"), default="posix")
    parser.add_argument("--cert", type=Path)
    parser.add_argument("--key", type=Path)
    parser.add_argument("--allow-insecure-loopback", action="store_true")
    args = parser.parse_args()
    require(1 <= args.port <= 65535, "PORT")
    owner = os.environ.get(args.owner_token_env)
    require(isinstance(owner, str) and len(owner) >= 32, "OWNER_TOKEN_MISSING")
    try:
        loopback = ipaddress.ip_address(args.host).is_loopback
    except ValueError:
        loopback = args.host == "localhost"
    context = None
    if args.cert or args.key:
        require(args.cert and args.key, "TLS_CONFIGURATION")
        context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        context.load_cert_chain(args.cert, args.key)
    elif not (loopback and args.allow_insecure_loopback):
        raise RemoteError("TLS_REQUIRED")
    if context is not None:
        require(args.origin.startswith("https://"), "ORIGIN_TLS_REQUIRED")
    app = asyncio.run(make_remote_app(args.data_dir, owner, args.origin, store=args.store))
    web.run_app(app, host=args.host, port=args.port, ssl_context=context, access_log=None)


if __name__ == "__main__":
    main()
