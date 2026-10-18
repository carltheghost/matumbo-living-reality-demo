"""Bounded document-evidence protocol for the v0.3 first real-task proof.

This module is deliberately independent of the existing neural gate task.  A
document task exposes only a server-owned section catalogue, lets a policy
inspect bounded sections, and records typed candidates with byte-level
provenance.  A completion is accepted only after the verifier rereads the
original bytes and checks the requested revision rule.  The policy never gets
an oracle answer or a caller-provided filesystem path.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import re
from typing import Any, Iterable, Mapping, Sequence


DOCUMENT_BUNDLE_RELATIVE_PATH = Path("storage/document_evidence")
MANIFEST_FILENAME = "bundle_manifest.json"
DOCUMENT_SCHEMA = "vevo.v03.document-evidence.document.v1"
MANIFEST_SCHEMA = "vevo.v03.document-evidence.bundle-manifest.v1"
REQUEST_SCHEMA = "vevo.v03.document-evidence.request.v1"
RESPONSE_SCHEMA = "vevo.v03.document-evidence.response.v1"
CANDIDATE_SCHEMA = "vevo.v03.document-evidence.candidate.v1"
SNAPSHOT_SCHEMA = "vevo.v03.document-evidence.snapshot.v2"

MAX_DOCUMENTS = 6
MIN_DOCUMENTS = 2
MAX_SECTIONS_PER_DOCUMENT = 4
MIN_REQUESTED_FIELDS = 2
MAX_REQUESTED_FIELDS = 3
DEFAULT_ACTION_BUDGET = 16

VALUE_TYPES = frozenset({
    "date",
    "email",
    "enum",
    "number",
    "percentage",
    "person",
    "phone",
    "duration",
    "ratio",
})
DOCUMENT_ACTIONS = (
    "inspect_section",
    "select_candidate",
    "finish",
    "report_missing",
    "report_conflict",
)
REVISION_RULES = frozenset({"latest_non_obsolete"})
SECTION_KINDS = frozenset({"overview", "commercial", "contacts", "terms"})
HANDLE_RE = re.compile(r"^doc-[a-z0-9-]+$")
FIELD_RE = re.compile(r"^[a-z][a-z0-9_]*$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^\+[0-9][0-9 -]{5,31}$")


class DocumentEvidenceError(RuntimeError):
    """Base class for protocol and bundle failures."""


class DocumentIntegrityError(DocumentEvidenceError):
    """The server-owned document bytes no longer match the manifest."""


class ForbiddenDocumentHandle(DocumentEvidenceError):
    """A caller attempted to escape the server-owned handle namespace."""


class ProtocolViolation(DocumentEvidenceError):
    """A task, action, or packet violates the typed protocol."""


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON constant is forbidden: {value}")


def _assert_json_tree(value: Any, *, path: str = "$") -> None:
    """Reject non-JSON values, NaN, and infinities recursively."""

    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ProtocolViolation(f"non-finite value at {path}")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _assert_json_tree(item, path=f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ProtocolViolation(f"non-string object key at {path}")
            _assert_json_tree(item, path=f"{path}.{key}")
        return
    raise ProtocolViolation(f"unsupported JSON value at {path}: {type(value).__name__}")


def _strict_json_load(raw: bytes, *, source: str) -> Any:
    try:
        value = json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise DocumentIntegrityError(f"invalid JSON in {source}: {exc}") from exc
    try:
        _assert_json_tree(value, path=source)
    except ProtocolViolation as exc:
        raise DocumentIntegrityError(str(exc)) from exc
    return value


def _canonical_json(value: Any) -> str:
    _assert_json_tree(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _json_digest(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _bytes_digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _require_string(value: Any, name: str, *, pattern: re.Pattern[str] | None = None) -> str:
    if not isinstance(value, str) or not value:
        raise DocumentIntegrityError(f"{name} must be a non-empty string")
    if pattern is not None and pattern.fullmatch(value) is None:
        raise DocumentIntegrityError(f"invalid {name}")
    return value


def _validate_typed_value(value: Any, value_type: str, *, context: str) -> None:
    if value_type not in VALUE_TYPES:
        raise DocumentIntegrityError(f"unsupported value_type at {context}")
    if value_type == "number" or value_type == "ratio" or value_type == "percentage":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            raise DocumentIntegrityError(f"invalid finite numeric value at {context}")
        return
    if not isinstance(value, str) or not value or len(value) > 512:
        raise DocumentIntegrityError(f"invalid string value at {context}")
    if value_type == "date":
        if DATE_RE.fullmatch(value) is None:
            raise DocumentIntegrityError(f"invalid date value at {context}")
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise DocumentIntegrityError(f"invalid date value at {context}") from exc
    elif value_type == "email" and EMAIL_RE.fullmatch(value) is None:
        raise DocumentIntegrityError(f"invalid email value at {context}")
    elif value_type == "phone" and PHONE_RE.fullmatch(value) is None:
        raise DocumentIntegrityError(f"invalid phone value at {context}")


def _validate_document(document: Any, *, source: str) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise DocumentIntegrityError(f"document {source} must be an object")
    if document.get("schema") != DOCUMENT_SCHEMA:
        raise DocumentIntegrityError(f"unsupported document schema in {source}")
    document_id = _require_string(document.get("document_id"), "document_id")
    _require_string(document.get("template_family"), "template_family")
    _require_string(document.get("layout_id"), "layout_id")
    version = document.get("version")
    if type(version) is not int or version <= 0:
        raise DocumentIntegrityError(f"invalid version in {source}")
    _require_string(document.get("published_at"), "published_at")
    sections = document.get("sections")
    if not isinstance(sections, list) or not (1 <= len(sections) <= MAX_SECTIONS_PER_DOCUMENT):
        raise DocumentIntegrityError(f"document section bound exceeded in {source}")
    section_ids: set[str] = set()
    for section_index, section in enumerate(sections):
        if not isinstance(section, dict):
            raise DocumentIntegrityError(f"section {section_index} is not an object")
        section_id = _require_string(section.get("section_id"), "section_id")
        if section_id in section_ids:
            raise DocumentIntegrityError(f"duplicate section_id in {source}: {section_id}")
        section_ids.add(section_id)
        section_kind = _require_string(section.get("section_kind"), "section_kind")
        if section_kind not in SECTION_KINDS:
            raise DocumentIntegrityError(f"unsupported section_kind in {source}")
        _require_string(section.get("title"), "section title")
        _require_string(section.get("body"), "section body")
        facts = section.get("facts")
        if not isinstance(facts, list):
            raise DocumentIntegrityError(f"facts must be a list in {source}:{section_id}")
        fact_ids: set[str] = set()
        for fact_index, fact in enumerate(facts):
            if not isinstance(fact, dict):
                raise DocumentIntegrityError(f"fact {fact_index} is not an object")
            fact_id = _require_string(fact.get("fact_id"), "fact_id")
            if fact_id in fact_ids:
                raise DocumentIntegrityError(f"duplicate fact_id in {source}:{section_id}")
            fact_ids.add(fact_id)
            _require_string(fact.get("field_id"), "field_id", pattern=FIELD_RE)
            value_type = _require_string(fact.get("value_type"), "value_type")
            _validate_typed_value(fact.get("value"), value_type, context=f"{source}:{fact_id}")
            revision = fact.get("revision")
            if type(revision) is not int or revision <= 0:
                raise DocumentIntegrityError(f"invalid fact revision in {source}:{fact_id}")
            state = fact.get("state")
            if state not in {"current", "obsolete"}:
                raise DocumentIntegrityError(f"invalid fact state in {source}:{fact_id}")
            _require_string(fact.get("published_at"), "fact published_at")
            conflict_group = fact.get("conflict_group")
            if conflict_group is not None:
                _require_string(conflict_group, "conflict_group")
    return deepcopy(document)


def _safe_manifest_path(relative_path: Any) -> str:
    path = _require_string(relative_path, "manifest path")
    candidate = Path(path)
    if candidate.is_absolute() or "\\" in path or any(part in {"", ".", ".."} for part in candidate.parts):
        raise DocumentIntegrityError("manifest path must remain within the server bundle")
    return path


_SERVER_CONSTRUCTOR_TOKEN = object()


class DocumentBundleStore:
    """Read-only access to a fixed, manifest-addressed document bundle."""

    def __init__(self, root: Path, manifest: dict[str, Any], *, _token: object | None = None):
        if _token is not _SERVER_CONSTRUCTOR_TOKEN:
            raise ForbiddenDocumentHandle("document stores must be opened by the server-owned factory")
        self._root = root
        self._manifest = manifest
        self._entries = {entry["handle"]: entry for entry in manifest["documents"]}

    @classmethod
    def from_bundled(cls) -> "DocumentBundleStore":
        """Open the repository's bundled fixture; callers cannot choose a path."""

        root = Path(__file__).resolve().parents[2] / DOCUMENT_BUNDLE_RELATIVE_PATH
        return cls._from_server_root(root)

    @classmethod
    def _from_server_root(cls, root: Path) -> "DocumentBundleStore":
        """Test-only constructor for a copied server bundle.

        The production entry point is :meth:`from_bundled`; this private helper
        exists so integrity tests can mutate a copied bundle without exposing a
        caller-controlled document path in the task protocol.
        """

        if not isinstance(root, Path):
            raise ForbiddenDocumentHandle("server root must be a Path")
        root = root.resolve()
        manifest_path = root / MANIFEST_FILENAME
        try:
            raw = manifest_path.read_bytes()
        except OSError as exc:
            raise DocumentIntegrityError(f"cannot read document bundle manifest: {exc}") from exc
        manifest = _strict_json_load(raw, source=str(manifest_path))
        if not isinstance(manifest, dict) or manifest.get("schema") != MANIFEST_SCHEMA:
            raise DocumentIntegrityError("unsupported document bundle manifest")
        if not isinstance(manifest.get("bundle_id"), str) or not manifest["bundle_id"]:
            raise DocumentIntegrityError("manifest bundle_id is required")
        documents = manifest.get("documents")
        if not isinstance(documents, list) or not (MIN_DOCUMENTS <= len(documents) <= MAX_DOCUMENTS):
            raise DocumentIntegrityError("document bundle count is outside the bounded range")
        handles: set[str] = set()
        for entry in documents:
            if not isinstance(entry, dict):
                raise DocumentIntegrityError("manifest document entry must be an object")
            handle = _require_string(entry.get("handle"), "document handle", pattern=HANDLE_RE)
            if handle in handles:
                raise DocumentIntegrityError(f"duplicate document handle: {handle}")
            handles.add(handle)
            _safe_manifest_path(entry.get("path"))
            _require_string(entry.get("document_id"), "manifest document_id")
            sha256 = _require_string(entry.get("sha256"), "manifest sha256", pattern=SHA256_RE)
            if len(sha256) != 64:
                raise DocumentIntegrityError("manifest sha256 must be 64 hexadecimal characters")
        return cls(root, deepcopy(manifest), _token=_SERVER_CONSTRUCTOR_TOKEN)

    @property
    def bundle_id(self) -> str:
        return str(self._manifest["bundle_id"])

    @property
    def document_handles(self) -> tuple[str, ...]:
        return tuple(entry["handle"] for entry in self._manifest["documents"])

    def _entry(self, handle: str) -> dict[str, Any]:
        if not isinstance(handle, str) or HANDLE_RE.fullmatch(handle) is None or handle not in self._entries:
            raise ForbiddenDocumentHandle(f"unknown server-owned document handle: {handle!r}")
        return self._entries[handle]

    def _path_for(self, entry: Mapping[str, Any]) -> Path:
        relative = _safe_manifest_path(entry["path"])
        root = self._root.resolve()
        path = (root / relative).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ForbiddenDocumentHandle("manifest path escapes the server bundle") from exc
        return path

    def _read_verified_bytes(self, handle: str) -> tuple[dict[str, Any], bytes, str]:
        entry = self._entry(handle)
        path = self._path_for(entry)
        try:
            raw = path.read_bytes()
        except OSError as exc:
            raise DocumentIntegrityError(f"cannot read bundled document {handle}: {exc}") from exc
        actual = _bytes_digest(raw)
        if actual != entry["sha256"]:
            raise DocumentIntegrityError(f"source_changed:{handle}")
        return entry, raw, actual

    def open_document(self, handle: str) -> dict[str, Any]:
        entry, raw, _ = self._read_verified_bytes(handle)
        document = _strict_json_load(raw, source=f"document:{handle}")
        document = _validate_document(document, source=f"document:{handle}")
        if document["document_id"] != entry["document_id"]:
            raise DocumentIntegrityError(f"manifest document_id mismatch:{handle}")
        return document

    def verify_integrity(self, handles: Iterable[str] | None = None) -> None:
        selected = self.document_handles if handles is None else tuple(handles)
        for handle in selected:
            self.open_document(handle)

    def section_catalog(self, handles: Sequence[str]) -> list[dict[str, Any]]:
        catalog: list[dict[str, Any]] = []
        for handle in handles:
            document = self.open_document(handle)
            for position, section in enumerate(document["sections"]):
                catalog.append({
                    "document_handle": handle,
                    "section_id": section["section_id"],
                    "section_kind": section["section_kind"],
                    "position": position,
                })
        return catalog

    def read_section(self, handle: str, section_id: str) -> tuple[dict[str, Any], dict[str, Any], str]:
        document = self.open_document(handle)
        entry = self._entry(handle)
        for section in document["sections"]:
            if section["section_id"] == section_id:
                return deepcopy(document), deepcopy(section), str(entry["sha256"])
        raise ProtocolViolation(f"unknown section for document handle: {handle}:{section_id}")

    def manifest_entry(self, handle: str) -> dict[str, Any]:
        return deepcopy(self._entry(handle))


