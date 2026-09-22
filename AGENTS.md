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

## Canonical Living Reality UI lock

The clean root landing is the **connected Block World / Living Reality cube field**. This is the actual glass-cube UI: small connected blocks, visible connection lines, 3-D orbit/zoom, hover/select behavior, and deliberate double-click/double-tap on a portal cube to enter/dive inside it.

Do **not** replace the clean root with the Gateway Tentacles/tentacle cube, a constellation-overview overlay, Tab Dock/Tab Engine, the old Reality Lens presentation, or another competing root presentation. Those are not the canonical landing.

Keep `src/core/default-landing.js` resolving a clean root to `block-world` and keep the cube-first presentation contract/tests green. New experiments may exist as explicit features/routes, but they must not take ownership of the clean root.
