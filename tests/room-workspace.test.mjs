import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomWorkspace, ROOM_WORKSPACE_KEY, ROOM_WORKSPACE_LIMITS } from '../src/domains/room-workspace.js';

const seeds = [
  { id: 'room:reality', label: 'Reality room', context: 'social', role: 'owner' },
  { id: 'room:market', label: 'Market room', context: 'market', role: 'observer' },
];
function setup(options = {}) {
  let count = 0; const saved = new Map();
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const domainOptions = { storage, seedRooms: seeds, now: () => '2026-10-04T12:00:00.000Z', makeId: () => `${++count}`, ...options };
  return { workspace: createRoomWorkspace(domainOptions), domainOptions, storage, saved };
}

test('create, enter, select, leave and persist real local messages without mutating seed projection', () => {
  const before = JSON.stringify(seeds), { workspace, storage } = setup();
  assert.throws(() => workspace.sendMessage('Before entering'), /Enter/);
  workspace.joinRoom('room:reality'); workspace.sendMessage('A real local note');
  const privateRoom = workspace.createRoom({ label: 'Studio plan', context: 'private' });
  assert.equal(privateRoom.origin, 'local'); assert.equal(privateRoom.role, 'owner');
  assert.equal(workspace.getRoom('room:reality').joined, false);
  workspace.sendMessage('Work in this room'); workspace.leaveRoom();
  assert.throws(() => workspace.sendMessage('Cannot write after leaving'), /Enter/);
  workspace.selectRoom('room:reality'); workspace.joinRoom();
  assert.deepEqual(workspace.snapshot().messages.map(row => row.roomId), ['room:reality', privateRoom.id]);
  const reload = createRoomWorkspace({ storage, seedRooms: seeds });
  assert.equal(reload.snapshot().messages.length, 2); assert.equal(reload.getRoom().id, 'room:reality');
  assert.equal(reload.snapshot().networkConnected, false); assert.equal(reload.snapshot().cryptographyImplemented, false);
  assert.equal(JSON.stringify(seeds), before);
});

test('projected observer membership remains read-only and canonical refresh can revoke writing', () => {
  const { workspace } = setup(); workspace.joinRoom('room:market');
  assert.throws(() => workspace.sendMessage('Observer should not write'), /read-only/);
  workspace.joinRoom('room:reality'); workspace.sendMessage('Before permission refresh');
  workspace.syncSeedRooms(seeds.map(room => ({ ...room, role: 'observer' })));
  assert.throws(() => workspace.sendMessage('After permission refresh'), /read-only/);
  assert.equal(workspace.snapshot().messages.length, 1);
});

test('unknown saved projection rooms become local archives and forged backup roles cannot grant canonical access', () => {
  const { workspace, storage } = setup(); workspace.joinRoom('room:market');
  const exported = workspace.exportData(); exported.rooms[1].role = 'owner';
  storage.setItem(ROOM_WORKSPACE_KEY, JSON.stringify(exported));
  const reload = createRoomWorkspace({ storage, seedRooms: [seeds[1]] });
  assert.equal(reload.getRoom('room:reality').origin, 'local');
  assert.equal(reload.getRoom('room:market').role, 'observer');
  assert.throws(() => reload.sendMessage('Forged owner'), /read-only/);
});

test('bounded capacity preserves full room history instead of silently dropping earlier messages', () => {
  const { workspace } = setup({ storage: null }); workspace.joinRoom('room:reality');
  for (let index = 0; index < ROOM_WORKSPACE_LIMITS.messagesPerRoom; index++) workspace.sendMessage(`Message ${index}`);
  const before = workspace.exportData();
  assert.throws(() => workspace.sendMessage('Too many'), /200 messages/);
  assert.deepEqual(workspace.exportData(), before);
  workspace.deleteMessage(before.messages[0].id); workspace.sendMessage('After explicit delete');
  assert.equal(workspace.snapshot().messages.length, 200);
});

test('room capacity, field lengths and invalid messages fail atomically', () => {
  const { workspace } = setup({ storage: null });
  assert.throws(() => workspace.createRoom({ label: 'x'.repeat(81) }), /80/);
  assert.throws(() => workspace.createRoom({ label: 'Bad context', context: 'unknown' }), /context/);
  assert.throws(() => workspace.selectRoom('missing'), /exists/);
  workspace.joinRoom('room:reality');
  assert.throws(() => workspace.sendMessage('  '), /characters/);
  assert.throws(() => workspace.sendMessage('x'.repeat(4001)), /4000/);
  for (let index = seeds.length; index < 32; index++) workspace.createRoom({ label: `Room ${index}` });
  const before = workspace.exportData();
  assert.throws(() => workspace.createRoom({ label: 'Overflow' }), /32 rooms/);
  assert.deepEqual(workspace.exportData(), before);
});

