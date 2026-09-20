/**
 * token-social-ux.js — TUMBO-SIM social tipping + two-phase delivery UX (domain).
 *
 * Workstream 10 of 14 — TOKEN SOCIAL UX (tip/deliver from feeds).
 *
 * SIMULATION ONLY. Every surface and receipt is labeled simulated.
 * Units: integer fluff. 1 TUMBO-SIM = 1000 fluff. Exact integer math only.
 *
 * Depends on the shared contract (docs/TOKEN-CONTRACT.md):
 *   - window.TumboToken facade when present (act / balance / fmt / on)
 *   - Accounts: u:<name>, b:<name>, sys:escrow
 *   - EchoProof-style receipts with idempotency keys
 *   - document CustomEvent('tumbo:tip', { detail: { postId, author, amountFluff } })
 *   - document CustomEvent('tumbo:token', { detail: { type, ... } })
 *
 * When TumboToken is not yet mounted (other workstreams unmerged), this module
 * runs a minimal local ledger that obeys the same tip/deliver/cancel/confirm
 * semantics so the UI remains demonstrable and idempotent.
 */

export const TOKEN_SOCIAL_UX_SOURCE = "token-social-ux";
export const TOKEN_SOCIAL_UX_SCHEMA = 1;
export const FLUFF_PER_TUMBO = 1000;
export const DEFAULT_TIP_FLUFF = 500; // 0.500 TUMBO-SIM
export const TIP_PRESETS_FLUFF = Object.freeze([100, 500, 1000, 2500, 5000]);
export const TIP_EVENT = "tumbo:tip";
export const TOKEN_EVENT = "tumbo:token";
export const TOAST_EVENT = "tumbo:social-toast";

const ACCOUNT_RE = /^(?:u|b):[a-z0-9](?:[a-z0-9._-]{0,62})?$/i;

function freeze(v) {
  if (Array.isArray(v)) {
    v.forEach(freeze);
    return Object.freeze(v);
  }
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    return Object.freeze(v);
  }
  return v;
}

