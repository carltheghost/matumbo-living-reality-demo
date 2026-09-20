# AI Judgments — TypeSafe judgment integration for Living Reality

Local, deterministic judgment calls for Bot Plaza intent routing and the
"Contracts for your review" queue. Tumbo's standing rule: use TypeSafe
whenever building on the project. This module is the Living Reality
equivalent of the Tumbo Picks agent-integration pattern, rebuilt in vanilla
ESM (this repo has no TypeScript build) around Bot Plaza and the Contract
Atelier instead of sports chat.

## Architecture law

**Code owns the workflow; judgments supply narrow, typed semantic calls.**
This module never generates prose, never mutates anything, and never invents
facts. It answers one narrow question per question, and code decides what to
do with the answers.

## What the module does

`src/ai/judgments.js` (zero dependencies, local-only) provides:

- **JudgmentQuestion builders** — the questions a live TypeSafe model (Jev)
  would answer, with complete meaning in `instructions` and `criteria`:
  - `botIntentQuestion()` — Choice: which Bot Plaza handler owns this message?
    Options mirror the Bot Plaza capability set: `chat`, `world_action`,
    `draft_contract`, `propose_contract`, `journal`, `message_bots`,
    `announce`, `explain_contract`, `help`, `no_match`.
  - `slotBotQuestion(candidates)` — Choice over candidate bot ids + `none`.
    Candidates are found by *code* (name-token matching); the judgment only
    selects the intended one.
  - `proposalReadinessQuestion()` — Score 0..1: how ready is a proposal for
    review? 1.0 = clear title, named event, ≥2 distinct outcomes, sane stake
    range, source + research notes, still pending.
- **Deterministic heuristics** — `routeBotIntentHeuristic(state)` mirrors the
  existing bot-plaza trigger vocabulary (the contract-scout's `scout` /
  `contract` triggers, journal notes, world actions, announcements) in
  precedence order; `selectSlotHeuristic(candidates)` resolves a unique strong
  name match (matchScore 3/2/1) and returns the `none` choice at 0.35 confidence
  under real ambiguity; `scoreProposalHeuristic(proposal, { now })` computes a
  readiness score from proposal fields plus a `reasons[]` list. Same input
  twice → byte-identical answers.
- **Provider seam** — `selectProvider()` reads `TYPESAFE_JUDGMENTS`
  (`mock` | `heuristic` | `http`, default `heuristic`). `askJudgments(state,
  questions, provider?)` asks independent questions over the same state in one
  parallel batch and returns `{ answers, provider }`.

## Providers

| Provider | Behavior |
|---|---|
| `heuristic` (default) | Deterministic local rules. Zero network. Honestly labeled. |
| `mock` | Deterministic canned answers, for unit tests. |
| `http` | Live Jev. Reads `TYPESAFE_API_KEY` / `TYPESAFE_API_URL` from the **server** environment only — never in client code, never in the browser bundle. Falls back to `heuristic` on *any* failure (missing key/URL, network error, malformed answer), so the demo never blocks and never acts blind. |

Live Jev is **never active in the local demo**: the demo never sets
`TYPESAFE_API_KEY` / `TYPESAFE_API_URL`.

## Confidence policy

`CLARIFY_THRESHOLD = 0.65`. Below it, code must clarify or confirm with Tumbo
instead of acting. **Never act blind.**

- `belowThreshold(answer)` — true when `answer.confidence < 0.65`.
- `routeBotIntentHeuristic` reports confidence below 0.65 on genuinely
  ambiguous input (e.g. two intents firing at once).
- `selectSlotHeuristic` returns the `none` choice at exactly 0.35 confidence
  when two bots are equally plausible or the name match is weak — a
  confirmation case, not a guess.

## Integration points

1. **Bot Plaza intent router** — `createIntentRouter({ registry, now })` in
   `src/domains/bot-plaza.js`. Code finds candidate bots by name-token
   matching; one parallel judgment batch (`bot-intent` + `bot-slot`) decides
   the intent and the target bot. `route(text)` returns a frozen
   `{ intent, confidence, botId|null, clarify, clarificationText }`:
   - intent confidence < 0.65 → clarify, naming the top-2 intents;
   - slot `none` while candidates exist (or low slot confidence with
     candidates) → confirmation text naming the candidates;
   - otherwise the resolved `botId` (null when no bot was named).
   
   **Routing decision only — it never messages, announces, drafts, journals,
   or executes anything.** It is additive: no existing bot-plaza function
   changed behavior.

2. **Proposal triage** — `rankProposalsForReview(queueOrProposals, { now })`
   in `src/domains/bot-plaza.js`. Scores pending proposals with the
   proposal-readiness judgment and returns a frozen array of
   `{ proposal, readiness, reasons }` sorted highest-readiness first, ties in
   queue order. **Display order only** — queue internals (approve / edit /
   dismiss, expiry, persistence) are untouched. The Contract Atelier render
   (`src/render/contract-atelier.js`, "Contracts for your review") uses it for
   display order, with a try/catch that falls back to submission order so the
   queue can never render blank.

## Boundary (non-negotiable)

- Simulated TUMBO / rehearsal points only. No wallet, no chain, no custody,
  no mainnet, no real money.
- No network calls in the demo. API keys live server-side only and are never
  in client code.
- The default provider is fully deterministic: the local demo behaves exactly
  as it did before this module existed; judgments only *order* and *route*,
  they never change what anything does.

## Tests

`tests/ai-judgments.test.mjs` — clear-input routing (e.g. "draft a contract on
the derby" → `draft_contract`, "tell the other bot" → `message_bots`),
ambiguity → confidence < 0.65, slot ambiguity → `none` at 0.35, complete >
incomplete proposal ranking with stable order, byte-identical answers for
repeated inputs, a 50-input determinism sweep, provider defaulting, the mock
shape, and the http→heuristic fallback.
