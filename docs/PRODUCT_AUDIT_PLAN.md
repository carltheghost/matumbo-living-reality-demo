# maTumbo product audit and sequential build plan

## Current ecosystem migration frontier — 2026-09-04

The 2026-09-04 migration snapshot records Financial Academy as the 23rd openable local feature. It is projected into SIMFABRIC, reachable as a
Block World cube, and provides four retryable knowledge checks with bounded
page-session progress. Connected City is the next migration target.

This document keeps the full maTumbo brief visible while distinguishing a
verified local social-experiment / space-explorer demo from capabilities that
would need a separate identity, security, legal, provider, persistence, or
deployment system.

## Product north star

The demo is one navigable Living Reality. The focused world is made of
semantic cubes that can be selected, opened, inspected, moved, carried, and
placed. The wider Reality Lens projection remains available as a separate
semantic view for people, rooms, proof, agents, contracts, TUMBO allocation,
and evidence. The same frozen local projection feeds every route; a rendered
object is never treated as an external authority.

The launcher starts the cube-first route so the first impression is an
interactive world rather than a static organ constellation. The latest
verified cube-first journey is:

`http://[::1]:8080/?build=control4&fresh=20260828&panel=block-world&journey=integrated-block-world-166`

The public-world projection is a separate explicit route. The latest verified
all-source status journey is:

`http://[::1]:8080/?build=control4&fresh=20260828&panel=live-status&live=all&journey=real-data-175`

World Pulse reads only documented public sources after the user asks it to
refresh. Returned headlines/events become selectable cube evidence with source
links, observed/event-time separation, uncertainty, and provider-reported
coordinates when available. Title-language signals are shown as color/glow/lift
and as a nested inspection cube; they are not severity or casualty scores. A
timeout or unavailable feed stays unavailable; there is no mock-data replacement
and no claim of complete global coverage.

Tennis Evidence is the parallel public sports read at
`http://[::1]:8080/?build=control4&fresh=20260828&panel=sports-events`.
It joins public ESPN ATP/WTA scoreboard, ranking, competition, and linescore
responses on explicit refresh. Missing commentary, ranking, or set data stays
unavailable, and the completeness grade is never presented as a performance or
betting signal.

The current frontier is documented in the top of `docs/CURRENT_STATE.md` and
`.tumbo/continuity/NEXT.md`. Packets 166–215 verify the integrated cube journey,
3-D/4-D/5-D semantic depth and linked navigation, the seven-source public
 status batch, the Local Cube Sync route/copy handoff, the coupled gaze-plus-hand
 seam, the fresh real-provider/fail-closed audit, the no-mock boundary audit
across the canonical status and World Pulse routes, the provider-backed
sports-to-contract/pool local draft handoff, and keyboard/pointer feature
  navigation with cube/input reachability, the addressable local
  contract-detail lifecycle route, gaze-locked native-hand carry, and the
  final Contracts/Pools route verification, the Sports empty-state refresh
  action, the pointer-reachable cube-world feature rail, and nested preview
  focus fallback. These are
  localhost browser receipts; they do not promote the demo to a public deployment or an external
authority.

## Verified frontier — packets 166–215

- **Packet 181 — feature navigation and input reachability.** The Launch Kit
  route was exercised by pointer and keyboard; closing the directory returns
  focus to the visible toggle, representative cards open, direct Launch Kit
  route buttons and Mission Control return work, and the Block World
  cube/camera/gesture controls remain reachable. Receipt:
  `work/audit-feature-navigation-181.json` (15/15, 681 requests, zero
  unexpected, zero page errors). This is an accessibility/navigation proof,
  not a universal sensor or WebXR claim.
- **Packet 182 — addressable contract-detail lifecycle route.** A selected
  provider-backed ATP/WTA record now creates a bounded local contract/pool
  detail route with actionable contract/pool links, copy/manual-copy fallback,
  local close tracing, exact source-record back navigation, and same-document
  pushState/popstate restoration. Valid cold and history hydration perform no
  ESPN refresh; malformed or non-allowlisted provenance fails closed. Receipt:
  `work/audit-contract-detail-route-182.json` (25/25, 101 source requests,
  zero unexpected endpoints or page errors). This is a local provenance
  rehearsal, not a live contract, wallet, custody, settlement, or deployment.
- **Packet 183 — red gaze-lock cue and coupled eye + hand target actions.** A
  supported host gaze point now arms a visible short-lived red edge cue on the
  existing cube and the readout explicitly says **EYE LOCK ARMED**. Sanitized
  native-hand point/pinch/open/inspect and XR-hand select remain same-target
  local actions; coordinate-less hand/XR input reuses the fresh lock id despite
  presentation easing, while explicit hand coordinates fail closed on a
  different ray. Absent gaze, expiry, Stop, and presentation close clear the
  cue. Receipt `work/audit-gaze-hand-target-cue-183.json` passed 27/27 (95
  requests: 84 local and 11 pinned CDN, zero unexpected requests/page errors);
  focused suites pass 15/15. This remains a sanitized localhost host seam,
  not universal eye/hand hardware, production WebXR, raw sensor processing, or
  an external authority path.
