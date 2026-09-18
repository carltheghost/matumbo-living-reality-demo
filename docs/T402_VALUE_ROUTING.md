# T402 Value Routing — local rehearsal

The T402 surface is an inspectable, deterministic rehearsal of the path:

`offer → route → simulated hold → live movement denied`

Open it from Mission Control with **T402 Value Routing**, or use the shareable
deep link:

`http://localhost:8080/?feature=t402`

The console joins the canonical `t402-value-routing` contribution and exposes
one fictional compute offer, one profile-to-room route, one simulated escrow
record, and one explicit `settle` denial. Selecting a record, replaying the
sequence, and resetting the trace are all in-memory renderer actions. They do
not mutate the canonical projection.

## Boundary

This is not a payment rail or token transfer implementation. The local demo
does not create a wallet, custody, signer, recipient, provider connection,
release operation, transfer, settlement, market, or money claim. `TUMBO-SIM`
is a fictional display unit only.

The implementation lives in `src/render/t402.js` and is covered by
`tests/t402-render.test.mjs` alongside the domain contract in
`src/domains/t402.js`.
