import assert from 'node:assert/strict';
import test from 'node:test';
import { mountMarketBuilder } from '../src/render/market-builder.js';

function documentFixture({ storage } = {}) {
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.listeners = new Map();
      this.attributes = new Map();
      this.dataset = {};
      this.value = '';
      this.textContent = '';
      this.hidden = false;
      this.disabled = false;
      this.ownerDocument = documentRoot;
    }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (this.tagName === 'SELECT' && child.tagName === 'OPTION' && this.value === '') this.value = child.value;
      return child;
    }
    replaceChildren(...children) {
      this.children.forEach((child) => { child.parentNode = null; });
      this.children = [];
      this.append(...children);
    }
    addEventListener(type, handler) {
      const handlers = this.listeners.get(type) ?? [];
      handlers.push(handler);
      this.listeners.set(type, handlers);
    }
    dispatch(type) {
      const event = { target: this, preventDefault() {}, stopPropagation() {} };
      for (const handler of this.listeners.get(type) ?? []) handler(event);
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; }
    click() { this.dispatch('click'); }
  }
  const documentRoot = {
    createElement: (tag) => new Element(tag),
    getElementById: () => null,
    defaultView: { HTMLFormElement: class HTMLFormElement {}, localStorage: storage ?? new MapStorage() },
  };
  const panel = new Element('section');
  return { documentRoot, panel };
}

class MapStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }
function marketplaceRoot(panel) { return descendants(panel).find((element) => element.className === 'marketplace-surface'); }
function control(root, label) {
  const element = descendants(root).find((candidate) => candidate.getAttribute('aria-label') === label);
  assert.ok(element, `missing marketplace control ${label}`);
  return element;
}
function form(root, className) {
  const element = descendants(root).find((candidate) => candidate.tagName === 'FORM' && candidate.className === className);
  assert.ok(element, `missing marketplace form ${className}`);
  return element;
}
function createListing(root, question) {
  control(root, 'Creator label').value = 'Local author';
  control(root, 'Listing question').value = question;
  control(root, 'Terms and completion criteria').value = 'Local inspection terms';
  control(root, 'Outcomes · one per line').value = 'YES\nNO';
  form(root, 'marketplace-composer').dispatch('submit');
}

test('quota failure keeps the memory-only/export warning visible after a successful in-memory create', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  const fixture = documentFixture({ storage });
  const api = mountMarketBuilder(fixture);
  const root = marketplaceRoot(fixture.panel);
  createListing(root, 'Quota listing');
  const status = descendants(root).find((element) => element.className === 'marketplace-status');
  assert.equal(api.getSnapshot().length, 1, 'the listing remains available in memory for this session');
  assert.equal(root.dataset.storageState, 'unavailable');
  assert.match(status.textContent, /Local listing created/);
  assert.match(status.textContent, /Workspace is memory-only \(quota\); export before leaving/);

  const reloaded = documentFixture({ storage });
  const reloadedApi = mountMarketBuilder(reloaded);
  assert.equal(reloadedApi.getSnapshot().length, 0, 'quota-backed memory work is not falsely reported as durable after reload');
  api.destroy();
  reloadedApi.destroy();
});

test('a synchronous create notification selects the newly created listing', () => {
  const fixture = documentFixture();
  const api = mountMarketBuilder(fixture);
  const root = marketplaceRoot(fixture.panel);
  createListing(root, 'First local listing');
  createListing(root, 'Second local listing');
  const cards = descendants(root).filter((element) => element.className === 'marketplace-card');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].dataset.selected, 'false');
  assert.equal(cards[1].dataset.selected, 'true');
  assert.equal(api.getSelection(), api.getSnapshot()[1].id);
  const detailTitle = descendants(root).find((element) => element.tagName === 'H4' && element.parentNode?.className === 'marketplace-detail-head');
  assert.equal(detailTitle.textContent, 'Second local listing');
  api.destroy();
});

test('refreshContracts adds contracts created after Marketplace mount without duplicating the list', () => {
  let contracts = [];
  const fixture = documentFixture();
  const api = mountMarketBuilder({ ...fixture, getContracts: () => contracts });
  const root = marketplaceRoot(fixture.panel);
  const governing = control(root, 'Governing contract (optional)');
  assert.equal(governing.children.length, 1);
  contracts = [{ id: 'contract:later', title: 'Created later', status: 'pending_approval' }];
  api.refreshContracts();
  assert.deepEqual(governing.children.map((option) => option.value), ['', 'contract:later']);
  assert.match(governing.children[1].textContent, /Created later/);
  api.destroy();
});