@dataclass(frozen=True)
class RequestedField:
    field_id: str
    value_type: str
    revision_rule: str = "latest_non_obsolete"

    def __post_init__(self) -> None:
        if FIELD_RE.fullmatch(self.field_id) is None:
            raise ProtocolViolation(f"invalid requested field id: {self.field_id!r}")
        if self.value_type not in VALUE_TYPES:
            raise ProtocolViolation(f"unsupported requested value type: {self.value_type!r}")
        if self.revision_rule not in REVISION_RULES:
            raise ProtocolViolation(f"unsupported revision rule: {self.revision_rule!r}")


@dataclass(frozen=True)
class DocumentTask:
    task_id: str
    document_handles: tuple[str, ...]
    requested_fields: tuple[RequestedField, ...]
    action_budget: int = DEFAULT_ACTION_BUDGET
    seed: int = 0

    def __post_init__(self) -> None:
        if not isinstance(self.task_id, str) or not self.task_id:
            raise ProtocolViolation("task_id is required")
        handles = tuple(self.document_handles)
        fields = tuple(self.requested_fields)
        object.__setattr__(self, "document_handles", handles)
        object.__setattr__(self, "requested_fields", fields)
        if not (MIN_DOCUMENTS <= len(handles) <= MAX_DOCUMENTS):
            raise ProtocolViolation("task document count is outside the bounded range")
        if any(not isinstance(handle, str) or HANDLE_RE.fullmatch(handle) is None for handle in handles):
            raise ProtocolViolation("task handles must use server-owned handle syntax")
        if len(set(handles)) != len(handles):
            raise ProtocolViolation("task document handles must be unique")
        if any(not isinstance(field, RequestedField) for field in fields):
            raise ProtocolViolation("task requested fields must be typed RequestedField objects")
        if not (MIN_REQUESTED_FIELDS <= len(fields) <= MAX_REQUESTED_FIELDS):
            raise ProtocolViolation("task requested-field count is outside the bounded range")
        if len({field.field_id for field in fields}) != len(fields):
            raise ProtocolViolation("task requested fields must be unique")
        if type(self.action_budget) is not int or not (1 <= self.action_budget <= DEFAULT_ACTION_BUDGET):
            raise ProtocolViolation("task action budget exceeds the bounded cap")
        if type(self.seed) is not int or self.seed < 0:
            raise ProtocolViolation("task seed must be a non-negative integer")

    def request_payload(self) -> dict[str, Any]:
        return {
            "schema": REQUEST_SCHEMA,
            "task_id": self.task_id,
            "document_handles": list(self.document_handles),
            "requested_fields": [
                {
                    "field_id": field.field_id,
                    "value_type": field.value_type,
                    "revision_rule": field.revision_rule,
                }
                for field in self.requested_fields
            ],
            "action_budget": self.action_budget,
        }

    @property
    def request_fingerprint(self) -> str:
        return _json_digest(self.request_payload())


