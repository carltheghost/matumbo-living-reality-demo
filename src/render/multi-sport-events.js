import {
  MULTI_SPORT_EVENTS_BOUNDARY,
  createUnavailableMultiSportEvents,
  replayMultiSportEvents,
  summarizeMultiSportEvents,
} from "../domains/multi-sport-events.js";

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
  if (!panel || !closeButton || !refreshButton || !resetButton || !statusEl || !summaryEl || !queryEl || !currentEl || !sourcesEl || !recordsEl || !traceEl) {
    throw new Error("Multi-sport console mount points are missing");
  }

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
