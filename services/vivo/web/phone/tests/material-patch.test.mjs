import test from 'node:test';
import assert from 'node:assert/strict';
import { createEye, createPhoneSnapshot, stepSparseSpace } from '../engine.mjs';
import {
  PHONE_MATERIAL_TARGET_SCHEMA,
  materialIdentityFromEnvelope,
} from '../material-contract.mjs';
import {
  MaterialContactQueue,
  PhoneMaterialAuthority,
  capturedInverseMapping,
  projectMaterialBody,
} from '../material-patch.mjs';

const clone = value => structuredClone(value);

function makeEnvelope(dimension = 4, { branchId = 'branch-a', worldId = `material-world-${dimension}` } = {}) {
  const snapshot = createPhoneSnapshot({ worldId, rootDimension: dimension });
  const eye = createEye({ id: `eye-${dimension}`, dimension });
  return {
    snapshot,
    eyes: { [eye.id]: eye },
    currentEyeId: eye.id,
    branchId,
    mode: 'local',
  };
}

function inverseFor(q, point = [100, 100]) {
  return capturedInverseMapping({
    devicePoint: point,
    viewport: { left: 0, top: 0, width: 400, height: 400 },
    renderer: { w: 400, h: 400, yaw: 0.55, pitch: 0.68, distance: 10.5, origin: [0, 0, 0] },
    axes: [0, 2, 1], depth: 10.5, canonicalQ: q,
  });
}

function openAuthority(dimension = 4, options = {}) {
  const envelope = makeEnvelope(dimension, options);
  const authority = new PhoneMaterialAuthority({ now: () => 1000, sessionId: 'material-session-a' });
  const opened = authority.open({ envelope });
  assert.equal(opened.available, true);
  const body = opened.body;
  const identity = materialIdentityFromEnvelope(envelope, 'workpiece', body);
  let sequence = envelope.snapshot.acceptedSequence;
  const nextSequence = () => ++sequence;
  return { envelope, authority, body, identity, nextSequence, get sequence() { return sequence; } };
}

function source(kind, sourceId, generation = 1, extras = {}) {
  return { kind, sourceId, sessionId: extras.sessionId || 'source-session', generation, ...extras };
}

function attachment(body, nodeId, capturedAt = 10, point = [100, 100]) {
  const q = body.nodes[nodeId].q;
  return { nodeId, capturedCanonicalPoint: [...q], capturedAt, inverseMapping: inverseFor(q, point) };
}

function beginContact(context, {
  operationId = 'begin:one', contactId = 'contact:one', source: owner = source('finger', 'hand-1:index', 1, { parentSourceId: 'hand-1', fingerId: 'index' }), nodeId = 'workpiece.patch.v1.r1c1', observedAt = 10,
} = {}) {
  return context.authority.begin({
    envelope: context.envelope, operationId, contactId, source: owner,
    identity: context.identity, attachment: attachment(context.body, nodeId, observedAt),
    actuator: { maxForce: 2, stiffness: 3, damping: 0.4 }, observedAt, receivedAt: observedAt + 1,
    nextSequence: context.nextSequence,
  });
}

function targetFor(context, contact, {
  operationId = 'target:one', targetSeq = 1, nodeId = contact.attachment.nodeId,
  q = null, source: owner = contact.source, observedAt = 20, identity = null,
} = {}) {
  const targetQ = q || context.body.nodes[nodeId].q.map((value, axis) => value + (axis === 0 ? 0.32 : 0));
  return context.authority.target({
    envelope: context.envelope, schema: PHONE_MATERIAL_TARGET_SCHEMA, operationId,
    contactId: contact.contactId, identity: { ...context.identity, ...(identity || {}), bodyRevision: context.authority.body.bodyRevision },
    source: owner, targetSeq, q: targetQ, attachment: attachment(context.body, nodeId, observedAt),
    actuator: { maxForce: 2, stiffness: 3, damping: 0.4 }, observedAt, receivedAt: observedAt + 1,
    nextSequence: context.nextSequence,
  });
}

