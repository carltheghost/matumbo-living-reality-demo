# Vivo Agent Station — local runtime integration

This directory is the exact archived v0.12 Python runtime, not a cloud service. The native phone route mounts its Agent Station face on the existing local agent controls. GitHub Pages serves that interface only; the broker stays bound to `127.0.0.1`. No database, provider credential, owner memory, or token is included.

Use Python 3.11+ and Node 22+ for tests. Run from this directory:

```sh
python -m unittest test_station test_memory_port test_continuity test_strategy -v
```

For a real installation, first stop the existing Station, inventory and consistently back up its SQLite and Apollo stores, and use the archived exact-version upgrade guard for v0.12. Do not overwrite changed sources or create a replacement owner world. This source directory is a canonical runtime distribution; simply checking out the repo does not start it.

Start the local web runtime from the repository using a server restricted to the actual `services/vivo/web` files or the original Vivo launcher. Open the original phone route in the intended browser profile. Enter the local world, open **Advanced → Agent Station**, and confirm the exact world ID. The owner and host credentials are separate Station credentials; never use model API keys here. Start the broker with its existing explicit database and Apollo scope/owner/world arguments and allow only the exact trusted page origin. For example (substitute your existing paths and identity):

```sh
python station.py --db /private/path/station.sqlite serve --origin http://127.0.0.1:8765 --memory /private/path/apollo.json --memory-world ACTUAL_WORLD_ID --memory-scope ACTUAL_SCOPE --memory-owner ACTUAL_OWNER
```

Without memory binding, omit all four memory options. Only use an existing, reviewed database; do not guess its location or identity. Enrollment is operator-controlled using `station.py --db ... enroll --help`. Keep credentials private. Do not expose the loopback broker through a tunnel, proxy or public network. Existing agents must bind explicitly; world edits still require their original native approvals. If the broker cannot be reached, the interface remains disconnected.

**Strategy** compares existing assigned missions via `/v1/owner/continuity/strategy/compare`. Review the exact alternative dependencies and owner-supplied estimates; a separate explicit graph confirmation invokes the existing organization setup API. Preview does not dispatch work or consume model credits. Advanced v0.12 agent tools remain available through the existing local MCP client.

## Activate the existing private runtime safely

The source checkout includes the same `upgrade_v012.py` exact-hash guard from the verified v0.12 archive. Use the existing private installed Station directory, not a replacement database or world. Stop the old broker and any other writers, consistently checkpoint its SQLite WAL, and keep byte-identical private backups of the SQLite and Apollo files **outside the public repository and web tree**. Never copy secrets or databases into the repository. Inspect the installed directory using the guard's default dry-run first:

```powershell
python .\upgrade_v012.py "<existing Station directory>"
```

Only after a supported exact base is reported, backups are verified by the operator, and the broker remains stopped, use the same command with `--apply`. Do not force unknown hashes, replace an independently modified UI, or delete journal files to pass a check. The guard does not discover all databases, take a process lock, or back up the owner's stores automatically.

The owner-operated `launch_existing.py` defaults to a read-only preflight. Use the exact existing database path, native world ID, and trusted browser origin from the original deployment. For the GitHub Pages route the origin is `https://carltheghost.github.io` (an origin does not include the repository path). For a local route use its exact `http://127.0.0.1:PORT` origin. Switching origins may select a different browser-local world; do not invent a new world to satisfy this check.

```powershell
python .\launch_existing.py --station-dir "<existing Station directory>" --db "<existing station.sqlite>" --world "<exact enrolled world ID>" --origin "https://carltheghost.github.io" --confirm-stopped --db-backup "<private stopped SQLite backup>"
```

If the existing Station is bound to Apollo, include **all** of `--memory "<existing Apollo store>" --memory-scope "<original scope>" --memory-owner "<original owner>" --memory-backup "<private stopped Apollo backup>"`. Make the original Apollo reader available through the same reviewed Python environment; optionally include `--probe-task "<known exact native mission task ID>"` to confirm a scoped read. No active memory grant may be silently stranded by a changed binding or by starting without Apollo.

The preflight validates every installed runtime hash, recognized database tables and integrity, exact enrolled world/host, memory binding, unresolved action status, source origin and loopback port. It reads a stopped, consistently checkpointed SQLite store in immutable read-only mode. It does not prove that all other writers are stopped; the explicit owner confirmation is required. It refuses a missing database, unknown source/schema, pending running actions or queued native edits, changed backup bytes, nonempty WAL/journal or unavailable port. Resolve these through the existing owner-reviewed procedure rather than changing records to make it pass. It does not enroll a user, delete records, choose paths or modify source.

If preflight passes, append `--start` to the same command. Start requires distinct byte-identical backups for each configured store. This runs the existing broker in the foreground on loopback only, with no bearer token on the command line. Keep that terminal open. In the **original** Vivo browser profile and world, open Advanced → Agent Station and explicitly connect with the existing owner and exact-world host credentials. Only a confirmed native receipt and an exact Apollo recall demonstrate the corresponding live features. A successful preflight or process start is not evidence of a connected browser or a verified user-world receipt. Browser local-network access policy may still require a user-controlled permission; do not disable browser protections.

Run the startup guard regression with `python -m unittest test_launch_existing -v`. It uses disposable stores, an isolated Apollo reader fixture and a real loopback HTTP startup smoke on Linux. No owner's store, token or native world is used.
