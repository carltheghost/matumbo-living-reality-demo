# v0.3 fresh mapping-transfer inference

- Status: `complete`
- Evaluation started: `True`
- Frozen model outcomes loaded: `True`
- Completed primary cases: `16/16`
- Completed row-relabel checks: `1536/1536`

The case manifest is the sealed source-only plan. No checkpoint is fitted
or mutated during inference. If a cap or failure occurs, later aggregate
metrics are intentionally omitted.

## Planned case partitions

The two nonzero partitions are reported separately: only the U partition
is globally never-inspected mapping evidence; the counterfactual-exposed
partition contains fresh physical worlds but is not U evidence.

| partition | exposure label | planned cases | raw records retained |
|---|---|---:|---:|
| seen_training_mapping_new_world | seen training mapping; fresh physical world | 0 | 0 |
| training_disjoint_previously_inspected_mapping_new_world | training-disjoint previously inspected mapping | 0 | 0 |
| training_disjoint_never_inspected_mapping_new_world | globally never-inspected mapping in U; U evidence | 8 | 8 |
| training_disjoint_counterfactual_exposed_mapping_new_world | fresh physical world with prior counterfactual row-relabel exposure; not U evidence | 8 | 8 |

## Resources and artifact preservation

- Wall-clock: `18.3813` seconds of `300` capped.
- CPU: `18.5454` seconds; single CPU process: `True`.
- Additional memory high-water: `12120` KiB of `524288` KiB.
- Screening artifacts verified byte-for-byte: `True`.
- Frozen checkpoint manifest: `576509668f556238ae11bb405cc5788fe6c5e54e4226ef01a4d81d20a2ee1bb0`.
- Frozen normalization digest: `cf43d9f347aca5d7a2339849b850e6d1c234fa8b0977df0459c45dfc0460cbeb`.

## Failures

- None recorded.

## Per-partition metrics

These metrics preserve the U versus counterfactual-exposed distinction.

| checkpoint | partition | n | joint accuracy | physical success | joint loss |
|---|---|---:|---:|---:|---:|
| control-seed-141 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| control-seed-141 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.00124701 |
| control-seed-141 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.00123303 |
| control-seed-141 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| control-seed-143 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| control-seed-143 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.000890682 |
| control-seed-143 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.000880807 |
| control-seed-143 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| full-seed-107 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| full-seed-107 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.00313564 |
| full-seed-107 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.00314873 |
| full-seed-107 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| full-seed-117 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| full-seed-117 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 1 | 8 | 0.00239269 |
| full-seed-117 | training_disjoint_never_inspected_mapping_new_world | 8 | 1 | 8 | 0.00239491 |
| full-seed-117 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| legacy-control-seed-141 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| legacy-control-seed-141 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 0.25 | 2 | 4.40838 |
| legacy-control-seed-141 | training_disjoint_never_inspected_mapping_new_world | 8 | 0.25 | 2 | 3.33723 |
| legacy-control-seed-141 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| legacy-control-seed-143 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| legacy-control-seed-143 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 0.25 | 2 | 4.61501 |
| legacy-control-seed-143 | training_disjoint_never_inspected_mapping_new_world | 8 | 0.25 | 2 | 2.89215 |
| legacy-control-seed-143 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| legacy-full-seed-107 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| legacy-full-seed-107 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 0.25 | 2 | 3.75439 |
| legacy-full-seed-107 | training_disjoint_never_inspected_mapping_new_world | 8 | 0.25 | 2 | 2.53301 |
| legacy-full-seed-107 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |
| legacy-full-seed-117 | seen_training_mapping_new_world | 0 | n/a | n/a | n/a |
| legacy-full-seed-117 | training_disjoint_counterfactual_exposed_mapping_new_world | 8 | 0.25 | 2 | 4.34509 |
| legacy-full-seed-117 | training_disjoint_never_inspected_mapping_new_world | 8 | 0.25 | 2 | 2.49283 |
| legacy-full-seed-117 | training_disjoint_previously_inspected_mapping_new_world | 0 | n/a | n/a | n/a |

## Per-checkpoint metrics

All planned partitions combined; not a globally-never-inspected-only estimate.

| checkpoint | n | joint accuracy | physical success | joint loss |
|---|---:|---:|---:|---:|
| control-seed-141 | 16 | 1 | 16 | 0.00124002 |
| control-seed-143 | 16 | 1 | 16 | 0.000885744 |
| full-seed-107 | 16 | 1 | 16 | 0.00314219 |
| full-seed-117 | 16 | 1 | 16 | 0.0023938 |
| legacy-control-seed-141 | 16 | 0.25 | 4 | 3.87281 |
| legacy-control-seed-143 | 16 | 0.25 | 4 | 3.75358 |
| legacy-full-seed-107 | 16 | 0.25 | 4 | 3.1437 |
| legacy-full-seed-117 | 16 | 0.25 | 4 | 3.41896 |

## Per-world metrics

