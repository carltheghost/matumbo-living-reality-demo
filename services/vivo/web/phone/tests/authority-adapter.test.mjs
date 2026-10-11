import test from 'node:test';
import assert from 'node:assert/strict';
import {MountedRuntime} from '../../../server/application/runtime.mjs';
import {workshopSeed} from '../../../server/application/seed.mjs';
import {studioBindingDefinition, studioCommitCommand, studioTransformCommand} from '../../../contracts/studio-binding.mjs';
import {LocalVivoEngine} from '../engine.mjs';
import {PHONE_CANONICAL_BINDINGS, PHONE_LOCAL_DIMENSIONS, PHONE_ROOT_DIMENSION, mapPhoneEnvelopeToCanonical} from '../authority-mapping.mjs';
import {PhoneAuthorityAdapter} from '../authority-adapter.mjs';

const copy = value => structuredClone(value);
const initialEnvelope = async worldId => {
  const engine = new LocalVivoEngine();
  await engine.open(worldId, 4);
  return {engine, envelope: await engine.snapshot()};
};
const deferred = () => {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return {promise, resolve};
};

class RuntimeTransport {
  constructor(runtime, options) {
    this.runtime = runtime;
    this.onState = options.onState;
    this.closed = true;
    this.current = null;
    this.session = null;
    this.submitCalls = [];
  }
  receive(state) {
    this.current = copy(state);
    this.onState?.(copy(state));
  }
  async admit(seat) {
    const result = await this.runtime.dispatch({op: 'open', args: {seat}});
    this.closed = false;
    this.session = copy(result.session);
    this.token = result.token;
    this.receive(result.state);
    return {token: this.token, session: copy(this.session), state: copy(result.state)};
  }
  async refresh() {
    const result = await this.runtime.dispatch({op: 'state', token: this.token});
    this.receive(result.state);
    return result;
  }
  getSnapshot() { return copy(this.current.snapshot); }
  async submit(command) {
    this.submitCalls.push(copy(command));
    const result = await this.runtime.dispatch({op: 'submit', token: this.token, args: {command}});
    if (result.state) this.receive(result.state);
    return copy(result.value);
  }
  async close() {
    if (this.closed) return;
    await this.runtime.dispatch({op: 'close', token: this.token});
    this.closed = true;
  }
}

async function fixture() {
  const runtime = await MountedRuntime.open({store: 'memory'});
  const transports = [];
  const makeTransport = options => {
    const transport = new RuntimeTransport(runtime, options);
    transports.push(transport);
    return transport;
  };
  const first = await initialEnvelope('phone.one');
  const second = await initialEnvelope('phone.two');
  const one = new PhoneAuthorityAdapter({snapshot: () => first.engine.snapshot(), transportFactory: makeTransport, seat: 'one'});
  const two = new PhoneAuthorityAdapter({snapshot: () => second.engine.snapshot(), transportFactory: makeTransport, seat: 'two'});
  return {runtime, transports, first, second, one, two};
}

