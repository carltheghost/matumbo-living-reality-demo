import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomSpaces, summarizeRooms } from '../src/render/room-spaces.js';
import { createLivingRealityProjection } from '../src/core/demo-projection.js';
import { createRealitySurfaceDocument } from '../src/render/reality-surface-document.js';
import { ROOM_WORKSPACE_KEY } from '../src/domains/room-workspace.js';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import { webcrypto } from 'node:crypto';
import { decryptVoice, encryptVoice } from '../src/domains/voice-message.js';
import { claimVoiceActivity } from '../src/render/voice-session.js?v=20261005-voice';

function element(tag = 'div') {
  const listeners = new Map(), attributes = new Map(); let text = '';
  return {
    tagName: tag.toUpperCase(), children: [], dataset: {}, style: {}, value: '', files: [], parentNode: null, hidden: false, disabled: false,
    get parentElement() { return this.parentNode; }, get isConnected() { let root = this; while (root.parentNode) root = root.parentNode; return root.tagName === 'DOCUMENT'; },
    get textContent() { return text + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { text = String(value); this.children = []; },
    setAttribute(key, value) { attributes.set(key, String(value)); }, getAttribute(key) { return attributes.get(key) ?? null; }, hasAttribute(key) { return attributes.has(key); }, removeAttribute(key) { attributes.delete(key); if (key === 'src') this.src = ''; },
    appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child; }, append(...children) { children.forEach(child => this.appendChild(child)); },
    insertBefore(child, before) { child.remove(); const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); child.parentNode = this; return child; },
    replaceChildren(...children) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; text = ''; this.append(...children); },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; },
    classList: { toggle() {} }, addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); }, removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    async fire(name, extra = {}) { if (this.disabled) return; return Promise.all([...(listeners.get(name) || [])].map(listener => listener({ preventDefault() {}, target: this, ...extra }))); }, click() { return this.fire('click'); }, focus() {}, play() { this.playCalls = (this.playCalls || 0) + 1; this.paused = false; return this.fire('play'); }, pause() { this.paused = true; this.fire('pause'); }, load() {},
  };
}
function walk(root) { return [root, ...root.children.flatMap(walk)]; }
function label(root, name) { const item = walk(root).find(item => item.getAttribute('aria-label') === name); assert.ok(item, `Missing ${name}`); return item; }
function button(root, name) { const item = walk(root).find(item => item.tagName === 'BUTTON' && item.textContent === name); assert.ok(item, `Missing ${name}`); return item; }
function formOf(input) { let current = input; while (current && current.tagName !== 'FORM') current = current.parentNode; assert.ok(current); return current; }
function setup({ storage, projection = createLivingRealityProjection().world, three = null, parent = null, windowRoot = {} } = {}) {
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
  const api = createRoomSpaces({ documentRoot: doc, windowRoot, storage, projection, three, parent });
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

function voiceBrowser() {
  let now = 0, count = 0, permissionCalls = 0, stoppedTracks = 0;
  const urls = new Map(), revoked = new Set(), timers = new Map();
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(stream, options) { this.mimeType = options.mimeType; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['local audio bytes'], { type: this.mimeType }) }); this.onstop?.(); }
  }
  const windowRoot = {
    crypto: webcrypto, Blob, MediaRecorder: Recorder, isSecureContext: true,
    performance: { now: () => now },
    navigator: { mediaDevices: { async getUserMedia() { permissionCalls++; const track = { readyState: 'live', stop() { stoppedTracks++; }, addEventListener() {}, removeEventListener() {} }; return { getTracks: () => [track], getAudioTracks: () => [track] }; } } },
    URL: { createObjectURL(blob) { const url = `blob:voice-${++count}`; urls.set(url, blob); return url; }, revokeObjectURL(url) { revoked.add(url); urls.delete(url); } },
    setTimeout(callback) { const id = ++count; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
  };
  return { windowRoot, urls, revoked, advance(ms = 1250) { now += ms; }, get permissionCalls() { return permissionCalls; }, get stoppedTracks() { return stoppedTracks; } };
}

