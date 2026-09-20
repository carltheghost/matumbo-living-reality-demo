/**
 * src/render/photo-mascot-set.js
 *
 * Photo mascot set manifest and loader for the maTumbo Living Reality Ω
 * project (Reality Lens Ω naming; World Eye is retired).
 *
 * This module covers ONLY the four bundled mascot photos in
 * assets/avatar/photo-mascot/. It does NOT touch the separate on-device
 * Become-Tumbo user-photo flow.
 *
 * Conventions: no console.log spam, no emojis, everything closed by default
 * (no eager DOM work at import time), assets materialize only when needed
 * via preloadPhotos(), simulated TUMBO points only (no wallets/crypto).
 */

const STORAGE_KEY = 'tumbo-mascot-look';
const PHOTO_DIR = 'assets/avatar/photo-mascot';

export const MASCOT_PHOTOS = [
  {
    id: 'hoodie',
    label: 'TUMBO Hoodie',
    src: `${PHOTO_DIR}/tumbo-hoodie.png`,
    description: 'Default look: comic-style portrait wearing a black TUMBO hoodie.',
    default: true,
  },
  {
    id: 'hat',
    label: 'Snapback Hat',
    src: `${PHOTO_DIR}/tumbo-hat.png`,
    description: 'Comic-style portrait wearing a TUMBO snapback hat.',
  },
  {
    id: 'float',
    label: 'Floating Pose',
    src: `${PHOTO_DIR}/tumbo-float.png`,
    description: 'Comic-style portrait in a floating pose.',
  },
  {
    id: 'outfit',
    label: 'Dark Casual Jacket',
    src: `${PHOTO_DIR}/tumbo-outfit.png`,
    description: 'Comic-style portrait wearing a dark casual jacket.',
  },
];

const DEFAULT_PHOTO =
  MASCOT_PHOTOS.find((photo) => photo.default === true) || MASCOT_PHOTOS[0];

/** Id of the default mascot look (the hoodie entry). */
export const DEFAULT_LOOK_ID = DEFAULT_PHOTO.id;

function isKnownLookId(id) {
  return MASCOT_PHOTOS.some((photo) => photo.id === id);
}

function readStoredLookId() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredLookId(id) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage unavailable (private mode, non-browser env): ignore silently.
  }
}

/**
 * Returns the manifest entry for `id`, or the default entry for unknown ids.
 */
export function getPhoto(id) {
  return MASCOT_PHOTOS.find((photo) => photo.id === id) || DEFAULT_PHOTO;
}

/**
 * Persists the chosen mascot look id in localStorage.
 * Unknown ids are ignored (the stored look is left unchanged).
 */
export function setMascotLook(id) {
  if (!isKnownLookId(id)) return;
  writeStoredLookId(id);
}

/**
 * Returns the stored look id when it is a known photo id,
 * otherwise the default look id.
 */
export function getMascotLook() {
  const stored = readStoredLookId();
  return isKnownLookId(stored) ? stored : DEFAULT_LOOK_ID;
}

/**
 * Preloads every bundled mascot photo by creating one Image per entry.
 * Resolves with { loaded: [ids], failed: [ids] } once all settle.
 * Never throws on a missing/unreachable file. Calls onProgress(done, total)
 * after each image settles (onProgress is optional).
 */
export function preloadPhotos(onProgress) {
  const total = MASCOT_PHOTOS.length;
  const notify = typeof onProgress === 'function' ? onProgress : undefined;
  const outcomes = new Array(total);
  let settled = 0;

  return new Promise((resolve) => {
    if (total === 0) {
      resolve({ loaded: [], failed: [] });
      return;
    }

    const finishOne = (index, ok) => {
      outcomes[index] = ok;
      settled += 1;
      if (notify) {
        try {
          notify(settled, total);
        } catch {
          // A throwing progress callback must not break preloading.
        }
      }
      if (settled === total) {
        const loaded = [];
        const failed = [];
        MASCOT_PHOTOS.forEach((photo, i) => {
          (outcomes[i] ? loaded : failed).push(photo.id);
        });
        resolve({ loaded, failed });
      }
    };

    MASCOT_PHOTOS.forEach((photo, index) => {
      try {
        const img = new Image();
        img.onload = () => finishOne(index, true);
        img.onerror = () => finishOne(index, false);
        img.src = photo.src;
      } catch {
        // Missing/broken asset or unavailable Image constructor: never throw.
        finishOne(index, false);
      }
    });
  });
}