@dataclass(frozen=True)
class EvidenceRecord:
    candidate_id: str
    field_id: str
    value: Any
    value_type: str
    revision: int
    state: str
    published_at: str
    conflict_group: str | None
    document_handle: str
    document_id: str
    section_id: str
    section_kind: str
    source_sha256: str
    fact_digest: str

    def policy_feature(self) -> dict[str, Any]:
        """Return only information legitimately observed by a policy."""

        return {
            "schema": CANDIDATE_SCHEMA,
            "candidate_id": self.candidate_id,
            # The source field identity is legitimate evidence.  It is not a
            # repeated requested/not-requested flag: a policy compares this
            # observed source identity with the initial typed request.
            "field_id": self.field_id,
            "document_handle": self.document_handle,
            "section_id": self.section_id,
            "section_kind": self.section_kind,
            "value_type": self.value_type,
            "value": deepcopy(self.value),
            "revision": self.revision,
            "revision_state": self.state,
            "published_at": self.published_at,
            "conflict_group": self.conflict_group,
            "source_sha256": self.source_sha256,
            "fact_digest": self.fact_digest,
        }


@dataclass(frozen=True)
class VerificationOutcome:
    status: str
    task_success: bool
    source_citation_accuracy: float | None
    false_completion: bool | None
    missing_fact_detection: bool | None
    selected_candidate_ids: tuple[str, ...] = ()
    requested_field_count: int = 0
    details: tuple[tuple[str, Any], ...] = ()

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "schema": "vevo.v03.document-evidence.verification.v1",
            "status": self.status,
            "task_success": self.task_success,
            "source_citation_accuracy": self.source_citation_accuracy,
            "false_completion": self.false_completion,
            "missing_fact_detection": self.missing_fact_detection,
            "selected_candidate_ids": list(self.selected_candidate_ids),
            "requested_field_count": self.requested_field_count,
        }
        for key, value in self.details:
            result[key] = deepcopy(value)
        return result


def _outcome(
    status: str,
    *,
    task_success: bool = False,
    source_citation_accuracy: float | None = None,
    false_completion: bool | None = None,
    missing_fact_detection: bool | None = None,
    selected_candidate_ids: Iterable[str] = (),
    requested_field_count: int = 0,
    **details: Any,
) -> VerificationOutcome:
    return VerificationOutcome(
        status=status,
        task_success=task_success,
        source_citation_accuracy=source_citation_accuracy,
        false_completion=false_completion,
        missing_fact_detection=missing_fact_detection,
        selected_candidate_ids=tuple(sorted(selected_candidate_ids)),
        requested_field_count=requested_field_count,
        details=tuple((key, deepcopy(value)) for key, value in details.items()),
    )


_HIDDEN_OBSERVATION_KEYS = frozenset({
    "fact_id",
    "requested_fields",
    "target",
    "oracle",
    "expected",
    "answer",
    "requested",
    "is_requested",
    "not_requested",
    "request_match",
    "raw_document",
    "source_path",
    "filesystem_path",
})


def assert_observation_no_hidden_fields(observation: Any, requested_field_ids: Iterable[str]) -> None:
    """Fail closed if an observation adds oracle or request-match labels.

    Source ``field_id`` is intentionally allowed: it is the document fact's
    semantic identity and is needed to distinguish two fields with the same
    value type.  Request membership is never emitted as a separate boolean.
    """

    def visit(value: Any, path: str) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if key in _HIDDEN_OBSERVATION_KEYS:
                    raise ProtocolViolation(f"hidden observation key at {path}.{key}")
                visit(item, f"{path}.{key}")
        elif isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, f"{path}[{index}]")
        # Field names and typed values are legitimate observations.  The
        # forbidden vocabulary is enforced structurally by object keys above,
        # not by suppressing a real source field identity.

    visit(observation, "$")


