# Bounded simulated-futures planner

Known mechanical/oscillator simulator predictor; not a trained neural world model.

- Frozen before comparison: `True`
- Two-step candidates: `25`
- Actual cycle limit: `4`
- Virtual rollout candidate limit: `100`
- Neural geometry status: `available_but_not_used`

## Fixtures

| Fixture | Reachability | Witness | Reason |
|---|---|---|---|
| `planner-reachable-seed-0-port-0` | `reachable` | `drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0` | public observation verifier found a bounded witness |
| `planner-reachable-seed-1-port-1` | `reachable` | `drive_positive_port_1, drive_positive_port_1, drive_positive_port_1, drive_positive_port_1` | public observation verifier found a bounded witness |
| `planner-reachable-seed-2-port-0` | `reachable` | `drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0` | public observation verifier found a bounded witness |
| `planner-unreachable-high-energy` | `unreachable` | `—` | no candidate sequence satisfied the goal within the bounded verification horizon |

## Strategy comparison on reachable fixtures

| Fixture | Strategy | Success | Terminal | Actions |
|---|---|---:|---|---|
| `planner-reachable-seed-0-port-0` | `coast` | `False` | `budget_exhausted` | coast, coast, coast, coast |
| `planner-reachable-seed-0-port-0` | `greedy` | `True` | `goal_reached` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0 |
| `planner-reachable-seed-0-port-0` | `open_loop` | `False` | `budget_exhausted` | drive_positive_port_0, drive_positive_port_0, coast, coast |
| `planner-reachable-seed-0-port-0` | `receding_horizon` | `False` | `budget_exhausted` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, coast |
| `planner-reachable-seed-1-port-1` | `coast` | `False` | `budget_exhausted` | coast, coast, coast, coast |
| `planner-reachable-seed-1-port-1` | `greedy` | `True` | `goal_reached` | drive_positive_port_1, drive_positive_port_1, drive_positive_port_1, drive_positive_port_1 |
| `planner-reachable-seed-1-port-1` | `open_loop` | `False` | `budget_exhausted` | drive_positive_port_1, drive_positive_port_1, coast, coast |
| `planner-reachable-seed-1-port-1` | `receding_horizon` | `False` | `budget_exhausted` | drive_positive_port_1, drive_positive_port_1, drive_positive_port_1, coast |
| `planner-reachable-seed-2-port-0` | `coast` | `False` | `budget_exhausted` | coast, coast, coast, coast |
| `planner-reachable-seed-2-port-0` | `greedy` | `True` | `goal_reached` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0 |
| `planner-reachable-seed-2-port-0` | `open_loop` | `False` | `budget_exhausted` | drive_positive_port_0, drive_positive_port_0, coast, coast |
| `planner-reachable-seed-2-port-0` | `receding_horizon` | `False` | `budget_exhausted` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, coast |

## Controlled changed-world case

Fixture `planner-reachable-seed-0-port-0`: controlled positive neighbor-node disturbance at cycle 1.

| Strategy | Success | Terminal | Actions |
|---|---:|---|---|
| `coast` | `False` | `budget_exhausted` | coast, coast, coast, coast |
| `greedy` | `True` | `goal_reached` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, drive_positive_port_0 |
| `open_loop` | `False` | `budget_exhausted` | drive_positive_port_0, drive_positive_port_0, coast, coast |
| `receding_horizon` | `False` | `budget_exhausted` | drive_positive_port_0, drive_positive_port_0, drive_positive_port_0, coast |

Receding-horizon plan cycles observed after the change: `[0, 1, 2, 3]`.

No claim is made that receding horizon is superior; this is a bounded, deterministic prototype and the full JSON preserves forecasts, observations, results, errors, and budgets.
