# v0.3 Stage 1 tool-synthesis design

This artifact records what is implemented at the first review boundary and what remains unavailable. It accompanies `TOOL_SYNTHESIS_CONTRACT_V01.md`; it does not describe a completed learner or benchmark.

## Implemented now

- `v03_tool_synthesis.py` defines a versioned typed AST, strict JSON parser, pre-load byte/nesting guards, canonical serializer, pure table interpreter, evolving-schema validation, independent resource counters, and structured failure reporting.
- The executable language has only `filter`, `project`, one numeric `derive`, and final `explicit_output`.
- `v03_tool_synthesis_verifier.py` contains two hand-authored development gold cases, including duplicate-row retention and an empty table. Expected outputs are written independently of the interpreter; output-table bytes must agree with execution bytes; an empty gold set is `inconclusive`; and the report is explicitly marked `complete_benchmark: false`.
- `v03_specialist_interface.py` defines typed capability/request/result, verification state, memory-feedback state, four explicit execution kinds (internal learned skill, local generated tool, external tool adapter, and specialist-model adapter), and total-system budget accounting. The local registry has no provider and returns `unavailable_provider` without output.

All accepted data is in-memory JSON. There is no shell, import, filesystem, process, network, external model, credential, or paid-resource path. Resource failures reject the complete execution; they never truncate a table or return a partial success.

## Neural construction boundary for a later stage

The future neural system should query a source token/field bank at every generation step. A learned encoder can represent the current table schema, constants, prior typed nodes, and the integrated center/memory state. A variable-length typed decoder then emits operation kind, argument type, source pointer, constant pointer, alias, and explicit connection tokens along one hybrid recurrent trajectory. Contextual scores come from that integrated center/memory state. Syntax/type-only masks may remove impossible next tokens, while `END` and `abstain` remain explicit decoder decisions.

This is a construction path, not a lookup over opaque full-program templates. The present code supplies the typed target language and executable verifier; it does not pretend that a neural decoder is available. No second document-level recurrent forward pass is introduced. The tool decoder must not reuse the existing gate feature semantics or normalization as a hidden substitute for its own typed inputs.

Before any learning run, examples must be split by whole program structure/composition and schema family, then traces generated separately. Public training examples and held-out input outcomes must remain distinct. Correctness must be measured by generated execution on unseen inputs, not exact textual match. Tension energy is a state objective, never a correctness reward. Initial timing uses fixed token/event `dt`; wall-clock and refinement accounting remain separate. Episodes reset, inference weights stay fixed, and memory comparisons use matched two-memory-write controls.

## Integrated specialist boundary

The compact controller may eventually select an internal learned skill, a locally generated executable tool, an external tool adapter, or a specialist-model adapter through the typed capability interface. Numerical learned operations are not executable code; local generated tools must pass the bounded tool interpreter and verifier. Each option must declare schemas, byte limits, resident weights/RAM, latency, and cost units. The scheduler must sum the controller and every resident or called specialist before admitting a request. A missing provider remains a typed unavailable state; it is not a reason to synthesize a fake specialist result. Routing is a future learned decision, not a rule table relabeled as neural.

The ambition of a beyond-Codex/Claude system remains an unproven research target. This Stage 1 artifact demonstrates a real learned-capability path to be connected later, not a delegated language-model answer relabeled as neural generation.

## Not implemented or not approved

- No neural tool decoder, training schedule, learned weights, or evaluation sweep.
- No provider registry entry, live specialist call, external service, credential, or account permission change.
- No benchmark claim beyond the tiny explicit development gold cases.
- No change to the existing hybrid-core checkpoint, reports, seeds, optimizer, schedule, or normalization.
