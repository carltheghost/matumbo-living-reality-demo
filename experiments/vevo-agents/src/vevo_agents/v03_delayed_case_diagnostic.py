"""Create a compact, per-case reading of the frozen clipping evidence.

The input is the already-published frozen-weight clipping report.  This module
does not load weights, run episodes, optimize, or alter the historical report.
It adds case-level loss/action overlap, gate confusion, response ordering and
goal-conditioned collision summaries so equal aggregate totals cannot be
mistaken for identical predictions.
"""

from __future__ import annotations

from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np

from .v03_delayed_memory import _training_observations, build_delayed_examples, make_training_specs
from .v03_model import fit_shared_max_abs_input_normalization


PROJECT_REPORT_PATH = Path("reports/generated/v03-neural-delayed-final-input-clipping-report.json")
OUTPUT_PATH = Path("reports/generated/v03-neural-delayed-final-input-clipping-case-diagnostic.json")
SUMMARY_PATH = Path("reports/generated/v03-neural-delayed-final-input-clipping-case-diagnostic.md")
CASE_CELL = "new_worlds_original_format"
CONDITIONS = ("baseline", "clip_response")
REPRESENTATIONS = ("raw", "shared_max_abs", "legacy_normalized", "legacy_clipped")
MODEL_KEYS = ("full-seed-107", "full-seed-117", "control-seed-141", "control-seed-143")
CLIP_BOUND = 3.0


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


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _json_digest(value) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _case_id(run: dict) -> str:
    return f"world-{int(run['world_seed'])}/goal-{int(run['goal_index'])}"


def _loss(probabilities: list[float], target: int) -> float:
    values = np.asarray(probabilities, dtype=np.float64)
    if values.shape != (4,) or not np.isfinite(values).all():
        raise ValueError("expected four finite action probabilities")
    probability = float(values[int(target)])
    return float(-np.log(max(probability, np.finfo(np.float64).tiny)))


def _ordering(values: np.ndarray) -> dict:
    values = np.asarray(values, dtype=np.float64).reshape(4)
    order = tuple(int(index) for index in np.argsort(-values, kind="stable"))
    return {
        "values": values.tolist(),
        "descending_gate_order": list(order),
        "argmax_gate": int(order[0]),
        "top_two_margin": float(values[order[0]] - values[order[1]]),
    }


def _target_column(matrix: np.ndarray, column: int) -> np.ndarray:
    matrix = np.asarray(matrix, dtype=np.float64)
    if matrix.shape != (4, 4) or not np.isfinite(matrix).all():
        raise ValueError("expected a finite 4x4 response matrix")
    return matrix[:, int(column)]


def _training_shared_scale() -> dict:
    """Fit the proposed scalar on the declared two-world training microset."""

    examples = build_delayed_examples(make_training_specs())
    normalization = fit_shared_max_abs_input_normalization(_training_observations(examples))
    return normalization


def _representations(base_run: dict, clipped_run: dict, shared_scale: float) -> dict[str, np.ndarray]:
    raw = np.asarray(base_run["raw_response"], dtype=np.float64).reshape(4, 4)
    legacy_before = np.asarray(base_run["normalized_response_before_hook"], dtype=np.float64).reshape(4, 4)
    legacy_after = np.asarray(clipped_run["normalized_response"], dtype=np.float64).reshape(4, 4)
    return {
        "raw": raw,
        "shared_max_abs": raw / float(shared_scale),
        "legacy_normalized": legacy_before,
        "legacy_clipped": legacy_after,
    }


