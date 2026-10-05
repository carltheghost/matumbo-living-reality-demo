import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createPlainVoice, encryptVoice, decryptVoice, createVoiceEncryptionAdapter, normalizeVoiceAttachment, plainVoiceBlob, serializeVoiceAttachment, parseVoiceEnvelope, VOICE_LIMITS } from '../src/domains/voice-message.js';
import { createRoomWorkspace, ROOM_WORKSPACE_KEY } from '../src/domains/room-workspace.js';

const recording = (size = 20) => ({ blob: new Blob([new Uint8Array(size).fill(74)], { type: 'audio/webm;codecs=opus' }), mimeType: 'audio/webm;codecs=opus', durationMs: 1250 });
const bytes = async blob => [...new Uint8Array(await blob.arrayBuffer())];
function workspace(options = {}) { let id = 0; return createRoomWorkspace({ makeId: () => `${++id}`, ...options }); }

test('plain audio round trips through portable canonical envelope without changing bytes', async () => {
  const source = recording(), attachment = await createPlainVoice(source);
  assert.equal(attachment.mode, 'plain'); assert.equal(attachment.byteLength, 20);
  assert.deepEqual(parseVoiceEnvelope(serializeVoiceAttachment(attachment)), attachment);
  assert.deepEqual(await bytes(plainVoiceBlob(attachment)), await bytes(source.blob));
});

test('real AES-GCM-256 encrypt/decrypt uses fresh keys and IVs with no key/plaintext inside envelope', async () => {
  const source = recording();
  const first = await encryptVoice(source, { cryptoRoot: webcrypto }), second = await encryptVoice(source, { cryptoRoot: webcrypto });
  assert.match(first.unlockCode, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.unlockCode, second.unlockCode); assert.notEqual(first.attachment.iv, second.attachment.iv); assert.notEqual(first.attachment.ciphertext, second.attachment.ciphertext);
  assert.equal(Buffer.from(first.attachment.iv, 'base64url').length, 12); assert.equal(Buffer.from(first.attachment.ciphertext, 'base64url').length, source.blob.size + 16);
  const serialized = serializeVoiceAttachment(first.attachment);
  assert.equal(serialized.includes(first.unlockCode), false); assert.equal('data' in first.attachment, false);
  const restored = parseVoiceEnvelope(serialized);
  assert.deepEqual(await bytes(await decryptVoice(restored, first.unlockCode, { cryptoRoot: webcrypto })), await bytes(source.blob));
  assert.throws(() => plainVoiceBlob(first.attachment), /Unlock/);
});

test('domain encryption adapter binds the injected provider and exposes only bounded encrypt/decrypt operations', async () => {
  const calls = [], browser = { crypto: {
    getRandomValues(array) { calls.push('random'); return webcrypto.getRandomValues(array); },
    subtle: {
      importKey(...args) { calls.push('import'); return webcrypto.subtle.importKey(...args); },
      encrypt(...args) { calls.push('encrypt'); return webcrypto.subtle.encrypt(...args); },
      decrypt(...args) { calls.push('decrypt'); return webcrypto.subtle.decrypt(...args); },
    },
  } };
  const adapter = createVoiceEncryptionAdapter(browser);
  assert.deepEqual(Object.keys(adapter).sort(), ['decrypt', 'encrypt']); assert.equal(Object.isFrozen(adapter), true);
  browser.crypto = {}; // A mounted renderer retains its original domain binding.
  const source = recording(), encrypted = await adapter.encrypt(source);
  assert.deepEqual(await bytes(await adapter.decrypt(encrypted.attachment, encrypted.unlockCode)), await bytes(source.blob));
  assert.deepEqual(calls, ['random', 'random', 'import', 'encrypt', 'import', 'decrypt']);
  await assert.rejects(adapter.encrypt(recording(VOICE_LIMITS.bytes + 1)), /384 KB/);
  assert.deepEqual(calls, ['random', 'random', 'import', 'encrypt', 'import', 'decrypt'], 'oversize input never invokes the provider');
  await assert.rejects(createVoiceEncryptionAdapter({ crypto: {} }).encrypt(recording()), /Web Crypto/);
});

test('wrong key, modified ciphertext, IV and authenticated metadata reject decryption', async () => {
  const first = await encryptVoice(recording(), { cryptoRoot: webcrypto }), second = await encryptVoice(recording(), { cryptoRoot: webcrypto });
  await assert.rejects(decryptVoice(first.attachment, second.unlockCode, { cryptoRoot: webcrypto }), /wrong or.*changed/);
  for (const field of ['ciphertext', 'iv']) {
    const changed = { ...first.attachment, [field]: `${first.attachment[field][0] === 'A' ? 'B' : 'A'}${first.attachment[field].slice(1)}` };
    await assert.rejects(decryptVoice(changed, first.unlockCode, { cryptoRoot: webcrypto }), /wrong or.*changed/);
  }
  for (const patch of [{ durationMs: 1300 }, { mimeType: 'audio/ogg' }]) await assert.rejects(decryptVoice({ ...first.attachment, ...patch }, first.unlockCode, { cryptoRoot: webcrypto }), /wrong or.*changed/);
  await assert.rejects(decryptVoice(first.attachment, 'short', { cryptoRoot: webcrypto }), /43-character/);
});

