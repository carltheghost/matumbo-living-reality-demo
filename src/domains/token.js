// TUMBO-SIM Ledger Core — the demo's canonical token ledger (part 01: token ledger core).
// Ported from the TUMBO-SIM ledger prototype into src/domains.
//
// SIMULATION ONLY. No real money, custody, signing, wallets, or chains.
// All value is local demo points. Deterministic: seeded PRNG + logical clock.
//
// Shared contract: integer fluff (1 TUMBO-SIM = 1000 fluff); assets TUMBO (native)
// and sMIMAS (synthetic) with supply from the single ASSETS config below — never
// quoted in UI text; accounts u:<name>, b:<name>, sys:*; every mutation carries a
// client-supplied idempotency key; replays return the original EchoProof receipt;
// every committed journal balances to exactly 0 per asset; verifyInvariants()
// runs on load.
import { createPrng } from "./token-prng.js";
import { sha256Hex, canonical } from "./token-sha256.js";

export const FLUFF_PER_TUMBO = 1000;
export const ASSETS = Object.freeze({
  TUMBO:  { supplyFluff: 420_000_000_000 * FLUFF_PER_TUMBO, label: "TUMBO-SIM" },
  sMIMAS: { supplyFluff: 21_000_000 * FLUFF_PER_TUMBO,      label: "sMIMAS (synthetic)" },
});
export const REVERSE_WINDOW_TICKS = 1000;
export const VOID_TITHE_BPS = 10;            // Hunger Meter sink on market ops
export const GATE_ARBITER = "gate:arbiter:v1";
export const GATE_SYSTEM  = "gate:system:v1";

export const ACTIONS = Object.freeze([
  "send","receive","exchange","buy","sell","deliver","tip",
  "stake","save","deposit","lock","reverse","cancel",
]);
// internal (non-user) actions also journaled for a complete audit trail
const INTERNAL_ACTIONS = Object.freeze([
  "genesis","payreq","unstake","withdraw","unlock","slash","sweep","pop",
]);

export class LedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

const SYS = {
  treasury: "sys:treasury",
  faucet:   "sys:faucet",
  escrow:   "sys:escrow",
  vault:    "sys:vault",
  void:     "sys:void",
  market:   "sys:market",
};
// Debiting these requires the system autonomy gate (or a ledger-internal flow).
const DEBIT_GATED = new Set([SYS.treasury, SYS.market, SYS.faucet]);
// These can ONLY be touched by ledger-internal flows (opts.system): escrow/vault
// hold the backing for intents/locks, and the Void is burn-only.
const INTERNAL_ONLY = new Set([SYS.escrow, SYS.vault, SYS.void]);

