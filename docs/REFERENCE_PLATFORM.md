# Reference platform — observed implementation and gaps

## Label collision handling — 2026-09-08

Projected labels now reserve visible panel rectangles, viewport margins and previously accepted label rectangles. Selected and hovered objects receive placement priority. A label that cannot fit is hidden; its cube, feature identity and searchable catalog entry remain intact. This is presentation-only and does not mutate layout history or domain data.

Fresh receipt `2026-09-08T04:29:58.270Z` passes 24/24 browser checks, adding nonzero visible labels with no label/label or label/panel overlap at the tested desktop overview and compact phone view. All 23 directory feature selections still pass. Full Node suite: 463/463 passed. These sampled poses do not establish collision-free behavior at every possible camera angle, focused-label stability or physical-device performance; per-frame DOM measurement cost still needs profiling. Visual architectural fidelity and full ecosystem requirements remain open.

## Compact phone inspector — 2026-09-08

The inspector can now collapse to a strip no more than 72px high at the tested phone viewport while retaining the selected feature name. Its toggle has a 44px minimum phone target, accurate Expand/Minimize accessible names, `aria-controls` and `aria-expanded`. Expanding with the keyboard restores the feature actions without also toggling cube contents. Selection-name updates remain visible while folded.

Current browser receipt at `2026-09-08T04:27:44.042Z`: 22/22 checks true. New checks measure reduced inspector height, visible compact selection and keyboard restoration of actions. Screenshot: `work/reality-assembly-mobile-compact.png`. Full Node suite rerun: 463/463 passed, zero skipped. The expanded inspector still occupies scene space; collapsing is user-controlled, not an automatic layout or camera-occlusion solution. Physical-device testing remains outstanding.

## Mobile directory fix — 2026-09-08

The existing Assembly now exposes a phone-sized `Find a world` directory with searchable access to all 23 features, 44px minimum directory touch targets, focus-on-open, Escape/close focus restoration, and automatic close after selection. Enter on a native button no longer also toggles the selected cube. Scene-label stacking is contained beneath interactive panels; the first browser run caught a label intercepting the directory toggle after camera movement, and the product stacking fix resolved it without forced clicks.

Fresh receipt `work/reality-assembly-audit.json` at `2026-09-08T04:25:18.057Z` passes 19/19 checks, including actual selection of each of the 23 catalog entries at 390×844, filtering, keyboard selection without opening, directory bounds and focus restoration. `work/reality-assembly-mobile-directory.png` shows the actual filtered directory. Full Node suite remains 463/463 passed. This is browser viewport evidence, not physical phone or headset validation.

This supersedes the hidden-mobile-catalog gap below. Label-to-label collisions and overall reference fidelity remain unresolved; stacking controls above labels does not implement a full collision-avoidance layout. No provider, financial execution or deployment changes were made.

## Assembly audit: 2026-09-08

Local route: `http://127.0.0.1:8081/?feature=reality-lens`.

The existing `scripts/audit-reality-assembly.mjs` was rerun without product-source changes. `work/reality-assembly-audit.json` records 11/11 true checks at `2026-09-08T04:20:59.328Z`, with no reported browser runtime errors. Screenshots from this run: `work/reality-assembly-desktop.png`, `work/reality-assembly-mobile.png`, `work/reality-assembly-timeline.png`.

The checked behaviors are actual equal-axis geometry and 23 nodes; opening an interior; keyboard movement recorded in view history; read-only past state; independent proposed branches; unchanged present when returning from a proposal; existing Contracts owner navigation; mobile toolbar bounds and document overflow; Person navigation in the same application; absence of page errors.

This receipt does NOT check external network activity, source-revision stability, pointer drag accuracy, label occlusion, physical mobile touch, hardware XR, live provider data or financial execution. Do not transfer the Person audit's stronger network checks to this different audit. Current full-suite evidence is separately recorded in `work/current-test-results.log` (463 tests passed).

## Visual review of the actual screenshots

- Desktop labels overlap each other and overlay the catalog, inspector and bottom toolbar. Document overflow checks cannot detect this occlusion.
- The mobile inspector hides a substantial part of the cube field. A bounded panel can still obstruct navigation.
- At widths below 700px, `.assembly-search-label` and `.assembly-catalog` are hidden. The visible scene labels do not establish equivalent searchable access to all features on a phone.
- Materials, lighting, interiors and architectural variety remain substantially simpler than the supplied concept images. Passing interaction tests does not establish reference fidelity.
- The initial selected object is Block World / Fabric while nearby Reality Lens labels compete for attention. Review hierarchy and framing before further visual polish.

## Required next implementation work, not claimed complete

1. Add accessible mobile catalog/search access, preserving existing feature IDs and domain routing.
2. Avoid placing scene labels over UI panels and resolve label collisions; preserve an accessible complete directory when labels are suppressed.
3. Provide a compact/collapsible phone inspector that leaves a usable interaction region, with touch and keyboard evidence.
4. Improve architectural detail, lighting, depth and selected-object framing, then assess actual screenshots against the references.
5. Separately verify pointer hover/open/drag, reduced-motion behavior, touch input, phone performance and real XR hardware.

The existing 4D control is observed local view-state history plus explicitly proposed branches, not live worldwide historical data, physical four-dimensional rendering, predictive certainty or financial settlement history. The scene is designed architecture, not a live city model. Complete accounts, providers, collaboration, media, administration and token execution remain separate unfinished requirements of the full objective.

This continuation audited existing work only. It did not open a new feature packet, deploy, commit, push or enable external execution.
