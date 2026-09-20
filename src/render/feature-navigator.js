/**
 * Mission Control for the local Living Reality projection.
 *
 * This is deliberately a DOM adapter, not a second source of truth. It
 * indexes the canonical SIMFABRIC contribution envelope and gives the viewer
 * an explicit way to open each feature that is present in the demo. A feature
 * can describe a future capability, but this surface never grants one.
 */

export const FEATURE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "reality-lens",
    label: "Reality Lens Ω",
    kicker: "semantic zoom",
    focusOrganId: "logo",
    sources: [],
    description: "Navigate reference-built architectural cubes, expose interiors, enter existing features, move their local layout and inspect observed view history or proposed branches.",
    boundary: "One feature identity across views. 4D is space plus recorded local layout history; proposed branches are not predictions, shared worlds or financial execution.",
  }),
]);

export const FEATURE_FUTURE_OPTIONS = Object.freeze([]);
const FEATURE_BY_ID = new Map(FEATURE_DEFINITIONS.map((feature) => [feature.id, feature]));
export const FEATURE_HANDOFF_LINKS = Object.freeze({});
export function createFeatureNavigator() {
  return Object.freeze({ open() {}, close() {}, select() {}, destroy() {} });
}
export default createFeatureNavigator;
