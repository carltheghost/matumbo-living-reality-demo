/**
 * Contract Ledger — lifecycle tracking, history, audit view, eternal-escrow grading.
 * Projection-only. SIMULATED TUMBO POINTS ONLY. No wallets, no signing, no custody, no settlement.
 *
 * Lifecycle: proposed → open → active → graded → claimed
 * Reverse / cancel append audit entries; history is never deleted.
 * A win is claimable FOREVER (expiresAt: null).
 */

const LIFECYCLE_STATUSES = Object.freeze([
  'proposed',
  'open',
  'active',
  'graded',
  'claimed',
  'reversed',
  'cancelled',
]);

const VALID_TRANSITIONS = Object.freeze({
  proposed: ['open', 'cancelled'],
  open: ['active', 'cancelled'],
  active: ['graded', 'cancelled'],
  graded: ['claimed', 'reversed'],
  claimed: ['reversed'],
  reversed: [],
  cancelled: [],
});

const LEDGER_EVENT_TYPES = Object.freeze([
  'created',
  'joined',
  'status_change',
  'graded',
  'claimed',
  'reversed',
  'cancelled',
  'audit_note',
]);

/**
 * @typedef {Object} LedgerEntry
 * @property {string} id
 * @property {string} contractId
 * @property {string} type
 * @property {string} [fromStatus]
 * @property {string} [toStatus]
 * @property {string} [participant]
 * @property {number} [amount]          // simulated Tumbo points delta
 * @property {string} [side]            // 'win' | 'lose' | null
 * @property {string} [reason]
 * @property {Object} [payload]
 * @property {number} ts                // unix ms
 * @property {number|null} expiresAt    // null = eternal (claimable forever)
 * @property {boolean} [claimed]
 * @property {boolean} [graded]
 */

/**
 * Pure: apply a lifecycle event to a status, returning the new status or null if illegal.
 * @param {string} state
 * @param {{ type: string, toStatus?: string }} event
 * @returns {string|null}
 */
export function applyLifecycleEvent(state, event) {
  if (!LIFECYCLE_STATUSES.includes(state)) return null;
  if (event.type === 'reversed') return 'reversed';
  if (event.type === 'cancelled') return 'cancelled';
  if (event.type === 'status_change' && event.toStatus) {
    const allowed = VALID_TRANSITIONS[state] || [];
    if (allowed.includes(event.toStatus)) return event.toStatus;
    return null;
  }
  if (event.type === 'graded' && state === 'active') return 'graded';
  if (event.type === 'claimed' && state === 'graded') return 'claimed';
  return null;
}

/**
 * Pure: a graded win entry is claimable forever when expiresAt is null.
 * @param {LedgerEntry} ledgerEntry
 * @param {number} now
 * @returns {boolean}
 */
export function isClaimable(ledgerEntry, now) {
  if (!ledgerEntry || ledgerEntry.type !== 'graded') return false;
  if (ledgerEntry.side !== 'win') return false;
  if (ledgerEntry.claimed === true) return false;
  if (ledgerEntry.graded !== true) return false;
  if (ledgerEntry.expiresAt === null || ledgerEntry.expiresAt === undefined) return true;
  return now < ledgerEntry.expiresAt;
}

/**
 * Pure: summarize a participant's history from ledger entries.
 * @param {LedgerEntry[]} entries
 * @param {string} participant
 * @returns {{ wins: number, losses: number, claimed: number, totalPoints: number, openClaims: number }}
 */
export function summarizeParticipantHistory(entries, participant) {
  const summary = {
    wins: 0,
    losses: 0,
    claimed: 0,
    totalPoints: 0,
    openClaims: 0,
  };
  if (!Array.isArray(entries) || !participant) return summary;

  for (const e of entries) {
    if (e.participant !== participant) continue;
    if (e.type === 'graded') {
      if (e.side === 'win') {
        summary.wins += 1;
        if (!e.claimed) summary.openClaims += 1;
      } else if (e.side === 'lose') {
        summary.losses += 1;
      }
    }
    if (e.type === 'claimed' && typeof e.amount === 'number') {
      summary.claimed += 1;
      summary.totalPoints += e.amount;
    }
    if (e.type === 'graded' && e.side === 'lose' && typeof e.amount === 'number') {
      summary.totalPoints += e.amount; // negative for losses
    }
  }
  return summary;
}

function makeId(prefix = 'led') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Create a contract ledger instance.
 * @returns {{
 *   record: (event: Object) => LedgerEntry,
 *   getHistory: (contractId: string) => LedgerEntry[],
 *   getAuditView: (filter: Object) => LedgerEntry[],
 *   reverse: (contractId: string, reason: string) => LedgerEntry|null,
 *   cancel: (contractId: string, reason: string) => LedgerEntry|null,
 *   gradeOnEventLanding: (contract: Object, result: Object) => Object,
 *   claim: (contractId: string, participant: string, now?: number) => Object,
 *   getStatus: (contractId: string) => string|null,
 * }}
 */
