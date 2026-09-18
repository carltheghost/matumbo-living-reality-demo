# Prime Ledger + EchoProof — local summary

Open the surface from Mission Control or use:

`http://localhost:8080/?feature=ledger`

The console exposes the balanced journal rehearsal and the declared proof
ancestry behind it. The demo fixture contains one balanced `TUMBO-SIM` journal
record (debit 12 / credit 12) and two proof nodes (`root → projection`).

Selecting a record, replaying its local path, and resetting the trace do not
mutate the canonical projection. Proof ancestry is displayed as declared
metadata; it is not cryptographically verified.

## Boundary

This adapter does not record an authoritative ledger, sign, settle, publish,
or contact an external service. All state is read-only projection data plus a
bounded in-memory renderer trace. See `src/render/ledger-proof.js` and
`tests/ledger-proof-render.test.mjs`.
