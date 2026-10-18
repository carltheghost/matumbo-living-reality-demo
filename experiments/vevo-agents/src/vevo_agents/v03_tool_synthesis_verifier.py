"""Independent development-gold verifier for the bounded tool protocol."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping

from .v03_tool_synthesis import (
    ExecutionResult,
    ToolSpec,
    execute,
    parse_spec,
)


@dataclass(frozen=True, slots=True)
class GoldCase:
    case_id: str
    input_table: Mapping[str, Any]
    expected_output: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class CaseVerification:
    case_id: str
    passed: bool
    expected_bytes: bytes
    observed_bytes: bytes | None
    error: Mapping[str, Any] | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "passed": self.passed,
            "expected_bytes": self.expected_bytes.decode("utf-8"),
            "observed_bytes": self.observed_bytes.decode("utf-8") if self.observed_bytes else None,
            "error": self.error,
        }


@dataclass(frozen=True, slots=True)
class VerificationReport:
    status: str
    purpose: str
    complete_benchmark: bool
    cases: tuple[CaseVerification, ...]

    @property
    def passed(self) -> bool:
        return self.status == "passed"

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "purpose": self.purpose,
            "complete_benchmark": self.complete_benchmark,
            "cases": [case.as_dict() for case in self.cases],
        }


def _independent_canonical_bytes(value: Any) -> bytes:
    """Canonicalize expected/observed values without using the interpreter serializer."""

    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def verify_gold_cases(
    spec: ToolSpec,
    cases: tuple[GoldCase, ...],
) -> VerificationReport:
    if not cases:
        return VerificationReport(
            status="inconclusive",
            purpose="tiny explicit development gold cases",
            complete_benchmark=False,
            cases=(),
        )
    results: list[CaseVerification] = []
    for case in cases:
        result: ExecutionResult = execute(spec, case.input_table)
        expected_bytes = _independent_canonical_bytes(case.expected_output)
        observed_bytes = (
            _independent_canonical_bytes(result.output_table)
            if result.output_table is not None
            else None
        )
        output_bytes_consistent = (
            result.output_bytes is not None
            and observed_bytes is not None
            and result.output_bytes == observed_bytes
        )
        passed = result.status == "success" and output_bytes_consistent and observed_bytes == expected_bytes
        error = None if passed else (result.error or {"code": "output_mismatch"})
        if not passed and result.status == "success":
            error = {
                "code": "output_mismatch",
                "expected_bytes": expected_bytes.decode("utf-8"),
                "observed_bytes": observed_bytes.decode("utf-8") if observed_bytes else None,
                "execution_output_bytes": result.output_bytes.decode("utf-8") if result.output_bytes else None,
                "output_bytes_consistent": output_bytes_consistent,
            }
        results.append(CaseVerification(case.case_id, passed, expected_bytes, observed_bytes, error))
    return VerificationReport(
        status="passed" if all(case.passed for case in results) else "failed",
        purpose="tiny explicit development gold cases",
        complete_benchmark=False,
        cases=tuple(results),
    )


DEVELOPMENT_SPEC_DOCUMENT = json.dumps(
    {
        "schema": "vevo.v03.tool-synthesis.spec.v1",
        "version": 1,
        "name": "development-score-adjustment",
        "constants": {"threshold": 2, "bonus": 1},
        "operations": [
            {
                "op": "filter",
                "left": {"kind": "field", "name": "score"},
                "operator": "ge",
                "right": {"kind": "constant", "name": "threshold"},
            },
            {
                "op": "project",
                "columns": [
                    {"source": {"kind": "field", "name": "id"}, "as": "id"},
                    {"source": {"kind": "field", "name": "score"}, "as": "score"},
                ],
            },
            {
                "op": "derive",
                "as": "adjusted",
                "left": {"kind": "field", "name": "score"},
                "operator": "add",
                "right": {"kind": "constant", "name": "bonus"},
            },
            {
                "op": "explicit_output",
                "columns": [
                    {"source": {"kind": "field", "name": "id"}, "as": "id"},
                    {"source": {"kind": "field", "name": "adjusted"}, "as": "adjusted"},
                ],
            },
        ],
    },
    ensure_ascii=False,
    sort_keys=True,
    separators=(",", ":"),
)

DEVELOPMENT_GOLD_CASES = (
    GoldCase(
        case_id="duplicate-retained-order",
        input_table={
            "schema": "vevo.v03.tool-synthesis.table.v1",
            "columns": ["id", "score", "label"],
            "rows": [
                {"id": "a", "score": 3, "label": "keep"},
                {"id": "b", "score": 1, "label": "drop"},
                {"id": "a", "score": 3, "label": "keep"},
            ],
        },
        expected_output={
            "schema": "vevo.v03.tool-synthesis.output.v1",
            "columns": ["id", "adjusted"],
            "rows": [{"id": "a", "adjusted": 4}, {"id": "a", "adjusted": 4}],
        },
    ),
    GoldCase(
        case_id="empty-development-schema",
        input_table={
            "schema": "vevo.v03.tool-synthesis.table.v1",
            "columns": ["id", "score", "label"],
            "rows": [],
        },
        expected_output={
            "schema": "vevo.v03.tool-synthesis.output.v1",
            "columns": ["id", "adjusted"],
            "rows": [],
        },
    ),
)


def development_spec() -> ToolSpec:
    return parse_spec(DEVELOPMENT_SPEC_DOCUMENT)


__all__ = [
    "CaseVerification",
    "DEVELOPMENT_GOLD_CASES",
    "DEVELOPMENT_SPEC_DOCUMENT",
    "GoldCase",
    "VerificationReport",
    "development_spec",
    "verify_gold_cases",
]
