# Contracts + Pools Explorer

Mission Control's **Contracts + Pools** feature opens an inspectable local
scenario graph. Its domain graph resolves the canonical
`contract → pool → collateral → position → derived risk` chain from the
existing records, with every edge marked `complete` or `missing` and each
chain summarized as `complete`, `partial`, or `missing`. Coverage ratio,
coverage status, risk band, risk status, and risk source are deterministic
readouts over the fictional scenario values; no row is repaired or invented.

Selecting a row focuses the matching local record. **Expand linked graph**
adds a nested contract/pool/collateral/position/risk path plus any missing-link
rows to the console, and records the expansion in the visible local trace.
**Replay local inspection** repeats the bounded view; **Reset view** returns
to the first record, collapses the graph, and clears the trace.

The explorer reads the canonical `contracts-markets` contribution. A selected
public ATP/WTA record can explicitly open a separate **Make a local contract /
pool draft** panel. That panel carries only bounded provider provenance into an
in-memory proposed draft; it does not append to the canonical contribution.
Contract and pool names are editable within the UI's length bound, while pool
liquidity remains `not-configured`. The displayed canonical liquidity,
collateral, exposure, and risk band are fictional `TUMBO-SIM` rehearsal values.
No order book, price, odds, wager, trade, signature, wallet, custody,
settlement, or legal agreement is present.

If the public sports surface is unavailable or has zero records, the handoff
button is not rendered and no sports placeholder is used. The draft builder is
therefore a real-record provenance handoff, not a mock-data generator.

## Addressable contract-detail route

After a draft is created, the console writes a bounded `panel=contracts` URL
with `contract=<contractId>` and a versioned `draft=<JSON>` payload. The
payload is intentionally small and self-consistent: it carries the local
draft/contract/pool IDs, proposed or closed lifecycle state, bounded labels,
the selected provider record ID, two player names/ranks, provider, retrieval
time, an allowlisted HTTPS ESPN source URL, and a relative
`panel=sports-events` back route. Route validation rejects unknown fields,
oversized payloads, malformed IDs, non-HTTPS or non-allowlisted provenance,
invalid source routes, and ID mismatches before any hydration occurs.

The detail panel provides **Create local draft**, **Inspect draft**, **Close
local draft**, **Copy detail route**, **Clear draft**, and **Back to Tennis
Evidence**. Copy uses `navigator.clipboard.writeText` only when the browser
offers it and otherwise leaves the route visible for manual copying. Closing
rebuilds the same local record with lifecycle state `closed`; clearing removes
the in-memory draft and route query. A cold detail URL hydrates directly from
the validated payload and does not refresh Tennis Evidence or any other public
provider. Invalid route hydration fails closed with no local draft and a
visible rejection status. All route actions remain local, simulation-labelled,
non-persistent, non-executable, and outside the canonical graph.

## Separate public provider evidence

The same panel can mount a **Provider TVL Readout** when the shareable route
includes `feature=contracts&live=protocols`. Its Refresh public TVL button
explicitly reads the free DeFiLlama current-TVL endpoint for the fixed
allowlist `aave`, `uniswap`, `lido`, and `makerdao`. Each row keeps its provider
source URL, retrieval time, USD unit, and available/unavailable state. A
malformed or failed response stays unavailable; there is no fallback value.

This rail is intentionally separate from the graph above: a provider TVL
observation is not copied into fictional `simulatedLiquidity`, collateral,
reserves, positions, risk, or a contract state. The observation can be stale or
methodology-dependent and is not a quote, reserve attestation, investment
signal, or proof of solvency. No wallet, trade, custody, signing, transfer, or
settlement action exists.
