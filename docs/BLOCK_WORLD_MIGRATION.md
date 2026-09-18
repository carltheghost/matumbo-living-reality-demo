# Block World / Fabric migration bridge

The local demo now exposes the earlier Arena / Living Reality ideas through a
visible **Migration Bridge** surface. It is intentionally a data-only seam:
the bridge starts from a fixed manifest, shows the mapping decision, and can
apply only safe rows to an in-memory draft.

## What is mapped

| Earlier concept | Current destination | Status |
| --- | --- | --- |
| `world-scene-layout` | Semantic block grid | mapped |
| `world-games` | ARENA runtime organ | preserved |
| `world-contracts` | Contracts + Pools projection | mapped |
| `arena-room` | Spatial room portal | mapped |
| `semantic-block-concepts` | Block World / Fabric | preserved |
| `external-project-sync` | none | deferred |

Open `Migration Bridge` from Mission Control to inspect each row. **Preview
mappings** rebuilds the deterministic preview; **Apply local draft** validates
and applies the five mapped/preserved rows to the visible Block World local
draft (the migration trace shows each destination coordinate); **Reset draft**
returns the voxel surface to its canonical fixture. Applying hands the viewer
back to the voxel surface so the destination remains visible.

### Interactive cubes

Block World is deliberately cube-first. Every projected block is a moveable
semantic cube; sparse portal, crystal, and wood cubes are also local
containers. Select a cube in the scene or directory, then use **Open cube** to
lift its lid and reveal nested cube contents, **Inspect** to read the contents
and provenance, or the six one-step move controls to reposition it inside the
bounded grid. Open/close, movement, and inspection return immutable in-memory
draft snapshots, so the canonical fixture is unchanged and a replay closes
any open containers.

The domain also exposes a bounded **Grab → Hold → Place** handoff and a direct
pointer/touch drag adapter. `createBlockWorldGrabDraft(base, target)` detaches one
selected cube into a frozen `heldBlock`; `createBlockWorldHoldDraft(draft,
delta)` moves that carried cube by at most one grid step (or to an explicitly
bounded coordinate); and `createBlockWorldPlaceDraft(draft, coordinate)`
releases it into an empty cell. `createBlockWorldPickupDraft` and
`createBlockWorldDropDraft` are readable aliases. A grab removes the cube from
the active grid only in the returned local draft, a hold keeps it detached, and
a successful place restores it with a coordinate-derived id. Every operation
records `localOnly`, `simulation`, `externalNetwork:false`,
`externalTransfer:false`, `persistence:false`, and `executable:false`.
Missing targets, malformed coordinates, out-of-bounds cells, occupied hold or
place cells, and deltas larger than one step are rejected before a new draft is
returned; the input draft and canonical fixture remain unchanged. The domain
contract remains local renderer state; it does not itself read pointer events
or camera frames, and it has no network sync, persistence, wallet movement,
token transfer, or external-world authority.

On the focused browser route, dragging a cube past the small movement threshold
maps horizontal displacement to one X step and vertical displacement to one Z
step. The renderer validates the destination with the atomic
`createBlockWorldDirectManipulationDraft` contract, records a visible
`Grab → Hold → Place` trace, and leaves the draft unchanged when the cell is
occupied or outside the bounded grid. A click without a drag still selects a
cube, and the button/keyboard-accessible controls remain the fallback. The
gesture boundary is explicit: **cube drag = one bounded local move; empty-field
drag = OrbitControls camera orbit; wheel/trackpad = camera travel**. Orbiting
never grabs a cube, and a cube drag never steers the camera. This is
  pointer/touch input only; it does not read camera frames or claim universal
  hand tracking. The separate Packet 174 host capability seam accepts only
  sanitized gaze points plus native-hand `point`, `pinch`, `open`, `inspect`,
  `grab`, `hold`, `place`, and `release` names; it requires a fresh same-cube
  gaze lock. Carry is limited to the local `Grab → one-step Hold →
  Place/Release` draft seam and never infers a destination or edits the
  canonical projection. See `docs/DEVICE_PROJECTION.md` for that boundary.

### Semantic depth and inside navigation

The field's **3-D / 4-D / 5-D** controls are reversible presentation modes over
the same cube graph. The derived W axis reflects nested-content depth and the V
axis reflects linked-neighbor degree; neither is a physical coordinate or a new
canonical record. A selected container's existing contents can be focused with
row, peek-cube, or hover-preview controls and cycled with **Previous inside** /
**Next inside**. The parent remains the only movable, openable, or grabbable
cube. Packet 166 verified the depth switch, linked previous/next navigation,
inside focus, and Portal → Rooms → Return journey with cube-only geometry.

