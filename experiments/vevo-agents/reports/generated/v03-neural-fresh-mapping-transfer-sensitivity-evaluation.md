# v0.3 inspected-case mapping-transfer sensitivity inference

- Status: `complete`
- Completed primary evaluations: `256/256`
- Baseline action replay: `passed` (64/64 pairs)

All cases are now-inspected robustness cases, not fresh mapping evidence.
The U and counterfactual-exposed partitions remain separate.

## Resources and stopping

- Wall-clock: `23.2649` / `300` seconds.
- Additional memory: `17116` / `524288` KiB.
- Checkpoint normalization exact: `True`.

## Partition counts

| partition | label | case records retained |
|---|---|---:|
| seen_training_mapping_new_world | seen-training mapping; zero planned cases | 0 |
| training_disjoint_previously_inspected_mapping_new_world | training-disjoint previously inspected mapping; zero planned cases | 0 |
| training_disjoint_never_inspected_mapping_new_world | U mapping, now inspected; not fresh evidence | 8 |
| training_disjoint_counterfactual_exposed_mapping_new_world | counterfactually exposed mapping, now inspected; not fresh evidence | 8 |

## Baseline replay

Exact action pairs: `64/64`; exact probability pairs: `64/64`.

## Per-arm per-checkpoint metrics

| arm | checkpoint | n | gate accuracy | frequency accuracy | joint accuracy | physical success | joint loss |
|---|---|---:|---:|---:|---:|---:|---:|
| baseline_existing_delay | control-seed-141 | 16 | 1 | 1 | 1 | 16 | 0.00124002 |
| baseline_existing_delay | control-seed-143 | 16 | 1 | 1 | 1 | 16 | 0.000885744 |
| baseline_existing_delay | full-seed-107 | 16 | 1 | 1 | 1 | 16 | 0.00314219 |
| baseline_existing_delay | full-seed-117 | 16 | 1 | 1 | 1 | 16 | 0.0023938 |
| hidden_delay_4 | control-seed-141 | 16 | 0.25 | 0.25 | 0.25 | 4 | 5.97665 |
| hidden_delay_4 | control-seed-143 | 16 | 0.5 | 0.5 | 0.5 | 8 | 2.72297 |
| hidden_delay_4 | full-seed-107 | 16 | 1 | 1 | 1 | 16 | 0.0046382 |
| hidden_delay_4 | full-seed-117 | 16 | 1 | 1 | 1 | 16 | 0.00275906 |
| hidden_delay_8 | control-seed-141 | 16 | 0 | 0 | 0 | 0 | 4.81375 |
| hidden_delay_8 | control-seed-143 | 16 | 0.25 | 0.5 | 0.25 | 4 | 3.02664 |
| hidden_delay_8 | full-seed-107 | 16 | 0.75 | 0.75 | 0.75 | 12 | 2.04668 |
| hidden_delay_8 | full-seed-117 | 16 | 1 | 1 | 1 | 16 | 0.00615417 |
| note_format_variant_baseline_delay | control-seed-141 | 16 | 1 | 1 | 1 | 16 | 0.00127995 |
| note_format_variant_baseline_delay | control-seed-143 | 16 | 1 | 1 | 1 | 16 | 0.000934137 |
| note_format_variant_baseline_delay | full-seed-107 | 16 | 1 | 1 | 1 | 16 | 0.00316729 |
| note_format_variant_baseline_delay | full-seed-117 | 16 | 1 | 1 | 1 | 16 | 0.00240261 |

## Per-arm partition metrics

