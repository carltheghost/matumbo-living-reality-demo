# Reality Lens browser usability and geometry review

Verified October 3, 2026 against the working checkout `work/reality-lens`, branch `fix/reality-lens-calm-2026-10-03`, base commit `a12462cd865dc094a44c58f6d11ef8061eb7b79e`. This records local working-tree behavior; it is not deployment or CI evidence.

The final structured audit covers all 36 routes at desktop 1440 × 1000 and phone 390 × 844. Each route was opened through the actual Spaces directory, with its search retaining keyboard focus. Enabled visible controls were scrolled into their real owning surface and checked with `elementFromPoint`. Available native Close buttons were clicked with real pointer coordinates; the actual Back control returned to the space view.

| Check | Verified result |
| --- | --- |
| Route opening, search and Back | 72 / 72 |
| Attached information fronts compared with their real 3D owner | 68 / 68 |
| Largest difference between actual and projected face bounds | 1.50 px |
| Enabled visible controls reachable after scrolling | 1,177 / 1,177 |
| Available native Close controls receiving a real click and hiding their panel | 66 / 66 |
| Substantive local workflows | 6 / 6 |
| Browser page errors | 0 |
| Visible legacy chrome or unrelated panels | 0 |
| Document horizontal overflow | 0 |
| Final audit JSON parse / NUL bytes | Valid JSON / 0 |

The geometry check observes the actual Three.js renderer through its optional devtools hook. It compares the CSS3D skin's physical width and height against its owning face, then projects that same face through the actual camera and compares its rectangle with the DOM rectangle. It does not create an alternative camera or change game state. Person Studio and the Reality Lens overview use separate presentations and are excluded from the 68 attached-face comparisons. Person Studio's profile, wardrobe, pose and companion evidence is recorded separately in `avatar-input-browser-verification.json`.

## Defects found and repaired

- Wave-shaped bodies cut up to 13% from their upper and lower edges, while their content had only 20px padding. Close buttons and final rows fell outside the visible contour. Attached waves now use height-based safe insets and matching scroll padding.
- Web + AI's older flexible inner viewport could overlap its boundary text and controls; its two header buttons could also occupy the same rectangle. Its owning body now supplies one scroll flow, and its header buttons have separate positions.
- Contract Workshop injected a more-specific `!important` width of up to 1120px. The interactive skin consequently stretched far beyond the actual phone-shaped body. Native sizing now authoritatively sets the composed width, height and min/max constraints as inline important properties. The original inline style is restored when the surface detaches.
- Reducing a desktop grid to one column left children's explicit second-column placements intact. Contract fields collapsed into narrow vertical strips beside the toolbar. Compact attached grids now reset their child placements as well as their columns. Native select values stay on one line.
- Rooms retained a legacy transform entrance transition. As CSS3D updated the body every frame, its skin continually lagged behind the body during camera travel. Attached roots now use the actual current transform immediately. The former failing bounds measurement remains in the audit retry history; its fresh corrected check passes.

The separate native sizing regression uses a clearly labeled deliberate `777px !important` inline fixture. On both screen sizes, the attached skin conforms to the actual physical phone face, the Source mode control is readable at approximately 352px / 204px wide, and the complete original inline style restores exactly at detachment before the ordinary panel manager resumes ownership. Both corrected form screenshots were visually reviewed.

## Workflow evidence

| Workflow | Actual result | Boundary |
| --- | --- | --- |
| Block World | Added one cube, 102 → 103 draft blocks; inspected the selected Crystal cube | Renderer-only local draft |
| Academy | Answered a lesson correctly, 0 → 1 completed, +30 demo XP | Local educational session; no credential |
| Rooms | Entered `room:reality`, then left; entered room became null | Simulated membership metadata |
| Neural Mesh | Replay appended one advisory trace | Local advisory projection; no provider/tool access |
| Contract Atelier | Created terms, approved as two simulated roles, recorded matching test evidence, completed with one receipt | Simulated 100 TUMBO points; no authentic signature or settlement |
| Chess | Selected e2 on the real canvas and moved to e4; SAN `e4`, Black to move | Actual local chess rules and pointer interaction |

## Evidence files

- `usability-audit.json`: complete final route, control, geometry, workflow and retry evidence.
- `usability-gallery.html`: compact interactive viewer for the six contact sheets. It needs only the six `usability-screens/gallery-*.png` images, not all 72 individual captures.
- `usability-gallery-full.html`: local full-size drill-down gallery, requiring the individual route screenshots.
- `usability-screens/gallery-desktop-1.png`, `gallery-desktop-2.png`, `gallery-desktop-3.png`: all 36 desktop captures.
- `usability-screens/gallery-phone-1.png`, `gallery-phone-2.png`, `gallery-phone-3.png`: all 36 phone captures.
- `native-sizing-restoration.json`: actual legacy important sizing and detachment restoration regression.
- `usability-screens/corrected-desktop-contracts-form.png` and `corrected-phone-contracts-form.png`: readable form on its real object front.
- `usability-screens/workflow-chess.png`: actual completed e4 move.
- `native-layout-tests.tap`: 46 relevant existing layout tests passed after the sizing and compact-layout changes.

The six final contact sheets were reviewed visually. The individual captures remain local; a repository evidence package can use the compact gallery, six contact sheets, structured JSON, sizing regression and the three selected workflow/form screenshots to stay well below 20MB.

## Reproduction

Run from the actual repository with its configured bridge listening on 8082. The verified server process command was Python `scripts/provider_bridge.py --port 8082` from this checkout; the restored process was PID 11560. The served module graph was revision `20261003-complete8`.

```powershell
$env:AUDIT_PHASE = 'all'
node ..\..\outputs\reality-lens-review\usability-audit.cjs
node ..\..\outputs\reality-lens-review\native-sizing-restoration.cjs
node ..\..\outputs\reality-lens-review\usability-gallery.cjs
```

The audit defaults to `http://127.0.0.1:8082/`; set `REALITY_LENS_URL` for another configured preview. `AUDIT_PHASE=retry` retests only failed routes while retaining their previous evidence. Audit JSON uses a flushed temporary sibling followed by atomic rename, so a reader sees a complete report.

Chromium used SwiftShader software WebGL and fresh isolated browser profiles. Phone results are viewport emulation, not physical-phone measurements. Generic route checks did not refresh external providers or probe accounts. Hardware XR, physical camera/microphone, authenticated identity, external signing/settlement and unavailable credentialed providers remain unverified. The workflow records explicitly label all local simulation fixtures. No commit, push, merge or deployment was performed by this reviewer.
