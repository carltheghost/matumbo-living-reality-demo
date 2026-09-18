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
