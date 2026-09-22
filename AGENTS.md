# maTumbo Living Reality Ω — Agent Contract

This folder is the canonical Living Reality source. Agent 01 / Control Tower owns task routing, shared contracts, integration, and merge decisions.

## Non-negotiable rules
- Work only in your assigned Git worktree and branch.
- Read `.tumbo/continuity/STATE.md`, `OWNERSHIP.md`, `INTERFACES.md`, and your packet in `.tumbo/control/tasks/` before editing.
- Do not edit another role's owned paths.
- The Three.js world is a projection. It cannot become a ledger, identity authority, wallet, signing authority, settlement engine, or external execution surface.
- All PAYCORE, Ledger, Contract, T402, and Gateway effects remain local simulation/projection data unless a separately authorized backend exists.
- Run the exact tests in your work packet. Submit a diff and evidence; never merge your own branch.

## Current baseline
The original app is a static Three.js 0.179.1 organ-and-semantic-object study served with `python -m http.server 8080`.

## Canonical UI lock — DO NOT REGRESS
The clean root route is permanently owned by the **Reality Assembly**: the connected translucent/glass cube field implemented by `src/render/reality-assembly.js`. It is the canonical Living Reality landing surface.

- Do **not** replace the root landing with Block World, the old Reality Lens, a constellation overlay, Tab Dock/Tab Engine, Gateway Tentacles, or any other parallel presentation stack.
- Do **not** add a second root presentation layer that can compete with Reality Assembly during boot.
- Do **not** change `resolveDefaultFeature()` away from `reality-lens` for the clean root route without an explicit project-owner decision.
- Keep `tests/reality-assembly-canonical.test.mjs` green. A change that breaks this test is a regression, not a harmless UI experiment.
- If a new UI is proposed, it must be a deliberate feature reachable from the canonical assembly, not a replacement of the root surface.
- The canonical assembly must remain mounted and opened after its renderer exists; async feature mounts must never be allowed to steal the clean landing.

This lock exists because multiple agents previously replaced the intended UI with competing surfaces. Preserve the canonical surface unless the project owner explicitly changes the product decision.
