# Story Mode

Story Mode is a guided tour of the Living Reality's simulated world objects.
An author assembles a **story** out of **beats**; a **player** walks the beats
one at a time. Everything is local-only: stories point at simulated world
objects, and every player snapshot carries the local-simulation flags.

Pure domain logic lives in `src/domains/story-mode.js`. It touches no DOM,
THREE, network, or storage. Boundary:

> Local story mode: a guided tour of simulated world objects only. No wallet,
> no custody, no mainnet, no network call, no real execution. Stories persist
> in this browser only.

## Concepts

- **Library** — the collection of stories plus a seq counter and the active
  story pointer. Created with `createStoryLibrary()`.
- **Story** — `{ id, canonical, title, description, beats }`. Ids are
  deterministic per operation order: `story-${++library.seq}`. Titles are
  required, trimmed, and capped at 80 characters.
- **Beat** — `{ id, kind, refId, title, caption }`. `kind` names what the beat
  points at; `refId` is the target's id. Beat ids follow the same counter:
  `beat-${++library.seq}`.
- **Canonical story** — `canonical: true`. Locked: add/update/remove/move of
  beats, rename, and delete are all rejected with `{ ok: false, reason:
  'canonical-story' }`. Duplicating it with `copyStory()` yields an editable
  copy titled `<title> (copy)` with fresh ids.
- **The Journey** — the canonical built-in story (`id: 'story-journey'`),
  Tumbo's designed journey end to end: 9 frozen beats from the giant block,
  through the constellation, the market, the ledger, contracts, relics, the
  journal, and back to one block. Seeded with `seedJourneyStory(library)`,
  which is idempotent.

## Beat kinds

`STORY_MODE_BEAT_KINDS = ['feature', 'world-view', 'contract', 'relic', 'bot']`

- `feature` — a world feature cube (refId is a feature id).
- `world-view` — one of `STORY_MODE_WORLD_VIEWS`:
  `['giant-block', 'constellation', 'tentacles']`.
- `contract` — an outcome contract in eternal escrow (simulated points).
- `relic` — a frozen relic (cube-form NFT record).
- `bot` — a bot from the plaza registry.

`validateBeat(beat, registry)` checks kind membership and a non-empty refId,
and — when a registry is supplied with an array or Set at `registry[kind]` —
that the refId is a known target. `validateStory(story, registry)` requires at
least one beat and reports per-beat errors as `[{ beatId, reason }]`.

## Planner

`planTraversal(story)` returns one entry per beat in play order:
`[{ index, beatId, kind, refId, title, caption }]`. It is a plain read — the
render layer decides how to materialize each beat (camera moves, panels,
chips).

## Player

`createStoryPlayer()` returns `{ state: 'idle', storyId: null, beatIndex: 0 }`.
States: `idle | playing | finished`.

- `playerStart(player, story, { beatIndex = 0 })` — needs at least one beat;
  index is range-checked. Sets `playing`.
- `playerNext` — advances; at the last beat the state becomes `finished`.
- `playerPrev` — steps back; at the first beat it returns
  `{ ok: false, reason: 'at-first-beat' }` with no mutation.
- `playerGoto(player, story, index)` — range-checked jump, no mutation on
  failure.
- `playerStop(player)` — back to `idle`.
- `currentBeat(player, story)` — the beat under the player, or null.

Every call returns `{ ok, state, beat, snapshot }`. Snapshots are frozen and
carry `{ simulation: true, externalTransfer: false, localOnly: true }` plus
`storyId`, `beatIndex`, `beatId`, `kind`, `refId`, `title`, and `at`. Illegal
transitions (not playing, story mismatch, already finished) return
`{ ok: false, reason }` and never mutate the player.

## Persistence

- `encodeLibrary(library)` / `decodeLibrary(text)` — JSON codec. Decode
  rejects non-objects and foreign `schemaVersion` values, and defensively
  fills missing fields (seq, stories, active pointers).
- `createStoryStore(storage)` — wraps a `{ getItem, setItem }` backend under
  the storage key `matumbo.story-mode.v1`. `load()` returns
  `{ ok, library, fresh }` (a missing key yields a fresh library with
  `fresh: true`); `save(library)` persists; `reset()` clears.
