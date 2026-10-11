# Stage: nested Eyes and durable accepted state

Parent: `7e72f15122024f3fa1ab955ac475f3ff6b6d01df` on PR #76's main-owned
`vivo/chat1-authority-input-2026-10-10` branch. No merge into #74 or main.
Two-window ownership revision 2 remains unchanged. No Chat 3 edits.
PR #75 stays hash-pinned at `1d8b25adbcef63559b85c069029b4caf02216b41`.

## Executable additions

LocalLeaseWorld's session adapter now offers registerEye(eyeId, view),
getEye(eyeId), and moveEye(eyeId, view, expectedEyeRevision), in addition to its
existing Authority/grip API. Eye owners are bound to host-admitted actor IDs.
attach() is still PRIVILEGED local admission, not a remote authentication API.
Eye state is stored separately from the material Snapshot; another participant's
snapshot never replaces your observer. getEye returns detached own-actor data.
Registering an existing Eye on reconnection returns its saved state, not a reset.

Existing canonical space.enter and space.exit commands are now implemented.
Entry requires the current Eye, a matching portal revision and a pre-existing
innerSpaceId. Destination Space.entryView explicitly declares the full spatial
Frame, orthonormal basis and slice. There is no guessed destination or implicit
new universe. Return saves/restores all coordinates, basis and slice using a
revision-fenced LIFO returnFrameId. This is an explicitly mapped nested entrance,
not continuous portal rendering, ray tracing or a geodesic traversal solver.
Portal cycles are bounded to 32 return frames. Observers are bounded to 256.
A session must release its own live grip in that space before crossing. A second
participant's grip does not move/block your Eye. Viewers can navigate but not grab.

All changes pass through the existing serialized acceptance queue and atomic
store compare-and-swap. Navigation events, Eye changes and return identities
are included in the checksum-protected checkpoint/history. A failed store write
cannot acknowledge a movement. Time, entity coordinates and material state are
not changed by looking/entering/leaving. Full 2–11 coordinate and basis lengths
are preserved; no dimension is relabelled as time or prediction.

FileAuthorityStore provides actual POSIX filesystem storage through the existing
load/compareAndSwap port. It uses a private non-web path, exclusive temporary file,
file fsync, atomic rename, directory fsync and an exclusive lock directory.
Mismatched writers fail STORE_CONFLICT; a held lock fails STORE_BUSY. Crash-left
locks require operator inspection, not automatic unsafe stealing. Process restart
is tested; sudden power loss and Windows directory-fsync support are not certified.
Old process-local lease capabilities are invalidated on restart. Checkpoint state
and accepted event records survive; event-only reconstruction is NOT implemented.

## Tests executed locally

185 Node tests passed, no failures/skips, including 24 new nested/durable tests,
the four accepted-release fixtures and all 90 exact worker input tests. Four
Python module-route tests passed on real loopback HTTP. Input-only separately
passed 90/90 with all 25 falsy/control names asserted (not added twice to total).
Durable tests actually use filesystem data and a distinct Node subprocess; no
memory store is substituted for that evidence. CI must repeat the exact sources.
No mounted app, physical camera/phone, public networking or material step is
claimed. The child relic accepts a native x11 grip constraint but does not move
until the future material driver consumes it.

## Source-transfer status, not dropped

A supported GitHub-runner path has now transferred all seven complete upstream
vendor payloads with original size, SHA-256 and Git blob checks. Run 38093280167
reported HTTP 201 for 27,094,361 bytes in total, including both full WASMs and the
full hand model. Detached blob IDs match the original archive. This is not the
64-byte probe and removes that particular upload blocker.
The transfer job has no tree/ref/commit code and publishes no partial runtime.
It is now gated to explicit [transfer-vendor] push messages on this feature branch.

The complete original import still is not published: #74 retains 13/109 runtime
members and 6/31 research members. Remaining application/report/training payloads
need a complete byte-transfer path and atomic tree assembly. The source archives
remain intact locally. No substituted reports, regenerated approximations or
source deletions are allowed. Main must finish this before claiming a mounted
application or positive complete-package readiness. Do not count isolated full-
archive tests as certification of the partial published tree.

## Next stage

Bind authenticated remote admission/transport to this same acceptance store and
prove two real clients reconnect with independent saved Eyes. Continue the exact
source import in parallel. App hooks, material dynamics/learning, recorder replay,
local browser persistence and the full two-person shaped-object/inner-world gate
remain explicit outstanding work. Do not restart from the comparison Studio.
