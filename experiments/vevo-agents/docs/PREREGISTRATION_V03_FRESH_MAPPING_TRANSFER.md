# v0.3 frozen fresh mapping-transfer preregistration

Status: `awaiting_independent_review_before_fresh_evaluation`

This is a source-only design record. It does not train, load candidate
outcomes on a fresh world, prepare a fresh episode, or run fresh evaluation.
The four shared-row screening checkpoints and the four immediately preceding
c35c2e legacy-head checkpoints are frozen read-only inputs for a later paired
inference run.

## Frozen screening identity

The screening artifact commit is
`00c60a84f3ee90ef661cfd12482d34ef194c4633`; its training source SHA is
`d8a41bfe6e7e38d5319438f2c7171006b2349e51`.

The actual screening output uses the name
`v03-neural-shared-row-bundled-screening`, while the earlier preregistration
planned `v03-neural-shared-row-scorer` names. This records the actual output
identity; there is no hidden source change or replacement implied.

Candidate normalization is the frozen train-only `shared_max_abs` v2 payload
with digest:

```text
cf43d9f347aca5d7a2339849b850e6d1c234fa8b0977df0459c45dfc0460cbeb
```

The c35c2e legacy baseline uses the same frozen normalization payload and
digest. No normalization fitting is permitted during paired fresh inference.

| inference family | checkpoint | file SHA-256 | payload digest |
|---|---|---|---|
| candidate full 107 | `v03-neural-shared-row-bundled-screening-full-seed-107.json` | `e5053d3c81165d9b44e7c1706dc372c98976715bad621797f1a7dc8a0e94a3ec` | `fd9fd9f06ae7a27193fe761ca97b76556e0a8d4c006212bf05f58c613ce1c600` |
| candidate full 117 | `v03-neural-shared-row-bundled-screening-full-seed-117.json` | `a686d2a6b5006bd73c5e9b1ea50b501a513d2ce5842675de5ca3d790ac42baa1` | `bf2e97dd9a890e83a8ea4bd2e488f9e17a7a2b72bcd6a516f25cd660b4f69800` |
| candidate control 141 | `v03-neural-shared-row-bundled-screening-control-seed-141.json` | `6bf7be9f6b234e448cbc789dab5a7e800e15c58e75b9ce51bfa9d7c08639d42b` | `cb367156ca9ad28fe215618055a1f67b777cf32f43f6af6ddd091ade0330be3f` |
| candidate control 143 | `v03-neural-shared-row-bundled-screening-control-seed-143.json` | `3825f372f6845185512165bb1ef9c1c5ad8efc41ca36a747f2c602c214aa5acb` | `6884d8ba415ceb37770ed44fd94178ac736fb07684f9a26f4490692db9e20f40` |
| c35c2e legacy full 107 | `v03-neural-delayed-shared-response-scale-full-seed-107.json` | `5fe3a3a07c2572a2f51cde5699de36af41f6f39263c601b8e130ebcfba9f6ea6` | `c2cc0dd9b429741aff4765ba0deae75cf2753fddfca5fddd723c2bc4183d6ba5` |
| c35c2e legacy full 117 | `v03-neural-delayed-shared-response-scale-full-seed-117.json` | `08775a56a4d31c8f7c2bce38aaac105a2169e73619c32aa0890270a3f7223c4d` | `b6809215f6b8503f2d0f023d5590289d0577e90fbe7ecf49064b1da9d114ab58` |
| c35c2e legacy control 141 | `v03-neural-delayed-shared-response-scale-control-seed-141.json` | `27c195ddce0e7524a464ad28963849d97d90a437b783be0dc34344b24d750095` | `a38c0d4271f2d7f4af9b9371e39048a8280614779d261addfd3db3b70cb11dc2` |
| c35c2e legacy control 143 | `v03-neural-delayed-shared-response-scale-control-seed-143.json` | `a1f622654e00a8195a202a29a3a70beae3cf1213d77e6900af9324b1d227e94c` | `ab1276e01fe633ef7b9af67fde11c2cf5f7711333bba8b5829fe143c50dc2c0c` |

The later run must use these eight payloads directly, pair candidate and
legacy models on exactly the same case manifest, and never fit or mutate a
checkpoint.

## Complete mapping inventory

The authoritative tuple is the inverse of the simulator's four gate resonance
array: positions are target frequencies
`(0.55, 0.75, 0.95, 1.15)` and values are gate indices. Selection uses only
the deterministic `gate_resonance_hz` metadata generated from a world seed.
It never uses model predictions, physical success, or a prior candidate
outcome.

The inventory covers all 24 feasible bijections and records the explicit
protocol-fixture resonance overrides rather than treating a seed-generated
mapping as the executed mapping. One listed parameter-sensitivity override is
non-bijective and is recorded for provenance but excluded from the bijective
mapping universe.

- The inventory covers 22 physical mapping tuples after combining ordinary
  seed-derived metadata with the listed bijective fixture overrides.
- A prior development row-relabel diagnostic on world `9306` used physical
  mapping `(2,3,0,1)` and exposed `(1,2,3,0)` only as a transformed
  counterfactual row order. That tuple was not a physical-world run.
