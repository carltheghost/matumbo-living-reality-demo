import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { capturedInverseMapping } from '../material-patch.mjs';
import { materialIdentityFromEnvelope } from '../material-contract.mjs';

function call(worker, method, ...args) {
  const id = `${method}:${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const onMessage = value => {
      if (value?.id !== id) return;
      worker.off('message', onMessage);
      if (value.ok) resolve(value.value);
      else reject(new Error(value.error || 'worker call failed'));
    };
    worker.on('message', onMessage);
    worker.postMessage({ id, method, args });
  });
}

function attachment(body, nodeId) {
  const q = body.nodes[nodeId].q;
  return {
    nodeId,
    capturedCanonicalPoint: [...q],
    capturedAt: 10,
    inverseMapping: capturedInverseMapping({
      devicePoint: [100, 100],
      viewport: { left: 0, top: 0, width: 400, height: 400 },
      renderer: { w: 400, h: 400, yaw: 0.55, pitch: 0.68, distance: 10.5, origin: [0, 0, 0] },
      axes: [0, 2, 1], depth: 10.5, canonicalQ: q,
    }),
  };
}

test('actual phone module worker flushes rapid end atomically and reloads coherent material state', async t => {
  const worker = new Worker(new URL('./engine-worker-harness.mjs', import.meta.url), { type: 'module' });
  t.after(() => worker.terminate());

  const opened = await call(worker, 'open', 'worker-material-regression', 4);
  const bodyBefore = opened.snapshot.materialBodies.workpiece;
  const identity = materialIdentityFromEnvelope(opened, 'workpiece', bodyBefore);
  const nodeId = 'workpiece.patch.v1.r1c2';
  const source = { kind: 'touch', sourceId: 'rapid-worker-touch', sessionId: 'worker-session', generation: 1 };
  const actuator = { maxForce: 2, stiffness: 3, damping: 0.4 };
  const beginAttachment = attachment(bodyBefore, nodeId);
  const begin = await call(worker, 'materialBegin', {
    operationId: 'worker:begin', contactId: 'worker:contact', source,
    identity, attachment: beginAttachment, actuator, observedAt: 10, receivedAt: 11,
  });
  const targetQ = bodyBefore.nodes[nodeId].q.map((value, axis) => value + (axis === 0 ? 0.8 : axis === 2 ? 0.15 : 0));
  const target = {
    schema: 'vivo.phone.material-target/1', operationId: 'worker:target', contactId: begin.contact.contactId,
    identity: { ...identity, bodyRevision: begin.receipt.bodyRevision }, source, targetSeq: 1,
    q: targetQ, attachment: beginAttachment, actuator, observedAt: 12, receivedAt: 13,
  };

  // Submit target and release back-to-back. The worker queue serializes them;
  // no timer tick is needed to make release flush the newest accepted target.
  const targetPromise = call(worker, 'materialTarget', target);
  const endPromise = call(worker, 'materialEnd', {
    operationId: 'worker:end', contactId: begin.contact.contactId, source,
    identity: { ...identity, bodyRevision: begin.receipt.bodyRevision },
    observedAt: 14, receivedAt: 15,
  });
  const [targetResult, end] = await Promise.all([targetPromise, endPromise]);
  assert.equal(targetResult.status, 'accepted');
  assert.equal(end.status, 'accepted');
  assert.equal(end.physicsAdvanced, true);
  assert.deepEqual(end.entity.q, end.body.centroid.q);
  assert.deepEqual(end.entity.v, end.body.centroid.v);
  assert.equal(end.entity.revision, end.body.entityRevision);
  assert.equal(end.worldTime, end.body.simulationTime);

  const after = await call(worker, 'snapshot');
  const entity = after.snapshot.spaces.root.entities.workpiece;
  const body = after.snapshot.materialBodies.workpiece;
  assert.deepEqual(entity.q, body.centroid.q);
  assert.deepEqual(entity.v, body.centroid.v);
  assert.equal(entity.revision, body.entityRevision);
  assert.equal(after.snapshot.simulationTime, body.simulationTime);
  assert.equal(after.snapshot.acceptedSequence, body.acceptedSequence);
  assert.equal(after.snapshot.spaces.root.entities.workpiece.geometry.scale, 1);

  const reloaded = await call(worker, 'open', 'worker-material-regression', 4);
  const reloadedBody = reloaded.snapshot.materialBodies.workpiece;
  const reloadedEntity = reloaded.snapshot.spaces.root.entities.workpiece;
  assert.deepEqual(reloadedEntity.q, reloadedBody.centroid.q);
  assert.deepEqual(reloadedEntity.v, reloadedBody.centroid.v);
  assert.equal(reloadedEntity.revision, reloadedBody.entityRevision);
  assert.equal(reloaded.snapshot.simulationTime, reloadedBody.simulationTime);
  const active = await call(worker, 'materialSnapshot');
  assert.equal(active.activeContacts.length, 0);
});
