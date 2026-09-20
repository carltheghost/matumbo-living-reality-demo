/** "Become Tumbo" — everyone's avatar is a chibi of THEM.
 *
 * Tumbo's avatar law: every avatar is a cute chibi — a fluffy creature with
 * headphones whose face keeps the person's ACTUAL likeness (their real eyes,
 * brows, nose, mouth, beard, hair) simplified into chibi proportions, with
 * the fluffy fur tinted to THEIR COLOR too. The big human portrait bust is
 * retired.
 *
 * The local flow: the photo's face is center-cropped, resampled into the
 * fluffy template's blank face oval, chibi-fied (softened, gentle comic
 * grade — every feature stays where the photo put it), and composited with
 * a feathered mask; the template's fur is tinted toward the sampled skin
 * tone while keeping its fluffy shading. 100% local: pure pixel math over
 * input RGBA buffers. No network, no external AI service, no identity
 * verification, no biometric claim — a visual skin only. The photo never leaves the device;
 * results are stored in the browser's own localStorage.
 *
 * Projection only: no wallet, chain, custody, settlement, or authority.
 */

export const AVATAR_FACE_STORAGE_KEY = 'matumbo.person-studio.avatar-face.v1';
export const AVATAR_HOME_STORAGE_KEY = 'matumbo.person-studio.avatar-home.v1';
/** The default avatar face: the neutral fluffy template as-is. */
export const AVATAR_DEFAULT_FACE_URL = 'assets/avatar/fluffy-body-template.webp';
/** The neutral fluffy body template the Become Tumbo flow builds chibis on. */
export const AVATAR_FLUFFY_BODY_TEMPLATE_URL = 'assets/avatar/fluffy-body-template.webp';
/** Tumbo's own chibi — warm brown fur, his skin-tone cartoon face, locs
 *  peeking out. Replaces the retired portrait bust as the "tumbo-you" face. */
export const AVATAR_TUMBO_CHIBI_FACE_URL = 'assets/avatar/tumbo-chibi.webp';
export const AVATAR_FACE_CHOICE_STORAGE_KEY = 'matumbo.person-studio.avatar-face-choice.v1';

/** The comic photo-mascot looks: Tumbo's real likeness in comic ink, one
 *  face-choice entry per look. `look` maps to the photo-mascot-set look ids
 *  (hoodie/hat/float/outfit); `url` is the texture the 2D placements wear. */
export const AVATAR_PHOTO_MASCOT_LOOKS = Object.freeze([
  Object.freeze({
    id: 'photo-hoodie',
    label: 'You · TUMBO hoodie',
    blurb: 'Your comic photo mascot — black TUMBO hoodie.',
    look: 'hoodie',
    url: 'assets/avatar/photo-mascot/tumbo-hoodie.png',
  }),
  Object.freeze({
    id: 'photo-hat',
    label: 'You · snapback',
    blurb: 'Your comic photo mascot — snapback hat.',
    look: 'hat',
    url: 'assets/avatar/photo-mascot/tumbo-hat.png',
  }),
  Object.freeze({
    id: 'photo-float',
    label: 'You · floating',
    blurb: 'Your comic photo mascot — floating pose.',
    look: 'float',
    url: 'assets/avatar/photo-mascot/tumbo-float.png',
  }),
  Object.freeze({
    id: 'photo-outfit',
    label: 'You · jacket',
    blurb: 'Your comic photo mascot — dark casual jacket.',
    look: 'outfit',
    url: 'assets/avatar/photo-mascot/tumbo-outfit.png',
  }),
]);

const PHOTO_MASCOT_LOOK_BY_CHOICE = new Map(
  AVATAR_PHOTO_MASCOT_LOOKS.map((entry) => [entry.id, entry.look]),
);

/** Map a face-choice id to its photo-mascot look id, or null for non-photo
 *  choices. Lets render modules sync the mascot's persisted look when a
 *  photo look is chosen in Person Studio. Never throws. */
