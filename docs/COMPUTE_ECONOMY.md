# maTumbo Compute Economy / AI Exchange

## Goal

Turn the existing Web + AI Reality Lens object into a provider-neutral compute marketplace: one task surface, many AI providers, one usage meter, one receipt trail, and one maTumbo reward policy.

The design intentionally does **not** reward raw token count. A million tokens can have radically different cost and utility depending on provider, model, input/output mix, caching, context and batch terms. Raw tokens remain evidence; verified provider-reported spend is the normalization basis.

## User loop

1. Person Ω writes a task.
2. maTumbo can compare eligible provider quotes for cost and latency.
3. The user chooses a provider or allows a routing policy.
4. A connected provider adapter executes the request in a future live phase.
5. The provider returns usage plus a cost receipt.
6. PAYCORE meters the verified spend.
7. T402 records the value route.
8. The reward policy accrues TUMBO-SIM in the local demo.
9. Prime Ledger / EchoProof receives the receipt identity and ancestry in a future canonical integration.
10. Reality Lens renders the same transaction as a living object rather than a separate finance dashboard.

## Access models

- **External / account handoff:** open ChatGPT, Claude, Gemini, DeepSeek or Kimi without sharing credentials with maTumbo.
- **BYOK future adapter:** user supplies a provider key to a secure backend adapter; the browser must never persist it.
- **maTumbo Compute Balance:** prepaid credits bought through maTumbo and spent across providers.
- **Subscription Pool:** a Cursor-like monthly allowance that can be spent across eligible models, with overage controls.

Only the first mode exists today. The domain code added in this branch implements local metering, receipt deduplication, quote ranking and reward rehearsal. It does not execute provider calls or money movement.

## Reward rule

The initial demo policy is configurable and currently rehearses:

**1 TUMBO-SIM per $10 of verified provider spend.**

This is deliberately not a promise of real token issuance, yield, price appreciation or future conversion. It is a testable accounting rule. Product economics should later derive the rate from gross margin, fraud cost, provider pricing, treasury policy and any applicable legal constraints.

## Venice-inspired loop, maTumbo version

Venice's useful idea is not the decoration; it is the visible economic loop. maTumbo should expose:

- compute purchased / available / consumed
- provider and model used
- input/output token evidence
- actual provider-reported cost
- reward eligibility and accrual
- treasury / fee allocation when connected
- any burn or supply action only after a real settlement engine exists
- immutable receipt identity and replay protection
- one zoom path from Person → Task → Provider → Usage → PAYCORE → T402 → Ledger → Proof

## Safety / authority boundary

This branch is local simulation. It accepts no API keys, wallets or credentials, cannot issue or burn a token, cannot settle money, and does not claim provider billing authority. Real adapters must fail closed when price, receipt authenticity or settlement status is unavailable.