class EvidenceStore:
    """Opaque candidate store retaining raw values and exact provenance."""

    def __init__(self, *, seed: int, requested_field_ids: Iterable[str]):
        self.seed = seed
        self._requested_field_ids = tuple(requested_field_ids)
        self._records: dict[str, EvidenceRecord] = {}
        self._section_candidates: dict[tuple[str, str], tuple[str, ...]] = {}

    @property
    def candidate_ids(self) -> tuple[str, ...]:
        return tuple(self._records)

    def record_section(
        self,
        *,
        handle: str,
        document: Mapping[str, Any],
        section: Mapping[str, Any],
        source_sha256: str,
    ) -> list[EvidenceRecord]:
        section_key = (handle, str(section["section_id"]))
        if section_key in self._section_candidates:
            return [self._records[candidate_id] for candidate_id in self._section_candidates[section_key]]
        created: list[EvidenceRecord] = []
        for position, fact in enumerate(section.get("facts", [])):
            seed_material = f"{self.seed}|{handle}|{section['section_id']}|{fact['fact_id']}|{position}"
            candidate_id = "cand-" + hashlib.sha256(seed_material.encode("utf-8")).hexdigest()[:24]
            fact_digest = _json_digest(fact)
            record = EvidenceRecord(
                candidate_id=candidate_id,
                field_id=str(fact["field_id"]),
                value=deepcopy(fact["value"]),
                value_type=str(fact["value_type"]),
                revision=int(fact["revision"]),
                state=str(fact["state"]),
                published_at=str(fact["published_at"]),
                conflict_group=fact.get("conflict_group"),
                document_handle=handle,
                document_id=str(document["document_id"]),
                section_id=str(section["section_id"]),
                section_kind=str(section["section_kind"]),
                source_sha256=source_sha256,
                fact_digest=fact_digest,
            )
            if candidate_id in self._records and self._records[candidate_id] != record:
                raise ProtocolViolation("candidate id collision")
            self._records[candidate_id] = record
            created.append(record)
        ordered = sorted(
            created,
            key=lambda record: hashlib.sha256(
                f"{self.seed}|{record.candidate_id}".encode("utf-8")
            ).hexdigest(),
        )
        self._section_candidates[section_key] = tuple(record.candidate_id for record in ordered)
        return ordered

    def get(self, candidate_id: str) -> EvidenceRecord:
        if not isinstance(candidate_id, str) or candidate_id not in self._records:
            raise ProtocolViolation(f"unknown observed candidate: {candidate_id!r}")
        return self._records[candidate_id]

    def policy_feature(self, candidate_id: str) -> dict[str, Any]:
        feature = self.get(candidate_id).policy_feature()
        assert_observation_no_hidden_fields(feature, self._requested_field_ids)
        return feature

    def records(self) -> tuple[EvidenceRecord, ...]:
        return tuple(self._records.values())


