import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCurrentAgentResponse,
  mergeAgentTaskRows,
  shouldAcceptAgentTaskDetail,
  submissionFingerprint,
} from '../../web/application/agent-task-ui-state.mjs';

test('newer polling summary wins over stale inspected detail while evidence fields update', () => {
  const staleDetail = {
    taskId: 'vivo-task-abcdefghijklmnop',
    status: 'running',
    artifact: null,
    verification: null,
    version: 2,
    events: [{type: 'task.started'}],
  };
  const current = {
    taskId: staleDetail.taskId,
    status: 'succeeded',
    artifact: {artifactId: 'new'},
    verification: {status: 'verified'},
    version: 3,
  };
  const merged = mergeAgentTaskRows([current], new Map([[current.taskId, staleDetail]]));
  assert.equal(merged[0].status, 'succeeded');
  assert.deepEqual(merged[0].artifact, current.artifact);
  assert.deepEqual(merged[0].verification, current.verification);
  assert.equal('events' in merged[0], false);
});

test('detail events survive when the inspected revision matches the polling row', () => {
  const detail = {
    taskId: 'vivo-task-abcdefghijklmnop',
    status: 'succeeded',
    artifact: {artifactId: 'a'},
    verification: {status: 'verified'},
    version: 4,
    events: [{type: 'task.succeeded'}],
  };
  const rows = [{taskId: detail.taskId, status: detail.status, version: detail.version}];
  const merged = mergeAgentTaskRows(rows, new Map([[detail.taskId, detail]]));
  assert.deepEqual(merged[0].events, detail.events);
});

test('out-of-order detail replies cannot regress the cached revision', () => {
  const v1 = {taskId: 'vivo-task-abcdefghijklmnop', version: 1, events: [{type: 'task.started'}]};
  const v2 = {taskId: v1.taskId, version: 2, events: [{type: 'task.succeeded'}]};
  assert.equal(shouldAcceptAgentTaskDetail(undefined, v1), true);
  assert.equal(shouldAcceptAgentTaskDetail(v1, v2), true);
  assert.equal(shouldAcceptAgentTaskDetail(v2, v1), false);
});

test('stale task responses are fenced by generation and client', () => {
  const current = {closed: false};
  assert.equal(isCurrentAgentResponse(2, 2, current, current), true);
  assert.equal(isCurrentAgentResponse(1, 2, current, current), false);
  assert.equal(isCurrentAgentResponse(2, 2, current, {closed: false}), false);
  current.closed = true;
  assert.equal(isCurrentAgentResponse(2, 2, current, current), false);
});

test('submission fingerprint excludes the retry request id', () => {
  const body = {
    goal: 'inspect',
    permissions: ['sample.read'],
    toolCall: {name: 'vivo.sample.inspect', arguments: {sampleId: 'field-baseline'}},
  };
  assert.equal(submissionFingerprint(body), submissionFingerprint({...body, requestId: 'new-id'}));
  assert.notEqual(submissionFingerprint(body), submissionFingerprint({...body, goal: 'other'}));
});