test('creates a versioned Workpiece patch on existing identity with stable nodes and zero-mean centroid offsets', () => {
  const { authority, body } = openAuthority(4);
  assert.equal(body.schema, 'vivo.phone.material-body/1');
  assert.equal(body.identity.entityId, 'workpiece');
  assert.equal(body.identity.dimension, 4);
  assert.equal(Object.keys(body.nodes).length, 12);
  assert.equal(body.edges.length, 23);
  assert.equal(body.topologyId, 'workpiece.patch.grid-4x3');
  assert.deepEqual(body.nodes['workpiece.patch.v1.r0c0'].restQ, body.nodes['workpiece.patch.v1.r0c0'].q);
  assert.deepEqual(body.centroid.q, body.nodes[Object.keys(body.nodes)[0]].q.map((_, axis) => {
    return Object.values(body.nodes).reduce((sum, node) => sum + node.q[axis], 0) / Object.keys(body.nodes).length;
  }));
  assert.equal(authority.snapshot().contactsPersisted, false);
  assert.equal('contacts' in body, false);
});

test('five distinct node contacts retain complete identity, node attachment, inverse mapping, and source generations', () => {
  const context = openAuthority();
  const nodes = ['r0c0', 'r0c1', 'r1c1', 'r2c2', 'r1c3'].map(suffix => `workpiece.patch.v1.${suffix}`);
  const contacts = nodes.map((nodeId, index) => beginContact(context, {
    operationId: `begin:${index}`, contactId: `contact:${index}`,
    source: source('finger', `hand-${index < 2 ? 1 : 2}:${['thumb', 'index', 'middle', 'ring', 'pinky'][index]}`, 1, { parentSourceId: `hand-${index < 2 ? 1 : 2}`, fingerId: ['thumb', 'index', 'middle', 'ring', 'pinky'][index] }), nodeId,
  }));
  assert.deepEqual(contacts.map(item => item.contact.attachment.nodeId), nodes);
  for (const contact of contacts) {
    assert.equal(contact.contact.attachment.inverseMapping.schema, 'vivo.phone.material-inverse/1');
    assert.equal(contact.contact.source.sessionId, 'source-session');
  }
  assert.equal(context.authority.snapshot().activeContacts.length, 5);
});

test('ten fingertip-sized sources can own ten distinct material nodes without fabric averaging', () => {
  const context = openAuthority();
  const nodeIds = Object.keys(context.body.nodes);
  for (let index = 0; index < 10; index++) {
    beginContact(context, {
      operationId: `begin:finger:${index}`, contactId: `finger:${index}`,
      nodeId: nodeIds[index],
      source: source('finger', `${index < 5 ? 'left' : 'right'}:${['thumb', 'index', 'middle', 'ring', 'pinky'][index % 5]}`, 1, {
        parentSourceId: index < 5 ? 'left' : 'right', fingerId: ['thumb', 'index', 'middle', 'ring', 'pinky'][index % 5],
      }),
    });
  }
  assert.equal(context.authority.snapshot().activeContacts.length, 10);
  assert.deepEqual(context.authority.snapshot().activeContacts.map(item => item.nodeId), nodeIds.slice(0, 10));
});

test('moved right nodes change edge lengths and propagate to neighbors while rigid geometry scale remains entity-owned', () => {
  const context = openAuthority();
  const left = beginContact(context, { operationId: 'begin:left', contactId: 'left', nodeId: 'workpiece.patch.v1.r1c1', source: source('touch', 'left-touch') });
  const right = beginContact(context, { operationId: 'begin:right', contactId: 'right', nodeId: 'workpiece.patch.v1.r1c3', source: source('touch', 'right-touch') });
  const before = clone(context.authority.body);
  const leftTarget = targetFor(context, left.contact, { operationId: 'target:left', targetSeq: 1, q: before.nodes[left.contact.attachment.nodeId].q });
  const rightTargetQ = before.nodes[right.contact.attachment.nodeId].q.map((value, axis) => value + (axis === 0 ? 0.72 : axis === 2 ? 0.18 : 0));
  targetFor(context, right.contact, { operationId: 'target:right', targetSeq: 1, q: rightTargetQ });
  const bodyBeforeStep = clone(context.authority.body);
  const initialEdge = bodyBeforeStep.edges.find(edge =>
    (edge.a === 'workpiece.patch.v1.r1c2' && edge.b === 'workpiece.patch.v1.r1c3') ||
    (edge.a === 'workpiece.patch.v1.r1c3' && edge.b === 'workpiece.patch.v1.r1c2'));
  const geometry = context.envelope.snapshot.spaces.root.entities.workpiece.geometry;
  const step = context.authority.step({ envelope: context.envelope, dt: 1 / 30, nextSequence: context.nextSequence });
  context.authority.step({ envelope: context.envelope, dt: 1 / 30, nextSequence: context.nextSequence });
  const bodyAfter = context.authority.body;
  const edgeAfter = bodyAfter.edges.find(edge => edge.id === initialEdge.id);
  assert.equal(step.status, 'accepted');
  assert.notEqual(edgeAfter.restLength, undefined);
  assert.ok(Math.abs(edgeAfter.restLength - distanceOf(bodyAfter, edgeAfter)) > 1e-6, { edgeAfter, bodyAfter });
  assert.notDeepEqual(bodyAfter.nodes['workpiece.patch.v1.r1c2'].q, bodyBeforeStep.nodes['workpiece.patch.v1.r1c2'].q);
  assert.equal(context.envelope.snapshot.spaces.root.entities.workpiece.geometry.scale, geometry.scale);
  assert.equal(leftTarget.status, 'accepted');
});

