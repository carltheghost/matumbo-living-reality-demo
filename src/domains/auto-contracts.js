/**
 * Automatic contract creation from today's sports games.
 *
 * Reality Lens Ω:
 * - ESPN data is read-only.
 * - Contracts are projection-only.
 * - Contract values are simulated TUMBO Points only.
 * - No wallet, signing, custody, settlement, or mainnet execution exists here.
 */
const SIMULATION_ONLY = true;
const CONTRACT_KIND = "outcome-contract-draft";
const PROPOSAL_KIND = "contract-review";
const REVIEW_QUEUE = "Contracts for your review";

/**
 * Return a stable game identifier when the feed uses one of the supported
 * ESPN-style identifier locations.
 *
 * @param {object} game
 * @returns {string}
 */
function getGameId(game) {
  if (!game || typeof game !== "object") {
    return "";
  }
  const candidates = [
    game.id,
    game.gameId,
    game.eventId,
    game.uid,
    game.event?.id,
    game.event?.uid,
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null) {
      const value = String(candidate).trim();
      if (value) {
        return value;
      }
    }
  }
  return "";
}

/**
 * Extract a team display name from the common ESPN event shapes.
 *
 * @param {object} team
 * @returns {string}
 */
function teamName(team) {
  if (!team || typeof team !== "object") {
    return "Unknown team";
  }
  return String(
    team.displayName ??
      team.name ??
      team.shortName ??
      team.abbreviation ??
      team.team?.displayName ??
      team.team?.name ??
      "Unknown team",
  ).trim();
}

/**
 * Extract the two competitors from an event.
 *
 * @param {object} game
 * @returns {{homeTeam: string, awayTeam: string}}
 */
function getTeams(game) {
  const competitions =
    Array.isArray(game?.competitions) && game.competitions.length > 0
      ? game.competitions
      : Array.isArray(game?.event?.competitions) &&
          game.event.competitions.length > 0
        ? game.event.competitions
        : [];
  const competition = competitions[0];
  const competitors = Array.isArray(competition?.competitors)
    ? competition.competitors
    : Array.isArray(game?.competitors)
      ? game.competitors
      : [];
  let homeTeam = "";
  let awayTeam = "";
  for (const competitor of competitors) {
    const name = teamName(competitor);
    if (competitor?.homeAway === "home") {
      homeTeam = name;
    } else if (competitor?.homeAway === "away") {
      awayTeam = name;
    }
  }
  if (!homeTeam && competitors[0]) {
    homeTeam = teamName(competitors[0]);
  }
  if (!awayTeam && competitors[1]) {
    awayTeam = teamName(competitors[1]);
  }
  return {
    homeTeam: homeTeam || "Unknown team",
    awayTeam: awayTeam || "Unknown team",
  };
}

/**
 * Extract the league/competition name.
 *
 * @param {object} game
 * @returns {string}
 */
function getLeague(game) {
  return String(
    game?.league?.name ??
      game?.competition?.name ??
      game?.competitions?.[0]?.league?.name ??
      game?.competitions?.[0]?.name ??
      game?.event?.league?.name ??
      game?.event?.competitions?.[0]?.league?.name ??
      game?.event?.competitions?.[0]?.name ??
      game?.sport?.name ??
      "Unknown league",
  ).trim();
}

/**
 * Extract an event start timestamp.
 *
 * @param {object} game
 * @returns {string|null}
 */
