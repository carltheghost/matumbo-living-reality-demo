# Living Reality live development preview

## Current availability

Current public development URL: https://graduated-nickel-these-margin.trycloudflare.com/

Current machine-readable context: https://graduated-nickel-these-margin.trycloudflare.com/context.json

The current public browser audit passed at `2026-09-11T04:34:29.850Z` for source revision `5f1ab21fe1ec28d7e5611b1477affbd59498e1de076b5701dcc3f2c200283165`. It exercised the visible Contracts workshop, centered/dragged surface, honest XR/media permission path, 390×844 bounds, public context, private/API denial, and zero browser errors. The public `/context.json` reports all 23 canonical features, including `runtime-sync` and `t402`, with no truncated fallback identifier. The local Person-room route remains `http://127.0.0.1:8081/?feature=person`.

This is a temporary read-only quick tunnel, not permanent production hosting. It remains available only while this computer, the preview server, and the tunnel process stay online; restarting the tunnel changes the URL.

The previously published quick-tunnel hostname below failed DNS resolution in later recovery checks. Treat its earlier public verification as historical, not current availability.

Previous development URL: https://crown-partly-disks-chronicle.trycloudflare.com/

Readable project context: https://crown-partly-disks-chronicle.trycloudflare.com/context

Machine-readable source revision: https://crown-partly-disks-chronicle.trycloudflare.com/context.json

This is a public **development preview**, not a production financial service. It serves the current worktree's frontend files without Git commits or publishing unrelated files. The computer, Node preview process and Cloudflare tunnel must remain online. Restarting a quick tunnel generates a different URL. There is no uptime guarantee.

The injected preview control polls every three seconds. It refreshes after source changes unless paused, a form control is active, or a local market is marked unsaved. Export session-only market work before manually refreshing. The context endpoint is not a transcript, a browser session, or an audit of every feature.

## ChatGPT access

In the earlier public-preview verification, the public URL loaded in Chromium and returned HTTP 200 in an external HTTPS probe. That is not a current uptime claim. The chat web reader rejected this temporary tunnel domain. Do not promise every ChatGPT client can browse it. When a preview is available, its `/context.json` can be opened in a browser and pasted into the chat. A permanent hosted domain remains a separate deployment step.

Suggested prompt: “Read this maTumbo context URL, compare its source revision with the last one, and distinguish implemented, tested and pending work. Do not assume the context page contains my unsaved session or conversation.”

## Start and stop

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-public-preview.ps1` from this worktree.

Cloudflared is pinned to official release 2026.8.3. The installer binary's SHA-256 was verified against GitHub release metadata:

`83e726ed18ea78c5ad5213c4c3a3a27051393950d2bc8ed4de69bec12d14eaae`

Binary and process logs are under `%LOCALAPPDATA%\maTumbo-preview`. The launcher prints process IDs. Before stopping a process, inspect its command line and verify it is this preview/tunnel, then stop that exact PID. Do not stop unrelated Node or tunnel processes.

Port 8081 binds to loopback. It allows only frontend `index.html`, `favicon.svg`, approved extensions under `src/`, and pinned Three.js assets. Repository metadata, dotfiles, runtime/admin routes, scripts and environment files are not served. No write API or directory listing is exposed.

## Current verified slice

- Centered feature surfaces, drag handles, recentering, mobile bounds and collapsible cube controls.
- Equal-axis semantic cube sigils.
- Actual public ESPN record → local rules-based single/pool builder → explicit local entries → close → JSON export.
- No fabricated entrants, balances or liquidity in the new builder. Existing legacy fixture surfaces remain labeled simulation.
- VR/AR requests attach to the same Three.js renderer and scene. Controller/select events use existing cube/content actions. Session tests cover hit selection and desktop restoration; headset and AR hardware remain unverified.
- Camera/microphone preview starts only on explicit action. Audio-only, mute, stop and late-permission cancellation are implemented. No call, recording or upload is created.
- Avatar identity/motion/appearance domain foundation: see `PERSON_EMBODIMENT.md`.

Evidence: `work/live-preview-audit.json`, `work/live-preview-desktop.png`, `work/live-preview-mobile.png`, `work/live-market-verification.png`, and `work/current-test-results.log`.

Historical verification for source revision `351e69d382e3d54a3cf1c5e474d94baccc187652d7f26e1f6b8c5df1b3ebba35`: 454 automated tests passed; public HTTPS browser checks passed with no page errors; 15 actual ESPN records returned; selected soccer provenance passed through pool creation, explicit local entry and close. These are bounded development checks, not a full release certification. Current Person-room source revisions and checks are recorded separately in `work/person-studio-audit.json`; current full-suite output is in `work/current-test-results.log`.

Run `node scripts/audit-live-preview.mjs --live-sports` for a browser audit with real public sports reads. Test browser availability and provider responses are external prerequisites. Do not use the static unit-test pass count as proof of public, mobile hardware or XR completeness.

## Still pending

Authenticated shared market persistence, admin authorization, user accounts, verified result resolution, full sports-provider coverage, one-to-one/group WebRTC signaling and TURN/media relay, cross-device tests, human likeness generation/approved rig assets, rig/IK/blendshape integration, persistent companion runtime and permanent production hosting. Token issuance, signing, custody and settlement are not enabled by this preview.
