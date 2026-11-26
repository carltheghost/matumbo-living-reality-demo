# Provider Council — bounded owner-side evidence

This first integration compares explicitly configured direct inference API lanes on one fixed arithmetic task. It uses the real provider protocol for each lane; the default fixture mode never reads ambient credentials or sends network requests. A returned response is an observation, not proof of account ownership, model quality, provider-signed provenance, actual charges, or settlement. The council never invokes tools or acts on the world.

| Lane | Trusted host credential | Explicit model variable |
| --- | --- | --- |
| OpenAI | OPENAI_API_KEY | VIVO_COUNCIL_OPENAI_MODEL |
| Anthropic | ANTHROPIC_API_KEY | VIVO_COUNCIL_ANTHROPIC_MODEL |
| Google | GEMINI_API_KEY | VIVO_COUNCIL_GOOGLE_MODEL |
| DeepSeek | DEEPSEEK_API_KEY | VIVO_COUNCIL_DEEPSEEK_MODEL |
| Kimi | MOONSHOT_API_KEY | VIVO_COUNCIL_KIMI_MODEL |
| NVIDIA | NVIDIA_API_KEY | VIVO_COUNCIL_NVIDIA_MODEL |
| xAI | XAI_API_KEY | VIVO_COUNCIL_XAI_MODEL |

Use exact models authorized on the owner's trusted host. No default live model or guessed account availability. Gemini expects a bare model ID. Existing Jev typed decisions, Hermes/local inference and subscription/OAuth sessions have different contracts; they are not converted into these API credentials. Quantum hardware is excluded.

Offline: `node --test tests/provider-council.test.mjs`
Create a clearly synthetic report: `node scripts/vivo/provider-council.mjs --fixture --out=provider-council-fixture.json`

On the authorized provider host only, after existing approved credential/model configuration and reviewing the provider account budgets:
`node scripts/vivo/provider-council.mjs --live --providers=all --max-attempts=7 --accept-provider-charges --out=provider-council-live.json`

The live command attempts each configured selected provider at most once, up to the explicit attempt count, with a fixed short prompt, requested output parameter 64, default 20-second deadline, no tools, no redirects, no fallback and no automatic retry. A timeout or error can be billed; output parameters have provider-specific semantics (including reasoning tokens). This is not a guaranteed monetary ceiling. A non-green live run exits nonzero but still exports evidence. Actual billing remains the provider's authority. Do not run the live command in hosted CI or a public browser. Do not expose secret values, provider response bodies or authorization headers in reports.

Import the export in the existing Compute object's Provider Council evidence region. Only the latest validated report is stored in this tab, not a cumulative ledger. Fixture and host-claimed live reports are clearly distinguished. SHA-256 checks the exact supplied report bytes, not provider authenticity. No demo credits, reward balances, observed Jev journal or economic events are mutated. A saved report is not permission to issue a new request.

Reference protocols:
- https://developers.openai.com/api/reference/resources/responses/methods/create
- https://platform.claude.com/docs/en/api/http/beta/messages/create
- https://ai.google.dev/api/generate-content
- https://api-docs.deepseek.com/api/create-chat-completion/
- https://platform.moonshot.ai/docs/api/chat
- https://docs.api.nvidia.com/nim/reference/llm-apis
- https://docs.x.ai/developers/rest-api-reference/inference/responses

Live responses require authorized existing connections; offline fixtures cannot establish which accounts have credits. The separate existing account broker must own subscription/OAuth authentication and any future task-level authorization, replay protection, budget reservations, actual billing reconciliation and production fan-out.

## Version 2: independently verified planning mission

The arithmetic report and export remain backward compatible. The additional route task asks providers to select a nonempty subset from four fixed synthetic jobs with budget 7, maximizing total value. Vivo enumerates all 15 nonempty subsets and determines the unique optimum C,D (cost 7, value 13). A,B is feasible but suboptimal; A,C exceeds the budget. The response parser accepts only canonicalized comma-separated IDs. Invalid answers, alternatives and unavailable lanes remain explicit. The report schema /2 requires a candidate field and verifies that answerCorrect is consistent with the independently computed optimum. The import cannot prove what a provider actually said, and a rehashed fabricated report can still lie consistently. No response is executed or used for real billing.

Offline mixed evidence: `node scripts/vivo/provider-council.mjs --fixture --task=route --out=provider-council-mission-fixture.json`. Live, only on the already configured authorized provider host: add `--task=route` to the existing explicit live command. This is an additional paid probe if executed, not an automatic retry. The exact same constrained task is sent independently to each model; no private conversation history or provider reply is forwarded.

The native Compute browser scenario imports a mixed mission, checks dissent and provenance labels, rejects inconsistent bytes and a rehashed invalid answer, navigates between native objects, reloads the same tab and verifies unchanged accounting and Jev state. A fresh sibling tab has no report. The three mounted application Chromium jobs use ubuntu-24.04 after actual Ubuntu 26.04 installation failures. All remaining CI must be verified before merging.
