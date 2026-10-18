import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCurrentAgentResponse,
  mergeAgentTaskRows,
  submissionFingerprint,
} from '../../web/application/agent-task-ui-state.mjs';

test('selected task evidence survives a polling list response without events', () => {
  const detail = {
    taskId: 'vivo-task-abcdefghijklmnop',
    status: 'succeeded',
    artifact: {artifactId: 'a'},
    verification: {status: 'verified'},
    events: [{type: 'task.succeeded'}],
  };
  const rows = [{taskId: detail.taskId, status: 'running', artifact: null, verification: null}];
  const merged = mergeAgentTaskRows(rows, new Map([[detail.taskId, detail]]));
  assert.deepEqual(merged[0], detail);
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
