// Deterministic PRNG (mulberry32) with serializable state.
// All randomness in the ledger derives from this — same seed + same ops = same ledger.
export function createPrng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return {
    next() {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    nextInt(max) {
      return Math.floor(this.next() * max);
    },
    hex(n) {
      let out = "";
      for (let i = 0; i < n; i++) out += "0123456789abcdef"[this.nextInt(16)];
      return out;
    },
    getState() { return s | 0; },
    setState(v) { s = v | 0; },
  };
}