function requireSafeFluff(value, field = "amountFluff") {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a safe non-negative integer (fluff)`);
  }
  return value;
}

function requirePositiveFluff(value, field = "amountFluff") {
  const n = requireSafeFluff(value, field);
  if (n <= 0) throw new TypeError(`${field} must be > 0`);
  return n;
}

function requireAccount(value, field = "account") {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  const id = value.trim();
  if (id === "sys:escrow" || id === "sys:treasury" || id === "sys:faucet") return id;
  if (!ACCOUNT_RE.test(id) && !id.startsWith("sys:")) {
    const bare = id.replace(/^u:/i, "");
    if (/^[a-z0-9][a-z0-9._-]{0,62}$/i.test(bare)) return `u:${bare}`;
    throw new TypeError(`${field} must be u:<name>, b:<name>, or a sys:* account`);
  }
  return id;
}

function requireIdem(key) {
  if (typeof key !== "string" || !key.trim()) {
    throw new TypeError("idempotencyKey must be a non-empty string");
  }
  if (key.length > 128) throw new TypeError("idempotencyKey too long");
  return key.trim();
}

export function fmtFluff(fluff, asset = "TUMBO") {
  const v = requireSafeFluff(fluff, "fluff");
  const units = Math.floor(v / FLUFF_PER_TUMBO);
  const rem = v % FLUFF_PER_TUMBO;
  return `${units}.${String(rem).padStart(3, "0")} ${asset}-SIM`;
}

export function newIdemKey(prefix = "social") {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {}
  const r = Math.floor(Math.random() * 0xffffffff).toString(36).padStart(7, "0");
  return `${prefix}-${Date.now().toString(36)}-${r}`;
}

function nowIso() {
  return new Date().toISOString();
}

function contentHashLite(obj) {
  const s = JSON.stringify(obj, Object.keys(obj || {}).sort());
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function createLocalSocialLedger() {
  const balances = new Map();
  const receipts = [];
  const byIdem = new Map();
  const pending = new Map();
  const notifications = [];
  let seq = 0;
  let prevHash = "genesis";

  function bal(acct) {
    return balances.get(acct) ?? 0;
  }

  function setBal(acct, v) {
    balances.set(acct, requireSafeFluff(v, "balance"));
  }

  setBal("u:you", 250_000);
  setBal("u:alice", 50_000);
  setBal("u:bob", 30_000);
  setBal("u:river", 40_000);
  setBal("sys:escrow", 0);

  function issueReceipt({ action, actor, state, entries, refs = {}, meta = {}, idem }) {
    seq += 1;
    const body = {
      seq,
      action,
      actor,
      state,
      entries,
      refs,
      meta,
      idem,
      tick: seq,
      simulation: true,
    };
    const hash = contentHashLite({ ...body, prevHash });
    const receipt = freeze({
      id: `rcpt-${seq.toString(36)}`,
      idem,
      action,
      actor,
      state,
      entries: freeze(entries),
      refs: freeze(refs),
      meta: freeze({ ...meta, simulation: true, stamp: "Simulated Proof — TUMBO-SIM" }),
      tick: seq,
      seq,
      hash,
      prevHash,
      at: nowIso(),
      simulation: true,
      source: TOKEN_SOCIAL_UX_SOURCE,
    });
    prevHash = hash;
    receipts.push(receipt);
    byIdem.set(idem, receipt);
    return receipt;
  }

  function pushNotif(n) {
    notifications.unshift(
      freeze({
        id: `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        at: nowIso(),
        simulation: true,
        ...n,
      }),
    );
    if (notifications.length > 200) notifications.length = 200;
  }

  function tip({ tipper, author, amountFluff, postId = null, idempotencyKey }) {
    const from = requireAccount(tipper, "tipper");
    const to = requireAccount(author, "author");
    const amount = requirePositiveFluff(amountFluff);
    const idem = requireIdem(idempotencyKey);

    const cached = byIdem.get(idem);
    if (cached) return freeze({ ...cached, duplicate: true });

    if (bal(from) < amount) {
      const err = new Error("insufficient-simulated-funds");
      err.code = "insufficient-simulated-funds";
      err.simulation = true;
      throw err;
    }

    setBal(from, bal(from) - amount);
    setBal(to, bal(to) + amount);

    const receipt = issueReceipt({
      action: "tip",
      actor: from,
      state: "settled",
      entries: [
        { account: from, asset: "TUMBO", delta: -amount },
        { account: to, asset: "TUMBO", delta: amount },
      ],
      refs: { postId, tipper: from, author: to },
      meta: { amountFluff: amount, kind: "tip" },
      idem,
    });

    pushNotif({
      kind: "tip-received",
      direction: "in",
      amountFluff: amount,
      counterparty: from,
      forAccount: to,
      receiptId: receipt.id,
      postId,
    });

    emitToken("receipt", { receipt, tx: receipt });
    emitToken("balance-changed", {
      accounts: [from, to],
      amountFluff: amount,
      receipt,
    });
    return receipt;
  }

  function deliver({ sender, receiver, amountFluff, memo = "", idempotencyKey }) {
    const from = requireAccount(sender, "sender");
    const to = requireAccount(receiver, "receiver");
    const amount = requirePositiveFluff(amountFluff);
    const idem = requireIdem(idempotencyKey);

    const cached = byIdem.get(idem);
    if (cached) return freeze({ ...cached, duplicate: true });

    if (bal(from) < amount) {
      const err = new Error("insufficient-simulated-funds");
      err.code = "insufficient-simulated-funds";
      err.simulation = true;
      throw err;
    }

    setBal(from, bal(from) - amount);
    setBal("sys:escrow", bal("sys:escrow") + amount);

    const intentId = `intent-${seq + 1}-${Date.now().toString(36)}`;
    const receipt = issueReceipt({
      action: "deliver",
      actor: from,
      state: "pending",
      entries: [
        { account: from, asset: "TUMBO", delta: -amount },
        { account: "sys:escrow", asset: "TUMBO", delta: amount },
      ],
      refs: { intentId, sender: from, receiver: to },
      meta: { amountFluff: amount, memo: String(memo || "").slice(0, 140), phase: "escrow-hold" },
      idem,
    });

    pending.set(intentId, freeze({
      intentId,
      sender: from,
      receiver: to,
      amountFluff: amount,
      memo: String(memo || "").slice(0, 140),
      state: "pending",
      createdAt: nowIso(),
      holdReceiptId: receipt.id,
      holdIdem: idem,
    }));

    pushNotif({
      kind: "delivery-pending",
      direction: "in",
      amountFluff: amount,
      counterparty: from,
      forAccount: to,
      receiptId: receipt.id,
      intentId,
    });

    emitToken("receipt", { receipt, tx: receipt });
    emitToken("balance-changed", {
      accounts: [from, "sys:escrow"],
      amountFluff: amount,
      receipt,
    });
    return freeze({ ...receipt, intentId });
  }

  function confirmDelivery({ intentId, actor, idempotencyKey }) {
    const idem = requireIdem(idempotencyKey);
    const cached = byIdem.get(idem);
    if (cached) return freeze({ ...cached, duplicate: true });

    const intent = pending.get(intentId);
    if (!intent || intent.state !== "pending") {
      const err = new Error("intent-not-pending");
      err.code = "intent-not-pending";
      err.simulation = true;
      throw err;
    }
    const who = requireAccount(actor, "actor");
    if (who !== intent.receiver) {
      const err = new Error("only-receiver-may-confirm");
      err.code = "only-receiver-may-confirm";
      err.simulation = true;
      throw err;
    }

    const amount = intent.amountFluff;
    if (bal("sys:escrow") < amount) {
      const err = new Error("escrow-integrity");
      err.code = "escrow-integrity";
      err.simulation = true;
      throw err;
    }

    setBal("sys:escrow", bal("sys:escrow") - amount);
    setBal(intent.receiver, bal(intent.receiver) + amount);

    const receipt = issueReceipt({
      action: "confirm",
      actor: who,
      state: "settled",
      entries: [
        { account: "sys:escrow", asset: "TUMBO", delta: -amount },
        { account: intent.receiver, asset: "TUMBO", delta: amount },
      ],
      refs: { intentId, sender: intent.sender, receiver: intent.receiver },
      meta: { amountFluff: amount, phase: "escrow-release" },
      idem,
    });

    pending.set(intentId, freeze({ ...intent, state: "confirmed", confirmedAt: nowIso(), confirmReceiptId: receipt.id }));

    pushNotif({
      kind: "delivery-confirmed",
      direction: "in",
      amountFluff: amount,
      counterparty: intent.sender,
      forAccount: intent.receiver,
      receiptId: receipt.id,
      intentId,
    });

    emitToken("receipt", { receipt, tx: receipt });
    emitToken("balance-changed", {
      accounts: ["sys:escrow", intent.receiver],
      amountFluff: amount,
      receipt,
    });
    return receipt;
  }

  function cancelDelivery({ intentId, actor, idempotencyKey }) {
    const idem = requireIdem(idempotencyKey);
    const cached = byIdem.get(idem);
    if (cached) return freeze({ ...cached, duplicate: true });

    const intent = pending.get(intentId);
    if (!intent || intent.state !== "pending") {
      const err = new Error("intent-not-pending");
      err.code = "intent-not-pending";
      err.simulation = true;
      throw err;
    }
    const who = requireAccount(actor, "actor");
    if (who !== intent.sender) {
      const err = new Error("only-sender-may-cancel");
      err.code = "only-sender-may-cancel";
      err.simulation = true;
      throw err;
    }

    const amount = intent.amountFluff;
    if (bal("sys:escrow") < amount) {
      const err = new Error("escrow-integrity");
      err.code = "escrow-integrity";
      err.simulation = true;
      throw err;
    }

    setBal("sys:escrow", bal("sys:escrow") - amount);
    setBal(intent.sender, bal(intent.sender) + amount);

    const receipt = issueReceipt({
      action: "cancel",
      actor: who,
      state: "cancelled",
      entries: [
        { account: "sys:escrow", asset: "TUMBO", delta: -amount },
        { account: intent.sender, asset: "TUMBO", delta: amount },
      ],
      refs: { intentId, sender: intent.sender, receiver: intent.receiver },
      meta: { amountFluff: amount, phase: "escrow-refund" },
      idem,
    });

    pending.set(intentId, freeze({ ...intent, state: "cancelled", cancelledAt: nowIso(), cancelReceiptId: receipt.id }));

    pushNotif({
      kind: "delivery-cancelled",
      direction: "out",
      amountFluff: amount,
      counterparty: intent.receiver,
      forAccount: intent.sender,
      receiptId: receipt.id,
      intentId,
    });

    emitToken("receipt", { receipt, tx: receipt });
    emitToken("balance-changed", {
      accounts: ["sys:escrow", intent.sender],
      amountFluff: amount,
      receipt,
    });
    return receipt;
  }

  return {
    balance: (acct) => bal(requireAccount(acct)),
    tip,
    deliver,
    confirmDelivery,
    cancelDelivery,
    listPending: () => [...pending.values()].filter((p) => p.state === "pending"),
    listNotifications: (forAccount = null) => {
      if (!forAccount) return [...notifications];
      const a = requireAccount(forAccount);
      return notifications.filter((n) => n.forAccount === a);
    },
    history: () => [...receipts].reverse(),
    fmt: fmtFluff,
  };
}