- **Packet 185 companion — gaze-locked hand Grab → Hold → Place.** The same
  fresh gaze lock gates sanitized native-hand `grab`, a bounded integer
  one-cell `hold`, and `place`/`release` at the held coordinate. Mismatch,
  stale, invalid, duplicate, and no-held actions fail closed. Receipt
  `work/audit-gaze-hand-manipulation-185.json` passed 24/24; focused carry
  suites pass 18/18. This is a local host callback seam, not raw sensor
  processing or a universal hardware claim.
- **Packet 208 — Contracts/Pools route verification.** The final-tree
  recheck passed 25/25: canonical graph and real Sports-to-draft handoff,
  visible VOID DEMO CONTRACT lifecycle, exact history/cold hydration, and
  malformed/unknown fail-closed routes. Source provider reads were the four
  expected ESPN calls; post-handoff/local hydration provider and unexpected
  requests were zero, with zero page/console errors. Receipt:
  `work/audit-contracts-route-verification-208.json`.
- **Packets 209–210 — Contracts/Pools route hardening (verified).** Bounded
  `node=contract|pool` targets remain distinct and unsupported nodes fail
  closed; non-null draft `retrievedAt` values must be valid UTC ISO timestamps.
  The two receipts pass 7/7 and 4/4 respectively, with zero local-validation
  provider/unexpected requests or page/console errors.
- **Packet 211 — final-tree gaze + hand/finger carry recheck.** The explicit
  gesture route was re-run with sanitized host callbacks: a fresh gaze armed a
  real cube, the same target completed `Grab → one-cell Hold (+X) → Release`,
  and mismatch, invalid/no-held, stale, and Stop cases stayed fail-closed.
  Receipt `work/audit-gaze-hand-final-tree-recheck-211.json` passed 24/24 at
  `2026-08-30T12:09:17.115Z`; it observed 84 local page requests and 11 pinned
  CDN imports, with zero unexpected requests, page/console errors, and only
  cube geometry. This is a local host adapter rehearsal, not physical eye/hand
  hardware, raw sensor processing, or production WebXR.
- **Packet 213 — Sports/Tennis empty-state action.** When the public feed is
  empty, an explicit `REFRESH ATP / WTA TO UNLOCK LOCAL CONTRACT / POOL`
  action sits beside the empty state. Receipt
  `work/audit-sports-route-gap-213.json` passed 6/6: no initial provider read,
  explicit ESPN refresh, returned provider rows, and provenance-gated local
  contract/pool handoff with zero page/console errors. No fallback match data
  or executable value path was added.
- **Packet 214 — reachable cube-world feature rail and active directory.** The
  feature blocks mount near the top of the Block World console in a bounded
  scroll viewport; the long inspector scrolls, and selected/hovered/held cubes
  remain addressable beyond the capped directory rows. Receipt
  `work/audit-block-world-feature-navigation-214.json` passed 12/12: 22 unique
  pointer-reachable feature blocks, Sports/Tennis pointer handoff, explicit
  no-data refresh CTA, 102 terrain cubes, three allowlisted ESPN requests,
  zero unexpected requests, and zero page/console errors. This is local
  renderer/public-read reachability, not a production or authority claim.
- **Packet 215 — nested preview content focus fallback.** A reduced-motion
  mobile DOM now exposes a focusable nested preview summary without changing
  the parent selection; activation delegates to existing content navigation.
  Receipt `work/audit-preview-content-focus-215.json` passed 9/9 with focused
  12/12, full 385/385, release 9/9, syntax 3/3, and zero provider/unexpected
  requests or page/console errors. This is renderer/accessibility parity only.

## Brief-to-surface audit

