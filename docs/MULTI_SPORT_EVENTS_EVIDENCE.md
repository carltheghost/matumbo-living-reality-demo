# Multi-Sport Scoreboards · public evidence

The cube-first demo now has a standalone **Multi-Sport Scoreboards** route. It
reads three fixed, browser-safe ESPN public web API scoreboards after an
explicit refresh:

- `https://site.web.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard`
- `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard`
- `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`

The domain adapter is [src/domains/multi-sport-events.js](../src/domains/multi-sport-events.js).
It bounds the allowlist to three providers, limits each provider to twelve
competition rows, caps each request at 60 seconds (the default is 9 seconds),
and performs requests sequentially. The normalizer retains provider-returned
competition, participant/team or player, score, status, event time, venue,
season/week, leader text, and source URL fields. It drops unrelated payload
fields and never supplies a fixture row when a provider is empty, malformed,
timed out, or unavailable.

The presentation adapter is [src/render/multi-sport-events.js](../src/render/multi-sport-events.js).
It owns DOM rendering only; `src/main.js` owns the explicit button and URL
refresh callback. Selecting, replaying, and resetting an event are local
inspection traces. The panel has no credentials, identity, persistence,
media nodes, external action, outcome claim, or value authority. Data grade is
field completeness only.

## Shareable route

```text
http://localhost:8080/?build=control4&fresh=20260828&panel=multi-sport-events
```

Opening that URL performs one explicit refresh of the three fixed endpoints.
The ordinary landing route and local feature routes remain network-free.

## Packet 116 evidence

Browser replay: `work/audit-multi-sport-public-evidence-116.mjs`.

Observed on 2026-08-28 against the local HTTP server:

- exactly three provider requests (soccer/eng.1, basketball/nba, football/nfl)
- all three providers ready; 14 provider-returned rows (soccer 1, NBA 1,
  NFL 12) under the per-provider cap
- event rows visibly expose sport/league, participants, score fields, status,
  event time, venue, completeness, and source URL
- no image, audio, iframe, or video node in the panel; camera stream inactive
- the visible Three.js world child remained `semantic-block-world`
- no browser page errors; audit JSON `passed: true`

The generated screenshot is `work/multi-sport-public-evidence-116.png`, and
the machine-readable result is `work/audit-multi-sport-public-evidence-116.json`.

Focused tests:

```text
node --test tests/multi-sport-events.test.mjs tests/multi-sport-events-render.test.mjs
```

## "All leagues" browser (Phase 2, 2026-09-19)

The multi-sport console gained an on-demand league browser behind a
**Browse all leagues** button. The browser modal reads a single ESPN soccer
scoreboard per request with day navigation (past/present/future via
`?dates=YYYYMMDD`).

### Catalog

- `src/data/league-catalog.js`: 83 probe-verified ESPN soccer leagues
  (frozen), region-ordered (Popular first, countries A–Z, International last),
  plus a 47-entry `LEAGUE_UNAVAILABLE` list of requested labels with no working
  ESPN slug. The catalog is the slug allowlist: a request slug must match
  `LEAGUE_SCOREBOARD_SLUG_PATTERN` **and** be an exact catalog hit, otherwise
  the promise rejects with zero network calls. UI input can never become a URL.

### Fetch contract (one shared queue, `createLeagueScoreboardQueue`)

- Single in-flight request globally; a newly scheduled request aborts the
  previous one via AbortController (the superseded promise still resolves as
  an unavailable envelope — nothing is dropped silently).
- At least 1000ms between network-call starts; requests queue, never drop.
- Cache key `${slug}:${YYYYMMDD}` with TTLs: 45s when any record is live,
  10min when all records are settled, 3min when zero records. Only `ready`
  envelopes are cached — aborted/failed fetches never poison the cache.
- Session budget of 90 network calls (reserved at request time, fail closed);
  past it, the queue resolves a throttled envelope with the exact reason
  "Slow down — session request budget reached" and no fetch.
- Empty league → `status: "ready"`, `empty: true`, with the honest reason
  "No matches on this date · the season may be off" — never fabricated rows.

### Modal tuning controls

Search (label/slug/ESPN name), region groups, favorites (max 6, localStorage
with in-memory fallback), day navigation (prev/today/next + date picker),
status chips (All/Live/Final/Scheduled), sort (kickoff/live-first),
compact/detailed view, refresh, and paged "show more" (20 at a time). Every
game row shows date/time, period, venue, and score. Stale responses are
dropped via a request sequence; closing the modal invalidates in-flight
requests so a late response cannot repaint it. Escape closes the modal
without closing the parent console; focus returns to the browse button.

