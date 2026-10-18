# v0.1 bounded tool-synthesis contract

**Title:** v0.1 Stage 1 typed tool synthesis and local specialist boundary

## Metadata

- **Author:** Codex
- **Date:** 2026-10-18
- **Status:** implementation-ready
- Version: `vevo.v03.tool-synthesis.contract.v1`
- Owner: `vevo-agents`
- Review gate: local source review before any training

## Context

The hybrid-core experiment needs a small, reviewable path from a future learned decoder to executable tools. Stage 1 is a deterministic execution and verification foundation. It is not a trained model, a benchmark, or a claim that a neural decoder can yet synthesize useful programs.

The contract represents pure transformations over a bounded JSON table. A program is a structured JSON specification with a typed abstract syntax tree (AST). The only executable operations are `filter`, `project`, one bounded arithmetic `derive`, and an explicit final output. The implementation MUST reject prose, unknown fields, unsupported operations, malformed references, resource-limit violations, and any attempt to create an external effect.

The shared hybrid-core checkpoint and historical reports are outside this contract. This document and its implementation are additive and MUST NOT rewrite or reinterpret those artifacts.

## Functional Requirements

- FR-1: Versioned structured specifications

### Versioned structured specifications

The implementation MUST accept only the exact versioned specification schema `vevo.v03.tool-synthesis.spec.v1`. A specification MUST be JSON data with a name, a constants object, and an ordered operation list. Duplicate JSON object keys MUST be rejected. Unknown top-level keys, operation keys, reference kinds, operators, and schema versions MUST be rejected rather than ignored.

- FR-2: Stable typed references and serialization

### Stable typed references and serialization

Field references and constant references MUST be represented by distinct typed nodes. A field reference MUST use `{"kind":"field","name":"..."}` and a constant reference MUST use `{"kind":"constant","name":"..."}`. Canonical serialization MUST be deterministic, UTF-8, sorted by object key, and free of whitespace and non-finite numbers. A round trip MUST preserve reference kind, field name, constant name, operation order, aliases, and constant values. Renaming a field or constant MUST change only the intended pointer and MUST NOT silently resolve to a different pointer.

- FR-3: Restricted operation language

### Restricted operation language

The first implementation MUST support these ordered operations and no others:

1. `filter`, with one scalar left reference, one comparison operator, and one scalar right reference;
2. `project`, with one or more named output columns;
3. at most one `derive`, with one numeric left reference, one arithmetic operator, one numeric right reference, and one output name; and
4. exactly one final `explicit_output`, with one or more named output columns.

Programs MUST contain `filter` before `project` when both are present, MUST contain `derive` before `explicit_output`, and MUST end at `explicit_output`. The parser MUST reject loops, recursion, branching, imports, calls, lambdas, shell fragments, file paths, network addresses, embedded code, and unrecognized prose.

- FR-4: Pure table semantics

### Pure table semantics

The interpreter MUST operate only on a canonical JSON table with unique non-empty column names and scalar JSON cell values. It MUST preserve input row order and duplicate rows unless the program explicitly changes columns. `filter` MUST preserve duplicate values and retain rows in their original order. `project`, `derive`, and `explicit_output` MUST construct new tables without mutating the input. Empty tables MUST remain valid when their schema is valid.

- FR-5: Exact constants and numeric safety

### Exact constants and numeric safety

Constants MUST be scalar JSON values and MUST be stored exactly as parsed. Non-finite numeric values, unsupported nested literals, duplicate constant names, and numeric values outside the contract's finite magnitude bound MUST be rejected. Arithmetic MUST produce finite numeric values within the same magnitude bound; division by zero MUST be rejected. The implementation MUST NOT silently round, clip, coerce, or truncate values.

- FR-6: Independent resource bounds

### Independent resource bounds

Input bytes, input tokens, specification tokens, literal count, literal bytes, AST nodes, interpreter steps, and output bytes MUST each have an independently enforced limit. Limits MUST be checked before work that could exceed them. A limit failure MUST return a typed failure with the resource name, observed amount, and configured limit. No output or partial result MUST be returned as a successful execution after a limit failure.

