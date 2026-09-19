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
