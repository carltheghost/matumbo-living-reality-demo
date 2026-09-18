import {
  SPORTS_EVENTS_BOUNDARY,
  createSecondaryParityStatus,
  createUnavailableSportsEvents,
  replaySportsEvents,
  summarizeSportsEvents,
} from "../domains/sports-events.js";

export const SPORTS_EVENTS_CONSOLE_SOURCE = "sports-events-evidence-console";
// Keep this in parity with the route validator in main.js. ESPN-style event
// identifiers can contain dots (for example `atp.123`); rejecting them here
// breaks an otherwise valid source-return handoff before the selected match
// and its local Contract/Pool rehearsal action can be rendered.
const SPORTS_RECORD_ID_PATTERN = /^[a-z0-9:_.-]{1,160}$/i;

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

function playerLabel(player) {
  if (!player) return "PLAYER UNAVAILABLE";
  const rank = Number.isSafeInteger(player.rank) ? `#${player.rank}` : "RANK UNAVAILABLE";
  const country = player.countryCode ?? player.country;
  const rankSource = player.rankStatus === "provider-reported" ? "RANK SOURCE · ESPN" : "RANK SOURCE · UNAVAILABLE";
  const winner = player.winner === true
    ? "WINNER FLAG · PROVIDER"
    : player.winner === false
      ? "NON-WINNER FLAG · PROVIDER"
      : "WINNER FLAG · UNAVAILABLE";
  return `${player.name ?? "Player unavailable"} · ${rank}${country ? ` · ${country}` : ""} · ${rankSource} · ${winner}`;
}

function setScoreLabel(setScore) {
  const scores = Array.isArray(setScore?.scores) ? setScore.scores : [];
  const scoreValues = scores.map((score) => {
    const value = score.displayValue ?? (score.value ?? "—");
    const tiebreak = Number.isSafeInteger(score.tiebreak) ? ` (TB ${score.tiebreak})` : "";
    const winner = score.winner === true ? " · WINNER FLAG" : "";
    return `${score.athleteName ?? score.displayName ?? "Player"} ${value}${tiebreak}${winner}`;
  });
  const scoreCount = Number.isSafeInteger(setScore?.scoreCount) ? setScore.scoreCount : scores.filter((score) => score.value !== null && score.value !== undefined).length;
  const expected = Number.isSafeInteger(setScore?.expectedScoreCount) ? setScore.expectedScoreCount : scores.length;
  const status = String(setScore?.scoreStatus ?? (scoreCount === expected && expected > 0 ? "complete" : scoreCount ? "partial" : "unavailable")).toUpperCase();
  const grade = setScore?.dataCompletenessGrade ?? setScore?.dataGrade ?? "D";
  const percent = setScore?.dataCompletenessPercent ?? Math.round((expected > 0 ? scoreCount / expected : 0) * 100);
  return `SET ${setScore?.set ?? "—"} · ${scoreValues.join(" · ") || "SCORES UNAVAILABLE"} · SCORES ${scoreCount}/${expected} ${status} · DATA ${grade} ${percent}%`;
}

function recordSummary(record) {
  if (!record) return "SELECT A TENNIS MATCH TO INSPECT";
  return `${record.title} · ${record.status?.label ?? record.statusDetail?.label ?? record.status ?? "status unavailable"} · DATA ${record.dataCompletenessGrade ?? record.dataGrade ?? "D"}`;
}

function recordStatus(record) {
  return record?.status?.label ?? record?.statusDetail?.label ?? record?.status ?? "status unavailable";
}

function recordCompletion(record) {
  const detail = record?.statusDetail ?? {};
  const completion = record?.completion ?? {};
  const status = detail.completionStatus ?? record?.completionStatus ?? completion.status ?? "unavailable";
  const completed = typeof detail.completed === "boolean" ? detail.completed : typeof completion.completed === "boolean" ? completion.completed : null;
  const final = typeof detail.final === "boolean" ? detail.final : typeof completion.final === "boolean" ? completion.final : null;
  const state = detail.state ?? "unavailable";
  const finalText = final === true ? "FINAL YES" : final === false ? "FINAL NO" : "FINAL UNAVAILABLE";
  const completedText = completed === true ? "COMPLETED YES" : completed === false ? "COMPLETED NO" : "COMPLETED UNAVAILABLE";
  const source = detail.source ?? completion.source ?? "unavailable";
  return `${recordStatus(record)} · STATE ${state} · ${String(status).toUpperCase()} · ${finalText} · ${completedText} · SOURCE ${source}`;
}