### Empty / error / throttled states

- No league selected → placeholder text; never blank.
- Empty date → no-matches message with the date and league named.
- Network error → the envelope's real reason is surfaced (e.g. HTTP status),
  not a generic "no games".
- Throttled → prior rows stay on screen (never blanked) with a "slow down"
  status message.

### Verification (Agent C, 2026-09-19)

- Unit: `node --test tests/league-scoreboard.test.mjs` — 19/19 pass
  (catalog shape, slug/date guards with zero fetch calls, ≥1000ms spacing,
  abort supersede, cache hit + TTL expiry + live/settled/empty TTL selection,
  no caching of failed fetches, budget → throttled envelope, empty league,
  date/classifier edge cases, replay determinism, 3-provider regression).
- Critique fixes landed: the modal was moved out of the parent aside (its
  `backdrop-filter` trapped `position:fixed` to the panel box); failed/aborted
  fetches no longer poison the cache; throttled/close-during-load no longer
  strand the loading dim; provider-error reasons are shown instead of a
  misleading "no games".
- Browser: headless Chromium 152 via CDP against a local CORS-enabled HTTP
  server (VM quirk: this Chromium build hard-blocks real navigation to
  localhost via Local Network Access checks, and the egress proxy returns
  ERR_EMPTY_RESPONSE to the browser, so the app was loaded with
  `Page.setDocumentContent` + `<base href>` and ESPN responses were
  fulfilled through CDP Fetch interception using real payloads captured via
  curl — all app code, queue logic, caching, and rendering ran unmodified).
  Desktop 1280x800: modal opens, covers the viewport (B1 fix verified:
  it lives in `#hud`, outside the `backdrop-filter` console aside, and
  `#hud` has no containing-block traps); 83 leagues across 43 region
  groups; selecting EPL loads 5 games with date/time/status/clock/scores
  and venue in detailed view (`READY · EPL · 2026-09-19 · 5 GAMES`); day
  stepping refetches with a new date; search narrows the league list;
  status chips filter with honest empty copy; a far-future date shows the
  no-matches message; Escape closes the modal. Mobile 390x844: no
  horizontal overflow (`document.scrollingElement.scrollWidth <=
  innerWidth`). Zero console errors from the league feature code — the only
  two exceptions are person-studio `crypto.randomUUID`/`crypto.subtle`
  failures caused by the harness's opaque origin (`isSecureContext` is
  false under `about:blank` injection), in files this branch does not
  touch. Screenshots: `/tmp/league-verify/desktop-games.png`,
  `/tmp/league-verify/desktop-modal.png`,
  `/tmp/league-verify/mobile-modal.png`; full JSON report:
  `/tmp/league-verify/verify-report.json`.

## Multi-provider extension (Agent D, 2026-09-19)

The league browser now serves three providers through one shared queue.
Project law: fixtures/scores only — no odds, wagering, markets, or
predictions from any source.

### Catalog v2 — 129 entries

`src/data/league-catalog.js` (`LEAGUE_CATALOG_VERSION = 2`, frozen):

- 85 ESPN (`provider: "espn"`), 43 TheSportsDB (`provider: "thesportsdb"`
  with `tsdbIds`, `tsdbName`, `seasonType: "european" | "calendar"`),
  1 OpenLigaDB (`provider: "openligadb"`, `ger.w.ffb1` Frauen-Bundesliga).
- New ESPN entries: `por.taca.portugal` (Portuguese Cup), `usa.usl.1`
  (USL Championship).
- `LEAGUE_UNAVAILABLE` is down to one entry: Czech Cup — not on the ESPN
  public API, not on TheSportsDB, and SportScore's free tier too flaky
  (3/3 build probes timed out).

### Provider contracts

- **TheSportsDB** (`https://www.thesportsdb.com/api/v1/json/3/eventsseason.php?id=<id>&s=<season>`):
  european leagues use `YYYY-YYYY`, calendar leagues `YYYY`. Whole-season
  payloads are cached under `tsdb:<ids>:<season>`; day envelopes derive
  from the cache, so day-stepping costs zero network. Scored rows →
  `final`, future unscored rows → `scheduled`; TheSportsDB never reports
  `live`. Multi-id leagues (Spanish Primera División RFEF: ids 4673, 4750)
  merge groups and reserve one budget unit per HTTP call. Provider pacing
  ≥2000ms between TheSportsDB network starts, on top of the global
  ≥1000ms. All-failed groups resolve `unavailable` with the real provider
  reason (never a cached empty season).