- Therefore the globally never-inspected complement `U` contains exactly one
  tuple, `(3,2,0,1)`, after subtracting both physical prior exposure and the
  explicit counterfactual exposure.

The candidate training and prior inventory are:

- Candidate training worlds `9200, 9201` use `(3,0,1,2)` and `(0,2,1,3)`. These are the `seen_training_mapping` tuples.
- The prior train/development/diagnostic/audit inventory covers 22 of 24 physical mapping tuples.
- The counterfactual-exposed set contains `(1,2,3,0)`; it is not part of `U` despite not having a prior physical-world run.
- The globally never-inspected complement `U` therefore has exactly one tuple: `(3,2,0,1)`.
- The other 21 training-disjoint tuples were previously inspected physically or exposed by the recorded counterfactual diagnostic. Fresh worlds carrying those tuples are not globally unseen-map evidence.

The excluded prior world inventory includes v0.3 proof train/validation/test
and donor worlds, repair micro/future audit worlds, delayed-memory training and
development worlds, and all listed v0.3 protocol audit fixtures. Every such
world seed is excluded from the fresh seed search.

## Fresh-world selection

Use the fixed candidate seed range `[20000, 30000)`, sort `U` lexicographically,
and take `K = min(8, |U|)`. For each selected mapping, scan candidate seeds in
ascending order, skip every excluded or already selected seed, derive the
frequency-to-gate tuple from simulator metadata, and take the first two seeds.
For the current inventory, `K=1`, and the true U evidence is:

| partition | mapping tuple | fresh world seeds | goals per world | cases |
|---|---|---:|---:|---:|
| training-disjoint, never-inspected mapping | `(3,2,0,1)` | `20049, 20050` | `0..3` | 8 |

The previously frozen physical worlds `20021, 20023` carrying `(1,2,3,0)` are
preserved in the case manifest, but relabeled:

| partition | mapping tuple | fresh world seeds | goals per world | cases |
|---|---|---:|---:|---:|
| training-disjoint, counterfactually exposed mapping | `(1,2,3,0)` | `20021, 20023` | `0..3` | 8 |

They are fresh physical worlds and remain useful supplemental transfer cases,
but they are not U evidence and must never be described as globally
never-inspected. No outcome-based replacement was made. The complete preserved
manifest is therefore 4 fresh worlds and 16 cases: 8 U cases plus 8 explicitly
counterfactual-exposed cases. The upper bound remains 8 mappings × 2 worlds
per mapping × 4 goals = 64 cases per checkpoint, or 512 paired checkpoint
evaluations. If `U` were empty, the design would stop and require separate
review of a clearly labelled fresh-instance/training-disjoint test; it would
not be called globally unseen-map evidence. That fallback is not applicable
to the sealed current inventory.

## Protocol and metrics

Keep the existing `CorrectedEpisode` physics, goal, probe measurement, and
actuation protocol unchanged. Use the original note format and delayed
schedule exactly:

```text
target_hz={goal_frequency:.2f}; target_phase=0.00; rule=max-response-at-target; variant=delayed-train
```

The note is shown once, hidden during two independent delay steps, and the
policy sees the same five stages and payload masks `[0,1,0,0,0]`. Wording and
delay variations are deferred to a separate later design.

For each frozen candidate and legacy checkpoint, report learned frequency,
gate, joint, physical-success, and loss metrics per case, per world, per
frequency-to-gate mapping, and per selected partition. Keep the U and
counterfactually exposed partitions separate in every report. The gate target is
derived from simulator resonance metadata only; it is not supplied to policy
input or selected from model success. `joint_mean_loss` is the arithmetic mean
of gate and frequency cross-entropies. Physical success is the unchanged
`CorrectedEpisode.success()` result after the model-selected actuation.

## Row-relabel consistency

For each fresh case and each candidate shared-row checkpoint, test all 24 row
permutations. If the final response rows are replaced by `rows[p]`, require:

- `gate_probs_permuted == gate_probs_baseline[p]` to `atol=1e-12`, `rtol=0`;
- frequency probabilities unchanged exactly within the same tolerance;
- selected gate remapped as `p.index(baseline_selected_gate)` only when the
  baseline top gate is unique; and
- retained context unchanged.

Near-tie selected-index checks are `not_applicable_tie`, never counted as
passes. Row-relabel checks apply to the four candidate shared-row checkpoints;
the legacy per-gate checkpoints remain the paired primary inference baseline,
not an expected symmetry-positive control.

## Budget, failure, and stopping rules

The later evaluation is one CPU process with a cooperative 300-second wall
clock cap and a 512 MiB additional-memory cap. It has a fixed 16-case current
plan, 128 primary model evaluations across eight checkpoints, and 1,536
candidate row-relabel counterfactual checks. Deadline checks occur before each
case, between cases, before each row-relabel block, and between derived-metric
stages.

The report must use explicit statuses `not_started`, `complete`,
`partial_wall_clock_cap`, `partial_memory_cap`, or `partial_failure`; preserve
completed raw prefixes; record phase, case identity, and exception details;
and compute no later metrics after cap or failure. No retry, tuning, seed
substitution, checkpoint mutation, or model-based case replacement is allowed.

No fresh evaluation has been run under this preregistration. No new training,
PC work, paid resources, credentials, merge, deploy, or PR action is part of
this stage.
