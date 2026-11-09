# Living encounters inside the existing Vivo phone app

This feature gives existing objects a local sensory response to touch, observed
hand contacts, proximity, and explicitly emitted simulated light. It is not another
world, physics engine, neural model, account service, or remote task executor.

`client.mjs` installs an idempotent hook into the original phone-ready event. The
hook uses the existing published snapshot, original hit test, renderer instance,
and contact API. It adds a Living objects action inside the original phone controls.
No other renderer, bootstrap, world, input, material, economy or Android file changes.

## Behavior

- 100 ms sensing uses all spatial axes, same-chart Euclidean distance and proximity
  hysteresis. A screen overlap alone is not contact. Unknown metrics are unsupported.
- Touch and explicit simulated light change per-object channels immediately. Four
  response profiles have fixed local gains; they are not learned weights.
- Channels decay with a 2.4 second time constant. Meaningful accumulated responses
  retain a small provenance-tagged history. Rendering samples state; it never logs
  frames. A prior history leaves a quiet surface tint, not a running-job indicator.
- Maximum 128 sensed objects, 32 retained events per object, and 256 recent IDs.
  Repeats are coalesced. The cap is visible; this is not an unlimited lifetime archive.
- History persists in a separate device-local IndexedDB store, keyed by original
  world/branch/space/dimension. Revision-checked writes detect concurrent-tab changes.
  Restoration never resurrects a glow, grip, provider session, or external task.
- Pausing sensing preserves history. Forget selected traces changes only that
  object's local sensory history. Canonical position, identity and receipts stay intact.
- Message inputs are explicit host ports, not automatically wired to agents. A
  confirmed-message label needs a trusted verification callback and matching scope.
  No provider call, permission escalation, secret, message body or trading operation
  is created by these encounters. Light uses distance falloff, not physical optics.

## Integration and release

The existing phone shell cache is v25 and includes the three new modules. v24 is
reserved by the separate account PR; that branch must reconcile its cache version
when integrated. This change does not merge unrelated pending work.

The preserved historical service-worker test runs unchanged from exact parent
2e25e258021c6b16d2892e98a2b13d40b1e5f5d1 in a temporary detached worktree, then checks
v23 to v25 with real cached assets, IndexedDB worlds, Eyes, balances and receipts.
It removes only its own disposable test worktree. No assertions are skipped.

## Evidence at authoring

Node v22.16.0: 89 focused tests pass, zero failures/skips, including 46 new checks.
The local browser could launch but its first localhost navigation was denied by
administrator policy; no browser assertion from that attempt is a pass.
The own read-only CI workflow runs the complete phone suite, original-route browser
interaction/IndexedDB checks, and preserved historical cache-upgrade assertions.
Read the resulting hosted logs before claiming live/browser success.

This patch must be published and checked at the existing repository-backed Vivo
URL before it is described as live. GitHub Pages publication does not publish the
separate maTumbo ChatGPT Site or update an installed Android APK. The exposed Vivo
connector is currently offline and offers no source-edit/publish operation.
