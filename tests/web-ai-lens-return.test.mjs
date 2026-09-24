import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildAiPrompt,WEB_AI_BOUNDARY,WEB_AI_STORAGE_KEYS} from '../src/domains/web-ai.js';

test('assistant handoff describes the current object-first Lens rather than the obsolete cube scene',()=>{
  const prompt=buildAiPrompt({taskNote:'Continue the Reality Lens UI'});
  assert.match(prompt,/live interfaces attached to mutable 3D objects/);
  assert.match(prompt,/no provider OAuth or sign-in bridge/);
  assert.match(prompt,/Task note: Continue the Reality Lens UI/);
  assert.doesNotMatch(prompt,/static three\.js world of translucent blue glass cubes/);
});

test('external sign-in remains separate and the same Lens object has an explicit return affordance',async()=>{
  assert.match(WEB_AI_BOUNDARY,/separate tab that leaves the Reality Lens open/);
  assert.match(WEB_AI_BOUNDARY,/does not authorize this demo|does not authorize/i);
  assert.equal(WEB_AI_STORAGE_KEYS.lensReturn,'tumbo.web-ai.lens-return.v1');
  const source=await readFile(new URL('../src/render/web-ai.js',import.meta.url),'utf8');
  assert.match(source,/RETURN TO THIS LENS OBJECT/);
  assert.match(source,/windowRoot\?\.addEventListener\?\.\("focus",observeExternalReturn\)/);
  assert.match(source,/doc\.addEventListener\?\.\("visibilitychange",observeExternalReturn\)/);
  assert.match(source,/returnedToSameTab:true,registrationVerified:false/);
  assert.match(source,/localStorage|WEB_AI_STORAGE_KEYS\.taskNote/);
});

test('new-tab handoff preserves browser separation while avoiding the noopener null-handle trap',async()=>{
  const source=await readFile(new URL('../src/render/web-ai.js',import.meta.url),'utf8');
  assert.match(source,/windowRoot\.open\(url, "_blank"\)/);
  assert.match(source,/opened\.opener = null/);
  assert.doesNotMatch(source,/windowRoot\.open\(url, "_blank", "noopener"\)/);
});