test('length, duration, MIME and canonical base64 limits reject before reading audio bytes', async () => {
  let reads = 0;
  const blob = { size: VOICE_LIMITS.bytes + 1, type: 'audio/webm', async arrayBuffer() { reads++; throw new Error('Must not allocate'); } };
  await assert.rejects(createPlainVoice({ blob, durationMs: 1 }), /384 KB/);
  await assert.rejects(encryptVoice({ blob, durationMs: 1 }, { cryptoRoot: webcrypto }), /384 KB/);
  assert.equal(reads, 0);
  for (const durationMs of [0, -1, 60001, 1.5, NaN]) await assert.rejects(createPlainVoice({ ...recording(), durationMs }), /60 seconds/);
  await assert.rejects(createPlainVoice({ blob: new Blob(['no'], { type: 'text/html' }), durationMs: 1 }), /Unsupported/);
  await assert.rejects(encryptVoice(recording(), { cryptoRoot: {} }), /Web Crypto/);
  const plain = await createPlainVoice(recording(1));
  for (const data of ['QQ=', 'QQ+', 'QR', 'Q', 'Q'.repeat(600000)]) assert.throws(() => normalizeVoiceAttachment({ ...plain, data }), /Invalid/);
  const encrypted = await encryptVoice(recording(), { cryptoRoot: webcrypto });
  for (const patch of [{ unlockCode: encrypted.unlockCode }, { data: 'plaintext' }, { key: 'key' }]) assert.throws(() => normalizeVoiceAttachment({ ...encrypted.attachment, ...patch }), /extra fields/);
  assert.throws(() => parseVoiceEnvelope(' '.repeat(514001)), /514 KB/);
});

test('local room voice attachments survive backups/reload and old text-only schema remains valid', async () => {
  const store = new Map(), storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const first = workspace({ storage }); first.createRoom({ label: 'Voice room' }); first.sendMessage('Old text history');
  const old = first.exportJson(), encrypted = await encryptVoice(recording(), { cryptoRoot: webcrypto });
  first.sendVoiceMessage(await createPlainVoice(recording()), 'Plain caption'); first.sendVoiceMessage(encrypted.attachment, 'Readable caption');
  const raw = first.exportJson(); assert.equal(raw.includes(encrypted.unlockCode), false); assert.equal(raw.includes('Readable caption'), true);
  const restored = workspace({ storage }); assert.deepEqual(restored.exportData(), first.exportData());
  const imported = workspace(); assert.deepEqual(imported.importData(raw), { roomsAdded: 1, messagesAdded: 3 });
  assert.deepEqual(imported.importData(raw), { roomsAdded: 0, messagesAdded: 0 });
  assert.equal(imported.exportData().messages[2].voice.mode, 'encrypted');
  assert.equal(JSON.stringify(restored.snapshot()).includes(encrypted.unlockCode), false);
  const oldRestore = workspace(); oldRestore.importData(old); assert.equal(oldRestore.exportData().messages[0].text, 'Old text history'); assert.equal('voice' in oldRestore.exportData().messages[0], false);
  assert.equal(store.get(ROOM_WORKSPACE_KEY), raw);
});

test('voice respects membership, local origin, import atomicity and stale-tab conflicts', async () => {
  const attachment = await createPlainVoice(recording());
  const first = workspace({ seedRooms: [{ id: 'projected', label: 'Projection', context: 'social', role: 'owner' }] });
  first.joinRoom(); assert.throws(() => first.sendVoiceMessage(attachment), /own local rooms/);
  const room = first.createRoom({ label: 'Local' }); first.leaveRoom(); assert.throws(() => first.sendVoiceMessage(attachment), /Enter/);
  first.joinRoom(); first.sendVoiceMessage(attachment);
  assert.throws(() => first.sendVoiceMessage(null, 'Invalid attachment'), /supported voice envelope/);
  const forged = first.exportData(); forged.messages[0].roomId = 'projected'; assert.throws(() => first.importData(forged), /local archive room/);
  const observer = first.exportData(); observer.rooms.find(row => row.id === room.id).role = 'observer';
  const restricted = workspace(); restricted.importData(observer); restricted.joinRoom(room.id); assert.throws(() => restricted.sendVoiceMessage(attachment), /read-only/);
  const invalid = first.exportData(); invalid.messages[0].voice.byteLength = VOICE_LIMITS.bytes + 1;
  const before = first.exportJson(); assert.throws(() => first.importData(invalid), /384 KB/); assert.equal(first.exportJson(), before);
  const conflict = first.exportData(); conflict.messages[0].voice.durationMs += 1;
  assert.throws(() => first.importData(conflict), /conflicts/); assert.equal(first.exportJson(), before);
  const saved = new Map(), storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const writer = workspace({ storage }); writer.createRoom({ label: 'Shared browser' }); const stale = workspace({ storage });
  writer.sendVoiceMessage(attachment); assert.throws(() => stale.sendVoiceMessage(attachment), /Another tab/); assert.equal(stale.exportData().messages.length, 0);
  stale.reload(); assert.equal(stale.exportData().messages.length, 1);
});

test('voice uses the existing 2 MB UTF-8 capacity without trimming or partial importing', async () => {
  const first = workspace(); first.createRoom({ label: 'Capacity' }); const attachment = await createPlainVoice(recording(VOICE_LIMITS.bytes));
  for (let i = 0; i < 3; i++) first.sendVoiceMessage(attachment, `Clip ${i}`);
  const before = first.exportJson(); assert.throws(() => first.sendVoiceMessage(attachment), /2 MB backup capacity/); assert.equal(first.exportJson(), before);
  const imported = JSON.parse(before); imported.messages = [{ ...imported.messages[0], id: 'extra-voice' }];
  assert.throws(() => first.importData(imported), /2 MB backup capacity/); assert.equal(first.exportJson(), before);
  const restored = workspace(); restored.importData(before); assert.equal(restored.exportData().messages.length, 3);
});
