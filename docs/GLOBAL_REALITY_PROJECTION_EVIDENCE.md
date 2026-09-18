# Global Reality Projection evidence

Packet 120 adds one explicit cube-first entry point to the existing World
Pulse surface: **PROJECT LIVE WORLD PULSE** in the Launch Kit. The control is
still a local same-page hand-off; it calls the existing `openWorldEvents`
handler, which opens the World Events console and performs its single explicit
public refresh through the already-mounted `worldEventsConsole.refresh`
callback.

The initial projection remains honest and empty. Until that control (or the
existing World Pulse refresh control) is activated, the event record list and
event cubes remain unavailable; no bundled fallback rows are introduced. Once
the provider envelope returns, the existing World Pulse renderer projects only
returned event records as `BoxGeometry` cubes. Existing record selection,
double-activation/open, and bounded drag/move paths remain the interaction
surface; this slice adds no provider, geocoder, severity/casualty/truth claim,
media stream, wallet, transfer, persistence, or execution authority.

Static wiring is covered in `tests/world-events-integration.test.mjs`. The
renderer test in `tests/world-events-render.test.mjs` verifies no-data before
activation, exactly one refresh callback after activation, and a returned row
after the callback resolves.

## Browser receipt

`work/audit-global-reality-projection-120.mjs` replays the Launch Kit route at
`http://[::1]:8080/?build=control4&fresh=20260828&panel=launch-kit&global=120`.
Before the handoff it records 0 returned records and 0 event cubes. After the
single click it observed five fixed public reads (GDELT DOC 2.0, New York
Times World RSS, USGS Earthquakes, NASA EONET, and UNHCR), received 9 event
records (6 with provider coordinates), and rendered 9 `BoxGeometry` cubes.
The receipt then opened the first returned cube, found its nested source/time/
place contents, moved it by one bounded local step, and verified that no new
provider request occurred. The run finished with 0 page errors, no camera
stream, no image/audio/iframe nodes, and `passed: true` in
`work/audit-global-reality-projection-120.json`; the visual receipt is
`work/global-reality-projection-120.png`.
