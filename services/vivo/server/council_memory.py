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
BACKUP_SET_MAX_BYTES = 5 * 1024 * 1024
BACKUP_SET_MAX_REQUEST = BACKUP_SET_MAX_BYTES + 8192
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


MISSION_JOB_ID = re.compile(r"^[A-Z][A-Z0-9]{0,7}$")
MISSION_MAX_JOBS = 12
MISSION_MAX_UNIT = 1_000_000


def mission_layers(ids, dependencies):
    """Deterministic precedence layers, not a timed or authorized schedule."""
    remaining, completed, layers = set(ids), set(), []
    while remaining:
        ready = sorted(job for job in remaining
                       if all(dep in completed for target, dep in dependencies if target == job))
        need(bool(ready), "MISSION_DEPENDENCY_CYCLE")
        layers.append(ready)
        remaining.difference_update(ready)
        completed.update(ready)
    return layers


def normalize_agent_mission(mission):
    """Exact bounded integer resource allocation; no executable instructions."""
    fields = {"budget", "jobs", "required", "conflicts"}
    need(exact(mission, fields) or exact(mission, fields | {"dependencies"}), "MISSION_INVALID")
    budget, jobs, required, conflicts = (mission[k] for k in ("budget", "jobs", "required", "conflicts"))
    need(integer(budget, 0, MISSION_MAX_JOBS * MISSION_MAX_UNIT)
         and isinstance(jobs, list) and 1 <= len(jobs) <= MISSION_MAX_JOBS, "MISSION_INVALID")
    normalized, ids = [], set()
    for job in jobs:
        need(exact(job, {"id", "cost", "value"}) and matches(MISSION_JOB_ID, job["id"])
             and integer(job["cost"], 0, MISSION_MAX_UNIT) and integer(job["value"], 0, MISSION_MAX_UNIT)
             and job["id"] not in ids, "MISSION_INVALID")
        ids.add(job["id"])
        normalized.append({"id": job["id"], "cost": job["cost"], "value": job["value"]})
    need(isinstance(required, list) and len(required) <= len(ids)
         and all(isinstance(item, str) and item in ids for item in required)
         and len(set(required)) == len(required), "MISSION_INVALID")
    need(isinstance(conflicts, list) and len(conflicts) <= len(ids)*(len(ids)-1)//2, "MISSION_INVALID")
    pairs = set()
    for pair in conflicts:
        need(isinstance(pair, list) and len(pair) == 2
             and all(isinstance(item, str) and item in ids for item in pair)
             and pair[0] != pair[1], "MISSION_INVALID")
        key = tuple(sorted(pair))
        need(key not in pairs, "MISSION_INVALID")
        pairs.add(key)
    dependencies = mission.get("dependencies", [])
    need(isinstance(dependencies, list) and len(dependencies) <= len(ids)*(len(ids)-1),
         "MISSION_INVALID")
    edges = set()
    for edge in dependencies:
        need(isinstance(edge, list) and len(edge) == 2
             and all(isinstance(item, str) and item in ids for item in edge)
             and edge[0] != edge[1] and tuple(edge) not in edges, "MISSION_INVALID")
        edges.add(tuple(edge))
    ordered_edges = [list(edge) for edge in sorted(edges)]
    # Reject cycles anywhere in the declared definition, including optional
    # jobs. Keep the legacy v1 fingerprint for an absent or empty edge list.
    mission_layers(ids, ordered_edges)
    result = {"budget": budget, "jobs": sorted(normalized, key=lambda job: job["id"]),
              "required": sorted(required), "conflicts": [list(pair) for pair in sorted(pairs)]}
    if ordered_edges:
        result["dependencies"] = ordered_edges
    return result


def mission_rows(mission, *, respect_budget=True):
    """Enumerate combinations independently of the browser's bitmask solver."""
    jobs = mission["jobs"]
    required = set(mission["required"])
    dependencies = mission.get("dependencies", [])
    rows = []
    for size in range(len(jobs)+1):
        for subset in combinations(jobs, size):
            ids = {job["id"] for job in subset}
            cost = sum(job["cost"] for job in subset)
            value = sum(job["value"] for job in subset)
            feasible = ((not respect_budget or cost <= mission["budget"]) and required.issubset(ids)
                        and not any(a in ids and b in ids for a,b in mission["conflicts"])
                        and all(target not in ids or dep in ids for target,dep in dependencies))
            rows.append([",".join(job["id"] for job in subset), cost, value, feasible])
    rows.sort(key=lambda row: row[0])
    return rows


def mission_certificate(mission):
    jobs = mission["jobs"]
    required = set(mission["required"])
    dependencies = mission.get("dependencies", [])
    rows = mission_rows(mission)
    feasible = sorted((row for row in rows if row[3]), key=lambda row: (-row[2], row[1], row[0]))
    def projected(row):
        return {"candidate": row[0], "cost": row[1], "value": row[2], "feasible": True} if row else None
    best = feasible[0] if feasible else None
    second = feasible[1] if len(feasible) > 1 else None
    proof = {
        "method": "exhaustive-dependent-subsets/1" if dependencies else "exhaustive-bounded-subsets/1",
        "subsetsChecked": len(rows), "feasibleSubsets": len(feasible),
        "equallyValuableOptima": sum(row[2] == best[2] for row in feasible) if best else 0,
        "runnerUp": projected(second),
        "optimalityGap": best[2] - second[2] if second else None,
        "enumerationSha256": hashlib.sha256(canonical(rows).encode("utf-8")).hexdigest(),
        "ranking": "value-desc-cost-asc-id-asc",
        "includesEmptyChoice": True,
    }
    if dependencies:
        # With nonnegative costs and no mandatory optional jobs, the closed
        # required set itself is feasible exactly when these blockers are absent.
        closure = set(required)
        for _ in jobs:
            closure.update(dep for target, dep in dependencies if target in closure)
        cost = sum(job["cost"] for job in jobs if job["id"] in closure)
        conflicts = [pair for pair in mission["conflicts"] if all(item in closure for item in pair)]
        blockers = []
        if cost > mission["budget"]:
            blockers.append("required-closure-over-budget")
        if conflicts:
            blockers.append("required-closure-conflict")
        need(bool(blockers) == (best is None), "MISSION_PROOF_INVALID")
        chosen = best[0].split(",") if best and best[0] else []
        proof.update({"requiredClosure": sorted(closure), "requiredMinimumCost": cost,
                      "requiredConflicts": conflicts, "infeasibilityReasons": blockers,
                      "dependencyLayers": mission_layers(chosen, dependencies),
                      "executionAuthority": "advisory-only"})
    return projected(best), proof


def mission_budget_comparison(args):
    """A single structural enumeration answers all resource scenarios.

    No historical reports are queried: the costs/values are caller-supplied
    scenario assumptions, not observations, prices or execution authorization.
    """
    need(exact(args, {"mission", "budgets", "targetValue"}), "MISSION_COMPARISON_INVALID")
    mission = normalize_agent_mission(args["mission"])
    budgets, target_value = args["budgets"], args["targetValue"]
    maximum = MISSION_MAX_JOBS * MISSION_MAX_UNIT
    need(isinstance(budgets, list) and 1 <= len(budgets) <= 8
         and all(integer(budget, 0, maximum) for budget in budgets)
         and len(set(budgets)) == len(budgets)
         and (target_value is None or integer(target_value, 0, maximum)),
         "MISSION_COMPARISON_INVALID")
    budgets = sorted(budgets)
    rows = mission_rows(mission, respect_budget=False)
    viable = sorted((row for row in rows if row[3]), key=lambda row: (row[1], -row[2], row[0]))
    # Group ordering chooses the highest value and smallest ID at a given cost.
    # Strict improvements are exactly the non-dominated cost/value breakpoints.
    frontier, best_value = [], -1
    for row in viable:
        if row[2] > best_value:
            frontier.append(row)
            best_value = row[2]

    def proposal(row):
        return {"candidate": row[0], "cost": row[1], "value": row[2], "feasible": True} if row else None

    def scenario(budget):
        point = next((row for row in reversed(frontier) if row[1] <= budget), None)
        return {"budget": budget, "proposal": proposal(point),
                "feasibleSubsets": sum(row[1] <= budget for row in viable)}

    baseline = scenario(mission["budget"])
    next_step = next((row for row in frontier if row[1] > mission["budget"]), None)
    target = None
    if target_value is not None:
        reached = next((row for row in frontier if row[2] >= target_value), None)
        target = {"requestedValue": target_value, "status": "attainable" if reached else "unattainable",
                  "minimumBudget": reached[1] if reached else None, "proposal": proposal(reached)}
    result = {
        "schema": "vivo.agent-budget-comparison/1",
        "mission": mission, "missionSha256": hashlib.sha256(canonical(mission).encode("utf-8")).hexdigest(),
        "budgets": budgets, "targetValue": target_value,
        "baseline": baseline, "scenarios": [scenario(budget) for budget in budgets],
        "nextImprovement": proposal(next_step),
        "minimumFeasibleBudget": frontier[0][1] if frontier else None,
        "maximumAttainableValue": frontier[-1][2] if frontier else None,
        "target": target,
        "proof": {"method": "exhaustive-resource-frontier/1", "subsetsChecked": len(rows),
                  "structurallyFeasibleSubsets": len(viable), "frontierPoints": len(frontier),
                  "enumerationSha256": hashlib.sha256(canonical(rows).encode("utf-8")).hexdigest(),
                  "frontierSha256": hashlib.sha256(canonical(frontier).encode("utf-8")).hexdigest(),
                  "ranking": "value-desc-cost-asc-id-asc"},
        "evidence": {"status": "hypothetical-resource-comparison", "recordsUsed": 0},
        "authority": "evidence-only", "providerAuthenticated": False, "providerCallsInitiated": 0,
        "postedChargesUsd": None, "worldActionExecuted": False,
    }
    return {**result, "decisionSha256": hashlib.sha256(canonical(result).encode("utf-8")).hexdigest()}


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


def validate_backup_set(bundle):
    """Independently validate complete ordered coverage before a restore.

    The manifest is an integrity/coverage contract, not authenticated origin.
    It cannot import grants, credentials or prior restore receipts.
    """
    try:
        need(exact(bundle, {"schema", "manifestJson", "manifestSha256", "capsules"})
             and bundle["schema"] == "vivo.memory-backup-set/1")
        raw, claimed, capsules = bundle["manifestJson"], bundle["manifestSha256"], bundle["capsules"]
        need(isinstance(raw, str) and raw.isascii() and len(raw) <= 32768
             and matches(DIGEST, claimed) and isinstance(capsules, list)
             and 1 <= len(capsules) <= MAX_REPORTS)
        need(len(canonical(bundle).encode("utf-8")) <= BACKUP_SET_MAX_BYTES)
        need(hmac.compare_digest(hashlib.sha256(raw.encode("utf-8")).hexdigest(), claimed))
        manifest = strict_json(raw)
        need(exact(manifest, {"schema", "revision", "total", "parts", "includesGrants", "includesRestoreReceipts"})
             and canonical(manifest) == raw and manifest["schema"] == "vivo.memory-backup-manifest/1"
             and matches(DIGEST, manifest["revision"]) and integer(manifest["total"], 0, MAX_REPORTS)
             and manifest["includesGrants"] is False and manifest["includesRestoreReceipts"] is False
             and isinstance(manifest["parts"], list) and len(manifest["parts"]) == len(capsules))
        incoming, seen = [], set()
        offset, journal_bytes = 0, 0
        for part, capsule in zip(manifest["parts"], capsules):
            need(exact(part, {"offset", "count", "journalSha256"})
                 and integer(part["offset"], 0, MAX_REPORTS) and part["offset"] == offset
                 and integer(part["count"], 0, CAPSULE_MAX_REPORTS)
                 and offset + part["count"] <= manifest["total"]
                 and (part["count"] > 0 or (manifest["total"] == 0 and len(capsules) == 1)))
            entries = validate_capsule(capsule)
            need(len(entries) == part["count"] and capsule["journalSha256"] == part["journalSha256"])
            for record, _, _ in entries:
                need(record["runId"] not in seen)
                seen.add(record["runId"])
            incoming.extend(entries)
            offset += len(entries)
            journal_bytes += len(capsule["journalJson"].encode("utf-8"))
        need(offset == manifest["total"] and journal_bytes <= MAX_BYTES + 384
             and sum(entry[2] for entry in incoming) <= MAX_BYTES)
        return manifest, incoming
    except (MemoryError, ValueError, TypeError, UnicodeError, RecursionError):
        raise MemoryError("BACKUP_SET_INVALID") from None


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
            CREATE TABLE IF NOT EXISTS capsule_restore_receipts(
              seq INTEGER PRIMARY KEY,
              capsule_digest TEXT NOT NULL,
              base_revision TEXT NOT NULL,
              receipt TEXT NOT NULL,
              receipt_digest TEXT NOT NULL,
              UNIQUE(capsule_digest, base_revision));
            CREATE TABLE IF NOT EXISTS backup_set_restore_receipts(
              seq INTEGER PRIMARY KEY,
              manifest_digest TEXT NOT NULL,
              base_revision TEXT NOT NULL,
              receipt TEXT NOT NULL,
              receipt_digest TEXT NOT NULL,
              UNIQUE(manifest_digest, base_revision));
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

    def decode_restore_receipt(self, row, *, backup_set=False):
        """Revalidate a historical commit receipt without implying current grants."""
        _, source_digest, base_revision, raw, digest = row
        field = "manifestDigest" if backup_set else "capsuleDigest"
        kind = "backup" if backup_set else "capsule"
        maximum = MAX_REPORTS if backup_set else CAPSULE_MAX_REPORTS
        try:
            need(isinstance(raw, str) and len(raw) <= 16384 and matches(DIGEST, digest)
                 and hmac.compare_digest(hashlib.sha256(raw.encode("utf-8")).hexdigest(), digest))
            receipt = strict_json(raw)
            need(exact(receipt, {"schema", field, "baseRevision", "committedAt",
                                "addedMemoryIds", "added", "duplicates", "totalAtCommit",
                                "newReportsPrivateAtCommit"}) and canonical(receipt) == raw)
            need(receipt["schema"] == f"vivo.memory-{kind}-commit/1"
                 and receipt[field] == source_digest and matches(DIGEST, source_digest)
                 and receipt["baseRevision"] == base_revision and matches(DIGEST, base_revision)
                 and integer(receipt["committedAt"]) and receipt["newReportsPrivateAtCommit"] is True)
            ids = receipt["addedMemoryIds"]
            need(isinstance(ids, list) and 1 <= len(ids) <= maximum
                 and all(matches(MEMORY_ID, item) for item in ids) and len(set(ids)) == len(ids))
            need(integer(receipt["added"], 1, maximum) and receipt["added"] == len(ids)
                 and integer(receipt["duplicates"], 0, maximum)
                 and receipt["added"] + receipt["duplicates"] <= maximum
                 and integer(receipt["totalAtCommit"], receipt["added"] + receipt["duplicates"], MAX_REPORTS))
            for memory_id in ids:
                evidence = self.db.execute("SELECT * FROM evidence WHERE memory_id=?", (memory_id,)).fetchone()
                need(evidence is not None)
                self.decode(evidence)
            return {**receipt, "receiptSha256": digest}
        except (MemoryError, ValueError, TypeError, UnicodeError, RecursionError):
            raise MemoryError("STORED_RESTORE_RECEIPT_INVALID", 409) from None

    def restore_receipt(self, args, *, backup_set=False):
        field = "manifestDigest" if backup_set else "capsuleDigest"
        kind = "backup" if backup_set else "capsule"
        need(exact(args, {field, "baseRevision"})
             and matches(DIGEST, args[field]) and matches(DIGEST, args["baseRevision"]), "REQUEST_INVALID")
        sql = ("SELECT * FROM backup_set_restore_receipts WHERE manifest_digest=? AND base_revision=?"
               if backup_set else
               "SELECT * FROM capsule_restore_receipts WHERE capsule_digest=? AND base_revision=?")
        row = self.db.execute(sql, (args[field], args["baseRevision"])).fetchone()
        return {"schema": f"vivo.memory-{kind}-commit-status/1", **args,
                "status": "committed" if row else "not-observed",
                "receipt": self.decode_restore_receipt(row, backup_set=backup_set) if row else None}

    def recent_restore_receipts(self, args, *, backup_set=False):
        need(exact(args, {"limit"}) and integer(args["limit"], 1, 16), "REQUEST_INVALID")
        sql = ("SELECT * FROM backup_set_restore_receipts ORDER BY seq DESC LIMIT ?" if backup_set else
               "SELECT * FROM capsule_restore_receipts ORDER BY seq DESC LIMIT ?")
        rows = self.db.execute(sql, (args["limit"],)).fetchall()
        kind = "backup" if backup_set else "capsule"
        return {"schema": f"vivo.memory-{kind}-commit-history/1",
                "receipts": [self.decode_restore_receipt(row, backup_set=backup_set) for row in rows]}

    def commit_reviewed_evidence(self, added, duplicates, current, revision, source_digest, *, backup_set=False):
        """Caller owns the transaction; evidence and its receipt are indivisible."""
        now = int(time.time())
        self.db.executemany(
            "INSERT INTO evidence(memory_id,run_id,envelope,bytes,archived_at) VALUES(?,?,?,?,?)",
            [(record["memoryId"], record["runId"], raw, size, now) for record, raw, size in added])
        if not added:
            return
        # Across both receipt tables, each changed transaction consumes at
        # least one of the non-evicting evidence slots; no unbounded no-op writes.
        kind = "backup" if backup_set else "capsule"
        field = "manifestDigest" if backup_set else "capsuleDigest"
        receipt = {"schema": f"vivo.memory-{kind}-commit/1",
                   field: source_digest, "baseRevision": revision, "committedAt": now,
                   "addedMemoryIds": [record["memoryId"] for record, _, _ in added],
                   "added": len(added), "duplicates": duplicates, "totalAtCommit": current + len(added),
                   "newReportsPrivateAtCommit": True}
        raw = canonical(receipt)
        sql = ("""INSERT INTO backup_set_restore_receipts
                (manifest_digest,base_revision,receipt,receipt_digest) VALUES(?,?,?,?)""" if backup_set else
               """INSERT INTO capsule_restore_receipts
                (capsule_digest,base_revision,receipt,receipt_digest) VALUES(?,?,?,?)""")
        self.db.execute(sql, (source_digest, revision, raw, hashlib.sha256(raw.encode("utf-8")).hexdigest()))

    def backup_capsule(self, args):
        """Return one recoverable part of an owner-only, revision-pinned backup.

        Parts retain original Council envelopes in archive order. Grants,
        invitation identifiers, commit history and credentials are deliberately
        excluded. Any intervening evidence/grant mutation invalidates the cursor.
        """
        need(exact(args, {"after", "revision"}), "REQUEST_INVALID")
        after, expected = args["after"], args["revision"]
        need((after is None and expected is None) or
             (integer(after, 1) and matches(DIGEST, expected)), "REQUEST_INVALID")
        revision, total, _, _ = self.capsule_plan([])
        if expected is not None:
            need(hmac.compare_digest(expected, revision), "BACKUP_REVISION_STALE", 409)
        rows = self.db.execute("SELECT * FROM evidence ORDER BY seq").fetchall()
        if after is not None:
            need(any(row[0] == after for row in rows), "BACKUP_CURSOR_INVALID", 409)
        start = sum(row[0] <= after for row in rows) if after is not None else 0
        need(after is None or start < total, "BACKUP_CURSOR_INVALID", 409)
        envelopes, last_seq = [], None
        journal_bytes = 2  # brackets, plus exact envelope bytes and commas
        for row in rows[start:]:
            _, envelope = self.decode(row)
            size = len(canonical(envelope).encode("utf-8")) + bool(envelopes)
            if len(envelopes) >= CAPSULE_MAX_REPORTS or journal_bytes + size > CAPSULE_MAX_JOURNAL:
                break
            envelopes.append(envelope)
            journal_bytes += size
            last_seq = row[0]
        need(bool(envelopes) or total == 0, "BACKUP_PART_TOO_LARGE", 409)
        raw = canonical(envelopes)
        capsule = {"schema": CAPSULE_SCHEMA, "journalJson": raw,
                   "journalSha256": hashlib.sha256(raw.encode("utf-8")).hexdigest()}
        # Apply the same validator that will be used at restore time.
        validate_capsule(capsule)
        through = start + len(envelopes)
        return {"schema": "vivo.memory-backup-part/1", "revision": revision,
                "after": after, "offset": start, "count": len(envelopes),
                "total": total, "nextAfter": last_seq if through < total else None,
                "complete": through == total, "capsule": capsule,
                "includesGrants": False, "includesRestoreReceipts": False}

    def capsule_dispatch(self, principal, body):
        need(principal.role == "owner", "FORBIDDEN", 403)
        need(exact(body, {"op", "args"}) and isinstance(body["args"], dict), "REQUEST_INVALID")
        op, args = body["op"], body["args"]
        if op == "backup":
            with self.transaction():
                return self.backup_capsule(args)
        if op == "receipt":
            with self.transaction():
                return self.restore_receipt(args)
        if op == "recent":
            with self.transaction():
                return self.recent_restore_receipts(args)
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
            self.commit_reviewed_evidence(added, duplicates, current, revision, capsule["journalSha256"])
            return {"schema": "vivo.memory-capsule-restore/1", "capsuleDigest": capsule["journalSha256"],
                    "status": "restored" if added else "unchanged", "added": len(added),
                    "duplicates": duplicates, "total": current + len(added), "newReportsPrivate": True}

    def backup_set_dispatch(self, principal, body):
        need(principal.role == "owner", "FORBIDDEN", 403)
        need(exact(body, {"op", "args"}) and isinstance(body["args"], dict), "REQUEST_INVALID")
        op, args = body["op"], body["args"]
        if op == "receipt":
            with self.transaction():
                return self.restore_receipt(args, backup_set=True)
        if op == "recent":
            with self.transaction():
                return self.recent_restore_receipts(args, backup_set=True)
        need(op in ("preview", "restore"), "REQUEST_INVALID")
        need(exact(args, {"bundle"} if op == "preview" else {"bundle", "review"}), "REQUEST_INVALID")
        bundle = args["bundle"]
        manifest, incoming = validate_backup_set(bundle)
        digest = bundle["manifestSha256"]
        if op == "restore":
            review = args["review"]
            need(exact(review, {"manifestDigest", "baseRevision"}) and
                 matches(DIGEST, review["baseRevision"]) and review["manifestDigest"] == digest,
                 "BACKUP_REVIEW_REQUIRED", 409)
        with self.transaction():
            revision, current, added, duplicates = self.capsule_plan(incoming)
            if op == "preview":
                return {"schema": "vivo.memory-backup-review/1", "manifestDigest": digest,
                        "sourceRevision": manifest["revision"], "baseRevision": revision,
                        "parts": len(manifest["parts"]), "current": current, "incoming": len(incoming),
                        "added": len(added), "duplicates": duplicates, "resulting": current + len(added),
                        "fixture": sum(record["mode"] == "fixture" for record, _, _ in incoming),
                        "liveClaims": sum(record["mode"] == "live" for record, _, _ in incoming),
                        "newReportsPrivate": True}
            need(hmac.compare_digest(review["baseRevision"], revision), "BACKUP_REVIEW_STALE", 409)
            self.commit_reviewed_evidence(added, duplicates, current, revision, digest, backup_set=True)
            return {"schema": "vivo.memory-backup-restore/1", "manifestDigest": digest,
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

    def plan_agent_mission(self, principal, args):
        need(exact(args, {"mission", "selection"}), "MISSION_INVALID")
        mission = normalize_agent_mission(args["mission"])
        selection = args["selection"]
        need(exact(selection, {"mode", "providers", "limit"}), "MISSION_INVALID")
        mode, providers, limit = (selection[k] for k in ("mode", "providers", "limit"))
        need(mode in ("fixture", "live") and isinstance(providers, list) and len(providers) <= len(PROVIDERS)
             and all(isinstance(p, str) and p in PROVIDERS for p in providers)
             and len(set(providers)) == len(providers) and integer(limit, 1, 8), "MISSION_INVALID")
        scope = {"mode": mode, "providers": sorted(providers), "limit": limit}
        known = {"budget": 7, "jobs": [{"id": name, "cost": cost, "value": value}
                 for name, (cost, value) in JOBS.items()], "required": [], "conflicts": []}
        best, proof = mission_certificate(mission)
        # Historical observations apply ONLY to an identical known mission.
        # No private archive query at all for a new problem.
        evidence = None
        if mission == known:
            evidence = self.agent_reason(principal, {"task": "route-constraint-v1", **scope})
            need(best == evidence["proposal"])
        decision = {
            "schema": "vivo.agent-mission-plan/2" if mission.get("dependencies") else "vivo.agent-mission-plan/1",
            "mission": mission,
            "missionSha256": hashlib.sha256(canonical(mission).encode("utf-8")).hexdigest(),
            "selection": scope, "proposal": best,
            "status": "optimal" if best is not None else "infeasible",
            "proof": proof,
            "evidence": {"status": "exact-task-recall" if evidence is not None else "mission-not-in-memory-contract",
                         "receipt": evidence},
            "authority": "evidence-only", "providerAuthenticated": False,
            "providerCallsInitiated": 0, "postedChargesUsd": None, "worldActionExecuted": False,
        }
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
        if op == "plan":
            return self.plan_agent_mission(principal, args)
        if op == "compare-budgets":
            return mission_budget_comparison(args)
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

    async def owner_upload(request, limit, handler):
        # Separate bounded owner-only routes preserve the ordinary 64 KiB
        # API and single-capsule limits. Reauthenticate after the upload.
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
            need(request.content_length is None or request.content_length <= limit,
                 "REQUEST_TOO_LARGE", 413)
            raw = bytearray()
            async with asyncio.timeout(15):
                async for chunk in request.content.iter_chunked(16384):
                    need(len(raw) + len(chunk) <= limit, "REQUEST_TOO_LARGE", 413)
                    raw.extend(chunk)
            try:
                principal = authenticate(header[7:])
            except Exception:
                return reply({"error": "AUTH_REQUIRED"}, 401)
            return reply({"result": handler(principal, strict_json(raw.decode("utf-8")))})
        except MemoryError as error:
            return reply({"error": error.code}, error.status)
        except TimeoutError:
            return reply({"error": "CAPSULE_UPLOAD_TIMEOUT"}, 408)
        except (UnicodeError, RecursionError, TypeError, ValueError):
            return reply({"error": "REQUEST_INVALID"}, 400)
        except sqlite3.Error:
            return reply({"error": "MEMORY_STORAGE_UNAVAILABLE"}, 503)

    async def capsule_dispatch(request):
        return await owner_upload(request, CAPSULE_MAX_REQUEST, vault.capsule_dispatch)

    async def backup_set_dispatch(request):
        return await owner_upload(request, BACKUP_SET_MAX_REQUEST, vault.backup_set_dispatch)

    app.router.add_post("/api/neural-memory", dispatch)
    app.router.add_post("/api/neural-memory/capsule", capsule_dispatch)
    app.router.add_post("/api/neural-memory/backup-set", backup_set_dispatch)
