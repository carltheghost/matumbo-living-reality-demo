# Railway deployment handoff (not deployed)

Use the included Dockerfile as a **single-instance** service and attach writable
persistent storage at `/data` for UID 10001. Set a fresh random `VIVA_CREATE_KEY`
of at least 32 characters. Configure the exact HTTPS public origin in
`VIVA_PUBLIC_ORIGIN`; alternatively Railway's `RAILWAY_PUBLIC_DOMAIN` is read.
Set health-check path `/readyz`. The Docker command uses the assigned `PORT`.

Do not copy a creation key into source or a browser URL. Configure it in secret
environment variables. Enter it only into the creation form on your own HTTPS
origin. Invite guests using editor/viewer links, not owner credentials.

No railway.toml is supplied: current official Railway documentation says new
services cannot opt into that deprecated format. Service settings can be selected
in the dashboard or managed with current Infrastructure as Code. Creating a
service, selecting a paid plan and granting connection consent remain user actions.

A ready response is not proof of real-device tracking or durable mounted storage.
Restart/redeploy after moving a test object and confirm that its coordinates and
invitation still work. Run two-device acceptance before using a shared workshop.

Official sources checked 2026-10-10:
https://docs.railway.com/infrastructure-as-code
https://docs.railway.com/deployments/healthchecks
https://docs.railway.com/volumes
