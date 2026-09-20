import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  stylizeTumboPortrait,
  buildChibi, sampleSkinTone, resampleBilinear, chibifyFace,
  CHIBI_FACE_REGION, CHIBI_FACE_FEATHER,
  saveAvatarFace, loadAvatarFace, clearAvatarFace,
  saveAvatarHome, loadAvatarHome,
  saveAvatarFaceChoice, loadAvatarFaceChoice, resolveAvatarFaceUrl,
  AVATAR_FACE_STORAGE_KEY, AVATAR_HOME_STORAGE_KEY,
  AVATAR_DEFAULT_FACE_URL, AVATAR_FLUFFY_BODY_TEMPLATE_URL, AVATAR_TUMBO_CHIBI_FACE_URL,
  AVATAR_FACE_CHOICES, AVATAR_FACE_CHOICE_DEFAULT,
  AVATAR_PHOTO_MASCOT_LOOKS, avatarFaceChoiceToMascotLook,
} from '../src/domains/avatar-style.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

/** Small synthetic photo: horizontal red gradient, vertical green gradient. */
function syntheticPhoto(w = 16, h = 16) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i] = Math.round((x / (w - 1)) * 255);
    data[i + 1] = Math.round((y / (h - 1)) * 255);
    data[i + 2] = 128;
    data[i + 3] = 255;
  }
  return data;
}

test('stylization is a pure function: same input + seed, byte-identical output', () => {
  const photo = syntheticPhoto();
  const a = stylizeTumboPortrait(photo, 16, 16, { seed: 42 });
  const b = stylizeTumboPortrait(photo, 16, 16, { seed: 42 });
  assert.deepEqual([...a.data], [...b.data]);
  assert.equal(a.width, 16); assert.equal(a.height, 16);
});

test('stylization actually transforms the image', () => {
  const photo = syntheticPhoto();
  const out = stylizeTumboPortrait(photo, 16, 16, { seed: 42 });
  let diff = 0;
  for (let i = 0; i < photo.length; i += 4) {
    diff += Math.abs(photo[i] - out.data[i]) + Math.abs(photo[i + 1] - out.data[i + 1]);
  }
  assert.ok(diff > photo.length, 'the grade must visibly change the pixels');
});

test('the seed changes the grain, the grade stays recognizable', () => {
  const photo = syntheticPhoto();
  const a = stylizeTumboPortrait(photo, 16, 16, { seed: 1 });
  const b = stylizeTumboPortrait(photo, 16, 16, { seed: 2 });
  assert.notDeepEqual([...a.data], [...b.data], 'seeded grain differs');
  // Same coarse grade: average channels close between seeds.
  const avg = (d) => [0, 1, 2].map((c) => d.filter((_, i) => i % 4 === c).reduce((s, v) => s + v, 0) / (d.length / 4));
  const [ar, ag, ab] = avg(a.data), [br, bg, bb] = avg(b.data);
  assert.ok(Math.abs(ar - br) < 6 && Math.abs(ag - bg) < 6 && Math.abs(ab - bb) < 6);
});

test('vignette darkens the corners of a flat field', () => {
  const w = 16, h = 16, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 200; data[i * 4 + 1] = 200; data[i * 4 + 2] = 200; data[i * 4 + 3] = 255; }
  const out = stylizeTumboPortrait(data, w, h, { seed: 5 }).data;
  const lum = (i) => (out[i * 4] + out[i * 4 + 1] + out[i * 4 + 2]) / 3;
  const center = lum(8 * w + 8), corner = lum(0);
  assert.ok(corner < center, `corner ${corner} should be darker than center ${center}`);
});

test('gold grade warms the midtones', () => {
  const w = 8, h = 8, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 128; data[i * 4 + 1] = 128; data[i * 4 + 2] = 128; data[i * 4 + 3] = 255; }
  const out = stylizeTumboPortrait(data, w, h, { seed: 5 }).data;
  const i = (4 * w + 4) * 4;
  assert.ok(out[i] >= out[i + 2], 'red channel should lead blue after the gold grade');
});

