# V03 bounded simulated-futures planner

This prototype is a bounded development control loop over the existing
`ResonantWorld` in `src/vevo_agents/physics.py`. It is deliberately a known
mechanical/oscillator simulator predictor, not a trained neural world model.
It does not inspect or expose the simulator's hidden target, calibration, or
natural frequencies, and it makes no neural-geometry or strategy-superiority
claim.

## Contract

The planner accepts only the public observation record emitted by
`ResonantWorld.observe()` plus public accounting values:

`tick`, `time`, per-node displacement and velocity, oscillator amplitude and
velocity, local oscillator energy, neighbor amplitude mean, total energy,
residual, and supplied work. Fixture identity and cycle are record metadata;
they are not world state. Forecasts reconstruct a world from that whitelist
using fixed nominal frequencies and call the existing simulator with cue and
distractor inputs disabled.

The fixed action set has five actions:

1. coast;
2. positive drive at port 0;
3. negative drive at port 0;
4. positive drive at port 1;
5. negative drive at port 1.

Every action is two simulator ticks at magnitude `0.16`, and only ports 0 and
1 are admitted. A two-step forecast therefore evaluates exactly `5**2 == 25`
candidate sequences. Virtual candidate and virtual physics-step budgets are
tracked separately from the actual execution budget.

## Goal and fixture protocol

Each goal combines all of the requested public criteria:

- minimum target-port oscillator energy;
- maximum neighbor oscillator energy;
- minimum node-separation change;
- maximum elapsed time, including the one-tick fixture warmup;
- maximum supplied work.

The development fixtures are verified exhaustively over one through four
actions using only public observations. The verification is completed and
frozen before any strategy comparison. Three fixtures are reachable and one
high-energy target fixture is intentionally unreachable. The unreachable case
is reported separately and is never presented as a failed generalization
trial.

## Strategies and safety behavior

The comparison runs four bounded strategies on the reachable frozen
fixtures:

- `coast`: execute coast at each actual cycle;
- `greedy`: forecast one action and execute the selected action;
- `open_loop`: forecast two actions once, then reuse the sequence;
- `receding_horizon`: forecast two actions, execute only its first action,
  observe, and forecast again.

The actual budget is at most four cycles and eight physics steps. Forecasts,
observations, actions, results, errors, terminal outcomes, and budgets are
frozen dataclass records (serialized as JSON only at the artifact boundary).
Cancellation before dispatch, partial/uncertain effects, and execution errors
are terminal. They set `alternatives_blocked=true`; the planner does not try a
second action after an uncertain or cancelled action.

A controlled changed-world case applies a deterministic external drive at
cycle 1. The complete result retains the change, observations, forecasts,
results, and replan cycles so the response to the change is inspectable.

## Reproduction

From `experiments/vevo-agents`:

```bash
PYTHONPATH=src python -m vevo_agents.v03_simulator_planner \
  --output-json artifacts/v03-simulator-planner-results.json \
  --output-markdown artifacts/v03-simulator-planner-results.md
```

Run the focused tests with:

```bash
PYTHONPATH=src python -m unittest tests.test_v03_simulator_planner -v
```

The JSON is the source of structured evidence; the Markdown is a compact
human-readable summary. Both outputs state that the predictor is the known
simulator, that no trained neural world model or geometry ablation was used,
and that no superiority claim is supported.