def _case_record(base_run: dict, clipped_run: dict, shared_scale: float) -> dict:
    identity = (_case_id(base_run), _case_id(clipped_run))
    if identity[0] != identity[1]:
        raise ValueError(f"baseline/clipped identity mismatch: {identity}")
    target_column = int(base_run["target_column"])
    if target_column != int(clipped_run["target_column"]):
        raise ValueError("baseline/clipped target columns differ")
    representations = _representations(base_run, clipped_run, shared_scale)
    target_columns = {
        name: _ordering(_target_column(matrix, target_column))
        for name, matrix in representations.items()
    }
    physical_reference_gate = int(base_run["physical_reference_gate"])
    target_frequency = int(base_run["target_frequency_index"])
    baseline_gate_loss = _loss(base_run["gate_probabilities"], physical_reference_gate)
    clipped_gate_loss = _loss(clipped_run["gate_probabilities"], physical_reference_gate)
    baseline_frequency_loss = _loss(base_run["frequency_probabilities"], target_frequency)
    clipped_frequency_loss = _loss(clipped_run["frequency_probabilities"], target_frequency)
    baseline_joint_loss = float((baseline_gate_loss + baseline_frequency_loss) / 2.0)
    clipped_joint_loss = float((clipped_gate_loss + clipped_frequency_loss) / 2.0)
    baseline_action = base_run["final_action"]
    clipped_action = clipped_run["final_action"]
    return {
        "case_id": _case_id(base_run),
        "world_seed": int(base_run["world_seed"]),
        "goal_index": int(base_run["goal_index"]),
        "target_column_index": target_column,
        "target_frequency_index": target_frequency,
        "physical_reference_gate": physical_reference_gate,
        "raw_argmax_matches_reference": bool(
            target_columns["raw"]["argmax_gate"] == physical_reference_gate
        ),
        "baseline": {
            "success": bool(base_run["success"]),
            "gate": int(baseline_action["gate"]),
            "frequency_index": int(baseline_action["frequency_index"]),
            "gate_loss": baseline_gate_loss,
            "frequency_loss": baseline_frequency_loss,
            "joint_mean_loss": baseline_joint_loss,
        },
        "clipped": {
            "success": bool(clipped_run["success"]),
            "gate": int(clipped_action["gate"]),
            "frequency_index": int(clipped_action["frequency_index"]),
            "gate_loss": clipped_gate_loss,
            "frequency_loss": clipped_frequency_loss,
            "joint_mean_loss": clipped_joint_loss,
        },
        "loss_delta_clipped_minus_baseline": {
            "gate": float(clipped_gate_loss - baseline_gate_loss),
            "frequency": float(clipped_frequency_loss - baseline_frequency_loss),
            "joint_mean": float(clipped_joint_loss - baseline_joint_loss),
        },
        "action_changed": bool(
            baseline_action["gate"] != clipped_action["gate"]
            or baseline_action["frequency_index"] != clipped_action["frequency_index"]
        ),
        "probability_linf": float(max(
            np.max(np.abs(np.asarray(base_run["gate_probabilities"]) - np.asarray(clipped_run["gate_probabilities"]))),
            np.max(np.abs(np.asarray(base_run["frequency_probabilities"]) - np.asarray(clipped_run["frequency_probabilities"]))),
        )),
        "target_column": {
            "index": target_column,
            "target_frequency_index": target_frequency,
            "shared_scale": float(shared_scale),
            "representations": target_columns,
            "ordering_preserved_raw_to_shared": bool(
                target_columns["raw"]["descending_gate_order"]
                == target_columns["shared_max_abs"]["descending_gate_order"]
            ),
            "ordering_changed_raw_to_legacy_normalized": bool(
                target_columns["raw"]["descending_gate_order"]
                != target_columns["legacy_normalized"]["descending_gate_order"]
            ),
            "ordering_changed_legacy_normalized_to_clipped": bool(
                target_columns["legacy_normalized"]["descending_gate_order"]
                != target_columns["legacy_clipped"]["descending_gate_order"]
            ),
        },
    }


def _success_set_summary(cases: list[dict]) -> dict:
    baseline = {case["case_id"] for case in cases if case["baseline"]["success"]}
    clipped = {case["case_id"] for case in cases if case["clipped"]["success"]}
    intersection = baseline & clipped
    union = baseline | clipped
    return {
        "baseline_count": len(baseline),
        "clipped_count": len(clipped),
        "intersection_count": len(intersection),
        "union_count": len(union),
        "jaccard": float(len(intersection) / len(union)) if union else 1.0,
        "baseline_only": sorted(baseline - clipped),
        "clipped_only": sorted(clipped - baseline),
        "intersection": sorted(intersection),
        "baseline_set": sorted(baseline),
        "clipped_set": sorted(clipped),
    }


def _confusion(cases: list[dict], condition: str) -> list[list[int]]:
    case_condition = "clipped" if condition == "clip_response" else condition
    matrix = np.zeros((4, 4), dtype=np.int64)
    for case in cases:
        target = int(case["physical_reference_gate"])
        predicted = int(case[case_condition]["gate"])
        matrix[target, predicted] += 1
    return matrix.tolist()


def _goal_confusion(cases: list[dict], condition: str) -> dict:
    result = {}
    for goal in range(4):
        subset = [case for case in cases if case["goal_index"] == goal]
        matrix = np.asarray(_confusion(subset, condition), dtype=np.int64)
        result[str(goal)] = {
            "n": len(subset),
            "target_gate_by_case": [int(case["physical_reference_gate"]) for case in subset],
            "confusion_rows_target_gate_columns_predicted_gate": matrix.tolist(),
            "correct": int(np.trace(matrix)),
            "accuracy": float(np.trace(matrix) / len(subset)) if subset else None,
        }
    return result


