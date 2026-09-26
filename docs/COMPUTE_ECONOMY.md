# maTumbo Compute Economy / AI Exchange

## Product thesis

maTumbo should not behave like a single-model chatbot with a token bolted on afterward. The stronger design is a neutral economic and spatial layer above many models, tools, agents and eventually user-provided compute.

The user sees one Reality Lens object. Behind it, maTumbo can route work among eligible providers, meter the actual usage, enforce the user's budget, maintain a receipt trail, reward permitted participation and project the same state back into SIMFABRIC.

The current implementation remains a local simulation. It deliberately does not pretend that provider billing, custody, token issuance, staking, burn, settlement or cryptographic proof already exist.

## One task, many engines

The target flow is:

Person Ω
→ task/context
→ maTumbo router
→ provider/model
→ usage receipt
→ Compute Wallet
→ PAYCORE meter
→ T402 route
→ reward policy
→ Prime Ledger / EchoProof target
→ SIMFABRIC
→ Reality Lens

Current provider handoff lanes include:

- OpenAI / GPT
- Anthropic / Claude
- Google / Gemini
- DeepSeek
- Kimi
- Local / self-hosted as an adapter lane

External providers are currently links only. Local/self-hosted is represented as a lane but has no runtime adapter yet.

## Why raw token count is not the reward unit

One million tokens is not economically equivalent across models. Input/output prices, cached context, batch modes, model class and provider terms can all change cost.

Therefore the implementation keeps two separate facts:

1. **Raw model tokens** are usage evidence.
2. **Verified provider-reported spend** is the normalization basis for the demo reward policy.

The initial configurable rehearsal rule remains:

**1 TUMBO-SIM per $10 of verified provider spend.**

An unverified claim of one million tokens earns nothing.

This is not a promise of real TUMBO issuance, yield, price, convertibility or future value.

## Compute Wallet

The Compute tab now contains a local Compute Wallet with:

- explicit demo-credit funding
- zero starting balance
- monthly spending guardrail
- per-task spending guardrail
- verified-spend debits
- duplicate-spend protection
- visible remaining budget

A verified usage receipt is blocked before reward accrual when:

- balance is insufficient
- the per-task cap is exceeded
- the monthly cap is exceeded

No card, bank account, crypto wallet or real-money balance is connected.

## Model Market

Every provider is represented as a provider object with:

- provider identity
- capabilities
- execution mode
- current usage totals when receipts exist
- an external handoff or local-adapter boundary

The UI does not invent live provider prices.

## Auto Router

The routing layer accepts entered or future adapter-supplied quotes.

Policies currently support:

- balanced cost/latency
- lowest cost
- lowest latency
- maximum cost
- maximum latency
- required capabilities
- provider allow-lists
- local-only privacy mode

Local-only privacy rejects external-provider quotes before ranking.

The routing decision is added to the Economic Timeline so the user can inspect why a route was selected.

## Usage receipts

A usage receipt can contain:

- receipt ID
- provider
- model
- input tokens
- output tokens
- total tokens
- provider-reported cost
- verification state
- latency

Duplicate receipt IDs are rejected.

For verified local-demo receipts, the Compute Wallet is debited first. Only after the wallet accepts the spend does the exchange record the receipt and calculate the TUMBO-SIM reward.

## Contribution Vault

The contribution system is intentionally separate from ordinary private conversations.

The local vault accepts **metadata only**, never raw chat text, files, health records, browsing history or other underlying content.

A contribution contains only fields such as:

- contribution ID
- category
- unit count
- declared purpose
- retention period
- consent scope
- training permission
- research permission
- local acceptance evidence ID

Supported consent scopes currently include:

- aggregate-only
- research-only
- provider-specific

The contribution state flow is:

proposed
→ explicit authorization
→ accepted
→ optional later revocation state

Without explicit consent, the proposal earns nothing.

The local demo reward is intentionally small and capped. It exists to exercise accounting and consent boundaries, not to claim that personal data has a known market price.

## Earning channels

The architecture now distinguishes multiple future economic channels rather than treating every activity as the same reward.

### Implemented local rehearsals

- verified compute usage → TUMBO-SIM accrual
- explicitly authorized, accepted contribution metadata → capped TUMBO-SIM accrual

### Planned, not enabled

- user/self-hosted compute provision → metered provider reward
- published tools or agents → usage-linked creator reward
- marketplace services → explicit service revenue split
- treasury fees → policy-controlled allocation
- buy/burn or supply actions → only after real settlement authority exists

Each channel should have its own anti-fraud, consent, accounting and legal boundary.

## Economic Timeline

The Compute Economy now has an append-only local ancestry timeline.

Example event sequence:

