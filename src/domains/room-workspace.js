/**
 * Browser-local room conversations. This workspace is separate from the
 * canonical membership/cipher projections: no network, identity or crypto.
 */
export const ROOM_WORKSPACE_KEY = 'tumbo.rooms.workspace.v1';
export const ROOM_WORKSPACE_LIMITS = Object.freeze({ rooms: 32, messagesPerRoom: 200, message: 4000, label: 80, importBytes: 2000000 });
const CONTEXTS = new Set(['private', 'social', 'contract', 'market', 'ai']);
const ROLES = new Set(['owner', 'member', 'observer', 'agent']);
const copy = value => JSON.parse(JSON.stringify(value));
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function string(value, field, limit = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new TypeError(`${field} must contain 1–${limit} characters.`);
  return value.trim();
}
function normalizeRoom(input) {
  if (!record(input)) throw new TypeError('Room must be an object.');
  if (!CONTEXTS.has(input.context)) throw new TypeError('Unknown room context.');
  if (!ROLES.has(input.role)) throw new TypeError('Unknown local membership role.');
  if (!['local', 'projection'].includes(input.origin)) throw new TypeError('Unknown room origin.');
  return { id: string(input.id, 'Room ID'), label: string(input.label, 'Room name', ROOM_WORKSPACE_LIMITS.label), context: input.context, origin: input.origin, role: input.role, joined: input.joined === true };
}
function normalizeMessage(input) {
  if (!record(input)) throw new TypeError('Message must be an object.');
  const sentAt = string(input.sentAt, 'Message date', 40);
  if (!Number.isFinite(Date.parse(sentAt))) throw new TypeError('Message date is invalid.');
  return { id: string(input.id, 'Message ID'), roomId: string(input.roomId, 'Message room'), authorId: string(input.authorId, 'Message author ID'), author: string(input.author, 'Message author', 80), text: string(input.text, 'Message', ROOM_WORKSPACE_LIMITS.message), sentAt };
}
function normalizeData(input) {
  if (!record(input) || input.schemaVersion !== 1 || !Array.isArray(input.rooms) || !Array.isArray(input.messages)) throw new TypeError('Choose a maTumbo rooms workspace JSON export.');
  if (input.rooms.length > ROOM_WORKSPACE_LIMITS.rooms || input.messages.length > ROOM_WORKSPACE_LIMITS.rooms * ROOM_WORKSPACE_LIMITS.messagesPerRoom) throw new RangeError('This workspace exceeds the room/history limit.');
  const rooms = input.rooms.map(normalizeRoom);
  const ids = new Set();
  for (const room of rooms) { if (ids.has(room.id)) throw new TypeError('Duplicate room ID.'); ids.add(room.id); }
  if (rooms.filter(room => room.joined).length > 1) throw new TypeError('Only one local room can be entered at a time.');
  const messages = input.messages.map(normalizeMessage);
  const messageIds = new Set(), counts = new Map();
  for (const message of messages) {
    if (!ids.has(message.roomId)) throw new TypeError('Message references an unknown room.');
    if (messageIds.has(message.id)) throw new TypeError('Duplicate message ID.');
    messageIds.add(message.id);
    const count = (counts.get(message.roomId) || 0) + 1;
    if (count > ROOM_WORKSPACE_LIMITS.messagesPerRoom) throw new RangeError('A room has too many messages.');
    counts.set(message.roomId, count);
  }
  return { schemaVersion: 1, revision: Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : 0, rooms, messages, selectedRoomId: ids.has(input.selectedRoomId) ? input.selectedRoomId : rooms[0]?.id ?? null };
}
function seedRoom(room) {
  return normalizeRoom({ id: room.id, label: room.label, context: room.context, origin: 'projection', role: ROLES.has(room.role) ? room.role : 'observer', joined: false });
}
function boundedJson(value) {
  if (typeof value === 'string') {
    if (new TextEncoder().encode(value).length > ROOM_WORKSPACE_LIMITS.importBytes) throw new RangeError('Choose a rooms export smaller than 2 MB.');
    return JSON.parse(value);
  }
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).length > ROOM_WORKSPACE_LIMITS.importBytes) throw new RangeError('Choose a rooms export smaller than 2 MB.');
  return value;
}
function serialize(value) {
  const raw = JSON.stringify(value);
  if (new TextEncoder().encode(raw).length > ROOM_WORKSPACE_LIMITS.importBytes) throw new RangeError('Room history has reached its 2 MB backup capacity. Export it, then explicitly remove messages before adding more.');
  return raw;
}

