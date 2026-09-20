/**
 * tests/photo-mascot-set.test.mjs
 *
 * DOM-free tests for src/render/photo-mascot-set.js.
 * Stubs globalThis.Image with a small fake that succeeds/fails on demand,
 * and stubs globalThis.localStorage with an in-memory map.
 *
 * Run with: node --test tests/photo-mascot-set.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MASCOT_PHOTOS,
  getPhoto,
  setMascotLook,
  getMascotLook,
  preloadPhotos,
} from '../src/render/photo-mascot-set.js';

const STORAGE_KEY = 'tumbo-mascot-look';

function installLocalStorageStub() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: (key) => {
      store.delete(String(key));
    },
    clear: () => {
      store.clear();
    },
  };
  return store;
}

function uninstallLocalStorageStub() {
  delete globalThis.localStorage;
}

/**
 * Fake Image: settles asynchronously via queueMicrotask; fails when the
 * requested src is listed in failSrcs. Records every created instance.
 */
function installImageStub({ failSrcs = [] } = {}) {
  const created = [];
  class FakeImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.complete = false;
      this.naturalWidth = 0;
      created.push(this);
    }
    set src(value) {
      this._src = String(value);
      queueMicrotask(() => {
        this.complete = true;
        if (failSrcs.includes(this._src)) {
          this.naturalWidth = 0;
          if (typeof this.onerror === 'function') {
            this.onerror(new Error(`failed to load: ${this._src}`));
          }
        } else {
          this.naturalWidth = 512;
          if (typeof this.onload === 'function') {
            this.onload();
          }
        }
      });
    }
    get src() {
      return this._src;
    }
  }
  globalThis.Image = FakeImage;
  return created;
}

function uninstallImageStub() {
  delete globalThis.Image;
}

describe('MASCOT_PHOTOS manifest', () => {
  test('has exactly 4 entries with unique ids and well-formed src paths', () => {
    assert.equal(MASCOT_PHOTOS.length, 4);
    const ids = MASCOT_PHOTOS.map((photo) => photo.id);
    assert.equal(new Set(ids).size, 4, 'ids must be unique');
    for (const photo of MASCOT_PHOTOS) {
      assert.equal(typeof photo.id, 'string');
      assert.ok(photo.id.length > 0);
      assert.equal(typeof photo.label, 'string');
      assert.ok(photo.label.length > 0);
      assert.equal(typeof photo.description, 'string');
      assert.ok(photo.description.length > 0);
      assert.match(photo.src, /^assets\/avatar\/photo-mascot\/tumbo-[a-z]+\.png$/);
    }
  });

  test('hoodie entry is the single default', () => {
    const defaults = MASCOT_PHOTOS.filter((photo) => photo.default === true);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].id, 'hoodie');
  });
});

describe('getPhoto', () => {
  test('returns the matching entry for a known id', () => {
    const photo = getPhoto('hat');
    assert.equal(photo.id, 'hat');
    assert.equal(photo.src, 'assets/avatar/photo-mascot/tumbo-hat.png');
  });

  test('falls back to the default entry for unknown ids', () => {
    assert.equal(getPhoto('no-such-photo').id, 'hoodie');
    assert.equal(getPhoto(undefined).id, 'hoodie');
    assert.equal(getPhoto(null).id, 'hoodie');
    assert.equal(getPhoto('').id, 'hoodie');
  });
});

describe('setMascotLook / getMascotLook', () => {
  test('round-trips the chosen look through localStorage', () => {
    installLocalStorageStub();
    try {
      setMascotLook('float');
      assert.equal(getMascotLook(), 'float');
      assert.equal(globalThis.localStorage.getItem(STORAGE_KEY), 'float');
      setMascotLook('outfit');
      assert.equal(getMascotLook(), 'outfit');
    } finally {
      uninstallLocalStorageStub();
    }
  });

  test('ignores unknown ids and keeps the previous look', () => {
    installLocalStorageStub();
    try {
      setMascotLook('hat');
      setMascotLook('unknown-id');
      assert.equal(getMascotLook(), 'hat');
      assert.equal(globalThis.localStorage.getItem(STORAGE_KEY), 'hat');
    } finally {
      uninstallLocalStorageStub();
    }
  });

  test('returns the default id when storage is empty or holds an invalid id', () => {
    installLocalStorageStub();
    try {
      assert.equal(getMascotLook(), 'hoodie');
      globalThis.localStorage.setItem(STORAGE_KEY, 'tampered-value');
      assert.equal(getMascotLook(), 'hoodie');
    } finally {
      uninstallLocalStorageStub();
    }
  });
});

describe('preloadPhotos', () => {
  test('reports loaded/failed ids and notifies progress after each settle', async () => {
    const created = installImageStub({
      failSrcs: ['assets/avatar/photo-mascot/tumbo-hat.png'],
    });
    try {
      const progress = [];
      const result = await preloadPhotos((done, total) => progress.push([done, total]));
      assert.equal(created.length, 4, 'one Image per manifest entry');
      assert.deepEqual(result, {
        loaded: ['hoodie', 'float', 'outfit'],
        failed: ['hat'],
      });
      assert.deepEqual(progress, [
        [1, 4],
        [2, 4],
        [3, 4],
        [4, 4],
      ]);
    } finally {
      uninstallImageStub();
    }
  });

  test('never throws when every file is missing; works without a callback', async () => {
    installImageStub({ failSrcs: MASCOT_PHOTOS.map((photo) => photo.src) });
    try {
      const result = await preloadPhotos();
      assert.deepEqual(result.loaded, []);
      assert.deepEqual(result.failed, ['hoodie', 'hat', 'float', 'outfit']);
    } finally {
      uninstallImageStub();
    }
  });

  test('survives a throwing Image constructor without rejecting', async () => {
    globalThis.Image = class {
      constructor() {
        throw new Error('no DOM');
      }
    };
    try {
      const progress = [];
      const result = await preloadPhotos((done, total) => progress.push([done, total]));
      assert.deepEqual(result, {
        loaded: [],
        failed: ['hoodie', 'hat', 'float', 'outfit'],
      });
      assert.equal(progress.length, 4);
    } finally {
      uninstallImageStub();
    }
  });
});
