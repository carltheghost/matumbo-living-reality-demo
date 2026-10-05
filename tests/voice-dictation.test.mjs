import test from 'node:test';
import assert from 'node:assert/strict';
import { mountVoiceDictation } from '../src/render/voice-dictation.js';

// Minimal mounted DOM adapter: real module handlers, selection insertion, event
// bubbling and visibility checks, without a browser or microphone dependency.
class UiEvent {
  constructor(type, options = {}) { Object.assign(this, { type, bubbles: false, cancelable: false, defaultPrevented: false }, options); }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
  stopImmediatePropagation() { this.stopped = true; }
}
function walk(node) { return node.children.flatMap(child => [child, ...walk(child)]); }
function matches(node, selector) {
  return selector.split(',').some(part => {
    const choice = part.trim();
    if (choice === ':disabled') return node.disabled;
    if (choice.startsWith('#')) return node.id === choice.slice(1);
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(choice);
    if (attribute) return attribute[2] === undefined ? node.getAttribute(attribute[1]) !== null : node.getAttribute(attribute[1]) === attribute[2];
    return node.tagName.toLowerCase() === choice;
  });
}
function element(tag, doc) {
  const attributes = new Map(), listeners = new Map();
  const item = {
    tagName: tag.toUpperCase(), ownerDocument: doc, children: [], parentNode: null, dataset: {}, style: {},
    id: '', type: tag === 'input' ? 'text' : '', value: '', defaultValue: '', hidden: false, disabled: false,
    readOnly: false, maxLength: -1, selectionStart: 0, selectionEnd: 0, emitted: [], _text: '',
    get parentElement() { return this.parentNode; },
    get isConnected() { let current = this; while (current.parentNode) current = current.parentNode; return current === this.ownerDocument; },
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); },
    set textContent(text) { this.replaceChildren(); this._text = String(text); },
    get innerHTML() { return this._html || ''; },
    set innerHTML(html) {
      this.replaceChildren(); this._html = html;
      const stack = [this];
      for (const token of html.match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith('</')) { stack.pop(); continue; }
        if (!token.startsWith('<')) { stack.at(-1)._text += token; continue; }
        const start = /^<([\w-]+)/.exec(token); if (!start) continue;
        const child = element(start[1], doc);
        for (const entry of token.slice(start[0].length, -1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) child.setAttribute(entry[1], entry[2] ?? '');
        stack.at(-1).append(child);
        if (!['input', 'link', 'br', 'meta', 'img'].includes(start[1])) stack.push(child);
      }
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
      if (['id', 'type', 'name', 'value'].includes(name)) this[name] = String(value);
      if (name === 'hidden') this.hidden = true;
      if (name === 'maxlength') this.maxLength = Number(value);
    },
    getAttribute(name) { return name === 'hidden' ? this.hidden ? '' : null : attributes.get(name) ?? null; },
    matches(selector) { return matches(this, selector); },
    closest(selector) { for (let current = this; current; current = current.parentNode) if (matches(current, selector)) return current; return null; },
    querySelectorAll(selector) { return walk(this).filter(child => matches(child, selector)); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); if (this.tagName === 'SELECT' && this.children.length === 1) this.value = child.value; } },
    appendChild(child) { this.append(child); return child; },
    replaceChildren(...children) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this._text = ''; this.append(...children); },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    _dispatch(event) {
      event.target ??= this; this.emitted.push(event); const pending = [];
      for (const fn of listeners.get(event.type) || []) { pending.push(fn(event)); if (event.stopped) break; }
      if (event.bubbles && !event.stopped && this.parentNode) pending.push(...this.parentNode._dispatch(event));
      return pending;
    },
    dispatchEvent(event) { this._dispatch(event); return !event.defaultPrevented; },
    fire(type, options = {}) { return Promise.all(this._dispatch(new UiEvent(type, { bubbles: true, cancelable: true, ...options }))); },
    click() { return this.disabled ? Promise.resolve() : this.fire('click'); },
    focus() { doc.activeElement = this; this.dispatchEvent(new UiEvent('focusin', { bubbles: true })); },
    select() { this.selected = true; this.selectionStart = 0; this.selectionEnd = this.value.length; },
    setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); this.selectionStart = this.selectionEnd = start + text.length; },
    getClientRects() { for (let current = this; current; current = current.parentNode) if (current.hidden || current.style.display === 'none') return []; return this.isConnected ? [{}] : []; },
    listenerCount() { return [...listeners.values()].reduce((sum, values) => sum + values.size, 0); },
  };
  return item;
}
function setup(t, options = {}) {
  const doc = element('document'); doc.ownerDocument = doc;
  doc.head = element('head', doc); doc.body = element('body', doc); doc.append(doc.head, doc.body);
  doc.createElement = tag => element(tag, doc); doc.activeElement = doc.body;
  const intervals = new Map(); let nextTimer = 0, context = 'owner:a';
  const win = element('window', doc); win.document = doc; doc.defaultView = win;
  win.Event = win.InputEvent = win.CustomEvent = UiEvent;
  win.navigator = { language: 'en-US', ...(options.navigator || {}) };
  win.location = { href: 'http://localhost/example' };
  win.getComputedStyle = item => ({ visibility: item.style.visibility || 'visible' });
  win.setInterval = fn => { const id = ++nextTimer; intervals.set(id, fn); return id; };
  win.clearInterval = id => intervals.delete(id);
  const speech = { starts: [], aborts: 0, stops: 0, destroyed: 0 };
  let callbacks, state = { status: 'idle', supported: options.supported ?? true, active: false, transcript: '', interim: '' };
  const speechFactory = value => {
    callbacks = value;
    return {
      getSnapshot: () => ({ ...state }),
      start(value) { speech.starts.push(value); state = { ...state, status: 'listening', active: true, transcript: '', interim: '' }; callbacks.onState({ ...state }); return true; },
      stop() { speech.stops += 1; finish(); },
      abort() { speech.aborts += 1; if (state.active) finish(); },
      destroy() { speech.destroyed += 1; state = { ...state, status: 'destroyed', active: false }; },
    };
  };
  function finish() { state = { ...state, status: 'stopped', active: false, interim: '' }; callbacks.onUpdate({ ...state }); callbacks.onState({ ...state }); }
  speech.report = (transcript, interim = '') => { state = { ...state, transcript, interim }; callbacks.onUpdate({ ...state }); };
  const api = mountVoiceDictation({ documentRoot: doc, windowRoot: win, speechFactory, getContext: () => context,
    onSearch: options.onSearch, onNavigate: options.onNavigate, onOpen: options.onOpen });
  t.after(() => api.destroy());
  const q = suffix => { const found = doc.querySelector(`[data-vd-${suffix}]`); assert.ok(found, `Missing ${suffix}`); return found; };
  const addField = ({ title = 'Original message', type = 'text', tag = 'input', value = '', ...rest } = {}) => {
    const field = element(tag, doc); field.type = type; field.value = value; field.selectionStart = field.selectionEnd = value.length;
    field.setAttribute('aria-label', title); Object.assign(field, rest); doc.body.append(field); return field;
  };
  return { doc, win, api, q, speech, addField, intervals,
    setContext(value) { context = value; }, tick() { for (const callback of [...intervals.values()]) callback(); } };
}
async function draftWords(context, text) {
  await context.q('start').click(); context.speech.report(text); await context.q('stop').click();
}

