"""Typed, untrained neural interface for the v0.3 document protocol.

This module deliberately keeps the new document weights out of the usable
decision-service boundary.  It does, however, implement the reviewed typed
encoder, a variable candidate scorer, and an untrained five-brain forward path
using the same four-peripheral/one-central recurrent and addressable-memory
mechanisms as the existing proof model.  Forward and gradient calls are
structural tests only; :meth:`DocumentPolicyInterface.select_action` remains
closed until a separately trained and reviewed checkpoint exists.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import date
import hashlib
import itertools
import json
import math
from typing import Any, Mapping, Sequence

import numpy as np

from .autograd import Tensor, concatenate, log, sigmoid, softmax, tanh
from .v03_document_evidence import (
    CANDIDATE_SCHEMA,
    DATE_RE,
    DOCUMENT_ACTIONS,
    MAX_DISPOSITION_CANDIDATES,
    MAX_FIELD_ID_UTF8_BYTES,
    MAX_REQUESTED_FIELDS,
    MAX_VALUE_UTF8_BYTES,
    REQUEST_SCHEMA,
    ProtocolViolation,
    assert_observation_no_hidden_fields,
)


DOCUMENT_POLICY_BACKEND = "v03-five-brain-addressable-memory-interface"
DOCUMENT_MEMORY_SHAPE = (2, 6)
DOCUMENT_PERIPHERAL_COUNT = 4
DOCUMENT_CENTRAL_COUNT = 1
DOCUMENT_TOTAL_BRAINS = DOCUMENT_PERIPHERAL_COUNT + DOCUMENT_CENTRAL_COUNT
DOCUMENT_PERIPHERAL_HIDDEN = 8
DOCUMENT_CENTRAL_HIDDEN = 12
FIELD_ID_BYTES = MAX_FIELD_ID_UTF8_BYTES
VALUE_BYTES = MAX_VALUE_UTF8_BYTES
VALUE_TYPE_VOCABULARY = (
    "date", "email", "enum", "number", "percentage", "person", "phone", "duration", "ratio"
)
SECTION_KIND_VOCABULARY = ("overview", "commercial", "contacts", "terms")
FIXED_ACTIONS = ("inspect_section", "finish", "report_missing", "report_conflict")
DISPOSITION_KINDS = ("source", "missing", "conflict")
# Exact inspect targets need a small identity-bearing action row.  The first
# coordinate is a bias; the remaining coordinates are stable episode-local
# document/section relations and a normalized section ordinal.
INSPECT_ACTION_FEATURE_DIM = 4
RESPONSE_STATUS_VOCABULARY = (
    "request",
    "section_observed",
    "candidate_selected",
    "invalid_action",
    "duplicate_action",
    "incomplete_packet",
    "inconclusive_insufficient_exploration",
    "already_terminal",
)

# Rows are lossless within the protocol-admitted UTF-8 widths.  The remaining
# fields are typed numeric/category features; there is no candidate position.
DOCUMENT_REQUEST_FEATURE_DIM = FIELD_ID_BYTES + len(VALUE_TYPE_VOCABULARY) + 1
DOCUMENT_CANDIDATE_FEATURE_DIM = (
    FIELD_ID_BYTES
    + VALUE_BYTES
    + len(VALUE_TYPE_VOCABULARY)
    + len(SECTION_KIND_VOCABULARY)
    + 3  # revision, current/obsolete, conflict-group presence
    + 4  # ordered publication date
    + 2  # ordered typed numeric/date values
    + 2  # stable episode-local document and section indices
)
DOCUMENT_MODEL_INPUT_DIM = (
    MAX_REQUESTED_FIELDS * DOCUMENT_REQUEST_FEATURE_DIM
    + 2 * DOCUMENT_CANDIDATE_FEATURE_DIM
    + len(RESPONSE_STATUS_VOCABULARY)
    + 2  # candidate count and remaining budget
)
DOCUMENT_MODEL_SCHEMA = "vevo.v03.document-evidence.neural-model.v1"
DOCUMENT_MODEL_VERSION = "vevo.v03.document-evidence.typed-action-bilinear.v2"
DOCUMENT_FORWARD_SCHEMA = "vevo.v03.document-evidence.neural-forward.v1"
DOCUMENT_RUNTIME_SNAPSHOT_SCHEMA = "vevo.v03.document-evidence.neural-runtime.v1"
DOCUMENT_ENCODER_ID = "vevo.v03.document-evidence.encoder.lossless-identity.v2"
DOCUMENT_CHECKPOINT_ID = "untrained-random-document-policy"


class DocumentNeuralPolicyUnavailable(RuntimeError):
    """Raised when a caller asks the untrained document model to decide."""


@dataclass(frozen=True)
class DocumentPolicyModelStatus:
    available: bool = False
    reason: str = "new document weights are untrained and not exposed as a decision service"
    checkpoint: str | None = DOCUMENT_CHECKPOINT_ID

    def as_dict(self) -> dict[str, Any]:
        return {"available": self.available, "reason": self.reason, "checkpoint": self.checkpoint}


@dataclass(frozen=True)
class DocumentEpisodeIdentity:
    """Stable episode-local identity relations derived from the catalog."""

    episode_id: str
    document_handles: tuple[str, ...]
    section_keys: tuple[tuple[str, str], ...]

    def __post_init__(self) -> None:
        if not isinstance(self.episode_id, str) or not self.episode_id:
            raise ProtocolViolation("episode identity requires an episode id")
        if len(set(self.document_handles)) != len(self.document_handles):
            raise ProtocolViolation("episode document identities must be unique")
        if any(not isinstance(handle, str) or not handle for handle in self.document_handles):
            raise ProtocolViolation("episode document identities must be strings")
        if len(set(self.section_keys)) != len(self.section_keys):
            raise ProtocolViolation("episode section identities must be unique")
        if any(
            not isinstance(handle, str)
            or not isinstance(section_id, str)
            or not handle
            or not section_id
            or handle not in self.document_handles
            for handle, section_id in self.section_keys
        ):
            raise ProtocolViolation("episode section identity is invalid")

    @classmethod
    def from_request(cls, request: Mapping[str, Any], *, episode_id: str | None = None) -> "DocumentEpisodeIdentity":
        if not isinstance(request, Mapping) or request.get("schema") != REQUEST_SCHEMA:
            raise ProtocolViolation("document episode identity requires the typed initial request")
        catalog = request.get("document_catalog")
        if not isinstance(catalog, list) or not catalog:
            raise ProtocolViolation("initial request catalog is required for episode identity")
        handles: list[str] = []
        sections: list[tuple[str, str]] = []
        for document in catalog:
            if not isinstance(document, Mapping):
                raise ProtocolViolation("initial request catalog document is invalid")
            handle = document.get("document_handle")
            if not isinstance(handle, str) or not handle or handle in handles:
                raise ProtocolViolation("initial request catalog handle is invalid")
            handles.append(handle)
            listed_sections = document.get("sections")
            if not isinstance(listed_sections, list):
                raise ProtocolViolation("initial request catalog sections are invalid")
            seen_positions: set[int] = set()
            for section in listed_sections:
                if not isinstance(section, Mapping):
                    raise ProtocolViolation("initial request catalog section is invalid")
                section_id = section.get("section_id")
                position = section.get("position")
                if not isinstance(section_id, str) or not section_id or type(position) is not int:
                    raise ProtocolViolation("initial request catalog section identity is invalid")
                if position in seen_positions or (handle, section_id) in sections:
                    raise ProtocolViolation("initial request catalog section identity is duplicated")
                seen_positions.add(position)
                sections.append((handle, section_id))
        return cls(
            episode_id=episode_id or str(request.get("task_id") or "episode"),
            document_handles=tuple(handles),
            section_keys=tuple(sections),
        )

    @classmethod
    def from_candidates(
        cls,
        candidates: Sequence[Mapping[str, Any]],
        *,
        episode_id: str = "standalone-observation",
    ) -> "DocumentEpisodeIdentity":
        if not candidates:
            return cls(episode_id=episode_id, document_handles=(), section_keys=())
        handles = sorted({str(candidate.get("document_handle")) for candidate in candidates})
        sections = sorted({
            (str(candidate.get("document_handle")), str(candidate.get("section_id")))
            for candidate in candidates
        })
        if not handles or any(handle in {"None", ""} for handle in handles) or any(
            handle == "None" or section_id == "None" for handle, section_id in sections
        ):
            raise ProtocolViolation("standalone candidate identity is incomplete")
        return cls(episode_id=episode_id, document_handles=tuple(handles), section_keys=tuple(sections))

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "DocumentEpisodeIdentity":
        if not isinstance(payload, Mapping) or payload.get("schema") != "vevo.v03.document-evidence.episode-identity.v1":
            raise ProtocolViolation("unsupported episode identity snapshot")
        episode_id = payload.get("episode_id")
        document_handles = payload.get("document_handles")
        sections = payload.get("sections")
        if not isinstance(episode_id, str) or not episode_id or not isinstance(document_handles, list) or not isinstance(sections, list):
            raise ProtocolViolation("episode identity sections are required")
        section_keys: list[tuple[str, str]] = []
        for section in sections:
            if not isinstance(section, Mapping):
                raise ProtocolViolation("episode identity section is invalid")
            handle = section.get("document_handle")
            section_id = section.get("section_id")
            if not isinstance(handle, str) or not isinstance(section_id, str):
                raise ProtocolViolation("episode identity section fields are invalid")
            section_keys.append((handle, section_id))
        if not all(isinstance(handle, str) for handle in document_handles):
            raise ProtocolViolation("episode identity document handles are invalid")
        return cls(
            episode_id=episode_id,
            document_handles=tuple(document_handles),
            section_keys=tuple(section_keys),
        )

    def document_index(self, handle: str) -> int:
        try:
            return self.document_handles.index(handle)
        except ValueError as exc:
            raise ProtocolViolation("candidate document is outside the episode catalog") from exc

    def section_index(self, handle: str, section_id: str) -> int:
        try:
            return self.section_keys.index((handle, section_id))
        except ValueError as exc:
            raise ProtocolViolation("candidate section is outside the episode catalog") from exc

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": "vevo.v03.document-evidence.episode-identity.v1",
            "episode_id": self.episode_id,
            "document_handles": list(self.document_handles),
            "sections": [
                {"document_handle": handle, "section_id": section_id, "section_index": index}
                for index, (handle, section_id) in enumerate(self.section_keys)
            ],
            "relations": {
                "document_handle_scope": "initial_request_catalog",
                "section_scope": "initial_request_catalog",
                "candidate_id_scope": "one_episode_only",
                "cross_episode_identity_joins": False,
            },
        }


def _coerce_identity(
    identity: DocumentEpisodeIdentity | Mapping[str, Any] | None,
    candidates: Sequence[Mapping[str, Any]],
) -> DocumentEpisodeIdentity:
    if identity is None:
        return DocumentEpisodeIdentity.from_candidates(candidates)
    if isinstance(identity, DocumentEpisodeIdentity):
        return identity
    return DocumentEpisodeIdentity.from_dict(identity)


def _assert_finite_json(value: Any, *, path: str = "$") -> None:
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ProtocolViolation(f"non-finite neural state at {path}")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _assert_finite_json(item, path=f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ProtocolViolation(f"non-string neural state key at {path}")
            _assert_finite_json(item, path=f"{path}.{key}")
        return
    raise ProtocolViolation(f"unsupported neural state value at {path}")


def _canonical_action(value: Any) -> str:
    """Return the stable identity used for typed policy-action targets."""

    _assert_finite_json(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _action_base(option: Mapping[str, Any]) -> dict[str, Any]:
    """Strip model metadata while retaining the complete dispatch payload."""

    return {
        key: deepcopy(value)
        for key, value in option.items()
        if key not in {"action_id", "score"}
    }


def _bounded_utf8(value: Any, width: int, *, name: str = "semantic text") -> list[float]:
    if not isinstance(value, str):
        raise ProtocolViolation(f"{name} must be a string")
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ProtocolViolation(f"{name} is not valid UTF-8") from exc
    if len(encoded) > width:
        raise ProtocolViolation(f"{name} exceeds the lossless width of {width} UTF-8 bytes")
    result = np.zeros(width, dtype=np.float64)
    if encoded:
        result[:len(encoded)] = np.frombuffer(encoded, dtype=np.uint8).astype(np.float64) / 255.0
    return result.tolist()


def _one_hot(value: str, vocabulary: Sequence[str]) -> list[float]:
    return [float(value == item) for item in vocabulary]


def _ordered_date_features(value: Any) -> list[float]:
    if not isinstance(value, str) or DATE_RE.fullmatch(value) is None:
        raise ProtocolViolation("publication date must be an ISO-8601 calendar date")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ProtocolViolation("publication date must be an ISO-8601 calendar date") from exc
    epoch = date(1970, 1, 1).toordinal()
    return [
        float((parsed.toordinal() - epoch) / 36525.0),
        float(parsed.year / 10000.0),
        float(parsed.month / 12.0),
        float(parsed.day / 31.0),
    ]


def _typed_value_features(value: Any, value_type: str) -> tuple[list[float], list[float]]:
    value_bytes = _bounded_utf8(value if isinstance(value, str) else str(value), VALUE_BYTES, name="candidate value")
    numeric = [0.0, 0.0]
    if value_type == "date":
        numeric = _ordered_date_features(value)[:2]
    elif value_type in {"number", "ratio", "percentage"}:
        if isinstance(value, bool):
            raise ProtocolViolation("numeric candidate value must not be boolean")
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise ProtocolViolation("numeric candidate value is not finite") from exc
        if not math.isfinite(number):
            raise ProtocolViolation("numeric candidate value is not finite")
        bounded = float(np.clip(number, -1_000_000.0, 1_000_000.0))
        # Keep the second coordinate ordered while remaining in a bounded
        # neural range; the raw numeric value is still present losslessly in
        # the verifier, not smuggled into the model as an unbounded scalar.
        numeric = [float(np.tanh(bounded / 1_000_000.0)), float(bounded / 1_000_000.0)]
    return value_bytes, numeric


class DocumentObservationEncoder:
    """Encode typed observations without truncating semantic identity."""

    encoder_id = DOCUMENT_ENCODER_ID

    def __init__(self, *, candidate_feature_dim: int = DOCUMENT_CANDIDATE_FEATURE_DIM):
        if type(candidate_feature_dim) is not int or candidate_feature_dim < DOCUMENT_CANDIDATE_FEATURE_DIM:
            raise ValueError("candidate feature dimension is too small for the lossless protocol")
        self.candidate_feature_dim = candidate_feature_dim

    def identity_from_request(self, request: Mapping[str, Any]) -> DocumentEpisodeIdentity:
        return DocumentEpisodeIdentity.from_request(request)

    def encode_candidates(
        self,
        candidates: Sequence[Mapping[str, Any]],
        *,
        requested_field_ids: Sequence[str] = (),
        identity: DocumentEpisodeIdentity | Mapping[str, Any] | None = None,
    ) -> np.ndarray:
        """Return ``(candidate_count, feature_dim)`` with no position feature."""

        candidates = list(candidates)
        assert_observation_no_hidden_fields(candidates, requested_field_ids)
        episode_identity = _coerce_identity(identity, candidates) if candidates else identity
        if episode_identity is None:
            return np.zeros((0, self.candidate_feature_dim), dtype=np.float64)
        if not isinstance(episode_identity, DocumentEpisodeIdentity):
            episode_identity = _coerce_identity(episode_identity, candidates)
        rows: list[list[float]] = []
        for candidate in candidates:
            if not isinstance(candidate, Mapping) or candidate.get("schema") != CANDIDATE_SCHEMA:
                raise ProtocolViolation("unsupported document candidate observation")
            field_id = candidate.get("field_id")
            value_type = candidate.get("value_type")
            section_kind = candidate.get("section_kind")
            handle = candidate.get("document_handle")
            section_id = candidate.get("section_id")
            candidate_id = candidate.get("candidate_id")
            if not all(isinstance(value, str) and value for value in (field_id, value_type, section_kind, handle, section_id, candidate_id)):
                raise ProtocolViolation("candidate semantic identity is required")
            if value_type not in VALUE_TYPE_VOCABULARY or section_kind not in SECTION_KIND_VOCABULARY:
                raise ProtocolViolation("candidate vocabulary value is unsupported")
            document_index = episode_identity.document_index(handle)
            section_index = episode_identity.section_index(handle, section_id)
            revision = candidate.get("revision")
            if type(revision) is not int or revision < 1:
                raise ProtocolViolation("candidate revision is invalid")
            revision_state = candidate.get("revision_state")
            if revision_state not in {"current", "obsolete"}:
                raise ProtocolViolation("candidate revision state is invalid")
            value_bytes, typed_numeric = _typed_value_features(candidate.get("value"), value_type)
            row = (
                _bounded_utf8(field_id, FIELD_ID_BYTES, name="candidate field id")
                + value_bytes
                + _one_hot(value_type, VALUE_TYPE_VOCABULARY)
                + _one_hot(section_kind, SECTION_KIND_VOCABULARY)
                + [float(revision / 16.0), float(revision_state == "current"), float(bool(candidate.get("conflict_group")))]
                + _ordered_date_features(candidate.get("published_at"))
                + typed_numeric
                + [float(document_index), float(section_index)]
            )
            if len(row) != DOCUMENT_CANDIDATE_FEATURE_DIM or not all(math.isfinite(value) for value in row):
                raise ProtocolViolation("invalid candidate feature")
            row.extend([0.0] * (self.candidate_feature_dim - len(row)))
            rows.append(row)
        if not rows:
            return np.zeros((0, self.candidate_feature_dim), dtype=np.float64)
        result = np.asarray(rows, dtype=np.float64)
        if result.shape != (len(rows), self.candidate_feature_dim) or not np.isfinite(result).all():
            raise ProtocolViolation("invalid variable candidate encoding")
        return result

    def encode_request_types(self, requested_fields: Sequence[Mapping[str, Any]]) -> np.ndarray:
        """Encode the initial request, including each requested field identity."""

        rows: list[list[float]] = []
        for field in requested_fields:
            if not isinstance(field, Mapping):
                raise ProtocolViolation("invalid initial request field")
            field_id = field.get("field_id")
            value_type = field.get("value_type")
            if not isinstance(field_id, str) or not field_id or value_type not in VALUE_TYPE_VOCABULARY:
                raise ProtocolViolation("initial request field identity and type are required")
            if field.get("revision_rule") != "latest_non_obsolete":
                raise ProtocolViolation("unsupported initial request revision rule")
            rows.append(_bounded_utf8(field_id, FIELD_ID_BYTES, name="requested field id") + _one_hot(value_type, VALUE_TYPE_VOCABULARY) + [1.0])
        if len(rows) > MAX_REQUESTED_FIELDS:
            raise ProtocolViolation("initial request exceeds the supported field count")
        if not rows:
            return np.zeros((0, DOCUMENT_REQUEST_FEATURE_DIM), dtype=np.float64)
        result = np.asarray(rows, dtype=np.float64)
        if result.shape != (len(rows), DOCUMENT_REQUEST_FEATURE_DIM) or not np.isfinite(result).all():
            raise ProtocolViolation("invalid initial request encoding")
        return result

    def encode_policy_input(
        self,
        *,
        requested_fields: Sequence[Mapping[str, Any]],
        candidates: Sequence[Mapping[str, Any]],
        latest_response: Mapping[str, Any] | None = None,
        remaining_action_budget: int = 0,
        identity: DocumentEpisodeIdentity | Mapping[str, Any] | None = None,
    ) -> np.ndarray:
        request_rows = self.encode_request_types(requested_fields)
        candidate_rows = self.encode_candidates(
            candidates,
            requested_field_ids=[str(field.get("field_id")) for field in requested_fields],
            identity=identity,
        )
        request_block = np.zeros((MAX_REQUESTED_FIELDS, DOCUMENT_REQUEST_FEATURE_DIM), dtype=np.float64)
        request_block[:len(request_rows)] = request_rows
        if len(candidate_rows):
            candidate_mean = np.mean(candidate_rows, axis=0)
            candidate_max = np.max(candidate_rows, axis=0)
        else:
            candidate_mean = np.zeros(self.candidate_feature_dim, dtype=np.float64)
            candidate_max = np.zeros(self.candidate_feature_dim, dtype=np.float64)
        response = latest_response or {}
        status = response.get("status", "request") if isinstance(response, Mapping) else "request"
        status_features = _one_hot(str(status), RESPONSE_STATUS_VOCABULARY)
        if type(remaining_action_budget) is not int or remaining_action_budget < 0:
            raise ProtocolViolation("remaining action budget is invalid")
        result = np.asarray(
            request_block.reshape(-1).tolist()
            + candidate_mean.tolist()
            + candidate_max.tolist()
            + status_features
            + [float(len(candidate_rows)), float(remaining_action_budget)],
            dtype=np.float64,
        )
        if result.shape != (DOCUMENT_MODEL_INPUT_DIM,) or not np.isfinite(result).all():
            raise ProtocolViolation("invalid document model input")
        return result


def _softmax_array(value: np.ndarray) -> np.ndarray:
    shifted = np.asarray(value, dtype=np.float64) - np.max(value)
    result = np.exp(shifted)
    result /= np.sum(result)
    return result


def _sigmoid_array(value: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.asarray(value, dtype=np.float64)))


class DocumentNeuralPolicy:
    """Untrained five-brain forward model; never a usable action service."""

    PERIPHERALS = DOCUMENT_PERIPHERAL_COUNT
    PERIPH_HIDDEN = DOCUMENT_PERIPHERAL_HIDDEN
    CENTER_HIDDEN = DOCUMENT_CENTRAL_HIDDEN
    MEMORY_SLOTS, MEMORY_DIM = DOCUMENT_MEMORY_SHAPE

    def __init__(self, seed: int = 0, *, encoder: DocumentObservationEncoder | None = None):
        if type(seed) is not int or seed < 0:
            raise ValueError("document model seed must be a non-negative integer")
        self.seed = seed
        self.encoder = encoder or DocumentObservationEncoder()
        self.input_normalization = None
        rng = np.random.default_rng(seed)
        self.params: dict[str, np.ndarray] = {}

        def normal(name: str, shape: tuple[int, ...], scale: float) -> None:
            self.params[name] = rng.normal(0.0, scale, shape).astype(np.float64)

        for brain in range(self.PERIPHERALS):
            prefix = f"p{brain}."
            normal(prefix + "W_in", (self.PERIPH_HIDDEN, DOCUMENT_MODEL_INPUT_DIM), 0.04)
            normal(prefix + "W_rec", (self.PERIPH_HIDDEN, self.PERIPH_HIDDEN), 0.12)
            self.params[prefix + "b"] = np.zeros(self.PERIPH_HIDDEN, dtype=np.float64)
            normal(prefix + "W_msg", (1, self.PERIPH_HIDDEN), 0.18)
            self.params[prefix + "b_msg"] = np.zeros(1, dtype=np.float64)

        center_input = DOCUMENT_MODEL_INPUT_DIM + self.PERIPHERALS + self.MEMORY_DIM
        normal("c.W_in", (self.CENTER_HIDDEN, center_input), 0.04)
        normal("c.W_rec", (self.CENTER_HIDDEN, self.CENTER_HIDDEN), 0.10)
        normal("c.W_gate_in", (self.CENTER_HIDDEN, center_input), 0.04)
        normal("c.W_gate_rec", (self.CENTER_HIDDEN, self.CENTER_HIDDEN), 0.08)
        self.params["c.b"] = np.zeros(self.CENTER_HIDDEN, dtype=np.float64)
        self.params["c.b_gate"] = np.zeros(self.CENTER_HIDDEN, dtype=np.float64)
        normal("c.W_key", (self.MEMORY_DIM, self.CENTER_HIDDEN), 0.12)
        normal("c.W_addr", (self.MEMORY_SLOTS, self.CENTER_HIDDEN), 0.12)
        normal("c.W_write_gate", (1, self.CENTER_HIDDEN), 0.10)
        self.params["c.b_write_gate"] = np.array([-0.35], dtype=np.float64)
        normal("c.W_value", (self.MEMORY_DIM, self.CENTER_HIDDEN), 0.12)
        self.params["c.b_value"] = np.zeros(self.MEMORY_DIM, dtype=np.float64)
        context_dim = self.CENTER_HIDDEN + self.MEMORY_DIM
        normal("c.W_action", (len(FIXED_ACTIONS), context_dim), 0.12)
        self.params["c.b_action"] = np.zeros(len(FIXED_ACTIONS), dtype=np.float64)
        normal("c.w_candidate_row", (self.encoder.candidate_feature_dim,), 0.08)
        normal("c.w_candidate_context", (context_dim,), 0.08)
        normal("c.W_candidate_bilinear", (self.encoder.candidate_feature_dim, context_dim), 0.02)
        normal("c.w_inspect_row", (INSPECT_ACTION_FEATURE_DIM,), 0.08)
        normal("c.W_inspect_bilinear", (INSPECT_ACTION_FEATURE_DIM, context_dim), 0.02)
        self.params["c.b_candidate"] = np.zeros(1, dtype=np.float64)
        self.model_status = DocumentPolicyModelStatus()

    @property
    def central_memory_shape(self) -> tuple[int, int]:
        return DOCUMENT_MEMORY_SHAPE

    def parameter_count(self) -> int:
        return int(sum(value.size for value in self.params.values()))

    def parameter_digest(self) -> str:
        """Return the digest of the actual immutable parameter payload.

        The seed and tensor shapes identify initialization, not the weights
        that are actually loaded.  Runtime snapshots therefore bind to this
        digest so a same-seed model with changed parameters cannot restore a
        state under a false identity.
        """

        digest = hashlib.sha256()
        for name in sorted(self.params):
            payload = np.ascontiguousarray(self.params[name], dtype=np.float64).tobytes()
            digest.update(name.encode("utf-8"))
            digest.update(b"\0")
            digest.update(str(self.params[name].shape).encode("ascii"))
            digest.update(b"\0")
            digest.update(payload)
        return digest.hexdigest()

    def model_identity(self) -> dict[str, Any]:
        return {
            "schema": DOCUMENT_MODEL_SCHEMA,
            "architecture": "four-peripheral-one-central-recurrent-addressable-memory-v2-typed-action-bilinear",
            "encoder_id": self.encoder.encoder_id,
            "checkpoint_id": DOCUMENT_CHECKPOINT_ID,
            "seed": self.seed,
            "parameter_count": self.parameter_count(),
            "parameter_digest": self.parameter_digest(),
            "model_version": DOCUMENT_MODEL_VERSION,
            "encoder_version": self.encoder.encoder_id,
            "decision_service_available": False,
            "weights_status": "random_untrained",
        }

    def initial_runtime(
        self,
        *,
        identity: DocumentEpisodeIdentity | Mapping[str, Any] | None = None,
        remaining_action_budget: int = 0,
    ) -> dict[str, Any]:
        if identity is None:
            identity = DocumentEpisodeIdentity("unbound-episode", (), ())
        elif not isinstance(identity, DocumentEpisodeIdentity):
            identity = DocumentEpisodeIdentity.from_dict(identity)
        if type(remaining_action_budget) is not int or remaining_action_budget < 0:
            raise ProtocolViolation("remaining action budget is invalid")
        return {
            "identity": identity,
            "peripheral": [np.zeros(self.PERIPH_HIDDEN, dtype=np.float64) for _ in range(self.PERIPHERALS)],
            "central": np.zeros(self.CENTER_HIDDEN, dtype=np.float64),
            "memory": np.zeros(self.central_memory_shape, dtype=np.float64),
            "phase": "initial_request",
            "requested_fields": None,
            "last_tool_response": None,
            "remaining_action_budget": remaining_action_budget,
            "step": 0,
            "inspected_section_keys": [],
            "selected_candidate_ids": [],
            "observed_candidate_ids": [],
            "observed_candidates": [],
            "dispositions": [],
            "terminal": False,
        }

    @staticmethod
    def copy_runtime(runtime: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "identity": runtime["identity"],
            "peripheral": [np.asarray(value, dtype=np.float64).copy() for value in runtime["peripheral"]],
            "central": np.asarray(runtime["central"], dtype=np.float64).copy(),
            "memory": np.asarray(runtime["memory"], dtype=np.float64).copy(),
            "phase": str(runtime.get("phase", "initial_request")),
            "requested_fields": deepcopy(runtime.get("requested_fields")),
            "last_tool_response": deepcopy(runtime.get("last_tool_response")),
            "remaining_action_budget": int(runtime.get("remaining_action_budget", 0)),
            "step": int(runtime.get("step", 0)),
            "inspected_section_keys": [list(key) for key in runtime.get("inspected_section_keys", [])],
            "selected_candidate_ids": list(runtime.get("selected_candidate_ids", [])),
            "observed_candidate_ids": list(runtime.get("observed_candidate_ids", [])),
            "observed_candidates": deepcopy(runtime.get("observed_candidates", [])),
            "dispositions": deepcopy(runtime.get("dispositions", [])),
            "terminal": bool(runtime.get("terminal", False)),
        }

    def _validate_runtime(self, runtime: Mapping[str, Any]) -> None:
        if not isinstance(runtime.get("identity"), DocumentEpisodeIdentity):
            raise ProtocolViolation("document runtime identity is invalid")
        if len(runtime.get("peripheral", [])) != self.PERIPHERALS:
            raise ProtocolViolation("document runtime peripheral count is invalid")
        values = list(runtime["peripheral"]) + [runtime["central"], runtime["memory"]]
        expected = [(self.PERIPH_HIDDEN,)] * self.PERIPHERALS + [(self.CENTER_HIDDEN,), self.central_memory_shape]
        for value, shape in zip(values, expected):
            array = np.asarray(value, dtype=np.float64)
            if array.shape != shape or not np.isfinite(array).all():
                raise ProtocolViolation("document runtime has invalid finite state")
        if type(runtime.get("remaining_action_budget")) is not int or runtime["remaining_action_budget"] < 0:
            raise ProtocolViolation("document runtime budget is invalid")
        if type(runtime.get("step")) is not int or runtime["step"] < 0:
            raise ProtocolViolation("document runtime step is invalid")
        if runtime.get("phase") not in {"initial_request", "tool_response"}:
            raise ProtocolViolation("document runtime phase is invalid")
        if runtime["step"] == 0 and runtime["phase"] != "initial_request":
            raise ProtocolViolation("initial document runtime phase is invalid")
        if runtime["step"] > 0 and runtime["phase"] != "tool_response":
            raise ProtocolViolation("subsequent document runtime phase is invalid")
        requested_fields = runtime.get("requested_fields")
        if runtime["step"] == 0:
            if requested_fields is not None:
                raise ProtocolViolation("initial runtime cannot carry a request payload")
        elif not isinstance(requested_fields, list) or not requested_fields:
            raise ProtocolViolation("subsequent runtime must retain the initial request")
        inspected = runtime.get("inspected_section_keys", [])
        if not isinstance(inspected, list) or not all(
            isinstance(item, (list, tuple)) and len(item) == 2 and all(isinstance(value, str) for value in item)
            for item in inspected
        ):
            raise ProtocolViolation("document runtime inspected-section state is invalid")
        for candidate_id_key in ("selected_candidate_ids", "observed_candidate_ids"):
            values = runtime.get(candidate_id_key, [])
            if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
                raise ProtocolViolation(f"document runtime {candidate_id_key} state is invalid")
        observed_candidates = runtime.get("observed_candidates", [])
        if not isinstance(observed_candidates, list):
            raise ProtocolViolation("document runtime observed candidate state is invalid")
        assert_observation_no_hidden_fields(observed_candidates, ())
        if any(
            not isinstance(candidate, Mapping)
            or candidate.get("schema") != CANDIDATE_SCHEMA
            or not isinstance(candidate.get("candidate_id"), str)
            for candidate in observed_candidates
        ):
            raise ProtocolViolation("document runtime observed candidate schema is invalid")
        dispositions = runtime.get("dispositions", [])
        if not isinstance(dispositions, list):
            raise ProtocolViolation("document runtime disposition state is invalid")
        disposition_fields: set[str] = set()
        requested_ids = {
            str(field.get("field_id"))
            for field in (requested_fields or [])
            if isinstance(field, Mapping) and isinstance(field.get("field_id"), str)
        }
        observed_ids = set(runtime.get("observed_candidate_ids", []))
        selected_ids = set(runtime.get("selected_candidate_ids", []))
        for disposition in dispositions:
            if not isinstance(disposition, Mapping) or set(disposition) != {"field_id", "disposition", "candidate_ids"}:
                raise ProtocolViolation("document runtime disposition schema is invalid")
            field_id = disposition.get("field_id")
            kind = disposition.get("disposition")
            candidate_ids = disposition.get("candidate_ids")
            if (
                not isinstance(field_id, str)
                or not field_id
                or field_id in disposition_fields
                or kind not in DISPOSITION_KINDS
                or not isinstance(candidate_ids, list)
                or not all(isinstance(candidate_id, str) and candidate_id for candidate_id in candidate_ids)
                or len(set(candidate_ids)) != len(candidate_ids)
                or len(candidate_ids) > MAX_DISPOSITION_CANDIDATES
                or (runtime["step"] > 0 and field_id not in requested_ids)
                or not set(candidate_ids).issubset(observed_ids)
                or not set(candidate_ids).issubset(selected_ids)
            ):
                raise ProtocolViolation("document runtime disposition values are invalid")
            if kind == "source" and len(candidate_ids) != 1:
                raise ProtocolViolation("source disposition requires one candidate")
            if kind == "missing" and candidate_ids:
                raise ProtocolViolation("missing disposition cannot cite candidates")
            if kind == "conflict" and len(candidate_ids) < 2:
                raise ProtocolViolation("conflict disposition requires at least two candidates")
            disposition_fields.add(field_id)
        if runtime["step"] == 0 and dispositions:
            raise ProtocolViolation("initial runtime cannot carry evidence dispositions")
        if not isinstance(runtime.get("terminal"), bool):
            raise ProtocolViolation("document runtime terminal state is invalid")
        _assert_finite_json(runtime.get("last_tool_response"))
        _assert_finite_json(requested_fields)
        _assert_finite_json(observed_candidates)
        _assert_finite_json(dispositions)

    @staticmethod
    def _request_field_ids(requested_fields: Sequence[Mapping[str, Any]]) -> list[str]:
        return [str(field.get("field_id")) for field in requested_fields]

    def _inspect_action_row(self, identity: DocumentEpisodeIdentity, handle: str, section_id: str) -> np.ndarray:
        document_index = identity.document_index(handle)
        section_index = identity.section_index(handle, section_id)
        document_scale = max(1, len(identity.document_handles) - 1)
        section_scale = max(1, len(identity.section_keys) - 1)
        row = np.asarray(
            [
                1.0,
                float(document_index / document_scale),
                float(section_index / section_scale),
                float((section_index + 1) / max(1, len(identity.section_keys))),
            ],
            dtype=np.float64,
        )
        if not np.isfinite(row).all():
            raise ProtocolViolation("inspect action feature is non-finite")
        return row

    def _candidate_scores_from_rows(self, rows: np.ndarray, context: np.ndarray) -> np.ndarray:
        if rows.size == 0:
            return np.zeros(0, dtype=np.float64)
        interaction = (rows @ self.params["c.W_candidate_bilinear"] * context.reshape(1, -1)).sum(axis=1)
        scores = (
            interaction
            + rows @ self.params["c.w_candidate_row"]
            + float(self.params["c.w_candidate_context"] @ context + self.params["c.b_candidate"][0])
        )
        if not np.isfinite(scores).all():
            raise ProtocolViolation("candidate scorer produced non-finite values")
        return scores

    def _numeric_forward(
        self,
        runtime: Mapping[str, Any],
        vector: np.ndarray,
        candidate_rows: np.ndarray,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        runtime = self.copy_runtime(runtime)
        messages: list[float] = []
        peripheral: list[np.ndarray] = []
        for brain in range(self.PERIPHERALS):
            prefix = f"p{brain}."
            hidden = np.tanh(self.params[prefix + "W_in"] @ vector + self.params[prefix + "W_rec"] @ runtime["peripheral"][brain] + self.params[prefix + "b"])
            peripheral.append(hidden)
            messages.append(float(np.tanh(self.params[prefix + "W_msg"] @ hidden + self.params[prefix + "b_msg"])[0]))
        messages_array = np.asarray(messages, dtype=np.float64)
        memory_before = runtime["memory"]
        prior_key = np.tanh(self.params["c.W_key"] @ runtime["central"])
        read_weights_before = _softmax_array((memory_before @ prior_key) / 0.75)
        read_before = read_weights_before @ memory_before
        center_input = np.concatenate((vector, messages_array, read_before))
        candidate = np.tanh(self.params["c.W_in"] @ center_input + self.params["c.W_rec"] @ runtime["central"] + self.params["c.b"])
        update = _sigmoid_array(self.params["c.W_gate_in"] @ center_input + self.params["c.W_gate_rec"] @ runtime["central"] + self.params["c.b_gate"])
        central = update * candidate + (1.0 - update) * runtime["central"]
        key = np.tanh(self.params["c.W_key"] @ central)
        write_weights = _softmax_array(self.params["c.W_addr"] @ central)
        write_gate = float(_sigmoid_array(self.params["c.W_write_gate"] @ central + self.params["c.b_write_gate"])[0])
        write_value = np.tanh(self.params["c.W_value"] @ central + self.params["c.b_value"])
        memory = memory_before + write_gate * write_weights[:, None] * (write_value[None, :] - memory_before)
        read_weights_after = _softmax_array((memory @ key) / 0.75)
        read_after = read_weights_after @ memory
        context = np.concatenate((central, read_after))
        fixed_logits = self.params["c.W_action"] @ context + self.params["c.b_action"]
        candidate_scores = self._candidate_scores_from_rows(candidate_rows, context)
        if not all(np.isfinite(value).all() for value in (central, memory, fixed_logits, candidate_scores)):
            raise ProtocolViolation("document neural forward produced non-finite values")
        next_runtime = {
            "identity": runtime["identity"],
            "peripheral": peripheral,
            "central": central,
            "memory": memory,
            "phase": runtime.get("phase", "initial_request"),
            "requested_fields": deepcopy(runtime.get("requested_fields")),
            "last_tool_response": runtime.get("last_tool_response"),
            "remaining_action_budget": runtime.get("remaining_action_budget", 0),
            "step": runtime.get("step", 0) + 1,
            "inspected_section_keys": deepcopy(runtime.get("inspected_section_keys", [])),
            "selected_candidate_ids": list(runtime.get("selected_candidate_ids", [])),
            "observed_candidate_ids": list(runtime.get("observed_candidate_ids", [])),
            "observed_candidates": deepcopy(runtime.get("observed_candidates", [])),
            "dispositions": deepcopy(runtime.get("dispositions", [])),
            "terminal": bool(runtime.get("terminal", False)),
        }
        trace = {
            "policy_input": vector.copy(),
            "messages": messages_array,
            "central": central.copy(),
            "memory": memory.copy(),
            "read_weights_before": read_weights_before.copy(),
            "read_before": read_before.copy(),
            "read_weights_after": read_weights_after.copy(),
            "read_after": read_after.copy(),
            "context": context.copy(),
            "fixed_action_logits": fixed_logits.copy(),
            "candidate_scores": candidate_scores.copy(),
        }
        return next_runtime, {"fixed_action_logits": fixed_logits, "candidate_scores": candidate_scores, "trace": trace}

    def _validate_observation_phase(
        self,
        observation: Mapping[str, Any],
        runtime: Mapping[str, Any] | None,
    ) -> tuple[str, list[Mapping[str, Any]] | None]:
        phase = observation.get("phase")
        if phase not in {"initial_request", "tool_response"}:
            raise ProtocolViolation("document neural observation phase is invalid")
        if runtime is None:
            if phase != "initial_request":
                raise ProtocolViolation("the first neural observation must be initial_request")
        else:
            self._validate_runtime(runtime)
            expected = "initial_request" if runtime["step"] == 0 else "tool_response"
            if phase != expected:
                raise ProtocolViolation("document neural observation phase does not match runtime step")
        if phase == "initial_request":
            requested_fields = observation.get("requested_fields")
            if not isinstance(requested_fields, list) or not requested_fields:
                raise ProtocolViolation("initial_request must carry the typed request exactly once")
            if observation.get("latest_response") is not None:
                raise ProtocolViolation("initial_request cannot carry a tool response")
            return phase, requested_fields
        if "requested_fields" in observation:
            raise ProtocolViolation("requested_fields payload is forbidden after the initial step")
        if not isinstance(observation.get("latest_response"), Mapping):
            raise ProtocolViolation("tool_response must carry the latest typed response")
        if runtime is None or not isinstance(runtime.get("requested_fields"), list):
            raise ProtocolViolation("tool_response has no retained initial request")
        return phase, runtime["requested_fields"]

    @staticmethod
    def _merge_candidates(
        previous: Sequence[Mapping[str, Any]],
        current: Sequence[Mapping[str, Any]],
        response: Mapping[str, Any] | None,
    ) -> list[dict[str, Any]]:
        merged: dict[str, dict[str, Any]] = {}
        values: list[Any] = list(previous) + list(current)
        if isinstance(response, Mapping):
            values.extend(response.get("candidates", []) if isinstance(response.get("candidates", []), list) else [])
            candidate = response.get("candidate")
            if isinstance(candidate, Mapping):
                values.append(candidate)
        for value in values:
            if not isinstance(value, Mapping) or not isinstance(value.get("candidate_id"), str):
                continue
            assert_observation_no_hidden_fields(value, ())
            candidate_id = str(value["candidate_id"])
            if candidate_id in merged and merged[candidate_id] != dict(value):
                raise ProtocolViolation("observed candidate identity changed across responses")
            merged[candidate_id] = deepcopy(dict(value))
        return [merged[key] for key in sorted(merged)]

    def _advance_observation_runtime(
        self,
        runtime: Mapping[str, Any],
        observation: Mapping[str, Any],
        requested_fields: Sequence[Mapping[str, Any]],
    ) -> dict[str, Any]:
        next_runtime = self.copy_runtime(runtime)
        response = observation.get("latest_response")
        next_runtime["phase"] = str(observation["phase"])
        if observation["phase"] == "initial_request":
            next_runtime["requested_fields"] = deepcopy(list(requested_fields))
        next_runtime["observed_candidates"] = self._merge_candidates(
            next_runtime.get("observed_candidates", []),
            observation.get("candidates", []),
            response,
        )
        inspected = {tuple(item) for item in next_runtime.get("inspected_section_keys", [])}
        selected = set(next_runtime.get("selected_candidate_ids", []))
        dispositions = {
            str(item["field_id"]): deepcopy(dict(item))
            for item in next_runtime.get("dispositions", [])
            if isinstance(item, Mapping) and isinstance(item.get("field_id"), str)
        }
        if isinstance(response, Mapping):
            if response.get("status") == "section_observed":
                handle = response.get("document_handle")
                section_id = response.get("section_id")
                if isinstance(handle, str) and isinstance(section_id, str):
                    inspected.add((handle, section_id))
            if response.get("status") == "candidate_selected":
                candidate = response.get("candidate")
                if isinstance(candidate, Mapping) and isinstance(candidate.get("candidate_id"), str):
                    selected.add(str(candidate["candidate_id"]))
            if response.get("status") == "disposition_set":
                field_id = response.get("field_id")
                disposition = response.get("disposition")
                candidate_ids = response.get("candidate_ids")
                if (
                    isinstance(field_id, str)
                    and disposition in DISPOSITION_KINDS
                    and isinstance(candidate_ids, list)
                ):
                    dispositions[field_id] = {
                        "field_id": field_id,
                        "disposition": disposition,
                        "candidate_ids": [str(candidate_id) for candidate_id in candidate_ids],
                    }
        next_runtime["inspected_section_keys"] = [list(item) for item in sorted(inspected)]
        next_runtime["selected_candidate_ids"] = sorted(selected)
        next_runtime["dispositions"] = [dispositions[key] for key in sorted(dispositions)]
        next_runtime["observed_candidate_ids"] = sorted(
            str(candidate["candidate_id"]) for candidate in next_runtime["observed_candidates"]
        )
        next_runtime["last_tool_response"] = deepcopy(response)
        next_runtime["remaining_action_budget"] = observation.get("remaining_action_budget", 0)
        if type(next_runtime["remaining_action_budget"]) is not int or next_runtime["remaining_action_budget"] < 0:
            raise ProtocolViolation("remaining action budget is invalid")
        next_runtime["terminal"] = bool(response.get("terminal", False)) if isinstance(response, Mapping) else False
        return next_runtime

    @staticmethod
    def _candidate_citation(candidate: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "document_handle": candidate["document_handle"],
            "section_id": candidate["section_id"],
            "source_sha256": candidate["source_sha256"],
            "fact_digest": candidate["fact_digest"],
        }

    def _materialize_packet(
        self,
        runtime: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Serialize only explicit per-field policy dispositions.

        No semantic ranking, equality, revision, or missingness decision is
        made here.  The verifier remains authoritative for those questions.
        """

        by_id = {str(candidate["candidate_id"]): candidate for candidate in runtime.get("observed_candidates", [])}
        dispositions = {
            str(item["field_id"]): item
            for item in runtime.get("dispositions", [])
            if isinstance(item, Mapping) and isinstance(item.get("field_id"), str)
        }
        entries: list[dict[str, Any]] = []
        missing_fields: list[str] = []
        conflicts: list[dict[str, Any]] = []
        for field_id in sorted(dispositions):
            item = dispositions[field_id]
            kind = item.get("disposition")
            candidate_ids = list(item.get("candidate_ids", []))
            if kind == "missing":
                missing_fields.append(field_id)
            elif kind == "source":
                if len(candidate_ids) != 1 or candidate_ids[0] not in by_id:
                    raise ProtocolViolation("source disposition cannot be materialized")
                candidate = by_id[candidate_ids[0]]
                entries.append({
                    "field_id": field_id,
                    "candidate_id": candidate["candidate_id"],
                    "value": deepcopy(candidate["value"]),
                    "value_type": candidate["value_type"],
                    "citation": self._candidate_citation(candidate),
                })
            elif kind == "conflict":
                if len(candidate_ids) < 2 or any(candidate_id not in by_id for candidate_id in candidate_ids):
                    raise ProtocolViolation("conflict disposition cannot be materialized")
                selected = [by_id[candidate_id] for candidate_id in candidate_ids]
                conflicts.append({
                    "field_id": field_id,
                    "candidate_ids": candidate_ids,
                    "value_type": selected[0]["value_type"],
                    "values": [deepcopy(candidate["value"]) for candidate in selected],
                    "citations": [self._candidate_citation(candidate) for candidate in selected],
                })
            else:
                raise ProtocolViolation("unknown evidence disposition")
        return {"entries": entries, "missing_fields": missing_fields, "conflicts": conflicts}

    def _legal_action_candidates(
        self,
        runtime: Mapping[str, Any],
        requested_fields: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        if runtime.get("terminal", False):
            return []
        identity = runtime["identity"]
        inspected = {tuple(item) for item in runtime.get("inspected_section_keys", [])}
        selected = set(runtime.get("selected_candidate_ids", []))
        candidates = list(runtime.get("observed_candidates", []))
        dispositions = {
            str(item["field_id"]): item
            for item in runtime.get("dispositions", [])
            if isinstance(item, Mapping) and isinstance(item.get("field_id"), str)
        }
        actions: list[dict[str, Any]] = []
        for handle, section_id in identity.section_keys:
            if (handle, section_id) not in inspected:
                actions.append({"kind": "inspect_section", "document_handle": handle, "section_id": section_id})
        for candidate in candidates:
            candidate_id = str(candidate["candidate_id"])
            if candidate_id not in selected:
                actions.append({"kind": "select_candidate", "candidate_id": candidate_id})
        selected_candidates = [candidate for candidate in candidates if str(candidate["candidate_id"]) in selected]
        for field in requested_fields:
            field_id = str(field["field_id"])
            if field_id in dispositions:
                continue
            # These options are intentionally syntax/permission masks only.
            # Whether a field is actually absent, current, latest, or in
            # conflict is decided by the server verifier after dispatch.
            actions.append({
                "kind": "set_disposition",
                "field_id": field_id,
                "disposition": "missing",
                "candidate_ids": [],
            })
            matching = [
                candidate for candidate in selected_candidates
                if candidate.get("field_id") == field_id
                and candidate.get("value_type") == field.get("value_type")
            ]
            for candidate in matching:
                actions.append({
                    "kind": "set_disposition",
                    "field_id": field_id,
                    "disposition": "source",
                    "candidate_ids": [str(candidate["candidate_id"])],
                })
            for group_size in range(2, min(4, len(matching)) + 1):
                for group in itertools.combinations(matching, group_size):
                    actions.append({
                        "kind": "set_disposition",
                        "field_id": field_id,
                        "disposition": "conflict",
                        "candidate_ids": [str(candidate["candidate_id"]) for candidate in group],
                    })
        if requested_fields and all(str(field["field_id"]) in dispositions for field in requested_fields):
            actions.append({"kind": "finish", "packet": self._materialize_packet(runtime)})
        return actions

    def _score_action_options(
        self,
        options: Sequence[Mapping[str, Any]],
        *,
        fixed_logits: np.ndarray,
        context: np.ndarray,
        identity: DocumentEpisodeIdentity,
        observed_candidates: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        candidate_rows = self.encoder.encode_candidates(
            observed_candidates,
            requested_field_ids=(),
            identity=identity,
        )
        candidate_scores = self._candidate_scores_from_rows(candidate_rows, context)
        candidate_score_map = {
            str(candidate["candidate_id"]): float(score)
            for candidate, score in zip(observed_candidates, candidate_scores)
        }
        scored: list[dict[str, Any]] = []
        for option in options:
            kind = option["kind"]
            if kind == "inspect_section":
                row = self._inspect_action_row(identity, option["document_handle"], option["section_id"])
                score = float(
                    fixed_logits[0]
                    + row @ self.params["c.w_inspect_row"]
                    + (row @ self.params["c.W_inspect_bilinear"] * context).sum()
                )
            elif kind == "select_candidate":
                score = candidate_score_map[str(option["candidate_id"])]
            elif kind == "set_disposition":
                # The existing fixed terminal logit is the structural score
                # for a disposition operation; the typed payload carries all
                # field/candidate identity and is never collapsed into one
                # semantic mask.
                score = float(fixed_logits[FIXED_ACTIONS.index("finish")])
            else:
                score = float(fixed_logits[FIXED_ACTIONS.index(kind)])
            scored.append({
                **deepcopy(dict(option)),
                "action_id": _canonical_action(option),
                "score": score,
            })
        return scored

    def make_observation(
        self,
        *,
        requested_fields: Sequence[Mapping[str, Any]] | None = None,
        candidates: Sequence[Mapping[str, Any]],
        latest_response: Mapping[str, Any] | None = None,
        remaining_action_budget: int = 0,
        identity: DocumentEpisodeIdentity | Mapping[str, Any] | None = None,
        phase: str | None = None,
    ) -> dict[str, Any]:
        candidates = list(candidates)
        episode_identity = _coerce_identity(identity, candidates)
        if phase is None:
            phase = "initial_request" if latest_response is None else "tool_response"
        if phase not in {"initial_request", "tool_response"}:
            raise ProtocolViolation("document neural observation phase is invalid")
        if phase == "initial_request":
            if not isinstance(requested_fields, Sequence) or isinstance(requested_fields, (str, bytes)) or not list(requested_fields):
                raise ProtocolViolation("initial_request requires a typed request")
            if latest_response is not None:
                raise ProtocolViolation("initial_request cannot carry a tool response")
        elif requested_fields is not None:
            raise ProtocolViolation("requested_fields payload is forbidden after the initial step")
        if type(remaining_action_budget) is not int or remaining_action_budget < 0:
            raise ProtocolViolation("remaining action budget is invalid")
        observation = {
            "schema": DOCUMENT_FORWARD_SCHEMA,
            "phase": phase,
            "candidates": deepcopy(candidates),
            "latest_response": deepcopy(latest_response),
            "remaining_action_budget": remaining_action_budget,
            "identity": episode_identity.as_dict(),
        }
        if phase == "initial_request":
            observation["requested_fields"] = deepcopy(list(requested_fields or ()))
        return observation

    def forward(self, observation: Mapping[str, Any], runtime: Mapping[str, Any] | None = None) -> dict[str, Any]:
        if not isinstance(observation, Mapping) or observation.get("schema") != DOCUMENT_FORWARD_SCHEMA:
            raise ProtocolViolation("unsupported document neural observation")
        candidates = observation.get("candidates")
        if not isinstance(candidates, list):
            raise ProtocolViolation("document neural observation is not typed")
        identity = _coerce_identity(observation.get("identity"), candidates)
        phase, requested_fields = self._validate_observation_phase(observation, runtime)
        if runtime is None:
            runtime = self.initial_runtime(
                identity=identity,
                remaining_action_budget=int(observation.get("remaining_action_budget", 0)),
            )
        else:
            if runtime["identity"] != identity:
                raise ProtocolViolation("document neural observation identity does not match runtime")
        runtime = self._advance_observation_runtime(runtime, observation, requested_fields or ())
        network_requested_fields = requested_fields if phase == "initial_request" else ()
        vector = self.encoder.encode_policy_input(
            requested_fields=network_requested_fields,
            candidates=candidates,
            latest_response=observation.get("latest_response"),
            remaining_action_budget=observation.get("remaining_action_budget", 0),
            identity=identity,
        )
        candidate_rows = self.encoder.encode_candidates(
            candidates,
            requested_field_ids=self._request_field_ids(network_requested_fields),
            identity=identity,
        )
        next_runtime, result = self._numeric_forward(runtime, vector, candidate_rows)
        next_runtime["phase"] = "tool_response"
        next_runtime["requested_fields"] = deepcopy(list(requested_fields or ()))
        next_runtime["last_tool_response"] = deepcopy(observation.get("latest_response"))
        next_runtime["remaining_action_budget"] = int(observation.get("remaining_action_budget", 0))
        next_runtime["inspected_section_keys"] = deepcopy(runtime.get("inspected_section_keys", []))
        next_runtime["selected_candidate_ids"] = deepcopy(runtime.get("selected_candidate_ids", []))
        next_runtime["observed_candidates"] = deepcopy(runtime.get("observed_candidates", []))
        next_runtime["observed_candidate_ids"] = deepcopy(runtime.get("observed_candidate_ids", []))
        next_runtime["dispositions"] = deepcopy(runtime.get("dispositions", []))
        next_runtime["terminal"] = bool(runtime.get("terminal", False))
        legal_options = self._legal_action_candidates(next_runtime, requested_fields or ())
        action_options = self._score_action_options(
            legal_options,
            fixed_logits=result["fixed_action_logits"],
            context=result["trace"]["context"],
            identity=identity,
            observed_candidates=next_runtime["observed_candidates"],
        )
        return {
            "schema": DOCUMENT_FORWARD_SCHEMA,
            "model_identity": self.model_identity(),
            "model_available": False,
            "decision_service_available": False,
            "action_options": action_options,
            "fixed_action_logits": result["fixed_action_logits"].copy(),
            "candidate_scores": result["candidate_scores"].copy(),
            "candidate_ids": [str(candidate["candidate_id"]) for candidate in candidates],
            "legal_action_candidates": deepcopy(action_options),
            "runtime": next_runtime,
            "trace": result["trace"],
        }

    def score_candidates(
        self,
        candidates: Sequence[Mapping[str, Any]],
        *,
        requested_field_ids: Sequence[str] = (),
        identity: DocumentEpisodeIdentity | Mapping[str, Any] | None = None,
        context: Sequence[float] | None = None,
    ) -> np.ndarray:
        candidates = list(candidates)
        if not candidates:
            return np.zeros(0, dtype=np.float64)
        episode_identity = _coerce_identity(identity, candidates)
        rows = self.encoder.encode_candidates(candidates, requested_field_ids=requested_field_ids, identity=episode_identity)
        context_array = np.zeros(self.CENTER_HIDDEN + self.MEMORY_DIM, dtype=np.float64) if context is None else np.asarray(context, dtype=np.float64)
        if context_array.shape != (self.CENTER_HIDDEN + self.MEMORY_DIM,) or not np.isfinite(context_array).all():
            raise ProtocolViolation("candidate scorer context is invalid")
        return self._candidate_scores_from_rows(rows, context_array)

    def _tensor_forward(
        self,
        runtime: Mapping[str, Tensor],
        vector: np.ndarray,
        candidate_rows: np.ndarray,
        params: Mapping[str, Tensor],
    ) -> tuple[dict[str, Tensor], Tensor, list[Tensor], dict[str, Any]]:
        peripheral = runtime["peripheral"]
        central = runtime["central"]
        memory = runtime["memory"]
        messages: list[Tensor] = []
        next_peripheral: list[Tensor] = []
        for brain in range(self.PERIPHERALS):
            prefix = f"p{brain}."
            hidden = tanh(params[prefix + "W_in"] @ Tensor(vector) + params[prefix + "W_rec"] @ peripheral[brain] + params[prefix + "b"])
            next_peripheral.append(hidden)
            messages.append(tanh(params[prefix + "W_msg"] @ hidden + params[prefix + "b_msg"]))
        messages_tensor = concatenate(messages, axis=0)
        prior_key = tanh(params["c.W_key"] @ central)
        read_weights_before = softmax((memory @ prior_key) / 0.75)
        read_before = read_weights_before @ memory
        center_input = concatenate((Tensor(vector), messages_tensor, read_before), axis=0)
        candidate = tanh(params["c.W_in"] @ center_input + params["c.W_rec"] @ central + params["c.b"])
        update = sigmoid(params["c.W_gate_in"] @ center_input + params["c.W_gate_rec"] @ central + params["c.b_gate"])
        central = update * candidate + (1.0 - update) * central
        key = tanh(params["c.W_key"] @ central)
        write_weights = softmax(params["c.W_addr"] @ central)
        write_gate = sigmoid(params["c.W_write_gate"] @ central + params["c.b_write_gate"])
        write_value = tanh(params["c.W_value"] @ central + params["c.b_value"])
        memory = memory + write_gate * write_weights.reshape(self.MEMORY_SLOTS, 1) * (write_value.reshape(1, self.MEMORY_DIM) - memory)
        read_weights_after = softmax((memory @ key) / 0.75)
        read_after = read_weights_after @ memory
        context = concatenate((central, read_after), axis=0)
        fixed_logits = params["c.W_action"] @ context + params["c.b_action"]
        candidate_logits: list[Tensor] = []
        for row in candidate_rows:
            row_score = (params["c.w_candidate_row"].reshape(1, -1) @ Tensor(row))[0]
            interaction_vector = Tensor(row) @ params["c.W_candidate_bilinear"]
            interaction_score = (interaction_vector.reshape(1, -1) @ context)[0]
            context_score = (params["c.w_candidate_context"].reshape(1, -1) @ context + params["c.b_candidate"])[0]
            candidate_logits.append((row_score + interaction_score + context_score).reshape(1))
        return {"peripheral": next_peripheral, "central": central, "memory": memory}, fixed_logits, candidate_logits, {
            "policy_input": vector.copy(),
            "fixed_action_logits": fixed_logits.data.copy(),
            "candidate_scores": np.asarray([score.data for score in candidate_logits], dtype=np.float64),
            "memory": memory.data.copy(),
            "central": central.data.copy(),
            "context": context.data.copy(),
            "context_tensor": context,
        }

    def loss_and_gradients(
        self,
        observations: Sequence[Mapping[str, Any]],
        *,
        target_action: str | Mapping[str, Any] | None = None,
        target_actions: Sequence[str | Mapping[str, Any]] | None = None,
        initial_memory: np.ndarray | None = None,
    ) -> tuple[float, dict[str, np.ndarray], np.ndarray, list[dict[str, Any]]]:
        if not observations:
            raise ProtocolViolation("document neural observations are required")
        if target_action is not None and target_actions is not None:
            raise ProtocolViolation("provide target_action or target_actions, not both")
        if target_actions is None:
            if target_action is None:
                raise ProtocolViolation("document neural imitation targets are required")
            targets = [target_action for _ in observations]
        else:
            targets = list(target_actions)
            if len(targets) != len(observations):
                raise ProtocolViolation("one exact imitation target is required per observation step")
        params = {name: Tensor(value.copy(), requires_grad=True) for name, value in self.params.items()}
        first = observations[0]
        if not isinstance(first, Mapping) or first.get("schema") != DOCUMENT_FORWARD_SCHEMA:
            raise ProtocolViolation("unsupported document neural observation")
        identity = _coerce_identity(first.get("identity"), first.get("candidates", []))
        if first.get("phase") != "initial_request":
            raise ProtocolViolation("gradient sequences must begin with initial_request")
        metadata_runtime: dict[str, Any] = self.initial_runtime(identity=identity, remaining_action_budget=0)
        tensor_runtime: dict[str, Any] = {
            "peripheral": [Tensor(np.zeros(self.PERIPH_HIDDEN)) for _ in range(self.PERIPHERALS)],
            "central": Tensor(np.zeros(self.CENTER_HIDDEN)),
            "memory": Tensor(np.zeros(self.central_memory_shape, dtype=np.float64) if initial_memory is None else np.asarray(initial_memory, dtype=np.float64), requires_grad=True),
        }
        initial_memory_tensor = tensor_runtime["memory"]
        if initial_memory_tensor.data.shape != self.central_memory_shape or not np.isfinite(initial_memory_tensor.data).all():
            raise ProtocolViolation("invalid initial neural memory")
        trace: list[dict[str, Any]] = []
        step_losses: list[Tensor] = []
        for step_index, (observation, target) in enumerate(zip(observations, targets)):
            if not isinstance(observation, Mapping) or observation.get("schema") != DOCUMENT_FORWARD_SCHEMA:
                raise ProtocolViolation("unsupported document neural observation")
            observation_identity = _coerce_identity(observation.get("identity"), observation.get("candidates", []))
            if observation_identity != identity:
                raise ProtocolViolation("document neural sequence changes episode identity")
            phase, requested_fields = self._validate_observation_phase(observation, metadata_runtime)
            metadata_runtime = self._advance_observation_runtime(metadata_runtime, observation, requested_fields or ())
            candidates = list(observation.get("candidates", []))
            network_requested_fields = requested_fields if phase == "initial_request" else ()
            vector = self.encoder.encode_policy_input(
                requested_fields=network_requested_fields,
                candidates=candidates,
                latest_response=observation.get("latest_response"),
                remaining_action_budget=observation.get("remaining_action_budget", 0),
                identity=identity,
            )
            rows = self.encoder.encode_candidates(
                metadata_runtime.get("observed_candidates", []),
                requested_field_ids=self._request_field_ids(network_requested_fields),
                identity=identity,
            )
            tensor_runtime, fixed_logits, candidate_logits, step_trace = self._tensor_forward(tensor_runtime, vector, rows, params)
            legal_options = self._legal_action_candidates(metadata_runtime, requested_fields or ())
            if not legal_options:
                raise ProtocolViolation("document neural observation has no legal action candidates")
            candidate_ids = [str(candidate["candidate_id"]) for candidate in metadata_runtime.get("observed_candidates", [])]
            candidate_logit_by_id = {
                candidate_id: logit for candidate_id, logit in zip(candidate_ids, candidate_logits)
            }
            action_logits: list[Tensor] = []
            for option in legal_options:
                kind = option["kind"]
                if kind == "inspect_section":
                    row = self._inspect_action_row(identity, option["document_handle"], option["section_id"])
                    row_tensor = Tensor(row)
                    row_score = (params["c.w_inspect_row"].reshape(1, -1) @ row_tensor)[0]
                    interaction_vector = row_tensor @ params["c.W_inspect_bilinear"]
                    interaction_score = (interaction_vector.reshape(1, -1) @ step_trace["context_tensor"])[0]
                    action_logits.append((fixed_logits[0] + row_score + interaction_score).reshape(1))
                elif kind == "select_candidate":
                    candidate_id = str(option["candidate_id"])
                    if candidate_id not in candidate_logit_by_id:
                        raise ProtocolViolation("legal select candidate is missing from the encoded observation")
                    action_logits.append(candidate_logit_by_id[candidate_id])
                elif kind == "set_disposition":
                    action_logits.append(fixed_logits[FIXED_ACTIONS.index("finish")].reshape(1))
                else:
                    action_logits.append(fixed_logits[FIXED_ACTIONS.index(kind)].reshape(1))
            logits = concatenate(action_logits, axis=0)
            target_index = self._target_option_index(legal_options, target)
            probabilities = softmax(logits)
            step_loss = -log(probabilities[target_index] + 1e-12)
            step_losses.append(step_loss)
            step_trace["loss"] = float(step_loss.data)
            step_trace["legal_action_count"] = len(legal_options)
            step_trace["target_action"] = deepcopy(target)
            step_trace.pop("context_tensor", None)
            trace.append(step_trace)
            metadata_runtime["phase"] = "tool_response"
            metadata_runtime["step"] += 1
        imitation_total = step_losses[0]
        for step_loss in step_losses[1:]:
            imitation_total = imitation_total + step_loss
        total = (
            imitation_total / float(len(step_losses))
            + 0.0002 * (params["c.W_rec"] * params["c.W_rec"]).sum()
        )
        total.backward()
        gradients = {name: tensor.grad.copy() for name, tensor in params.items()}
        if not np.isfinite(total.data) or not all(np.isfinite(gradient).all() for gradient in gradients.values()):
            raise ProtocolViolation("document neural gradient path produced non-finite values")
        return float(total.data), gradients, initial_memory_tensor.grad.copy(), trace

    @staticmethod
    def _target_option_index(options: Sequence[Mapping[str, Any]], target: str | Mapping[str, Any]) -> int:
        if isinstance(target, str):
            raise ProtocolViolation("string imitation target is not allowed; use the exact typed action payload")
        if not isinstance(target, Mapping) or not isinstance(target.get("kind"), str):
            raise ProtocolViolation("typed imitation target is invalid")
        target_base = _action_base(target)
        if "action_id" in target:
            action_id = target.get("action_id")
            if not isinstance(action_id, str) or action_id != _canonical_action(target_base):
                raise ProtocolViolation("typed imitation action_id does not bind to its payload")
        for index, option in enumerate(options):
            if _canonical_action(target_base) == _canonical_action(_action_base(option)):
                return index
        raise ProtocolViolation("exact typed imitation target is not a legal action in this step")

    def loss_only(
        self,
        observations: Sequence[Mapping[str, Any]],
        *,
        target_action: str | Mapping[str, Any] | None = None,
        target_actions: Sequence[str | Mapping[str, Any]] | None = None,
    ) -> float:
        return self.loss_and_gradients(observations, target_action=target_action, target_actions=target_actions)[0]

    def snapshot_runtime(self, runtime: Mapping[str, Any]) -> dict[str, Any]:
        self._validate_runtime(runtime)
        snapshot = {
            "schema": DOCUMENT_RUNTIME_SNAPSHOT_SCHEMA,
            "model_identity": self.model_identity(),
            "encoder_identity": {"encoder_id": self.encoder.encoder_id, "candidate_feature_dim": self.encoder.candidate_feature_dim},
            "episode_identity": runtime["identity"].as_dict(),
            "peripheral_hidden_states": [np.asarray(value, dtype=np.float64).tolist() for value in runtime["peripheral"]],
            "central_hidden_state": np.asarray(runtime["central"], dtype=np.float64).tolist(),
            "learned_memory": np.asarray(runtime["memory"], dtype=np.float64).tolist(),
            "last_tool_response": deepcopy(runtime.get("last_tool_response")),
            "remaining_action_budget": runtime["remaining_action_budget"],
            "step": runtime["step"],
            "phase": runtime["phase"],
            "requested_fields": deepcopy(runtime.get("requested_fields")),
            "inspected_section_keys": [list(key) for key in runtime.get("inspected_section_keys", [])],
            "selected_candidate_ids": sorted(str(item) for item in runtime.get("selected_candidate_ids", [])),
            "observed_candidate_ids": sorted(str(item) for item in runtime.get("observed_candidate_ids", [])),
            "observed_candidates": deepcopy(runtime.get("observed_candidates", [])),
            "dispositions": deepcopy(runtime.get("dispositions", [])),
            "terminal": runtime.get("terminal", False),
        }
        _assert_finite_json(snapshot)
        return snapshot

    def restore_runtime(self, snapshot: Mapping[str, Any]) -> dict[str, Any]:
        _assert_finite_json(snapshot)
        if not isinstance(snapshot, Mapping) or snapshot.get("schema") != DOCUMENT_RUNTIME_SNAPSHOT_SCHEMA:
            raise ProtocolViolation("unsupported document neural runtime snapshot")
        if snapshot.get("model_identity") != self.model_identity():
            raise ProtocolViolation("document neural model/checkpoint identity mismatch")
        expected_encoder = {"encoder_id": self.encoder.encoder_id, "candidate_feature_dim": self.encoder.candidate_feature_dim}
        if snapshot.get("encoder_identity") != expected_encoder:
            raise ProtocolViolation("document neural encoder identity mismatch")
        identity = DocumentEpisodeIdentity.from_dict(snapshot.get("episode_identity", {}))
        peripheral_values = snapshot.get("peripheral_hidden_states")
        if not isinstance(peripheral_values, list) or len(peripheral_values) != self.PERIPHERALS:
            raise ProtocolViolation("document neural peripheral snapshot is incomplete")
        observed_candidate_ids = snapshot.get("observed_candidate_ids", [])
        if not isinstance(observed_candidate_ids, list) or not all(isinstance(item, str) for item in observed_candidate_ids):
            raise ProtocolViolation("document neural candidate identity snapshot is invalid")
        selected_candidate_ids = snapshot.get("selected_candidate_ids", [])
        if not isinstance(selected_candidate_ids, list) or not all(isinstance(item, str) for item in selected_candidate_ids):
            raise ProtocolViolation("document neural selected candidate snapshot is invalid")
        inspected_section_keys = snapshot.get("inspected_section_keys", [])
        if not isinstance(inspected_section_keys, list) or not all(
            isinstance(item, list) and len(item) == 2 and all(isinstance(value, str) for value in item)
            for item in inspected_section_keys
        ):
            raise ProtocolViolation("document neural inspected-section snapshot is invalid")
        observed_candidates = snapshot.get("observed_candidates", [])
        if not isinstance(observed_candidates, list):
            raise ProtocolViolation("document neural observed candidate snapshot is invalid")
        dispositions = snapshot.get("dispositions", [])
        if not isinstance(dispositions, list):
            raise ProtocolViolation("document neural disposition snapshot is invalid")
        if snapshot.get("terminal") not in {True, False}:
            raise ProtocolViolation("document neural terminal snapshot is invalid")
        try:
            runtime = {
                "identity": identity,
                "peripheral": [np.asarray(value, dtype=np.float64).reshape(self.PERIPH_HIDDEN).copy() for value in peripheral_values],
                "central": np.asarray(snapshot.get("central_hidden_state"), dtype=np.float64).reshape(self.CENTER_HIDDEN).copy(),
                "memory": np.asarray(snapshot.get("learned_memory"), dtype=np.float64).reshape(self.central_memory_shape).copy(),
                "phase": snapshot.get("phase"),
                "requested_fields": deepcopy(snapshot.get("requested_fields")),
                "last_tool_response": deepcopy(snapshot.get("last_tool_response")),
                "remaining_action_budget": snapshot.get("remaining_action_budget"),
                "step": snapshot.get("step"),
                "inspected_section_keys": deepcopy(inspected_section_keys),
                "selected_candidate_ids": list(selected_candidate_ids),
                "observed_candidate_ids": list(observed_candidate_ids),
                "observed_candidates": deepcopy(observed_candidates),
                "dispositions": deepcopy(dispositions),
                "terminal": snapshot.get("terminal"),
            }
        except (TypeError, ValueError) as exc:
            raise ProtocolViolation("document neural runtime state shapes are invalid") from exc
        self._validate_runtime(runtime)
        if self.snapshot_runtime(runtime) != dict(snapshot):
            raise ProtocolViolation("document neural runtime snapshot replay mismatch")
        return runtime


class VariableCandidateScorer:
    """Structural variable-row scorer backed by the untrained model."""

    def __init__(self, *, encoder: DocumentObservationEncoder | None = None, model: DocumentNeuralPolicy | None = None):
        self.model = model or DocumentNeuralPolicy(encoder=encoder or DocumentObservationEncoder())
        self.encoder = self.model.encoder

    def score(
        self,
        candidates: Sequence[Mapping[str, Any]],
        *,
        requested_field_ids: Sequence[str] = (),
        identity: DocumentEpisodeIdentity | Mapping[str, Any] | None = None,
        context: Sequence[float] | None = None,
    ) -> np.ndarray:
        return self.model.score_candidates(candidates, requested_field_ids=requested_field_ids, identity=identity, context=context)


class DocumentPolicyInterface:
    """Typed boundary for the future document policy."""

    backend = DOCUMENT_POLICY_BACKEND
    peripheral_count = DOCUMENT_PERIPHERAL_COUNT
    central_count = DOCUMENT_CENTRAL_COUNT
    total_brains = DOCUMENT_TOTAL_BRAINS
    memory_shape = DOCUMENT_MEMORY_SHAPE
    action_vocabulary = DOCUMENT_ACTIONS
    gate_outputs_are_document_actions = False

    def __init__(self, *, seed: int = 0, encoder: DocumentObservationEncoder | None = None):
        self.encoder = encoder or DocumentObservationEncoder()
        self.model = DocumentNeuralPolicy(seed=seed, encoder=self.encoder)
        self.candidate_scorer = VariableCandidateScorer(model=self.model)
        self.model_status = self.model.model_status

    def specification(self) -> dict[str, Any]:
        return {
            "backend": self.backend,
            "peripheral_count": self.peripheral_count,
            "central_count": self.central_count,
            "total_brains": self.total_brains,
            "memory_shape": list(self.memory_shape),
            "action_vocabulary": list(self.action_vocabulary),
            "legal_action_schemas": {
                "inspect_section": {"operation": "inspect one server-catalogued section", "arguments": {"document_handle": "opaque server handle", "section_id": "catalog section id"}},
                "select_candidate": {"operation": "explicitly select one observed candidate", "arguments": {"candidate_id": "episode-local opaque candidate id"}},
                "set_disposition": {"operation": "explicitly designate one requested field as source, missing, or conflict", "arguments": {"field_id": "initial-request field id", "disposition": "source|missing|conflict", "candidate_ids": "selected candidate ids"}},
                "finish": {"operation": "submit entries, missing fields, and/or conflict citations", "arguments": {"packet": "typed evidence packet"}},
                "report_missing": {"operation": "submit a typed packet with an explicit missing field", "arguments": {"field_id": "initial-request field id", "packet": "typed evidence packet"}},
                "report_conflict": {"operation": "submit a typed packet with all equal-rank conflict citations", "arguments": {"field_id": "initial-request field id", "packet": "typed evidence packet"}},
            },
            "typed_action_candidates": {
                "identity": "kind plus all typed arguments; candidate ids and catalog section keys are episode-local",
                "inspect_section": "one exact uninspected (document_handle, section_id) pair",
                "select_candidate": "one exact observed candidate_id not already selected",
                "set_disposition": "one exact unconsumed requested field plus a bounded source/missing/conflict candidate-id payload; verifier decides semantic correctness",
                "terminal": "finish is offered only after every requested field has an explicit serialized disposition packet",
                "masking": ["already_inspected_sections", "already_selected_candidates", "already_disposed_fields", "illegal_or_unobserved_candidates"],
                "packet_materialization": "serializes explicit source/missing/conflict dispositions only; it never ranks evidence or chooses a winner",
            },
            "phase_rules": {
                "initial_request_only": True,
                "initial_phase_name": "initial_request",
                "subsequent_phase_name": "tool_response",
                "requested_fields_rejected_after_step_zero": True,
                "initial_request_contains_field_ids": True,
                "candidate_observations_contain_source_field_ids": True,
                "latest_tool_response_visible": True,
                "remaining_action_budget_visible": True,
                "latest_tool_response_fields": ["phase", "status", "action_count", "remaining_action_budget", "terminal", "candidates", "outcome"],
            },
            "identity_encoding": {
                "field_id_utf8_bytes": FIELD_ID_BYTES,
                "value_utf8_bytes": VALUE_BYTES,
                "lossless_within_protocol_limits": True,
                "stable_episode_local_indices_from_catalog": True,
                "candidate_position_feature": False,
                "source_digest_scalar_features": False,
                "arbitrary_value_hashes_as_scalar_features": False,
            },
            "recurrent_snapshot_contract": {
                "schema": DOCUMENT_RUNTIME_SNAPSHOT_SCHEMA,
                "memory_shape": list(self.memory_shape),
                "state_fields": ["peripheral_hidden_states[4]", "central_hidden_state", "learned_memory", "phase", "requested_fields_initial_only", "last_tool_response", "remaining_action_budget", "episode_identity_relations", "inspected_section_keys", "selected_candidate_ids", "observed_candidate_ids", "observed_candidates", "dispositions", "terminal"],
                "types": {
                    "peripheral_hidden_states": "finite_float[4,8]",
                    "central_hidden_state": "finite_float[12]",
                    "learned_memory": "finite_float[2,6]",
                    # Kept as a concise alias for consumers of the earlier
                    # v2 interface; the explicit state fields above are the
                    # authoritative contract.
                    "memory": "finite_float[2,6]",
                    "last_tool_response": "typed_json_or_null",
                    "phase": "initial_request_or_tool_response",
                    "requested_fields": "typed_initial_request_or_null_after_step_zero",
                    "remaining_action_budget": "nonnegative_integer",
                    "episode_identity_relations": "catalog_bound_episode_local_relation_map",
                    "dispositions": "unique_typed_per_field_source_missing_or_conflict_records",
                },
                "identity_requirements": {"encoder_id": self.encoder.encoder_id, "model_identity": self.model.model_identity(), "checkpoint_id": DOCUMENT_CHECKPOINT_ID},
            },
            "ordered_date_features": ["ordinal_days", "year", "month", "day"],
            "provenance_digests_as_scalar_features": False,
            "arbitrary_value_hashes_as_scalar_features": False,
            "gate_outputs_are_document_actions": self.gate_outputs_are_document_actions,
            "neural_model_available": False,
            "forward_available_for_structural_audit": True,
            "decision_service_available": False,
            "model_status": self.model_status.as_dict(),
            "model_identity": self.model.model_identity(),
            "variable_candidate_set": True,
            "imitation_loss": {
                "aggregation": "mean_per_step",
                "target_contract": "one exact typed legal action identity per observation step",
                "regularization": "small recurrent-weight penalty added after step-loss mean",
            },
        }

    def encode_observation(
        self,
        *,
        requested_fields: Sequence[Mapping[str, Any]] | None = None,
        candidates: Sequence[Mapping[str, Any]],
        requested_field_ids: Sequence[str] = (),
        latest_response: Mapping[str, Any] | None = None,
        remaining_action_budget: int = 0,
        identity: DocumentEpisodeIdentity | Mapping[str, Any] | None = None,
        phase: str | None = None,
    ) -> dict[str, Any]:
        candidates = list(candidates)
        episode_identity = _coerce_identity(identity, candidates)
        observation = self.model.make_observation(requested_fields=requested_fields, candidates=candidates, latest_response=latest_response, remaining_action_budget=remaining_action_budget, identity=episode_identity, phase=phase)
        encoded_request_fields = list(requested_fields or ())
        return {
            "request_types": self.encoder.encode_request_types(encoded_request_fields) if observation["phase"] == "initial_request" else None,
            "candidates": self.encoder.encode_candidates(candidates, requested_field_ids=requested_field_ids, identity=episode_identity),
            "model_input": self.encoder.encode_policy_input(requested_fields=encoded_request_fields, candidates=candidates, latest_response=latest_response, remaining_action_budget=remaining_action_budget, identity=episode_identity),
            "identity": episode_identity.as_dict(),
            "observation": observation,
        }

    def forward(self, observation: Mapping[str, Any], runtime: Mapping[str, Any] | None = None) -> dict[str, Any]:
        return self.model.forward(observation, runtime=runtime)

    def loss_and_gradients(
        self,
        observations: Sequence[Mapping[str, Any]],
        *,
        target_action: str | Mapping[str, Any] | None = None,
        target_actions: Sequence[str | Mapping[str, Any]] | None = None,
    ):
        return self.model.loss_and_gradients(observations, target_action=target_action, target_actions=target_actions)

    def select_action(self, observation: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(observation, Mapping):
            raise ProtocolViolation("document policy observation must be a mapping")
        raise DocumentNeuralPolicyUnavailable("document neural policy is untrained and explicitly unavailable as a decision service")


__all__ = [
    "DOCUMENT_ACTIONS",
    "DOCUMENT_CANDIDATE_FEATURE_DIM",
    "DOCUMENT_CHECKPOINT_ID",
    "DOCUMENT_ENCODER_ID",
    "DOCUMENT_MEMORY_SHAPE",
    "DOCUMENT_MODEL_VERSION",
    "DOCUMENT_MODEL_INPUT_DIM",
    "DOCUMENT_POLICY_BACKEND",
    "DOCUMENT_REQUEST_FEATURE_DIM",
    "DocumentEpisodeIdentity",
    "DocumentNeuralPolicy",
    "DocumentNeuralPolicyUnavailable",
    "DocumentObservationEncoder",
    "DocumentPolicyInterface",
    "DocumentPolicyModelStatus",
    "VariableCandidateScorer",
]