export function avatarFaceChoiceToMascotLook(choiceId) {
  return PHOTO_MASCOT_LOOK_BY_CHOICE.get(choiceId) ?? null;
}

/** The face options Person Studio offers, in presentation order.
 *  The photo mascot ("You") leads; the default character and the on-device
 *  "your photo" (Become Tumbo) stay as options. `url: null` means
 *  "resolved per device" (the user's own chibi). */
export const AVATAR_FACE_CHOICES = Object.freeze([
  ...AVATAR_PHOTO_MASCOT_LOOKS,
  Object.freeze({
    id: 'tumbo',
    label: 'Chibi character',
    blurb: 'The default chibi — cream fur, headphones, ready for anyone.',
    url: AVATAR_DEFAULT_FACE_URL,
  }),
  Object.freeze({
    id: 'tumbo-you',
    label: "Tumbo's chibi",
    blurb: "Tumbo's own chibi — his likeness, locs, beard, headphones.",
    url: AVATAR_TUMBO_CHIBI_FACE_URL,
  }),
  Object.freeze({
    id: 'your-photo',
    label: 'Your chibi',
    blurb: 'Your likeness as a chibi, made on this device. Never uploaded.',
    url: null,
  }),
]);

const AVATAR_FACE_CHOICE_IDS = new Set(AVATAR_FACE_CHOICES.map((c) => c.id));
/** New users start as the photo mascot (hoodie look): "it's be you". */
export const AVATAR_FACE_CHOICE_DEFAULT = 'photo-hoodie';
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
    || width > 4096 || height > 4096) throw Error('pixel pipeline needs sane dimensions');
  if (!pixels || pixels.length !== width * height * 4) throw Error('pixel pipeline needs an RGBA buffer');
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

/** The blank face oval on the fluffy body template, measured from the
 *  template's own pixels (smooth-region scan, normalized 0..1). The chibi
 *  face is drawn into this ellipse with a soft feathered mask. */
export const CHIBI_FACE_REGION = Object.freeze({ cx: 0.475, cy: 0.45, rx: 0.215, ry: 0.125 });
/** Feather width as a fraction of the ellipse radius (smoothstep falloff). */
export const CHIBI_FACE_FEATHER = 0.15;

function validateChibiInputs(templatePixels, tw, th, photoPixels, pw, ph) {
  for (const [pixels, w, h, name] of [
    [templatePixels, tw, th, 'template'], [photoPixels, pw, ph, 'photo'],
  ]) {
    if (!Number.isInteger(w) || w <= 0 || !Number.isInteger(h) || h <= 0
      || w > 4096 || h > 4096) throw Error(`buildChibi needs sane ${name} dimensions`);
    if (!pixels || pixels.length !== w * h * 4) throw Error(`buildChibi needs a ${name} RGBA buffer`);
  }
}

/**
 * Sample the person's color: mean RGB of the photo's center crop. Selfies
 * keep the face centered, so the center is the honest sample. Pure and
 * deterministic.
 */
export function sampleSkinTone(pixels, width, height) {
  validatePixels(pixels, width, height);
  const side = Math.max(1, Math.floor(Math.min(width, height) * 0.5));
  const ox = Math.floor((width - side) / 2), oy = Math.floor((height - side) / 2);
  let r = 0, g = 0, b = 0;
  for (let y = oy; y < oy + side; y++) {
    for (let x = ox; x < ox + side; x++) {
      const o = (y * width + x) * 4;
      r += pixels[o]; g += pixels[o + 1]; b += pixels[o + 2];
    }
  }
  const n = side * side;
  return Object.freeze({ r: r / n, g: g / n, b: b / n });
}

function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** True for the template's cream fur: bright and warm. Gray headphones,
 *  dark background, and the face oval are never fur. */
function isFurPixel(r, g, b) {
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma > 100 && (r - b) > 15;
}

/**
 * Bilinear resample of an RGBA buffer to a new size. Pure, deterministic.
 */
