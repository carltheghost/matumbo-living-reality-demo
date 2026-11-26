"""Private, bounded Council evidence vault. No model or world-action authority.

The remote gateway authenticates the caller on every request. An editor gets
read access only to individual evidence records explicitly granted by the owner.
SQLite persists original report bytes; independent validation is repeated on recall.
"""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
from datetime import datetime
import hashlib
import hmac
from itertools import combinations
import json
import re
import sqlite3
import time

from aiohttp import web

SCHEMA = "vivo.neural-memory/1"
MAX_REPORTS = 128
MAX_BYTES = 2 * 1024 * 1024
MAX_REQUEST = 64 * 1024
CAPSULE_SCHEMA = "matumbo.neural-memory-capsule/1"
CAPSULE_MAX_REPORTS = 64
CAPSULE_MAX_JOURNAL = 512 * 1024
CAPSULE_MAX_REQUEST = 2 * CAPSULE_MAX_JOURNAL + 8192
MAX_SAFE = 2**53 - 1
PROVIDERS = {"openai", "anthropic", "google", "deepseek", "kimi", "nvidia", "xai"}
JOBS = {"A": (3, 5), "B": (4, 7), "C": (5, 9), "D": (2, 4)}
REPORT_KEYS = {"schema", "runId", "createdAt", "mode", "task", "maxAttempts",
               "requestedOutputTokens", "rows", "postedChargesUsd", "worldActionExecuted"}
ROW_KEYS = {"provider", "requestedModel", "resolvedModel", "status", "attempted",
            "latencyMs", "httpStatus", "usage", "answerCorrect", "responseSha256"}
DIGEST = re.compile(r"^[0-9a-f]{64}$")
MEMORY_ID = re.compile(r"^council:[0-9a-f]{64}$")
RUN_ID = re.compile(r"^[A-Za-z0-9-]{1,80}$")
INVITE_ID = re.compile(r"^[0-9a-f]{32}$")
MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
SECRET_PREFIX = re.compile(r"^(sk-|nvapi-|jv_live_|AIza)", re.I)
STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


class MemoryError(ValueError):
    def __init__(self, code, status=400):
        super().__init__(code)
        self.code, self.status = code, status


def need(condition, code="EVIDENCE_INVALID", status=400):
    if not condition:
        raise MemoryError(code, status)


def exact(value, keys):
    return isinstance(value, dict) and set(value) == set(keys)


def matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def integer(value, low=0, high=MAX_SAFE):
    return type(value) is int and low <= value <= high


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result)
        result[key] = value
    return result


def strict_json(value):
    try:
        return json.loads(value, object_pairs_hook=unique_pairs,
                          parse_constant=lambda _value: (_ for _ in ()).throw(MemoryError("EVIDENCE_INVALID")))
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise MemoryError("EVIDENCE_INVALID") from None


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def model(value):
    return value is None or (matches(MODEL, value) and not SECRET_PREFIX.match(value))


def plan(candidate):
    if not isinstance(candidate, str):
        return None
    parts = candidate.split(",")
    if not parts or parts != sorted(set(parts)) or any(part not in JOBS for part in parts):
        return None
    cost = sum(JOBS[part][0] for part in parts)
    value = sum(JOBS[part][1] for part in parts)
    return {"candidate": candidate, "cost": cost, "value": value, "feasible": cost <= 7}


def optimum():
    options = [plan(",".join(parts)) for size in range(1, len(JOBS)+1)
               for parts in combinations(JOBS, size)]
    feasible = sorted((p for p in options if p["feasible"]), key=lambda p: -p["value"])
    need(feasible[0]["value"] > feasible[1]["value"])
    return feasible[0]


