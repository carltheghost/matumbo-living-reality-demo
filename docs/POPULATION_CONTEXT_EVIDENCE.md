# Launch Distribution · World Bank population context

The Launch Distribution console can optionally show public population context
alongside the fictional aggregate registry. The context rail is an evidence
readout, not an allocator.

## Provider contract

- Provider: World Bank Indicators API v2.
- Indicator: `SP.POP.TOTL` (`Population, total`).
- Endpoint: `https://api.worldbank.org/v2/country/USA;KEN;IND;BRA;NGA;DEU/indicator/SP.POP.TOTL`.
- Request parameters: `format=json`, `date=2022:2024`, `per_page=18`, `page=1`.
- Authentication: none; the adapter accepts no API key, credential, or caller
  supplied URL.
- Context set: six fixed representative lenses (`USA`, `KEN`, `IND`, `BRA`,
  `NGA`, `DEU`). They are context labels, never recipient records.
- Collection bound: one request per explicit refresh and at most 18 normalized
  observations (six contexts × three years).

The adapter is `src/domains/population-context.js`. It validates the provider
envelope, indicator id, allowlisted country code, year window, and finite
non-negative population value. Provider strings are control-character
sanitized and the renderer writes them with `textContent`. Duplicate and
malformed rows are discarded. The response remains `UNAVAILABLE` when no
usable observation survives validation; no fixture, fallback, or fabricated
population row is inserted.

## Route and ownership

The normal Launch Distribution route stays local and makes no request. The
optional public-read route is:

`http://localhost:8080/?build=control4&fresh=20260828&panel=launch-distribution&live=population`

Only `src/main.js` owns URL-driven I/O. It calls
`fetchPopulationContext()` once and passes the frozen envelope to the
renderer. `src/render/launch-console.js` owns presentation state, the explicit
button, and status/metadata rendering; it contains no `fetch`, WebSocket,
storage, recipient, wallet, transfer, signing, or settlement path.

## Interpretation boundary

The observed values are country-level public metadata. They do not describe
the number of recipients, community membership, eligibility, allocation
weights, reserves, or expected distribution. No country or context is
geocoded, joined to the registry, or used to calculate the fixed schedule.
Population values are not a severity, humanitarian, financial, price, or
truth claim. The 18 fictional registry rows and their 10,000 basis points /
1,000,000,000 `TUMBO-SIM` units remain canonical and unchanged.

## Focused checks

```text
node --test tests/population-context.test.mjs tests/launch-console.test.mjs tests/launch-console-cohort-inspection.test.mjs
```

The browser audit for a live run is stored under `work/` with the exact URL,
request list, returned rows, provider status, registry totals, cube-only
geometry check, and page-error count. A provider timeout, CORS failure, or
empty response is an expected unavailable state and is reported as such.
