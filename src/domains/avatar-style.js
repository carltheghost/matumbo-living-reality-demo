/** "Become Tumbo" — local photo-to-avatar style filter.
 *
 * Turns a user's own picture into the Tumbo avatar aesthetic: a black-and-gold
 * grade, teal/violet rim light, contrast + vignette + glow, matching the
 * AI-built bust portrait's look. 100% local: pure pixel math over an input
 * RGBA buffer. No network, no external AI service, no identity verification,
 * no biometric claim — a visual skin only. The photo never leaves the device;
 * results are stored in the browser's own localStorage.
 *
 * Projection only: no wallet, chain, custody, settlement, or authority.
 */

export const AVATAR_FACE_STORAGE_KEY = 'matumbo.person-studio.avatar-face.v1';
export const AVATAR_HOME_STORAGE_KEY = 'matumbo.person-studio.avatar-home.v1';
export const AVATAR_DEFAULT_FACE_URL = 'assets/avatar/avatar-bust.webp';
/** Tumbo's own likeness — his selfies, generated into the black-and-gold
 *  Tumbo avatar style. Offered as a personal face option alongside the
 *  default Tumbo character; the default stays unchanged unless chosen. */
export const AVATAR_TUMBO_PERSONAL_FACE_URL = 'assets/avatar/tumbo-personal.webp';
export const AVATAR_FACE_CHOICE_STORAGE_KEY = 'matumbo.person-studio.avatar-face-choice.v1';

/** The face options Person Studio offers, in presentation order.
 *  `url: null` means "resolved per device" (the user's own styled photo). */
export const AVATAR_FACE_CHOICES = Object.freeze([
  Object.freeze({
    id: 'tumbo',
    label: 'Tumbo character',
    blurb: 'The default Tumbo character.',
    url: AVATAR_DEFAULT_FACE_URL,
  }),
  Object.freeze({
    id: 'tumbo-you',
    label: 'Tumbo — you',
    blurb: "Tumbo's own likeness, in the black-and-gold style.",
    url: AVATAR_TUMBO_PERSONAL_FACE_URL,
  }),
  Object.freeze({
    id: 'your-photo',
    label: 'Your photo',
    blurb: 'Your own picture, styled locally into the Tumbo look. Never uploaded.',
    url: null,
  }),
]);

const AVATAR_FACE_CHOICE_IDS = new Set(AVATAR_FACE_CHOICES.map((c) => c.id));
export const AVATAR_FACE_CHOICE_DEFAULT = 'tumbo';
/** Stored face versions stay small: a 256px JPEG data URL is ~15-40KB. */
export const AVATAR_FACE_MAX_DIM = 256;
const MAX_STORED_BYTES = 1_500_000;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Deterministic PRNG so the film grain is stable per seed. */
function mulberry32(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function validatePixels(pixels, width, height) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0
    || width > 4096 || height > 4096) throw Error('stylizeTumboPortrait needs sane dimensions');
  if (!pixels || pixels.length !== width * height * 4) throw Error('stylizeTumboPortrait needs an RGBA buffer');
}

/**
 * Pure stylization: (pixels, width, height, seed) -> new RGBA buffer.
 * Deterministic: the same input + seed always yields byte-identical output.
 */
export function stylizeTumboPortrait(pixels, width, height, { seed = 7 } = {}) {
  validatePixels(pixels, width, height);
  const n = width * height;
  const src = pixels;
  // Work in float RGB; alpha passes through untouched.
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = src[i * 4] / 255; g[i] = src[i * 4 + 1] / 255; b[i] = src[i * 4 + 2] / 255;
  }

  // Pass 1 — black-and-gold grade + contrast/saturation S-curve.
  for (let i = 0; i < n; i++) {
    const luma = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i];
    const contrast = clamp01((luma - 0.5) * 1.35 + 0.5);
    let R = (r[i] - luma) * 1.25 + contrast;
    let G = (g[i] - luma) * 1.25 + contrast;
    let B = (b[i] - luma) * 1.25 + contrast;
    // Deepen the blacks, keep them warm.
    const shadow = 1 - clamp01(luma / 0.45);
    R += 0.06 * shadow; B -= 0.05 * shadow;
    // Gold lives in the midtones.
    const mid = Math.sin(Math.PI * clamp01(luma));
    R += 0.10 * mid; G += 0.05 * mid; B -= 0.08 * mid;
    r[i] = R; g[i] = G; b[i] = B;
  }

  // Pass 2 — teal/violet rim light by distance from center, plus vignette.
  const TEAL = [0x2f / 255, 0xe8 / 255, 0xd4 / 255];
  const VIOLET = [0x8b / 255, 0x46 / 255, 0xff / 255];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const nx = (x / width - 0.5) * 2, ny = (y / height - 0.5) * 2;
      const dist2 = nx * nx + ny * ny;
      const edge = clamp01(dist2 - 0.35);
      if (edge > 0) {
        const tealW = edge * (0.5 - nx * 0.5) * 0.38;
        const violetW = edge * (0.5 + nx * 0.5) * 0.38;
        r[i] = r[i] * (1 - tealW - violetW) + TEAL[0] * tealW + VIOLET[0] * violetW;
        g[i] = g[i] * (1 - tealW - violetW) + TEAL[1] * tealW + VIOLET[1] * violetW;
        b[i] = b[i] * (1 - tealW - violetW) + TEAL[2] * tealW + VIOLET[2] * violetW;
      }
      const vignette = 1 - 0.45 * clamp01(dist2);
      r[i] *= vignette; g[i] *= vignette; b[i] *= vignette;
    }
  }

  // Pass 3 — glow: a cheap half-res box blur of the highlights, screen-blended.
  const hw = Math.max(1, width >> 1), hh = Math.max(1, height >> 1);
  const blur = new Float32Array(hw * hh * 3);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      let R = 0, G = 0, B = 0, c = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = Math.min(width - 1, x * 2 + dx), sy = Math.min(height - 1, y * 2 + dy);
        const si = sy * width + sx;
        const luma = 0.2126 * r[si] + 0.7152 * g[si] + 0.0722 * b[si];
        const w = luma > 0.55 ? (luma - 0.55) * 2 : 0; // highlights only
        R += r[si] * w; G += g[si] * w; B += b[si] * w; c += w;
      }
      const o = (y * hw + x) * 3, k = c > 0 ? 1 / c : 0;
      blur[o] = R * k; blur[o + 1] = G * k; blur[o + 2] = B * k;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const bo = ((y >> 1) * hw + (x >> 1)) * 3;
      // screen blend at low strength
      r[i] = 1 - (1 - r[i]) * (1 - blur[bo] * 0.35);
      g[i] = 1 - (1 - g[i]) * (1 - blur[bo + 1] * 0.35);
      b[i] = 1 - (1 - b[i]) * (1 - blur[bo + 2] * 0.35);
    }
  }

  // Pass 4 — seeded film grain.
  const rand = mulberry32(seed);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const grain = (rand() - 0.5) * 0.05;
    out[i * 4] = clamp01(r[i] + grain) * 255;
    out[i * 4 + 1] = clamp01(g[i] + grain) * 255;
    out[i * 4 + 2] = clamp01(b[i] + grain) * 255;
    out[i * 4 + 3] = src[i * 4 + 3];
  }
  return Object.freeze({ data: out, width, height });
}

function validDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/')
    && value.length > 100 && value.length <= MAX_STORED_BYTES;
}

/** Persist the photo + stylized face on this device only. Never throws. */
export function saveAvatarFace(storage, { photoDataURL, stylizedDataURL } = {}) {
  if (!storage) return false;
  if (!validDataUrl(photoDataURL) || !validDataUrl(stylizedDataURL)) return false;
  try {
    storage.setItem(AVATAR_FACE_STORAGE_KEY, JSON.stringify({
      photoDataURL, stylizedDataURL, savedAt: Date.now(), localOnly: true,
    }));
    return true;
  } catch { return false; } // quota or privacy mode: the look just doesn't persist
}

export function loadAvatarFace(storage) {
  if (!storage) return null;
  let raw = null;
  try { raw = storage.getItem(AVATAR_FACE_STORAGE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return null;
    if (!validDataUrl(saved.photoDataURL) || !validDataUrl(saved.stylizedDataURL)) return null;
    return Object.freeze({ photoDataURL: saved.photoDataURL, stylizedDataURL: saved.stylizedDataURL });
  } catch { return null; }
}

export function clearAvatarFace(storage) {
  if (!storage) return false;
  try { storage.removeItem(AVATAR_FACE_STORAGE_KEY); return true; } catch { return false; }
}

/** Persist which face option the user picked. Never throws. */
export function saveAvatarFaceChoice(storage, choiceId) {
  if (!storage || !AVATAR_FACE_CHOICE_IDS.has(choiceId)) return false;
  try { storage.setItem(AVATAR_FACE_CHOICE_STORAGE_KEY, choiceId); return true; }
  catch { return false; }
}

/** Load the saved face choice; unknown or missing values fall back to the
 *  default Tumbo character. Never throws. */
export function loadAvatarFaceChoice(storage) {
  if (!storage) return AVATAR_FACE_CHOICE_DEFAULT;
  let raw = null;
  try { raw = storage.getItem(AVATAR_FACE_CHOICE_STORAGE_KEY); } catch { return AVATAR_FACE_CHOICE_DEFAULT; }
  return AVATAR_FACE_CHOICE_IDS.has(raw) ? raw : AVATAR_FACE_CHOICE_DEFAULT;
}

/** Resolve the face texture URL for this device:
 *  the chosen option, with graceful fallbacks (a "your photo" choice with no
 *  saved photo falls back to the default Tumbo character). Always returns a
 *  usable URL string; never throws. */
export function resolveAvatarFaceUrl(storage) {
  const choice = loadAvatarFaceChoice(storage);
  if (choice === 'tumbo-you') return AVATAR_TUMBO_PERSONAL_FACE_URL;
  if (choice === 'your-photo') {
    const saved = loadAvatarFace(storage);
    if (saved) return saved.stylizedDataURL;
  }
  return AVATAR_DEFAULT_FACE_URL;
}

function validHome(value) {
  return value && typeof value === 'object'
    && [value.x, value.y, value.z].every((v) => Number.isFinite(v) && Math.abs(v) <= 100);
}

/** Persist the avatar's 3D home position on this device only. Never throws. */
export function saveAvatarHome(storage, home) {
  if (!storage || !validHome(home)) return false;
  try {
    storage.setItem(AVATAR_HOME_STORAGE_KEY, JSON.stringify({ x: home.x, y: home.y, z: home.z }));
    return true;
  } catch { return false; }
}

export function loadAvatarHome(storage) {
  if (!storage) return null;
  let raw = null;
  try { raw = storage.getItem(AVATAR_HOME_STORAGE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const home = JSON.parse(raw);
    return validHome(home) ? Object.freeze({ x: home.x, y: home.y, z: home.z }) : null;
  } catch { return null; }
}
