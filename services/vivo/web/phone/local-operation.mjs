/**
 * Session-scoped identities for local phone operations.
 *
 * Persisted operation results make a submitted edit idempotent, so a
 * restarted phone session must never reuse the first operation identity from
 * the previous session. The nonce is local-only and carries no authority
 * meaning.
 */
const uniqueId = () => globalThis.crypto?.randomUUID?.()
  || `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class LocalOperationIdFactory {
  constructor(prefix = 'local-operation') {
    if (typeof prefix !== 'string' || !prefix || prefix.length > 64 || /[\u0000-\u001f\u007f:]/.test(prefix)) {
      throw new TypeError('Operation prefix must be a bounded identity');
    }
    this.prefix = prefix;
    this.nonce = uniqueId();
    this.counter = 0;
  }
  next(scope = 'operation') {
    const boundedScope = String(scope || 'operation').slice(0, 120);
    if (!boundedScope || /[\u0000-\u001f\u007f]/.test(boundedScope)) throw new TypeError('Operation scope must be bounded');
    this.counter++;
    return `${this.prefix}:${this.nonce}:${boundedScope}:${this.counter}`;
  }
}
