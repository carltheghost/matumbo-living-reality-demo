maTumbo Living Reality Ω — Semantic Cube World + Local Feature Lab

RUN
1. Double-click run_local.bat on Windows, or run
   powershell -ExecutionPolicy Bypass -File .\scripts\launch-demo.ps1 -OpenBrowser.
2. The launcher verifies the static page at http://localhost:8080/ and opens the
   current cache-busted interactive Block World surface at
   http://localhost:8080/?build=control4&fresh=20260903-reality-lens&feature=block-world&block=portal.
   The general control surface remains available at
   http://localhost:8080/?build=control4&fresh=20260903-reality-lens. It records
   launcher-owned PIDs under work\demo-launch\.
3. If runtime\merge4 dependencies are installed, it also starts the explicit
   in-memory rehearsal API at http://localhost:8091/api/health. If they are
   absent, the static social-experiment demo remains fully usable and the
   launcher prints the exact npm ci hint.
4. Stop only the processes started by the launcher with
   powershell -ExecutionPolicy Bypass -File .\scripts\stop-demo.ps1.

CONTROL 1 / 15-AGENT RUNTIME
- This exact folder is the canonical source.
- Agent 01 is the only Control Tower.
- Domain roles 04–13 publish deterministic simulation projections.
- SIMFABRIC composes them in src/core/demo-projection.js.
- Agent 03 renders the projection and emits simulation-only intent events.
- Agent 14 provides device/accessibility metadata.
- Agent 15 owns the release boundary tests.

VERIFY
- powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1
- npm test
- python -m http.server 8080

INTERACTION
- A bare localhost visit now lands in the focused cube world so the first
  screen is interactive: select a cube, open it, inspect its contents, move
  it, or grab and place it. Press F (or use Mission Control) to return to the
  full directory of 22 local features, including Asset Market Evidence and the public World Pulse
  evidence route; Reality Lens is the intentional
  semantic-organ view.
- Mission Control opens with all 22 local features visible; select a feature
  to focus it and open its records.
- Launch Distribution exposes one canonical aggregate registry across social,
  county/community, organisation, international-fund, grant, and reserve
  cohorts. Use its **ALL / SOCIAL / COUNTY/COMMUNITY / ORGANISATIONS /
  INTERNATIONAL FUNDS / GRANTS / RESERVES** coverage lens to inspect only the
  matching returned registry rows; the fixed 10,000 BP / 1,000,000,000
  TUMBO-SIM reconciliation stays visible and unchanged. These rows are
  fictional aggregate previews only: lens clicks never call a provider,
  create recipients, connect wallets, or transfer anything.
- Rooms + Messaging has two enterable local portals with Enter / Leave / Replay.
- Social Explorer / Re-market keeps its local social-experiment and
  space-explorer rehearsal, and its optional `live=public` route can read up to
  eight untrusted text/metadata observations from the fixed public Bluesky
  author feed. It never posts, authenticates, resolves identity, loads media,
  or creates a wallet/asset-token transfer path; failures remain unavailable.
- Block World / Fabric is a cube-first Minecraft-like voxel field: select a
  cube, open a container to reveal nested cubes, inspect what is inside, move
  the selected cube one bounded grid step, or use Add / Replace / Remove. All
  actions are renderer-only local drafts.
  Grab cube detaches the selected cube, HOLD steps carry it through the bounded
  grid, and Place cube releases it into an empty cell; collisions are rejected.
  Drag a cube directly in the focused 3-D field for one local X/Z step; a short
  click selects, and a deliberate double-click/double-tap on a container opens
  or closes it. The visible buttons remain the accessible fallback.
  The selected Portal cube at 4,0,4 exposes seventeen same-page routes into the
  local feature surfaces, including World Pulse, Tennis Evidence, and
  Multi-Sport Scoreboards. Use the
  portal-picker button when a solid cube is selected; each route is a frozen
  local handoff and keeps the URL and block projections unchanged.
  Move world JSON opens the actual cube-grid snapshot handoff: Export JSON,
  paste and validate a bounded snapshot, Preview, Apply local draft, Replay,
  or Reset. It is a data-only local rehearsal, not an external world import.
- Migration Bridge maps the earlier Arena / Living Reality concepts to a
  safe local block draft without reading files or executing imported code.
   Load JSON snapshot opens a data-only textarea that validates known mapping
   IDs before handing a local draft to Block World; arbitrary files and code
   are rejected.
   Review Merge 4 snapshot opens the safe in-memory adapter review beside the
   same bridge: mapped metadata and deferred server/message/ledger/proof rows
   are visible, while API writes and PostgreSQL remain disabled.
