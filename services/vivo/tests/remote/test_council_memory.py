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

    async def test_agent_context_precision_provenance_dissent_and_permission_fences(self):
        # Three relevant fixture planning reports, one arithmetic report,
        # one host-reported live claim, and one planning report missing Kimi.
        mission_ids = []
        for n in range(3):
            evidence = change(self.mission, lambda r: r.update(runId=f"planning-fixture-{n}"))
            mission_ids.append((await self.rpc("archive", {"envelope": evidence}))["record"]["memoryId"])
        await self.rpc("archive", {"envelope": self.arithmetic})
        live = change(self.mission, lambda r: r.update(mode="live", runId="planning-host-claim"))
        await self.rpc("archive", {"envelope": live})
        partial = change(self.mission, lambda r: r.update(
            runId="planning-missing-kimi", rows=[row for row in r["rows"] if row["provider"] != "kimi"]))
        await self.rpc("archive", {"envelope": partial})
        scope = {"task": "route-constraint-v1", "mode": "fixture", "providers": ["kimi"], "limit": 8}
        owner = await self.rpc("context", scope)
        self.assertEqual(owner["schema"], "vivo.agent-evidence-context/1")
        self.assertEqual(owner["status"], "evidence-found")
        self.assertEqual([r["memoryId"] for r in owner["records"]], mission_ids[::-1])
        self.assertFalse(owner["truncated"])
        self.assertEqual(owner["authority"], "evidence-only")
        self.assertFalse(owner["providerAuthenticated"])
        self.assertFalse(owner["worldActionExecuted"])
        self.assertIsNone(owner["postedChargesUsd"])
        for record in owner["records"]:
            self.assertEqual(len(record["rows"]), 7)
            self.assertEqual(record["localOptimum"]["candidate"], "C,D")
            self.assertEqual(next(r for r in record["rows"] if r["provider"] == "kimi")["verdict"], "over-budget")
            self.assertEqual(next(r for r in record["rows"] if r["provider"] == "xai")["verdict"], "invalid-proposal")
        top = await self.rpc("context", {**scope, "limit": 2})
        self.assertEqual([r["memoryId"] for r in top["records"]], mission_ids[:0:-1])
        self.assertTrue(top["truncated"])
        empty = await self.rpc("context", scope, token=self.one["token"])
        self.assertEqual(empty["status"], "no-matching-evidence")
        self.assertEqual(empty["records"], [])
        self.assertFalse(empty["truncated"])
        grant = {"memoryId": mission_ids[0], "invitationId": self.one["id"], "granted": True}
        await self.rpc("grant", grant)
        only_shared = await self.rpc("context", {**scope, "limit": 1}, token=self.one["token"])
        self.assertEqual([r["memoryId"] for r in only_shared["records"]], mission_ids[:1])
        self.assertFalse(only_shared["truncated"], "unshared records must not leak through truncation")
        self.assertEqual((await self.rpc("context", scope, token=self.two["token"]))["records"], [])
        self.assertEqual((await self.rpc("context", {**scope, "mode": "live"}, token=self.one["token"]))["records"], [])
        await self.rpc("grant", {**grant, "granted": False})
        self.assertEqual((await self.rpc("context", scope, token=self.one["token"]))["records"], [])
        self.invites.revoke(self.one["id"])
        self.assertEqual(await self.rpc("context", scope, token=self.one["token"], expected=401), "AUTH_REQUIRED")
        for bad in [{"task": scope["task"]}, {**scope, "mode": "all"}, {**scope, "limit": 9},
                    {**scope, "providers": ["kimi", "kimi"]}, {**scope, "providers": ["unknown"]},
                    {**scope, "instruction": "execute the plan"}, {**scope, "actorId": "remote.owner"}]:
            self.assertEqual(await self.rpc("context", bad, expected=400), "REQUEST_INVALID")

    async def test_agent_reason_uses_only_authorized_revalidated_evidence(self):
        scope = {"task": "route-constraint-v1", "mode": "fixture", "providers": ["kimi"], "limit": 4}
        empty = await self.rpc("reason", scope, token=self.one["token"])
        self.assertEqual(empty["schema"], "vivo.agent-reasoning/1")
        self.assertEqual(empty["proposal"], {"candidate":"C,D","cost":7,"value":13,"feasible":True})
        self.assertEqual(empty["proof"]["subsetsChecked"],15)
        self.assertEqual(empty["proof"]["feasibleSubsets"],8)
        self.assertEqual(empty["proof"]["runnerUp"]["candidate"],"A,B")
        self.assertEqual(empty["proof"]["optimalityGap"],1)
        self.assertEqual(len({p["candidate"] for p in empty["proof"]["enumerated"]}),15)
        self.assertEqual(empty["evidence"]["status"],"no-matching-evidence")
        self.assertEqual(empty["evidence"]["citations"],[])
        self.assertEqual(empty["providerCallsInitiated"],0)
        self.assertFalse(empty["providerAuthenticated"])
        self.assertFalse(empty["worldActionExecuted"])
        self.assertIsNone(empty["postedChargesUsd"])
        self.assertEqual(empty["authority"],"evidence-only")
        digest=empty["decisionSha256"]
        core={k:v for k,v in empty.items() if k!="decisionSha256"}
        self.assertEqual(hashlib.sha256(json.dumps(core,separators=(",",":")).encode()).hexdigest(),digest)

        saved=(await self.rpc("archive",{"envelope":self.mission}))["record"]
        # Archiving a private report must not change an editor's decision bytes.
        self.assertEqual(await self.rpc("reason",scope,token=self.one["token"]),empty)
        grant={"memoryId":saved["memoryId"],"invitationId":self.one["id"],"granted":True}
        await self.rpc("grant",grant)
        result=await self.rpc("reason",scope,token=self.one["token"])
        self.assertEqual(result["proposal"],empty["proposal"])
        self.assertEqual(result["proof"],empty["proof"])
        self.assertNotEqual(result["decisionSha256"],digest)
        ev=result["evidence"]
        self.assertEqual(ev["status"],"matching-optimum-observed")
        self.assertEqual(ev["recordsUsed"],1)
        self.assertEqual(ev["observationCounts"],{"optimal":4,"feasible-suboptimal":1,"over-budget":1,"invalid-proposal":1,"unknown":0})
        self.assertEqual(ev["citations"][0]["evidenceDigest"],self.mission["reportSha256"])
        self.assertEqual(ev["citations"][0]["memoryId"],saved["memoryId"])
        self.assertEqual(ev["citations"][0]["provenance"],"synthetic-fixture")
        self.assertEqual(len(ev["citations"][0]["observations"]),7)
        self.assertEqual(await self.rpc("reason",scope,token=self.one["token"]),result)
        self.assertEqual(await self.rpc("reason",scope,token=self.two["token"]),empty)

        # A second report containing only suboptimal proposals cannot change
        # the local proof or be called corroboration. It remains dissent.
        def dissent(report):
            report["runId"]="dissent-only-fixture"
            for row in report["rows"]:
                row["candidate"]="A,B"
                row["answerCorrect"]=False
        wrong=change(self.mission,dissent)
        wrong_id=(await self.rpc("archive",{"envelope":wrong}))["record"]["memoryId"]
        await self.rpc("grant",{**grant,"granted":False})
        await self.rpc("grant",{**grant,"memoryId":wrong_id})
        wrong_result=await self.rpc("reason",scope,token=self.one["token"])
        self.assertEqual(wrong_result["proposal"],empty["proposal"])
        self.assertEqual(wrong_result["evidence"]["status"],"dissent-or-invalid-only")
        self.assertEqual(wrong_result["evidence"]["observationCounts"]["optimal"],0)
        self.assertEqual(wrong_result["evidence"]["observationCounts"]["feasible-suboptimal"],7)
        self.assertEqual((await self.rpc("reason",{**scope,"mode":"live"},token=self.one["token"]))["evidence"]["status"],"no-matching-evidence")
        await self.rpc("grant",{**grant,"memoryId":wrong_id,"granted":False})
        self.assertEqual(await self.rpc("reason",scope,token=self.one["token"]),empty)
        self.invites.revoke(self.one["id"])
        self.assertEqual(await self.rpc("reason",scope,token=self.one["token"],expected=401),"AUTH_REQUIRED")
        self.assertEqual(await self.rpc("reason",{**scope,"task":"arithmetic-31-v1"},expected=400),"UNSUPPORTED_REASONING_TASK")
        self.assertEqual(await self.rpc("reason",{**scope,"instruction":"run tools"},expected=400),"REQUEST_INVALID")