| Requested idea | Current verified surface | Boundary that remains explicit |
| --- | --- | --- |
| Minecraft-like blocks | Block World / Fabric: cube selection, hover/inside preview, open/close, nested inspection, bounded movement, Grab → Hold-step → Place, Add / Replace / Remove, JSON snapshots, and reversible 3-D/4-D/5-D semantic depth | in-memory local draft; optional loopback runtime sync is separately gated and not durable/public |
| Open a block and see inside | Container lids lift and nested fixture items appear in the 3-D layer and inspection console | deterministic fixture contents, not a file or live inventory |
| Move blocks | Directional one-step movement and bounded carry placement | collisions and bounds reject atomically; canonical projection is unchanged |
| Migrate the old project into blocks | Migration Bridge maps six known legacy concepts; Block World Snapshot moves the actual cube grid through validated JSON | no arbitrary file/package import, code execution, or server write |
| Social experiment / re-market | Social Explorer rehearses discover → discuss → create → allocate-preview; Launch Kit packages the local route directory | no social network, market, price, recipient list, or external share |
| TUMBO as an asset token | `TUMBO-SIM` fixed-supply asset-token projection and aggregate launch registry | fictional simulation only; no issuance, wallet, custody, signing, transfer, settlement, or money |
| County / organisation / international allocation | eight aggregate cohort rows reconcile to a fixed 1,000,000,000-unit schedule | rows are fictional classes, not addresses or instructions |
| Contracts, pools, brokers, value flow | Contracts + Pools, PAYCORE, and T402 local consoles with selectable records and replay/reset | no trading, brokerage, payment rail, escrow authority, or settlement |
| Proof, agents, oracle, and matter | Prime Ledger + EchoProof, Neural Mesh, Live Gateway / Evidence, and Picture Matter local projections | advisory/non-authoritative summaries; public rows retain provider provenance but never become provider truth or executable agents |
| World-wide reporting / brutality context | World Pulse: GDELT + NYT World RSS headlines with USGS/NASA geolocated context projected as selectable cubes, plus local ALL / CONTEXT / VIOLENCE / EXPLICIT signal lenses | public-source observations only; title signal is not a verified incident, geography/time may be unavailable, no graphic imagery or response authority |
| Tennis match context | Tennis Evidence: ESPN ATP/WTA scoreboard, rankings, competitions, and provider-returned set scores projected as selectable cubes | public research observation only; no odds, betting, performance, outcome, or persistence authority |
| Camera control | Camera Motion opt-in coarse frame-difference input plus mouse/trackpad orbit fallback; Phone Gestures can use an explicitly supplied host gaze point and native-hand/XR-hand gesture | no recording, recognition, upload, or sensor-driven move/grab/hold/place edits; fresh gaze adds only a red edge cue and same-target select/open/inspect, with explicit coordinate mismatches rejected |
| Phone / PC / VR / AR | local device profiles, reduced-motion metadata, touch/pointer fallback, and capability-aware orientation/gaze/native-hand/XR-hand readout with a red gaze-lock cue | XR remains not-tested/fallback-only; gaze and hand require explicit host hooks and do not imply hardware, parity, or deployment |

## TUMBO-SIM allocation rehearsal

The current local schedule is intentionally aggregate and deterministic. It is
useful for exploring the story and testing reconciliation, not for promising a
real launch distribution.

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
| **Total** | **100%** | **1,000,000,000** |

The browser can inspect and replay this schedule. It must not silently turn a
preview into issuance or distribution. A real asset launch would require an
independently authorised token design, jurisdictional/legal review, recipient
identity and consent policy, wallet/custody model, signing and settlement
infrastructure, monitoring, and an explicit production release decision.

## Migration map

The old concepts are not lost; they are represented by safe local destinations.

| Legacy concept | Local destination | Current state |
| --- | --- | --- |
| `world-scene-layout` | semantic cube grid | mapped |
| `world-games` | ARENA / Game Lab | preserved |
| `world-contracts` | Contracts + Pools | mapped |
| `arena-room` | Rooms + Messaging | mapped |
| `semantic-block-concepts` | Block World / Fabric | preserved |
| `external-project-sync` | none | deferred behind an explicit adapter and authority review |

For an actual cube-world handoff, **Move world JSON** exports the bounded grid,
accepts pasted data-only JSON, validates dimensions/types/coordinates, previews
the result, and applies a renderer-only draft. It never reads a path or runs
imported content.

## Sequential implementation queue

The Control Tower assigns one bounded packet at a time. A packet is not marked
complete until its source contract, connected browser control, focused tests,
full regression, release checks, launch probe, and (where applicable) fresh
browser route evidence agree.

1. **Packets 41–43 — cube interaction foundation (complete).** Cube-only
   focus, open/close, inspect, bounded movement, local edits, JSON snapshot
   migration, and Grab → Hold-step → Place are implemented and verified.
2. **Packet 44 — direct pointer/touch manipulation (complete).** Drag a
   cube through one deterministic bounded local carry transition while keeping
   OrbitControls, camera motion, keyboard access, and button fallback separate.
3. **Packet 45 — asset-token nomenclature (complete).** Visible TUMBO and
   PAYCORE copy and the canonical organ focus now use asset-token language;
   stable `coin-*` wire values and an incoming `coin` focus alias remain
   parser/fixture compatibility aliases.
4. **Packet 46 — cube-world navigation and route handoffs (complete).** Portal
   cubes expose a finite route registry and same-page handoffs into rooms,
   migration, social explorer, launch distribution, asset-token, ARENA, and
   Reality Lens. The frozen navigation draft and visible trace preserve source
   and target while canonical blocks remain unchanged; invalid routes are
   rejected atomically.
5. **Packet 47 — mobile/accessibility interaction audit (complete).** Portal
   routes and cube controls use native buttons with keyboard/touch activation,
   focus-visible states, Escape close, reduced-motion-safe updates, narrow
   touch targets, optional readout mounts, and an explicit no-WebGL
   `static-controls` fallback. Input and motion metadata stay in frozen local
   drafts; no provider, network, persistence, or authority path was added.
6. **Packet 48 — social-experiment / re-market handoff (complete).** The Portal
   destination now exposes a highlighted ordered cursor for discover → discuss
   → create → allocation-preview, rejects skipped actions atomically, and
   provides visible next/reset/replay controls plus a fixed registry preview.
   The final local preview hands off to Launch Distribution; no social account,
   network, price, recipient, wallet, transfer, settlement, or persistence path
   was added.
