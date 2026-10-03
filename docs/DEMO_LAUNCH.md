# Launch and use Reality Lens

This guide describes the working browser prototype and its loopback provider bridge. It supersedes earlier launch instructions that started a cube-first interface and an optional Merge4 memory server. Historical architecture and feature receipts remain linked below; they do not establish a running backend or public deployment.

## Start on Windows

Python **3.10 or newer** is required. The local bridge uses the standard library, so no pip installation is needed. In a PowerShell window opened at this repository:

```powershell
.\run_local.bat
```

The equivalent direct launcher command is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\launch-demo.ps1 -OpenBrowser
```

The default URL is [http://127.0.0.1:8082/](http://127.0.0.1:8082/). The launcher starts `scripts/provider_bridge.py` in a hidden process, verifies the selected checkout and required browser resources, and records the actual port-owning Python process. It also reports the canonical feature count and NVIDIA configuration state. No database, account, Merge4 service, or NVIDIA inference is started by opening the page.

The local Launch Registry opens through the `launch-distribution` feature in Spaces. Its existing direct-link alias is [http://127.0.0.1:8082/?panel=launch-distribution](http://127.0.0.1:8082/?panel=launch-distribution); the current feature link is [http://127.0.0.1:8082/?feature=launch-distribution](http://127.0.0.1:8082/?feature=launch-distribution). Both describe a local prototype registry; publishing requires its separate release workflow.

If a listener already exists, the launcher verifies its health fingerprint against this checkout and probes its resources. It reuses a matching service without taking process ownership. A different or unverifiable listener causes an error; it is not killed or replaced. Choose a free port instead:

```powershell
.\run_local.bat -StaticPort 8085
```

## Verify and stop

Verification is read-only and does not start another service:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-demo-launch.ps1
```

Use `-StaticPort 8085` to check that alternate port. The verifier reads `GET /api/health`, checks the service and normalized-checkout-path fingerprint, fetches the entry page, main module, assembly, Connections module and vendored Three.js module, then reads `GET /api/providers`.

Health fields include `service:matumbo-provider-bridge`, `healthy`, `instanceId`, `rootFingerprint`, `featureCount`, `storage:browser-local-projection`, `localOnly:true`, `credentialsInBrowser:false`, and `externalDeployment:false`. The path fingerprint identifies the directory; it is not a Git commit hash or source-integrity checksum. These probes establish service identity and file delivery. Browser rendering, interaction, source availability, and actual NVIDIA answers require separate checks.

Stop the launcher-owned process with:

```powershell
.\run_local.bat stop
```

For an alternate port:

```powershell
.\run_local.bat stop -StaticPort 8085
```

Launch records and logs are under `work/demo-launch/`. The stopper requires the recorded checkout and port, PID, process creation time, exact command line, and the running health instance/fingerprint to match. It refuses a changed identity. If there is no owned record, it stops nothing; if the recorded process already exited, it removes that stale record. A manually started or reused service remains owned by its original launcher.

## Other platforms and browser-only preview

On macOS/Linux, run the bridge in the foreground from the repository:

```sh
python3 scripts/provider_bridge.py --port 8082
```

Open the same loopback URL and stop that process with Ctrl+C. A Windows foreground session can use `py -3 scripts/provider_bridge.py --port 8082`.

For a browser-only preview, any ordinary HTTP server can serve a built static package. This fallback has no `/api/health`, process ownership protocol, or NVIDIA inference route:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory work/static-preview
```

Use an extracted static package as `work/static-preview` and open `http://127.0.0.1:8080/`. Do not use the bridge verifier to certify an ordinary file server. Open the bridge's own 8082 page when testing NVIDIA, avoiding public-page local-network access restrictions.

## First use and recovery

The landing is **Reality Lens / Reality Assembly**, organized into six spaces using five bodies: cube, sphere, cylinder, triangular prism and torus. Choose a space, then open a feature object. Busy spaces show six objects per desktop page or four per compact phone page. **Find / Locate** searches the canonical identities; breadcrumbs and browser Back return object → containing space → Home. Drag a body to turn it, tap its painted controls, and use surface **Previous / Next** to browse longer content. **Details** adds information to the same body's surfaces. **Text view** exposes the original accessible feature. **View** and **Connections** expose optional controls on request. Person Ω opens the personal room through the same navigator. See [whole-body surfaces](REALITY_SURFACES_360.md) for interaction and media boundaries.

