# maTumbo council orchestration — local simulation

This is a bounded orchestration slice, not a deployed agency backend and not a provider connector. Run it locally with:

```sh
node scripts/council-demo.mjs
```

The output begins with `SIMULATION ONLY`. It uses deterministic in-process mock adapters. It does not sign in, create credentials, transmit user data, call an LLM/provider, execute a world/tool action, or claim that any provider connection exists.

## Ownership and integration boundary

`src/domains/council-orchestrator.js` owns only the council state machine:

- `createBotPlazaCouncilAuthority()` reads the existing Bot Plaza registry. Bot Plaza remains authoritative for identity, enabled state, and approved tool capabilities.
- `createCouncilMemberRegistry()` stores the user’s explicit council membership, role, context scopes, orchestration capabilities, connection state, and revocation epoch. It cannot add capabilities to the Bot Plaza authority.
- `createCouncilOrchestrator()` requires explicit per-member and per-task consent, creates redacted context views, runs bounded proposal/critic/synthesis phases, and returns an auditable result.
- Adapter results are untrusted data. `permissions`, `budget`, `credentials`, tool calls, and delegation requests in a bot response are recorded or rejected; they are never authority.
- Action requests are proposal-only records. The council never calls `createWorldActionExecutor`, a provider SDK, a browser, a login flow, or an external service.

No `index.html`, `src/main.js`, `src/render/*`, Vivo transport/provider file, contract/token/economy/house-pool file, or shared entrypoint is changed. A future UI integration must be separately approved by the parent/control tower.

## Bounded flow

```text
existing authority
       │ read-only member state
       ▼
explicit council member + task consent
       │ per-member scopes/capabilities
       ▼
redacted context ──► specialist proposals ──► critic review ──► selected lead/specialist synthesis
       │                      │                    │                    │
       └──────────── provenance, unknowns, disagreements, budget, revocation/late-result fences ─────┘
```

The default budget and phase limits are intentionally small. Concurrency is capped; token/cost reservations happen before an adapter call; a bot cannot increase them in its response. Duplicate response IDs and duplicate effect keys are fenced. Delegation is disabled by default and, when explicitly configured, follows only an allowlisted edge/depth policy with cycle checks. Similar-bot agreement is reported as a warning, never proof of truth.

## Account/provider status research

The simulation keeps provider states at `manual-setup-required`. That is an honest setup gate, not a fake connected account.

| Candidate | Supported route to investigate later | Current slice |
| --- | --- | --- |
| OpenAI / ChatGPT plan | OpenAI documents Sign in with ChatGPT and eligible plan-backed Responses requests for registered applications. The app must use the supported consent flow, keep tokens under the user’s control, and must not pool subscriptions or provide a general-purpose gateway. | Pending registration/eligibility and a separately approved account flow; no conversations, memory, credentials, or requests are used. |
| GitHub Copilot | GitHub documents a registered GitHub OAuth/App flow for the Copilot SDK, with each user’s own Copilot subscription and per-user token lifecycle. | Pending OAuth app setup and backend-only secret handling; no token or sign-in is created. |
| Anthropic / Claude | Anthropic documents Claude consumer/Console accounts as independent; the Claude API requires Console/API authentication or supported workload/cloud identity. | No consumer-account bridge is assumed; manual Console/cloud setup remains separate. |
| Anthropic / Claude plan | Anthropic documents Claude Agent SDK, `claude -p`, and third-party app usage against eligible plan limits/credits, while the Agent SDK docs require provider approval for third-party `claude.ai` login/rate-limit offerings. | Approval and account-flow setup remain separate; no Claude login, cached auth, or plan request is attempted. |
| Google / Gemini | Google documents OAuth for a configured Google Cloud project and Generative Language API, with consent and project credentials. | No Gemini consumer sign-in is treated as API entitlement; manual project setup remains separate. |
| Google / Gemini CLI | Gemini CLI documents local browser sign-in with a Google account and an ACP/stdio mode for programmatic clients. | Local CLI/ACP is a future adapter boundary only; no CLI process or cached credential is touched. |
| xAI / Grok Build | xAI documents `grok login`/device auth, headless scripting, and an ACP agent mode. | Manual account authorization remains separate; no login, cached token, API key, or CLI process is used. |

Primary references:

- [OpenAI: Sign in with ChatGPT](https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt)
- [OpenAI: using a ChatGPT plan in other apps](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites)
- [OpenAI developer quickstart](https://developers.openai.com/siwc/quickstart)
- [OpenAI open-source token-sharing overview](https://developers.openai.com/siwc/token-sharing-open-source)
- [OpenAI Sign in with ChatGPT terms](https://openai.com/policies/sign-in-with-chatgpt-terms/)
- [GitHub: Copilot SDK GitHub OAuth](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth)
- [Anthropic: Claude and Console accounts](https://support.claude.com/en/articles/8987223-can-i-have-a-claude-account-and-a-console-account)
- [Anthropic: API overview and authentication](https://platform.claude.com/docs/en/api/overview)
- [Anthropic: Claude Agent SDK with a Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Anthropic: Agent SDK overview and approval boundary](https://code.claude.com/docs/en/agent-sdk/overview)
- [Google: Gemini OAuth quickstart](https://ai.google.dev/gemini-api/docs/oauth)
- [Gemini CLI: authentication setup](https://geminicli.com/docs/get-started/authentication/)
- [Gemini CLI: ACP mode](https://geminicli.com/docs/cli/acp-mode/)
- [xAI: Grok CLI reference](https://docs.x.ai/build/cli/reference)
- [xAI: Grok headless and ACP scripting](https://docs.x.ai/build/cli/headless-scripting)

Sign-in is not the same as bot-to-bot entitlement. The user must select the provider/account, complete the provider’s own consent and eligibility gates, and authorize the council task separately. Chat subscriptions do not establish arbitrary API or conversation access.

## Verification

The focused suite is:

```sh
node --test tests/council-orchestrator.test.mjs
```

It exercises unapproved members, per-task capability gates, context redaction, lead versus approved-specialist speaker selection, proposal/critic disagreement, unknowns and provenance, budget exhaustion, concurrency, failures/timeouts, delegation cycles, duplicate responses/effects, in-flight revocation, cancellation, and the simulation/provider-status boundary.
