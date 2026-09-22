/**
 * contract-flow.js — Reality Lens Ω contract pipeline.
 *
 * Connects the contract lanes into one working flow:
 *
 *   ESPN scoreboard (read-only)
 *     → auto-contracts draft (gameToDraft / isUpcoming / dedupeGames)
 *     → odds enrichment (Kalshi + Polymarket, read-only, 15-min freshness)
 *     → Contract Atelier review queue ("Contracts for your review")
 *     → approval (freezes the odds quote snapshot)
 *     → canonical outcome desk (real local simulated contract)
 *     → lifecycle ledger (proposed → open → active → graded → claimed)
 *     → deterministic grading → claimable forever (expiresAt: null)
 *
 * Simulated TUMBO points only. No wallet, signing, custody, settlement,
 * orders, or mainnet. Projection only — Three.js never holds authority.
 *
 * Status vocabulary is normalized through contract-status-vocab so the
 * review dialect (draft/pending_review/active/graded/claimable/cancelled),
 * the ledger dialect (proposed/open/active/graded/claimed/reversed/cancelled)
 * and the canonical desk dialect (draft/open/locked/graded/settled/claimed/voided)
 * stay mutually intelligible. Canonical statuses remain authoritative.
 */

import {
  gameToDraft,
  isUpcoming,
  dedupeGames,
} from "./auto-contracts.js?v=20260922-cache2";
import {
  attachOddsToDraft,
  fetchKalshiOdds,
  fetchPolymarketOdds,
  isFreshQuote,
  validateQuoteShape,
} from "./odds-feeds.js?v=20260922-cache2";
import { toCanonical } from "./contract-status-vocab.js?v=20260922-cache2";

const FLOW_SOURCE = "contract-flow";
const REVIEW_DIALECT = "review";
const LEDGER_DIALECT = "ledger";

