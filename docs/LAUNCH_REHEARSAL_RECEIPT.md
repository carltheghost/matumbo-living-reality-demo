# Launch Rehearsal Receipt

The Launch Rehearsal Receipt is a local, deterministic readout of the same
fictional `TUMBO-SIM` distribution registry used by Launch Distribution. It
does not create a second allocation schedule. Instead, it copies the canonical
aggregate cohort rows into one inspectable receipt and records the arithmetic
needed to check the fixed-supply rehearsal.

## What the receipt proves

The default receipt contains all 18 aggregate fictional registry cohorts. It
reports:

- `1,000,000,000` integer `TUMBO-SIM` units;
- `10,000` basis points;
- the per-cohort percentage, basis points, and simulated units;
- the launch and registry event identifiers; and
- an exact reconciliation for basis points, token units, and fixed supply.

The receipt is a presentation record, not a ledger or a claim. `exact:
true` means only that the deterministic rows add up to the fixed numbers in
the local fixture.

## Renderer API

`src/render/launch-receipt.js` exports the following pure helpers:

- `createLaunchRehearsalReceipt(projection)` creates one frozen receipt from
  the canonical projection. The optional projection is read only; if omitted,
  the existing default registry fixture is used.
- `serializeLaunchRehearsalReceipt(receipt)` returns indented JSON text for
  inspection or a manually shared local fixture. It does not write a file or
  use the clipboard.
- `createLaunchReceiptConsole(...).download()` serializes and validates the
  current receipt, then (only after an explicit button/method call) creates a
  temporary `Blob` URL and clicks a detached download anchor for
  `matumbo-tumbo-sim-launch-rehearsal-receipt.json`. The object URL is revoked
  immediately after the browser has handled the click. If the browser does not
  provide `Blob`, `URL.createObjectURL`, or an anchor click method, the adapter
  returns a frozen `unavailable` snapshot and leaves the serialized JSON on
  screen so it can be saved manually.
- `validateLaunchRehearsalReceipt(input, projection)` accepts JSON text or a
  plain in-memory object and checks its schema, canonical cohort IDs and
  amounts, reconciliation, and authority flags. Functions, getters,
  non-finite values, cycles, and executable-looking fields are rejected before
  the value is retained.
- `createLaunchReceiptConsole({ documentRoot, projection, ...callbacks })`
  provides an optional DOM adapter. It exposes cohort selection, replay,
  local JSON download, serialization, and reset. Hosts receive frozen callback
  snapshots and may connect those snapshots to the existing local intent
  timeline. Download success is reported as `downloaded`; unavailable browser
  APIs are reported as `unavailable`, never as a failed or partial issuance.

The adapter's stable mount IDs are exported as
`LAUNCH_RECEIPT_DOM_IDS`. A host can therefore add the console without making
the receipt module own page layout or canonical state.

## Explicit boundary

Every receipt and replay snapshot carries the following boundary:

- `simulation: true`, `localOnly: true`, and `deterministic: true`;
- `realIssuance`, `liveIssuance`, and `issuance`: `false`;
- `externalDistribution` and `realDistribution`: `false`;
- `wallet`, `walletConnection`, and `custody`: `false`;
- `signing`, `transfer`, `externalTransfer`, `settlement`, and `exchange`:
  `false`;
- `market`, `realMoney`, `persistence`, `network`, `externalNetwork`,
  `provider`, and `externalProvider`: `false`; and
- `executable: false`, with `authority: "none"`.

The module has no network request, provider connector, wallet, signing key,
transfer call, exchange path, application persistence layer, clipboard
operation, no filesystem import, `eval`, or imported-code execution. The optional
Download JSON action is a user-triggered local browser export of validated text;
it does not upload, share externally, or turn the receipt into a durable app
state. JSON validation is an in-memory safety check only. Reset restores the
current canonical projection; it does not erase or rewrite a project.

## What a real launch would still need

This receipt is not evidence of **no real issuance or distribution** having
occurred; it is only a local simulation record. A real
asset launch would require separately authorized legal, tax, issuer, smart
contract, custody, signing, eligibility, privacy, security, consent, dispute,
rollback, and production-verification work. Until those gates exist, keep the
demo language and implementation in `TUMBO-SIM` simulation mode.
