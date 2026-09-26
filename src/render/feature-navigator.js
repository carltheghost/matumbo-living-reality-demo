/**
 * Mission Control for the local Living Reality projection.
 *
 * This is deliberately a DOM adapter, not a second source of truth. It
 * indexes the canonical SIMFABRIC contribution envelope and gives the viewer
 * an explicit way to open each feature that is present in the demo. A feature
 * can describe a future capability, but this surface never grants one.
 */

export const FEATURE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "reality-lens",
    label: "Reality Lens Ω",
    kicker: "semantic zoom",
    focusOrganId: "logo",
    sources: [],
    description: "Navigate reference-built architectural cubes, expose interiors, enter existing features, move their local layout and inspect observed view history or proposed branches.",
    boundary: "One feature identity across views. 4D is space plus recorded local layout history; proposed branches are not predictions, shared worlds or financial execution.",
  }),
  Object.freeze({
    id: "person",
    label: "Person Ω",
    kicker: "your personal space",
    focusOrganId: "logo",
    sources: ["person-profile"],
    description: "Enter your reference-built 3D personal room: approve a persistent avatar, change its wardrobe, adjust the atmosphere, test the rig and choose a companion form.",
    boundary: "Stylized local avatar and browser storage only. No account verification, biometric enrollment, cloud synchronization or connected AI is implied.",
  }),
  Object.freeze({
    id: "rooms",
    label: "Rooms + Messaging",
    kicker: "space + cipher",
    focusOrganId: "matchbox",
    sources: ["spatial-rooms", "cipher-messaging"],
    description: "Open the room map, membership scope, and metadata-only message session indicators.",
    boundary: "Room membership and cipher indicators are simulated metadata; message content and cryptography are not implemented here.",
  }),
  Object.freeze({
    id: "block-world",
    label: "Block World / Fabric",
    kicker: "voxel space",
    focusOrganId: "arena",
    sources: ["semantic-block-fabric"],
    description: "Enter a cube-first Minecraft-like semantic block world, open nested containers, inspect what is inside, move selected cubes, grab and carry a cube into an empty cell, and move the grid through a data-only JSON snapshot.",
    boundary: "Blocks and snapshots are fictional local projections. Draft edits do not persist, sync, mint assets, publish content, or become executable instructions.",
  }),
  Object.freeze({
    id: "runtime-sync",
    label: "Local Cube Sync",
    kicker: "Merge 4 runtime",
    focusOrganId: "arena",
    sources: [],
    description: "Open the explicit loopback bridge for the cube draft: connect to the local Merge 4 runtime, load a validated snapshot, save with an optimistic version, and review remote updates without overwriting local work.",
    boundary: "This route is a local data-only handoff. Connect, Load, Save, and WebSocket review are explicit; no public deployment, wallet, token, identity, imported code, or external authority is available.",
  }),
  Object.freeze({
    id: "migration",
    label: "Migration Bridge",
    kicker: "old project → blocks",
    focusOrganId: "arena",
    sources: ["block-migration-bridge"],
    description: "Open the fixed Arena / Living Reality manifest, preview safe mappings, and apply them to a renderer-only local draft.",
    boundary: "The bridge never reads legacy files or executes imported code. Mappings are fictional, local, and non-persistent.",
  }),
  Object.freeze({
    id: "asset-token",
    label: "TUMBO Asset Token",
    kicker: "fixed allocation",
    focusOrganId: "asset-token",
    sources: ["tumbo-asset-token"],
    description: "Inspect the fixed 1,000,000,000 TUMBO-SIM schedule and its eight aggregate allocation cohorts.",
    boundary: "This is a fictional social-experiment projection. No wallet, issuance, custody, transfer, settlement, or money exists.",
  }),
  Object.freeze({
    id: "asset-market",
    label: "Asset Market Evidence",
    kicker: "public market read",
    focusOrganId: "market",
    sources: [],
    description: "Read a bounded public market snapshot for comparison assets while keeping TUMBO-SIM explicitly unlisted and unpriced.",
    boundary: "Market rows are unverified public observations. There is no TUMBO listing, quote, trading, wallet, custody, settlement, or financial authority.",
  }),
  Object.freeze({
    id: "launch-distribution",
    label: "Launch Distribution",
    kicker: "social experiment",
    focusOrganId: "asset-token",
    sources: ["tumbo-distribution-registry"],
    description: "Open the complete deterministic registry and rehearse the fixed TUMBO-SIM launch across every fictional county, organisation, fund, grant, and reserve cohort.",
    boundary: "Rows are aggregate fictional cohorts only; the console cannot create recipients, transfer tokens, connect a wallet, sign, settle, or represent money.",
  }),
  Object.freeze({
    id: "social-explorer",
    label: "Social Explorer / Re-market",
    kicker: "discover → reuse",
    focusOrganId: "market",
    sources: ["social-explorer-rehearsal"],
    description: "Browse fictional rooms, creator/community cards, discovery signals, and the frozen local rehearsal that links discovery to community reuse.",
    boundary: "Re-market is a local discovery rehearsal only; there is no network, provider, recipient, price, market, wallet, transfer, settlement, or money authority.",
  }),
  Object.freeze({
    id: "social-mirror",
    label: "Social Mirror / Feed Ticker",
    kicker: "feed pass-through",
    focusOrganId: "market",
    sources: [],
    description: "Open the social feed mirror to review its configured official X and YouTube embed slots, Snapchat and Meta placeholders, and local source status.",
    boundary: "Official embeds only: the X timeline widget and YouTube iframe render provider content in their own frames; Snapchat and Meta stay connect placeholders. No credentials, API keys, tokens, or secrets are requested, accepted, or stored. Simulated points only — no money, no wagering, no wallets.",
  }),
  Object.freeze({
    id: "youtube",
    label: "YouTube",
    kicker: "watch · search · explore",
    focusOrganId: "media",
    sources: [],
    description: "Open a YouTube object, search on YouTube, or paste a public video or playlist link to watch it in the Reality Lens surface.",
    boundary: "The embedded player loads only after you submit a link. Playback is provided by YouTube; this feature uses no API key, account credentials, upload, or automatic playback.",
  }),
  Object.freeze({
    id: "paycore",
    label: "PAYCORE Asset-token Balances",
    kicker: "value preview",
    focusOrganId: "asset-token",
    sources: ["tumbo-paycore"],
    description: "See the local participant and simulation-pool asset-token balance previews plus a non-executable flow.",
    boundary: "PAYCORE is projection-only. It cannot sign, custody, move, or settle value.",
  }),
  Object.freeze({
    id: "contracts",
    label: "Contracts + Pools",
    kicker: "covenant rehearsal",
    focusOrganId: "contract",
    sources: ["contracts-markets"],
    description: "Open the covenant, pool, collateral, position, and risk records as one linked scenario.",
    boundary: "Scenarios are fictional and non-binding; execution, custody, trading, and settlement are denied.",
  }),
  Object.freeze({
    id: "contract-atelier",
    label: "Contract Atelier",
    kicker: "create · stake · resolve",
    focusOrganId: "contract",
    sources: ["contract-atelier"],
    description: "Open your own pool, binary, or multi-outcome contract on any topic as the house or a player — then stake rehearsal credits and resolve it with true/false, AND, OR, or IF/ELSE logic.",
    boundary: "Every contract is a fictional local rehearsal. No wallet, chain, custody, settlement, wagering, or real money exists; stakes are rehearsal credits with zero real value.",
  }),
  Object.freeze({
    id: "ledger",
    label: "Prime Ledger + EchoProof",
    kicker: "journal + ancestry",
    focusOrganId: "ledger",
    sources: ["prime-ledger-echoproof"],
    description: "Inspect the balanced rehearsal journal and the declared proof ancestry behind its projection receipt.",
    boundary: "The renderer displays summaries only; it is not an authoritative ledger or cryptographic verifier.",
  }),
  Object.freeze({
    id: "t402",
    label: "T402 Value Routing",
    kicker: "offer → route → hold",
    focusOrganId: "exchange",
    sources: ["t402-value-routing"],
    description: "Walk a fictional offer, route, and escrow rehearsal through a visible local sequence.",
    boundary: "Live value movement, custody, signing, release, and settlement are explicitly denied.",
  }),
  Object.freeze({
    id: "agent",
    label: "Agent",
    kicker: "local agent field",
    focusOrganId: "bots",
    sources: ["skynet-neural-mesh", "muse-agent", "bot-plaza", "luna-companion"],
    description: "Open the local Bot Plaza roster to inspect advisory agents, their visible capabilities, and renderer-only drafts.",
    boundary: "Agents are advisory fixtures. They have no autonomous execution, provider, or tool authority. Bot Plaza contracts are fictional local rehearsals; no wallet, chain, custody, settlement, or wagering is available.",
  }),
  Object.freeze({
    id: "neural-mesh",
    label: "Neural Mesh",
    kicker: "advisory graph",
    focusOrganId: "bots",
    sources: ["skynet-neural-mesh"],
    description: "Open the local advisory mesh to inspect its deterministic graph and proposal-path status.",
    boundary: "The mesh is an advisory renderer projection. It cannot run tools, take autonomous action, or change canonical state.",
  }),
  Object.freeze({
    id: "muse-agent",
    label: "Muse Agent",
    kicker: "design companion",
    focusOrganId: "bots",
    sources: ["muse-agent"],
    description: "Open Muse's local design companion to review visual proposals and their explicit apply controls.",
    boundary: "Design proposals stay local until explicitly applied. No remote model, external image fetch, or automatic world edit is implied.",
  }),
  Object.freeze({
    id: "bot-plaza",
    label: "Bot Plaza",
    kicker: "local agent registry",
    focusOrganId: "bots",
    sources: ["bot-plaza"],
    description: "Open the local agent roster, chat with deterministic built-in bots, and review their renderer-only drafts.",
    boundary: "Bots have only explicitly granted local capabilities. They cannot access the network, wallets, credentials, or canonical world state.",
  }),
  Object.freeze({
    id: "luna-companion",
    label: "Luna Companion",
    kicker: "scripted local guide",
    focusOrganId: "bots",
    sources: ["luna-companion"],
    description: "Open Luna's deterministic local guide to ask what is here or navigate to an existing feature.",
    boundary: "Luna is a scripted local guide. No AI model, conversation service, or network is connected. Luna navigates and explains only and remembers nothing past this page session.",
  }),
  Object.freeze({
    id: "picture-matter",
    label: "Picture Matter",
    kicker: "word → statement",
    focusOrganId: "proof",
    sources: ["picture-matter-statement-forge"],
    description: "See how a local word-object becomes a provenance-linked interpretation in the spatial world.",
    boundary: "Interpretations are not truth determinations; remote image fetch and external publishing are denied.",
  }),
  Object.freeze({
    id: "nft-atelier",
    label: "NFT Atelier",
    kicker: "mint · collect · inspect",
    focusOrganId: "proof",
    sources: ["nft-atelier"],
    description: "Mint fictional collectibles, inspect their simulated provenance, or burn them — a standalone local rehearsal with no wallet or chain.",
    boundary: "Minted pieces are simulated collectibles. No wallet, chain, transfer, sale, custody, royalty, or external publication exists.",
  }),
  
  
  
  Object.freeze({
    id: "wardrobe-atelier",
    label: "Wardrobe Atelier",
    kicker: "dress · equip · express",
    focusOrganId: "person",
    sources: ["wardrobe-atelier"],
    description: "Browse and design fictional outfits, then equip a look — starter looks that map to the Person Studio also dress the 3D person. A standalone local rehearsal with no marketplace.",
    boundary: "Outfits are simulated looks. No marketplace, ownership, purchase, transfer, or external publication exists.",
  }),
  Object.freeze({
    id: "white-paper",
    label: "White Paper",
    kicker: "read · live document",
    focusOrganId: "logo",
    sources: ["white-paper-document"],
    description: "Read the living white paper: vision, the live feature registry, neural mesh, contracts and ledger state — composed from this session's projection, zero WebGL, zero network.",
    boundary: "Read-only local document. No wallet, chain, custody, mainnet, settlement, or real money. Numbers are live from the local projection, never fetched.",
  }),
  Object.freeze({
    id: "gesture-lens",
    label: "Gesture Lens",
    kicker: "steer · hand-proxy rehearsal",
    focusOrganId: "arena",
    sources: ["gesture-lens"],
    description: "Steer the 3D world with hand-proxy gestures: open palm moves the proxy, pinch grabs, pinch-drag moves in 3D, two-hand spread stretches, twist rotates, fist releases. Camera is off by default and never analyzed, recorded, or uploaded.",
    boundary: "Rehearsal controls only. No camera tracking, no recording, no network, no biometric analysis.",
  }),
  Object.freeze({
    id: "gateway",
    label: "World Gateway / Evidence",
    kicker: "public-source boundary",
    focusOrganId: "logo",
    sources: [],
    description: "Open the public World Pulse readout: refresh documented sources, inspect provenance, and keep uncertainty visible.",
    boundary: "Public records are unverified research observations; this route cannot establish truth, completeness, identity, response authority, or live action.",
  }),
  Object.freeze({
    id: "world-events",
    label: "World Events / Evidence",
    kicker: "public-source pulse",
    focusOrganId: "logo",
    sources: [],
    description: "Refresh documented public event sources on demand, inspect source URLs and uncertainty, and keep missing event times visibly unavailable.",
    boundary: "Public records are unverified research observations; no completeness, attribution, live-provider authority, private scraping, or response action is active.",
  }),
  Object.freeze({
    id: "sports-events",
    label: "Tennis Evidence / ATP · WTA",
    kicker: "public sports read",
    focusOrganId: "arena",
    sources: [],
    description: "Refresh public ATP/WTA scoreboard, ranking, competition, and set-score records, then inspect exactly what the provider returned.",
    boundary: "Sports records are unverified research observations. A data-completeness grade is not a player rating, odds signal, betting recommendation, or outcome claim; commentary may be unavailable.",
  }),
  Object.freeze({
    id: "multi-sport-events",
    label: "Multi-Sport Scoreboards",
    kicker: "public sports read",
    focusOrganId: "arena",
    sources: [],
    description: "Refresh fixed public soccer, NBA, and NFL scoreboards, then inspect provider-returned participants, scores, status, time, venue, and source fields.",
    boundary: "Multi-sport rows are unverified public research observations. Completeness is field presence only; no outcome claim, odds, betting, performance, or executable authority is active.",
  }),
  Object.freeze({
    id: "arena",
    label: "ARENA / Game Lab",
    kicker: "playable rehearsal",
    focusOrganId: "arena",
    sources: ["arena-games"],
    description: "Open the local Game Lab: choose Nebula Rally, Chrono Grid, or Orbital Duel, take legal turns, inspect the event chain, and replay the result.",
    boundary: "ARENA is a deterministic local rehearsal. There is no multiplayer, network, imported runtime, reward, wallet, token, persistence, or value authority.",
  }),
  Object.freeze({
    id: "chess",
    label: "Chess",
    kicker: "standard chess",
    focusOrganId: "arena",
    sources: [],
    description: "Open the dedicated chess room with standard recognizable chess pieces, legal move validation, local AI, and a two-player mode.",
    boundary: "Chess is a local browser game. No wager, wallet, token, network multiplayer, or external authority is attached.",
  }),
  Object.freeze({
    id: "web-ai",
    label: "Web + AI",
    kicker: "browse + ask",
    focusOrganId: "arena",
    sources: [],
    description: "Browse the open web, hand one task to ChatGPT, Claude, Gemini, DeepSeek, Kimi and other assistants, or open the local Compute tab to meter cross-provider usage and rehearse the maTumbo reward loop.",
    boundary: "Provider handoffs remain separate tabs and the Compute economy is local simulation. No credentials, API keys, wallet authority, provider billing verification, token issuance, settlement, staking, or burn is performed.",
  }),
  Object.freeze({
    id: "academy",
    label: "Financial Academy",
    kicker: "learn → test → progress",
    focusOrganId: "ledger",
    sources: ["financial-academy"],
    description: "Follow the restored Financial OS learning path through HTTP 402, x402, T402, PAYCORE, evidence, and authority boundaries.",
    boundary: "Lessons, progress, and demo XP are local education state only; there is no credential, financial advice, reward token, persistence, or external authority.",
  }),
  Object.freeze({
    id: "projections",
    label: "Phone / PC / XR",
    kicker: "one canonical view",
    focusOrganId: "arena",
    sources: [],
    description: "Inspect the device presentation metadata and the reduced-motion/mobile fallback used by this preview.",
    boundary: "VR/AR/WebXR support is not established by this local projection; the fallback remains the source of truth.",
  }),
]);

