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
they are not world state. Public record constructors normalize supported
sequence fields to immutable tuples. Forecasts reconstruct a world from that
whitelist using fixed nominal frequencies and call the existing simulator with
cue and distractor inputs disabled.

The predictor is explicitly nominal and not calibrated to each hidden fixture:
the actual target, calibration, and natural frequencies are not read. The
corrected result records `mismatch_expected=true`; nominal predictions are not
a physical-safety guarantee.

The fixed action set has five actions:

1. coast;
2. positive drive at port 0;
3. negative drive at port 0;
4. positive drive at port 1;
5. negative drive at port 1.

Every action is two simulator ticks at magnitude `0.16`, and only ports 0 and
1 are admitted. A two-step forecast therefore evaluates exactly `5**2 == 25`
candidate sequences. The four-cycle actual budget is exactly eight physics
ticks because each action lasts two ticks. Virtual candidate and virtual
physics-step budgets are tracked separately by strategy: the two-step
receding planner has a 100-candidate/400-step cap, while the fair full-episode
open-loop baseline evaluates `5**4 == 625` candidates and 5,000 virtual
physics steps once. These virtual physics-step values are worst-case reserved
compute for the declared candidate/horizon envelope, not measured simulator
execution; candidates may terminate early after a failed tick check.

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

The corrected comparison runs four bounded strategies on the reachable frozen
fixtures:

- `coast`: execute coast at each actual cycle;
- `greedy`: forecast one action and execute the selected action;
- `open_loop_full_episode`: forecast the entire four-action episode once,
  then execute its remaining suffix without silently coasting;
- `receding_horizon`: forecast two actions, execute only its first action,
  observe, and forecast again. On the final cycle the horizon is truncated to
  one action.

The old two-step-open-loop result is retained unchanged alongside the corrected
comparison as `v03-simulator-planner-results-original.json` and `.md`.

Candidate scoring rejects any sequence whose every-physics-tick forecast
violates neighbor energy, elapsed time, or supplied-work constraints. A
reachability witness is accepted only when the initial state and every physics
tick of every witness action satisfy those hard constraints, not merely when
the final state does. Actual execution applies the same hard checks after each
physics tick and stops before dispatching the next tick when a completed tick
violates one. Only already-exhausted public budgets are prechecked before
dispatch, so a two-tick action can report one known completed tick plus one
never-dispatched tick when its first tick remains feasible but its second would
exceed a cap. This is constraint accounting, not a safety guarantee under
nominal-model mismatch.

The actual budget is at most four cycles and eight physics steps. The reserved
actual budget remains separate from its accounting partition: completed ticks
are `known_executed_ticks`, a tick whose invocation raised is
`in_flight_uncertain_ticks`, and the remaining ticks are
`never_dispatched_ticks`. Cancellation after a completed tick therefore does
not make that tick unknown. Forecasts, observations, actions, results, errors,
terminal outcomes, and budgets are frozen dataclass records (serialized as JSON
only at the artifact boundary). Cancellation before or after dispatch, partial
effects, and execution errors are terminal. They set
`alternatives_blocked=true`; the planner does not try a second action after an
uncertain, cancelled, or failed action.

A controlled changed-world case applies a deterministic external drive during
cycle 1. The observation after that action is the first changed observation,
so receding plans cycle 2 onward are the plans that can use the change. The
complete result retains the change, observations, forecasts, realized residual
measurements, results, and all planning cycles.

Every run is a new seeded run; it never resumes a previous world. Forecast
residuals compare public predicted and realized observations explicitly, even
for complete action intervals. Reused full-episode forecasts retain the
predicted start observation for each suffix action, so their supplied-work and
residual increments are measured from predicted start to predicted end; actual
increments use the actual cycle start and end. Because the nominal predictor resets
initial energy, signed work, and dissipation for each forecast from the public
state, `predicted.residual` is a forecast increment and is compared with
`realized.residual - prior.residual`; the analogous supplied-work increment is
also serialized. Partial, cancelled, uncertain, or failed action intervals
are marked unavailable with a reason unless an exactly matching prefix
prediction exists; this implementation stores no such prefix, so it never
compares a full two-tick forecast with a shorter actual interval. These
residuals are diagnostic measurements only: they are not control feedback,
action-score inputs, or adaptation signals. The separation threshold is only
`1e-8`, a tiny development threshold, and does not support a meaningful
spatial-navigation claim.

## Reproduction

From `experiments/vevo-agents`:

```bash
PYTHONPATH=src python -m vevo_agents.v03_simulator_planner \
  --output-json artifacts/v03-simulator-planner-results-corrected.json \
  --output-markdown artifacts/v03-simulator-planner-results-corrected.md
```

Run the focused tests with:

```bash
PYTHONPATH=src python -m unittest tests.test_v03_simulator_planner -v
```

The corrected JSON is the source of structured evidence; the corrected
Markdown is a compact human-readable summary. The original JSON/Markdown
remain byte-identical beside them. The reports state that the predictor is a
nominal known simulator with expected mismatch, that no trained neural world
model or geometry benefit was used, and that no physical-safety, meaningful
spatial-navigation, or superiority claim is supported.
