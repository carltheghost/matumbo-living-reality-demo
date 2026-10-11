# Viva Phase Fabric: a material field that people can inhabit and shape

Status: proposed additive architecture, supported by a discrete 4D reference and
an input-transport component. This document does not describe a deployed upgrade.
The audit covers selected source paths in the uploaded 0.8.1, not the current repo.

## 1. The experience to implement

A participant encounters a persistent material-like relic in a shared space. An
open hand disturbs the surrounding field. A deliberate grab captures the relic,
not whichever particle happens to pass behind a fingertip. Moving the hand exerts
a controlled local interaction. The relic can deform, carry surface waves, or
flow under its declared material law without losing its object identity or contents.
Another participant, physically elsewhere, can observe the same accepted result
through an independent World Eye. They can enter an explicit opening into an inner
space, edit it, return, and recover that history later.

Dimensional movement changes actual coordinates, not merely the visible camera.
A 4D body can leave another observer's 3D slice without being deleted. Past records,
possible futures, nesting, and neural memory remain distinct from spatial axes.

The goal is controllable digital material, not universally liquid furniture. Text,
work products and pinned tools need legibility and stable identity. A no-damping
fluid that never settles can be unsuitable for precise manipulation. Interactive
control can deliberately dissipate energy; that is an actuator, not negative viscosity.

## 2. Canonical state and separation of concerns

A region retains:

`region_id, dimension, atlas, metric, topology, law_id, law_version, field_state,
entities, observer_frames, accepted_revision, checkpoints, model_hashes`.

A material entity retains:

`entity_id, region_id, material_support, constitutive_profile, mass_budget,
field_membership, lineage, contents_handle, permissions, revision`.

The field may contain density, momentum, coherent complex amplitude, material
fractions, deformation variables, temperature when modeled, and local memory.
These are distinct physical/internal quantities. A feature channel is not another
spatial direction. A phase angle is not the fourth spatial axis. Frequency is not
a universal identifier for a person or a file.

Material samples, continuum density and visible tracers must have explicit roles.
Do not add the mass of a density grid to the mass of particles representing the same
material. A visualization tracer has no mass unless its backreaction is implemented.
If a two-fluid model is used, its normal and superfluid mass shares sum to the total;
it does not introduce a second unrelated full-mass fluid behind the first.

Rendering, camera contrast and a participant's view are readers of this state.
They cannot silently change the field, rewrite a recording, or alter permissions.

## 3. Three material mechanisms, not one misleading shader

### 3.1 Classical material transport

Implement pressure, inertia, surface tension and boundary response for liquids;
elastic/viscoelastic stress for deformable solids; cohesion or fragmentation where
explicitly enabled. Particle-grid or meshless methods are candidates. They require
physical calibration and validation for each intended profile. A 3D library is not
a ready-made arbitrary-11D solver just because it uses vectors internally.

DiffTaichi supplies research and code for differentiable simulation [R6]. NVIDIA
Warp supplies differentiable simulation kernels, fluid and geometry examples [R7].
Use these as numerical ingredients or offline teachers, not as replacements for
Viva's identities, networking, room system, or input contracts.

### 3.2 Coherent phase dynamics

A mean-field reference can use:

`i hbar dpsi/dt = [-(hbar^2/2m) Delta_G + V + g|psi|^2] psi`.

On the implemented flat periodic domain, Delta_G is the ordinary full-dimensional
Laplacian. An arbitrary curved manifold would need the correct Laplace–Beltrami
operator, quadrature, boundary conditions and convergence tests. That implementation
is not supplied here.

This order parameter supports phase-dependent currents and quantized loop winding.
It does not automatically model dense liquid helium-4, its normal component,
roton dispersion, free droplets, surface wetting, or a stable semantic object.
The present kernel is a weakly interacting mean-field simulation in chosen units.
Strong interactions in actual He-4 make the condensate fraction different from the
superfluid fraction [R2]. Superfluidity is not evidence of learning or intention.

