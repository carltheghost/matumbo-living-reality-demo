import test from 'node:test';
import assert from 'node:assert/strict';
import {MountedRuntime} from '../../../server/application/runtime.mjs';
import {workshopSeed} from '../../../server/application/seed.mjs';
import {studioBindingDefinition} from '../../../contracts/studio-binding.mjs';
import {LocalVivoEngine} from '../engine.mjs';
import {PHONE_CANONICAL_BINDINGS, PHONE_LOCAL_DIMENSIONS, PHONE_ROOT_DIMENSION, mapPhoneEnvelopeToCanonical} from '../authority-mapping.mjs';
import {PhoneAuthorityAdapter} from '../authority-adapter.mjs';

const copy = value => structuredClone(value);
const initialEnvelope = async worldId => {
  const engine = new LocalVivoEngine();
  await engine.open(worldId, 4);
  return {engine, envelope: await engine.snapshot()};
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
  const resolved = await one.publish();
  assert.equal(resolved.status, 'accepted');
  assert.equal(transports[0].submitCalls.length, callsBefore + 1);
  assert.deepEqual((await first.engine.snapshot()).snapshot.spaces.root.entities.relic.q, before);
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

