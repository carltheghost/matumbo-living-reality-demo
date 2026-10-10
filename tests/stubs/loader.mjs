// tests/stubs/loader.mjs
//
// node:module customization hooks that redirect the imports of
// src/render/photo-mascot-presence.js to the minimal stubs in this directory:
//   "three"                       -> ./three.mjs
//   "./photo-mascot.js"           -> ./photo-mascot.mjs
//   "./photo-mascot-set.js"       -> ./photo-mascot-set.mjs
//   "../domains/mascot-motion.js" -> ./mascot-motion.mjs
//
// Registered from the test file via:
//   import { register } from "node:module";
//   register(new URL("./stubs/loader.mjs", import.meta.url));

const stubDir = new URL("./", import.meta.url);

const TARGET = "src/render/photo-mascot-presence.js";

const relativeStubs = {
  "./photo-mascot.js": "photo-mascot.mjs",
  "./photo-mascot-set.js": "photo-mascot-set.mjs",
  "../domains/mascot-motion.js": "mascot-motion.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "three") {
    return { url: new URL("./three.mjs", stubDir).href, shortCircuit: true };
  }
  // Browser cache versions do not change a dependency's identity. Redirect
  // the versioned imports too, so tests exercise the intended instrumented
  // dependencies rather than a second, real builder/photo-set instance.
  const parent = (context.parentURL || "").split(/[?#]/, 1)[0];
  const modulePath = specifier.split(/[?#]/, 1)[0];
  if (parent.endsWith(TARGET) && Object.hasOwn(relativeStubs, modulePath)) {
    return {
      url: new URL("./" + relativeStubs[modulePath], stubDir).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
