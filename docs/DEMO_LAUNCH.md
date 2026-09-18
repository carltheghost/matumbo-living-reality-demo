# maTumbo demo launch and TUMBO asset-token boundary

This checkout launches a local social-experiment / space-explorer demo. The
browser renders a deterministic **TUMBO Asset Token** projection (`TUMBO-SIM`);
it does not create a chain asset, account, wallet, claim, payment, or transfer.
The launch map is an explorable story about how a future allocation could be
structured, not a promise to distribute anything to real counties,
organisations, funds, or people.

## Run the demo locally

The supported Windows path starts the static browser and, when installed, the
separate in-memory rehearsal API. It never replaces an existing listener:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\launch-demo.ps1 -OpenBrowser
```

The launcher verifies the static page at <http://localhost:8080/> and records
its own process IDs under `work\demo-launch\`. If `runtime\merge4\node_modules`
contains the server dependencies, it also starts the local-only API and probes
<http://localhost:8091/api/health>; the expected response is `postgres:false`
and `storage:"memory-demo"`. If those dependencies are absent, the browser
demo still launches and the launcher prints the install hint. Stop only those
processes with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-demo.ps1
```

For a static-only fallback, serve the files with any HTTP server. For a
minimal PowerShell session:

```powershell
python -m http.server 8080
```

Then open the current cache-busted control surface at
<http://localhost:8080/?build=control4&fresh=20260827> in a modern browser. A
bare visit now starts in the focused cube world so the first screen is an
interactive object field; press **F** to open Mission Control and choose the
explicit Reality Lens semantic-organ view when you want the older zoom
presentation. A small runtime badge
shows the projection, renderer, and feature-directory stages while the page
starts. It changes to **Local surface ready** after the first render loop is
mounted; if WebGL, the vendored module, or another startup step fails, it changes
to **Local 3-D surface unavailable** and provides a reload link while the
static feature names remain readable. The page imports the exact Three.js
0.179.1 closure from `vendor/three-r179.1`, so the core 3-D world no longer
needs a CDN connection. Explicit public-data refreshes still require network
access to their displayed provider endpoints. The static page does not call an API,
wallet connector, token contract, recipient database, or deployment secret.
The optional `runtime/merge4` memory service is a separate local rehearsal
surface and is never a live provider or asset rail.

### Block World interaction

Open <http://localhost:8080/?build=control4&fresh=20260827&feature=block-world>
to work in the cube-only Block World surface. Click a cube in the 3-D field or
the coordinate directory, then use **Open cube** to lift its lid and reveal
nested cubes, **Inspect inside** to read the deterministic contents, or the
directional / **LIFT** / **DROP** controls to move it one bounded grid step.
**Add above**, **Replace**, **Remove**, and **Reset local block draft** remain
available. The expanded preview route (with the default container selected) is
<http://localhost:8080/?build=control4&fresh=20260827&feature=block-world&block=open>.
For a carry-style edit, select a cube, press **Grab cube**, use the **HOLD**
direction buttons to carry it one bounded step at a time, then press **Place
cube**. The carried cube floats above its current cell and the active grid
temporarily shows the detached state; placement rejects occupied cells.
You can also drag a cube directly in the focused 3-D field: a horizontal drag
commits one X step and a vertical drag commits one Z step when you release it.
The gesture is pointer/touch-only, uses the same atomic local Grab → Hold →
Place contract, and leaves the button controls available as an accessible
fallback. A short click still selects without moving the cube. Double-click
(mouse) or double-tap (touch) a container cube to open or close it directly in
the field; the first tap only selects, and solid cubes stay inert.
While this feature is active, the round semantic-organ layers are hidden so
the cubes are the only interactive 3-D objects; leaving the feature restores
the rest of the local projection. These actions are local, deterministic, and
non-persistent.

Portal cubes are also hand-off points. Select a cube whose type is **Portal**;
the **Portal routes · same-world handoff** section exposes Rooms + Messaging,
Migration Bridge, Social Explorer / Re-market, Launch Distribution,
TUMBO Asset Token, Asset Market Evidence, ARENA / Game Lab, Contracts + Pools,
PAYCORE Asset-token Balances, T402 Value Routing, Neural Mesh / Agents,
Picture Matter, Prime Ledger + EchoProof, World Gateway / Evidence,
World Events / Evidence, Tennis Evidence / ATP · WTA, Multi-Sport Scoreboards,
Phone / PC / XR, and Reality Lens Ω. Choosing one opens the existing local
feature surface in the same page while
keeping the originating cube field visible underneath and records the source
cube, route, and `portal` transition in the visible trace. There is no full page
reload, hidden global route state, wallet action, or persistence. Asset Market
Evidence and World Events / Evidence issue only their explicit documented
public GET refresh through the existing host handlers.
Return to **Block World / Fabric** from Mission Control and the route trace
remains available until Reset local block draft.
For a route-first view with the Portal cube already selected, use
<http://localhost:8080/?build=control4&fresh=20260827&feature=block-world&block=portal>.

