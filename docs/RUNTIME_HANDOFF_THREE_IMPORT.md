# Runtime handoff — Three.js import-map failure

Date: 2026-09-22

## Incident

The GitHub Pages demo showed:

    Local 3-D surface unavailable · UNCAUGHT RUNTIME

with:

    TypeError: Failed to resolve module specifier "three?v=20260922-cache2".
    Relative references must start with either "/", "./", or "../".

## Root cause

The browser import map registers the bare specifier `three`. A cache query attached directly to that bare specifier — for example `three?v=20260922-cache2` — is a different module specifier and is not covered by the import-map key.

The repository had several files containing that invalid pattern while other nested relative imports correctly used query strings.

## Fix

All known invalid bare Three.js imports were changed from:

    import * as THREE from "three?v=20260922-cache2";

to:

    import * as THREE from "three";

The nine affected source files were:

- src/render/hand-presence.js
- src/render/chess-arena.js
- src/render/person-organisms.js
- src/domains/token-vault-ui.js
- src/render/token-lifecycle.js
- src/render/photo-mascot-presence.js
- src/render/token-gamification.js
- src/render/distribution-explorer.js
- src/domains/token-transfers-ui.js

Relative local module imports may continue to use explicit cache-bust queries.

## Regression guard

`tests/three-import-specifier.test.mjs` now checks the affected source modules and fails if a queried bare Three.js specifier is reintroduced.

## Important deployment rule

For browser ES modules:

- `three` = valid import-map key.
- `./module.js?v=...` = valid relative module cache-bust.
- `three?v=...` = invalid unless the import map explicitly contains that exact key.

When the demo shows the red runtime banner again, inspect the browser's first module resolution error and grep the source tree for `three?` before changing unrelated runtime code.
