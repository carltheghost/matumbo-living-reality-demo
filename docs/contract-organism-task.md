# Contract organism integration

## Model-switch continuation

The detailed current-state handoff and ordered remaining work are in `contract-organism-handoff.md` beside this document (the initial snapshot is also preserved as `../../../CONTINUE-CONTRACT-ORGANISM.md` in the local task root). Read it before resuming. Latest root wiring has 128 passing focused tests and desktop/phone service-contract browser verification. Legacy-market/failure-path browser verification and three documented persistence edge cases remain; do not restart the project or assume the goal complete.

User objective: readable information that forms and acts with its object; comprehensive usable contract workflows that automate after creation and approval. Reference all nine supplied images, especially image 9.

Task branch: `codex/contract-organism-2026-09-24`, based on committed Reality Lens surface work `e7249f5`. Do not merge or publish. Preserve the source worktrees' unrelated uncommitted changes.

The exported repository has AGENTS.md but no referenced continuity, ownership, interface, or task-packet files. This document records the current task's local coordination; it does not create external authority.

## Ownership

- Root: integration in main.js, runtime observation adapters, persistence wiring, browser verification and this report.
- Contract engine lane: new domains/contract-automation.js and its domain tests. Existing financial/projection authorities stay intact.
- Workbench lane: new render/contract-workbench.js and CSS plus its tests.
- Surface lane: living-surface-layout-engine, Reality Assembly surface rendering/styles and focused surface tests. Preserve the canonical landing, focus/navigation and right-side rail.

## Interfaces

Contract automation owns immutable local terms, approval, evidence evaluation, deduplication, history and explicit simulation receipts. Three.js projects that state only. No wallet, real funds, signatures, legal enforceability, external execution or provider authority is implied.

Primary engine API: createContractAutomation({now,storage,onEvent}), listTemplates(), create(input), approve(id,{actor}), observe(evidence), tick(), pause(id,{actor}), resume(id,{actor}), cancel(id,{actor}), dispute(id,{actor,reason}), resolveDispute(id,{actor,resolution}), get(id), list(), snapshot(), subscribe(listener). Engine lane will publish exact field schema before workbench integration.

Workbench mount API: mountContractWorkbench({root,engine,onSelect}). Render readable native controls inside the selected object's living surface and give changes back through the domain engine.

## Verification requirements

- Tests for each contract template and created -> approval -> evidence -> automatic receipt without manual resolve.
- No execution before required approvals, on stale/missing evidence, while paused/disputed, or beyond approved limits.
- Duplicate observations and reload cannot duplicate effects; immutable approved terms; schema-checked import/persistence; clear offline/errors.
- Universal surface geometry/layout, stable mobile resize/touch, readable controls and attached content at varied camera angles.
- Full node test suite, syntax checks and actual desktop/mobile browser workflow with screenshots. Actual XR device support remains unverified unless exercised.
- Completion remains unproven until the full requirement audit is supported by current evidence.
