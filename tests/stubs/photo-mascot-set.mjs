// tests/stubs/photo-mascot-set.mjs
//
// Stub for src/render/photo-mascot-set.js (GPT-M1 photo set loader).

export const MASCOT_PHOTOS = [
  { id: "look-1", label: "Look 1", src: "look-1.png" },
  { id: "look-2", label: "Look 2", src: "look-2.png" },
  { id: "look-3", label: "Look 3", src: "look-3.png" },
  { id: "look-4", label: "Look 4", src: "look-4.png" },
];

let current = "look-1";

export function __reset() {
  current = "look-1";
}

export function getMascotLook() {
  return current;
}

export function setMascotLook(look) {
  current = look;
}

export function getPhoto(id) {
  return MASCOT_PHOTOS.find((p) => p.id === id) || null;
}

export function preloadPhotos() {
  return Promise.resolve(MASCOT_PHOTOS);
}
