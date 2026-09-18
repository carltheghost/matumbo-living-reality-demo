# Picture Matter — local statement forge

Open **Picture Matter** from Mission Control or use:

`http://localhost:8080/?feature=picture-matter`

For a shareable live metadata read focused on conflict and humanitarian
context, use:

`http://localhost:8080/?build=control4&fresh=20260828&panel=picture-matter&pictureQuery=war%20conflict%20humanitarian&live=metadata`

The console makes one causal seam visible:

`word object → statement → provenance`

The starting fixture is the local word `reality`. Its interpretation is joined
to the input and to provenance metadata (source, timestamp, uncertainty, and
degraded state). Selecting any record shows the joins. Use **Expand meaning
path** to open a nested, three-stage inspection rail with selectable Word /
Local Input, Statement, and Provenance nodes. Every node keeps its identifier,
source, timestamp, uncertainty, degraded flag, and truth-authority label visible
where applicable; selecting a node from the rail keeps the path open. **Replay
meaning path** walks the same deterministic path in memory, while **Reset view**
returns to the first local input and collapses the rail.

The renderer also exposes a frozen local snapshot for this interaction. It
includes `pathExpanded`, `pathVisible`, and `path` (`sequence`, `input`,
`statements`, and `provenance`) so tests or a host adapter can inspect the
exact causal seam without scraping the DOM. Expand/collapse actions add a
bounded local trace entry and, when supplied, call the optional
`onPathToggle(snapshot)` callback. No action leaves the projection boundary.

## Public metadata rail

The **Public image metadata · optional read** rail is a separate, explicit
host-owned refresh. A user enters a bounded word query (64 characters) and
activates **Refresh metadata**; the host calls the fixed Wikimedia Commons API
search with namespace `6`, an allowlisted `imageinfo` property set, a maximum
of five rows, and `origin=*`. The endpoint is credential-free and browser-safe.

The rail displays the provider, source marker, retrieved time, query, returned
count, canonical Commons source URL, and (when supplied) an
`upload.wikimedia.org` thumbnail URL as text. It never creates an image
element, downloads image bytes, stores or publishes anything, or changes the
local word → statement → provenance path. Provider errors and empty responses
remain visibly `UNAVAILABLE`; no local or fabricated image rows are used as a
fallback.

The renderer accepts a frozen `metadata` envelope and an optional
`onMetadataRefresh({ query, limit, method })` callback. It only presents the
returned envelope; `src/domains/picture-matter-metadata.js` owns URL bounds,
provider allowlists, timeout, response normalization, and fail-closed status.

## Boundary

Picture Matter does not fetch or render remote image bytes, store image bytes,
publish text, decide truth, or create an authoritative evidence service. The
metadata rail is a read-only exception for explicitly requested public JSON
metadata and canonical references; it has no persistence, identity, wallet,
token, settlement, or authority path. Interpretation records are explicitly
non-authoritative; fact-shaped records, if added later, remain unverified. The
implementation is in `src/render/picture-matter.js` and
`src/domains/picture-matter-metadata.js`, covered by
`tests/picture-matter-render.test.mjs` and
`tests/picture-matter-metadata.test.mjs`.