def validate_envelope(envelope):
    """Reproduce the bounded JS /1 and /2 report contract independently.

    All accepted strings in report JSON are ASCII protocol fields. Requiring
    compact canonical bytes also rejects duplicate keys, escaped variants and
    noninteger numeric representations accepted by a generic JSON parser.
    """
    need(exact(envelope, {"schema", "reportJson", "reportSha256"}))
    need(envelope["schema"] == "matumbo.provider-council-export/1")
    raw, digest = envelope["reportJson"], envelope["reportSha256"]
    need(isinstance(raw, str) and len(raw) <= 32000 and raw.isascii() and matches(DIGEST, digest))
    need(hmac.compare_digest(hashlib.sha256(raw.encode("utf-8")).hexdigest(), digest))
    report = strict_json(raw)
    need(exact(report, REPORT_KEYS) and canonical(report) == raw)
    mission = report["schema"] == "matumbo.provider-council/2"
    need(mission or report["schema"] == "matumbo.provider-council/1")
    need(report["task"] == ("route-constraint-v1" if mission else "arithmetic-31-v1"))
    need(matches(RUN_ID, report["runId"]) and matches(STAMP, report["createdAt"]))
    try:
        datetime.strptime(report["createdAt"], "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        raise MemoryError("EVIDENCE_INVALID") from None
    need(report["mode"] in ("fixture", "live") and integer(report["maxAttempts"], 1, 7))
    need(integer(report["requestedOutputTokens"], 64, 64))
    need(report["postedChargesUsd"] is None and report["worldActionExecuted"] is False)
    need(isinstance(report["rows"], list) and 1 <= len(report["rows"]) <= 7)
    seen, attempts, projected = set(), 0, []
    best = optimum() if mission else None
    for row in report["rows"]:
        need(exact(row, ROW_KEYS | ({"candidate"} if mission else set())))
        provider = row["provider"]
        need(isinstance(provider, str) and provider in PROVIDERS and provider not in seen)
        seen.add(provider)
        need(model(row["requestedModel"]) and model(row["resolvedModel"]))
        usage = row["usage"]
        need(usage is None or (exact(usage, {"inputTokens", "outputTokens"}) and
                              all(integer(n) for n in usage.values())))
        answer, response_digest = row["answerCorrect"], row["responseSha256"]
        need(answer is None or type(answer) is bool)
        need(response_digest is None or matches(DIGEST, response_digest))
        status, attempted = row["status"], row["attempted"]
        code, latency = row["httpStatus"], row["latencyMs"]
        ok = integer(code, 200, 299)
        no_evidence = all(row[key] is None for key in ("resolvedModel", "usage", "answerCorrect", "responseSha256"))
        candidate = row.get("candidate")
        score = plan(candidate) if mission else None
        if mission:
            need(candidate is None or score is not None)
            if status == "response-observed":
                need(type(answer) is bool and answer == (candidate == best["candidate"]))
            else:
                need(candidate is None)
        if status in ("not-configured", "skipped-limit"):
            need(attempted is False and latency is None and code is None and no_evidence)
        else:
            need(attempted is True and row["requestedModel"] is not None and integer(latency))
            attempts += 1
            if status == "transport-uncertain":
                need(code is None and no_evidence)
            elif status == "http-error":
                need(integer(code, 100, 599) and not ok and no_evidence)
            elif status == "invalid-response":
                need(ok and no_evidence)
            elif status == "response-observed":
                need(ok and matches(DIGEST, response_digest) and type(answer) is bool)
            elif status == "no-usable-answer":
                need(ok and matches(DIGEST, response_digest) and answer is None)
            else:
                raise MemoryError("EVIDENCE_INVALID")
        verdict = "unknown"
        if status == "response-observed":
            if mission:
                verdict = ("invalid-proposal" if score is None else "over-budget" if not score["feasible"]
                           else "optimal" if answer else "feasible-suboptimal")
            else:
                verdict = "correct" if answer else "incorrect"
        projected.append({"provider": provider, "model": row["resolvedModel"] or row["requestedModel"],
                          "status": status, "verdict": verdict, "candidate": candidate,
                          "plan": score, "usage": usage})
    need(attempts <= report["maxAttempts"])
    return {"memoryId": "council:" + digest, "evidenceDigest": digest,
            "runId": report["runId"], "reportedAt": report["createdAt"],
            "mode": report["mode"], "task": report["task"],
            "provenance": "synthetic-fixture" if report["mode"] == "fixture" else "host-reported-unverified",
            "authority": "evidence-only", "providerAuthenticated": False,
            "postedChargesUsd": None, "worldActionExecuted": False,
            "localOptimum": best, "rows": projected}


def validate_capsule(capsule):
    """Read the exact local-journal capsule format, never grants or credentials."""
    need(exact(capsule, {"schema", "journalJson", "journalSha256"}), "CAPSULE_INVALID")
    need(capsule["schema"] == CAPSULE_SCHEMA, "CAPSULE_INVALID")
    raw, claimed = capsule["journalJson"], capsule["journalSha256"]
    need(isinstance(raw, str) and raw.isascii() and len(raw) <= CAPSULE_MAX_JOURNAL
         and matches(DIGEST, claimed), "CAPSULE_INVALID")
    need(hmac.compare_digest(hashlib.sha256(raw.encode("utf-8")).hexdigest(), claimed),
         "CAPSULE_DIGEST_MISMATCH")
    try:
        envelopes = strict_json(raw)
        need(isinstance(envelopes, list) and len(envelopes) <= CAPSULE_MAX_REPORTS
             and canonical(envelopes) == raw)
        seen, entries = set(), []
        for envelope in envelopes:
            record = validate_envelope(envelope)
            need(record["runId"] not in seen)
            seen.add(record["runId"])
            encoded = canonical(envelope)
            size = len(encoded.encode("utf-8"))
            need(size <= MAX_REQUEST)
            entries.append((record, encoded, size))
        return entries
    except (MemoryError, ValueError, TypeError, UnicodeError, RecursionError):
        raise MemoryError("CAPSULE_INVALID") from None


class EvidenceVault:
    """One owner namespace per existing private remote data directory."""
    def __init__(self, path):
        self.db = sqlite3.connect(path, isolation_level=None, timeout=3)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS evidence(
              seq INTEGER PRIMARY KEY,
              memory_id TEXT UNIQUE NOT NULL,
              run_id TEXT UNIQUE NOT NULL,
              envelope TEXT NOT NULL,
              bytes INTEGER NOT NULL CHECK(bytes>0),
              archived_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS grants(
              memory_id TEXT NOT NULL REFERENCES evidence(memory_id),
              invitation_id TEXT NOT NULL,
              PRIMARY KEY(memory_id, invitation_id));
        """)

    @contextmanager
    def transaction(self):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
            self.db.execute("COMMIT")
        except BaseException:
            if self.db.in_transaction:
                self.db.execute("ROLLBACK")
            raise

    def decode(self, row):
        seq, memory_id, run_id, raw, size, archived_at = row
        try:
            need(isinstance(raw, str) and len(raw.encode("utf-8")) == size and size <= MAX_REQUEST)
            envelope = strict_json(raw)
            record = validate_envelope(envelope)
            need(record["memoryId"] == memory_id and record["runId"] == run_id)
        except (MemoryError, TypeError, UnicodeError, RecursionError, ValueError):
            raise MemoryError("STORED_EVIDENCE_INVALID", 409) from None
        return {**record, "sequence": seq, "archivedAt": archived_at}, envelope

    def archive(self, envelope):
        record = validate_envelope(envelope)
        raw = canonical(envelope)
        size = len(raw.encode("utf-8"))
        need(size <= MAX_REQUEST)
        with self.transaction():
            previous = self.db.execute(
                "SELECT * FROM evidence WHERE run_id=?", (record["runId"],)).fetchone()
            if previous:
                saved, _ = self.decode(previous)
                need(saved["memoryId"] == record["memoryId"], "RUN_CONFLICT", 409)
                return {"status": "duplicate", "record": saved}
            count, total = self.db.execute("SELECT count(*),coalesce(sum(bytes),0) FROM evidence").fetchone()
            need(count < MAX_REPORTS and total + size <= MAX_BYTES, "MEMORY_CAPACITY", 409)
            cursor = self.db.execute(
                "INSERT INTO evidence(memory_id,run_id,envelope,bytes,archived_at) VALUES(?,?,?,?,?)",
                (record["memoryId"], record["runId"], raw, size, int(time.time())))
            row = self.db.execute("SELECT * FROM evidence WHERE seq=?", (cursor.lastrowid,)).fetchone()
            saved, _ = self.decode(row)
            return {"status": "recorded", "record": saved}

    def capsule_plan(self, incoming):
        """Must run inside the caller's transaction. Include exact current
        evidence and grants in the revision; never restore grants from a file."""
        rows = self.db.execute("SELECT * FROM evidence ORDER BY seq").fetchall()
        grants = self.db.execute(
            "SELECT memory_id,invitation_id FROM grants ORDER BY memory_id,invitation_id").fetchall()
        known, revision_rows = {}, []
        total_bytes = 0
        for row in rows:
            record, _ = self.decode(row)
            known[record["runId"]] = record["memoryId"]
            total_bytes += row[4]
            revision_rows.append([row[0], row[1], hashlib.sha256(row[3].encode("utf-8")).hexdigest(),
                                  row[4], row[5]])
        revision = hashlib.sha256(canonical({"rows": revision_rows, "grants": grants}).encode("utf-8")).hexdigest()
        added, duplicates = [], 0
        for record, raw, size in incoming:
            prior = known.get(record["runId"])
            if prior is not None:
                need(prior == record["memoryId"], "RUN_CONFLICT", 409)
                duplicates += 1
            else:
                added.append((record, raw, size))
        need(len(rows) + len(added) <= MAX_REPORTS
             and total_bytes + sum(item[2] for item in added) <= MAX_BYTES, "MEMORY_CAPACITY", 409)
        return revision, len(rows), added, duplicates

    def capsule_dispatch(self, principal, body):
        need(principal.role == "owner", "FORBIDDEN", 403)
        need(exact(body, {"op", "args"}) and isinstance(body["args"], dict), "REQUEST_INVALID")
        op, args = body["op"], body["args"]
        need(op in ("preview", "restore"), "REQUEST_INVALID")
        need(exact(args, {"capsule"} if op == "preview" else {"capsule", "review"}), "REQUEST_INVALID")
        capsule = args["capsule"]
        incoming = validate_capsule(capsule)
        if op == "restore":
            review = args["review"]
            need(exact(review, {"capsuleDigest", "baseRevision"}) and
                 matches(DIGEST, review["baseRevision"]) and
                 review["capsuleDigest"] == capsule["journalSha256"], "CAPSULE_REVIEW_REQUIRED", 409)
        with self.transaction():
            revision, current, added, duplicates = self.capsule_plan(incoming)
            if op == "preview":
                return {"schema": "vivo.memory-capsule-review/1",
                        "capsuleDigest": capsule["journalSha256"], "baseRevision": revision,
                        "current": current, "incoming": len(incoming), "added": len(added),
                        "duplicates": duplicates, "resulting": current + len(added),
                        "fixture": sum(record["mode"] == "fixture" for record, _, _ in incoming),
                        "liveClaims": sum(record["mode"] == "live" for record, _, _ in incoming),
                        "newReportsPrivate": True}
            need(hmac.compare_digest(review["baseRevision"], revision), "CAPSULE_REVIEW_STALE", 409)
            now = int(time.time())
            # One SQLite transaction; no per-record archive() commits.
            # Existing evidence rows and grants are never modified.
            self.db.executemany(
                "INSERT INTO evidence(memory_id,run_id,envelope,bytes,archived_at) VALUES(?,?,?,?,?)",
                [(record["memoryId"], record["runId"], raw, size, now) for record, raw, size in added])
            return {"schema": "vivo.memory-capsule-restore/1", "capsuleDigest": capsule["journalSha256"],
                    "status": "restored" if added else "unchanged", "added": len(added),
                    "duplicates": duplicates, "total": current + len(added), "newReportsPrivate": True}

    def visible_rows(self, principal):
        if principal.role == "owner":
            return self.db.execute("SELECT * FROM evidence ORDER BY seq DESC").fetchall()
        need(principal.role == "editor" and matches(INVITE_ID, principal.invitation_id), "FORBIDDEN", 403)
        return self.db.execute("""SELECT e.* FROM evidence e JOIN grants g ON g.memory_id=e.memory_id
            WHERE g.invitation_id=? ORDER BY e.seq DESC""", (principal.invitation_id,)).fetchall()

    def get(self, principal, memory_id):
        need(matches(MEMORY_ID, memory_id), "REQUEST_INVALID")
        row = next((row for row in self.visible_rows(principal) if row[1] == memory_id), None)
        # Unshared and absent records are deliberately indistinguishable.
        need(row is not None, "NOT_FOUND", 404)
        record, envelope = self.decode(row)
        return {"record": record, "envelope": envelope}

    def search(self, principal, args):
        need(set(args) <= {"query", "mode", "limit", "before"}, "REQUEST_INVALID")
        query, mode, limit, before = args.get("query", ""), args.get("mode", "all"), args.get("limit", 16), args.get("before")
        need(isinstance(query, str) and len(query) <= 128 and mode in ("all", "fixture", "live"), "REQUEST_INVALID")
        need(integer(limit, 1, 20) and (before is None or integer(before, 1)), "REQUEST_INVALID")
        terms = query.lower().split()
        matches_rows = []
        for row in self.visible_rows(principal):
            if before is not None and row[0] >= before:
                continue
            record, _ = self.decode(row)
            if mode != "all" and record["mode"] != mode:
                continue
            haystack = " ".join(str(v or "") for v in
                                [record["memoryId"], record["runId"], record["mode"], record["task"],
                                 record["provenance"]] + [v for r in record["rows"] for v in
                                 (r["provider"], r["model"], r["status"], r["verdict"], r["candidate"])]).lower()
            if all(term in haystack for term in terms):
                matches_rows.append(record)
            if len(matches_rows) > limit:
                break
        page = matches_rows[:limit]
        return {"records": page, "nextBefore": page[-1]["sequence"] if len(matches_rows) > limit else None}

    def agent_context(self, principal, args):
        """Task- and provenance-scoped recall, with all dissent retained.

        No free-form instructions, provider calls or confidence-derived
        authority. The scope is explicit rather than inferred from a prompt.
        Filtering, truncation and sequence order concern authorized records
        only; the result never reveals an inaccessible record's existence.
        """
        need(set(args) <= {"task", "mode", "providers", "limit"}, "REQUEST_INVALID")
        task, mode = args.get("task"), args.get("mode")
        providers, limit = args.get("providers", []), args.get("limit", 4)
        need(task in ("arithmetic-31-v1", "route-constraint-v1") and mode in ("fixture", "live"), "REQUEST_INVALID")
        need(isinstance(providers, list) and len(providers) <= len(PROVIDERS)
             and all(isinstance(p, str) and p in PROVIDERS for p in providers)
             and len(set(providers)) == len(providers) and integer(limit, 1, 8), "REQUEST_INVALID")
        required = set(providers)
        matching = []
        for row in self.visible_rows(principal):
            record, _ = self.decode(row)
            if record["task"] != task or record["mode"] != mode:
                continue
            if not required.issubset({r["provider"] for r in record["rows"]}):
                continue
            # Keep the entire scoped report, not only favorable responses
            # from the requested providers. Missing usage is still null.
            matching.append(record)
            if len(matching) > limit:
                break
        records = matching[:limit]
        return {"schema": "vivo.agent-evidence-context/1",
                "selection": {"task": task, "mode": mode, "providers": sorted(required), "limit": limit},
                "status": "evidence-found" if records else "no-matching-evidence",
                "records": records, "truncated": len(matching) > limit,
                "authority": "evidence-only", "providerAuthenticated": False,
                "postedChargesUsd": None, "worldActionExecuted": False}

    def agent_reason(self, principal, args):
        """Resolve one exact versioned planning task, using scoped memory.

        The local mathematical certificate is independent of model votes.
        Historical proposals are observations, not authenticated facts. The
        same solver answer is possible without memory, but no hidden record
        can influence the evidence summary, citations or returned digest.
        """
        need(args.get("task") == "route-constraint-v1", "UNSUPPORTED_REASONING_TASK")
        context = self.agent_context(principal, args)
        options = [plan(",".join(parts)) for size in range(1, len(JOBS)+1)
                   for parts in combinations(JOBS, size)]
        feasible = sorted((item for item in options if item["feasible"]),
                          key=lambda item: (-item["value"], item["cost"], item["candidate"]))
        best, runner_up = feasible[:2]
        need(best == optimum() and best["value"] > runner_up["value"])
        counts = {verdict: 0 for verdict in
                  ("optimal", "feasible-suboptimal", "over-budget", "invalid-proposal", "unknown")}
        citations = []
        for record in context["records"]:
            observations = []
            for row in record["rows"]:
                verdict = row["verdict"]
                need(verdict in counts, "STORED_EVIDENCE_INVALID", 409)
                counts[verdict] += 1
                observations.append({"provider": row["provider"], "candidate": row["candidate"],
                                     "verdict": verdict, "status": row["status"]})
            citations.append({"memoryId": record["memoryId"], "evidenceDigest": record["evidenceDigest"],
                              "runId": record["runId"], "provenance": record["provenance"],
                              "observations": observations})
        if not citations:
            support = "no-matching-evidence"
        elif counts["optimal"]:
            support = "matching-optimum-observed"
        elif counts["feasible-suboptimal"] or counts["over-budget"] or counts["invalid-proposal"]:
            support = "dissent-or-invalid-only"
        else:
            support = "no-usable-proposal"
        decision = {
            "schema": "vivo.agent-reasoning/1",
            "selection": context["selection"],
            "proposal": best,
            "proof": {
                "method": "exhaustive-subset-enumeration",
                "budget": 7,
                "jobs": [{"id": name, "cost": cost, "value": value}
                         for name, (cost, value) in JOBS.items()],
                "subsetsChecked": len(options), "feasibleSubsets": len(feasible),
                "runnerUp": runner_up, "optimalityGap": best["value"] - runner_up["value"],
                "enumerated": options,
            },
            "evidence": {
                "status": support, "recordsUsed": len(citations),
                "truncated": context["truncated"], "observationCounts": counts,
                "countUnit": "report-provider-observations-not-independent-votes",
                "citations": citations,
            },
            "authority": "evidence-only", "providerAuthenticated": False,
            "providerCallsInitiated": 0, "postedChargesUsd": None, "worldActionExecuted": False,
        }
        # Hash the exact decision bytes; this is a reproducible receipt, not
        # a provider signature or new permission to execute the proposal.
        return {**decision, "decisionSha256": hashlib.sha256(canonical(decision).encode("utf-8")).hexdigest()}

    def set_grant(self, principal, memory_id, invitation_id, granted, invitations):
        need(principal.role == "owner", "FORBIDDEN", 403)
        need(matches(INVITE_ID, invitation_id) and type(granted) is bool, "REQUEST_INVALID")
        self.get(principal, memory_id)
        invite = next((item for item in invitations() if item["id"] == invitation_id), None)
        if granted:
            need(invite is not None and not invite["revoked"] and invite["expiresAt"] > int(time.time()),
                 "INVITATION_INACTIVE", 409)
        with self.transaction():
            if granted:
                self.db.execute("INSERT OR IGNORE INTO grants(memory_id,invitation_id) VALUES(?,?)",
                                (memory_id, invitation_id))
            else:
                self.db.execute("DELETE FROM grants WHERE memory_id=? AND invitation_id=?",
                                (memory_id, invitation_id))
        return {"memoryId": memory_id, "invitationId": invitation_id, "granted": granted}

    def list_grants(self, principal, memory_id, invitations):
        need(principal.role == "owner", "FORBIDDEN", 403)
        self.get(principal, memory_id)
        ids = {r[0] for r in self.db.execute("SELECT invitation_id FROM grants WHERE memory_id=?", (memory_id,))}
        now = int(time.time())
        return {"memoryId": memory_id, "grants": [
            {"invitationId": i["id"], "actorId": i["actorId"],
             "active": not i["revoked"] and i["expiresAt"] > now}
            for i in invitations() if i["id"] in ids]}

    def dispatch(self, principal, body, invitations):
        need(exact(body, {"op", "args"}) and isinstance(body["args"], dict), "REQUEST_INVALID")
        op, args = body["op"], body["args"]
        if op == "search":
            return self.search(principal, args)
        if op == "context":
            return self.agent_context(principal, args)
        if op == "reason":
            return self.agent_reason(principal, args)
        if op == "get":
            need(exact(args, {"memoryId"}), "REQUEST_INVALID")
            return self.get(principal, args["memoryId"])
        need(principal.role == "owner", "FORBIDDEN", 403)
        if op == "archive":
            need(exact(args, {"envelope"}), "REQUEST_INVALID")
            return self.archive(args["envelope"])
        if op == "grant":
            need(exact(args, {"memoryId", "invitationId", "granted"}), "REQUEST_INVALID")
            return self.set_grant(principal, args["memoryId"], args["invitationId"], args["granted"], invitations)
        if op == "grants":
            need(exact(args, {"memoryId"}), "REQUEST_INVALID")
            return self.list_grants(principal, args["memoryId"], invitations)
        raise MemoryError("REQUEST_INVALID")

    def close(self):
        self.db.close()


def attach_memory_routes(app, *, vault, origin, authenticate, invitations):
    """Single explicit same-origin POST; bearer authenticated on each call."""
    def reply(body, status=200):
        return web.json_response({"schema": SCHEMA, **body}, status=status, headers={"Cache-Control": "no-store"})

    async def dispatch(request):
        if request.headers.get("Origin") != origin:
            return reply({"error": "ORIGIN_NOT_ALLOWED"}, 403)
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer ") or not 20 <= len(header[7:]) <= 256:
            return reply({"error": "AUTH_REQUIRED"}, 401)
        try:
            principal = authenticate(header[7:])
        except Exception:
            return reply({"error": "AUTH_REQUIRED"}, 401)
        try:
            need(request.content_type == "application/json", "REQUEST_INVALID")
            raw = await request.read()
            need(len(raw) <= MAX_REQUEST, "REQUEST_TOO_LARGE", 413)
            body = strict_json(raw.decode("utf-8"))
            # Reauthenticate after the asynchronous body read: an invitation
            # could have expired or been revoked while the body was arriving.
            try:
                principal = authenticate(header[7:])
            except Exception:
                return reply({"error": "AUTH_REQUIRED"}, 401)
            return reply({"result": vault.dispatch(principal, body, invitations)})
        except MemoryError as error:
            return reply({"error": error.code}, error.status)
        except web.HTTPRequestEntityTooLarge:
            return reply({"error": "REQUEST_TOO_LARGE"}, 413)
        except (UnicodeError, RecursionError, TypeError, ValueError):
            return reply({"error": "REQUEST_INVALID"}, 400)
        except sqlite3.Error:
            return reply({"error": "MEMORY_STORAGE_UNAVAILABLE"}, 503)

    async def capsule_dispatch(request):
        # A separate bounded owner-only route keeps the ordinary 64 KiB API
        # limit unchanged. Recheck admission after the asynchronous upload.
        if request.headers.get("Origin") != origin:
            return reply({"error": "ORIGIN_NOT_ALLOWED"}, 403)
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer ") or not 20 <= len(header[7:]) <= 256:
            return reply({"error": "AUTH_REQUIRED"}, 401)
        try:
            principal = authenticate(header[7:])
        except Exception:
            return reply({"error": "AUTH_REQUIRED"}, 401)
        if principal.role != "owner":
            return reply({"error": "FORBIDDEN"}, 403)
        try:
            need(request.content_type == "application/json", "REQUEST_INVALID")
            need(request.headers.get("Content-Encoding", "identity").lower() == "identity", "REQUEST_INVALID")
            need(request.content_length is None or request.content_length <= CAPSULE_MAX_REQUEST,
                 "REQUEST_TOO_LARGE", 413)
            raw = bytearray()
            async with asyncio.timeout(15):
                async for chunk in request.content.iter_chunked(16384):
                    need(len(raw) + len(chunk) <= CAPSULE_MAX_REQUEST, "REQUEST_TOO_LARGE", 413)
                    raw.extend(chunk)
            try:
                principal = authenticate(header[7:])
            except Exception:
                return reply({"error": "AUTH_REQUIRED"}, 401)
            return reply({"result": vault.capsule_dispatch(principal, strict_json(raw.decode("utf-8")))})
        except MemoryError as error:
            return reply({"error": error.code}, error.status)
        except TimeoutError:
            return reply({"error": "CAPSULE_UPLOAD_TIMEOUT"}, 408)
        except (UnicodeError, RecursionError, TypeError, ValueError):
            return reply({"error": "REQUEST_INVALID"}, 400)
        except sqlite3.Error:
            return reply({"error": "MEMORY_STORAGE_UNAVAILABLE"}, 503)

    app.router.add_post("/api/neural-memory", dispatch)
    app.router.add_post("/api/neural-memory/capsule", capsule_dispatch)