function distanceOf(body, edge) {
  const a = body.nodes[edge.a].q, b = body.nodes[edge.b].q;
  return Math.hypot(...a.map((value, axis) => value - b[axis]));
}

test('target consumes individual constraints, keeps full-D coordinates, and distinguishes observed from receipt time', () => {
  const context = openAuthority(11);
  const began = beginContact(context, { nodeId: 'workpiece.patch.v1.r1c2', source: source('agent', 'agent-a', 3), operationId: 'begin:agent' });
  const q = context.authority.body.nodes[began.contact.attachment.nodeId].q.map((value, axis) => value + (axis === 10 ? 0.45 : axis === 0 ? 0.2 : 0));
  const result = targetFor(context, began.contact, { operationId: 'target:agent', targetSeq: 4, q, observedAt: 77 });
  assert.equal(result.receipt.observedAt, 77);
  assert.equal(result.receipt.receivedAt, 78);
  assert.equal(result.target.q.length, 11);
  assert.equal(result.target.q[10], q[10]);
  assert.equal(context.authority.body.inputCursor['agent:agent-a:source-session:3'].lastTargetSeq, 4);
});

test('idempotent retries replay the receipt and conflicting or ambiguous retries fail closed to reconciliation', () => {
  const context = openAuthority();
  const began = beginContact(context, { operationId: 'begin:replay', contactId: 'replay', source: source('touch', 'touch-replay') });
  const first = targetFor(context, began.contact, { operationId: 'target:replay', targetSeq: 1 });
  const replay = targetFor(context, began.contact, { operationId: 'target:replay', targetSeq: 1 });
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.acceptedSequence, first.receipt.acceptedSequence);
  assert.throws(() => targetFor(context, began.contact, { operationId: 'target:replay', targetSeq: 2, q: context.body.nodes[began.contact.attachment.nodeId].q.map(value => value + 0.7) }), /MATERIAL_OPERATION_REPLAY_MISMATCH/);
  assert.deepEqual(context.authority.reconcileOperation('target:replay').receipt, first.receipt);
  assert.equal(context.authority.reconcileOperation('transport-timeout').safeToRetry, false);
});

test('stale world, topology, node ownership, and source generation are rejected', () => {
  const context = openAuthority();
  const began = beginContact(context, { operationId: 'begin:stale', source: source('finger', 'hand-stale:index', 2, { parentSourceId: 'hand-stale', fingerId: 'index' }) });
  assert.throws(() => targetFor(context, began.contact, { operationId: 'target:bad-generation', targetSeq: 1, source: source('finger', 'hand-stale:index', 3, { parentSourceId: 'hand-stale', fingerId: 'index' }) }), /MATERIAL_GENERATION_STALE|MATERIAL_SOURCE_MISMATCH/);
  assert.throws(() => targetFor(context, began.contact, { operationId: 'target:bad-node', targetSeq: 1, nodeId: 'workpiece.patch.v1.r1c2' }), /MATERIAL_NODE_MISMATCH/);
  assert.throws(() => targetFor(context, began.contact, {
    operationId: 'target:bad-topology', targetSeq: 1,
    q: context.body.nodes[began.contact.attachment.nodeId].q,
    identity: { topologyRevision: context.authority.body.topologyRevision + 1 },
  }), /MATERIAL_TOPOLOGY_STALE|MATERIAL_SCOPE_CHANGED/);
  const staleEnvelope = clone(context.envelope); staleEnvelope.branchId = 'branch-stale';
  assert.throws(() => context.authority.target({
    envelope: staleEnvelope, schema: PHONE_MATERIAL_TARGET_SCHEMA, operationId: 'target:stale-branch', contactId: began.contact.contactId,
    identity: { ...context.identity, branchId: 'branch-stale', bodyRevision: context.authority.body.bodyRevision }, source: began.contact.source,
    targetSeq: 1, q: context.authority.body.nodes[began.contact.attachment.nodeId].q, attachment: attachment(context.body, began.contact.attachment.nodeId), actuator: { maxForce: 1, stiffness: 2, damping: .2 }, observedAt: 2, receivedAt: 3,
    nextSequence: context.nextSequence,
  }), /MATERIAL_SCOPE_CHANGED/);
});

