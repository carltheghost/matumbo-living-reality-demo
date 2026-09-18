# maTumbo demo scope and next gates

This is the working product audit for the local social-experiment / space-
explorer demo. It keeps the ambitious idea intact while distinguishing a
verified local rehearsal from a capability that would need a separate service,
consent flow, security review, or legal/operational authority.

## Verified in the current browser

| Idea from the brief | Current surface | Evidence | Boundary |
|---|---|---|---|
| One Living Reality with semantic zoom | Reality Lens Ω, Person Ω, 11-organ scene | 21-feature directory; 19 explicit portal destinations; projection tests | renderer projection, not canonical authority |
| Minecraft-like blocks | Block World / Fabric | cube-only route with click selection, direct pointer/touch drag, open/close, nested inspection, bounded movement, Grab / Hold-step / Place, add/replace/remove draft controls, and data-only JSON snapshot export/import | in-memory local draft only; no external world sync |
| Migrate old concepts into blocks | Migration Bridge | six-entry manifest, JSON snapshot preview/apply, and Merge 4 adapter review | fixed manifest / fixture-only; arbitrary project import and server write are separate |
| TUMBO as an asset token | TUMBO Asset Token | fixed 1,000,000,000 TUMBO-SIM schedule and release checks | fictional simulation; no issuance or money |
| Full launch allocation story | Launch Distribution | 18 aggregate cohorts reconcile to 100% | no recipient addresses, wallets, or transfers |
| Shareable launch proof | Launch Rehearsal Receipt | exact 18-cohort / 10,000-basis-point / 1,000,000,000 TUMBO-SIM receipt with serialized JSON and validated user-triggered Download JSON export | local proof/export of demo math; not an issuance or distribution receipt and never an external share |
| Re-market / social experiment | Social Explorer / Re-market | discover, discuss, create, allocate-preview controls | local rehearsal; no social network, price, or market |
| Contracts, pools, value flow | Contracts + Pools, PAYCORE, T402 | selectable records and replay/reset traces | no signing, custody, transfer, settlement, or payment rail |
| Proof and agent concepts | Prime Ledger + EchoProof, Neural Mesh, Picture Matter | linked journal/proof, agent graph, statement/provenance consoles | non-authoritative, advisory, and local-only |
| Gateway / oracle seam | World Gateway / Evidence | public-source observation → uncertainty → provider status console | no truth, completeness, response, or external-action claim |
| Live sports context | Tennis Evidence / ATP · WTA | public ESPN scoreboard/ranking/competition/linescore read with source URLs and completeness-only grades | no odds, betting, performance, outcome, persistence, or sports authority |
| Phone / PC / VR / AR idea | Phone / PC / XR | shared-world profile readout and fallback metadata | XR is not-tested; no session or parity claim |
| Camera-controlled navigation | Camera Motion | opt-in frame-difference adapter and fallback tests | no face recognition, recording, storage, or upload |
| Space-explorer launch | local static launch scripts | HTTP 200 at `http://localhost:8080/`, exact vendored Three.js 0.179.1 runtime, and optional memory API | local demo; live provider refreshes still require network access |

## Next implementation gates

1. **Safe snapshot migration** — completed in packet 33: data-only JSON validates
   and previews allowlisted legacy records into the existing block draft.
2. **Merge 4 adapter review** — completed in packet 35: the tested in-memory
   snapshot contract is now visible from Migration Bridge → Migration Snapshot;
   PostgreSQL remains separate from the renderer and no server write is wired.
3. **Next bounded renderer surface** — choose the next local/replayable seam
   from the audit. Keep any provider, multiplayer, persistence, XR, or economic
   authority behind its own identity, consent, security, and deployment gates.
4. **Real multiplayer/provider/XR work** — separate projects with explicit
   identity, consent, credentials, threat-model, parity, performance, and
   deployment gates. They must not be smuggled into this static demo.
5. **Any real TUMBO distribution** — requires an independently authorized token
   design, recipient/identity policy, wallet and custody model, signing and
   settlement infrastructure, legal review, and production monitoring. The
   current demo must remain a simulation until those gates are actually met.

## Verification rule

An item is called implemented here only when the source contract, local UI, and
focused tests agree and the route is exercised in a browser. A label, decorative
3-D object, or green unit test without a connected interaction is not treated as
completion evidence.
