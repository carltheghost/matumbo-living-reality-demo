export const PROFILES = Object.freeze({
  phone: Object.freeze({
    id: 'phone',
    label: 'Phone',
    viewport: Object.freeze({ width: 390, height: 844 }),
    orientation: 'portrait',
    input: Object.freeze(['touch', 'voice', 'gaze']),
    camera: 'rear',
    accessibility: Object.freeze({
      screenReader: true,
      largeText: true,
      reducedMotion: true
    })
  }),
  desktop: Object.freeze({
    id: 'desktop',
    label: 'Desktop',
    viewport: Object.freeze({ width: 1440, height: 900 }),
    orientation: 'landscape',
    input: Object.freeze(['touch', 'voice', 'hand', 'gaze']),
    camera: 'webcam',
    accessibility: Object.freeze({
      screenReader: true,
      largeText: true,
      reducedMotion: true
    })
  }),
  'ar-glasses': Object.freeze({
    id: 'ar-glasses',
    label: 'AR Glasses',
    viewport: Object.freeze({ width: 1920, height: 1080 }),
    orientation: 'landscape',
    input: Object.freeze(['gaze', 'pinch', 'hand', 'voice', 'xr']),
    camera: 'world-facing',
    accessibility: Object.freeze({
      screenReader: false,
      largeText: true,
      reducedMotion: true
    })
  })
});

export function getProfile(id) {
  if (!Object.hasOwn(PROFILES, id)) throw new Error(`Unknown device profile: ${id}`);
  return PROFILES[id];
}

export function listProfiles() {
  return ['phone', 'desktop', 'ar-glasses'];
}