test('stylization validates its input', () => {
  assert.throws(() => stylizeTumboPortrait(new Uint8ClampedArray(10), 2, 2), /RGBA buffer/);
  assert.throws(() => stylizeTumboPortrait(new Uint8ClampedArray(16), 0, 2), /dimensions/);
});

const tinyPng = (tag) => `data:image/png;base64,${Buffer.from(`fake-${tag}-` + 'x'.repeat(120)).toString('base64')}`;

test('avatar face persists and round-trips on this device', () => {
  const store = fakeStorage();
  assert.equal(loadAvatarFace(store), null);
  assert.ok(saveAvatarFace(store, { photoDataURL: tinyPng('photo'), stylizedDataURL: tinyPng('styled') }));
  const loaded = loadAvatarFace(store);
  assert.ok(loaded.stylizedDataURL.startsWith('data:image/'));
  assert.equal(loaded.photoDataURL, tinyPng('photo'));
  assert.ok(clearAvatarFace(store));
  assert.equal(loadAvatarFace(store), null);
});

test('avatar face storage refuses junk and never throws', () => {
  const store = fakeStorage();
  assert.equal(saveAvatarFace(store, { photoDataURL: 'nope', stylizedDataURL: tinyPng('s') }), false);
  assert.equal(saveAvatarFace(null, { photoDataURL: tinyPng('p'), stylizedDataURL: tinyPng('s') }), false);
  store.setItem(AVATAR_FACE_STORAGE_KEY, 'not json{{{');
  assert.equal(loadAvatarFace(store), null);
  const throwing = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); }, removeItem() { throw Error('denied'); } };
  assert.equal(saveAvatarFace(throwing, { photoDataURL: tinyPng('p'), stylizedDataURL: tinyPng('s') }), false);
  assert.equal(loadAvatarFace(throwing), null);
});

test('avatar home position persists and round-trips', () => {
  const store = fakeStorage();
  assert.equal(loadAvatarHome(store), null);
  assert.ok(saveAvatarHome(store, { x: 1.5, y: -0.5, z: 2.25 }));
  assert.deepEqual(loadAvatarHome(store), { x: 1.5, y: -0.5, z: 2.25 });
  assert.equal(saveAvatarHome(store, { x: NaN, y: 0, z: 0 }), false);
  store.setItem(AVATAR_HOME_STORAGE_KEY, '{"x":1e999,"y":0,"z":0}');
  assert.equal(loadAvatarHome(store), null, 'absurd coordinates are rejected');
});

test('style domain never touches the network', async () => {
  const src = await readFile(new URL('../src/domains/avatar-style.js', import.meta.url), 'utf8');
  for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'http://', 'https://', 'import(']) {
    assert.ok(!src.includes(banned), `style module must not reference ${banned}`);
  }
  assert.ok(src.includes('never leaves the device'), 'the local-only contract is documented in the module');
});

