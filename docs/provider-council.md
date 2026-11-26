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

## Responsive reading anchor hardening

On 7374ec5, provider offline CI passed 26/26, both council browser scenarios passed 22 checkpoints each, and the mounted application gate passed. The expanded Compute face exposed a real portrait-return failure (run 45750727457, mobile orientation job 139677605166). Its input was no longer an actionable hit target despite a 433px attached skin and a 7,258px scrollable content area. The earlier nearest-element scroll used transformed screen geometry and a short wall-clock window. This follow-up computes the centered target in the owning skin's untransformed layout coordinates, accounts for nested scroll offsets, and verifies the actual projected hit target for three stable rendered frames (bounded to 90 frames). It never scrolls the outer document, changes focus, remounts or alters the draft. User pointer/wheel/key activity still cancels assistance. Dedicated arithmetic/DOM-contract tests and richer failure diagnostics are added. Desktop core's prior structured report passed 40 checkpoints but its job was canceled; preserve that distinction and allow cleanup/artifact headroom with a separate 20-minute test step within a 25-minute job. Fresh hosted results are required.

## Neural Memory evidence recall

This is an incremental, object-native local evidence memory, not a trained neural network or shared server memory. A report import alone still only updates the latest Council report. The explicit Remember in Neural Mesh control saves the validated original envelope in a bounded, tab-local journal (64 entries / 512 KiB); no eviction, no mutation of balances, no model calls. The content digest provides a stable memory ID. A same-run different digest is rejected, exact duplicate is idempotent, and every stored envelope is independently revalidated on recall. Same-document writes are serialized; cross-document atomicity and malicious local storage tampering are not authenticated or guaranteed. No account synchronization, persistence after tab closure, or provider authentication is implied. Existing latest reports remain compatible and may be remembered explicitly.

Neural Mesh reads the same journal through its native object skin and supports bounded search of provider, model, task, run ID, candidate, verdict and digest, plus fixture/live-claim filtering. Recall computes verdicts anew, retains disagreement and unknown results, and never grants execution authority. Browser acceptance includes two explicit saves, duplicate rejection, actual object navigation, exact digest and dissent recall, page reload and independently opened tab isolation. Offline unit tests cover conflicts, corruption, capacity and unavailable storage. No actual paid inference is needed for this increment.

## Private remote memory vault (next server stage)

The existing canonical remote application now has a distinct, bounded SQLite evidence store in its private data directory. This does not turn the public Pages site or its tab-local journal into an authenticated backend. Explicitly download or retain a Council export and import it in the authenticated remote application's existing Neural Memory surface. The owner can archive, search, retrieve the original envelope, and grant or revoke recall of individual records to an existing active invitation. Editors have read-only access to individually granted records; they cannot archive or grant. Expired/revoked invitations fail authentication on every memory request. Unshared and absent evidence return the same error. Revocation blocks future reads, not copies already downloaded. No automatic cross-account sync, new token, provider call, model training, money movement, or world mutation.

The same-origin POST /api/neural-memory takes {op,args} with the existing bearer capability and exact configured Origin. Operations: archive {envelope}; search {query?,mode?,limit?,before?}; get {memoryId}; grant {memoryId,invitationId,granted}; grants {memoryId}. The server validates original /1 and /2 report bytes and recomputes planning verdicts independently, including on recall. The database stores up to 128 reports / 2 MiB and fails closed without eviction. The owner namespace is the existing private remote data directory; credentials and raw provider responses are not stored in this vault. This is evidence memory, not a provider signature, E2E encryption, or general neural model. Test coverage includes actual loopback HTTP, Node-generated fixture parity, store restart, grants, expiry/revocation, conflict, corruption and pagination. Deployment of the opt-in authenticated remote server remains separate from Pages.


### Task-scoped agent evidence and deployment hardening

The previous commit passed all 43 canonical remote HTTP/WebSocket tests, including three cross-runtime Council vault cases, and both loopback TLS and two-person browser jobs. Its opt-in image smoke failed certificate verification because the ephemeral CA lacked explicit key usage; four phone browser jobs failed because Ubuntu 26.04 is incompatible with pinned Playwright Chromium, and the static verifier incorrectly asserted 51 paths after coverage grew to 53. This revision pins only those browser jobs to Ubuntu 24.04, generates standards-compliant test CA and server extensions and verifies the chain strictly, and retains every previously covered public path while adding ten current memory/geometry paths. It does not relax TLS or discard coverage.

The new authenticated `context` operation requires an explicit known task and fixture/live provenance, optional exact provider membership, and a maximum of eight records. It returns only authorized matching records, including all dissent, unavailable responses, source digests and recomputed local scores. Missing matches remain empty; no unshared record is disclosed through truncation. A six-report synthetic corpus tests exact retrieval, provenance separation, capacity, grant revocation and unauthorized access. The remote Neural Memory sheet exposes this operation without prompting a model. Existing transport admission and socket-close fencing are retained. A new real two-context browser regression exercises owner archival, explicit grant, mobile recall, provenance filtering and revocation. No automatic agent execution or prompt injection is added; a prepared context is evidence, not a command. Fresh CI and authenticated server deployment are required.

### Strict CSP browser regression repair
The ec5bce2 revision passed all integration workflows except the new memory-sharing browser case. Existing two-person browser acceptance passed 13/13 and the remote HTTP/TLS jobs passed. The new case stopped before memory actions because Playwright's string wait_for_function attempted eval under the unchanged strict CSP. Replace that single wait with the already proven bounded input_value polling pattern. The invitation bearer is not written to the new evidence report. No application security policy is changed. Fresh browser CI must pass before this vault is merged.

### Explicit sharing-target correction
The strict-CSP repair progressed through archive and private recall. The next browser failure revealed a real targeting ambiguity: the invitation dropdown automatically selected an older active invitation. The owner UI now starts with no selected evidence or collaborator, binds loaded grant choices to the selected report, disables sharing until an explicit target is selected, clears the target when the report changes or a grant/revoke is submitted, and correlates the returned receipt with the exact report and invitation. The two-context test creates two active invitations, chooses the authenticated editor identity explicitly, checks that changing the report invalidates the target, and reloads permissions before revoking. No security boundary or server authorization is relaxed.
