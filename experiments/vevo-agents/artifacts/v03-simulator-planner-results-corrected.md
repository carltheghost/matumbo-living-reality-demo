# Bounded simulated-futures planner

Corrected bounded comparison using a nominal mechanical/oscillator simulator predictor; not a trained neural world model.

- Comparison variant: `corrected_bounded_comparison`
- Original result retained: `artifacts/v03-simulator-planner-results-original.json` and `artifacts/v03-simulator-planner-results-original.md`
- Frozen before comparison: `True`
- Two-step candidates: `25`
- Full-episode open-loop candidates: `625`
- Actual cycle limit: `4`
- Virtual rollout candidate limit: `100`
- Predictor parameterization: `nominal_not_calibrated`; mismatch expected: `True`
- Neural geometry status: `not_used`
- Virtual physics-step semantics: `worst_case_reserved_compute`
- Forecast residual role: `diagnostic_measurement_only`; control feedback: `False`

## Fixtures

| Fixture | Reachability | Witness | Reason |
|---|---|---|---|
| `planner-reachable-seed-0-port-0` | `reachable` | `drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0` | public observation verifier found a bounded witness |
| `planner-reachable-seed-1-port-1` | `reachable` | `drive_positive_port_1, drive_positive_port_1, drive_positive_port_1, drive_positive_port_1` | public observation verifier found a bounded witness |
| `planner-reachable-seed-2-port-0` | `reachable` | `drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0` | public observation verifier found a bounded witness |
| `planner-unreachable-high-energy` | `unreachable` | `—` | no candidate sequence satisfied the goal within the bounded verification horizon |

## Strategy comparison on reachable fixtures

| Fixture | Strategy | Success | Terminal | Horizons | Actions |
|---|---|---:|---|---|---|
| `planner-reachable-seed-0-port-0` | `coast` | `False` | `budget_exhausted` | `[1, 1, 1, 1]` | coast, coast, coast, coast |
| `planner-reachable-seed-0-port-0` | `one-step greedy` | `True` | `goal_reached` | `[1, 1, 1, 1]` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0 |
| `planner-reachable-seed-0-port-0` | `fair bounded full-episode open-loop baseline` | `True` | `goal_reached` | `[4, 3, 2, 1]` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0 |
| `planner-reachable-seed-0-port-0` | `two-step receding horizon` | `True` | `goal_reached` | `[2, 2, 2, 1]` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0 |
| `planner-reachable-seed-1-port-1` | `coast` | `False` | `budget_exhausted` | `[1, 1, 1, 1]` | coast, coast, coast, coast |
| `planner-reachable-seed-1-port-1` | `one-step greedy` | `True` | `goal_reached` | `[1, 1, 1, 1]` | drive_positive_port_1, drive_positive_port_1, drive_positive_port_1, drive_positive_port_1 |
| `planner-reachable-seed-1-port-1` | `fair bounded full-episode open-loop baseline` | `True` | `goal_reached` | `[4, 3, 2, 1]` | drive_positive_port_1, drive_positive_port_1, drive_positive_port_1, drive_positive_port_1 |
| `planner-reachable-seed-1-port-1` | `two-step receding horizon` | `True` | `goal_reached` | `[2, 2, 2, 1]` | drive_positive_port_1, drive_positive_port_1, drive_positive_port_1, drive_positive_port_1 |
| `planner-reachable-seed-2-port-0` | `coast` | `False` | `budget_exhausted` | `[1, 1, 1, 1]` | coast, coast, coast, coast |
| `planner-reachable-seed-2-port-0` | `one-step greedy` | `True` | `goal_reached` | `[1, 1, 1, 1]` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0 |
| `planner-reachable-seed-2-port-0` | `fair bounded full-episode open-loop baseline` | `True` | `goal_reached` | `[4, 3, 2, 1]` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0 |
| `planner-reachable-seed-2-port-0` | `two-step receding horizon` | `True` | `goal_reached` | `[2, 2, 2, 1]` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0 |

## Controlled changed-world case

Fixture `planner-reachable-seed-0-port-0`: controlled positive neighbor-node disturbance at cycle 1.

| Strategy | Success | Terminal | Horizons | Actions |
|---|---:|---|---|---|
| `coast` | `False` | `budget_exhausted` | `[1, 1, 1, 1]` | coast, coast, coast, coast |
| `one-step greedy` | `True` | `goal_reached` | `[1, 1, 1, 1]` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0 |
| `fair bounded full-episode open-loop baseline` | `True` | `goal_reached` | `[4, 3, 2, 1]` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0 |
| `two-step receding horizon` | `True` | `goal_reached` | `[2, 2, 2, 1]` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0 |

All receding-horizon plan cycles: `[0, 1, 2, 3]`; cycles after the cycle-1 change became observable: `[2, 3]` (first observable cycle `2`).

No physical-safety guarantee, meaningful spatial-navigation claim, neural/geometry benefit, or strategy-superiority claim is made. Forecast residuals are diagnostic measurements only, never control feedback. Virtual physics steps are worst-case reserved compute, not measured execution. The full JSON preserves forecasts, forecast-versus-realized residuals, observations, results, errors, and budgets.