class EvidencePacketVerifier:
    """Verify values, citations, explicit selections, and revision semantics."""

    def __init__(self, store: DocumentBundleStore, task: DocumentTask, evidence: EvidenceStore):
        self.store = store
        self.task = task
        self.evidence = evidence
        self._requested = {field.field_id: field for field in task.requested_fields}

    def _full_exploration(self, explored_sections: set[tuple[str, str]]) -> bool:
        expected = {
            (entry["document_handle"], entry["section_id"])
            for entry in self.store.section_catalog(self.task.document_handles)
        }
        return expected == explored_sections

    @staticmethod
    def _same_value(left: Any, right: Any) -> bool:
        return _canonical_json(left) == _canonical_json(right)

    def _authoritative_current(self, field_id: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]], bool]:
        """Read all server-owned source facts without returning them to policy."""

        current: list[dict[str, Any]] = []
        for handle in self.task.document_handles:
            document = self.store.open_document(handle)
            source_sha256 = self.store.manifest_entry(handle)["sha256"]
            for section in document["sections"]:
                for fact in section["facts"]:
                    if fact["field_id"] == field_id and fact["state"] == "current":
                        current.append({
                            "field_id": field_id,
                            "value": deepcopy(fact["value"]),
                            "value_type": fact["value_type"],
                            "revision": fact["revision"],
                            "published_at": fact["published_at"],
                            "document_handle": handle,
                            "section_id": section["section_id"],
                            "source_sha256": source_sha256,
                            "fact_digest": _json_digest(fact),
                        })
        if not current:
            return None, [], False
        rank = max((fact["revision"], fact["published_at"]) for fact in current)
        winners = [fact for fact in current if (fact["revision"], fact["published_at"]) == rank]
        conflicting = any(not self._same_value(fact["value"], winners[0]["value"]) for fact in winners[1:])
        winner = sorted(winners, key=lambda fact: (fact["document_handle"], fact["section_id"], fact["fact_digest"]))[0]
        return winner, winners, conflicting

    def _invalid_packet(self, status: str, *, selected: Iterable[str] = ()) -> VerificationOutcome:
        return _outcome(
            status,
            selected_candidate_ids=selected,
            requested_field_count=len(self.task.requested_fields),
        )

    def verify(
        self,
        packet: Any,
        *,
        selected_candidate_ids: set[str],
        explored_sections: set[tuple[str, str]],
    ) -> VerificationOutcome:
        try:
            _assert_json_tree(packet)
        except ProtocolViolation:
            return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
        try:
            self.store.verify_integrity(self.task.document_handles)
        except DocumentIntegrityError:
            return self._invalid_packet("source_changed", selected=selected_candidate_ids)
        if not isinstance(packet, dict) or not set(packet).issubset({"entries", "missing_fields", "conflicts"}):
            return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
        entries = packet.get("entries")
        missing = packet.get("missing_fields")
        conflicts = packet.get("conflicts", [])
        if not isinstance(entries, list) or not isinstance(missing, list) or not isinstance(conflicts, list):
            return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
        if any(not isinstance(field_id, str) for field_id in missing):
            return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
        if len(set(missing)) != len(missing):
            return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
        entry_fields: list[str] = []
        validated_records: dict[str, EvidenceRecord] = {}
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {"field_id", "candidate_id", "value", "value_type", "citation"}:
                return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
            field_id = entry["field_id"]
            candidate_id = entry["candidate_id"]
            if not isinstance(field_id, str) or field_id not in self._requested:
                return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
            if field_id in entry_fields:
                return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
            entry_fields.append(field_id)
            try:
                record = self.evidence.get(candidate_id)
            except ProtocolViolation:
                return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
            if candidate_id not in selected_candidate_ids:
                return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
            if record.field_id != field_id:
                return _outcome(
                    "verification_failed",
                    false_completion=True,
                    selected_candidate_ids=selected_candidate_ids,
                    requested_field_count=len(self.task.requested_fields),
                )
            field = self._requested[field_id]
            if record.value_type != field.value_type or entry["value_type"] != field.value_type:
                return _outcome(
                    "verification_failed",
                    false_completion=True,
                    selected_candidate_ids=selected_candidate_ids,
                    requested_field_count=len(self.task.requested_fields),
                )
            if not self._same_value(entry["value"], record.value):
                return _outcome(
                    "verification_failed",
                    false_completion=True,
                    selected_candidate_ids=selected_candidate_ids,
                    requested_field_count=len(self.task.requested_fields),
                )
            citation = entry["citation"]
            expected_citation = {
                "document_handle": record.document_handle,
                "section_id": record.section_id,
                "source_sha256": record.source_sha256,
                "fact_digest": record.fact_digest,
            }
            if citation != expected_citation:
                return _outcome(
                    "verification_failed",
                    false_completion=True,
                    selected_candidate_ids=selected_candidate_ids,
                    requested_field_count=len(self.task.requested_fields),
                )
            validated_records[field_id] = record
        validated_conflicts: dict[str, tuple[EvidenceRecord, ...]] = {}
        for conflict in conflicts:
            if not isinstance(conflict, dict) or set(conflict) != {
                "field_id", "candidate_ids", "value_type", "values", "citations"
            }:
                return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
            field_id = conflict["field_id"]
            candidate_ids = conflict["candidate_ids"]
            values = conflict["values"]
            citations = conflict["citations"]
            if not isinstance(field_id, str) or field_id not in self._requested:
                return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
            if field_id in validated_conflicts or field_id in entry_fields:
                return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
            if (
                not isinstance(candidate_ids, list)
                or len(candidate_ids) < 2
                or not all(isinstance(candidate_id, str) for candidate_id in candidate_ids)
                or len(set(candidate_ids)) != len(candidate_ids)
                or not isinstance(values, list)
                or len(values) != len(candidate_ids)
                or not isinstance(citations, list)
                or len(citations) != len(candidate_ids)
            ):
                return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
            records: list[EvidenceRecord] = []
            field = self._requested[field_id]
            for candidate_id, value, citation in zip(candidate_ids, values, citations):
                try:
                    record = self.evidence.get(candidate_id)
                except ProtocolViolation:
                    return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
                if candidate_id not in selected_candidate_ids:
                    return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
                if record.field_id != field_id or record.value_type != field.value_type:
                    return _outcome(
                        "verification_failed",
                        false_completion=True,
                        selected_candidate_ids=selected_candidate_ids,
                        requested_field_count=len(self.task.requested_fields),
                    )
                if conflict["value_type"] != field.value_type or not self._same_value(value, record.value):
                    return _outcome(
                        "verification_failed",
                        false_completion=True,
                        selected_candidate_ids=selected_candidate_ids,
                        requested_field_count=len(self.task.requested_fields),
                    )
                expected_citation = {
                    "document_handle": record.document_handle,
                    "section_id": record.section_id,
                    "source_sha256": record.source_sha256,
                    "fact_digest": record.fact_digest,
                }
                if citation != expected_citation:
                    return _outcome(
                        "verification_failed",
                        false_completion=True,
                        selected_candidate_ids=selected_candidate_ids,
                        requested_field_count=len(self.task.requested_fields),
                    )
                records.append(record)
            if len({self._canonical_value_key(record.value) for record in records}) < 2:
                return _outcome(
                    "verification_failed",
                    false_completion=True,
                    selected_candidate_ids=selected_candidate_ids,
                    requested_field_count=len(self.task.requested_fields),
                )
            validated_conflicts[field_id] = tuple(records)
        requested_ids = set(self._requested)
        conflict_fields = set(validated_conflicts)
        if set(entry_fields) | set(missing) | conflict_fields != requested_ids:
            return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
        if (
            set(entry_fields) & set(missing)
            or set(entry_fields) & conflict_fields
            or set(missing) & conflict_fields
        ):
            return self._invalid_packet("incomplete_packet", selected=selected_candidate_ids)
        full_exploration = self._full_exploration(explored_sections)
        for field_id in missing:
            try:
                winner, _, _ = self._authoritative_current(field_id)
            except DocumentIntegrityError:
                return self._invalid_packet("source_changed", selected=selected_candidate_ids)
            if not full_exploration:
                return _outcome(
                    "inconclusive_insufficient_exploration",
                    selected_candidate_ids=selected_candidate_ids,
                    requested_field_count=len(self.task.requested_fields),
                    missing_fields=list(missing),
                )
            if winner is not None:
                return _outcome(
                    "verification_failed",
                    false_completion=True,
                    selected_candidate_ids=selected_candidate_ids,
                    requested_field_count=len(self.task.requested_fields),
                )
        for field_id, record in validated_records.items():
            try:
                winner, winners, conflicting = self._authoritative_current(field_id)
            except DocumentIntegrityError:
                return self._invalid_packet("source_changed", selected=selected_candidate_ids)
            if conflicting:
                return _outcome(
                    "verification_failed",
                    false_completion=True,
                    selected_candidate_ids=selected_candidate_ids,
                    requested_field_count=len(self.task.requested_fields),
                )
            if winner is None:
                return _outcome(
                    "verification_failed",
                    false_completion=True,
                    selected_candidate_ids=selected_candidate_ids,
                    requested_field_count=len(self.task.requested_fields),
                )
            if not any(
                record.source_sha256 == candidate["source_sha256"]
                and record.fact_digest == candidate["fact_digest"]
                for candidate in winners
            ):
                return _outcome(
                    "verification_failed",
                    false_completion=True,
                    selected_candidate_ids=selected_candidate_ids,
                    requested_field_count=len(self.task.requested_fields),
                )
        verified_conflicts: list[dict[str, Any]] = []
        for field_id, records in validated_conflicts.items():
            try:
                winner, winners, conflicting = self._authoritative_current(field_id)
            except DocumentIntegrityError:
                return self._invalid_packet("source_changed", selected=selected_candidate_ids)
            if winner is None or not conflicting:
                return _outcome(
                    "verification_failed",
                    false_completion=True,
                    selected_candidate_ids=selected_candidate_ids,
                    requested_field_count=len(self.task.requested_fields),
                )
            observed_refs = {(record.source_sha256, record.fact_digest) for record in records}
            authoritative_refs = {(fact["source_sha256"], fact["fact_digest"]) for fact in winners}
            if observed_refs != authoritative_refs:
                return _outcome(
                    "verification_failed",
                    false_completion=True,
                    selected_candidate_ids=selected_candidate_ids,
                    requested_field_count=len(self.task.requested_fields),
                )
            verified_conflicts.append({
                "field_id": field_id,
                "candidate_ids": [record.candidate_id for record in records],
                "citations": [
                    {
                        "document_handle": record.document_handle,
                        "section_id": record.section_id,
                        "source_sha256": record.source_sha256,
                        "fact_digest": record.fact_digest,
                    }
                    for record in records
                ],
            })
        missing_verified = bool(missing)
        if verified_conflicts:
            return _outcome(
                "verified_conflict",
                task_success=True,
                source_citation_accuracy=1.0,
                false_completion=False,
                missing_fact_detection=missing_verified,
                selected_candidate_ids=selected_candidate_ids,
                requested_field_count=len(self.task.requested_fields),
                verified_conflicts=verified_conflicts,
                missing_fields=list(missing),
                full_exploration=full_exploration,
            )
        return _outcome(
            "verified_missing_facts" if missing_verified else "verified_complete",
            task_success=True,
            source_citation_accuracy=1.0 if entries else None,
            false_completion=False,
            missing_fact_detection=missing_verified,
            selected_candidate_ids=selected_candidate_ids,
            requested_field_count=len(self.task.requested_fields),
            missing_fields=list(missing),
            full_exploration=full_exploration,
        )

    @staticmethod
    def _canonical_value_key(value: Any) -> str:
        return _canonical_json(value)