export function resampleBilinear(src, sw, sh, dw, dh) {
  validatePixels(src, sw, sh);
  if (!Number.isInteger(dw) || dw <= 0 || !Number.isInteger(dh) || dh <= 0
    || dw > 4096 || dh > 4096) throw Error('pixel pipeline needs sane resample dimensions');
  const out = new Uint8ClampedArray(dw * dh * 4);
  const xScale = sw / dw, yScale = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * yScale - 0.5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
    const y1 = Math.max(0, Math.min(sh - 1, y0 + 1));
    const fy = Math.min(1, Math.max(0, sy - y0));
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * xScale - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
      const x1 = Math.max(0, Math.min(sw - 1, x0 + 1));
      const fx = Math.min(1, Math.max(0, sx - x0));
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = src[(y0 * sw + x0) * 4 + c], p10 = src[(y0 * sw + x1) * 4 + c];
        const p01 = src[(y1 * sw + x0) * 4 + c], p11 = src[(y1 * sw + x1) * 4 + c];
        out[o + c] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
      }
    }
  }
  return out;
}

/**
 * Chibi-fy a face: soften (3x3 box), then lift saturation/contrast a breath
 * and settle tones into soft posterized bands — the plush-comic look — while
 * keeping every feature where the photo put it. Pure and deterministic.
 */
export function chibifyFace(pixels, width, height) {
  validatePixels(pixels, width, height);
  const soft = new Float32Array(pixels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          const yy = Math.min(height - 1, Math.max(0, y + dy));
          const o = (yy * width + xx) * 4;
          r += pixels[o]; g += pixels[o + 1]; b += pixels[o + 2]; n++;
        }
      }
      const o = (y * width + x) * 4;
      soft[o] = r / n; soft[o + 1] = g / n; soft[o + 2] = b / n; soft[o + 3] = 255;
    }
  }
  const out = new Uint8ClampedArray(pixels.length);
  const LEVELS = 20;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = soft[o], g = soft[o + 1], b = soft[o + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    for (let c = 0; c < 3; c++) {
      const v = soft[o + c];
      // Gentle contrast around the pixel's own luminance, slight saturation lift.
      let styled = luma + (v - luma) * 1.18;
      // Soft posterize: settle into bands, then blend back halfway.
      const band = Math.round(styled / 255 * LEVELS) / LEVELS * 255;
      styled = styled * 0.5 + band * 0.5;
      out[o + c] = styled;
    }
    out[o + 3] = 255;
  }
  return out;
}

/**
 * Build a personal chibi that keeps the person's ACTUAL likeness: the photo's
 * face (eyes, brows, nose, mouth, beard, hair — wherever they are) is
 * cropped from the center, resampled into the fluffy template's blank face
 * oval at chibi proportions, chibi-fied, and composited with a feathered
 * mask. The template's fur is tinted toward the sampled skin tone while
 * keeping its fluffy shading. Pure pixel math — deterministic, byte-identical
 * for the same inputs, no DOM, no network. Headphones and background are
 * untouched.
 */
