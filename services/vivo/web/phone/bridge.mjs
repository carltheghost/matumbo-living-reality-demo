const ID = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

/** Origin-limited native message adapter. No fallback uploads or hidden grants. */
export class AndroidPhoneBridge extends EventTarget {
  constructor(scope = globalThis) {
    super(); this.scope = scope; this.pending = new Map(); this.tools = []; this.agentController = null;
    this.native = scope.VivoPhone && typeof scope.VivoPhone.postMessage === 'function' ? scope.VivoPhone : null;
    if (this.native) {
      this.bindNative();
      this.available = true;
      this.native.postMessage(JSON.stringify({ id: ID(), kind: 'hello' }));
    } else this.available = false;
    scope.addEventListener?.('vivo:phone-ready', () => this.attach());
  }
  attach() {
    if (this.native || !this.scope.VivoPhone || typeof this.scope.VivoPhone.postMessage !== 'function') return;
    this.native = this.scope.VivoPhone; this.available = true;
    this.bindNative();
    this.native.postMessage(JSON.stringify({ id: ID(), kind: 'hello' }));
    this.dispatchEvent(new Event('ready'));
  }
  bindNative() {
    const receive = event => this.receive(event.data);
    if (typeof this.native.addEventListener === 'function') this.native.addEventListener('message', receive);
    else this.native.onmessage = receive;
  }
  reply(id, ok, value) {
    if (!this.native) return false;
    this.native.postMessage(JSON.stringify({ kind: 'async-result', id, ok, ...(ok ? { value } : { error: String(value?.message || value || 'Native request failed') }) }));
    return true;
  }
  receive(raw) {
    let message; try { message = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.kind === 'tools' && Array.isArray(message.tools)) this.tools = message.tools.filter(item => typeof item?.name === 'string');
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id); this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.value); else pending.reject(new Error(message.error || 'Android capability request failed'));
    }
    this.dispatchEvent(new CustomEvent('message', { detail: message }));
  }
  request(kind, value = {}) {
    this.attach(); if (!this.native) return Promise.reject(new Error('Android Companion is not connected'));
    const id = ID();
    return new Promise((resolve, reject) => {
      const timeout = kind === 'tool.invoke' ? 120000 : 15000;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Android Companion response timed out')); }, timeout);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.native.postMessage(JSON.stringify({ id, kind, ...value }));
    });
  }
  listTools() { return this.request('tools.list'); }
  invoke(name, args = {}) { return this.request('tool.invoke', { name, args }); }
  setAgentController(controller) { this.agentController = controller || null; return this; }
  async invokeLocal(name, args = {}, context = {}) {
    if (!this.agentController) throw new Error('Local agent control is not available');
    // World tools are accepted only through the registered session controller.
    // In particular, never fall back to engine.translate(args.agentId/axis),
    // which would bypass full-D identity, CAS and operation idempotency.
    return this.agentController.invokeTool(context.session, name, args);
  }
}