test('mounted dictation requires explicit Start, review and Insert and never submits the original control', async t => {
  const searches = []; const context = setup(t, { onSearch: text => searches.push(text) });
  const field = context.addField({ value: 'Before old after' }); field.selectionStart = 7; field.selectionEnd = 10;
  field.focus(); context.api.open();
  assert.equal(context.speech.starts.length, 0); assert.equal(context.api.getSnapshot().targetLabel, 'Original message');
  await context.q('start').click(); context.speech.report('new', 'uncertain words');
  assert.equal(context.q('draft').value, 'new'); assert.equal(context.q('interim').textContent, 'uncertain words');
  assert.equal(context.q('draft').readOnly, true); assert.equal(context.q('insert').disabled, true);
  assert.equal(field.value, 'Before old after'); assert.deepEqual(searches, []);
  await context.q('stop').click(); context.q('draft').value = 'reviewed'; await context.q('draft').fire('input');
  await context.q('insert').click();
  assert.equal(field.value, 'Before reviewed after'); assert.equal(context.api.getSnapshot().opened, false);
  assert.deepEqual(field.emitted.filter(event => ['beforeinput', 'input', 'change', 'matumbo:voice-input', 'submit'].includes(event.type)).map(event => event.type), ['beforeinput', 'input', 'change', 'matumbo:voice-input']);
  assert.deepEqual(searches, []);
});