| arm | checkpoint | partition | n | joint accuracy | physical success | joint loss |
|---|---|---|---:|---:|---:|---:|
| baseline_existing_delay | control-seed-141 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| baseline_existing_delay | control-seed-141 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| baseline_existing_delay | control-seed-141 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.00123303 |
| baseline_existing_delay | control-seed-141 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.00124701 |
| baseline_existing_delay | control-seed-143 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| baseline_existing_delay | control-seed-143 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| baseline_existing_delay | control-seed-143 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.000880807 |
| baseline_existing_delay | control-seed-143 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.000890682 |
| baseline_existing_delay | full-seed-107 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| baseline_existing_delay | full-seed-107 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| baseline_existing_delay | full-seed-107 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.00314873 |
| baseline_existing_delay | full-seed-107 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.00313564 |
| baseline_existing_delay | full-seed-117 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| baseline_existing_delay | full-seed-117 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| baseline_existing_delay | full-seed-117 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.00239491 |
| baseline_existing_delay | full-seed-117 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.00239269 |
| hidden_delay_4 | control-seed-141 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_4 | control-seed-141 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_4 | control-seed-141 | training_disjoint_never_inspected_mapping_new_world | 8 | 0.25 | 2 | 5.97684 |
| hidden_delay_4 | control-seed-141 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 0.25 | 2 | 5.97646 |
| hidden_delay_4 | control-seed-143 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_4 | control-seed-143 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_4 | control-seed-143 | training_disjoint_never_inspected_mapping_new_world | 8 | 0.5 | 4 | 2.72374 |
| hidden_delay_4 | control-seed-143 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 0.5 | 4 | 2.72221 |
| hidden_delay_4 | full-seed-107 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_4 | full-seed-107 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_4 | full-seed-107 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.00461666 |
| hidden_delay_4 | full-seed-107 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.00465974 |
| hidden_delay_4 | full-seed-117 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_4 | full-seed-117 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_4 | full-seed-117 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.00271441 |
| hidden_delay_4 | full-seed-117 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.0028037 |
| hidden_delay_8 | control-seed-141 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_8 | control-seed-141 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_8 | control-seed-141 | training_disjoint_never_inspected_mapping_new_world | 8 | 0 | 0 | 4.8199 |
| hidden_delay_8 | control-seed-141 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 0 | 0 | 4.8076 |
| hidden_delay_8 | control-seed-143 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_8 | control-seed-143 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_8 | control-seed-143 | training_disjoint_never_inspected_mapping_new_world | 8 | 0.25 | 2 | 3.02826 |
| hidden_delay_8 | control-seed-143 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 0.25 | 2 | 3.02502 |
| hidden_delay_8 | full-seed-107 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_8 | full-seed-107 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_8 | full-seed-107 | training_disjoint_never_inspected_mapping_new_world | 8 | 0.75 | 6 | 2.04973 |
| hidden_delay_8 | full-seed-107 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 0.75 | 6 | 2.04363 |
| hidden_delay_8 | full-seed-117 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_8 | full-seed-117 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| hidden_delay_8 | full-seed-117 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.00604657 |
| hidden_delay_8 | full-seed-117 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.00626178 |
| note_format_variant_baseline_delay | control-seed-141 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| note_format_variant_baseline_delay | control-seed-141 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| note_format_variant_baseline_delay | control-seed-141 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.00127709 |
| note_format_variant_baseline_delay | control-seed-141 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.00128282 |
| note_format_variant_baseline_delay | control-seed-143 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| note_format_variant_baseline_delay | control-seed-143 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| note_format_variant_baseline_delay | control-seed-143 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.000931667 |
| note_format_variant_baseline_delay | control-seed-143 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.000936607 |
| note_format_variant_baseline_delay | full-seed-107 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| note_format_variant_baseline_delay | full-seed-107 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| note_format_variant_baseline_delay | full-seed-107 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.00317907 |
| note_format_variant_baseline_delay | full-seed-107 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.00315551 |
| note_format_variant_baseline_delay | full-seed-117 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| note_format_variant_baseline_delay | full-seed-117 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| note_format_variant_baseline_delay | full-seed-117 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.00240517 |
| note_format_variant_baseline_delay | full-seed-117 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.00240005 |
