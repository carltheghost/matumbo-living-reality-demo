# Vivo conversation backend contract

This is an optional server capability for the canonical remote Vivo process. It
does not make the GitHub Pages phone route dynamic. The browser-side companion
seam remains honest when no provider is configured.

## Boundary

`server.remote_application` exposes two same-origin routes:

* `GET /api/conversation/status`
* `POST /api/conversation/respond`

Both require the exact configured `Origin` and the existing Vivo bearer
capability in `Authorization: Bearer ...`. The bearer is authenticated by the
remote gateway; it is reduced to a one-way digest before selecting process-local
conversation state. Each state is also scoped by the client-generated session
ID and sanitized world/companion scope, so two tabs using the same bearer do
not share generation fences or request-ID outcomes. The raw bearer and
`OPENAI_API_KEY` never enter responses, browser assets, logs, or receipts.

The response route accepts only this bounded JSON shape:

```json
{
  "sessionId": "phone-tab-7f4b",
  "requestId": "phone.turn.1",
  "generation": 1,
  "message": "What is this place?",
  "companion": {"id": "relic", "name": "Relic", "role": "Keeper"},
  "world": {
    "worldId": "world-1",
    "branchId": "branch-1",
    "eyeId": "eye-1",
    "spaceId": "root",
    "dimension": 4,
    "entity": {"id": "relic", "name": "Relic", "q": [0, 0, 0, 0], "revision": 0}
  }
}
```

`sessionId` is a client-generated, bounded tab/session identifier. It is
combined with the authenticated bearer identity; it is not an authorization
credential. `requestId` is required and must remain unchanged when a client
retries the same turn.

The server ignores unlisted companion fields, rejects oversized or malformed
context, caps coordinates to the accepted bounded range, and uses world data
only as descriptive prompt context. It never uses that data to authorize an
operation, execute a tool, mutate a world, place an order, move money, or start
another agent.

Successful replies echo `requestId`, `generation`, and a server-issued
process-local `conversationId`:

```json
{
  "schema": "vivo.conversation/2",
  "status": "complete",
  "requestId": "phone.turn.1",
  "conversationId": "vivo-conv-...",
  "generation": 1,
  "text": "...",
  "reaction": null
}
```

Retries with the same session, request ID, and payload replay the cached reply
or the cached terminal provider error without issuing another provider
attempt. Reusing a request ID for a different payload is rejected. A newer
generation fences an older in-flight response; cancellation of the HTTP
request also cancels the provider task, memoizes the cancelled attempt, and
does not commit the turn. This is the server half of the companion
selection/navigation stop contract. The memoization is process-local, so a
restart remains an operational boundary for exactly-once billing protection.

## Provider behavior

When `OPENAI_API_KEY` is absent, status is explicitly:
`{"status":"unavailable","available":false,"reason":"provider-not-configured"}`.
The response route returns `CONVERSATION_UNAVAILABLE`; it never supplies a
scripted answer that could be mistaken for model output.

When configured, the adapter sends a bounded `input` array to the fixed
`https://api.openai.com/v1/responses` endpoint with `store: false`, a pinned
operator-selected model, and no tools. Provider output is parsed from all
`message`/`output_text` blocks rather than assuming the first output item is
text. Tool calls and reasoning items are ignored; if no readable text exists,
the request fails safely. Provider errors, timeouts, and invalid responses are
redacted to stable error codes.

The default model is `gpt-6-luna`, the current model catalog’s cost-sensitive,
high-volume choice. Operators may set `VIVO_OPENAI_MODEL` to an approved model
or snapshot in secret-managed deployment configuration. No client field or
arbitrary proxy URL can change the provider destination.

Conversation history, request outcomes, and rate-limit buckets are bounded and
process-local; they reset on process restart and are not durable
application/world state. Set spend and rate limits in the
OpenAI project before enabling a live deployment, then verify with a real
authorized key and a non-production session. This branch deliberately performs
no live provider call.

The implementation follows the current OpenAI guidance to use the Responses
API for text generation, parse the `output` array rather than assuming
`output[0]`, and use `store: false` for manually managed bounded history:

* <https://developers.openai.com/api/docs/guides/text>
* <https://developers.openai.com/api/docs/guides/conversation-state>
* <https://developers.openai.com/api/docs/models>
* <https://developers.openai.com/api/docs/guides/production-best-practices>

## Deployment blockers

GitHub Pages cannot run this route. Before enabling it, the operator still has
to choose an authorized HTTPS host for `start-canonical-remote.sh`, configure
one-instance storage and the exact origin, provide the existing owner/invite
capability policy, store `OPENAI_API_KEY` as a server secret, select an approved
model/snapshot and project spend limits, and complete live provider/device
verification. No host, domain, credential, billing change, or public endpoint
was created by this change.
