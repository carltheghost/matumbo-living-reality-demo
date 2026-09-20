import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../", import.meta.url);
const SRC = new URL("src/", ROOT);

// Regression coverage for the 2026-09-20 public-demo boot crash:
// src/render/contract-atelier.js statically imported { rankProposalsForReview }
// from ../domains/bot-plaza.js, which never exported it. A missing named
// export is a SyntaxError at module instantiation — the whole module graph
// fails, main.js never runs, and the user only sees the red banner. This test
// statically resolves every named import in the browser module graph against
// the target file's real exports, so a missing export can never ship again.

async function listJsFiles(dirUrl) {
  const out = [];
  const entries = await readdir(dirUrl, { withFileTypes: true });
  for (const entry of entries) {
    const url = new URL(entry.name, dirUrl.href.endsWith("/") ? dirUrl : new URL(dirUrl.href + "/"));
    if (entry.isDirectory()) out.push(...(await listJsFiles(new URL(entry.name + "/", url))));
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(url);
  }
  return out;
}

function stripQuery(specifier) {
  const queryAt = specifier.indexOf("?");
  const hashAt = specifier.indexOf("#");
  const cut = [queryAt, hashAt].filter((i) => i >= 0);
  return cut.length ? specifier.slice(0, Math.min(...cut)) : specifier;
}

function resolveSpecifier(specifier, fromUrl) {
  const clean = stripQuery(specifier).trim();
  if (!clean || clean.startsWith("node:") || clean.startsWith("data:")) return null;
  if (clean === "three" || clean.startsWith("three/")) {
    const rest = clean === "three" ? "build/three.module.js" : clean.slice("three/".length);
    // three/addons/* maps to examples/jsm/* via the import map in index.html.
    const vendorPath = rest.startsWith("addons/")
      ? `vendor/three-r179.1/examples/jsm/${rest.slice("addons/".length)}`
      : `vendor/three-r179.1/${rest}`;
    return new URL(vendorPath, ROOT);
  }
  if (!clean.startsWith(".")) return null; // bare specifier we do not map
  return new URL(clean, fromUrl);
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
}

function exportedNames(source) {
  const names = new Set();
  const code = stripComments(source);
  for (const match of source.matchAll(/export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

function namedImports(source) {
  const out = [];
  const code = stripComments(source);
  // Static named imports only; namespace/default/dynamic imports are skipped
  // because their members cannot be resolved without executing the module.
  for (const match of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const names = match[1]
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/).shift().trim())
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
    if (names.length) out.push({ names, specifier: match[2] });
  }
  return out;
}

test("every static named import resolves to a real export in its target module", async () => {
  const files = await listJsFiles(SRC);
  assert.ok(files.length > 50, `expected the src tree, found ${files.length} files`);
  const exportCache = new Map();
  async function exportsOf(url) {
    const key = url.href;
    if (!exportCache.has(key)) {
      exportCache.set(key, exportedNames(await readFile(url, "utf8")));
    }
    return exportCache.get(key);
  }
  const failures = [];
  for (const fileUrl of files) {
    const source = await readFile(fileUrl, "utf8");
    for (const { names, specifier } of namedImports(source)) {
      const target = resolveSpecifier(specifier, fileUrl);
      if (!target) continue;
      let provided;
      try {
        provided = await exportsOf(target);
      } catch {
        failures.push(`${path.relative(ROOT.pathname, fileUrl.pathname)} imports from ${specifier}: target file unreadable`);
        continue;
      }
      for (const name of names) {
        if (!provided.has(name)) {
          failures.push(
            `${path.relative(ROOT.pathname, fileUrl.pathname)} imports { ${name} } from ${specifier}, but the target module does not export it`
          );
        }
      }
    }
  }
  assert.deepEqual(failures, [], `unresolvable named imports:\n${failures.join("\n")}`);
});
