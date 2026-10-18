"""Review-gated document-policy interface; no trained neural model exists.

The existing v0.3 gate checkpoint is not adapted into document tools.  This
module specifies the future five-brain/addressable-memory boundary and a
typed, variable-candidate encoder.  It deliberately fails closed for neural
action selection until a new document encoder, training run, and reviewed
checkpoint exist.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import math
from typing import Any, Mapping, Sequence

import numpy as np

from .v03_document_evidence import (
    CANDIDATE_SCHEMA,
    DOCUMENT_ACTIONS,
    ProtocolViolation,
    assert_observation_no_hidden_fields,
)


DOCUMENT_POLICY_BACKEND = "v03-five-brain-addressable-memory-interface"
DOCUMENT_MEMORY_SHAPE = (2, 6)
DOCUMENT_PERIPHERAL_COUNT = 4
DOCUMENT_CENTRAL_COUNT = 1
DOCUMENT_TOTAL_BRAINS = DOCUMENT_PERIPHERAL_COUNT + DOCUMENT_CENTRAL_COUNT
FIELD_ID_BYTES = 16
VALUE_BYTES = 16
DOCUMENT_CANDIDATE_FEATURE_DIM = 64
DOCUMENT_REQUEST_FEATURE_DIM = FIELD_ID_BYTES + 9 + 1
VALUE_TYPE_VOCABULARY = (
    "date", "email", "enum", "number", "percentage", "person", "phone", "duration", "ratio"
)
SECTION_KIND_VOCABULARY = ("overview", "commercial", "contacts", "terms")


class DocumentNeuralPolicyUnavailable(RuntimeError):
    """Raised when a caller asks the untrained document model to decide."""


@dataclass(frozen=True)
class DocumentPolicyModelStatus:
    available: bool = False
    reason: str = "requires new document encoder, training, and reviewed checkpoint"
    checkpoint: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "reason": self.reason,
            "checkpoint": self.checkpoint,
        }


def _bounded_utf8(value: Any, width: int) -> list[float]:
    encoded = str(value).encode("utf-8")
    if len(encoded) > width:
        raise ProtocolViolation(f"semantic text exceeds bounded width {width}")
    result = np.zeros(width, dtype=np.float64)
    if encoded:
        result[:len(encoded)] = np.frombuffer(encoded, dtype=np.uint8).astype(np.float64) / 255.0
    return result.tolist()


def _one_hot(value: str, vocabulary: Sequence[str]) -> list[float]:
    return [float(value == item) for item in vocabulary]


def _ordered_date_features(value: Any) -> list[float]:
    try:
        parsed = date.fromisoformat(str(value))
    except ValueError:
        return [0.0, 0.0, 0.0, 0.0]
    epoch = date(1970, 1, 1).toordinal()
    return [
        float((parsed.toordinal() - epoch) / 36525.0),
        float(parsed.year / 10000.0),
        float(parsed.month / 12.0),
        float(parsed.day / 31.0),
    ]


def _typed_value_features(value: Any, value_type: str) -> tuple[list[float], list[float]]:
    """Return bounded value bytes plus ordered numeric/date features.

    Provenance digests and arbitrary hashes are intentionally absent.  A
    numeric value remains ordered, and dates retain an explicitly ordered
    ordinal component rather than a categorical digest.
    """

    value_bytes = _bounded_utf8(value, VALUE_BYTES)
    numeric = [0.0, 0.0]
    if value_type == "date":
        numeric = _ordered_date_features(value)[:2]
    elif value_type in {"number", "ratio", "percentage"}:
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise ProtocolViolation("numeric candidate value is not finite") from exc
        if not math.isfinite(number):
            raise ProtocolViolation("numeric candidate value is not finite")
        bounded = float(np.clip(number, -1_000_000.0, 1_000_000.0))
        numeric = [float(np.tanh(bounded / 1_000_000.0)), bounded]
    return value_bytes, numeric


class DocumentObservationEncoder:
    """Encode typed observations with variable candidate rows and identities."""

    def __init__(self, *, candidate_feature_dim: int = DOCUMENT_CANDIDATE_FEATURE_DIM):
        if type(candidate_feature_dim) is not int or candidate_feature_dim < 57:
            raise ValueError("candidate feature dimension is too small")
        self.candidate_feature_dim = candidate_feature_dim

    def encode_candidates(
        self,
        candidates: Sequence[Mapping[str, Any]],
        *,
        requested_field_ids: Sequence[str] = (),
    ) -> np.ndarray:
        """Return ``(candidate_count, feature_dim)`` without oracle features."""

        assert_observation_no_hidden_fields(list(candidates), requested_field_ids)
        document_indices: dict[str, int] = {}
        section_indices: dict[tuple[str, str], int] = {}
        rows: list[list[float]] = []
        for candidate_index, candidate in enumerate(candidates):
            if not isinstance(candidate, Mapping) or candidate.get("schema") != CANDIDATE_SCHEMA:
                raise ProtocolViolation("unsupported document candidate observation")
            field_id = candidate.get("field_id")
            value_type = candidate.get("value_type")
            section_kind = candidate.get("section_kind")
            handle = candidate.get("document_handle")
            section_id = candidate.get("section_id")
            if not all(isinstance(value, str) and value for value in (field_id, value_type, section_kind, handle, section_id)):
                raise ProtocolViolation("candidate semantic identity is required")
            if value_type not in VALUE_TYPE_VOCABULARY or section_kind not in SECTION_KIND_VOCABULARY:
                raise ProtocolViolation("candidate vocabulary value is unsupported")
            if handle not in document_indices:
                document_indices[handle] = len(document_indices)
            section_key = (handle, section_id)
            if section_key not in section_indices:
                section_indices[section_key] = len(section_indices)
            revision = candidate.get("revision")
            if type(revision) is not int or revision < 1:
                raise ProtocolViolation("candidate revision is invalid")
            value_bytes, typed_numeric = _typed_value_features(candidate.get("value"), value_type)
            row = (
                _bounded_utf8(field_id, FIELD_ID_BYTES)
                + value_bytes
                + _one_hot(value_type, VALUE_TYPE_VOCABULARY)
                + _one_hot(section_kind, SECTION_KIND_VOCABULARY)
                + [
                    float(revision / 16.0),
                    float(candidate.get("revision_state") == "current"),
                    float(bool(candidate.get("conflict_group"))),
                ]
                + _ordered_date_features(candidate.get("published_at"))
                + typed_numeric
                + [
                    float(document_indices[handle]),
                    float(section_indices[section_key]),
                    float(candidate_index / max(1, len(candidates) - 1)),
                ]
            )
            if len(row) > self.candidate_feature_dim or not all(math.isfinite(value) for value in row):
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
            rows.append(
                _bounded_utf8(field_id, FIELD_ID_BYTES)
                + _one_hot(value_type, VALUE_TYPE_VOCABULARY)
                + [float(field.get("revision_rule") == "latest_non_obsolete")]
            )
        if not rows:
            return np.zeros((0, DOCUMENT_REQUEST_FEATURE_DIM), dtype=np.float64)
        result = np.asarray(rows, dtype=np.float64)
        if result.shape != (len(rows), DOCUMENT_REQUEST_FEATURE_DIM) or not np.isfinite(result).all():
            raise ProtocolViolation("invalid initial request encoding")
        return result


class VariableCandidateScorer:
    """Interface for a future scorer over a variable candidate set."""

    def __init__(self, *, encoder: DocumentObservationEncoder | None = None):
        self.encoder = encoder or DocumentObservationEncoder()

    def score(
        self,
        candidates: Sequence[Mapping[str, Any]],
        *,
        requested_field_ids: Sequence[str] = (),
    ) -> np.ndarray:
        self.encoder.encode_candidates(candidates, requested_field_ids=requested_field_ids)
        raise DocumentNeuralPolicyUnavailable(
            "document candidate scorer is unavailable until a new encoder and reviewed checkpoint are trained"
        )


class DocumentPolicyInterface:
    """Structural interface for a future five-brain document policy."""

    backend = DOCUMENT_POLICY_BACKEND
    peripheral_count = DOCUMENT_PERIPHERAL_COUNT
    central_count = DOCUMENT_CENTRAL_COUNT
    total_brains = DOCUMENT_TOTAL_BRAINS
    memory_shape = DOCUMENT_MEMORY_SHAPE
    action_vocabulary = DOCUMENT_ACTIONS
    gate_outputs_are_document_actions = False

    def __init__(
        self,
        *,
        encoder: DocumentObservationEncoder | None = None,
        scorer: VariableCandidateScorer | None = None,
    ):
        self.encoder = encoder or DocumentObservationEncoder()
        self.candidate_scorer = scorer or VariableCandidateScorer(encoder=self.encoder)
        self.model_status = DocumentPolicyModelStatus()

    def specification(self) -> dict[str, Any]:
        return {
            "backend": self.backend,
            "peripheral_count": self.peripheral_count,
            "central_count": self.central_count,
            "total_brains": self.total_brains,
            "memory_shape": list(self.memory_shape),
            "action_vocabulary": list(self.action_vocabulary),
            "legal_action_schemas": {
                "inspect_section": {
                    "operation": "inspect one server-catalogued section",
                    "arguments": {"document_handle": "opaque server handle", "section_id": "catalog section id"},
                },
                "select_candidate": {
                    "operation": "explicitly select one observed candidate",
                    "arguments": {"candidate_id": "episode-local opaque candidate id"},
                },
                "finish": {
                    "operation": "submit entries, missing fields, and/or conflict citations",
                    "arguments": {"packet": "typed evidence packet"},
                },
                "report_missing": {
                    "operation": "submit a typed packet with an explicit missing field",
                    "arguments": {"field_id": "initial-request field id", "packet": "typed evidence packet"},
                },
                "report_conflict": {
                    "operation": "submit a typed packet with all equal-rank conflict citations",
                    "arguments": {"field_id": "initial-request field id", "packet": "typed evidence packet"},
                },
            },
            "phase_rules": {
                "initial_request_only": True,
                "initial_request_contains_field_ids": True,
                "candidate_observations_contain_source_field_ids": True,
                "latest_tool_response_visible": True,
                "remaining_action_budget_visible": True,
                "latest_tool_response_fields": [
                    "phase", "status", "action_count", "remaining_action_budget", "terminal", "candidates", "outcome"
                ],
            },
            "recurrent_snapshot_contract": {
                "schema": "vevo.v03.document-evidence.recurrent-snapshot.v1",
                "memory_shape": list(self.memory_shape),
                "episode_local_identity_relations": [
                    "candidate_id is scoped to one session",
                    "document_handle and section_id are scoped to the initial request",
                    "no cross-episode identity joins",
                ],
                "state_fields": ["memory", "last_tool_response", "remaining_action_budget", "identity_relations"],
                "types": {
                    "memory": "finite_float[2,6]",
                    "last_tool_response": "typed_json_or_null",
                    "remaining_action_budget": "nonnegative_integer",
                    "identity_relations": "episode_local_relation_map",
                },
            },
            "ordered_date_features": ["ordinal_days", "year", "month", "day"],
            "provenance_digests_as_scalar_features": False,
            "arbitrary_value_hashes_as_scalar_features": False,
            "gate_outputs_are_document_actions": self.gate_outputs_are_document_actions,
            "neural_model_available": self.model_status.available,
            "model_status": self.model_status.as_dict(),
            "variable_candidate_set": True,
        }

    def encode_observation(
        self,
        *,
        requested_fields: Sequence[Mapping[str, Any]],
        candidates: Sequence[Mapping[str, Any]],
        requested_field_ids: Sequence[str] = (),
    ) -> dict[str, np.ndarray]:
        return {
            "request_types": self.encoder.encode_request_types(requested_fields),
            "candidates": self.encoder.encode_candidates(
                candidates,
                requested_field_ids=requested_field_ids,
            ),
        }

    def select_action(self, observation: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(observation, Mapping):
            raise ProtocolViolation("document policy observation must be a mapping")
        raise DocumentNeuralPolicyUnavailable(
            "document neural policy is explicitly unavailable; use a verified deterministic baseline"
        )


__all__ = [
    "DOCUMENT_ACTIONS",
    "DOCUMENT_CANDIDATE_FEATURE_DIM",
    "DOCUMENT_MEMORY_SHAPE",
    "DOCUMENT_POLICY_BACKEND",
    "DOCUMENT_REQUEST_FEATURE_DIM",
    "DocumentNeuralPolicyUnavailable",
    "DocumentObservationEncoder",
    "DocumentPolicyInterface",
    "DocumentPolicyModelStatus",
    "VariableCandidateScorer",
]
