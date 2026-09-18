# World Events evidence adapter

`src/domains/world-events.js` is a bounded, public-source read adapter for the
world-event surface. It is deliberately an evidence readout, not a truth
engine, incident command system, emergency service, or complete event ledger.
The default query is a keyword screen for `violence`, `conflict`, `attack`,
`brutality`, and `displacement`; a matching title is not a determination that
violence occurred and does not provide instructions for responding to it.

Every retained record also receives a bounded `brutalityLanguageSignal`. It is
derived from the provider title only and reports one of `none`,
`conflict-context`, `violence-language`, or `explicit-language`, plus the
matched title terms. The level controls cube color, glow, size, and lift so a
viewer can see the language pattern across the field. It is presentation
intensity—not a severity score, casualty estimate, verification, or claim that
brutality occurred.

The World Pulse console also exposes four local signal lenses: `ALL` keeps every
returned record, `CONTEXT` keeps level 1 and above, `VIOLENCE` keeps level 2 and
above, and `EXPLICIT` keeps level 3 only. These lenses filter the returned
records and cube evidence in memory; they do not change the fetched envelope,
reclassify a provider response, or create a record when a lens has no match.
Provider-status rows remain visible while a lens is active, and the empty state
says when no returned record matches.

The **Timeline** controls add a third presentation dimension over that same
returned set: **Latest** uses provider-observed time, **Event time** uses a
provider-supplied event timestamp and keeps records without one at the end,
and **Signal first** orders the title-language signal level before the newest
observed time. Changing order emits a local filter snapshot and rebuilds the
cube projection; it does not refetch, infer, geocode, or fabricate a record.

The console adds an independent geographic coverage lens at
`#world-events-geography-lens` with `ALL MAP`, `MAPPED`, and `MAP N/A` choices.
`MAPPED` includes only returned records with a bounded provider longitude and
latitude; `MAP N/A` includes only returned records without one. The signal and
geography lenses compose in memory, and their status is visible in
`#world-events-signal-lens-status`. This is coverage accounting, not geocoding,
location verification, severity, casualty, or event truth.

The console also renders `#world-events-signal-field`, a compact read-model
derived from the records currently visible through those lenses. It counts the
four frozen title-language bands (`NO TITLE SIGNAL`, `CONFLICT CONTEXT`,
`VIOLENCE LANGUAGE`, and `EXPLICIT LANGUAGE`) and reports mapped versus
map-unavailable records. `summarizeWorldEventSignalField` is pure and frozen;
it never fetches, repairs missing timestamps, geocodes, creates rows, or
upgrades a keyword into a brutality/severity/casualty/truth claim. Switching a
lens only changes which already-returned records are counted and projected.

The **Global map cells** field adds a coordinate-only way to navigate the
returned map without pretending to know a place name. It groups valid provider
longitude/latitude pairs into nine broad buckets (`NORTH`, `EQUATORIAL`, or
`SOUTH` crossed with `WEST`, `CENTRAL`, or `EAST`) and shows the count of
returned records plus title-language signal counts in each active cell. Empty
cells are omitted; records without coordinates remain in `MAP N/A` and are
never assigned to a cell. Clicking a cell is an in-memory filter over the same
records and cube markers. `summarizeWorldEventMapCells` is pure and frozen; it
does not geocode, infer a country/city/conflict zone, repair coordinates, or
claim severity, casualties, truth, or complete global coverage.

The **Reality / Brutality Context** rail is a compact readout over that same
returned World Pulse envelope. `summarizeWorldEventRealityBrutality` copies the
four title-language bands, provider availability/counts, broad map-cell
coverage, and returned record ids into one frozen presentation read model. It
does not add a provider, fetch a second feed, manufacture a row, or interpret
the title language as verified brutality. The rail is explicit about this
boundary: **title-language signal only; no verified brutality, severity,
casualty, truth, attribution, or completeness claim**.

Each band button is an in-memory action. Selecting `CONFLICT CONTEXT`,
`VIOLENCE LANGUAGE`, or `EXPLICIT LANGUAGE` applies the existing signal lens
and focuses the first matching returned record; `NO TITLE SIGNAL` restores the
all-record view. The selection callback is the existing cube evidence
selection path, so it can reveal source/time/provider-coordinate children in
the cube field without issuing another request. A band with no returned rows
stays visibly `NO DATA` and cannot focus an invented record.