function emitToken(type, detail) {
  try {
    if (typeof document !== "undefined" && typeof CustomEvent === "function") {
      document.dispatchEvent(
        new CustomEvent(TOKEN_EVENT, {
          detail: { type, simulation: true, source: TOKEN_SOCIAL_UX_SOURCE, ...detail },
        }),
      );
    }
  } catch {}
}

function emitToast(kind, message, extra = {}) {
  try {
    if (typeof document !== "undefined" && typeof CustomEvent === "function") {
      document.dispatchEvent(
        new CustomEvent(TOAST_EVENT, {
          detail: freeze({
            kind,
            message,
            simulation: true,
            at: nowIso(),
            ...extra,
          }),
        }),
      );
    }
  } catch {}
}

let localLedger = null;

function getLocal() {
  if (!localLedger) localLedger = createLocalSocialLedger();
  return localLedger;
}

function getFacade() {
  try {
    if (typeof window !== "undefined" && window.TumboToken) return window.TumboToken;
  } catch {}
  return null;
}

export function socialTip({
  tipper = "u:you",
  author,
  amountFluff = DEFAULT_TIP_FLUFF,
  postId = null,
  idempotencyKey = newIdemKey("tip"),
} = {}) {
  const facade = getFacade();
  try {
    let receipt;
    if (facade && typeof facade.act === "function") {
      receipt = facade.act(
        "tip",
        { from: tipper, to: author, amountFluff, postId, asset: "TUMBO" },
        idempotencyKey,
      );
    } else if (facade?.ledger?.send) {
      receipt = facade.ledger.send({
        from: tipper,
        to: author,
        amountFluff,
        memo: postId ? `tip:${postId}` : "tip",
        idempotencyKey,
      });
    } else {
      receipt = getLocal().tip({ tipper, author, amountFluff, postId, idempotencyKey });
    }
    emitToast("tip-sent", `Tip sent · ${fmtFluff(amountFluff)} (simulated)`, {
      receiptId: receipt?.id,
      amountFluff,
    });
    try {
      if (typeof document !== "undefined") {
        document.dispatchEvent(
          new CustomEvent(TIP_EVENT, {
            detail: freeze({
              postId,
              author: requireAccount(author),
              amountFluff: requirePositiveFluff(amountFluff),
              tipper: requireAccount(tipper),
              receiptId: receipt?.id ?? null,
              simulation: true,
              source: TOKEN_SOCIAL_UX_SOURCE,
            }),
          }),
        );
      }
    } catch {}
    return receipt;
  } catch (err) {
    emitToast("failed", err?.message || "Tip failed (simulated)", { error: true });
    throw err;
  }
}

