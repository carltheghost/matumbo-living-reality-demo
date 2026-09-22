import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const ROOT = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

test("Windows launcher exposes a verified static URL and optional memory API", async () => {
  const launcher = await read("scripts/launch-demo.ps1");
  const verifier = await read("scripts/verify-demo-launch.ps1");
  const batch = await read("run_local.bat");
  assert.match(launcher, /http:\/\/localhost:\$StaticPort/);
  assert.match(launcher, /http\.server/);
  assert.match(launcher, /runtime\\merge4/);
  assert.match(launcher, /MATUMBO_STORAGE\s*=\s*["']memory["']/);
  assert.match(launcher, /api\/health/);
  assert.match(launcher, /OpenBrowser/);
  assert.match(launcher, /fresh=20260903-reality-lens/);
  assert.match(verifier, /\$demoRevision\s*=\s*"20260903-reality-lens"/);
  assert.match(verifier, /22 openable local features/);
  assert.doesNotMatch(verifier, /19 openable local features/);
  assert.match(verifier, /postgres:false/);
  assert.match(verifier, /memory-demo/);
  assert.match(batch, /launch-demo\.ps1/);
  assert.match(batch, /stop-demo\.ps1/);
});

test("launcher stop path is scoped to recorded PIDs", async () => {
  const launcher = await read("scripts/launch-demo.ps1");
  const stopper = await read("scripts/stop-demo.ps1");
  assert.match(launcher, /staticPid/);
  assert.match(launcher, /apiPid/);
  assert.match(stopper, /Get-CimInstance Win32_Process/);
  assert.match(stopper, /Stop-Process -Id \$ProcessId/);
  assert.doesNotMatch(stopper, /Stop-Process\s+-Name/i);
  assert.doesNotMatch(stopper, /-Recurse/i);
  assert.doesNotMatch(stopper, /git\s+(reset|clean)/i);
});

test("launch scripts keep the public authority boundary local", async () => {
  const source = `${await read("scripts/launch-demo.ps1")}\n${await read("scripts/verify-demo-launch.ps1")}`;
  assert.match(source, /memory/);
  assert.doesNotMatch(source, /npm\s+publish/i);
  assert.doesNotMatch(source, /deployContract|createToken|wallet|privateKey/i);
});

test("static package script is deterministic and credential-free", async () => {
  const source = await read("scripts/package-demo.ps1");
  assert.match(source, /static-demo/);
  assert.match(source, /manifest\.json/);
  assert.match(source, /SHA256/);
  assert.match(source, /credentialsRequired\s*=\s*\$false/);
  assert.match(source, /externalDeployment\s*=\s*\$false/);
  assert.match(source, /index\.html/);
  assert.match(source, /favicon\.svg/);
  assert.match(source, /src/);
  assert.match(source, /vendor\\three-r179\.1/);
  assert.match(source, /ce6be0cb5ead0027e1f6094dd82ad43bba0886c03324a3b21fd9a33ac93fc2b4/);
  assert.match(source, /b97879c748170baadeb3fb84cea1ffdf4674e283dc06042f34e2acb95a76042c/);
  assert.match(source, /vendor\/three-r179\\\.1\/build\/three\\\.module\\\.js/);
  assert.match(source, /three\.core\.js/);
  assert.match(source, /EffectComposer\.js/);
  assert.match(source, /MaskPass\.js/);
  assert.match(source, /UnrealBloomPass\.js/);
  assert.match(source, /LuminosityHighPassShader\.js/);
  assert.match(source, /Copy-Item -LiteralPath \(Join-Path \$repositoryRoot "docs"\)/);
  assert.doesNotMatch(source, /npm\s+publish|wrangler\s+deploy|privateKey|wallet/i);
});

