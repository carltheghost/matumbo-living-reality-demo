# Vivo local account host and constructed-memory integration

This extends the existing `services/vivo/web/phone/index.html` and mounted Field Lab
entry. It does not replace the engine, world, renderer, ledger or existing learned
models. Its browser controls live in the native Advanced sheet, opened by **AI &
memory**. No provider is contacted until a user explicitly asks.

## Run the actual sign-in host

From this repository, with Python 3.11+:

```sh
python -m pip install -r services/vivo/server/accounts/requirements.txt
python services/vivo/server/accounts/host.py --repo .
```

The host prints a five-minute, one-use local link and opens the system browser.
Treat that link as a local capability; do not share it. It serves the existing Vivo
page, not a copied application. Enter local Vivo, open AI & memory, name the
connection, and choose Add another account / Continue with ChatGPT. Credentials,
MFA and consent happen on OpenAI's page. Refresh to see the validated account.
Choose an account-specific model, separately consent to one tiny verification
request, then verify it. This may consume the selected account's allowance.

The implementation uses OpenAI's documented local open-source dynamic-client flow,
PKCE S256, a fresh state/nonce, signed ID-token validation, the issued client ID,
and granted scopes. Identity is the signed subject plus issued registration, not
email. The application name is Vivo, never a spoofed Codex or another client's ID.
A catalog response is not execution proof; only `response.completed` marks one
verification request successful. Interrupted streams and quota errors remain errors.
No automatic account cycling, action retry, paid fallback, API key, password or
browser-cookie extraction is implemented.

Multiple accounts have separate tokens, registration identities, generation fences,
and status. Reconnect cannot change the selected identity. A default is metadata for
NEW work; it does not switch any existing job. This slice does not create a background
worker or attach existing Codex/dot conversations. It does not grant agent world.edit.

Private state lives outside the repository in `~/.vivo-account-host`. POSIX files
are owner-only 0600 in a 0700 directory. Windows bytes are protected using current-user
DPAPI. DPAPI requires physical Windows acceptance; Linux tests do not certify it.
One process locks the store; a stale crash lock is reported, not deleted by a second
worker. Restarts preserve account registrations, not claimed running work or verified
entitlement. Disconnect fences late calls immediately and separately reports whether
provider refresh-token revocation succeeded. An already accepted request may still
consume allowance; local disconnect is not rollback.

The host binds only 127.0.0.1. Mutations require an HttpOnly SameSite local session,
exact Host and Origin and an explicit request header. Only selected runtime asset
paths/extensions are served. No arbitrary filesystem, `.git`, credentials, server
sources, cross-origin token API or network listener on all interfaces is exposed.

## Public Pages and other providers

Static GitHub Pages cannot execute this Python credential host. On that origin,
account controls explain the missing host instead of simulating sign-in. Opening
this loopback URL on a different phone reaches THAT phone, not the desktop. A
reviewed HTTPS relay/native companion or registered hosted login is still needed
for remote phone sign-in. This patch must not be presented as a completed public
multi-provider deployment.

Claude native Claude Code login, Hermes, Grok, Muse and dots remain visibly
unconfigured; no unsupported OAuth flow is invented. In particular, Claude.ai
subscription credentials are not collected by this third-party interface. Their
existing agent sessions and histories are distinct from model-provider access.

## Explicit-weight memory

`phone/constructive-memory.mjs` constructs a small four-bank associative circuit
from scoped exact edges. An address is a 16-bit bipolar vector. A key neuron's
weights are that stored vector and its bias is `1 - 16`. Its ReLU is 1 only for an
exact match. Explicit readout weights reconstruct the next numeric address. The
central recurrence feeds that output to the next selected relation bank.

The forward pass is numeric matrix computation, not a dictionary traversal. Exact
records and provenance remain separately available. No optimizer, gradient descent,
pretrained weight copying or provider is used. Each bank holds at most 256 unique
source keys; four banks support paths of at most 32 hops. Unknown/ambiguous memory
abstains. Checkpoint restoration validates weights against the exact records. A
world/branch change cannot read the previous scope's model through this panel.

This is an analytically constructed lookup circuit, NOT a language model, semantic
Obsidian reader, five learned agents, a universal memory, or a replacement for the
reciprocal-memory research checkpoint. It does not resolve that model's prior 48/72
transfer failure. Deterministic symbolic traversal solves the same task, and is the
independent correctness baseline. Four required banks are not proof of biological
or general intelligence. New weights require explicit compile/save, not silent edits.

## Evidence and gates

Run:

```sh
python -m unittest discover -s services/vivo/tests/accounts -p 'test_*.py' -v
node --test services/vivo/web/phone/tests/constructive-memory.test.mjs services/vivo/web/phone/tests/intelligence-entry.test.mjs
python services/vivo/tests/accounts/browser_component.py --evidence test-evidence
node --test services/vivo/web/phone/tests/*.test.mjs
```

Account tests use a signed mock issuer, not a real login. HTTP tests use an actual
loopback socket. Component browser tests use the real module with fake account HTTP
and injected storage; they are NOT full-app/network/provider tests. The enhanced
existing Field Lab Chromium check exercises native worker startup, x11 edits, original
world/Eye reload and the new IndexedDB memory lifecycle without provider/camera use.
This container blocks browser localhost navigation by administrator policy; do not
remove the policy or label that unexecuted native path passed. Hosted CI is separate.

Official references checked 2026-11-08:
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://code.claude.com/docs/en/legal-and-compliance
- https://rikiyat.github.io/blog/weight-space-programming/

No merge/deployment or provider authentication has been performed by writing this
code. A real account login and completed inference, complete-repository browser CI,
cache upgrade, Windows credential-store validation and phone acceptance remain
separate release gates. No private note, model archive or secret is published.
