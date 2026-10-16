# Frozen delayed-memory clipping: compact case diagnostic

Input report: `reports/generated/v03-neural-delayed-final-input-clipping-report.json`
Input report SHA-256: `8eb705585a495e9bd326a3abf3fa23ff78a382473a06d755dc2980f1e9fc0639`
Current source at analysis: `d83da256ed11e49a81cc676da1b07897e3a4c158`

This is a read-only projection of the historical 320-evaluation report. It does not retrain, reload weights for inference, or overwrite historical artifacts. The compact per-case rows cover the 32 previously inspected new-world cases for each frozen model.

## Success overlap, loss, and action changes

| checkpoint | baseline | clipped | overlap | union | Jaccard | baseline-only | clipped-only | mean loss baseline→clipped | action changes | raw/reference | raw→shared | legacy changes | clip changes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| full-seed-107 | 7 | 10 | 7 | 10 | 0.700 | 0 | 3 | 2.8089 → 2.6374 | 14 | 32/32 | 32/32 | 18 | 1 |
| full-seed-117 | 7 | 10 | 6 | 11 | 0.545 | 1 | 4 | 2.8025 → 2.4715 | 17 | 32/32 | 32/32 | 18 | 1 |
| control-seed-141 | 4 | 10 | 3 | 11 | 0.273 | 1 | 7 | 1.8098 → 2.3780 | 17 | 32/32 | 32/32 | 18 | 1 |
| control-seed-143 | 7 | 10 | 7 | 10 | 0.700 | 0 | 3 | 2.1668 → 2.7236 | 11 | 32/32 | 32/32 | 18 | 1 |

The overlap column is the count of identical case identities that succeed in both conditions; equal totals therefore do not imply identical success sets or predictions.

## Per-goal gate confusion

Rows are the authoritative physical gate and columns are the selected gate. Goals are target-frequency indices 0–3; each matrix has eight cases.

| checkpoint | condition | goal 0 | goal 1 | goal 2 | goal 3 |
|---|---|---|---|---|---|
| full-seed-107 | baseline | `0,0,0,0/1,0,0,1/4,0,0,0/2,0,0,0` | `0,0,1,1/0,0,1,0/0,0,2,0/1,0,2,0` | `1,0,1,0/0,4,0,0/0,1,0,1/0,0,0,0` | `0,0,0,4/0,0,1,0/0,0,0,0/0,0,1,2` |
| full-seed-107 | clip_response | `0,0,0,0/2,0,0,0/3,0,0,1/1,0,0,1` | `0,0,2,0/0,0,1,0/0,0,2,0/1,0,2,0` | `0,2,0,0/0,4,0,0/0,2,0,0/0,0,0,0` | `0,0,0,4/0,0,1,0/0,0,0,0/0,0,0,3` |
| full-seed-117 | baseline | `0,0,0,0/0,0,0,2/0,2,0,2/1,1,0,0` | `1,0,1,0/0,1,0,0/0,1,1,0/1,2,0,0` | `0,2,0,0/0,4,0,0/0,2,0,0/0,0,0,0` | `0,0,4,0/0,0,1,0/0,0,0,0/0,0,2,1` |
| full-seed-117 | clip_response | `0,0,0,0/2,0,0,0/3,0,0,1/1,0,0,1` | `0,0,2,0/0,0,1,0/0,0,2,0/1,0,2,0` | `0,2,0,0/0,4,0,0/0,2,0,0/0,0,0,0` | `0,0,1,3/0,0,1,0/0,0,0,0/0,0,0,3` |
| control-seed-141 | baseline | `0,0,0,0/0,0,0,2/3,0,1,0/2,0,0,0` | `0,0,1,1/0,0,1,0/0,0,1,1/0,0,3,0` | `0,1,1,0/0,1,3,0/0,2,0,0/0,0,0,0` | `0,0,4,0/0,0,1,0/0,0,0,0/0,2,0,1` |
| control-seed-141 | clip_response | `0,0,0,0/2,0,0,0/3,0,0,1/1,0,0,1` | `0,0,2,0/1,0,0,0/0,0,2,0/1,0,2,0` | `0,2,0,0/0,4,0,0/0,2,0,0/0,0,0,0` | `0,0,1,3/0,0,1,0/0,0,0,0/0,0,0,3` |
| control-seed-143 | baseline | `0,0,0,0/1,0,1,0/4,0,0,0/2,0,0,0` | `0,0,2,0/0,0,1,0/0,0,2,0/0,0,3,0` | `0,2,0,0/0,4,0,0/0,2,0,0/0,0,0,0` | `0,0,4,0/0,0,1,0/0,0,0,0/0,0,2,1` |
| control-seed-143 | clip_response | `0,0,0,0/2,0,0,0/3,0,0,1/2,0,0,0` | `1,0,1,0/1,0,0,0/0,0,2,0/1,0,2,0` | `0,2,0,0/0,4,0,0/0,2,0,0/0,0,0,0` | `0,0,1,3/0,0,1,0/0,0,0,0/0,0,0,3` |

