// tests/stubs/photo-mascot.mjs
//
// Stub for src/render/photo-mascot.js (GPT-M2 builder).
// Records buildPhotoMascot() calls: { group, setLook, setTilt, applyMotion, faceCamera, dispose }.

import { Vector3 } from "./three.mjs";

export const calls = {
  built: 0,
  setLook: [],
  setTilt: [],
  applyMotion: [],
  faceCamera: [],
  disposed: 0,
};

let lastGroup = null;

export function __reset() {
  calls.built = 0;
  calls.setLook = [];
  calls.setTilt = [];
  calls.applyMotion = [];
  calls.faceCamera = [];
  calls.disposed = 0;
  lastGroup = null;
}

export function lastBuiltGroup() {
  return lastGroup;
}

export function buildPhotoMascot() {
  calls.built += 1;
  const group = {
    visible: false,
    position: new Vector3(),
    name: "photo-mascot-stub",
  };
  lastGroup = group;
  return {
    group,
    setLook: (look) => {
      calls.setLook.push(look);
    },
    setTilt: (x, y) => {
      calls.setTilt.push([x, y]);
    },
    applyMotion: (sample) => {
      calls.applyMotion.push(sample);
    },
    faceCamera: (cam) => {
      calls.faceCamera.push(cam);
    },
    dispose: () => {
      calls.disposed += 1;
    },
  };
}