### Field double activation

A deliberate double-click (mouse) or double-tap (touch) on a container cube
toggles its lid through the same local `open` / `close` contract as the **Open
cube** button. The first tap only selects; taps on different cubes, taps outside
the 420 ms / 28 px gesture bounds, drags, and pointer cancellation never open a
cube. Solid cubes report a local boundary message and remain unchanged. There
is no native `dblclick` execution path, so a browser click cannot duplicate the
single renderer action; reduced-motion mode changes no state semantics.

### Selected-container affordance

Openable cubes now carry a stronger cube-only visual cue in the focused field:
their shell uses an accent material and slightly larger box geometry, a small
floating cube beacon marks the container state, and the selected outline uses
the matching box edges. The beacon is presentation-only and is intentionally
not added to `raycastTargets`, so the owning block id remains the target for
click, direct drag, and same-container double activation. When the optional
`block-world-container-hint` mount is present, selecting a closed container
shows `CONTAINER READY` with the **Open cube** / double-activation instruction;
opening it changes the hint to the nested-cube count and **Inspect inside**
guidance. These cues do not alter canonical blocks or introduce persistence,
network, wallet, transfer, or external execution authority.

### Mapping back to the cube field

Every mapped or preserved row in **Migration Bridge** now shows the fixed
destination coordinate from the manifest and exposes **Show in Cube Field**.
Selecting it closes the bridge, selects the matching existing cube in the
current Block World draft, re-anchors the readout/camera, and leaves the
`Migration Bridge` control available as the return path. The handoff does not
apply a second mapping or create a new block: it only resolves the coordinate
against the existing renderer-owned draft. If a local draft has moved or
removed that coordinate, the handoff remains open and reports that no cube was
found rather than mutating the draft. The `external-project-sync` row stays
`DEFERRED · NO CUBE HANDOFF`; filesystem import, provider sync, identity
handoff, persistence, and imported-code execution remain explicitly denied.

The shared `resolveBlockMigrationHandback` domain helper is the continuity
boundary behind that button. It accepts a known manifest/preview row plus the
current Block World projection, returns the deterministic mapping id,
coordinate, resolved cube id (when present), and an explicit reason when the
handoff is deferred or the cube is absent. The helper is pure and frozen, so
the renderer can report `cube-not-found-in-current-draft` without creating a
replacement cube or silently falling back to the old organic scene.

The cube field also exposes a user-supplied snapshot preview seam. A caller
may provide an in-memory JSON object or JSON string containing `schemaVersion`,
`snapshotId`, `updatedAt`, and `entries` (or `mappings`). Validation accepts
only known legacy identifiers and treats the fixed manifest status, block type,
and coordinate as authoritative. The frozen preview returns separate mapped
and deferred rows plus stable manifest IDs/coordinates; invalid or mismatched
input is visibly blocked and never changes the current draft. This path does
not read files, execute imported values, contact providers, persist state, or
create a replacement cube or external authority.

The cube renderer also keeps a small, frozen `migrationContinuity` handoff for
the currently selected cube. Opening the bridge records the cube id and its
`[x, y, z]` coordinate; returning or replaying resolves by id first and by
coordinate second, so a stable cube remains selected even when a local draft
has been rebuilt. If the destination is no longer in the current draft, the
renderer exposes `MIGRATION HANDOFF MISSING` and returns a blocked continuity
snapshot instead of selecting an unrelated midpoint cube. Deferred rows expose
`MIGRATION HANDOFF DEFERRED` and stay non-actionable. These are renderer/local
readouts only: they never create blocks, import files, execute code, persist
state, sync providers, transfer assets, or grant authority.

### Container peek and carry cue

When a selected container is opened, each nested content record is rendered as
an ordinary cube on a short viewer-facing **peek rail** above and in front of
the shell. The rail is deterministic and derived from the content's existing
fixture offset; it is not a second world or a new semantic record. The selected
container readout reports `PEEK ACTIVE` and `HOLD → PLACE`, while the content
mesh carries the same local cue in its renderer metadata. Grabbing the selected
cube changes the existing draft to `CARRY MODE`; the status and container hint
then keep **Hold → Place** visible until the cube is placed. Placement returns
the open container to the peek state and leaves the canonical projection
unchanged. All geometry remains boxes (shell, lid, nested content, and carried
cube), and the seam adds no network, persistence, wallet, transfer, provider,
or execution authority.

### Portal cube hand-offs

