JavaScript
const AR_GLASSES_PROFILE = Object.freeze({
  name: 'ar-glasses',
  input: Object.freeze(['hand', 'gaze', 'pinch', 'voice']),
  primaryPointer: 'gaze-dwell',
  viewport: 'stereo',
  keyboardRequired: false,
  mouseRequired: false
});

const PHONE_PROFILE = Object.freeze({
  name: 'phone',
  input: Object.freeze(['touch', 'voice']),
  primaryPointer: 'touch',
  viewport: 'mono',
  keyboardRequired: false,
  mouseRequired: false
});

const DESKTOP_PROFILE = Object.freeze({
  name: 'desktop',
  input: Object.freeze(['voice', 'gaze']),
  primaryPointer: 'gaze-dwell',
  viewport: 'mono',
  keyboardRequired: false,
  mouseRequired: false
});

export { AR_GLASSES_PROFILE };

export function resolveProfile(deviceType) {
  switch (deviceType) {
    case 'phone':
      return PHONE_PROFILE;
    case 'desktop':
      return DESKTOP_PROFILE;
    case 'ar-glasses':
      return AR_GLASSES_PROFILE;
    default:
      throw new Error(`Unknown device type: ${deviceType}`);
  }
}

export function requiresKeyboardOrMouse(profile) {
  return profile.keyboardRequired || profile.mouseRequired;
}