test('face choices are a fixed, frozen menu: photo mascot first, then the chibis', () => {
  assert.ok(Object.isFrozen(AVATAR_FACE_CHOICES));
  assert.deepEqual(AVATAR_FACE_CHOICES.map((c) => c.id), [
    'photo-hoodie', 'photo-hat', 'photo-float', 'photo-outfit',
    'tumbo', 'tumbo-you', 'your-photo',
  ]);
  assert.ok(AVATAR_FACE_CHOICES.every((c) => Object.isFrozen(c)));
  const byId = Object.fromEntries(AVATAR_FACE_CHOICES.map((c) => [c.id, c]));
  assert.equal(byId['photo-hoodie'].url, 'assets/avatar/photo-mascot/tumbo-hoodie.png');
  assert.equal(byId['photo-hat'].url, 'assets/avatar/photo-mascot/tumbo-hat.png');
  assert.equal(byId['photo-float'].url, 'assets/avatar/photo-mascot/tumbo-float.png');
  assert.equal(byId['photo-outfit'].url, 'assets/avatar/photo-mascot/tumbo-outfit.png');
  assert.equal(byId['tumbo'].url, AVATAR_DEFAULT_FACE_URL);
  assert.equal(AVATAR_DEFAULT_FACE_URL, AVATAR_FLUFFY_BODY_TEMPLATE_URL, 'the default is the fluffy template as-is');
  assert.equal(byId['tumbo-you'].url, AVATAR_TUMBO_CHIBI_FACE_URL, "Tumbo's own chibi");
  assert.equal(byId['your-photo'].url, null);
  assert.equal(AVATAR_FACE_CHOICE_DEFAULT, 'photo-hoodie', 'new users start as the photo mascot: it is you');
  assert.ok(Object.isFrozen(AVATAR_PHOTO_MASCOT_LOOKS));
  assert.deepEqual(AVATAR_PHOTO_MASCOT_LOOKS.map((c) => c.look), ['hoodie', 'hat', 'float', 'outfit']);
  assert.equal(avatarFaceChoiceToMascotLook('photo-hat'), 'hat');
  assert.equal(avatarFaceChoiceToMascotLook('tumbo'), null);
  assert.equal(avatarFaceChoiceToMascotLook('your-photo'), null);
  assert.equal(avatarFaceChoiceToMascotLook('nope'), null);
  assert.ok(Object.isFrozen(CHIBI_FACE_REGION));
  assert.ok(CHIBI_FACE_REGION.rx > 0 && CHIBI_FACE_REGION.ry > 0);
});

test('face choice persists and round-trips', () => {
  const store = fakeStorage();
  assert.equal(loadAvatarFaceChoice(store), 'photo-hoodie', 'unset choice falls back to the photo mascot');
  assert.ok(saveAvatarFaceChoice(store, 'tumbo-you'));
  assert.equal(loadAvatarFaceChoice(store), 'tumbo-you');
  assert.ok(saveAvatarFaceChoice(store, 'your-photo'));
  assert.equal(loadAvatarFaceChoice(store), 'your-photo');
  assert.ok(saveAvatarFaceChoice(store, 'photo-float'));
  assert.equal(loadAvatarFaceChoice(store), 'photo-float');
});

test('face choice rejects junk and never throws', () => {
  const store = fakeStorage();
  assert.equal(saveAvatarFaceChoice(store, 'hacker-face'), false);
  assert.equal(saveAvatarFaceChoice(store, ''), false);
  assert.equal(saveAvatarFaceChoice(null, 'tumbo-you'), false);
  assert.equal(loadAvatarFaceChoice(null), 'photo-hoodie');
  store.setItem('matumbo.person-studio.avatar-face-choice.v1', 'hacker-face');
  assert.equal(loadAvatarFaceChoice(store), 'photo-hoodie', 'a tampered choice falls back to default');
  const throwing = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  assert.equal(saveAvatarFaceChoice(throwing, 'tumbo-you'), false);
  assert.equal(loadAvatarFaceChoice(throwing), 'photo-hoodie');
});

test('resolveAvatarFaceUrl honors the choice with graceful fallbacks', () => {
  const store = fakeStorage();
  assert.equal(resolveAvatarFaceUrl(store), 'assets/avatar/photo-mascot/tumbo-hoodie.png', 'photo mascot out of the box');
  saveAvatarFaceChoice(store, 'photo-float');
  assert.equal(resolveAvatarFaceUrl(store), 'assets/avatar/photo-mascot/tumbo-float.png', 'chosen photo look');
  saveAvatarFaceChoice(store, 'tumbo-you');
  assert.equal(resolveAvatarFaceUrl(store), AVATAR_TUMBO_CHIBI_FACE_URL, "Tumbo's own chibi when chosen");
  saveAvatarFaceChoice(store, 'your-photo');
  assert.equal(resolveAvatarFaceUrl(store), AVATAR_DEFAULT_FACE_URL, 'no saved photo yet → default character');
  assert.ok(saveAvatarFace(store, { photoDataURL: tinyPng('photo'), stylizedDataURL: tinyPng('styled') }));
  assert.equal(resolveAvatarFaceUrl(store), tinyPng('styled'), 'saved styled photo wins for your-photo choice');
  saveAvatarFaceChoice(store, 'tumbo');
  assert.equal(resolveAvatarFaceUrl(store), AVATAR_DEFAULT_FACE_URL, 'explicit default still the character');
  assert.equal(resolveAvatarFaceUrl(null), 'assets/avatar/photo-mascot/tumbo-hoodie.png', 'no storage → photo mascot');
});

