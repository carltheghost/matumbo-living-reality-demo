const GESTURE_MAP = Object.freeze({
  tap: 'select',
  'two-finger-pinch': 'zoom',
  swipe: 'navigate',
  'long-press': 'inspect'
});

export const PHONE_PROFILE = Object.freeze({
  id: 'phone',
  input: Object.freeze(['touch', 'voice']),
  viewport: 'small',
  maxVisibleObjects: 6,
  labelStrategy: 'compact',
  gestureMap: GESTURE_MAP
});

export function resolveGesture(name) {
  if (!Object.prototype.hasOwnProperty.call(PHONE_PROFILE.gestureMap, name)) {
    throw new Error(`Unknown phone gesture: ${name}`);
  }

  return PHONE_PROFILE.gestureMap[name];
}