Published work simulates vortex surfaces in four spatial dimensions [R1]. For a
complex scalar field whose real and imaginary gradients are independent at a zero,
two independent equations define the core; its generic dimension is D-2. Thus a
regular vortex core is a point in 2D, line in 3D, surface in 4D, and higher-dimensional
set in larger spaces. Intersections and singular points need separate treatment.
This is a genuine change of geometry, not a label on a 3D swirl.

The local vortex fixture included here demonstrates that geometric fact and its
sampled loop winding. It does not prove that an isolated sheet is dynamically stable
or that a coarse loop resolves every vortex.

### 3.3 Surface films and wetting

A film moving over a relic or room boundary needs a surface domain, thickness or
mass-per-area, surface velocity/flux, a wetting potential, gravity where applicable,
and boundary exchange with bulk material. A surface mesh cannot be substituted
for the bulk volume without declaring the reduction.

Wetting depends on substrate interactions: helium even has non-wetting cases on
weakly binding substrates [R3]. Turning viscosity to zero does not by itself supply
the mechanism for film climbing. A modeled source of work and chemical potential
must account for the motion. A Rollin-film-inspired visual mode is not a verified
helium reproduction until that additional model is validated.

## 4. Geometry, graph structure and nested places

Retain the earlier distinctions: connectivity, geometric distance, containment,
portal mapping, and observation are different relationships. Smith/electrical
layouts can help arrange an overview or constrain a planar region, but cannot
serve as the universal adjacency map for every world or physical field.

Curved or folded surfaces must use intrinsic connectivity. Two folds close in the
3D display need not exchange mass or waves. Crossing a Möbius chart seam transforms
tangent directions; a scalar phase field is carried consistently through its
transition map. Reversing a chart's orientation must not be mistaken for creating
or destroying a physical vortex. Oriented winding signs need an explicitly chosen
loop orientation.

A same-dimensional portal starts with an isometric coordinate map plus an explicit
aperture and crossing rule. Transport maps position and tangent velocity. For a
field, it also defines which boundary samples exchange flux and how phase is
matched. An imposed phase offset can be an intentional interaction, not a forgotten
coordinate conversion. A non-isometric mapping needs a density/volume Jacobian and
an explicit energy/work policy. Different-dimensional transfer must preserve latent
coordinates or implement a declared materialization/confinement operation.

An object can be an entrance to another world. The inner world's authoritative
identity does not depend on whether the outer object is rendered. Room entry is not
a screen change masquerading as geometry. Work products retain IDs through travel,
deformation and replay; split/merge events record lineage. Emergent shape recovery
and durable file/record identity are separate mechanisms.

## 5. The neural system: three trainable roles

### A. Material response model

Inputs: local geometric and material state, recent forcing, surface/boundary data,
and phase-aware neighbor features. Outputs: bounded local constitutive parameters,
coarse-to-fine corrections, or a constrained next-state proposal. No permission,
user ID, room secret, or unrequested camera frame belongs in this model by default.

Graph Network-based Simulators [R4] and constraint-based graph simulators [R5] are
useful precedents. E(n)-equivariant networks [R8] provide an architecture compatible
with higher-dimensional Euclidean transformations. That is not a guarantee of
invariance under arbitrary curved chart changes. Curved implementations require
covariant/tangent-space operations and their own tests.

For phase input, useful global-phase-invariant features include density and
`conj(psi_i)*psi_j`. Do not train a model that responds differently to a physically
irrelevant uniform phase shift. Avoid dividing by density at a vortex core.

For a closed-system model, learn an energy functional or antisymmetric fluxes when
appropriate rather than adding unconstrained acceleration. For dissipative modes,
use positive-semidefinite dissipative structure and explicit accounting. Mass
conservation, valid constitutive ranges and action authority remain hard checks.
No such neural material network has been trained in this kit.

### B. Interaction model

Inputs: timestamped supported hand/eye observations, confidence, active axes,
current target and recent interaction context. Outputs: a predicted reversible
intent or estimated grip/control parameters. The model does not commit a grab
without the interaction state machine and does not invent a hand after tracking loss.

Keep targeting, capture, manipulation, release, cancellation and reacquisition
separate. Test target ownership through occlusion and crossover. The active source
(hand versus touch) must remain explicit. Model confidence alone does not establish
sensor accuracy; real-device benchmarks remain necessary.

