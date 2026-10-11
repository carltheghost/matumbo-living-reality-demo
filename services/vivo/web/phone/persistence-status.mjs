/** User-facing status copy for local phone persistence outcomes. */
export function formatPersistenceStatus(action, persistence = {}, result = null) {
  const state = persistence?.state;
  const error = persistence?.error || 'storage failed';
  const memoryOnly = state === 'memory-only' || result?.persistent === false;
  if (state === 'saved' && !memoryOnly) {
    return action === 'release' ? 'Hand released · local state saved.' : 'Saved locally on this device.';
  }
  if (memoryOnly) {
    return action === 'release'
      ? 'Hand released · local state is memory-only and will not survive reload. Retry remains available.'
      : 'Local state changed in memory only; it was not saved across reload. Retry remains available.';
  }
  if (state === 'unsaved') {
    return action === 'release'
      ? `Hand released · local state was not saved: ${error}. Retry remains available.`
      : `Local Vivo state changed but was not saved: ${error}. Retry remains available.`;
  }
  if (state === 'saving') {
    return action === 'release' ? 'Hand released · saving local state…' : 'Saving local state…';
  }
  return action === 'release'
    ? 'Hand released · local state has not been saved yet. Retry remains available.'
    : 'Local state has not been saved yet. Retry remains available.';
}
