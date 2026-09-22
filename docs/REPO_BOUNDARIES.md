# Repository boundaries — Living Reality

This repository contains several kinds of material that were previously allowed to bleed into one another while multiple agents pushed directly to `main`. This file is now the integration boundary.

## 1. White paper

The white paper is **documentation/explanation**, not a runtime feature.

- Canonical reader: `paper.html` / `paper-live.html`.
- Runtime document code may render the paper, but the paper must not become a world object, feature cube, feature-directory entry, or domain-state contribution.
- White-paper text explains the product; it does not define authority, money, identity, or external execution.
- The in-app **EXPLAIN · WHITE PAPER** control is a documentation surface, not a feature route.

## 2. Product / demo

The default `index.html` experience is the Living Reality demo.

- `src/main.js` owns browser orchestration.
- `src/core/` owns canonical local projection/state assembly.
- `src/domains/` owns bounded domain contributions.
- `src/render/` owns presentation adapters.
- `tests/` owns release gates.

A domain contribution must represent a thing the demo actually models. Documentation does not belong in the projection envelope.

## 3. Agent work

Parallel agents must not add a new concept directly to the feature registry merely because it appears in a brief or white paper.

Before implementation, classify the work as exactly one of:

1. documentation,
2. core state/projection,
3. bounded domain,
4. renderer/UI,
5. test/release tooling.

If it spans categories, the integration owner decides the seam.

## 4. Integration rule

No agent should push unrelated work directly to `main`. Work lands through a named branch and reviewable integration commit/PR. Existing behavior is preserved unless the change explicitly owns that surface.

## 5. Cleanup principle

When two agents implement the same concept under different names, do not keep both versions “just in case.” Choose one canonical owner, connect the presentation to it, and retire the duplicate path.