test('Search app works with no selected field and is called only by its explicit button', async t => {
  const searches = [], context = setup(t, { onSearch: text => searches.push(text) });
  context.api.open(); await context.q('start').click(); context.speech.report('  search all spaces  ');
  await context.q('search').click(); assert.deepEqual(searches, []);
  await context.q('stop').click();
  assert.equal(context.q('insert').disabled, true); assert.equal(context.q('search').disabled, false);
  assert.deepEqual(searches, []);
  await context.q('search').click();
  assert.deepEqual(searches, ['search all spaces']); assert.equal(context.api.getSnapshot().opened, false);
});

test('unavailable or failed app search preserves words and never invents a search result', async t => {
  const absent = setup(t); absent.api.open(); assert.equal(absent.q('search').hidden, true);
  const failed = setup(t, { onSearch() { throw new Error('Host search is unavailable'); } });
  failed.api.open(); await draftWords(failed, 'retained search'); await failed.q('search').click();
  assert.equal(failed.q('draft').value, 'retained search'); assert.equal(failed.api.getSnapshot().opened, true);
  assert.match(failed.q('status').textContent, /Host search is unavailable/);
});

test('cancelling an empty recognition take retains a reviewed draft and later takes append once', async t => {
  const context = setup(t); context.api.open(); context.q('draft').value = 'My reviewed beginning'; await context.q('draft').fire('input');
  await context.q('start').click(); context.api.close();
  assert.equal(context.q('draft').value, 'My reviewed beginning');
  context.api.open(); await context.q('start').click(); context.speech.report('next thought'); context.speech.report('next thought');
  await context.q('stop').click();
  assert.equal(context.q('draft').value, 'My reviewed beginning next thought');
});

test('hidden and secret fields cannot become destinations, including a previously focused field', async t => {
  const context = setup(t), hidden = context.addField({ title: 'Old field' });
  hidden.focus(); hidden.hidden = true;
  context.addField({ title: 'API key' }); context.addField({ title: 'Access token' });
  context.addField({ title: 'Password', type: 'password' });
  const excluded = context.addField({ title: 'Explicitly excluded' }); excluded.setAttribute('data-voice-exclude', '');
  context.addField({ title: 'Visible note' }); context.api.open();
  assert.equal(context.api.getSnapshot().targetLabel, null);
  assert.deepEqual(context.q('target').children.map(item => item.textContent), ['Transcript only — choose a field first', 'Visible note']);
  await draftWords(context, 'private destination must stay unchanged');
  assert.equal(context.q('insert').disabled, true); assert.equal(hidden.value, '');
});