export function buildChibi(templatePixels, tw, th, photoPixels, pw, ph) {
  validateChibiInputs(templatePixels, tw, th, photoPixels, pw, ph);
  const tone = sampleSkinTone(photoPixels, pw, ph);
  const { cx, cy, rx, ry } = CHIBI_FACE_REGION;
  const fcx = cx * tw, fcy = cy * th, frx = rx * tw, fry = ry * th;
  const feather = CHIBI_FACE_FEATHER, inner = 1 - feather;

  // Self-calibrating fur brightness: the tint keeps the template's shading.
  let furLumaSum = 0, furCount = 0;
  for (let i = 0; i < tw * th; i++) {
    const o = i * 4;
    if (isFurPixel(templatePixels[o], templatePixels[o + 1], templatePixels[o + 2])) {
      furLumaSum += 0.2126 * templatePixels[o] + 0.7152 * templatePixels[o + 1] + 0.0722 * templatePixels[o + 2];
      furCount++;
    }
  }
  const furAvg = furCount > 0 ? furLumaSum / furCount : 190;

  const out = new Uint8ClampedArray(templatePixels);
  for (let i = 0; i < tw * th; i++) {
    const o = i * 4;
    const r = templatePixels[o], g = templatePixels[o + 1], b = templatePixels[o + 2];
    if (!isFurPixel(r, g, b)) continue;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const k = luma / furAvg;
    out[o] = tone.r * k; out[o + 1] = tone.g * k; out[o + 2] = tone.b * k;
  }

  // The likeness: center-crop the photo's face square, lay it over the oval
  // bbox with a small chibi overscan, chibi-fy, feather in.
  const side = Math.min(pw, ph);
  const sx0 = Math.floor((pw - side) / 2), sy0 = Math.floor((ph - side) / 2);
  const faceSquare = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const s = ((sy0 + y) * pw + (sx0 + x)) * 4, d = (y * side + x) * 4;
      faceSquare[d] = photoPixels[s]; faceSquare[d + 1] = photoPixels[s + 1];
      faceSquare[d + 2] = photoPixels[s + 2]; faceSquare[d + 3] = 255;
    }
  }
  const OVERSCAN = 1.12;
  const bw = Math.max(2, Math.round(frx * 2 * OVERSCAN));
  const bh = Math.max(2, Math.round(fry * 2 * OVERSCAN));
  const faceBig = chibifyFace(resampleBilinear(faceSquare, side, side, bw, bh), bw, bh);

  const x0 = Math.max(0, Math.floor(fcx - frx * (1 + feather)));
  const x1 = Math.min(tw - 1, Math.ceil(fcx + frx * (1 + feather)));
  const y0 = Math.max(0, Math.floor(fcy - fry * (1 + feather)));
  const y1 = Math.min(th - 1, Math.ceil(fcy + fry * (1 + feather)));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const ex = (x - fcx) / frx, ey = (y - fcy) / fry;
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d >= 1) continue;
      const mask = 1 - smoothstep(inner, 1, d);
      if (mask <= 0) continue;
      // Map the template pixel back into the chibi-fied face layer.
      const fx = Math.min(bw - 1, Math.max(0, Math.round((x - (fcx - bw / 2)))));
      const fy = Math.min(bh - 1, Math.max(0, Math.round((y - (fcy - bh / 2)))));
      const fo = (fy * bw + fx) * 4;
      const o = (y * tw + x) * 4;
      out[o] = faceBig[fo] * mask + out[o] * (1 - mask);
      out[o + 1] = faceBig[fo + 1] * mask + out[o + 1] * (1 - mask);
      out[o + 2] = faceBig[fo + 2] * mask + out[o + 2] * (1 - mask);
      out[o + 3] = 255;
    }
  }
  return Object.freeze({ data: out, width: tw, height: th });
}
function validDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/')
    && value.length > 100 && value.length <= MAX_STORED_BYTES;
}

/** Persist the photo + personal chibi on this device only. Never throws. */
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
 *  default photo-mascot look. Never throws. */
export function loadAvatarFaceChoice(storage) {
  if (!storage) return AVATAR_FACE_CHOICE_DEFAULT;
  let raw = null;
  try { raw = storage.getItem(AVATAR_FACE_CHOICE_STORAGE_KEY); } catch { return AVATAR_FACE_CHOICE_DEFAULT; }
  return AVATAR_FACE_CHOICE_IDS.has(raw) ? raw : AVATAR_FACE_CHOICE_DEFAULT;
}

/** Resolve the face texture URL for this device:
 *  the chosen option, with graceful fallbacks (a "your chibi" choice with
 *  no saved photo falls back to the default fluffy character). Always
 *  returns a usable URL string; never throws. */
export function resolveAvatarFaceUrl(storage) {
  const choice = loadAvatarFaceChoice(storage);
  const photoLook = AVATAR_PHOTO_MASCOT_LOOKS.find((entry) => entry.id === choice);
  if (photoLook) return photoLook.url;
  if (choice === 'tumbo-you') return AVATAR_TUMBO_CHIBI_FACE_URL;
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
