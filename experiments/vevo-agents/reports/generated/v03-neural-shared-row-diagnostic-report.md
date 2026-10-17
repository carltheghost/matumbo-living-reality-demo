# Frozen shared-row scorer diagnostic

Status: `complete`
Input report: `/workspace/matumbo-living-reality-demo/experiments/vevo-agents/reports/generated/v03-neural-delayed-shared-response-scale-report.json`

This is a frozen source/evidence diagnostic. It does not train, sweep, select checkpoints, or claim fresh generalization.

## Shortcut evidence

- Training-world target frequency→gate maps: `{"9200": [3, 0, 1, 2], "9201": [0, 2, 1, 3]}`.
- All four models agree with the target map on the training microset: `{"control-seed-141": true, "control-seed-143": true, "full-seed-107": true, "full-seed-117": true}`.
- All-four development success overlap: `10` cases.
- Primary historical baseline: `reports/generated/v03-neural-delayed-shared-response-scale-report.json` at `c35c2e6729dc867b516de8229ddd99adb88bcc44`; original v1 is retained as a secondary comparison.

## Architecture and symmetry

- Full parameter count legacy/shared: `11183` / `11184` (delta `1`).
- Control parameter count legacy/shared: `11178` / `11179` (delta `1`).
- Preprocessing non-response invariance: `32/32`; response-row permutation: `32/32`.
- Common body/frequency initialization exact across legacy/shared variants: full `True`, control `True`; frequency raw parameters `True`.
- This is a bundled action-head/context redesign, not a pure single-factor ablation: the shared gate changes and the frequency head moves to pre-final retained context.
- The shared head uses one bilinear scorer across rows. Its retained context is pre-final recurrent state plus memory read, so the final row permutation does not alter that context.
- The diagnostic scope is the final response hook only; it is not a full-trajectory slot-causality claim.

## Frozen row-permutation result

- `full-seed-107`: legacy reference; row symmetry not expected (`legacy_final_action_head_counterfactual_reference`).
- `full-seed-117`: legacy reference; row symmetry not expected (`legacy_final_action_head_counterfactual_reference`).
- `control-seed-141`: legacy reference; row symmetry not expected (`legacy_final_action_head_counterfactual_reference`).
- `control-seed-143`: legacy reference; row symmetry not expected (`legacy_final_action_head_counterfactual_reference`).

Structural shared-head replay (freshly initialized, untrained; not a performance result):
- `full-seed-107`: gate permutation `32/32`, frequency invariant `32/32`, retained context invariant `32/32`.
- `full-seed-117`: gate permutation `32/32`, frequency invariant `32/32`, retained context invariant `32/32`.
- `control-seed-141`: gate permutation `32/32`, frequency invariant `32/32`, retained context invariant `32/32`.
- `control-seed-143`: gate permutation `32/32`, frequency invariant `32/32`, retained context invariant `32/32`.

## Frequency, phase, and time scope

- Frequency/goal information can be carried in retained state from the note and delay; no evaluator reference gate or frequency label is fed to inference.
- No separate current frequency index, phase signal, or time signal is synthesized. Magnitude-only response measurements remain magnitude-only.

Historical artifacts and input checkpoint bytes were checked before/after diagnostic execution; no existing artifact is rewritten.