### C. Room adaptation model

Train tasks such as recovering a target pattern after a perturbation, maintaining
an accessible route, or proposing a useful arrangement. Neural cellular automata
provide a precedent for trained local pattern growth and repair [R9]. A room that
repairs a trained shape has not demonstrated general intelligence. A room that
moves a participant's tools without permission has failed its task.

Existing learned wayfinding remains a separate valid model. It must not be reported
as a material-response model merely because both return a field of numbers.

## 6. Training and pretraining protocol

1. Establish teacher equations and invariants. Verify analytic fixtures and both
   temporal and spatial refinement. Make external forcing part of the input record.
2. Generate synthetic episodes varying geometry, material coefficients, boundaries,
   obstacles, input speed, and failure conditions. Label these as simulations, not
   empirical measurements. A model can be better at a chosen task without being a
   better model of nature.
3. Partition by whole trajectories, rooms and sessions before preprocessing. Hold
   out parameter regimes and topologies for explicit out-of-distribution tests.
   Fit normalization only on training. Do not repeatedly tune against final test.
4. Evaluate density/current/shape error, rollout stability, energy/work accounting,
   mass balance, topology-aware defect measures, chart/phase equivariance, and
   recovery. Compare to analytic and numerical baselines, not only weak networks.
5. For interaction, report false grabs, misses, release safety, jitter, target error,
   hand-to-visible latency percentiles and real phone performance in bright/dim
   scenes. A high animation frame rate does not demonstrate low interaction delay.
6. Distill a passing model into a small device-appropriate inference model. Train
   asynchronously; do not run gradient updates in the interaction/render loop.
7. Run candidates in shadow mode, then promote only after predefined gates. Store
   model hash, data provenance, numerical law and rollback checkpoint. Local memory
   updates during a session are not the same as online weight retraining.

The kit includes a 4D teacher generator and 12 example trajectories: eight train,
two validation and two test. Train/validation coupling is in [.5,2]; the two test
trajectories use [2.5,3]. This small example is pipeline scaffolding, not a training
corpus sufficient for a general material model or arbitrary manifolds.

The teacher uses 16^4 complex128 state and exports 8^4 float32 observations. Treat
unresolved fine state as an uncertainty/modeling issue, not as proof that coarse
state determines an exact future. The generator records each transition's forcing.
No network was trained on these files in this turn.

## 7. Movement must not wait for a network round trip

The existing drag path can discard deltas while an acknowledgement is pending.
The replacement contract is a timestamped absolute desired target, with a bounded
local grip/constraint integrator. Display a provisional target/response immediately;
commit shared state only through the chosen authority. Do not send a long backlog
of old hand trajectories. The included mailbox coalesces to one current target.

Touch, physics, rendering, inference, network synchronization and persistence need
separate schedules. Suggested initial budgets are design goals, not measured
results: touch response p95 below 50 ms; hand-to-visible response p95 below 100 ms
on selected target devices; bounded camera work and only one inference in flight.
A slow device should reduce decorative samples before compromising interaction.
Google documents synchronous MediaPipe inference blocking the UI and recommends
workers for video [R10].

Build a local-first authority adapter, not another application. Personal rooms run
without a shared backend. An offline shared client can inspect its last accepted
state and explicitly fork personal edits, but cannot silently commit to the shared
history. On reconnect, reconcile or require an explicit merge.

The target mailbox is not a full fix: it needs chart mapping, a new server endpoint,
force/contact rules, authorization, lease termination and accepted-state rendering.
Its cancel operation cannot undo a command already accepted remotely.

## 8. Shared place, camera, Eye and history

Each participant has an independent observer in one canonical world. Physical-room
anchors map local camera and hand coordinates into the shared virtual frame. A
person outside a selected high-dimensional slice remains a participant; do not
confuse slice visibility with tracking loss or disconnection.

Two people manipulating one material object need shared constraints or a handoff,
not two uncoordinated copies of its physics. Higher-dimensional access does not
grant permission to inspect someone else's private room. Camera frames remain local
unless explicit sharing/recording is selected. A neural adaptation never joins a
person to a room or exports their observations silently.

