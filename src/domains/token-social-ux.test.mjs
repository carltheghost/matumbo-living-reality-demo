/**
 * Node unit tests for token-social-ux domain (simulation only).
 * Run: node --test src/domains/token-social-ux.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  socialTip,
  socialDeliver,
  socialConfirmDelivery,
  socialCancelDelivery,
  socialBalance,
  fmtFluff,
  newIdemKey,
  FLUFF_PER_TUMBO,
  listPendingEscrow,
} from "./token-social-ux.js";

test("fmtFluff formats integer fluff as 3dp TUMBO-SIM", () => {
  assert.equal(fmtFluff(0), "0.000 TUMBO-SIM");
  assert.equal(fmtFluff(500), "0.500 TUMBO-SIM");
  assert.equal(fmtFluff(1000), "1.000 TUMBO-SIM");
  assert.equal(fmtFluff(1234), "1.234 TUMBO-SIM");
});

test("tip debits tipper and credits author (idempotent)", () => {
  const beforeYou = socialBalance("u:you");
  const beforeAlice = socialBalance("u:alice");
  const key = newIdemKey("test-tip");
  const r1 = socialTip({
    tipper: "u:you",
    author: "u:alice",
    amountFluff: 500,
    postId: "post-test-1",
    idempotencyKey: key,
  });
  assert.equal(r1.action, "tip");
  assert.equal(r1.state, "settled");
  assert.equal(socialBalance("u:you"), beforeYou - 500);
  assert.equal(socialBalance("u:alice"), beforeAlice + 500);

  const r2 = socialTip({
    tipper: "u:you",
    author: "u:alice",
    amountFluff: 500,
    postId: "post-test-1",
    idempotencyKey: key,
  });
  assert.equal(r2.duplicate, true);
  assert.equal(socialBalance("u:you"), beforeYou - 500);
});

test("deliver holds in sys:escrow; confirm releases; cancel refunds", () => {
  const beforeYou = socialBalance("u:you");
  const beforeBob = socialBalance("u:bob");
  const beforeEscrow = socialBalance("sys:escrow");

  const holdKey = newIdemKey("test-deliver");
  const hold = socialDeliver({
    sender: "u:you",
    receiver: "u:bob",
    amountFluff: 1000,
    idempotencyKey: holdKey,
  });
  assert.equal(hold.state, "pending");
  assert.ok(hold.intentId);
  assert.equal(socialBalance("u:you"), beforeYou - 1000);
  assert.equal(socialBalance("sys:escrow"), beforeEscrow + 1000);
  assert.equal(socialBalance("u:bob"), beforeBob);

  const pending = listPendingEscrow();
  assert.ok(pending.some((p) => p.intentId === hold.intentId));

  const hold2 = socialDeliver({
    sender: "u:you",
    receiver: "u:bob",
    amountFluff: 1000,
    idempotencyKey: holdKey,
  });
  assert.equal(hold2.duplicate, true);
  assert.equal(socialBalance("sys:escrow"), beforeEscrow + 1000);

  const confKey = newIdemKey("test-confirm");
  const conf = socialConfirmDelivery({
    intentId: hold.intentId,
    actor: "u:bob",
    idempotencyKey: confKey,
  });
  assert.equal(conf.state, "settled");
  assert.equal(socialBalance("sys:escrow"), beforeEscrow);
  assert.equal(socialBalance("u:bob"), beforeBob + 1000);

  const holdB = socialDeliver({
    sender: "u:you",
    receiver: "u:alice",
    amountFluff: 2500,
    idempotencyKey: newIdemKey("test-deliver-b"),
  });
  const youMid = socialBalance("u:you");
  const cancel = socialCancelDelivery({
    intentId: holdB.intentId,
    actor: "u:you",
    idempotencyKey: newIdemKey("test-cancel"),
  });
  assert.equal(cancel.state, "cancelled");
  assert.equal(socialBalance("u:you"), youMid + 2500);
});

test("insufficient funds fail closed", () => {
  assert.throws(
    () =>
      socialTip({
        tipper: "u:you",
        author: "u:alice",
        amountFluff: 999_999_999,
        idempotencyKey: newIdemKey("fail-tip"),
      }),
    /insufficient/,
  );
});

test("FLUFF_PER_TUMBO is 1000", () => {
  assert.equal(FLUFF_PER_TUMBO, 1000);
});
