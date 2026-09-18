# Social Explorer launch plan (local rehearsal)

The social destination now carries one frozen launch-plan projection. It is a
small, renderer-friendly story for showing how a viewer could enter a local
community or space route without turning the demo into a social provider,
identity registry, marketplace, or distribution service.

## Two modes

`social-experiment` is a discovery-and-community-reuse rehearsal. It starts in
the Social Explorer catalog and keeps every card, room, signal, and artifact
fictional and aggregate.

`space-explorer` is a space-first rehearsal. It points at the local route and
nested blocks, but it does not create an account, remember a participant, or
contact another person.

In the browser host, selecting the accepted `space-explorer` mode performs a
same-page handoff to the existing cube-first Block World route
(`?feature=block-world`) through the local feature navigator. The handoff does
not write the URL, close over a new state store, or contact a provider; it only
changes which already-mounted local surface is visible. Selecting
`social-experiment` keeps the Social Explorer console open.

Both modes declare `participationPolicy: "opt-in-only"`. The projection reports
`participantStatus: "not-enrolled"` and `participationStatus:
"opt-in-not-recorded"`; selecting a mode is only a local preview and is not a
consent or enrollment record.

## Public social pulse (optional read)

The Social Explorer now has a separate **Public social pulse · optional read**
rail. It does not replace the fictional rooms, creator cards, discovery
signals, or the local `discover → discuss → create → allocation-preview` flow.
The rail is empty and visibly `UNAVAILABLE` until an explicit refresh is
requested, either with its **Refresh public pulse** button or the shareable
`?build=control4&fresh=20260828&panel=social-explorer&live=public` route.

The host owns the refresh and calls one fixed, credential-free Bluesky public
AppView endpoint: `app.bsky.feed.getAuthorFeed`, with the allowlisted actor
`atproto.com` and a maximum of eight rows. Bluesky documents this author-feed
read as not requiring authentication, and the verified public endpoint returns
JSON with `Access-Control-Allow-Origin: *`. The adapter reads only provider
text and post metadata (author label, timestamps, counts, URI/source link).
Embeds, avatars, thumbnails, and all other media references are omitted; no
media bytes are fetched or rendered.

Every row is marked an untrusted public-source observation. The adapter has no
identity resolution, posting, authentication, durable persistence, recipient,
wallet, token, transfer, settlement, or authority path. HTTP errors and empty
payloads remain `UNAVAILABLE`; no local or fictional fallback rows are added.
The implementation is in `src/domains/social-pulse.js` and the presentation
adapter is in `src/render/social-explorer.js`; `src/main.js` owns the explicit
refresh and emits a metadata-only projection intent.

## Ordered phases

The immutable cursor keeps the launch story in this order:

1. `opt-in` — choose a rehearsal mode.
2. `explore` — browse the local route, rooms, signals, and nested space.
3. `create` — compose a fictional local artifact without publishing it.
4. `allocate-preview` — read the canonical TUMBO asset-token schedule as a
   preview.

`createSocialExplorerLaunchPlan`,
`selectSocialExplorerLaunchMode`,
`advanceSocialExplorerLaunchPhase`, and
`resetSocialExplorerLaunchPlan` return deeply frozen local records. An
out-of-order phase is rejected atomically, leaving the existing cursor intact.

The final phase carries only a reference to the canonical
`tumbo-distribution-registry` contribution (`distribution:tumbo-demo-launch`).
The launch plan contains no rows, percentages, units, recipient addresses,
wallets, signatures, or transfer instructions. Its distribution status is
always `preview-only`.

## Renderer surface

`createSocialExplorerConsole` exposes the same cursor as DOM-safe methods:

- `selectLaunchMode(modeId)`
- `advanceLaunchPhase(phaseId)`
- `resetLaunchPlan()`
- `replayLaunchPlan()`

Launch-specific mounts are optional. When a host has not added mode/phase
markup, these methods still work in memory and return frozen snapshots. The
console keeps a bounded `launchPlanTrace` in memory, including reset and replay
events, so a local viewer can inspect the route without persistence. An
optional `onLaunchPlan` callback receives those frozen local events.

No fetch, WebSocket, provider call, storage write, participant enrollment,
issuance, mint, transfer, custody, signing, settlement, or executable path is
introduced by this projection.

Focused verification:

```text
node --check src/domains/social-explorer.js
node --check src/render/social-explorer.js
node --test tests/social-explorer.test.mjs
```