async function recordClip(context, browser) { await button(context.panel, 'Record voice').click(); browser.advance(); await button(context.panel, 'Stop recording').click(); }
async function selectVoicePrivacy(context, value = 'plain') { const mode = label(context.panel, 'Voice privacy'); mode.value = value; await mode.fire('change'); }
class TestFile extends Blob { constructor(parts, name, options) { super(parts, options); this.name = name; } }

test('voice recording is explicit, previews without autoplay, saves into original local history and downloads bytes', async () => {
  const browser = voiceBrowser(), context = setup({ windowRoot: browser.windowRoot });
  assert.equal(browser.permissionCalls, 0); assert.equal(button(context.panel, 'Record voice').disabled, true);
  await createLocalRoom(context); await selectVoicePrivacy(context); await recordClip(context, browser);
  assert.equal(browser.permissionCalls, 1); assert.ok(browser.stoppedTracks > 0);
  const preview = label(context.panel, 'Voice recording preview'); assert.ok(preview.src); assert.notEqual(preview.autoplay, true);
  assert.equal(context.api.exportConversations().messages.length, 0);
  label(context.panel, 'Message this local room').value = 'Optional caption';
  await button(context.panel, 'Save local voice').click();
  const saved = context.api.exportConversations().messages[0]; assert.equal(saved.text, 'Optional caption'); assert.equal(saved.voice.mode, 'plain'); assert.equal(preview.src, '');
  await button(context.panel, 'Load voice playback').click(); const audio = label(context.panel, 'Voice message playback'); assert.ok(audio.src); assert.notEqual(audio.autoplay, true);
  await button(context.panel, 'Play voice').click(); const source = audio.src, release = claimVoiceActivity('test-new-microphone', () => {}, browser.windowRoot);
  assert.equal(audio.src, ''); assert.ok(browser.revoked.has(source)); release();
  await button(context.panel, 'Download voice clip').click();
  assert.ok([...browser.urls.values()].some(blob => blob.type === 'audio/webm;codecs=opus'));
  context.api.destroy(); assert.equal(browser.urls.size, 0);
});

test('explicit preview and voice buttons play and stop the same native audio through original surface handlers', async () => {
  const browser = voiceBrowser(), context = setup({ windowRoot: browser.windowRoot }); await createLocalRoom(context); await selectVoicePrivacy(context); await recordClip(context, browser); context.api.open();
  const preview = label(context.panel, 'Voice recording preview'); assert.equal(preview.playCalls || 0, 0); assert.equal(preview.controls, true);
  const surface = createRealitySurfaceDocument({ element: context.panel, feature: { id: 'rooms' } });
  const previewAction = surface.read().find(item => item.text === 'Play preview'); assert.ok(previewAction?.actionId);
  assert.equal(surface.activate(previewAction.actionId), true); await Promise.resolve(); await Promise.resolve();
  assert.equal(preview.playCalls, 1); assert.equal(preview.paused, false);
  await button(context.panel, 'Stop preview').click(); assert.equal(preview.paused, true); assert.equal(preview.currentTime, 0); assert.ok(preview.src, 'Stop preserves the preview source');
  await button(context.panel, 'Save local voice').click();
  const audio = label(context.panel, 'Voice message playback'); assert.equal(audio.playCalls || 0, 0); assert.equal(audio.controls, true);
  const voiceAction = surface.read().find(item => item.text === 'Play voice'); assert.ok(voiceAction?.actionId);
  assert.equal(surface.activate(voiceAction.actionId), true); await Promise.resolve(); await Promise.resolve();
  assert.equal(audio.playCalls, 1); assert.equal(audio.paused, false); assert.ok(audio.src, 'Play loads the saved plain clip directly');
  await button(context.panel, 'Stop voice').click(); assert.equal(audio.paused, true); assert.equal(audio.currentTime, 0);
  surface.dispose(); context.api.destroy(); assert.equal(browser.urls.size, 0);
});

