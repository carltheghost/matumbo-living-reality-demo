# Local Social-Experiment Launch Kit

`src/domains/launch-kit.js` packages the current maTumbo space-explorer demo
into one deterministic JSON manifest. It is the handoff artifact for someone
who wants to understand what is in the local demo before opening the browser.

The manifest includes:

- all 22 Mission Control routes, including Local Cube Sync, Asset Market Evidence, World Pulse,
  Multi-Sport Scoreboards,
  and Tennis Evidence public reads;
- the fictional `TUMBO-SIM` fixed-supply asset token, its eight allocation
  classes, and a canonical class summary;
- all 18 aggregate fictional registry rows and their exact basis-point math;
- the six-entry Arena/Living Reality migration manifest;
- Social Explorer rooms, creator cards, discovery signals, rehearsal actions,
  and steps;
- Phone, PC, and VR/AR/XR presentation profiles.

`createLaunchKit()` is pure and replay-safe. `serializeLaunchKit()` validates
the frozen payload before producing JSON. `validateLaunchKit()` rejects malformed
identity, cycles, getters/setters, executable-looking fields, oversized
collections, and non-local authority flags.

The manifest is not a deployment script and does not contain recipient
addresses, wallets, accounts, secrets, provider credentials, payment
instructions, signing material, commands, executable code, or network URLs to
invoke. It cannot issue, custody, transfer, settle, list, or represent money.
The supply and registry are a fictional local projection only.

The browser now exposes this through the `Launch Kit · everything in one view`
console. Open it from either Launch Distribution or Social Explorer. The
console includes a 22-route directory; clicking a route hands focus back to
Mission Control, where the corresponding local console opens. The Local Cube
Sync route is the one explicit `?panel=runtime-sync` handoff: it selects the
Mission Control entry once and opens the existing loopback-only Merge 4 panel,
where Connect, Load, Save, and remote-update review remain user actions. The token,
migration, social, and device sections are visible alongside the serialized
manifest so the handoff is inspectable without hunting through old panels.
World Pulse and Tennis Evidence remain explicit public-source refresh surfaces;
their records are not bundled into the manifest and are never fabricated by
Launch Kit.
The token section names the asset token explicitly, shows the eight class
labels (county/community, organisations, international public-good funds,
grants, treasury, operations, reserve, and opt-in social cohorts), and shows
registry basis points and units reconciled to the fixed supply.

`Download Launch Kit` is an explicit user-triggered browser action. It validates
the frozen manifest, downloads a deterministic JSON artifact, revokes its
temporary object URL, and reports a visible fallback when browser download APIs
are unavailable. A download is a local description of the demo; it is not proof
of real issuance or distribution.

The console also exposes a readonly **Live status link · 7 public sources ·
refresh once on open** field. Its route is deterministic for the current local
origin and pathname and resolves to `panel=live-status&live=all`, so a viewer
can paste it into another local browser window without carrying stale feature,
panel, or hash state. Opening that route performs one bounded, fixed-order read
of World Pulse, Tennis, Asset Market, Protocol TVL, Multi-Sport Scoreboards,
Social Pulse, and Picture Matter metadata. `Copy live status link` calls
`navigator.clipboard.writeText` only after the user presses that button. If
clipboard permission or the API is unavailable, the URL remains selectable and
the status reports either `LINK VISIBLE · COPY MANUALLY` or `LINK VISIBLE ·
COPY UNAVAILABLE`. A successful copy reports `LINK COPIED · LOCAL ONLY`.

The live status panel keeps auto-refresh off on entry. Its explicit **Start
auto-refresh · 30s** control runs one immediate seven-source batch and then a
fixed 30-second local cadence; Stop, close, reset, and destroy cancel that
timer. The copied route itself never turns on the timer implicitly. Packet 175
first rechecked this route against the mounted public adapters, and Packet 178
re-audited both the canonical status route and direct World Pulse route: returned
rows kept source provenance/freshness or explicit unavailable state, and an
aborted allowlisted CoinGecko request stayed empty rather than receiving a
fixture replacement (`work/audit-live-status-no-mock-178.json`).

The **Reset** control clears the local Launch Kit selection, replay/download
status, and copied-link status without reloading the page.

This is a local route handoff, not a public share URL. The console does not use
`navigator.share`, publish a link, persist a session, or create a
wallet/token/settlement authority. The live-status route contacts only the
already allowlisted public providers when its explicit route refresh runs;
Launch Kit itself remains network-free. Replay and Reset clear a stale copied
status back to the visible manual-copy state.

The console adapter is `src/render/launch-kit.js` and its mount points are
declared in `LAUNCH_KIT_DOM_IDS`. It emits only frozen local callbacks to the
host; it has no fetch, WebSocket, `navigator.share`, provider, wallet, or
persistence path. Clipboard access is limited to the explicit local-link copy
button described above.

Focused verification:

```text
node --test tests/launch-kit.test.mjs tests/launch-kit-render.test.mjs
```

The Launch Kit directory currently contains 23 openable local features. Packet
169 verified the Launch Kit → `panel=live-status&live=all` handoff and Packet
172 verified the Launch Kit → `?panel=runtime-sync` handoff. These are local
same-origin routes; neither is a public share service, durable sync channel,
provider truth surface, or production deployment.
