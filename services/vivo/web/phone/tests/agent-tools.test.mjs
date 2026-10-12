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
  const session = { sessionId: 'registered-session', generation: 1 };
  registry.setAgentController({
    setGrantedCapabilities() {},
    assertActive() {},
    sessionCapabilities: () => ['world.read'],
    sessionSource: () => 'worker',
  });
  registry.updateGrants(['world.read']);
  assert.deepEqual(registry.list().map(item => item.name), ['vivo.world.read']);
  assert.equal((await registry.invokeFor(session, 'vivo.world.read')).worldId, 'world-1');
  registry.setLocalCapabilities([]);
  assert.deepEqual(registry.list(), []);
  await assert.rejects(registry.invokeFor(session, 'vivo.world.read'), /unavailable/);
});

test('per-session local tool listing does not expose unregistered world capabilities', () => {
  const registry = new AgentToolRegistry({ localCapabilities: ['world.read', 'world.edit'] });
  registry.setAgentController({
    setGrantedCapabilities() {},
    assertActive() {},
    sessionCapabilities: () => ['world.read'],
  });
  registry.updateGrants(['world.read', 'world.edit']);
  assert.deepEqual(registry.listFor({ sessionId: 'registered-session', generation: 1 }).map(item => item.name), ['vivo.world.read']);
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

test('revokeAll clears controller grants and leaves explicit stop as the only re-enable path', async () => {
  const calls = [];
  const controller = {
    setGrantedCapabilities: async names => { calls.push(['grants', names]); },
    stopAll: async reason => { calls.push(['stop', reason]); return ['stopped']; },
  };
  const registry = new AgentToolRegistry({ agentController: controller, localCapabilities: ['world.edit'] });
  await registry.revokeAll();
  assert.deepEqual(calls, [['grants', []], ['stop', 'grant-revoke-all']]);
  assert.deepEqual(registry.list(), []);
});