The **Collect / refresh** control lets the viewer replace the default public
query with a short (maximum 160-character) visible query. The host sends that
normalized query only to the documented public adapters on explicit request;
the renderer does not fetch or persist it. An empty or malformed value returns
to the default query, and a provider that returns no usable rows remains
unavailable instead of receiving mock records.

For a shareable starting view, the route may include a `worldQuery` parameter,
for example `?panel=world-events&worldQuery=earthquake%20OR%20wildfire`. The
host passes that value through the same 160-character normalizer and performs
one explicit public refresh; URL text is never treated as a credential,
endpoint, command, or persistence key.

## Public sources

The default refresh list contains documented HTTPS public endpoints that do
not require a credential in this demo. It deliberately combines a global
reporting screen with broad geolocated hazard feeds; a feed being available is
not evidence that its records are complete or independently verified:

- **GDELT DOC 2.0** (`https://api.gdeltproject.org/api/v2/doc/doc`) — article
  search/list endpoint. A record is retained only when the response includes
  both an article URL and title. `seendate` is
  recorded as the source-observed time; the adapter leaves occurrence time
  unavailable because an article publication/observation time is not an
  independently verified event time.
- **The New York Times World RSS**
  (`https://rss.nytimes.com/services/xml/rss/nyt/World.xml`) — a public RSS
  headline feed. Only the headline, public link, GUID (when supplied), and
  `pubDate` are read; `pubDate` is source-observed time, not an occurrence
  claim. The adapter does not fetch article bodies, images, or paywalled
  content.
- **USGS Earthquake Hazards Program**
  (`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson`)
  — the public all-day GeoJSON feed. A record is retained only when
  `properties.url` (or `detail`) and
  `properties.title` are present. `properties.time` is shown as a
  provider-reported event time and remains an observation, not a truth claim.
- **NASA EONET** (`https://eonet.gsfc.nasa.gov/api/v3/events`) — the public
  open-events endpoint. A record is retained only when an event title and a
  source URL are present. The first valid geometry date is shown as a
  provider-reported event time.

USGS and NASA are broad context feeds, not violence filters. Their records are
shown because the projection is meant to convey what public systems are
reporting around the world, while GDELT and NYT provide headline/reporting
context for the keyword screen. The title classifier remains a local label and
never turns a headline into a verified brutality determination.

ReliefWeb v2 is listed as an **optional** source only. ReliefWeb requires an
approved `appname`; the adapter will not contact it unless the host explicitly
passes an approved app name and an endpoint configuration. No default request
invents an app identity.

## Structured humanitarian evidence

World Pulse also makes one separate, bounded read of the documented UNHCR
Refugee Data Finder population endpoint:

- **UNHCR Refugee Data Finder**
  (`https://api.unhcr.org/population/v1/population/`) — the public population
  API is credential-free and origin-enabled. The adapter requests at most the
  current year plus a two-year lookback and keeps only provider-returned
  annual rows. Metrics such as `refugees`, `asylum_seekers`, `idps`,
  `stateless`, and return categories are retained as numeric provider fields;
  missing values remain unavailable. Named origin/asylum dimensions are
  displayed only when UNHCR supplies them.

This rail is deliberately not merged with GDELT/NYT/USGS/NASA event records.
An annual population observation is not an incident, brutality measurement,
severity score, casualty count, intensity estimate, or truth determination.
`eventTime` is unavailable because the provider row is an annual reference;
`severity` and `intensity` remain `unknown`, and absent geography is never
geocoded or inferred. A failed or empty response produces an explicit
unavailable state and no replacement rows. The renderer only presents the
host-supplied envelope and does not fetch data itself.

When UNHCR returns rows, the host projects those exact rows into the existing
`semantic-block-world` group beside the World Pulse event cubes. Each
structured row is a cube-only evidence marker on a clearly non-map shelf;
missing coordinates are not geocoded or assigned a country position. A local
double activation opens nested `BoxGeometry` children for the UNHCR source,
annual reference year, and each provider-supplied numeric metric that is
present. A bounded drag changes only the in-page marker position. Selection,
opening, and moving emit local inspection intents and never refetch, persist,
or convert population metrics into a severity/brutality claim; those fields
remain visibly `unknown`.

## Refresh and no-data behavior