function recordSetCompleteness(record) {
  const detail = record?.setScoreCompleteness ?? {};
  const setScores = Array.isArray(record?.setScores) ? record.setScores : [];
  const providedSets = Number.isSafeInteger(detail.providedSets) ? detail.providedSets : setScores.length;
  const completeSets = Number.isSafeInteger(detail.completeSets)
    ? detail.completeSets
    : setScores.filter((set) => set?.scoreStatus === "complete" || set?.dataCompletenessGrade === "A").length;
  const status = detail.status ?? (providedSets === 0 ? "unavailable" : completeSets === providedSets ? "complete" : completeSets ? "partial" : "unavailable");
  return { providedSets, completeSets, status };
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

function recordPlayers(record) {
  return Array.isArray(record?.players) && record.players.length
    ? record.players
    : Array.isArray(record?.competitors) ? record.competitors : [];
}

function contractDraftEligible(record) {
  if (!record || typeof record.id !== "string" || !record.id.trim()) return false;
  const tour = String(record.tour ?? "").toUpperCase();
  if (tour !== "ATP" && tour !== "WTA") return false;
  const players = recordPlayers(record);
  if (players.length !== 2 || players.some((player) => {
    const name = player?.name ?? player?.displayName;
    return typeof name !== "string" || !name.trim() || name === "Player unavailable";
  })) return false;
  if (typeof record.sourceUrl !== "string" || !/^https:\/\//i.test(record.sourceUrl)) return false;
  try {
    const parsed = new URL(record.sourceUrl);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !parsed.port
      && (host === "espn.com" || host.endsWith(".espn.com") || host === "espncdn.com" || host.endsWith(".espncdn.com"));
  } catch {
    return false;
  }
}

function recordGrade(record) {
  return record?.dataCompletenessGrade ?? record?.dataGrade ?? "D";
}

function timelineAvailable(record) {
  return record?.timeline?.available === true || record?.timelineStatus === "available";
}

function recordReconciliation(record) {
  const detail = record?.resultReconciliation ?? {};
  const status = detail.status ?? "unavailable";
  const conflictCount = Number.isSafeInteger(detail.conflictCount) ? detail.conflictCount : 0;
  const available = Number.isSafeInteger(detail.availableCheckCount) ? detail.availableCheckCount : 0;
  const total = Number.isSafeInteger(detail.checkCount) ? detail.checkCount : 0;
  const label = status === "consistent"
    ? "INTERNALLY CONSISTENT"
    : status === "partial"
      ? "PARTIAL · SOME CHECKS UNAVAILABLE"
      : status === "conflict"
        ? "CONFLICT · PROVIDER FIELDS DISAGREE"
        : "UNAVAILABLE · NOT ENOUGH PROVIDER FIELDS";
  return { status, conflictCount, available, total, label };
}

/**
 * Mount the public tennis evidence console. It owns only DOM presentation;
 * the host supplies the explicit refresh callback that performs network IO.
 */
export function createSportsEventsConsole({
  documentRoot = globalThis.document,
  data = null,
  onRefresh = null,
  onSelect = null,
  onInspect = null,
  onOpenContractDraft = null,
  onReplay = null,
  onReset = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Sports Events console needs a document-like owner");
  const panel = documentRoot.getElementById("sports-events-console");
  const closeButton = documentRoot.getElementById("sports-events-close");
  const refreshButton = documentRoot.getElementById("sports-events-refresh");
  const resetButton = documentRoot.getElementById("sports-events-reset");
  const statusEl = documentRoot.getElementById("sports-events-status");
  const summaryEl = documentRoot.getElementById("sports-events-summary");
  const queryEl = documentRoot.getElementById("sports-events-query");
  const currentEl = documentRoot.getElementById("sports-events-current");
  const sourcesEl = documentRoot.getElementById("sports-events-sources");
  const recordsEl = documentRoot.getElementById("sports-events-records");
  const traceEl = documentRoot.getElementById("sports-events-trace");
  const boundaryEl = documentRoot.getElementById("sports-events-boundary");
  const secondaryEl = documentRoot.getElementById("sports-events-secondary-parity");
  const secondaryStatusEl = documentRoot.getElementById("sports-events-secondary-status");
  const secondaryContextEl = documentRoot.getElementById("sports-events-secondary-context");
  const secondaryFieldsEl = documentRoot.getElementById("sports-events-secondary-fields");
  const secondaryBoundaryEl = documentRoot.getElementById("sports-events-secondary-boundary");
  if (!panel || !closeButton || !refreshButton || !resetButton || !statusEl || !summaryEl || !queryEl || !currentEl || !sourcesEl || !recordsEl || !traceEl) {
    throw new Error("Sports Events console mount points are missing");
  }

  let summary = summarizeSportsEvents(data ?? createUnavailableSportsEvents());
  let selectedId = summary.records[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let loading = false;
  let detailLoadingId = null;
  let refreshCount = 0;
  let trace = [];
  // A source-return route is stricter than the normal first-row view.  While
  // it is pending or unavailable, selectedRecord() must not fall back to the
  // first provider row: that would fabricate continuity with the contract's
  // source record.  A user can still choose a real returned row manually,
  // which intentionally exits the strict return context.
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
      providerCredentials: false,
      liveFetch: false,
      truthClaim: false,
      executable: false,
    }), ...trace].slice(0, 12);
  }

  function renderSummary() {
    summaryEl.replaceChildren();
    [
      [summary.recordCount, "matches"],
      [`${summary.availableProviderCount}/${summary.providerCount}`, "providers"],
      [summary.setCount, "set scores"],
      [`${summary.setCompleteCount ?? 0}/${summary.setCount ?? 0}`, "sets complete"],
      [summary.rankingCount, "ranking rows"],
      [summary.timelineAvailableCount, "timelines"],
      [summary.records.filter((record) => ["A", "B"].includes(recordGrade(record))).length, "complete enough"],
      [`${summary.reconciliationConsistentCount ?? 0}/${summary.recordCount}`, "internally consistent"],
      [summary.reconciliationConflictCount ?? 0, "result conflicts"],
    ].forEach(([value, label]) => {
      const metric = documentRoot.createElement("div");
      metric.className = "sports-events-metric";
      metric.append(createText(documentRoot, "b", "sports-events-metric-value", value), createText(documentRoot, "span", "sports-events-metric-label", label));
      summaryEl.appendChild(metric);
    });
  }

  function renderSources() {
    sourcesEl.replaceChildren();
    if (!summary.sources.length) {
      sourcesEl.appendChild(createText(documentRoot, "div", "sports-events-empty", "No public ESPN endpoints are configured."));
      return;
    }
    summary.sources.forEach((source) => {
      const row = documentRoot.createElement("div");
      row.className = `sports-events-source ${source.available ? "sports-events-source-available" : "sports-events-source-unavailable"}`;
      const state = source.available
        ? `AVAILABLE · ${source.recordCount} ${source.format === "rankings" ? "RANKING ROW" : "MATCH"}${source.recordCount === 1 ? "" : "S"}`
        : "UNAVAILABLE · NO DATA USED";
      row.append(
        createText(documentRoot, "strong", "sports-events-source-title", source.provider),
        createText(documentRoot, "span", "sports-events-source-meta", state),
        createText(documentRoot, "span", "sports-events-source-endpoint", source.endpoint),
        createText(documentRoot, "span", "sports-events-source-reason", source.reason ?? "Public endpoint queried only after explicit refresh."),
      );
      sourcesEl.appendChild(row);
    });
  }

  function renderRecords() {
    recordsEl.replaceChildren();
    if (!summary.records.length) {
      const reason = summary.reason ?? "No public tennis matches available. Refresh explicitly when online.";
      recordsEl.appendChild(createText(documentRoot, "div", "sports-events-empty", `${reason} · NO DATA FABRICATED`));
      return;
    }
    summary.records.forEach((record) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.className = "sports-events-record";
      button.dataset.recordId = record.id;
      button.setAttribute("aria-pressed", String(record.id === selectedId));
      button.title = record.sourceUrl ?? "Public ESPN source";
      const setSummary = recordSetCompleteness(record);
      const reconciliation = recordReconciliation(record);
      button.append(
        createText(documentRoot, "strong", "sports-events-record-title", record.title),
        createText(documentRoot, "span", "sports-events-record-meta", `${record.tour ?? "TENNIS"} · ${recordCompletion(record)} · DATA ${recordGrade(record)} · RECON ${reconciliation.status.toUpperCase()}`),
        createText(documentRoot, "span", "sports-events-record-time", `MATCH ${record.eventTime ?? "TIME UNAVAILABLE"} · SETS ${setSummary.providedSets} (${setSummary.completeSets}/${setSummary.providedSets || 0} COMPLETE) · TIMELINE ${timelineAvailable(record) ? "available" : "unavailable"}`),
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
        routeState === "pending" ? "sports-events-current-route-pending" : "sports-events-current-empty",
        routeState === "pending"
          ? "RESTORING REQUESTED SOURCE RECORD · WAITING FOR THE ALLOWLISTED ESPN RESPONSE"
          : routeState === "missing" || routeState === "invalid"
            ? "SOURCE RECORD NOT RETURNED · NO DATA FABRICATED"
            : "SELECT A RETURNED TENNIS MATCH TO OPEN LOCAL CONTRACT / POOL · NO DATA FABRICATED",
      ));
      // Keep the next action beside the empty state instead of making a
      // viewer discover the toolbar first. This remains an explicit,
      // provider-backed read: no row is created locally and the contract/pool
      // action only appears after a real allowlisted ESPN record is returned.
      if (typeof onRefresh === "function") {
        const emptyRefreshButton = documentRoot.createElement("button");
        emptyRefreshButton.id = "sports-events-empty-refresh";
        emptyRefreshButton.type = "button";
        emptyRefreshButton.className = "sports-events-current-detail-button sports-events-current-refresh-button";
        emptyRefreshButton.disabled = loading;
        emptyRefreshButton.textContent = loading
          ? "REQUESTING ATP / WTA · WAIT"
          : "REFRESH ATP / WTA TO UNLOCK LOCAL CONTRACT / POOL";
        emptyRefreshButton.title = "Explicitly request current public ATP/WTA records; no match or draft is fabricated while the feed is unavailable.";
        emptyRefreshButton.addEventListener("click", () => { void refresh("empty-state"); });
        currentEl.appendChild(emptyRefreshButton);
      }
    } else {
      currentEl.append(
        createText(documentRoot, "strong", "sports-events-current-title", record.title),
        createText(documentRoot, "span", "sports-events-current-meta", `${record.tour ?? "TENNIS"} · ${record.tournament?.name ?? record.tournament?.label ?? "Tournament unavailable"} · ${recordStatus(record)}`),
        createText(documentRoot, "span", "sports-events-current-completion", `MATCH STATUS · ${recordCompletion(record)}`),
        createText(documentRoot, "span", "sports-events-current-time", `MATCH ${record.eventTime ?? "TIME UNAVAILABLE"} · RETRIEVED ${record.retrievedAt ?? "—"}`),
        createText(documentRoot, "span", "sports-events-current-grade", `DATA COMPLETENESS ${recordGrade(record)} · ${record.dataCompletenessPercent ?? record.dataGradePercent ?? 0}% · ${record.basis ?? "field presence only"}`),
      );
      const playerList = documentRoot.createElement("div");
      playerList.className = "sports-events-current-players";
      recordPlayers(record).forEach((player) => {
        const playerRow = documentRoot.createElement("div");
        playerRow.className = "sports-events-current-player-row";
        playerRow.appendChild(createText(documentRoot, "span", "sports-events-current-player", playerLabel(player)));
        const profileLink = publicLink(documentRoot, "sports-events-current-player-profile", player.profileUrl, "OPEN PLAYER PROFILE · ESPN");
        if (profileLink) playerRow.appendChild(profileLink);
        const rankLink = publicLink(documentRoot, "sports-events-current-player-rank-source", player.rankSourceUrl, "OPEN RANK SOURCE · ESPN");
        if (rankLink && player.rankStatus === "provider-reported") playerRow.appendChild(rankLink);
        playerList.appendChild(playerRow);
      });
      currentEl.appendChild(playerList);
      const sets = documentRoot.createElement("div");
      sets.className = "sports-events-current-sets";
      if (record.setScores?.length) {
        record.setScores.forEach((setScore) => sets.appendChild(createText(documentRoot, "span", "sports-events-current-set", setScoreLabel(setScore))));
      } else {
        sets.appendChild(createText(documentRoot, "span", "sports-events-current-set-unavailable", "SET-BY-SET SCORE UNAVAILABLE"));
      }
      currentEl.appendChild(sets);
      const setSummary = recordSetCompleteness(record);
      currentEl.appendChild(createText(
        documentRoot,
        "span",
        "sports-events-current-set-summary",
        `SET DATA SUMMARY · ${setSummary.completeSets}/${setSummary.providedSets} COMPLETE · ${String(setSummary.status).toUpperCase()} · PROVIDER SCORES ONLY`,
      ));
      const reconciliation = recordReconciliation(record);
      currentEl.appendChild(createText(
        documentRoot,
        "span",
        "sports-events-current-reconciliation",
        `RESULT RECONCILIATION · ${reconciliation.label} · CHECKS ${reconciliation.available}/${reconciliation.total} · CONFLICTS ${reconciliation.conflictCount} · SAME PROVIDER ONLY`,
      ));
      const timelineText = timelineAvailable(record)
        ? `POINT-BY-POINT TIMELINE · ${record.timeline?.points?.length ?? 0} POINTS · ${String(record.timelineRequestStatus ?? "provider response").toUpperCase()}`
        : `POINT-BY-POINT TIMELINE UNAVAILABLE · ${record.timelineRequestReason ?? record.timelineReason ?? record.timeline?.reason ?? "The provider returned no point-level events."}`;
      currentEl.appendChild(createText(documentRoot, "span", "sports-events-current-timeline", timelineText));
      if (timelineAvailable(record) && Array.isArray(record.timeline?.points) && record.timeline.points.length) {
        const timelineList = documentRoot.createElement("div");
        timelineList.className = "sports-events-current-timeline-points";
        record.timeline.points.forEach((point) => {
          const location = [
            point.set !== null && point.set !== undefined ? `SET ${point.set}` : null,
            point.game !== null && point.game !== undefined ? `GAME ${point.game}` : null,
            point.point !== null && point.point !== undefined ? `POINT ${point.point}` : null,
          ].filter(Boolean).join(" · ");
          const detail = [point.text, point.score].filter(Boolean).join(" · ") || "provider point detail";
          timelineList.appendChild(createText(
            documentRoot,
            "span",
            "sports-events-current-timeline-point",
            `${point.index ?? "—"} · ${(point.kind ?? "point").toUpperCase()}${location ? ` · ${location}` : ""} · ${detail}`,
          ));
        });
        currentEl.appendChild(timelineList);
      }
      if (typeof onInspect === "function") {
        const detail = record.publicDetail;
        const inspectButton = documentRoot.createElement("button");
        inspectButton.id = "sports-events-current-detail";
        inspectButton.type = "button";
        inspectButton.className = "sports-events-current-detail-button";
        inspectButton.disabled = detailLoadingId === record.id;
        inspectButton.textContent = detailLoadingId === record.id
          ? "REQUESTING PROVIDER DETAIL · WAIT"
          : detail?.status === "available"
            ? "REFRESH PROVIDER DETAIL · PLAY-BY-PLAY"
            : "LOAD PROVIDER DETAIL · PLAY-BY-PLAY";
        inspectButton.title = "Explicitly request the provider's competition detail; no local rows are fabricated.";
        inspectButton.addEventListener("click", () => { void inspectRecord(record.id, "button"); });
        currentEl.appendChild(inspectButton);
        if (detail) {
          const commentary = detail.commentaryAvailable === true ? "available" : "unavailable";
          const live = detail.liveAvailable === true ? "available" : "unavailable";
          currentEl.appendChild(createText(
            documentRoot,
            "span",
            "sports-events-current-detail",
            `PROVIDER DETAIL · ${String(detail.status ?? "unavailable").toUpperCase()} · COMMENTARY ${commentary.toUpperCase()} · LIVE ${live.toUpperCase()} · REQUESTS ${detail.requestCount ?? 0}`,
          ));
          if (Array.isArray(detail.notes) && detail.notes.length) {
            currentEl.appendChild(createText(documentRoot, "span", "sports-events-current-detail-notes", `PROVIDER NOTE · ${detail.notes[0]}`));
          }
          // Detail inspection already records the exact provider document it
          // read, but the old surface only displayed a reference count. Give
          // the user an inspectable route back to that returned ESPN detail
          // source without making another request or treating the document as
          // verified truth.
          const detailSourceLink = publicLink(
            documentRoot,
            "sports-events-current-detail-source",
            detail.sourceUrl,
            "OPEN PROVIDER DETAIL SOURCE · ESPN",
          );
          if (detailSourceLink) currentEl.appendChild(detailSourceLink);
        }
      }
      if (typeof onOpenContractDraft === "function" && contractDraftEligible(record)) {
        const draftButton = documentRoot.createElement("button");
        draftButton.id = "sports-events-current-contract-draft";
        draftButton.type = "button";
        draftButton.className = "sports-events-current-detail-button sports-events-current-contract-button";
        draftButton.textContent = "OPEN LOCAL CONTRACT / POOL REHEARSAL";
        draftButton.title = "Carry this selected public record into an in-memory, non-executable local draft.";
        // Keep the handoff inspectable for keyboard/screen-reader users and
        // for the shared projection session. The identifiers are copied from
        // the returned provider record; this element never becomes a source
        // of truth and never creates a draft until the explicit click.
        draftButton.dataset.sourceRecordId = record.id;
        draftButton.dataset.sourceUrl = record.sourceUrl;
        draftButton.setAttribute?.("aria-label", `Open local contract and pool rehearsal for ${record.title}`);
        draftButton.addEventListener("click", () => onOpenContractDraft({ record, method: "button" }));
        currentEl.appendChild(draftButton);
      } else if (typeof onOpenContractDraft === "function") {
        currentEl.appendChild(createText(
          documentRoot,
          "span",
          "sports-events-current-contract-unavailable",
          "LOCAL CONTRACT / POOL UNAVAILABLE · PROVIDER RECORD LACKS REQUIRED ID, TWO NAMED PLAYERS, OR ALLOWLISTED HTTPS SOURCE · NO DRAFT",
        ));
      }
      // Provider records can be incomplete.  Do not turn an absent or
      // non-HTTPS source into a misleading # link: this is the same safe
      // outbound-link boundary used for player-rank and detail documents.
      const sourceLink = publicLink(
        documentRoot,
        "sports-events-current-url",
        record.sourceUrl,
        "OPEN PUBLIC ESPN SOURCE",
      );
      if (sourceLink) {
        currentEl.appendChild(sourceLink);
      } else {
        currentEl.appendChild(createText(
          documentRoot,
          "span",
          "sports-events-current-url-unavailable",
          "PUBLIC ESPN SOURCE UNAVAILABLE · PROVIDER DID NOT RETURN SAFE HTTPS SOURCE",
        ));
      }
      if (Array.isArray(record.detailReferences) && record.detailReferences.length) {
        currentEl.appendChild(createText(documentRoot, "span", "sports-events-current-refs", `DETAIL REFERENCES · ${record.detailReferences.length} PUBLIC LINK${record.detailReferences.length === 1 ? "" : "S"}`));
      }
    }
    const status = summary.status === "ready"
      ? `READY · ${summary.recordCount} TENNIS MATCH${summary.recordCount === 1 ? "" : "ES"} · RESEARCH ONLY`
      : summary.status === "partial"
        ? `PARTIAL · ${summary.recordCount} MATCH${summary.recordCount === 1 ? "" : "ES"} · SOME PROVIDERS UNAVAILABLE`
        : "UNAVAILABLE · NO TENNIS DATA LOADED · NO DATA FABRICATED";
    statusEl.textContent = loading
      ? "REFRESHING ESPN PUBLIC SOURCES · WAITING FOR RESPONSE"
      : sourceReturn?.strict === true && sourceReturn.state === "pending"
        ? "RESTORING SOURCE RECORD · WAITING FOR EXACT PROVIDER ID"
        : sourceReturn?.strict === true && (sourceReturn.state === "missing" || sourceReturn.state === "invalid")
          ? "SOURCE RECORD NOT RETURNED · NO DATA FABRICATED"
          : trace.length ? `${status} · ${trace.length} LOCAL INSPECTION${trace.length === 1 ? "" : "S"}` : status;
    refreshButton.disabled = loading;
    resetButton.disabled = trace.length === 0 && selectedId === (summary.records[0]?.id ?? null);
    queryEl.textContent = `TOURS · ${(summary.tours ?? ["ATP", "WTA"]).join(" + ")} · RETRIEVED ${summary.retrievedAt ?? "—"}`;
    if (boundaryEl) boundaryEl.textContent = summary.boundary ?? SPORTS_EVENTS_BOUNDARY;
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(createText(documentRoot, "div", "sports-events-empty", "No local inspection yet. Refresh public tennis evidence, then select a match."));
      return;
    }
    trace.forEach((entry, index) => traceEl.appendChild(createText(
      documentRoot,
      "div",
      "sports-events-trace-row",
      `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.recordId ?? "all matches"} · LOCAL ONLY`,
    )));
  }

  function renderSecondaryParity(record) {
    if (!secondaryEl && !secondaryStatusEl && !secondaryContextEl && !secondaryFieldsEl) return;
    const parity = createSecondaryParityStatus(record);
    if (secondaryStatusEl) {
      secondaryStatusEl.textContent = parity.status === "available"
        ? `AVAILABLE · ${parity.provider}`
        : "UNAVAILABLE · NO VERIFIED SECONDARY SOURCE · NO PARITY REQUEST MADE";
    }
    if (secondaryContextEl) {
      const context = parity.context ?? {};
      const players = Array.isArray(context.playerNames) && context.playerNames.length
        ? context.playerNames.join(" vs ")
        : "PLAYER CONTEXT UNAVAILABLE";
      secondaryContextEl.textContent = `${parity.provider} · MATCH ${context.matchId ?? "UNAVAILABLE"} · ${players} · OBSERVED ${context.observedAt ?? "—"}`;
    }
    if (secondaryFieldsEl) {
      secondaryFieldsEl.replaceChildren();
      (parity.fields ?? []).forEach((field) => {
        const row = documentRoot.createElement("div");
        row.className = `sports-events-secondary-field sports-events-secondary-field-${field.status}`;
        const status = String(field.status ?? "unavailable").toUpperCase();
        row.append(
          createText(documentRoot, "strong", "sports-events-secondary-field-name", String(field.id ?? "field").replace(/([A-Z])/g, " $1").toUpperCase()),
          createText(documentRoot, "span", "sports-events-secondary-field-status", `${status} · ${field.agreement ?? "unavailable"}`),
        );
        if (field.reason) row.appendChild(createText(documentRoot, "span", "sports-events-secondary-field-reason", field.reason));
        secondaryFieldsEl.appendChild(row);
      });
    }
    if (secondaryBoundaryEl) secondaryBoundaryEl.textContent = parity.boundary;
  }

  function render() {
    renderSummary();
    renderSources();
    renderRecords();
    renderCurrent();
    renderSecondaryParity(selectedRecord());
    renderTrace();
  }

  function selectRecord(recordId, method = "button") {
    const record = summary.records.find((candidate) => candidate.id === recordId);
    if (!record) return null;
    if (sourceReturn?.strict === true && !String(method).startsWith("route:")) sourceReturn = null;
    selectedId = record.id;
    const snapshot = deepFreeze({
      source: SPORTS_EVENTS_CONSOLE_SOURCE,
      action: "select",
      method,
      recordId: record.id,
      record,
      secondaryParity: createSecondaryParityStatus(record),
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
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
    const snapshot = replaySportsEvents(summary, selectedId, method);
    pushTrace({ action: "replay", recordId: snapshot.recordId });
    render();
    const envelope = deepFreeze({ ...snapshot, source: SPORTS_EVENTS_CONSOLE_SOURCE });
    onReplay?.(envelope);
    return envelope;
  }

  function reset(method = "button") {
    selectedId = summary.records[0]?.id ?? null;
    trace = [];
    const snapshot = deepFreeze({
      source: SPORTS_EVENTS_CONSOLE_SOURCE,
      action: "reset",
      method,
      recordId: selectedId,
      secondaryParity: createSecondaryParityStatus(selectedRecord()),
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      providerCredentials: false,
      liveFetch: false,
      truthClaim: false,
      executable: false,
    });
    render();
    onReset?.(snapshot);
    return snapshot;
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
        summary = summarizeSportsEvents({
          ...summary,
          records: summary.records.map((candidate) => candidate.id === nextRecord.id ? nextRecord : candidate),
          timelineSources: [
            ...(Array.isArray(summary.timelineSources) ? summary.timelineSources : []),
            ...(Array.isArray(result.timelineSources) ? result.timelineSources : []),
          ],
          timelineRequestCount: (summary.timelineRequestCount ?? 0) + (result.requestCount ?? 0),
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

  async function refresh(method = "button", options = {}) {
    if (loading) return getSnapshot();
    loading = true;
    renderCurrent();
    try {
      const result = await onRefresh?.({ method, tours: summary.tours ?? ["ATP", "WTA"] });
      summary = summarizeSportsEvents(result ?? createUnavailableSportsEvents({ reason: "Refresh returned no public ESPN response; no data was fabricated." }));
      // Keep a strict source-return context empty until the exact requested
      // provider id is resolved by the route owner.  The ordinary Sports
      // surface retains its useful first-row selection behavior.
      selectedId = sourceReturn?.strict === true ? null : summary.records[0]?.id ?? null;
      refreshCount += 1;
      pushTrace({ action: "refresh", recordId: null, refreshCount });
    } catch (error) {
      summary = summarizeSportsEvents(createUnavailableSportsEvents({ reason: `Public ESPN provider unavailable: ${text(error?.message ?? error, "unknown error")}` }));
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
    summary = summarizeSportsEvents(nextData);
    if (sourceReturn?.strict === true) selectedId = null;
    else if (!summary.records.some((record) => record.id === selectedId)) selectedId = summary.records[0]?.id ?? null;
    render();
    return getSnapshot();
  }

  function setSourceReturnState({ requestedRecordId = null, state = "pending", reason = null } = {}) {
    const validId = typeof requestedRecordId === "string" && SPORTS_RECORD_ID_PATTERN.test(requestedRecordId)
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
      pushTrace({
        action: "source-record-not-returned",
        recordId: validId,
        reason: sourceReturn.reason ?? "requested provider record was not returned",
      });
    }
    render();
    return getSnapshot();
  }

  function getSnapshot() {
    return deepFreeze({
      source: SPORTS_EVENTS_CONSOLE_SOURCE,
      summary,
      selectedId,
      selectedRecord: selectedRecord(),
      sourceReturn,
      secondaryParity: createSecondaryParityStatus(selectedRecord()),
      opened,
      loading,
      refreshCount,
      detailLoadingId,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      providerCredentials: false,
      liveFetch: summary.liveFetch,
      truthClaim: false,
      executable: false,
      boundary: summary.boundary ?? SPORTS_EVENTS_BOUNDARY,
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

export const createSportsEventsEvidenceConsole = createSportsEventsConsole;
export default createSportsEventsConsole;
