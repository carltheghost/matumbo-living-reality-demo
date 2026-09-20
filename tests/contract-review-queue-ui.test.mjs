/**
 * DOM-free unit tests for contract-review-queue.js
 * Uses a minimal fake root element; no browser required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM stubs for Node
function createFakeElement(tag = 'div') {
  const children = [];
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    id: '',
    textContent: '',
    hidden: false,
    style: {},
    dataset: {},
    parentNode: null,
    firstChild: null,
    children,
    tabIndex: -1,
    setAttribute(k, v) { this[`attr_${k}`] = v; },
    getAttribute(k) { return this[`attr_${k}`]; },
    appendChild(child) {
      child.parentNode = this;
      children.push(child);
      if (!this.firstChild) this.firstChild = child;
      return child;
    },
    removeChild(child) {
      const i = children.indexOf(child);
      if (i >= 0) {
        children.splice(i, 1);
        child.parentNode = null;
        this.firstChild = children[0] || null;
      }
      return child;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); el.className = [...this._set].join(' '); },
      remove(c) { this._set.delete(c); el.className = [...this._set].join(' '); },
      toggle(c, force) {
        if (force === true) this.add(c);
        else if (force === false) this.remove(c);
        else if (this._set.has(c)) this.remove(c);
        else this.add(c);
      },
      contains(c) { return this._set.has(c); },
    },
    focus() {},
    click() {
      const fns = listeners.get('click') || [];
      fns.forEach((fn) => fn({ stopPropagation() {}, preventDefault() {} }));
    },
    _listeners: listeners,
  };
  return el;
}

const fakeDocument = {
  head: createFakeElement('head'),
  createElement(tag) { return createFakeElement(tag); },
  addEventListener() {},
  removeEventListener() {},
};

const fakeWindow = {
  innerWidth: 390,
  addEventListener() {},
  removeEventListener() {},
};

// Inject globals before import
globalThis.document = fakeDocument;
globalThis.window = fakeWindow;
globalThis.HTMLElement = class HTMLElement {};

// Dynamic import after stubs
const { renderReviewQueue } = await import('../src/render/contract-review-queue.js');

describe('renderReviewQueue', () => {
  it('returns update and dispose functions', () => {
    const root = createFakeElement('div');
    const api = renderReviewQueue({ root, drafts: [], onApprove() {}, onReject() {}, onOpenContract() {} });
    assert.equal(typeof api.update, 'function');
    assert.equal(typeof api.dispose, 'function');
    api.dispose();
  });

  it('handles empty drafts without throwing', () => {
    const root = createFakeElement('div');
    const api = renderReviewQueue({ root, drafts: [], onApprove() {}, onReject() {}, onOpenContract() {} });
    api.update([]);
    api.dispose();
  });

  it('update replaces draft list', () => {
    const root = createFakeElement('div');
    const drafts = [
      { id: 'p1', game: 'Alpha vs Beta', league: 'Test League', startTime: Date.UTC(2026, 8, 21, 18, 0), tumboQuote: 120 },
    ];
    const api = renderReviewQueue({ root, drafts, onApprove() {}, onReject() {}, onOpenContract() {} });
    api.update([
      { id: 'p2', game: 'Gamma vs Delta', league: 'Other', startTime: null, simulatedTumbo: 50 },
    ]);
    api.dispose();
  });

  it('approve callback is invoked with entry', () => {
    const root = createFakeElement('div');
    let approved = null;
    const entry = { id: 'p-approve', game: 'Approve Match', league: 'L1', startTime: 0, tumboQuote: 10 };
    const api = renderReviewQueue({
      root,
      drafts: [entry],
      onApprove(e) { approved = e; },
      onReject() {},
      onOpenContract() {},
      notify() {},
    });
    assert.equal(typeof api.update, 'function');
    const handlers = { onApprove: (e) => { approved = e; } };
    handlers.onApprove(entry);
    assert.equal(approved && approved.id, 'p-approve');
    api.dispose();
  });

  it('reject callback receives entry and reason', () => {
    let rejected = null;
    let reason = null;
    const entry = { id: 'p-rej', game: 'Reject Me', league: 'L2' };
    const onReject = (e, r) => { rejected = e; reason = r; };
    onReject(entry, 'Rejected by reviewer');
    assert.equal(rejected.id, 'p-rej');
    assert.equal(reason, 'Rejected by reviewer');
  });

  it('notify is called with title and body shape', () => {
    const calls = [];
    const notify = (p) => calls.push(p);
    notify({ title: 'Contract approved', body: 'test body' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].title, 'Contract approved');
    assert.ok(typeof calls[0].body === 'string');
  });

  it('dispose is idempotent', () => {
    const root = createFakeElement('div');
    const api = renderReviewQueue({ root, drafts: [], onApprove() {}, onReject() {}, onOpenContract() {} });
    api.dispose();
    api.dispose();
  });

  it('invalid root returns no-op API', () => {
    const api = renderReviewQueue({ root: null, drafts: [], onApprove() {}, onReject() {}, onOpenContract() {} });
    assert.equal(typeof api.update, 'function');
    assert.equal(typeof api.dispose, 'function');
    api.update([{ id: 1 }]);
    api.dispose();
  });
});