test('changing owner while reusing the same empty field rejects a late insertion and retains the transcript', async t => {
  const context = setup(t), field = context.addField(); context.api.open(field);
  await draftWords(context, 'Words for the first conversation'); context.setContext('owner:b');
  await context.q('insert').click();
  assert.equal(field.value, ''); assert.equal(context.q('draft').value, 'Words for the first conversation');
  assert.match(context.q('status').textContent, /destination changed or closed/);
  context.tick(); assert.equal(context.api.getSnapshot().targetLabel, null); assert.equal(context.q('insert').disabled, true);
  assert.equal(context.q('draft').value, 'Words for the first conversation');
});

test('typing into or hiding the destination during review preserves both the new value and transcript', async t => {
  for (const action of ['edit', 'hide']) {
    const context = setup(t), field = context.addField({ value: 'original' }); context.api.open(field);
    await draftWords(context, 'dictated words');
    if (action === 'edit') field.value = 'newer manual writing'; else field.hidden = true;
    await context.q('insert').click();
    assert.equal(field.value, action === 'edit' ? 'newer manual writing' : 'original');
    assert.equal(context.q('draft').value, 'dictated words'); assert.equal(context.api.getSnapshot().opened, true);
    assert.match(context.q('status').textContent, action === 'edit' ? /field changed/ : /destination changed or closed/);
  }
});

test('clipboard failure offers native selection and disposal suppresses late callbacks and removes listeners', async t => {
  let resolveCopy; const pending = new Promise(resolve => { resolveCopy = resolve; });
  const context = setup(t); context.api.open(); await draftWords(context, 'words to copy');
  await context.q('copy').click();
  assert.match(context.q('status').textContent, /Automatic copy is unavailable/);
  assert.equal(context.doc.activeElement, context.q('draft')); assert.equal(context.q('draft').selected, true);
  context.win.navigator.clipboard = { writeText: () => pending };
  const status = context.q('status'), before = status.textContent, draft = context.q('draft');
  const copying = context.q('copy').click(); context.api.destroy(); resolveCopy(); await copying;
  context.speech.report('late callback');
  assert.equal(status.textContent, before); assert.equal(draft.value, 'words to copy');
  assert.equal(context.speech.destroyed, 1); assert.equal(context.intervals.size, 0);
  assert.equal(context.doc.listenerCount(), 0); assert.equal(context.win.listenerCount(), 0);
  assert.equal(context.doc.querySelector('#voice-dictation-panel'), null); assert.equal(context.doc.head.children.length, 0);
  context.api.open(); assert.equal(context.doc.querySelector('#voice-dictation-panel'), null);
});

test('numeric and date destinations expose format hints before insertion and keep invalid transcripts editable', async t => {
  const context = setup(t), amount = context.addField({ title: 'Amount', type: 'number', value: '4', min: '0', max: '10', step: '0.5' });
  context.addField({ title: 'Day', type: 'date', value: '2026-10-05' }); context.api.open(amount);
  assert.equal(context.q('format').hidden, false); assert.match(context.q('format').textContent, /digits.*whole field/);
  await draftWords(context, 'ten dollars'); await context.q('insert').click();
  assert.equal(amount.value, '4'); assert.equal(context.q('draft').value, 'ten dollars'); assert.match(context.q('status').textContent, /Use digits/);
  context.q('draft').value = '4.5'; await context.q('draft').fire('input'); await context.q('insert').click();
  assert.equal(amount.value, '4.5');
  context.api.open(); const option = context.q('target').children.find(item => item.textContent === 'Day');
  context.q('target').value = option.value; await context.q('target').fire('change');
  assert.match(context.q('format').textContent, /YYYY-MM-DD.*whole field/);
});

test('unsupported recognition still allows reviewed typed text and explicit host search', async t => {
  const searches = [], context = setup(t, { supported: false, onSearch: text => searches.push(text) }); context.api.open();
  assert.equal(context.q('start').disabled, true); assert.match(context.q('status').textContent, /unavailable in this browser/);
  context.q('draft').value = 'typed fallback'; await context.q('draft').fire('input'); await context.q('search').click();
  assert.deepEqual(searches, ['typed fallback']); assert.equal(context.speech.starts.length, 0);
});
