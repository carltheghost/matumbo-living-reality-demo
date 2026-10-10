# Relay this packet to Chats 2-5

Repository `carltheghost/matumbo-living-reality-demo`; integration branch
`vivo/chat1-integration-2026-10-10`. Use the full frozen HEAD SHA reported with this
packet. Start your named worker branch from that commit. Do not start from main.
Read `BASELINE.md`, `INTERFACES.md`, `OWNERSHIP.json`, and the typed contract.
Restore the two exact ZIPs with `scripts/vivo/recover.py` before inspecting runtime
code. The accompanying baseline ZIP also supplies that exact on-disk source.

Chat 2: local/shared authority adapters, nested spaces/identity/lineage, persistence,
leases, immutable snapshots, idempotency, own-Eye navigation. Do not edit app.py.

Chat 3: absolute-target controller and mailbox adapter, bounded provisional motion,
release/cancel barriers, touch-vs-hand ownership, stale-frame and reacquire safety,
frame/chart mapping. Do not edit shared.js/camera.js; supply integration hooks.

Chat 4: material-driver module reusing the actual phase solver, bounded grip forcing,
explicit material membership/state, mass/work diagnostics, checkpoint/replay and
versioned learned material/intent/room boundaries. Do not rewrite recovered solver,
server loop, routing neural model or shared protocol. Extensions only.

Chat 5: independent acceptance fixtures, delayed/lost ACK tests, actual extra-axis
interaction, two-client nested enter/edit/return persistence, learning and device
limits. Preserve raw evidence and distinguish mocked versus real networking/input.
Do not implement production fixes or change the contract to make tests pass.

All: use only your owned new subdirectories. Commit only those paths, never the
whole untracked source overlay. Send Chat 1 a PR targeting integration branch, or
an exact diff plus full parent/commit SHA. Do not merge, force-push, buy hosting or
replace the current root. Report exported factories, run commands/results, raw logs,
assumptions, limits and required main hooks. Requests to change interfaces go to
Chat 1 before implementation. Only Tumbo authorizes merges.
