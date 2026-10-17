"""Write a source-only preregistration for frozen fresh mapping transfer.

This module freezes the four completed shared-row screening checkpoints and a
deterministic metadata-only fresh-world plan.  It does not instantiate a
candidate model, load candidate weights, prepare a fresh episode, or evaluate
any fresh-world outcome.
"""

from __future__ import annotations

from itertools import permutations
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np

from .v03_delayed_memory import (
    DELAYED_CONTROL_SEEDS,
    DELAYED_MODEL_SEEDS,
    DELAYED_TRAIN_WORLD_SEEDS,
    DEVELOPMENT_WORLD_SEEDS,
    RETENTION_DELAY_STEPS,
    WALL_CLOCK_CAP_SECONDS,
    _training_observations,
    build_delayed_examples,
    make_training_specs,
)
from .v03_model import (
    LEGACY_GATE_HEAD,
    SHARED_RESPONSE_SCALING_METHOD,
    SHARED_ROW_GATE_HEAD,
    fit_shared_max_abs_input_normalization,
)
from .v03_neural_proof import _gate_resonances, _goal_note
from .v03_protocol import PROBE_FREQUENCIES


OUTPUT_PATH = Path("reports/generated/v03-neural-fresh-mapping-transfer-preregistration.json")
DOC_PATH = Path("docs/PREREGISTRATION_V03_FRESH_MAPPING_TRANSFER.md")

SCREENING_ARTIFACT_COMMIT = "00c60a84f3ee90ef661cfd12482d34ef194c4633"
SCREENING_SOURCE_SHA = "d8a41bfe6e7e38d5319438f2c7171006b2349e51"
SCREENING_REPORT_PATH = "reports/generated/v03-neural-shared-row-bundled-screening-report.json"
SCREENING_SUMMARY_PATH = "reports/generated/v03-neural-shared-row-bundled-screening-report.md"
SCREENING_PAIRED_PATH = "reports/generated/v03-neural-shared-row-bundled-screening-paired.md"
SCREENING_CHECKPOINT_PREFIX = "v03-neural-shared-row-bundled-screening"
SCREENING_OUTPUT_DIGESTS = {
    SCREENING_REPORT_PATH: "bb60e55cb77f5ffe8f2f968c9a7be837e41b85a54e1c2cc1fa3b572b24f28da4",
    SCREENING_SUMMARY_PATH: "c8bc63d39b2e42c05c12b0b98c9be8c42f0d9684f9c67e6ce8c7410f028d3731",
    SCREENING_PAIRED_PATH: "70e5c20e8b8fa1dc18e3018a8c7eb093a46fef30633a76cbb4099c7a2bff54aa",
}

LEGACY_BASELINE_ARTIFACT_COMMIT = "c35c2e6729dc867b516de8229ddd99adb88bcc44"
LEGACY_BASELINE_SOURCE_SHA = "2d35c0b32c5fb844c94b3909506dbf361d0bc521"

FRESH_EVALUATION_REPORT_PATH = "reports/generated/v03-neural-fresh-mapping-transfer-evaluation.json"
FRESH_EVALUATION_SUMMARY_PATH = "reports/generated/v03-neural-fresh-mapping-transfer-evaluation.md"

FROZEN_CANDIDATE_CHECKPOINTS = {
    "full-seed-107": {
        "path": "storage/checkpoints/v03-neural-shared-row-bundled-screening-full-seed-107.json",
        "digest": "e5053d3c81165d9b44e7c1706dc372c98976715bad621797f1a7dc8a0e94a3ec",
        "payload_digest": "fd9fd9f06ae7a27193fe761ca97b76556e0a8d4c006212bf05f58c613ce1c600",
        "model_class": "V03FiveBrain",
        "label": "full",
        "seed": 107,
        "parameter_count": 11184,
    },
    "full-seed-117": {
        "path": "storage/checkpoints/v03-neural-shared-row-bundled-screening-full-seed-117.json",
        "digest": "a686d2a6b5006bd73c5e9b1ea50b501a513d2ce5842675de5ca3d790ac42baa1",
        "payload_digest": "bf2e97dd9a890e83a8ea4bd2e488f9e17a7a2b72bcd6a516f25cd660b4f69800",
        "model_class": "V03FiveBrain",
        "label": "full",
        "seed": 117,
        "parameter_count": 11184,
    },
    "control-seed-141": {
        "path": "storage/checkpoints/v03-neural-shared-row-bundled-screening-control-seed-141.json",
        "digest": "6bf7be9f6b234e448cbc789dab5a7e800e15c58e75b9ce51bfa9d7c08639d42b",
        "payload_digest": "cb367156ca9ad28fe215618055a1f67b777cf32f43f6af6ddd091ade0330be3f",
        "model_class": "V03SingleRecurrentMemory",
        "label": "control",
        "seed": 141,
        "parameter_count": 11179,
    },
    "control-seed-143": {
        "path": "storage/checkpoints/v03-neural-shared-row-bundled-screening-control-seed-143.json",
        "digest": "3825f372f6845185512165bb1ef9c1c5ad8efc41ca36a747f2c602c214aa5acb",
        "payload_digest": "6884d8ba415ceb37770ed44fd94178ac736fb07684f9a26f4490692db9e20f40",
        "model_class": "V03SingleRecurrentMemory",
        "label": "control",
        "seed": 143,
        "parameter_count": 11179,
    },
}

NORMALIZATION_DIGEST = "cf43d9f347aca5d7a2339849b850e6d1c234fa8b0977df0459c45dfc0460cbeb"
LEGACY_BASELINE_NORMALIZATION_DIGEST = NORMALIZATION_DIGEST

