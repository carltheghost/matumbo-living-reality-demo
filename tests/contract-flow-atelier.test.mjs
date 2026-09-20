import assert from "node:assert/strict";
import { test } from "node:test";
import { createContractAtelierConsole } from "../src/render/contract-atelier.js";
import { createProposalQueue } from "../src/domains/bot-plaza.js";
import { createOutcomeContracts } from "../src/domains/outcome-contracts.js";

const MOUNT_IDS = [
  "contract-atelier-console", "contract-atelier-close", "contract-atelier-status",
  "contract-atelier-list", "contract-atelier-detail", "contract-atelier-type",
  "contract-atelier-role", "contract-atelier-topic", "contract-atelier-title-input",
  "contract-atelier-logic-kind", "contract-atelier-prop-a", "contract-atelier-prop-b",
  "contract-atelier-prop-c", "contract-atelier-outcomes", "contract-atelier-create",
  "contract-atelier-reset", "contract-atelier-trace", "contract-atelier-boundary",
  "contract-atelier-review",
];

function fakeDocument() {
  const makeEl = (id) => {
    const el = {
      id,
      children: [],
      dataset: {},
      className: "",
      value: "",
      textContent: "",
      hidden: false,
      disabled: false,
      listeners: {},
      append(...nodes) { this.children.push(...nodes); return this; },
      replaceChildren() { this.children = []; },
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
      setAttribute() {},
      click(type = "click") { for (const fn of this.listeners[type] ?? []) fn({}); },
    };
    return el;
  };
  const byId = new Map(MOUNT_IDS.map((id) => [id, makeEl(id)]));
  return {
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => byId.get(id) ?? null,
    __byId: byId,
  };
}

function findAll(root, predicate, out = []) {
  if (!root || !Array.isArray(root.children)) return out;
  for (const child of root.children) {
    if (predicate(child)) out.push(child);
    findAll(child, predicate, out);
  }
  return out;
}

function harness({ onContractApproved = null, onScanRequested = null } = {}) {
  const documentRoot = fakeDocument();
  const proposalQueue = createProposalQueue({ storage: null, now: () => new Date() });
  const outcomeDesk = createOutcomeContracts({ seed: "atelier-seam-test" });
  createContractAtelierConsole({
    documentRoot,
    proposalQueue,
    outcomeDesk,
    onContractApproved,
    onScanRequested,
  });
  return { documentRoot, proposalQueue, outcomeDesk };
}

function submitDraft(proposalQueue) {
  return proposalQueue.submitProposal(
    { botId: "contract-scout", botName: "Contract Scout" },
    {
      title: "Arsenal vs Chelsea",
      eventLabel: "Arsenal vs Chelsea",
      eventId: "game-1",
      outcomes: ["Arsenal", "Chelsea"],
      sourceNotes: "Odds info (read-only): Kalshi 62% Yes · fresh ≤15 min · simulated TUMBO points",
      researchNotes: "English Premier League · starts 2026-09-20 · auto-draft from ESPN",
    },
  );
}

function approveButton(documentRoot) {
  const reviewEl = documentRoot.getElementById("contract-atelier-review");
  const buttons = findAll(reviewEl, (node) => node.className === "contract-atelier-action" && node.textContent === "APPROVE");
  return buttons[0] ?? null;
}

function scanButton(documentRoot) {
  const reviewEl = documentRoot.getElementById("contract-atelier-review");
  const buttons = findAll(reviewEl, (node) => node.className === "contract-atelier-scan-button");
  return buttons[0] ?? null;
}

test("approve fires onContractApproved with the created contract and proposal", () => {
  const seen = [];
  const { documentRoot, proposalQueue, outcomeDesk } = harness({
    onContractApproved: (payload) => seen.push(payload),
  });
  const proposal = submitDraft(proposalQueue);
  const button = approveButton(documentRoot);
  assert.ok(button, "expected an APPROVE button on the review card");
  button.click();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].proposal.id, proposal.id);
  assert.ok(seen[0].contract?.id, "hook must receive the created desk contract");
  const deskContract = outcomeDesk.get(seen[0].contract.id);
  assert.ok(deskContract, "approval must open the book on the outcome desk");
  assert.equal(deskContract.status, "open");
  assert.equal(proposalQueue.getProposals().find((p) => p.id === proposal.id).status, "approved");
});

test("a throwing approval hook never unwinds the approval", () => {
  const { documentRoot, proposalQueue, outcomeDesk } = harness({
    onContractApproved: () => { throw new Error("hook exploded"); },
  });
  const proposal = submitDraft(proposalQueue);
  const button = approveButton(documentRoot);
  assert.ok(button);
  button.click(); // must not throw
  const decided = proposalQueue.getProposals().find((p) => p.id === proposal.id);
  assert.equal(decided.status, "approved");
  assert.ok(outcomeDesk.list().length > 0, "desk contract still created");
});

test("scan button appears only when onScanRequested is wired", () => {
  const without = harness();
  assert.equal(scanButton(without.documentRoot), null, "no scan control without the seam");
  const withScan = harness({ onScanRequested: async () => ({ proposals: [], drafts: [], errors: [] }) });
  assert.ok(scanButton(withScan.documentRoot), "scan control renders when the seam is wired");
});

test("scan button calls onScanRequested and reports the queue count", async () => {
  const calls = [];
  const { documentRoot } = harness({
    onScanRequested: async () => { calls.push(true); return { proposals: [{ id: "p1" }], drafts: [], errors: [] }; },
  });
  const button = scanButton(documentRoot);
  assert.ok(button);
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.length, 1);
  const statusEl = documentRoot.getElementById("contract-atelier-status");
  assert.match(statusEl.textContent, /1 DRAFT.*QUEUED FOR REVIEW/);
});

test("scan failure reports honestly and leaves the queue intact", async () => {
  const { documentRoot, proposalQueue } = harness({
    onScanRequested: async () => { throw new Error("ESPN down"); },
  });
  const before = proposalQueue.getProposals().length;
  const button = scanButton(documentRoot);
  assert.ok(button);
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const statusEl = documentRoot.getElementById("contract-atelier-status");
  assert.match(statusEl.textContent, /SCAN FAILED/);
  assert.match(statusEl.textContent, /QUEUE UNAFFECTED/);
  assert.equal(proposalQueue.getProposals().length, before);
});

test("the review card renders the odds SOURCES line", () => {
  const { documentRoot, proposalQueue } = harness();
  submitDraft(proposalQueue);
  const reviewEl = documentRoot.getElementById("contract-atelier-review");
  const sources = findAll(reviewEl, (node) => node.className === "contract-atelier-kv-value"
    && String(node.textContent).includes("Kalshi 62%"));
  assert.ok(sources.length > 0, "expected the odds line on the review card's SOURCES row");
});