- FR-7: Deterministic execution and result reporting

### Deterministic execution and result reporting

For a fixed specification, table, and limits, execution MUST be deterministic. A successful result MUST include the versioned output schema, canonical output table, canonical serialized output bytes, and resource usage. A failure MUST include a stable error code and enough structured context for a caller to distinguish parsing, typing, missing-field, numeric, resource, and unsupported-effect failures. There MUST be no retry, fallback template, or hidden truncation.

- FR-8: Independent verification

### Independent verification

The verifier MUST be a separate module from the parser/interpreter and MUST compare generated execution with hand-authored expected outputs for explicit development gold cases. It MUST use an independently defined canonical comparison path and MUST report every case result, not only an aggregate. A deliberately wrong program MUST fail verification. The development cases are smoke-level gold cases only; they MUST NOT be described as a complete training, validation, test, or generalization benchmark.

- FR-9: Stable neural-construction boundary

### Stable neural-construction boundary

The future neural path MUST construct operation kinds, typed arguments, field/constant pointers, aliases, and explicit connections at generation time. It MUST NOT choose among opaque stored full-program templates. The intended decoder boundary is a source token/field bank queried at each generation step, followed by a learned encoder and variable-length typed decoder driving one hybrid recurrent trajectory. Contextual scores MUST come from the integrated center/memory state. Syntax and type masks MAY suppress invalid next tokens, and an explicit `END` or `abstain` decision MUST be representable. This stage MAY leave the decoder unavailable, but it MUST keep this boundary precise.

- FR-10: Evaluation and clocks

### Evaluation and clocks

Any later learning study MUST split by whole program structure/composition and schema family before execution traces are generated. Public training examples MUST be separated from held-out input outcomes. This stage MUST NOT freeze the small development gold set as a complete benchmark. Generated execution on unseen inputs, rather than exact text match, MUST be the eventual correctness criterion. Tension energy MUST NOT be used as a correctness reward. Initial clocks MUST use fixed token/event `dt`; wall-clock/refinement accounting MUST remain distinct. Episodes MUST reset, inference weights MUST be fixed, and matched two-memory-write controls MUST be used for memory comparisons.

- FR-11: Local specialist boundary

### Local specialist boundary

The integrated system MUST expose a typed local specialist interface describing capability, input/output schemas, byte and latency budgets, resident-weight/RAM estimates, and cost units. A missing provider MUST produce an explicit `unavailable_provider` result and MUST NOT be replaced with fabricated specialist output. A future scheduler MUST account for the compact controller plus every resident or called specialist; the controller alone MUST NOT be presented as the total system size or cost. External providers, live calls, credentials, and account changes are out of scope for this stage.

## Non-Functional Requirements

### NFR-1: No arbitrary effects

The interpreter MUST use only in-memory standard-library operations and MUST expose no import, filesystem, process, shell, network, reflection, or dynamic-code execution path.

### NFR-2: No information loss

The implementation MUST reject unsupported input rather than truncate rows, columns, literals, names, or output bytes. All accepted scalar values MUST survive parse, execution, serialization, and result reporting without lossy conversion.

### NFR-3: Small deterministic dependency surface

The Stage 1 implementation SHOULD use Python standard-library types and existing repository conventions. It MUST not add a third-party runtime dependency or require a credential, service, paid resource, or external model.

### NFR-4: Reviewable versioning

The contract, implementation modules, tests, and design artifact MUST carry the same explicit v0.1 schema identifiers. The tool protocol MUST remain separate from the shared-metric geometry extension, which is versioned and committed independently.

### NFR-5: Error transparency

Errors MUST be typed, deterministic, and serializable. A caller MUST be able to tell whether a failure happened during parse, static validation, execution, verification, budget enforcement, or provider availability.

## Acceptance Criteria

### AC-1: Structured specification parsing (FR-1, FR-2)

