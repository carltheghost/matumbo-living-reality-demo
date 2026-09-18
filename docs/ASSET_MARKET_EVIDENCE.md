# Asset Market Evidence

The Asset Market surface is a bounded, read-only research projection over
CoinGecko's keyless public `/api/v3/coins/markets` endpoint. It requests only
four fixed peer IDs:

- `bitcoin`
- `ethereum`
- `official-trump`
- `melania-meme`

The provider URL is built with `vs_currency=usd`, `sparkline=false`, a bounded
page size, and a 24-hour change field. It is queried only after an explicit
refresh. The adapter accepts only HTTPS `api.coingecko.com` responses, caps the
returned rows at four, times out a stalled request, and reports `ready`,
`partial`, or `unavailable` with the provider URL, retrieval time, returned
IDs, and omitted IDs. It never fills a missing slug with a local fixture row.

## TUMBO boundary

`TUMBO-SIM` is not sent to CoinGecko and is never presented as a priced or
listed market asset. The surface renders it separately as:

- listing status: `unlisted`;
- market data: unavailable;
- price status: `not-provided`;
- market status: `not-a-market-instrument`.

That state is a local declaration from the fictional asset-token projection,
not a CoinGecko result. A peer's current price, market cap, volume, or change
is provider-reported observation only. `dataCompletenessGrade` measures field
presence and timestamp provenance; it is not a performance grade, price
prediction, investment recommendation, or trading signal.

## Renderer and authority boundary

`src/render/asset-market.js` is a DOM-only console. It exposes explicit
refresh, row selection, replay, and reset, and shows provider state, source
links, observed time, field completeness, and the unlisted TUMBO-SIM notice.
There are no buy, sell, order, quote, wallet, custody, signing, transfer,
settlement, persistence, or external-write controls. The world remains a
square/cube-only presentation seam; the market adapter does not create or
mutate world geometry.

The renderer calls each provider row an **asset** and labels the deep link
`OPEN ASSET PAGE`. The canonical projection field is `assetPageUrl`; the
historical `coinPageUrl` field remains as a compatibility alias for existing
saved projections and is never used as visible maTumbo copy. The provider's
CoinGecko endpoint and official documentation keep their original names and
paths because changing those identifiers would break the external API contract.

## Live-provider note

The default endpoint was probed during implementation and returned all four
requested IDs at that time. CoinGecko responses and availability are
time-sensitive and rate-limited; the application must treat the current
refresh result as the evidence, not as a guarantee of future coverage. If the
provider is unavailable or omits a slug, the console keeps that peer missing
and shows the unavailable/partial reason.

Provider reference: [CoinGecko Coins List with Market Data](https://docs.coingecko.com/reference/coins-markets). The keyless public API guidance
requires the `api.coingecko.com` root and no demo/pro API-key header.
