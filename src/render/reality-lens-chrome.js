import { resolveRealityLensGroup } from '../domains/reality-lens-engine.js';

// These are views over the existing feature registry, not new feature owners.
export const LENS_SPACES = Object.freeze([
  Object.freeze({ id: 'worlds', label: 'Worlds & rooms' }),
  Object.freeze({ id: 'people', label: 'Your space' }),
  Object.freeze({ id: 'network', label: 'Network & tools' }),
  Object.freeze({ id: 'value', label: 'Value & contracts' }),
  Object.freeze({ id: 'agents', label: 'Agents' }),
  Object.freeze({ id: 'experiences', label: 'Play, media & learning' }),
]);

export function lensSpaceLabel(id) {
  return LENS_SPACES.find(space => space.id === id)?.label ?? id;
}

export function lensDirectory(features, query = '') {
  const term = String(query).trim().toLocaleLowerCase();
  return LENS_SPACES.map(space => ({
    ...space,
    features: features.filter(feature => {
      if (resolveRealityLensGroup(feature.id) !== space.id) return false;
      const text = [space.label, feature.id, feature.label, feature.kicker, feature.description].join(' ').toLocaleLowerCase();
      return !term || text.includes(term);
    }),
  })).filter(space => space.features.length);
}

export function lensRuntimeStatus(state) {
  if (state === 'ready') return '3D ready';
  if (state === 'error') return 'Directory mode · 3D unavailable';
  return 'Loading 3D…';
}
