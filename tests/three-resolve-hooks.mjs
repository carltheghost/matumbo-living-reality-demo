// Test-only loader hooks: map the bare "three" specifier to the vendored
// three.module.js so hand-presence tests run in plain node (no browser).
// Resolve from this checkout on Windows, Linux, and macOS. A developer's
// absolute workspace path must never decide which Three.js build is tested.
const THREE_URL = new URL(
  "../vendor/three-r179.1/build/three.module.js", import.meta.url,
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "three") {
    return { url: THREE_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
