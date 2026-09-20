/**
 * Adversarial security suite for the TumboToken domain
 * (API surface from gpt/token-exchange: TokenLedger + QuoteEngine).
 *
 * Each probe reports PASS (attack rejected / fails closed), FAIL (attack
 * succeeded = hole), or SKIP (capability not present in module under test).
 *
 * After every probe we re-check shared invariants:
 *   - non-negativity (except sys:issuance which is allowNegative)
 *   - double-entry Σ0 per asset on every journal
 *   - conservation of total supply (TUMBO / sMIMAS vs CONFIG.supply)
 *   - sys:void never debited
 *
 * Integer fluff units: 1 TUMBO-SIM = 1000 fluff.
 *
 * Run (from repo root, with src/domains/token.js present):
 *   node --experimental-vm-modules tests/security/token-adversarial.test.js
 * or:
 *   node tests/security/token-adversarial.test.js
 */

import {
  CONFIG,
  ASSETS,
  QuoteEngine,
  TokenLedger,
  quoteHash,
  mulDivFloor,
  assertFluff,
  MARKET_MAKER,
  VOID_ACCOUNT,
  createTokenEngine,
} from "../../src/domains/token.js";

// ---------------------------------------------------------------------------
// Minimal runner
// ---------------------------------------------------------------------------

const results = [];