7. **Packet 49 — portal return handoff (complete).** Every portal destination
   now has a disabled-until-open Return to Cube Field rail with normalized
   source/route metadata, keyboard/touch-safe activation, frozen return and
   replay records, and explicit draft/portal-trace preservation. The handoff
   remains same-page and local; it does not change the URL or add persistence,
   provider, wallet, transfer, settlement, or execution authority.
8. **Packet 50 — direct field double activation (complete).** A short canvas
   activation selects a cube; a same-container mouse double-click or touch
   double-tap within a bounded 420 ms / 28 px window opens or closes it through
   the existing local interaction contract. Dragging, stale/distant/cross-cube
   taps, solid cubes, malformed targets, and cancellation remain inert. The
   bridge has no native `dblclick` listener, so one gesture cannot duplicate an
   open/close event; focused coverage and the full 152/152 suite pass.
9. **Packet 51 — visible container affordance (complete).** Every container
   now has a bright cubic cap while closed; opening lifts the same cap and
   reveals nested cubes. The cap keeps the owning block ID so selection, drag,
   and double activation stay atomic, and the selected-cube rail repeats the
   direct open hint. The field remains box-only and renderer-local.
10. **Packet 52 — cube-first journey and camera gesture boundary (complete).**
   The focused surface now names the ownership boundary directly: cube drag
   means one bounded X/Z move, empty-field drag means camera orbit, and
   wheel/trackpad means camera travel. The optional camera adapter remains a
   coarse local orbit input and never grabs cubes. Fresh Chrome proof opened
   the cube route, opened the camera panel with permission still off, completed
   Portal → Rooms, and returned to the cube field without a URL change, page
   error, or narrow-screen overflow. Destination openers keep the route
   visible in reduced/static hosts.
11. **Next seam — one more fresh cube-first journey audit after any visual
   change.** Recheck Portal → local feature → replay/reset → Return to Cube
   Field, confirming every handoff preserves canonical/draft boundaries and
   that the focused route contains no round semantic layers.
    Packet 53 completed this audit on a fresh Chrome route: Rooms opened in
    place, replay stayed local, Return to Cube Field preserved the URL, Reset
    cleared the draft and traces, and the focused scene exposed only the
    `semantic-block-world` child.
    Packet 54 then closed the migration UX gap: exporting the validated block
    snapshot visibly reports its block count and download/copy readiness, and
    Load/Reset clears stale export state before the next local handoff.
- **Packet 55 — local Launch Kit link handoff (complete).** Launch Kit now
  exposes a readonly cube-first Portal route derived from the current local
  origin/pathname and an explicit **Copy local link** control. The clipboard
  API is called only after that user action; missing or rejected access keeps
  the URL selectable and reports `LINK VISIBLE · COPY MANUALLY` or `LINK
  VISIBLE · COPY UNAVAILABLE`, while success reports `LINK COPIED · LOCAL
  ONLY`. Replay/Reset clear stale copy status. Fresh Chrome proof at
  `http://[::1]:8080/?build=control4&fresh=20260827&feature=block-world&block=portal&panel=launch-kit`
  opened the visible Launch Kit, exercised the explicit copy button and replay
  fallback, held the URL stable, and observed no page errors. Treat this as a
  localhost/relative route only: no `navigator.share`, public deployment,
  network, persistence, wallet, token, transfer, settlement, or executable
  import path exists.
- **Packet 56 — cube-first post-link audit (complete).** Fresh Chrome started at
  the cube-first Portal route, opened and inspected the Portal container and
  its two nested items, entered Rooms + Messaging, replayed the local
  enter/leave flow, returned to the cube field without changing the URL, and
  reset the local cube draft and traces. Focused world visibility contained
  only `semantic-block-world`; a fresh 390×844 pass had equal body scroll and
  client dimensions with no errors or warnings. This remains a renderer-only
  journey with no network, persistence, wallet, transfer, settlement,
  provider, camera-recording, or executable authority.
- **Packet 57 — Block World camera affordance (complete).** The focused cube
  console now exposes a native keyboard/touch-safe **Camera Motion** opener and
  mirrors the existing adapter's off/requesting/active/unsupported/denied/error
  states. Opening the panel is consent-only and never invokes camera permission;
  **Enable camera motion** remains the explicit request. Desktop and 390×844
  Chrome checks confirmed the status mirror, 44px target, no body overflow, and
  no page errors or warnings. Camera input stays coarse/local and separate from
  cube editing, with no face/hand recognition, recording, persistence, network,
  wallet, token, transfer, settlement, provider, or `navigator.share` path.
- **Packet 58 — post-camera cube-first audit (complete).** Fresh Chrome
  selected Portal, opened and inspected its two nested items, entered Rooms +
  Messaging, replayed the local enter/leave flow, returned without changing
  the URL, and reset the cube draft and traces. The Camera Motion opener
  opened the consent panel by keyboard with permission still off until Enable.
  The focused world exposed only `semantic-block-world`; a 390×844 pass had
  equal scroll/client dimensions, no page errors, and no console warnings.