Choosing **Social Explorer / Re-market** from that Portal opens a guided local
path: **Discover → Discuss → Create → Allocation-preview**. The next step is
highlighted, skipped steps are rejected, and **Reset flow** / **Replay local
social rehearsal** make the sequence repeatable. Completing the fourth step
shows the fixed 18-row `TUMBO-SIM` registry and hands off to Launch Distribution
on the same page. This is a fictional community-reuse rehearsal only: it does
not create a social account, publish externally, show a price, identify a
recipient, or transfer an asset.

Use **Move world JSON** from Block World (or Migration Bridge) to open the
snapshot handoff. **Export JSON** serializes the current cube draft, while
**Load JSON** accepts a pasted data-only envelope for bounded validation and
preview before **Apply local draft** hands it back to the visible cubes. This
is the actual block-world migration path; the separate Migration Snapshot
surface still handles the six named legacy mappings. No file picker, package
import, code execution, network upload, or persistent save is involved.
The snapshot console also has a direct link:
<http://localhost:8080/?build=control4&fresh=20260827&panel=block-snapshot>.

## Runtime readiness and recovery

The page shows a small runtime badge while the canonical projection, WebGL
renderer, and local feature directory are starting. It changes to **Local
surface ready** only after the first render loop is mounted. If WebGL is
unavailable, the pinned module cannot load, or an uncaught runtime error stops
the module, the badge changes to **Local 3-D surface unavailable** and offers a
  reload link. The Mission Control markup includes a static directory of all 22
feature names, so the page remains legible even when Three.js cannot create a
canvas. Try a current browser with WebGL enabled, then reload the local page.

This recovery path is deliberately local UI only. It does not create a wallet,
provider, persisted state, token authority, signing operation, transfer, or
other external execution path.