def _response(status: str, *, action_count: int, action_budget: int, terminal: bool, **payload: Any) -> dict[str, Any]:
    response = {
        "schema": RESPONSE_SCHEMA,
        "phase": "tool_response",
        "status": status,
        "action_count": action_count,
        "action_budget": action_budget,
        "remaining_action_budget": max(0, action_budget - action_count),
        "terminal": terminal,
    }
    response.update(deepcopy(payload))
    _assert_json_tree(response)
    return response


class DocumentEvidenceSession:
    """A deterministic, restartable action session over one document task."""

    def __init__(self, store: DocumentBundleStore, task: DocumentTask, *, seed: int | None = None):
        if not isinstance(store, DocumentBundleStore):
            raise ProtocolViolation("session requires the server-owned bundle store")
        for handle in task.document_handles:
            store._entry(handle)
        chosen_seed = task.seed if seed is None else seed
        if type(chosen_seed) is not int or chosen_seed < 0:
            raise ProtocolViolation("session seed must be a non-negative integer")
        self.store = store
        self.task = task
        self.seed = chosen_seed
        self.evidence = EvidenceStore(seed=chosen_seed, requested_field_ids=(field.field_id for field in task.requested_fields))
        self.action_count = 0
        self.action_log: list[dict[str, Any]] = []
        self._action_identities: set[str] = set()
        self._explored_sections: set[tuple[str, str]] = set()
        self._selected_candidate_ids: set[str] = set()
        self._started = False
        self.terminal = False
        self.result: VerificationOutcome | None = None
        self._catalog = self.store.section_catalog(self.task.document_handles)
        self._pinned_source_hashes = {
            handle: self.store.manifest_entry(handle)["sha256"]
            for handle in self.task.document_handles
        }
        self._budget_exhaustion_logged = False
        self._catalog_keys = {(item["document_handle"], item["section_id"]) for item in self._catalog}
        self._verifier = EvidencePacketVerifier(self.store, self.task, self.evidence)

    @property
    def explored_sections(self) -> frozenset[tuple[str, str]]:
        return frozenset(self._explored_sections)

    @property
    def selected_candidate_ids(self) -> frozenset[str]:
        return frozenset(self._selected_candidate_ids)

    def start(self) -> dict[str, Any]:
        if self._started:
            raise ProtocolViolation("session already started")
        self.store.verify_integrity(self.task.document_handles)
        self._started = True
        request = {
            "schema": REQUEST_SCHEMA,
            "phase": "request",
            "task_id": self.task.task_id,
            "requested_fields": [
                {
                    "field_id": field.field_id,
                    "value_type": field.value_type,
                    "revision_rule": field.revision_rule,
                }
                for field in self.task.requested_fields
            ],
            "document_catalog": [
                {
                    "document_handle": handle,
                    "sections": [
                        {
                            "section_id": item["section_id"],
                            "section_kind": item["section_kind"],
                            "position": item["position"],
                        }
                        for item in self._catalog
                        if item["document_handle"] == handle
                    ],
                }
                for handle in self.task.document_handles
            ],
            "action_budget": self.task.action_budget,
            "remaining_action_budget": self.task.action_budget,
        }
        _assert_json_tree(request)
        return request

    def _base(self, status: str, *, terminal: bool, **payload: Any) -> dict[str, Any]:
        return _response(
            status,
            action_count=self.action_count,
            action_budget=self.task.action_budget,
            terminal=terminal,
            **payload,
        )

    def _record_invalid(self, error: str) -> dict[str, Any]:
        self.action_log.append({"kind": "invalid", "error": error})
        return self._base("invalid_action", terminal=False, error=error)

    def _apply_budget_exhaustion_event(self) -> dict[str, Any]:
        self._budget_exhaustion_logged = True
        self.terminal = True
        outcome = _outcome("budget_exhausted", selected_candidate_ids=self._selected_candidate_ids)
        self.result = outcome
        return self._base("budget_exhausted", terminal=True, outcome=outcome.as_dict())

    def _action_identity(self, action: Mapping[str, Any]) -> str:
        return _canonical_json(action)

    def _inspect(self, action: Mapping[str, Any]) -> dict[str, Any]:
        if set(action) != {"kind", "document_handle", "section_id"}:
            return self._base("invalid_action", terminal=False, error="inspect_section shape")
        handle = action["document_handle"]
        section_id = action["section_id"]
        if not isinstance(handle, str) or not isinstance(section_id, str):
            return self._base("invalid_action", terminal=False, error="inspect_section identifiers")
        key = (handle, section_id)
        if key not in self._catalog_keys:
            return self._base("invalid_action", terminal=False, error="unknown document section")
        identity = self._action_identity(action)
        if identity in self._action_identities:
            return self._base("duplicate_action", terminal=False, document_handle=handle, section_id=section_id)
        self._action_identities.add(identity)
        try:
            document, section, source_sha256 = self.store.read_section(handle, section_id)
        except DocumentIntegrityError:
            outcome = _outcome("source_changed", selected_candidate_ids=self._selected_candidate_ids)
            self.result = outcome
            self.terminal = True
            return self._base("source_changed", terminal=True, outcome=outcome.as_dict())
        records = self.evidence.record_section(
            handle=handle,
            document=document,
            section=section,
            source_sha256=source_sha256,
        )
        self._explored_sections.add(key)
        candidates = [record.policy_feature() for record in records]
        for feature in candidates:
            assert_observation_no_hidden_fields(feature, (field.field_id for field in self.task.requested_fields))
        return self._base(
            "section_observed",
            terminal=False,
            document_handle=handle,
            section_id=section_id,
            section_kind=section["section_kind"],
            candidates=candidates,
        )

    def _select(self, action: Mapping[str, Any]) -> dict[str, Any]:
        if set(action) != {"kind", "candidate_id"}:
            return self._base("invalid_action", terminal=False, error="select_candidate shape")
        candidate_id = action["candidate_id"]
        identity = self._action_identity(action)
        if identity in self._action_identities:
            return self._base("duplicate_action", terminal=False, candidate_id=candidate_id)
        self._action_identities.add(identity)
        try:
            feature = self.evidence.policy_feature(candidate_id)
        except ProtocolViolation:
            return self._base("invalid_candidate", terminal=False, candidate_id=candidate_id)
        if candidate_id in self._selected_candidate_ids:
            return self._base("duplicate_selection", terminal=False, candidate_id=candidate_id)
        self._selected_candidate_ids.add(candidate_id)
        return self._base("candidate_selected", terminal=False, candidate=feature)

    def _verify_action(self, action: Mapping[str, Any], *, mode: str | None = None) -> dict[str, Any]:
        expected = {"kind", "packet"} | ({"field_id"} if mode in {"missing", "conflict"} else set())
        if set(action) != expected:
            return self._base("invalid_action", terminal=False, error="completion action shape")
        if mode in {"missing", "conflict"}:
            field_id = action.get("field_id")
            if not isinstance(field_id, str) or field_id not in {field.field_id for field in self.task.requested_fields}:
                return self._base("invalid_action", terminal=False, error="unknown missing field")
            packet = action.get("packet")
            if not isinstance(packet, dict):
                return self._base("incomplete_packet", terminal=False, error="completion packet is not an object")
            missing_fields = packet.get("missing_fields", [])
            if mode == "missing" and (
                not isinstance(missing_fields, list) or field_id not in missing_fields
            ):
                return self._base("incomplete_packet", terminal=False, error="reported field is not missing")
            if mode == "conflict" and field_id not in {
                conflict.get("field_id")
                for conflict in packet.get("conflicts", [])
                if isinstance(conflict, dict)
            }:
                return self._base("incomplete_packet", terminal=False, error="reported field is not conflicted")
        else:
            packet = action.get("packet")
        outcome = self._verifier.verify(
            packet,
            selected_candidate_ids=self._selected_candidate_ids,
            explored_sections=self._explored_sections,
        )
        self.result = outcome
        terminal = outcome.status in {
            "verified_complete",
            "verified_missing_facts",
            "verified_conflict",
            "verification_failed",
            "source_changed",
        }
        self.terminal = terminal
        return self._base(outcome.status, terminal=terminal, outcome=outcome.as_dict())

    def dispatch(self, action: Any) -> dict[str, Any]:
        if not self._started:
            raise ProtocolViolation("call start() before dispatch")
        if self.terminal:
            return self._base("already_terminal", terminal=True)
        if self.action_count >= self.task.action_budget:
            if not self._budget_exhaustion_logged:
                self.action_log.append({"kind": "__budget_exhausted__"})
            return self._apply_budget_exhaustion_event()
        self.action_count += 1
        if not isinstance(action, dict):
            return self._record_invalid("action must be an object")
        try:
            _assert_json_tree(action)
            if not isinstance(action.get("kind"), str):
                raise ProtocolViolation("action kind is required")
            self.action_log.append(deepcopy(action))
        except (ProtocolViolation, ValueError) as exc:
            return self._record_invalid(str(exc))
        kind = action["kind"]
        if kind == "inspect_section":
            return self._inspect(action)
        if kind == "select_candidate":
            return self._select(action)
        if kind == "finish":
            return self._verify_action(action)
        if kind == "report_missing":
            return self._verify_action(action, mode="missing")
        if kind == "report_conflict":
            return self._verify_action(action, mode="conflict")
        return self._base("invalid_action", terminal=False, error=f"unknown action kind: {kind}")

    def snapshot(self) -> dict[str, Any]:
        snapshot = {
            "schema": SNAPSHOT_SCHEMA,
            "task_id": self.task.task_id,
            "request_fingerprint": self.task.request_fingerprint,
            "document_scope": list(self.task.document_handles),
            "bundle_id": self.store.bundle_id,
            "pinned_source_hashes": deepcopy(self._pinned_source_hashes),
            "seed": self.seed,
            "action_count": self.action_count,
            "action_budget": self.task.action_budget,
            "action_log": deepcopy(self.action_log),
            "explored_sections": [list(key) for key in sorted(self._explored_sections)],
            "observed_candidate_ids": list(self.evidence.candidate_ids),
            "selected_candidate_ids": sorted(self._selected_candidate_ids),
            "budget_exhausted": self._budget_exhaustion_logged,
            "terminal": self.terminal,
            "result": None if self.result is None else self.result.as_dict(),
        }
        _assert_json_tree(snapshot)
        return snapshot

    @classmethod
    def restore(cls, store: DocumentBundleStore, task: DocumentTask, snapshot: Any) -> "DocumentEvidenceSession":
        _assert_json_tree(snapshot)
        if not isinstance(snapshot, dict) or snapshot.get("schema") != SNAPSHOT_SCHEMA:
            raise ProtocolViolation("unsupported session snapshot")
        if (
            snapshot.get("task_id") != task.task_id
            or snapshot.get("request_fingerprint") != task.request_fingerprint
            or snapshot.get("document_scope") != list(task.document_handles)
            or snapshot.get("action_budget") != task.action_budget
        ):
            raise ProtocolViolation("snapshot task mismatch")
        if snapshot.get("seed") != task.seed:
            raise ProtocolViolation("snapshot seed mismatch")
        if snapshot.get("bundle_id") != store.bundle_id:
            raise ProtocolViolation("snapshot bundle mismatch")
        expected_hashes = {
            handle: store.manifest_entry(handle)["sha256"]
            for handle in task.document_handles
        }
        if snapshot.get("pinned_source_hashes") != expected_hashes:
            raise ProtocolViolation("snapshot source pin mismatch")
        store.verify_integrity(task.document_handles)
        session = cls(store, task, seed=task.seed)
        session.start()
        action_log = snapshot.get("action_log")
        if not isinstance(action_log, list):
            raise ProtocolViolation("snapshot action_log must be a list")
        for action in action_log:
            if not isinstance(action, dict):
                raise ProtocolViolation("snapshot action log entry must be an object")
            if action.get("kind") == "__budget_exhausted__":
                if session.action_count < task.action_budget:
                    raise ProtocolViolation("budget event appeared before action budget was consumed")
                session.action_log.append(deepcopy(action))
                session._apply_budget_exhaustion_event()
            else:
                session.dispatch(action)
        if session.action_count != snapshot.get("action_count"):
            raise ProtocolViolation("snapshot action count mismatch")
        if session._budget_exhaustion_logged != snapshot.get("budget_exhausted"):
            raise ProtocolViolation("snapshot budget transition mismatch")
        if session.snapshot() != snapshot:
            raise ProtocolViolation("snapshot replay mismatch")
        return session