# The immediately preceding c35c2e shared-scale report/checkpoint set is the
# paired legacy-head inference baseline.  These files are read-only inputs;
# no model is fitted or retrained in the fresh-evaluation stage.
FROZEN_LEGACY_CHECKPOINTS = {
    "legacy-full-seed-107": {
        "path": "storage/checkpoints/v03-neural-delayed-shared-response-scale-full-seed-107.json",
        "digest": "5fe3a3a07c2572a2f51cde5699de36af41f6f39263c601b8e130ebcfba9f6ea6",
        "payload_digest": "c2cc0dd9b429741aff4765ba0deae75cf2753fddfca5fddd723c2bc4183d6ba5",
        "model_class": "V03FiveBrain",
        "label": "full",
        "seed": 107,
        "parameter_count": 11183,
    },
    "legacy-full-seed-117": {
        "path": "storage/checkpoints/v03-neural-delayed-shared-response-scale-full-seed-117.json",
        "digest": "08775a56a4d31c8f7c2bce38aaac105a2169e73619c32aa0890270a3f7223c4d",
        "payload_digest": "b6809215f6b8503f2d0f023d5590289d0577e90fbe7ecf49064b1da9d114ab58",
        "model_class": "V03FiveBrain",
        "label": "full",
        "seed": 117,
        "parameter_count": 11183,
    },
    "legacy-control-seed-141": {
        "path": "storage/checkpoints/v03-neural-delayed-shared-response-scale-control-seed-141.json",
        "digest": "27c195ddce0e7524a464ad28963849d97d90a437b783be0dc34344b24d750095",
        "payload_digest": "a38c0d4271f2d7f4af9b9371e39048a8280614779d261addfd3db3b70cb11dc2",
        "model_class": "V03SingleRecurrentMemory",
        "label": "control",
        "seed": 141,
        "parameter_count": 11178,
    },
    "legacy-control-seed-143": {
        "path": "storage/checkpoints/v03-neural-delayed-shared-response-scale-control-seed-143.json",
        "digest": "a1f622654e00a8195a202a29a3a70beae3cf1213d77e6900af9324b1d227e94c",
        "payload_digest": "ab1276e01fe633ef7b9af67fde11c2cf5f7711333bba8b5829fe143c50dc2c0c",
        "model_class": "V03SingleRecurrentMemory",
        "label": "control",
        "seed": 143,
        "parameter_count": 11178,
    },
}

FROZEN_INFERENCE_CHECKPOINTS = {
    **{
        key: {**value, "family": "candidate", "expected_gate_head": SHARED_ROW_GATE_HEAD, "expected_source_sha": SCREENING_SOURCE_SHA}
        for key, value in FROZEN_CANDIDATE_CHECKPOINTS.items()
    },
    **{
        key: {**value, "family": "legacy_baseline", "expected_gate_head": LEGACY_GATE_HEAD, "expected_source_sha": LEGACY_BASELINE_SOURCE_SHA}
        for key, value in FROZEN_LEGACY_CHECKPOINTS.items()
    },
}

FRESH_WORLD_SEED_START = 20000
FRESH_WORLD_SEED_STOP_EXCLUSIVE = 30000

PARTITION_SEEN_TRAINING = "seen_training_mapping_new_world"
PARTITION_DISJOINT_PRIOR = "training_disjoint_previously_inspected_mapping_new_world"
PARTITION_DISJOINT_NEVER = "training_disjoint_never_inspected_mapping_new_world"
PARTITION_DISJOINT_COUNTERFACTUAL = "training_disjoint_counterfactual_exposed_mapping_new_world"

COUNTERFACTUAL_EXPOSED_MAPPING_TUPLES = ((1, 2, 3, 0),)

# Protocol tests contain both seed-generated worlds and explicit resonance
# arrays.  Keep the explicit arrays in the provenance record instead of
# silently treating their seed-generated mapping as the executed mapping.
KNOWN_PROTOCOL_OVERRIDE_RECORDS = (
    {"world_seed": 3100, "context": "pair_same_measurement_different_notes", "gate_resonance_hz": (0.55, 0.75, 0.95, 1.15), "frequency_to_gate": (0, 1, 2, 3), "bijective": True},
    {"world_seed": 3200, "context": "pair_same_note_different_measurements_first", "gate_resonance_hz": (0.55, 0.75, 0.95, 1.15), "frequency_to_gate": (0, 1, 2, 3), "bijective": True},
    {"world_seed": 3200, "context": "pair_same_note_different_measurements_second", "gate_resonance_hz": (0.75, 0.55, 0.95, 1.15), "frequency_to_gate": (1, 0, 2, 3), "bijective": True},
    {"world_seed": 3300, "context": "parameter_sensitivity_first", "gate_resonance_hz": (0.55, 0.75, 0.95, 1.15), "frequency_to_gate": (0, 1, 2, 3), "bijective": True},
    {"world_seed": 3300, "context": "parameter_sensitivity_second", "gate_resonance_hz": (0.57, 0.75, 0.95, 1.15), "frequency_to_gate": None, "bijective": False},
    {"world_seed": 3302, "context": "shared_coupling_energy", "gate_resonance_hz": (0.55, 0.75, 0.95, 1.15), "frequency_to_gate": (0, 1, 2, 3), "bijective": True},
    {"world_seed": 3500, "context": "all_gates_can_open", "gate_resonance_hz": (0.55, 0.75, 0.95, 1.15), "frequency_to_gate": (0, 1, 2, 3), "bijective": True},
    {"world_seed": 3501, "context": "wrong_gate_drive", "gate_resonance_hz": (0.55, 0.75, 0.95, 1.15), "frequency_to_gate": (0, 1, 2, 3), "bijective": True},
    {"world_seed": 3502, "context": "wrong_goal_drive", "gate_resonance_hz": (0.55, 0.75, 0.95, 1.15), "frequency_to_gate": (0, 1, 2, 3), "bijective": True},
    {"world_seed": 3503, "context": "right_goal_drive", "gate_resonance_hz": (0.55, 0.75, 0.95, 1.15), "frequency_to_gate": (0, 1, 2, 3), "bijective": True},
    {"world_seed": 3507, "context": "virtual_probe_work", "gate_resonance_hz": (0.55, 0.75, 0.95, 1.15), "frequency_to_gate": (0, 1, 2, 3), "bijective": True},
    {"world_seed": 3508, "context": "gate_quartic_force", "gate_resonance_hz": (0.55, 0.75, 0.95, 1.15), "frequency_to_gate": (0, 1, 2, 3), "bijective": True},
    {"world_seed": 3509, "context": "internal_coupling", "gate_resonance_hz": (0.55, 0.75, 0.95, 1.15), "frequency_to_gate": (0, 1, 2, 3), "bijective": True},
    {"world_seed": 3512, "context": "timestep_refinement", "gate_resonance_hz": (0.55, 0.75, 0.95, 1.15), "frequency_to_gate": (0, 1, 2, 3), "bijective": True},
    {"world_seed": 3516, "context": "additional_gate_opening", "gate_resonance_hz": (0.55, 0.75, 0.95, 1.15), "frequency_to_gate": (0, 1, 2, 3), "bijective": True},
)