export function socialDeliver({
  sender = "u:you",
  receiver,
  amountFluff,
  memo = "",
  idempotencyKey = newIdemKey("deliver"),
} = {}) {
  const facade = getFacade();
  try {
    let receipt;
    if (facade && typeof facade.act === "function") {
      receipt = facade.act(
        "deliver",
        { from: sender, to: receiver, amountFluff, memo, asset: "TUMBO" },
        idempotencyKey,
      );
    } else {
      receipt = getLocal().deliver({ sender, receiver, amountFluff, memo, idempotencyKey });
    }
    emitToast("delivery-created", `Delivery held in escrow · ${fmtFluff(amountFluff)} (simulated)`, {
      receiptId: receipt?.id,
      intentId: receipt?.intentId ?? receipt?.refs?.intentId,
      amountFluff,
    });
    return receipt;
  } catch (err) {
    emitToast("failed", err?.message || "Delivery failed (simulated)", { error: true });
    throw err;
  }
}

export function socialConfirmDelivery({
  intentId,
  actor = "u:you",
  idempotencyKey = newIdemKey("confirm"),
} = {}) {
  const facade = getFacade();
  try {
    let receipt;
    if (facade && typeof facade.act === "function") {
      receipt = facade.act("confirm", { intentId, actor }, idempotencyKey);
    } else {
      receipt = getLocal().confirmDelivery({ intentId, actor, idempotencyKey });
    }
    emitToast("delivery-confirmed", "Delivery confirmed · funds released (simulated)", {
      receiptId: receipt?.id,
      intentId,
    });
    return receipt;
  } catch (err) {
    emitToast("failed", err?.message || "Confirm failed (simulated)", { error: true });
    throw err;
  }
}