1. credits.demo-funded
2. budget.updated
3. route.selected
4. credits.spent
5. provider.usage
6. prime-ledger.receipt-target
7. contribution.proposed
8. contribution.authorized
9. contribution.accepted

Events are linked with a deterministic FNV-1a checksum so local replay can detect ordering changes.

This checksum is explicitly **not cryptographic proof** and is not EchoProof. It is a staging mechanism for later cryptographic receipt ancestry.

## SIMFABRIC / Reality Lens world projection

The economy is no longer only a panel.

A dynamic `compute-economy-world` contribution is published into the same SIMFABRIC projection used by the rest of Living Reality.

Projected entities can include:

- Compute Exchange
- Compute Credit Wallet
- Reward Accrual
- provider objects
- usage receipt objects
- contribution objects
- consent evidence
- economic timeline events
- Prime Ledger / EchoProof target

Relationships are also represented as entities, for example:

Compute Wallet → funds-compute → Compute Exchange

Provider → produced → Usage Receipt

Usage Receipt → metered-by → Compute Exchange

Usage Receipt → ancestry-target → Prime Ledger / EchoProof Target

Contribution → may-accrue → Reward Accrual

This is the key Reality Lens distinction: the financial/compute state can exist as part of the same world graph rather than as a detached dashboard.

## Product modes

The long-term product can support several access models without changing the user's main interface.

### External-account handoff

Open a provider in a separate tab and carry the maTumbo task note. This exists now.

### BYOK

A future secure backend can accept a user-authorized provider key. The browser should never persist raw provider secrets.

### maTumbo Compute Credits

The user buys one compute balance and maTumbo spends it across eligible models. The current Compute Wallet rehearses the accounting but performs no purchase.

### Subscription Pool

A Cursor-like monthly allowance can sit above the Compute Wallet. The user sees one subscription while maTumbo manages provider spend and policy internally.

### Local / self-hosted compute

A local or user-controlled inference runtime can become another provider lane. Privacy policies can prefer or require it.

### Community compute

A later network may allow verified compute providers to contribute capacity. That requires strong measurement, fraud controls, attestation and settlement and is not enabled in this branch.

## What maTumbo should do better than a normal AI aggregator

A basic aggregator stops at model selection.

maTumbo's intended chain is broader:

- identity and consent
- context
- model/tool routing
- budget policy
- usage accounting
- rewards
- contracts
- treasury policy
- evidence
- provenance
- spatial representation
- replay

That is why the provider router lives inside Reality Lens rather than becoming another unrelated web dashboard.

## Live-adapter requirements

A real provider adapter should not be considered production-ready until it can provide:

- authenticated server-side execution
- provider/model identity
- quoted or bounded price before execution when possible
- actual usage after execution
- provider-reported cost
- stable receipt ID
- timestamp
- retry/idempotency behavior
- error state
- cancellation semantics
- secrets isolation
- rate-limit behavior
- reconciliation when quote and final cost differ

Provider adapters must fail closed when billing or receipt authenticity is unknown.

## Real-money requirements

Before maTumbo can sell Compute Credits or perform any token-linked settlement, it needs a separate authoritative backend for:

- payment processing
- ledger accounting
- tax/accounting records
- refunds and disputes
- fraud controls
- reconciliation
- custody decisions
- legal/compliance review where applicable

The browser projection must never become the source of truth for money.

## TUMBO issuance / burn requirements

Real token actions must remain disabled until there is an authoritative rule engine and settlement layer.

If later enabled, every issuance or burn should have:

- rule/policy ID
- triggering economic event
- amount
- signer/authority
- settlement receipt
- replay guard
- Prime Ledger record
- EchoProof evidence
- Reality Lens projection

No UI animation should be allowed to imply a burn or mint occurred when no authoritative transaction exists.

## Current branch implementation

This branch currently implements:

- provider-neutral usage receipt normalization
- configurable verified-spend reward policy
- duplicate receipt protection
- provider quote ranking
- routing caps and privacy policy
- local/self-hosted provider lane
- local Compute Wallet
- monthly and per-task budget guardrails
- demo-credit funding
- explicit-consent Contribution Vault
- capped contribution reward rehearsal
- local economic ancestry timeline
- SIMFABRIC world contribution
- Web + AI Compute tab
- external provider handoffs
- Reality Lens projection publication
- tests covering the above boundaries

## Authority boundary

Everything described as current implementation is still local simulation unless explicitly stated otherwise.

There is no:

- provider API execution
- stored API key
- card charge
- bank transfer
- crypto wallet
- custody
- real TUMBO issuance
- staking
- burn
- settlement
- cryptographic EchoProof

The purpose of this phase is to make the complete economic state machine visible and testable before any irreversible financial authority is connected.