- **Packet 59 — direct Migration Bridge affordance (complete).** The focused
  Block World console now offers a visible **Migration Bridge** button with a
  keyboard/touch-safe 44px target and `aria-controls` pointing at the existing
  migration console. Activation emits a frozen local handoff, selects the
  Migration feature without a URL change, and opens the existing mapping
  surface; closing or applying its local draft returns to the cube field while
  preserving canonical/draft separation. Focused renderer/markup coverage
  passes, and the surface remains data-only: no filesystem import, executable
  code, persistence, network, token, wallet, transfer, provider, or external
  sync authority.
- **Packet 60 — post-migration cube-first journey audit (complete).** Fresh
  desktop and 390×844 Chrome completed Portal selection, Open/Inspect, the
  direct Migration Bridge handoff, Preview (5 safe / 1 deferred), Apply back to
  Block World, Replay/reset, Rooms + Messaging, Return to Cube Field, and the
  camera consent boundary with a stable URL and no page errors or warnings. The
  focused world exposed exactly `semantic-block-world`; the narrow route stayed
  at 390/390 by 844/844 and both new cube-world controls measured 44px. The
  migration preview/apply remains a local renderer-only draft with no import,
  execution, persistence, network, token, wallet, transfer, provider, or
  external-sync authority.
- **Packet 61 — portal cube-substrate handoff (complete).** Portal routes into
   Rooms + Messaging, Social Explorer, and Launch Distribution retain the
   cube field as the visible world substrate while the destination console
   opens on the same page. The camera and HUD readout re-anchor on the
   originating Portal cube after normal feature focus runs, so hidden round
   organs cannot become stale visual context. Return to Cube Field remains
   available and restores the focused Block World surface; this is a
   renderer-only presentation seam with no new network, persistence, provider,
   wallet, token, transfer, settlement, or executable authority.
- **Packet 62 — Social Explorer responsive console (complete).** At narrow
   widths the retained cube-substrate destination scrolls as one intrinsic
   surface, so action and guided-flow sections cannot flex-shrink into
   overlapping rows. Close, toolbar, Launch Kit, catalog, and rehearsal-action
   controls all have 44px minimum touch targets; action/flow copy wraps and
   flow/trace rows retain readable minimum heights. The existing native-button
   renderer and local-only boundary are unchanged; focused Social Explorer
   coverage passes 6/6, full renderer coverage is 160/160, and release
   boundaries remain 9/9. Fresh browser verification is the next Control Tower
   check for the 390×844 route.
- **Packet 63 — expanded portal cube-substrate routes (complete).** The finite
   Portal registry now includes the remaining local destinations: asset-token,
   Migration, ARENA, Contracts + Pools, PAYCORE, T402, Neural Mesh, Picture
   Matter, Prime Ledger + EchoProof, Live Gateway, Phone / PC / XR, and Reality
   Lens, in addition to Rooms, Social Explorer, and Launch Distribution. Portal
   handoffs keep `semantic-block-world` visible, re-anchor camera/HUD state on
   the source cube, open each existing local console (or the asset-token panel),
   guard destination organ focus, and preserve Return to Cube Field. The route
  expansion remains local/replayable with no network, provider, persistence,
  wallet, token, transfer, settlement, or executable authority. Control Tower
  owns the fresh browser replay of each expanded route.
- **Packet 64 — portal return rail stacking (complete).** The Return to Cube
  Field rail is isolated at a higher stacking context than every expanded
  destination console, including narrow-screen overrides. This keeps normal
  pointer/touch/keyboard return activation usable after any Portal handoff;
  the fix remains presentation-only and local.
- **Packet 65 — portal source-readout stability (complete).** While a Portal
  destination is active, animation-loop cube hover no longer calls the HUD
  readout updater, so the originating Portal stays visible as the source
  context. Deliberate cube selection/action callbacks still update the readout;
  the guard is local presentation logic only. Control Tower owns the fresh
  browser replay and click-through check.
- **Packet 66 — cube-first interaction focus (complete).** Block World now
  marks a document-level cube-first presentation mode. The old rounded organ
  selector and Reality Lens rails fade out, the non-destination allocation
  panel leaves the field, and Mission Control closes after a cube handoff while
  OPEN FEATURES / F remains available. The asset panel is allowed only for an
  explicit Portal → TUMBO Asset Token destination. This is a presentation-only
  local seam; all cube interactions and portal/migration/camera boundaries stay
  unchanged. Control Tower owns fresh desktop/mobile proof.
- **Packet 67 — selected-container affordance (complete).** Openable cubes
  now use a larger accent-material box shell, a small non-raycast cube beacon,
  and matching cube-edge selection cues. The selected-container hint changes
  from **CONTAINER READY** with Open/double-activate guidance to **OPEN
  CONTAINER** with nested-cube and Inspect guidance after the local draft opens.
  Cue updates remain reduced-motion safe and preserve stable direct drag,
  double activation, portal, migration, camera, and renderer-only boundaries.
