"""Bounded, typed tool-synthesis protocol for the v0.3 experiments.

This module is deliberately a small local interpreter, not a general-purpose
language.  It accepts versioned JSON table programs made from typed references
and four pure operations: ``filter``, ``project``, one numeric ``derive``, and
an explicit final output.  It has no import, filesystem, process, shell,
network, reflection, or dynamic-code execution path.

The module is an execution foundation for a future learned decoder.  It does
not train or run that decoder, and it does not select opaque stored templates.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Literal, Mapping, Sequence, TypeAlias


TOOL_SYNTHESIS_CONTRACT_VERSION = "vevo.v03.tool-synthesis.contract.v1"
TOOL_SYNTHESIS_SPEC_SCHEMA = "vevo.v03.tool-synthesis.spec.v1"
TOOL_SYNTHESIS_TABLE_SCHEMA = "vevo.v03.tool-synthesis.table.v1"
TOOL_SYNTHESIS_OUTPUT_SCHEMA = "vevo.v03.tool-synthesis.output.v1"
TOOL_SYNTHESIS_VERSION = 1
MAX_NUMERIC_ABS = 1_000_000.0
MAX_NAME_BYTES = 256


Scalar: TypeAlias = None | bool | int | float | str


class ToolSynthesisError(ValueError):
    """Base error with stable structured serialization."""

    code = "tool_synthesis_error"

    def __init__(self, message: str, **context: Any) -> None:
        super().__init__(message)
        self.message = message
        self.context = dict(context)

    def as_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "context": self.context}


class SpecParseError(ToolSynthesisError):
    code = "spec_parse_error"


class TableValidationError(ToolSynthesisError):
    code = "table_validation_error"


class TypeValidationError(ToolSynthesisError):
    code = "type_error"


class MissingFieldError(ToolSynthesisError):
    code = "missing_field"


class NumericValidationError(ToolSynthesisError):
    code = "numeric_error"


class UnsupportedOperationError(ToolSynthesisError):
    code = "unsupported_operation"


class ResourceLimitError(ToolSynthesisError):
    code = "resource_limit"

    def __init__(self, resource: str, observed: int, limit: int) -> None:
        super().__init__(
            f"{resource} limit exceeded: observed {observed}, limit {limit}",
            resource=resource,
            observed=observed,
            limit=limit,
        )
        self.resource = resource
        self.observed = observed
        self.limit = limit


def _raise_nonfinite(value: Any, *, label: str) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise NumericValidationError(f"{label} must be finite")


def _is_scalar(value: Any) -> bool:
    if value is None or isinstance(value, (bool, str)):
        return True
    if type(value) is int:
        return abs(value) <= MAX_NUMERIC_ABS
    if type(value) is float:
        return math.isfinite(value) and abs(value) <= MAX_NUMERIC_ABS
    return False


def _validate_scalar(value: Any, *, label: str) -> Scalar:
    if not _is_scalar(value):
        _raise_nonfinite(value, label=label)
        raise TableValidationError(
            f"{label} must be a bounded scalar JSON value",
            label=label,
        )
    return value


def _validate_name(value: Any, *, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise SpecParseError(f"{label} must be a non-empty string", label=label)
    if len(value.encode("utf-8")) > MAX_NAME_BYTES:
        raise SpecParseError(f"{label} is too long", label=label)
    return value


@dataclass(frozen=True, slots=True)
class FieldRef:
    name: str


@dataclass(frozen=True, slots=True)
class ConstantRef:
    name: str


Ref: TypeAlias = FieldRef | ConstantRef


@dataclass(frozen=True, slots=True)
class OutputColumn:
    source: Ref
    name: str


@dataclass(frozen=True, slots=True)
class FilterOp:
    left: Ref
    operator: str
    right: Ref


@dataclass(frozen=True, slots=True)
class ProjectOp:
    columns: tuple[OutputColumn, ...]


@dataclass(frozen=True, slots=True)
class DeriveOp:
    name: str
    left: Ref
    operator: str
    right: Ref


@dataclass(frozen=True, slots=True)
class ExplicitOutputOp:
    columns: tuple[OutputColumn, ...]


Operation: TypeAlias = FilterOp | ProjectOp | DeriveOp | ExplicitOutputOp


@dataclass(frozen=True, slots=True)
class ToolSpec:
    schema: str
    version: int
    name: str
    constants: Mapping[str, Scalar]
    operations: tuple[Operation, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "constants", MappingProxyType(dict(self.constants)))


@dataclass(frozen=True, slots=True)
class Table:
    schema: str
    columns: tuple[str, ...]
    rows: tuple[tuple[Scalar, ...], ...]

    def as_mapping(self, *, output: bool = False) -> dict[str, Any]:
        schema = TOOL_SYNTHESIS_OUTPUT_SCHEMA if output else self.schema
        return {
            "schema": schema,
            "columns": list(self.columns),
            "rows": [
                {column: value for column, value in zip(self.columns, row)}
                for row in self.rows
            ],
        }


@dataclass(frozen=True, slots=True)
class ResourceLimits:
    max_input_bytes: int = 64 * 1024
    max_input_tokens: int = 4096
    max_spec_bytes: int = 32 * 1024
    max_spec_tokens: int = 1024
    max_literals: int = 64
    max_literal_bytes: int = 4096
    max_ast_nodes: int = 256
    max_steps: int = 4096
    max_output_bytes: int = 64 * 1024

    def __post_init__(self) -> None:
        values = (
            ("max_input_bytes", self.max_input_bytes),
            ("max_input_tokens", self.max_input_tokens),
            ("max_spec_bytes", self.max_spec_bytes),
            ("max_spec_tokens", self.max_spec_tokens),
            ("max_literals", self.max_literals),
            ("max_literal_bytes", self.max_literal_bytes),
            ("max_ast_nodes", self.max_ast_nodes),
            ("max_steps", self.max_steps),
            ("max_output_bytes", self.max_output_bytes),
        )
        for name, value in values:
            if type(value) is not int or value <= 0:
                raise ValueError(f"{name} must be a positive integer")


DEFAULT_RESOURCE_LIMITS = ResourceLimits()


@dataclass(frozen=True, slots=True)
class ResourceUsage:
    input_bytes: int = 0
    input_tokens: int = 0
    spec_bytes: int = 0
    spec_tokens: int = 0
    literal_count: int = 0
    literal_bytes: int = 0
    ast_nodes: int = 0
    steps: int = 0
    output_bytes: int = 0
    output_tokens: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "input_bytes": self.input_bytes,
            "input_tokens": self.input_tokens,
            "spec_bytes": self.spec_bytes,
            "spec_tokens": self.spec_tokens,
            "literal_count": self.literal_count,
            "literal_bytes": self.literal_bytes,
            "ast_nodes": self.ast_nodes,
            "steps": self.steps,
            "output_bytes": self.output_bytes,
            "output_tokens": self.output_tokens,
        }


@dataclass(slots=True)
class _UsageCounter:
    input_bytes: int = 0
    input_tokens: int = 0
    spec_bytes: int = 0
    spec_tokens: int = 0
    literal_count: int = 0
    literal_bytes: int = 0
    ast_nodes: int = 0
    steps: int = 0
    output_bytes: int = 0
    output_tokens: int = 0

    def snapshot(self) -> ResourceUsage:
        return ResourceUsage(
            input_bytes=self.input_bytes,
            input_tokens=self.input_tokens,
            spec_bytes=self.spec_bytes,
            spec_tokens=self.spec_tokens,
            literal_count=self.literal_count,
            literal_bytes=self.literal_bytes,
            ast_nodes=self.ast_nodes,
            steps=self.steps,
            output_bytes=self.output_bytes,
            output_tokens=self.output_tokens,
        )


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    status: Literal["success", "failure"]
    output_table: Mapping[str, Any] | None
    output_bytes: bytes | None
    usage: ResourceUsage
    error: Mapping[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "output_table": self.output_table,
            "output_bytes": self.output_bytes.decode("utf-8") if self.output_bytes else None,
            "usage": self.usage.as_dict(),
            "error": self.error,
        }


_COMPARISON_OPERATORS = frozenset({"eq", "ne", "lt", "le", "gt", "ge"})
_ARITHMETIC_OPERATORS = frozenset({"add", "sub", "mul", "div"})
_OPERATION_KEYS = {
    "filter": frozenset({"op", "left", "operator", "right"}),
    "project": frozenset({"op", "columns"}),
    "derive": frozenset({"op", "as", "left", "operator", "right"}),
    "explicit_output": frozenset({"op", "columns"}),
}


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise SpecParseError("duplicate JSON object key", key=key)
        result[key] = value
    return result


def _reject_json_constant(value: str) -> Any:
    raise SpecParseError("non-finite JSON number is not permitted", value=value)


def _load_json_document(document: bytes | str, *, label: str) -> tuple[Any, bytes]:
    if isinstance(document, bytes):
        raw = document
        try:
            text = document.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise SpecParseError(f"{label} must be UTF-8 JSON") from exc
    elif isinstance(document, str):
        raw = document.encode("utf-8")
        text = document
    else:
        raise SpecParseError(f"{label} must be bytes or str JSON", label=label)
    try:
        value = json.loads(
            text,
            object_pairs_hook=_reject_duplicate_pairs,
            parse_constant=_reject_json_constant,
        )
    except ToolSynthesisError:
        raise
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise SpecParseError(f"{label} is not valid JSON", label=label) from exc
    return value, raw


def _json_token_count(value: Any) -> int:
    """Count one token for each scalar/key/container in canonical JSON data."""

    if isinstance(value, dict):
        return 1 + sum(1 + _json_token_count(item) for item in value.values())
    if isinstance(value, list):
        return 1 + sum(_json_token_count(item) for item in value)
    return 1


def _literal_stats(value: Any) -> tuple[int, int]:
    """Return scalar literal count and canonical byte size, excluding object keys."""

    if isinstance(value, dict):
        counts = [_literal_stats(item) for item in value.values()]
        return sum(item[0] for item in counts), sum(item[1] for item in counts)
    if isinstance(value, list):
        counts = [_literal_stats(item) for item in value]
        return sum(item[0] for item in counts), sum(item[1] for item in counts)
    return 1, len(_canonical_json_bytes(value))


def _canonical_json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ToolSynthesisError("value cannot be canonically serialized") from exc


def _validate_reference(value: Any, constants: Mapping[str, Scalar]) -> Ref:
    if not isinstance(value, dict) or set(value) != {"kind", "name"}:
        raise SpecParseError("reference must have exactly kind and name")
    kind = value["kind"]
    name = _validate_name(value["name"], label="reference name")
    if kind == "field":
        return FieldRef(name)
    if kind == "constant":
        if name not in constants:
            raise SpecParseError("constant reference is unresolved", name=name)
        return ConstantRef(name)
    raise SpecParseError("reference kind is unsupported", kind=kind)


def _validate_output_columns(value: Any, constants: Mapping[str, Scalar]) -> tuple[OutputColumn, ...]:
    if not isinstance(value, list) or not value:
        raise SpecParseError("output columns must be a non-empty list")
    result: list[OutputColumn] = []
    names: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {"source", "as"}:
            raise SpecParseError("output column must have source and as")
        name = _validate_name(item["as"], label="output alias")
        if name in names:
            raise SpecParseError("output aliases must be unique", name=name)
        names.add(name)
        result.append(OutputColumn(_validate_reference(item["source"], constants), name))
    return tuple(result)


def _parse_operation(value: Any, constants: Mapping[str, Scalar]) -> Operation:
    if not isinstance(value, dict) or "op" not in value:
        raise SpecParseError("operation must be a JSON object with op")
    kind = value["op"]
    if kind not in _OPERATION_KEYS:
        raise UnsupportedOperationError("operation is unsupported", operation=kind)
    if set(value) != _OPERATION_KEYS[kind]:
        raise SpecParseError("operation has unexpected or missing fields", operation=kind)
    if kind == "filter":
        operator = value["operator"]
        if operator not in _COMPARISON_OPERATORS:
            raise SpecParseError("filter operator is unsupported", operator=operator)
        return FilterOp(
            _validate_reference(value["left"], constants),
            operator,
            _validate_reference(value["right"], constants),
        )
    if kind == "project":
        return ProjectOp(_validate_output_columns(value["columns"], constants))
    if kind == "derive":
        operator = value["operator"]
        if operator not in _ARITHMETIC_OPERATORS:
            raise SpecParseError("derive operator is unsupported", operator=operator)
        return DeriveOp(
            _validate_name(value["as"], label="derived field"),
            _validate_reference(value["left"], constants),
            operator,
            _validate_reference(value["right"], constants),
        )
    return ExplicitOutputOp(_validate_output_columns(value["columns"], constants))


def _spec_from_mapping(value: Any) -> ToolSpec:
    if not isinstance(value, dict):
        raise SpecParseError("specification must be a JSON object")
    required = {"schema", "version", "name", "constants", "operations"}
    if set(value) != required:
        raise SpecParseError("specification has unexpected or missing fields")
    if value["schema"] != TOOL_SYNTHESIS_SPEC_SCHEMA:
        raise SpecParseError("specification schema is unsupported", schema=value["schema"])
    if type(value["version"]) is not int or value["version"] != TOOL_SYNTHESIS_VERSION:
        raise SpecParseError("specification version is unsupported", version=value["version"])
    name = _validate_name(value["name"], label="specification name")
    constants_value = value["constants"]
    if not isinstance(constants_value, dict):
        raise SpecParseError("constants must be a JSON object")
    constants: dict[str, Scalar] = {}
    for key, item in constants_value.items():
        constant_name = _validate_name(key, label="constant name")
        if constant_name in constants:
            raise SpecParseError("constant names must be unique", name=constant_name)
        constants[constant_name] = _validate_scalar(item, label=f"constant {constant_name}")
    operations_value = value["operations"]
    if not isinstance(operations_value, list) or not operations_value:
        raise SpecParseError("operations must be a non-empty list")
    operations = tuple(_parse_operation(item, constants) for item in operations_value)
    explicit_positions = [index for index, operation in enumerate(operations) if isinstance(operation, ExplicitOutputOp)]
    if len(explicit_positions) != 1 or explicit_positions[0] != len(operations) - 1:
        raise SpecParseError("exactly one explicit_output must be final")
    filter_positions = [index for index, operation in enumerate(operations) if isinstance(operation, FilterOp)]
    project_positions = [index for index, operation in enumerate(operations) if isinstance(operation, ProjectOp)]
    if filter_positions and project_positions and filter_positions[0] > project_positions[0]:
        raise SpecParseError("filter must precede project")
    if sum(isinstance(operation, DeriveOp) for operation in operations) > 1:
        raise SpecParseError("only one derive operation is permitted")
    return ToolSpec(
        schema=TOOL_SYNTHESIS_SPEC_SCHEMA,
        version=TOOL_SYNTHESIS_VERSION,
        name=name,
        constants=constants,
        operations=operations,
    )


def _reference_mapping(reference: Ref) -> dict[str, str]:
    if isinstance(reference, FieldRef):
        return {"kind": "field", "name": reference.name}
    return {"kind": "constant", "name": reference.name}


def _output_column_mapping(column: OutputColumn) -> dict[str, Any]:
    return {"source": _reference_mapping(column.source), "as": column.name}


def _operation_mapping(operation: Operation) -> dict[str, Any]:
    if isinstance(operation, FilterOp):
        return {
            "op": "filter",
            "left": _reference_mapping(operation.left),
            "operator": operation.operator,
            "right": _reference_mapping(operation.right),
        }
    if isinstance(operation, ProjectOp):
        return {"op": "project", "columns": [_output_column_mapping(item) for item in operation.columns]}
    if isinstance(operation, DeriveOp):
        return {
            "op": "derive",
            "as": operation.name,
            "left": _reference_mapping(operation.left),
            "operator": operation.operator,
            "right": _reference_mapping(operation.right),
        }
    return {"op": "explicit_output", "columns": [_output_column_mapping(item) for item in operation.columns]}


def spec_to_mapping(spec: ToolSpec) -> dict[str, Any]:
    if not isinstance(spec, ToolSpec):
        raise SpecParseError("spec must be a ToolSpec")
    mapping = {
        "schema": spec.schema,
        "version": spec.version,
        "name": spec.name,
        "constants": dict(spec.constants),
        "operations": [_operation_mapping(operation) for operation in spec.operations],
    }
    _spec_from_mapping(mapping)
    return mapping


def serialize_spec(spec: ToolSpec) -> bytes:
    return _canonical_json_bytes(spec_to_mapping(spec))


def parse_spec(document: bytes | str, *, limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS) -> ToolSpec:
    value, raw = _load_json_document(document, label="specification")
    if len(raw) > limits.max_spec_bytes:
        raise ResourceLimitError("spec_bytes", len(raw), limits.max_spec_bytes)
    token_count = _json_token_count(value)
    if token_count > limits.max_spec_tokens:
        raise ResourceLimitError("spec_tokens", token_count, limits.max_spec_tokens)
    literal_count, literal_bytes = _literal_stats(value)
    if literal_count > limits.max_literals:
        raise ResourceLimitError("literal_count", literal_count, limits.max_literals)
    if literal_bytes > limits.max_literal_bytes:
        raise ResourceLimitError("literal_bytes", literal_bytes, limits.max_literal_bytes)
    spec = _spec_from_mapping(value)
    ast_nodes = _estimate_ast_nodes(spec)
    if ast_nodes > limits.max_ast_nodes:
        raise ResourceLimitError("ast_nodes", ast_nodes, limits.max_ast_nodes)
    return spec


def _estimate_ast_nodes(spec: ToolSpec) -> int:
    count = 1 + len(spec.constants)
    for operation in spec.operations:
        count += 1
        if isinstance(operation, FilterOp):
            count += 2
        elif isinstance(operation, (ProjectOp, ExplicitOutputOp)):
            count += len(operation.columns)
        else:
            count += 2
    return count


def _validate_table_mapping(value: Any, *, expected_schema: str = TOOL_SYNTHESIS_TABLE_SCHEMA) -> Table:
    if not isinstance(value, dict):
        raise TableValidationError("table must be a JSON object")
    if set(value) != {"schema", "columns", "rows"}:
        raise TableValidationError("table has unexpected or missing fields")
    if value["schema"] != expected_schema:
        raise TableValidationError("table schema is unsupported", schema=value["schema"])
    columns_value = value["columns"]
    if not isinstance(columns_value, list) or not columns_value:
        raise TableValidationError("table columns must be a non-empty list")
    columns: list[str] = []
    for item in columns_value:
        if not isinstance(item, str) or not item:
            raise TableValidationError("table column names must be non-empty strings")
        if item in columns:
            raise TableValidationError("table column names must be unique", column=item)
        columns.append(item)
    rows_value = value["rows"]
    if not isinstance(rows_value, list):
        raise TableValidationError("table rows must be a list")
    rows: list[tuple[Scalar, ...]] = []
    for row_index, row_value in enumerate(rows_value):
        if not isinstance(row_value, dict) or set(row_value) != set(columns):
            raise TableValidationError("each row must contain exactly the declared columns", row=row_index)
        rows.append(
            tuple(_validate_scalar(row_value[column], label=f"row {row_index} column {column}") for column in columns)
        )
    return Table(expected_schema, tuple(columns), tuple(rows))


def validate_table(
    table: bytes | str | Mapping[str, Any],
    *,
    limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS,
) -> Table:
    if isinstance(table, (bytes, str)):
        value, raw = _load_json_document(table, label="table")
    elif isinstance(table, Mapping):
        value = dict(table)
        raw = _canonical_json_bytes(value)
    else:
        raise TableValidationError("table must be JSON bytes, str, or mapping")
    if len(raw) > limits.max_input_bytes:
        raise ResourceLimitError("input_bytes", len(raw), limits.max_input_bytes)
    token_count = _json_token_count(value)
    if token_count > limits.max_input_tokens:
        raise ResourceLimitError("input_tokens", token_count, limits.max_input_tokens)
    return _validate_table_mapping(value)


def _enforce_limit(resource: str, observed: int, limit: int) -> None:
    if observed > limit:
        raise ResourceLimitError(resource, observed, limit)


def _resolve_reference(
    reference: Ref,
    columns: tuple[str, ...],
    row: tuple[Scalar, ...],
    constants: Mapping[str, Scalar],
) -> Scalar:
    if isinstance(reference, ConstantRef):
        return constants[reference.name]
    try:
        index = columns.index(reference.name)
    except ValueError as exc:
        raise MissingFieldError("field is missing from the current table", field=reference.name) from exc
    return row[index]


def _numeric(value: Scalar, *, label: str) -> int | float:
    if isinstance(value, bool) or type(value) not in (int, float):
        raise TypeValidationError(f"{label} must be numeric", label=label)
    if not math.isfinite(float(value)) or abs(float(value)) > MAX_NUMERIC_ABS:
        raise NumericValidationError(f"{label} is outside the finite numeric bound", label=label)
    return value


def _compare(left: Scalar, right: Scalar, operator: str) -> bool:
    if operator in {"eq", "ne"}:
        same_numeric = (
            isinstance(left, (int, float))
            and not isinstance(left, bool)
            and isinstance(right, (int, float))
            and not isinstance(right, bool)
        )
        if type(left) is not type(right) and not same_numeric:
            result = False
        else:
            result = left == right
        return result if operator == "eq" else not result
    if isinstance(left, bool) or isinstance(right, bool):
        raise TypeValidationError("ordering booleans is unsupported")
    both_numbers = type(left) in (int, float) and type(right) in (int, float)
    both_strings = isinstance(left, str) and isinstance(right, str)
    if not (both_numbers or both_strings):
        raise TypeValidationError("ordering requires two strings or two numbers")
    if operator == "lt":
        return left < right  # type: ignore[operator]
    if operator == "le":
        return left <= right  # type: ignore[operator]
    if operator == "gt":
        return left > right  # type: ignore[operator]
    return left >= right  # type: ignore[operator]


def _derive(left: Scalar, right: Scalar, operator: str) -> int | float:
    left_number = _numeric(left, label="derive left operand")
    right_number = _numeric(right, label="derive right operand")
    if operator == "add":
        value = left_number + right_number
    elif operator == "sub":
        value = left_number - right_number
    elif operator == "mul":
        value = left_number * right_number
    else:
        if right_number == 0:
            raise NumericValidationError("derive division by zero")
        value = left_number / right_number
    if not math.isfinite(float(value)) or abs(float(value)) > MAX_NUMERIC_ABS:
        raise NumericValidationError("derived value is outside the finite numeric bound")
    return value


def _execute_columns(
    columns: tuple[OutputColumn, ...],
    current_columns: tuple[str, ...],
    rows: tuple[tuple[Scalar, ...], ...],
    constants: Mapping[str, Scalar],
) -> tuple[tuple[str, ...], tuple[tuple[Scalar, ...], ...]]:
    names = tuple(item.name for item in columns)
    result_rows = tuple(
        tuple(_resolve_reference(item.source, current_columns, row, constants) for item in columns)
        for row in rows
    )
    return names, result_rows


def execute(
    spec: ToolSpec,
    table: bytes | str | Mapping[str, Any],
    limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS,
) -> ExecutionResult:
    usage = _UsageCounter()
    try:
        if not isinstance(spec, ToolSpec):
            raise SpecParseError("spec must be a parsed ToolSpec")
        spec_mapping = spec_to_mapping(spec)
        spec_bytes = _canonical_json_bytes(spec_mapping)
        usage.spec_bytes = len(spec_bytes)
        usage.spec_tokens = _json_token_count(spec_mapping)
        spec_literals, spec_literal_bytes = _literal_stats(spec_mapping)
        usage.literal_count = spec_literals
        usage.literal_bytes = spec_literal_bytes
        _enforce_limit("spec_bytes", usage.spec_bytes, limits.max_spec_bytes)
        _enforce_limit("spec_tokens", usage.spec_tokens, limits.max_spec_tokens)
        _enforce_limit("ast_nodes", _estimate_ast_nodes(spec), limits.max_ast_nodes)

        if isinstance(table, (bytes, str)):
            table_value, table_raw = _load_json_document(table, label="table")
        elif isinstance(table, Mapping):
            table_value = dict(table)
            table_raw = _canonical_json_bytes(table_value)
        else:
            raise TableValidationError("table must be JSON bytes, str, or mapping")
        usage.input_bytes = len(table_raw)
        usage.input_tokens = _json_token_count(table_value)
        table_literals, table_literal_bytes = _literal_stats(table_value)
        usage.literal_count += table_literals
        usage.literal_bytes += table_literal_bytes
        _enforce_limit("input_bytes", usage.input_bytes, limits.max_input_bytes)
        _enforce_limit("input_tokens", usage.input_tokens, limits.max_input_tokens)
        _enforce_limit("literal_count", usage.literal_count, limits.max_literals)
        _enforce_limit("literal_bytes", usage.literal_bytes, limits.max_literal_bytes)
        current_table = _validate_table_mapping(table_value)

        current_columns = current_table.columns
        current_rows = current_table.rows
        explicit_output: ExplicitOutputOp | None = None
        for operation in spec.operations:
            usage.steps += 1
            _enforce_limit("steps", usage.steps, limits.max_steps)
            if isinstance(operation, FilterOp):
                retained: list[tuple[Scalar, ...]] = []
                for row in current_rows:
                    usage.steps += 1
                    _enforce_limit("steps", usage.steps, limits.max_steps)
                    if _compare(
                        _resolve_reference(operation.left, current_columns, row, spec.constants),
                        _resolve_reference(operation.right, current_columns, row, spec.constants),
                        operation.operator,
                    ):
                        retained.append(row)
                current_rows = tuple(retained)
            elif isinstance(operation, ProjectOp):
                usage.steps += len(current_rows)
                _enforce_limit("steps", usage.steps, limits.max_steps)
                current_columns, current_rows = _execute_columns(
                    operation.columns, current_columns, current_rows, spec.constants
                )
            elif isinstance(operation, DeriveOp):
                if operation.name in current_columns:
                    raise TypeValidationError("derived field already exists", field=operation.name)
                derived_rows: list[tuple[Scalar, ...]] = []
                for row in current_rows:
                    usage.steps += 1
                    _enforce_limit("steps", usage.steps, limits.max_steps)
                    derived = _derive(
                        _resolve_reference(operation.left, current_columns, row, spec.constants),
                        _resolve_reference(operation.right, current_columns, row, spec.constants),
                        operation.operator,
                    )
                    derived_rows.append(row + (derived,))
                current_columns = current_columns + (operation.name,)
                current_rows = tuple(derived_rows)
            else:
                explicit_output = operation
        if explicit_output is None:
            raise SpecParseError("specification has no explicit output")
        output_columns, output_rows = _execute_columns(
            explicit_output.columns, current_columns, current_rows, spec.constants
        )
        output_table = Table(TOOL_SYNTHESIS_OUTPUT_SCHEMA, output_columns, output_rows)
        output_mapping = output_table.as_mapping(output=True)
        output_bytes = _canonical_json_bytes(output_mapping)
        usage.output_bytes = len(output_bytes)
        usage.output_tokens = _json_token_count(output_mapping)
        _enforce_limit("output_bytes", usage.output_bytes, limits.max_output_bytes)
        return ExecutionResult("success", output_mapping, output_bytes, usage.snapshot())
    except ToolSynthesisError as exc:
        return ExecutionResult("failure", None, None, usage.snapshot(), exc.as_dict())
    except (TypeError, ValueError, OverflowError) as exc:
        error = ToolSynthesisError("execution rejected an invalid value", detail=str(exc))
        return ExecutionResult("failure", None, None, usage.snapshot(), error.as_dict())


__all__ = [
    "ConstantRef",
    "DEFAULT_RESOURCE_LIMITS",
    "DeriveOp",
    "ExplicitOutputOp",
    "ExecutionResult",
    "FieldRef",
    "FilterOp",
    "MAX_NUMERIC_ABS",
    "MissingFieldError",
    "OutputColumn",
    "ProjectOp",
    "ResourceLimitError",
    "ResourceLimits",
    "ResourceUsage",
    "SpecParseError",
    "Table",
    "TableValidationError",
    "TOOL_SYNTHESIS_CONTRACT_VERSION",
    "TOOL_SYNTHESIS_OUTPUT_SCHEMA",
    "TOOL_SYNTHESIS_SPEC_SCHEMA",
    "TOOL_SYNTHESIS_TABLE_SCHEMA",
    "ToolSpec",
    "ToolSynthesisError",
    "TypeValidationError",
    "execute",
    "parse_spec",
    "serialize_spec",
    "spec_to_mapping",
    "validate_table",
]