/** Synthetic template: cream fur (two shades, for the shading test), a gray
 *  "headphone" block and a dark "background" block — all outside the face
 *  oval — so tinting, face drawing, and untouched regions are detectable. */
function syntheticTemplate(w = 64, h = 64) {
  const data = new Uint8ClampedArray(w * h * 4);
  const set = (x, y, r, g, b) => { const o = (y * w + x) * 4; data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < w / 2) set(x, y, 245, 238, 222); else set(x, y, 200, 194, 182);
    }
  }
  for (let y = 50; y < 60; y++) for (let x = 50; x < 60; x++) set(x, y, 150, 148, 147); // gray headphones
  for (let y = 55; y < 63; y++) for (let x = 0; x < 8; x++) set(x, y, 18, 14, 15);     // dark background
  return data;
}

/** Synthetic photo: saturated red, so the sampled tone must read red. */
function syntheticRedPhoto(w = 32, h = 32) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 220; data[i * 4 + 1] = 40; data[i * 4 + 2] = 40; data[i * 4 + 3] = 255;
  }
  return data;
}

test('sampleSkinTone reads the center crop', () => {
  const tone = sampleSkinTone(syntheticRedPhoto(), 32, 32);
  assert.ok(Math.abs(tone.r - 220) < 1 && Math.abs(tone.g - 40) < 1 && Math.abs(tone.b - 40) < 1,
    `solid red photo must sample red, got ${tone.r},${tone.g},${tone.b}`);
  // Red center, blue border: the border must not leak into the sample.
  const w = 32, h = 32, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, center = x >= 8 && x < 24 && y >= 8 && y < 24;
    data[o] = center ? 220 : 30; data[o + 1] = center ? 40 : 60; data[o + 2] = center ? 40 : 220; data[o + 3] = 255;
  }
  const t2 = sampleSkinTone(data, w, h);
  assert.ok(t2.r > 200 && t2.b < 60, `center crop wins, got ${t2.r},${t2.g},${t2.b}`);
});

test('buildChibi is pure: same inputs, byte-identical output', () => {
  const a = buildChibi(syntheticTemplate(), 64, 64, syntheticRedPhoto(), 32, 32);
  const b = buildChibi(syntheticTemplate(), 64, 64, syntheticRedPhoto(), 32, 32);
  assert.deepEqual([...a.data], [...b.data]);
  assert.equal(a.width, 64); assert.equal(a.height, 64);
  assert.ok(Object.isFrozen(a));
});

/** Synthetic likeness photo: red left half, blue right half, bright nose
 *  dot at center, dark beard band across the bottom — recognizable structure
 *  the chibi must preserve. */
function syntheticLikenessPhoto(w = 32, h = 32) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r, g, b;
      if (y >= Math.floor(h * 0.68)) { r = 30; g = 25; b = 25; }        // beard
      else if (x === Math.floor(w / 2) && y === Math.floor(h / 2)) { r = 250; g = 240; b = 230; } // nose
      else if (x < w / 2) { r = 220; g = 40; b = 40; }                    // left
      else { r = 40; g = 60; b = 220; }                                  // right
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
  }
  return data;
}