To verify a running launch without starting anything new:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-demo-launch.ps1
```

The page opens with **Mission Control** visible so the major surfaces are not
hidden behind the organ art. Select any feature button to open its local
records and focus the camera on the nearest visual organ. The **ARENA / Game
Lab** button opens three playable local modes with legal actions, visible state
transitions, a bounded event chain, and replay/reset controls. Press **F** (or the
close button) to hide/show Mission Control, **R** to reset the camera, drag the
empty field to orbit, and use the wheel/trackpad to travel. Dragging a cube is
reserved for its bounded one-step move. **Reality Lens Ω** still provides WORLD →
PEOPLE → DETAIL zoom. The TUMBO allocation rows remain available when Mission
Control is closed; use them to inspect aggregate cohorts, or use **Replay launch
preview** to replay the same deterministic reveal. A URL such as
`/?feature=rooms`, `/?feature=block-world`, `/?feature=migration`, or
`/?feature=arena`, and URLs such as `/?lens=detail&person=profile%3Amira-vale`, only change
presentation focus; it does not mutate canonical state.

Use `/?build=control4&fresh=20260828&panel=camera` to open the cube-first Camera
Motion consent panel directly. Permission is requested only after **Enable
camera motion**; the control uses coarse frame-difference vectors to steer the
local camera and keeps mouse/trackpad orbit available as the fallback. The
camera route hides the legacy round semantic layers so the block field remains
the visible substrate.

Inside **Launch Distribution**, **Open rehearsal receipt** opens the exact
18-cohort reconciliation (10,000 basis points and 1,000,000,000 TUMBO-SIM
units), lets you inspect cohorts, replay/reset the receipt, view its serialized
JSON, and use **Download JSON** for an explicit local browser export. The
download validates the receipt first, then revokes its temporary object URL;
unsupported browser download APIs leave the JSON visible for manual saving. It
is a local proof of the demo's allocation math, not an issuance, claim, wallet,
or distribution receipt, and it never uploads or shares externally.

The complete registry is also a shareable local panel route:
`/?build=control4&fresh=20260828&panel=launch-distribution`. This opens the
18 aggregate fictional registry rows directly and performs no network request.
Add `&live=population` only when the optional World Bank metadata rail is
explicitly wanted; that route performs one bounded context read and never
changes the registry totals.

The **Open Launch Kit** button in Launch Distribution or Social Explorer opens
the complete local handoff in one place: all 22 Mission Control routes, the
fixed fictional token/allocation registry, the six migration mappings, the
social catalog, and Phone/PC/XR presentation profiles. Each route button
returns to the corresponding Mission Control console. **Download Launch Kit**
exports that validated manifest as local JSON only; it cannot launch a service,
create recipients, or issue/distribute an asset.

**Contracts + Pools** is also an openable local graph. It lists the covenant,
pool, collateral, position, and derived risk records from the canonical
projection; selecting a row, replaying the inspection, or resetting the view
only changes the in-memory renderer trace. It never creates a trade or
settlement path.

**PAYCORE Asset-token Balances** opens the two fictional TUMBO asset-token
balance previews and the projected flow between them. Selecting a balance or
flow, replaying the preview, and resetting the view are renderer-only actions;
they never move value or create a wallet.

**T402 Value Routing** opens the four-stage offer → route → simulated hold →
live movement blocked rehearsal. Select any stage to inspect its local record,
then replay or reset the sequence. It never creates custody, signing, release,
transfer, settlement, or a payment rail. A shareable local route is
`/?feature=t402`.

**Neural Mesh / Agents** opens the advisory graph. The Control Tower → Oracle
relationship, declared ancestry, intent, and proposal are selectable records;
replay follows their local links and reset clears the in-memory trace. These
fixtures have no provider, tool, autonomous execution, or identity authority.
Use `/?feature=neural-mesh` to open it directly.

**Picture Matter** opens the word → statement → provenance chain. Select the
local `reality` word-object, its interpretation, or either provenance link to
inspect the joins; replay follows the chain and reset clears the local trace.
Images remain local metadata, statements are not truth determinations, and
external fetching or publishing is denied. Use `/?feature=picture-matter`.

**Prime Ledger + EchoProof** opens the balanced journal record and its declared
proof ancestry. Select either journal or proof node, replay the local path, and
reset the trace. The surface is a renderer summary only: it does not verify
cryptography, sign, settle, publish, or mutate a ledger. Use `/?feature=ledger`.

**World Gateway / Evidence** opens the World Pulse public-source projection.
Refresh requests documented public feeds and keeps each provider's status,
source URL, observed time, missing event time, and uncertainty visible. A
provider failure yields an unavailable/partial state; no fabricated rows or
graphic imagery are inserted. The former Live Gateway fixture remains mounted
only as an internal regression surface and is not the user-facing route. Use
`/?feature=gateway`.

The same World Pulse panel also exposes a separate **Structured humanitarian
evidence** rail backed by the documented, credential-free UNHCR Refugee Data
Finder API. It shows only provider-returned annual population metrics, the
provider year, and named origin/asylum dimensions when UNHCR supplies them.
The rail never turns a population count into a conflict event, brutality,
severity, casualty, or intensity claim: event time, severity, and intensity
remain visibly unavailable/unknown, and missing geography is not inferred.
The four headline/event providers and their title-language signal remain a
separate stream. If the UNHCR request fails or returns no usable row, the rail
stays unavailable and no fallback data is fabricated.

The **Public source status · live refresh snapshots** surface in Live Gateway
mirrors that UNHCR envelope as a nested **Structured humanitarian · UNHCR**
status row beneath World Pulse. It also exposes the existing fixed ESPN
Multi-Sport Scoreboards read (soccer, NBA, and NFL) alongside Tennis, Asset
Market, and Protocol TVL. Every row preserves provider state, freshness,
retrieved time, observed-time availability, record count, source URL, and
failure reason without merging the humanitarian row into the headline /
event-provider totals.

**Tennis Evidence / ATP · WTA** opens a public sports read over the same
cube-first field. Refresh requests the ESPN public ATP/WTA scoreboard and
ranking endpoints, then follows bounded public competition and linescore
references when they are returned. Each match keeps its source URL, observed
time, player/ranking fields, status, set-score availability, play-by-play
availability, and a data-completeness grade. The grade is not a player rating,
prediction, odds signal, betting recommendation, or outcome claim; unavailable
provider fields remain unavailable and no rows are fabricated. Use
`/?feature=sports-events`.

**Multi-Sport Scoreboards** opens a cube-backed public read for the fixed
English Premier League soccer, NBA, and NFL ESPN scoreboards. An explicit
refresh requests those three HTTPS endpoints and displays only returned event,
participant, score, status, time, venue, leader, and source fields. Empty or
failed providers remain unavailable with no replacement rows; field
completeness is not an outcome claim. Selecting, replaying, and resetting an
event are local inspection traces, and the route has no odds, betting, media,
identity, persistence, or value-execution path. Use
`/?build=control4&fresh=20260828&panel=multi-sport-events`.

**Phone / PC / XR** opens the device-parity readout over the same canonical
world. Select the compact phone, expanded PC, or not-tested XR profile to see
the input, motion, viewport, and fallback metadata; replay and reset only touch
the local trace. No XR session, shared-state sync, or parity claim is active. Use
`/?feature=projections`.

## Local intent timeline

The **Intent Trace** button opens a small in-page observability window for the
same renderer intents that drive Mission Control, launch-distribution replay,
Social Explorer rehearsal, Reality Lens changes, camera focus, and optional
camera-motion samples. It keeps at most 12 recent entries in memory. Each row
shows only a type, target, and a shallow primitive metadata summary; nested
objects and address/key/credential-shaped fields are omitted.

Use **Replay visible trace** to redraw the captured rows or **Clear trace** to
remove them. Both actions are local UI operations and do not alter the
canonical projection. Closing the panel or reloading the page clears the
session window. The trace is explicitly labelled **local simulation / no
network** and does not persist, identify, authorize, or execute anything.

## Optional camera motion

Mission Control includes a **Camera Motion** button. Camera access is never
requested on page load: press the button, approve the browser permission, and
the local adapter will use only coarse frame-difference motion to steer the
OrbitControls camera. Empty-field drag orbit and wheel/trackpad travel remain
available at all times; cube drags stay reserved for local one-step moves. The
adapter does not recognize faces, infer identity, record, store, or
send frames; disabling it immediately releases the camera tracks. If the
browser does not support camera access or permission is denied, the panel
reports the fallback and the mouse/trackpad path keeps working.

## Fixed demo allocation schedule

The projection uses 1,000,000,000 integer `TUMBO-SIM` units and 10,000 basis
points. The rows are aggregate fictional classes, never recipient addresses:

| Cohort | Share | Simulated units |
| --- | ---: | ---: |
| Public social-experiment participants | 25% | 250,000,000 |
| County and community cohorts | 20% | 200,000,000 |
| Participating organisations | 15% | 150,000,000 |
| International public-good funds | 15% | 150,000,000 |
| Ecosystem grants | 10% | 100,000,000 |
| Treasury reserve | 10% | 100,000,000 |
| Demo operations | 3% | 30,000,000 |
| Insurance and risk reserve | 2% | 20,000,000 |

The schedule reconciles exactly to both 10,000 basis points and the fixed
1,000,000,000-unit supply. “Distributed at launch” in the UI means only that
these rows become visible in the local scene; no units leave the browser.

## Complete launch registry and replay behavior

Mission Control includes a **Launch Distribution** feature. It opens the full
scrollable registry rather than only the eight class summaries. The registry
is deterministic and contains 18 aggregate fictional rows:

| Registry cohort | Class share | Simulated units |
| --- | ---: | ---: |
| Opt-in social-experiment participants | 10% | 100,000,000 |
| Community builders in the social experiment | 8% | 80,000,000 |
| Space-explorer demo cohorts | 7% | 70,000,000 |
| County/community cohort Alpha | 5% | 50,000,000 |
| County/community cohort Beta | 5% | 50,000,000 |
| County/community cohort Gamma | 5% | 50,000,000 |
| County/community cohort Delta | 5% | 50,000,000 |
| Civic and public-service organisations | 5% | 50,000,000 |
| Education and research organisations | 5% | 50,000,000 |
| Nonprofit and community organisations | 5% | 50,000,000 |
| International public-good funds | 5% | 50,000,000 |
| International humanitarian funds | 5% | 50,000,000 |
| International climate and resilience funds | 5% | 50,000,000 |
| Ecosystem builder grants | 5% | 50,000,000 |
| Ecosystem creator and research grants | 5% | 50,000,000 |
| Treasury reserve | 10% | 100,000,000 |
| Demo operations reserve | 3% | 30,000,000 |
| Insurance and risk reserve | 2% | 20,000,000 |

The **Run local launch preview** button marks the registry event as
`previewed`, reveals the deterministic event id, and checks row totals against
10,000 basis points and 1,000,000,000 units. Replaying the button increments a
local replay counter but uses the same event and rows; it emits only a frozen
`simfabric:intent` for the renderer. It never generates recipient addresses,
wallet records, signatures, settlement instructions, provider calls, or
external transfers.

The console now keeps the selected cohort visible in an inline inspection card
above the scrollable registry. Selecting any row updates that card with the
fictional cohort label, recipient class, coverage, allocation id, percentage,
basis points, simulated `TUMBO-SIM` units, and status. The card also repeats
the aggregate-fictional / local-only boundary so a row selection cannot be
mistaken for a claim or a transfer. `getSnapshot().selectedCohort` exposes the
same frozen readout to the host for local intent tracing; it does not create a
second schedule or mutate the canonical projection.

The registry table has a **Coverage** lens rail for quicker inspection of the
same rows: **ALL**, **SOCIAL**, **COUNTY/COMMUNITY**, **ORGANISATIONS**,
**INTERNATIONAL FUNDS**, **GRANTS**, and **RESERVES**. The lens matches the
canonical `recipientClass` on each existing registry row; it does not infer a
new recipient or build a second allocation. The rail reports the visible row,
basis-point, and unit subtotals while the fixed 18-row, 10,000-basis-point,
1,000,000,000-unit reconciliation remains unchanged. Changing the lens only
changes which rows are rendered and keeps selection local; replay still reports
the canonical launch totals and remains `TUMBO-SIM` / no-transfer preview data.

The launch console also includes a four-step **Launch story** rail so the
social-experiment path is navigable rather than hidden behind one replay
button: **Prepare** explains the fixed-supply boundary, **Reveal map** lights
the aggregate 3-D cohorts, **Inspect registry** keeps the full 18-row table in
view, and **Social explorer** hands the viewer to the local discovery rooms.
The Back/Next controls and the social handoff all update presentation state
only and emit frozen local intents.

### Optional World Bank population context

The Launch Distribution console has a separate **Public population context ·
optional read** rail. It is not part of the registry and never derives a
recipient count or allocation percentage. Press **Refresh World Bank** (or use
the explicit route below) to request one bounded HTTPS read from the official
World Bank v2 Indicators API for `SP.POP.TOTL`. The fixed request covers six
representative context lenses (`USA`, `KEN`, `IND`, `BRA`, `NGA`, and `DEU`)
and the 2022–2024 year window, with a maximum of 18 observations. Provider
country names, years, values, source, retrieval time, and unavailable
contexts remain visible as metadata only; no geocoding, identity resolution,
eligibility, population weighting, or community membership is inferred.

The shareable opt-in route is:

`http://localhost:8080/?build=control4&fresh=20260828&panel=launch-distribution&live=population`

