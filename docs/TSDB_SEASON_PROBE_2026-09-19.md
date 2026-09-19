# TheSportsDB season-key probe — 2026-09-19

Two probes, run against the live TheSportsDB `eventsseason.php` endpoint, to
replace the hard-coded July season flip with measured per-league metadata.

## Method

1. **Working-key probe** (`tsdb-season-probe-2026-09-19.json`, 44 league ids):
   recorded which season key (`2026-2027`, `2026`, …) returned events for
   each id on 2026-09-19. This produced the catalog's `seasonType`
   (`european` vs `calendar`) assignments.
2. **Re-probe** (`tsdb-season-reprobe-2026-09-19.json`, same 44 ids): for each
   id, fetched up to three candidate keys — the recorded working key, the
   other format (`2026` ↔ `2026-2027`), and the previous year-pair
   (`2025-2026`) — and recorded event count plus min/max event dates per key.

## Findings

- **Format assignments confirmed.** Every id returned events only under keys
  matching its catalog `seasonType`. No league needed to switch formats.
- **June-start leagues (measured):** `tsdb.4655` (Moldovan Divizia Nationala)
  and `tsdb.5200` (Vietnamese National Cup) have June 2026 events under the
  `2026-2027` key (and June 2025 events under `2025-2026`). Both catalog
  entries now carry `seasonStartMonth: 6`.
- **July default retained everywhere else.** The re-probe responses were
  capped at ~5 events per id, so true season start/end months could NOT be
  reliably measured for the other european leagues (a 5-event sample pins
  neither boundary). Rather than guess, those entries keep the
  backwards-compatible July default (`seasonStartMonth` omitted → 7). The
  one-step adjacent-season retry in the TSDB turn is the safety net for
  boundary-month dateParams: a wrong primary key resolves as honest empty
  after the retry rules out the neighboring key.
- **Primera RFEF (ids 4673, 4750): zero events under every key** —
  `2026-2027`, `2026`, and `2025-2026` all returned OK with no events.
  These leagues resolve as honest empty (cached), never fabricated.
- **Dual-keyed ids:** 4824 (J League 2) has events under both `2026-2027`
  and `2026`; 4973 (Georgian league) under both `2026` and `2025-2026`.
  The primary key works today, so no catalog change; the adjacent retry
  covers a future key migration.
- **Southern-hemisphere / split seasons:** no id in the current catalog
  required a non-July flip beyond the two measured June starts. If one is
  added later, measure it the same way and set `seasonStartMonth`.

## What was deliberately NOT done

- No `seasonStartMonth` was set from a 5-event sample where the boundary
  was ambiguous (e.g. ids whose sampled events started in August/September
  — that may be the API's sample window, not the season start).
- No league was re-typed between `european`/`calendar` on sample evidence
  alone; the working-key probe is the authority there.
- No events, scores, or dates were invented for empty keys (RFEF).

## Raw data

- `~/workspace/league-catalog/tsdb-season-probe-2026-09-19.json` — working key per id
- `~/workspace/league-catalog/tsdb-season-reprobe-2026-09-19.json` — per-key counts and date ranges
