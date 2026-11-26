"""Cross-runtime fixture and actual authenticated HTTP evidence tests."""
import json
import hashlib
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from services.vivo.server.council_memory import EvidenceVault, attach_memory_routes, validate_envelope, MemoryError
from services.vivo.server.remote_application import InvitationStore, Principal, token_hash

ROOT = Path(__file__).resolve().parents[4]
ORIGIN = "https://vivo.test"
OWNER = "owner-fixture-" + "x"*40


def fixture(task="route"):
    return json.loads(subprocess.check_output(
        ["node", str(ROOT / "scripts/vivo/provider-council.mjs"), "--fixture", "--task="+task],
        cwd=ROOT, text=True))


def change(envelope, edit):
    report = json.loads(envelope["reportJson"])
    edit(report)
    raw = json.dumps(report, separators=(",", ":"), ensure_ascii=False)
    return {**envelope, "reportJson": raw, "reportSha256": hashlib.sha256(raw.encode()).hexdigest()}


class CouncilMemoryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.vault = EvidenceVault(self.path / "evidence.sqlite")
        self.invites = InvitationStore(self.path / "invites.sqlite")
        self.one, self.two = self.invites.create(), self.invites.create()
        self.mission = fixture()
        self.arithmetic = fixture("arithmetic")
        await self.start()

    async def start(self):
        app = web.Application(client_max_size=65536)
        def authenticate(token):
            if token_hash(token) == token_hash(OWNER):
                return Principal("owner", "remote.owner", "one")
            invite = self.invites.lookup(token)
            return Principal(invite["role"], invite["actorId"], invite["seat"], invite["id"])
        attach_memory_routes(app, vault=self.vault, origin=ORIGIN,
                             authenticate=authenticate, invitations=self.invites.list)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.vault.close()
        self.invites.close()
        self.temp.cleanup()

    async def rpc(self, op, args=None, token=OWNER, expected=200, origin=ORIGIN):
        headers = {"Origin": origin}
        if token is not None:
            headers["Authorization"] = "Bearer "+token
        async with self.client.post("/api/neural-memory", headers=headers,
                                    json={"op":op,"args":args or {}}) as response:
            body = await response.json()
            self.assertEqual(response.status, expected, body)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(body["schema"], "vivo.neural-memory/1")
            return body.get("result", body.get("error"))

    async def test_archive_recall_restart_and_explicit_share(self):
        saved = await self.rpc("archive", {"envelope":self.mission})
        ident = saved["record"]["memoryId"]
        self.assertEqual(saved["status"], "recorded")
        self.assertEqual(saved["record"]["localOptimum"]["candidate"], "C,D")
        self.assertFalse(saved["record"]["providerAuthenticated"])
        self.assertEqual((await self.rpc("archive", {"envelope":self.mission}))["status"], "duplicate")
        self.assertEqual((await self.rpc("archive", {"envelope":self.arithmetic}))["status"], "recorded")
        self.assertEqual((await self.rpc("search", {"query":"kimi over-budget"}))["records"][0]["memoryId"], ident)
        self.assertEqual((await self.rpc("search", token=self.one["token"]))["records"], [])
        self.assertEqual(await self.rpc("get", {"memoryId":ident}, token=self.one["token"], expected=404), "NOT_FOUND")
        self.assertEqual(await self.rpc("archive", {"envelope":self.mission}, token=self.one["token"], expected=403), "FORBIDDEN")
        grant = {"memoryId":ident,"invitationId":self.one["id"],"granted":True}
        await self.rpc("grant", grant)
        self.assertEqual(await self.rpc("grant", grant, token=self.one["token"], expected=403), "FORBIDDEN")
        self.assertEqual((await self.rpc("get", {"memoryId":ident}, token=self.one["token"]))["envelope"],self.mission)
        self.assertEqual((await self.rpc("search", token=self.two["token"]))["records"], [])
        self.assertEqual(len((await self.rpc("grants", {"memoryId":ident}))["grants"]),1)
        # Close/reopen the actual durable stores, not an in-memory clone.
        await self.client.close()
        self.vault.close()
        self.invites.close()
        self.vault = EvidenceVault(self.path / "evidence.sqlite")
        self.invites = InvitationStore(self.path / "invites.sqlite")
        await self.start()
        self.assertEqual((await self.rpc("get", {"memoryId":ident}, token=self.one["token"]))["envelope"],self.mission)
        await self.rpc("grant", {**grant,"granted":False})
        self.assertEqual(await self.rpc("get", {"memoryId":ident}, token=self.one["token"], expected=404),"NOT_FOUND")
        await self.rpc("grant", grant)
        self.invites.revoke(self.one["id"])
        self.assertEqual(await self.rpc("search", token=self.one["token"], expected=401),"AUTH_REQUIRED")
        self.assertEqual(await self.rpc("grant", grant, expected=409),"INVITATION_INACTIVE")
        self.assertEqual(len((await self.rpc("search"))["records"]),2)

    async def test_conflict_corruption_validation_and_origin_boundary(self):
        self.assertEqual(await self.rpc("search",token=None,expected=401),"AUTH_REQUIRED")
        self.assertEqual(await self.rpc("search",origin="https://other.test",expected=403),"ORIGIN_NOT_ALLOWED")
        saved = await self.rpc("archive", {"envelope":self.mission})
        ident = saved["record"]["memoryId"]
        conflict=change(self.mission,lambda r:r["rows"][0].update(latencyMs=1))
        self.assertEqual(await self.rpc("archive",{"envelope":conflict},expected=409),"RUN_CONFLICT")
        wrong=change(self.mission,lambda r:r["rows"][0].update(candidate="A,B"))
        self.assertEqual(await self.rpc("archive",{"envelope":wrong},expected=400),"EVIDENCE_INVALID")
        money=change(self.mission,lambda r:r.update(postedChargesUsd=0))
        self.assertEqual(await self.rpc("archive",{"envelope":money},expected=400),"EVIDENCE_INVALID")
        self.assertEqual((await self.rpc("get",{"memoryId":ident}))["envelope"],self.mission)
        self.vault.db.execute("UPDATE evidence SET envelope='{}' WHERE memory_id=?",(ident,))
        self.assertEqual(await self.rpc("get",{"memoryId":ident},expected=409),"STORED_EVIDENCE_INVALID")
        self.assertEqual(await self.rpc("archive",{"envelope":self.mission},expected=409),"STORED_EVIDENCE_INVALID")

    async def test_pagination_mode_and_expired_invitation(self):
        first=await self.rpc("archive",{"envelope":self.mission})
        claim=change(self.mission,lambda r:r.update(mode="live",runId="host-claim"))
        second=await self.rpc("archive",{"envelope":claim})
        self.assertEqual(second["record"]["provenance"],"host-reported-unverified")
        self.assertFalse(second["record"]["providerAuthenticated"])
        page=await self.rpc("search",{"limit":1})
        self.assertEqual(page["records"][0]["memoryId"],second["record"]["memoryId"])
        older=await self.rpc("search",{"limit":1,"before":page["nextBefore"]})
        self.assertEqual(older["records"][0]["memoryId"],first["record"]["memoryId"])
        self.assertIsNone(older["nextBefore"])
        self.assertEqual(len((await self.rpc("search",{"mode":"fixture"}))["records"]),1)
        grant={"memoryId":first["record"]["memoryId"],"invitationId":self.one["id"],"granted":True}
        await self.rpc("grant",grant)
        self.invites.db.execute("UPDATE invitations SET expires_at=? WHERE id=?",(int(time.time())-1,self.one["id"]))
        self.assertEqual(await self.rpc("search",token=self.one["token"],expected=401),"AUTH_REQUIRED")
