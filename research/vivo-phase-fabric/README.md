# Viva Phase Fabric: reverse engineering and native 4D reference

**Status: research and integration kit, not a website release.** No repository,
PR, hosting service, or existing Viva package has been changed. No physical phone,
camera, room tracking, or new neural material model was tested or trained here.

This work audits selected critical paths of the supplied Viva 0.8.1 and makes the
next material-field direction concrete. It preserves the original project rather
than substituting another app builder or unrelated interface.

## Contents

- `docs/BLUEPRINT.md`: material, intelligence, interaction, manifold, identity,
  local-first, collaboration, training, performance, and integration design.
- `docs/AUDIT.md`: specific findings in the actual uploaded 0.8.1 code.
- `reports/source-audit.json`: input artifact and selected file hashes, exact lines.
- `viva_phase/solver.py`: actual N-spatial-dimensional complex phase field using a
  split-step spectral Gross-Pitaevskii equation on a flat periodic domain.
- `run_experiment.py`: runs a 24 x 24 x 24 x 24 field, records numerical invariants,
  timestep refinement, observer-slice independence, and a local vortex-sheet test.
- `web/target-mailbox.mjs`: isolated absolute-target input scheduler with one
  in-flight command and a single replaceable pending target. NOT wired into Viva.
- `generate_training_data.py`: generates independent synthetic whole trajectories,
  with train/validation/test membership assigned before simulation.
- `training-data/`: 12 generated example trajectories and their provenance manifest.
- `tests/`: 26 Python test methods and 9 Node tests. Results are in `reports/`.

## Run

Tested with Python 3.13.5, NumPy 2.3.5, and Node 22.16.0 in a Linux CPU environment.

```sh
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
node --test tests/target-mailbox.test.mjs
python run_experiment.py
python generate_training_data.py --output training-data
```

The neural training data generator does **not** train a network. Teacher labels
are invented-law numerical simulations, not measurements of real liquid helium.
The teacher is 16^4; exported observations are subsampled to 8^4 and explicitly
labelled as partial state. Test trajectories use a held-out coupling range.

## What the physics reference means

The implemented equation is, in dimensionless units:

`i dpsi/dt = (-0.5 Laplacian + V + g |psi|^2) psi`.

All active axes enter the Laplacian and evolution. A 4D simulation is not four
copies of a 3D scene. The clock, model channels, and history are separate.
Discrete field norm is conserved to floating-point precision without normalization.
Energy has splitting error; temporal refinement is measured. Spatial convergence,
quantitative helium-4 agreement, and general curved-manifold fidelity are NOT
established. The vortex sheet is an analytic local fixture, not a demonstrated
stable freely evolved vortex configuration.

This is a weakly interacting mean-field reference, not a two-fluid helium solver.
It does not simulate Rollin-film climbing, a helium equation of state, normal-fluid
entropy transport, photoreal liquids, or emergent intelligent rooms. The design
explains how these different modules must be added without double-counting matter.

## Integration warning

The new mailbox sends an **absolute desired target**, not an old relative move.
It cannot be dropped into the existing server protocol unchanged. A new server
endpoint must enforce leases, full-D transforms, collision, bounded work, and
ordered acknowledgements. Preview callbacks represent provisional intent only.
Cancel does not undo a command the server may already have committed.

The numerical kernel is additive and headless. It needs a local backend/worker
adapter and a separately tested shared-room adapter before it becomes live Viva.
No new live URL is claimed. Do not expect this ZIP to enable phone camera access.

## Result summary

Read `reports/verification.json` and `reports/experiment.json`. The main experiment
contains 331,776 complex samples in four spatial coordinates. Halving dt reduced
relative numerical error by about 4.2x against a finer-step reference at the same
spatial resolution. This is numerical evidence for the stated test, not evidence
of intelligence, actual extra physical dimensions, or phone performance.
