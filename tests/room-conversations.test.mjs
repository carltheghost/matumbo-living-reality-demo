import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomSpaces, summarizeRooms } from '../src/render/room-spaces.js';
import { createLivingRealityProjection } from '../src/core/demo-projection.js';
import { createRealitySurfaceDocument } from '../src/render/reality-surface-document.js';
import { ROOM_WORKSPACE_KEY } from '../src/domains/room-workspace.js';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';

function element(tag = 'div') {
  const listeners = new Map(), attributes = new Map(); let text = '';
  return {
    tagName: tag.toUpperCase(), children: [], dataset: {}, style: {}, value: '', files: [], parentNode: null, hidden: false, disabled: false,
    get textContent() { return text + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { text = String(value); this.children = []; },
    setAttribute(key, value) { attributes.set(key, String(value)); }, getAttribute(key) { return attributes.get(key) ?? null; }, hasAttribute(key) { return attributes.has(key); },
    appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child; }, append(...children) { children.forEach(child => this.appendChild(child)); },
    insertBefore(child, before) { child.remove(); const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); child.parentNode = this; return child; },
    replaceChildren(...children) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; text = ''; this.append(...children); },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; },
    classList: { toggle() {} }, addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); }, removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    async fire(name, extra = {}) { if (this.disabled) return; return Promise.all([...(listeners.get(name) || [])].map(listener => listener({ preventDefault() {}, target: this, ...extra }))); }, click() { return this.fire('click'); }, focus() {},
  };
}
function walk(root) { return [root, ...root.children.flatMap(walk)]; }
function label(root, name) { const item = walk(root).find(item => item.getAttribute('aria-label') === name); assert.ok(item, `Missing ${name}`); return item; }
function button(root, name) { const item = walk(root).find(item => item.tagName === 'BUTTON' && item.textContent === name); assert.ok(item, `Missing ${name}`); return item; }
function formOf(input) { let current = input; while (current && current.tagName !== 'FORM') current = current.parentNode; assert.ok(current); return current; }
function setup({ storage, projection = createLivingRealityProjection().world, three = null, parent = null } = {}) {
  const saved = new Map(); storage ??= { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const doc = element('document'); doc.head = element('head'); doc.body = element('body'); doc.append(doc.head, doc.body);
  doc.createElement = tag => { const item = element(tag); item.ownerDocument = doc; return item; }; doc.getElementById = id => walk(doc).find(item => item.id === id) ?? null;
  const panel = doc.createElement('aside'); panel.id = 'room-console'; panel.hidden = true; doc.body.appendChild(panel);
  function add(id, tag, parent = panel) { const item = doc.createElement(tag); item.id = id; parent.appendChild(item); return item; }
  const head = add('room-console-head', 'div'); add('room-console-title', 'h2', head); add('room-console-close', 'button', head);
  const toolbar = add('room-console-toolbar', 'div');
  for (const [id, text] of [['room-console-enter', 'Enter selected room'], ['room-console-leave', 'Leave room'], ['room-console-replay', 'Replay local enter / leave']]) add(id, 'button', toolbar).textContent = text;
  add('room-console-status', 'p', toolbar);
  const metrics = add('room-console-summary', 'div'); add('room-console-room-count', 'b', metrics); add('room-console-membership-count', 'b', metrics);
  for (const id of ['room-console-current', 'room-console-membership', 'room-console-message-indicator', 'room-console-list', 'room-console-trace', 'room-console-boundary']) add(id, 'div');
  const api = createRoomSpaces({ documentRoot: doc, windowRoot: {}, storage, projection, three, parent });
  return { doc, panel, api, storage, saved };
}

async function createLocalRoom(context, name = 'Studio room') {
  const input = label(context.panel, 'New room name'); input.value = name; await formOf(input).fire('submit');
  return context.api.getSnapshot().selectedId;
}
async function send(context, text) {
  const input = label(context.panel, 'Message this local room'); input.value = text; await formOf(input).fire('submit');
}

test('removing a middle local room reconciles retained portal positions before another room is added', async () => {
  const parent = new THREE.Group(), context = setup({ three: THREE, parent });
  const first = await createLocalRoom(context, 'First');
  await createLocalRoom(context, 'Second'); await createLocalRoom(context, 'Third');
  context.api.selectRoom(first);
  await button(context.panel, 'Remove this local room').click();
  await button(context.panel, 'Confirm remove room & messages').click();
  await createLocalRoom(context, 'Fourth');
  const rooms = context.api.exportConversations().rooms;
  const points = rooms.map(({ id }) => context.api.getFocusTarget(id).toArray().join(','));
  assert.equal(new Set(points).size, rooms.length, 'Every retained and new portal has its own location');
  assert.equal(parent.children[0].children.length, rooms.length);
  context.api.destroy(); assert.equal(parent.children.length, 0);
});

test('Rooms mounts one conversation owner, with original enter controls and composer captured before optional evidence', () => {
  const context = setup(); context.api.open();
  assert.equal(walk(context.doc).filter(item => item.dataset.roomConversations === 'true').length, 1);
  const semantic = createRealitySurfaceDocument({ element: context.panel, feature: { id: 'rooms' } });
  const blocks = semantic.read();
  assert.ok(blocks.find(item => item.text === 'Conversation room'));
  assert.ok(blocks.find(item => item.text === 'Enter selected room'));
  assert.ok(blocks.findIndex(item => item.text === 'Message this local room') < blocks.findIndex(item => item.text === 'Room spaces & projection evidence'));
  assert.equal(semantic.snapshot().canonicalOwners, 1); semantic.dispose(); context.api.destroy();
});

test('create, write, select, leave and reload use the same message context as the room portal', async () => {
  const context = setup();
  const roomId = await createLocalRoom(context); await send(context, 'A room plan');
  assert.equal(context.api.getSnapshot().enteredRoomId, roomId);
  assert.equal(context.api.getSnapshot().conversationWorkspace.currentRoom.id, roomId);
  assert.equal(context.api.exportConversations().messages[0].roomId, roomId);
  assert.equal(label(context.panel, 'Message this local room').value, '');
  await button(context.panel, 'Leave room').click();
  assert.equal(label(context.panel, 'Message this local room').disabled, true);
  const reload = setup({ storage: context.storage });
  assert.equal(reload.api.getSnapshot().conversationWorkspace.messageCount, 1);
  assert.equal(reload.api.getSnapshot().selectedId, roomId);
  await button(reload.panel, 'Enter selected room').click(); await send(reload, 'A second room plan');
  assert.equal(reload.api.exportConversations().messages.length, 2);
});

test('projected observer room is read-only while owner room retains real local messages', async () => {
  const context = setup();
  context.api.selectRoom('room:market'); context.api.enterRoom();
  assert.equal(label(context.panel, 'Message this local room').disabled, true);
  assert.match(context.panel.textContent, /observer membership is read-only/);
  context.api.selectRoom('room:reality'); context.api.enterRoom(); await send(context, '<img src=x onerror=alert(1)>');
  assert.equal(context.api.getSnapshot().conversationWorkspace.messageCount, 1);
  assert.ok(walk(context.panel).some(item => item.tagName === 'P' && item.textContent === '<img src=x onerror=alert(1)>'));
  assert.equal(walk(context.panel).some(item => item.tagName === 'IMG'), false);
});

test('backup import and delete actions change actual history, with confirmation before removing a room', async () => {
  const first = setup(); await createLocalRoom(first); await send(first, 'Imported history');
  const second = setup(); const input = label(second.panel, 'Import rooms JSON backup');
  input.files = [{ size: 900, text: async () => JSON.stringify(first.api.exportConversations()) }]; await input.fire('change');
  assert.equal(second.api.getSnapshot().conversationWorkspace.messageCount, 1);
  second.api.selectRoom(first.api.getSnapshot().selectedId);
  await button(second.panel, 'Remove this local room').click();
  assert.equal(second.api.getSnapshot().conversationWorkspace.messageCount, 1);
  await button(second.panel, 'Confirm remove room & messages').click();
  assert.equal(second.api.getSnapshot().conversationWorkspace.messageCount, 0);
  assert.equal(second.api.getSnapshot().roomCount, 2);
});

test('stale-tab conflict is visible and explicit reload restores current saved room and history', async () => {
  const first = setup(), second = setup({ storage: first.storage });
  await createLocalRoom(first); await send(first, 'From the newer tab');
  const input = label(second.panel, 'New room name'); input.value = 'Older tab room'; await formOf(input).fire('submit');
  assert.equal(second.api.getSnapshot().conversationWorkspace.conflict, true);
  assert.match(second.panel.textContent, /Another tab has a newer saved workspace/);
  await button(second.panel, 'Load saved workspace').click();
  assert.equal(second.api.getSnapshot().selectedId, first.api.getSnapshot().selectedId);
  assert.equal(second.api.getSnapshot().conversationWorkspace.messageCount, 1);
  assert.equal(second.api.getSnapshot().conversationWorkspace.conflict, false);
});

test('persistent failures expose session-only history and the safe export reminder', async () => {
  const storage = { getItem() { return null; }, setItem() { throw new Error('Quota exceeded'); } };
  const context = setup({ storage }); await createLocalRoom(context); await send(context, 'Unsaved but retained');
  assert.equal(context.api.getSnapshot().conversationWorkspace.messageCount, 1);
  assert.match(context.api.getSnapshot().conversationWorkspace.storageError, /export a backup/);
  assert.match(context.panel.textContent, /could not be saved/);
  assert.equal(context.api.exportConversations().messages[0].text, 'Unsaved but retained');
});

test('viewer role uses explicit viewer membership rather than the first room member', () => {
  const projection = { source: 'spatial-rooms', simulation: true, entities: [{ kind: 'spatial-room', id: 'room:one', label: 'One', context: 'social' }, { kind: 'room-membership', id: 'member:other', roomId: 'room:one', memberId: 'another-person', role: 'owner' }, { kind: 'room-membership', id: 'member:viewer', roomId: 'room:one', memberId: 'viewer', role: 'observer' }], evidence: [{ kind: 'local-membership-filter', viewerId: 'viewer' }] };
  assert.equal(summarizeRooms(projection).rooms[0].role, 'observer');
});
