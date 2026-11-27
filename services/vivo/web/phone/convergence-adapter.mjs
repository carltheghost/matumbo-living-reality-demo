/** Additive composition over an EXISTING Vivo registry and economy owner.
 * No provider login, auto-grants, economic mutations, second world, or UI mount.
 * Supplied transports are trusted host ports, not a sandbox for arbitrary plugins.
 */
const EXTRAS = Object.freeze({
  'memory.search': 'memory.read',
  'memory.read': 'memory.read',
  'neural.predict': 'neural.lab',
  'contracts.inspect': 'contracts.read',
});
const failure = code => Object.assign(new Error(code), {code});

export class VivoConvergenceAdapter {
  #registry; #economy; #transport; #timeout; #sessions = new Map(); #serial = 0;
  constructor({registry, economy = null, transport = null, timeoutMs = 5000}) {
    if (!registry || typeof registry.listFor !== 'function' || typeof registry.invokeFor !== 'function' || typeof registry.agentController?.assertActive !== 'function') throw failure('EXISTING_REGISTRY_REQUIRED');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw failure('INVALID_TIMEOUT');
    this.#registry = registry; this.#economy = economy; this.#transport = transport; this.#timeout = timeoutMs;
  }
  attach(nativeSession, capabilities = []) {
    // The main host creates/approves this attachment; model output cannot grant it.
    this.#registry.agentController?.assertActive(nativeSession);
    if (!Array.isArray(capabilities) || capabilities.some(x => !Object.values(EXTRAS).includes(x))) throw failure('UNAVAILABLE_CAPABILITY');
    const ref = Object.freeze({id: ++this.#serial});
    this.#sessions.set(ref, {nativeSession, capabilities: new Set(capabilities), stopped: false, flights: new Set()});
    return ref;
  }
  #active(ref) {
    const s = this.#sessions.get(ref);
    if (!s || s.stopped) throw failure('SESSION_STOPPED_OR_UNKNOWN');
    this.#registry.agentController?.assertActive(s.nativeSession);
    return s;
  }
  list(ref) {
    const s = this.#active(ref), native = this.#registry.listFor(s.nativeSession).map(t => t.name);
    const extras = Object.entries(EXTRAS).filter(([name, cap]) => s.capabilities.has(cap) &&
      (name === 'contracts.inspect' ? this.#economy !== null : this.#transport !== null)).map(([name]) => name);
    return [...native, ...extras];
  }
  async invoke(ref, name, args = {}) {
    const s = this.#active(ref);
    if (!this.list(ref).includes(name)) throw failure('TOOL_NOT_GRANTED');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw failure('INVALID_ARGUMENTS');
    const safeArgs = structuredClone(args);
    if (JSON.stringify(safeArgs).length > 200000) throw failure('PAYLOAD_TOO_LARGE');
    if (name === 'contracts.inspect') {
      if (Object.keys(safeArgs).length) throw failure('INVALID_ARGUMENTS');
      // Read the existing canonical owner. Do not instantiate another ledger.
      const verification = this.#economy.verify();
      if (verification?.ok !== true || verification.simulation !== true) throw failure('ECONOMY_VERIFICATION_FAILED');
      const contracts = structuredClone(this.#economy.contracts());
      if (contracts.some(c => c.simulation !== true)) throw failure('NON_SIMULATED_CONTRACT');
      this.#active(ref);
      return {schema: 'vivo.convergence.contract-inspection/1', contracts, verification,
        simulation: true, readOnly: true, authority: 'existing canonical simulated economy'};
    }
    const controller = new AbortController();
    let timer, abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(failure('CANCELLED_OR_DEADLINE'));
      controller.signal.addEventListener('abort', abort, {once: true});
      timer = setTimeout(() => controller.abort(), this.#timeout);
    });
    s.flights.add(controller);
    try {
      const work = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw failure('CANCELLED_OR_DEADLINE');
        return Object.hasOwn(EXTRAS, name)
          ? this.#transport.invoke(name, safeArgs, {signal: controller.signal})
          : this.#registry.invokeFor(s.nativeSession, name, safeArgs);
      });
      const result = await Promise.race([work, cancelled]);
      this.#active(ref); // Ignore late/stopped-session responses; never automatically retry.
      return structuredClone(result);
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', abort); s.flights.delete(controller);
    }
  }
  async stop(ref) {
    const s = this.#sessions.get(ref);
    if (!s || s.stopped) return;
    s.stopped = true;
    for (const flight of s.flights) flight.abort();
    await this.#registry.stopAgent(s.nativeSession, 'convergence-stop');
  }
}