test('normal release flushes newest absolute target, removes only its actuator, and preserves velocity for neighbors', () => {
  const context = openAuthority();
  const first = beginContact(context, { operationId: 'begin:release:a', contactId: 'release:a', nodeId: 'workpiece.patch.v1.r1c2', source: source('touch', 'release-a') });
  const second = beginContact(context, { operationId: 'begin:release:b', contactId: 'release:b', nodeId: 'workpiece.patch.v1.r1c3', source: source('touch', 'release-b') });
  targetFor(context, first.contact, { operationId: 'target:release:a', targetSeq: 1, q: context.body.nodes[first.contact.attachment.nodeId].q.map((value, axis) => value + (axis === 0 ? .6 : 0)) });
  targetFor(context, second.contact, { operationId: 'target:release:b', targetSeq: 1, q: context.body.nodes[second.contact.attachment.nodeId].q.map((value, axis) => value + (axis === 0 ? .8 : 0)) });
  const before = clone(context.authority.body);
  const ended = context.authority.end({ envelope: context.envelope, operationId: 'end:release:a', contactId: first.contact.contactId, identity: { ...context.identity, bodyRevision: context.authority.body.bodyRevision }, observedAt: 40, receivedAt: 41, nextSequence: context.nextSequence });
  assert.equal(ended.status, 'accepted');
  assert.equal(ended.physicsAdvanced, true);
  assert.deepEqual(ended.entity.q, ended.body.centroid.q);
  assert.deepEqual(ended.entity.v, ended.body.centroid.v);
  assert.equal(ended.entity.revision, ended.body.entityRevision);
  assert.equal(ended.worldTime, ended.body.simulationTime);
  assert.equal(ended.acceptedSequence, ended.body.acceptedSequence);
  assert.equal(context.authority.snapshot().activeContacts.length, 1);
  assert.ok(context.authority.body.nodes[second.contact.attachment.nodeId].v.some(value => Math.abs(value) > 0));
  assert.ok(context.authority.body.physicsTick > before.physicsTick);
  const endedSecond = context.authority.end({ envelope: context.envelope, operationId: 'end:release:b', contactId: second.contact.contactId, identity: { ...context.identity, bodyRevision: context.authority.body.bodyRevision }, observedAt: 42, receivedAt: 43, nextSequence: context.nextSequence });
  assert.equal(endedSecond.status, 'accepted');
});

test('a stale hand stop only releases old child-finger generations and fences the complete finger group', () => {
  const context = openAuthority();
  const old = beginContact(context, {
    operationId: 'begin:hand-old', contactId: 'finger:old',
    source: source('finger', 'hand-group:index', 1, { parentSourceId: 'hand-group', fingerId: 'index' }),
  });
  const fresh = beginContact(context, {
    operationId: 'begin:hand-fresh', contactId: 'finger:fresh',
    source: source('finger', 'hand-group:middle', 2, { parentSourceId: 'hand-group', fingerId: 'middle' }),
  });
  const stopped = context.authority.stopSource({
    envelope: context.envelope, operationId: 'stop:hand-generation-1',
    source: source('hand', 'hand-group', 1), identity: { ...context.identity, bodyRevision: context.authority.body.bodyRevision },
    observedAt: 50, receivedAt: 51, nextSequence: context.nextSequence,
  });
  assert.deepEqual(stopped.released.map(item => item.contactId), [old.contact.contactId]);
  assert.deepEqual(context.authority.snapshot().activeContacts.map(item => item.contactId), [fresh.contact.contactId]);
  assert.throws(() => beginContact(context, {
    operationId: 'begin:hand-fenced', contactId: 'finger:fenced',
    source: source('finger', 'hand-group:ring', 1, { parentSourceId: 'hand-group', fingerId: 'ring' }),
  }), /MATERIAL_SOURCE_STOPPED/);
  const newer = beginContact(context, {
    operationId: 'begin:hand-newer', contactId: 'finger:newer',
    source: source('finger', 'hand-group:ring', 2, { parentSourceId: 'hand-group', fingerId: 'ring' }),
  });
  assert.equal(newer.status, 'accepted');
});

