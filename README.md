# maTumbo Living Reality / Reality Lens

An interactive 3D prototype organized into six spaces and six recognizable bodies: cube, sphere, diamond, cylinder, triangular prism and torus. Open a body on Home, choose a feature, and turn its object to read and operate the information across its surfaces. Search and navigation keep the same canonical feature identity; optional controls stay closed until needed.

The world includes local rooms, personal avatar/wardrobe tools, standard chess and game rehearsals, advisory agents, YouTube search and playback, public-source observations, and simulated contracts and points. The renderer is a projection of local domain state. TUMBO-SIM is a local simulation; this prototype does not issue assets, operate wallets, sign, custody, trade, or settle real value.

## Open the demo

[Published GitHub Pages demo](https://carltheghost.github.io/matumbo-living-reality-demo/) · [Current launch guide](docs/DEMO_LAUNCH.md) · [API connections and secure NVIDIA setup](docs/API_CONNECTIONS.md)

The published site serves the deployed main-branch build. A branch or draft PR can contain newer work; its local preview and public deployment must be checked separately.

## Run locally on Windows

Install Python **3.10 or newer**, then run this from the repository folder:

```powershell
.\run_local.bat
```

It starts a hidden loopback Python bridge and opens [local Reality Lens](http://127.0.0.1:8082/). The bridge serves the browser assets and exposes health/provider status. It works without a NVIDIA key and requires no Python package installation. The launcher verifies this checkout before reporting the URL and will not replace another listener.

```powershell
# Verify the current service without starting another process.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-demo-launch.ps1

# Stop only the process recorded and identified by this launcher.
.\run_local.bat stop
```

For another port, use `.\run_local.bat -StaticPort 8085` and `.\run_local.bat stop -StaticPort 8085`. On macOS/Linux, `python3 scripts/provider_bridge.py --port 8082` serves the same prototype; stop that foreground process with Ctrl+C. See the launch guide for ownership checks, recovery, and static packaging.

## Use Reality Lens

- Choose **Worlds & rooms**, **Your space**, **Network & tools**, **Value & contracts**, **Agents**, or **Play, media & learning**. Busy spaces page through six objects on desktop or four on a compact phone viewport.
- Use **Find / Locate** to open a feature by name. Breadcrumbs and browser Back return from an object to its space, then Home. Space URLs support reload and browser Back/Forward.
- Drag a body to turn it; tap a painted control to use its original action. Scroll or use the surface's **Previous / Next** controls for longer content. The focused body also supports arrow keys and Page Up/Page Down.
- **Details** adds information to the selected body's surfaces. Text fields use the original native input; **Text view** exposes the original accessible feature. **View** exposes camera and optional device controls. **Connections** shows source status and the optional assistant.
- In **YouTube**, search by title, creator, or topic and select a result to use the in-object player. Search cancellation, direct video/playlist links, and a single-player lifecycle remain available. Individual videos and public search providers can be unavailable.
- **Your space / Person Ω** opens the local avatar room. Appearance approval and camera permission are separate actions. Physical-device camera/gesture behavior and XR hardware support require their own verification.
- **Value & contracts / Asset Token / Ourplace** lets you describe, review and apply a design to the actual world, publish a licensed local version, download a share package and trace adoption/remix rewards. Its tabs also expose shared compute budgets, consent rewards, service payments, reserved orders, collateral credit, prediction contracts and receipts. See [Ourplace economy](docs/OURPLACE_ECONOMY.md) for the full loop and exact local boundaries.

The current [feature registry](src/render/feature-navigator.js) contains **36 canonical feature identities**. Their IDs, routes, and dependency boundaries are listed in the [launch guide](docs/DEMO_LAUNCH.md#canonical-feature-identities). A route being present does not prove every external provider or internal workflow is available.

## State and connections

Layouts, approved appearance, local bot/proposal records, and some simulation workflows can use browser storage. Storage belongs to the browser origin: `127.0.0.1:8082`, `localhost:8082`, another port, and the public Pages URL have separate local state. Other projections and traces are session-only. Browser persistence is neither a cloud account nor a shared backend.

On page load, Connections performs **one bounded public batch** for weather, EUR reference rates, earthquakes, and Aave TVL. FX has one attributed alternate after a primary failure; there is no repeating poll. Older source surfaces retain their own explicit refresh controls. YouTube search is user-triggered. Source URLs, timestamps, failures, and coverage remain visible. See [API_CONNECTIONS.md](docs/API_CONNECTIONS.md) for endpoints and terms.

NVIDIA inference is optional and uses the local bridge. **Key needed** means no server key is configured; **Configured · untested** is not proof of a working cloud request. The owner supplies the developer key to the server environment, and **Send to NVIDIA** triggers an advisory answer. Keys are not accepted by or stored in the browser. Static Pages cannot run this Python bridge or keep a server key secret.

## Development and delivery

**Hands & eyes** in the Home header opens the shared camera/video controls. Ordinary laptop, USB and phone cameras use the browser camera API; local video files use the same on-device detector. Hands can select original object controls or move, resize and rotate unlocked objects. Optional eye tracking requires nine calibration targets and five separate accuracy-check targets before it can aim or navigate. Camera access is explicit, frames stay local, and physical-camera/human-gaze validation remains open. See [the hands-and-eyes guide](docs/HANDS_AND_EYES.md) for setup, phone HTTPS access, troubleshooting and evidence boundaries.

The browser uses pinned, vendored Three.js **0.179.1**, vanilla JavaScript and WebGL. Live document content becomes canvas textures on the actual mesh, and triangle UV hits operate the original controls. Canvas features retain their proportions and receive a dedicated reading surface. One native YouTube iframe uses CSS3D placement because cross-origin player pixels cannot be copied onto curved geometry. See [the whole-body surface engine](docs/REALITY_SURFACES_360.md) for geometry, ownership and media boundaries. Node's test runner exercises the JavaScript domains; Python's standard library serves and packages the prototype. Some optional widgets and public providers still need network access.

```powershell
# Complete JavaScript and Python suites (Node 22+ and Python 3.10+).
py -3 scripts/run_tests.py
py -3 -m unittest discover -s tests -p "test_*.py"

# Build a browser-only ZIP, integrity manifest, and checksum in a fresh folder.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-demo.ps1
```

The static package excludes the local Python server and cannot provide NVIDIA inference by itself. Packaging is local; it does not publish a site. The [Pages workflow](.github/workflows/deploy-pages.yml) deploys on main-branch pushes or explicit dispatch. Follow the repository's [agent contract](AGENTS.md), preserve existing work, and do not merge without the owner's authorization.

## Project history

Earlier cube-only landing rules, packet receipts, Merge4 adapters, and allocation rehearsals remain documented under [docs/](docs/). They describe the architecture and experimental history, not installed services or current acceptance evidence. The [earlier launch guide at commit a12462c](https://github.com/carltheghost/matumbo-living-reality-demo/blob/a12462cd865dc094a44c58f6d11ef8061eb7b79e/docs/DEMO_LAUNCH.md) is preserved for comparison. Current launch instructions are in [DEMO_LAUNCH.md](docs/DEMO_LAUNCH.md).