Ordinary Launch Distribution routes do not call the provider. The URL above
performs one explicit host-owned request; the DOM adapter itself has no
network client. If the provider fails, returns malformed data, or omits a
context, the rail reports `UNAVAILABLE` or `PARTIAL` and shows no replacement
rows. The fixed 18-row, 10,000-basis-point, 1,000,000,000-unit `TUMBO-SIM`
schedule remains unchanged. The read is public research context, not a
distribution plan, issuance, wallet, transfer, custody, signing, settlement,
price, or money claim.

## Social Explorer / Re-market rehearsal

Mission Control also includes **Social Explorer / Re-market**. Open it to
browse four fictional rooms, six creator/community cards, and six discovery
signals. The rooms make the intended local flow visible:

`discover → discuss → create → allocate-preview`

The phrase “re-market” here means only a rehearsal of discovery and community
reuse. It is not a market, listing, exchange, trading pair, price, return
promise, buy/sell action, or investment product. The final
`allocate-preview` step links back to the same fixed launch-registry story; it
does not create a second schedule or move units.

The **Re-market rehearsal actions** rail makes all four verbs clickable:
**Discover a community story**, **Discuss the shared question**, **Create a
remix preview**, and **Preview community reuse**. Each button updates the
local status and trace; the last action opens the existing launch console at
the registry step so the two stories visibly share one allocation projection.