The page uses the vendored Three.js 0.179.1 module; the core renderer does not depend on a Three.js CDN. WebGL is required for the full 3D view. If startup or WebGL fails, the page reports an unavailable renderer and preserves an accessible feature fallback. Check the reported failure, use a current WebGL-capable browser, and reload. A successful HTTP probe alone does not prove the 3D world is working.

If an older screen remains after an update, reload the page with the browser's cache bypass. Do not use a hard-coded historical `build=control4` or `fresh=...` query as a release identifier. Direct routes use the canonical identity, for example `/?feature=youtube`, `/?feature=chess`, or `/?feature=contract-atelier`; Back/Forward restores navigation separately from domain state.

## Canonical feature identities

The current registry is [FEATURE_DEFINITIONS](../src/render/feature-navigator.js). It contains **36 identities**; counts are derived from that registry rather than an old packet's route list. Each ID can be selected through the navigator or `/?feature=ID`. A present route is not evidence that its provider, account, hardware dependency, or every workflow has been verified.

| Space | Feature | Canonical ID |
| --- | --- | --- |
| Worlds & rooms | Rooms + Messaging | `rooms` |
| Worlds & rooms | Block World / Fabric | `block-world` |
| Worlds & rooms | Local Cube Sync | `runtime-sync` |
| Worlds & rooms | Migration Bridge | `migration` |
| Your space | Person Ω | `person` |
| Your space | Social Mirror / Feed Ticker | `social-mirror` |
| Your space | Luna Companion | `luna-companion` |
| Your space | Wardrobe Atelier | `wardrobe-atelier` |
| Network & tools | Social Explorer / Re-market | `social-explorer` |
| Network & tools | Bot Plaza | `bot-plaza` |
| Network & tools | World Gateway / Evidence | `gateway` |
| Network & tools | Web + AI | `web-ai` |
| Value & contracts | TUMBO Asset Token | `asset-token` |
| Value & contracts | Asset Market Evidence | `asset-market` |
| Value & contracts | Launch Distribution | `launch-distribution` |
| Value & contracts | PAYCORE Asset-token Balances | `paycore` |
| Value & contracts | Contracts + Pools | `contracts` |
| Value & contracts | Contract Atelier | `contract-atelier` |
| Value & contracts | Prime Ledger + EchoProof | `ledger` |
| Value & contracts | T402 Value Routing | `t402` |
| Agents | Agent | `agent` |
| Agents | Neural Mesh | `neural-mesh` |
| Agents | Muse Agent | `muse-agent` |
| Play, media & learning | Reality Lens Ω | `reality-lens` |
| Play, media & learning | YouTube | `youtube` |
| Play, media & learning | Picture Matter | `picture-matter` |
| Play, media & learning | NFT Atelier | `nft-atelier` |
| Play, media & learning | White Paper | `white-paper` |
| Play, media & learning | Gesture Lens | `gesture-lens` |
| Play, media & learning | World Events / Evidence | `world-events` |
| Play, media & learning | Tennis Evidence / ATP · WTA | `sports-events` |
| Play, media & learning | Multi-Sport Scoreboards | `multi-sport-events` |
| Play, media & learning | ARENA / Game Lab | `arena` |
| Play, media & learning | Chess | `chess` |
| Play, media & learning | Financial Academy | `academy` |
| Play, media & learning | Phone / PC / XR | `projections` |

Local Cube Sync is an explicit adapter for a separately running compatible Merge4 service. The standard launcher does not install or start that service. Rooms/cipher indicators, allocation schedules, projected ledger proofs, and several advisory graphs describe simulated or illustrative state. Keep those boundaries distinct from playable local workflows and provider-returned observations.

## What persists

The service reports `browser-local-projection`. The browser can store feature layout, an approved avatar/look, local bot definitions and proposal records, persistent user blocks, and simulation records through their domain adapters. Other room actions, projections, and inspection traces remain session-only. Persistence varies by feature; it does not turn renderer metadata into backend authority.

Browser storage belongs to its origin. `localhost:8082`, `127.0.0.1:8082`, another port, and the public GitHub Pages site each have separate state. Use the same URL to continue the same local workspace. Clearing that site's browser data can remove saved layouts and simulation progress; export supported JSON before deliberately resetting it. Ordinary navigation does not need a global storage clear.