test('phone mapping mirrors the reviewed registry and rejects non-canonical dimensions', async () => {
  assert.deepEqual(PHONE_LOCAL_DIMENSIONS, [3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(PHONE_ROOT_DIMENSION, 4);
  for (const [entityId, expectedBindingId] of Object.entries({relic: 'studio.node.echo', workpiece: 'studio.node.workpiece', portal: 'studio.node.portal'})) {
    const expected = studioBindingDefinition(expectedBindingId);
    assert.deepEqual(PHONE_CANONICAL_BINDINGS[entityId], {
      bindingId: expected.bindingId, sourceModel: expected.sourceModel, sourceNode: expected.sourceNode,
      spaceId: expected.spaceId, entityId: expected.entityId, dimension: expected.dimension,
      chart: expected.chart, metadata: expected.metadata,
    });
  }
  const {engine, envelope} = await initialEnvelope('mapping');
  const available = mapPhoneEnvelopeToCanonical(envelope, 'relic');
  assert.equal(available.status, 'available');
  assert.deepEqual(available.q, [-1.15, -.1, .25, 0]);
  assert.equal(mapPhoneEnvelopeToCanonical(envelope, 'innerRelic').code, 'PHONE_OBJECT_UNBOUND');
  const wide = new LocalVivoEngine(); await wide.open('wide', 5);
  assert.equal((await mapPhoneEnvelopeToCanonical(await wide.snapshot(), 'relic')).code, 'PHONE_DIMENSION_UNSUPPORTED');
  await engine.close(); await wide.close();
});

test('two phone clients connect/read/preview explicitly and keep projection separate from canonical commit', async t => {
  const {runtime, transports, first, second, one, two} = await fixture();
  t.after(async () => { await one.close(); await two.close(); await first.engine.close(); await second.engine.close(); await runtime.dispatch({op: 'shutdown'}); });

  const connectedOne = await one.connect();
  assert.equal(connectedOne.connected, true);
  assert.equal(transports[0].submitCalls.length, 0, 'connect must not publish local state');

  await first.engine.translate('relic', 0, .65);
  const preview = await one.preview({entityId: 'relic'});
  assert.equal(preview.status, 'preview');
  assert.ok(Math.abs(preview.q[0] + .5) < 1e-9);
  assert.equal(transports[0].submitCalls.length, 0, 'preview must not send');

  const published = await one.publish();
  assert.equal(published.status, 'accepted');
  assert.equal(published.projectionOnly, true);
  assert.deepEqual(one.debug().acceptedEntity.q, [-1.2, -.15, .25, 0]);
  assert.deepEqual(one.debug().local?.mode, 'local');

  // The second phone joins after the projection so its initial accepted
  // baseline is unambiguous; its local object still remains independently
  // owned and must be read explicitly.
  const connectedTwo = await two.connect();
  assert.equal(connectedTwo.connected, true);
  await two.read();
  assert.ok(Math.abs(two.debug().acceptedBinding.q[0] + .5) < 1e-9);
  assert.deepEqual(two.debug().acceptedEntity.q, [-1.2, -.15, .25, 0]);

  await second.engine.translate('relic', 0, .9);
  const committed = await two.commit();
  assert.equal(committed.status, 'accepted');
  assert.equal(committed.canonical, true);
  assert.equal(two.debug().acceptedEntity.revision, 1);
  assert.ok(Math.abs(two.debug().acceptedEntity.q[0] + .25) < 1e-9);
  assert.ok(Math.abs((await second.engine.snapshot()).snapshot.spaces.root.entities.relic.q[0] + .25) < 1e-9);
  assert.notEqual(first.engine.eye.id, second.engine.eye.id, 'phone Eyes remain independent');
});

test('stale accepted changes require an explicit conflict retry and never replace the phone object', async t => {
  const {runtime, transports, first, second, one, two} = await fixture();
  t.after(async () => { await one.close(); await two.close(); await first.engine.close(); await second.engine.close(); await runtime.dispatch({op: 'shutdown'}); });
  await one.connect();
  await first.engine.translate('relic', 0, .4); await one.publish();
  await two.connect();
  await first.engine.translate('relic', 0, .1);
  await second.engine.translate('relic', 0, .8); await two.commit();
  await one.read();
  assert.equal(one.debug().conflict?.code, 'STUDIO_CONFLICT');
  const before = (await first.engine.snapshot()).snapshot.spaces.root.entities.relic.q.slice();
  const callsBefore = transports[0].submitCalls.length;
  const blocked = await one.publish();
  assert.equal(blocked.status, 'rejected'); assert.equal(blocked.code, 'STUDIO_CONFLICT'); assert.equal(blocked.retryArmed, true);
  assert.equal(transports[0].submitCalls.length, callsBefore, 'first conflict action must not send');
  const wrongAction = await one.commit();
  assert.equal(wrongAction.status, 'rejected'); assert.equal(wrongAction.code, 'STUDIO_CONFLICT');
  assert.equal(transports[0].submitCalls.length, callsBefore, 'changing conflict action must not send');
  const resolved = await one.commit();
  assert.equal(resolved.status, 'accepted');
  assert.equal(transports[0].submitCalls.length, callsBefore + 1);
  assert.deepEqual((await first.engine.snapshot()).snapshot.spaces.root.entities.relic.q, before);
});

test('a conflict acknowledgement is retained per binding when another phone object is selected', async t => {
  const {runtime, transports, first, second, one, two} = await fixture();
  t.after(async () => { await one.close(); await two.close(); await first.engine.close(); await second.engine.close(); await runtime.dispatch({op: 'shutdown'}); });
  await one.connect();
  await first.engine.translate('relic', 0, .4); await one.publish();
  await two.connect();
  await first.engine.translate('relic', 0, .1);
  await second.engine.translate('relic', 0, .8); await two.commit();
  await one.read();
  assert.equal(one.debug().conflict?.code, 'STUDIO_CONFLICT');
  await one.selectEntity('workpiece');
  assert.equal(one.debug().conflict, null);
  await one.selectEntity('relic');
  assert.equal(one.debug().conflict?.bindingId, 'studio.node.echo');
  const firstRetry = await one.commit();
  assert.equal(firstRetry.status, 'rejected'); assert.equal(firstRetry.code, 'STUDIO_CONFLICT');
  const secondRetry = await one.commit();
  assert.equal(secondRetry.status, 'accepted');
  assert.ok(transports[0].submitCalls.some(command => command.kind === 'studio.commit'));
});

test('canonical entity changes with an unchanged binding q require explicit conflict acknowledgement', async t => {
  const {runtime, transports, first, second, one, two} = await fixture();
  t.after(async () => { await one.close(); await two.close(); await first.engine.close(); await second.engine.close(); await runtime.dispatch({op: 'shutdown'}); });
  await one.connect();
  first.engine.world.spaces.root.entities.relic.q[0] = 7;
  await one.syncLocal(); await one.publish();
  await two.connect();
  second.engine.world.spaces.root.entities.relic.q[0] = 3;
  await two.syncLocal();
  await one.commit();
  assert.equal(one.debug().acceptedBinding.q[0], 7);
  assert.equal(one.debug().acceptedEntity.q[0], 7);
  await two.read();
  assert.equal(two.debug().conflict?.acceptedBinding.q[0], 7);
  assert.equal(two.debug().conflict?.acceptedEntity.q[0], 7);
  const callsBefore = transports[1].submitCalls.length;
  const blocked = await two.commit();
  assert.equal(blocked.status, 'rejected'); assert.equal(blocked.code, 'STUDIO_CONFLICT');
  assert.equal(transports[1].submitCalls.length, callsBefore);
  assert.equal(two.debug().acceptedEntity.q[0], 7);
  const accepted = await two.commit();
  assert.equal(accepted.status, 'accepted');
  assert.equal(two.debug().acceptedEntity.q[0], 3);
});

test('pending command loading fences a new offline branch before transport submit', async t => {
  const {runtime, transports, first, one} = await fixture();
  t.after(async () => { await one.close(); await first.engine.close(); await runtime.dispatch({op: 'shutdown'}); });
  await one.connect();
  first.engine.world.spaces.root.entities.relic.q[0] = 1;
  await one.syncLocal();
  const loaderStarted = deferred();
  const releaseLoader = deferred();
  one.commandLoader = async () => { loaderStarted.resolve(); return releaseLoader.promise; };
  const pending = one.commit();
  await loaderStarted.promise;
  first.engine.forkOffline('race branch');
  await one.syncLocal();
  releaseLoader.resolve({studioCommitCommand, studioTransformCommand});
  const result = await pending;
  assert.equal(result.code, 'PHONE_OFFLINE_BRANCH_NO_SEND');
  assert.equal(transports[0].submitCalls.length, 0);
  assert.equal(one.debug().local.mode, 'offline-branch');
});

test('close disposes a transport that resolves after connect was cancelled', async () => {
  const factoryResult = deferred();
  const snapshot = await initialEnvelope('late-connect');
  const late = {
    closed: false, closeCalls: 0, admitCalls: 0,
    async admit() { this.admitCalls++; throw new Error('late admit must not run'); },
    async close() { this.closeCalls++; this.closed = true; },
  };
  const adapter = new PhoneAuthorityAdapter({snapshot: () => snapshot.envelope, transportFactory: () => factoryResult.promise});
  const connecting = adapter.connect();
  await Promise.resolve();
  await adapter.close();
  factoryResult.resolve(late);
  const result = await connecting;
  assert.equal(result.code, 'AUTHORITY_SESSION_CHANGED');
  assert.equal(late.admitCalls, 0);
  assert.equal(late.closeCalls, 1);
  assert.equal(adapter.debug().connected, false);
  await snapshot.engine.close();
});

test('older local snapshot results cannot replace a newer explicit offline envelope', async () => {
  const source = await initialEnvelope('local-fence');
  const oldResult = deferred();
  let calls = 0;
  const adapter = new PhoneAuthorityAdapter({snapshot: () => {
    calls++;
    return calls === 1 ? oldResult.promise : source.engine.snapshot();
  }});
  const older = adapter.syncLocal();
  const offline = copy(await source.engine.snapshot());
  offline.mode = 'offline-branch'; offline.branchId = 'offline.new'; offline.parentBranchId = 'local-fence';
  await adapter.syncLocal(offline);
  oldResult.resolve(copy(await source.engine.snapshot()));
  await older;
  assert.equal(adapter.debug().local.mode, 'offline-branch');
  assert.equal(adapter.debug().local.branchId, 'offline.new');
  await source.engine.close();
});

test('offline branch, permission, material and journal gates reject without a send or local mutation', async t => {
  const {runtime, transports, first, one} = await fixture();
  t.after(async () => { await one.close(); await first.engine.close(); await runtime.dispatch({op: 'shutdown'}); });
  await one.connect();
  await first.engine.translate('relic', 0, .2);
  const before = (await first.engine.snapshot()).snapshot.spaces.root.entities.relic.q.slice();
  await first.engine.forkOffline('No network'); await one.syncLocal();
  const calls = transports[0].submitCalls.length;
  const offline = await one.commit();
  assert.equal(offline.code, 'PHONE_OFFLINE_BRANCH_NO_SEND');
  assert.equal(transports[0].submitCalls.length, calls);
  assert.deepEqual((await first.engine.snapshot()).snapshot.spaces.root.entities.relic.q, before);

  // Return to a local envelope only for the capability gates below; none of
  // these branches invoke transport.submit.
  first.engine.mode = 'local'; await one.syncLocal();
  one.transport.session = {...one.transport.session, capabilities: ['observe']};
  const permission = await one.publish();
  assert.equal(permission.code, 'STUDIO_PERMISSION_DENIED');
  one.transport.session = {...one.transport.session, capabilities: ['grab', 'observe', 'nested']};
  one.state.capabilities.studio.canonicalCommit = {allowed: false, durable: false, rejectionCode: 'STUDIO_MATERIAL_BOUNDARY', reason: 'material boundary'};
  const material = await one.commit();
  assert.equal(material.code, 'STUDIO_MATERIAL_BOUNDARY');
  one.state.capabilities.studio.canonicalCommit = {allowed: true, durable: false, rejectionCode: null, reason: 'memory'};
  one.state.journal = {readOnly: true, backpressure: true};
  const journal = await one.publish();
  assert.equal(journal.code, 'JOURNAL_BACKPRESSURE');
  assert.equal(transports[0].submitCalls.length, calls);
  assert.deepEqual((await first.engine.snapshot()).snapshot.spaces.root.entities.relic.q, before);
});

test('a pending read cannot resurrect the connected message after close', async t => {
  const {runtime, transports, first, one} = await fixture();
  t.after(async () => { await one.close(); await first.engine.close(); await runtime.dispatch({op: 'shutdown'}); });
  await one.connect();
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const transport = transports[0];
  const originalRefresh = transport.refresh.bind(transport);
  transport.refresh = async () => {
    refreshStarted.resolve();
    await releaseRefresh.promise;
    return originalRefresh();
  };
  const pending = one.read();
  await refreshStarted.promise;
  await one.close();
  releaseRefresh.resolve();
  const result = await pending;
  assert.equal(result.status, 'rejected');
  assert.equal(result.code, 'AUTHORITY_SESSION_CHANGED');
  assert.equal(one.debug().connected, false);
  assert.match(one.debug().message, /disconnected/i);
  assert.doesNotMatch(one.debug().message, /refreshed/i);
});

test('a selection change while refresh is pending cannot retarget the command', async t => {
  const {runtime, transports, first, one} = await fixture();
  t.after(async () => { await one.close(); await first.engine.close(); await runtime.dispatch({op: 'shutdown'}); });
  await one.connect();
  first.engine.world.spaces.root.entities.relic.q[0] = 1;
  await one.syncLocal();
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const transport = transports[0];
  const originalRefresh = transport.refresh.bind(transport);
  transport.refresh = async () => {
    refreshStarted.resolve();
    await releaseRefresh.promise;
    return originalRefresh();
  };
  const pending = one.commit();
  await refreshStarted.promise;
  await one.selectEntity('workpiece');
  releaseRefresh.resolve();
  const result = await pending;
  assert.equal(result.status, 'rejected');
  assert.equal(result.code, 'PHONE_LOCAL_STATE_CHANGED');
  assert.equal(result.action, 'commit');
  assert.equal(transport.submitCalls.length, 0);
  assert.equal(one.debug().selectedEntityId, 'workpiece');
});

test('a remote accepted revision during command loading requires a fresh conflict acknowledgement', async t => {
  const {runtime, transports, first, second, one, two} = await fixture();
  t.after(async () => { await one.close(); await two.close(); await first.engine.close(); await second.engine.close(); await runtime.dispatch({op: 'shutdown'}); });
  await one.connect();
  await two.connect();
  first.engine.world.spaces.root.entities.relic.q[0] = 1;
  await one.syncLocal();
  second.engine.world.spaces.root.entities.relic.q[0] = 2;
  await two.syncLocal();
  await two.commit();
  await one.read();
  const armed = await one.commit();
  assert.equal(armed.code, 'STUDIO_CONFLICT');
  assert.equal(armed.retryArmed, true);

  const loaderStarted = deferred();
  const releaseLoader = deferred();
  one.commandLoader = async () => { loaderStarted.resolve(); return releaseLoader.promise; };
  const pending = one.commit();
  await loaderStarted.promise;
  second.engine.world.spaces.root.entities.relic.q[0] = 3;
  await two.syncLocal();
  await two.commit();
  // The production transport delivers this state through its subscription;
  // the in-process test transport models that delivery explicitly.
  one.receive(transports[1].current);
  releaseLoader.resolve({studioCommitCommand, studioTransformCommand});
  const result = await pending;
  assert.equal(result.status, 'rejected');
  assert.equal(result.code, 'STUDIO_CONFLICT');
  assert.equal(transports[0].submitCalls.length, 0);
  assert.equal(result.retryArmed, true, 'the newer accepted state must be acknowledged again');
  assert.equal(one.debug().conflict?.retryArmed, true);
  const accepted = await one.commit();
  assert.equal(accepted.status, 'accepted');
});

test('a dirty unselected binding keeps its conflict baseline across selection changes', async t => {
  const {runtime, transports, first, second, one, two} = await fixture();
  t.after(async () => { await one.close(); await two.close(); await first.engine.close(); await second.engine.close(); await runtime.dispatch({op: 'shutdown'}); });
  await one.connect();
  await two.connect();
  first.engine.world.spaces.root.entities.relic.q[0] = 1;
  await one.syncLocal();
  await one.selectEntity('workpiece');
  second.engine.world.spaces.root.entities.relic.q[0] = 2;
  await two.syncLocal();
  await two.commit();
  await one.read();
  assert.equal(one.debug().selectedEntityId, 'workpiece');
  assert.equal(one.debug().conflict, null);
  await one.selectEntity('relic');
  assert.equal(one.debug().conflict?.bindingId, 'studio.node.echo');
  const callsBefore = transports[0].submitCalls.length;
  const blocked = await one.commit();
  assert.equal(blocked.code, 'STUDIO_CONFLICT');
  assert.equal(blocked.retryArmed, true);
  assert.equal(transports[0].submitCalls.length, callsBefore);
  const accepted = await one.commit();
  assert.equal(accepted.status, 'accepted');
  assert.equal(one.debug().acceptedEntity.q[0], 1);
});

test('a newer overlapping connect admission wins and disposes the older factory result', async t => {
  const runtime = await MountedRuntime.open({store: 'memory'});
  const source = await initialEnvelope('overlapping-connect');
  const firstFactory = deferred();
  const secondFactory = deferred();
  let factoryCalls = 0;
  const adapter = new PhoneAuthorityAdapter({
    snapshot: () => source.engine.snapshot(),
    transportFactory: async () => (++factoryCalls === 1 ? firstFactory.promise : secondFactory.promise),
  });
  const makeClient = ({admit = true} = {}) => ({
    closed: false,
    closeCalls: 0,
    admitCalls: 0,
    current: null,
    session: null,
    async admit(seat) {
      this.admitCalls++;
      if (!admit) throw new Error('late client must not be admitted');
      const result = await runtime.dispatch({op: 'open', args: {seat}});
      this.session = copy(result.session);
      this.token = result.token;
      this.current = copy(result.state);
      return {token: this.token, session: copy(this.session), state: copy(result.state)};
    },
    getSnapshot() { return copy(this.current?.snapshot); },
    async close() { this.closeCalls++; this.closed = true; },
  });
  t.after(async () => { await adapter.close(); await source.engine.close(); await runtime.dispatch({op: 'shutdown'}); });

  const older = adapter.connect();
  await Promise.resolve();
  const newer = adapter.connect();
  const winningClient = makeClient();
  secondFactory.resolve(winningClient);
  const winningResult = await newer;
  const losingClient = makeClient({admit: false});
  firstFactory.resolve(losingClient);
  const losingResult = await older;

  assert.equal(winningResult.connected, true);
  assert.equal(losingResult.code, 'AUTHORITY_SESSION_CHANGED');
  assert.equal(adapter.transport, winningClient);
  assert.equal(losingClient.admitCalls, 0);
  assert.equal(losingClient.closeCalls, 1);
  assert.equal(winningClient.closeCalls, 0);
});