test('explicit playback surfaces browser permission and codec failures without auto-retrying', async () => {
  const browser = voiceBrowser(), context = setup({ windowRoot: browser.windowRoot }); await createLocalRoom(context); await selectVoicePrivacy(context); await recordClip(context, browser);
  const preview = label(context.panel, 'Voice recording preview'); let attempts = 0;
  preview.play = () => { attempts++; return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })); };
  await button(context.panel, 'Play preview').click(); assert.match(context.panel.textContent, /Playback was blocked/); assert.equal(attempts, 1); assert.equal(preview.paused, true);
  await button(context.panel, 'Save local voice').click(); const audio = label(context.panel, 'Voice message playback');
  audio.play = () => { attempts++; return Promise.reject(Object.assign(new Error('codec'), { name: 'NotSupportedError' })); };
  await button(context.panel, 'Play voice').click(); assert.match(context.panel.textContent, /cannot play this audio format/); assert.equal(attempts, 2); assert.equal(audio.paused, true);
  audio.error = { code: 3 }; await audio.fire('error'); assert.match(context.panel.textContent, /Audio playback failed/); context.api.destroy();
});

test('pending playback is stopped before another voice activity and late settlement cannot replace stop status', async () => {
  const browser = voiceBrowser(), context = setup({ windowRoot: browser.windowRoot }); await createLocalRoom(context); await selectVoicePrivacy(context); await recordClip(context, browser);
  const preview = label(context.panel, 'Voice recording preview'); let settle;
  preview.play = () => new Promise(resolve => { settle = resolve; });
  const playing = button(context.panel, 'Play preview').click();
  const source = preview.src, release = claimVoiceActivity('pending-playback-test', () => {}, browser.windowRoot);
  assert.equal(preview.src, ''); assert.ok(browser.revoked.has(source)); assert.equal(preview.paused, true);
  settle(); await playing; assert.match(context.panel.textContent, /preview stopped because another voice activity/); release();
  await button(context.panel, 'Save local voice').click(); const audio = label(context.panel, 'Voice message playback');
  audio.play = () => new Promise(resolve => { settle = resolve; });
  const savedPlayback = button(context.panel, 'Play voice').click(); await button(context.panel, 'Stop voice').click(); settle(); await savedPlayback;
  assert.equal(audio.paused, true); assert.match(context.panel.textContent, /Voice playback stopped/); context.api.destroy();
});

test('encrypted voice requires keeping code separately, persists ciphertext only, unlocks explicitly and locks on room change', async () => {
  const browser = voiceBrowser(), context = setup({ windowRoot: browser.windowRoot }); await createLocalRoom(context); await recordClip(context, browser);
  const mode = label(context.panel, 'Voice privacy'); assert.equal(mode.value, 'encrypted');
  assert.equal(button(context.panel, 'Save local voice').disabled, true);
  await button(context.panel, 'Encrypt voice & show unlock code').click();
  const code = label(context.panel, 'Keep this unlock code separately').value; assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(button(context.panel, 'Save local voice').disabled, true); assert.equal(JSON.stringify(context.api.getSnapshot()).includes(code), false);
  const retained = label(context.panel, 'I saved the unlock code separately'); retained.checked = true; await retained.fire('change');
  await button(context.panel, 'Save local voice').click();
  const exported = JSON.stringify(context.api.exportConversations()); assert.equal(exported.includes(code), false); assert.equal(exported.includes('local audio bytes'), false); assert.equal(label(context.panel, 'Keep this unlock code separately').value, '');
  const voice = context.api.exportConversations().messages[0].voice; assert.equal(voice.mode, 'encrypted'); assert.equal(await (await decryptVoice(voice, code, { cryptoRoot: webcrypto })).text(), 'local audio bytes');
  const audio = label(context.panel, 'Unlocked voice playback'); assert.equal(!!audio.src, false);
  assert.equal(button(context.panel, 'Play voice').disabled, true); assert.equal(audio.playCalls || 0, 0);
  const input = label(context.panel, 'Voice unlock code'); input.value = 'A'.repeat(43); await button(context.panel, 'Unlock voice').click(); assert.match(context.panel.textContent, /wrong or.*changed/); assert.equal(!!audio.src, false);
  input.value = code; await button(context.panel, 'Unlock voice').click(); assert.ok(audio.src); assert.equal(input.value, ''); assert.notEqual(audio.autoplay, true);
  assert.equal(audio.playCalls || 0, 0); assert.equal(button(context.panel, 'Play voice').disabled, false);
  await button(context.panel, 'Play voice').click(); assert.equal(audio.playCalls, 1); await button(context.panel, 'Stop voice').click(); assert.equal(audio.paused, true);
  const url = audio.src; context.api.selectRoom('room:reality'); assert.ok(browser.revoked.has(url)); assert.equal(audio.src, ''); context.api.destroy();
});