# These are all prior v0.3 world seeds used by training, validation,
# development, frozen diagnostics, donor measurements, repair audits, or
# protocol/audit fixtures.  The protocol fixtures are conservatively excluded
# even when they were not part of a published candidate report.
KNOWN_PRIOR_WORLD_SEED_GROUPS = {
    "v03_neural_proof_train": tuple(range(6100, 6108)),
    "v03_neural_proof_validation": tuple(range(6200, 6204)),
    "v03_neural_proof_test": tuple(range(6300, 6312)),
    "v03_neural_proof_test_donor_measurements": tuple(range(15300, 15312)),
    "v03_neural_repair_microtrain": (7100, 7101),
    "v03_neural_repair_future_audit": (8300, 8301),
    "v03_delayed_memory_training": tuple(DELAYED_TRAIN_WORLD_SEEDS),
    "v03_delayed_memory_development": tuple(DEVELOPMENT_WORLD_SEEDS),
    "v03_protocol_audit_fixtures": tuple(sorted(
        set(range(12))
        | {3100, 3200, 3300, 3301, 3302, 3400}
        | set(range(3500, 3520))
    )),
}

KNOWN_PRIOR_WORLD_SEEDS = frozenset(
    seed
    for group in KNOWN_PRIOR_WORLD_SEED_GROUPS.values()
    for seed in group
)

ALL_FREQUENCY_TO_GATE_MAPPINGS = tuple(permutations(range(len(PROBE_FREQUENCIES))))

# The seed choices are frozen outputs of the ascending metadata-only search in
# [20000, 30000), after excluding KNOWN_PRIOR_WORLD_SEEDS.  This review stage
# selects the lexicographic first K=min(8, |U|) globally never-inspected
# mappings, with two fresh worlds per selected mapping.  After the provenance
# correction below, U has size one; the previously frozen worlds carrying the
# counterfactually exposed mapping are preserved as a separate supplemental
# partition rather than silently deleted.
FRESH_MAPPING_LIMIT = 8
FRESH_WORLDS_PER_MAPPING = 2
FROZEN_FRESH_WORLDS_BY_MAPPING = {
    (1, 2, 3, 0): (20021, 20023),
    (3, 2, 0, 1): (20049, 20050),
}

ROW_PERMUTATIONS = tuple(permutations(range(len(PROBE_FREQUENCIES))))
ADDITIONAL_MEMORY_CAP_KB = 512 * 1024


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _source_sha() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=_project_root().parents[1],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _digest(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    ).hexdigest()


