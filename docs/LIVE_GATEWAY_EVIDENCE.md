# Live Gateway / Evidence Console

The Live Gateway / Evidence surface is a public-read status bridge for the
returned World Pulse, humanitarian, sports, market, and protocol envelopes. It
gives the demo an explicit place to inspect provider availability, freshness,
provenance, and returned counts while keeping the point where authority stops:

```text
provider-returned observation → uncertainty / degraded state → declared local readout → authority boundary
```

Mission Control opens the public World Pulse surface with **World Gateway /
Evidence** or the shareable route `/?feature=gateway`. The Gateway route is
public-read-first: it performs one explicit World Pulse refresh on entry, then
keeps the returned provider rows in the status rail. The dedicated status
dashboard remains available at `/?panel=live-status`.

The console exposes:

- provider rows returned by the World Pulse, UNHCR, Tennis, Asset Market,
  Protocol TVL, Multi-Sport Scoreboards, Social Pulse, and Picture Matter
  metadata adapters;
- explicit refresh controls whose rows are never replaced with local fallback
  data;
- selectable public-source rows, freshness/provenance metadata, and a local
  status intent;
- a visible boundary stating that providers, credentials, live data, truth
  authority, and executable actions are disabled.

## Public-source status bridge

The status dashboard includes a separate **Public source status · live refresh
snapshots** section. It is a read-only view over host refresh callbacks, not a
new provider client. The existing host refresh callbacks
pass their in-memory response envelopes to the renderer after an explicit
refresh:

- **World Pulse** — GDELT, NYT World RSS, USGS, and NASA provider rows when
  returned by the World Events adapter;
- **Tennis Evidence** — the public ESPN scoreboard/ranking rows returned by
  the Tennis Events adapter; and
- **Asset Market Evidence** — the bounded CoinGecko response returned by the
  Asset Market adapter; and
- **Protocol TVL Evidence** — the fixed DeFiLlama current-TVL rows returned by
  the separate provider-evidence adapter.
- **Multi-Sport Scoreboards** — the existing fixed ESPN public scoreboard rows
  for soccer, NBA, and NFL returned by the Multi-Sport Events adapter;
- **Social Pulse** — the bounded Bluesky public AppView rows returned by the
  Social Pulse adapter; and
- **Picture Matter Metadata** — the bounded Wikimedia Commons metadata rows
  returned by the Picture Matter adapter. These are the sixth and seventh
  read-only status surfaces; they add no provider, fallback rows, odds,
  betting, outcome authority, media-byte transfer, or write path.

When the World Pulse envelope includes its structured humanitarian read, the
dashboard adds one nested **Structured humanitarian · UNHCR** row beneath the
World Pulse provider list. This row mirrors only the host-returned UNHCR
Refugee Data Finder status, annual record count, retrieval/observed-time
availability, source URL, and failure reason. It is deliberately kept outside
the headline provider totals, so an annual population observation cannot be
mistaken for an incident, severity, brutality, casualty, or truth signal.

The dashboard has seven per-surface controls—**Refresh World Pulse**,
**Refresh Tennis**, **Refresh Asset Market**, **Refresh Protocol TVL**,
**Refresh Multi-Sport Scoreboards**, **Refresh Social Pulse**, and **Refresh
Picture Metadata**—plus an explicit **Refresh all public sources** action. A
per-surface click emits a frozen local refresh intent, calls only the matching
host adapter, and then reports either
`REFRESH COMPLETE` or `REFRESH FAILED` in the same surface. The all-sources
action delegates to the existing finite host batch and awaits those same seven
adapters in fixed order, one at a time. Its status line reports aggregate
`FRESH`, `PARTIAL`, `UNAVAILABLE`, and `STALE` counts plus `PROVENANCE VISIBLE`;
the provider rows remain the detailed source of names, timestamps, counts, and
validated URLs. Controls are disabled while the selected request or batch is
in flight and are re-enabled after it settles. The renderer does not choose a
provider, retry a failure, invent a row, or reuse another surface's response.

Each row in `#live-gateway-public-status` shows the provider name, `READY`,
`PARTIAL`, or `UNAVAILABLE` state, `FRESH`, `STALE`, `UNKNOWN`, or
`UNAVAILABLE` freshness, retrieved and provider-observed timestamps when
available, returned record count, and a validated HTTPS source URL when one is
present. An unavailable provider stays unavailable and never receives a local
replacement row. A stale label is derived only from the supplied retrieved
timestamp and the local status-age threshold; it does not assert that the
underlying provider data is true or complete.

The pure normalizer is `normalizePublicSourceStatus`; the aggregate helper is
`summarizePublicSourceStatuses`. `syncPublicSourceStatus` and
`syncPublicSources` only update the current page's in-memory readout and emit a
frozen local status intent. They do not fetch, persist, publish, trade, connect
a wallet, custody assets, sign, settle, identify people, or trigger a response.

The legacy **mock observations · internal only** and **non-authoritative
interpretations** sections remain available only for renderer regression
coverage. The canonical composition passes `includeLegacyFixture: false`, and
the public-only Gateway route hides the compatibility mount. Those fixtures
must not be described as World Pulse, Tennis Evidence, Asset Market, or
Protocol TVL, Multi-Sport, Social Pulse, or Picture Matter data.

The latest no-mock/fail-closed browser verification is Packet 178:
`work/audit-live-status-no-mock-178.json` and
`work/live-status-no-mock-178.png`. It rechecked both the
`panel=live-status&live=all` route and the direct `panel=world-events` route:
the status route settled all seven surfaces in order, both routes kept the
legacy fixture hidden, and returned rows remained provider-backed or explicitly
unavailable. An intentionally aborted allowlisted CoinGecko request stayed
unavailable with zero rows; its expected browser abort console line is
evidence of the failure path, not a provider error being hidden. Packet 175's
earlier real-provider receipt remains available at
`work/audit-live-status-real-data-175.json`.

The implementation is split between `src/domains/live-gateway.js` (the frozen
projection contribution) and `src/render/live-gateway.js` (the DOM console).
`tests/live-gateway-render.test.mjs` covers the join, selection, replay, reset,
and the absence of network paths.

This is not an oracle, provider adapter, truth service, or network gateway. The
renderer does not fetch, persist, publish, sign, settle, identify, or claim that
a returned observation is true or complete. A future authenticated or
write-capable integration would need a separate reviewed boundary, credentials
policy, consent model, provenance contract, and runtime verification before it
could be considered beyond this local demo.