The host must call `fetchWorldEvents()` only from an explicit user refresh (or
an equally visible host action). The renderer does not own network access. A
missing browser fetch, failed HTTP response, malformed payload, provider with
no usable URL/title rows, or provider skipped by its app-name gate produces an
unavailable/partial source status and **zero fabricated records**. There is no
fixture fallback and no claim of complete coverage. Retained source links must
be HTTPS URLs without embedded user/password credentials; unsafe or malformed
links are dropped rather than displayed as evidence.

Each retained record carries:

- the provider and exact source URL;
- `retrievedAt`, plus a provider-observed time when one is available;
- `eventTime` and `eventTimeStatus` (`provider-reported` or `unavailable`);
- `confidence: 0` and `uncertainty: 1` because these public responses do not
  provide a validated confidence score;
  - a provider-reported `coordinates` pair when GeoJSON/EONET geometry contains
    a bounded longitude/latitude pair; missing or invalid geography remains
    `MAP LOCATION UNAVAILABLE`;
  - `geographicCoverage` with `mappedCount`, `mapUnavailableCount`, and a
    `partial`, `mapped`, or `map-unavailable` status calculated only from those
    provider coordinate pairs;
  - `signalCoverage` with counts of existing title-language signal records and
    no-signal records. Neither coverage object creates a row or changes the
    source response;
- explicit `truthClaim: false`, `complete: false`, `localOnly: true`, and
  `executable: false` boundary fields.
- `brutalityLanguageSignal` with a title-only keyword basis; the field never
  asserts verified brutality or severity.

The envelope may report `externalNetwork: true` after an explicit refresh and
still report `simulation: true`: that combination means the page read a real
public response while keeping the result inside a non-authoritative,
simulation-only presentation. It does not mean that the source data was
invented or that the page has authority to act on it.

The query, title classifier, and brutality-language signal are screening
metadata only. Keyword classes such as “violence / conflict mention” must not
be presented as verified incident classifications. A stronger glow or taller
cube is only a visual encoding of title language.

On the focused cube field, each retained event record is a `BoxGeometry`
evidence block. A click selects it, a bounded drag changes only its in-page
position, and a second activation opens nested `BoxGeometry` children for
source, time, and provider-reported place when those fields exist. A matching
title-language signal adds one more nested `signal` cube. Structured
humanitarian rows use the same local interaction contract, with source/year/
metric children instead of event-time/place children. Those moves and opens
are local inspection intents; they do not edit the fetched record, persist a
layout, or call a provider again.

Each provider request is bounded (the default timeout is nine seconds), and the
record budget is distributed across the configured providers. Public event feeds
and the separate structured humanitarian feed start concurrently, while their
results are flattened back into allowlist order for deterministic projection.
A slow public endpoint becomes an unavailable provider row instead of starving
or freezing the local projection.

## Portal journey and return handoff

World Pulse records can travel through the existing Block World portal rail
without turning the portal into another data store. When a returned event or
humanitarian cube is focused and a portal destination is opened, the host records
the public record id, provider id/source URL, humanitarian kind, and the marker's
renderer-local position in a short-lived handoff context. The destination may
hide the evidence layer while it is open, but it never replaces the fetched
envelope, refetches the provider, or treats the local position as public
geography.

Selecting **Return to Cube Field** reopens the same Block World substrate and
restores the matching returned marker, its readout, and any already-open nested
source/year/metric or source/time/place children. If the provider row is no
longer present, the handoff is dropped and no replacement/mock cube is created.
The handoff and all moved positions are in-memory renderer state only:
`localOnly: true`, `persistence: false`, and no transfer, signing, settlement, or
other executable authority is introduced.

## Local safety boundary

This surface has no provider credentials, private-source scraping, identity
resolution, emergency/violence response, money movement, betting, custody,
signing, settlement, persistence, or executable authority. `replayWorldEventEvidence`
replays the already fetched observation in page memory without another request;
it does not publish, settle, or assert that the event is true.

`src/render/world-events.js` is presentation-only. The host supplies the
explicit refresh callback, mounts the console, and may route it from the
Reality Lens/Gateway surface. On initial load and offline, the console stays
visibly unavailable and says that no data was fabricated. Online behavior must
still be described as public-source research evidence, never as a complete,
live, or authoritative view of world events.