Portal blocks are explicit local entry points into the rest of the demo. Select a
`portal` cube and the console renders the finite 19-destination registry for
Rooms + Messaging, Migration Bridge, Social Explorer / Re-market, Launch
Distribution, TUMBO Asset Token, Asset Market Evidence, ARENA / Game Lab,
Contracts + Pools, PAYCORE Asset-token Balances, T402 Value Routing, Neural
Mesh / Agents, Picture Matter, Prime Ledger + EchoProof, World Gateway /
Evidence, World Events / Evidence, Phone / PC / XR, Tennis Evidence / ATP · WTA,
Multi-Sport Scoreboards, and Reality Lens Ω. Activating a route
returns a frozen `semantic-block-world-navigation-draft` containing the source
block, coordinate, route id, target feature, and `portal` transition. The
renderer then hands the feature id to the existing Feature Navigator, so the
destination surface opens on the same page without a reload while the cube field
stays visible as the world substrate. A local navigation trace records each
hand-off and is cleared by Replay or a new projection draft. Route controls are
disabled while a cube is being dragged or carried, and unknown routes or
non-portal sources are rejected atomically. This is presentation-only navigation:
it does not mutate the canonical blocks, write a URL, contact a provider, persist
state, move an asset, or grant authority.

For a route-first browser check, open
`?feature=block-world&block=portal`; the URL selects the fixture Portal cube
without changing the underlying projection. The normal `block=open` link still
opens the deterministic container selected by the default cube directory.

The renderer only uses box geometry for block bodies, lids, and nested
contents. Organic round forms belong to the separate Reality Lens projection;
they are not part of the Block World surface. The interaction trace labels
each action `LOCAL ONLY` and does not imply persistence, wallet access, asset
movement, provider calls, or an external Minecraft world.

### Mobile and accessibility route audit

Portal routes are native `<button type="button">` controls with an explicit
accessible name, pressed state, and `Enter Space` keyboard hint. They therefore
remain reachable in normal Tab order and activate with Enter or Space; Escape
closes the focused Block World console. Selecting a route through a button,
touch target, or keyboard event records the input mode in the frozen local
navigation draft without changing the canonical blocks.

The current finite portal registry contains nineteen destinations. The public-
read destinations (**Asset Market Evidence**, **World Events / Evidence**,
**Tennis Evidence / ATP · WTA**, **Multi-Sport Scoreboards**, and **World
Gateway / Evidence**) reuse their existing host handlers with refresh disabled
at the portal opener; the Feature Navigator performs the one explicit public
refresh for a hand-off, so opening a portal cannot duplicate a provider request.
`Person Ω`, `Local Cube Sync`, and `Block World / Fabric` remain ordinary
feature selections rather than portal targets (Block World is the originating
workspace and Local Cube Sync has its own `?panel=runtime-sync` route).

The console keeps its route list scrollable at narrow widths, uses touch
targets large enough for compact screens, and retains a visible focus outline.
The compact CSS layout switches the portal list to one column and keeps the
directory and status regions mounted even when optional metric/readout nodes
are absent. When reduced motion is requested, cube pulse/rotation is disabled
and route metadata reports `reduced` motion; the route hand-off remains a
same-page local operation.

The layer can also mount in `static-controls` mode when no Three.js parent is
available. That mode is deliberately labelled in the panel and snapshot so
DOM controls are not mistaken for a WebGL scene. If WebGL or the module cannot
start, the inline runtime error state leaves the static local feature directory
readable. Neither fallback path contacts a provider, writes a URL, persists a
draft, moves an asset, or executes imported content.

### JSON snapshot rehearsal

The **Load JSON snapshot** control opens a second, shareable local console. Its
textarea accepts only a small JSON fixture containing the six known mapping IDs
(or their legacy IDs), for example:

```json
{
  "source": "block-migration-snapshot",
  "schemaVersion": 1,
  "entries": [
    { "id": "migration:world-scene-layout" },
    { "id": "migration:world-games" }
  ]
}
```

The console reports parse/unknown/duplicate/executable-looking-field errors
before Apply is enabled, shows mapped versus deferred rows, and can replay or
reset the in-memory draft. Applying a valid snapshot hands the viewer back to
Block World with the selected local edits visible. Snapshot input is data-only:
it is not an arbitrary file path, package import, script, command, or network
request. The **Block World Snapshot** console also offers an explicit
`block-world-snapshot-file` chooser for one user-selected `.json` file. The
browser reads `File.text()` in memory, applies the same bounded validator, and
discards the filename/path; no automatic directory access, upload, package
import, or imported-code execution is involved.

### Block World snapshots