export function socialCancelDelivery({
  intentId,
  actor = "u:you",
  idempotencyKey = newIdemKey("cancel"),
} = {}) {
  const facade = getFacade();
  try {
    let receipt;
    if (facade && typeof facade.act === "function") {
      receipt = facade.act("cancel", { intentId, actor }, idempotencyKey);
    } else if (facade && typeof facade.cancel === "function") {
      receipt = facade.cancel(intentId, idempotencyKey);
    } else {
      receipt = getLocal().cancelDelivery({ intentId, actor, idempotencyKey });
    }
    emitToast("delivery-cancelled", "Delivery cancelled · funds refunded (simulated)", {
      receiptId: receipt?.id,
      intentId,
    });
    return receipt;
  } catch (err) {
    emitToast("failed", err?.message || "Cancel failed (simulated)", { error: true });
    throw err;
  }
}

export function socialBalance(acct = "u:you") {
  const facade = getFacade();
  if (facade && typeof facade.balance === "function") {
    try {
      return facade.balance(acct, "TUMBO");
    } catch {
      try {
        return facade.balance(acct);
      } catch {}
    }
  }
  return getLocal().balance(acct);
}

export function socialFmt(fluff) {
  const facade = getFacade();
  if (facade && typeof facade.fmt === "function") {
    try {
      return facade.fmt(fluff);
    } catch {}
  }
  return fmtFluff(fluff);
}

export function listPendingEscrow() {
  return getLocal().listPending();
}

export function listSocialNotifications(forAccount = "u:you") {
  return getLocal().listNotifications(forAccount);
}

