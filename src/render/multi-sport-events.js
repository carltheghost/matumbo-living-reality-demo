import {
  MULTI_SPORT_EVENTS_BOUNDARY,
  classifyScoreboardStatus,
  createUnavailableMultiSportEvents,
  leagueProviderLabel,
  replayMultiSportEvents,
  summarizeMultiSportEvents,
} from "../domains/multi-sport-events.js";
import {
  LEAGUE_CATALOG,
  LEAGUE_UNAVAILABLE,
  findLeagueCatalogEntry,
  leagueCatalogRegions,
} from "../data/league-catalog.js";

export const MULTI_SPORT_EVENTS_CONSOLE_SOURCE = "multi-sport-events-evidence-console";
const SOURCE_RETURN_RECORD_ID_PATTERN = /^[a-z0-9:_.-]{1,160}$/i;

function text(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  if (value === null || typeof value !== "object") return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

function publicLink(documentRoot, className, href, label) {
  if (typeof href !== "string" || !/^https:\/\//i.test(href)) return null;
  const link = documentRoot.createElement("a");
  link.className = className;
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

function participantLine(participant) {
  if (!participant) return "PARTICIPANT UNAVAILABLE";
  const score = participant.scoreStatus === "provider-reported" ? ` · SCORE ${participant.score}` : " · SCORE UNAVAILABLE";
  const side = participant.homeAway ? ` · ${participant.homeAway.toUpperCase()}` : "";
  const rank = Number.isSafeInteger(participant.rank) ? ` · RANK #${participant.rank}` : "";
  return `${participant.name ?? "Participant unavailable"}${participant.abbreviation ? ` (${participant.abbreviation})` : ""}${side}${score}${rank}`;
}

function recordParticipants(record) {
  return Array.isArray(record?.participants) ? record.participants : [];
}

function contractDraftRecord(record) {
  const participants = recordParticipants(record);
  if (!record || typeof record.id !== "string" || !record.id.trim() || participants.length !== 2) return null;
  if (participants.some((participant) => typeof participant?.name !== "string" || !participant.name.trim() || participant.name === "Participant unavailable")) return null;
  if (typeof record.sourceUrl !== "string" || !/^https:\/\//i.test(record.sourceUrl)) return null;
  try {
    const parsed = new URL(record.sourceUrl);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !(host === "espn.com" || host.endsWith(".espn.com") || host === "espncdn.com" || host.endsWith(".espncdn.com"))) return null;
  } catch { return null; }
  return Object.freeze({
    ...record,
    sourcePanel: "multi-sport-events",
    tour: "SPORTS",
    players: participants.map((participant) => Object.freeze({ id: participant.id ?? null, name: participant.name, rank: Number.isSafeInteger(participant.rank) ? participant.rank : null })),
  });
}

function recordStatus(record) {
  const detail = record?.statusDetail ?? {};
  const state = detail.state ? ` · STATE ${detail.state}` : "";
  const completed = detail.completed === true ? " · COMPLETED" : detail.completed === false ? " · NOT COMPLETED" : "";
  return `${record?.status ?? "status unavailable"}${state}${completed}`;
}

function recordTitle(record) {
  return record?.title ?? `${record?.sport ?? "SPORT"} event ${record?.competition?.id ?? "unavailable"}`;
}

function detailPlayerLine(player) {
  if (!player) return "PLAYER CONTEXT UNAVAILABLE";
  const team = player.teamName ? ` · TEAM ${player.teamName}` : "";
  const role = player.position ? ` · ${player.position}` : "";
  const jersey = player.jersey ? ` · #${player.jersey}` : "";
  const stats = Array.isArray(player.statLines) && player.statLines.length
    ? ` · ${player.statLines.slice(0, 3).map((stat) => [stat.label, stat.value].filter(Boolean).join(" ")).join(" · ")}`
    : "";
  return `${player.name ?? "Player unavailable"}${team}${role}${jersey}${stats}`;
}

function detailPeriodLine(period) {
  const scores = Array.isArray(period?.scores)
    ? period.scores.map((score) => `${score.participantName ?? "Participant"} ${score.value ?? "—"}`).join(" · ")
    : "";
  return `${period?.label ?? `PERIOD ${period?.period ?? "—"}`} · ${scores || "SCORES UNAVAILABLE"} · ${String(period?.status ?? "unavailable").toUpperCase()}`;
}

function detailPlayLine(play) {
  const location = [
    play?.period !== null && play?.period !== undefined ? `PERIOD ${play.period}` : null,
    play?.quarter !== null && play?.quarter !== undefined && play.quarter !== play.period ? `QUARTER ${play.quarter}` : null,
    play?.clock ? `CLOCK ${play.clock}` : null,
  ].filter(Boolean).join(" · ");
  const body = [play?.text, play?.participant, play?.score].filter(Boolean).join(" · ") || "provider play detail";
  return `${play?.index ?? "—"} · ${(play?.kind ?? "play").toUpperCase()}${location ? ` · ${location}` : ""} · ${body}`;
}

/* ------------------------------------------------------------------ */
/* All-leagues modal browser. Presentation owns only DOM state; the    */
/* host supplies onLeagueRequest({slug, date}) which performs the      */
/* queued provider read. The domain layer (league catalog + scoreboard  */
/* queue) is loaded lazily so this console keeps working when the      */
/* league domain files are not present yet.                            */
/* ------------------------------------------------------------------ */
const LEAGUE_FAVORITES_KEY = "matumbo:league-favorites:v1";
const LEAGUE_FAVORITES_MAX = 6;
const LEAGUE_PAGE_SIZE = 20;
const LEAGUE_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Catalog + unavailable rows come from Agent A's domain layer (static).
// classifyScoreboardStatus is the domain classifier: "live" | "final" |
// "scheduled" | "unknown" (defensive: null/absent statusDetail → "unknown").
function leagueTodayISO() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function leagueISOToParam(iso) {
  const match = LEAGUE_ISO_RE.exec(String(iso ?? ""));
  return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

function leagueParamToISO(param) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(param ?? ""));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function leagueShiftISO(iso, deltaDays) {
  const match = LEAGUE_ISO_RE.exec(String(iso ?? ""));
  if (!match) return leagueTodayISO();
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + deltaDays);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function leagueGameTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "TIME UNAVAILABLE";
  return parsed.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function leagueGameStatusLine(record) {
  const detail = record && typeof record.statusDetail === "object" ? record.statusDetail : {};
  const clock = detail.clock ? ` · CLOCK ${detail.clock}` : "";
  const period = detail.period !== null && detail.period !== undefined && detail.period !== "" ? ` · PERIOD ${detail.period}` : "";
  return `STATUS · ${text(record?.status, "status unavailable")}${clock}${period}`;
}

function loadLeagueFavorites() {
  try {
    const raw = globalThis.localStorage?.getItem(LEAGUE_FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((slug) => typeof slug === "string" && slug).slice(0, LEAGUE_FAVORITES_MAX)
      : [];
  } catch {
    return [];
  }
}

function saveLeagueFavorites(list) {
  try {
    globalThis.localStorage?.setItem(LEAGUE_FAVORITES_KEY, JSON.stringify(list));
  } catch {
    // Private mode: favorites stay in memory for this session only.
  }
}

function createLeagueBrowser({ documentRoot, mounts, onLeagueRequest }) {
  const {
    browseButton, modal, closeButton, searchInput, favoritesEl, groupsEl,
    prevButton, todayButton, nextButton, dateInput, chipsEl, refreshButton,
    viewButton, sortSelect, statusEl, gamesEl, moreButton,
  } = mounts;

  const catalogEntries = Array.isArray(LEAGUE_CATALOG)
    ? LEAGUE_CATALOG.filter((entry) => entry && typeof entry.slug === "string")
    : [];
  const unavailableEntries = Array.isArray(LEAGUE_UNAVAILABLE)
    ? LEAGUE_UNAVAILABLE.filter((entry) => entry && typeof entry.label === "string")
    : [];
  const classifyStatus = classifyScoreboardStatus;
  let favorites = loadLeagueFavorites();
  let selectedSlug = null;
  let selectedLabel = null;
  let statusFilter = "all";
  let sortMode = "kickoff";
  let detailedView = false;
  let shownCount = LEAGUE_PAGE_SIZE;
  let requestSeq = 0;
  let lastEnvelope = null;
  let modalOpen = false;

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function hostAvailable() {
    return typeof onLeagueRequest === "function";
  }

  function catalogEntryFor(slug) {
    try {
      return findLeagueCatalogEntry(slug) ?? null;
    } catch {
      return catalogEntries.find((entry) => entry?.slug === slug) ?? null;
    }
  }

  // Per-league source attribution for the games panel header ("via
  // TheSportsDB" etc.), read from the catalog entry's provider tag.
  function selectedProviderAttribution() {
    try {
      const entry = catalogEntryFor(selectedSlug ?? lastEnvelope?.league ?? null);
      return leagueProviderLabel(entry?.provider) ?? "ESPN";
    } catch {
      return "ESPN";
    }
  }

  // Region display order comes from the catalog (Popular first, then
  // alphabetical, International last); unknown regions sort after.
  function orderedLeagueRegions() {
    const grouped = new Map();
    catalogEntries.forEach((entry) => {
      const region = entry.region || "OTHER";
      if (!grouped.has(region)) grouped.set(region, []);
      grouped.get(region).push(entry);
    });
    let displayOrder = [];
    try {
      displayOrder = leagueCatalogRegions() ?? [];
    } catch {
      displayOrder = [];
    }
    const ordered = [];
    displayOrder.forEach((name) => {
      if (grouped.has(name)) {
        ordered.push([name, grouped.get(name)]);
        grouped.delete(name);
      }
    });
    [...grouped.entries()]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .forEach((entry) => ordered.push(entry));
    return ordered;
  }

  function currentDateISO() {
    const raw = dateInput.value;
    return LEAGUE_ISO_RE.test(String(raw)) ? raw : leagueTodayISO();
  }

  function currentDateParam() {
    return leagueISOToParam(currentDateISO());
  }

  function markLeaguePressed() {
    const sync = (root) => root.querySelectorAll?.("[data-league-slug]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.leagueSlug === selectedSlug));
    });
    sync(groupsEl);
    sync(favoritesEl);
  }

  function leagueMatches(entry, query) {
    if (!query) return true;
    const haystack = `${entry.label ?? ""} ${entry.slug ?? ""} ${entry.espnName ?? ""} ${entry.tsdbName ?? ""}`.toLowerCase();
    return haystack.includes(query);
  }

  function leagueRow(entry) {
    const row = documentRoot.createElement("div");
    row.className = "multi-sport-events-league-row";
    const button = documentRoot.createElement("button");
    button.type = "button";
    button.className = "multi-sport-events-league-name";
    button.dataset.leagueSlug = entry.slug;
    button.setAttribute("aria-pressed", String(entry.slug === selectedSlug));
    button.title = entry.provider === "thesportsdb" && entry.tsdbName
      ? `${entry.label} · TheSportsDB ${entry.tsdbName}`
      : entry.provider === "openligadb"
        ? `${entry.label} · OpenLigaDB`
        : entry.espnName ? `${entry.label} · ESPN ${entry.espnName}` : entry.label;
    const label = documentRoot.createElement("span");
    label.className = "multi-sport-events-league-name-label";
    label.textContent = entry.label;
    button.appendChild(label);
    if (entry.popular === true) {
      const popular = documentRoot.createElement("span");
      popular.className = "multi-sport-events-league-popular";
      popular.textContent = "POPULAR";
      button.appendChild(popular);
    }
    button.addEventListener("click", () => selectLeague(entry.slug, "button"));
    const star = documentRoot.createElement("button");
    star.type = "button";
    star.className = "multi-sport-events-league-star";
    star.dataset.leagueSlug = entry.slug;
    const isFavorite = favorites.includes(entry.slug);
    star.setAttribute("aria-pressed", String(isFavorite));
    star.setAttribute("aria-label", isFavorite ? `Remove ${entry.label} from favorites` : `Add ${entry.label} to favorites`);
    star.textContent = isFavorite ? "★" : "☆";
    star.addEventListener("click", () => toggleFavorite(entry.slug, "button"));
    row.append(button, star);
    return row;
  }

  function renderGroups() {
    groupsEl.replaceChildren();
    const query = searchInput.value.trim().toLowerCase();
    orderedLeagueRegions()
      .forEach(([region, entries]) => {
        const visible = entries.filter((entry) => leagueMatches(entry, query));
        if (!visible.length) return;
        const details = documentRoot.createElement("details");
        details.className = "multi-sport-events-league-region";
        details.open = query !== "" || visible.some((entry) => entry.popular === true || favorites.includes(entry.slug));
        const summary = documentRoot.createElement("summary");
        summary.className = "multi-sport-events-league-region-title";
        summary.textContent = `${region} · ${visible.length}`;
        details.appendChild(summary);
        const list = documentRoot.createElement("div");
        list.className = "multi-sport-events-league-list";
        visible.forEach((entry) => list.appendChild(leagueRow(entry)));
        details.appendChild(list);
        groupsEl.appendChild(details);
      });
    if (unavailableEntries.length) {
      const details = documentRoot.createElement("details");
      details.className = "multi-sport-events-league-region multi-sport-events-league-region-missing";
      const summary = documentRoot.createElement("summary");
      summary.className = "multi-sport-events-league-region-title";
      summary.textContent = `UNAVAILABLE · ${unavailableEntries.length}`;
      details.appendChild(summary);
      const list = documentRoot.createElement("div");
      list.className = "multi-sport-events-league-list";
      unavailableEntries.forEach((entry) => {
        const row = documentRoot.createElement("div");
        row.className = "multi-sport-events-league-row multi-sport-events-league-row-unavailable";
        row.title = entry.reason ?? "Not available";
        const name = documentRoot.createElement("span");
        name.className = "multi-sport-events-league-name-label";
        name.textContent = `${entry.label}${entry.region ? ` · ${entry.region}` : ""}`;
        const tag = documentRoot.createElement("span");
        tag.className = "multi-sport-events-league-notespn";
        tag.textContent = "UNAVAILABLE";
        row.append(name, tag);
        list.appendChild(row);
      });
      details.appendChild(list);
      groupsEl.appendChild(details);
    }
    if (!groupsEl.children.length) {
      groupsEl.appendChild(createText(
        documentRoot,
        "div",
        "multi-sport-events-empty",
        query
          ? `NO LEAGUES MATCH "${searchInput.value.trim()}" · NO DATA FABRICATED`
          : "NO LEAGUE CATALOG LOADED · DOMAIN LAYER NOT READY · NO DATA FABRICATED",
      ));
    }
    markLeaguePressed();
  }

  function renderFavorites() {
    favoritesEl.replaceChildren();
    if (!favorites.length) {
      favoritesEl.hidden = true;
      return;
    }
    favoritesEl.hidden = false;
    const label = documentRoot.createElement("span");
    label.className = "multi-sport-events-league-favorites-label";
    label.textContent = "FAVORITES";
    favoritesEl.appendChild(label);
    favorites.forEach((slug) => {
      const entry = catalogEntryFor(slug);
      const wrap = documentRoot.createElement("span");
      wrap.className = "multi-sport-events-league-favorite-wrap";
      const chip = documentRoot.createElement("button");
      chip.type = "button";
      chip.className = "multi-sport-events-league-favorite";
      chip.dataset.leagueSlug = slug;
      chip.setAttribute("aria-pressed", String(slug === selectedSlug));
      chip.textContent = entry?.label ?? slug;
      chip.addEventListener("click", () => selectLeague(slug, "favorite"));
      const remove = documentRoot.createElement("button");
      remove.type = "button";
      remove.className = "multi-sport-events-league-favorite-remove";
      remove.setAttribute("aria-label", `Remove ${entry?.label ?? slug} from favorites`);
      remove.textContent = "×";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleFavorite(slug, "favorite-remove");
      });
      wrap.append(chip, remove);
      favoritesEl.appendChild(wrap);
    });
  }

  function toggleFavorite(slug, method = "button") {
    void method;
    if (favorites.includes(slug)) {
      favorites = favorites.filter((candidate) => candidate !== slug);
      saveLeagueFavorites(favorites);
      renderFavorites();
      renderGroups();
      return;
    }
    if (favorites.length >= LEAGUE_FAVORITES_MAX) {
      setStatus(`FAVORITES FULL · ${LEAGUE_FAVORITES_MAX} MAX · REMOVE ONE FIRST`);
      return;
    }
    favorites = [...favorites, slug];
    saveLeagueFavorites(favorites);
    renderFavorites();
    renderGroups();
  }

  function leagueGameRow(record) {
    const row = documentRoot.createElement("div");
    row.className = "multi-sport-events-league-game";
    row.setAttribute("role", "listitem");
    row.dataset.leagueStatus = classifyStatus(record);
    row.append(
      createText(documentRoot, "strong", "multi-sport-events-league-game-title", recordTitle(record)),
      createText(documentRoot, "span", "multi-sport-events-league-game-meta", `${leagueGameTime(record?.eventTime)} · ${leagueGameStatusLine(record)}`),
    );
    recordParticipants(record).forEach((participant) => row.appendChild(createText(
      documentRoot, "span", "multi-sport-events-league-game-score", participantLine(participant),
    )));
    if (detailedView) {
      const venue = (record && typeof record.venue === "object") ? record.venue : {};
      row.appendChild(createText(
        documentRoot,
        "span",
        "multi-sport-events-league-game-venue",
        `VENUE · ${text(venue.name, "UNAVAILABLE")}${venue.city ? ` · ${venue.city}` : ""}${venue.state ? ` · ${venue.state}` : ""}${venue.country ? ` · ${venue.country}` : ""}`,
      ));
      row.appendChild(createText(
        documentRoot,
        "span",
        "multi-sport-events-league-game-grade",
        `DATA COMPLETENESS · ${record?.dataCompletenessGrade ?? "D"} · ${record?.dataCompletenessPercent ?? 0}% · FIELD PRESENCE ONLY`,
      ));
    }
    const link = publicLink(documentRoot, "multi-sport-events-league-game-source", record?.sourceUrl, `OPEN PUBLIC ${selectedProviderAttribution().toUpperCase()} SOURCE`);
    row.appendChild(link ?? createText(
      documentRoot,
      "span",
      "multi-sport-events-league-game-source-unavailable",
      "PUBLIC SOURCE UNAVAILABLE · NO SAFE HTTPS SOURCE",
    ));
    return row;
  }

  function renderGames() {
    gamesEl.replaceChildren();
    moreButton.hidden = true;
    if (!selectedSlug) {
      gamesEl.appendChild(createText(documentRoot, "div", "multi-sport-events-empty", "SELECT A LEAGUE TO BROWSE PUBLIC SCOREBOARDS · NO DATA FABRICATED"));
      return;
    }
    const envelope = lastEnvelope;
    const records = Array.isArray(envelope?.records) ? envelope.records : [];
    if (!records.length || envelope?.empty === true) {
      gamesEl.appendChild(createText(
        documentRoot,
        "div",
        "multi-sport-events-empty",
        text(envelope?.emptyReason ?? envelope?.reason, `NO GAMES RETURNED FOR ${envelope?.leagueLabel ?? selectedLabel ?? "THIS LEAGUE"} ON ${currentDateISO()} · NO DATA FABRICATED`),
      ));
      return;
    }
    const filtered = records
      .filter((record) => statusFilter === "all" || classifyStatus(record) === statusFilter)
      .slice()
      .sort((a, b) => {
        if (sortMode === "live-first") {
          const rank = (record) => (classifyStatus(record) === "live" ? 0 : 1);
          const diff = rank(a) - rank(b);
          if (diff) return diff;
        }
        const timeA = new Date(a?.eventTime).getTime();
        const timeB = new Date(b?.eventTime).getTime();
        const safeA = Number.isNaN(timeA) ? Number.MAX_SAFE_INTEGER : timeA;
        const safeB = Number.isNaN(timeB) ? Number.MAX_SAFE_INTEGER : timeB;
        return safeA - safeB;
      });
    if (!filtered.length) {
      gamesEl.appendChild(createText(documentRoot, "div", "multi-sport-events-empty", `NO ${statusFilter.toUpperCase()} GAMES IN THIS RESPONSE · TRY ANOTHER FILTER · NO DATA FABRICATED`));
      return;
    }
    filtered.slice(0, shownCount).forEach((record) => gamesEl.appendChild(leagueGameRow(record)));
    const remaining = filtered.length - shownCount;
    if (remaining > 0) {
      moreButton.hidden = false;
      moreButton.textContent = `SHOW MORE · ${remaining} MORE`;
    }
  }

  function handleEnvelope(envelope, fromCache = false) {
    if (!envelope || typeof envelope !== "object") {
      setStatus("LEAGUE RESPONSE UNAVAILABLE · NO DATA FABRICATED");
      renderGames();
      return;
    }
    if (envelope.throttled === true || envelope.status === "throttled") {
      // Throttle is polite: keep the prior rows on screen, never blank the panel.
      gamesEl.classList.remove("multi-sport-events-league-games-loading");
      setStatus("SLOW DOWN · TOO MANY LEAGUE REQUESTS · WAIT A FEW SECONDS, THEN REFRESH");
      return;
    }
    lastEnvelope = envelope;
    shownCount = LEAGUE_PAGE_SIZE;
    const dateLabel = envelope.dateParam ? (leagueParamToISO(envelope.dateParam) ?? envelope.dateParam) : currentDateISO();
    const leagueLabel = envelope.leagueLabel ?? selectedLabel ?? "LEAGUE";
    const via = `via ${selectedProviderAttribution()}`;
    if (envelope.status === "unavailable" || envelope.empty === true) {
      const why = text(envelope.emptyReason ?? envelope.reason, "NO DATA RETURNED");
      setStatus(`${String(envelope.status ?? "unavailable").toUpperCase()} · ${leagueLabel} · ${dateLabel} · ${via} · ${why}${fromCache ? " · CACHED" : ""}`);
    } else {
      const count = Array.isArray(envelope.records) ? envelope.records.length : 0;
      setStatus(`${String(envelope.status ?? "ready").toUpperCase()} · ${leagueLabel} · ${dateLabel} · ${via} · ${count} GAME${count === 1 ? "" : "S"}${fromCache ? " · CACHED" : ""}`);
    }
    renderGames();
  }

  async function requestLeague(method = "button") {
    void method;
    if (!hostAvailable()) {
      setStatus("LEAGUE BROWSING UNAVAILABLE IN THIS HOST");
      return null;
    }
    if (!selectedSlug) {
      setStatus("SELECT A LEAGUE TO BROWSE PUBLIC SCOREBOARDS");
      return null;
    }
    const date = currentDateParam();
    const id = ++requestSeq;
    gamesEl.classList.add("multi-sport-events-league-games-loading");
    setStatus(`REQUESTING… · ${selectedLabel ?? selectedSlug} · ${date ?? "DATE UNAVAILABLE"}`);
    try {
      const result = await onLeagueRequest({ slug: selectedSlug, date });
      if (id !== requestSeq) return null; // stale response: a newer request already replaced it
      gamesEl.classList.remove("multi-sport-events-league-games-loading");
      handleEnvelope(result?.envelope ?? null, result?.fromCache === true);
      return result;
    } catch (error) {
      if (id !== requestSeq) return null; // stale response
      gamesEl.classList.remove("multi-sport-events-league-games-loading");
      setStatus(`LEAGUE REQUEST FAILED · ${text(error?.message ?? error, "unknown error")} · NO DATA FABRICATED`);
      return null;
    }
  }

  function selectLeague(slug, method = "button") {
    if (!hostAvailable()) {
      setStatus("LEAGUE BROWSING UNAVAILABLE IN THIS HOST");
      return;
    }
    const entry = catalogEntryFor(slug);
    if (!entry) return;
    selectedSlug = entry.slug;
    selectedLabel = entry.label;
    shownCount = LEAGUE_PAGE_SIZE;
    markLeaguePressed();
    void requestLeague(method);
  }

  // Catalog is statically imported; this just (re)renders and reports readiness.
  function ensureCatalog() {
    if (catalogEntries.length) {
      renderGroups();
      renderFavorites();
      return true;
    }
    renderGroups();
    return false;
  }

  function open() {
    modalOpen = true;
    modal.hidden = false;
    // A close-during-load can strand the loading state; clear it on open.
    gamesEl.classList.remove("multi-sport-events-league-games-loading");
    if (!hostAvailable()) {
      setStatus("LEAGUE BROWSING UNAVAILABLE IN THIS HOST");
    } else if (!selectedSlug) {
      setStatus("SELECT A LEAGUE TO BROWSE PUBLIC SCOREBOARDS");
    }
    const catalogReady = ensureCatalog();
    if (!catalogReady && hostAvailable()) {
      setStatus("LEAGUE CATALOG UNAVAILABLE · DOMAIN LAYER NOT LOADED · NO DATA FABRICATED");
    }
    searchInput.focus?.();
  }

  function close() {
    modalOpen = false;
    modal.hidden = true;
    // Invalidate in-flight requests so a late response cannot repaint a closed modal.
    requestSeq += 1;
    browseButton.focus?.();
  }

  browseButton.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation(); // do not also close the parent console
      close();
    }
  });
  searchInput.addEventListener("input", () => renderGroups());
  prevButton.addEventListener("click", () => {
    dateInput.value = leagueShiftISO(currentDateISO(), -1);
    if (selectedSlug) void requestLeague("day-prev");
  });
  nextButton.addEventListener("click", () => {
    dateInput.value = leagueShiftISO(currentDateISO(), 1);
    if (selectedSlug) void requestLeague("day-next");
  });
  todayButton.addEventListener("click", () => {
    dateInput.value = leagueTodayISO();
    if (selectedSlug) void requestLeague("day-today");
  });
  dateInput.addEventListener("change", () => {
    if (!LEAGUE_ISO_RE.test(String(dateInput.value))) {
      dateInput.value = currentDateISO();
      return;
    }
    if (selectedSlug) void requestLeague("day-input");
  });
  chipsEl.addEventListener("click", (event) => {
    const chip = event.target?.closest?.("[data-league-filter]");
    if (!chip) return;
    statusFilter = chip.dataset.leagueFilter;
    chipsEl.querySelectorAll("[data-league-filter]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === chip)));
    renderGames();
  });
  refreshButton.addEventListener("click", () => {
    void requestLeague("refresh");
  });
  viewButton.addEventListener("click", () => {
    detailedView = !detailedView;
    viewButton.setAttribute("aria-pressed", String(detailedView));
    viewButton.textContent = detailedView ? "COMPACT VIEW" : "DETAILED VIEW";
    renderGames();
  });
  sortSelect.addEventListener("change", () => {
    sortMode = sortSelect.value === "live-first" ? "live-first" : "kickoff";
    renderGames();
  });
  moreButton.addEventListener("click", () => {
    shownCount += LEAGUE_PAGE_SIZE;
    renderGames();
  });

  dateInput.value = leagueTodayISO();
  renderGames(); // initial placeholder: the panel is never blank
  if (!hostAvailable()) setStatus("LEAGUE BROWSING UNAVAILABLE IN THIS HOST");

  return Object.freeze({ open, close });
}