test('imports merge rooms and messages idempotently and preserve saved content', () => {
  const first = setup(); first.workspace.joinRoom('room:reality'); first.workspace.sendMessage('Original note');
  const privateRoom = first.workspace.createRoom({ label: 'Imported room' }); first.workspace.sendMessage('Private import');
  const second = setup(); const imported = second.workspace.importData(JSON.stringify(first.workspace.exportData()));
  assert.deepEqual(imported, { roomsAdded: 1, messagesAdded: 2 });
  assert.deepEqual(second.workspace.importData(first.workspace.exportData()), { roomsAdded: 0, messagesAdded: 0 });
  assert.equal(second.workspace.getRoom(privateRoom.id).joined, false);
  const changed = first.workspace.exportData(); changed.messages[0].text = 'A conflicting replacement';
  const before = second.workspace.exportData();
  assert.throws(() => second.workspace.importData(changed), /conflicts/);
  assert.deepEqual(second.workspace.exportData(), before);
});

test('malformed imports, oversized files and invalid references do not partially apply', () => {
  const { workspace } = setup(); const data = workspace.exportData();
  assert.throws(() => workspace.importData('{bad json'), SyntaxError);
  assert.throws(() => workspace.importData(' '.repeat(2000001)), /2 MB/);
  const duplicate = structuredClone(data); duplicate.rooms.push(duplicate.rooms[0]);
  assert.throws(() => workspace.importData(duplicate), /Duplicate room/);
  const missing = structuredClone(data); missing.messages.push({ id: 'msg:1', roomId: 'absent', authorId: 'you', author: 'You', text: 'A note', sentAt: '2026-10-04' });
  assert.throws(() => workspace.importData(missing), /unknown room/);
  assert.deepEqual(workspace.exportData(), data);
});

test('storage failures keep usable session data and expose a clear export warning', () => {
  const storage = { getItem() { return null; }, setItem() { throw new Error('Quota exceeded'); } };
  const { workspace } = setup({ storage });
  const room = workspace.createRoom({ label: 'Unsaved room' }); workspace.sendMessage('Retained in memory');
  assert.equal(workspace.getRoom().id, room.id); assert.equal(workspace.snapshot().messages.length, 1);
  assert.match(workspace.snapshot().storageError, /export a backup/);
  assert.equal(workspace.exportData().messages[0].text, 'Retained in memory');
});

test('another tab cannot silently overwrite newer saved history; explicit reload recovers', () => {
  const first = setup(); const second = createRoomWorkspace({ ...first.domainOptions, makeId: () => 'second' });
  first.workspace.joinRoom('room:reality'); first.workspace.sendMessage('First tab note');
  assert.throws(() => second.createRoom({ label: 'Stale tab change' }), /Another tab/);
  assert.equal(second.snapshot().conflict, true); assert.equal(second.snapshot().messages.length, 0);
  assert.equal(JSON.parse(first.storage.getItem(ROOM_WORKSPACE_KEY)).messages.length, 1);
  second.reload(); second.sendMessage('Second tab after reload');
  assert.equal(second.snapshot().messages.length, 2);
});

test('removing local room explicitly deletes its own messages and never removes canonical rooms', () => {
  const { workspace } = setup(); workspace.joinRoom('room:reality'); workspace.sendMessage('Keep canonical note');
  const room = workspace.createRoom({ label: 'Temporary room' }); workspace.sendMessage('Delete with room');
  assert.throws(() => workspace.removeRoom('room:reality'), /projected/);
  workspace.removeRoom(room.id);
  assert.equal(workspace.snapshot().messages.length, 1); assert.equal(workspace.getRoom().id, 'room:reality');
});

test('snapshots are detached and message markup remains literal stored text', () => {
  const { workspace } = setup(); workspace.joinRoom('room:reality'); workspace.sendMessage('<img src=x onerror=alert(1)>');
  const snapshot = workspace.snapshot(); snapshot.messages[0].text = 'Modified copy'; snapshot.rooms[0].role = 'observer';
  assert.match(workspace.snapshot().messages[0].text, /^<img/); assert.equal(workspace.getRoom().role, 'owner');
});

test('UTF-8 workspace capacity rejects overflow atomically and the full canonical backup restores', () => {
  const { workspace } = setup({ storage: null });
  const room = workspace.createRoom({ label: 'Unicode history' });
  let count = 0, lastGood;
  for (;;) {
    lastGood = workspace.exportJson();
    try { workspace.sendMessage('文'.repeat(4000)); count += 1; }
    catch (error) { assert.match(error.message, /2 MB backup capacity/); break; }
  }
  assert.ok(count > 100 && count < 200, 'Unicode bytes exhaust portable capacity before per-room message count');
  assert.equal(workspace.exportJson(), lastGood);
  assert.equal(workspace.snapshot().messages.length, count);
  assert.ok(new TextEncoder().encode(lastGood).length <= ROOM_WORKSPACE_LIMITS.importBytes);
  const restore = setup({ storage: null }).workspace;
  restore.importData(lastGood);
  assert.equal(restore.getRoom(room.id).label, 'Unicode history');
  assert.deepEqual(restore.snapshot().messages, workspace.snapshot().messages);
  const incoming = JSON.parse(lastGood);
  incoming.messages.push({ ...incoming.messages[0], id: 'extra-message' });
  assert.throws(() => restore.importData(incoming), /2 MB/);
  assert.deepEqual(restore.snapshot().messages, workspace.snapshot().messages);
});