Given a canonical v0.1 JSON specification with unique keys and valid typed references, when it is parsed and serialized, then the canonical bytes MUST be stable and a second parse MUST produce an equivalent AST.

### AC-2: Rejection of prose and unknown language (FR-1, FR-3, NFR-1)

Given prose, an unknown operation, a duplicate JSON key, an embedded code string, or an import-like field, when the parser receives it, then parsing MUST fail with a structured error and MUST execute no operation.

### AC-3: Filter/project/derive/output execution (FR-3, FR-4)

Given a table containing numeric and string columns and a valid program using filter, project, one derive, and explicit output, when the program executes, then the result MUST contain only the explicitly named output columns, correct derived numeric values, original retained-row order, and preserved duplicate rows.

### AC-4: Empty-table behavior (FR-4)

Given a valid table with columns and zero rows, when a valid program executes, then it MUST return an empty output table with the explicit output schema and no fabricated row.

### AC-5: Missing fields and type errors (FR-3, FR-5)

Given a field reference absent from the current table, an ordering comparison between incompatible scalar types, a nonnumeric arithmetic operand, or division by zero, when execution is attempted, then it MUST fail with a typed error and no successful output.

### AC-6: Constant and numeric preservation (FR-2, FR-5, NFR-2)

Given finite scalar constants and cells inside the magnitude bound, when they pass through references and output serialization, then exact JSON values and pointer identities MUST be preserved. Non-finite, nested, or over-bound literals MUST be rejected.

### AC-7: Independent resource caps (FR-6)

Given a valid program or table that exceeds exactly one configured byte, token, literal, AST, step, or output limit, when execution starts, then the corresponding resource failure MUST be reported before successful output, with no truncation or partial-success status.

### AC-8: No arbitrary effects (FR-3, NFR-1)

Given a specification containing loop-like syntax, a shell token, a path, a URL, a callable name, or any dynamic-code marker, when it is parsed or executed, then it MUST be rejected and MUST not access filesystem, process, network, import, or evaluation capabilities.

### AC-9: Independent gold verification (FR-8)

Given hand-authored development gold cases and a correct program, when the independent verifier runs, then it MUST report one result per case and pass all correct cases. Given a deliberately wrong program, when the same verifier runs, then at least one case MUST fail with an observed/expected difference.

### AC-10: Future neural boundary (FR-9, FR-10)

Given the contract documentation, when a reviewer traces the future decoder boundary, then it MUST identify per-step source-bank queries, typed variable-length decoding, one hybrid recurrent trajectory, syntax/type masks, explicit end/abstain, structure/schema-family splits, unseen-input correctness, fixed weights, reset episodes, and fixed token/event clocks without claiming that Stage 1 has trained or evaluated that decoder.

### AC-11: Specialist availability and accounting (FR-11)

Given an empty local specialist registry, when a typed request is made, then the result MUST be `unavailable_provider` with no fabricated output. Given controller and specialist resource estimates, when a system budget is checked, then the combined weights, resident RAM, latency, and cost MUST be compared with the budget.

### AC-12: Version and artifact separation (NFR-4)

Given the v0.1 tool sources and later geometry sources, when their schema identifiers and commits are inspected, then the tool protocol MUST be independently versioned from geometry and no historical report or checkpoint bytes MUST change.

### AC-13: Deterministic result reporting (FR-7)

Given identical valid inputs, a specification, and resource limits, when execution is repeated, then the status, canonical output bytes, usage accounting, and structured diagnostics MUST be identical.

## Edge Cases

