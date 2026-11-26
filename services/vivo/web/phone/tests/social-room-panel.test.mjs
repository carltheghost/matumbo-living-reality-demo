import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSocialRoom } from '../social-room-panel.mjs';
class Element {
  constructor(tag, text = '') { this.tag = tag; this.textContent = text; this.children = []; this.events = {}; }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this[name] = value; }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, fn) { this.events[name] = fn; }
  remove() { this.removed = true; }
}
const all = root => [root, ...root.children.flatMap(all)];
test('panel needs explicit selection and start, renders replies as text and stops on pagehide', async () => {
  const documentRoot = { createElement: tag => new Element(tag), createTextNode: text => new Element('#text', text) };
  const container = new Element('root'); let calls = 0, leave;
  const adapter = { key: 'account-1', connected: true, respond: async () => { calls++; return { text: '<script>untrusted</script>' }; } };
  const mounted = mountSocialRoom({ container, documentRoot, residents: [{ id: 'muse', name: 'Muse' }, { id: 'dot', name: 'dot' }], resolveConnection: () => adapter, scope: { addEventListener: (_, fn) => { leave = fn; }, removeEventListener() {} } });
  const start = all(container).find(n => n.textContent === 'Start socializing');
  assert.equal(calls, 0); assert.equal(start.disabled, true);
  for (const input of all(container).filter(n => n.tag === 'input')) input.checked = true;
  all(container).find(n => n.tag === 'fieldset').events.change(); assert.equal(start.disabled, false);
  start.events.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 6); assert.equal(mounted.room.snapshot().status, 'complete');
  assert.equal(all(container).filter(n => n.tag === '#text' && n.textContent.includes('<script>')).length, 6);
  adapter.respond = () => new Promise(() => {});
  start.events.click(); await Promise.resolve(); leave(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(mounted.room.snapshot().status, 'stopped');
  adapter.connected = false; mounted.refresh(); assert.equal(start.disabled, true);
  mounted.destroy(); assert.equal(container.children[0].removed, true);
});