- **OpenLigaDB** (`https://api.openligadb.de/getmatchdata/<league>/<year>`):
  whole-season cache under `openligadb:<league>:<year>`; day envelopes
  derive from it. Verified 2026-09-19: `getmatchdata/ffb1/2026` returned
  182 events with CORS `*` (later curl attempts through the VM egress
  path timed out; the contract is implemented from the recorded payload
  shape).
- **SportScore: excluded.** Free-tier API key issued, but 3/3 build probes
  timed out and earlier research showed Cloudflare challenges on 2/3
  attempts (the one success returned empty). The registry still accepts
  the `"sportscore"` provider tag for future work, but no catalog entry
  uses it and no SportScore link was added to the UI.

### TheSportsDB per-league probe (2026-09-19, live API)

All 43 catalog entries (44 ids) probed with 2.2s spacing; raw results in
`~/workspace/league-catalog/tsdb-season-probe-2026-09-19.json`. 42/44 ids
returned events (sparse community data: 5 events/season typical; Polish
Ekstraklasa and Romanian Liga II returned 15):

| id | league | season | events |
|----|--------|--------|--------|
| 4617 | Albanian Superliga | `2026-2027` | 5 |
| 4618 | Andorran Primera Divisio | `2026-2027` | 5 |
| 4619 | Armenian Premier League | `2026-2027` | 5 |
| 4693 | Azerbaijan Premier League | `2026-2027` | 5 |
| 4623 | Belgian Challenger Pro League | `2026-2027` | 5 |
| 4624 | Bosnian Premier League | `2026-2027` | 5 |
| 4626 | Bulgarian A League | `2026-2027` | 5 |
| 4913 | Bulgarian B League | `2026-2027` | 5 |
| 4820 | Canadian PL | `2026` | 5 |
| 5210 | Chinese Taipei - Premier League | `2026-2027` | 5 |
| 4629 | Croatian 1 HNL | `2026-2027` | 5 |
| 4952 | Croatian 2 HNL | `2026-2027` | 5 |
| 4954 | Czech 2 Liga | `2026-2027` | 5 |
| 4958 | Estonian Esiliiga | `2026` | 5 |
| 4634 | Estonian PL | `2026` | 5 |
| 4635 | Faroe Premier League | `2026` | 5 |
| 4973 | Georgian Erovnuli Liga 2 | `2026` | 5 |
| 4638 | Georgian Umaglesi Liga | `2026` | 5 |
| 4825 | Hong Kong Premier League | `2026-2027` | 5 |
| 4690 | Hungarian NB I | `2026-2027` | 5 |
| 4965 | Hungarian NB II | `2026-2027` | 5 |
| 4642 | Icelandic Urvalsdeild | `2026` | 5 |
| 4757 | Irish Division 1 | `2026` | 5 |
| 5638 | Irish FAI Cup | `2026` | 5 |
| 4824 | Japanese J League 2 | `2026-2027` | 5 |
| 5656 | Lithuanian 1 Lyga | `2026` | 5 |
| 4651 | Lithuanian A Lyga | `2026` | 5 |
| 4655 | Moldovan Divizia Nationala | `2026-2027` | 5 |
| 4656 | Montenegrin 1st League | `2026-2027` | 5 |
| 5208 | Norwegian Toppserien Ladies | `2026` | 5 |
| 4422 | Polish Ekstraklasa | `2026-2027` | 15 |
| 4661 | Polish I Liga | `2026-2027` | 5 |
| 4665 | Romanian Liga II | `2026-2027` | 15 |
| 4671 | Serbian Super League | `2026-2027` | 5 |
| 5314 | Slovakian 2 Liga | `2026-2027` | 5 |
| 4672 | Slovakian Super League | `2026-2027` | 5 |
| 4692 | Slovenian Premier League | `2026-2027` | 5 |
| 4689 | South Korean K League 1 | `2026` | 5 |
| 4822 | South Korean K League 2 | `2026` | 5 |
| 4673 | Spanish Primera División RFEF | `2026-2027` | **0** |
| 4750 | Spanish Primera División RFEF | `2026-2027` | **0** |
| 5209 | Swedish Damallsvenskan | `2026` | 5 |
| 4354 | Ukrainian Premier League | `2026-2027` | 5 |
| 5200 | Vietnamese National Cup | `2026-2027` | 5 |

