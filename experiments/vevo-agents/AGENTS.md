# Vevo Agents project contract

This repository is an isolated, CPU-scale proof project. It is intentionally
separate from the existing Vivo/Living Reality repositories and must not edit
or import their runtime files at execution time.

## Scope

- Exactly five neural brains in the initial proof: four peripheral recurrent
  brains and one structurally different recurrent central brain.
- The central brain owns differentiable addressable memory, learned action
  selection, and typed tool-result feedback inside the neural loop.
- SIMFABRIC owns authoritative world, document/graph, event, budget, and
  checkpoint state. The renderer is read-only.
- The only executable tool in the proof is a bounded local resonance
  diagnostic. No network, shell, credentials, arbitrary code, growth, or live
  external action is enabled.

## Verification

Run `python -m unittest discover -s tests -v` from this repository. The proof
runner writes a report under `artifacts/` and records all seeds, counts,
budgets, controls, interventions, and numerical residuals.

Do not add third-party source until the parent task supplies its open-source
license findings. NumPy is an environment dependency used as a numerical
array library, not copied source.
