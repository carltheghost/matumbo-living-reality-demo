import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentToolRegistry } from '../agent-tools.mjs';

test('agents receive exactly the granted capabilities and revoked calls stop immediately', async () => {
  const bridge = { available: true, invoke: async (name, args) => ({ name, textLength: String(args.text || '').length }) };
  const registry = new AgentToolRegistry({ bridge });
  registry.updateGrants(['clipboard.write']);
  assert.deepEqual(registry.list().map(item => item.name), ['phone.clipboard.write']);
  await assert.rejects(registry.invoke('phone.files.open'), /not granted/);
  const result = await registry.invoke('phone.clipboard.write', { text: 'private payload' });
  assert.equal(result.textLength, 15);
  assert.equal(JSON.stringify(registry.audit).includes('private payload'), false);
  registry.revokeAll();
  await assert.rejects(registry.invoke('phone.clipboard.write'), /not granted/);
});

test('local agent tools remain hidden until the matching user grant exists', async () => {
  const bridge = { invokeLocal: async () => ({ worldId: 'world-1' }) };
  const registry = new AgentToolRegistry({ bridge, localCapabilities: ['world.read'] });
  registry.updateGrants(['world.read']);
  assert.deepEqual(registry.list().map(item => item.name), ['vivo.world.read']);
  assert.equal((await registry.invoke('vivo.world.read')).worldId, 'world-1');
  registry.setLocalCapabilities([]);
  assert.deepEqual(registry.list(), []);
  await assert.rejects(registry.invoke('vivo.world.read'), /unavailable/);
});

test('torch is advertised and dispatched only with the explicit torch grant', async () => {
  const calls = [];
  const bridge = { available: true, invoke: async (name, args) => { calls.push({ name, args }); return { enabled: args.enabled }; } };
  const registry = new AgentToolRegistry({ bridge });
  registry.updateGrants(['torch']);
  assert.deepEqual(registry.list().map(item => item.name), ['phone.torch.set']);
  assert.deepEqual(await registry.invoke('phone.torch.set', { enabled: false }), { enabled: false });
  assert.deepEqual(calls, [{ name: 'phone.torch.set', args: { enabled: false } }]);
  registry.revokeAll();
  assert.deepEqual(registry.list(), []);
  await assert.rejects(registry.invoke('phone.torch.set', { enabled: true }), /not granted/);
});