- **Packet 68 — default cube substrate (complete).** Normal feature routes keep
  their existing local consoles and route controls while the cube layer becomes
  the default visual substrate. Round organ meshes are hidden, organ-focus
  callbacks re-anchor to the selected cube, and Reality Lens remains usable as
  a local readout/control surface without moving the camera to hidden geometry.
  Block World and Portal routes retain the stricter cube-first rail-hiding mode.
  Fresh desktop and 390×844 browser probes verified default, Rooms, Person,
  Reality Lens, Asset Token, Contracts, and Portal routes with cube-only
  `BoxGeometry`, usable route panels, Portal → Rooms → Return, and Block World
  Open/Inspect/Move plus navigator toggle journeys; no page errors occurred.
  Camera Motion opened from the cube console and failed closed in headless
  Chrome without storing frames. The route polish hides the allocation panel
  outside Asset Token and keeps Person/Reality Lens readouts cube-anchored.
- **Packet 69 — cube quick-actions rail (complete).** Normal cube-backed
  consoles now expose a compact local Open / Inspect / Move / Grab / Hold /
  Place rail that delegates to the canonical Block World draft rather than
  creating a second state store. The rail is hidden on dedicated Block World
  and Portal focus routes, uses 44px touch-safe native buttons, and emits only
  frozen local simulation receipts. Fresh desktop and 390×844 Chrome checks
  confirmed Rooms Open → Inspect behavior, disabled Place before Grab,
  Contracts visibility, cube-only `BoxGeometry`, and no page errors. The next
  bounded audit should make nested cube contents visibly peek out and verify
  Grab → Hold → Place end to end on desktop and mobile.
- **Packet 70 — container peek/carry presentation (complete).** Opening a
  selected container now spreads its existing nested cube records across a
  deterministic viewer-facing peek rail beyond the shell, while selected and
  held states announce `PEEK ACTIVE · HOLD → PLACE` and `CARRY ACTIVE` in the
  local readout. The pure transform adds no semantic state; the existing
  Block World draft remains the only Grab/Hold/Place path. Fake-Three focused
  coverage and the full suite are green. Fresh desktop Chrome verified a
  `blockWorldPeek` mesh beyond the shell and the Grab → Hold +X → Place
  lifecycle; 390×844 Chrome kept the six-button rail and route console readable
  without overflow or page errors. A fake-stream camera probe reached the
  opt-in active state and stopped cleanly; this is not evidence of permission on
  a physical camera. No external authority is implied.
- **Packet 71 — direct-manipulation affordance (complete).** Selected cube
  readouts now teach `DRAG TO MOVE` and `DOUBLE-ACTIVATE TO OPEN`. A pointer or
  touch drag creates a transient cube-only preview with `PREVIEW ACTIVE ·
  RELEASE TO PLACE`, keeps that preview out of the raycast targets, and clears
  it after the existing atomic local draft placement. Focused coverage plus a
  fresh Chrome canvas pointer down/move/up probe passed without page errors;
  canonical state remains separate from the draft.
- **Packet 72 — launch-distribution cohort inspection (complete).** The Launch
  Distribution Console now renders a selected-cohort detail card for every
  one of the 18 aggregate fictional registry rows, including county/community,
  organization, international public-good, grant, and reserve classes. The
  card exposes coverage, allocation id, percentage, basis points, simulated
  TUMBO-SIM units, status, and the no-transfer boundary; the fixed supply and
  deterministic replay event remain unchanged. Focused, full, release, and
  fresh browser registry/replay/social-handoff checks passed.
- **Packet 73 — migration cube handback (complete).** Each safe Migration
  Bridge mapping now exposes its fixed cube coordinate and a separate
  `SHOW IN CUBE FIELD` button. The handoff selects the existing Block World
  cube and keeps Migration Bridge as the return path; the deferred
  external-project-sync row has no cube target and remains disabled. Focused
  coverage, full/release checks, and a fresh browser migration → mapped cube →
  return journey passed with cube-only geometry.
- **Packet 74 — cube-native allocation map (complete).** The TUMBO-SIM
  distribution explorer's anchor, allocation bodies, and square selection
  cues now use BoxGeometry rather than the legacy round geometry. Selection,
  raycast metadata, launch-state/replay behavior, reduced-motion handling, and
  the aggregate local-only schedule are unchanged. Focused source coverage is
  green; the fresh browser exposure check remains the next Control Tower gate.

## Verified frontier — packets 166–215

The older queue above is retained as historical implementation context. The packet frontier below is historical evidence; current route membership is owned by the authoritative feature registry and current renderer wiring. The cube field remains the visible cube-only substrate.

- **Packet 166 — integrated cube-first journey (verified).** The real Portal
  container can be hovered, opened, inspected, and navigated through existing
  nested content; the parent remains the only movable/grabbable cube. Reversible
  3-D/4-D/5-D semantic depth modes and linked previous/next navigation keep one
  canonical local world. Receipt: `work/audit-block-world-integrated-166.json`.