test('a conflicting stop retry rejects before changing fences, contacts, receipts, or accepted time', () => {
  const context = openAuthority();
  beginContact(context, {
    operationId: 'begin:stop-replay', contactId: 'agent:old', source: source('agent', 'agent-replay', 1),
  });
  context.authority.stopSource({
    envelope: context.envelope, operationId: 'stop:replay', source: source('agent', 'agent-replay', 1),
    identity: { ...context.identity, bodyRevision: context.authority.body.bodyRevision },
    observedAt: 60, receivedAt: 61, nextSequence: context.nextSequence,
  });
  const fresh = beginContact(context, {
    operationId: 'begin:stop-replay-fresh', contactId: 'agent:fresh', source: source('agent', 'agent-replay', 2),
  });
  const before = {
    body: clone(context.authority.body),
    snapshot: clone(context.authority.snapshot()),
    fences: [...context.authority.sourceFences.entries()],
    sequence: context.sequence,
  };
  assert.throws(() => context.authority.stopSource({
    envelope: context.envelope, operationId: 'stop:replay', source: source('agent', 'agent-replay', 2),
    identity: { ...context.identity, bodyRevision: context.authority.body.bodyRevision },
    observedAt: 62, receivedAt: 63, nextSequence: context.nextSequence,
  }), /MATERIAL_OPERATION_REPLAY_MISMATCH/);
  assert.deepEqual(context.authority.body, before.body);
  assert.deepEqual(context.authority.snapshot(), before.snapshot);
  assert.deepEqual([...context.authority.sourceFences.entries()], before.fences);
  assert.equal(context.sequence, before.sequence);
  assert.deepEqual(context.authority.snapshot().activeContacts.map(item => item.contactId), [fresh.contact.contactId]);
});

test('cancel and selective source stop remove only their actuators and preserve exact other source intent', () => {
  const context = openAuthority();
  const touch = beginContact(context, { operationId: 'begin:touch', contactId: 'touch', nodeId: 'workpiece.patch.v1.r1c1', source: source('touch', 'touch-1') });
  const hand = beginContact(context, { operationId: 'begin:hand', contactId: 'hand', nodeId: 'workpiece.patch.v1.r1c2', source: source('finger', 'hand-1:index', 1, { parentSourceId: 'hand-1', fingerId: 'index' }) });
  const agent = beginContact(context, { operationId: 'begin:agent', contactId: 'agent', nodeId: 'workpiece.patch.v1.r1c3', source: source('agent', 'agent-1', 1) });
  const touchTarget = targetFor(context, touch.contact, { operationId: 'target:touch', q: context.body.nodes[touch.contact.attachment.nodeId].q.map((value, axis) => value + (axis === 0 ? .2 : 0)) });
  targetFor(context, hand.contact, { operationId: 'target:hand', q: context.body.nodes[hand.contact.attachment.nodeId].q.map((value, axis) => value + (axis === 0 ? .4 : 0)) });
  targetFor(context, agent.contact, { operationId: 'target:agent', q: context.body.nodes[agent.contact.attachment.nodeId].q.map((value, axis) => value + (axis === 0 ? .8 : 0)) });
  const canceled = context.authority.cancel({ envelope: context.envelope, operationId: 'cancel:hand', contactId: hand.contact.contactId, identity: { ...context.identity, bodyRevision: context.authority.body.bodyRevision }, observedAt: 50, receivedAt: 51, reason: 'finger-lost', nextSequence: context.nextSequence });
  assert.equal(canceled.released.acceptedHistoryPreserved, true);
  const stopped = context.authority.stopSource({ envelope: context.envelope, operationId: 'stop:agent', source: source('agent', 'agent-1', 1), identity: { ...context.identity, bodyRevision: context.authority.body.bodyRevision }, observedAt: 52, receivedAt: 53, nextSequence: context.nextSequence });
  assert.equal(stopped.released.length, 1);
  assert.deepEqual(context.authority.snapshot().activeContacts.map(item => item.contactId), ['touch']);
  assert.deepEqual(context.authority.body.receipts.find(item => item.operationId === touchTarget.receipt.operationId).result, touchTarget.receipt.result);
  assert.throws(() => beginContact(context, { operationId: 'begin:stopped-agent', contactId: 'stopped-agent', source: source('agent', 'agent-1', 1) }), /MATERIAL_SOURCE_STOPPED/);
  const fresh = beginContact(context, { operationId: 'begin:fresh-agent', contactId: 'fresh-agent', source: source('agent', 'agent-1', 2) });
  assert.equal(fresh.status, 'accepted');
});

