import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPersistenceStatus } from '../persistence-status.mjs';

test('quota failure stays visible after a hand release', () => {
  const message = formatPersistenceStatus('release', {
    state: 'unsaved', error: 'QuotaExceededError: phone storage quota exceeded',
  });
  assert.match(message, /Hand released/);
  assert.match(message, /was not saved/);
  assert.match(message, /QuotaExceededError/);
  assert.match(message, /Retry remains available/);
  assert.doesNotMatch(message, /state saved\.?$/);
});

test('memory-only fallback is not reported as a durable save', () => {
  const message = formatPersistenceStatus('save', { state: 'memory-only' }, { persistent: false });
  assert.match(message, /in memory only/);
  assert.match(message, /not saved across reload/);
  assert.doesNotMatch(message, /Saved locally on this device/);
});

test('successful retry reports a durable local save', () => {
  assert.equal(formatPersistenceStatus('save', { state: 'saved' }, { persistent: true }), 'Saved locally on this device.');
  assert.equal(formatPersistenceStatus('release', { state: 'saved' }), 'Hand released · local state saved.');
});

test('a pending save is not presented as complete', () => {
  assert.equal(formatPersistenceStatus('release', { state: 'saving' }), 'Hand released · saving local state…');
});