/**
 * Mount the public multi-sport scoreboard console. Presentation owns only
 * DOM state; the host supplies the explicit refresh callback that performs
 * provider I/O.
 */
export function createMultiSportEventsConsole({
  documentRoot = globalThis.document,
  data = null,
  onRefresh = null,
  onInspect = null,
  onSelect = null,
  onOpenContractDraft = null,
  onReplay = null,
  onReset = null,
  onLeagueRequest = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Multi-sport console needs a document-like owner");
  const panel = documentRoot.getElementById("multi-sport-events-console");
  const closeButton = documentRoot.getElementById("multi-sport-events-close");
  const refreshButton = documentRoot.getElementById("multi-sport-events-refresh");
  const resetButton = documentRoot.getElementById("multi-sport-events-reset");
  const statusEl = documentRoot.getElementById("multi-sport-events-status");
  const summaryEl = documentRoot.getElementById("multi-sport-events-summary");
  const queryEl = documentRoot.getElementById("multi-sport-events-query");
  const currentEl = documentRoot.getElementById("multi-sport-events-current");
  const sourcesEl = documentRoot.getElementById("multi-sport-events-sources");
  const recordsEl = documentRoot.getElementById("multi-sport-events-records");
  const traceEl = documentRoot.getElementById("multi-sport-events-trace");
  const boundaryEl = documentRoot.getElementById("multi-sport-events-boundary");
  const leagueBrowseButton = documentRoot.getElementById("multi-sport-events-league-browse");
  const leagueModal = documentRoot.getElementById("multi-sport-events-league-modal");
  const leagueCloseButton = documentRoot.getElementById("multi-sport-events-league-close");
  const leagueSearchInput = documentRoot.getElementById("multi-sport-events-league-search");
  const leagueFavoritesEl = documentRoot.getElementById("multi-sport-events-league-favorites");
  const leagueGroupsEl = documentRoot.getElementById("multi-sport-events-league-groups");
  const leaguePrevButton = documentRoot.getElementById("multi-sport-events-league-prev");
  const leagueTodayButton = documentRoot.getElementById("multi-sport-events-league-today");
  const leagueNextButton = documentRoot.getElementById("multi-sport-events-league-next");
  const leagueDateInput = documentRoot.getElementById("multi-sport-events-league-date");
  const leagueChipsEl = documentRoot.getElementById("multi-sport-events-league-chips");
  const leagueRefreshButton = documentRoot.getElementById("multi-sport-events-league-refresh");
  const leagueViewButton = documentRoot.getElementById("multi-sport-events-league-view");
  const leagueSortSelect = documentRoot.getElementById("multi-sport-events-league-sort");
  const leagueStatusEl = documentRoot.getElementById("multi-sport-events-league-status");
  const leagueGamesEl = documentRoot.getElementById("multi-sport-events-league-games");
  const leagueMoreButton = documentRoot.getElementById("multi-sport-events-league-more");
  if (!panel || !closeButton || !refreshButton || !resetButton || !statusEl || !summaryEl || !queryEl || !currentEl || !sourcesEl || !recordsEl || !traceEl
    || !leagueBrowseButton || !leagueModal || !leagueCloseButton || !leagueSearchInput || !leagueFavoritesEl || !leagueGroupsEl
    || !leaguePrevButton || !leagueTodayButton || !leagueNextButton || !leagueDateInput || !leagueChipsEl || !leagueRefreshButton
    || !leagueViewButton || !leagueSortSelect || !leagueStatusEl || !leagueGamesEl || !leagueMoreButton) {
    throw new Error("Multi-sport console mount points are missing");
  }

  let closeLeagueBrowser = () => {};
  const leagueBrowser = createLeagueBrowser({
    documentRoot,
    mounts: {
      browseButton: leagueBrowseButton,
      modal: leagueModal,
      closeButton: leagueCloseButton,
      searchInput: leagueSearchInput,
      favoritesEl: leagueFavoritesEl,
      groupsEl: leagueGroupsEl,
      prevButton: leaguePrevButton,
      todayButton: leagueTodayButton,
      nextButton: leagueNextButton,
      dateInput: leagueDateInput,
      chipsEl: leagueChipsEl,
      refreshButton: leagueRefreshButton,
      viewButton: leagueViewButton,
      sortSelect: leagueSortSelect,
      statusEl: leagueStatusEl,
      gamesEl: leagueGamesEl,
      moreButton: leagueMoreButton,
    },
    onLeagueRequest,
  });
  closeLeagueBrowser = () => leagueBrowser.close();

  let summary = summarizeMultiSportEvents(data ?? createUnavailableMultiSportEvents());
  let selectedId = summary.records[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let loading = false;
  let detailLoadingId = null;
  let refreshCount = 0;
  let trace = [];
  // Returning from a local contract draft must restore the exact provider
  // record that supplied its provenance.  Until it does, do not quietly show
  // the first current scoreboard row as if it were that source event.
  let sourceReturn = null;

  function selectedRecord() {
    if (sourceReturn?.strict === true && sourceReturn.state !== "matched") return null;
    return summary.records.find((record) => record.id === selectedId) ?? summary.records[0] ?? null;
  }

  function setOpen(next) {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList?.toggle?.("visible", opened);
    panel.setAttribute?.("aria-hidden", String(!opened));
    if (!opened) closeLeagueBrowser();
  }

  function pushTrace(entry) {
    trace = [deepFreeze({
      ...entry,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      providerCredentials: false,
      liveFetch: false,
      truthClaim: false,
      executable: false,
    }), ...trace].slice(0, 12);
  }

  function renderSummary() {
    summaryEl.replaceChildren();
    [
      [summary.recordCount, "events"],
      [`${summary.availableProviderCount}/${summary.providerCount}`, "providers"],
      [summary.scoreReportedCount, "scores reported"],
      [summary.participantReportedCount, "participant rows"],
      [(summary.sports ?? []).length, "sports"],
      [summary.records.filter((record) => ["A", "B"].includes(record.dataCompletenessGrade)).length, "complete enough"],
    ].forEach(([value, label]) => {
      const metric = documentRoot.createElement("div");
      metric.className = "multi-sport-events-metric";
      metric.append(
        createText(documentRoot, "b", "multi-sport-events-metric-value", value),
        createText(documentRoot, "span", "multi-sport-events-metric-label", label),
      );
      summaryEl.appendChild(metric);
    });
    summaryEl.appendChild(createText(documentRoot, "div", "multi-sport-events-research-boundary", "RESEARCH SUMMARY · FIELD PRESENCE ONLY · NOT A PREDICTION · NO ODDS OR WAGERING"));
    Object.entries(summary.researchSummary ?? {}).forEach(([sport, data]) => summaryEl.appendChild(createText(documentRoot, "div", "multi-sport-events-research-row", `${sport.toUpperCase()} · ${data.eventCount} events · scores ${data.scoreReportedCount} · status ${data.statusReportedCount} · time ${data.timeReportedCount} · completeness ${data.completenessAverage}% · PROVIDER-REPORTED FIELDS ONLY`)));
  }

  function renderSources() {
    sourcesEl.replaceChildren();
    if (!summary.sources.length) {
      sourcesEl.appendChild(createText(documentRoot, "div", "multi-sport-events-empty", "No public scoreboard endpoints are configured."));
      return;
    }
    summary.sources.forEach((source) => {
      const row = documentRoot.createElement("div");
      row.className = `multi-sport-events-source ${source.available ? "multi-sport-events-source-available" : "multi-sport-events-source-unavailable"}`;
      row.append(
        createText(documentRoot, "strong", "multi-sport-events-source-title", source.provider),
        createText(documentRoot, "span", "multi-sport-events-source-meta", source.available ? `READY · ${source.recordCount} EVENT${source.recordCount === 1 ? "" : "S"}` : "UNAVAILABLE · NO DATA USED"),
        createText(documentRoot, "span", "multi-sport-events-source-endpoint", source.endpoint),
        createText(documentRoot, "span", "multi-sport-events-source-reason", source.reason ?? "Provider queried only after explicit refresh."),
      );
      sourcesEl.appendChild(row);
    });
  }

  function renderRecords() {
    recordsEl.replaceChildren();
    if (!summary.records.length) {
      recordsEl.appendChild(createText(documentRoot, "div", "multi-sport-events-empty", `${summary.reason ?? "No public multi-sport events are available."} · NO DATA FABRICATED`));
      return;
    }
    summary.records.forEach((record) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.className = "multi-sport-events-record";
      button.dataset.recordId = record.id;
      button.setAttribute("aria-pressed", String(record.id === selectedId));
      button.title = record.sourceUrl ?? "Public ESPN source";
      const participants = recordParticipants(record).map(participantLine).join(" · ");
      button.append(
        createText(documentRoot, "strong", "multi-sport-events-record-title", recordTitle(record)),
        createText(documentRoot, "span", "multi-sport-events-record-meta", `${String(record.sport ?? "sport").toUpperCase()} · ${record.leagueLabel ?? record.league ?? "league unavailable"} · DATA ${record.dataCompletenessGrade ?? "D"}`),
        createText(documentRoot, "span", "multi-sport-events-record-status", recordStatus(record)),
        createText(documentRoot, "span", "multi-sport-events-record-time", `TIME ${record.eventTime ?? "UNAVAILABLE"} · ${participants || "PARTICIPANTS UNAVAILABLE"}`),
      );
      button.addEventListener("click", () => selectRecord(record.id, "button"));
      recordsEl.appendChild(button);
    });
  }

  function renderCurrent() {
    const record = selectedRecord();
    currentEl.setAttribute?.("data-source-route-state", sourceReturn?.strict === true ? sourceReturn.state : "none");
    currentEl.replaceChildren();
    if (!record) {
      const routeState = sourceReturn?.strict === true ? sourceReturn.state : null;
      currentEl.appendChild(createText(
        documentRoot,
        "span",
        routeState === "pending" ? "multi-sport-events-current-route-pending" : "multi-sport-events-current-empty",
        routeState === "pending"
          ? "RESTORING REQUESTED SOURCE EVENT · WAITING FOR THE ALLOWLISTED ESPN RESPONSE"
          : routeState === "missing" || routeState === "invalid"
            ? "SOURCE EVENT NOT RETURNED · NO DATA FABRICATED"
            : "SELECT A PUBLIC EVENT TO INSPECT · NO DATA FABRICATED",
      ));
    } else {
      currentEl.append(
        createText(documentRoot, "strong", "multi-sport-events-current-title", recordTitle(record)),
        createText(documentRoot, "span", "multi-sport-events-current-meta", `${String(record.sport ?? "sport").toUpperCase()} · ${record.leagueLabel ?? record.league ?? "league unavailable"} · ${record.competition?.type ?? "competition"}`),
        createText(documentRoot, "span", "multi-sport-events-current-status", `STATUS · ${recordStatus(record)}`),
        createText(documentRoot, "span", "multi-sport-events-current-time", `EVENT TIME · ${record.eventTime ?? "UNAVAILABLE"} · RETRIEVED ${record.retrievedAt ?? "—"}`),
        createText(documentRoot, "span", "multi-sport-events-current-score", `SCORE FIELDS · ${record.scoreCount ?? 0}/${recordParticipants(record).length} PROVIDER-REPORTED`),
        createText(documentRoot, "span", "multi-sport-events-current-venue", `VENUE · ${record.venue?.name ?? "UNAVAILABLE"}${record.venue?.city ? ` · ${record.venue.city}` : ""}${record.venue?.country ? ` · ${record.venue.country}` : ""}`),
        createText(documentRoot, "span", "multi-sport-events-current-grade", `DATA COMPLETENESS · ${record.dataCompletenessGrade ?? "D"} · ${record.dataCompletenessPercent ?? 0}% · FIELD PRESENCE ONLY`),
      );
      const participants = documentRoot.createElement("div");
      participants.className = "multi-sport-events-current-participants";
      recordParticipants(record).forEach((participant) => participants.appendChild(createText(documentRoot, "span", "multi-sport-events-current-participant", participantLine(participant))));
      currentEl.appendChild(participants);
      if (Array.isArray(record.leaders) && record.leaders.length) {
        currentEl.appendChild(createText(documentRoot, "span", "multi-sport-events-current-leaders", `PROVIDER LEADER FIELDS · ${record.leaders.map((leader) => leader.label ?? leader.name).filter(Boolean).join(" · ")}`));
      }
      if (typeof onInspect === "function") {
        const detail = record.publicDetail;
        const inspectButton = documentRoot.createElement("button");
        inspectButton.id = "multi-sport-events-current-detail";
        inspectButton.type = "button";
        inspectButton.className = "multi-sport-events-current-detail-button";
        inspectButton.disabled = detailLoadingId === record.id;
        inspectButton.textContent = detailLoadingId === record.id
          ? "REQUESTING EVENT DETAIL · WAIT"
          : detail?.status === "available"
            ? "REFRESH EVENT DETAIL · PLAYS / PERIODS"
            : "LOAD EVENT DETAIL · PLAYS / PERIODS";
        inspectButton.title = "Explicitly request the selected event's provider summary; no rows are fabricated.";
        inspectButton.addEventListener("click", () => { void inspectRecord(record.id, "button"); });
        currentEl.appendChild(inspectButton);
        if (detail) {
          const timelineStatus = detail.timelineStatus === "available" ? "AVAILABLE" : "UNAVAILABLE";
          const periodStatus = detail.periodStatus === "provider-reported" ? "AVAILABLE" : "UNAVAILABLE";
          currentEl.appendChild(createText(
            documentRoot,
            "span",
            "multi-sport-events-current-detail",
            `PROVIDER DETAIL · ${String(detail.status ?? "unavailable").toUpperCase()} · PLAY-BY-PLAY ${timelineStatus} · PERIOD / QUARTER ${periodStatus} · REQUESTS ${detail.requestCount ?? 0}`,
          ));
          currentEl.appendChild(createText(
            documentRoot,
            "span",
            "multi-sport-events-current-detail-grade",
            `DETAIL COMPLETENESS · ${detail.detailCompletenessGrade ?? "D"} · ${detail.detailCompletenessPercent ?? 0}% · FIELD PRESENCE ONLY`,
          ));
          const detailSourceLink = publicLink(
            documentRoot,
            "multi-sport-events-current-detail-url",
            detail.sourceUrl,
            "OPEN PUBLIC ESPN EVENT DETAIL",
          );
          if (detailSourceLink) {
            currentEl.appendChild(detailSourceLink);
          } else {
            currentEl.appendChild(createText(
              documentRoot,
              "span",
              "multi-sport-events-current-detail-notes",
              "EVENT DETAIL SOURCE UNAVAILABLE · PROVIDER DID NOT RETURN SAFE HTTPS SOURCE",
            ));
          }
          if (Array.isArray(detail.players) && detail.players.length) {
            const players = documentRoot.createElement("div");
            players.className = "multi-sport-events-current-detail-players";
            detail.players.slice(0, 8).forEach((player) => players.appendChild(createText(documentRoot, "span", "multi-sport-events-current-detail-player", detailPlayerLine(player))));
            currentEl.appendChild(players);
          } else {
            currentEl.appendChild(createText(documentRoot, "span", "multi-sport-events-current-detail-notes", "PLAYER CONTEXT UNAVAILABLE · PROVIDER RETURNED NO PLAYER ROWS"));
          }
          if (Array.isArray(detail.periods) && detail.periods.length) {
            const periods = documentRoot.createElement("div");
            periods.className = "multi-sport-events-current-detail-periods";
            detail.periods.slice(0, 8).forEach((period) => periods.appendChild(createText(documentRoot, "span", "multi-sport-events-current-detail-period", detailPeriodLine(period))));
            currentEl.appendChild(periods);
          } else {
            currentEl.appendChild(createText(documentRoot, "span", "multi-sport-events-current-detail-notes", "PERIOD / QUARTER DETAIL UNAVAILABLE · PROVIDER RETURNED NO PERIOD ROWS"));
          }
          if (Array.isArray(detail.timeline) && detail.timeline.length) {
            const timeline = documentRoot.createElement("div");
            timeline.className = "multi-sport-events-current-detail-timeline";
            detail.timeline.slice(0, 12).forEach((play) => timeline.appendChild(createText(documentRoot, "span", "multi-sport-events-current-detail-play", detailPlayLine(play))));
            currentEl.appendChild(timeline);
          } else {
            currentEl.appendChild(createText(documentRoot, "span", "multi-sport-events-current-detail-notes", `PLAY-BY-PLAY UNAVAILABLE · ${detail.timelineReason ?? "Provider returned no usable play rows"}`));
          }
        }
      }
      const draftRecord = contractDraftRecord(record);
      if (typeof onOpenContractDraft === "function" && draftRecord) {
        const draftButton = documentRoot.createElement("button");
        draftButton.id = "multi-sport-events-current-contract-draft";
        draftButton.type = "button";
        draftButton.className = "multi-sport-events-current-detail-button multi-sport-events-current-contract-button";
        draftButton.textContent = "OPEN LOCAL CONTRACT / POOL REHEARSAL";
        draftButton.title = "Carry this selected public ESPN event into an in-memory, non-executable local draft.";
        draftButton.dataset.sourceRecordId = draftRecord.id;
        draftButton.dataset.sourceUrl = draftRecord.sourceUrl;
        draftButton.setAttribute?.("aria-label", `Open local contract and pool rehearsal for ${recordTitle(record)}`);
        draftButton.addEventListener("click", () => onOpenContractDraft({ record: draftRecord, method: "button" }));
        currentEl.appendChild(draftButton);
      } else if (typeof onOpenContractDraft === "function") {
        currentEl.appendChild(createText(documentRoot, "span", "multi-sport-events-current-contract-unavailable", "LOCAL CONTRACT / POOL UNAVAILABLE · PROVIDER EVENT LACKS REQUIRED ID, TWO NAMED PARTICIPANTS, OR ALLOWLISTED HTTPS SOURCE · NO DRAFT"));
      }
      const sourceLink = publicLink(documentRoot, "multi-sport-events-current-url", record.sourceUrl, `OPEN PUBLIC ESPN SOURCE · ${record.sourceUrl ?? "unavailable"}`);
      if (sourceLink) {
        currentEl.appendChild(sourceLink);
      } else {
        currentEl.appendChild(createText(
          documentRoot,
          "span",
          "multi-sport-events-current-source-unavailable",
          "PUBLIC SCOREBOARD SOURCE UNAVAILABLE · PROVIDER DID NOT RETURN SAFE HTTPS SOURCE",
        ));
      }
    }
    const status = summary.status === "ready"
      ? `READY · ${summary.recordCount} MULTI-SPORT EVENT${summary.recordCount === 1 ? "" : "S"} · RESEARCH ONLY`
      : summary.status === "partial"
        ? `PARTIAL · ${summary.recordCount} EVENT${summary.recordCount === 1 ? "" : "S"} · SOME PROVIDERS UNAVAILABLE`
        : "UNAVAILABLE · NO MULTI-SPORT DATA LOADED · NO DATA FABRICATED";
    statusEl.textContent = loading
      ? "REFRESHING ESPN PUBLIC SCOREBOARDS · WAITING FOR RESPONSE"
      : sourceReturn?.strict === true && sourceReturn.state === "pending"
        ? "RESTORING SOURCE EVENT · WAITING FOR EXACT PROVIDER ID"
        : sourceReturn?.strict === true && (sourceReturn.state === "missing" || sourceReturn.state === "invalid")
          ? "SOURCE EVENT NOT RETURNED · NO DATA FABRICATED"
          : trace.length ? `${status} · ${trace.length} LOCAL INSPECTION${trace.length === 1 ? "" : "S"}` : status;
    refreshButton.disabled = loading;
    resetButton.disabled = trace.length === 0 && selectedId === (summary.records[0]?.id ?? null);
    queryEl.textContent = `SPORTS · ${(summary.sports ?? []).map((sport) => String(sport).toUpperCase()).join(" + ") || "SOCCER + BASKETBALL + FOOTBALL"} · RETRIEVED ${summary.retrievedAt ?? "—"}`;
    if (boundaryEl) boundaryEl.textContent = summary.boundary ?? MULTI_SPORT_EVENTS_BOUNDARY;
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(createText(documentRoot, "div", "multi-sport-events-empty", "No local inspection yet. Refresh public scoreboards, then select an event."));
      return;
    }
    trace.forEach((entry, index) => traceEl.appendChild(createText(
      documentRoot,
      "div",
      "multi-sport-events-trace-row",
      `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.recordId ?? "all events"} · LOCAL ONLY`,
    )));
  }

  function render() {
    renderSummary();
    renderSources();
    renderRecords();
    renderCurrent();
    renderTrace();
  }

  function selectRecord(recordId, method = "button") {
    const record = summary.records.find((candidate) => candidate.id === recordId);
    if (!record) return null;
    if (sourceReturn?.strict === true && !String(method).startsWith("route:")) sourceReturn = null;
    selectedId = record.id;
    const snapshot = deepFreeze({
      source: MULTI_SPORT_EVENTS_CONSOLE_SOURCE,
      action: "select",
      method,
      recordId: record.id,
      record,
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      providerCredentials: false,
      liveFetch: false,
      truthClaim: false,
      executable: false,
    });
    pushTrace({ action: "select", recordId: record.id });
    render();
    onSelect?.(snapshot);
    return snapshot;
  }

  function replay(method = "button") {
    const snapshot = replayMultiSportEvents(summary, selectedId, method);
    pushTrace({ action: "replay", recordId: snapshot.recordId });
    render();
    const envelope = deepFreeze({ ...snapshot, source: MULTI_SPORT_EVENTS_CONSOLE_SOURCE });
    onReplay?.(envelope);
    return envelope;
  }

  async function inspectRecord(recordId = selectedId, method = "button") {
    if (detailLoadingId) return getSnapshot();
    const record = summary.records.find((candidate) => candidate.id === recordId);
    if (!record || typeof onInspect !== "function") return getSnapshot();
    detailLoadingId = record.id;
    renderCurrent();
    try {
      const result = await onInspect({ record, method });
      const nextRecord = result?.record;
      if (nextRecord?.id) {
        summary = summarizeMultiSportEvents({
          ...summary,
          records: summary.records.map((candidate) => candidate.id === nextRecord.id ? nextRecord : candidate),
          liveFetch: summary.liveFetch || result.liveFetch === true,
          externalNetwork: summary.externalNetwork || result.externalNetwork === true,
        });
        selectedId = nextRecord.id;
      }
      pushTrace({ action: "inspect-detail", recordId: nextRecord?.id ?? record.id, requestStatus: result?.requestStatus ?? "unavailable" });
      return getSnapshot();
    } catch (error) {
      pushTrace({ action: "inspect-detail-unavailable", recordId: record.id, reason: text(error?.message ?? error, "provider detail unavailable") });
      return getSnapshot();
    } finally {
      detailLoadingId = null;
      render();
    }
  }

  function reset(method = "button") {
    selectedId = summary.records[0]?.id ?? null;
    trace = [];
    const snapshot = deepFreeze({
      source: MULTI_SPORT_EVENTS_CONSOLE_SOURCE,
      action: "reset",
      method,
      recordId: selectedId,
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      providerCredentials: false,
      liveFetch: false,
      truthClaim: false,
      executable: false,
    });
    render();
    onReset?.(snapshot);
    return snapshot;
  }

  async function refresh(method = "button") {
    if (loading) return getSnapshot();
    loading = true;
    renderCurrent();
    try {
      const result = await onRefresh?.({ method });
      summary = summarizeMultiSportEvents(result ?? createUnavailableMultiSportEvents({ reason: "Refresh returned no public scoreboard response; no data was fabricated." }));
      selectedId = sourceReturn?.strict === true ? null : summary.records[0]?.id ?? null;
      refreshCount += 1;
      pushTrace({ action: "refresh", recordId: null, refreshCount });
    } catch (error) {
      summary = summarizeMultiSportEvents(createUnavailableMultiSportEvents({ reason: `Public ESPN provider unavailable: ${text(error?.message ?? error, "unknown error")}` }));
      selectedId = null;
      refreshCount += 1;
      pushTrace({ action: "refresh-unavailable", recordId: null, refreshCount });
    } finally {
      loading = false;
      render();
    }
    return getSnapshot();
  }

  function setData(nextData) {
    summary = summarizeMultiSportEvents(nextData);
    if (sourceReturn?.strict === true) selectedId = null;
    else if (!summary.records.some((record) => record.id === selectedId)) selectedId = summary.records[0]?.id ?? null;
    render();
    return getSnapshot();
  }

  function setSourceReturnState({ requestedRecordId = null, state = "pending", reason = null } = {}) {
    const validId = typeof requestedRecordId === "string" && SOURCE_RETURN_RECORD_ID_PATTERN.test(requestedRecordId)
      ? requestedRecordId
      : null;
    const normalizedState = ["pending", "matched", "missing", "invalid"].includes(state) ? state : "invalid";
    sourceReturn = deepFreeze({
      strict: true,
      requestedRecordId: validId,
      state: normalizedState,
      reason: typeof reason === "string" ? reason.slice(0, 180) : null,
    });
    selectedId = normalizedState === "matched" && validId ? validId : null;
    if (normalizedState === "missing" || normalizedState === "invalid") {
      pushTrace({ action: "source-event-not-returned", recordId: validId, reason: sourceReturn.reason ?? "requested provider event was not returned" });
    }
    render();
    return getSnapshot();
  }

  function getSnapshot() {
    return deepFreeze({
      source: MULTI_SPORT_EVENTS_CONSOLE_SOURCE,
      summary,
      selectedId,
      selectedRecord: selectedRecord(),
      sourceReturn,
      opened,
      loading,
      detailLoadingId,
      refreshCount,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      providerCredentials: false,
      liveFetch: summary.liveFetch,
      truthClaim: false,
      executable: false,
      boundary: summary.boundary ?? MULTI_SPORT_EVENTS_BOUNDARY,
    });
  }

  closeButton.addEventListener("click", () => setOpen(false));
  refreshButton.addEventListener("click", () => refresh("button"));
  resetButton.addEventListener("click", () => reset("button"));
  documentRoot.addEventListener?.("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false);
  });
  render();
  setOpen(opened);

  return Object.freeze({
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!opened),
    refresh,
    inspect: inspectRecord,
    selectRecord,
    replay,
    reset,
    setData,
    setSourceReturnState,
    setProjection: setData,
    getSnapshot,
    destroy: () => {},
  });
}

export const createMultiSportEventsEvidenceConsole = createMultiSportEventsConsole;
export default createMultiSportEventsConsole;