export function attachTipControl(postEl, {
  tipper = "u:you",
  defaultAmount = DEFAULT_TIP_FLUFF,
  presets = TIP_PRESETS_FLUFF,
} = {}) {
  if (!postEl || postEl.dataset.tipAttached === "1") return null;
  postEl.dataset.tipAttached = "1";

  const postId = postEl.dataset.postId || postEl.getAttribute("data-post-id") || null;
  const authorRaw = postEl.dataset.author || postEl.getAttribute("data-author") || "u:alice";
  const author = requireAccount(authorRaw);

  const root = document.createElement("div");
  root.className = "tumbo-tip-control";
  root.setAttribute("data-simulation", "true");
  root.innerHTML = `
    <button type="button" class="tumbo-tip-btn" data-action="quick-tip" title="Tip ${fmtFluff(defaultAmount)} (simulated)">
      ◎ Tip
    </button>
    <div class="tumbo-tip-picker" hidden>
      <span class="tumbo-tip-label">Simulated tip</span>
      ${presets
        .map(
          (f) =>
            `<button type="button" class="tumbo-tip-preset" data-fluff="${f}">${fmtFluff(f)}</button>`,
        )
        .join("")}
    </div>
  `;

  root.querySelector('[data-action="quick-tip"]').addEventListener("click", (e) => {
    e.stopPropagation();
    const picker = root.querySelector(".tumbo-tip-picker");
    picker.hidden = !picker.hidden;
  });

  root.querySelectorAll(".tumbo-tip-preset").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const amount = Number(btn.dataset.fluff);
      try {
        socialTip({
          tipper,
          author,
          amountFluff: amount,
          postId,
          idempotencyKey: newIdemKey(`tip:${postId || "x"}:${amount}`),
        });
        root.querySelector(".tumbo-tip-picker").hidden = true;
      } catch {}
    });
  });

  postEl.appendChild(root);
  return root;
}

export function bindTipBridge({ tipper = "u:you" } = {}) {
  if (typeof document === "undefined") return () => {};
  const handler = (ev) => {
    const d = ev?.detail || {};
    if (!d.author || !Number.isSafeInteger(d.amountFluff) || d.amountFluff <= 0) return;
    if (d.source === TOKEN_SOCIAL_UX_SOURCE) return;
    try {
      socialTip({
        tipper: d.tipper || tipper,
        author: d.author,
        amountFluff: d.amountFluff,
        postId: d.postId ?? null,
        idempotencyKey: d.idempotencyKey || newIdemKey(`bridge-tip:${d.postId || "x"}`),
      });
    } catch {}
  };
  document.addEventListener(TIP_EVENT, handler);
  return () => document.removeEventListener(TIP_EVENT, handler);
}

export const DEMO_FEED_POSTS = freeze([
  {
    id: "post-river-1",
    author: "u:river",
    label: "River Commons",
    body: "Shared a new water-stewardship capsule for the local route.",
  },
  {
    id: "post-alice-1",
    author: "u:alice",
    label: "Alice",
    body: "Posted a maker note on repair tools in the northline studio.",
  },
  {
    id: "post-bob-1",
    author: "u:bob",
    label: "Bob",
    body: "Opened a discussion brief on care and accessibility signals.",
  },
]);

export function createTokenSocialUxController({ tipper = "u:you" } = {}) {
  const unbind = bindTipBridge({ tipper });
  return {
    tip: (opts) => socialTip({ tipper, ...opts }),
    deliver: (opts) => socialDeliver({ sender: tipper, ...opts }),
    confirm: (opts) => socialConfirmDelivery({ actor: tipper, ...opts }),
    cancel: (opts) => socialCancelDelivery({ actor: tipper, ...opts }),
    balance: () => socialBalance(tipper),
    fmt: socialFmt,
    pending: listPendingEscrow,
    notifications: () => listSocialNotifications(tipper),
    attachTipControl: (el, opts) => attachTipControl(el, { tipper, ...opts }),
    dispose: () => {
      try {
        unbind();
      } catch {}
    },
    simulation: true,
    source: TOKEN_SOCIAL_UX_SOURCE,
  };
}