test('preview is detached, provisional, and does not advance accepted sequence or body revision', () => {
  const context = openAuthority();
  const began = beginContact(context, { operationId: 'begin:preview', contactId: 'preview', nodeId: 'workpiece.patch.v1.r1c2', source: source('touch', 'preview-touch') });
  const before = clone(context.authority.body);
  const preview = context.authority.preview({
    envelope: context.envelope,
    target: {
      schema: PHONE_MATERIAL_TARGET_SCHEMA, operationId: 'preview-target', contactId: began.contact.contactId,
      identity: { ...context.identity, bodyRevision: before.bodyRevision }, source: began.contact.source, targetSeq: 1,
      q: before.nodes[began.contact.attachment.nodeId].q.map((value, axis) => value + (axis === 0 ? .7 : 0)),
      attachment: attachment(before, began.contact.attachment.nodeId), actuator: { maxForce: 2, stiffness: 3, damping: .4 }, observedAt: 60, receivedAt: 61,
    },
  });
  assert.equal(preview.provisional, true);
  assert.equal(context.authority.body.bodyRevision, before.bodyRevision);
  assert.equal(context.authority.body.acceptedSequence, before.acceptedSequence);
  assert.deepEqual(context.authority.body.nodes, before.nodes);
  assert.notDeepEqual(preview.nodes[began.contact.attachment.nodeId].q, before.nodes[began.contact.attachment.nodeId].q);
});

test('solver disabled removes non-rigid propagation while preserving the accepted body and velocity contract', () => {
  const context = openAuthority();
  const began = beginContact(context, { operationId: 'begin:disabled', contactId: 'disabled', nodeId: 'workpiece.patch.v1.r1c3', source: source('touch', 'disabled-touch') });
  targetFor(context, began.contact, { operationId: 'target:disabled', q: context.body.nodes[began.contact.attachment.nodeId].q.map((value, axis) => value + (axis === 0 ? 1 : 0)) });
  const before = clone(context.authority.body);
  context.authority.body.solver.enabled = false;
  const step = context.authority.step({ envelope: context.envelope, nextSequence: context.nextSequence });
  assert.equal(step.status, 'unchanged');
  assert.deepEqual(context.authority.body.nodes, before.nodes);
  assert.equal(context.authority.body.bodyRevision, before.bodyRevision);
});

test('reload restores accepted nodes, velocities, revisions, input cursors, and receipts but revives no contacts', () => {
  const context = openAuthority();
  const began = beginContact(context, { operationId: 'begin:reload', contactId: 'reload', nodeId: 'workpiece.patch.v1.r1c2', source: source('touch', 'reload-touch') });
  targetFor(context, began.contact, { operationId: 'target:reload', q: context.body.nodes[began.contact.attachment.nodeId].q.map((value, axis) => value + (axis === 0 ? .5 : 0)) });
  context.authority.step({ envelope: context.envelope, nextSequence: context.nextSequence });
  const persisted = clone(context.authority.body);
  const reloadedEnvelope = clone(context.envelope);
  reloadedEnvelope.snapshot.materialBodies = { workpiece: persisted };
  const reloaded = new PhoneMaterialAuthority({ now: () => 2000, sessionId: 'new-session' });
  const opened = reloaded.open({ envelope: reloadedEnvelope });
  assert.equal(opened.contactsRevived, false);
  assert.deepEqual(reloaded.body.nodes, persisted.nodes);
  assert.deepEqual(reloaded.body.inputCursor, persisted.inputCursor);
  assert.deepEqual(reloaded.body.receipts, persisted.receipts);
  assert.equal(reloaded.snapshot().activeContacts.length, 0);
  assert.throws(() => reloaded.target({ envelope: reloadedEnvelope, operationId: 'after-reload', contactId: 'reload', identity: { ...reloaded.body.identity }, source: began.contact.source, targetSeq: 2, q: reloaded.body.nodes[began.contact.attachment.nodeId].q, attachment: attachment(reloaded.body, began.contact.attachment.nodeId), actuator: { maxForce: 1, stiffness: 1, damping: .1 }, observedAt: 1, receivedAt: 2 }), /MATERIAL_CONTACT_UNKNOWN/);
});