- ARENA / Game Lab opens three local game rehearsals with legal actions,
  visible state transitions, a bounded event/hash trace, replay, and reset;
  it has no multiplayer, imported runtime, rewards, wallet, token, or value
  authority.
- Contracts + Pools opens the covenant, pool, collateral, position, and risk
  graph with local selection, replay, and reset inspection controls; it cannot
  trade, sign, custody, or settle. Its separate Provider TVL Readout can
  explicitly refresh the fixed public DeFiLlama Aave, Uniswap, Lido, and Maker
  endpoints; live values remain provider evidence and never become the
  fictional pool graph. Open it with
  `?build=control4&feature=contracts&live=protocols`.
- PAYCORE Asset-token Balances opens the fictional TUMBO asset-token balance
  and flow previews with local selection, replay, and reset; the flow never
  becomes a transfer or custody operation.
- T402 Value Routing opens the offer → route → simulated hold sequence plus an
  explicit live-movement denial; replay and reset remain local and non-executable.
- Neural Mesh / Agents opens the advisory Control Tower → Oracle graph, intent →
  proposal thread, and declared ancestry links with local replay/reset only.
- Picture Matter opens the word → statement → provenance chain with uncertainty
  and truth-boundary metadata. Its optional **Public image metadata** rail can
  explicitly read Wikimedia Commons JSON for a bounded query such as
  `?build=control4&panel=picture-matter&pictureQuery=war%20conflict%20humanitarian&live=metadata`;
  it shows canonical source and optional thumbnail references as text only,
  never downloads or renders image bytes, publishes, or verifies truth.
- Prime Ledger + EchoProof opens the balanced journal and declared proof
  ancestry with local linked replay; it is not an authoritative verifier.
- World Gateway / Evidence hands into World Pulse: refresh the documented
   GDELT, NYT World RSS, USGS, and NASA public endpoints, inspect source URLs, observed/event
   times, coordinates, and uncertainty, and see an explicit partial/unavailable
   state when a provider cannot be reached. Cube color, glow, size, and lift
   project headline conflict/brutality language; opening a marked cube reveals
   nested source/time/place/signal blocks, and a bounded drag moves only the
   in-page projection. The square ALL / CONTEXT / VIOLENCE / EXPLICIT lens
   filters only returned title-language levels and keeps an honest no-match
   state. The Timeline controls order the returned blocks by latest provider
   observation, provider event time (missing times remain visible at the end),
   or title-language signal first. The **Global map cells** control groups only
   provider-mapped records into broad NORTH / EQUATORIAL / SOUTH × WEST /
   CENTRAL / EAST coordinate buckets; click one to filter the same returned
   blocks. Records without coordinates remain MAP N/A, and no country/city is
   inferred. No provider response is treated as verified
   truth, complete coverage, or a reason to trigger a response.
- World Pulse also shows a **Derived signal field** for the current returned
  records: no title signal, conflict-context language, violence language, and
  explicit language, plus provider-mapped versus map-unavailable coverage.
  These bars are counts derived from the response currently on screen—not a
  brutality, severity, casualty, truth, or completeness score—and they never
  create a missing event or location.
- World Pulse includes a separate **Structured humanitarian evidence** rail
  from the documented, credential-free UNHCR Refugee Data Finder API. It shows
  only provider-returned annual population metrics, year, and named
  origin/asylum dimensions when present. Event time and missing geography stay
  unavailable; severity, intensity, casualties, truth, and completeness stay
  unknown. The rail is not joined to headline/event cubes, never infers
  brutality, and remains visibly unavailable with no fallback rows if UNHCR
  fails. Use the same World Pulse route with `humanitarian=110` for the
  verified shareable read.
- Use the visible **Collect / refresh** field in World Pulse to steer the
  public query (maximum 160 characters). It sends only the normalized query
  you explicitly submit to the host's documented public adapters; the query
  stays visible in the returned envelope. Empty or malformed input falls back
  to the default, and an unavailable provider remains unavailable with no
  fabricated rows.
- Share a starting World Pulse query with `worldQuery` in the route, for example
  `?build=control4&panel=world-events&worldQuery=earthquake%20OR%20wildfire`.
  For the brutality-focused view, use
  `?build=control4&panel=world-events&worldQuery=war%20OR%20conflict%20OR%20attack%20OR%20massacre`;
  the VIOLENCE and EXPLICIT lenses still show no-match honestly when the
  returned titles contain no such language.
