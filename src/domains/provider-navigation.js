// Navigation opens a local surface. Only explicit refresh operations may ask
// a public provider for data; unknown methods fail closed with the others.
export function featureSelectionMayRefreshProvider(method) {
  return ["provider-refresh", "explicit-live-route"].includes(String(method));
}