// Future work must be visible in the directory instead of being implied by
// optimistic copy. These are deliberately capability-gated options: showing
// them gives the explorer a forward path without pretending that a provider,
// shared session, or XR host is already connected.
export const FEATURE_FUTURE_OPTIONS = Object.freeze([
  Object.freeze({
    id: "shared-session",
    label: "SHARED SESSION",
    detail: "multi-view state handoff after a real sync service is supplied",
    status: "NOT ENABLED",
    routeId: "runtime-sync",
    routeLabel: "OPEN LOCAL SYNC BOUNDARY",
  }),
  Object.freeze({
    id: "provider-adapters",
    label: "PROVIDER ADAPTERS",
    detail: "secure model APIs, signed usage receipts and server-side price verification",
    status: "OPTIONAL GATE",
    routeId: "web-ai",
    routeLabel: "OPEN COMPUTE BOUNDARY",
  }),
  Object.freeze({
    id: "xr-host",
    label: "XR HOST",
    detail: "real WebXR session and device parity must be verified by the host",
    status: "NOT TESTED",
    routeId: "projections",
    routeLabel: "OPEN DEVICE FALLBACK",
  }),
]);

const FEATURE_BY_ID = new Map(FEATURE_DEFINITIONS.map((feature) => [feature.id, feature]));