- Open **source status** from the World Pulse toolbar, or use
  `?build=control4&fresh=20260903-reality-lens&panel=live-status`, to see World Pulse,
  Tennis Evidence, Multi-Sport Scoreboards, Asset Market, and Protocol TVL
  provider state in one read-only rail. Use **Refresh World Pulse**, **Refresh
  Tennis**, **Refresh Multi-Sport Scoreboards**, **Refresh Asset Market**, or
  **Refresh Protocol TVL** in that same rail to request each public source
  explicitly; the button shows
  completion or failure and never replaces a failed provider with mock rows.
  Provider rows show their own availability, freshness, timestamps, source URL,
  and returned count; a failed or unrefreshed provider stays unavailable and
  receives no local replacement row. The public-only view hides the legacy
  mock fixture.
- Tennis Evidence / ATP · WTA reads public ESPN ATP/WTA scoreboard, ranking,
  competition, and provider-returned set-score records on explicit refresh.
  Match source URLs, player/ranking fields, status, set-score and play-by-play
  availability, and a completeness-only data grade remain visible. It never
  reads odds, recommends a bet, fabricates missing matches, or claims outcome
  authority. The selected match also shows same-provider result
  reconciliation (competitor identity, winner flags, set declarations, and
  completion flags) with conflicts and unavailable checks kept explicit. Use
  `/?feature=sports-events`. An **Independent parity source** rail keeps the
  multi-provider gate visible: until a documented browser-safe credential-free
  second source is verified, all parity fields stay unavailable and no second
  request or copied ESPN value is presented.
- Phone / PC / XR opens one device-parity readout over the same canonical world:
  compact phone fallback, expanded pointer presentation, and an explicit
  not-tested XR profile with local replay/reset. No XR session or cross-device
  sync is claimed.
- Launch Distribution shows the complete 18-row fictional TUMBO-SIM registry;
  Social Explorer now runs that path as an ordered local cursor: Discover →
  Discuss → Create → Allocation-preview, with visible Next / Reset / Replay
  controls and an allocation-preview handoff back to Launch Distribution.
- Start the local launch story directly with
  `?build=control4&panel=social-explorer&mode=social-experiment` or
  `?build=control4&panel=social-explorer&mode=space-explorer`. The first opens
  the Social Explorer rehearsal; the second hands into the cube-only Block
  World. Both are opt-in previews only and do not enroll participants or
  publish anything.
- Open **Launch Kit** from either of those consoles for one directory containing
  all 22 routes, including Asset Market Evidence, World Pulse public-source evidence, Tennis Evidence,
  Multi-Sport Scoreboards,
  the token/allocation registry, migration mappings, social
  catalog, device profiles, serialized JSON, and an explicit local
  **Download Launch Kit** export. It also shows a readonly cube-first local
  launch link with an explicit **Copy local link** action; if clipboard access
  is unavailable, select the URL and copy it manually. This is a localhost or
  relative route handoff, not a public deployment or external share. Route
  buttons return to Mission Control.
- Open rehearsal receipt from Launch Distribution to inspect the exact
  18-cohort / 10,000-basis-point reconciliation as serialized local JSON;
  it is a proof-of-demo-math surface, not a claim or transfer receipt.
- Camera Motion is opt-in. It uses only coarse frame-difference motion; frames
  are not stored, recognized, recorded, or sent.
  The direct inspection link `?build=control4&fresh=20260903-reality-lens&panel=camera`
  opens the consent panel without requesting permission until **Enable camera
  motion** is pressed.
- Move/approach an organ: its anatomy wakes and separates.
- Hover the 3D word-objects that grow around it.
- Each word-object is a physical semantic object, not a flat label.
- Hovering a semantic object unfolds smaller information objects from it.
- Drag to orbit. Mouse wheel to move closer/farther.

AUTHORITY BOUNDARY
This remains a local simulation/projection. It is not a real-money rail, wallet, identity provider, cryptographic messaging system, blockchain, live gateway, or settlement service.

MERGE 4 BACKEND DEMO
The separate server-backed package lives under runtime/merge4. With Docker/PostgreSQL unavailable, the verified local demo runs with:

```powershell
cd .\runtime\merge4
$env:MATUMBO_STORAGE="memory"
$env:PORT="8091"
npm start
```

The demo reports `postgres:false` and uses non-durable in-memory storage. The canonical browser remains the root Living Reality page.


## Live launch layer

This repository now includes an optional live API layer for public demos. It provides expiring account sessions, multiplayer rooms with presence/event streaming and optimistic shared-world state, read-only live observations from supported prediction-market providers (Kalshi, Polymarket, and Manifold), and account-scoped app-event export/deletion.

Run locally with `npm run start:live`. The static GitHub Pages experience remains usable without the API. For a public deployment, put the API behind HTTPS, set an explicit `CORS_ORIGIN`, and use durable production storage/secrets rather than the default JSON-file store.

Market data is observational only: no wagering, brokerage, wallet custody, signing, settlement, or real-money transfer is implemented.
