# Vivo conversation backend contract

This is an optional server capability for the canonical remote Vivo process. It
does not make the GitHub Pages phone route dynamic. The browser-side companion
seam remains honest when no provider is configured.

## Browser handoff

The remote UI may create the browser provider only after the existing
`RemoteTransport.admit()` succeeds. The handoff is explicit and in memory:

```js
const provider = await transport.connectConversationProvider({
  // Optional test/session configuration; production derives the exact
  // same-origin HTTP origin from the admitted WebSocket URL.
  sessionId: 'phone-tab-local',
});
window.VivoConversationProvider = provider;
await window.VivoCompanion?.refresh();
```

`RemoteTransport` supplies the already-admitted bearer to the provider
closure; the provider sends it only as an `Authorization` header to the fixed
same-origin `/api/conversation/*` routes. It does not place credentials in a
URL, body, browser storage, or logs. The provider starts unavailable and does
not perform a status request until `connectConversationProvider()` is called.
GitHub Pages and the local static phone route therefore stay disabled unless a
same-origin authorized server is explicitly present. A caller must remove the
global provider and close the transport on disconnect; no browser camera,
microphone, or XR permission is involved.

## Boundary

`server.remote_application` exposes two same-origin routes:

* `GET /api/conversation/status`
* `POST /api/conversation/respond`

The response route requires the exact configured `Origin`; the read-only status
GET also accepts the browser's same-origin Fetch Metadata + Host proof because
Chromium omits `Origin` on same-origin GET requests. Both require the existing
Vivo bearer capability in `Authorization: Bearer ...`. The bearer is
authenticated by the remote gateway; it is reduced to a one-way digest before selecting process-local
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
retries the same turn. New turns must advance `generation` within that
session; this lets the bounded idempotency cache reject an old uncached retry
without issuing another provider attempt.

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

When an inactive conversation slot is evicted, a bounded fence retains its
conversation ID, generation fence, and recent request outcomes while dropping
the conversational history. A replay that is still in that fence returns the
same result without allocating an active slot or making a provider attempt,
even when another active slot is locked. Fences use a bounded slot budget and
may themselves be evicted; after that, the old request is no longer covered by
an exactly-once guarantee. An unknown old/equal generation in a retained fence
is rejected before active-slot allocation; a future generation still follows
normal capacity rules. No fence survives a process restart.

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
