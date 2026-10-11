# Vivo canonical remote stage

This stage exposes the same canonical MountedRuntime through an authenticated
WebSocket gateway. It does **not** create a second world or copy state into a
remote-specific authority.

## Security/identity boundary
- Public clients never receive the private Node runtime token.
- Owner access comes from a 32+ character environment token.
- Editor invitations are random 256-bit URL-safe tokens; only SHA-256 hashes are
  stored in the durable invitation SQLite database.
- An invitation has a stable actor ID, so reconnect and process restart recover
  the same saved Eye and accepted world state.
- The first verified scope is two participants: owner/seat one and one active
  editor/seat two.
- Exact Origin is required. Plain ws/http is allowed only on explicit loopback
  test mode. Non-loopback startup requires a certificate/key and HTTPS Origin.
- Camera frames and microphone data have no remote protocol operation.

## Canonical behavior
- Commands, leases, nested entry/return, Eyes, history and material acceptance all
  execute inside the existing MountedRuntime/LocalLeaseWorld.
- Learned adaptive material is the same `vivo.lease-adaptive/1` protocol.
- Matching cooperative groups let both people apply independent accepted
  constraints to one object. Ordinary grabs remain exclusive.
- Disconnect closes the private runtime session and releases that participant's
  leases. Reconnect does not replay unacknowledged targets.
- Canonical world and invite DB survive process restart. Process-local leases do
  not.

## Run a loopback development server

```sh
export VIVO_OWNER_TOKEN='replace-with-at-least-32-random-characters'
python -m server.remote_application \
  --data-dir /absolute/private/vivo-remote \
  --origin http://127.0.0.1:8768 \
  --allow-insecure-loopback
```

A real public deployment still requires an actual TLS hostname, private durable
storage, device/browser acceptance and operator key management. This PR performs
no deployment.