- EC-1: A valid empty table has columns but zero rows and MUST still validate.
- EC-2: Duplicate row values and duplicate whole rows are data, not syntax errors.
- EC-3: Duplicate column names, duplicate aliases, duplicate constant names, and duplicate JSON keys are rejected.
- EC-4: A missing field is distinct from a present field whose value is JSON `null`.
- EC-5: Boolean values are scalar data but MUST NOT be treated as numeric operands.
- EC-6: Equality MAY compare any accepted scalar values; ordering MUST require compatible strings or finite numbers.
- EC-7: A negative zero, if accepted by the JSON parser, MUST serialize deterministically and MUST not become a non-finite value.
- EC-8: An output alias may differ from its source field name but MUST be non-empty and unique within that output.
- EC-9: A resource failure at the final output serialization boundary MUST not return a truncated byte string.
- EC-10: An unavailable specialist is a typed state, not an implicit retry or a fabricated result.
- EC-11: A field rename changes the field pointer; it MUST not resolve through a fuzzy or positional fallback.
- EC-12: A constant rename changes the constant pointer; unresolved references fail statically.

## API Contracts

This is a local Python API; it is intentionally not an HTTP service.

```text
parse_spec(document: bytes | str) -> ToolSpec
serialize_spec(spec: ToolSpec) -> bytes
validate_table(table: bytes | str | mapping) -> Table
execute(spec: ToolSpec, table: bytes | str | mapping, limits: ResourceLimits) -> ExecutionResult
verify_gold_cases(spec: ToolSpec, cases: sequence[GoldCase]) -> VerificationReport
```

```text
ToolSpec(schema, version, name, constants, operations)
ResourceLimits(max_input_bytes, max_input_tokens, max_spec_tokens,
               max_literals, max_literal_bytes, max_ast_nodes,
               max_steps, max_output_bytes)
ExecutionResult(status, output_table, output_bytes, usage, error)
SpecialistCapability(name, execution_kind, description, input_schema, output_schema,
                     max_input_bytes, max_output_bytes, max_latency_ms,
                     resident_weight_bytes, resident_ram_bytes, cost_units)
SpecialistRequest(request_id, capability, input_payload, budget)
SpecialistResult(status, request_id, provider, output_payload, error,
                 verification, memory_feedback, usage)
```

The callable signatures and field names above are stable source-level interfaces for this version. An implementation MAY add read-only diagnostics fields, but it MUST NOT change the meaning of the required fields.

## Data Models

| Model | Required fields | Invariants |
| --- | --- | --- |
| Versioned spec | `schema`, `version`, `name`, `constants`, `operations` | Exact schema identifier; unique names; one final explicit output |
| Typed reference | `kind`, `name` | `kind` is exactly `field` or `constant`; name is non-empty |
| Table | `schema`, `columns`, `rows` | Unique columns; every row has exactly the declared columns; scalar cells only |
| Operation | `op` plus operation-specific typed fields | Only four operation kinds; one derive maximum; explicit output final |
| Resource limits | Independent positive integer maxima | Every limit is enforced separately; no implicit truncation |
| Execution result | `status`, output or error, usage | Success has complete output; failure has no successful output |
| Gold case | `case_id`, input table, expected output | Expected output is hand-authored and not produced by the interpreter |
| Specialist capability | `execution_kind`, schemas, and resource estimates | Kind is one of internal learned skill, local generated tool, external tool adapter, or specialist-model adapter |
| Specialist result | status, request id, optional provider/output/error, verification, memory feedback | `unavailable_provider` has no fabricated payload; unavailable results do not claim verification |

## Out of Scope

- OS-1: Training, tuning, or running a neural tool decoder.
- OS-2: Choosing among opaque stored full-program templates.
- OS-3: Loops, recursion, arbitrary branching, joins, grouping, sorting, mutation, side effects, imports, dynamic code, filesystem, shell, network, or external calls.
- OS-4: A complete benchmark, learning sweep, generalization claim, or large evaluation run.
- OS-5: Changes to the existing hybrid-core architecture, seeds, optimizer, schedule, checkpoints, reports, or historical normalization.
- OS-6: Calling or provisioning an external specialist model, provider, credential, or paid resource.
- OS-7: Geometry, curvature, or attention metric implementation; that extension has a separate contract and commit.
- OS-8: Treating a constant SPD metric as a curved manifold or as physical extra dimensions. The later geometry extension is a shared coordinate metric only; it does not add a circle, hyperbolic expansion, or hidden physical dimensions.