Caveats (do not over-claim):

- TheSportsDB responses are sparse community data (5 events/season is
  typical) — the UI presents them as-is with honest empty states, never
  as complete season coverage.
- Spanish Primera División RFEF: both ids return **zero** events for the
  current season `2026-2027`; the entry resolves to an honest empty state
  (stale/sparse on TheSportsDB). Older seasons returned a handful of
  events, but the client always requests the current season.
- Two ESPN-overlapping TSDB ids were also verified live: USL
  Championship id 4684 (current season `2026`, 5 events each in 2024,
  2025, 2026) and Portuguese Cup id 4510 (probed earlier the same day).

### Queue fixes (browser-found)

- **Fetch binding:** `createLeagueScoreboardQueue({})` (and the two older
  multi-sport fetch helpers) defaulted to the unbound `globalThis.fetch`,
  which throws `Failed to execute 'fetch' on 'Window': Illegal invocation`
  in Chromium — league selection could never load games in a real
  browser. Defaults are now `(...args) => globalThis.fetch(...args)`.
  Regression test included.
- **Supersede re-check after inter-group pacing:** a multi-id turn checked
  for supersede *before* its ~2000ms inter-group pacing wait; a newer turn
  starting during the wait had its abort handle clobbered and its fetch
  run concurrently (two in-flight requests). The check now runs *after*
  the wait, before `beginNetwork()`. Regression test included (fails on
  the old order, passes on the new).

### Unit tests

`node --test tests/league-scoreboard.test.mjs` — **31/31 pass** (catalog
v2 shape/counts/provider tags, ESPN regressions, pacing/supersede/TTL/
budget, unknown-provider rejection, TSDB URL/season shapes, scored→final
/ future→scheduled, attribution, whole-season caching, multi-id merge +
budget, TSDB ≥2000ms pacing, failure cache protection, OpenLigaDB
contract + season caching, fetch-binding regression, inter-group
supersede regression, 3-provider regression).

### Browser verification (Agent D, 2026-09-19)

Same CDP method as Agent C (one headless Chromium, `Page.setDocumentContent`
+ `<base href>`, Fetch interception, real curl-captured payloads; raw CDP
over a hand-rolled WebSocket client — no Playwright/ws packages installed).
TheSportsDB `eventsseason.php?id=4422&s=2026-2027` was fulfilled with the
real captured payload (15 events, 2026-07-24 → 2026-08-02). The app's
`createLeagueScoreboardQueue({})` is constructed with NO injected fetch —
games load through the default fetch path, exercising the binding fix:

- Desktop 1280×800: modal opens; search narrows to Polish Ekstraklasa;
  selecting it and jumping to 2026-07-24 renders the 2 real games
  (Pogoń Szczecin 0–1 Legia Warsaw, Radomiak Radom 2–1 Wieczysta Kraków)
  with status `READY · POLISH EKSTRAKLASA · 2026-07-24 · via TheSportsDB ·
  2 GAMES`; day-stepping to 2026-07-25 derives 3 games from the cached
  season with zero new network; 2026-07-28 shows the honest no-matches
  state; Escape closes the modal.
- Mobile 390×844: no horizontal overflow, modal usable.
- Modal stacking: the modal is now a direct child of `<body>` (moved out of
  `#hud`), with `z-index: 9500` and `pointer-events: auto`. Raising z-index
  alone was NOT enough: empirically, `#hud` (despite having no
  stacking-context trigger in computed style) traps fixed descendants below
  body-level HUD elements — the `#runtime-status` banner (z-index 90) painted
  above the modal (z-index 9500, even 100000) and won `elementFromPoint`
  hit-testing. Moving the modal out of `#hud` (or giving `#hud` its own
  z-index) fixed it; the DOM move was chosen for minimal blast radius.
  Verified geometrically: `elementFromPoint` at the modal header's center now
  resolves inside the modal, and real CDP pointer clicks open the modal, pick
  a league, and hit the × close button. The `pointer-events: auto` was also
  required — `#hud` sets `pointer-events: none` and the modal never
  re-enabled it, so real clicks fell through the modal before this fix.
- Zero league-feature console errors.
- Screenshots: `/tmp/league-verify-d/desktop-games.png`,
  `/tmp/league-verify-d/mobile-modal.png`; full JSON report:
  `/tmp/league-verify-d/verify-report.json`.
