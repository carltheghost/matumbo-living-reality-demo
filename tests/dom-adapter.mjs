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
    removeAttribute(name) { attributes.delete(name); if(name==="src")this.src=""; }, getAttribute(name) { return name === 'hidden' ? this.hidden ? '' : null : attributes.get(name) ?? null; },
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

export {UiEvent,element};
