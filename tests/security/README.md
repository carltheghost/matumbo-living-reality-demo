# Token domain adversarial security suite

Probes the **gpt/token-exchange** `src/domains/token.js` surface
(`TokenLedger.post`, `QuoteEngine.quote` / `execute`, `faucet`).

## Run

Requires `src/domains/token.js` (lands via the token PR(s); not on `main`).

```bash
node tests/security/token-adversarial.test.js
```

## Probes

| Probe | Intent |
|-------|--------|
| forged-quote-execution | Tamper `amountOut` / `from` while keeping original hash |
| quote-replay-different-idem-keys | Same quote id, two different idempotency keys |
| expired-quote | `expiresAt` in the past |
| idempotency-key-reuse-cross-intent | Same key, different postings must return original receipt |
| ungated-sys-debit-via-quote-execute | Quote/execute as `sys:treasury` / `sys:market` / `sys:faucet` |
| direct-debit-sys-escrow-vault-void | Direct `ledger.post` drain of escrow/vault; void debit |
| vault-double-release | Double unlock (SKIP if no vault API) |
| negative-and-zero-amounts | `amountIn` 0 / negative |
| unsafe-integer-amounts | Values above `Number.MAX_SAFE_INTEGER` |
| float-math-rounding-theft | Float fluff + tithe floor accumulation |
| journal-tamper-chain-break | Mutate journal / detect EchoProof chain (SKIP if absent) |
| double-reverse | Reverse same receipt twice (SKIP if no reverse API) |

Each probe reports **PASS** (attack rejected), **FAIL** (hole), or **SKIP**
(capability not in module under test). Shared invariants (non-negativity,
Σ0 journals, supply conservation) are checked after every probe.

## Merge dependency

This suite imports `src/domains/token.js`, which is **not** on `main`.
Merge (or co-land with) the token engine PR before CI can execute these tests
against production code.
