/** Node-side verifier for Python material checkpoints/proofs; not authorization. */
import {createHash} from 'node:crypto';
export const MATERIAL_HASH_CODEC = 'vivo.f64-json-sha256/1';

function encoded(root) {
  const seen = new Set();
  let nodes = 0, characters = 0;
  const encode = (value, depth = 0) => {
    if (depth > 32 || ++nodes > 10000) throw new Error('HASH_BUDGET');
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error('HASH_NUMBER');
      const bytes = Buffer.alloc(8);
      bytes.writeDoubleLE(value === 0 ? 0 : value);
      return ['number', bytes.toString('hex')];
    }
    if (value === null) return ['null'];
    if (typeof value === 'boolean') return ['boolean', value];
    if (typeof value === 'string') {
      characters += value.length;
      if (characters > 16*1024*1024) throw new Error('HASH_BUDGET');
      return ['string', value];
    }
    if (!(Array.isArray(value) || value && Object.getPrototypeOf(value) === Object.prototype)) throw new Error('HASH_TYPE');
    if (seen.has(value)) throw new Error('HASH_CYCLE');
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        if (value.length > 10000) throw new Error('HASH_BUDGET');
        if (Object.keys(value).length !== value.length || !Array.from({length:value.length}, (_,i) => Object.hasOwn(value,i)).every(Boolean)) throw new Error('HASH_TYPE');
        return ['array', value.map(v => encode(v, depth+1))];
      }
      const keys=Object.keys(value).sort();
      if (keys.some(k => k.length > 128 || /[^\x00-\x7f]/.test(k))) throw new Error('HASH_KEY');
      return ['object', keys.map(k => [k, encode(value[k], depth+1)])];
    } finally { seen.delete(value); }
  };
  return encode(root);
}
function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4,'0'));
}
export function materialDigest(value) {
  return createHash('sha256').update(asciiJson(encoded(value)), 'utf8').digest('hex');
}
export function verifyMaterialDigest(checkpoint) {
  if (!checkpoint || checkpoint.schema !== 'vivo.material.phase/1'
      || checkpoint.hashCodec !== MATERIAL_HASH_CODEC) throw new Error('MATERIAL_CODEC');
  const {digest, ...body} = checkpoint;
  if (typeof digest !== 'string' || digest !== materialDigest(body)) throw new Error('MATERIAL_DIGEST');
  return true;
}