def _file_digest(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def frequency_to_gate_mapping(world_seed: int) -> tuple[int, ...]:
    """Derive the authoritative frequency-to-gate permutation from metadata."""

    resonances = np.asarray(_gate_resonances(int(world_seed)), dtype=np.float64)
    mapping = []
    for frequency in PROBE_FREQUENCIES:
        matches = np.flatnonzero(np.isclose(
            resonances,
            float(frequency),
            rtol=0.0,
            atol=1e-12,
        ))
        if len(matches) != 1:
            raise ValueError(f"world {world_seed} does not have a bijective resonance mapping")
        mapping.append(int(matches[0]))
    result = tuple(mapping)
    if result not in ALL_FREQUENCY_TO_GATE_MAPPINGS:
        raise ValueError(f"world {world_seed} produced an infeasible mapping: {result}")
    return result


def _mapping_json(mapping: tuple[int, ...]) -> list[int]:
    return [int(value) for value in mapping]


def _mapping_label(mapping: tuple[int, ...]) -> str:
    return "(" + ", ".join(str(int(value)) for value in mapping) + ")"


def _override_record_json(record: dict) -> dict:
    """Return an explicit protocol override in the sealed JSON shape."""

    frequency_to_gate = record.get("frequency_to_gate")
    return {
        "world_seed": int(record["world_seed"]),
        "context": str(record["context"]),
        "gate_resonance_hz": [float(value) for value in record["gate_resonance_hz"]],
        "frequency_to_gate": (
            None
            if frequency_to_gate is None
            else _mapping_json(tuple(int(value) for value in frequency_to_gate))
        ),
        "bijective": bool(record["bijective"]),
    }


def _prior_inventory() -> dict:
    groups = {}
    for name, seeds in KNOWN_PRIOR_WORLD_SEED_GROUPS.items():
        worlds = [
            {
                "world_seed": int(seed),
                "frequency_to_gate": _mapping_json(frequency_to_gate_mapping(seed)),
                "frequency_to_gate_source": "seed_generated_simulator_rule",
            }
            for seed in sorted(seeds)
        ]
        groups[name] = {
            "world_seeds": [int(seed) for seed in sorted(seeds)],
            "world_count": len(worlds),
            "mapping_tuples": sorted({
                tuple(item["frequency_to_gate"])
                for item in worlds
            }),
            "worlds": worlds,
        }
        groups[name]["mapping_tuples"] = [
            _mapping_json(tuple(mapping))
            for mapping in groups[name]["mapping_tuples"]
        ]
    explicit_override_records = [
        _override_record_json(record)
        for record in KNOWN_PROTOCOL_OVERRIDE_RECORDS
    ]
    explicit_bijective_mappings = tuple(sorted({
        tuple(record["frequency_to_gate"])
        for record in explicit_override_records
        if record["bijective"] and record["frequency_to_gate"] is not None
    }))
    protocol_group = groups["v03_protocol_audit_fixtures"]
    protocol_group.update({
        "mapping_provenance_status": (
            "explicit_overrides_recorded; seed_derived_fixture_maps_retained_conservatively; "
            "not_an_exact_physical_exposure_census; one_non_bijective_override_is_outside_"
            "the_bijective_mapping_universe"
        ),
        "explicit_override_records": explicit_override_records,
        "actual_bijective_override_mapping_tuples": [
            _mapping_json(mapping) for mapping in explicit_bijective_mappings
        ],
        "non_bijective_override_count": sum(
            not record["bijective"] for record in explicit_override_records
        ),
        "seed_generated_world_mapping_is_not_treated_as_execution_provenance": True,
    })
    seed_generated_mappings = {
        frequency_to_gate_mapping(seed)
        for seed in KNOWN_PRIOR_WORLD_SEEDS
    }
    # Retain the seed-derived fixture union conservatively. Explicit override
    # arrays are recorded above, but this inventory is not an exact physical
    # exposure census; it is a conservative exclusion basis for U.
    prior_mappings = tuple(sorted(seed_generated_mappings | set(explicit_bijective_mappings)))
    training_mappings = tuple(sorted({
        frequency_to_gate_mapping(seed)
        for seed in DELAYED_TRAIN_WORLD_SEEDS
    }))
    all_mappings = set(ALL_FREQUENCY_TO_GATE_MAPPINGS)
    training_disjoint = tuple(sorted(all_mappings - set(training_mappings)))
    counterfactual_exposed = tuple(sorted(set(COUNTERFACTUAL_EXPOSED_MAPPING_TUPLES)))
    globally_unseen = tuple(sorted(
        all_mappings - set(prior_mappings) - set(counterfactual_exposed)
    ))
    return {
        "candidate_training_world_seeds": [int(seed) for seed in DELAYED_TRAIN_WORLD_SEEDS],
        "candidate_training_mapping_tuples": [_mapping_json(mapping) for mapping in training_mappings],
        "known_prior_world_seed_count": len(KNOWN_PRIOR_WORLD_SEEDS),
        "groups": groups,
        "prior_inspected_mapping_tuples": [_mapping_json(mapping) for mapping in prior_mappings],
        "prior_inspected_mapping_count": len(prior_mappings),
        "explicit_bijective_override_mapping_tuples": [
            _mapping_json(mapping) for mapping in explicit_bijective_mappings
        ],
        "explicit_override_record_count": len(explicit_override_records),
        "non_bijective_override_count": sum(
            not record["bijective"] for record in explicit_override_records
        ),
        "mapping_provenance_status": (
            "conservative_seed_derived_union_with_explicit_override_metadata; "
            "not_an_exact_physical_exposure_census; non_bijective_fixture_recorded_"
            "and_excluded_from_bijective_universe"
        ),
        "prior_mapping_exclusion_basis": (
            "conservative union of seed-derived fixture mappings and listed bijective "
            "override mappings; not an exact physical exposure census"
        ),
        "physical_exposure_census_claim": False,
        "training_disjoint_mapping_tuples": [_mapping_json(mapping) for mapping in training_disjoint],
        "training_disjoint_mapping_count": len(training_disjoint),
        "counterfactual_exposed_mapping_tuples": [
            _mapping_json(mapping) for mapping in counterfactual_exposed
        ],
        "counterfactual_exposed_mapping_count": len(counterfactual_exposed),
        "mapping_exposure_count": len(set(prior_mappings) | set(counterfactual_exposed)),
        "globally_unseen_mapping_tuples": [_mapping_json(mapping) for mapping in globally_unseen],
        "globally_unseen_mapping_count": len(globally_unseen),
        "all_feasible_mapping_count": len(ALL_FREQUENCY_TO_GATE_MAPPINGS),
        "inventory_note": (
            "The 24 feasible bijections are not all globally unseen under the conservative prior "
            f"exclusion union, which covers {len(prior_mappings)}/24 mappings. This is not an exact "
            "physical exposure census: explicit protocol overrides are recorded separately while "
            "seed-derived fixture mappings remain conservatively excluded. The row-relabel diagnostic on development "
            "world 9306 exposed (1,2,3,0) only as a counterfactual transformed row order; it was "
            "not a physical-world run. Therefore (1,2,3,0) is excluded from U even though fresh "
            "physical worlds 20021 and 20023 may be preserved as a supplemental, explicitly "
            "counterfactual-exposed partition. The true globally never-inspected complement U is "
            f"{len(globally_unseen)}/24 mapping(s)."
        ),
    }


def select_fresh_worlds() -> list[dict]:
    """Select U worlds plus preserved physical worlds relabeled by provenance."""

    inventory = _prior_inventory()
    globally_unseen = tuple(
        tuple(mapping) for mapping in inventory["globally_unseen_mapping_tuples"]
    )
    selected_mappings = globally_unseen[:min(FRESH_MAPPING_LIMIT, len(globally_unseen))]
    supplemental_mappings = tuple(sorted(
        set(FROZEN_FRESH_WORLDS_BY_MAPPING) - set(selected_mappings)
    ))
    output_mappings = tuple(sorted(set(selected_mappings) | set(supplemental_mappings)))
    selected = []
    used_worlds = set(KNOWN_PRIOR_WORLD_SEEDS)
    for mapping in output_mappings:
        chosen = []
        for candidate in range(FRESH_WORLD_SEED_START, FRESH_WORLD_SEED_STOP_EXCLUSIVE):
            if candidate in used_worlds:
                continue
            if frequency_to_gate_mapping(candidate) == mapping:
                chosen.append(candidate)
                if len(chosen) == FRESH_WORLDS_PER_MAPPING:
                    break
        if len(chosen) != FRESH_WORLDS_PER_MAPPING:
            raise RuntimeError(f"no fresh metadata-only world found for mapping {mapping}")
        if tuple(chosen) != tuple(FROZEN_FRESH_WORLDS_BY_MAPPING.get(mapping, ())):
            raise AssertionError(
                f"frozen fresh selection changed for {mapping}: expected "
                f"{FROZEN_FRESH_WORLDS_BY_MAPPING.get(mapping)}, got {chosen}"
            )
        for world_seed in chosen:
            used_worlds.add(world_seed)
            is_supplemental = mapping in supplemental_mappings
            selected.append({
                "world_seed": int(world_seed),
                "frequency_to_gate": _mapping_json(mapping),
                "partition": (
                    PARTITION_DISJOINT_COUNTERFACTUAL
                    if is_supplemental
                    else PARTITION_DISJOINT_NEVER
                ),
                "candidate_training_mapping": False,
                "mapping_was_prior_inspected": False,
                "mapping_was_counterfactual_exposed": bool(is_supplemental),
                "world_was_prior_inspected": False,
                "selection_basis": (
                    "preserved prior metadata-only selection; relabeled after counterfactual "
                    "provenance correction; not U evidence"
                    if is_supplemental
                    else "ascending world-seed search using gate-resonance metadata only"
                ),
                "candidate_pool": [FRESH_WORLD_SEED_START, FRESH_WORLD_SEED_STOP_EXCLUSIVE],
                "gate_resonance_hz": [
                    float(value)
                    for value in _gate_resonances(world_seed)
                ],
            })
    if len(selected) != len(output_mappings) * FRESH_WORLDS_PER_MAPPING:
        raise AssertionError("fresh selection does not match the bounded U plus supplemental plan")
    if len({item["world_seed"] for item in selected}) != len(selected):
        raise AssertionError("fresh selection reused a world seed")
    if any(
        item["mapping_was_counterfactual_exposed"]
        and tuple(item["frequency_to_gate"]) not in COUNTERFACTUAL_EXPOSED_MAPPING_TUPLES
        for item in selected
    ):
        raise AssertionError("supplemental mapping is not in the counterfactual exposure record")
    return selected


def _fresh_cases(fresh_worlds: list[dict]) -> list[dict]:
    cases = []
    for world in fresh_worlds:
        mapping = tuple(int(value) for value in world["frequency_to_gate"])
        for goal_index, frequency in enumerate(PROBE_FREQUENCIES):
            cases.append({
                "case_index": len(cases),
                "world_seed": int(world["world_seed"]),
                "goal_index": int(goal_index),
                "partition": world["partition"],
                "frequency_to_gate": _mapping_json(mapping),
                "metadata_reference_gate": int(mapping[goal_index]),
                "note_goal_id": f"delayed-train-goal-{goal_index}",
                "note_text": _goal_note(goal_index, "delayed-train", 0.0),
                "target_frequency_hz": float(frequency),
                "gate_resonance_hz": list(world["gate_resonance_hz"]),
            })
    return cases


def _normalization_freeze() -> dict:
    """Recompute the frozen train-only normalization without loading weights."""

    training_examples = build_delayed_examples(make_training_specs())
    normalization = fit_shared_max_abs_input_normalization(
        _training_observations(training_examples)
    )
    digest = _digest(normalization)
    if digest != NORMALIZATION_DIGEST:
        raise AssertionError(f"frozen normalization digest changed: {digest}")
    return {
        "mode": SHARED_RESPONSE_SCALING_METHOD,
        "fit_scope": "candidate training observations from worlds 9200 and 9201 only",
        "fit_world_seeds": [int(seed) for seed in DELAYED_TRAIN_WORLD_SEEDS],
        "schema": normalization["schema"],
        "digest": digest,
        "fixture": normalization,
        "model_outcomes_used": False,
    }


def _frozen_checkpoint_metadata() -> dict:
    metadata = {}
    root = _project_root()
    expected_normalization = _normalization_freeze()["fixture"]
    for key, frozen in FROZEN_INFERENCE_CHECKPOINTS.items():
        path = root / frozen["path"]
        current_digest = _file_digest(path)
        if current_digest != frozen["digest"]:
            raise AssertionError(
                f"checkpoint digest mismatch for {key}: expected {frozen['digest']}, got {current_digest}"
            )
        payload = json.loads(path.read_text(encoding="utf-8"))
        actual_gate_head = payload.get("gate_head", LEGACY_GATE_HEAD)
        if actual_gate_head != frozen["expected_gate_head"]:
            raise AssertionError(f"checkpoint {key} gate head changed: {actual_gate_head}")
        if payload.get("source_sha") != frozen["expected_source_sha"]:
            raise AssertionError(f"checkpoint {key} source SHA changed")
        if payload.get("normalization") != expected_normalization:
            raise AssertionError(f"checkpoint {key} normalization changed")
        if payload.get("training", {}).get("updates") != 1000:
            raise AssertionError(f"checkpoint {key} was not frozen at 1000 updates")
        if payload.get("model_class") != frozen["model_class"]:
            raise AssertionError(f"checkpoint {key} model class changed")
        if payload.get("seed") != frozen["seed"]:
            raise AssertionError(f"checkpoint {key} model seed changed")
        if payload.get("parameter_count") != frozen["parameter_count"]:
            raise AssertionError(f"checkpoint {key} parameter count changed")
        if _digest(payload) != frozen["payload_digest"]:
            raise AssertionError(f"checkpoint {key} payload digest changed")
        metadata[key] = {
            **frozen,
            "current_digest": current_digest,
            "source_sha": payload["source_sha"],
            "checkpoint_schema": payload["schema"],
            "gate_head": actual_gate_head,
            "training_updates": payload["training"]["updates"],
            "normalization_digest": _digest(payload["normalization"]),
            "normalization_exact_to_frozen_fixture": True,
        }
    return metadata


def build_preregistration() -> dict:
    """Build the frozen source-only fresh evaluation design."""

    inventory = _prior_inventory()
    fresh_worlds = select_fresh_worlds()
    cases = _fresh_cases(fresh_worlds)
    normalization = _normalization_freeze()
    checkpoints = _frozen_checkpoint_metadata()
    partition_counts = {
        partition: sum(item["partition"] == partition for item in fresh_worlds)
        for partition in (
            PARTITION_SEEN_TRAINING,
            PARTITION_DISJOINT_PRIOR,
            PARTITION_DISJOINT_NEVER,
            PARTITION_DISJOINT_COUNTERFACTUAL,
        )
    }
    checkpoint_count = len(FROZEN_INFERENCE_CHECKPOINTS)
    candidate_checkpoint_count = len(FROZEN_CANDIDATE_CHECKPOINTS)
    case_count = len(cases)
    primary_evaluations = case_count * checkpoint_count
    row_relabel_checks = case_count * candidate_checkpoint_count * len(ROW_PERMUTATIONS)
    globally_unseen = [
        tuple(mapping)
        for mapping in inventory["globally_unseen_mapping_tuples"]
    ]
    selected_mapping_count = min(FRESH_MAPPING_LIMIT, len(globally_unseen))
    max_case_count_per_checkpoint = (
        FRESH_MAPPING_LIMIT * FRESH_WORLDS_PER_MAPPING * len(PROBE_FREQUENCIES)
    )
    return {
        "schema": "vevo.v03.neural-fresh-mapping-transfer-preregistration.v1",
        "status": "awaiting_independent_review_before_fresh_evaluation",
        "source_sha_at_registration": _source_sha(),
        "training_started": False,
        "evaluation_started": False,
        "fresh_cases_evaluated": 0,
        "fresh_model_outcomes_loaded": False,
        "question": (
            "Does the frozen shared-row candidate transfer learned frequency-to-gate behavior "
            "to deterministic fresh worlds from the first lexicographic K globally never-inspected mappings?"
        ),
        "scope_boundary": {
            "source_only": True,
            "no_new_training": True,
            "no_fresh_case_evaluation": True,
            "no_candidate_outcomes_inspected_on_fresh_worlds": True,
            "preserved_counterfactual_exposed_worlds_are_not_U_evidence": True,
            "original_note_format_only": True,
            "varied_wording_or_delays_deferred": True,
            "fresh_worlds_are_not_generalization_claims_until_reviewed_and_run": True,
        },
        "frozen_screening_identity": {
            "artifact_commit": SCREENING_ARTIFACT_COMMIT,
            "source_sha": SCREENING_SOURCE_SHA,
            "report_path": SCREENING_REPORT_PATH,
            "summary_path": SCREENING_SUMMARY_PATH,
            "paired_analysis_path": SCREENING_PAIRED_PATH,
            "checkpoint_prefix": SCREENING_CHECKPOINT_PREFIX,
            "output_filename_deviation": {
                "prior_scorer_report_name": "v03-neural-shared-row-scorer-report.json",
                "actual_screening_report_name": "v03-neural-shared-row-bundled-screening-report.json",
                "prior_scorer_checkpoint_prefix": "v03-neural-shared-row-scorer",
                "actual_screening_checkpoint_prefix": SCREENING_CHECKPOINT_PREFIX,
                "reason": "The preregistration records the actual independent screening output name; no hidden source change is implied.",
                "hidden_source_change": False,
            },
            "output_digests": SCREENING_OUTPUT_DIGESTS,
        },
        "frozen_checkpoints": checkpoints,
        "paired_inference": {
            "candidate_checkpoint_family": sorted(FROZEN_CANDIDATE_CHECKPOINTS),
            "legacy_baseline_checkpoint_family": sorted(FROZEN_LEGACY_CHECKPOINTS),
            "identical_case_manifest": True,
            "candidate_and_baseline_normalization_fitting_during_evaluation": False,
            "candidate_and_baseline_use_frozen_checkpoint_payload_normalization": True,
            "baseline_artifact_commit": LEGACY_BASELINE_ARTIFACT_COMMIT,
            "baseline_source_sha": LEGACY_BASELINE_SOURCE_SHA,
        },
        "normalization": {
            "candidate_shared_row": normalization,
            "legacy_baseline": {
                "mode": SHARED_RESPONSE_SCALING_METHOD,
                "fit_scope": "same frozen candidate training observations from worlds 9200 and 9201",
                "schema": normalization["schema"],
                "digest": LEGACY_BASELINE_NORMALIZATION_DIGEST,
                "fixture": normalization["fixture"],
                "model_outcomes_used": False,
            },
            "candidate_and_baseline_digests_equal": bool(
                normalization["digest"] == LEGACY_BASELINE_NORMALIZATION_DIGEST
            ),
            "fit_at_preregistration_only": True,
            "fit_during_fresh_evaluation": False,
        },
        "mapping_inventory": inventory,
        "fresh_world_selection": {
            "seed_range": [FRESH_WORLD_SEED_START, FRESH_WORLD_SEED_STOP_EXCLUSIVE],
            "excluded_world_seeds": sorted(KNOWN_PRIOR_WORLD_SEEDS),
            "selection_uses_model_outcomes": False,
            "selection_metadata": "gate_resonance_hz generated by the fixed simulator seed rule only",
            "selection_universe": "U = globally_unseen_mapping_tuples after subtracting physical prior and counterfactual exposure",
            "lexicographic_mapping_limit_K": FRESH_MAPPING_LIMIT,
            "selected_mapping_count": selected_mapping_count,
            "selected_mapping_tuples": [_mapping_json(mapping) for mapping in globally_unseen[:selected_mapping_count]],
            "all_selected_U_mappings_covered": True,
            "all_feasible_mappings_covered": False,
            "preserved_supplemental_mapping_tuples": [
                _mapping_json(mapping)
                for mapping in sorted(set(tuple(item["frequency_to_gate"]) for item in fresh_worlds) - set(globally_unseen))
            ],
            "preserved_supplemental_worlds": [
                int(item["world_seed"])
                for item in fresh_worlds
                if item["mapping_was_counterfactual_exposed"]
            ],
            "worlds_per_mapping": FRESH_WORLDS_PER_MAPPING,
            "partition_counts": partition_counts,
            "worlds": fresh_worlds,
            "selection_algorithm": "sort U lexicographically, take the first K=min(8,|U|) mappings, scan ascending candidate seeds and take the first two unused seeds per U mapping after excluding every known world, then preserve previously frozen physical worlds for counterfactually exposed mappings under an explicit supplemental partition",
            "unselected_training_disjoint_mapping_tuples": [
                mapping
                for mapping in inventory["training_disjoint_mapping_tuples"]
                if tuple(mapping) not in {
                    tuple(item["frequency_to_gate"])
                    for item in fresh_worlds
                }
            ],
            "if_U_empty_alternative": {
                "status": "not_applicable_U_nonempty",
                "label": "fresh-instance/training-disjoint test, not globally unseen-map evidence",
                "requires_independent_review": True,
            },
        },
        "case_plan": {
            "world_count": len(fresh_worlds),
            "goals_per_world": len(PROBE_FREQUENCIES),
            "case_count": case_count,
            "goal_indices": list(range(len(PROBE_FREQUENCIES))),
            "cases": cases,
        },
        "protocol": {
            "episode_class": "CorrectedEpisode",
            "measurement": "existing pure four-channel continuous response matrix",
            "probe_frequencies_hz": [float(value) for value in PROBE_FREQUENCIES],
            "note_format_template": "target_hz={goal_frequency:.2f}; target_phase=0.00; rule=max-response-at-target; variant=delayed-train",
            "note_shown_once": True,
            "note_payload_masks": [0, 1, 0, 0, 0],
            "retention_delay_steps": int(RETENTION_DELAY_STEPS),
            "schedule_stages": [
                "before_note",
                "note_shown_once",
                "goal_independent_delay_1",
                "goal_independent_delay_2",
                "spectrum_and_action",
            ],
            "physics_goal_measurement_protocol_unchanged": True,
            "no_wording_or_delay_factor_in_this_evaluation": True,
            "target_gate_for_scoring": "authoritative inverse frequency_to_gate mapping from gate_resonance_hz metadata; never read from model success",
        },
        "metrics": {
            "per_case": [
                "gate_loss",
                "frequency_loss",
                "joint_mean_loss",
                "gate_correct",
                "frequency_correct",
                "joint_correct",
                "physical_success",
            ],
            "per_world": "aggregate all four goals for each selected world and each frozen checkpoint family member",
            "per_mapping": "aggregate both selected worlds carrying the same frequency_to_gate tuple, preserving whether the mapping is globally never-inspected or counterfactually exposed",
            "per_partition": "report the selected never-inspected and preserved counterfactual-exposed partitions; retain explicit zero counts for seen-training and training-disjoint previously-inspected partitions",
            "loss_definition": "gate and frequency cross-entropies from frozen model probabilities; joint_mean_loss is their arithmetic mean",
            "physical_success_definition": "unchanged CorrectedEpisode.success after the model-selected gate and frequency actuation",
            "frequency_target": "goal index from the original note/task construction",
            "gate_target": "metadata-derived gate matching the target frequency; not supplied to policy input",
            "no_selection_or_tuning_from_outcomes": True,
        },
        "row_relabel_consistency": {
            "permutation_count": len(ROW_PERMUTATIONS),
            "permutations": [_mapping_json(tuple(permutation)) for permutation in ROW_PERMUTATIONS],
            "response_relabel_definition": "replace final response rows with rows[p] for each permutation p",
            "expected_gate_probability": "permuted_gate_probs == baseline_gate_probs[p]",
            "expected_frequency_probability": "permuted_frequency_probs == baseline_frequency_probs",
            "expected_selected_gate": "p.index(baseline_selected_gate) when the baseline top gate is unique",
            "near_tie_selected_gate_status": "not_applicable_tie; do not count as a selected-index pass",
            "probability_allclose_atol": 1e-12,
            "probability_allclose_rtol": 0.0,
            "retained_context_expected_unchanged": True,
            "row_relabel_checkpoint_family": "candidate shared-row checkpoints only; legacy per-gate baseline is retained for paired primary metrics, not expected to satisfy shared-row equivariance",
            "checks_per_candidate_checkpoint": len(ROW_PERMUTATIONS) * case_count,
            "model_outcomes_available_at_preregistration": False,
        },
        "resource_budget": {
            "wall_clock_cap_seconds": float(WALL_CLOCK_CAP_SECONDS),
            "additional_memory_cap_kb": int(ADDITIONAL_MEMORY_CAP_KB),
            "single_cpu_process": True,
            "cooperative_deadline_checks": ["before each case", "between cases", "before each row-relabel block", "between derived metric stages"],
            "primary_physical_cases": case_count,
            "frozen_checkpoint_count": checkpoint_count,
            "primary_model_evaluations": primary_evaluations,
            "row_relabel_counterfactual_checks": row_relabel_checks,
            "maximum_prediction_blocks": primary_evaluations + row_relabel_checks,
            "maximum_mappings_if_U_is_large": FRESH_MAPPING_LIMIT,
            "maximum_worlds_if_U_is_large": FRESH_MAPPING_LIMIT * FRESH_WORLDS_PER_MAPPING,
            "maximum_cases_per_checkpoint": max_case_count_per_checkpoint,
            "maximum_primary_evaluations_if_U_is_large": max_case_count_per_checkpoint * checkpoint_count,
            "fixed_bounded_case_plan": True,
            "no_metrics_after_budget_exhaustion": True,
            "no_retry_tuning_or_seed_substitution": True,
        },
        "failure_and_cap_reporting": {
            "allowed_statuses": ["not_started", "complete", "partial_wall_clock_cap", "partial_memory_cap", "partial_failure"],
            "record_completed_case_prefix": True,
            "record_completed_row_relabel_prefix": True,
            "record_failure_phase_identity_and_exception": True,
            "preserve_partial_raw_prefix": True,
            "do_not_compute_later_metrics_after_cap_or_failure": True,
            "do_not_retry_or_select_a_different_world": True,
            "do_not_treat_partial_evidence_as_complete": True,
        },
        "separate_artifacts_after_review": {
            "preregistration": str(OUTPUT_PATH),
            "evaluation_report": FRESH_EVALUATION_REPORT_PATH,
            "evaluation_summary": FRESH_EVALUATION_SUMMARY_PATH,
            "candidate_checkpoints_are_read_only": True,
            "historical_and_screening_artifacts_must_remain_byte_for_byte": True,
        },
        "review_gates": [
            "Do not evaluate any fresh case before independent review of this source-only record.",
            "Do not retrain or alter the four frozen shared-row or four c35c2e legacy baseline checkpoints.",
            "Use the frozen shared_max_abs normalization payload exactly for both families; fit no normalization during paired inference.",
            "Use only original note wording and the existing two-step delayed schedule in this evaluation.",
            "Keep seen-training mappings, training-disjoint previously-inspected mappings, training-disjoint never-inspected mappings, and preserved counterfactual-exposed mappings separate in every report.",
            "Do not call training-disjoint previously-inspected mappings globally unseen-map evidence.",
            "Do not call the preserved (1,2,3,0) worlds globally never-inspected: a prior row-relabel diagnostic exposed that mapping counterfactually on development world 9306.",
            "Use simulator resonance metadata, never model success, to select worlds and derive gate targets.",
            "Report frequency, gate, joint, physical-success, and loss metrics per case, world, mapping, and partition.",
            "Require row-relabel probability equivariance and action remapping; mark near-tie selected-index checks not-applicable.",
            "Stop on cap or failure with structured partial evidence and no later metrics.",
            "Vary wording or delay only in a separately reviewed later design.",
        ],
        "prohibited_actions": [
            "fresh-world evaluation before independent review",
            "new training",
            "checkpoint mutation",
            "PC training",
            "new paid resources",
            "credentials or account permission changes",
            "merge",
            "deploy",
            "PR creation",
        ],
    }


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            handle.write(text)
            handle.flush()
        temporary.replace(path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def write_preregistration(*, output_path: str | Path = OUTPUT_PATH) -> dict:
    output = Path(output_path)
    if output.exists():
        raise FileExistsError(f"refusing to overwrite preregistration: {output}")
    result = build_preregistration()
    _atomic_write(output, json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(OUTPUT_PATH))
    args = parser.parse_args()
    result = write_preregistration(output_path=args.output)
    print(json.dumps({
        "schema": result["schema"],
        "status": result["status"],
        "training_started": result["training_started"],
        "evaluation_started": result["evaluation_started"],
        "fresh_cases_evaluated": result["fresh_cases_evaluated"],
        "fresh_world_count": result["fresh_world_selection"]["partition_counts"],
        "globally_unseen_mapping_count": result["mapping_inventory"]["globally_unseen_mapping_count"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
