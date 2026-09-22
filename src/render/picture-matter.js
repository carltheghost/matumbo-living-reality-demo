import { MATTER_FORGE_SOURCE } from "../domains/matter-forge.js?v=20260922-cache2";

/**
 * Renderer-only source marker.  The Picture Matter console reads the
 * canonical matter-forge projection but never materializes image bytes,
 * contacts a provider, publishes a statement, or decides whether text is
 * true. A host may hand it a frozen, metadata-only public read; the renderer
 * displays that envelope and never performs the refresh itself.
 */
export const PICTURE_MATTER_CONSOLE_SOURCE = "picture-matter-console";
export const PICTURE_MATTER_RENDER_SOURCE = PICTURE_MATTER_CONSOLE_SOURCE;

const DEFAULT_BOUNDARY =
  "Picture Matter is a local word → statement → provenance rehearsal. Images stay local, interpretations stay non-authoritative, and external publishing is denied.";

const DEFAULT_METADATA_QUERY = "reality";
const DEFAULT_METADATA_BOUNDARY =
  "Public Wikimedia Commons metadata only. Canonical source and optional thumbnail URLs are references; image bytes are not downloaded or rendered, and no storage, publishing, identity, wallet, token, or authority path exists.";

const freeze = (value) => Object.freeze(value);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return freeze(value);
  }
  if (!isRecord(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return freeze(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function normalizeMetadataSnapshot(value) {
  const source = isRecord(value) ? value : {};
  const records = asArray(source.records).filter((record) => isRecord(record));
  const status = source.status === "ready" && records.length ? "ready" : "unavailable";
  return deepFreeze({
    schemaVersion: Number.isSafeInteger(source.schemaVersion) ? source.schemaVersion : 1,
    source: text(source.source, "picture-matter-wikimedia-metadata"),
    provider: text(source.provider, "Wikimedia Commons"),
    endpoint: text(source.endpoint, "https://commons.wikimedia.org/w/api.php"),
    requestUrl: source.requestUrl ?? null,
    query: text(source.query, DEFAULT_METADATA_QUERY),
    requestedLimit: Number.isSafeInteger(source.requestedLimit) ? source.requestedLimit : records.length || 3,
    retrievedAt: text(source.retrievedAt, "not retrieved"),
    status,
    providerAvailable: source.providerAvailable === true,
    returnedCount: records.length,
    records,
    unavailableReason: status === "ready" ? null : text(source.unavailableReason, "No public metadata refresh has completed; no fallback image rows were fabricated."),
    metadataOnly: true,
    imageBytesFetched: false,
    imageBytesStored: false,
    imageBytesRendered: false,
    externalNetwork: source.externalNetwork === true,
    persistence: false,
    publishing: false,
    identity: false,
    wallet: false,
    token: false,
    authority: false,
    executable: false,
    boundary: text(source.boundary, DEFAULT_METADATA_BOUNDARY),
  });
}

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

function contributionFrom(projection) {
  if (projection?.source === MATTER_FORGE_SOURCE) return projection;
  return asArray(projection?.contributions).find(
    (contribution) => contribution?.source === MATTER_FORGE_SOURCE,
  ) ?? { source: MATTER_FORGE_SOURCE, updatedAt: null, entities: [], evidence: [], capabilities: [] };
}

function isInput(entity) {
  return entity?.kind === "word-object" || entity?.kind === "local-image";
}

function isStatement(entity) {
  return entity?.kind === "interpretation" || entity?.kind === "fact-claim";
}

function inputLabel(input) {
  if (!input) return "unlinked input";
  if (input.kind === "word-object") return text(input.word, input.id);
  return text(input.name, input.localRef ?? input.id);
}

function kindLabel(kind) {
  return text(kind, "record").replace(/-/g, " ");
}

function evidenceForEntity(entity, evidenceByEntityId) {
  const evidence = evidenceByEntityId.get(entity.id);
  const provenance = entity?.provenance ?? {};
  return {
    id: evidence?.id ?? `matter-forge-evidence:${entity.id}`,
    kind: evidence?.kind ?? "provenance-record",
    entityId: entity.id,
    source: text(evidence?.source ?? provenance.source),
    timestamp: text(evidence?.timestamp ?? provenance.timestamp),
    uncertainty: typeof (evidence?.uncertainty ?? provenance.uncertainty) === "number"
      ? (evidence?.uncertainty ?? provenance.uncertainty)
      : null,
    entityLabel: entity?.kind === "word-object" || entity?.kind === "local-image"
      ? inputLabel(entity)
      : text(entity?.text, entity?.id),
    entityKind: kindLabel(entity?.kind),
    degraded: evidence?.degraded === true || provenance.degraded === true,
    note: provenance.note ?? null,
    truthAuthority: evidence?.truthAuthority ?? "none",
    simulation: true,
  };
}

/**
 * Build a renderer-safe graph of word/local-image inputs, their statements,
 * and the provenance records that explain where each local fixture came from.
 * All output is frozen and retains the matter-forge simulation boundary.
 */
export function summarizePictureMatter(projection) {
  const contribution = contributionFrom(projection);
  const entities = asArray(contribution.entities);
  const rawInputs = entities.filter(isInput);
  const rawStatements = entities.filter(isStatement);
  const evidenceByEntityId = new Map(
    asArray(contribution.evidence).map((evidence) => [evidence?.entityId, evidence]),
  );

  const inputs = rawInputs.map((input) => {
    const linkedStatements = rawStatements
      .filter((statement) => statement.inputId === input.id)
      .map((statement) => statement.id);
    const provenance = evidenceForEntity(input, evidenceByEntityId);
    return deepFreeze({
      ...input,
      displayLabel: inputLabel(input),
      displayKind: kindLabel(input.kind),
      linkedStatementIds: linkedStatements,
      provenance,
      provenanceId: provenance.id,
    });
  });

  const inputById = new Map(inputs.map((input) => [input.id, input]));
  const statements = rawStatements.map((statement) => {
    const input = inputById.get(statement.inputId);
    const provenance = evidenceForEntity(statement, evidenceByEntityId);
    return deepFreeze({
      ...statement,
      displayLabel: text(statement.text, statement.id),
      displayKind: kindLabel(statement.kind),
      inputLabel: inputLabel(input ?? { id: statement.inputId }),
      inputKind: input?.kind ?? null,
      provenance,
      provenanceId: provenance.id,
    });
  });

  const provenance = [...inputs, ...statements].map((record) => deepFreeze({
    ...record.provenance,
    entityId: record.id,
    entityLabel: record.displayLabel,
    entityKind: record.displayKind,
  }));
  const statementById = new Map(statements.map((statement) => [statement.id, statement]));
  const enrichedInputs = inputs.map((input) => deepFreeze({
    ...input,
    linkedStatements: input.linkedStatementIds
      .map((statementId) => statementById.get(statementId))
      .filter(Boolean),
  }));
  const enrichedStatements = statements.map((statement) => {
    const input = inputById.get(statement.inputId);
    return deepFreeze({
      ...statement,
      input: input ? deepFreeze({ id: input.id, kind: input.kind, displayLabel: input.displayLabel }) : null,
    });
  });
  const enrichedProvenance = provenance.map((record) => deepFreeze({
    ...record,
    entity: entities.find((entity) => entity?.id === record.entityId) ?? null,
  }));
  const wordObjects = enrichedInputs.filter((input) => input.kind === "word-object");
  const localImages = enrichedInputs.filter((input) => input.kind === "local-image");
  const interpretations = enrichedStatements.filter((statement) => statement.kind === "interpretation");
  const factClaims = enrichedStatements.filter((statement) => statement.kind === "fact-claim");

  return deepFreeze({
    source: MATTER_FORGE_SOURCE,
    updatedAt: contribution.updatedAt ?? null,
    inputs: enrichedInputs,
    wordObjects,
    localImages,
    statements: enrichedStatements,
    interpretations,
    factClaims,
    provenance: enrichedProvenance,
    entities: [...enrichedInputs, ...enrichedStatements],
    inputCount: enrichedInputs.length,
    wordCount: wordObjects.length,
    localImageCount: localImages.length,
    statementCount: enrichedStatements.length,
    interpretationCount: interpretations.length,
    factClaimCount: factClaims.length,
    provenanceCount: enrichedProvenance.length,
    recordCount: entities.length,
    evidenceCount: asArray(contribution.evidence).length,
    capabilityCount: asArray(contribution.capabilities).length,
    simulation: contribution.simulation === true,
    localOnly: true,
    externalNetwork: false,
    externalImageFetch: false,
    externalPublishing: false,
    truthDetermination: false,
    assertedTruth: false,
    executable: false,
    persistence: false,
    boundary: DEFAULT_BOUNDARY,
  });
}

export function createPictureMatterConsole({
  documentRoot = globalThis.document,
  projection = null,
  metadata = null,
  onSelect = null,
  onReplay = null,
  onReset = null,
  onPathToggle = null,
  onMetadataRefresh = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Picture Matter console needs a document-like owner");

  const panel = documentRoot.getElementById("picture-matter-console");
  const closeButton = documentRoot.getElementById("picture-matter-console-close");
  const replayButton = documentRoot.getElementById("picture-matter-console-replay");
  const resetButton = documentRoot.getElementById("picture-matter-console-reset");
  const statusEl = documentRoot.getElementById("picture-matter-console-status");
  const summaryEl = documentRoot.getElementById("picture-matter-console-summary");
  const currentEl = documentRoot.getElementById("picture-matter-console-current");
  const wordsEl = documentRoot.getElementById("picture-matter-console-words");
  const statementsEl = documentRoot.getElementById("picture-matter-console-statements");
  const provenanceEl = documentRoot.getElementById("picture-matter-console-provenance");
  const traceEl = documentRoot.getElementById("picture-matter-console-trace");
  const boundaryEl = documentRoot.getElementById("picture-matter-console-boundary");
  // The path controls are optional so older embed hosts can still mount the
  // console, while the canonical index exposes the inspectable graph by
  // default.
  const pathToggleButton = documentRoot.getElementById("picture-matter-console-path-toggle");
  const pathStatusEl = documentRoot.getElementById("picture-matter-console-path-status");
  const pathEl = documentRoot.getElementById("picture-matter-console-path");
  // Metadata controls are optional so older embed hosts can continue to mount
  // the local graph without having to provide the public-read rail.
  const metadataQueryEl = documentRoot.getElementById("picture-matter-console-metadata-query");
  const metadataRefreshButton = documentRoot.getElementById("picture-matter-console-metadata-refresh");
  const metadataStatusEl = documentRoot.getElementById("picture-matter-console-metadata-status");
  const metadataSummaryEl = documentRoot.getElementById("picture-matter-console-metadata-summary");
  const metadataRecordsEl = documentRoot.getElementById("picture-matter-console-metadata-records");
  const metadataBoundaryEl = documentRoot.getElementById("picture-matter-console-metadata-boundary");
  if (!panel || !closeButton || !replayButton || !resetButton || !statusEl || !summaryEl || !currentEl
    || !wordsEl || !statementsEl || !provenanceEl || !traceEl) {
    throw new Error("Picture Matter console mount points are missing");
  }

  let summary = summarizePictureMatter(projection);
  let selectedType = summary.inputs[0] ? "input" : summary.statements[0] ? "statement" : "provenance";
  let selectedId = summary.inputs[0]?.id ?? summary.statements[0]?.id ?? summary.provenance[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let pathExpanded = false;
  let trace = [];
  let metadataSnapshot = normalizeMetadataSnapshot(metadata);
  let metadataRefreshing = false;

  function recordsFor(type) {
    if (type === "statement") return summary.statements;
    if (type === "provenance") return summary.provenance;
    return summary.inputs;
  }

  function selectedRecord() {
    return recordsFor(selectedType).find((record) => record.id === selectedId)
      ?? summary.inputs[0] ?? summary.statements[0] ?? summary.provenance[0] ?? null;
  }

  function linksFor(record, type = selectedType) {
    if (!record) return { input: null, statements: [], provenance: [] };
    if (type === "input") {
      const statements = summary.statements.filter((statement) => statement.inputId === record.id);
      const provenance = [record.provenance, ...statements.map((statement) => statement.provenance)];
      return { input: record, statements, provenance };
    }
    if (type === "statement") {
      const input = summary.inputs.find((candidate) => candidate.id === record.inputId) ?? null;
      return { input, statements: [record], provenance: [input?.provenance, record.provenance].filter(Boolean) };
    }
    const entity = summary.entities.find((candidate) => candidate.id === record.entityId) ?? null;
    const input = entity?.inputId ? summary.inputs.find((candidate) => candidate.id === entity.inputId) ?? null : entity;
    const statement = entity?.kind === "interpretation" || entity?.kind === "fact-claim" ? entity : null;
    return {
      input,
      statements: statement ? [statement] : input?.linkedStatements ?? [],
      provenance: [record],
    };
  }

  /**
   * Return a compact, frozen description of the currently inspectable path.
   * The nested objects deliberately repeat source/provenance/uncertainty
   * fields so a snapshot can be inspected without reaching into the DOM or
   * inferring authority from a label.
   */
  function pathDetailsFor(record, type = selectedType, expanded = pathExpanded) {
    const links = linksFor(record, type);
    const input = links.input;
    return deepFreeze({
      sequence: ["word", "statement", "provenance"],
      selectedType: type,
      selectedId: record?.id ?? null,
      expanded: Boolean(expanded),
      input: input ? {
        id: input.id,
        kind: input.kind,
        label: input.displayLabel,
        word: input.word ?? null,
        localRef: input.localRef ?? null,
        statementIds: input.linkedStatementIds ?? [],
        provenance: input.provenance,
      } : null,
      statements: links.statements.map((statement) => ({
        id: statement.id,
        kind: statement.kind,
        text: statement.text,
        inputId: statement.inputId ?? null,
        inputLabel: statement.inputLabel,
        truthStatus: statement.truthStatus ?? "unverified",
        assertedAsTruth: statement.assertedAsTruth === true,
        provenance: statement.provenance,
      })),
      provenance: links.provenance.map((entry) => ({
        id: entry.id,
        entityId: entry.entityId,
        entityLabel: entry.entityLabel ?? text(entry.entityId),
        entityKind: entry.entityKind ?? kindLabel(entry.kind),
        source: entry.source,
        timestamp: entry.timestamp,
        uncertainty: entry.uncertainty,
        degraded: entry.degraded === true,
        note: entry.note ?? null,
        truthAuthority: entry.truthAuthority ?? "none",
        simulation: true,
      })),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalImageFetch: false,
      externalPublishing: false,
      truthDetermination: false,
      assertedTruth: false,
      executable: false,
      persistence: false,
      boundary: summary.boundary,
    });
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
      externalImageFetch: false,
      externalPublishing: false,
      truthDetermination: false,
      assertedTruth: false,
      executable: false,
    }), ...trace].slice(0, 12);
  }

  function renderSummary() {
    summaryEl.replaceChildren();
    [
      [summary.wordCount, "word objects"],
      [summary.localImageCount, "local images"],
      [summary.statementCount, "statements"],
      [summary.provenanceCount, "provenance links"],
    ].forEach(([value, label]) => {
      const metric = documentRoot.createElement("div");
      metric.className = "picture-matter-console-metric";
      metric.append(
        createText(documentRoot, "b", "picture-matter-console-metric-value", value),
        createText(documentRoot, "span", "picture-matter-console-metric-label", label),
      );
      summaryEl.appendChild(metric);
    });
  }

  function recordButton(record, type) {
    const button = documentRoot.createElement("button");
    button.type = "button";
    button.className = "picture-matter-console-record";
    button.dataset[`${type}Id`] = record.id;
    button.setAttribute("aria-pressed", String(type === selectedType && record.id === selectedId));
    const title = type === "input" ? record.displayLabel : type === "statement" ? record.displayLabel : record.entityLabel;
    const meta = type === "input"
      ? `${record.displayKind} · ${record.linkedStatements.length} linked statement${record.linkedStatements.length === 1 ? "" : "s"}`
      : type === "statement"
        ? `${record.displayKind} · from ${record.inputLabel} · ${record.truthStatus}`
        : `${record.entityKind} · ${record.source} · uncertainty ${record.uncertainty ?? "—"}`;
    button.append(
      createText(documentRoot, "strong", "picture-matter-console-record-title", title),
      createText(documentRoot, "span", "picture-matter-console-record-meta", meta),
    );
    button.addEventListener("click", () => {
      if (type === "input") selectInput(record.id, "button");
      else if (type === "statement") selectStatement(record.id, "button");
      else selectProvenance(record.id, "button");
    });
    return button;
  }

  function pathNode(record, type) {
    const button = documentRoot.createElement("button");
    button.type = "button";
    button.className = "picture-matter-console-path-node";
    button.dataset.pathType = type;
    button.dataset.pathId = record.id;
    const title = type === "input"
      ? record.displayLabel
      : type === "statement"
        ? record.displayLabel
        : text(record.entityLabel ?? record.entityId ?? record.id);
    const meta = type === "input"
      ? `${record.displayKind} · ${record.id} · source ${record.provenance.source}`
      : type === "statement"
        ? `${record.displayKind} · ${record.inputLabel} · ${String(record.truthStatus ?? "unverified").toUpperCase()}`
        : `${record.entityKind ?? kindLabel(record.kind ?? "provenance")} · ${record.id} · uncertainty ${record.uncertainty ?? "—"}`;
    const detail = type === "input"
      ? `PROVENANCE · ${record.provenance.source} · ${record.provenance.timestamp} · UNCERTAINTY ${record.provenance.uncertainty ?? "—"}`
      : type === "statement"
        ? `SOURCE · ${record.provenance.source} · ${record.provenance.timestamp} · UNCERTAINTY ${record.provenance.uncertainty ?? "—"} · AUTHORITY ${record.provenance.truthAuthority ?? "none"}`
        : `SOURCE · ${record.source} · ${record.timestamp} · UNCERTAINTY ${record.uncertainty ?? "—"} · AUTHORITY ${record.truthAuthority ?? "none"}`;
    button.setAttribute("aria-label", `${kindLabel(type)} ${title}; ${meta}`);
    button.append(
      createText(documentRoot, "strong", "picture-matter-console-path-node-title", `${kindLabel(type).toUpperCase()} · ${title}`),
      createText(documentRoot, "span", "picture-matter-console-path-node-meta", meta),
      createText(documentRoot, "span", "picture-matter-console-path-node-detail", detail),
    );
    button.addEventListener("click", () => {
      if (type === "input") selectInput(record.id, "path");
      else if (type === "statement") selectStatement(record.id, "path");
      else selectProvenance(record.id, "path");
    });
    return button;
  }

  function renderPathStage(label, records, type, emptyCopy) {
    const stage = documentRoot.createElement("section");
    stage.className = "picture-matter-console-path-stage";
    stage.setAttribute("aria-label", label);
    stage.appendChild(createText(documentRoot, "h4", "picture-matter-console-path-stage-title", label));
    const stack = documentRoot.createElement("div");
    stack.className = "picture-matter-console-path-stage-list";
    if (!records.length) {
      stack.appendChild(createText(documentRoot, "div", "picture-matter-console-empty", emptyCopy));
    } else {
      records.forEach((record) => stack.appendChild(pathNode(record, type)));
    }
    stage.appendChild(stack);
    return stage;
  }

  function renderPath() {
    const record = selectedRecord();
    const links = linksFor(record);
    const visible = Boolean(pathExpanded && record);
    if (pathToggleButton) {
      pathToggleButton.disabled = !record;
      pathToggleButton.textContent = visible ? "Collapse meaning path" : "Expand meaning path";
      pathToggleButton.setAttribute("aria-expanded", String(visible));
      pathToggleButton.setAttribute("aria-controls", "picture-matter-console-path");
    }
    if (pathStatusEl) {
      pathStatusEl.textContent = !record
        ? "PATH COLLAPSED · NO RECORD"
        : visible
          ? `PATH OPEN · WORD → STATEMENT → PROVENANCE · ${links.statements.length} STATEMENT${links.statements.length === 1 ? "" : "S"} · ${links.provenance.length} PROVENANCE`
          : "PATH COLLAPSED · WORD → STATEMENT → PROVENANCE";
    }
    if (!pathEl) return;
    pathEl.hidden = !visible;
    pathEl.setAttribute("aria-hidden", String(!visible));
    pathEl.replaceChildren();
    if (!visible) return;
    pathEl.append(
      renderPathStage("WORD / LOCAL INPUT", links.input ? [links.input] : [], "input", "No input is linked."),
      renderPathStage("STATEMENT", links.statements, "statement", "No statement is linked."),
      renderPathStage("PROVENANCE", links.provenance, "provenance", "No provenance is linked."),
    );
  }

  function metadataRecordElement(record, index) {
    const card = documentRoot.createElement("article");
    card.className = "picture-matter-console-metadata-record";
    card.setAttribute?.("role", "listitem");
    card.append(
      createText(documentRoot, "strong", "picture-matter-console-metadata-record-title", `${index + 1}. ${text(record.title, "Wikimedia file")}`),
      createText(documentRoot, "span", "picture-matter-console-metadata-record-meta", `${text(record.mime, "image metadata")} · ${text(record.width, "?")}×${text(record.height, "?")} · ${text(record.sizeBytes, "?")} bytes · provider ${text(record.providerTimestamp, "—")}`),
      createText(documentRoot, "span", "picture-matter-console-metadata-record-label", "CANONICAL SOURCE"),
      createText(documentRoot, "code", "picture-matter-console-metadata-record-url", text(record.sourceUrl, "not supplied")),
    );
    if (record.thumbnailUrl) {
      card.append(
        createText(documentRoot, "span", "picture-matter-console-metadata-record-label", "OPTIONAL THUMBNAIL REFERENCE · NOT RENDERED"),
        createText(documentRoot, "code", "picture-matter-console-metadata-record-url", record.thumbnailUrl),
      );
    }
    return card;
  }

  function renderMetadata() {
    const metadata = metadataSnapshot;
    const records = asArray(metadata.records);
    if (metadataQueryEl && typeof metadata.query === "string") metadataQueryEl.value = metadata.query;
    if (metadataStatusEl) {
      if (metadataRefreshing) {
        metadataStatusEl.textContent = `REQUESTING · ${text(metadata.provider, "PUBLIC PROVIDER").toUpperCase()} METADATA`;
      } else if (metadata.status === "ready") {
        metadataStatusEl.textContent = `READY · ${text(metadata.provider, "PUBLIC PROVIDER").toUpperCase()} · ${records.length} RETURNED · METADATA ONLY`;
      } else {
        metadataStatusEl.textContent = `UNAVAILABLE · ${text(metadata.provider, "PUBLIC PROVIDER").toUpperCase()} · ${records.length} RETURNED`;
      }
    }
    if (metadataSummaryEl) {
      metadataSummaryEl.textContent = [
        `PROVIDER · ${text(metadata.provider, "—")}`,
        `SOURCE · ${text(metadata.source, "—")}`,
        `RETRIEVED · ${text(metadata.retrievedAt, "—")}`,
        `QUERY · ${text(metadata.query, DEFAULT_METADATA_QUERY)}`,
        `RETURNED · ${records.length}/${text(metadata.requestedLimit, "—")}`,
      ].join(" · ");
    }
    if (metadataRecordsEl) {
      metadataRecordsEl.replaceChildren();
      if (!records.length) {
        metadataRecordsEl.appendChild(createText(
          documentRoot,
          "div",
          "picture-matter-console-empty",
          metadata.unavailableReason ?? "No public metadata rows are available. Refresh explicitly to query the provider.",
        ));
      } else {
        records.forEach((record, index) => metadataRecordsEl.appendChild(metadataRecordElement(record, index)));
      }
    }
    if (metadataBoundaryEl) metadataBoundaryEl.textContent = text(metadata.boundary, DEFAULT_METADATA_BOUNDARY);
    if (metadataRefreshButton) metadataRefreshButton.disabled = metadataRefreshing;
  }

  function unavailableMetadata(reason, query) {
    return normalizeMetadataSnapshot({
      source: "picture-matter-wikimedia-metadata",
      provider: "Wikimedia Commons",
      endpoint: "https://commons.wikimedia.org/w/api.php",
      query: text(query, metadataSnapshot.query),
      requestedLimit: metadataSnapshot.requestedLimit,
      status: "unavailable",
      unavailableReason: text(reason, "Metadata refresh was unavailable; no fallback image rows were fabricated."),
      providerAvailable: false,
      externalNetwork: false,
      boundary: DEFAULT_METADATA_BOUNDARY,
    });
  }

  function renderList(element, records, type, emptyCopy) {
    element.replaceChildren();
    if (!records.length) {
      element.appendChild(createText(documentRoot, "div", "picture-matter-console-empty", emptyCopy));
      return;
    }
    records.forEach((record) => element.appendChild(recordButton(record, type)));
  }

  function renderCurrent() {
    const record = selectedRecord();
    const links = linksFor(record);
    if (!record) {
      currentEl.textContent = "NO PICTURE MATTER RECORDS";
    } else if (selectedType === "input") {
      const statementCopy = links.statements[0]?.text ?? "No statement linked yet.";
      currentEl.textContent = `WORD · ${record.displayLabel} → STATEMENT · ${statementCopy} → PROVENANCE · ${links.provenance.length} local link${links.provenance.length === 1 ? "" : "s"}`;
    } else if (selectedType === "statement") {
      currentEl.textContent = `STATEMENT · ${record.text} · FROM ${record.inputLabel} · ${record.truthStatus.toUpperCase()} · PROVENANCE ${record.provenance.source}`;
    } else {
      currentEl.textContent = `PROVENANCE · ${record.entityLabel} · ${record.source} · UNCERTAINTY ${record.uncertainty ?? "—"} · NO AUTHORITY`;
    }
    statusEl.textContent = trace.length
      ? `READY · ${trace.length} LOCAL INSPECTION${trace.length === 1 ? "" : "S"} · NO PUBLISHING`
      : "READY · WORD → STATEMENT → PROVENANCE · LOCAL ONLY";
    replayButton.disabled = !record;
    const firstId = summary.inputs[0]?.id ?? summary.statements[0]?.id ?? summary.provenance[0]?.id ?? null;
    resetButton.disabled = trace.length === 0 && selectedId === firstId && selectedType === (summary.inputs[0] ? "input" : summary.statements[0] ? "statement" : "provenance");
    if (boundaryEl) boundaryEl.textContent = summary.boundary;
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(createText(documentRoot, "div", "picture-matter-console-empty", "No local inspection yet. Select a word, statement, or provenance link."));
      return;
    }
    trace.forEach((entry, index) => traceEl.appendChild(createText(
      documentRoot,
      "div",
      "picture-matter-console-trace-row",
      `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.recordId ?? "graph"} · LOCAL ONLY`,
    )));
  }

  function render() {
    renderSummary();
    renderList(wordsEl, summary.inputs, "input", "No local word-object or image metadata is projected.");
    renderList(statementsEl, summary.statements, "statement", "No interpretation or claim-shaped statement is projected.");
    renderList(provenanceEl, summary.provenance, "provenance", "No provenance records are projected.");
    renderCurrent();
    renderPath();
    renderMetadata();
    renderTrace();
  }

  function selectRecord(recordId, type, method = "button") {
    const record = recordsFor(type).find((candidate) => candidate.id === recordId);
    if (!record) return null;
    selectedType = type;
    selectedId = record.id;
    const links = linksFor(record, type);
    const snapshot = deepFreeze({
      source: PICTURE_MATTER_CONSOLE_SOURCE,
      action: "select",
      method,
      recordType: type,
      recordId: record.id,
      record,
      input: links.input,
      linkedStatements: links.statements,
      linkedProvenance: links.provenance,
      path: pathDetailsFor(record, type),
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalImageFetch: false,
      externalPublishing: false,
      truthDetermination: false,
      assertedTruth: false,
      executable: false,
    });
    pushTrace({ action: `select-${type}`, recordId: record.id });
    render();
    onSelect?.(snapshot);
    return snapshot;
  }

  function selectInput(recordId, method = "button") {
    return selectRecord(recordId, "input", method);
  }

  function selectWord(recordId, method = "button") {
    if (!summary.wordObjects.some((record) => record.id === recordId)) return null;
    return selectRecord(recordId, "input", method);
  }

  function selectStatement(recordId, method = "button") {
    return selectRecord(recordId, "statement", method);
  }

  function selectProvenance(recordId, method = "button") {
    return selectRecord(recordId, "provenance", method);
  }

  function replay(method = "button") {
    const record = selectedRecord();
    const links = linksFor(record);
    const path = {
      inputId: links.input?.id ?? null,
      statementIds: links.statements.map((statement) => statement.id),
      provenanceIds: links.provenance.map((entry) => entry.id),
    };
    const snapshot = deepFreeze({
      source: PICTURE_MATTER_CONSOLE_SOURCE,
      action: "replay",
      method,
      recordType: selectedType,
      recordId: record?.id ?? null,
      path,
      pathDetails: pathDetailsFor(record),
      sequence: ["word", "statement", "provenance"],
      replayedRecordCount: summary.recordCount,
      record,
      linkedStatements: links.statements,
      linkedProvenance: links.provenance,
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalImageFetch: false,
      externalPublishing: false,
      truthDetermination: false,
      assertedTruth: false,
      executable: false,
    });
    pushTrace({ action: "replay", recordId: record?.id ?? null });
    render();
    onReplay?.(snapshot);
    return snapshot;
  }

  function reset(method = "button") {
    selectedType = summary.inputs[0] ? "input" : summary.statements[0] ? "statement" : "provenance";
    selectedId = summary.inputs[0]?.id ?? summary.statements[0]?.id ?? summary.provenance[0]?.id ?? null;
    pathExpanded = false;
    trace = [];
    const snapshot = deepFreeze({
      source: PICTURE_MATTER_CONSOLE_SOURCE,
      action: "reset",
      method,
      recordType: selectedType,
      recordId: selectedId,
      path: pathDetailsFor(selectedRecord()),
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalImageFetch: false,
      externalPublishing: false,
      truthDetermination: false,
      assertedTruth: false,
      executable: false,
    });
    render();
    onReset?.(snapshot);
    return snapshot;
  }

  function syncProjection(nextProjection) {
    summary = summarizePictureMatter(nextProjection);
    if (!recordsFor(selectedType).some((record) => record.id === selectedId)) {
      selectedType = summary.inputs[0] ? "input" : summary.statements[0] ? "statement" : "provenance";
      selectedId = summary.inputs[0]?.id ?? summary.statements[0]?.id ?? summary.provenance[0]?.id ?? null;
    }
    if (!selectedRecord()) pathExpanded = false;
    render();
    return getSnapshot();
  }

  function setMetadata(nextMetadata) {
    metadataSnapshot = normalizeMetadataSnapshot(nextMetadata);
    render();
    return getSnapshot();
  }

  function setMetadataQuery(nextQuery) {
    const normalized = text(nextQuery, DEFAULT_METADATA_QUERY)
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 64) || DEFAULT_METADATA_QUERY;
    if (metadataQueryEl) metadataQueryEl.value = normalized;
    return getSnapshot();
  }

  function refreshMetadata(method = "button") {
    const query = text(metadataQueryEl?.value, metadataSnapshot.query).trim() || DEFAULT_METADATA_QUERY;
    const limit = metadataSnapshot.requestedLimit;
    metadataRefreshing = true;
    renderMetadata();
    let request;
    try {
      request = typeof onMetadataRefresh === "function"
        ? onMetadataRefresh({ query, limit, method })
        : unavailableMetadata("No host metadata refresh is connected; no fallback image rows were fabricated.", query);
    } catch (error) {
      request = Promise.reject(error);
    }
    return Promise.resolve(request)
      .then((nextMetadata) => setMetadata(nextMetadata ?? unavailableMetadata("Host metadata refresh returned no envelope; no fallback image rows were fabricated.", query)))
      .catch((error) => setMetadata(unavailableMetadata(`Metadata refresh failed: ${text(error?.message, error)}`, query)))
      .finally(() => {
        metadataRefreshing = false;
        renderMetadata();
      });
  }

  function setPathExpanded(next, method = "button") {
    const recordBeforeToggle = selectedRecord();
    // A disabled control must remain a no-op even when a host calls the API
    // directly while the projection has no records.
    const desired = Boolean(next) && Boolean(recordBeforeToggle);
    if (desired === pathExpanded) {
      renderPath();
      return getSnapshot();
    }
    pathExpanded = desired;
    const record = selectedRecord();
    const snapshot = deepFreeze({
      source: PICTURE_MATTER_CONSOLE_SOURCE,
      action: pathExpanded ? "expand-path" : "collapse-path",
      method,
      recordType: selectedType,
      recordId: record?.id ?? null,
      expanded: pathExpanded,
      path: pathDetailsFor(record),
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalImageFetch: false,
      externalPublishing: false,
      truthDetermination: false,
      assertedTruth: false,
      executable: false,
      persistence: false,
      boundary: summary.boundary,
    });
    pushTrace({ action: snapshot.action, recordId: record?.id ?? null });
    render();
    onPathToggle?.(snapshot);
    return snapshot;
  }

  function togglePath(method = "button") {
    return setPathExpanded(!pathExpanded, method);
  }

  function getSnapshot() {
    const record = selectedRecord();
    const links = linksFor(record);
    return deepFreeze({
      source: PICTURE_MATTER_CONSOLE_SOURCE,
      summary,
      selectedType,
      selectedId,
      selectedRecord: record,
      input: links.input,
      linkedStatements: links.statements,
      linkedProvenance: links.provenance,
      metadata: metadataSnapshot,
      metadataRefreshing,
      metadataOnly: true,
      metadataExternalNetwork: metadataSnapshot.externalNetwork === true,
      pathExpanded,
      path: pathDetailsFor(record),
      pathVisible: Boolean(pathExpanded && record),
      opened,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalImageFetch: false,
      externalPublishing: false,
      truthDetermination: false,
      assertedTruth: false,
      executable: false,
      boundary: summary.boundary,
    });
  }

  closeButton.addEventListener("click", () => setOpen(false));
  replayButton.addEventListener("click", () => replay("button"));
  resetButton.addEventListener("click", () => reset("button"));
  pathToggleButton?.addEventListener("click", () => togglePath("button"));
  metadataRefreshButton?.addEventListener("click", () => { void refreshMetadata("button"); });
  documentRoot.addEventListener?.("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false);
  });
  render();
  setOpen(opened);

  return Object.freeze({
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!opened),
    selectRecord: (recordId, type = "input", method = "button") => selectRecord(recordId, type, method),
    selectInput,
    selectWord,
    selectStatement,
    selectProvenance,
    replay,
    reset,
    togglePath,
    setPathExpanded,
    refreshMetadata,
    setMetadataQuery,
    setMetadata,
    syncProjection,
    setProjection: syncProjection,
    getSnapshot,
    destroy: () => {},
  });
}

export const createPictureMatterLayer = createPictureMatterConsole;
export const createPictureMatterRenderer = createPictureMatterConsole;
export default createPictureMatterConsole;
