import assert from "node:assert/strict";
import { test } from "node:test";
import { createContractAtelier } from "../src/domains/contract-atelier.js";
import { createOutcomeContracts } from "../src/domains/outcome-contracts.js";
import { createContractAtelierConsole } from "../src/render/contract-atelier.js";

const FIXED_NOW = "2026-09-18T12:00:00.000Z";

/**
 * Faithful in-memory stand-in for the bot-plaza `createProposalQueue`
 * (sibling worker). Implements the exact API the renderer codes against,
 * including the permitted-field validation on updateProposal.
 */
function fakeProposalQueue({ now = () => FIXED_NOW } = {}) {
  const PERMITTED = ["title", "eventLabel", "outcomes", "minStake", "maxStake", "sourceNotes", "researchNotes", "expiresAt"];
  const proposals = new Map();
  const listeners = new Set();
  let counter = 0;
  const emit = () => { for (const fn of [...listeners]) fn(); };
  const clone = (record) => ({
    ...record,
    outcomes: [...record.outcomes],
    history: record.history.map((entry) => ({ ...entry })),
  });
  const queue = {
    submitProposal({ botId, botName }, proposal) {
      counter += 1;
      const id = `prop:${String(counter).padStart(4, "0")}`;
      const record = {
        id,
        botId: String(botId),
        botName: String(botName),
        title: String(proposal.title ?? ""),
        eventLabel: String(proposal.eventLabel ?? ""),
        eventId: proposal.eventId ?? null,
        outcomes: [...(proposal.outcomes ?? [])],
        minStake: proposal.minStake ?? null,
        maxStake: proposal.maxStake ?? null,
        sourceNotes: proposal.sourceNotes ?? "",
        researchNotes: proposal.researchNotes ?? "",
        expiresAt: proposal.expiresAt ?? null,
        status: "pending",
        history: [],
        createdAt: now(),
      };
      proposals.set(id, record);
      emit();
      return clone(record);
    },
    getProposals({ status } = {}) {
      const all = [...proposals.values()].map(clone);
      return status ? all.filter((record) => record.status === status) : all;
    },
    getProposal(id) {
      const record = proposals.get(String(id));
      return record ? clone(record) : null;
    },
    updateProposal(id, patch, { by } = {}) {
      const record = proposals.get(String(id));
      if (!record) throw new TypeError("unknown proposal id");
      if (record.status !== "pending") throw new TypeError("only pending proposals can be edited");
      for (const key of Object.keys(patch ?? {})) {
        if (!PERMITTED.includes(key)) throw new TypeError(`field not editable: ${key}`);
      }
      const next = { ...record, ...(patch ?? {}) };
      if (patch?.outcomes) next.outcomes = [...patch.outcomes];
      next.history = [...record.history, { action: "edit", by: by ?? "unknown", at: now(), fields: Object.keys(patch ?? {}) }];
      proposals.set(id, next);
      emit();
      return clone(next);
    },
    setProposalStatus(id, status, { by, note } = {}) {
      const record = proposals.get(String(id));
      if (!record) throw new TypeError("unknown proposal id");
      if (!["approved", "dismissed"].includes(status)) throw new TypeError(`cannot set status: ${status}`);
      const next = {
        ...record,
        status,
        history: [...record.history, { action: status, by: by ?? "unknown", note: note ?? "", at: now() }],
      };
      proposals.set(id, next);
      emit();
      return clone(next);
    },
    dismissProposal(id, { by } = {}) {
      return queue.setProposalStatus(id, "dismissed", { by });
    },
    clear() {
      proposals.clear();
      counter = 0;
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return queue;
}

function interactiveDocument() {
  const created = [];
  function makeEl(tag = "", id = "") {
    const el = {
      tagName: tag,
      id,
      className: "",
      children: [],
      dataset: {},
      value: "",
      textContent: "",
      type: "",
      min: "",
      placeholder: "",
      hidden: false,
      disabled: false,
      handlers: {},
      append(...nodes) { this.children.push(...nodes); return this; },
      replaceChildren() { this.children = []; },
      addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute() {},
      click() { if (typeof this.handlers.click === "function") this.handlers.click(); },
    };
    created.push(el);
    return el;
  }
  const mountIds = [
    "contract-atelier-console", "contract-atelier-close", "contract-atelier-status",
    "contract-atelier-list", "contract-atelier-detail", "contract-atelier-type",
    "contract-atelier-role", "contract-atelier-topic", "contract-atelier-title-input",
    "contract-atelier-logic-kind", "contract-atelier-prop-a", "contract-atelier-prop-b",
    "contract-atelier-prop-c", "contract-atelier-outcomes", "contract-atelier-create",
    "contract-atelier-reset", "contract-atelier-trace", "contract-atelier-boundary",
    "contract-atelier-review",
  ];
  const byId = new Map(mountIds.map((id) => [id, makeEl("div", id)]));
  return {
    created,
    byId: (id) => byId.get(id) ?? null,
    createElement: (tag) => makeEl(tag, ""),
    getElementById: (id) => byId.get(id) ?? null,
  };
}

function fakeDocument(missing = []) {
  const doc = interactiveDocument();
  return {
    createElement: doc.createElement,
    getElementById: (id) => (missing.includes(id) ? null : doc.getElementById(id)),
  };
}

function lastButton(doc, text) {
  const matches = doc.created.filter((el) => el.tagName === "button" && el.textContent === text);
  assert.ok(matches.length > 0, `expected a "${text}" button in the rendered console`);
  return matches[matches.length - 1];
}

function lastInput(doc, placeholder) {
  const matches = doc.created.filter((el) => el.tagName === "input" && el.placeholder === placeholder);
  assert.ok(matches.length > 0, `expected an input with placeholder "${placeholder}"`);
  return matches[matches.length - 1];
}

function subtreeText(node) {
  let text = String(node.textContent ?? "");
  for (const child of node.children ?? []) text += ` ${subtreeText(child)}`;
  return text;
}

function submitScoutProposal(queue, overrides = {}) {
  return queue.submitProposal({ botId: "scout", botName: "Scout" }, {
    title: "Derby rematch — who takes it?",
    eventLabel: "Sunday derby",
    eventId: "evt:derby-3",
    outcomes: ["HOME", "AWAY"],
    minStake: 10,
    maxStake: 500,
    sourceNotes: "form table",
    researchNotes: "home side strong at home",
    expiresAt: null,
    ...overrides,
  });
}

test("missing review mount point keeps the mount-points throw", () => {
  assert.throws(
    () => createContractAtelierConsole({ documentRoot: fakeDocument(["contract-atelier-review"]) }),
    /mount points are missing/,
  );
});

test("missing proposal queue does not crash and shows the unwired note", () => {
  const doc = interactiveDocument();
  const consoleApi = createContractAtelierConsole({ documentRoot: doc });
  assert.ok(
    subtreeText(doc.byId("contract-atelier-review")).includes("No proposal queue wired"),
    "review section explains the queue is not wired",
  );
  assert.equal(consoleApi.getSnapshot().reviewQueue, null);
  assert.equal(consoleApi.getReviewQueue(), null);
});

test("injected outcome desk is used instead of the internal one", () => {
  const doc = interactiveDocument();
  const desk = createOutcomeContracts({ seed: "shared-desk" });
  const consoleApi = createContractAtelierConsole({ documentRoot: doc, outcomeDesk: desk });
  assert.equal(consoleApi.getOutcomeSnapshot().seed, "shared-desk");
});

test("approve creates a contract on the desk and marks the proposal approved", () => {
  const doc = interactiveDocument();
  const queue = fakeProposalQueue();
  const desk = createOutcomeContracts({ seed: "approve-test" });
  const seen = [];
  const consoleApi = createContractAtelierConsole({
    documentRoot: doc,
    atelier: createContractAtelier({ seed: "approve-atelier" }),
    proposalQueue: queue,
    outcomeDesk: desk,
    onSelect: (snapshot) => seen.push(snapshot),
  });
  const proposal = submitScoutProposal(queue);
  lastButton(doc, "APPROVE").click();
  const created = desk.list().find((contract) => contract.eventId === "evt:derby-3");
  assert.ok(created, "a contract was created on the shared desk");
  assert.equal(created.eventLabel, "Sunday derby");
  assert.deepEqual([...created.outcomes], ["HOME", "AWAY"]);
  assert.equal(created.creator, "bot:Scout");
  assert.equal(created.status, "open");
  assert.equal(queue.getProposal(proposal.id).status, "approved");
  assert.match(doc.byId("contract-atelier-status").textContent, /APPROVED/);
  assert.equal(seen[seen.length - 1].action, "review-approve");
  assert.deepEqual(consoleApi.getSnapshot().reviewQueue, { wired: true, pending: 0, decided: 1 });
});

test("approve failure shows the error and leaves the proposal pending", () => {
  const doc = interactiveDocument();
  const queue = fakeProposalQueue();
  const failingDesk = {
    createContract() { throw new TypeError("desk exploded"); },
    list: () => [],
    get: () => null,
    join() { throw new TypeError("no"); },
    recordResult() { throw new TypeError("no"); },
    listNfts: () => [],
    reset() {},
    getSnapshot: () => ({}),
  };
  createContractAtelierConsole({ documentRoot: doc, proposalQueue: queue, outcomeDesk: failingDesk });
  const proposal = submitScoutProposal(queue);
  lastButton(doc, "APPROVE").click();
  assert.match(doc.byId("contract-atelier-status").textContent, /APPROVE BLOCKED/);
  assert.equal(queue.getProposal(proposal.id).status, "pending");
});

test("edit changes the permitted draft fields and records history", () => {
  const doc = interactiveDocument();
  const queue = fakeProposalQueue();
  const desk = createOutcomeContracts({ seed: "edit-test" });
  const seen = [];
  createContractAtelierConsole({
    documentRoot: doc,
    proposalQueue: queue,
    outcomeDesk: desk,
    onSelect: (snapshot) => seen.push(snapshot),
  });
  const proposal = submitScoutProposal(queue);
  lastButton(doc, "EDIT").click();
  lastInput(doc, "Title").value = "Derby rematch — revised";
  lastInput(doc, "Outcomes (comma-separated)").value = "HOME, AWAY, DRAW";
  lastInput(doc, "Min stake (blank = none)").value = "25";
  lastButton(doc, "SAVE CHANGES").click();
  const updated = queue.getProposal(proposal.id);
  assert.equal(updated.title, "Derby rematch — revised");
  assert.deepEqual(updated.outcomes, ["HOME", "AWAY", "DRAW"]);
  assert.equal(updated.minStake, 25);
  assert.equal(updated.status, "pending");
  const editEntry = updated.history.find((entry) => entry.action === "edit");
  assert.ok(editEntry, "history records the edit");
  assert.equal(editEntry.by, "user");
  assert.ok(editEntry.fields.includes("title"), "history records the changed fields");
  assert.equal(seen[seen.length - 1].action, "review-edit");
});

test("edit validation errors show inline and keep the draft pending", () => {
  const doc = interactiveDocument();
  const queue = fakeProposalQueue();
  createContractAtelierConsole({
    documentRoot: doc,
    proposalQueue: queue,
    outcomeDesk: createOutcomeContracts({ seed: "edit-invalid" }),
  });
  const proposal = submitScoutProposal(queue);
  lastButton(doc, "EDIT").click();
  lastInput(doc, "Min stake (blank = none)").value = "not-a-number";
  lastButton(doc, "SAVE CHANGES").click();
  const errors = doc.created.filter((el) =>
    String(el.className || "").includes("contract-atelier-review-error") && String(el.textContent || "").length > 0);
  assert.ok(errors.length > 0, "an inline validation error is shown");
  assert.match(errors[errors.length - 1].textContent, /Min stake/);
  assert.equal(queue.getProposal(proposal.id).status, "pending");
  assert.equal(queue.getProposal(proposal.id).minStake, 10);
});

test("edit of an illegal field or a decided proposal throws", () => {
  const queue = fakeProposalQueue();
  const proposal = submitScoutProposal(queue);
  assert.throws(
    () => queue.updateProposal(proposal.id, { status: "approved" }, { by: "user" }),
    /not editable/,
  );
  assert.throws(
    () => queue.updateProposal(proposal.id, { history: [] }, { by: "user" }),
    /not editable/,
  );
  queue.setProposalStatus(proposal.id, "approved", { by: "user" });
  assert.throws(
    () => queue.updateProposal(proposal.id, { title: "Too late" }, { by: "user" }),
    /pending/,
  );
});

test("dismiss marks the proposal dismissed and moves it to the decided list", () => {
  const doc = interactiveDocument();
  const queue = fakeProposalQueue();
  const seen = [];
  createContractAtelierConsole({
    documentRoot: doc,
    proposalQueue: queue,
    outcomeDesk: createOutcomeContracts({ seed: "dismiss-test" }),
    onSelect: (snapshot) => seen.push(snapshot),
  });
  const proposal = submitScoutProposal(queue);
  lastButton(doc, "DISMISS").click();
  assert.equal(queue.getProposal(proposal.id).status, "dismissed");
  assert.match(doc.byId("contract-atelier-status").textContent, /DISMISSED/);
  const details = doc.created.filter((el) => el.tagName === "details");
  assert.ok(details.length > 0, "a collapsed decided list is rendered");
  const latest = details[details.length - 1];
  assert.match(subtreeText(latest).replace(/\s+/g, " "), /DECIDED · 1/);
  assert.match(subtreeText(latest), /DISMISSED/);
  assert.equal(seen[seen.length - 1].action, "review-dismiss");
});

test("expired proposals render in the decided list, not as pending", () => {
  const doc = interactiveDocument();
  const queue = fakeProposalQueue();
  const consoleApi = createContractAtelierConsole({
    documentRoot: doc,
    proposalQueue: queue,
    outcomeDesk: createOutcomeContracts({ seed: "expiry-test" }),
  });
  submitScoutProposal(queue, { title: "Stale derby", expiresAt: "2020-01-01T00:00:00.000Z" });
  assert.deepEqual(consoleApi.getSnapshot().reviewQueue, { wired: true, pending: 0, decided: 1 });
  const details = doc.created.filter((el) => el.tagName === "details");
  assert.ok(details.length > 0, "a collapsed decided list is rendered");
  assert.match(subtreeText(details[details.length - 1]), /Stale derby/);
  assert.match(subtreeText(details[details.length - 1]), /EXPIRED/);
});

test("queue subscribe triggers a console rerender", () => {
  const doc = interactiveDocument();
  const queue = fakeProposalQueue();
  const consoleApi = createContractAtelierConsole({
    documentRoot: doc,
    proposalQueue: queue,
    outcomeDesk: createOutcomeContracts({ seed: "subscribe-test" }),
  });
  assert.ok(!subtreeText(doc.byId("contract-atelier-review")).includes("Fresh proposal"));
  submitScoutProposal(queue, { title: "Fresh proposal" });
  assert.ok(
    subtreeText(doc.byId("contract-atelier-review")).includes("Fresh proposal"),
    "the queue change rerendered the review section",
  );
  assert.deepEqual(consoleApi.getSnapshot().reviewQueue, { wired: true, pending: 1, decided: 0 });
});

test("review snapshot is frozen and carries the queue counts", () => {
  const doc = interactiveDocument();
  const queue = fakeProposalQueue();
  const consoleApi = createContractAtelierConsole({
    documentRoot: doc,
    proposalQueue: queue,
    outcomeDesk: createOutcomeContracts({ seed: "snapshot-test" }),
  });
  submitScoutProposal(queue, { title: "Counted proposal" });
  const snapshot = consoleApi.getSnapshot();
  assert.deepEqual(snapshot.reviewQueue, { wired: true, pending: 1, decided: 0 });
  assert.ok(Object.isFrozen(snapshot));
});
