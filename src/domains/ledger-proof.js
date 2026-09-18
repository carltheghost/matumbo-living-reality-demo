/**
 * Non-authoritative Prime Ledger and EchoProof summaries for local display.
 * Nothing in this module records, verifies, signs, settles, or publishes data.
 */

export const LEDGER_PROOF_SCHEMA_VERSION = 1;
export const LEDGER_PROOF_SOURCE = "prime-ledger-echoproof";

export const BalanceStatus = Object.freeze({
  BALANCED: "balanced",
  UNBALANCED: "unbalanced",
});

const ENTRY_SIDES = new Set(["credit", "debit"]);

const CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "ledger-project-balanced-records",
    label: "Summarize fictional balanced records",
    enabled: true,
    mode: "local-projection",
    authority: "none",
  }),
  Object.freeze({
    id: "echoproof-project-ancestry",
    label: "Summarize declared proof ancestry",
    enabled: true,
    mode: "local-projection",
    authority: "none",
  }),
  Object.freeze({
    id: "ledger-proof-authoritative-action",
    label: "Record, verify, sign, settle, or publish externally",
    enabled: false,
    mode: "denied",
    authority: "none",
  }),
]);

function requireRecord(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireAmount(value, field) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite, non-negative number`);
  }
  return value;
}

function requireUniqueIds(records, label) {
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) throw new TypeError(`Duplicate ${label} id: ${record.id}`);
    seen.add(record.id);
  }
}

function normalizeLedgerRecord(record) {
  requireRecord(record, "ledgerRecord");
  if (!Array.isArray(record.entries) || record.entries.length === 0) {
    throw new TypeError("ledgerRecord.entries must be a non-empty array");
  }

  let debitTotal = 0;
  let creditTotal = 0;
  record.entries.forEach((entry, index) => {
    requireRecord(entry, `ledgerRecord.entries[${index}]`);
    requireString(entry.account, `ledgerRecord.entries[${index}].account`);
    if (!ENTRY_SIDES.has(entry.side)) {
      throw new TypeError(`Unknown ledgerRecord.entries[${index}].side: ${String(entry.side)}`);
    }
    const amount = requireAmount(entry.amount, `ledgerRecord.entries[${index}].amount`);
    if (entry.side === "debit") debitTotal += amount;
    else creditTotal += amount;
  });

  if (!Number.isFinite(debitTotal) || !Number.isFinite(creditTotal)) {
    throw new TypeError("ledger record totals must remain finite");
  }

  const balanced = debitTotal === creditTotal;
  return Object.freeze({
    id: requireString(record.id, "ledgerRecord.id"),
    kind: "balanced-record-summary",
    label: requireString(record.label, "ledgerRecord.label"),
    unit: requireString(record.unit, "ledgerRecord.unit"),
    entryCount: record.entries.length,
    debitTotal,
    creditTotal,
    difference: debitTotal - creditTotal,
    status: balanced ? BalanceStatus.BALANCED : BalanceStatus.UNBALANCED,
    simulation: true,
    authoritative: false,
  });
}

function normalizeProof(proof) {
  requireRecord(proof, "proof");
  if (!Array.isArray(proof.parentIds)) {
    throw new TypeError("proof.parentIds must be an array");
  }
  const parentIds = proof.parentIds.map((id, index) =>
    requireString(id, `proof.parentIds[${index}]`));
  if (new Set(parentIds).size !== parentIds.length) {
    throw new TypeError(`Duplicate parent id in proof: ${String(proof.id)}`);
  }
  return {
    id: requireString(proof.id, "proof.id"),
    label: requireString(proof.label, "proof.label"),
    parentIds: Object.freeze([...parentIds].sort()),
  };
}

function summarizeProofs(proofs) {
  requireUniqueIds(proofs, "proof");
  const byId = new Map(proofs.map((proof) => [proof.id, proof]));
  for (const proof of proofs) {
    for (const parentId of proof.parentIds) {
      if (!byId.has(parentId)) throw new TypeError(`Proof references unknown parent: ${parentId}`);
      if (parentId === proof.id) throw new TypeError(`Proof cannot parent itself: ${proof.id}`);
    }
  }

  const memo = new Map();
  const generationMemo = new Map();
  const visiting = new Set();
  function ancestorsOf(id) {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) throw new TypeError(`Proof ancestry contains a cycle at: ${id}`);
    visiting.add(id);
    const ancestors = new Set();
    for (const parentId of byId.get(id).parentIds) {
      ancestors.add(parentId);
      for (const ancestorId of ancestorsOf(parentId)) ancestors.add(ancestorId);
    }
    visiting.delete(id);
    const result = Object.freeze([...ancestors].sort());
    memo.set(id, result);
    return result;
  }

  function generationOf(id) {
    if (generationMemo.has(id)) return generationMemo.get(id);
    const proof = byId.get(id);
    const generation = proof.parentIds.length === 0
      ? 0
      : 1 + Math.max(...proof.parentIds.map(generationOf));
    generationMemo.set(id, generation);
    return generation;
  }

  return proofs.map((proof) => {
    const ancestorIds = ancestorsOf(proof.id);
    return Object.freeze({
      id: proof.id,
      kind: "proof-ancestry-summary",
      label: proof.label,
      directParentIds: proof.parentIds,
      ancestorIds,
      generation: generationOf(proof.id),
      simulation: true,
      authoritative: false,
      cryptographicallyVerified: false,
    });
  });
}

/** Build a deterministic, non-authoritative contribution for the local projection. */
export function createLedgerProofContribution({ updatedAt, ledgerRecords = [], proofs = [] }) {
  requireString(updatedAt, "updatedAt");
  if (!Array.isArray(ledgerRecords) || !Array.isArray(proofs)) {
    throw new TypeError("ledgerRecords and proofs must be arrays");
  }

  const normalizedRecords = ledgerRecords.map(normalizeLedgerRecord);
  requireUniqueIds(normalizedRecords, "ledger record");
  const normalizedProofs = proofs.map(normalizeProof);
  const proofSummaries = summarizeProofs(normalizedProofs);

  return Object.freeze({
    schemaVersion: LEDGER_PROOF_SCHEMA_VERSION,
    source: LEDGER_PROOF_SOURCE,
    simulation: true,
    authoritative: false,
    updatedAt,
    entities: Object.freeze([...normalizedRecords, ...proofSummaries]),
    evidence: Object.freeze([
      Object.freeze({
        id: "ledger-proof-boundary:non-authoritative",
        kind: "simulation-boundary",
        status: "enforced",
        simulation: true,
        authoritative: false,
        note: "Projection summaries only; no ledger, verification, signing, settlement, or publishing authority.",
      }),
    ]),
    capabilities: CAPABILITIES,
  });
}

export { CAPABILITIES as LEDGER_PROOF_CAPABILITIES };