/** All mutations validate first; full history is never silently trimmed. */
export function createRoomWorkspace({ storage = null, seedRooms = [], now = () => new Date().toISOString(), makeId = () => globalThis.crypto.randomUUID(), author = 'You' } = {}) {
  const authorLabel = string(author, 'Your local name', 80);
  let state = { schemaVersion: 1, revision: 0, rooms: seedRooms.map(seedRoom), messages: [], selectedRoomId: seedRooms[0]?.id ?? null };
  state = normalizeData(state);
  let checkpoint = null, storageError = null, conflict = false;
  if (storage) {
    try {
      checkpoint = storage.getItem(ROOM_WORKSPACE_KEY);
      if (checkpoint !== null) {
        const saved = normalizeData(boundedJson(checkpoint));
        const seedIds = new Set(state.rooms.map(room => room.id));
        for (const room of saved.rooms) if (room.origin === 'projection' && !seedIds.has(room.id)) Object.assign(room, { origin: 'local', role: 'owner', joined: false });
        for (const room of state.rooms) {
          const existing = saved.rooms.find(row => row.id === room.id);
          // Projection membership remains authoritative. A backup cannot turn
          // an observer into an owner, or invent canonical membership.
          if (existing) Object.assign(existing, room, { joined: existing.joined });
          else if (saved.rooms.length < ROOM_WORKSPACE_LIMITS.rooms) saved.rooms.push(room);
        }
        state = saved;
      }
    } catch { storageError = 'Saved rooms could not be read. This session is in memory; export a backup before closing.'; storage = null; }
  }
  function snapshot() { return { ...copy(state), localOnly: true, networkConnected: false, cryptographyImplemented: false, storageError, conflict }; }
  function update(change) {
    if (storage) {
      let latest;
      try { latest = storage.getItem(ROOM_WORKSPACE_KEY); }
      catch { storageError = 'Browser storage is unavailable. Changes stay in this session; export a backup.'; }
      if (latest !== undefined && latest !== checkpoint) {
        conflict = true;
        throw new Error('Another tab changed the saved rooms. Export this session, then load the saved workspace before editing.');
      }
    }
    const next = copy(state);
    const result = change(next);
    next.revision += 1;
    const normalized = normalizeData(next);
    // Every adopted state must fit its own portable export, including UTF-8
    // Unicode bytes. Capacity rejection leaves all existing history intact.
    const raw = serialize(normalized);
    if (storage) {
      try { storage.setItem(ROOM_WORKSPACE_KEY, raw); checkpoint = raw; storageError = null; }
      catch { storageError = 'Rooms could not be saved in this browser. Changes stay in this session; export a backup.'; }
    }
    state = normalized;
    return copy(result ?? snapshot());
  }
  function roomIn(next, id) {
    const room = next.rooms.find(row => row.id === id);
    if (!room) throw new Error('Select a room that exists in this workspace.');
    return room;
  }
  function getRoom(id = state.selectedRoomId) { return copy(state.rooms.find(row => row.id === id) ?? null); }
  function createRoom({ label, context = 'private' }) {
    const room = normalizeRoom({ id: `local-room:${makeId()}`, label, context, origin: 'local', role: 'owner', joined: true });
    return update(next => {
      if (next.rooms.length >= ROOM_WORKSPACE_LIMITS.rooms) throw new RangeError('The workspace holds 32 rooms. Export or remove an unused local room before creating another.');
      if (next.rooms.some(row => row.id === room.id)) throw new Error('Room ID already exists.');
      for (const existing of next.rooms) existing.joined = false;
      next.rooms.push(room); next.selectedRoomId = room.id;
      return room;
    });
  }
  function selectRoom(id) { return update(next => { const room = roomIn(next, id); next.selectedRoomId = id; return room; }); }
  function joinRoom(id = state.selectedRoomId) { return update(next => { const room = roomIn(next, id); for (const existing of next.rooms) existing.joined = existing.id === id; next.selectedRoomId = id; return room; }); }
  function leaveRoom(id = state.selectedRoomId) { return update(next => { const room = roomIn(next, id); room.joined = false; return room; }); }
  function sendMessage(text, roomId = state.selectedRoomId) {
    const message = normalizeMessage({ id: `local-message:${makeId()}`, roomId, authorId: 'local-you', author: authorLabel, text, sentAt: now() });
    return update(next => {
      const room = roomIn(next, roomId);
      if (!room.joined) throw new Error('Enter this local room before adding a message.');
      if (room.role === 'observer') throw new Error('This projected room is read-only for your observer membership. Create your own local room to write.');
      if (next.messages.filter(row => row.roomId === roomId).length >= ROOM_WORKSPACE_LIMITS.messagesPerRoom) throw new RangeError('This room has 200 messages. Export a backup and remove a message before writing more.');
      if (next.messages.some(row => row.id === message.id)) throw new Error('Message ID already exists.');
      next.messages.push(message); return message;
    });
  }
  function deleteMessage(id) { return update(next => { const index = next.messages.findIndex(row => row.id === id); if (index < 0) throw new Error('Message no longer exists.'); next.messages.splice(index, 1); }); }
  function removeRoom(id) { return update(next => { const room = roomIn(next, id); if (room.origin !== 'local') throw new Error('A projected room cannot be removed here.'); next.rooms = next.rooms.filter(row => row.id !== id); next.messages = next.messages.filter(row => row.roomId !== id); if (next.selectedRoomId === id) next.selectedRoomId = next.rooms[0]?.id ?? null; }); }
  function importData(value) {
    const incoming = normalizeData(boundedJson(value));
    return update(next => {
      let roomsAdded = 0, messagesAdded = 0;
      const remap = new Map();
      for (const room of incoming.rooms) {
        const existing = next.rooms.find(row => row.id === room.id);
        if (existing) {
          if (existing.label !== room.label || existing.context !== room.context || existing.origin !== room.origin) throw new Error('An imported room ID conflicts with a different saved room. Import was not applied.');
          remap.set(room.id, existing.id);
        } else {
          // Unknown imported projection IDs have no canonical authority. They
          // become plainly labeled local archive rooms with local membership.
          const imported = room.origin === 'projection' ? { ...room, origin: 'local', role: 'owner', joined: false } : { ...room, joined: false };
          next.rooms.push(imported); remap.set(room.id, imported.id); roomsAdded += 1;
        }
      }
      for (const message of incoming.messages) {
        const imported = { ...message, roomId: remap.get(message.roomId) };
        const existing = next.messages.find(row => row.id === message.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(imported)) throw new Error('An imported message ID conflicts with saved content. Import was not applied.');
        if (!existing) { next.messages.push(imported); messagesAdded += 1; }
      }
      // Repeated imports are idempotent and never replace saved messages.
      return { roomsAdded, messagesAdded };
    });
  }
  function reload() {
    if (!storage) throw new Error('This session has no browser storage. Export a backup.');
    const raw = storage.getItem(ROOM_WORKSPACE_KEY);
    const next = raw === null ? normalizeData({ schemaVersion: 1, revision: 0, rooms: seedRooms.map(seedRoom), messages: [], selectedRoomId: seedRooms[0]?.id }) : normalizeData(boundedJson(raw));
    const seeds = seedRooms.map(seedRoom), seedIds = new Set(seeds.map(room => room.id));
    for (const room of next.rooms) if (room.origin === 'projection' && !seedIds.has(room.id)) Object.assign(room, { origin: 'local', role: 'owner', joined: false });
    for (const seed of seeds) {
      const existing = next.rooms.find(row => row.id === seed.id);
      if (existing) Object.assign(existing, seed, { joined: existing.joined });
      else if (next.rooms.length < ROOM_WORKSPACE_LIMITS.rooms) next.rooms.push(seed);
    }
    state = next; checkpoint = raw; conflict = false; storageError = null;
    return snapshot();
  }
  function syncSeedRooms(rooms) {
    const seeds = rooms.map(seedRoom), next = copy(state), ids = new Set(seeds.map(room => room.id));
    for (const room of next.rooms) if (room.origin === 'projection' && !ids.has(room.id)) Object.assign(room, { origin: 'local', role: 'owner', joined: false });
    for (const seed of seeds) {
      const existing = next.rooms.find(room => room.id === seed.id);
      if (existing) Object.assign(existing, seed, { joined: existing.joined });
      else if (next.rooms.length < ROOM_WORKSPACE_LIMITS.rooms) next.rooms.push(seed);
      else storageError = 'This workspace is full. Remove an unused local room to show newly projected rooms.';
    }
    // Projection refresh cannot overwrite a newer browser checkpoint. It only
    // reconciles metadata here; the next explicit local mutation persists it.
    state = normalizeData(next); seedRooms = copy(rooms);
    return snapshot();
  }
  return Object.freeze({ snapshot, getRoom, createRoom, selectRoom, joinRoom, leaveRoom, sendMessage, deleteMessage, removeRoom, importData, exportData: () => copy(state), exportJson: () => serialize(state), reload, syncSeedRooms });
}