def _collision_summary(cases: list[dict], representation: str) -> dict:
    by_world = defaultdict(list)
    for case in cases:
        signature = tuple(case["target_column"]["representations"][representation]["descending_gate_order"])
        values = tuple(
            round(float(value), 12)
            for value in case["target_column"]["representations"][representation]["values"]
        )
        by_world[int(case["world_seed"])].append((int(case["goal_index"]), signature, values))
    ordering_groups = []
    value_groups = []
    for world_seed, rows in sorted(by_world.items()):
        for field_index, target in ((1, ordering_groups), (2, value_groups)):
            groups = defaultdict(list)
            for row in rows:
                groups[row[field_index]].append(row[0])
            for signature, goals in sorted(groups.items(), key=lambda item: repr(item[0])):
                if len(goals) > 1:
                    target.append({
                        "world_seed": world_seed,
                        "goal_indices": sorted(goals),
                        "signature": list(signature),
                    })
    return {
        "ordering_collision_groups": ordering_groups,
        "ordering_collision_pair_count": int(sum(
            len(group["goal_indices"]) * (len(group["goal_indices"]) - 1) // 2
            for group in ordering_groups
        )),
        "exact_value_collision_groups_rounded_1e-12": value_groups,
        "exact_value_collision_pair_count_rounded_1e-12": int(sum(
            len(group["goal_indices"]) * (len(group["goal_indices"]) - 1) // 2
            for group in value_groups
        )),
    }


def _preserved_paths(root: Path) -> list[Path]:
    output_names = {OUTPUT_PATH.name, SUMMARY_PATH.name}
    paths = []
    for path in sorted((root / "reports/generated").glob("*")):
        if path.name not in output_names and path.is_file():
            paths.append(path)
    paths.extend(sorted((root / "storage/checkpoints").glob("*.json")))
    return paths


def _digests(paths: list[Path]) -> dict[str, str]:
    root = _project_root()
    return {str(path.relative_to(root)): _sha256(path) for path in paths}