const DEFAULT_BOT_IDENTITY = Object.freeze({
  botId: "contract-scout",
  botName: "Contract Scout",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function nowMsOf(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(ms) ? ms : Date.now();
  } catch {
    return Date.now();
  }
}

function nowIsoOf(now) {
  return new Date(nowMsOf(now)).toISOString();
}

function freezeDeep(value) {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

/**
 * Resolve the read-only network fetch lazily inside the domain module so
 * render/entry layers stay network-free (release boundary). Public GETs
 * only; never used for orders, wallets, signing, or settlement.
 */
function defaultReadOnlyFetch() {
  try {
    const candidate = globalThis?.fetch;
    return typeof candidate === "function" ? candidate.bind(globalThis) : null;
  } catch {
    return null;
  }
}

/**
 * Map a normalized ESPN multi-sport record into the game shape the
 * auto-contracts lane consumes (id/uid/date/competitions/competitors with
 * homeAway, plus flat home/away aliases for the odds matcher).
 *
 * @param {object} record — one record from fetchMultiSportEvents().records
 * @returns {object|null}
 */
export function mapEspnRecordToGame(record) {
  if (!isRecord(record)) return null;
  const gameId = cleanText(record.id);
  if (!gameId) return null;

  const teams = Array.isArray(record.teams) ? record.teams : [];
  const names = teams
    .map((team) => cleanText(team?.name))
    .filter(Boolean);

  let home = "";
  let away = "";
  for (const team of teams) {
    const name = cleanText(team?.name);
    if (!name) continue;
    if (team?.homeAway === "home" && !home) home = name;
    if (team?.homeAway === "away" && !away) away = name;
  }
  if (!home && names[1]) home = names[1];
  if (!away && names[0]) away = names[0];
  if (!home && names[0]) home = names[0];

  const competitors = teams.map((team, index) => ({
    displayName: cleanText(team?.name, "Unknown team"),
    homeAway: team?.homeAway === "home" ? "home" : team?.homeAway === "away" ? "away" : (index === 0 ? "away" : "home"),
  }));

  const leagueLabel = cleanText(record.leagueLabel || record.league, "Unknown league");
  const eventTime = cleanText(record.eventTime);

  return {
    id: gameId,
    uid: gameId,
    gameId,
    date: eventTime || null,
    title: cleanText(record.title, `Game ${gameId}`),
    status: cleanText(record.status),
    league: { name: leagueLabel },
    home,
    away,
    homeTeam: home,
    awayTeam: away,
    competitions: [{ competitors }],
  };
}

/**
 * Normalize one auto-contract lane proposal into the integration draft shape
 * pinned by docs/contract-integration-check.md.
 *
 * @param {object} proposal — gameToDraft(game) output
 * @param {Function} now
 * @returns {object|null}
 */
export function normalizeDraft(proposal, now = () => new Date()) {
  if (!isRecord(proposal)) return null;
  const contractDraft = isRecord(proposal.contractDraft) ? proposal.contractDraft : {};
  const gameId = cleanText(proposal.gameId || contractDraft.gameId);
  if (!gameId) return null;
  const teams = isRecord(contractDraft.teams) ? contractDraft.teams : {};
  const home = cleanText(teams.home, "Unknown team");
  const away = cleanText(teams.away, "Unknown team");
  // Integration target field is `startsAt`; the lane draft carries `startTime`.
  const startsAt = cleanText(contractDraft.startTime) || null;

  return freezeDeep({
    id: `draft:${gameId}`,
    gameId,
    teams: { home, away },
    league: cleanText(contractDraft.league, "Unknown league"),
    startsAt,
    status: toCanonical("draft", REVIEW_DIALECT),
    createdAt: nowIsoOf(now),
    source: "espn-auto",
    title: cleanText(proposal.title, `${away} vs ${home}`),
    laneProposal: proposal,
    oddsQuote: null,
    oddsUnavailable: null,
  });
}

/**
 * One-line human summary of a frozen odds quote for the review card's
 * SOURCES row. Never invents data: returns null when there is no quote.
 *
 * @param {object|null} quote
 * @returns {string|null}
 */
export function describeOddsQuote(quote) {
  if (!isRecord(quote)) return null;
  const price = Number(quote.price);
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return null;
  const venue = cleanText(quote.source, "market").toLowerCase();
  const venueLabel = venue === "kalshi" ? "Kalshi" : venue === "polymarket" ? "Polymarket" : venue;
  const outcome = cleanText(quote.outcome, "Yes");
  return `${venueLabel} ${Math.round(price * 100)}% ${outcome} · fresh ≤15 min · simulated TUMBO points`;
}

/**
 * Build the contract flow controller.
 *
 * @param {object} deps
 * @param {Function} deps.fetchEspnRecords — async () => normalized ESPN records[]
 * @param {object} deps.outcomeDesk — canonical createOutcomeContracts() desk
 * @param {object} deps.proposalQueue — canonical createProposalQueue()
 * @param {object} deps.ledger — createContractLedger()
 * @param {Function} [deps.fetchImpl] — fetch for the odds adapters
 * @param {Function} [deps.now]
 * @param {object} [deps.botIdentity]
 */
export function createContractFlow({
  fetchEspnRecords,
  outcomeDesk,
  proposalQueue,
  ledger,
  fetchImpl = null,
  now = () => new Date(),
  botIdentity = DEFAULT_BOT_IDENTITY,
} = {}) {
  if (typeof fetchEspnRecords !== "function") {
    throw new TypeError("createContractFlow requires fetchEspnRecords");
  }
  if (!isRecord(outcomeDesk) || typeof outcomeDesk.createContract !== "function") {
    throw new TypeError("createContractFlow requires a canonical outcome desk");
  }
  if (!isRecord(proposalQueue) || typeof proposalQueue.submitProposal !== "function") {
    throw new TypeError("createContractFlow requires the proposal queue");
  }
  if (!isRecord(ledger) || typeof ledger.record !== "function") {
    throw new TypeError("createContractFlow requires the contract ledger");
  }

  const seenGameIds = new Set();
  const quotesByProposalId = new Map();
  const draftsByGameId = new Map();

  function mapGames(records) {
    const games = [];
    for (const record of Array.isArray(records) ? records : []) {
      const game = mapEspnRecordToGame(record);
      if (game) games.push(game);
    }
    return games;
  }

  /**
   * Scan ESPN records for upcoming games and build normalized drafts.
   * Idempotent on gameId across scans.
   */
  function scanToday() {
    return Promise.resolve()
      .then(() => fetchEspnRecords())
      .then((records) => {
        const games = mapGames(records);
        const upcoming = games.filter((game) => {
          try {
            return isUpcoming(game, now());
          } catch {
            return false;
          }
        });
        const fresh = dedupeGames(upcoming, seenGameIds);
        const drafts = [];
        for (const game of fresh) {
          const gameId = cleanText(game.gameId || game.id);
          if (!gameId || seenGameIds.has(gameId)) continue;
          seenGameIds.add(gameId);
          let proposal = null;
          try {
            proposal = gameToDraft(game);
          } catch {
            continue;
          }
          const draft = normalizeDraft(proposal, now);
          if (!draft) continue;
          draftsByGameId.set(gameId, draft);
          drafts.push(draft);
        }
        return Object.freeze(drafts);
      });
  }

  /**
   * Attach read-only Kalshi + Polymarket quotes to drafts.
   * Feed failure never blocks a draft: it stays usable with an honest
   * unavailable state.
   */
  async function enrichWithOdds(drafts) {
    const list = Array.isArray(drafts) ? drafts : [];
    const http = typeof fetchImpl === "function" ? fetchImpl : defaultReadOnlyFetch();
    let markets = [];
    if (typeof http === "function") {
      const [kalshi, polymarket] = await Promise.all([
        fetchKalshiOdds({ fetch: http }).catch(() => null),
        fetchPolymarketOdds({ fetch: http }).catch(() => null),
      ]);
      if (kalshi && kalshi.available && Array.isArray(kalshi.markets)) {
        markets = markets.concat(kalshi.markets);
      }
      if (polymarket && polymarket.available && Array.isArray(polymarket.markets)) {
        markets = markets.concat(polymarket.markets);
      }
    }
    return Object.freeze(
      list.map((draft) => {
        if (!isRecord(draft) || markets.length === 0) {
          return freezeDeep({
            ...draft,
            oddsQuote: null,
            oddsUnavailable: markets.length === 0 ? "Odds feeds unavailable; draft remains reviewable." : draft.oddsUnavailable,
          });
        }
        const gameView = {
          title: draft.title,
          home: draft.teams?.home,
          away: draft.teams?.away,
          homeTeam: draft.teams?.home,
          awayTeam: draft.teams?.away,
        };
        let attached = null;
        try {
          attached = attachOddsToDraft({ game: gameView }, { markets });
        } catch {
          attached = null;
        }
        const oddsQuote = attached && attached.oddsQuote ? freezeDeep({ ...attached.oddsQuote }) : null;
        const oddsUnavailable = attached && attached.oddsQuote
          ? null
          : cleanText(attached?.oddsUnavailable, "No market matched this draft.");
        const enriched = freezeDeep({ ...draft, oddsQuote, oddsUnavailable });
        if (draft.gameId) draftsByGameId.set(draft.gameId, enriched);
        return enriched;
      }),
    );
  }

  /**
   * Submit drafts to the Contract Atelier review queue ("Contracts for your
   * review"). The odds line rides in sourceNotes so the existing review card
   * renders it with zero UI changes. The frozen quote is kept in a sidecar
   * keyed by proposal id for approval-time freezing.
   */
  function submitForReview(drafts) {
    const list = Array.isArray(drafts) ? drafts : [];
    const proposals = [];
    for (const draft of list) {
      if (!isRecord(draft) || !draft.gameId) continue;
      const oddsLine = describeOddsQuote(draft.oddsQuote);
      const sourceNotes = oddsLine
        ? `Odds info (read-only): ${oddsLine}`
        : `Odds info: ${cleanText(draft.oddsUnavailable, "unavailable")} (read-only)`;
      const researchNotes = `${cleanText(draft.league)} · starts ${cleanText(draft.startsAt, "TBD")} · auto-draft from ESPN`;
      let proposal = null;
      try {
        proposal = proposalQueue.submitProposal(
          { botId: botIdentity.botId, botName: botIdentity.botName },
          {
            title: draft.title,
            eventLabel: draft.title,
            eventId: draft.gameId,
            outcomes: [draft.teams.home, draft.teams.away].filter((name) => name && name !== "Unknown team"),
            sourceNotes,
            researchNotes,
            expiresAt: cleanText(draft.startsAt) || undefined,
          },
        );
      } catch {
        continue;
      }
      if (!proposal || !proposal.id) continue;
      quotesByProposalId.set(proposal.id, draft.oddsQuote || null);
      try {
        ledger.record({
          contractId: proposal.id,
          type: "created",
          toStatus: "proposed",
          reason: "auto-draft queued for review",
          payload: { gameId: draft.gameId, league: draft.league, startsAt: draft.startsAt },
          ts: nowMsOf(now),
        });
      } catch {
        // Ledger failure never blocks the review queue.
      }
      proposals.push(proposal);
    }
    return Object.freeze(proposals);
  }

  /**
   * Convenience: scan → odds → review queue, fully failure-tolerant.
   */
  async function scanAndQueue() {
    const errors = [];
    let drafts = [];
    try {
      drafts = await scanToday();
    } catch (error) {
      errors.push(`scan: ${error?.message ?? error}`);
    }
    let enriched = drafts;
    try {
      enriched = await enrichWithOdds(drafts);
    } catch (error) {
      errors.push(`odds: ${error?.message ?? error}`);
    }
    let proposals = [];
    try {
      proposals = submitForReview(enriched);
    } catch (error) {
      errors.push(`queue: ${error?.message ?? error}`);
    }
    return freezeDeep({ proposals, drafts: enriched, errors });
  }

  /**
   * Sidecar lookup for the atelier's approval hook.
   */
  function quoteForProposal(proposalId) {
    return quotesByProposalId.get(cleanText(proposalId)) ?? null;
  }

  /**
   * Approval-time handler (wired as the atelier's onContractApproved):
   * re-validates the quote at the moment of approval and freezes the
   * snapshot into the ledger. A stale or missing quote never blocks the
   * approval — it is recorded honestly as unavailable.
   */
  function handleContractApproved({ contract, proposal } = {}) {
    const contractId = cleanText(contract?.id);
    const proposalId = cleanText(proposal?.id);
    if (!contractId) return null;
    const candidate = proposalId ? quoteForProposal(proposalId) : null;
    const currentMs = nowMsOf(now);
    const frozen = candidate && validateQuoteShape(candidate) && isFreshQuote(candidate, currentMs)
      ? freezeDeep({ ...candidate })
      : null;
    const quoteStatus = frozen ? "frozen-at-approval" : "unavailable-at-approval";
    try {
      ledger.record({
        contractId,
        type: "status_change",
        toStatus: "open",
        reason: "approved from review",
        ts: currentMs,
      });
      ledger.record({
        contractId,
        type: "status_change",
        toStatus: "active",
        reason: "book opened",
        payload: { quote: frozen, quoteStatus, proposalId: proposalId || null },
        ts: currentMs,
      });
    } catch {
      // Ledger failure never unwinds an approval.
    }
    return freezeDeep({ contractId, quote: frozen, quoteStatus });
  }

  /**
   * Grade when the event lands: canonical desk grading + ledger audit.
   * Deterministic; anti-double-grade via the desk and the ledger.
   */
  function gradeOnLanding(contractId, result) {
    const id = cleanText(contractId);
    if (!id) throw new TypeError("gradeOnLanding requires a contract id");
    const winner = cleanText(result?.winner).toUpperCase();
    if (!winner) throw new TypeError("gradeOnLanding requires result.winner");
    let graded = null;
    try {
      graded = outcomeDesk.recordResult({ contractId: id, result: winner });
    } catch (error) {
      return freezeDeep({ graded: false, reason: String(error?.message ?? error).slice(0, 160) });
    }
    try {
      ledger.record({
        contractId: id,
        type: "graded",
        toStatus: "graded",
        reason: `event landed: ${winner}`,
        payload: { winner, gradedAt: nowIsoOf(now) },
        ts: nowMsOf(now),
      });
    } catch {
      // Ledger failure never unwinds grading.
    }
    return freezeDeep({ graded: true, contract: graded });
  }

  /**
   * Claim forever: canonical anti-double-claim + ledger audit.
   * expiresAt stays null — a win is claimable forever.
   */
  function claimForever({ nftId, idempotencyKey = null, participant = null } = {}) {
    const id = cleanText(nftId);
    if (!id) throw new TypeError("claimForever requires an nft id");
    let receipt = null;
    try {
      receipt = outcomeDesk.claimAward({ nftId: id, idempotencyKey });
    } catch (error) {
      return freezeDeep({ claimed: false, reason: String(error?.message ?? error).slice(0, 160) });
    }
    try {
      ledger.record({
        contractId: cleanText(receipt?.contractId),
        type: "claimed",
        toStatus: "claimed",
        participant: cleanText(participant),
        reason: "award claimed (forever)",
        payload: { nftId: id, expiresAt: null },
        ts: nowMsOf(now),
      });
    } catch {
      // Ledger failure never unwinds a claim.
    }
    return freezeDeep({ claimed: true, receipt });
  }

  return Object.freeze({
    source: FLOW_SOURCE,
    scanToday,
    enrichWithOdds,
    submitForReview,
    scanAndQueue,
    quoteForProposal,
    handleContractApproved,
    gradeOnLanding,
    claimForever,
  });
}

export const CONTRACT_FLOW_CONSTANTS = Object.freeze({
  FLOW_SOURCE,
  REVIEW_DIALECT,
  LEDGER_DIALECT,
});