test('storage failure is represented as accepted-in-memory by the persistence adapter contract, not a safe-to-retry rejection', async () => {
  const calls = [];
  const queue = new MaterialContactQueue({
    submit: async target => { calls.push(target); return { status: 'accepted-in-memory', acceptedInMemory: true, safeToRetry: false, operationId: target.operationId }; },
    release: async reason => ({ status: 'released', reason }),
    cancel: async reason => ({ status: 'canceled', reason }),
  });
  const accepted = await queue.offer({ operationId: 'storage:one', targetSeq: 1 });
  assert.equal(accepted.result.status, 'accepted-in-memory');
  assert.equal(accepted.result.safeToRetry, false);
  assert.equal(calls.length, 1);
});

test('contact queue keeps one in-flight target plus newest unsent target, fences stop, and reconciles submitted work', async () => {
  let releaseFirst;
  const firstStarted = new Promise(resolve => { releaseFirst = resolve; });
  let resolveFirst;
  const calls = [];
  const queue = new MaterialContactQueue({
    submit: async target => { calls.push(target); if (calls.length === 1) { await firstStarted; } return { status: 'accepted', operationId: target.operationId }; },
    release: async () => ({ status: 'released' }),
    cancel: async () => ({ status: 'canceled' }),
    reconcile: async error => ({ state: 'unknown', error: String(error) }),
  });
  const first = queue.offer({ operationId: 'queued:first', targetSeq: 1 });
  await Promise.resolve();
  const second = queue.offer({ operationId: 'queued:second', targetSeq: 2 });
  const third = queue.offer({ operationId: 'queued:third', targetSeq: 3 });
  assert.equal((await second).status, 'queued');
  assert.equal((await third).status, 'queued');
  resolveFirst?.();
  releaseFirst?.();
  const firstResult = await first;
  assert.equal(firstResult.status, 'accepted');
  await queue.stop('agent-stop');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].operationId, 'queued:third');
});

test('projected accepted and provisional vertices retain internal IDs and edge lengths', () => {
  const { body } = openAuthority(11);
  const render = projectMaterialBody(body, { project: q => ({ x: q[0] * 100, y: q[2] * 100, visible: true }) });
  assert.equal(render.vertices.length, 12);
  assert.equal(render.edges.length, 23);
  assert.equal(new Set(render.vertices.map(item => item.id)).size, 12);
  assert.ok(render.edges.every(edge => edge.from && edge.to && Number.isFinite(edge.length)));
  assert.equal(render.provisional, false);
});

test('x4 and x11 bodies use the full internal vector without dense allocation or phase-field claims', () => {
  for (const dimension of [4, 11]) {
    const context = openAuthority(dimension);
    assert.equal(context.authority.body.identity.dimension, dimension);
    assert.ok(Object.values(context.authority.body.nodes).every(node => node.q.length === dimension && node.v.length === dimension));
    assert.equal(context.authority.body.solver.adapter, 'stepSparseSpace/phone-view');
    assert.notEqual(context.authority.body.solver.adapter, 'vivo.phase-field');
  }
});

test('captured inverse mapping retains enough renderer state for deterministic roundtrip ownership', () => {
  const context = openAuthority();
  const node = context.body.nodes['workpiece.patch.v1.r1c2'];
  const mapping = inverseFor(node.q, [210, 140]);
  assert.equal(mapping.schema, 'vivo.phone.material-inverse/1');
  assert.deepEqual(mapping.axes, [0, 2, 1]);
  assert.deepEqual(mapping.canonicalQ, node.q);
  assert.equal(mapping.renderer.distance, 10.5);
});