| checkpoint | world | n | gate accuracy | frequency accuracy | joint accuracy | physical success | gate loss | frequency loss | joint loss |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| control-seed-141 | 20021 | 4 | 1 | 1 | 1 | 4 | 0.00198287 | 0.000501764 | 0.00124232 |
| control-seed-141 | 20023 | 4 | 1 | 1 | 1 | 4 | 0.00200164 | 0.000501764 | 0.0012517 |
| control-seed-141 | 20049 | 4 | 1 | 1 | 1 | 4 | 0.00195029 | 0.000501764 | 0.00122603 |
| control-seed-141 | 20050 | 4 | 1 | 1 | 1 | 4 | 0.00197829 | 0.000501764 | 0.00124002 |
| control-seed-143 | 20021 | 4 | 1 | 1 | 1 | 4 | 0.00136964 | 0.000401916 | 0.000885779 |
| control-seed-143 | 20023 | 4 | 1 | 1 | 1 | 4 | 0.00138925 | 0.000401916 | 0.000895585 |
| control-seed-143 | 20049 | 4 | 1 | 1 | 1 | 4 | 0.00134574 | 0.000401916 | 0.000873828 |
| control-seed-143 | 20050 | 4 | 1 | 1 | 1 | 4 | 0.00137366 | 0.000401916 | 0.000887786 |
| full-seed-107 | 20021 | 4 | 1 | 1 | 1 | 4 | 0.00533518 | 0.000954223 | 0.0031447 |
| full-seed-107 | 20023 | 4 | 1 | 1 | 1 | 4 | 0.00529895 | 0.000954223 | 0.00312659 |
| full-seed-107 | 20049 | 4 | 1 | 1 | 1 | 4 | 0.00529778 | 0.000954223 | 0.003126 |
| full-seed-107 | 20050 | 4 | 1 | 1 | 1 | 4 | 0.00538869 | 0.000954223 | 0.00317145 |
| full-seed-117 | 20021 | 4 | 1 | 1 | 1 | 4 | 0.00377082 | 0.00101909 | 0.00239495 |
| full-seed-117 | 20023 | 4 | 1 | 1 | 1 | 4 | 0.00376176 | 0.00101909 | 0.00239042 |
| full-seed-117 | 20049 | 4 | 1 | 1 | 1 | 4 | 0.00373686 | 0.00101909 | 0.00237797 |
| full-seed-117 | 20050 | 4 | 1 | 1 | 1 | 4 | 0.00380461 | 0.00101909 | 0.00241185 |
| legacy-control-seed-141 | 20021 | 4 | 0.25 | 1 | 0.25 | 1 | 8.81657 | 0.000448356 | 4.40851 |
| legacy-control-seed-141 | 20023 | 4 | 0.25 | 1 | 0.25 | 1 | 8.81607 | 0.000448002 | 4.40826 |
| legacy-control-seed-141 | 20049 | 4 | 0.25 | 1 | 0.25 | 1 | 6.67437 | 0.000312023 | 3.33734 |
| legacy-control-seed-141 | 20050 | 4 | 0.25 | 1 | 0.25 | 1 | 6.67394 | 0.000312043 | 3.33713 |
| legacy-control-seed-143 | 20021 | 4 | 0.25 | 1 | 0.25 | 1 | 9.22987 | 0.00019343 | 4.61503 |
| legacy-control-seed-143 | 20023 | 4 | 0.25 | 1 | 0.25 | 1 | 9.2298 | 0.000193341 | 4.615 |
| legacy-control-seed-143 | 20049 | 4 | 0.25 | 1 | 0.25 | 1 | 5.78404 | 0.000347344 | 2.8922 |
| legacy-control-seed-143 | 20050 | 4 | 0.25 | 1 | 0.25 | 1 | 5.78388 | 0.00034733 | 2.89211 |
| legacy-full-seed-107 | 20021 | 4 | 0.25 | 1 | 0.25 | 1 | 7.50733 | 0.0014605 | 3.7544 |
| legacy-full-seed-107 | 20023 | 4 | 0.25 | 1 | 0.25 | 1 | 7.50733 | 0.00146009 | 3.75439 |
| legacy-full-seed-107 | 20049 | 4 | 0.25 | 1 | 0.25 | 1 | 5.06442 | 0.00169983 | 2.53306 |
| legacy-full-seed-107 | 20050 | 4 | 0.25 | 1 | 0.25 | 1 | 5.06424 | 0.00169967 | 2.53297 |
| legacy-full-seed-117 | 20021 | 4 | 0.25 | 1 | 0.25 | 1 | 8.688 | 0.00220462 | 4.3451 |
| legacy-full-seed-117 | 20023 | 4 | 0.25 | 1 | 0.25 | 1 | 8.68797 | 0.00220409 | 4.34509 |
| legacy-full-seed-117 | 20049 | 4 | 0.25 | 1 | 0.25 | 1 | 4.9845 | 0.00120235 | 2.49285 |
| legacy-full-seed-117 | 20050 | 4 | 0.25 | 1 | 0.25 | 1 | 4.9844 | 0.00120237 | 2.4928 |

## Paired candidate-versus-legacy gains and losses

Each cell is `gain/loss/tie` over the same sealed cases.

| candidate | legacy | gate | frequency | joint | physical success |
|---|---|---:|---:|---:|---:|
| control-seed-141 | legacy-control-seed-141 | 12/0/4 | 0/0/16 | 12/0/4 | 12/0/4 |
| control-seed-143 | legacy-control-seed-143 | 12/0/4 | 0/0/16 | 12/0/4 | 12/0/4 |
| full-seed-107 | legacy-full-seed-107 | 12/0/4 | 0/0/16 | 12/0/4 | 12/0/4 |
| full-seed-117 | legacy-full-seed-117 | 12/0/4 | 0/0/16 | 12/0/4 | 12/0/4 |

## Row-relabel probability and tie checks

| checkpoint | checks | gate probability pass | frequency probability pass | context pass | selected-gate passed | selected-gate ties |
|---|---:|---:|---:|---:|---:|---:|
| control-seed-141 | 384 | 384 | 384 | 384 | 384 | 0 |
| control-seed-143 | 384 | 384 | 384 | 384 | 384 | 0 |
| full-seed-107 | 384 | 384 | 384 | 384 | 384 | 0 |
| full-seed-117 | 384 | 384 | 384 | 384 | 384 | 0 |
