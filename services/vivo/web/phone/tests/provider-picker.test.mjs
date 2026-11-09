import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AI_PROVIDERS,findAIProviders} from '../ai-accounts-panel.mjs';

test('ten unique connection routes grouped by method, not invented models',()=>{
  assert.equal(AI_PROVIDERS.length,10);
  assert.equal(new Set(AI_PROVIDERS.map(p=>p.id)).size,10);
  assert.deepEqual([...new Set(AI_PROVIDERS.map(p=>p.group))],['Popular','Local & self-hosted','Advanced']);
  assert.equal(AI_PROVIDERS.filter(p=>p.group==='Popular').length,6);
});
test('only implemented ChatGPT host route advertises an executable sign-in action',()=>{
  assert.deepEqual(AI_PROVIDERS.filter(p=>p.action).map(p=>p.id),['chatgpt-plan']);
});
test('subscription and separately billed API access remain distinct',()=>{
  assert.equal(AI_PROVIDERS.find(p=>p.id==='chatgpt-plan').method,'Plan sign-in');
  assert.equal(AI_PROVIDERS.find(p=>p.id==='openai-api').method,'API key');
  assert.match(AI_PROVIDERS.find(p=>p.id==='openai-api').description,/Separate API billing/);
});
test('Claude subscription is labelled native application, never generic third-party OAuth',()=>{
  const p=AI_PROVIDERS.find(p=>p.id==='claude-native');
  assert.equal(p.action,null);assert.equal(p.method,'Native app');assert.match(p.description,/not a Claude login inside Vivo/);
});
test('case-insensitive search matches provider and connection method',()=>{
  assert.equal(findAIProviders('  cLaUdE ').length,2);
  assert.equal(findAIProviders('API key').length,4);
  assert.equal(findAIProviders('does-not-exist').length,0);
  assert.equal(findAIProviders().length,10);
  assert.throws(()=>findAIProviders(null),TypeError);
});
test('catalogue and returned provider objects cannot be mutated',()=>{
  assert(Object.isFrozen(AI_PROVIDERS));assert(AI_PROVIDERS.every(Object.isFrozen));
  assert.throws(()=>{findAIProviders('ChatGPT')[0].action='invented';},TypeError);
});
test('documentation links use HTTPS, with no invented authorization endpoints',()=>{
  for(const p of AI_PROVIDERS)if(p.help){const u=new URL(p.help);assert.equal(u.protocol,'https:');assert.equal(u.username,'');assert.equal(u.password,'');}
});
test('device acceleration and persistent agent histories are not fabricated',()=>{
  assert.match(AI_PROVIDERS.find(p=>p.id==='local-model').description,/No NPU support is assumed/);
  assert.match(AI_PROVIDERS.find(p=>p.id==='persistent-agents').description,/own supported session connector/);
});
test('native memory and current toolbar integration are retained',async()=>{
  const src=await readFile(new URL('../ai-accounts-panel.mjs',import.meta.url),'utf8');
  assert.match(src,/new ConstructiveMemory/);assert.match(src,/publishedSnapshot/);
  assert.match(src,/AI & memory/);assert.match(src,/vivo:phone-local-ready/);
  assert.doesNotMatch(src,/createElement\(['"]iframe/);
});
