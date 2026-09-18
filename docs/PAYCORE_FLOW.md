# PAYCORE Asset-token Balance Flow

The **PAYCORE Asset-token Balances** feature opens a local preview surface over the
canonical `tumbo-paycore` contribution. It shows the fictional local
participant asset-token balance, simulation-pool asset-token balance, and
projected asset-token flow between them. Selecting a balance or flow focuses
the asset-token organ and adds an in-memory inspection trace. **Replay local
preview** repeats the view; **Reset view** returns to the first balance and
clears the trace.

The flow is not a transfer. Balances never change, no recipient or wallet is
created, and the renderer cannot sign, custody, settle, or move value. The
`TUMBO-SIM` unit is a fictional social-experiment label only.

## Compatibility boundary

New PAYCORE projections emit the canonical asset-token entity kinds
`asset-token-balance-preview` and `asset-token-flow-preview`. The compatibility
parser accepts the historical `coin-balance-preview` and `coin-flow-preview`
values from older fixtures, then normalizes them to the asset-token kinds before
they reach the console. Unknown kinds are ignored. These parser values are not
user-facing labels and do not change the simulation-only boundary.

The preserved procedural organ now has the canonical focus ID `asset-token`.
An incoming `coin` value remains a compatibility alias so older focus/event
fixtures continue to resolve; it is not a visible organ name. The organ title,
feature labels, accessibility copy, and renderer status all use **TUMBO Asset
Token** / **asset-token** wording.