Camera brightness only affects presentation and sensing. It cannot alter virtual
material coefficients unless the user deliberately wires ambient lighting into the
world. Torch/exposure controls remain explicit and device-capability dependent.
Poor light, motion and lack of features can degrade real AR tracking [R11]. Keep
manual/touch navigation when sensors cannot provide reliable input.

Record accepted input sequence, simulation clock, coordinate charts, topology and
law versions, entity lineage, model hashes, integration settings, checkpoints and
observer/anchor updates. GPU floating-point differences can prevent bit-identical
replay across devices; retain authoritative checkpoints and bounded-error checks.
History is not camera video, and a simulated future is not an observed record.

## 9. Acceptance and integration order

Preserve old IDs, exports, controls and existing tests. Add modules and adapters,
not a rewrite. A proposed sequence is:

- Repair local-first startup and target capture. Demonstrate a continuous drag
  under delayed acknowledgements without delayed stale motion after release.
- Attach a coherent 4D material reference through an explicit world-law adapter.
  Keep this law distinct from real helium and from a free-surface liquid law.
- Couple object constraints and surface effects with explicit work/mass accounting.
- Make one nested space and one portal preserve the same material entity/history.
- Add the teacher dataset and train a material/interaction model. Deploy it only
  after comparison and failure-condition tests, not because its loss decreased.
- Reuse the existing shared authority. Run a physical two-device session and record
  independent Eye movement, extra-axis travel, object handoff and saved restoration.

Final acceptance scene: two participants in different rooms manipulate one relic.
A hand supplies a disturbance; the material responds and retains identity. Moving
along the fourth spatial direction changes the other participant's slice. The
other follows, edits the same object, enters its inner space and returns. The
session is saved and restored. Brightness changes readability, not world truth.
Turning the camera off preserves touch control. Learned behavior must improve a
measured task while the exact solver and previous model remain available.

## References and limits

[R1] McCanna & Price, Superfluid Vortices in Four Spatial Dimensions.
https://arxiv.org/abs/2005.07485
A modeled higher-dimensional Bose gas, not an observed physical 4D helium sample.

[R2] Rota & Boronat, Condensate fraction in liquid 4He at zero temperature.
https://arxiv.org/abs/1109.6133
Strong correlations and condensate fraction; does not make simple GP quantitative He-4.

[R3] UC Irvine low-temperature research, Wetting and Liquid Helium.
https://www.physics.uci.edu/~lowtemp/mix_wet/wethe.html
Substrate-dependent wetting; not a universal climb-by-zero-viscosity rule.

[R4] Sanchez-Gonzalez et al., Learning to Simulate Complex Physics with Graph Networks.
https://proceedings.mlr.press/v119/sanchez-gonzalez20a.html
Learned particle/graph dynamics, not demonstrated universal intelligence.

[R5] Rubanova et al., Constraint-based graph network simulator.
https://proceedings.mlr.press/v162/rubanova22a.html
Learned constraints, not automatic satisfaction of all Viva invariants.

[R6] Hu et al., DiffTaichi: Differentiable Programming for Physical Simulation.
https://arxiv.org/abs/1910.00935
https://github.com/taichi-dev/difftaichi
Differentiable teachers and optimization examples; not a ready-made 11D engine.

[R7] NVIDIA Warp.
https://github.com/NVIDIA/warp
GPU/CPU and differentiable kernels. Check versions, hardware and licenses before integration.

[R8] Satorras et al., E(n) Equivariant Graph Neural Networks.
https://proceedings.mlr.press/v139/satorras21a.html
Higher-dimensional Euclidean symmetry, not arbitrary curved-coordinate covariance.

[R9] Mordvintsev et al., Growing Neural Cellular Automata.
https://distill.pub/2020/growing-ca/
Trained pattern growth/repair, not general cognition or unconstrained online learning.

[R10] Google, Hand landmarks detection guide for Web.
https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js
Input runtimes and timing; no promise of accurate all-device tracking.

[R11] Google ARCore, TrackingFailureReason.
https://developers.google.com/ar/reference/java/com/google/ar/core/TrackingFailureReason
Physical tracking limitations; distinct from the simulated world's existence.
