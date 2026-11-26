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
