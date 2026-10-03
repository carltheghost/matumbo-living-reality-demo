/** Explicit consent and immutable acceptance metadata; no raw content or uploads. */
import {
  COMPUTE_PROVIDERS
} from './compute-exchange.js?v=20261003-complete8';
import {
  economicChecksum,
  sealEconomicMetadata,
  stableEconomicString
} from './economic-timeline.js?v=20261003-complete8';
export const CONTRIBUTION_VAULT_SCHEMA_VERSION = 2;
export const CONTRIBUTION_VAULT_SOURCE = 'matumbo-contribution-vault';
export const CONTRIBUTION_VAULT_BOUNDARY = 'Metadata-only local consent rehearsal. It stores no raw conversation or file content and performs no upload, sale, training transfer, or real reward issuance.';
export const CONTRIBUTION_SCOPES = Object.freeze(['aggregate-only', 'research-only', 'provider-specific']);

function identifier(value, label) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 160) throw new Error(`${label} is required and must fit 160 characters`);
  return text;
}

function whole(value, min, max, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer between ${min} and ${max}`);
  return number;
}

export function createContributionVault({
  now = () => Date.now(),
  maxContributions = 2000
} = {}) {
  if (typeof now !== 'function' || !Number.isSafeInteger(maxContributions) || maxContributions < 1 || maxContributions > 10000) throw new Error('Invalid contribution vault options');
  let records = new Map(),
    evidence = new Map(),
    claims = new Map(),
    events = [],
    replayAt = null;
  const preparedClaims = new WeakMap();
  let claimCommitting = false;

  function mutationGuard() {
    if (claimCommitting) throw new Error('Contribution settlement is in progress; mutations cannot re-enter');
  }

  function at() {
    const time = replayAt ?? Number(now());
    if (!Number.isSafeInteger(time) || time < 0 || Number.isNaN(new Date(time).getTime())) throw new Error('Invalid contribution clock');
    return time;
  }

  function push(type, args, time) {
    const base = {
      sequence: events.length + 1,
      type,
      source: CONTRIBUTION_VAULT_SOURCE,
      at: time,
      previousChecksum: events.at(-1)?.checksum ?? 'GENESIS',
      args: sealEconomicMetadata(args)
    };
    events.push(sealEconomicMetadata({
      ...base,
      checksum: economicChecksum(stableEconomicString(base))
    }));
  }

  function capacity() {
    if (events.length >= maxContributions * 6) throw new Error('Contribution history is full; export before continuing');
  }

  function get(key) {
    const row = records.get(String(key));
    if (!row) throw new Error('Unknown contribution');
    return row;
  }

  function live(row, time = at()) {
    if (time >= row.expiresAt) throw new Error('Contribution retention/acceptance period expired');
    if (row.state === 'revoked') throw new Error('Revoked contribution needs a new proposal ID');
  }

  function snapshotRecord(row, time = at()) {
    return sealEconomicMetadata({
      ...row,
      rawContentStored: false,
      rewardClaimable: row.state === 'accepted' && !row.claimId && time < row.expiresAt
    });
  }

  function propose({
    contributionId,
    category = 'other',
    units = 1,
    purpose = '',
    retentionDays = 30
  } = {}) {
    mutationGuard();
    const key = identifier(contributionId, 'contributionId'),
      request = {
        category: String(category).slice(0, 80),
        units: whole(units, 1, 10000, 'Contribution units'),
        purpose: String(purpose).slice(0, 240),
        retentionDays: whole(retentionDays, 1, 3650, 'Retention days')
      },
      old = records.get(key);
    if (old) {
      if (stableEconomicString(old.request) !== stableEconomicString(request)) throw new Error('IDEM_MISMATCH: contribution ID belongs to another proposal');
      return snapshotRecord(old);
    }
    if (records.size >= maxContributions) throw new Error('Contribution limit reached');
    const time = at();
    capacity();
    const row = {
      contributionId: key,
      request,
      ...request,
      createdAt: time,
      expiresAt: time + request.retentionDays * 86400000,
      state: 'proposed',
      consent: null,
      consentVersion: 0,
      acceptedEvidenceId: null,
      everAccepted: false,
      rewardTumboSim: 0,
      rewardFluff: 0,
      claimId: null
    };
    records.set(key, row);
    push('contribution.proposed', {
      contributionId: key,
      ...request
    }, time);
    return snapshotRecord(row);
  }

  function authorize(contributionId, {
    scope = 'aggregate-only',
    providerId = null,
    allowTraining = false,
    allowResearch = true
  } = {}) {
    mutationGuard();
    const row = get(contributionId),
      time = at();
    live(row, time);
    if (!CONTRIBUTION_SCOPES.includes(scope)) throw new Error('Unsupported contribution scope');
    if (scope === 'provider-specific' && !COMPUTE_PROVIDERS.some(provider => provider.id === providerId)) throw new Error('Provider-specific consent requires a known providerId');
    if (scope === 'research-only' && allowTraining === true) throw new Error('Research-only consent cannot permit training');
    const consent = sealEconomicMetadata({
      explicit: true,
      scope,
      providerId: scope === 'provider-specific' ? providerId : null,
      allowTraining: allowTraining === true,
      allowResearch: allowResearch === true
    });
    if (row.state === 'accepted' || row.everAccepted) {
      if (stableEconomicString(row.consent) === stableEconomicString(consent)) return snapshotRecord(row);
      throw new Error('Accepted contribution consent cannot be rewritten');
    }
    if (stableEconomicString(row.consent) === stableEconomicString(consent)) return snapshotRecord(row);
    capacity();
    row.consent = consent;
    row.consentVersion++;
    row.state = 'authorized';
    push('contribution.authorized', {
      contributionId: row.contributionId,
      ...consent
    }, time);
    return snapshotRecord(row);
  }

  function revoke(contributionId) {
    mutationGuard();
    const row = get(contributionId);
    if (row.state === 'revoked') return snapshotRecord(row);
    const time = at();
    capacity();
    row.state = 'revoked';
    row.consent = sealEconomicMetadata({
      ...row.consent,
      explicit: row.consent?.explicit === true,
      revoked: true
    });
    push('contribution.revoked', {
      contributionId: row.contributionId
    }, time);
    return snapshotRecord(row);
  }

  function preflightAccept(contributionId, {
    evidenceId,
    providerId = null
  } = {}) {
    const row = get(contributionId),
      key = identifier(evidenceId, 'evidenceId');
    if (row.everAccepted) {
      if (row.acceptedEvidenceId !== key || row.acceptanceProviderId !== providerId) throw new Error('IDEM_MISMATCH: contribution already accepted with different evidence');
      return sealEconomicMetadata({
        accepted: false,
        duplicate: true,
        reason: 'duplicate-acceptance',
        record: snapshotRecord(row)
      });
    }
    if (row.state !== 'authorized' || row.consent?.explicit !== true || row.consent?.revoked === true) return sealEconomicMetadata({
      accepted: false,
      duplicate: false,
      reason: 'explicit-consent-required',
      record: snapshotRecord(row)
    });
    live(row);
    if (row.consent.scope === 'provider-specific' && providerId !== row.consent.providerId) throw new Error('Acceptance provider does not match consent');
    if (evidence.has(key)) throw new Error('Acceptance evidence is already bound to another contribution');
    capacity();
    return sealEconomicMetadata({
      accepted: true,
      duplicate: false,
      reason: 'ready-local-demo',
      rewardFluff: Math.min(1000, row.units),
      record: snapshotRecord(row)
    });
  }

  function accept(contributionId, {
    evidenceId,
    providerId = null
  } = {}) {
    mutationGuard();
    const ready = preflightAccept(contributionId, {
      evidenceId,
      providerId
    });
    if (!ready.accepted) return ready;
    const row = get(contributionId),
      time = at();
    row.state = 'accepted';
    row.everAccepted = true;
    row.acceptedEvidenceId = String(evidenceId).trim();
    row.acceptanceProviderId = providerId;
    row.rewardFluff = ready.rewardFluff;
    row.rewardTumboSim = ready.rewardFluff / 1000;
    evidence.set(row.acceptedEvidenceId, row.contributionId);
    push('contribution.accepted', {
      contributionId: row.contributionId,
      evidenceId: row.acceptedEvidenceId,
      providerId
    }, time);
    return sealEconomicMetadata({
      accepted: true,
      duplicate: false,
      reason: 'accepted-local-demo',
      record: snapshotRecord(row)
    });
  }

  function preflightClaim({
    contributionId,
    claimId
  } = {}) {
    const row = get(contributionId),
      key = identifier(claimId, 'claimId'),
      old = claims.get(key);
    if (old && old !== row.contributionId) throw new Error('IDEM_MISMATCH: claim ID belongs to another contribution');
    if (row.claimId) {
      if (row.claimId !== key) throw new Error('Contribution reward already claimed');
      return sealEconomicMetadata({
        accepted: false,
        duplicate: true,
        reason: 'duplicate-claim',
        record: snapshotRecord(row)
      });
    }
    if (row.state !== 'accepted' || !row.everAccepted) return sealEconomicMetadata({
      accepted: false,
      duplicate: false,
      reason: 'accepted-consent-required',
      record: snapshotRecord(row)
    });
    const time = at();
    live(row, time);
    capacity();
    const prepared = sealEconomicMetadata({
      accepted: true,
      duplicate: false,
      reason: 'claimable-local-entitlement',
      rewardFluff: row.rewardFluff,
      record: snapshotRecord(row)
    });
    preparedClaims.set(prepared, {
      row,
      claimId: key,
      at: time,
      eventCount: events.length
    });
    return prepared;
  }

  function acknowledgePrepared(input, ready) {
    // Use the owner-issued preparation to fix authorization time before the
    // coordinator posts its funded ledger leg. A millisecond expiry crossing
    // cannot invalidate the acknowledgement after that leg has committed.
    if (!ready.accepted) return ready;
    const ticket = preparedClaims.get(ready),
      row = get(input.contributionId);
    if (!ticket || ticket.row !== row || ticket.claimId !== String(input.claimId).trim() || ticket.eventCount !== events.length || row.state !== 'accepted' || row.claimId) throw new Error('Contribution claim preparation is stale or forged');
    const time = ticket.at;
    row.claimId = String(input.claimId).trim();
    claims.set(row.claimId, row.contributionId);
    push('contribution.reward-claimed', {
      contributionId: row.contributionId,
      claimId: row.claimId
    }, time);
    preparedClaims.delete(ready);
    return sealEconomicMetadata({
      ...ready,
      reason: 'claimed-local-entitlement',
      record: snapshotRecord(row, time),
      transferExecuted: false
    });
  }

  function claimReward(input = {}, {
    prepared = null
  } = {}) {
    mutationGuard();
    return acknowledgePrepared(input, prepared ?? preflightClaim(input));
  }

  function commitPreparedClaim(prepared, settle) {
    mutationGuard();
    const ticket = preparedClaims.get(prepared);
    if (!ticket || !prepared.accepted || ticket.row !== records.get(ticket.row.contributionId) || ticket.eventCount !== events.length || ticket.row.state !== 'accepted' || ticket.row.claimId) throw new Error('Contribution claim preparation is stale or forged');
    if (typeof settle !== 'function' || settle.constructor?.name === 'AsyncFunction') throw new Error('Contribution settlement callback must be synchronous');
    claimCommitting = true;
    try {
      const settlement = settle();
      if (settlement && typeof settlement.then === 'function') throw new Error('Contribution settlement callback must return synchronously');
      const claim = acknowledgePrepared({
        contributionId: ticket.row.contributionId,
        claimId: ticket.claimId
      }, prepared);
      return Object.freeze({
        claim,
        settlement
      });
    } finally {
      claimCommitting = false;
    }
  }

  function snapshot() {
    const rows = [...records.values()].map(row => snapshotRecord(row));
    return sealEconomicMetadata({
      schemaVersion: CONTRIBUTION_VAULT_SCHEMA_VERSION,
      source: CONTRIBUTION_VAULT_SOURCE,
      contributions: rows,
      totalRewardTumboSim: rows.reduce((sum, row) => sum + row.rewardFluff, 0) / 1000,
      claimedRewardTumboSim: rows.filter(row => row.claimId).reduce((sum, row) => sum + row.rewardFluff, 0) / 1000,
      events,
      rawContentStored: false,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      executable: false,
      boundary: CONTRIBUTION_VAULT_BOUNDARY
    });
  }

  function exportState() {
    return sealEconomicMetadata({
      schemaVersion: CONTRIBUTION_VAULT_SCHEMA_VERSION,
      source: CONTRIBUTION_VAULT_SOURCE,
      events,
      cryptographicProof: false
    });
  }

  function importState(input) {
    mutationGuard();
    const data = sealEconomicMetadata(input);
    if (data.schemaVersion !== CONTRIBUTION_VAULT_SCHEMA_VERSION || data.source !== CONTRIBUTION_VAULT_SOURCE || !Array.isArray(data.events) || data.events.length > maxContributions * 6) throw new Error('Invalid contribution vault state');
    const previous = {
      records,
      evidence,
      claims,
      events
    };
    records = new Map();
    evidence = new Map();
    claims = new Map();
    events = [];
    try {
      for (const event of data.events) {
        replayAt = event.at;
        const args = event.args;
        switch (event.type) {
          case 'contribution.proposed':
            propose(args);
            break;
          case 'contribution.authorized':
            authorize(args.contributionId, args);
            break;
          case 'contribution.revoked':
            revoke(args.contributionId);
            break;
          case 'contribution.accepted':
            accept(args.contributionId, args);
            break;
          case 'contribution.reward-claimed':
            claimReward(args);
            break;
          default:
            throw new Error('Unknown contribution event');
        }
        if (stableEconomicString(events.at(-1)) !== stableEconomicString(event)) throw new Error('Contribution replay checksum or transition is invalid');
      }
      replayAt = null;
      return snapshot();
    } catch (error) {
      ({
        records,
        evidence,
        claims,
        events
      } = previous);
      replayAt = null;
      throw error;
    }
  }
  return Object.freeze({
    propose,
    authorize,
    revoke,
    preflightAccept,
    accept,
    preflightClaim,
    claimReward,
    commitPreparedClaim,
    snapshot,
    exportState,
    importState
  });
}
export default Object.freeze({
  CONTRIBUTION_VAULT_SCHEMA_VERSION,
  CONTRIBUTION_VAULT_SOURCE,
  CONTRIBUTION_VAULT_BOUNDARY,
  CONTRIBUTION_SCOPES,
  createContributionVault
});