- **Packets 167–168 — seven-source status and opt-in refresh (verified).** The
  fixed World Pulse → Tennis → Asset Market → Protocol TVL → Multi-Sport →
  Social Pulse → Picture Matter order is finite, provider provenance remains
  visible, and auto-refresh is off until explicitly started. Missing providers
  remain unavailable; no fixture row fills a gap.
- **Packets 169–173 — local handoffs (verified).** Launch Kit exposes the
  live-status route, Local Cube Sync is a first-class `?panel=runtime-sync`
  route, and its copied route is a relative
  `?panel=runtime-sync&world=<bounded-id>` value that reopens offline until an
  explicit local Connect. These are same-origin/loopback handoffs, not public
  share links or durable synchronization.
- **Packet 174 — coupled gaze + hand (verified).** A supported host gaze point
  arms a visible 1,800 ms lock on one existing cube. Sanitized native-hand
  `point`, `pinch`, `open`, and `inspect` samples may address that same cube
  only while the lock is fresh; absent hand coordinates reuse the gaze point.
  Point/pinch/open/inspect remain local select/reveal operations; sensors cannot
  move, grab, hold, place, edit, record, identify, upload, or transmit frames.
  Receipt: `work/audit-gaze-hand-coupling-174.json` (22/22 browser checks).
- **Packet 175 — real-provider status audit (verified).** The canonical
  `panel=live-status&live=all` route was rechecked against the seven mounted
  public adapters. It observed provider/unavailable rows with source URLs,
  freshness, retrieval/observation times, and failure reasons; the hidden legacy
  fixture stayed quarantined, and an aborted CoinGecko request remained an
  explicit unavailable state. Receipt: `work/audit-live-status-real-data-175.json`
  (14/14 browser checks; 133 requests, zero unexpected endpoints, zero page
  errors; one intentional allowlisted abort console line on the failure page).
- **Packet 177 — bounded local JSON file handoff (verified).** Block World
  Snapshot and Migration Snapshot expose one explicit user-selected
  `.json`/`application/json` chooser each. `File.text()` is read in memory and
  passed through the existing validator; bounded byte/MIME metadata is kept,
  while filenames, paths, arbitrary directory access, uploads, package import,
  imported code, persistence, and provider sync stay unavailable. Receipt:
  `work/audit-snapshot-file-import-177.json` (25/25 browser checks; 190
  requests, zero provider/unexpected remote requests, zero page errors).
- **Packet 178 — live-status and World Pulse no-mock audit (verified).** The
  canonical `panel=live-status&live=all` route and direct `panel=world-events`
  route kept the compatibility fixture hidden and rendered only provider rows
  or explicit unavailable states. A controlled CoinGecko abort remained
  `STATE UNAVAILABLE · RECORDS 0` with no replacement row. Receipt:
  `work/audit-live-status-no-mock-178.json` (15/15 browser checks; 114 status
  page requests, 19 allowlisted provider reads, zero unexpected endpoints or
  page errors; direct World Pulse returned four provider sources and twelve
  records).
- **Packet 180 — provider-backed sports → local contract/pool draft (verified).**
  Selected ESPN ATP/WTA records expose a local handoff into a bounded draft
  builder. It carries only public provenance, lets the viewer name/create/
  inspect/clear an in-memory proposed contract and pool, and keeps liquidity
  unconfigured and execution/settlement/custody/persistence false. Zero-record
  sports responses keep the action unavailable. Receipt:
  `work/audit-sports-contract-draft-180.json` (10/10 browser checks; 99
  requests, zero unexpected endpoints, zero page errors; full suite 358/358).
- **Packet 181 — feature navigation and input reachability (verified).** The
  Launch Kit directory, direct route buttons, Mission Control return, Phone
  Gestures entry, and representative cube/camera controls were exercised from
  fresh mounts. Closing the shell returns focus to the visible toggle and the
  closed shell remains inert. Receipt:
  `work/audit-feature-navigation-181.json` (15/15 browser checks; 681
  requests, zero unexpected endpoints, zero page errors; cube-only geometry).
- **Packet 182 — addressable local contract-detail lifecycle route (verified).**
  A real ESPN ATP/WTA record can create, inspect, close, copy, clear, and
  return from a local contract/pool detail route. Its versioned payload is
  bounded, self-consistent, and allowlist-checked; valid cold, link, and
  history hydration make zero provider requests, while malformed provenance
  fails closed. Receipt: `work/audit-contract-detail-route-182.json` (25/25
  browser checks; 101 source requests, zero unexpected endpoints or page
  errors; full suite 366/366, release 9/9).
- **Packet 183 — red gaze-lock cue and coupled eye + hand target actions
  (verified).** A supported host gaze point now outlines the existing cube with
  a short-lived red edge cue and an **EYE LOCK ARMED** readout. Sanitized
  native-hand point/pinch/open/inspect and XR-hand select remain same-target;
  coordinate-less signals reuse the fresh lock id while explicit coordinates
  reject a different ray. Absent gaze, expiry, Stop, and presentation close
  clear the cue. Receipt: `work/audit-gaze-hand-target-cue-183.json` (27/27
  browser checks; 95 requests, zero unexpected endpoints or page errors;
  focused 14/14, full 372/372, release 9/9). This is a localhost host seam,
  not universal eye/hand hardware, raw sensor processing, or production WebXR.