export function createContractLedger() {
  /** @type {Map<string, LedgerEntry[]>} */
  const byContract = new Map();
  /** @type {Map<string, string>} contractId → current status */
  const statusMap = new Map();
  /** @type {Set<string>} contractIds already graded */
  const gradedSet = new Set();
  /** @type {Set<string>} claim keys: contractId:participant */
  const claimedSet = new Set();

  function append(contractId, entry) {
    if (!byContract.has(contractId)) byContract.set(contractId, []);
    byContract.get(contractId).push(entry);
    return entry;
  }

  function currentStatus(contractId) {
    return statusMap.get(contractId) || null;
  }

  /**
   * Record a lifecycle / audit event.
   * @param {Object} event
   * @param {string} event.contractId
   * @param {string} event.type
   * @param {string} [event.fromStatus]
   * @param {string} [event.toStatus]
   * @param {string} [event.participant]
   * @param {number} [event.amount]
   * @param {string} [event.side]
   * @param {string} [event.reason]
   * @param {Object} [event.payload]
   * @param {number} [event.ts]
   * @returns {LedgerEntry}
   */
  function record(event) {
    if (!event || !event.contractId || !event.type) {
      console.warn('[contract-ledger] record() missing contractId or type');
      return null;
    }

    const ts = typeof event.ts === 'number' ? event.ts : Date.now();
    const prev = currentStatus(event.contractId);

    let toStatus = event.toStatus || null;
    if (event.type === 'created') {
      toStatus = event.toStatus || 'proposed';
      statusMap.set(event.contractId, toStatus);
    } else if (event.type === 'joined') {
      // joining does not force status; optional open transition handled by caller
    } else if (event.type === 'status_change' || event.type === 'graded' || event.type === 'claimed') {
      const next = applyLifecycleEvent(prev || 'proposed', {
        type: event.type === 'status_change' ? 'status_change' : event.type,
        toStatus: event.toStatus,
      });
      if (next) {
        toStatus = next;
        statusMap.set(event.contractId, next);
      } else if (prev) {
        // illegal transition — still record audit but do not change status
        console.warn(`[contract-ledger] illegal transition ${prev} + ${event.type} for ${event.contractId}`);
      }
    } else if (event.type === 'reversed') {
      statusMap.set(event.contractId, 'reversed');
      toStatus = 'reversed';
    } else if (event.type === 'cancelled') {
      statusMap.set(event.contractId, 'cancelled');
      toStatus = 'cancelled';
    }

    const entry = Object.freeze({
      id: makeId(),
      contractId: event.contractId,
      type: event.type,
      fromStatus: event.fromStatus != null ? event.fromStatus : prev,
      toStatus: toStatus,
      participant: event.participant || null,
      amount: typeof event.amount === 'number' ? event.amount : null,
      side: event.side || null,
      reason: event.reason || null,
      payload: event.payload ? Object.freeze({ ...event.payload }) : null,
      ts,
      expiresAt: event.expiresAt === undefined ? null : event.expiresAt,
      claimed: event.claimed === true,
      graded: event.graded === true,
    });
    return append(event.contractId, entry);
  }

  /**
   * Deterministic grading when an event lands.
   * Winners paid / losers taken in SIMULATED TUMBO POINTS.
   * Claimable forever (expiresAt: null). Anti-double-grade.
   * @param {Object} contract — shape from outcome-contracts domain
   * @param {Object} result — { winnerSide?: string, winnerId?: string, scores?: Object, eventId?: string }
   * @returns {{ graded: boolean, entries: LedgerEntry[], reason?: string }}
   */
  function gradeOnEventLanding(contract, result) {
    if (!contract || !contract.id) {
      return { graded: false, entries: [], reason: 'missing contract' };
    }
    const contractId = contract.id;
    if (gradedSet.has(contractId)) {
      return { graded: false, entries: [], reason: 'already graded' };
    }
    const status = currentStatus(contractId);
    if (status && (status === 'graded' || status === 'claimed' || status === 'reversed' || status === 'cancelled')) {
      return { graded: false, entries: [], reason: `cannot grade from status ${status}` };
    }
    const participants = Array.isArray(contract.participants) ? contract.participants : [];
    const stake = typeof contract.stake === 'number' ? contract.stake : 0;
    const winnerSide = (result && (result.winnerSide || result.winnerId)) || null;
    const entries = [];
    const now = Date.now();
    // Transition to graded
    const statusEntry = record({
      contractId,
      type: 'graded',
      fromStatus: status || 'active',
      toStatus: 'graded',
      ts: now,
      payload: { eventId: result && result.eventId, winnerSide, simulated: true, unit: 'TUMBO_POINTS' },
    });
    if (statusEntry) entries.push(statusEntry);
    for (const p of participants) {
      const pid = typeof p === 'string' ? p : p.id || p.participantId;
      const side = typeof p === 'object' ? p.side : null;
      const isWinner = (winnerSide && side && side === winnerSide) || (winnerSide && pid === winnerSide);
      const amount = isWinner ? stake : -stake;
      const gradeEntry = record({
        contractId,
        type: 'graded',
        participant: pid,
        side: isWinner ? 'win' : 'lose',
        amount,
        ts: now,
        expiresAt: null, // eternal escrow — claimable forever
        graded: true,
        claimed: false,
        payload: { simulated: true, unit: 'TUMBO_POINTS', stake },
      });
      if (gradeEntry) entries.push(gradeEntry);
    }
    gradedSet.add(contractId);
    statusMap.set(contractId, 'graded');
    return { graded: true, entries };
  }

  /**
   * Claim a win. Anti-double-claim. Pays simulated Tumbo points. Eternal.
   * @param {string} contractId
   * @param {string} participant
   * @param {number} [now]
   * @returns {{ claimed: boolean, entry: LedgerEntry|null, amount: number, reason?: string }}
   */
  function claim(contractId, participant, now = Date.now()) {
    if (!contractId || !participant) {
      return { claimed: false, entry: null, amount: 0, reason: 'missing args' };
    }
    const claimKey = `${contractId}:${participant}`;
    if (claimedSet.has(claimKey)) {
      return { claimed: false, entry: null, amount: 0, reason: 'already claimed' };
    }
    const history = byContract.get(contractId) || [];
    const winEntry = history.find((e) => e.type === 'graded' && e.participant === participant && e.side === 'win' && e.graded === true);
    if (!winEntry) {
      return { claimed: false, entry: null, amount: 0, reason: 'no claimable win' };
    }
    if (!isClaimable(winEntry, now)) {
      return { claimed: false, entry: null, amount: 0, reason: 'not claimable' };
    }
    const amount = typeof winEntry.amount === 'number' ? winEntry.amount : 0;
    // Mark original as claimed (append-only: we record a claimed event; original stays)
    const claimEntry = record({
      contractId,
      type: 'claimed',
      participant,
      amount,
      side: 'win',
      ts: now,
      expiresAt: null,
      payload: { simulated: true, unit: 'TUMBO_POINTS', sourceGradeId: winEntry.id },
    });
    claimedSet.add(claimKey);
    statusMap.set(contractId, 'claimed');
    return { claimed: true, entry: claimEntry, amount };
  }

  /**
   * Reverse a contract. Appends audit entry; never deletes history.
   * @param {string} contractId
   * @param {string} reason
   * @returns {LedgerEntry|null}
   */
  function reverse(contractId, reason) {
    if (!contractId) return null;
    const prev = currentStatus(contractId);
    return record({
      contractId,
      type: 'reversed',
      fromStatus: prev,
      toStatus: 'reversed',
      reason: reason || 'reversed',
      ts: Date.now(),
      payload: { simulated: true },
    });
  }

  /**
   * Cancel a contract. Appends audit entry; never deletes history.
   * @param {string} contractId
   * @param {string} reason
   * @returns {LedgerEntry|null}
   */
  function cancel(contractId, reason) {
    if (!contractId) return null;
    const prev = currentStatus(contractId);
    return record({
      contractId,
      type: 'cancelled',
      fromStatus: prev,
      toStatus: 'cancelled',
      reason: reason || 'cancelled',
      ts: Date.now(),
      payload: { simulated: true },
    });
  }

  /**
   * Frozen chronological history for a contract.
   * @param {string} contractId
   * @returns {ReadonlyArray<LedgerEntry>}
   */
  function getHistory(contractId) {
    const list = byContract.get(contractId) || [];
    return Object.freeze(list.slice().sort((a, b) => a.ts - b.ts));
  }

  /**
   * Frozen, chronological, filterable audit trail.
   * @param {{ contractId?: string, participant?: string, from?: number, to?: number }} filter
   * @returns {ReadonlyArray<LedgerEntry>}
   */
  function getAuditView(filter = {}) {
    let all = [];
    if (filter.contractId) {
      all = (byContract.get(filter.contractId) || []).slice();
    } else {
      for (const list of byContract.values()) {
        all.push(...list);
      }
    }
    if (filter.participant) {
      all = all.filter((e) => e.participant === filter.participant);
    }
    if (typeof filter.from === 'number') {
      all = all.filter((e) => e.ts >= filter.from);
    }
    if (typeof filter.to === 'number') {
      all = all.filter((e) => e.ts <= filter.to);
    }
    all.sort((a, b) => a.ts - b.ts);
    return Object.freeze(all);
  }

  function getStatus(contractId) {
    return currentStatus(contractId);
  }

  return {
    record,
    getHistory,
    getAuditView,
    reverse,
    cancel,
    gradeOnEventLanding,
    claim,
    getStatus,
    // pure helpers re-exported for convenience
    applyLifecycleEvent,
    isClaimable,
    summarizeParticipantHistory,
  };
}

export { LIFECYCLE_STATUSES, VALID_TRANSITIONS, LEDGER_EVENT_TYPES };