class ObservationLimitedExpert:
    """A deterministic policy that sees responses only, never the store."""

    PREFERRED_KINDS = {
        "number": "commercial",
        "percentage": "commercial",
        "ratio": "commercial",
        "person": "contacts",
        "email": "contacts",
        "phone": "contacts",
        "date": "terms",
        "duration": "terms",
        "enum": "overview",
    }

    def run(self, session: DocumentEvidenceSession) -> dict[str, Any]:
        return _run_policy(session, self, read_all=False)


class ReadAllBaseline:
    """A deterministic comparator that inspects every bounded section."""

    def run(self, session: DocumentEvidenceSession) -> dict[str, Any]:
        return _run_policy(session, self, read_all=True)


def _packet_from_candidates(requested: list[dict[str, Any]], candidates: list[dict[str, Any]]) -> tuple[dict[str, Any], list[str]]:
    """Build a packet using exact source identity and current facts only."""

    by_field: dict[str, list[dict[str, Any]]] = {}
    for candidate in candidates:
        by_field.setdefault(candidate["field_id"], []).append(candidate)
    selected: list[str] = []
    entries: list[dict[str, Any]] = []
    missing: list[str] = []
    conflicts: list[dict[str, Any]] = []
    for field in requested:
        options = [
            candidate
            for candidate in by_field.get(field["field_id"], [])
            if candidate["value_type"] == field["value_type"]
            and candidate["revision_state"] == "current"
        ]
        if not options:
            missing.append(field["field_id"])
            continue
        rank = max((int(candidate["revision"]), candidate["published_at"]) for candidate in options)
        winners = sorted(
            [candidate for candidate in options if (int(candidate["revision"]), candidate["published_at"]) == rank],
            key=lambda candidate: candidate["candidate_id"],
        )
        if len({_canonical_json(candidate["value"]) for candidate in winners}) > 1:
            selected.extend(candidate["candidate_id"] for candidate in winners)
            conflicts.append({
                "field_id": field["field_id"],
                "candidate_ids": [candidate["candidate_id"] for candidate in winners],
                "value_type": field["value_type"],
                "values": [deepcopy(candidate["value"]) for candidate in winners],
                "citations": [
                    {
                        "document_handle": candidate["document_handle"],
                        "section_id": candidate["section_id"],
                        "source_sha256": candidate["source_sha256"],
                        "fact_digest": candidate["fact_digest"],
                    }
                    for candidate in winners
                ],
            })
            continue
        chosen = winners[0]
        selected.append(chosen["candidate_id"])
        entries.append({
            "field_id": field["field_id"],
            "candidate_id": chosen["candidate_id"],
            "value": deepcopy(chosen["value"]),
            "value_type": chosen["value_type"],
            "citation": {
                "document_handle": chosen["document_handle"],
                "section_id": chosen["section_id"],
                "source_sha256": chosen["source_sha256"],
                "fact_digest": chosen["fact_digest"],
            },
        })
    return {"entries": entries, "missing_fields": missing, "conflicts": conflicts}, selected