def _atomic_write(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False,
        ) as handle:
            temporary = Path(handle.name)
            handle.write(payload)
            handle.flush()
        temporary.replace(path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def _summary_markdown(report: dict) -> str:
    lines = [
        "# Frozen delayed-memory clipping: compact case diagnostic",
        "",
        f"Input report: `{report['input_report']}`",
        f"Input report SHA-256: `{report['input_report_sha256']}`",
        f"Current source at analysis: `{report['source_sha']}`",
        "",
        "This is a read-only projection of the historical 320-evaluation report. It does not retrain, reload weights for inference, or overwrite historical artifacts. The compact per-case rows cover the 32 previously inspected new-world cases for each frozen model.",
        "",
        "## Success overlap, loss, and action changes",
        "",
        "| checkpoint | baseline | clipped | overlap | union | Jaccard | baseline-only | clipped-only | mean loss baseline→clipped | action changes | raw/reference | raw→shared | legacy changes | clip changes |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for model in MODEL_KEYS:
        summary = report["models"][model]["success_set_overlap"]
        loss = report["models"][model]["loss_summary"]
        lines.append(
            f"| {model} | {summary['baseline_count']} | {summary['clipped_count']} | {summary['intersection_count']} | {summary['union_count']} | {summary['jaccard']:.3f} | {len(summary['baseline_only'])} | {len(summary['clipped_only'])} | {loss['baseline_joint_mean']:.4f} → {loss['clipped_joint_mean']:.4f} | {report['models'][model]['action_changes']} | {report['models'][model]['raw_argmax_reference_matches']}/{report['models'][model]['n']} | {report['models'][model]['target_ordering_summary']['raw_to_shared_preserved']}/{report['models'][model]['n']} | {report['models'][model]['target_ordering_summary']['raw_to_legacy_changed']} | {report['models'][model]['target_ordering_summary']['legacy_to_clipped_changed']} |"
        )
    lines.extend([
        "",
        "The overlap column is the count of identical case identities that succeed in both conditions; equal totals therefore do not imply identical success sets or predictions.",
        "",
        "## Per-goal gate confusion",
        "",
        "Rows are the authoritative physical gate and columns are the selected gate. Goals are target-frequency indices 0–3; each matrix has eight cases.",
        "",
        "| checkpoint | condition | goal 0 | goal 1 | goal 2 | goal 3 |",
        "|---|---|---|---|---|---|",
    ])
    for model in MODEL_KEYS:
        for condition in CONDITIONS:
            matrices = report["models"][model]["gate_confusion"][condition]
            formatted = [
                "/".join(",".join(str(value) for value in row) for row in matrices[str(goal)]["confusion_rows_target_gate_columns_predicted_gate"])
                for goal in range(4)
            ]
            lines.append(f"| {model} | {condition} | " + " | ".join(f"`{value}`" for value in formatted) + " |")
    lines.extend([
        "",
        "## Target-column ordering and margins",
        "",
        "`raw` is the physical response; `shared_max_abs` divides all 16 response coordinates by one train-only scalar; `legacy_normalized` is the saved per-coordinate centered/scaled input; `legacy_clipped` is that input after the historical final-update clip. Each order is descending gate indices and each margin is top1−top2.",
        "",
        "| checkpoint | case | target gate | raw order/margin | shared order/margin | legacy order/margin | clipped order/margin | raw→shared |",
        "|---|---|---:|---|---|---|---|---|",
    ])
    for model in MODEL_KEYS:
        for case in report["models"][model]["cases"]:
            reps = case["target_column"]["representations"]
            def fmt(name):
                value = reps[name]
                return f"{''.join(str(i) for i in value['descending_gate_order'])}/{value['top_two_margin']:.4g}"
            lines.append(
                f"| {model} | {case['case_id']} | {case['physical_reference_gate']} | {fmt('raw')} | {fmt('shared_max_abs')} | {fmt('legacy_normalized')} | {fmt('legacy_clipped')} | {case['target_column']['ordering_preserved_raw_to_shared']} |"
            )
    lines.extend([
        "",
        "## Goal-conditioned collisions",
        "",
        "A collision groups different goal indices within one world that share the same descending target-column gate ordering. Exact-value collisions are additionally checked after rounding to 1e−12.",
        "",
        "| representation | ordering collision groups | ordering pairs | exact-value groups |",
        "|---|---:|---:|---:|",
    ])
    for representation in REPRESENTATIONS:
        collision = report["goal_conditioned_collisions"][representation]
        lines.append(
            f"| {representation} | {len(collision['ordering_collision_groups'])} | {collision['ordering_collision_pair_count']} | {len(collision['exact_value_collision_groups_rounded_1e-12'])} |"
        )
    lines.extend([
        "",
        "## Corrected historical label and preservation",
        "",
        "The historical field named `at_clip_bound_after_count` uses `abs(response_after) >= 3`, so it counts at-or-beyond-bound values, not exact-bound values only. New source output uses `at_or_beyond_clip_bound_after_count`; the historical JSON/summary/checkpoints remain unchanged.",
        "",
        f"Historical artifacts unchanged during analysis: `{report['historical_artifacts']['unchanged_byte_for_byte']}`.",
        "",
    ])
    return "\n".join(lines)


def build_case_diagnostic(report: dict) -> dict:
    if report.get("status") != "complete":
        raise ValueError("historical clipping report is not complete")
    shared_normalization = _training_shared_scale()
    shared_scale = float(shared_normalization["response_scaling"]["scale"])
    models = {}
    for model_key in MODEL_KEYS:
        cell = report["cells"][CASE_CELL][model_key]
        baseline = {
            (int(run["world_seed"]), int(run["goal_index"])): run
            for run in cell["baseline"]["runs"]
        }
        clipped = {
            (int(run["world_seed"]), int(run["goal_index"])): run
            for run in cell["clip_response"]["runs"]
        }
        if set(baseline) != set(clipped) or len(baseline) != 32:
            raise ValueError(f"unexpected case identities for {model_key}")
        cases = [
            _case_record(baseline[key], clipped[key], shared_scale)
            for key in sorted(baseline)
        ]
        models[model_key] = {
            "n": len(cases),
            "cases": cases,
            "success_set_overlap": _success_set_summary(cases),
            "raw_argmax_reference_matches": int(sum(
                case["raw_argmax_matches_reference"] for case in cases
            )),
            "target_ordering_summary": {
                "raw_to_shared_preserved": int(sum(
                    case["target_column"]["ordering_preserved_raw_to_shared"] for case in cases
                )),
                "raw_to_legacy_changed": int(sum(
                    case["target_column"]["ordering_changed_raw_to_legacy_normalized"] for case in cases
                )),
                "legacy_to_clipped_changed": int(sum(
                    case["target_column"]["ordering_changed_legacy_normalized_to_clipped"] for case in cases
                )),
            },
            "gate_confusion": {
                condition: _goal_confusion(cases, condition)
                for condition in CONDITIONS
            },
            "action_changes": int(sum(case["action_changed"] for case in cases)),
            "probability_changes": int(sum(case["probability_linf"] > 1e-12 for case in cases)),
            "loss_summary": {
                "baseline_gate_mean": float(np.mean([case["baseline"]["gate_loss"] for case in cases])),
                "clipped_gate_mean": float(np.mean([case["clipped"]["gate_loss"] for case in cases])),
                "baseline_frequency_mean": float(np.mean([case["baseline"]["frequency_loss"] for case in cases])),
                "clipped_frequency_mean": float(np.mean([case["clipped"]["frequency_loss"] for case in cases])),
                "baseline_joint_mean": float(np.mean([case["baseline"]["joint_mean_loss"] for case in cases])),
                "clipped_joint_mean": float(np.mean([case["clipped"]["joint_mean_loss"] for case in cases])),
            },
        }

    reference_cases = models[MODEL_KEYS[0]]["cases"]
    collisions = {
        representation: _collision_summary(reference_cases, representation)
        for representation in REPRESENTATIONS
    }
    historical_paths = _preserved_paths(_project_root())
    return {
        "schema": "vevo.v03.neural-delayed-final-input-clipping-case-diagnostic.v1",
        "status": "complete",
        "source_sha": _source_sha(),
        "input_report": str(PROJECT_REPORT_PATH),
        "input_report_sha256": _sha256(_project_root() / PROJECT_REPORT_PATH),
        "input_report_source_sha": report.get("source_sha"),
        "scope": {
            "cell": CASE_CELL,
            "cases_per_model": 32,
            "models": list(MODEL_KEYS),
            "conditions": list(CONDITIONS),
            "no_training": True,
            "no_weight_reload_for_inference": True,
        },
        "shared_train_scale": {
            "normalization": shared_normalization,
            "response_scale": shared_scale,
            "fit_from": "two declared training worlds (9200, 9201), four goals each, all present training observations",
            "response_coordinate_count": 16,
            "centering": "none",
            "clipping": "none",
        },
        "models": models,
        "goal_conditioned_collisions": collisions,
        "goal_conditioned_collision_scope": {
            "definition": "different goal indices in one world sharing a target-column gate-order signature",
            "response_transform_is_model_independent": True,
            "computed_from": "full-seed-107 rows; raw response and frozen normalization are shared across checkpoints",
        },
        "historical_label_correction": {
            "historical_field": "at_clip_bound_after_count",
            "predicate": "abs(response_after) >= clip_bound",
            "corrected_field": "at_or_beyond_clip_bound_after_count",
            "exact_bound_only": False,
        },
        "historical_artifacts": {
            "paths": [str(path.relative_to(_project_root())) for path in historical_paths],
            "before": _digests(historical_paths),
            "after": _digests(historical_paths),
            "unchanged_byte_for_byte": True,
        },
    }


def run(*, output_path: str | Path = OUTPUT_PATH) -> dict:
    output = _project_root() / Path(output_path)
    summary = _project_root() / SUMMARY_PATH
    if output.exists() or summary.exists():
        raise FileExistsError("refusing to overwrite compact diagnostic artifacts")
    input_path = _project_root() / PROJECT_REPORT_PATH
    report = json.loads(input_path.read_text(encoding="utf-8"))
    historical_paths = _preserved_paths(_project_root())
    before = _digests(historical_paths)
    result = build_case_diagnostic(report)
    after = _digests(historical_paths)
    result["historical_artifacts"]["before"] = before
    result["historical_artifacts"]["after"] = after
    result["historical_artifacts"]["unchanged_byte_for_byte"] = before == after
    if not result["historical_artifacts"]["unchanged_byte_for_byte"]:
        raise RuntimeError("historical artifact changed during compact diagnostic")
    result["report_path"] = str(output)
    result["summary_path"] = str(summary)
    _atomic_write(output, json.dumps(result, indent=2, sort_keys=True) + "\n")
    _atomic_write(summary, _summary_markdown(result))
    return result


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(OUTPUT_PATH))
    args = parser.parse_args()
    report = run(output_path=args.output)
    print(json.dumps({
        "schema": report["schema"],
        "status": report["status"],
        "source_sha": report["source_sha"],
        "response_scale": report["shared_train_scale"]["response_scale"],
        "models": {
            key: {
                "baseline": value["success_set_overlap"]["baseline_count"],
                "clipped": value["success_set_overlap"]["clipped_count"],
                "overlap": value["success_set_overlap"]["intersection_count"],
            }
            for key, value in report["models"].items()
        },
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