## Target-column ordering and margins

`raw` is the physical response; `shared_max_abs` divides all 16 response coordinates by one train-only scalar; `legacy_normalized` is the saved per-coordinate centered/scaled input; `legacy_clipped` is that input after the historical final-update clip. Each order is descending gate indices and each margin is top1−top2.

| checkpoint | case | target gate | raw order/margin | shared order/margin | legacy order/margin | clipped order/margin | raw→shared |
|---|---|---:|---|---|---|---|---|
| full-seed-107 | world-9300/goal-0 | 3 | 3210/0.119 | 3210/0.4658 | 3210/0.0008702 | 3210/0.0008702 | True |
| full-seed-107 | world-9300/goal-1 | 2 | 2310/0.02374 | 2310/0.09293 | 2310/0.0002731 | 2310/0.0002731 | True |
| full-seed-107 | world-9300/goal-2 | 1 | 1203/0.02469 | 1203/0.09662 | 2013/0.7896 | 2013/0.7896 | True |
| full-seed-107 | world-9300/goal-3 | 0 | 0132/0.02615 | 0132/0.1024 | 0132/96.42 | 0132/3.007 | True |
| full-seed-107 | world-9301/goal-0 | 2 | 2310/0.1193 | 2310/0.4669 | 2130/3.121 | 2130/2.988 | True |
| full-seed-107 | world-9301/goal-1 | 3 | 3210/0.02391 | 3210/0.09357 | 3210/0.6283 | 3210/0.6283 | True |
| full-seed-107 | world-9301/goal-2 | 1 | 1302/0.02425 | 1302/0.09491 | 3012/2.122 | 3012/2.122 | True |
| full-seed-107 | world-9301/goal-3 | 0 | 0123/0.02614 | 0123/0.1023 | 0123/96.41 | 0123/2.981 | True |
| full-seed-107 | world-9302/goal-0 | 1 | 1023/0.1205 | 1023/0.4717 | 1230/224.6 | 1230/3.902 | True |
| full-seed-107 | world-9302/goal-1 | 0 | 0123/0.0233 | 0123/0.09118 | 1023/55.43 | 1023/1.997 | True |
| full-seed-107 | world-9302/goal-2 | 2 | 2031/0.0235 | 2031/0.09197 | 2031/1.324 | 2031/1.324 | True |
| full-seed-107 | world-9302/goal-3 | 3 | 3210/0.02538 | 3210/0.09933 | 3201/0.5413 | 3201/0.5413 | True |
| full-seed-107 | world-9303/goal-0 | 2 | 2310/0.1191 | 2310/0.4662 | 2130/3.117 | 2130/2.985 | True |
| full-seed-107 | world-9303/goal-1 | 3 | 3210/0.02389 | 3210/0.09349 | 3210/0.6282 | 3210/0.6282 | True |
| full-seed-107 | world-9303/goal-2 | 1 | 1302/0.02438 | 1302/0.09542 | 3012/2.117 | 3012/2.117 | True |
| full-seed-107 | world-9303/goal-3 | 0 | 0123/0.0261 | 0123/0.1021 | 0123/96.37 | 0123/2.958 | True |
| full-seed-107 | world-9304/goal-0 | 1 | 1203/0.1175 | 1203/0.4597 | 1230/222.6 | 1230/1.997 | True |
| full-seed-107 | world-9304/goal-1 | 2 | 2103/0.02467 | 2103/0.09654 | 1230/55.42 | 1230/2.005 | True |
| full-seed-107 | world-9304/goal-2 | 0 | 0231/0.02468 | 0231/0.09659 | 0231/0.5749 | 0231/0.5749 | True |
| full-seed-107 | world-9304/goal-3 | 3 | 3012/0.02575 | 3012/0.1008 | 0321/69.22 | 0321/1.996 | True |
| full-seed-107 | world-9305/goal-0 | 3 | 3120/0.1209 | 3120/0.473 | 1320/103.1 | 1320/2 | True |
| full-seed-107 | world-9305/goal-1 | 1 | 1320/0.02257 | 1320/0.08834 | 1320/79.32 | 1320/2 | True |
| full-seed-107 | world-9305/goal-2 | 2 | 2103/0.02305 | 2103/0.0902 | 2031/2.118 | 2031/2.118 | True |
| full-seed-107 | world-9305/goal-3 | 0 | 0231/0.02609 | 0231/0.1021 | 0231/95.95 | 0231/2.542 | True |
| full-seed-107 | world-9306/goal-0 | 2 | 2301/0.1193 | 2301/0.4671 | 2301/3.169 | 2301/3.035 | True |
| full-seed-107 | world-9306/goal-1 | 3 | 3201/0.02394 | 3201/0.09368 | 3201/0.6287 | 3201/0.6287 | True |
| full-seed-107 | world-9306/goal-2 | 0 | 0312/0.02377 | 0312/0.09301 | 3021/0.7831 | 3012/0.7831 | True |
| full-seed-107 | world-9306/goal-3 | 1 | 1023/0.02633 | 1023/0.103 | 0123/43.94 | 0123/0 | True |
| full-seed-107 | world-9307/goal-0 | 2 | 2013/0.1218 | 2013/0.4768 | 2130/3.136 | 2130/3.002 | True |
| full-seed-107 | world-9307/goal-1 | 0 | 0213/0.02206 | 0213/0.08636 | 0213/0.29 | 0213/0.29 | True |
| full-seed-107 | world-9307/goal-2 | 1 | 1032/0.02465 | 1032/0.09649 | 0312/0.003063 | 0312/0.003063 | True |
| full-seed-107 | world-9307/goal-3 | 3 | 3120/0.02552 | 3120/0.09988 | 3012/0.9119 | 3012/0.9119 | True |
| full-seed-117 | world-9300/goal-0 | 3 | 3210/0.119 | 3210/0.4658 | 3210/0.0008702 | 3210/0.0008702 | True |
| full-seed-117 | world-9300/goal-1 | 2 | 2310/0.02374 | 2310/0.09293 | 2310/0.0002731 | 2310/0.0002731 | True |
| full-seed-117 | world-9300/goal-2 | 1 | 1203/0.02469 | 1203/0.09662 | 2013/0.7896 | 2013/0.7896 | True |
| full-seed-117 | world-9300/goal-3 | 0 | 0132/0.02615 | 0132/0.1024 | 0132/96.42 | 0132/3.007 | True |
| full-seed-117 | world-9301/goal-0 | 2 | 2310/0.1193 | 2310/0.4669 | 2130/3.121 | 2130/2.988 | True |
| full-seed-117 | world-9301/goal-1 | 3 | 3210/0.02391 | 3210/0.09357 | 3210/0.6283 | 3210/0.6283 | True |
| full-seed-117 | world-9301/goal-2 | 1 | 1302/0.02425 | 1302/0.09491 | 3012/2.122 | 3012/2.122 | True |
| full-seed-117 | world-9301/goal-3 | 0 | 0123/0.02614 | 0123/0.1023 | 0123/96.41 | 0123/2.981 | True |
| full-seed-117 | world-9302/goal-0 | 1 | 1023/0.1205 | 1023/0.4717 | 1230/224.6 | 1230/3.902 | True |
| full-seed-117 | world-9302/goal-1 | 0 | 0123/0.0233 | 0123/0.09118 | 1023/55.43 | 1023/1.997 | True |
| full-seed-117 | world-9302/goal-2 | 2 | 2031/0.0235 | 2031/0.09197 | 2031/1.324 | 2031/1.324 | True |
| full-seed-117 | world-9302/goal-3 | 3 | 3210/0.02538 | 3210/0.09933 | 3201/0.5413 | 3201/0.5413 | True |
| full-seed-117 | world-9303/goal-0 | 2 | 2310/0.1191 | 2310/0.4662 | 2130/3.117 | 2130/2.985 | True |
| full-seed-117 | world-9303/goal-1 | 3 | 3210/0.02389 | 3210/0.09349 | 3210/0.6282 | 3210/0.6282 | True |
| full-seed-117 | world-9303/goal-2 | 1 | 1302/0.02438 | 1302/0.09542 | 3012/2.117 | 3012/2.117 | True |
| full-seed-117 | world-9303/goal-3 | 0 | 0123/0.0261 | 0123/0.1021 | 0123/96.37 | 0123/2.958 | True |
| full-seed-117 | world-9304/goal-0 | 1 | 1203/0.1175 | 1203/0.4597 | 1230/222.6 | 1230/1.997 | True |
| full-seed-117 | world-9304/goal-1 | 2 | 2103/0.02467 | 2103/0.09654 | 1230/55.42 | 1230/2.005 | True |
| full-seed-117 | world-9304/goal-2 | 0 | 0231/0.02468 | 0231/0.09659 | 0231/0.5749 | 0231/0.5749 | True |
| full-seed-117 | world-9304/goal-3 | 3 | 3012/0.02575 | 3012/0.1008 | 0321/69.22 | 0321/1.996 | True |
| full-seed-117 | world-9305/goal-0 | 3 | 3120/0.1209 | 3120/0.473 | 1320/103.1 | 1320/2 | True |
| full-seed-117 | world-9305/goal-1 | 1 | 1320/0.02257 | 1320/0.08834 | 1320/79.32 | 1320/2 | True |
| full-seed-117 | world-9305/goal-2 | 2 | 2103/0.02305 | 2103/0.0902 | 2031/2.118 | 2031/2.118 | True |
| full-seed-117 | world-9305/goal-3 | 0 | 0231/0.02609 | 0231/0.1021 | 0231/95.95 | 0231/2.542 | True |
| full-seed-117 | world-9306/goal-0 | 2 | 2301/0.1193 | 2301/0.4671 | 2301/3.169 | 2301/3.035 | True |
| full-seed-117 | world-9306/goal-1 | 3 | 3201/0.02394 | 3201/0.09368 | 3201/0.6287 | 3201/0.6287 | True |
| full-seed-117 | world-9306/goal-2 | 0 | 0312/0.02377 | 0312/0.09301 | 3021/0.7831 | 3012/0.7831 | True |
| full-seed-117 | world-9306/goal-3 | 1 | 1023/0.02633 | 1023/0.103 | 0123/43.94 | 0123/0 | True |
| full-seed-117 | world-9307/goal-0 | 2 | 2013/0.1218 | 2013/0.4768 | 2130/3.136 | 2130/3.002 | True |
| full-seed-117 | world-9307/goal-1 | 0 | 0213/0.02206 | 0213/0.08636 | 0213/0.29 | 0213/0.29 | True |
| full-seed-117 | world-9307/goal-2 | 1 | 1032/0.02465 | 1032/0.09649 | 0312/0.003063 | 0312/0.003063 | True |
| full-seed-117 | world-9307/goal-3 | 3 | 3120/0.02552 | 3120/0.09988 | 3012/0.9119 | 3012/0.9119 | True |
| control-seed-141 | world-9300/goal-0 | 3 | 3210/0.119 | 3210/0.4658 | 3210/0.0008702 | 3210/0.0008702 | True |
| control-seed-141 | world-9300/goal-1 | 2 | 2310/0.02374 | 2310/0.09293 | 2310/0.0002731 | 2310/0.0002731 | True |
| control-seed-141 | world-9300/goal-2 | 1 | 1203/0.02469 | 1203/0.09662 | 2013/0.7896 | 2013/0.7896 | True |
| control-seed-141 | world-9300/goal-3 | 0 | 0132/0.02615 | 0132/0.1024 | 0132/96.42 | 0132/3.007 | True |
| control-seed-141 | world-9301/goal-0 | 2 | 2310/0.1193 | 2310/0.4669 | 2130/3.121 | 2130/2.988 | True |
| control-seed-141 | world-9301/goal-1 | 3 | 3210/0.02391 | 3210/0.09357 | 3210/0.6283 | 3210/0.6283 | True |
| control-seed-141 | world-9301/goal-2 | 1 | 1302/0.02425 | 1302/0.09491 | 3012/2.122 | 3012/2.122 | True |
| control-seed-141 | world-9301/goal-3 | 0 | 0123/0.02614 | 0123/0.1023 | 0123/96.41 | 0123/2.981 | True |
| control-seed-141 | world-9302/goal-0 | 1 | 1023/0.1205 | 1023/0.4717 | 1230/224.6 | 1230/3.902 | True |
| control-seed-141 | world-9302/goal-1 | 0 | 0123/0.0233 | 0123/0.09118 | 1023/55.43 | 1023/1.997 | True |
| control-seed-141 | world-9302/goal-2 | 2 | 2031/0.0235 | 2031/0.09197 | 2031/1.324 | 2031/1.324 | True |
| control-seed-141 | world-9302/goal-3 | 3 | 3210/0.02538 | 3210/0.09933 | 3201/0.5413 | 3201/0.5413 | True |
| control-seed-141 | world-9303/goal-0 | 2 | 2310/0.1191 | 2310/0.4662 | 2130/3.117 | 2130/2.985 | True |
| control-seed-141 | world-9303/goal-1 | 3 | 3210/0.02389 | 3210/0.09349 | 3210/0.6282 | 3210/0.6282 | True |
| control-seed-141 | world-9303/goal-2 | 1 | 1302/0.02438 | 1302/0.09542 | 3012/2.117 | 3012/2.117 | True |
| control-seed-141 | world-9303/goal-3 | 0 | 0123/0.0261 | 0123/0.1021 | 0123/96.37 | 0123/2.958 | True |
| control-seed-141 | world-9304/goal-0 | 1 | 1203/0.1175 | 1203/0.4597 | 1230/222.6 | 1230/1.997 | True |
| control-seed-141 | world-9304/goal-1 | 2 | 2103/0.02467 | 2103/0.09654 | 1230/55.42 | 1230/2.005 | True |
| control-seed-141 | world-9304/goal-2 | 0 | 0231/0.02468 | 0231/0.09659 | 0231/0.5749 | 0231/0.5749 | True |
| control-seed-141 | world-9304/goal-3 | 3 | 3012/0.02575 | 3012/0.1008 | 0321/69.22 | 0321/1.996 | True |
| control-seed-141 | world-9305/goal-0 | 3 | 3120/0.1209 | 3120/0.473 | 1320/103.1 | 1320/2 | True |
| control-seed-141 | world-9305/goal-1 | 1 | 1320/0.02257 | 1320/0.08834 | 1320/79.32 | 1320/2 | True |
| control-seed-141 | world-9305/goal-2 | 2 | 2103/0.02305 | 2103/0.0902 | 2031/2.118 | 2031/2.118 | True |
| control-seed-141 | world-9305/goal-3 | 0 | 0231/0.02609 | 0231/0.1021 | 0231/95.95 | 0231/2.542 | True |
| control-seed-141 | world-9306/goal-0 | 2 | 2301/0.1193 | 2301/0.4671 | 2301/3.169 | 2301/3.035 | True |
| control-seed-141 | world-9306/goal-1 | 3 | 3201/0.02394 | 3201/0.09368 | 3201/0.6287 | 3201/0.6287 | True |
| control-seed-141 | world-9306/goal-2 | 0 | 0312/0.02377 | 0312/0.09301 | 3021/0.7831 | 3012/0.7831 | True |
| control-seed-141 | world-9306/goal-3 | 1 | 1023/0.02633 | 1023/0.103 | 0123/43.94 | 0123/0 | True |
| control-seed-141 | world-9307/goal-0 | 2 | 2013/0.1218 | 2013/0.4768 | 2130/3.136 | 2130/3.002 | True |
| control-seed-141 | world-9307/goal-1 | 0 | 0213/0.02206 | 0213/0.08636 | 0213/0.29 | 0213/0.29 | True |
| control-seed-141 | world-9307/goal-2 | 1 | 1032/0.02465 | 1032/0.09649 | 0312/0.003063 | 0312/0.003063 | True |
| control-seed-141 | world-9307/goal-3 | 3 | 3120/0.02552 | 3120/0.09988 | 3012/0.9119 | 3012/0.9119 | True |
| control-seed-143 | world-9300/goal-0 | 3 | 3210/0.119 | 3210/0.4658 | 3210/0.0008702 | 3210/0.0008702 | True |
| control-seed-143 | world-9300/goal-1 | 2 | 2310/0.02374 | 2310/0.09293 | 2310/0.0002731 | 2310/0.0002731 | True |
| control-seed-143 | world-9300/goal-2 | 1 | 1203/0.02469 | 1203/0.09662 | 2013/0.7896 | 2013/0.7896 | True |
| control-seed-143 | world-9300/goal-3 | 0 | 0132/0.02615 | 0132/0.1024 | 0132/96.42 | 0132/3.007 | True |
| control-seed-143 | world-9301/goal-0 | 2 | 2310/0.1193 | 2310/0.4669 | 2130/3.121 | 2130/2.988 | True |
| control-seed-143 | world-9301/goal-1 | 3 | 3210/0.02391 | 3210/0.09357 | 3210/0.6283 | 3210/0.6283 | True |
| control-seed-143 | world-9301/goal-2 | 1 | 1302/0.02425 | 1302/0.09491 | 3012/2.122 | 3012/2.122 | True |
| control-seed-143 | world-9301/goal-3 | 0 | 0123/0.02614 | 0123/0.1023 | 0123/96.41 | 0123/2.981 | True |
| control-seed-143 | world-9302/goal-0 | 1 | 1023/0.1205 | 1023/0.4717 | 1230/224.6 | 1230/3.902 | True |
| control-seed-143 | world-9302/goal-1 | 0 | 0123/0.0233 | 0123/0.09118 | 1023/55.43 | 1023/1.997 | True |
| control-seed-143 | world-9302/goal-2 | 2 | 2031/0.0235 | 2031/0.09197 | 2031/1.324 | 2031/1.324 | True |
| control-seed-143 | world-9302/goal-3 | 3 | 3210/0.02538 | 3210/0.09933 | 3201/0.5413 | 3201/0.5413 | True |
| control-seed-143 | world-9303/goal-0 | 2 | 2310/0.1191 | 2310/0.4662 | 2130/3.117 | 2130/2.985 | True |
| control-seed-143 | world-9303/goal-1 | 3 | 3210/0.02389 | 3210/0.09349 | 3210/0.6282 | 3210/0.6282 | True |
| control-seed-143 | world-9303/goal-2 | 1 | 1302/0.02438 | 1302/0.09542 | 3012/2.117 | 3012/2.117 | True |
| control-seed-143 | world-9303/goal-3 | 0 | 0123/0.0261 | 0123/0.1021 | 0123/96.37 | 0123/2.958 | True |
| control-seed-143 | world-9304/goal-0 | 1 | 1203/0.1175 | 1203/0.4597 | 1230/222.6 | 1230/1.997 | True |
| control-seed-143 | world-9304/goal-1 | 2 | 2103/0.02467 | 2103/0.09654 | 1230/55.42 | 1230/2.005 | True |
| control-seed-143 | world-9304/goal-2 | 0 | 0231/0.02468 | 0231/0.09659 | 0231/0.5749 | 0231/0.5749 | True |
| control-seed-143 | world-9304/goal-3 | 3 | 3012/0.02575 | 3012/0.1008 | 0321/69.22 | 0321/1.996 | True |
| control-seed-143 | world-9305/goal-0 | 3 | 3120/0.1209 | 3120/0.473 | 1320/103.1 | 1320/2 | True |
| control-seed-143 | world-9305/goal-1 | 1 | 1320/0.02257 | 1320/0.08834 | 1320/79.32 | 1320/2 | True |
| control-seed-143 | world-9305/goal-2 | 2 | 2103/0.02305 | 2103/0.0902 | 2031/2.118 | 2031/2.118 | True |
| control-seed-143 | world-9305/goal-3 | 0 | 0231/0.02609 | 0231/0.1021 | 0231/95.95 | 0231/2.542 | True |
| control-seed-143 | world-9306/goal-0 | 2 | 2301/0.1193 | 2301/0.4671 | 2301/3.169 | 2301/3.035 | True |
| control-seed-143 | world-9306/goal-1 | 3 | 3201/0.02394 | 3201/0.09368 | 3201/0.6287 | 3201/0.6287 | True |
| control-seed-143 | world-9306/goal-2 | 0 | 0312/0.02377 | 0312/0.09301 | 3021/0.7831 | 3012/0.7831 | True |
| control-seed-143 | world-9306/goal-3 | 1 | 1023/0.02633 | 1023/0.103 | 0123/43.94 | 0123/0 | True |
| control-seed-143 | world-9307/goal-0 | 2 | 2013/0.1218 | 2013/0.4768 | 2130/3.136 | 2130/3.002 | True |
| control-seed-143 | world-9307/goal-1 | 0 | 0213/0.02206 | 0213/0.08636 | 0213/0.29 | 0213/0.29 | True |
| control-seed-143 | world-9307/goal-2 | 1 | 1032/0.02465 | 1032/0.09649 | 0312/0.003063 | 0312/0.003063 | True |
| control-seed-143 | world-9307/goal-3 | 3 | 3120/0.02552 | 3120/0.09988 | 3012/0.9119 | 3012/0.9119 | True |

## Goal-conditioned collisions

A collision groups different goal indices within one world that share the same descending target-column gate ordering. Exact-value collisions are additionally checked after rounding to 1e−12.

| representation | ordering collision groups | ordering pairs | exact-value groups |
|---|---:|---:|---:|
| raw | 0 | 0 | 0 |
| shared_max_abs | 0 | 0 | 0 |
| legacy_normalized | 2 | 2 | 0 |
| legacy_clipped | 2 | 2 | 0 |

## Corrected historical label and preservation

The historical field named `at_clip_bound_after_count` uses `abs(response_after) >= 3`, so it counts at-or-beyond-bound values, not exact-bound values only. New source output uses `at_or_beyond_clip_bound_after_count`; the historical JSON/summary/checkpoints remain unchanged.

Historical artifacts unchanged during analysis: `True`.
