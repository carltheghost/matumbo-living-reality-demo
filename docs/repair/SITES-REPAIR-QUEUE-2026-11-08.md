# maTumbo site repair queue

This is the ordered repair list for the existing maTumbo sites and Vivo application.
Work on one bounded repair at a time. Reuse the existing project and storage owners;
do not create replacement sites or describe a local package as a live update.
A row is complete only after its acceptance check passes on the intended published
application. A source commit, a passing fixture and a published release are distinct.

## Verified starting points

Repository baseline: `carltheghost/matumbo-living-reality-demo` at
`2e25e258021c6b16d2892e98a2b13d40b1e5f5d1` (merged Field Lab entry PR #138).

| Surface | Located evidence | Boundary |
| --- | --- | --- |
| Fabric Omega / Village Council | Existing Site `appgprj_6adba316ae4c8191b55e99ff29fd7a59`, slug `matumbo-fabric-omega-v2`; saved site record source version 9 | Saved record describes eight roles and four local tools, not a verified live multi-provider council. Existing Sites source/editor is not exposed in this session. |
| TriBrain Connected Neural Lab | Existing Site `appgprj_6ace9fbccb408191a5a3e9817b39c04a`, slug `tumbo-tribrain-neural-lab`; saved record source version 11, projection revision 21 | Contains a separate Weight Studio; do not conflate it with the reciprocal model or Vivo account/memory code. |
| DiamondPulse / Diamond Arena | Owner screenshots 5096 and 5094 | Detailed crystal/stadium reference versus much simpler 3D geometry. Canonical Site project/source is not yet resolved. The older offline sports dashboard is not assumed to be this Site. |
| Current Vivo Field Lab | `services/vivo/web/phone/field-lab.html` | Existing original-file-free entry, assembling the canonical phone runtime. |
| Legacy Viva Studio | `field-lab-studio.html` and existing `src/vivo-phone-engine/boot.mjs` | Requires saved/original v0.4 HTML for its old app; must retain existing data and remain labelled separately. |
| Account and memory candidate | PR #141 at `e386f538b9bf6744438fe3a81e5a649829d7a8ad` | Open/unmerged when checked. Credential host is loopback-only; real account and remote-phone acceptance remain pending. |

This is not an exhaustive account-wide Sites inventory. ChatGPT Space's Pages tools
are not a Sites source/publishing API; its empty `sites` Page listing does not mean
the user's Sites are absent. The supplied Sites dashboard cannot be enumerated or
edited through the available tools. Public-site fetch failed and container DNS
failed, so no fresh live click-through is claimed. Source checks, saved Site records,
and the owner's five screenshots are the evidence for this queue.

## Ordered repairs and acceptance

1. **Stop sending users to the wrong launcher.** Add a clear current-Vivo entry to
   the existing legacy page without erasing the old app, changing the canonical
   root, or claiming saved-world migration. Link from the original Sites when their
   source is available. Display which app and revision a link opens. **Acceptance:**
   a cold visitor and returning visitor can reach current Field Lab without selecting
   v0.4; original saved app remains accessible; base paths resolve correctly; cached
   users receive the new navigation. **Status:** repository-side handoff implemented
   and locally tested in this change; review/publication and live verification pending.
   Fabric/TriBrain navigation remains untouched until original source is accessible.

2. **Make each 3D relic match its approved image.** Start with Village Council,
   then Diamond Arena and TriBrain. Recover the actual asset/renderer source and
   reference images; compare silhouette, proportions, openings, interior structures,
   framing, materials and lighting. Build the missing geometry rather than merely
   recolouring primitive shapes. Render the poster and interactive view from the same
   approved master asset. **Acceptance:** owner-approved paired reference/model views
   at the same camera plus coherent 360-degree rotation; no unexplained replacement
   object. **Status:** confirmed visual mismatch in supplied screenshots; original
   Site source/model access is the next blocker. No new model is represented as finished.

3. **Make relic interiors functional.** Opening/closing must animate the visible
   shell, preserve selection, and expose meaningful interior objects linked to real
   project tools. Support touch, keyboard, zoom, reset and reduced motion. **Acceptance:**
   documented actions succeed on each named component without losing project state;
   a decorative object is not labelled an operational agent or contract.

4. **Unify navigation and mobile usability.** Persistent Home/Projects/Accounts/
   Plans/Help access, correct back navigation, visible active workspace, reachable
   menus and no duplicated hero sections blocking work. Clearly label Obsidian as
   a material finish when that is its function. **Acceptance:** keyboard and phone
   task walkthroughs, focus visibility, touch targets and no horizontal clipping.
   Do not try to edit operating-system overlays or ChatGPT's own composer.

5. **Finish real account connections and multiple-account isolation.** Mount the
   existing account work with the required supported host, instead of adding a
   decorative login button. Distinguish a model connection from a persistent agent.
   Keep account A and B independent; default changes affect new tasks only. Separate
   locking/signing out of Vivo from disconnecting a provider. **Acceptance:** two real
   authorized same-provider accounts where supported, reconnect/expiry/revocation
   checks, persisted metadata without exposed tokens, no private-history leakage.
   Actual login and provider entitlement require their real acceptance test.

6. **Implement visible plans and subscriptions.** Separate maTumbo product billing
   from linking existing AI subscriptions. Define the product, prices and entitlements
   before enabling checkout; integrate an appropriate payment processor rather than
   collecting card data in this app. **Acceptance:** checkout, failed payment, duplicate
   webhook, cancellation, renewal, receipts and entitlement tests; clear pricing and
   no charge until an explicit user purchase. Do not invent prices or paid benefits.

7. **Mount the real agent council and task coordinator.** Reuse existing room,
   discussion and orchestration sources. Show connected/working/blocked/offline
   state, private first assessments, bounded debate, verifiable task receipts and
   independent review. **Acceptance:** two real authorized participants exchange a
   task and produce evidence inside the existing app. Scripted fixtures stay labelled.

8. **Connect memory with honest provenance.** Exact notes, decisions, contract
   constraints and task checkpoints remain inspectable records. Neural and directly
   constructed memories remain separate versioned components. **Acceptance:** remember,
   retrieve, correct, forget, conflict resolution, scope isolation and reload tests;
   recorded failed model gates are not overwritten by easier integration results.

9. **Unify persistence and migration.** Preserve world/object IDs, Eyes, tasks,
   discussions, contract receipts and account-connection references. Back up before
   any explicit cross-app migration. **Acceptance:** reload, offline reopen, restart,
   safe cache upgrade and rollback preserve exact records; no second competing ledger.
   A saved job is not described as running without execution evidence.

10. **Verify touch, hands, camera and XR on the actual phone.** Preserve independent
    schedules and per-source cancellation; camera off by default. Test blocked
    permissions, tracking loss, slow acknowledgements and unsupported XR hardware.
    **Acceptance:** Samsung/browser/device runs with recorded latency and failure
    handling. Synthetic or component tests do not establish physical-device success.

11. **Connect each project's real functions and data.** DiamondPulse must expose
    dated fixtures, data provenance and result audits rather than unsupported live
    badges. Neural Lab must retain checkpoint/evaluation provenance. Social, Exchange,
    Contracts and Relics must open their actual implemented operations. **Acceptance:**
    traceable data, real route actions and clear simulation versus external execution.
    Keep Flight Lab and Robot source/jobs under their existing owners; do not overwrite.

12. **Harden operation, updates and security.** Check delegated permissions, stopped
    sources, late replies, provider limits, secret redaction, version-pinned tasks,
    tested plug-in updates, rollback and user-visible errors. **Acceptance:** failure
    injection plus recovery preserves original tasks without automatic unsafe replay.

13. **Release and verify the one user-facing experience.** Confirm original Site
    project identity, publisher access, backend/runtime compatibility and audience.
    Publish reviewed changes through the existing owner, then verify real URLs and
    source/asset revisions. **Acceptance:** phone walkthrough covering a project,
    matching interactive relic, permitted account/task action and exact reopening.
    Local tests and green CI alone are not labelled a completed live product.

## Repair 1 implementation and evidence

Production changes are intentionally limited to:

- `src/vivo-phone-engine/boot.mjs`: install an accessible same-origin current-Field-Lab
  link above the legacy engine panel. Host/route matching prevents injecting it into
  unrelated pages. URL resolution retains the deployment prefix. No redirect, storage
  migration, second engine, account activation, or new network request is introduced.
- `vivo-phone-sw.js`: advance only the existing legacy engine cache namespace from
  v1 to v2 so the updated boot source can reach returning users. Its resource list and
  cache cleanup logic are otherwise identical. Other cache families and IndexedDB
  world stores are not modified. Existing loaded documents may need a normal reload.

`index.html`, `field-lab-studio.html`, `src/field-lab/`, existing runtime/ledger/input/
account code and `.github/workflows/deploy-pages.yml` remain unchanged.

Executed locally with Node v22.16.0 and Chromium:

```sh
node --check src/vivo-phone-engine/boot.mjs
node --check vivo-phone-sw.js
node --test tests/vivo-entry-handoff.test.mjs
python tests/browser_entry_handoff.py
```

- 19 Node tests passed, zero failures/cancellations/skips. Real boot source runs
  against explicit engine/DOM/cache harnesses; route, retention and cache-scope checks.
- 13 Chromium component assertions passed, zero page errors. Actual generated DOM,
  CSS, focus and pointer/keyboard behavior; injected engine and URL, intercepted
  navigation. This is not a full-app, live-site, real storage-migration or device test.
- First browser-harness attempt returned a class expression that Playwright tried
  to invoke. Correcting the fixture to evaluate a callback resolved it; no production
  behavior or assertion was weakened. The passing run is the evidence used here.

New read-only `vivo-entry-handoff.yml` runs these checks on the repair branch/PR and
uploads evidence. It has no deployment step. CI results are separate and must be
read after publication, not assumed from the local counts.

## Next exact step

Review/release repair 1 through the existing repository owner, and verify the
legacy URL's new link with a previously cached browser. Then recover the original
Fabric Site's current source/asset manifest through its own Sites editor. Match the
Village model to the approved reference before moving to the Arena. No replacement
Site, made-up editor URL or new account/payment action is part of this repair.
