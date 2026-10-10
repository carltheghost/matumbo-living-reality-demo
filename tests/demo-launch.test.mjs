import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

test("Windows launcher verifies this checkout's loopback bridge and exposes its provider state", async () => {
  const launcher = await read("scripts/launch-demo.ps1");
  const verifier = await read("scripts/verify-demo-launch.ps1");
  const batch = await read("run_local.bat");
  assert.match(verifier, /http:\/\/127\.0\.0\.1:\$StaticPort/);
  assert.match(launcher, /provider_bridge\.py/);
  assert.match(verifier, /api\/health/);
  assert.match(verifier, /api\/providers/);
  assert.match(verifier, /rootFingerprint/);
  assert.match(verifier, /featureCount/);
  assert.match(launcher, /OpenBrowser/);
  assert.match(launcher, /WindowStyle Hidden/);
  assert.doesNotMatch(launcher+verifier, /runtime\\merge4|memory-demo|postgres:false/);
  assert.match(batch, /launch-demo\.ps1/);
  assert.match(batch, /stop-demo\.ps1/);
});

test("launcher stop path is scoped to recorded PIDs", async () => {
  const launcher = await read("scripts/launch-demo.ps1");
  const stopper = await read("scripts/stop-demo.ps1");
  assert.match(launcher, /creationTime/);
  assert.match(launcher, /instanceId/);
  assert.match(stopper, /Get-CimInstance Win32_Process/);
  assert.match(stopper, /Stop-Process -Id \$ProcessId/);
  assert.doesNotMatch(stopper, /Stop-Process\s+-Name/i);
  assert.doesNotMatch(stopper, /-Recurse/i);
  assert.doesNotMatch(stopper, /git\s+(reset|clean)/i);
});

test("launch scripts keep the public authority boundary local", async () => {
  const source = `${await read("scripts/launch-demo.ps1")}\n${await read("scripts/verify-demo-launch.ps1")}`;
  assert.match(source, /externalDeployment=\$false/);
  assert.doesNotMatch(source, /npm\s+publish/i);
  assert.doesNotMatch(source, /deployContract|createToken|wallet|privateKey/i);
});

test("static package script is deterministic and credential-free", async () => {
  const source = `${await read("scripts/package-demo.ps1")}\n${await read("scripts/package_demo.py")}`;
  assert.match(source, /static-demo/);
  assert.match(source, /manifest\.json/);
  assert.match(source, /SHA256/);
  assert.match(source, /'credentialsRequired':False/);
  assert.match(source, /'externalDeployment':False/);
  assert.match(source, /index\.html/);
  assert.match(source, /hashlib\.sha256/);
  assert.match(source, /date_time=\(2026,1,1,0,0,0\)/);
  assert.match(source, /testzip\(\)/);
  assert.doesNotMatch(source, /npm\s+publish|wrangler\s+deploy|privateKey|wallet/i);
});

test('Windows launch/reuse/stop checks exercise actual owned processes',{skip:process.platform!=='win32',timeout:60000},()=>{
  const output=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('test-demo-launch.ps1',import.meta.url))],{encoding:'utf8',timeout:55000});
  assert.match(output,/Launch, reuse, guarded stop and foreign-listener checks passed/);
});