test('buildChibi keeps the photo likeness — features stay where the photo put them', () => {
  const tw = 64, th = 64;
  const out = buildChibi(syntheticTemplate(tw, th), tw, th, syntheticLikenessPhoto(), 32, 32).data;
  const { cx, cy, rx } = CHIBI_FACE_REGION;
  const at = (x, y) => { const o = (y * tw + x) * 4; return [out[o], out[o + 1], out[o + 2]]; };
  const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const fcx = Math.round(cx * tw), fcy = Math.round(cy * th);
  // Left/right orientation survives: red left, blue right.
  const [lr, , lb] = at(Math.round(fcx - 0.6 * rx * tw), fcy);
  assert.ok(lr > lb + 40, `left of face should read the red half, got ${lr},${lb}`);
  const [rr, , rb] = at(Math.round(fcx + 0.6 * rx * tw), fcy);
  assert.ok(rb > rr + 40, `right of face should read the blue half, got ${rr},${rb}`);
  // The beard band lands low: lower oval is darker than upper oval.
  const low = luma(at(fcx, Math.round(cy * th + 0.75 * 8)));
  const high = luma(at(fcx, Math.round(cy * th - 0.6 * 8)));
  assert.ok(low < high - 40, `beard should darken the lower oval, low ${Math.round(low)} vs high ${Math.round(high)}`);
  // The nose dot lands at the oval center: bright.
  const [nr] = at(fcx, fcy);
  assert.ok(nr > 150, `nose should land at the oval center, got ${nr}`);
});

test('chibifyFace softens but keeps features in place and is deterministic', () => {
  const w = 8, h = 8, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, left = x < w / 2;
    data[o] = left ? 60 : 200; data[o + 1] = left ? 50 : 190; data[o + 2] = left ? 50 : 180; data[o + 3] = 255;
  }
  const a = chibifyFace(data, w, h), b = chibifyFace(data, w, h);
  assert.deepEqual([...a], [...b], 'deterministic');
  assert.equal(a.length, w * h * 4);
  const lumaAt = (px, x, y) => { const o = (y * w + x) * 4; return 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]; };
  assert.ok(lumaAt(a, 1, 4) < lumaAt(a, 6, 4) - 30, 'dark/light halves keep their order');
  assert.throws(() => chibifyFace(new Uint8ClampedArray(3), 1, 1), /RGBA buffer/);
});

test('bilinear resample is deterministic and exact on solid fields', () => {
  const src = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
  const out = resampleBilinear(src, 2, 2, 4, 4);
  assert.equal(out.length, 64);
  assert.deepEqual([...resampleBilinear(src, 2, 2, 4, 4)], [...out]);
  const solid = new Uint8ClampedArray(4); solid.fill(200);
  const s2 = resampleBilinear(solid, 1, 1, 3, 3);
  assert.ok([...s2].every((v) => v === 200));
  assert.throws(() => resampleBilinear(new Uint8ClampedArray(3), 1, 1, 2, 2), /RGBA buffer/);
  assert.throws(() => resampleBilinear(src, 2, 2, 0, 4), /dimensions/);
});

test('buildChibi tints the fur, keeps the shading, spares the rest', () => {
  const tw = 64, th = 64;
  const tpl = syntheticTemplate(tw, th);
  const out = buildChibi(tpl, tw, th, syntheticRedPhoto(), 32, 32).data;
  const at = (x, y) => { const o = (y * tw + x) * 4; return [out[o], out[o + 1], out[o + 2]]; };
  // Bright fur turns red-ish: tinted, not cream.
  const [r1, g1, b1] = at(8, 8);
  assert.ok(r1 > 200 && r1 > g1 + 100, `fur should take the red tint, got ${r1},${g1},${b1}`);
  // The darker fur shade maps darker: shading survives the tint.
  const [r2] = at(58, 8);
  assert.ok(r2 < r1 - 20, `fur shading should survive, bright ${r1} vs dim ${r2}`);
  // Gray headphones are not fur: untouched.
  assert.deepEqual(at(55, 55), [150, 148, 147], 'headphones stay gray');
  // Dark background is not fur: untouched.
  assert.deepEqual(at(4, 60), [18, 14, 15], 'background stays dark');
});

test('buildChibi validates its inputs', () => {
  assert.throws(() => buildChibi(new Uint8ClampedArray(10), 2, 2, syntheticRedPhoto(), 32, 32), /RGBA buffer/);
  assert.throws(() => buildChibi(syntheticTemplate(), 64, 64, new Uint8ClampedArray(10), 2, 2), /RGBA buffer/);
  assert.throws(() => buildChibi(syntheticTemplate(), 0, 64, syntheticRedPhoto(), 32, 32), /dimensions/);
});