The **Block World Snapshot** surface is the complementary path for migrating
the actual cube world, rather than only the six named legacy concepts. Open it
from Block World or Migration Bridge to **Export JSON**, paste a previously
exported snapshot, **Load JSON**, inspect the block and nested-item counts,
**Preview**, and **Apply local draft**. The exported envelope keeps dimensions,
coordinates, known block types, open/closed container state, and nested content
metadata while dropping renderer-only mesh state and unknown executable fields.

Snapshot validation is bounded and deterministic: malformed JSON, duplicate or
out-of-bounds coordinates, unknown block types, accessor-backed values, cyclic
objects, executable-looking fields, and oversized payloads are rejected before
an apply can occur. **Replay** repeats the local draft operation and **Reset**
returns the panel to the current projection. Download is an explicit browser
JSON export. **Import local JSON** is the complementary user gesture: it
accepts only one bounded `.json` or `application/json` file, reads text in
memory, and then runs the same validator; the resulting state records only
bounded byte/mime metadata and never retains a filename or filesystem path.
There is no automatic upload or arbitrary path reader. A successful apply
creates only a new renderer-only in-memory draft and leaves the canonical
SIMFABRIC projection unchanged.

### Browser round-trip evidence (Packet 151)

The complete old-project JSON round trip was exercised from the shareable
Migration Bridge route:

`http://[::1]:8080/?build=packet151&fresh=20260828&feature=migration&packet=151&journey=block-migration-round-trip`

The audit pasted a four-row legacy fixture through **Load JSON**, ran
**Preview**, and then used **Apply local draft**. Three known mappings were
applied at the manifest-owned coordinates `[4,0,4]`, `[2,0,4]`, and `[6,0,4]`;
the `external-project-sync` row remained deferred. The canonical 102-cube
coordinate set survived intact. The imported crystal at `[2,0,4]` was selected
and inspected, replaced with a wood cube, and moved one local step up to
`[2,1,4]` through the visible Block World toolbar.

Two explicit **Export JSON** actions returned an identical deterministic
22,337-byte payload. Invalid JSON, an unknown snapshot schema, and an unknown
migration identifier were rejected before any draft change, and the rejection
checks confirmed both the renderer draft and canonical projection were
unchanged. The fresh render contained 148 visible meshes, every one
`BoxGeometry`, with no round geometry.

The receipt saw no provider requests, no new external requests after the 11
Three.js CDN module imports, and no fetch/XHR/WebSocket/EventSource,
IndexedDB, or Storage calls. All result flags stayed local/simulation-only;
there is no file read, imported-code execution, provider sync, persistence,
wallet, transfer, custody, signing, settlement, or external write path.

Evidence is saved in `work/audit-block-migration-151.mjs`,
`work/audit-block-migration-151.json`, and
`work/audit-block-migration-151.png`.

The bridge never reads a legacy file, imports a package, evaluates imported
code, writes to disk, persists state, contacts a provider, moves an asset, or
changes the canonical projection. A future real import would need an
explicitly authorized adapter, format contract, consent/identity boundary, and
separate persistence and review gates.

### Optional Merge 4 local runtime handoff

The Block World toolbar also exposes **Local runtime sync** for the optional
`runtime/merge4` service. It is an explicit loopback-only bridge: enter a local
endpoint (normally `http://localhost:8091`) and world id, press **Connect** to
check `/api/health`, then choose **Load remote** or **Save draft**. A load
validates the returned `blockWorldSnapshot` before applying a renderer-only
draft. A save sends only that validated snapshot inside the runtime's required
data-only arrays and includes the server's `expectedVersion`.

The Merge 4 service uses optimistic versions. A stale save returns a visible
`VERSION CONFLICT` and disables another save until the user loads the newer
version; the local draft is not overwritten. If the local WebSocket is
available, `WORLD_UPDATED` is shown as `REMOTE UPDATE · LOAD TO REVIEW`; it is
never auto-applied. Disconnect, closing the panel, reload, and save errors keep
the cube draft intact. The runtime bridge accepts loopback or same-origin URLs
only, adds no hidden polling, and has no public deployment, identity, wallet,
token issuance, custody, signing, settlement, imported-code, or external
execution authority. The console also shows a readonly/selectable local route
and a user-triggered **Copy local sync route** action. It emits only
`?panel=runtime-sync&world=<bounded-id>`; endpoint, credentials, arbitrary
origins, and unrelated query state are never copied. Clipboard success and
manual fallback are both visible as `LOCAL ONLY`, and reopening the copied
route restores the bounded world id while remaining offline until Connect is
pressed. The memory runtime is an in-memory local rehearsal; a
PostgreSQL deployment would require a separate security and deployment review.
