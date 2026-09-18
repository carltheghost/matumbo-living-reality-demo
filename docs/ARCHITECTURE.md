# maTumbo Living Reality Ω — Architecture

## Canonical direction

```text
role-owned domain projections
        ↓
SIMFABRIC world-state assembler
        ↓
versioned projection envelope
        ↓
Three.js Living Reality renderer
        ↓
simulation-only intent events
```

The browser scene is a projection, not a ledger, identity authority, wallet, signer, settlement engine, gateway, or external action surface.

## Ownership

- Agent 01: Control Tower, integration and release decisions.
- Agent 02: `src/core/` world state, events, and projection envelope.
- Agent 03: `index.html`, `src/main.js`, and `src/render/`.
- Agents 04–13: one bounded module each under `src/domains/`.
- Agent 14: `src/projections/` device/accessibility adapters.
- Agent 15: `tests/` and `scripts/` release gates.

## Runtime

The canonical page is a static Three.js 0.179.1 browser application. Domain modules run as local ES modules and are composed by `src/core/demo-projection.js`. The page publishes the composed world through `window.SIMFABRIC.getProjection()` and the renderer consumes it through `simfabric:projection`/`simfabric:intent` events.

## Safety boundary

Every contribution is `simulation: true`. Financial, identity, cryptographic, gateway, model-execution, publishing, and settlement capabilities are represented as denied or non-authoritative metadata.
