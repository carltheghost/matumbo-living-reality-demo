/** Portable local audio envelopes. Captions/room metadata are outside encryption. */
export const VOICE_LIMITS = Object.freeze({ bytes: 384000, durationMs: 60000 });
export const VOICE_MIME_TYPES = Object.freeze(['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2']);
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function metadata(input) {
  if (!record(input) || input.schemaVersion !== 1 || input.kind !== 'voice' || !['plain', 'encrypted'].includes(input.mode)) throw new TypeError('Choose a supported voice envelope.');
  if (!VOICE_MIME_TYPES.includes(input.mimeType)) throw new TypeError('Unsupported voice audio type.');
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > VOICE_LIMITS.durationMs) throw new RangeError('Voice clips must be between 1 ms and 60 seconds.');
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > VOICE_LIMITS.bytes) throw new RangeError('Voice clips must be between 1 byte and 384 KB.');
  return { schemaVersion: 1, kind: 'voice', mode: input.mode, mimeType: input.mimeType, durationMs: input.durationMs, byteLength: input.byteLength };
}
// Check decoded length and canonical padding bits before allocating binary data.
function encoded(value, bytes, label) {
  if (typeof value !== 'string' || value.length !== Math.ceil(bytes * 8 / 6) || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError(`Invalid ${label}.`);
  const remainder = value.length % 4, last = alphabet.indexOf(value.at(-1));
  if (remainder === 1 || (remainder === 2 && (last & 15)) || (remainder === 3 && (last & 3))) throw new TypeError(`Invalid ${label}.`);
  return value;
}
function encode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(value) { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0)); }
export function normalizeVoiceAttachment(input) {
  const result = metadata(input);
  const allowed = new Set([...Object.keys(result), ...(result.mode === 'plain' ? ['data'] : ['algorithm', 'iv', 'ciphertext'])]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new TypeError('Voice envelopes cannot contain extra fields, plaintext, or unlock codes.');
  if (result.mode === 'plain') return { ...result, data: encoded(input.data, result.byteLength, 'voice data') };
  if (input.algorithm !== 'AES-GCM-256') throw new TypeError('Unsupported voice encryption.');
  return { ...result, algorithm: 'AES-GCM-256', iv: encoded(input.iv, 12, 'voice nonce'), ciphertext: encoded(input.ciphertext, result.byteLength + 16, 'encrypted voice data') };
}
async function audioBytes({ blob, mimeType = blob?.type, durationMs }, mode) {
  const info = metadata({ schemaVersion: 1, kind: 'voice', mode, mimeType, durationMs, byteLength: blob?.size });
  if (!blob || typeof blob.arrayBuffer !== 'function' || blob.type !== mimeType) throw new TypeError('A matching audio recording is required.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength !== info.byteLength) throw new TypeError('Audio size changed while reading.');
  return { info, bytes };
}
function cryptoApi(cryptoRoot) {
  if (!cryptoRoot?.subtle || !cryptoRoot?.getRandomValues) throw new Error('Encrypted voice requires Web Crypto in a secure browser context.');
  return cryptoRoot;
}
// Fixed-order, authenticated metadata prevents changing type, length or duration.
function additionalData(info) { return new TextEncoder().encode(JSON.stringify([info.schemaVersion, info.kind, info.mode, info.mimeType, info.durationMs, info.byteLength, 'AES-GCM-256'])); }
export async function createPlainVoice(recording) {
  const { info, bytes } = await audioBytes(recording, 'plain');
  try { return { ...info, data: encode(bytes) }; } finally { bytes.fill(0); }
}
export async function encryptVoice(recording, { cryptoRoot = globalThis.crypto } = {}) {
  const crypto = cryptoApi(cryptoRoot), { info, bytes } = await audioBytes(recording, 'encrypted');
  const rawKey = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData(info), tagLength: 128 }, key, bytes));
    return { attachment: { ...info, algorithm: 'AES-GCM-256', iv: encode(iv), ciphertext: encode(ciphertext) }, unlockCode: encode(rawKey) };
  } finally { rawKey.fill(0); bytes.fill(0); }
}
export function plainVoiceBlob(input) {
  const attachment = normalizeVoiceAttachment(input);
  if (attachment.mode !== 'plain') throw new TypeError('Unlock this encrypted voice explicitly before playback.');
  return new Blob([decode(attachment.data)], { type: attachment.mimeType });
}
export async function decryptVoice(input, unlockCode, { cryptoRoot = globalThis.crypto } = {}) {
  const attachment = normalizeVoiceAttachment(input), crypto = cryptoApi(cryptoRoot);
  if (attachment.mode !== 'encrypted') throw new TypeError('This voice clip is already readable.');
  const rawKey = decode(encoded(unlockCode, 32, '43-character unlock code'));
  try {
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(attachment.iv), additionalData: additionalData(attachment), tagLength: 128 }, key, decode(attachment.ciphertext));
    if (bytes.byteLength !== attachment.byteLength) throw new Error('Voice size does not match.');
    const blob = new Blob([bytes], { type: attachment.mimeType }); new Uint8Array(bytes).fill(0); return blob;
  } catch { throw new Error('Cannot unlock this voice: the code is wrong or the envelope was changed.'); }
  finally { rawKey.fill(0); }
}
/** Keep browser cryptographic capabilities in the domain, outside render owners. */
export function createVoiceEncryptionAdapter(windowRoot = globalThis) {
  const cryptoRoot = windowRoot?.crypto ?? globalThis.crypto;
  return Object.freeze({
    encrypt: recording => encryptVoice(recording, { cryptoRoot }),
    decrypt: (attachment, unlockCode) => decryptVoice(attachment, unlockCode, { cryptoRoot }),
  });
}
export function serializeVoiceAttachment(input) { return JSON.stringify(normalizeVoiceAttachment(input)); }
export function parseVoiceEnvelope(json) {
  if (typeof json !== 'string' || json.length > 514000) throw new RangeError('Choose a voice envelope smaller than 514 KB.');
  return normalizeVoiceAttachment(JSON.parse(json));
}
export function voiceFileExtension(mimeType) { return mimeType.startsWith('audio/ogg') ? 'ogg' : mimeType.startsWith('audio/mp4') ? 'm4a' : 'webm'; }
