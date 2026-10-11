from __future__ import annotations

import asyncio
import json
import os
import posixpath
from pathlib import Path
import re
import socket
import tempfile
import time
import unittest
from urllib.request import Request, urlopen

from aiohttp import ClientSession, WSMsgType

SERVICES = Path(__file__).resolve().parents[2]
OWNER_TOKEN = "owner-" + "x" * 48


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class RemoteClient:
    def __init__(self, session, ws, joined):
        self.session = session
        self.ws = ws
        self.joined = joined
        self.state = joined["state"]
        self.serial = 0

    @classmethod
    async def connect(cls, base, origin, token):
        session = ClientSession()
        ws = await session.ws_connect(base + "/ws", headers={"Origin": origin}, max_msg_size=64 * 1024)
        await ws.send_json({"type": "join", "token": token})
        while True:
            msg = await ws.receive(timeout=10)
            if msg.type != WSMsgType.TEXT:
                await session.close()
                raise AssertionError("remote join closed")
            body = json.loads(msg.data)
            if body.get("type") == "joined":
                return cls(session, ws, body)
            if body.get("type") == "error":
                await session.close()
                raise AssertionError(body)

    async def call(self, op, args=None):
        self.serial += 1
        ident = f"t.{self.serial}"
        await self.ws.send_json({"id": ident, "op": op, "args": args or {}})
        while True:
            msg = await self.ws.receive(timeout=10)
            if msg.type != WSMsgType.TEXT:
                raise AssertionError("socket closed during request")
            body = json.loads(msg.data)
            if body.get("type") == "state":
                self.state = body["state"]
                continue
            if body.get("type") == "reply" and body.get("id") == ident:
                if body.get("state") is not None:
                    self.state = body["state"]
                if body.get("error"):
                    raise RuntimeError(body["error"])
                return body.get("value")

    async def refresh(self):
        await self.call("state")
        return self.state

    async def wait(self, predicate, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            await self.refresh()
            if predicate(self.state):
                return self.state
            await asyncio.sleep(0.1)
        raise AssertionError("remote state condition timed out")

    async def close(self, graceful=True):
        if graceful and not self.ws.closed:
            try:
                await self.call("close")
            except Exception:
                pass
        if not self.ws.closed:
            await self.ws.close()
        await self.session.close()


class RemoteAcceptance(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name) / "private"
        self.data.mkdir(mode=0o700)
        self.port = free_port()
        self.origin = f"http://127.0.0.1:{self.port}"
        self.base = self.origin
        self.proc = None
        self.owner = None
        self.editor = None
        await self.start_server()

    async def asyncTearDown(self):
        for client in (self.owner, self.editor):
            if client:
                try:
                    await client.close()
                except Exception:
                    pass
        await self.stop_server()
        self.temp.cleanup()

    async def start_server(self):
        env = {**os.environ, "VIVO_TEST_OWNER": OWNER_TOKEN, "PYTHONDONTWRITEBYTECODE": "1"}
        self.proc = await asyncio.create_subprocess_exec(
            os.sys.executable, "-m", "server.remote_application",
            "--port", str(self.port), "--host", "127.0.0.1",
            "--data-dir", str(self.data), "--origin", self.origin,
            "--owner-token-env", "VIVO_TEST_OWNER", "--allow-insecure-loopback",
            cwd=SERVICES, env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        deadline = time.monotonic() + 30
        last = None
        while time.monotonic() < deadline:
            if self.proc.returncode is not None:
                out, err = await self.proc.communicate()
                self.fail(f"remote server exited: {out!r} {err!r}")
            try:
                def health():
                    with urlopen(self.base + "/healthz", timeout=2) as response:
                        return response.status, json.load(response)
                status, body = await asyncio.to_thread(health)
                if status == 200 and body.get("ok"):
                    return
                last = body
            except Exception as exc:
                last = repr(exc)
            await asyncio.sleep(0.1)
        self.fail(f"remote readiness timeout: {last}")

    async def stop_server(self):
        if self.proc and self.proc.returncode is None:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), 8)
            except asyncio.TimeoutError:
                self.proc.kill()
                await self.proc.wait()
        self.proc = None

    async def connect_pair(self):
        self.owner = await RemoteClient.connect(self.base, self.origin, OWNER_TOKEN)
        invite = await self.owner.call("invite.create", {"ttlSeconds": 3600})
        self.invite = invite
        self.editor = await RemoteClient.connect(self.base, self.origin, invite["token"])
        self.assertEqual(self.owner.joined["actorId"], "remote.owner")
        self.assertEqual(self.editor.joined["actorId"], invite["actorId"])
        self.assertNotIn("token", self.owner.joined["session"])
        return invite

    def command(self, state, space, kind, expected, payload, ident):
        return {"schema": "vivo.command/1", "id": ident,
                "worldId": state["snapshot"]["worldId"], "spaceId": space,
                "kind": kind, "expectedRevision": expected, "payload": payload}

    async def submit(self, client, command):
        return await client.call("submit", {"command": command})

    async def test_two_people_one_object_nested_x11_disconnect_reconnect_restart(self):
        invite = await self.connect_pair()
        root = self.owner.state["snapshot"]["spaces"]["root"]
        rev = root["entities"]["relic"]["revision"]

        # Two remote people explicitly share one persistent object.
        a = await self.submit(self.owner, self.command(self.owner.state, "root", "grab.begin", rev,
            {"entityId": "relic", "source": "touch", "inputEpoch": 1, "cooperativeGroup": "shape.team"}, "root.begin.a"))
        b = await self.submit(self.editor, self.command(self.editor.state, "root", "grab.begin", rev,
            {"entityId": "relic", "source": "hand", "inputEpoch": 1, "cooperativeGroup": "shape.team"}, "root.begin.b"))
        self.assertEqual(a["status"], "accepted")
        self.assertEqual(b["status"], "accepted")
        la, lb = a["result"]["leaseId"], b["result"]["leaseId"]

        qa = list(root["entities"]["relic"]["q"]); qa[1] += 1.0
        qb = list(root["entities"]["relic"]["q"]); qb[3] += 1.0
        self.assertEqual((await self.submit(self.owner, self.command(self.owner.state, "root", "grab.target", rev,
            {"entityId": "relic", "leaseId": la, "source": "touch", "inputEpoch": 1, "targetSeq": 1,
             "dimension": 4, "chart": "flat", "q": qa, "sampleAgeMs": 1}, "root.target.a")))["status"], "accepted")
        self.assertEqual((await self.submit(self.editor, self.command(self.editor.state, "root", "grab.target", rev,
            {"entityId": "relic", "leaseId": lb, "source": "hand", "inputEpoch": 1, "targetSeq": 1,
             "dimension": 4, "chart": "flat", "q": qb, "sampleAgeMs": 1}, "root.target.b")))["status"], "accepted")

        await self.owner.call("materialRun", {"running": True})
        moved = await self.owner.wait(lambda s: s["snapshot"]["spaces"]["root"]["entities"]["relic"]["q"][1] > -0.2
            and s["snapshot"]["spaces"]["root"]["entities"]["relic"]["q"][3] > 0)
        await self.owner.call("materialRun", {"running": False})
        root_relic = moved["snapshot"]["spaces"]["root"]["entities"]["relic"]
        self.assertGreater(root_relic["q"][3], 0)
        self.assertGreater(root_relic["q"][1], -0.15)

        # Release both capabilities after material revision changes.
        for client, lease, epoch, ident in ((self.owner, la, 1, "root.end.a"), (self.editor, lb, 1, "root.end.b")):
            receipt = await self.submit(client, self.command(client.state, "root", "grab.end", root_relic["revision"],
                {"entityId": "relic", "leaseId": lease, "inputEpoch": epoch, "reason": "done"}, ident))
            self.assertEqual(receipt["status"], "accepted")

        # Owner enters nested 11D space; collaborator Eye remains in root.
        await self.owner.refresh()
        portal = self.owner.state["snapshot"]["spaces"]["root"]["entities"]["portal"]
        entered = await self.submit(self.owner, self.command(self.owner.state, "root", "space.enter", portal["revision"],
            {"portalEntityId": "portal", "eyeId": "main"}, "enter.inner"))
        self.assertEqual(entered["status"], "accepted")
        await self.owner.refresh(); await self.editor.refresh()
        self.assertEqual(self.owner.state["eye"]["spaceId"], "inner")
        self.assertEqual(self.owner.state["eye"]["dimension"], 11)
        self.assertEqual(self.editor.state["eye"]["spaceId"], "root")

        inner = self.owner.state["snapshot"]["spaces"]["inner"]["entities"]["relic"]
        inner_rev = inner["revision"]
        beg = await self.submit(self.owner, self.command(self.owner.state, "inner", "grab.begin", inner_rev,
            {"entityId": "relic", "source": "keyboard", "inputEpoch": 2}, "inner.begin"))
        lease = beg["result"]["leaseId"]
        q11 = list(inner["q"]); q11[10] = 1.0
        await self.submit(self.owner, self.command(self.owner.state, "inner", "grab.target", inner_rev,
            {"entityId": "relic", "leaseId": lease, "source": "keyboard", "inputEpoch": 2, "targetSeq": 1,
             "dimension": 11, "chart": "flat", "q": q11, "sampleAgeMs": 1}, "inner.target"))
        await self.owner.call("materialRun", {"running": True})
        inner_state = await self.owner.wait(lambda s: s["snapshot"]["spaces"]["inner"]["entities"]["relic"]["q"][10] > 0)
        await self.owner.call("materialRun", {"running": False})
        accepted_x11 = inner_state["snapshot"]["spaces"]["inner"]["entities"]["relic"]["q"][10]
        self.assertGreater(accepted_x11, 0)
        inner_current = inner_state["snapshot"]["spaces"]["inner"]["entities"]["relic"]
        await self.submit(self.owner, self.command(self.owner.state, "inner", "grab.end", inner_current["revision"],
            {"entityId": "relic", "leaseId": lease, "inputEpoch": 2, "reason": "done"}, "inner.end"))

        # Editor holds root, drops network, and server cleanup releases only that capability.
        await self.editor.refresh()
        eroot = self.editor.state["snapshot"]["spaces"]["root"]["entities"]["relic"]
        held = await self.submit(self.editor, self.command(self.editor.state, "root", "grab.begin", eroot["revision"],
            {"entityId": "relic", "source": "touch", "inputEpoch": 2}, "disconnect.begin"))
        held_id = held["result"]["leaseId"]
        qt = list(eroot["q"]); qt[0] += 0.2
        await self.submit(self.editor, self.command(self.editor.state, "root", "grab.target", eroot["revision"],
            {"entityId": "relic", "leaseId": held_id, "source": "touch", "inputEpoch": 2, "targetSeq": 1,
             "dimension": 4, "chart": "flat", "q": qt, "sampleAgeMs": 1}, "disconnect.target"))
        await self.editor.close(graceful=False); self.editor = None
        cleaned = await self.owner.wait(lambda s: not any(c.get("actorId") == invite["actorId"] for c in s["constraints"]))
        self.assertFalse(any(c.get("actorId") == invite["actorId"] for c in cleaned["constraints"]))

        # Same durable invite reconnects to same participant Eye/state.
        self.editor = await RemoteClient.connect(self.base, self.origin, invite["token"])
        self.assertEqual(self.editor.joined["actorId"], invite["actorId"])
        self.assertEqual(self.editor.state["eye"]["spaceId"], "root")
        self.assertAlmostEqual(self.editor.state["snapshot"]["spaces"]["inner"]["entities"]["relic"]["q"][10], accepted_x11)

        # Graceful shutdown and full process restart preserve accepted object/Eyes/invite, not leases.
        await self.owner.close(); self.owner = None
        await self.editor.close(); self.editor = None
        await self.stop_server()
        await self.start_server()
        self.editor = await RemoteClient.connect(self.base, self.origin, invite["token"])
        self.assertEqual(self.editor.state["eye"]["spaceId"], "root")
        self.assertAlmostEqual(self.editor.state["snapshot"]["spaces"]["inner"]["entities"]["relic"]["q"][10], accepted_x11)
        self.assertEqual(self.editor.state["constraints"], [])

    async def test_invite_token_is_one_way_stored_and_revocation_blocks_rejoin(self):
        invite = await self.connect_pair()
        db = self.data / "remote-invitations.sqlite"
        raw = db.read_bytes()
        self.assertNotIn(invite["token"].encode(), raw)
        await self.editor.close(); self.editor = None
        await self.owner.call("invite.revoke", {"id": invite["id"]})
        session = ClientSession()
        try:
            ws = await session.ws_connect(self.base + "/ws", headers={"Origin": self.origin})
            await ws.send_json({"type": "join", "token": invite["token"]})
            body = await ws.receive_json(timeout=5)
            self.assertEqual(body["type"], "error")
            self.assertEqual(body["code"], "AUTH_FAILED")
            await ws.close()
        finally:
            await session.close()

    async def test_revocation_disconnects_an_already_admitted_editor(self):
        invite = await self.connect_pair()
        await self.owner.call("invite.revoke", {"id": invite["id"]})
        # aiohttp updates the client-side closed flag only after its reader
        # consumes the server's close frame.  Assert the protocol event
        # directly so this regression does not race the reader task.
        deadline = time.monotonic() + 5
        message = None
        while time.monotonic() < deadline:
            remaining = max(0.05, deadline - time.monotonic())
            try:
                message = await self.editor.ws.receive(timeout=min(remaining, 1))
            except asyncio.TimeoutError:
                continue
            if message.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                break
        self.assertIsNotNone(message)
        self.assertIn(message.type, (WSMsgType.CLOSE, WSMsgType.CLOSED))
        self.assertEqual(self.editor.ws.close_code, 4003)

    async def test_device_evidence_has_origin_and_release_digest_headers(self):
        request = Request(self.base + "/device-check", method="HEAD")
        with urlopen(request, timeout=5) as response:
            self.assertEqual(response.headers.get("X-Vivo-Release-Origin"), self.origin)
            digest = response.headers.get("X-Vivo-Release-Digest")
            self.assertRegex(digest or "", r"^sha256:[0-9a-f]{64}$")

    async def test_remote_browser_module_graph_is_allowlisted(self):
        """Every static ESM import used by the remote bootstrap must be served."""
        imports = re.compile(
            r'''(?:\bimport\s+(?:[^"']*?\sfrom\s+)?|\bexport\s+[^"']*?\sfrom\s+)["']([^"']+)["']'''
        )
        pending = {"/application/remote-bootstrap.mjs"}
        seen = set()
        async with ClientSession() as session:
            while pending:
                path = pending.pop()
                if path in seen or not path.startswith("/"):
                    continue
                async with session.get(self.base + path) as response:
                    self.assertEqual(response.status, 200, path)
                    source = await response.text()
                seen.add(path)
                for specifier in imports.findall(source):
                    if specifier.startswith("/"):
                        child = posixpath.normpath(specifier)
                    elif specifier.startswith("."):
                        child = posixpath.normpath(
                            posixpath.join(posixpath.dirname(path), specifier)
                        )
                    else:
                        continue
                    if child.endswith((".mjs", ".js")):
                        pending.add(child)
        self.assertIn("/application/offline-branch.mjs", seen)

    async def test_invitation_identity_cap_counts_revoked_rows(self):
        owner = await RemoteClient.connect(self.base, self.origin, OWNER_TOKEN)
        invites = []
        try:
            for _ in range(32):
                invites.append(await owner.call("invite.create", {"ttlSeconds": 3600}))
            for invite in invites:
                await owner.call("invite.revoke", {"id": invite["id"]})
            with self.assertRaisesRegex(RuntimeError, "INVITE_LIMIT"):
                await owner.call("invite.create", {"ttlSeconds": 3600})
        finally:
            await owner.close()

    async def test_wrong_origin_is_refused_before_websocket_upgrade(self):
        session = ClientSession()
        try:
            with self.assertRaises(Exception):
                await session.ws_connect(self.base + "/ws", headers={"Origin": "https://evil.invalid"})
        finally:
            await session.close()


if __name__ == "__main__":
    unittest.main()
