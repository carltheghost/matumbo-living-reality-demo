# Hosting the shared authority

## This is a server deployment, not a Pages upload

The existing GitHub Pages site remains unchanged. A Python process owns shared room state and WebSocket connections. It must keep running. The same service serves `web/`, so the mobile interface and WebSocket use one origin.

No live hostname, repository write, PR or paid resource was created in this build. Replit app creation was attempted but rejected because an active subscription is required. The optional Railway connection was offered in the conversation; connection/consent remains the user's choice.

## Railway preparation

Use service settings or current Railway Infrastructure as Code. The previous railway.toml example was removed: it is no longer accepted for new services. Set the readiness path to `/readyz`.

1. Put this package in its own service directory without changing the current Studio files, then deploy that directory using the supplied Dockerfile. A dedicated service is less disruptive than converting the existing repository root into a Python app.
2. Attach persistent storage mounted at `/data`. The process runs as UID 10001. Verify the mounted directory is writable by that UID; do not solve this by making a world-readable database.
3. Set `VIVA_DB=/data/viva.sqlite`. Generate a random `VIVA_CREATE_KEY` in the service's secret environment variables. Do not place it in GitHub or a client JavaScript file. Only room creation uses it.
4. Configure exactly **one replica**. This version uses in-memory session/lease coordination and one SQLite database, not a distributed room lock.
5. Generate the service's public HTTPS domain, set `VIVA_PUBLIC_ORIGIN` to that exact origin (no path or trailing slash), and redeploy. The WebSocket uses WSS automatically.
6. Check `/health` returns `ok:true`, release `0.8.1`, and `creationKeyRequired:true`. Confirm `/`, `/studio.html`, `/camera.js`, and the local hand model/wasm assets load without a redirect to HTML.
7. Perform the two-device acceptance checklist. A green build or health response does not establish hand tracking or persistence.

Railway may charge for compute and storage. No plan, purchase, or billing change has been authorized here.

Official references:
- https://docs.railway.com/networking/public-networking
- https://docs.railway.com/volumes
- https://docs.railway.com/builds/dockerfiles

## Self-hosted Docker + HTTPS

`compose.yaml` runs the Python app behind Caddy. It requires a public hostname with working DNS and ports 80/443 reachable. Set `VIVA_DOMAIN` and a randomly generated `VIVA_CREATE_KEY` in an uncommitted `.env`. Do not use the example secret.

```sh
python -c "import secrets; print(secrets.token_urlsafe(32))"
docker compose up --build -d
```

The server container is not published directly; Caddy is the entry point. Both Caddy data and the Viva SQLite directory use persistent volumes. This configuration was prepared, not executed or TLS-verified in the provided environment.

## Operational boundaries

Back up the SQLite database with SQLite's backup mechanism while running, or stop the service before copying the DB together with its WAL state. Do not copy only the main file while ignoring an active WAL. Restore into one stopped instance.

Owner capability expires in 30 days; editor/viewer capability in 24 hours. No self-service account recovery or renewal UI is implemented. Operators must plan ownership renewal or data export before expiry. Guest invites can be revoked in the UI. There is no automatic anonymous public lobby.

The server sees object state; HTTPS is transport encryption, not end-to-end encryption. Camera pixels and raw gaze are not accepted by the room protocol. Shared display names and voluntary virtual observer positions are recorded with retained history.

Capacity is deliberately bounded: 64 rooms, 12 concurrent participants per room, 32 seeded published objects, 301 retained checkpoints/events, 1,200 recent command receipts. Start with two people. No capacity or WAN-latency benchmark supports a larger production claim.