- **Packet 185 companion — gaze-locked hand Grab → Hold → Place.** The same
  fresh gaze lock gates sanitized native-hand `grab`, bounded one-cell `hold`,
  and `place`/`release`; mismatch, stale, invalid, duplicate, and no-held
  actions fail closed. Receipt `work/audit-gaze-hand-manipulation-185.json`
  passed 24/24 with focused carry suites 18/18.
- **Packet 208 — Contracts/Pools route verification.** The final-tree receipt
  passed 25/25 for canonical graph, real Sports-to-draft handoff, VOID DEMO
  CONTRACT, history/cold hydration, and malformed/unknown fail-closed routes.
  The source page made four expected ESPN reads; post-handoff/local hydration
  paths made zero provider or unexpected requests and zero page/console errors.
  Receipt: `work/audit-contracts-route-verification-208.json`.
- **Packets 209–210 — Contracts/Pools route hardening (verified).** Bounded
  contract/pool node targets and UTC draft timestamps are validated and fail
  closed; their focused receipts pass 7/7 and 4/4 with no local-validation
  provider/unexpected requests or runtime errors.
- **Packet 211 — final-tree gaze + hand/finger carry recheck (verified).**
  Receipt `work/audit-gaze-hand-final-tree-recheck-211.json` passed 24/24 at
  `2026-08-30T12:09:17.115Z`: same-target gaze lock, native-hand Grab → one-cell
  Hold → Release, mismatch/invalid/no-held/stale/Stop rejection, zero
  unexpected requests/errors, and cube-only geometry. Local sanitized host
   adapter only; no universal hardware or WebXR claim.
- **Packet 213 — Sports/Tennis empty-state action (verified).** Receipt
  `work/audit-sports-route-gap-213.json` passed 6/6: the empty public feed
  shows an explicit refresh action, the user-triggered ESPN read returns
  provider rows, and an eligible row opens the existing provenance-gated local
  contract/pool rehearsal. No fallback rows, provider authority, or executable
  value path was added.
- **Packet 214 — reachable cube-world feature rail and active directory
  (verified).** Receipt `work/audit-block-world-feature-navigation-214.json`
  passed 12/12: the early bounded rail exposes 22 pointer-reachable feature
  blocks, the long inspector scrolls, active selected/hovered/held cubes stay
  addressable, and Sports/Tennis opens from a cube-world click. The run kept
  102 terrain cubes, observed three allowlisted ESPN requests, zero unexpected
  requests, and zero page/console errors.
- **Packet 215 — nested preview content focus fallback (verified).** A real
  reduced-motion 390x844 DOM exposes a focusable nested preview row with a
  visible content summary; focus leaves the parent selection unchanged and
  activation selects existing content. Receipt
  `work/audit-preview-content-focus-215.json` passed 9/9 with focused 12/12,
  full 385/385, release 9/9, syntax 3/3, and zero provider/unexpected/page/
  console errors. This remains local renderer/accessibility parity.

All frontier evidence is localhost/browser evidence. It does not establish a
public deployment, global truth or emergency response, durable cross-device
state, production XR, universal eye tracking, wallet/custody, token issuance,
signing, transfer, settlement, or external execution.
12. **Later, separately gated — real-time sharing or persistence.** This needs
   identity, consent, threat modeling, conflict resolution, storage, and an
   explicit deployment owner. It cannot be smuggled into the static demo.
13. **Later, separately gated — real TUMBO distribution.** This needs all of the
   issuer, recipient, wallet, custody, signing, settlement, legal, monitoring,
   and production gates above. Until then the local allocation remains
   `TUMBO-SIM` and aggregate.
14. **Later, separately gated — WebXR / AR.** A label or selector is not an XR
   implementation. Require an actual session, input behavior, shared-state
   parity trace, mobile performance evidence, and an accessible fallback.

## Current release path

- Static demo: `http://localhost:8080/`
- Interactive cube route: `?panel=block-world&journey=integrated-block-world-166`
  (Portal routes first)
- Cube snapshot console: `?panel=block-snapshot`
- Camera consent/input console: `?panel=camera`; coupled Phone Gestures:
  `?panel=gesture&journey=gaze-hand-target-cue-183` (prior coupling receipt:
  `gaze-hand-coupling-174`)
- Local Cube Sync route/copy handoff: `?panel=runtime-sync&world=<bounded-id>`
- Seven-source public status route:
  `?panel=live-status&live=all&journey=real-data-175`
- Addressable local contract-detail route (create from Tennis Evidence):
  `?panel=contracts&contract=<bounded-id>&draft=<bounded-json>`
- Optional in-memory rehearsal API: `http://localhost:8091/api/health`
- Full 22-route local directory: `?panel=launch-kit`

Every route is local and replayable. The release gate must continue to reject
wallet, custody, signing, settlement, external transfer, provider, persistence,
arbitrary import, and executable-code paths.