test('encrypted envelope download can be reimported without a microphone or code in saved data', async () => {
  const browser = voiceBrowser(), source = await encryptVoice({ blob: new Blob(['portable'], { type: 'audio/webm' }), durationMs: 1000 }, { cryptoRoot: webcrypto });
  const context = setup({ windowRoot: { crypto: webcrypto, URL: browser.windowRoot.URL } }); await createLocalRoom(context);
  const input = label(context.panel, 'Import encrypted voice envelope'), json = JSON.stringify(source.attachment); input.files = [{ size: json.length, text: async () => json }]; await input.fire('change');
  assert.equal(button(context.panel, 'Save local voice').disabled, false); await button(context.panel, 'Save local voice').click();
  assert.deepEqual(context.api.exportConversations().messages[0].voice, source.attachment);
  await button(context.panel, 'Share / download encrypted envelope').click(); const file = [...browser.urls.values()].find(blob => blob.type === 'application/json'); assert.deepEqual(JSON.parse(await file.text()), source.attachment);
  assert.equal((await file.text()).includes(source.unlockCode), false); context.api.destroy(); assert.equal(browser.urls.size, 0);
});

test('saved encrypted room voice shares only ciphertext and never implies recipient delivery', async () => {
  const browser = voiceBrowser(), context = setup({ windowRoot: browser.windowRoot }); await createLocalRoom(context); await recordClip(context, browser);
  await button(context.panel, 'Encrypt voice & show unlock code').click();
  const code = label(context.panel, 'Keep this unlock code separately').value, retained = label(context.panel, 'I saved the unlock code separately'); retained.checked = true; await retained.fire('change');
  await button(context.panel, 'Save local voice').click();
  const shared = [];
  browser.windowRoot.File = TestFile;
  browser.windowRoot.navigator.canShare = ({ files }) => files.length === 1;
  browser.windowRoot.navigator.share = async payload => { shared.push(payload); };
  await button(context.panel, 'Share / download encrypted envelope').click();
  assert.equal(shared.length, 1); assert.equal(shared[0].files[0].name, 'matumbo-encrypted-voice.json');
  const serialized = await shared[0].files[0].text(), envelope = JSON.parse(serialized);
  assert.equal(envelope.mode, 'encrypted'); assert.equal(serialized.includes(code), false); assert.equal(serialized.includes('local audio bytes'), false);
  assert.match(shared[0].text, /send the unlock code separately/i);
  assert.match(label(context.panel, 'Unlocked voice playback').parentNode.textContent, /sharing does not confirm delivery/i);
  assert.equal(context.api.exportConversations().messages.length, 1); context.api.destroy();
});

test('canceling the device share menu keeps the saved encrypted message and does not download another copy', async () => {
  const browser = voiceBrowser(), context = setup({ windowRoot: browser.windowRoot }); await createLocalRoom(context); await recordClip(context, browser);
  await button(context.panel, 'Encrypt voice & show unlock code').click();
  label(context.panel, 'I saved the unlock code separately').checked = true;
  await label(context.panel, 'I saved the unlock code separately').fire('change'); await button(context.panel, 'Save local voice').click();
  const before = [...browser.urls.values()].filter(blob => blob.type === 'application/json').length;
  browser.windowRoot.File = TestFile; browser.windowRoot.navigator.canShare = () => true;
  browser.windowRoot.navigator.share = async () => { throw Object.assign(new Error('dismissed'), { name: 'AbortError' }); };
  await button(context.panel, 'Share / download encrypted envelope').click();
  const after = [...browser.urls.values()].filter(blob => blob.type === 'application/json').length;
  assert.equal(after, before); assert.match(label(context.panel, 'Unlocked voice playback').parentNode.textContent, /Sharing canceled/);
  assert.equal(context.api.exportConversations().messages.length, 1); context.api.destroy();
});

