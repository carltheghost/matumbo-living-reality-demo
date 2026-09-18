# Tennis Evidence Surface

The tennis surface is a read-only research projection over ESPN's browser-friendly public JSON endpoints. It is a bounded vertical slice for ATP and WTA match evidence, not a sportsbook, ranking authority, or player-rating engine.

## Public reads

The default refresh requests four HTTPS endpoints, sequentially and with an abort timeout:

- `https://site.web.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard`
- `https://site.web.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard`
- `https://site.web.api.espn.com/apis/site/v2/sports/tennis/atp/rankings`
- `https://site.web.api.espn.com/apis/site/v2/sports/tennis/wta/rankings`

No key, login, private endpoint, provider credential, odds field, or write operation is used. Scoreboard records are capped before projection. A provider can fail independently; the result reports `ready`, `partial`, or `unavailable` rather than hiding the failure.

## Record shape

Each match record keeps the provider-returned fields that are useful for inspection:

- tournament and match identifiers, round, type, venue, and court;
- player name, full/short name, country or flag label when supplied, flag/profile URLs when supplied, current rank when the rankings response contains that athlete, and the ranking's source URL, previous position, points, and trend when available. Rank and country fields retain an explicit `provider-reported` or `unavailable` status;
- provider-reported match time and status (`scheduled`, `in progress`, `final`, or another provider label), with a normalized completion object that exposes the provider state, completed/final booleans only when reported or directly represented by provider state, and the source of that completion state;
- one entry per provider-returned set, including each player's score, provider winner flag (never inferred), optional tiebreak value, score availability, and the set's own `dataCompletenessGrade`, percentage, present/expected score counts, and missing-score count;
- public source URL, retrieval timestamp, detail references, and uncertainty flags.

The adapter only normalizes a point-by-point field when the provider actually returns a usable timeline/plays/events array (including a nested public timeline container). If it does not, the record says `timeline.status: "unavailable"` and gives the reason. It never reconstructs points from the final set score or from a second-hand fixture. Current ESPN scoreboard responses commonly include set linescores and final status while omitting point-by-point commentary; the UI keeps that split visible.

## Set and match completeness

`dataCompletenessGrade` is a transparent field-presence/provenance grade. The match grade checks source URL, tournament, event time, status, named players, set scores, both player ranks, and timeline availability. A set grade checks that the expected player count and score values are present. Each match also exposes `setScoreCompleteness` (`complete`, `partial`, or `unavailable`) and counts of provided, complete, partial, and unavailable sets. These grades and counts describe how much of the provider response is usable; they are explicitly **not** performance grades, predictions, odds, picks, recommendations, or betting advice.

The renderer labels final/completion state as provider status, state, `FINAL YES/NO/UNAVAILABLE`, and `COMPLETED YES/NO/UNAVAILABLE`. A winner label is shown only when ESPN supplies a boolean winner flag. The adapter does not derive a winner from set totals or status text.

## Independent parity gate

The Tennis Evidence panel also exposes an **Independent parity source** rail so
the distinction between one-provider reconciliation and a true multi-provider
comparison is visible. Its current contract is explicitly `unavailable`:
`SPORTS_EVENTS_SECONDARY_PROVIDER` has no configured endpoint because no
documented, browser-safe, credential-free independent tennis source has passed
the endpoint/CORS/provenance gate. The rail shows the selected ESPN match
context, each parity field (`match`, `players`, `rankings`, `status`, `final`,
`winner`, `setScores`, and `timeline`) as `unavailable`, and the reason no
parity request was made. It never fabricates a secondary row, copies ESPN
values into a second provider, or reports agreement. A future provider may be
added only after that gate is independently verified; until then ESPN remains
the sole source and the existing internal reconciliation remains explicitly
same-provider-only.

## Local contract/pool handoff

When a provider-returned match is selected, the current record exposes an
explicit **OPEN LOCAL CONTRACT / POOL REHEARSAL** action. It carries only the
record ID, title, tour, player names/ranks when reported, provider, retrieval
time, and HTTPS source URL into the Contracts + Pools console. That console
lets the viewer name and create an in-memory proposed draft, inspect it, or
clear it; the draft remains separate from the canonical contract graph and
marks its pool liquidity as `not-configured`.

The handoff never derives odds, wagers, prices, a winner, liquidity, or a
financial instruction from the match. If the explicit public refresh returns
zero records, the action is not rendered and the empty state remains
`NO DATA FABRICATED`. This is a provenance-preserving local exploration seam,
not a contract, market, wallet, custody, signing, or settlement operation.

The handoff also exposes a bounded, addressable local detail route. After a
draft is created, the Contracts + Pools console renders a `panel=contracts`
URL containing the validated draft payload and contract id, with **Inspect**,
**Close local draft**, **Copy detail route**, **Clear**, and **Back to Tennis
Evidence** controls. Copy uses the browser clipboard only when available and
falls back to an explicit address-bar instruction; neither path writes to a
provider or external service. A cold open of a valid route hydrates the local
draft without refreshing ESPN. Missing, malformed, overlong, non-HTTPS, or
non-allowlisted provenance fails closed and leaves the local draft absent. The
route preserves `localOnly`, `simulation`, `externalNetwork`, `persistence`,
`executable`, `settlement`, and `custody` boundaries, so it is a navigable
research detail view rather than a live contract, market, wallet, or custody
operation.

## Authority boundary

The browser projection remains local and simulation-labelled. It does not persist or publish the fetched response, authenticate a person, execute a wager, connect a wallet, move money, settle a contract, or trigger an action based on a match. A live response is evidence metadata for exploration, not a claim that the provider is complete, current, or correct.