// Infinite-handoff graph (2026-09-18): every feature links onward to a few
// related features so one interaction always pushes into the next. Rendered
// as the KEEP GOING strip in the feature detail; every id must resolve.
export const FEATURE_HANDOFF_LINKS = Object.freeze({
  "reality-lens": Object.freeze(["person", "block-world", "projections"]),
  person: Object.freeze(["wardrobe-atelier", "agent", "arena"]),
  rooms: Object.freeze(["social-explorer", "agent", "block-world"]),
  "block-world": Object.freeze(["reality-lens", "projections", "migration"]),
  "runtime-sync": Object.freeze(["block-world", "projections", "gateway"]),
  migration: Object.freeze(["block-world", "runtime-sync", "reality-lens"]),
  "asset-token": Object.freeze(["asset-market", "launch-distribution", "ledger"]),
  "asset-market": Object.freeze(["asset-token", "contracts", "ledger"]),
  "launch-distribution": Object.freeze(["asset-token", "asset-market", "white-paper"]),
  "social-explorer": Object.freeze(["rooms", "agent", "social-mirror"]),
  "social-mirror": Object.freeze(["social-explorer", "youtube", "rooms"]),
  "youtube": Object.freeze(["social-mirror", "picture-matter", "reality-lens"]),
  "web-ai": Object.freeze(["paycore", "t402", "ledger", "gateway"]),
  paycore: Object.freeze(["ledger", "t402", "contracts"]),
  contracts: Object.freeze(["contract-atelier", "paycore", "ledger"]),
  "contract-atelier": Object.freeze(["contracts", "paycore", "academy"]),
  ledger: Object.freeze(["paycore", "t402", "contracts"]),
  t402: Object.freeze(["paycore", "ledger", "gateway"]),
  "agent": Object.freeze(["neural-mesh", "muse-agent", "bot-plaza", "luna-companion"]),
  "neural-mesh": Object.freeze(["agent", "bot-plaza", "gateway"]),
  "muse-agent": Object.freeze(["agent", "person", "picture-matter"]),
  "bot-plaza": Object.freeze(["agent", "neural-mesh", "luna-companion"]),
  "luna-companion": Object.freeze(["agent", "rooms", "arena"]),
  "picture-matter": Object.freeze(["nft-atelier", "white-paper", "reality-lens"]),
  "nft-atelier": Object.freeze(["picture-matter", "agent", "asset-market"]),
  "wardrobe-atelier": Object.freeze(["person", "agent", "arena"]),
  "white-paper": Object.freeze(["projections", "reality-lens", "academy"]),
  "gesture-lens": Object.freeze(["block-world", "person", "agent"]),
  gateway: Object.freeze(["t402", "world-events", "runtime-sync", "web-ai"]),
  "world-events": Object.freeze(["sports-events", "multi-sport-events", "gateway"]),
  "sports-events": Object.freeze(["world-events", "multi-sport-events", "arena"]),
  "multi-sport-events": Object.freeze(["sports-events", "world-events", "arena"]),
  arena: Object.freeze(["chess", "person", "wardrobe-atelier"]),
  chess: Object.freeze(["arena", "person", "academy"]),
  academy: Object.freeze(["arena", "contract-atelier", "white-paper"]),
  projections: Object.freeze(["reality-lens", "block-world", "white-paper"]),
});

