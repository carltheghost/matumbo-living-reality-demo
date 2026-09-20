// Test-only loader hooks: map the bare "three" specifier to the vendored
// three.module.js so hand-presence tests run in plain node (no browser).
import { pathToFileURL } from "node:url";

const THREE_URL = pathToFileURL(
  "/home/hatch/workspace/matumbo/tree/vendor/three-r179.1/build/three.module.js",
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "three") {
    return { url: THREE_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