function record(id, status, evidence) {
  results.push({ id, status, evidence });
  const tag = status.padEnd(4);
  console.log(`[${tag}] ${id}: ${evidence}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// ---------------------------------------------------------------------------
// Invariant helpers (checked after every probe)
// ---------------------------------------------------------------------------

function totalSupply(engine, asset) {
  let sum = 0;
  for (const { account, asset: a } of engine.ledger.accounts()) {
    if (a !== asset) continue;
    // sys:issuance is the negative mirror; exclude it from circulating sum
    if (account === "sys:issuance") continue;
    sum += engine.ledger.balance(account, asset);
  }
  return sum;
}

function assertInvariants(engine, label) {
  const cfg = engine.config;
  // Conservation: circulating (all non-issuance) must equal CONFIG.supply
  for (const asset of ASSETS) {
    const circulating = totalSupply(engine, asset);
    const expected = cfg.supply[asset];
    assert(
      circulating === expected,
      `[${label}] supply conservation broken for ${asset}: circulating=${circulating} expected=${expected}`
    );
  }
  // Non-negativity for all opened accounts except allowNegative (issuance)
  for (const { account, asset } of engine.ledger.accounts()) {
    const bal = engine.ledger.balance(account, asset);
    if (account === "sys:issuance") {
      assert(bal <= 0, `[${label}] issuance should be <= 0, got ${bal}`);
      continue;
    }
    assert(bal >= 0, `[${label}] negative balance ${account}|${asset}=${bal}`);
  }
  // sys:void must never be negative
  for (const asset of ASSETS) {
    const v = engine.ledger.balance(VOID_ACCOUNT, asset);
    assert(v >= 0, `[${label}] sys:void negative for ${asset}: ${v}`);
  }
}

function freshEngine() {
  return new QuoteEngine({ ...CONFIG, supply: { ...CONFIG.supply }, price: { ...CONFIG.price } });
}

function fundUser(engine, acct, asset, amount) {
  // Prefer faucet when asset is TUMBO; otherwise post a balanced treasury transfer
  if (asset === "TUMBO") {
    return engine.faucet(acct, asset, amount, { idempotencyKey: `fund:${acct}:${asset}:${amount}:${Date.now()}:${Math.random()}` });
  }
  // sMIMAS lives at market; transfer from market (balanced) for tests
  return engine.ledger.post(
    [
      { account: MARKET_MAKER, asset, amount: -amount },
      { account: acct, asset, amount },
    ],
    { idempotencyKey: `fund-smimas:${acct}:${amount}:${Date.now()}:${Math.random()}`, action: "test-fund" }
  );
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

function probeForgedQuote() {
  const id = "forged-quote-execution";
  try {
    const engine = freshEngine();
    fundUser(engine, "u:alice", "TUMBO", 1_000_000);
    const q = engine.quote({
      action: "buy",
      from: "u:alice",
      fromAsset: "TUMBO",
      toAsset: "sMIMAS",
      amountIn: 10_000,
    });
    // Tamper amountOut (inflate) while keeping original hash
    const forged = {
      ...q,
      amountOut: q.amountOut * 100,
      // hash deliberately left as original
    };
    let rejected = false;
    try {
      engine.execute(forged, { idempotencyKey: "forge-1" });
    } catch (e) {
      rejected = /hash mismatch|tampered|rejected/i.test(String(e.message || e));
    }
    // Also try tampering `from`
    const forgedFrom = { ...q, from: "u:attacker" };
    let rejectedFrom = false;
    try {
      engine.execute(forgedFrom, { idempotencyKey: "forge-2" });
    } catch (e) {
      rejectedFrom = /hash mismatch|tampered|rejected|insufficient/i.test(String(e.message || e));
    }
    assertInvariants(engine, id);
    if (rejected && rejectedFrom) {
      record(id, "PASS", "execute() rejected amountOut and from forgeries via hash recompute");
    } else {
      record(
        id,
        "FAIL",
        `forged quote accepted (amountOutRejected=${rejected}, fromRejected=${rejectedFrom})`
      );
    }
  } catch (e) {
    record(id, "FAIL", `probe error: ${e.message || e}`);
  }
}

function probeQuoteReplay() {
  const id = "quote-replay-different-idem-keys";
  try {
    const engine = freshEngine();
    fundUser(engine, "u:bob", "TUMBO", 5_000_000);
    const q = engine.quote({
      action: "buy",
      from: "u:bob",
      fromAsset: "TUMBO",
      toAsset: "sMIMAS",
      amountIn: 100_000,
    });
    const r1 = engine.execute(q, { idempotencyKey: "replay-key-a" });
    const balAfter = engine.ledger.balance("u:bob", "TUMBO");
    let secondRejected = false;
    try {
      engine.execute(q, { idempotencyKey: "replay-key-b" }); // same quote id, new key
    } catch (e) {
      secondRejected = /already been executed|rejected/i.test(String(e.message || e));
    }
    const balFinal = engine.ledger.balance("u:bob", "TUMBO");
    assertInvariants(engine, id);
    if (secondRejected && balFinal === balAfter && r1) {
      record(id, "PASS", "second execute of same quote id under new key rejected; balances unchanged");
    } else {
      record(
        id,
        "FAIL",
        `replay succeeded or balances moved (rejected=${secondRejected}, balAfter=${balAfter}, balFinal=${balFinal})`
      );
    }
  } catch (e) {
    record(id, "FAIL", `probe error: ${e.message || e}`);
  }
}

function probeExpiredQuote() {
  const id = "expired-quote";
  try {
    const engine = freshEngine();
    fundUser(engine, "u:carol", "TUMBO", 1_000_000);
    const q = engine.quote({
      action: "buy",
      from: "u:carol",
      fromAsset: "TUMBO",
      toAsset: "sMIMAS",
      amountIn: 10_000,
      ttlMs: -1, // already expired relative to Date.now()
    });
    // Force expiresAt in the past and re-hash so shape is valid but expired
    const expired = {
      id: q.id,
      action: q.action,
      from: q.from,
      to: q.to,
      fromAsset: q.fromAsset,
      toAsset: q.toAsset,
      amountIn: q.amountIn,
      amountOut: q.amountOut,
      expiresAt: Date.now() - 60_000,
    };
    expired.hash = quoteHash(expired);
    let rejected = false;
    try {
      engine.execute(expired, { idempotencyKey: "expired-1" });
    } catch (e) {
      rejected = /expired|rejected/i.test(String(e.message || e));
    }
    assertInvariants(engine, id);
    if (rejected) {
      record(id, "PASS", "execute() rejected quote with expiresAt in the past");
    } else {
      record(id, "FAIL", "expired quote was accepted");
    }
  } catch (e) {
    record(id, "FAIL", `probe error: ${e.message || e}`);
  }
}

function probeIdempotencyCrossIntent() {
  const id = "idempotency-key-reuse-cross-intent";
  try {
    const engine = freshEngine();
    fundUser(engine, "u:dave", "TUMBO", 2_000_000);
    const key = "shared-idem-key-cross-intent";
    // First intent: balanced post from faucet path via ledger
    const first = engine.ledger.post(
      [
        { account: "sys:faucet", asset: "TUMBO", amount: -1_000 },
        { account: "u:dave", asset: "TUMBO", amount: 1_000 },
      ],
      { idempotencyKey: key, action: "first-intent" }
    );
    const balAfterFirst = engine.ledger.balance("u:dave", "TUMBO");
    // Second intent: different postings, SAME key — must return original receipt, not apply new intent
    const second = engine.ledger.post(
      [
        { account: "sys:faucet", asset: "TUMBO", amount: -500_000 },
        { account: "u:dave", asset: "TUMBO", amount: 500_000 },
      ],
      { idempotencyKey: key, action: "second-intent-theft" }
    );
    const balAfterSecond = engine.ledger.balance("u:dave", "TUMBO");
    assertInvariants(engine, id);
    const sameReceipt = second.id === first.id && second.action === first.action;
    const noExtraCredit = balAfterSecond === balAfterFirst;
    if (sameReceipt && noExtraCredit) {
      record(id, "PASS", "same idempotency key returned original receipt; second intent not applied");
    } else {
      record(
        id,
        "FAIL",
        `cross-intent reuse applied new funds (sameReceipt=${sameReceipt}, bal1=${balAfterFirst}, bal2=${balAfterSecond})`
      );
    }
  } catch (e) {
    record(id, "FAIL", `probe error: ${e.message || e}`);
  }
}

function probeUngatedSysDebitViaQuote() {
  const id = "ungated-sys-debit-via-quote-execute";
  try {
    const engine = freshEngine();
    // Attempt to issue a quote FROM a system account (treasury/market/faucet)
    const targets = ["sys:treasury", "sys:market", "sys:faucet"];
    let anyAccepted = false;
    const details = [];
    for (const from of targets) {
      try {
        const q = engine.quote({
          action: "buy",
          from,
          fromAsset: "TUMBO",
          toAsset: "sMIMAS",
          amountIn: 1_000,
        });
        // If quote was issued, try execute
        engine.execute(q, { idempotencyKey: `sys-debit-${from}` });
        anyAccepted = true;
        details.push(`${from}:quote+execute accepted`);
      } catch (e) {
        details.push(`${from}:rejected (${String(e.message || e).slice(0, 80)})`);
      }
    }
    assertInvariants(engine, id);
    if (!anyAccepted) {
      record(id, "PASS", `quote/execute refused sys accounts as taker: ${details.join("; ")}`);
    } else {
      record(id, "FAIL", `sys account quote/execute succeeded: ${details.join("; ")}`);
    }
  } catch (e) {
    record(id, "FAIL", `probe error: ${e.message || e}`);
  }
}

function probeDirectSysDebitOutsideFlows() {
  const id = "direct-debit-sys-escrow-vault-void";
  try {
    const engine = freshEngine();
    // Seed a positive balance into escrow/vault so a debit is meaningful
    engine.ledger.post(
      [
        { account: "sys:treasury", asset: "TUMBO", amount: -50_000 },
        { account: "sys:escrow", asset: "TUMBO", amount: 50_000 },
      ],
      { idempotencyKey: "seed-escrow", action: "seed" }
    );
    engine.ledger.post(
      [
        { account: "sys:treasury", asset: "TUMBO", amount: -50_000 },
        { account: "sys:vault", asset: "TUMBO", amount: 50_000 },
      ],
      { idempotencyKey: "seed-vault", action: "seed" }
    );

    // 1) Direct debit of sys:void must be rejected
    let voidDebitRejected = false;
    try {
      engine.ledger.post(
        [
          { account: VOID_ACCOUNT, asset: "TUMBO", amount: -1 },
          { account: "u:eve", asset: "TUMBO", amount: 1 },
        ],
        { idempotencyKey: "void-debit-1", action: "steal-void" }
      );
    } catch (e) {
      voidDebitRejected = /void is never debited/i.test(String(e.message || e));
    }

    // 2) Ungated balanced debit of escrow → user (no permission layer)
    let escrowDebitAccepted = false;
    try {
      engine.ledger.post(
        [
          { account: "sys:escrow", asset: "TUMBO", amount: -10_000 },
          { account: "u:eve", asset: "TUMBO", amount: 10_000 },
        ],
        { idempotencyKey: "escrow-drain-1", action: "drain-escrow" }
      );
      escrowDebitAccepted = true;
    } catch (e) {
      escrowDebitAccepted = false;
    }

    // 3) Ungated balanced debit of vault → user
    let vaultDebitAccepted = false;
    try {
      engine.ledger.post(
        [
          { account: "sys:vault", asset: "TUMBO", amount: -10_000 },
          { account: "u:eve", asset: "TUMBO", amount: 10_000 },
        ],
        { idempotencyKey: "vault-drain-1", action: "drain-vault" }
      );
      vaultDebitAccepted = true;
    } catch (e) {
      vaultDebitAccepted = false;
    }

    assertInvariants(engine, id);

    // Void debit rejection is required PASS.
    // Escrow/vault ungated debit via ledger.post is a FINDING if accepted
    // (there is no permission gate on TokenLedger.post itself).
    if (!voidDebitRejected) {
      record(id, "FAIL", "sys:void debit was accepted (must always reject)");
      return;
    }
    if (escrowDebitAccepted || vaultDebitAccepted) {
      record(
        id,
        "FAIL",
        `TokenLedger.post allows ungated balanced drain of protected accounts (escrowAccepted=${escrowDebitAccepted}, vaultAccepted=${vaultDebitAccepted}). No permission/role gate on post().`
      );
    } else {
      record(id, "PASS", "void debit rejected; escrow/vault drains also rejected");
    }
  } catch (e) {
    record(id, "FAIL", `probe error: ${e.message || e}`);
  }
}

function probeVaultDoubleRelease() {
  const id = "vault-double-release";
  // gpt/token-exchange has no lock/unlock API — only the account name sys:vault
  try {
    const engine = freshEngine();
    const hasLock = typeof engine.lock === "function" || typeof engine.ledger?.lock === "function";
    const hasUnlock = typeof engine.unlock === "function" || typeof engine.ledger?.unlock === "function";
    if (!hasLock || !hasUnlock) {
      record(
        id,
        "SKIP",
        "module under test (gpt/token-exchange) has no vault lock/unlock methods; capability lives only on gpt/token-block-ui"
      );
      return;
    }
    record(id, "FAIL", "unexpected: lock/unlock present but probe not fully implemented for this shape");
  } catch (e) {
    record(id, "FAIL", `probe error: ${e.message || e}`);
  }
}

function probeNegativeZeroAmounts() {
  const id = "negative-and-zero-amounts";
  try {
    const engine = freshEngine();
    fundUser(engine, "u:frank", "TUMBO", 100_000);
    let zeroRejected = false;
    let negRejected = false;
    try {
      engine.quote({
        action: "buy",
        from: "u:frank",
        fromAsset: "TUMBO",
        toAsset: "sMIMAS",
        amountIn: 0,
      });
    } catch (e) {
      zeroRejected = /positive|must be/i.test(String(e.message || e));
    }
    try {
      engine.quote({
        action: "buy",
        from: "u:frank",
        fromAsset: "TUMBO",
        toAsset: "sMIMAS",
        amountIn: -100,
      });
    } catch (e) {
      negRejected = /non-negative|safe integer|positive|TypeError/i.test(String(e.message || e));
    }
    // ledger post with zero-sum zero amounts should still require valid shape
    let postNegRejected = false;
    try {
      engine.ledger.post(
        [
          { account: "u:frank", asset: "TUMBO", amount: -1 },
          { account: "u:frank", asset: "TUMBO", amount: 1 },
        ],
        { idempotencyKey: "neg-ok-balanced" }
      );
      // balanced ±1 is fine; try pure negative unbalance
      engine.ledger.post(
        [{ account: "u:frank", asset: "TUMBO", amount: -5 }],
        { idempotencyKey: "neg-unbalanced" }
      );
    } catch (e) {
      postNegRejected = /sum to zero|insufficient/i.test(String(e.message || e));
    }
    assertInvariants(engine, id);
    if (zeroRejected && negRejected && postNegRejected) {
      record(id, "PASS", "zero/negative quote amounts rejected; unbalanced negative post rejected");
    } else {
      record(
        id,
        "FAIL",
        `amount validation hole (zeroRejected=${zeroRejected}, negRejected=${negRejected}, postNegRejected=${postNegRejected})`
      );
    }
  } catch (e) {
    record(id, "FAIL", `probe error: ${e.message || e}`);
  }
}

function probeUnsafeInteger() {
  const id = "unsafe-integer-amounts";
  try {
    const engine = freshEngine();
    fundUser(engine, "u:gina", "TUMBO", 100_000);
    const huge = Number.MAX_SAFE_INTEGER + 1;
    let rejected = false;
    try {
      engine.quote({
        action: "buy",
        from: "u:gina",
        fromAsset: "TUMBO",
        toAsset: "sMIMAS",
        amountIn: huge,
      });
    } catch (e) {
      rejected = /safe integer|TypeError|RangeError/i.test(String(e.message || e));
    }
    let postRejected = false;
    try {
      engine.ledger.post(
        [
          { account: "sys:faucet", asset: "TUMBO", amount: -huge },
          { account: "u:gina", asset: "TUMBO", amount: huge },
        ],
        { idempotencyKey: "unsafe-post" }
      );
    } catch (e) {
      postRejected = /safe integer|TypeError|RangeError/i.test(String(e.message || e));
    }
    assertInvariants(engine, id);
    if (rejected && postRejected) {
      record(id, "PASS", "amounts above MAX_SAFE_INTEGER rejected by assertFluff/assertSignedFluff");
    } else {
      record(id, "FAIL", `unsafe integer accepted (quoteRejected=${rejected}, postRejected=${postRejected})`);
    }
  } catch (e) {
    record(id, "FAIL", `probe error: ${e.message || e}`);
  }
}

function probeFloatRoundingTheft() {
  const id = "float-math-rounding-theft";
  try {
    // Direct float inputs must be rejected
    let floatRejected = false;
    try {
      assertFluff(0.1 + 0.2);
    } catch (e) {
      floatRejected = /safe integer|non-negative/i.test(String(e.message || e));
    }

    // Tithe accumulation: many tiny swaps — floor rounding must not mint value
    const engine = freshEngine();
    fundUser(engine, "u:harry", "TUMBO", 10_000_000);
    const beforeTumbo = totalSupply(engine, "TUMBO");
    const beforeSmimas = totalSupply(engine, "sMIMAS");
    const voidBefore = engine.ledger.balance(VOID_ACCOUNT, "TUMBO");

    // amountIn such that tithe floors to 0 repeatedly (amountIn < 1000 for 10bps)
    const n = 50;
    for (let i = 0; i < n; i++) {
      const q = engine.quote({
        action: "buy",
        from: "u:harry",
        fromAsset: "TUMBO",
        toAsset: "sMIMAS",
        amountIn: 500, // tithe = floor(500*10/10000)=0
      });
      engine.execute(q, { idempotencyKey: `tiny-${i}` });
    }

    const afterTumbo = totalSupply(engine, "TUMBO");
    const afterSmimas = totalSupply(engine, "sMIMAS");
    const voidAfter = engine.ledger.balance(VOID_ACCOUNT, "TUMBO");
    assertInvariants(engine, id);

    const supplyIntact = afterTumbo === beforeTumbo && afterSmimas === beforeSmimas;
    // With amountIn=500, tithe always 0; void should be unchanged
    const voidOk = voidAfter === voidBefore;
    // mulDivFloor is exact integer — float never used on funds
    const mulDivOk = mulDivFloor(10_000, 10, 10_000) === 10;

    if (floatRejected && supplyIntact && voidOk && mulDivOk) {
      record(
        id,
        "PASS",
        `float inputs rejected; ${n} tiny swaps conserved supply; mulDivFloor exact; void tithe floor did not mint`
      );
    } else {
      record(
        id,
        "FAIL",
        `rounding/float hole (floatRejected=${floatRejected}, supplyIntact=${supplyIntact}, voidOk=${voidOk}, mulDivOk=${mulDivOk})`
      );
    }
  } catch (e) {
    record(id, "FAIL", `probe error: ${e.message || e}`);
  }
}

function probeJournalTamperChain() {
  const id = "journal-tamper-chain-break";
  try {
    const engine = freshEngine();
    // Module has no EchoProof / hash-chained journal. Receipts are frozen objects
    // in an array, but there is no verify/chain API.
    const hasEcho =
      typeof engine.verifyJournal === "function" ||
      typeof engine.ledger.verify === "function" ||
      typeof engine.ledger.chainRoot === "function";
    if (!hasEcho) {
      // Demonstrate that mutating the internal journals array is possible if
      // caller reaches into private state — and no detector fires.
      fundUser(engine, "u:iris", "TUMBO", 10_000);
      const before = engine.ledger.journalCount();
      // Reach into private _journals if present (defense-in-depth check)
      if (Array.isArray(engine.ledger._journals) && engine.ledger._journals.length > 0) {
        const last = engine.ledger._journals[engine.ledger._journals.length - 1];
        // Receipt is Object.freeze'd — mutation of top-level fields should throw in strict mode
        let frozen = false;
        try {
          last.memo = "tampered";
        } catch {
          frozen = true;
        }
        // Even if freeze holds, absence of a hash chain is a missing control
        record(
          id,
          "SKIP",
          `no EchoProof/hash-chain on TokenLedger journals (receipts are frozen=${frozen}, journalCount=${before}); missing control vs ledger-core/echoproof.js`
        );
      } else {
        record(id, "SKIP", "no EchoProof/hash-chain API on QuoteEngine/TokenLedger");
      }
      return;
    }
    record(id, "FAIL", "unexpected chain API present but probe incomplete");
  } catch (e) {
    record(id, "FAIL", `probe error: ${e.message || e}`);
  }
}

function probeDoubleReverse() {
  const id = "double-reverse";
  try {
    const engine = freshEngine();
    const hasReverse =
      typeof engine.reverse === "function" ||
      typeof engine.ledger.reverse === "function" ||
      typeof engine.cancel === "function";
    if (!hasReverse) {
      record(
        id,
        "SKIP",
        "no reverse/cancel method on QuoteEngine/TokenLedger (header lists reverse|cancel as future actions only)"
      );
      return;
    }
    record(id, "FAIL", "unexpected reverse API present but probe incomplete");
  } catch (e) {
    record(id, "FAIL", `probe error: ${e.message || e}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=== TumboToken adversarial suite ===");
console.log(`CONFIG.supply TUMBO=${CONFIG.supply.TUMBO} sMIMAS=${CONFIG.supply.sMIMAS}`);
console.log(`tithe=${CONFIG.titheBps}bps  quoteTtlMs=${CONFIG.quoteTtlMs}`);
console.log("");

probeForgedQuote();
probeQuoteReplay();
probeExpiredQuote();
probeIdempotencyCrossIntent();
probeUngatedSysDebitViaQuote();
probeDirectSysDebitOutsideFlows();
probeVaultDoubleRelease();
probeNegativeZeroAmounts();
probeUnsafeInteger();
probeFloatRoundingTheft();
probeJournalTamperChain();
probeDoubleReverse();

console.log("");
console.log("=== Summary ===");
const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
for (const r of results) {
  counts[r.status] = (counts[r.status] || 0) + 1;
  console.log(`${r.status}\t${r.id}\t${r.evidence}`);
}
console.log("");
console.log(`PASS=${counts.PASS} FAIL=${counts.FAIL} SKIP=${counts.SKIP}`);

// Exit non-zero only if the runner itself broke; FAILs are findings, not suite bugs.
process.exit(0);
