"""Future document-policy boundary; the document neural model is unavailable.

The existing v0.3 five-brain checkpoint was trained for continuous gate
physics.  It is intentionally not adapted into document tools.  This module
defines the shape of a future document encoder and scorer while failing closed
for neural decisions until a new encoder, training run, and reviewed
checkpoint exist.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import math
from typing import Any, Mapping, Sequence

import numpy as np

from .v03_document_evidence import (
    CANDIDATE_SCHEMA,
    ProtocolViolation,
    assert_observation_no_hidden_fields,
)


DOCUMENT_ACTIONS = ("inspect_section", "select_candidate", "finish", "report_missing")
DOCUMENT_POLICY_BACKEND = "v03-five-brain-addressable-memory-interface"
DOCUMENT_MEMORY_SHAPE = (2, 6)
DOCUMENT_PERIPHERAL_COUNT = 4
DOCUMENT_CENTRAL_COUNT = 1
DOCUMENT_TOTAL_BRAINS = DOCUMENT_PERIPHERAL_COUNT + DOCUMENT_CENTRAL_COUNT
DOCUMENT_CANDIDATE_FEATURE_DIM = 16


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


def _stable_unit(value: str) -> float:
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    integer = int.from_bytes(digest[:8], "big")
    return float(integer / ((1 << 64) - 1))


class DocumentObservationEncoder:
    """Encode typed, observed candidates without requested-field labels."""

    def __init__(self, *, candidate_feature_dim: int = DOCUMENT_CANDIDATE_FEATURE_DIM):
        if type(candidate_feature_dim) is not int or candidate_feature_dim < 12:
            raise ValueError("candidate feature dimension is too small")
        self.candidate_feature_dim = candidate_feature_dim

    def encode_candidates(
        self,
        candidates: Sequence[Mapping[str, Any]],
        *,
        requested_field_ids: Sequence[str] = (),
    ) -> np.ndarray:
        """Return ``(candidate_count, feature_dim)``; candidate count is variable."""

        assert_observation_no_hidden_fields(list(candidates), requested_field_ids)
        rows: list[list[float]] = []
        for candidate in candidates:
            if not isinstance(candidate, Mapping) or candidate.get("schema") != CANDIDATE_SCHEMA:
                raise ProtocolViolation("unsupported document candidate observation")
            value_type = candidate.get("value_type")
            if not isinstance(value_type, str):
                raise ProtocolViolation("candidate value_type is required")
            row = [
                _stable_unit(value_type),
                _stable_unit(str(candidate.get("section_kind", ""))),
                _stable_unit(str(candidate.get("document_handle", ""))),
                _stable_unit(str(candidate.get("section_id", ""))),
                float(candidate.get("revision", 0)) / 16.0,
                float(candidate.get("revision_state") == "current"),
                _stable_unit(str(candidate.get("published_at", ""))),
                _stable_unit(str(candidate.get("conflict_group") or "none")),
                _stable_unit(str(candidate.get("value"))),
                _stable_unit(str(candidate.get("fact_digest", ""))),
                _stable_unit(str(candidate.get("source_sha256", ""))),
                float(len(str(candidate.get("candidate_id", "")))) / 64.0,
            ]
            if not all(math.isfinite(value) for value in row):
                raise ProtocolViolation("non-finite candidate feature")
            row.extend([0.0] * (self.candidate_feature_dim - len(row)))
            rows.append(row)
        result = np.asarray(rows, dtype=np.float64)
        if not rows:
            result = np.zeros((0, self.candidate_feature_dim), dtype=np.float64)
        if result.shape != (len(rows), self.candidate_feature_dim) or not np.isfinite(result).all():
            raise ProtocolViolation("invalid variable candidate encoding")
        return result

    def encode_request_types(self, requested_fields: Sequence[Mapping[str, Any]]) -> np.ndarray:
        """Encode initial request types while intentionally ignoring field labels."""

        rows = []
        for field in requested_fields:
            if not isinstance(field, Mapping) or not isinstance(field.get("value_type"), str):
                raise ProtocolViolation("invalid initial request type")
            rows.append([
                _stable_unit(str(field["value_type"])),
                _stable_unit(str(field.get("revision_rule", ""))),
            ])
        result = np.asarray(rows, dtype=np.float64)
        if not rows:
            result = np.zeros((0, 2), dtype=np.float64)
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
    """Structural interface for five-brain document policy integration."""

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
    "DocumentNeuralPolicyUnavailable",
    "DocumentObservationEncoder",
    "DocumentPolicyInterface",
    "DocumentPolicyModelStatus",
    "VariableCandidateScorer",
]