function assertSafeInt(n, what) {
  if (!Number.isSafeInteger(n)) throw new LedgerError("UNSAFE_AMOUNT", `${what} not a safe integer`);
  return n;
}
function deepCopy(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
// Exact floor(a*b/c) via BigInt — float Math.floor(a*b/c) can be off by ±1
// past 2^53 (e.g. max-supply slash math). Deterministic everywhere.
function mulDivFloor(a, b, c) {
  const r = (BigInt(a) * BigInt(b)) / BigInt(c);
  return assertSafeInt(Number(r), "mulDiv");
}
function fmtTumbo(fluff) { return (fluff / FLUFF_PER_TUMBO).toFixed(3); }

export class TumboLedger {
  constructor({ seed = 13131313, strict = true } = {}) {
    this.strict = strict;
    this.s = {
      seed,
      prngState: null,
      clock: 0,          // logical tick; increments once per committed transition
      seq: 0,            // receipt/tx sequence
      accounts: {},      // id -> {id,kind,label,owner,balances:{}}
      journal: [],       // tx records in commit order
      receipts: [],      // EchoProof receipts in chain order
      idem: {},          // idempotencyKey -> txId
      receiptTip: null,  // pinned hash of the latest receipt (anti-truncation)
      intents: {},       // txId -> pending-intent record
      vaultHolds: [],    // open stake/deposit/lock holds vs sys:vault
      stakes: {}, deposits: {}, locks: {},
      burrowScore: {},   // accountId -> non-transferable score
      popClaims: {},     // "acct:achievement" -> txId
      oracle: { "TUMBO/sMIMAS": { num: 1, den: 1000 }, "sMIMAS/TUMBO": { num: 1000, den: 1 } },
      qseq: 0,          // quote id counter (quotes never consume PRNG)
      quotes: {},       // qid -> issued quote (registry; _execSwap trusts only these)
      botPricing: {},   // "service:resource" -> fluff (per-service overrides)
      botSpend: {},      // botId -> [{tick, amount}] rolling window
    };
    this._prng = createPrng(seed);
    this.s.prngState = this._prng.getState();
    this._commitListeners = []; // onCommit subscribers (event mirror; never hashed)
    this._genesis();
  }

  // ---------- internal plumbing ----------
  _now() { return this.s.clock; }

  _acct(id) {
    const a = this.s.accounts[id];
    if (!a) throw new LedgerError("UNKNOWN_ACCOUNT", `unknown account ${id}`);
    return a;
  }
  _bal(id, asset) { return this._acct(id).balances[asset] || 0; }

  createAccount(id, kind, label = id, owner = null) {
    if (this.s.accounts[id]) throw new LedgerError("ACCOUNT_EXISTS", id);
    if (!["user","bot","system"].includes(kind)) throw new LedgerError("BAD_KIND", kind);
    this.s.accounts[id] = { id, kind, label, owner, balances: {} };
    return this.s.accounts[id];
  }
  ensureAccount(id, kind = "user", label) {
    if (!this.s.accounts[id]) this.createAccount(id, kind, label || id);
    return this.s.accounts[id];
  }

  _genesis() {
    // Opening balances are SET directly (the opening balance sheet), not moved
    // by a transfer journal — minting is not a double-entry transfer. The
    // genesis EchoProof receipt records the opening balances; every journal
    // after it must balance to zero per asset (enforced in _applyEntries).
    for (const [id, label] of Object.entries({
      [SYS.treasury]: "Treasury", [SYS.faucet]: "Faucet", [SYS.escrow]: "Escrow",
      [SYS.vault]: "Hibernation Vault", [SYS.void]: "The Void (burn sink)",
      [SYS.market]: "Synthetic market maker",
    })) this.createAccount(id, "system", label);
    const T = ASSETS.TUMBO.supplyFluff, M = ASSETS.sMIMAS.supplyFluff;
    const faucetT = 1_000_000_000 * FLUFF_PER_TUMBO;
    const marketT = 10_000_000 * FLUFF_PER_TUMBO;
    this.s.accounts[SYS.treasury].balances.TUMBO = T - faucetT - marketT;
    this.s.accounts[SYS.faucet].balances.TUMBO   = faucetT;
    this.s.accounts[SYS.market].balances.TUMBO   = marketT;
    this.s.accounts[SYS.market].balances.sMIMAS  = M;
    this.s.clock += 1;
    const tick = this.s.clock;
    const seq = this.s.seq++;
    const id = `tx-${String(seq).padStart(6, "0")}`;
    const opening = {};
    for (const [aid, a] of Object.entries(this.s.accounts)) opening[aid] = { ...a.balances };
    const tx = { id, idem: "genesis", action: "genesis", actor: "sys", state: "settled",
      entries: [], refs: {}, meta: { note: "opening balances; fixed supplies", openingBalances: opening },
      createdTick: tick, settledTick: tick };
    this.s.journal.push(tx);
    this.s.idem["genesis"] = id;
    this.s.receipts.push(this._sealReceipt(tx, tick, seq));
    this.s.receiptTip = this.s.receipts[this.s.receipts.length - 1].hash;
  }

  // Validate + apply entries atomically; returns nothing (throws on violation).
  _applyEntries(entries) {
    if (!entries.length) throw new LedgerError("EMPTY_JOURNAL", "journal needs entries");
    const sums = {};
    for (const e of entries) {
      if (!ASSETS[e.asset]) throw new LedgerError("UNKNOWN_ASSET", e.asset);
      this._acct(e.account); // throws UNKNOWN_ACCOUNT
      assertSafeInt(e.delta, "delta");
      if (e.delta === 0) throw new LedgerError("ZERO_DELTA", "deltas must be non-zero");
      if (e.account === SYS.void && e.delta < 0)
        throw new LedgerError("VOID_DEBIT", "The Void is burn-only; it can never be debited");
      sums[e.asset] = (sums[e.asset] || 0) + e.delta;
    }
    for (const [a, sum] of Object.entries(sums))
      if (sum !== 0) throw new LedgerError("UNBALANCED", `entries for ${a} sum to ${sum}, want 0`);
    // simulate on scratch balances
    const scratch = {};
    const get = (acct, asset) => {
      const k = acct + "|" + asset;
      if (!(k in scratch)) scratch[k] = this._bal(acct, asset);
      return scratch[k];
    };
    for (const e of entries) {
      const k = e.account + "|" + e.asset;
      const nb = get(e.account, e.asset) + e.delta;
      assertSafeInt(nb, "balance");
      if (nb < 0) throw new LedgerError("INSUFFICIENT_FUNDS",
        `${e.account} lacks ${fmtTumbo(-e.delta)} ${e.asset} (has ${fmtTumbo(get(e.account,e.asset))})`);
      scratch[k] = nb;
    }
    for (const [k, v] of Object.entries(scratch)) {
      const [acct, asset] = k.split("|");
      this.s.accounts[acct].balances[asset] = v;
    }
  }

  // The single commit path. Everything journals through here.
  //
  // System-account firewall: no journal may move value out of
  // sys:treasury/sys:market/sys:faucet, or touch sys:escrow/sys:vault/sys:void
  // at all, unless it comes through a ledger-internal flow (opts.system) or
  // carries the system gate (opts.gate). Checked BEFORE any balance mutates.
  // Public send()/tip() pass the caller's gate through.
  //
  // Transactional: on ANY failure after mutation starts (including post-mutation
  // invariant checks), all state is restored from the snapshot — a failed commit
  // never moves money and never wedges the ledger.
  _commitRaw(spec, opts = {}) { return this._commitInner(spec, opts).receipt; }
  // Commit listeners (demo event mirror; not part of hashed state). The token
  // boot subscribes so every settled action also emits a document
  // CustomEvent('tumbo:token'). Listener errors never break the commit path.
  onCommit(cb) {
    if (typeof cb !== "function") throw new LedgerError("BAD_LISTENER", "onCommit needs a function");
    this._commitListeners.push(cb);
    return () => {
      const i = this._commitListeners.indexOf(cb);
      if (i >= 0) this._commitListeners.splice(i, 1);
    };
  }
  _emitCommit(receipt) {
    for (const cb of this._commitListeners.slice()) {
      try { cb(receipt); } catch {}
    }
  }
  // Inner commit returns { receipt, replayed }. Callers with post-commit side
  // effects (intent records, state flips) MUST use _commitInner and skip those
  // effects when replayed — otherwise a replayed idem would mutate the WRONG
  // intent/tx's bookkeeping (H1 class).
  _commitInner({ action, actor, idem, entries, refs = {}, meta = {} }, opts = {}) {
    if (!idem || typeof idem !== "string") throw new LedgerError("BAD_IDEM", "idempotency key required");
    const seen = this.s.idem[idem];
    if (seen) {
      const orig = this.s.journal.find(t => t.id === seen);
      // refs are part of the identity: reusing an idem across different intents
      // or txs fails CLOSED instead of replaying the wrong receipt.
      const probe = canonical({ action, actor, entries, refs, meta });
      const prior = canonical({ action: orig.action, actor: orig.actor,
        entries: orig.entries, refs: orig.refs, meta: orig.meta });
      if (probe !== prior) throw new LedgerError("IDEM_MISMATCH",
        `idempotency key ${idem} already used with different payload`);
      return { receipt: this._receiptFor(seen), replayed: true }; // no new journal
    }
    for (const e of entries) {
      if (e.delta < 0 && DEBIT_GATED.has(e.account) && !(opts.system || opts.gate === GATE_SYSTEM))
        throw new LedgerError("GATE_DENIED",
          `moving value out of ${e.account} requires the system autonomy gate`);
      if (INTERNAL_ONLY.has(e.account) && !opts.system)
        throw new LedgerError("SYSTEM_ACCOUNT",
          `${e.account} can only be touched by ledger-internal flows (escrow, vault, burns)`);
    }
    const snap = this._snapshot();
    try {
      this._applyEntries(entries);
      this.s.clock += 1;
      const tick = this.s.clock;
      const seq = this.s.seq++;
      const id = `tx-${String(seq).padStart(6, "0")}`;
      const tx = {
        id, idem, action, actor, state: "settled",
        entries: entries.map(e => ({ ...e })),
        refs: deepCopy(refs), meta: deepCopy(meta),
        createdTick: tick, settledTick: tick,
      };
      this.s.journal.push(tx);
      this.s.idem[idem] = id;
      const receipt = this._sealReceipt(tx, tick, seq);
      this.s.receipts.push(receipt);
      this.s.receiptTip = receipt.hash;
      if (this.strict) this.verifyInvariants({ skipHolds: !!opts.deferHolds });
      this._emitCommit(receipt); // settled (replays return before any mutation)
      return { receipt, replayed: false };
    } catch (e) {
      this._restore(snap); // failed commit => zero state change
      throw e;
    }
  }

  _snapshot() {
    const bals = {};
    for (const [id, a] of Object.entries(this.s.accounts)) bals[id] = { ...a.balances };
    return { bals, journalLen: this.s.journal.length, receiptsLen: this.s.receipts.length,
             seq: this.s.seq, clock: this.s.clock, idem: { ...this.s.idem },
             receiptTip: this.s.receiptTip, prng: this._prng.getState() };
  }
  _restore(snap) {
    for (const [id, b] of Object.entries(snap.bals))
      if (this.s.accounts[id]) this.s.accounts[id].balances = { ...b };
    this.s.journal.length = snap.journalLen;
    this.s.receipts.length = snap.receiptsLen;
    this.s.seq = snap.seq; this.s.clock = snap.clock; this.s.idem = { ...snap.idem };
    this.s.receiptTip = snap.receiptTip; this._prng.setState(snap.prng);
  }

  // Commit a journal while releasing a vault hold first (exit actions).
  // The hold is restored if the commit throws, so state never half-updates.
  _commitReleasingHold(holdId, spec) {
    const idx = this.s.vaultHolds.findIndex(h => h.id === holdId);
    const hold = idx >= 0 ? this.s.vaultHolds[idx] : null;
    if (idx >= 0) this.s.vaultHolds.splice(idx, 1);
    try {
      const r = this._commitRaw(spec, { deferHolds: true, system: true });
      if (this.strict) this.verifyInvariants();
      return r;
    } catch (e) {
      if (hold) this.s.vaultHolds.splice(Math.min(idx, this.s.vaultHolds.length), 0, hold);
      throw e;
    }
  }

  _sealBody(tx, tick, seq, prevHash) {
    return {
      v: 2, seq, txId: tx.id, action: tx.action, actor: tx.actor, idem: tx.idem,
      entries: tx.entries.map(e => ({ account: e.account, asset: e.asset, delta: String(e.delta) })),
      refs: deepCopy(tx.refs), meta: deepCopy(tx.meta),
      prevHash, logicalTick: tick,
    };
  }
  _sealReceipt(tx, tick, seq) {
    const prev = this.s.receipts.length
      ? this.s.receipts[this.s.receipts.length - 1].hash : "TUMBO-GENESIS";
    const body = this._sealBody(tx, tick, seq, prev);
    return { ...body, hash: sha256Hex(canonical(body)) };
  }
  _receiptFor(txId) {
    const r = this.s.receipts.find(r => r.txId === txId);
    if (!r) throw new LedgerError("NO_RECEIPT", txId);
    return r;
  }
  tx(id) { return this.s.journal.find(t => t.id === id); }

  // ---------- invariants ----------
  verifyInvariants({ skipHolds = false } = {}) {
    for (const a of Object.values(this.s.accounts))
      for (const [asset, b] of Object.entries(a.balances)) {
        if (!Number.isSafeInteger(b) || b < 0)
          throw new LedgerError("INVARIANT_BALANCE", `${a.id}/${asset} = ${b}`);
      }
    for (const [asset, def] of Object.entries(ASSETS)) {
      let sum = 0;
      for (const a of Object.values(this.s.accounts)) sum += a.balances[asset] || 0;
      if (sum !== def.supplyFluff)
        throw new LedgerError("INVARIANT_SUPPLY", `${asset}: Σ=${sum} want ${def.supplyFluff}`);
    }
    if (!skipHolds) this._verifyHolds();
    this._verifyReplay(); // the journal is the source of truth for balances
    this._verifyOracle(); // oracle rates are sane (catches hand-edited den:0)
    this._verifyJournalReceiptLink(); // every tx has exactly one matching receipt
    this.verifyChain();
    return true;
  }
  // Journal<->receipt linkage: 1:1 count, txIds line up, each receipt hash
  // recomputes from its journal tx (catches entry/refs/meta tamper on either
  // side and tail truncation of either log). Chain tip is pinned in state.
  _verifyOracle() {
    for (const [pair, o] of Object.entries(this.s.oracle))
      if (!Number.isSafeInteger(o.num) || !Number.isSafeInteger(o.den) || o.num <= 0 || o.den <= 0)
        throw new LedgerError("INVARIANT_ORACLE", `${pair} has a corrupt rate`);
  }
  _verifyJournalReceiptLink() {
    if (this.s.journal.length !== this.s.receipts.length)
      throw new LedgerError("INVARIANT_LINK",
        `journal(${this.s.journal.length}) vs receipts(${this.s.receipts.length}) count mismatch`);
    let prev = "TUMBO-GENESIS";
    for (let i = 0; i < this.s.journal.length; i++) {
      const tx = this.s.journal[i], r = this.s.receipts[i];
      if (r.txId !== tx.id || r.seq !== i)
        throw new LedgerError("INVARIANT_LINK", `receipt/tx misaligned at index ${i}`);
      const body = this._sealBody(tx, r.logicalTick, r.seq, prev);
      if (sha256Hex(canonical(body)) !== r.hash)
        throw new LedgerError("INVARIANT_LINK", `receipt hash does not match journal tx ${tx.id}`);
      prev = r.hash;
    }
    const tip = this.s.receipts.length ? this.s.receipts[this.s.receipts.length - 1].hash : null;
    if (tip !== this.s.receiptTip)
      throw new LedgerError("INVARIANT_CHAIN", "receipt tip mismatch (truncation?)");
    return true;
  }
  // Replays every journal entry from the genesis opening balances and requires
  // the result to equal live balances. Serialized state edited outside the
  // journal (e.g. hand-edited localStorage) is rejected on load/verify.
  _verifyReplay() {
    const bals = {};
    const g = this.s.journal[0];
    if (!g || g.action !== "genesis" || !g.meta.openingBalances)
      throw new LedgerError("INVARIANT_REPLAY", "genesis opening balances missing");
    for (const [acct, m] of Object.entries(g.meta.openingBalances))
      bals[acct] = { ...m };
    for (const tx of this.s.journal.slice(1))
      for (const e of tx.entries) {
        bals[e.account] = bals[e.account] || {};
        bals[e.account][e.asset] = (bals[e.account][e.asset] || 0) + e.delta;
      }
    for (const [id, a] of Object.entries(this.s.accounts))
      for (const asset of Object.keys(ASSETS)) {
        const want = (bals[id] && bals[id][asset]) || 0;
        const have = a.balances[asset] || 0;
        if (want !== have) throw new LedgerError("INVARIANT_REPLAY",
          `${id}/${asset}: journal replays to ${want} but balance is ${have}`);
      }
    return true;
  }
  _verifyHolds() {
    // escrow integrity: escrow balance == Σ pending intent holds
    const pend = Object.values(this.s.intents).filter(i => i.state === "pending");
    for (const asset of Object.keys(ASSETS)) {
      const want = pend.filter(i => i.asset === asset).reduce((s, i) => s + i.amount, 0);
      const have = this._bal(SYS.escrow, asset);
      if (have !== want) throw new LedgerError("INVARIANT_ESCROW", `${asset}: escrow=${have} holds=${want}`);
    }
    // vault integrity
    for (const asset of Object.keys(ASSETS)) {
      const want = this.s.vaultHolds.reduce((s, h) => s + (h.asset === asset ? h.amount : 0), 0);
      const have = this._bal(SYS.vault, asset);
      if (have !== want) throw new LedgerError("INVARIANT_VAULT", `${asset}: vault=${have} holds=${want}`);
    }
  }
  verifyChain() {
    let prev = "TUMBO-GENESIS";
    for (const r of this.s.receipts) {
      if (r.prevHash !== prev) throw new LedgerError("INVARIANT_CHAIN", `link broken at seq ${r.seq}`);
      const { hash, ...body } = r;
      if (sha256Hex(canonical(body)) !== hash)
        throw new LedgerError("INVARIANT_CHAIN", `hash mismatch at seq ${r.seq}`);
      prev = hash;
    }
    return true;
  }

  // ---------- gates ----------
  _gate(token, want, what) {
    if (token !== want) throw new LedgerError("GATE_DENIED", `${what} requires an autonomy-gate approval`);
  }

  // ---------- action 1: SEND ----------
  send({ from, to, asset = "TUMBO", amountFluff, idem, memo = "", gate = null }) {
    this.ensureAccount(from); this.ensureAccount(to);
    assertSafeInt(amountFluff, "amount"); if (amountFluff <= 0) throw new LedgerError("BAD_AMOUNT", "amount > 0");
    return this._commitRaw({
      action: "send", actor: from, idem: idem || `send:${from}:${to}:${asset}:${amountFluff}:${this._prng.hex(8)}`,
      entries: [
        { account: from, asset, delta: -amountFluff },
        { account: to,   asset, delta:  amountFluff },
      ],
      meta: { memo },
    }, { gate });
  }

  // ---------- action 7: TIP ----------
  tip({ from, to, asset = "TUMBO", amountFluff, idem, memo = "", gate = null }) {
    this.ensureAccount(from); this.ensureAccount(to);
    assertSafeInt(amountFluff, "amount"); if (amountFluff <= 0) throw new LedgerError("BAD_AMOUNT", "amount > 0");
    return this._commitRaw({
      action: "tip", actor: from, idem: idem || `tip:${from}:${to}:${asset}:${amountFluff}:${this._prng.hex(8)}`,
      entries: [
        { account: from, asset, delta: -amountFluff },
        { account: to,   asset, delta:  amountFluff },
      ],
      meta: { memo, social: true, senderReversible: false },
    }, { gate });
  }

  // ---------- payment request (creates a PENDING inbound) ----------
  payreq({ issuer, recipient, asset = "TUMBO", amountFluff, expiresInTicks = 500, idem, memo = "" }) {
    this.ensureAccount(issuer); this.ensureAccount(recipient);
    assertSafeInt(amountFluff, "amount"); if (amountFluff <= 0) throw new LedgerError("BAD_AMOUNT", "amount > 0");
    const key = idem || `payreq:${issuer}:${recipient}:${asset}:${amountFluff}:${this._prng.hex(8)}`;
    const { receipt: r, replayed } = this._commitInner({
      action: "payreq", actor: issuer, idem: key,
      entries: [
        { account: issuer, asset, delta: -amountFluff },
        { account: SYS.escrow, asset, delta: amountFluff },
      ],
      meta: { memo, recipient, kind: "payreq" },
    }, { deferHolds: true, system: true });
    if (!replayed) { // replay: bookkeeping already done for the original receipt
      const tx = this.tx(r.txId);
      tx.state = "pending";
      this.s.intents[r.txId] = {
        kind: "payreq", creator: issuer, recipient, asset, amount: amountFluff,
        expiresTick: this.s.clock + expiresInTicks, state: "pending",
      };
    }
    if (this.strict) this.verifyInvariants(); // holds now registered
    return r;
  }

  // ---------- action 2: RECEIVE (settles a pending inbound) ----------
  receive({ intentTxId, by, idem }) {
    const it = this.s.intents[intentTxId];
    if (!it) throw new LedgerError("UNKNOWN_INTENT", intentTxId);
    const key = idem || `receive:${intentTxId}:${by}`;
    if (it.state !== "pending") throw new LedgerError("INTENT_NOT_PENDING", `${intentTxId} is ${it.state}`);
    if (by !== it.recipient) throw new LedgerError("NOT_RECIPIENT", `${by} is not the recipient`);
    if (this.s.clock > it.expiresTick) throw new LedgerError("INTENT_EXPIRED", "run sweep, then re-issue");
    const { receipt: r, replayed } = this._commitInner({
      action: "receive", actor: by, idem: key,
      entries: [
        { account: SYS.escrow, asset: it.asset, delta: -it.amount },
        { account: by,         asset: it.asset, delta:  it.amount },
      ],
      refs: { intentOf: intentTxId },
      meta: { kind: it.kind },
    }, { deferHolds: true, system: true });
    if (!replayed) {
      it.state = "settled"; it.settleTx = r.txId;
      this.tx(intentTxId).state = "settled"; this.tx(intentTxId).settledTick = this.s.clock;
    }
    if (this.strict) this.verifyInvariants(); // intent settled; holds re-checked
    return r;
  }

  // ---------- faucet + proof-of-presence (both settle via receive) ----------
  faucetDrip({ to, amountTumbo = 1000 }) {
    this.ensureAccount(to);
    assertSafeInt(amountTumbo, "amountTumbo");
    if (amountTumbo <= 0) throw new LedgerError("BAD_AMOUNT", "amountTumbo > 0");
    const amountFluff = amountTumbo * FLUFF_PER_TUMBO;
    const last = this.s.popClaims[`faucet:${to}`];
    if (last && this.s.clock - this.tx(last).createdTick < 500)
      throw new LedgerError("FAUCET_COOLDOWN", "one drip per 500 ticks");
    const { receipt: r, replayed } = this._commitInner({
      action: "payreq", actor: SYS.faucet, idem: `faucet:${to}:${this.s.clock}`,
      entries: [
        { account: SYS.faucet, asset: "TUMBO", delta: -amountFluff },
        { account: SYS.escrow, asset: "TUMBO", delta:  amountFluff },
      ],
      meta: { kind: "faucet", recipient: to },
    }, { deferHolds: true, system: true });
    if (!replayed) {
      const tx = this.tx(r.txId);
      tx.state = "pending";
      this.s.intents[r.txId] = {
        kind: "faucet", creator: SYS.faucet, recipient: to, asset: "TUMBO",
        amount: amountFluff, expiresTick: this.s.clock + 5000, state: "pending",
      };
    }
    if (this.strict) this.verifyInvariants(); // holds now registered
    this.s.popClaims[`faucet:${to}`] = r.txId;
    return r; // recipient calls receive({intentTxId: r.txId, by: to})
  }

  grantPop({ to, achievement, amountTumbo = 250, gate }) {
    this._gate(gate, GATE_SYSTEM, "pop grant");
    this.ensureAccount(to);
    assertSafeInt(amountTumbo, "amountTumbo");
    if (amountTumbo <= 0) throw new LedgerError("BAD_AMOUNT", "amountTumbo > 0");
    const key = `pop:${to}:${achievement}`;
    if (this.s.popClaims[key]) throw new LedgerError("POP_CLAIMED", `${achievement} already claimed by ${to}`);
    const amountFluff = amountTumbo * FLUFF_PER_TUMBO;
    const { receipt: r, replayed } = this._commitInner({
      action: "pop", actor: "sys", idem: key,
      entries: [
        { account: SYS.treasury, asset: "TUMBO", delta: -amountFluff },
        { account: SYS.escrow,   asset: "TUMBO", delta:  amountFluff },
      ],
      meta: { kind: "pop", recipient: to, achievement },
    }, { deferHolds: true, system: true });
    if (!replayed) {
      const tx = this.tx(r.txId);
      tx.state = "pending";
      this.s.intents[r.txId] = {
        kind: "pop", creator: SYS.treasury, recipient: to, asset: "TUMBO",
        amount: amountFluff, expiresTick: this.s.clock + 100000, state: "pending",
      };
    }
    if (this.strict) this.verifyInvariants(); // holds now registered
    this.s.popClaims[key] = r.txId;
    return r;
  }

  // ---------- actions 3/4/5: EXCHANGE / BUY / SELL ----------
  // Quotes are ISSUED here and stored in a registry. _execSwap trusts ONLY the
  // stored terms looked up by qid — a caller-supplied quote object is just a
  // reference (qid), never terms. This closes fabricated-quote market drains.
  quote({ assetIn, assetOut, idem }) {
    const pair = `${assetIn}/${assetOut}`;
    const rate = this.s.oracle[pair];
    if (!rate) throw new LedgerError("NO_MARKET", pair);
    if (idem && this.s.quotes[idem]) throw new LedgerError("QUOTE_EXISTS", idem); // no id squatting
    for (const [qid, q] of Object.entries(this.s.quotes))  // prune expired
      if (this.s.clock > q.expiresTick) delete this.s.quotes[qid];
    const qid = idem || `q:${pair}:${this.s.clock}:${this.s.qseq++}`; // reads stay reads: no PRNG consumed
    const q = { qid, pair, assetIn, assetOut, num: rate.num, den: rate.den,
                expiresTick: this.s.clock + 50, quotedTick: this.s.clock };
    this.s.quotes[qid] = q;
    return { ...q };
  }
  setRate({ pair, num, den, gate }) {
    this._gate(gate, GATE_SYSTEM, "oracle rate");
    assertSafeInt(num, "rate num"); assertSafeInt(den, "rate den");
    if (num <= 0 || den <= 0) throw new LedgerError("BAD_RATE", pair);
    if (num > 1e15 || den > 1e15) throw new LedgerError("BAD_RATE", `${pair}: rate legs capped at 1e15`);
    this.s.oracle[pair] = { num, den };
    // mirror pair
    const [a, b] = pair.split("/");
    this.s.oracle[`${b}/${a}`] = { num: den, den: num };
    return this.s.oracle[pair];
  }
  _execSwap({ by, assetIn, assetOut, amountInFluff, quote, maxSlippageBps = 50, idem, action }) {
    this.ensureAccount(by);
    assertSafeInt(amountInFluff, "amount"); if (amountInFluff <= 0) throw new LedgerError("BAD_AMOUNT", "amount > 0");
    // Registry lookup: only quotes issued by quote() are honored, and only on
    // their STORED terms. A fabricated object with a made-up qid is rejected.
    const stored = quote && this.s.quotes[quote.qid];
    if (!stored || stored.pair !== `${assetIn}/${assetOut}`)
      throw new LedgerError("UNKNOWN_QUOTE", "quote not issued by this ledger (or pair mismatch)");
    if (this.s.clock > stored.expiresTick) throw new LedgerError("QUOTE_EXPIRED", stored.qid);
    const live = this.s.oracle[stored.pair];
    const driftBps = Math.abs((live.num / live.den - stored.num / stored.den) / (stored.num / stored.den)) * 10000;
    // Hard ceiling: the caller can tighten slippage tolerance but never widen
    // it past 500 bps — no caller-controlled bypass of the price guard.
    const tolBps = Math.min(maxSlippageBps ?? 50, 500);
    if (driftBps > tolBps) throw new LedgerError("SLIPPAGE", `oracle moved ${driftBps.toFixed(1)} bps`);
    const q = stored;
    const amountOut = mulDivFloor(amountInFluff, q.num, q.den);
    if (amountOut <= 0) throw new LedgerError("DUST", "output rounds to zero");
    // Void tithe (Hunger Meter sink) on the TUMBO leg only
    const tumboLeg = assetIn === "TUMBO" ? amountInFluff : amountOut;
    const tithe = mulDivFloor(tumboLeg, VOID_TITHE_BPS, 10000);
    const entries = [
      { account: by,         asset: assetIn,  delta: -amountInFluff },
      { account: SYS.market, asset: assetIn,  delta:  amountInFluff },
      { account: SYS.market, asset: assetOut, delta: -amountOut },
      { account: by,         asset: assetOut, delta:  amountOut },
    ];
    if (tithe > 0) {
      // re-route tithe: market keeps (leg - tithe), void burns tithe
      const tumboEntry = entries.find(e => e.asset === "TUMBO" && e.account === (assetIn === "TUMBO" ? SYS.market : by));
      if (!tumboEntry) throw new LedgerError("NO_TUMBO_LEG",
        "market pairs must include a TUMBO leg for the Void tithe");
      tumboEntry.delta += -tithe;
      entries.push({ account: SYS.void, asset: "TUMBO", delta: tithe });
    }
    return this._commitRaw({
      action, actor: by, idem: idem || `${action}:${quote.qid}:${amountInFluff}:${this._prng.hex(8)}`,
      entries, refs: {},
      meta: { quote: quote.qid, pair: quote.pair, amountIn: String(amountInFluff),
              amountOut: String(amountOut), voidTithe: String(tithe) },
    }, { system: true });
  }
  exchange(args) { return this._execSwap({ ...args, action: "exchange" }); }
  buy({ by, asset = "sMIMAS", amountInFluff, quote, maxSlippageBps, idem }) {
    return this._execSwap({ by, assetIn: "TUMBO", assetOut: asset, amountInFluff, quote, maxSlippageBps, idem, action: "buy" });
  }
  sell({ by, asset = "sMIMAS", amountInFluff, quote, maxSlippageBps, idem }) {
    return this._execSwap({ by, assetIn: asset, assetOut: "TUMBO", amountInFluff, quote, maxSlippageBps, idem, action: "sell" });
  }

  // ---------- action 6: DELIVER (two-phase escrow) ----------
  deliverCreate({ from, to, asset = "TUMBO", amountFluff, expiresInTicks = 1000, idem, memo = "", contractId = "" }) {
    this.ensureAccount(from); this.ensureAccount(to);
    assertSafeInt(amountFluff, "amount"); if (amountFluff <= 0) throw new LedgerError("BAD_AMOUNT", "amount > 0");
    const key = idem || `deliver:${from}:${to}:${asset}:${amountFluff}:${this._prng.hex(8)}`;
    const { receipt: r, replayed } = this._commitInner({
      action: "deliver", actor: from, idem: key,
      entries: [
        { account: from,       asset, delta: -amountFluff },
        { account: SYS.escrow, asset, delta:  amountFluff },
      ],
      meta: { memo, recipient: to, contractId, phase: "escrowed" },
    }, { deferHolds: true, system: true });
    if (!replayed) {
      const tx = this.tx(r.txId);
      tx.state = "pending";
      this.s.intents[r.txId] = {
        kind: "deliver", creator: from, recipient: to, asset, amount: amountFluff,
        expiresTick: this.s.clock + expiresInTicks, state: "pending", contractId,
      };
    }
    if (this.strict) this.verifyInvariants(); // holds now registered
    return r;
  }
  deliverConfirm({ intentTxId, by, idem, gate = null }) {
    const it = this.s.intents[intentTxId];
    if (!it || it.kind !== "deliver") throw new LedgerError("UNKNOWN_INTENT", intentTxId);
    if (it.state !== "pending") throw new LedgerError("INTENT_NOT_PENDING", `${intentTxId} is ${it.state}`);
    const oracle = by === "sys:oracle";
    if (by !== it.recipient && !oracle) throw new LedgerError("NOT_RECIPIENT", "only recipient or oracle confirms");
    if (oracle) this._gate(gate, GATE_SYSTEM, "oracle confirm");
    if (this.s.clock > it.expiresTick) throw new LedgerError("INTENT_EXPIRED", "sender may cancel; arbiter may resolve");
    const { receipt: r, replayed } = this._commitInner({
      action: "deliver", actor: by, idem: idem || `deliver-confirm:${intentTxId}`,
      entries: [
        { account: SYS.escrow, asset: it.asset, delta: -it.amount },
        { account: it.recipient, asset: it.asset, delta: it.amount },
      ],
      refs: { intentOf: intentTxId },
      meta: { phase: "confirmed", contractId: it.contractId },
    }, { deferHolds: true, system: true });
    if (!replayed) {
      it.state = "settled"; it.settleTx = r.txId;
      const t = this.tx(intentTxId); t.state = "settled"; t.settledTick = this.s.clock;
    }
    if (this.strict) this.verifyInvariants(); // intent settled; holds re-checked
    return r;
  }

  // ---------- action 13: CANCEL (pending intents only) ----------
  cancel({ intentTxId, by, gate = null }) {
    const it = this.s.intents[intentTxId];
    if (!it) throw new LedgerError("UNKNOWN_INTENT", intentTxId);
    if (it.state === "cancelled") return this._receiptFor(it.cancelTx);
    if (it.state !== "pending") throw new LedgerError("USE_REVERSE",
      `intent ${intentTxId} is ${it.state}; settled intents need reverse, not cancel`);
    const arbiter = by === "sys:arbiter";
    if (by !== it.creator && !arbiter) throw new LedgerError("NOT_CREATOR", "only the creator (or arbiter) cancels");
    if (arbiter) this._gate(gate, GATE_ARBITER, "arbiter cancel");
    const { receipt: r, replayed } = this._commitInner({
      action: "cancel", actor: by, idem: `cancel:${intentTxId}:${by}`,
      entries: [
        { account: SYS.escrow, asset: it.asset, delta: -it.amount },
        { account: it.creator, asset: it.asset, delta:  it.amount },
      ],
      refs: { cancels: intentTxId },
      meta: { kind: it.kind },
    }, { deferHolds: true, system: true });
    if (!replayed) {
      it.state = "cancelled"; it.cancelTx = r.txId;
      const t = this.tx(intentTxId); t.state = "cancelled";
    }
    if (this.strict) this.verifyInvariants(); // hold released; re-check
    return r;
  }

  // ---------- sweeper: cancels expired pending intents ----------
  sweep({ gate }) {
    this._gate(gate, GATE_SYSTEM, "sweep");
    const out = [];
    for (const [txId, it] of Object.entries(this.s.intents)) {
      if (it.state === "pending" && this.s.clock > it.expiresTick) {
        out.push(this.cancel({ intentTxId: txId, by: "sys:arbiter", gate: GATE_ARBITER }));
      }
    }
    return out;
  }

  // ---------- action 12: REVERSE ----------
  _reverseEntries(T) {
    // Default: exact negation (send, tip, save — money goes back to the sender).
    // Escrow-settled intents (deliver confirm, receive) restore to the intent
    // CREATOR instead of stranding value in sys:escrow with no open hold.
    if ((T.action === "deliver" && T.meta.phase === "confirmed") || T.action === "receive") {
      const it = this.s.intents[T.refs.intentOf];
      if (it && it.state === "settled")
        return [
          { account: it.recipient, asset: it.asset, delta: -it.amount },
          { account: it.creator,   asset: it.asset, delta:  it.amount },
        ];
    }
    return T.entries.map(e => ({ account: e.account, asset: e.asset, delta: -e.delta }));
  }
  reverse({ txId, by, gate = null, idem }) {
    const T = this.tx(txId);
    if (!T) throw new LedgerError("UNKNOWN_TX", txId);
    if (T.state === "reversed") throw new LedgerError("ALREADY_REVERSED", txId);
    if (T.state !== "settled") throw new LedgerError("NOT_SETTLED", `cannot reverse ${T.state} tx`);
    if (T.action === "reverse" || T.action === "cancel")
      throw new LedgerError("NO_CHAIN", "reverse/cancel receipts are terminal");
    if (T.reversedBy) throw new LedgerError("ALREADY_REVERSED", txId);
    if (this.s.clock - T.createdTick > REVERSE_WINDOW_TICKS && T.action !== "save")
      throw new LedgerError("WINDOW_CLOSED", `reverse window (${REVERSE_WINDOW_TICKS} ticks) elapsed`);

    const policy = {
      send:    { who: [T.actor, "sys:arbiter"], window: true  },
      tip:     { who: ["sys:arbiter"],          window: true  }, // sender can NEVER reverse a tip
      receive: { who: ["sys:arbiter"],          window: true  },
      deliver: { who: ["sys:arbiter"],          window: true  },
      save:    { who: [T.actor],                window: false }, // owner, anytime
    }[T.action];
    if (!policy) throw new LedgerError("NOT_REVERSIBLE",
      `${T.action} has no direct reverse path (exchange/buy/sell: counter-trade; stake: unstake/slash; deposit: maturity withdraw; lock: unlock)`);
    if (!policy.who.includes(by)) throw new LedgerError("NOT_AUTHORIZED", `${by} may not reverse ${T.action}`);
    if (T.action === "deliver" && T.meta.phase !== "confirmed") throw new LedgerError("NOT_REVERSIBLE",
      "deliver escrow legs are governed by the intent lifecycle (confirm/cancel), not reverse");
    if (by === "sys:arbiter") this._gate(gate, GATE_ARBITER, "arbiter reverse");
    if (T.entries.some(e => e.account === SYS.void))
      throw new LedgerError("REVERSE_BURN_TOUCHED", "burns stay burned; the Void never gives back");

    const entries = this._reverseEntries(T);
    const { receipt: r, replayed } = this._commitInner({
      action: "reverse", actor: by, idem: idem || `reverse:${txId}:${by}`,
      entries, refs: { reverses: txId },
      meta: { reversedAction: T.action },
    }, { gate });
    if (!replayed) {
      T.state = "reversed"; T.reversedBy = r.txId; // NOT in sealed refs (post-seal write)
    }
    return r;
  }

  // ---------- action 9: SAVE (pocket move; owner-reversible anytime) ----------
  save({ owner, goal, amountFluff, idem, memo = "" }) {
    this.ensureAccount(owner);
    const pocket = `${owner}:save:${goal}`;
    this.ensureAccount(pocket, this.s.accounts[owner].kind, `Savings · ${goal}`);
    this.s.accounts[pocket].owner = owner;
    assertSafeInt(amountFluff, "amount"); if (amountFluff <= 0) throw new LedgerError("BAD_AMOUNT", "amount > 0");
    return this._commitRaw({
      action: "save", actor: owner, idem: idem || `save:${owner}:${goal}:${amountFluff}:${this._prng.hex(8)}`,
      entries: [
        { account: owner,  asset: "TUMBO", delta: -amountFluff },
        { account: pocket, asset: "TUMBO", delta:  amountFluff },
      ],
      meta: { memo, goal, pocket, reversibleBy: "owner" },
    });
  }

  // ---------- action 8: STAKE ----------
  stake({ owner, contractId, amountFluff, unlockInTicks = 2000, slashBps = 2000, idem }) {
    this.ensureAccount(owner);
    assertSafeInt(amountFluff, "amount"); if (amountFluff <= 0) throw new LedgerError("BAD_AMOUNT", "amount > 0");
    if (slashBps < 0 || slashBps > 10000) throw new LedgerError("BAD_SLASH", "slashBps 0..10000");
    const r = this._commitRaw({
      action: "stake", actor: owner,
      idem: idem || `stake:${owner}:${contractId}:${amountFluff}:${this._prng.hex(8)}`,
      entries: [
        { account: owner,     asset: "TUMBO", delta: -amountFluff },
        { account: SYS.vault, asset: "TUMBO", delta:  amountFluff },
      ],
      meta: { contractId, slashBps },
    }, { deferHolds: true, system: true });
    const sid = `stake-${r.txId}`;
    if (!this.s.stakes[sid]) { // replay-safe
      this.s.stakes[sid] = { id: sid, owner, contractId, amount: amountFluff,
        unlockTick: this.s.clock + unlockInTicks, slashBps, status: "active", txId: r.txId };
      this.s.vaultHolds.push({ id: sid, kind: "stake", asset: "TUMBO", amount: amountFluff });
    }
    if (this.strict) this.verifyInvariants(); // holds now registered
    return { receipt: r, stakeId: sid };
  }
  unstake({ stakeId, by }) {
    const st = this.s.stakes[stakeId];
    if (!st) throw new LedgerError("UNKNOWN_STAKE", stakeId);
    if (st.status !== "active") throw new LedgerError("STAKE_CLOSED", `${stakeId} is ${st.status}`);
    if (by !== st.owner) throw new LedgerError("NOT_OWNER", "only the staker unstakes");
    if (this.s.clock < st.unlockTick) throw new LedgerError("STAKE_LOCKED", `unlocks at tick ${st.unlockTick}`);
    const r = this._commitReleasingHold(stakeId, {
      action: "unstake", actor: by, idem: `unstake:${stakeId}`,
      entries: [
        { account: SYS.vault, asset: "TUMBO", delta: -st.amount },
        { account: by,        asset: "TUMBO", delta:  st.amount },
      ],
      refs: {}, meta: { stakeId, contractId: st.contractId },
    });
    st.status = "released";
    return r;
  }
  slash({ stakeId, gate }) {
    this._gate(gate, GATE_ARBITER, "slash");
    const st = this.s.stakes[stakeId];
    if (!st) throw new LedgerError("UNKNOWN_STAKE", stakeId);
    if (st.status !== "active") throw new LedgerError("STAKE_CLOSED", `${stakeId} is ${st.status}`);
    const cut = mulDivFloor(st.amount, st.slashBps, 10000);
    const rest = st.amount - cut;
    const entries = [{ account: SYS.vault, asset: "TUMBO", delta: -st.amount }];
    if (cut > 0)  entries.push({ account: SYS.void, asset: "TUMBO", delta: cut });   // burned: The Void
    if (rest > 0) entries.push({ account: st.owner, asset: "TUMBO", delta: rest });
    const r = this._commitReleasingHold(stakeId, {
      action: "slash", actor: "sys:arbiter", idem: `slash:${stakeId}`,
      entries, meta: { stakeId, contractId: st.contractId, burned: String(cut) },
    });
    st.status = "slashed";
    return r;
  }

  // ---------- action 10: DEPOSIT (Hibernation Vault — no early exit, ever) ----------
  deposit({ owner, amountFluff, termTicks = 5000, idem }) {
    this.ensureAccount(owner);
    assertSafeInt(amountFluff, "amount"); if (amountFluff <= 0) throw new LedgerError("BAD_AMOUNT", "amount > 0");
    if (termTicks <= 0) throw new LedgerError("BAD_TERM", "termTicks > 0");
    const r = this._commitRaw({
      action: "deposit", actor: owner,
      idem: idem || `deposit:${owner}:${amountFluff}:${this._prng.hex(8)}`,
      entries: [
        { account: owner,     asset: "TUMBO", delta: -amountFluff },
        { account: SYS.vault, asset: "TUMBO", delta:  amountFluff },
      ],
      meta: { termTicks, earlyExit: "never" },
    }, { deferHolds: true, system: true });
    const did = `dep-${r.txId}`;
    if (!this.s.deposits[did]) { // replay-safe
      this.s.deposits[did] = { id: did, owner, amount: amountFluff,
        maturityTick: this.s.clock + termTicks, status: "locked", txId: r.txId };
      this.s.vaultHolds.push({ id: did, kind: "deposit", asset: "TUMBO", amount: amountFluff });
    }
    if (this.strict) this.verifyInvariants(); // holds now registered
    return { receipt: r, depositId: did };
  }
  withdraw({ depositId, by }) {
    const d = this.s.deposits[depositId];
    if (!d) throw new LedgerError("UNKNOWN_DEPOSIT", depositId);
    if (d.status !== "locked") throw new LedgerError("DEPOSIT_CLOSED", d.status);
    if (by !== d.owner) throw new LedgerError("NOT_OWNER", "only the depositor withdraws");
    if (this.s.clock < d.maturityTick)
      throw new LedgerError("VAULT_SEALED", `Hibernation Vault: no early exit; matures at tick ${d.maturityTick}`);
    // Burrow Score: non-transferable, computed BEFORE the fund release so an
    // overflow throws before any mutation (score would otherwise be lost: DEPOSIT_CLOSED)
    const held = this.s.clock - this.tx(d.txId).createdTick;
    const s2 = mulDivFloor(d.amount, held, 1e6);
    const r = this._commitReleasingHold(depositId, {
      action: "withdraw", actor: by, idem: `withdraw:${depositId}`,
      entries: [
        { account: SYS.vault, asset: "TUMBO", delta: -d.amount },
        { account: by,        asset: "TUMBO", delta:  d.amount },
      ],
      meta: { depositId },
    });
    d.status = "withdrawn";
    this.s.burrowScore[by] = (this.s.burrowScore[by] || 0) + s2;
    return { receipt: r, burrowScore: this.s.burrowScore[by] };
  }

  // ---------- action 11: LOCK (generic primitive) ----------
  lock({ owner, amountFluff, unlockInTicks = 1000, idem, memo = "" }) {
    this.ensureAccount(owner);
    assertSafeInt(amountFluff, "amount"); if (amountFluff <= 0) throw new LedgerError("BAD_AMOUNT", "amount > 0");
    const r = this._commitRaw({
      action: "lock", actor: owner,
      idem: idem || `lock:${owner}:${amountFluff}:${this._prng.hex(8)}`,
      entries: [
        { account: owner,     asset: "TUMBO", delta: -amountFluff },
        { account: SYS.vault, asset: "TUMBO", delta:  amountFluff },
      ],
      meta: { memo, cancellable: false },
    }, { deferHolds: true, system: true });
    const lid = `lock-${r.txId}`;
    if (!this.s.locks[lid]) { // replay-safe
      this.s.locks[lid] = { id: lid, owner, amount: amountFluff,
        unlockTick: this.s.clock + unlockInTicks, status: "locked", txId: r.txId };
      this.s.vaultHolds.push({ id: lid, kind: "lock", asset: "TUMBO", amount: amountFluff });
    }
    if (this.strict) this.verifyInvariants(); // holds now registered
    return { receipt: r, lockId: lid };
  }
  unlock({ lockId, by }) {
    const l = this.s.locks[lockId];
    if (!l) throw new LedgerError("UNKNOWN_LOCK", lockId);
    if (l.status !== "locked") throw new LedgerError("LOCK_CLOSED", l.status);
    if (by !== l.owner) throw new LedgerError("NOT_OWNER", "only the locker unlocks");
    if (this.s.clock < l.unlockTick) throw new LedgerError("LOCK_SEALED", `unlocks at tick ${l.unlockTick}`);
    const r = this._commitReleasingHold(lockId, {
      action: "unlock", actor: by, idem: `unlock:${lockId}`,
      entries: [
        { account: SYS.vault, asset: "TUMBO", delta: -l.amount },
        { account: by,        asset: "TUMBO", delta:  l.amount },
      ],
      meta: { lockId },
    });
    l.status = "unlocked";
    return r;
  }

  // ---------- persistence ----------
  serialize() {
    return JSON.stringify({ strict: this.strict, ...this.s, prngState: this._prng.getState() });
  }
  static load(json, { strict } = {}) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    const L = new TumboLedger({ seed: data.seed, strict: false });
    L.s = data;
    L._prng = createPrng(data.seed);
    L._prng.setState(data.prngState);
    L.strict = strict !== undefined ? strict : data.strict !== false;
    if (L.s.receiptTip == null && L.s.receipts.length) // pre-tip snapshots
      L.s.receiptTip = L.s.receipts[L.s.receipts.length - 1].hash;
    L.verifyInvariants();
    return L;
  }

  // ---------- read helpers (for UX) ----------
  balance(id, asset = "TUMBO") { return this._bal(id, asset); }
  history(id, limit = 50) {
    return this.s.journal.filter(t =>
      t.entries.some(e => e.account === id || e.account.startsWith(id + ":save:"))
    ).slice(-limit).reverse();
  }
  voidBurned(asset = "TUMBO") { return this._bal(SYS.void, asset); }
  circulating(asset = "TUMBO") { return ASSETS[asset].supplyFluff - this._bal(SYS.void, asset); }
}

export { SYS, fmtTumbo, assertSafeInt, mulDivFloor };
