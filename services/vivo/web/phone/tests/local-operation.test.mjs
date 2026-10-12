import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalOperationIdFactory } from '../local-operation.mjs';

test('a reloaded phone session gets a fresh first-touch operation identity', () => {
  const firstSession = new LocalOperationIdFactory('touch-preview');
  const first = firstSession.next('world:branch:eye:root:relic');
  const reloaded = new LocalOperationIdFactory('touch-preview');
  const reloadedFirst = reloaded.next('world:branch:eye:root:relic');
  assert.notEqual(reloadedFirst, first);
  assert.match(first, /^touch-preview:[^:]+:world:branch:eye:root:relic:1$/);
  assert.match(reloadedFirst, /^touch-preview:[^:]+:world:branch:eye:root:relic:1$/);
  assert.notEqual(firstSession.next('world:branch:eye:root:relic'), first);
});
