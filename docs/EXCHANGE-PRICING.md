# Live Exchange Pricing Architecture

The live exchange board is a separate spot-pricing lane from Prediction Place.

## Spot lane

`Coinbase / Kraken / Bitstamp / Binance`
→ source adapters
→ normalized USD observations
→ per-asset outlier filtering
→ median reference price
→ local bid / ask / spread
→ 44-asset live exchange board.

Every asset retains its raw normalized observations plus accepted and rejected observations. The UI therefore shows which venues contributed to the reference and which observation was filtered out.

### Pricing rules

- Canonical universe: 44 assets.
- Expected venues: four.
- USD and stable-USD quotes are normalized to USD.
- Per asset, the median is computed from venue observations.
- Outliers are rejected when their distance from the median exceeds the larger of 2% of the median or 3× MAD.
- Reference price is the median of the remaining observations.
- Local bid/ask are derived from the reference and remaining cross-venue range; they are not orders on an external exchange.
- Missing venues remain missing. No fixture value fills a gap.
- A row is `healthy` only when all four venues contribute accepted observations; otherwise it is `partial` or `unavailable`.

The board refreshes on explicit open/refresh and while the board is open it refreshes every 15 seconds.

## Prediction lane

Prediction-market adapters remain owned by the existing contract flow:

`Kalshi / Polymarket / FanDuel / MGM / future adapters`
→ prediction-contract normalizer
→ our own YES/NO contract records
→ Prediction Place / Contract Atelier.

The spot pricing engine does not create, price, settle, or mutate prediction contracts. Prediction-market observations cannot become crypto spot observations, and crypto venue quotes cannot become prediction-contract terms.

## Authority boundary

The exchange board is a local pricing projection. It does not expose wallet custody, signing, external order placement, settlement, or transfer authority.