def _run_policy(session: DocumentEvidenceSession, policy: Any, *, read_all: bool) -> dict[str, Any]:
    initial = session.start()
    requested = initial["requested_fields"]
    catalog = initial["document_catalog"]
    all_sections = [
        (document["document_handle"], section["section_id"], section["section_kind"])
        for document in catalog
        for section in document["sections"]
    ]
    if read_all:
        inspection_queue = [(handle, section_id) for handle, section_id, _ in all_sections]
    else:
        needed_kinds = {ObservationLimitedExpert.PREFERRED_KINDS.get(field["value_type"]) for field in requested}
        preferred = [
            (handle, section_id)
            for handle, section_id, kind in all_sections
            if kind in needed_kinds
        ]
        remainder = [
            (handle, section_id)
            for handle, section_id, kind in all_sections
            if kind not in needed_kinds
        ]
        # The expert is still observation-limited: it only chooses the order
        # from the request/catalog and then inspects the complete bounded
        # scope before making a semantic completion claim.  This protects
        # unusual section placement without reading the store privately.
        inspection_queue = preferred + remainder
    transcripts = [initial]
    candidates: list[dict[str, Any]] = []
    explored: set[tuple[str, str]] = set()
    selected: set[str] = set()
    queue = list(inspection_queue)
    full_queue_added = True
    while True:
        if queue:
            handle, section_id = queue.pop(0)
            response = session.dispatch({"kind": "inspect_section", "document_handle": handle, "section_id": section_id})
            transcripts.append(response)
            if response.get("status") == "section_observed":
                explored.add((handle, section_id))
                candidates.extend(response.get("candidates", []))
            if response.get("terminal"):
                break
            continue
        packet, selected_ids = _packet_from_candidates(requested, candidates)
        for candidate_id in selected_ids:
            if candidate_id not in selected:
                response = session.dispatch({"kind": "select_candidate", "candidate_id": candidate_id})
                transcripts.append(response)
                if response.get("status") == "candidate_selected":
                    selected.add(candidate_id)
                if response.get("terminal"):
                    return {"initial": initial, "transcript": transcripts, "outcome": response.get("outcome")}
        if packet["conflicts"]:
            response = session.dispatch({
                "kind": "report_conflict",
                "field_id": packet["conflicts"][0]["field_id"],
                "packet": packet,
            })
        elif packet["missing_fields"]:
            response = session.dispatch({
                "kind": "report_missing",
                "field_id": packet["missing_fields"][0],
                "packet": packet,
            })
        else:
            response = session.dispatch({"kind": "finish", "packet": packet})
        transcripts.append(response)
        break
    return {
        "initial": initial,
        "transcript": transcripts,
        "outcome": session.result.as_dict() if session.result is not None else None,
    }


def run_observation_limited_policy(session: DocumentEvidenceSession, policy: Any | None = None) -> dict[str, Any]:
    """Run the deterministic expert against responses, not private bundle state."""

    chosen = ObservationLimitedExpert() if policy is None else policy
    if not isinstance(chosen, ObservationLimitedExpert):
        raise ProtocolViolation("observation-limited runner requires ObservationLimitedExpert")
    return chosen.run(session)


def run_read_all_baseline(session: DocumentEvidenceSession) -> dict[str, Any]:
    return ReadAllBaseline().run(session)


def make_task(
    task_id: str,
    document_handles: Sequence[str],
    requested_fields: Sequence[tuple[str, str]],
    *,
    action_budget: int = DEFAULT_ACTION_BUDGET,
    seed: int = 0,
) -> DocumentTask:
    return DocumentTask(
        task_id=task_id,
        document_handles=tuple(document_handles),
        requested_fields=tuple(RequestedField(field_id, value_type) for field_id, value_type in requested_fields),
        action_budget=action_budget,
        seed=seed,
    )


__all__ = [
    "CANDIDATE_SCHEMA",
    "DEFAULT_ACTION_BUDGET",
    "DOCUMENT_ACTIONS",
    "DocumentBundleStore",
    "DocumentEvidenceError",
    "DocumentEvidenceSession",
    "DocumentIntegrityError",
    "DocumentTask",
    "EvidencePacketVerifier",
    "EvidenceRecord",
    "ForbiddenDocumentHandle",
    "ObservationLimitedExpert",
    "ProtocolViolation",
    "ReadAllBaseline",
    "RequestedField",
    "VerificationOutcome",
    "assert_observation_no_hidden_fields",
    "make_task",
    "run_observation_limited_policy",
    "run_read_all_baseline",
]