The block draft's editing/import path and a separately connected Local Cube Sync service have their own boundaries. The launch kit is a data manifest, not a service installer or proof that a backend is present. Nothing in the browser grants account membership, real identity authority, wallet custody, signing, settlement, or external bot execution.

## Public reads and NVIDIA

Connections deliberately runs **one bounded public batch on page load**: Open-Meteo example weather, Frankfurter/ECB EUR rates, USGS past-day earthquakes, and DeFiLlama Aave TVL. One fixed ExchangeRate-API alternate is tried only if the FX primary fails, with its own attribution and retained primary failure. **Check connections** requests another batch. There is no repeating background poll.

Older source surfaces keep their own explicit refresh controls and provenance. YouTube search requests public metadata after a user search; selected video IDs play through one privacy-enhanced YouTube iframe on the object. Provider failures remain visible rather than being replaced with invented live rows. See [API_CONNECTIONS.md](API_CONNECTIONS.md) for endpoint, quota, attribution, and CORS details.

NVIDIA uses `GET /api/providers` for configuration discovery and `POST /api/nvidia/chat` only after **Send to NVIDIA**. Without a server environment key, its state is **Key needed**. Key presence yields **Configured · untested**; a successful explicit answer is needed to verify authentication and entitlement. No inference is issued automatically, and the result is advisory.

Follow [secure NVIDIA setup](API_CONNECTIONS.md#connect-nvidia-securely) to supply the developer key to the server environment. Stop and relaunch the owned bridge from that shell after configuring it; an already running process cannot inherit a new environment variable. Never put the key in the page, a URL, browser storage, a source file, or a launch log. Static GitHub Pages cannot run Python or keep a server API key secret. Browser local-network policy can block cross-origin discovery, so the bridge's own page is the supported local path.

## Build a static package

From Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-demo.ps1
```

The script chooses a fresh `work/static-demo-<id>/` directory. An explicit fresh destination is also supported:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-demo.ps1 -OutputDirectory .\work\review-package
```

On another platform:

```sh
python3 scripts/package_demo.py work/review-package
```

The output includes `matumbo-static-demo.zip`, `manifest.json` with each browser file's size and SHA-256, and `SHA256.txt` for the ZIP. Archive entry ordering, timestamps, and permissions are fixed for reproducible content. The packager builds browser directories and root entrypoints, checks ZIP integrity and each recorded file hash, and refuses to replace an existing archive. It does not freeze a universal file count or checksum: those depend on the actual source being packaged.

The ZIP is browser-only and excludes the Python server, credentials, repository metadata, and dotfiles. Extract it into a separate directory and serve it over HTTP to check the rendered result. Packaging and checksums are not deployment or interaction proof. The [Pages workflow](../.github/workflows/deploy-pages.yml) builds the static site on main-branch pushes or explicit dispatch; a draft PR remains separate from the published build.

## Architecture and history

Current controls preserve the project's local simulation/projection boundary. Domain records own their state; the 3D world and mesh surface textures render it. The cross-origin YouTube player remains one planar native browser surface. Public reads do not become trades, cryptographic proofs, membership, or financial authority. Optional advisory AI has no wallet, signing, settlement, or external execution tools.

For deeper feature history and architecture, see [Block World and migration](BLOCK_WORLD_MIGRATION.md), [contract flow](CONTRACT_FLOW.md), [Person embodiment](PERSON_EMBODIMENT.md), [public source evidence](LIVE_GATEWAY_EVIDENCE.md), [device projection](DEVICE_PROJECTION.md), and [Merge4 snapshot adapter](MERGE4_SNAPSHOT_ADAPTER.md). Packet receipts may contain earlier routes, geometry, fixture descriptions, or test counts; use current source and fresh evidence for acceptance.

The [earlier launch document at commit a12462c](https://github.com/carltheghost/matumbo-living-reality-demo/blob/a12462cd865dc094a44c58f6d11ef8061eb7b79e/docs/DEMO_LAUNCH.md) preserves the earlier cube-first / optional Merge4-memory narrative and fictional allocation examples. It is a historical reference, not the current startup procedure. Production services, shared synchronization, physical-device gestures, and XR hardware acceptance each need their own implemented and verified environment.
