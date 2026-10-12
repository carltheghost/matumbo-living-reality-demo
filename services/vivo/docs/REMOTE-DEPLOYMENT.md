# Opt-in canonical remote deployment

This recipe is deliberately separate from the existing `Dockerfile`,
`compose.yaml`, and local/0.8.1 entrypoint. It runs the current
`start-canonical-remote.sh` gateway behind Caddy; it does not change the GitHub
Pages site or wire a browser to a host chosen by this repository.

## Smallest hosting requirement

Use one Linux host with Docker Engine and Compose v2, a DNS name that points to
that host, and inbound TCP ports 80 and 443. Keep exactly one `vivo-remote`
replica: the gateway owns process-local sessions and leases and its persistent
`/data` volume is not a distributed database. Keep the named volumes for both
the authority data and Caddy's certificate state.

The deployment has two containers:

* `vivo-remote` is built from `Dockerfile.remote`. It contains Node 24.19.x,
  Python, the existing remote launcher, the authority, the allowlisted browser
  modules, and the exact research mailbox dependency. It binds `0.0.0.0:8768`
  with the operator-provided backend certificate and key, and its port 8768 is
  exposed only on the Compose network.
* `https` is the only public listener. Caddy terminates HTTPS, obtains and
  renews the certificate for `VIVA_DOMAIN`, and reverse-proxies HTTP,
  WebSocket, and conversation requests over a separately authenticated HTTPS
  hop to `vivo-remote:8768`. Caddy trusts only the supplied backend CA and
  verifies the backend name `vivo-remote`.

No hosting account, DNS record, certificate, volume, credential, or public
endpoint is created by this repository change.

## Required decisions and secrets

Copy [`REMOTE-DEPLOYMENT.env.example`](REMOTE-DEPLOYMENT.env.example) to an
untracked file managed by the host's secret facility. Resolve these before
starting the service:

* `VIVA_DOMAIN` must be the public DNS hostname, and
  `VIVA_PUBLIC_ORIGIN` must be exactly `https://` plus that hostname, with no
  path and no trailing slash. A mismatch is an origin failure, not a supported
  fallback.
* `VIVO_BACKEND_CERT_FILE`, `VIVO_BACKEND_KEY_FILE`, and
  `VIVO_BACKEND_CA_FILE` point to secret-managed files. The backend certificate
  must be signed by the supplied CA and include `vivo-remote` as a DNS SAN and
  `127.0.0.1` as an IP SAN for the container healthcheck. Caddy uses that CA
  and name for its private HTTPS hop. Do not replace this with
  `tls_insecure_skip_verify` or an HTTP backend.
* `VIVO_OWNER_TOKEN` is the existing remote owner capability and must contain
  at least 32 random characters. The operator must generate and rotate it in a
  secret manager. The image and launcher never generate, print, or persist it.
* Leave `OPENAI_API_KEY` empty to keep conversation disabled. Enabling it is a
  separate operator choice: inject it only as a server secret, configure the
  OpenAI project spend/rate limits first, and select an approved model. It is
  never read from browser input and is not needed for health or world traffic.
* `/data` must be a private persistent volume writable by container UID 10001.
  Do not make the database world-readable to fix a permissions problem.

The remote authority uses its existing owner/invitation capability policy. It
does not accept arbitrary proxy URLs, anonymous paid requests, model tools,
world mutations from model output, or a client-supplied authorization scope.

## Validate and start

From the repository root, after filling the untracked env file:

```sh
docker compose \
  --env-file services/vivo/docs/REMOTE-DEPLOYMENT.env \
  -f services/vivo/compose.remote.yaml config --quiet

docker compose \
  --env-file services/vivo/docs/REMOTE-DEPLOYMENT.env \
  -f services/vivo/compose.remote.yaml up --build -d
```

The first command validates interpolation and the explicit service wiring. Do
not paste its rendered output into logs: `VIVO_OWNER_TOKEN` and an optional
provider key are interpolated into the container environment. Use the host's
secret-aware Compose integration instead when it can supply those values
without a local env file.

## Health and graceful shutdown

`vivo-remote` is healthy only when the Python gateway and its private Node
authority are ready. Its Compose healthcheck polls
`https://127.0.0.1:8768/healthz` with the supplied backend CA; the Caddy
healthcheck validates the loaded Caddyfile. From an authorized host, the public
probe is:

```sh
curl --fail https://YOUR-REMOTE-HOST.example/healthz
```

The response is transport/readiness evidence only. It keeps
`physicalDeviceValidated` and `publicDeploymentVerified` false. Device,
camera, DNS, certificate trust, latency, and two-person acceptance still need
their separately scoped checks.

Compose supplies a small init process, the launcher uses `exec`, and both
services have a 30-second `stop_grace_period`. Stop through Compose so aiohttp can close
WebSockets, the material host, the authority process, the conversation adapter,
and the invitation database in order:

```sh
docker compose \
  --env-file services/vivo/docs/REMOTE-DEPLOYMENT.env \
  -f services/vivo/compose.remote.yaml stop -t 30
```

Back up the authority and invitation data with the service stopped, or use a
SQLite-aware backup procedure while running. Do not copy a live database while
ignoring its WAL/sidecar state.

## Bounded remote and conversation contract

The existing gateway remains bounded at two concurrent WebSocket participants
and 64 KiB per gateway message, with 120 messages per 10-second connection
window. Conversation state is process-local and bounded by the configured
limits below; it is not durable world state:

| Limit | Default |
| --- | ---: |
| Conversation request body | 16 KiB |
| User message | 400 characters |
| Model output | 4,000 characters |
| Conversation history | 24 messages / 12,000 characters |
| Provider timeout | 18 seconds |
| Provider output tokens | 240 |
| Conversation requests | 12 per identity per minute |
| Active conversation sessions | 256 total / 32 per identity |

When `OPENAI_API_KEY` is absent, the status route reports
`provider-not-configured` and response requests return
`CONVERSATION_UNAVAILABLE`; no scripted fallback is emitted. When enabled,
the adapter uses the fixed OpenAI Responses endpoint, `store: false`, bounded
history, no tools, and stable redacted errors. Conversation routes still
require the exact origin and an existing bearer capability. The full contract
is in [`CONVERSATION-BACKEND.md`](CONVERSATION-BACKEND.md).

## Remaining operator choices

Before any real deployment, the operator must choose the host/provider project,
configure DNS and firewall rules, provision the private persistent volume,
create and store the owner capability, decide whether to enable OpenAI, set
project spend limits if so, and run the authorized public-network/device
acceptance checks. This recipe intentionally does not assume free hosting,
create accounts, provision paid resources, generate persistent tokens, or make
live provider calls.