test('switching rooms or cancelling a recording releases tracks and does not save a voice message', async () => {
  const browser = voiceBrowser(), context = setup({ windowRoot: browser.windowRoot }); await createLocalRoom(context);
  await button(context.panel, 'Record voice').click(); await button(context.panel, 'Cancel voice').click(); assert.ok(browser.stoppedTracks > 0); assert.equal(context.api.exportConversations().messages.length, 0);
  await button(context.panel, 'Record voice').click(); browser.advance(); context.api.selectRoom('room:reality'); await Promise.resolve();
  assert.equal(context.api.exportConversations().messages.length, 0); assert.equal(browser.urls.size, 0); assert.equal(button(context.panel, 'Save local voice').disabled, true); context.api.destroy();
});

test('closing Rooms and hiding the page revoke microphone drafts and unlocked playback', async () => {
  const browser = voiceBrowser(), context = setup({ windowRoot: browser.windowRoot }); await createLocalRoom(context); await selectVoicePrivacy(context);
  await button(context.panel, 'Record voice').click(); context.api.close();
  assert.ok(browser.stoppedTracks > 0); assert.equal(context.api.exportConversations().messages.length, 0);
  context.api.open(); await recordClip(context, browser); await button(context.panel, 'Save local voice').click();
  await button(context.panel, 'Load voice playback').click(); const audio = label(context.panel, 'Voice message playback'), url = audio.src;
  context.doc.hidden = true; await context.doc.fire('visibilitychange');
  assert.equal(audio.src, ''); assert.ok(browser.revoked.has(url)); assert.equal(context.api.exportConversations().messages.length, 1); context.api.destroy();
});

test('direct dock-style panel hiding cancels capture through the owner visibility observer', async () => {
  const browser = voiceBrowser(), observers = [];
  browser.windowRoot.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.targets = []; }
  };
  browser.windowRoot.getComputedStyle = item => ({ display: item.style.display || 'block', visibility: item.style.visibility || 'visible' });
  const context = setup({ windowRoot: browser.windowRoot }); await createLocalRoom(context); context.api.open();
  const notify = () => { for (const observer of observers) if (observer.targets.length) observer.callback([{ type: 'attributes', target: context.panel, attributeName: 'hidden' }]); };
  notify(); await button(context.panel, 'Record voice').click(); assert.equal(context.api.getSnapshot().conversationWorkspace.recordingStatus, 'recording');
  context.panel.hidden = true; notify();
  assert.ok(browser.stoppedTracks > 0); assert.equal(context.api.getSnapshot().conversationWorkspace.recordingStatus, 'stopped'); assert.equal(context.api.exportConversations().messages.length, 0);
  assert.equal(button(context.panel, 'Save local voice').disabled, true); context.api.destroy(); assert.ok(observers.every(observer => observer.targets.length === 0));
});

test('Lock pressed during decryption prevents a late result from exposing audio', async () => {
  const browser = voiceBrowser(), encrypted = await encryptVoice({ blob: new Blob(['locked race'], { type: 'audio/webm' }), durationMs: 1000 }, { cryptoRoot: webcrypto });
  let beginDecrypt, finishDecrypt;
  const entered = new Promise(resolve => { beginDecrypt = resolve; });
  browser.windowRoot.crypto = { getRandomValues: array => webcrypto.getRandomValues(array), subtle: {
    importKey: (...args) => webcrypto.subtle.importKey(...args),
    decrypt: (...args) => new Promise((resolve, reject) => { finishDecrypt = () => webcrypto.subtle.decrypt(...args).then(resolve, reject); beginDecrypt(); }),
  } };
  const context = setup({ windowRoot: browser.windowRoot }); await createLocalRoom(context);
  const input = label(context.panel, 'Import encrypted voice envelope'), json = JSON.stringify(encrypted.attachment); input.files = [{ size: json.length, text: async () => json }]; await input.fire('change'); await button(context.panel, 'Save local voice').click();
  label(context.panel, 'Voice unlock code').value = encrypted.unlockCode;
  const unlocking = button(context.panel, 'Unlock voice').click(); await entered;
  await button(context.panel, 'Lock voice').click(); await finishDecrypt(); await unlocking;
  assert.equal(label(context.panel, 'Unlocked voice playback').src, ''); assert.equal(browser.urls.size, 0); assert.match(context.panel.textContent, /Encrypted audio · locked/); context.api.destroy();
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
