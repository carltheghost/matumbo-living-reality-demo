/**
 * contribution-vault.js — explicit-consent data contribution rehearsal.
 *
 * The vault intentionally stores contribution metadata only. Raw chat content,
 * files, prompts, personal records, or browsing history are never accepted by
 * this module. A contribution earns nothing until explicit consent and a local
 * acceptance step both exist.
 */

export const CONTRIBUTION_VAULT_SCHEMA_VERSION = 1;
export const CONTRIBUTION_VAULT_SOURCE = "matumbo-contribution-vault";
export const CONTRIBUTION_VAULT_BOUNDARY =
  "Metadata-only local consent rehearsal. It stores no raw conversation or file content and performs no upload, sale, training transfer, or real reward issuance.";

export const CONTRIBUTION_SCOPES = Object.freeze([
  "aggregate-only",
  "research-only",
  "provider-specific",
]);

function units(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number <= 0 || number > 10000) {
    throw new Error("Contribution units must be between 1 and 10000");
  }
  return number;
}

function rewardForUnits(value) {
  // Intentionally tiny and capped. This is a local policy rehearsal, not a
  // promise that data has a market price.
  return Math.min(1, Math.round(value * 0.001 * 1e6) / 1e6);
}

export function createContributionVault() {
  const records = new Map();
  const events = [];
  let sequence = 0;

  function push(type, contributionId, payload = {}) {
    const event = Object.freeze({
      sequence: ++sequence,
      type,
      contributionId,
      source: CONTRIBUTION_VAULT_SOURCE,
      ...payload,
    });
    events.push(event);
    return event;
  }

  function propose({
    contributionId,
    category = "other",
    units: unitCount = 1,
    purpose = "",
    retentionDays = 30,
  } = {}) {
    const id = String(contributionId ?? "").trim();
    if (!id) throw new Error("contributionId is required");
    if (records.has(id)) throw new Error("Contribution already exists");
    const days = Math.floor(Number(retentionDays));
    if (!Number.isFinite(days) || days < 1 || days > 3650) throw new Error("Retention days must be between 1 and 3650");

    const record = {
      contributionId: id,
      category: String(category).slice(0, 80),
      units: units(unitCount),
      purpose: String(purpose).slice(0, 240),
      retentionDays: days,
      state: "proposed",
      consent: null,
      acceptedEvidenceId: null,
      rewardTumboSim: 0,
      rawContentStored: false,
    };
    records.set(id, record);
    push("contribution.proposed", id, { category: record.category, units: record.units });
    return snapshotRecord(record);
  }

  function authorize(contributionId, {
    scope = "aggregate-only",
    allowTraining = false,
    allowResearch = true,
  } = {}) {
    const record = records.get(String(contributionId));
    if (!record) throw new Error("Unknown contribution");
    if (!CONTRIBUTION_SCOPES.includes(scope)) throw new Error("Unsupported contribution scope");
    if (record.state === "accepted") throw new Error("Accepted contribution consent cannot be rewritten");

    record.consent = Object.freeze({
      explicit: true,
      scope,
      allowTraining: allowTraining === true,
      allowResearch: allowResearch === true,
    });
    record.state = "authorized";
    push("contribution.authorized", record.contributionId, record.consent);
    return snapshotRecord(record);
  }

  function revoke(contributionId) {
    const record = records.get(String(contributionId));
    if (!record) throw new Error("Unknown contribution");
    record.state = "revoked";
    record.consent = record.consent ? Object.freeze({ ...record.consent, revoked: true }) : Object.freeze({ explicit: false, revoked: true });
    push("contribution.revoked", record.contributionId, { previouslyAccepted: Boolean(record.acceptedEvidenceId) });
    return snapshotRecord(record);
  }

  function accept(contributionId, { evidenceId } = {}) {
    const record = records.get(String(contributionId));
    if (!record) throw new Error("Unknown contribution");
    if (record.state !== "authorized" || record.consent?.explicit !== true || record.consent?.revoked === true) {
      return Object.freeze({ accepted: false, reason: "explicit-consent-required", record: snapshotRecord(record) });
    }
    const evidence = String(evidenceId ?? "").trim();
    if (!evidence) throw new Error("evidenceId is required");

    record.state = "accepted";
    record.acceptedEvidenceId = evidence;
    record.rewardTumboSim = rewardForUnits(record.units);
    push("contribution.accepted", record.contributionId, {
      evidenceId: evidence,
      rewardTumboSim: record.rewardTumboSim,
    });
    return Object.freeze({ accepted: true, reason: "accepted-local-demo", record: snapshotRecord(record) });
  }

  function snapshotRecord(record) {
    return Object.freeze({
      contributionId: record.contributionId,
      category: record.category,
      units: record.units,
      purpose: record.purpose,
      retentionDays: record.retentionDays,
      state: record.state,
      consent: record.consent,
      acceptedEvidenceId: record.acceptedEvidenceId,
      rewardTumboSim: record.rewardTumboSim,
      rawContentStored: false,
    });
  }

  function snapshot() {
    const rows = [...records.values()].map(snapshotRecord);
    return Object.freeze({
      schemaVersion: CONTRIBUTION_VAULT_SCHEMA_VERSION,
      source: CONTRIBUTION_VAULT_SOURCE,
      contributions: Object.freeze(rows),
      totalRewardTumboSim: Math.round(rows.reduce((sum, row) => sum + row.rewardTumboSim, 0) * 1e6) / 1e6,
      events: Object.freeze([...events]),
      rawContentStored: false,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      executable: false,
      boundary: CONTRIBUTION_VAULT_BOUNDARY,
    });
  }

  return Object.freeze({ propose, authorize, revoke, accept, snapshot });
}

export default Object.freeze({
  CONTRIBUTION_VAULT_SCHEMA_VERSION,
  CONTRIBUTION_VAULT_SOURCE,
  CONTRIBUTION_VAULT_BOUNDARY,
  CONTRIBUTION_SCOPES,
  createContributionVault,
});
