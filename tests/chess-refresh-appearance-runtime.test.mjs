import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('chess arena defines its public refreshAppearance hook before returning it',async()=>{
  const source=await readFile(new URL('../src/render/chess-arena.js',import.meta.url),'utf8');
  const definition=source.indexOf('function refreshAppearance(){');
  const exported=source.indexOf('refreshAppearance,');
  assert.ok(definition>=0,'refreshAppearance definition must exist');
  assert.ok(exported>definition,'return object must reference the defined hook');
  assert.doesNotMatch(source,/return\s*\{[\s\S]*?refreshAppearance,\s*destroy:/);
  assert.match(source,/const view=documentRoot\.defaultView\?\.\?null;[\s\S]{0,500}function refreshAppearance\(\)/);
});

test('chess arena cleans up appearance-change listeners',async()=>{
  const source=await readFile(new URL('../src/render/chess-arena.js',import.meta.url),'utf8');
  assert.match(source,/removeEventListener\?\.\('storage',onStorage\)/);
  assert.match(source,/removeEventListener\?\.\('person-studio:avatar-changed',onAvatarFaceChanged\)/);
});