// Every feature gets a small, deterministic "surface route".  The route is
// deliberately renderer metadata: it tells the viewer what becomes visible
// after opening a feature, without pretending that a missing domain adapter is
// a live service.  This also gives the two organ-only entries (Reality Lens
// and ARENA) useful records instead of an empty-state card.
export const FEATURE_SURFACE_ROUTES = Object.freeze({
  "reality-lens": Object.freeze([
    Object.freeze(["WORLD FIELD", "whole Living Reality projection"]),
    Object.freeze(["PEOPLE FIELD", "fictional population organisms"]),
    Object.freeze(["IDENTITY DETAIL", "one visual genome at a time"]),
  ]),
  person: Object.freeze([
    Object.freeze(["PERSONAL ROOM", "actual articulated 3D geometry"]),
    Object.freeze(["WARDROBE", "explicit versioned outfit changes"]),
    Object.freeze(["IDENTITY", "approve once, save locally"]),
  ]),
  rooms: Object.freeze([
    Object.freeze(["ROOM MAP", "two projected portals"]),
    Object.freeze(["MEMBERSHIP", "owner + observer roles"]),
    Object.freeze(["MESSAGE SESSION", "metadata-only cipher indicator"]),
  ]),
  "block-world": Object.freeze([
    Object.freeze(["VOXEL FIELD", "deterministic cube grid"]),
    Object.freeze(["OPEN + INSPECT", "reveal nested cube contents"]),
    Object.freeze(["MOVE + SNAPSHOT", "bounded edits and JSON handoff"]),
  ]),
  "runtime-sync": Object.freeze([
    Object.freeze(["LOOPBACK", "connect only to local Merge 4"]),
    Object.freeze(["VERSIONED DRAFT", "load + optimistic save"]),
    Object.freeze(["REMOTE REVIEW", "socket signal never overwrites local work"]),
  ]),
  migration: Object.freeze([
    Object.freeze(["OLD MANIFEST", "Arena + Living Reality concepts"]),
    Object.freeze(["MAP TO BLOCKS", "preview five safe mappings"]),
    Object.freeze(["LOCAL DRAFT", "apply without files or execution"]),
  ]),
  "asset-token": Object.freeze([
    Object.freeze(["FIXED SUPPLY", "1,000,000,000 TUMBO-SIM units"]),
    Object.freeze(["ALLOCATION MAP", "eight aggregate cohorts"]),
    Object.freeze(["LAUNCH BOUNDARY", "preview only · no transfer"]),
  ]),
  "asset-market": Object.freeze([
    Object.freeze(["PUBLIC SNAPSHOT", "bounded CoinGecko peer read"]),
    Object.freeze(["TUMBO-SIM", "unlisted · no price provided"]),
    Object.freeze(["FIELD COMPLETENESS", "provider fields only · research"]),
  ]),
  "launch-distribution": Object.freeze([
    Object.freeze(["PREPARE", "read the fixed-supply boundary"]),
    Object.freeze(["REGISTRY", "18 aggregate fictional rows"]),
    Object.freeze(["SOCIAL HANDOFF", "open the local explorer"]),
  ]),
  "social-explorer": Object.freeze([
    Object.freeze(["DISCOVER", "browse six fictional community cards"]),
    Object.freeze(["RE-MARKET", "four local rehearsal actions"]),
    Object.freeze(["RETURN TO MAP", "allocate-preview reopens registry"]),
  ]),
  "social-mirror": Object.freeze([
    Object.freeze(["FEED", "review configured X and YouTube slots"]),
    Object.freeze(["SOURCES", "inspect each source and its current state"]),
    Object.freeze(["ABOUT", "official embeds only · quiet placeholders by default"]),
  ]),
  paycore: Object.freeze([
    Object.freeze(["ASSET-TOKEN BALANCES", "participant + simulation pool"]),
    Object.freeze(["ASSET-TOKEN FLOW", "one projected preview route"]),
    Object.freeze(["VALUE BOUNDARY", "no custody or settlement"]),
  ]),
  contracts: Object.freeze([
    Object.freeze(["COVENANT", "one fictional contract scenario"]),
    Object.freeze(["POOL", "simulated liquidity + collateral"]),
    Object.freeze(["RISK", "position exposure is a rehearsal"]),
  ]),
  "contract-atelier": Object.freeze([
    Object.freeze(["OPEN CONTRACT", "pool · binary · multi on any topic"]),
    Object.freeze(["CHOOSE POSITION", "house counterparty or yes/no player"]),
    Object.freeze(["RESOLVE", "true/false · AND · OR · IF/ELSE logic"]),
  ]),
  ledger: Object.freeze([
    Object.freeze(["JOURNAL", "balanced local rehearsal record"]),
    Object.freeze(["ANCESTRY", "declared root → receipt"]),
    Object.freeze(["PROOF BOUNDARY", "renderer summary only"]),
  ]),
  t402: Object.freeze([
    Object.freeze(["OFFER", "fictional compute rehearsal"]),
    Object.freeze(["ROUTE", "profile → room projection"]),
    Object.freeze(["HOLD", "simulated escrow state"]),
  ]),
  "agent": Object.freeze([
    Object.freeze(["CONTROL TOWER", "advisory coordination role"]),
    Object.freeze(["ORACLE", "mock evidence relationship"]),
    Object.freeze(["INTENT → PROPOSAL", "no autonomous execution"]),
  ]),
  "youtube": Object.freeze([
    Object.freeze(["SEARCH", "open YouTube search when you choose"]),
    Object.freeze(["PLAYER", "paste a public video or playlist link"]),
    Object.freeze(["EMBED", "official player · no API key · no autoplay"]),
  ]),
  "neural-mesh": Object.freeze([
    Object.freeze(["ADVISORY GRAPH", "inspect the current local mesh"]),
    Object.freeze(["PROPOSAL PATH", "review intent routing without execution"]),
    Object.freeze(["LOCAL ONLY", "no tools or external authority"]),
  ]),
  "muse-agent": Object.freeze([
    Object.freeze(["DESIGN COMPANION", "review local visual proposals"]),
    Object.freeze(["EXPLICIT APPLY", "nothing changes without your action"]),
    Object.freeze(["NO REMOTE MODEL", "local demo behavior only"]),
  ]),
  "bot-plaza": Object.freeze([
    Object.freeze(["ROSTER", "inspect deterministic local agents"]),
    Object.freeze(["CHAT", "try a built-in local bot"]),
    Object.freeze(["DRAFTS", "review before another feature acts"]),
  ]),
  "luna-companion": Object.freeze([
    Object.freeze(["SCRIPTED GUIDE", "ask what is here or what you can do"]),
    Object.freeze(["FEATURE NAVIGATION", "open an existing local feature"]),
    Object.freeze(["NO AI MODEL", "page-session guidance only"]),
  ]),
  "picture-matter": Object.freeze([
    Object.freeze(["WORD OBJECT", "reality fixture"]),
    Object.freeze(["STATEMENT", "provenance-linked interpretation"]),
    Object.freeze(["PUBLISHING", "local only · no remote fetch"]),
  ]),
  "nft-atelier": Object.freeze([
    Object.freeze(["FICTIONAL MINT", "name a piece · deterministic local id"]),
    Object.freeze(["PROVENANCE", "designed → minted → burned trail"]),
    Object.freeze(["NO CHAIN", "no wallet · no transfer · no sale"]),
  ]),
  "wardrobe-atelier": Object.freeze([
    Object.freeze(["BROWSE", "four starter looks · design your own"]),
    Object.freeze(["EQUIP", "wear it · studio looks dress the 3D person"]),
    
  ]),
  "white-paper": Object.freeze([
    Object.freeze(["READ", "vision · live registry · mesh · ledger"]),
    Object.freeze(["LIVE", "composed from this session's projection"]),
    Object.freeze(["READ ONLY", "no wallet · no chain · no network"]),
  ]),
  "gesture-lens": Object.freeze([
    Object.freeze(["GRAB", "pinch · hold to attach a 3D object"]),
    Object.freeze(["MOVE · STRETCH · TWIST", "drag in 3D · spread scales · twist rotates"]),
    Object.freeze(["CAMERA OFF", "optional local preview · never recorded"]),
  ]),
  gateway: Object.freeze([
    Object.freeze(["PUBLIC READ", "refresh documented public endpoints"]),
    Object.freeze(["UNCERTAINTY", "source and event time stay visible"]),
    Object.freeze(["NO AUTHORITY", "research observation only"]),
  ]),
  "world-events": Object.freeze([
    Object.freeze(["PUBLIC SOURCES", "GDELT + NYT + USGS + NASA endpoints"]),
    Object.freeze(["EVENT EVIDENCE", "source URL + observed time"]),
    Object.freeze(["UNAVAILABLE SAFE", "no-data state when offline"]),
  ]),
  "sports-events": Object.freeze([
    Object.freeze(["PUBLIC SCOREBOARD", "ATP + WTA read endpoints"]),
    Object.freeze(["PLAYER + SETS", "ranking and linescore refs when returned"]),
    Object.freeze(["DATA GRADE", "field completeness only · research"]),
  ]),
  "web-ai": Object.freeze([
    Object.freeze(["WEB TAB", "sandboxed frame for framing-friendly sites · new-tab handoff otherwise"]),
    Object.freeze(["AI TAB", "ChatGPT · Claude · Gemini · DeepSeek · Kimi + other handoffs"]),
    Object.freeze(["COMPUTE WALLET", "demo credits · monthly + per-task budget guardrails"]),
    Object.freeze(["MODEL MARKET", "external providers + local/self-hosted adapter lane"]),
    Object.freeze(["AUTO ROUTER", "cost · latency · privacy policy over entered/provider quotes"]),
    Object.freeze(["USAGE RECEIPT", "tokens + verified cost → PAYCORE/T402 reward rehearsal"]),
    Object.freeze(["CONTRIBUTION VAULT", "metadata-only proposal · explicit consent · capped demo reward"]),
    Object.freeze(["ECONOMIC TIMELINE", "local ancestry checksum · explicitly not cryptographic proof"]),
    Object.freeze(["WORLD PROJECTION", "wallet + receipts + contributions become SIMFABRIC entities"]),
    Object.freeze(["TASK NOTE", "your note travels with every handoff · stored locally"]),
    Object.freeze(["OPENING", "nothing external loads until you choose a provider"]),
  ]),
  "multi-sport-events": Object.freeze([
    Object.freeze(["PUBLIC SCOREBOARDS", "soccer · NBA · NFL endpoints"]),
    Object.freeze(["EVENT FIELD", "participants · score · status · venue"]),
    Object.freeze(["DATA GRADE", "field presence only · research"]),
  ]),
  arena: Object.freeze([
    Object.freeze(["GAME LAB", "three deterministic local modes"]),
    Object.freeze(["TURN LOOP", "legal action → visible state change"]),
    Object.freeze(["REPLAY", "event/hash trace · no reward"]),
  ]),
  chess: Object.freeze([
    Object.freeze(["STANDARD PIECES", "recognizable king · queen · rook · bishop · knight · pawn"]),
    Object.freeze(["PLAY", "legal moves · local AI · two-player mode"]),
    Object.freeze(["MOBILE", "compact board and touch controls"]),
  ]),
  academy: Object.freeze([
    Object.freeze(["LEARNING PATH", "four connected Financial OS lessons"]),
    Object.freeze(["KNOWLEDGE CHECK", "retryable local questions"]),
    Object.freeze(["PROGRESS", "page-session demo XP · no credential"]),
  ]),
  projections: Object.freeze([
    Object.freeze(["PHONE", "compact reduced-motion fallback"]),
    Object.freeze(["PC", "expanded pointer presentation"]),
    Object.freeze(["XR", "status is not-tested in this preview"]),
  ]),
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function sourceLabel(source) {
  return text(source).replace(/-/g, " ");
}

function contributionIndex(projection) {
  return new Map(asArray(projection?.contributions).map((contribution) => [contribution?.source, contribution]));
}

function aggregateFor(feature, projection) {
  const index = contributionIndex(projection);
  const contributions = feature.sources.map((source) => index.get(source)).filter(Boolean);
  const entities = contributions.flatMap((contribution) => asArray(contribution.entities));
  const evidence = contributions.flatMap((contribution) => asArray(contribution.evidence));
  const capabilities = contributions.flatMap((contribution) => asArray(contribution.capabilities));
  return { contributions, entities, evidence, capabilities };
}

function surfaceRouteFor(feature) {
  return FEATURE_SURFACE_ROUTES[feature.id] ?? Object.freeze([
    Object.freeze(["CANONICAL STATE", "local projection envelope"]),
    Object.freeze(["WORLD FOCUS", feature.focusOrganId ?? "semantic organ"]),
    Object.freeze(["REPLAY", "renderer-only local view"]),
  ]);
}

function addClass(element, ...classes) {
  classes.filter(Boolean).forEach((name) => element.classList.add(name));
  return element;
}

function appendText(parent, tag, className, value) {
  const element = parent.ownerDocument?.createElement(tag) ?? globalThis.document?.createElement(tag);
  if (!element) throw new Error("Feature navigator needs a document-like owner");
  if (className) element.className = className;
  element.textContent = text(value);
  parent.appendChild(element);
  return element;
}

function appendPill(parent, value, className = "feature-pill") {
  const pill = parent.ownerDocument?.createElement("span") ?? globalThis.document?.createElement("span");
  if (!pill) throw new Error("Feature navigator needs a document-like owner");
  pill.className = className;
  pill.textContent = text(value);
  parent.appendChild(pill);
  return pill;
}

function entityLabel(entity) {
  return entity?.label
    ?? entity?.attributes?.displayName
    ?? entity?.presentation?.label
    ?? entity?.word
    ?? entity?.statement
    ?? entity?.id
    ?? "unnamed record";
}

function entitySubline(entity) {
  const kind = entity?.kind ?? entity?.type ?? "entity";
  const state = entity?.state ?? entity?.indicator ?? entity?.status ?? entity?.presence;
  return state ? `${kind} · ${state}` : kind;
}

function capabilityStatus(capability) {
  if (capability?.enabled === false || capability?.mode === "denied" || capability?.denied === true) return "denied";
  return "projected";
}

function readRequestedFeature() {
  const query = new URLSearchParams(globalThis.location?.search ?? "");
  const queryId = query.get("feature");
  if (FEATURE_BY_ID.has(queryId)) return queryId;
  const hash = String(globalThis.location?.hash ?? "").replace(/^#/, "");
  const hashParams = new URLSearchParams(hash.includes("=") ? hash : `feature=${hash}`);
  const hashId = hashParams.get("feature");
  return FEATURE_BY_ID.has(hashId) ? hashId : null;
}

/**
 * Mount the feature navigator into the existing HUD.
 *
 * `onFocus` is owned by the Three.js controller. This module only reports a
 * selected feature; it never moves the camera or mutates canonical state.
 */
export function createFeatureNavigator({
  documentRoot = document,
  projection = null,
  deviceProjection = null,
  onFocus = null,
  onIntent = null,
} = {}) {
  const shell = documentRoot.getElementById("feature-shell");
  const toggle = documentRoot.getElementById("feature-toggle");
  const close = documentRoot.getElementById("feature-close");
  const list = documentRoot.getElementById("feature-nav");
  const detail = documentRoot.getElementById("feature-detail");
  const count = documentRoot.getElementById("feature-count");
  if (!shell || !toggle || !close || !list || !detail) {
    throw new Error("Feature navigator mount points are missing");
  }

  let currentProjection = projection;
  let currentDeviceProjection = deviceProjection;
  let activeId = "reality-lens";
  let isOpen = true;

  function setOpen(next, method = "toggle") {
    isOpen = Boolean(next);
    shell.classList.toggle("open", isOpen);
    shell.setAttribute("aria-hidden", String(!isOpen));
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.textContent = isOpen ? "CLOSE FEATURES · F" : "OPEN FEATURES · F";
    if (isOpen && method === "toggle") {
      documentRoot.getElementById(`feature-button-${activeId}`)?.focus({ preventScroll: true });
    }
    // Route hand-offs intentionally collapse the directory so the cube field
    // or the selected console gets the available space. Move focus back to
    // the always-visible toggle when that happens; otherwise keyboard users
    // can be left focused on a button that is now aria-hidden and inert.
    if (!isOpen && method !== "initial") {
      toggle.focus?.({ preventScroll: true });
    }
  }

  function setLocation(id) {
    if (!globalThis.history?.replaceState || !globalThis.location) return;
    const url = new URL(globalThis.location.href);
    // A stale legacy `city` param must never survive a feature selection.
    url.searchParams.delete("city");
    url.searchParams.set("feature", id);
    globalThis.history.replaceState(null, "", url);
    return;
  }

  function renderDetail(feature) {
    const aggregate = aggregateFor(feature, currentProjection);
    const surfaceRoute = surfaceRouteFor(feature);
    detail.replaceChildren();

    const head = addClass(documentRoot.createElement("div"), "feature-detail-head");
    appendText(head, "div", "feature-kicker", `${feature.kicker} · local projection`);
    appendText(head, "h3", "", feature.label);
    appendText(head, "p", "feature-description", feature.description);
    detail.appendChild(head);

    const route = addClass(documentRoot.createElement("div"), "feature-route");
    appendText(route, "div", "feature-route-label", "OPEN SURFACE");
    const routeSteps = addClass(documentRoot.createElement("div"), "feature-route-steps");
    surfaceRoute.forEach(([label, value], index) => {
      const step = addClass(documentRoot.createElement("div"), "feature-route-step");
      appendText(step, "span", "feature-route-index", String(index + 1).padStart(2, "0"));
      const copy = addClass(documentRoot.createElement("div"), "feature-route-copy");
      appendText(copy, "strong", "", label);
      appendText(copy, "span", "", value);
      step.appendChild(copy);
      routeSteps.appendChild(step);
    });
    route.appendChild(routeSteps);
    detail.appendChild(route);

    const stats = addClass(documentRoot.createElement("div"), "feature-stats");
    const statRows = [
      ["records", aggregate.entities.length || surfaceRoute.length],
      ["evidence", aggregate.evidence.length],
      ["capabilities", aggregate.capabilities.length],
    ];
    if (!feature.sources.length && feature.id === "projections") {
      statRows[0][1] = currentDeviceProjection?.world?.entities?.length ?? 0;
      statRows[1][1] = currentDeviceProjection?.world?.contributions?.length ?? 0;
      statRows[2][1] = currentDeviceProjection?.presentation?.viewport?.class ?? "fallback";
    }
    statRows.forEach(([label, value]) => {
      const stat = addClass(documentRoot.createElement("div"), "feature-stat");
      appendText(stat, "b", "", value);
      appendText(stat, "span", "", label);
      stats.appendChild(stat);
    });
    detail.appendChild(stats);

    if (feature.id === "projections") {
      const presentation = currentDeviceProjection?.presentation ?? {};
      const rows = [
        ["viewport", `${presentation.viewport?.class ?? "unknown"} · ${presentation.viewport?.orientation ?? "unknown"}`],
        ["motion", presentation.accessibility?.motion ?? "unknown"],
        ["input", presentation.input?.mode ?? "unknown"],
        ["XR status", presentation.xr?.status ?? "not-tested"],
      ];
      const metadata = addClass(documentRoot.createElement("div"), "feature-records");
      rows.forEach(([label, value]) => {
        const row = addClass(documentRoot.createElement("div"), "feature-record");
        appendText(row, "strong", "", label);
        appendText(row, "span", "", value);
        metadata.appendChild(row);
      });
      detail.appendChild(metadata);
    } else if (aggregate.entities.length) {
      const records = addClass(documentRoot.createElement("div"), "feature-records");
      aggregate.entities.slice(0, 6).forEach((entity) => {
        const row = addClass(documentRoot.createElement("div"), "feature-record");
        appendText(row, "strong", "", entityLabel(entity));
        appendText(row, "span", "", entitySubline(entity));
        records.appendChild(row);
      });
      if (aggregate.entities.length > 6) {
        appendText(records, "div", "feature-more", `+ ${aggregate.entities.length - 6} more projected records`);
      }
      detail.appendChild(records);
    } else {
      const records = addClass(documentRoot.createElement("div"), "feature-records");
      surfaceRoute.forEach(([label, value]) => {
        const row = addClass(documentRoot.createElement("div"), "feature-record");
        appendText(row, "strong", "", label);
        appendText(row, "span", "", value);
        records.appendChild(row);
      });
      detail.appendChild(records);
    }

    const capabilityBar = addClass(documentRoot.createElement("div"), "feature-capability-bar");
    if (aggregate.capabilities.length) {
      const projected = aggregate.capabilities.filter((capability) => capabilityStatus(capability) === "projected").length;
      const denied = aggregate.capabilities.length - projected;
      appendPill(capabilityBar, `${projected} projected`, "feature-pill feature-pill-ok");
      if (denied) appendPill(capabilityBar, `${denied} denied`, "feature-pill feature-pill-denied");
    } else {
      appendPill(capabilityBar, "renderer projection", "feature-pill");
    }
    if (feature.sources.length) appendPill(capabilityBar, feature.sources.map(sourceLabel).join(" + "), "feature-pill feature-pill-source");
    detail.appendChild(capabilityBar);

    const actionBar = addClass(documentRoot.createElement("div"), "feature-action-bar");
    const focusAction = documentRoot.createElement("button");
    focusAction.type = "button";
    focusAction.className = "feature-action feature-action-focus";
    focusAction.dataset.featureAction = "focus";
    focusAction.textContent = "FOCUS IN WORLD";
    focusAction.addEventListener("click", () => {
      onFocus?.(feature, "focus");
      onIntent?.(feature, "focus");
      focusAction.textContent = "WORLD FOCUS ACTIVE";
      globalThis.setTimeout?.(() => { focusAction.textContent = "FOCUS IN WORLD"; }, 1200);
    });
    actionBar.appendChild(focusAction);
    const action = documentRoot.createElement("button");
    action.type = "button";
    action.className = "feature-action";
    action.textContent = feature.id === "asset-token"
      ? "REPLAY LAUNCH PREVIEW"
      : feature.id === "social-explorer"
        ? "REPLAY SOCIAL REHEARSAL"
        : "REPLAY LOCAL VIEW";
    action.addEventListener("click", () => {
      onIntent?.(feature, "replay");
      action.textContent = feature.id === "asset-token"
        ? "LAUNCH PREVIEW REPLAYED"
        : feature.id === "social-explorer"
          ? "SOCIAL REHEARSAL REPLAYED"
          : "LOCAL VIEW REPLAYED";
      globalThis.setTimeout?.(() => {
        action.textContent = feature.id === "asset-token"
          ? "REPLAY LAUNCH PREVIEW"
          : feature.id === "social-explorer"
            ? "REPLAY SOCIAL REHEARSAL"
            : "REPLAY LOCAL VIEW";
      }, 1200);
    });
    actionBar.appendChild(action);
    detail.appendChild(actionBar);

    // KEEP GOING (2026-09-18): the infinite-handoff strip. Every feature
    // links onward to related features so one interaction always pushes
    // into the next — same-page handoff, no reload, no dead ends.
    const handoff = addClass(documentRoot.createElement("section"), "feature-handoff");
    handoff.setAttribute("aria-label", "Keep going");
    appendText(handoff, "div", "feature-handoff-label", "KEEP GOING");
    const handoffRows = addClass(documentRoot.createElement("div"), "feature-handoff-rows");
    (FEATURE_HANDOFF_LINKS[feature.id] ?? []).forEach((targetId) => {
      const target = FEATURE_BY_ID.get(targetId);
      if (!target) return;
      const handoffAction = documentRoot.createElement("button");
      handoffAction.type = "button";
      handoffAction.className = "feature-handoff-action";
      handoffAction.dataset.handoffTarget = targetId;
      handoffAction.textContent = `OPEN ${target.label.toUpperCase()}`;
      handoffAction.title = target.description;
      handoffAction.setAttribute("aria-label", `Keep going: open ${target.label}`);
      handoffAction.addEventListener("click", () => select(targetId, "handoff"));
      handoffRows.appendChild(handoffAction);
    });
    handoff.appendChild(handoffRows);
    detail.appendChild(handoff);

    const boundary = addClass(documentRoot.createElement("div"), "feature-boundary");
    appendText(boundary, "strong", "", "BOUNDARY");
    appendText(boundary, "span", "", feature.boundary);
    detail.appendChild(boundary);

    // Keep future paths discoverable in the same surface as the feature they
    // describe. This is read-only directory metadata, not an action launcher.
    const future = addClass(documentRoot.createElement("section"), "feature-future-options");
    future.setAttribute("aria-label", "Future options");
    appendText(future, "div", "feature-future-label", "FUTURE OPTIONS");
    const futureRows = addClass(documentRoot.createElement("div"), "feature-future-rows");
    FEATURE_FUTURE_OPTIONS.forEach((option) => {
      const row = addClass(documentRoot.createElement("div"), "feature-future-row");
      row.dataset.futureOption = option.id;
      const copy = addClass(documentRoot.createElement("div"), "feature-future-copy");
      appendText(copy, "strong", "", option.label);
      appendText(copy, "span", "", option.detail);
      row.appendChild(copy);
      appendPill(row, option.status, "feature-pill feature-pill-future");
      // A future capability remains gated, but its current local boundary must
      // be reachable. This action opens the related existing projection; it
      // never enables a provider, shared session, or XR capability.
      if (FEATURE_BY_ID.has(option.routeId)) {
        const routeAction = documentRoot.createElement("button");
        routeAction.type = "button";
        routeAction.className = "feature-future-action";
        routeAction.dataset.futureRoute = option.routeId;
        routeAction.textContent = option.routeLabel;
        routeAction.addEventListener("click", () => select(option.routeId, "future-option"));
        row.appendChild(routeAction);
      }
      futureRows.appendChild(row);
    });
    future.appendChild(futureRows);
    detail.appendChild(future);
  }

  function renderButtons() {
    const sourceIndex = contributionIndex(currentProjection);
    list.replaceChildren();
    FEATURE_DEFINITIONS.forEach((feature) => {
      const button = documentRoot.createElement("button");
      button.id = `feature-button-${feature.id}`;
      button.type = "button";
      button.className = "feature-button";
      button.setAttribute("aria-pressed", String(feature.id === activeId));
      button.dataset.featureId = feature.id;
      const title = documentRoot.createElement("span");
      title.className = "feature-button-title";
      title.textContent = feature.label;
      const meta = documentRoot.createElement("span");
      meta.className = "feature-button-meta";
      const records = feature.sources.reduce((total, source) => total + asArray(sourceIndex.get(source)?.entities).length, 0)
        || surfaceRouteFor(feature).length;
      meta.textContent = `${FEATURE_DEFINITIONS.indexOf(feature) + 1}/${FEATURE_DEFINITIONS.length} · ${records} records · ${feature.kicker}`;
      button.append(title, meta);
      button.setAttribute("aria-controls", "feature-detail");
      button.title = `Open ${feature.label}`;
      button.addEventListener("click", () => select(feature.id, "button"));
      list.appendChild(button);
    });
    if (count) count.textContent = `${FEATURE_DEFINITIONS.length} openable local features`;
  }

  function select(id, method = "button", options = {}) {
    const feature = FEATURE_BY_ID.get(id);
    if (!feature) return null;
    activeId = id;
    renderButtons();
    renderDetail(feature);
    documentRoot.getElementById(`feature-button-${activeId}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    // Some local same-page hand-offs (for example a portal cube opening Rooms)
    // intentionally keep the original URL stable. Callers can opt out without
    // weakening the normal shareable feature links used by Mission Control.
    if (!isOpen) setOpen(true, method);
    onFocus?.(feature, method);
    onIntent?.(feature, method);
    if (options?.updateLocation !== false) setLocation(id);
    return feature;
  }

  // A low-level surface opener (for example Contracts → Tennis Evidence)
  // sometimes has to change the active directory identity without invoking
  // the feature's onFocus callback a second time. The owning surface then
  // performs its normal open/refresh sequence exactly once.
  function setActive(id, method = "surface") {
    const feature = FEATURE_BY_ID.get(id);
    if (!feature) return null;
    activeId = id;
    renderButtons();
    renderDetail(feature);
    documentRoot.getElementById(`feature-button-${activeId}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return feature;
  }

  function setProjection(nextProjection) {
    if (nextProjection) currentProjection = nextProjection;
    renderButtons();
    renderDetail(FEATURE_BY_ID.get(activeId));
  }

  function setDeviceProjection(nextDeviceProjection) {
    currentDeviceProjection = nextDeviceProjection ?? currentDeviceProjection;
    renderDetail(FEATURE_BY_ID.get(activeId));
  }

  toggle.addEventListener("click", () => setOpen(!isOpen, "toggle"));
  close.addEventListener("click", () => setOpen(false, "close"));
  documentRoot.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "f" && !event.repeat && !/input|textarea|select/i.test(event.target?.tagName ?? "")) {
      event.preventDefault();
      setOpen(!isOpen, "keyboard");
    }
    if (event.key === "Escape" && isOpen) setOpen(false, "escape");
  });

  renderButtons();
  const requested = readRequestedFeature();
  if (requested) activeId = requested;
  renderButtons();
  renderDetail(FEATURE_BY_ID.get(activeId));
  setOpen(true, "initial");
  if (requested) {
    onFocus?.(FEATURE_BY_ID.get(requested), "url");
    onIntent?.(FEATURE_BY_ID.get(requested), "url");
  }

  return Object.freeze({
    select,
    setActive,
    open: () => setOpen(true, "api"),
    close: () => setOpen(false, "api"),
    toggle: () => setOpen(!isOpen, "api"),
    setProjection,
    setDeviceProjection,
    getActiveId: () => activeId,
    getSnapshot: () => ({ activeId, open: isOpen, featureCount: FEATURE_DEFINITIONS.length }),
  });
}

export default createFeatureNavigator;
