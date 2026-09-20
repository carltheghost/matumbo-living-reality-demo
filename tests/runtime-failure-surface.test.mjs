import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

// Regression coverage for the 2026-09-20 red-banner fix. The public demo
// surfaced "LOCAL 3-D SURFACE UNAVAILABLE · UNCAUGHT RUNTIME" with no
// diagnosis: a rethrown renderer error was being relabeled by the window
// error handler, and a rejected photo-mascot mount could surface as an
// unhandled rejection reported as a module failure.

test("first boot failure wins and is never relabeled by later reports", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");

  // The failed flag is set exactly once, and markFailed exits early on any
  // second call so a later window-level error cannot relabel the original
  // phase (e.g. "WebGL renderer" -> "uncaught runtime").
  assert.match(html, /let failed = false;/);
  assert.match(html, /markFailed\(error, phase = 'runtime'\) \{\s*\n?\s*if \(failed\) return state;/);
  assert.match(html, /setStage\(stage, nextMessage\) \{\s*\n?\s*if \(ready \|\| failed\) return state;/);
  assert.match(html, /markReady\(meta = \{\}\) \{\s*\n?\s*if \(failed\) return state;/);
});

test("the error banner names the underlying failure", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");

  assert.match(html, /Reported error —/);
  assert.match(html, /const errorName = clean\(error\?\.name/);
  assert.match(html, /const errorMessage = clean\(error\?\.message/);
  // The global handlers forward the real error object, not a synthesized label —
  // and enrich resourceless load failures with the failed URL.
  assert.match(
    html,
    /let error = event\?\.error \?\? event\?\.reason \?\? event\?\.message;/
  );
  assert.match(html, /runtime\.markFailed\(error, event\?\.type === 'unhandledrejection' \? 'module promise' : 'uncaught runtime'\)/);
});

test("a rejected photo-mascot mount is observed and never breaks boot", async () => {
  const main = await readFile(new URL("src/main.js", ROOT), "utf8");

  const mountCall = main.indexOf("const mountMascot=mountPhotoMascot({");
  assert.ok(mountCall >= 0, "expected the mascot mount call site");
  const tail = main.slice(mountCall, mountCall + 1500);
  // The mount promise has an explicit rejection observer so a rejected
  // mount cannot become an unhandled rejection surfaced as a module failure.
  assert.match(tail, /mountMascot\(\)\.then\(\(handle\)=>\{mascotHandle=handle;\}\)\.catch\(\(mountError\)=>/);
  assert.match(tail, /console\.warn\('\[photo-mascot\] mount degraded:'/);
  // The whole mount is still belt-and-braced by the outer try/catch.
  assert.match(tail, /\}catch\{\/\* the mount degrades internally/);
});

test("the failure surface stays a local renderer boundary", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");

  assert.match(html, /No wallet, provider, persistence, or external execution was attempted/);
  assert.doesNotMatch(html, /Reported error[\s\S]*?fetch\s*\(/);
});

test("a resource load failure names the failed URL in the banner", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");

  // On the phone the banner showed no diagnosis at all: a <script>/<link>
  // load failure arrives as a plain Event with no error object, so the old
  // handler forwarded undefined. The handler must now name the failed
  // resource URL so a screenshot alone identifies the cause.
  assert.match(html, /resource failed to load:/);
  assert.match(html, /failedTarget\.currentSrc \|\| failedTarget\.src \|\| failedTarget\.href/);
  assert.match(html, /failedTarget !== globalThis/);
});