Use **Replay local social rehearsal** to run the four-step trace again. The
console reports `REPLAYED · LOCAL REHEARSAL` and marks each step with the local
replay count. Every action emits a frozen simulation intent in memory only.

The same console now has a separate **launch plan** for choosing how this
demo is entered. **Social experiment** emphasizes discovery, discussion,
creation, and community reuse; **Space explorer** emphasizes rooms, nested
cubes, and the block-world route. Both modes are opt-in previews only: the
page reports `OPT-IN-NOT-RECORDED`, never enrolls a person, and never creates a
social account. The ordered local phases are **Opt in → Explore → Create →
Allocation-preview**. The last phase points back to the canonical TUMBO
asset-token registry and always reports `PREVIEW-ONLY · NO TRANSFER`; it does
not copy the registry rows or invent another percentage schedule.

Shareable local examples are:

`http://localhost:8080/?build=control4&fresh=20260827&panel=social-explorer&mode=social-experiment`

`http://localhost:8080/?build=control4&fresh=20260827&panel=social-explorer&mode=space-explorer`

Those two default examples are deliberately local and make no provider calls.
For an explicit public-read observation, add `&live=public` to the social-
experiment route:

`http://localhost:8080/?build=control4&fresh=20260828&panel=social-explorer&mode=social-experiment&live=public`