function getStartTime(game) {
  const value =
    game?.startTime ??
    game?.startDate ??
    game?.date ??
    game?.commenceTime ??
    game?.event?.startTime ??
    game?.event?.startDate ??
    game?.event?.date ??
    null;
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

/**
 * Determine whether a game has not started yet.
 *
 * Games without a valid start time are not considered upcoming because the
 * automatic contract engine must not manufacture timing information.
 *
 * @param {object} game
 * @param {Date|string|number} now
 * @returns {boolean}
 */
export function isUpcoming(game, now) {
  const startTime = getStartTime(game);
  if (!startTime) {
    return false;
  }
  const current = new Date(now);
  const start = new Date(startTime);
  if (Number.isNaN(current.getTime()) || Number.isNaN(start.getTime())) {
    return false;
  }
  return start.getTime() > current.getTime();
}

/**
 * Remove games that have already been seen and duplicate games from the
 * current feed.
 *
 * The returned array preserves feed order.
 *
 * @param {Array<object>} games
 * @param {Set<string>|Iterable<string>} seenIds
 * @returns {Array<object>}
 */
export function dedupeGames(games, seenIds = new Set()) {
  const seen =
    seenIds instanceof Set ? new Set(seenIds) : new Set(seenIds || []);
  const unique = [];
  for (const game of Array.isArray(games) ? games : []) {
    const id = getGameId(game);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(game);
  }
  return unique;
}

/**
 * Convert one sports event into the canonical automatic-contract draft.
 *
 * @param {object} game
 * @returns {object}
 */
export function gameToDraft(game) {
  const gameId = getGameId(game);
  const { homeTeam, awayTeam } = getTeams(game);
  const league = getLeague(game);
  const startTime = getStartTime(game);
  const title =
    homeTeam !== "Unknown team" && awayTeam !== "Unknown team"
      ? `${awayTeam} vs ${homeTeam}`
      : `Outcome contract for game ${gameId || "unknown"}`;
  const contractDraft = Object.freeze({
    kind: CONTRACT_KIND,
    id: `auto-contract:${gameId}`,
    gameId,
    teams: Object.freeze({
      home: homeTeam,
      away: awayTeam,
    }),
    league,
    startTime,
    simulationOnly: SIMULATION_ONLY,
    settlement: "projection-only",
    asset: "TUMBO_POINTS_SIMULATED",
    source: "ESPN_READ_ONLY",
  });
  return Object.freeze({
    id: `proposal:auto-contract:${gameId}`,
    kind: PROPOSAL_KIND,
    type: PROPOSAL_KIND,
    queue: REVIEW_QUEUE,
    title,
    summary: `Simulated TUMBO Points outcome contract draft for ${title}.`,
    status: "DRAFT",
    gameId,
    createdBy: "auto-contracts",
    source: "ESPN_READ_ONLY",
    simulationOnly: SIMULATION_ONLY,
    execution: "NONE",
    contractDraft,
  });
}

/**
 * Build the automatic contract engine.
 *
 * The supplied createOutcomeContracts dependency is intentionally treated as
 * a factory/function boundary. The engine supports factories that either:
 *
 *   1. return a contract-creation function, or
 *   2. directly return the created contract when passed a draft.
 *
 * The resulting proposal remains a DRAFT and never executes anything.
 *
 * @param {object} dependencies
 * @param {Function} dependencies.fetchSportsEvents
 * @param {Function} dependencies.createOutcomeContracts
 * @param {Function} dependencies.now
 * @returns {{
 *   scanToday: Function,
 *   draftContractsForGames: Function,
 *   getDrafts: Function,
 *   clearDrafts: Function
 * }}
 */
export function createAutoContracts({
  fetchSportsEvents,
  createOutcomeContracts,
  now = () => new Date(),
}) {
  if (typeof fetchSportsEvents !== "function") {
    throw new TypeError("createAutoContracts requires fetchSportsEvents");
  }
  if (typeof createOutcomeContracts !== "function") {
    throw new TypeError("createAutoContracts requires createOutcomeContracts");
  }
  if (typeof now !== "function") {
    throw new TypeError("createAutoContracts requires now to be a function");
  }
  const drafts = [];
  const seenIds = new Set();
  let contractFactory;
  try {
    contractFactory = createOutcomeContracts({ simulationOnly: true });
  } catch {
    contractFactory = null;
  }

  /**
   * Send a draft through the outcome-contract factory boundary when the
   * connected factory exposes a callable creator. If the supplied factory
   * itself is the creator, use it directly.
   *
   * The auto-contract layer does not execute or settle contracts.
   *
   * @param {object} proposal
   * @returns {object}
   */
  function materializeContractDraft(proposal) {
    const draft = proposal.contractDraft;
    if (typeof contractFactory === "function") {
      const result = contractFactory(draft);
      if (result && typeof result === "object") {
        return result;
      }
    }
    try {
      const result = createOutcomeContracts(draft);
      if (result && typeof result === "object") {
        return result;
      }
    } catch {
      // A factory may require its own initialization signature. The proposal
      // itself remains a valid DRAFT and is still reviewable.
    }
    return draft;
  }

  /**
   * Draft contracts for every previously unseen game.
   *
   * @param {Array<object>} games
   * @returns {Array<object>}
   */
  function draftContractsForGames(games) {
    const candidates = dedupeGames(games, seenIds);
    const created = [];
    for (const game of candidates) {
      const gameId = getGameId(game);
      if (!gameId || seenIds.has(gameId)) {
        continue;
      }
      seenIds.add(gameId);
      const proposal = gameToDraft(game);
      const contract = materializeContractDraft(proposal);
      const reviewEntry = Object.freeze({
        ...proposal,
        contract,
      });
      drafts.push(reviewEntry);
      created.push(reviewEntry);
    }
    return Object.freeze(created);
  }

  /**
   * Fetch today's sports events and create contracts only for future games.
   *
   * @returns {Promise<ReadonlyArray<object>>}
   */
  async function scanToday() {
    const events = await fetchSportsEvents();
    const games = Array.isArray(events)
      ? events
      : Array.isArray(events?.games)
        ? events.games
        : Array.isArray(events?.events)
          ? events.events
          : [];
    const upcomingGames = games.filter((game) => isUpcoming(game, now()));
    return draftContractsForGames(upcomingGames);
  }

  /**
   * Return the current review queue without exposing the mutable backing
   * array.
   *
   * @returns {ReadonlyArray<object>}
   */
  function getDrafts() {
    return Object.freeze([...drafts]);
  }

  /**
   * Clear the generated review queue and its idempotency state.
   */
  function clearDrafts() {
    drafts.length = 0;
    seenIds.clear();
  }

  return Object.freeze({
    scanToday,
    draftContractsForGames,
    getDrafts,
    clearDrafts,
  });
}
