# Vevo Agents v0.2 interactive architecture

This additive experiment preserves v0.1 at `v0.1-frozen` and uses the same
CPU-scale field and exact note workspace. It does not import third-party notes
application code.

## One state and one loop

SIMFABRIC stores one checkpointable state containing:

- the four-node resonant world (`q`, `v`, `u`, `du`, tick, work, damping and
  numerical residual);
- exact SQLite documents, revisions, links, workspace events and digests;
- four peripheral recurrent states and one structurally different recurrent
  center state;
- two-slot differentiable center memory;
- typed tool results, event history, RNG/episode seed and tick, physics, tool
  and work budgets; and model/training state when a training checkpoint is
  saved.

Exact documents/history remain authoritative. Learned memory is a learned
representation and weights are not treated as a universal code archive.
Permissions and sandbox enforcement stay deterministic.

## Interactive proof

1. A three-step bounded field cue drives one hidden candidate node. Four local
   observations are returned after that brief cue; later advances are
   post-cue dynamics/distractors.
2. The center selects a note key. The deterministic executor reads the current
   SQLite revision and returns note ID, revision, content digest, randomized
   diagnostic port and episode calibration, but withholds the target gate.
3. The center selects a diagnostic port. The executor runs six calibrated
   physical steps and returns typed response/work/energy. It reveals the target
   gate only if the current note and port are valid.
4. The center selects a gate. The executor performs bounded actuation. Success
   is the authoritative `gate_open[target_gate]` mutation within budgets, not
   an action label.

The center's bounded port drives affect the same field; changed field state is
returned to the neural loop. There is no privileged target input.

## Neural core

There are exactly five initial brains: four recurrent peripherals with seven
hidden units each and one recurrent five-unit center. The center consumes four
peripheral messages, a stage code and an eight-value typed-result vector. It
updates and reads two differentiable four-value memory slots, uses the memory
address key as a small direct cue/action path, emits four action logits and
   bounded field drives. The full model has 625 parameters. The matched control is
   one recurrent no-memory controller with 625 parameters and the same input,
interactive traces, optimizer steps, seeds and budgets.

Training uses the same field/note/tool transition code as evaluation: teacher
actions execute correct bounded episode actions, but model-generated field
drives and typed feedback are retained. Disjoint balanced train/validation/test
seeds and whole-trajectory held-out evaluation are reported; model selection
uses validation loss only.

## Causal and numerical checks

The proof runs wrong-note, stale-revision, shuffled-diagnostic-result,
memory-erase, actuation-disabled, field-feedback-off, each-peripheral-ablation,
center-ablation and fixed-tool controls. It also checks shared-edge
finite-difference forces, finite-difference gradients for all four peripheral
groups, center and initial memory, SQLite and model save/reload/replay, work,
damping, numerical residual and budget limits. No growth, web, shell,
credentials, live external actions or arbitrary tools are enabled.