That opt-in route makes one bounded request to the public Bluesky AppView for
the allowlisted `@atproto.com` author feed and renders up to eight text and
metadata observations. It does not post, authenticate, load media, identify a
viewer, persist a feed, or turn observations into social membership, allocation,
wallet, transfer, settlement, or money. If the provider is unavailable, the
rail says so instead of inserting fixtures or fallback rows.

## Rooms + Messaging / enterable space layer

Mission Control's **Rooms + Messaging** feature opens a separate local space
surface over the two membership-scoped rooms in the canonical `spatial-rooms`
contribution: **Living Reality Chamber** (owner role) and **Market
Observatory** (observer role). Each room is rendered as a small low-poly
portal in the 3-D scene, and the console exposes:

- room selection from the same projection that drives the portals;
- explicit **Enter selected room** and **Leave room** actions;
- a local enter/leave trace and a **Replay local enter / leave** rehearsal;
- metadata-only messaging status (the demo never displays message content).

Selecting a portal on the canvas or selecting a row in the console focuses the
camera. Entering changes only the renderer's in-memory state and emits a frozen
local intent; it does not grant membership, send a message, persist state, or
contact a provider. The room map is intentionally bounded for compact/mobile
viewports and remains a presentation layer over the canonical projection.

## Migration Bridge / old project → blocks

Mission Control's **Migration Bridge** keeps the earlier Arena / Living Reality
concepts visible instead of leaving them in an archive. Its fixed six-row
manifest maps scene layout, game-room motion, contracts, rooms, and semantic
block concepts to current local destinations; external project sync is shown as
explicitly deferred. **Preview mappings** rebuilds the deterministic map, and
**Apply local draft** validates and applies the five safe rows to the visible
Block World / Fabric draft, including a trace entry for each destination
coordinate, before handing the viewer back to the voxel surface.

The **Load JSON snapshot** button opens a shareable local textarea for a
data-only fixture of known mapping IDs. It validates malformed, unknown,
duplicate, and executable-looking fields before Apply is enabled, then hands
valid mappings back to Block World as an in-memory draft. Replay and Reset are
local controls; no file path, package, script, command, network request, or
persistent migration is performed.

The **Review Merge 4 snapshot** control on the same bridge opens the staged
in-memory adapter fixture. It maps safe fabric/room/event/message/proof and
balanced-journal metadata into a frozen local envelope and lists deferred
server-only records. It never calls the Merge 4 API, writes PostgreSQL, opens
ciphertext, or hands Merge 4 records to the Block World apply path.

This is not a file importer. The bridge never reads a legacy path or package,
executes imported code, writes a migrated project, persists a draft, contacts a
provider, or changes the canonical projection. A real import would need a
separately authorized format adapter, consent/identity boundary, persistence
review, and rollback plan.

## What a real launch would still require

An actual public asset launch is a separate project and must not be inferred
from this demo. Before any live issuance or public distribution, the team
would need, at minimum:

1. jurisdiction-specific legal and tax review of the asset, its promotion,
   recipient program, and any consideration or expectation of profit;
2. a documented issuer, contract, upgrade, treasury, reserve, and key-control
   model with independent security review and an incident/recovery plan;
3. provider and infrastructure decisions for chain, custody, signing,
   monitoring, sanctions/eligibility, privacy, and data retention;
4. a real recipient registry and consent process, with country/county and
   organisation-level eligibility, privacy, and dispute handling; and
5. a staged testnet/rehearsal, approval record, rollback plan, and fresh
   production verification before any public announcement.

Until those gates are separately approved and implemented, keep the demo in
simulation mode. Do not add a wallet button, buy/sell language, token price,
claim link, recipient address, exchange listing, or “guaranteed distribution”
copy to this surface.
