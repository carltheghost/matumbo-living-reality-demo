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
from services.vivo.server.council_memory import EvidenceVault, attach_memory_routes, validate_envelope, MemoryError, CAPSULE_MAX_REQUEST
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

    async def rpc(self, op, args=None, token=OWNER, expected=200, origin=ORIGIN, capsule=False, backup_set=False):
        headers = {"Origin": origin}
        if token is not None:
            headers["Authorization"] = "Bearer "+token
        path = "/api/neural-memory/backup-set" if backup_set else "/api/neural-memory/capsule" if capsule else "/api/neural-memory"
        async with self.client.post(path, headers=headers,
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


    async def test_local_capsule_roundtrip_owner_review_private_restore_and_duplicate(self):
        # Produce the exact transfer using the real JS local journal, not a
        # Python reimplementation of the source capsule encoder.
        script = """
          import {createCouncilMemory} from './src/domains/council-memory.js';
          import {runProviderCouncil} from './scripts/vivo/provider-council.mjs';
          import {exportCouncilReport,COUNCIL_MISSION_TASK} from './src/domains/provider-council-evidence.js';
          const rows=new Map();
          const journal=createCouncilMemory({storage:{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)}});
          for(const task of [COUNCIL_MISSION_TASK,undefined]){
            await journal.archive(await exportCouncilReport(await runProviderCouncil(task?{task}:{})));
          }
          console.log(JSON.stringify(await journal.exportCapsule()));
        """
        capsule = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], cwd=ROOT, text=True))
        envelopes = json.loads(capsule["journalJson"])
        saved = await self.rpc("archive", {"envelope": envelopes[0]})
        ident = saved["record"]["memoryId"]
        await self.rpc("grant", {"memoryId":ident, "invitationId":self.one["id"], "granted":True})
        before = self.vault.db.execute("SELECT * FROM evidence ORDER BY seq").fetchall()
        grants = self.vault.db.execute("SELECT * FROM grants").fetchall()
        for token, expected, error in [(None,401,"AUTH_REQUIRED"),(self.one["token"],403,"FORBIDDEN")]:
            self.assertEqual(await self.rpc("preview", {"capsule":capsule},token=token,expected=expected,capsule=True),error)
        review=await self.rpc("preview", {"capsule":capsule},capsule=True)
        self.assertEqual((review["current"],review["incoming"],review["added"],review["duplicates"],review["resulting"]),(1,2,1,1,2))
        self.assertEqual((review["fixture"],review["liveClaims"]),(2,0))
        self.assertTrue(review["newReportsPrivate"])
        self.assertEqual(self.vault.db.execute("SELECT * FROM evidence ORDER BY seq").fetchall(),before)
        args={"capsule":capsule,"review":{k:review[k] for k in ("capsuleDigest","baseRevision")}}
        self.assertEqual(await self.rpc("restore",args,token=self.one["token"],expected=403,capsule=True),"FORBIDDEN")
        result=await self.rpc("restore",args,capsule=True)
        self.assertEqual((result["status"],result["added"],result["duplicates"],result["total"]),("restored",1,1,2))
        self.assertEqual(self.vault.db.execute("SELECT * FROM grants").fetchall(),grants)
        for envelope in envelopes:
            result=await self.rpc("get",{"memoryId":"council:"+envelope["reportSha256"]})
            self.assertEqual(result["envelope"],envelope)
        self.assertEqual(len((await self.rpc("search",token=self.one["token"]))["records"]),1)
        self.assertEqual(await self.rpc("get",{"memoryId":"council:"+envelopes[1]["reportSha256"]},
                                        token=self.one["token"],expected=404),"NOT_FOUND")
        self.assertEqual(await self.rpc("restore",args,expected=409,capsule=True),"CAPSULE_REVIEW_STALE")
        review=await self.rpc("preview",{"capsule":capsule},capsule=True)
        again=await self.rpc("restore",{"capsule":capsule,"review":{k:review[k] for k in ("capsuleDigest","baseRevision")}},capsule=True)
        self.assertEqual((again["status"],again["added"],again["duplicates"]),("unchanged",0,2))
        # Reopening the database preserves both evidence and only the old grant.
        await self.client.close(); self.vault.close(); self.invites.close()
        self.vault=EvidenceVault(self.path/"evidence.sqlite");self.invites=InvitationStore(self.path/"invites.sqlite")
        await self.start()
        self.assertEqual(len((await self.rpc("search"))["records"]),2)
        self.assertEqual(len((await self.rpc("search",token=self.one["token"]))["records"]),1)

    async def test_capsule_tampering_conflict_and_stale_review_fail_without_partial_import(self):
        def capsule(envelopes):
            raw=json.dumps(envelopes,separators=(",",":"),ensure_ascii=False)
            return {"schema":"matumbo.neural-memory-capsule/1","journalJson":raw,
                    "journalSha256":hashlib.sha256(raw.encode()).hexdigest()}
        await self.rpc("archive",{"envelope":self.mission})
        before=self.vault.db.execute("SELECT * FROM evidence").fetchall()
        conflict=change(self.mission,lambda r:r["rows"][0].update(latencyMs=13))
        self.assertEqual(await self.rpc("preview",{"capsule":capsule([self.arithmetic,conflict])},
                                        expected=409,capsule=True),"RUN_CONFLICT")
        valid=capsule([self.arithmetic])
        self.assertEqual(await self.rpc("preview",{"capsule":{**valid,"journalJson":valid["journalJson"]+" "}},
                                        expected=400,capsule=True),"CAPSULE_DIGEST_MISMATCH")
        self.assertEqual(await self.rpc("preview",{"capsule":capsule([self.arithmetic,{**self.mission,"reportSha256":"0"*64}])},
                                        expected=400,capsule=True),"CAPSULE_INVALID")
        self.assertEqual(await self.rpc("preview",{"capsule":capsule([self.arithmetic,self.arithmetic])},
                                        expected=400,capsule=True),"CAPSULE_INVALID")
        self.assertEqual(self.vault.db.execute("SELECT * FROM evidence").fetchall(),before)
        review=await self.rpc("preview",{"capsule":valid},capsule=True)
        args={"capsule":valid,"review":{k:review[k] for k in ("capsuleDigest","baseRevision")}}
        await self.rpc("grant",{"memoryId":"council:"+self.mission["reportSha256"],"invitationId":self.one["id"],"granted":True})
        self.assertEqual(await self.rpc("restore",args,expected=409,capsule=True),"CAPSULE_REVIEW_STALE")
        self.assertEqual(self.vault.db.execute("SELECT * FROM evidence").fetchall(),before)
        self.assertEqual(await self.rpc("preview",{"capsule":valid},origin="https://wrong.test",expected=403,capsule=True),"ORIGIN_NOT_ALLOWED")

    async def test_capsule_large_upload_limit_and_database_rollback(self):
        entries=[change(self.mission,lambda r:r.update(runId=f"capsule-large-{i}")) for i in range(40)]
        raw=json.dumps(entries,separators=(",",":"),ensure_ascii=False)
        capsule={"schema":"matumbo.neural-memory-capsule/1","journalJson":raw,
                 "journalSha256":hashlib.sha256(raw.encode()).hexdigest()}
        self.assertGreater(len(raw),65536)
        review=await self.rpc("preview",{"capsule":capsule},capsule=True)
        self.assertEqual(review["added"],40)
        args={"capsule":capsule,"review":{k:review[k] for k in ("capsuleDigest","baseRevision")}}
        # Force a real SQLite insertion failure after the first row; the
        # transaction must roll back even the successfully inserted prefix.
        self.vault.db.execute("""CREATE TRIGGER fail_capsule BEFORE INSERT ON evidence
            WHEN NEW.run_id='capsule-large-1' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END""")
        self.assertEqual(await self.rpc("restore",args,expected=503,capsule=True),"MEMORY_STORAGE_UNAVAILABLE")
        self.assertEqual(self.vault.db.execute("SELECT count(*) FROM evidence").fetchone()[0],0)
        self.vault.db.execute("DROP TRIGGER fail_capsule")
        restored=await self.rpc("restore",args,capsule=True)
        self.assertEqual(restored["total"],40)
        self.assertEqual(await self.rpc("preview",{"capsule":{"oversize":"x"*CAPSULE_MAX_REQUEST}},
                                        expected=413,capsule=True),"REQUEST_TOO_LARGE")
        self.assertEqual(self.vault.db.execute("SELECT count(*) FROM evidence").fetchone()[0],40)


    async def test_restore_receipt_survives_lost_response_restart_and_later_grants(self):
        raw=json.dumps([self.mission,self.arithmetic],separators=(",",":"),ensure_ascii=False)
        capsule={"schema":"matumbo.neural-memory-capsule/1","journalJson":raw,
                 "journalSha256":hashlib.sha256(raw.encode()).hexdigest()}
        review=await self.rpc("preview",{"capsule":capsule},capsule=True)
        key={k:review[k] for k in ("capsuleDigest","baseRevision")}
        initial=await self.rpc("receipt",key,capsule=True)
        self.assertEqual(initial["status"],"not-observed")
        self.assertIsNone(initial["receipt"])
        self.assertEqual(await self.rpc("recent",{"limit":16},capsule=True),
                         {"schema":"vivo.memory-capsule-commit-history/1","receipts":[]})
        # Simulate losing the reply after the server committed: discard the
        # successful restore result and reconcile only via the read endpoint.
        await self.rpc("restore",{"capsule":capsule,"review":key},capsule=True)
        committed=await self.rpc("receipt",key,capsule=True)
        receipt=committed["receipt"]
        self.assertEqual(committed["status"],"committed")
        self.assertEqual(receipt["added"],2)
        self.assertEqual(receipt["totalAtCommit"],2)
        self.assertEqual(receipt["addedMemoryIds"],["council:"+e["reportSha256"] for e in [self.mission,self.arithmetic]])
        self.assertTrue(receipt["newReportsPrivateAtCommit"])
        original={k:v for k,v in receipt.items() if k!="receiptSha256"}
        self.assertEqual(receipt["receiptSha256"],hashlib.sha256(json.dumps(original,separators=(",",":")).encode()).hexdigest())
        self.assertEqual(await self.rpc("receipt",key,token=self.one["token"],expected=403,capsule=True),"FORBIDDEN")
        self.assertEqual(await self.rpc("recent",{"limit":16},token=self.one["token"],expected=403,capsule=True),"FORBIDDEN")
        self.assertEqual(await self.rpc("recent",{"limit":17},expected=400,capsule=True),"REQUEST_INVALID")
        await self.rpc("grant",{"memoryId":receipt["addedMemoryIds"][0],"invitationId":self.one["id"],"granted":True})
        # Historical receipt is stable; current grant status is separate.
        self.assertEqual(await self.rpc("receipt",key,capsule=True),committed)
        again=await self.rpc("preview",{"capsule":capsule},capsule=True)
        second={k:again[k] for k in ("capsuleDigest","baseRevision")}
        self.assertEqual((await self.rpc("restore",{"capsule":capsule,"review":second},capsule=True))["status"],"unchanged")
        self.assertEqual((await self.rpc("receipt",second,capsule=True))["status"],"not-observed")
        self.assertEqual((await self.rpc("recent",{"limit":16},capsule=True))["receipts"],[receipt])
        await self.client.close();self.vault.close();self.invites.close()
        self.vault=EvidenceVault(self.path/"evidence.sqlite");self.invites=InvitationStore(self.path/"invites.sqlite")
        await self.start()
        self.assertEqual(await self.rpc("receipt",key,capsule=True),committed)
        self.assertEqual((await self.rpc("recent",{"limit":1},capsule=True))["receipts"],[receipt])
        self.vault.db.execute("UPDATE capsule_restore_receipts SET receipt_digest=?",("0"*64,))
        self.assertEqual(await self.rpc("receipt",key,expected=409,capsule=True),"STORED_RESTORE_RECEIPT_INVALID")

    async def test_restore_receipt_write_failure_rolls_back_evidence_and_receipt(self):
        raw=json.dumps([self.mission,self.arithmetic],separators=(",",":"),ensure_ascii=False)
        capsule={"schema":"matumbo.neural-memory-capsule/1","journalJson":raw,
                 "journalSha256":hashlib.sha256(raw.encode()).hexdigest()}
        review=await self.rpc("preview",{"capsule":capsule},capsule=True)
        key={k:review[k] for k in ("capsuleDigest","baseRevision")}
        self.vault.db.execute("""CREATE TRIGGER fail_receipt BEFORE INSERT ON capsule_restore_receipts
            BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END""")
        self.assertEqual(await self.rpc("restore",{"capsule":capsule,"review":key},expected=503,capsule=True),"MEMORY_STORAGE_UNAVAILABLE")
        self.assertEqual(self.vault.db.execute("SELECT count(*) FROM evidence").fetchone()[0],0)
        self.assertEqual((await self.rpc("receipt",key,capsule=True))["status"],"not-observed")
        self.vault.db.execute("DROP TRIGGER fail_receipt")
        await self.rpc("restore",{"capsule":capsule,"review":key},capsule=True)
        self.assertEqual((await self.rpc("receipt",key,capsule=True))["status"],"committed")


    async def test_owner_backup_parts_roundtrip_and_revision_fence(self):
        entries=[change(self.mission,lambda r:r.update(runId=f"backup-{i:03}")) for i in range(70)]
        for envelope in entries:
            await self.rpc("archive",{"envelope":envelope})
        before=self.vault.db.execute("SELECT * FROM evidence ORDER BY seq").fetchall()
        args={"after":None,"revision":None}
        first=await self.rpc("backup",args,capsule=True)
        self.assertEqual(first["schema"],"vivo.memory-backup-part/1")
        self.assertEqual((first["offset"],first["count"],first["total"]),(0,64,70))
        self.assertFalse(first["complete"])
        self.assertFalse(first["includesGrants"])
        self.assertFalse(first["includesRestoreReceipts"])
        self.assertEqual(await self.rpc("backup",args,token=self.one["token"],expected=403,capsule=True),"FORBIDDEN")
        self.assertEqual(await self.rpc("backup",args,token=None,expected=401,capsule=True),"AUTH_REQUIRED")
        cursor={"after":first["nextAfter"],"revision":first["revision"]}
        second=await self.rpc("backup",cursor,capsule=True)
        self.assertEqual((second["offset"],second["count"],second["total"]),(64,6,70))
        self.assertTrue(second["complete"])
        self.assertIsNone(second["nextAfter"])
        self.assertEqual(first["revision"],second["revision"])
        recovered=[]
        for part in (first,second):
            raw=part["capsule"]["journalJson"]
            self.assertEqual(hashlib.sha256(raw.encode()).hexdigest(),part["capsule"]["journalSha256"])
            self.assertLessEqual(len(raw.encode()),512*1024)
            recovered.extend(json.loads(raw))
        self.assertEqual(recovered,entries)
        self.assertEqual(self.vault.db.execute("SELECT * FROM evidence ORDER BY seq").fetchall(),before)
        # Import both parts through the existing restore path in a fresh
        # database; compare exact original envelopes, not just counts.
        with tempfile.TemporaryDirectory() as temp:
            other=EvidenceVault(Path(temp)/"restored.sqlite")
            try:
                principal=Principal("owner","remote.owner","one")
                for part in (first,second):
                    capsule=part["capsule"]
                    review=other.capsule_dispatch(principal,{"op":"preview","args":{"capsule":capsule}})
                    other.capsule_dispatch(principal,{"op":"restore","args":{"capsule":capsule,
                        "review":{k:review[k] for k in ("capsuleDigest","baseRevision")}}})
                self.assertEqual([other.decode(row)[1] for row in other.db.execute("SELECT * FROM evidence ORDER BY seq")],entries)
                self.assertEqual(other.db.execute("SELECT count(*) FROM grants").fetchone()[0],0)
            finally:
                other.close()
        await self.rpc("grant",{"memoryId":"council:"+entries[0]["reportSha256"],"invitationId":self.one["id"],"granted":True})
        self.assertEqual(await self.rpc("backup",cursor,expected=409,capsule=True),"BACKUP_REVISION_STALE")
        fresh=await self.rpc("backup",args,capsule=True)
        self.assertNotEqual(fresh["revision"],first["revision"])
        self.assertEqual(fresh["capsule"],first["capsule"])
        self.assertEqual(await self.rpc("backup",{"after":999,"revision":fresh["revision"]},expected=409,capsule=True),"BACKUP_CURSOR_INVALID")

    async def test_empty_backup_and_corrupt_evidence_fail_closed(self):
        args={"after":None,"revision":None}
        empty=await self.rpc("backup",args,capsule=True)
        self.assertEqual((empty["count"],empty["total"],empty["complete"]),(0,0,True))
        self.assertEqual(empty["capsule"]["journalJson"],"[]")
        await self.rpc("archive",{"envelope":self.mission})
        self.vault.db.execute("UPDATE evidence SET envelope='{}'")
        self.assertEqual(await self.rpc("backup",args,expected=409,capsule=True),"STORED_EVIDENCE_INVALID")
        self.assertEqual(await self.rpc("backup",{"after":1,"revision":None},expected=400,capsule=True),"REQUEST_INVALID")


    @staticmethod
    def complete_bundle(parts):
        capsules = []
        manifest_parts = []
        offset = 0
        for envelopes in parts:
            raw = json.dumps(envelopes,separators=(",",":"),ensure_ascii=False)
            digest = hashlib.sha256(raw.encode()).hexdigest()
            capsules.append({"schema":"matumbo.neural-memory-capsule/1","journalJson":raw,"journalSha256":digest})
            manifest_parts.append({"offset":offset,"count":len(envelopes),"journalSha256":digest})
            offset += len(envelopes)
        manifest = json.dumps({"schema":"vivo.memory-backup-manifest/1","revision":"a"*64,
            "total":offset,"parts":manifest_parts,"includesGrants":False,"includesRestoreReceipts":False},
            separators=(",",":"))
        return {"schema":"vivo.memory-backup-set/1","manifestJson":manifest,
                "manifestSha256":hashlib.sha256(manifest.encode()).hexdigest(),"capsules":capsules}

    async def test_atomic_complete_backup_restore_70_reports_receipt_and_restart(self):
        entries = [change(self.mission,lambda r:r.update(runId=f"complete-{i:03}")) for i in range(70)]
        bundle = self.complete_bundle([entries[:64],entries[64:]])
        first = await self.rpc("archive",{"envelope":entries[0]})
        await self.rpc("grant",{"memoryId":first["record"]["memoryId"],"invitationId":self.one["id"],"granted":True})
        before = self.vault.db.execute("SELECT * FROM evidence ORDER BY seq").fetchall()
        grants = self.vault.db.execute("SELECT * FROM grants").fetchall()
        self.assertEqual(await self.rpc("preview",{"bundle":bundle},token=self.one["token"],expected=403,backup_set=True),"FORBIDDEN")
        review = await self.rpc("preview",{"bundle":bundle},backup_set=True)
        self.assertEqual((review["incoming"],review["parts"],review["current"],review["added"],review["duplicates"],review["resulting"]),(70,2,1,69,1,70))
        self.assertTrue(review["newReportsPrivate"])
        self.assertEqual(self.vault.db.execute("SELECT * FROM evidence ORDER BY seq").fetchall(),before)
        key={k:review[k] for k in ("manifestDigest","baseRevision")}
        args={"bundle":bundle,"review":key}
        self.assertEqual(await self.rpc("restore",args,token=self.one["token"],expected=403,backup_set=True),"FORBIDDEN")
        self.vault.db.execute("""CREATE TRIGGER fail_last_part BEFORE INSERT ON evidence
            WHEN NEW.run_id='complete-069' BEGIN SELECT RAISE(ABORT,'fixture last part failure'); END""")
        self.assertEqual(await self.rpc("restore",args,expected=503,backup_set=True),"MEMORY_STORAGE_UNAVAILABLE")
        self.assertEqual(self.vault.db.execute("SELECT * FROM evidence ORDER BY seq").fetchall(),before)
        self.vault.db.execute("DROP TRIGGER fail_last_part")
        self.vault.db.execute("""CREATE TRIGGER fail_set_receipt BEFORE INSERT ON backup_set_restore_receipts
            BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END""")
        self.assertEqual(await self.rpc("restore",args,expected=503,backup_set=True),"MEMORY_STORAGE_UNAVAILABLE")
        self.assertEqual(self.vault.db.execute("SELECT * FROM evidence ORDER BY seq").fetchall(),before)
        self.assertEqual((await self.rpc("receipt",key,backup_set=True))["status"],"not-observed")
        self.vault.db.execute("DROP TRIGGER fail_set_receipt")
        restored=await self.rpc("restore",args,backup_set=True)
        self.assertEqual((restored["status"],restored["added"],restored["total"]),("restored",69,70))
        self.assertEqual([self.vault.decode(row)[1] for row in self.vault.db.execute("SELECT * FROM evidence ORDER BY seq")],entries)
        self.assertEqual(self.vault.db.execute("SELECT * FROM grants").fetchall(),grants)
        self.assertEqual(len((await self.rpc("search",token=self.one["token"]))["records"]),1)
        committed=await self.rpc("receipt",key,backup_set=True)
        self.assertEqual(committed["status"],"committed")
        self.assertEqual(committed["receipt"]["addedMemoryIds"],["council:"+e["reportSha256"] for e in entries[1:]])
        self.assertEqual(await self.rpc("receipt",key,token=self.one["token"],expected=403,backup_set=True),"FORBIDDEN")
        self.assertEqual(await self.rpc("restore",args,expected=409,backup_set=True),"BACKUP_REVIEW_STALE")
        again=await self.rpc("preview",{"bundle":bundle},backup_set=True)
        again_key={k:again[k] for k in ("manifestDigest","baseRevision")}
        self.assertEqual((await self.rpc("restore",{"bundle":bundle,"review":again_key},backup_set=True))["status"],"unchanged")
        self.assertEqual((await self.rpc("receipt",again_key,backup_set=True))["status"],"not-observed")
        self.assertEqual((await self.rpc("recent",{"limit":16},backup_set=True))["receipts"],[committed["receipt"]])
        await self.client.close();self.vault.close();self.invites.close()
        self.vault=EvidenceVault(self.path/"evidence.sqlite");self.invites=InvitationStore(self.path/"invites.sqlite")
        await self.start()
        self.assertEqual(await self.rpc("receipt",key,backup_set=True),committed)
        self.assertEqual(self.vault.db.execute("SELECT count(*) FROM evidence").fetchone()[0],70)
        self.assertEqual(self.vault.db.execute("SELECT * FROM grants").fetchall(),grants)

    async def test_complete_backup_rejects_missing_duplicate_conflicting_or_stale_parts(self):
        bundle=self.complete_bundle([[self.mission],[self.arithmetic]])
        await self.rpc("archive",{"envelope":self.mission})
        before=self.vault.db.execute("SELECT * FROM evidence").fetchall()
        for bad in ({**bundle,"capsules":bundle["capsules"][:1]},
                    {**bundle,"capsules":list(reversed(bundle["capsules"]))},
                    {**bundle,"manifestSha256":"0"*64},
                    self.complete_bundle([[self.mission],[self.mission]])):
            self.assertEqual(await self.rpc("preview",{"bundle":bad},expected=400,backup_set=True),"BACKUP_SET_INVALID")
        conflict=change(self.mission,lambda r:r["rows"][0].update(latencyMs=r["rows"][0]["latencyMs"]+1))
        bad=self.complete_bundle([[self.arithmetic],[conflict]])
        self.assertEqual(await self.rpc("preview",{"bundle":bad},expected=409,backup_set=True),"RUN_CONFLICT")
        review=await self.rpc("preview",{"bundle":bundle},backup_set=True)
        key={k:review[k] for k in ("manifestDigest","baseRevision")}
        await self.rpc("grant",{"memoryId":"council:"+self.mission["reportSha256"],"invitationId":self.one["id"],"granted":True})
        self.assertEqual(await self.rpc("restore",{"bundle":bundle,"review":key},expected=409,backup_set=True),"BACKUP_REVIEW_STALE")
        self.assertEqual(self.vault.db.execute("SELECT * FROM evidence").fetchall(),before)
        self.assertEqual(self.vault.db.execute("SELECT count(*) FROM backup_set_restore_receipts").fetchone()[0],0)
        self.assertEqual(await self.rpc("preview",{"bundle":bundle},origin="https://wrong.test",expected=403,backup_set=True),"ORIGIN_NOT_ALLOWED")


    async def test_bounded_mission_exact_evidence_scope_and_custom_constraints(self):
        known={"budget":7,"jobs":[{"id":"D","cost":2,"value":4},{"id":"B","cost":4,"value":7},
               {"id":"A","cost":3,"value":5},{"id":"C","cost":5,"value":9}],"required":[],"conflicts":[]}
        scope={"mode":"fixture","providers":["kimi"],"limit":4}
        args={"mission":known,"selection":scope}
        empty=await self.rpc("plan",args,token=self.one["token"])
        self.assertEqual(empty["proposal"],{"candidate":"C,D","cost":7,"value":13,"feasible":True})
        self.assertEqual(empty["proof"]["subsetsChecked"],16)
        self.assertEqual(empty["proof"]["feasibleSubsets"],9)
        self.assertEqual(empty["evidence"]["receipt"]["evidence"]["recordsUsed"],0)
        record=(await self.rpc("archive",{"envelope":self.mission}))["record"]
        self.assertEqual(await self.rpc("plan",args,token=self.one["token"]),empty)
        grant={"memoryId":record["memoryId"],"invitationId":self.one["id"],"granted":True}
        await self.rpc("grant",grant)
        matched=await self.rpc("plan",args,token=self.one["token"])
        self.assertEqual(matched["evidence"]["status"],"exact-task-recall")
        self.assertEqual(matched["evidence"]["receipt"]["evidence"]["citations"][0]["evidenceDigest"],self.mission["reportSha256"])
        self.assertEqual(matched["proof"],empty["proof"])
        custom={"mission":{**known,"required":["A"],"conflicts":[["B","A"]]},"selection":scope}
        result=await self.rpc("plan",custom,token=self.one["token"])
        self.assertEqual(result["proposal"],{"candidate":"A,D","cost":5,"value":9,"feasible":True})
        self.assertEqual(result["proof"]["feasibleSubsets"],2)
        self.assertEqual(result["proof"]["runnerUp"]["candidate"],"A")
        self.assertEqual(result["proof"]["optimalityGap"],4)
        self.assertEqual(result["evidence"],{"status":"mission-not-in-memory-contract","receipt":None})
        self.assertNotIn(self.mission["reportSha256"],json.dumps(result))
        await self.rpc("grant",{**grant,"granted":False})
        self.assertEqual(await self.rpc("plan",args,token=self.one["token"]),empty)
        self.assertEqual(await self.rpc("plan",custom,token=self.one["token"]),result)
        self.assertEqual(await self.rpc("plan",custom),result)
        self.assertEqual(self.vault.db.execute("SELECT count(*) FROM evidence").fetchone()[0],1)

    async def test_bounded_mission_ties_empty_infeasible_and_invalid_inputs(self):
        scope={"mode":"fixture","providers":[],"limit":4}
        jobs=[{"id":"A","cost":2,"value":3},{"id":"B","cost":1,"value":3}]
        mission={"budget":2,"jobs":jobs,"required":[],"conflicts":[]}
        result=await self.rpc("plan",{"mission":mission,"selection":scope})
        self.assertEqual(result["proposal"]["candidate"],"B")
        self.assertEqual(result["proof"]["runnerUp"]["candidate"],"A")
        self.assertEqual(result["proof"]["equallyValuableOptima"],2)
        self.assertEqual(result["proof"]["optimalityGap"],0)
        empty=await self.rpc("plan",{"mission":{**mission,"budget":0},"selection":scope})
        self.assertEqual(empty["proposal"],{"candidate":"","cost":0,"value":0,"feasible":True})
        self.assertIsNone(empty["proof"]["runnerUp"])
        impossible=await self.rpc("plan",{"mission":{**mission,"required":["A","B"],"conflicts":[["A","B"]]},"selection":scope})
        self.assertEqual(impossible["status"],"infeasible")
        self.assertIsNone(impossible["proposal"])
        self.assertEqual(impossible["proof"]["feasibleSubsets"],0)
        self.assertIsNone(impossible["proof"]["optimalityGap"])
        maximum=await self.rpc("plan",{"mission":{"budget":12,"jobs":[{"id":f"J{i}","cost":1,"value":i+1} for i in range(12)],
            "required":[],"conflicts":[]},"selection":scope})
        self.assertEqual(maximum["proposal"]["value"],78)
        self.assertEqual(maximum["proof"]["subsetsChecked"],4096)
        self.assertEqual(maximum["proof"]["feasibleSubsets"],4096)
        for bad in ({**mission,"budget":True},{**mission,"jobs":jobs+[jobs[0]]},
                    {**mission,"required":["C"]},{**mission,"conflicts":[["A","B"],["B","A"]]},
                    {**mission,"jobs":[{"id":"A","cost":-1,"value":3}]},
                    {**mission,"jobs":[{"id":f"J{i}","cost":1,"value":1} for i in range(13)]}):
            self.assertEqual(await self.rpc("plan",{"mission":bad,"selection":scope},expected=400),"MISSION_INVALID")
        self.assertEqual(await self.rpc("plan",{"mission":mission,"selection":{**scope,"mode":"all"}},expected=400),"MISSION_INVALID")
        self.assertEqual(await self.rpc("plan",{"mission":mission,"selection":scope},token=None,expected=401),"AUTH_REQUIRED")


    async def test_dependency_mission_layers_required_closure_and_legacy_fingerprint(self):
        scope={"mode":"fixture","providers":[],"limit":4}
        jobs=[{"id":"A","cost":3,"value":5},{"id":"B","cost":4,"value":7},
              {"id":"C","cost":5,"value":9},{"id":"D","cost":2,"value":4}]
        known={"budget":7,"jobs":jobs,"required":[],"conflicts":[]}
        plain=await self.rpc("plan",{"mission":known,"selection":scope})
        empty=await self.rpc("plan",{"mission":{**known,"dependencies":[]},"selection":scope})
        self.assertEqual(plain,empty)
        mission={**known,"budget":10,"dependencies":[["D","A"],["C","D"]]}
        args={"mission":mission,"selection":scope}
        result=await self.rpc("plan",args)
        self.assertEqual(result["schema"],"vivo.agent-mission-plan/2")
        self.assertEqual(result["proposal"],{"candidate":"A,C,D","cost":10,"value":18,"feasible":True})
        self.assertEqual(result["proof"]["dependencyLayers"],[["A"],["D"],["C"]])
        self.assertEqual(result["proof"]["requiredClosure"],[])
        self.assertEqual(result["proof"]["runnerUp"]["candidate"],"A,B,D")
        self.assertEqual(result["proof"]["optimalityGap"],2)
        self.assertEqual(result["evidence"],{"status":"mission-not-in-memory-contract","receipt":None})
        reordered={**mission,"jobs":list(reversed(jobs)),"dependencies":list(reversed(mission["dependencies"]))}
        self.assertEqual(await self.rpc("plan",{"mission":reordered,"selection":scope}),result)
        impossible={**mission,"budget":9,"required":["C"]}
        no_plan=await self.rpc("plan",{"mission":impossible,"selection":scope})
        self.assertEqual(no_plan["status"],"infeasible")
        self.assertIsNone(no_plan["proposal"])
        self.assertEqual(no_plan["proof"]["requiredClosure"],["A","C","D"])
        self.assertEqual(no_plan["proof"]["requiredMinimumCost"],10)
        self.assertEqual(no_plan["proof"]["infeasibilityReasons"],["required-closure-over-budget"])
        both={**impossible,"conflicts":[["A","C"]]}
        blocked=await self.rpc("plan",{"mission":both,"selection":scope})
        self.assertEqual(blocked["proof"]["requiredConflicts"],[["A","C"]])
        self.assertEqual(blocked["proof"]["infeasibilityReasons"],["required-closure-over-budget","required-closure-conflict"])
        for bad in ({"dependencies":[["A","D"],["D","C"],["C","A"]]},
                    {"dependencies":[["A","B"],["B","A"]]}):
            self.assertEqual(await self.rpc("plan",{"mission":{**mission,**bad},"selection":scope},expected=400),"MISSION_DEPENDENCY_CYCLE")
        for edges in ([["A","A"]],[["A","Z"]],[["C","D"],["C","D"]],None):
            self.assertEqual(await self.rpc("plan",{"mission":{**mission,"dependencies":edges},"selection":scope},expected=400),"MISSION_INVALID")
        chain={"budget":12,"jobs":[{"id":f"J{i:02}","cost":1,"value":1} for i in range(12)],
               "required":[],"conflicts":[],"dependencies":[[f"J{i:02}",f"J{i-1:02}"] for i in range(1,12)]}
        maximum=await self.rpc("plan",{"mission":chain,"selection":scope})
        self.assertEqual(maximum["proof"]["subsetsChecked"],4096)
        self.assertEqual(maximum["proof"]["feasibleSubsets"],13)
        self.assertEqual(maximum["proof"]["dependencyLayers"],[[f"J{i:02}"] for i in range(12)])
        self.assertEqual(maximum["proposal"]["value"],12)
        self.assertEqual(self.vault.db.execute("SELECT count(*) FROM evidence").fetchone()[0],0)


    async def test_budget_comparison_dependency_frontier_target_and_no_memory_reads(self):
        jobs=[{"id":"A","cost":3,"value":5},{"id":"B","cost":4,"value":7},
              {"id":"C","cost":5,"value":9},{"id":"D","cost":2,"value":4}]
        mission={"budget":6,"jobs":jobs,"required":[],"conflicts":[],"dependencies":[["C","D"],["D","A"]]}
        args={"mission":mission,"budgets":[10,0,5,9],"targetValue":18}
        result=await self.rpc("compare-budgets",args,token=self.one["token"])
        self.assertEqual(result["baseline"],{"budget":6,"proposal":{"candidate":"A,D","cost":5,"value":9,"feasible":True},"feasibleSubsets":4})
        self.assertEqual([row["budget"] for row in result["scenarios"]],[0,5,9,10])
        self.assertEqual([row["proposal"]["value"] for row in result["scenarios"]],[0,9,16,18])
        self.assertEqual(result["nextImprovement"],{"candidate":"A,B","cost":7,"value":12,"feasible":True})
        self.assertEqual(result["target"]["minimumBudget"],10)
        self.assertEqual(result["target"]["proposal"]["candidate"],"A,C,D")
        self.assertEqual(result["maximumAttainableValue"],25)
        self.assertEqual(result["minimumFeasibleBudget"],0)
        self.assertEqual(result["proof"]["subsetsChecked"],16)
        self.assertEqual(result["proof"]["structurallyFeasibleSubsets"],8)
        self.assertEqual(result["proof"]["frontierPoints"],8)
        self.assertEqual(result["evidence"],{"status":"hypothetical-resource-comparison","recordsUsed":0})
        await self.rpc("archive",{"envelope":self.mission})
        self.assertEqual(await self.rpc("compare-budgets",args),result)
        self.assertEqual(await self.rpc("compare-budgets",args,token=self.one["token"]),result)
        self.assertNotIn(self.mission["reportSha256"],json.dumps(result))
        # Each scenario must agree with a separately solved single-budget mission.
        for scenario in result["scenarios"]:
            plan=await self.rpc("plan",{"mission":{**mission,"budget":scenario["budget"]},
                "selection":{"mode":"fixture","providers":[],"limit":4}})
            self.assertEqual(plan["proposal"],scenario["proposal"])
            self.assertEqual(plan["proof"]["feasibleSubsets"],scenario["feasibleSubsets"])
        blocked={**mission,"required":["C"],"conflicts":[["A","C"]]}
        none=await self.rpc("compare-budgets",{"mission":blocked,"budgets":[0,12],"targetValue":0})
        self.assertIsNone(none["minimumFeasibleBudget"])
        self.assertIsNone(none["maximumAttainableValue"])
        self.assertEqual(none["target"]["status"],"unattainable")
        self.assertEqual(none["proof"]["frontierPoints"],0)
        self.assertTrue(all(row["proposal"] is None for row in none["scenarios"]))

    async def test_budget_comparison_zero_cost_ties_limits_and_invalid_scenarios(self):
        mission={"budget":0,"jobs":[{"id":"A","cost":0,"value":1},{"id":"B","cost":0,"value":1},
                 {"id":"C","cost":2,"value":4}],"required":[],"conflicts":[["A","B"]]}
        args={"mission":mission,"budgets":[0,1,2],"targetValue":5}
        result=await self.rpc("compare-budgets",args)
        self.assertEqual(result["baseline"]["proposal"]["candidate"],"A")
        self.assertEqual(result["nextImprovement"]["candidate"],"A,C")
        self.assertEqual(result["target"]["minimumBudget"],2)
        self.assertEqual(result["proof"]["frontierPoints"],2)
        self.assertEqual(result["proof"]["structurallyFeasibleSubsets"],6)
        self.assertEqual((await self.rpc("compare-budgets",{**args,"targetValue":6}))["target"]["status"],"unattainable")
        for changes in ({"budgets":[]},{"budgets":[0,0]},{"budgets":[True]},{"budgets":[-1]},
                        {"budgets":list(range(9))},{"targetValue":1.5},{"targetValue":True}):
            self.assertEqual(await self.rpc("compare-budgets",{**args,**changes},expected=400),"MISSION_COMPARISON_INVALID")
        self.assertEqual(await self.rpc("compare-budgets",args,token=None,expected=401),"AUTH_REQUIRED")
        maximum={"budget":6,"jobs":[{"id":f"J{i:02}","cost":1,"value":1} for i in range(12)],"required":[],"conflicts":[]}
        checked=await self.rpc("compare-budgets",{"mission":maximum,"budgets":[0,6,12],"targetValue":12})
        self.assertEqual(checked["proof"]["subsetsChecked"],4096)
        self.assertEqual(checked["proof"]["structurallyFeasibleSubsets"],4096)
        self.assertEqual(checked["proof"]["frontierPoints"],13)
        self.assertEqual(checked["target"]["minimumBudget"],12)
