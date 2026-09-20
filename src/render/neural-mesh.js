import { NEURAL_MESH_SOURCE } from "../domains/neural-mesh.js";

/**
 * Renderer-only adapter for the advisory Neural Mesh projection.
 *
 * The domain owns the canonical records.  This module only creates a small,
 * page-session inspection model and DOM controls around those records.  It
 * deliberately has no provider, network, tool, identity, or execution path.
 */
export const NEURAL_MESH_CONSOLE_SOURCE = "neural-mesh-console";
export const NEURAL_MESH_RENDER_SOURCE = NEURAL_MESH_CONSOLE_SOURCE;

const DEFAULT_BOUNDARY =
  "Advisory local projection only. Control Tower and Oracle records are inspectable, but no autonomous execution, provider access, or tool authority is active.";

const RECORD_TYPES = Object.freeze([
  "agent",
  "intent",
  "proposal",
  "relationship",
  "ancestry",
]);

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

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

function contributionFrom(projection) {
  if (projection?.source === NEURAL_MESH_SOURCE) return projection;
  return asArray(projection?.contributions).find((contribution) => contribution?.source === NEURAL_MESH_SOURCE)
    ?? { source: NEURAL_MESH_SOURCE, updatedAt: null, entities: [], evidence: [], capabilities: [] };
}

function typeForEntity(entity) {
  switch (entity?.kind) {
    case "advisory-agent": return "agent";
    case "advisory-intent": return "intent";
    case "advisory-proposal": return "proposal";
    case "agent-relationship": return "relationship";
    case "agent-ancestry": return "ancestry";
    default: return "record";
  }
}

function kindLabel(entity) {
  return text(entity?.kind ?? "record")
    .replace(/^advisory-/, "")
    .replace(/^agent-/, "")
    .replace(/-/g, " ");
}

function labelForAgent(byId, agentId) {
  return byId.get(agentId)?.label ?? agentId ?? "unknown agent";
}

function displayLabel(entity, byId, intentsById) {
  if (!entity) return "unnamed record";
  switch (entity.kind) {
    case "advisory-agent":
      return text(entity.label ?? entity.id);
    case "advisory-intent":
      return `${labelForAgent(byId, entity.agentId)} · ${text(entity.summary)}`;
    case "advisory-proposal":
      return `${labelForAgent(byId, entity.agentId)} · ${text(entity.summary)}`;
    case "agent-relationship":
      return `${labelForAgent(byId, entity.fromAgentId)} → ${labelForAgent(byId, entity.toAgentId)}`;
    case "agent-ancestry":
      return `${labelForAgent(byId, entity.ancestorAgentId)} → ${labelForAgent(byId, entity.descendantAgentId)}`;
    default:
      return text(entity.label ?? entity.id);
  }
}

function enrich(entity, byId, intentsById) {
  const type = typeForEntity(entity);
  const record = {
    ...entity,
    recordType: type,
    displayKind: kindLabel(entity),
    displayLabel: displayLabel(entity, byId, intentsById),
  };
  if (entity?.kind === "advisory-intent") {
    record.agentLabel = labelForAgent(byId, entity.agentId);
  } else if (entity?.kind === "advisory-proposal") {
    record.agentLabel = labelForAgent(byId, entity.agentId);
    record.intentSummary = intentsById.get(entity.intentId)?.summary ?? entity.intentId;
  } else if (entity?.kind === "agent-relationship") {
    record.fromLabel = labelForAgent(byId, entity.fromAgentId);
    record.toLabel = labelForAgent(byId, entity.toAgentId);
  } else if (entity?.kind === "agent-ancestry") {
    record.ancestorLabel = labelForAgent(byId, entity.ancestorAgentId);
    record.descendantLabel = labelForAgent(byId, entity.descendantAgentId);
  }
  return deepFreeze(record);
}

/**
 * Join the canonical Neural Mesh entities into five inspectable local lists.
 * All returned records are copies so the renderer can never mutate the
 * projection envelope owned by SIMFABRIC.
 */
export function summarizeNeuralMesh(projection) {
  const contribution = contributionFrom(projection);
  const entities = asArray(contribution.entities);
  const rawAgents = entities.filter((entity) => entity?.kind === "advisory-agent");
  const byId = new Map(rawAgents.map((agent) => [agent.id, agent]));
  const rawIntents = entities.filter((entity) => entity?.kind === "advisory-intent");
  const intentsById = new Map(rawIntents.map((intent) => [intent.id, intent]));
  const agents = rawAgents.map((entity) => enrich(entity, byId, intentsById));
  const intents = rawIntents.map((entity) => enrich(entity, byId, intentsById));
  const proposals = entities
    .filter((entity) => entity?.kind === "advisory-proposal")
    .map((entity) => enrich(entity, byId, intentsById));
  const relationships = entities
    .filter((entity) => entity?.kind === "agent-relationship")
    .map((entity) => enrich(entity, byId, intentsById));
  const ancestry = entities
    .filter((entity) => entity?.kind === "agent-ancestry")
    .map((entity) => enrich(entity, byId, intentsById));
  const records = [...agents, ...intents, ...proposals, ...relationships, ...ancestry];
  const evidence = asArray(contribution.evidence);
  const capabilities = asArray(contribution.capabilities);
  return deepFreeze({
    source: NEURAL_MESH_SOURCE,
    updatedAt: contribution.updatedAt,
    records,
    agents,
    intents,
    proposals,
    relationships,
    ancestry,
    agentCount: agents.length,
    intentCount: intents.length,
    proposalCount: proposals.length,
    relationshipCount: relationships.length,
    ancestryCount: ancestry.length,
    recordCount: records.length,
    evidence,
    capabilities,
    evidenceCount: evidence.length,
    capabilityCount: capabilities.length,
    simulation: contribution.simulation === true,
    advisoryOnly: true,
    localOnly: true,
    externalNetwork: false,
    externalProviders: false,
    providerAccess: false,
    toolAccess: false,
    autonomousExecution: false,
    executable: false,
    persistence: false,
    identityAuthority: "none",
    executionAuthority: "none",
    boundary: evidence[0]?.note ?? DEFAULT_BOUNDARY,
  });
}

function listForType(summary, type) {
  const key = type === "ancestry" ? "ancestry" : `${type}s`;
  return summary[key] ?? [];
}

function inferType(summary, recordId) {
  return RECORD_TYPES.find((type) => listForType(summary, type).some((record) => record.id === recordId)) ?? null;
}

function linkedReplay(summary, selectedType, selectedRecord) {
  if (!selectedRecord) return { sequence: [], sequenceTypes: [] };
  const sequence = [];
  const sequenceTypes = [];
  const add = (type, id) => {
    if (!id || sequence.includes(id)) return;
    sequence.push(id);
    sequenceTypes.push(type);
  };
  if (selectedType === "agent") {
    add("agent", selectedRecord.id);
    summary.relationships
      .filter((link) => link.fromAgentId === selectedRecord.id || link.toAgentId === selectedRecord.id)
      .forEach((link) => {
        add("relationship", link.id);
        add("agent", link.fromAgentId);
        add("agent", link.toAgentId);
      });
    summary.ancestry
      .filter((link) => link.ancestorAgentId === selectedRecord.id || link.descendantAgentId === selectedRecord.id)
      .forEach((link) => {
        add("ancestry", link.id);
        add("agent", link.ancestorAgentId);
        add("agent", link.descendantAgentId);
      });
    summary.intents.filter((intent) => intent.agentId === selectedRecord.id)
      .forEach((intent) => add("intent", intent.id));
    summary.proposals.filter((proposal) => proposal.agentId === selectedRecord.id)
      .forEach((proposal) => add("proposal", proposal.id));
  } else if (selectedType === "intent") {
    add("intent", selectedRecord.id);
    summary.proposals.filter((proposal) => proposal.intentId === selectedRecord.id)
      .forEach((proposal) => add("proposal", proposal.id));
  } else if (selectedType === "proposal") {
    add("intent", selectedRecord.intentId);
    add("proposal", selectedRecord.id);
  } else if (selectedType === "relationship") {
    add("agent", selectedRecord.fromAgentId);
    add("relationship", selectedRecord.id);
    add("agent", selectedRecord.toAgentId);
  } else if (selectedType === "ancestry") {
    add("agent", selectedRecord.ancestorAgentId);
    add("ancestry", selectedRecord.id);
    add("agent", selectedRecord.descendantAgentId);
  }
  return { sequence, sequenceTypes };
}

/**
 * Mount the local Neural Mesh console.  Controls select and replay advisory
 * records in memory; callbacks receive frozen inspection snapshots only.
 */
export function createNeuralMeshConsole({
  documentRoot = globalThis.document,
  projection = null,
  onSelect = null,
  onAgent = null,
  onIntent = null,
  onProposal = null,
  onRelationship = null,
  onAncestry = null,
  onReplay = null,
  onReset = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Neural Mesh console needs a document-like owner");
  const panel = documentRoot.getElementById("neural-mesh-console");
  const closeButton = documentRoot.getElementById("neural-mesh-close");
  const replayButton = documentRoot.getElementById("neural-mesh-replay");
  const resetButton = documentRoot.getElementById("neural-mesh-reset");
  const statusEl = documentRoot.getElementById("neural-mesh-status");
  const summaryEl = documentRoot.getElementById("neural-mesh-summary");
  const currentEl = documentRoot.getElementById("neural-mesh-current");
  const agentsEl = documentRoot.getElementById("neural-mesh-agents");
  const intentsEl = documentRoot.getElementById("neural-mesh-intents");
  const proposalsEl = documentRoot.getElementById("neural-mesh-proposals");
  const relationshipsEl = documentRoot.getElementById("neural-mesh-relationships");
  const ancestryEl = documentRoot.getElementById("neural-mesh-ancestry");
  const traceEl = documentRoot.getElementById("neural-mesh-trace");
  const boundaryEl = documentRoot.getElementById("neural-mesh-boundary");
  if (!panel || !closeButton || !replayButton || !resetButton || !statusEl || !summaryEl || !currentEl
    || !agentsEl || !intentsEl || !proposalsEl || !relationshipsEl || !ancestryEl || !traceEl) {
    throw new Error("Neural Mesh console mount points are missing");
  }

  let summary = summarizeNeuralMesh(projection);
  let selectedType = inferType(summary, summary.records[0]?.id) ?? "agent";
  let selectedId = summary[selectedType]?.[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let trace = [];

  function selectedRecord() {
    return listForType(summary, selectedType).find((record) => record.id === selectedId)
      ?? summary.records[0]
      ?? null;
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
      advisoryOnly: true,
      externalNetwork: false,
      providerAccess: false,
      toolAccess: false,
      executable: false,
    }), ...trace].slice(0, 12);
  }

  function renderSummary() {
    summaryEl.replaceChildren();
    [
      [summary.agentCount, "agents"],
      [summary.intentCount, "intents"],
      [summary.proposalCount, "proposals"],
      [summary.relationshipCount + summary.ancestryCount, "declared links"],
    ].forEach(([value, label]) => {
      const metric = documentRoot.createElement("div");
      metric.className = "neural-mesh-metric";
      metric.append(
        createText(documentRoot, "b", "neural-mesh-metric-value", value),
        createText(documentRoot, "span", "neural-mesh-metric-label", label),
      );
      summaryEl.appendChild(metric);
    });
  }

  function recordButton(record, type) {
    const button = documentRoot.createElement("button");
    button.type = "button";
    button.className = `neural-mesh-record neural-mesh-${type}`;
    button.dataset.recordId = record.id;
    button.dataset[`${type}Id`] = record.id;
    button.setAttribute("aria-pressed", String(type === selectedType && record.id === selectedId));
    let meta;
    if (type === "agent") meta = `${record.role} · advisory only`;
    else if (type === "intent") meta = `${record.agentLabel} · no execution`;
    else if (type === "proposal") meta = `${record.intentSummary} · ${record.status} · human decision`;
    else if (type === "relationship") meta = `${record.relationship} · declared local link`;
    else meta = `${record.basis} · declared local map`;
    button.append(
      createText(documentRoot, "strong", "neural-mesh-record-title", record.displayLabel),
      createText(documentRoot, "span", "neural-mesh-record-meta", meta),
    );
    button.addEventListener("click", () => selectRecord(record.id, type, "button"));
    return button;
  }

  function renderStage(element, records, type, emptyCopy) {
    element.replaceChildren();
    if (!records.length) {
      element.appendChild(createText(documentRoot, "div", "neural-mesh-empty", emptyCopy));
      return;
    }
    records.forEach((record) => element.appendChild(recordButton(record, type)));
  }

  function renderCurrent() {
    const record = selectedRecord();
    if (!record) currentEl.textContent = "NO ADVISORY RECORDS";
    else if (selectedType === "agent") currentEl.textContent = `${record.displayLabel} · ${text(record.role).toUpperCase()} · ADVISORY ONLY`;
    else if (selectedType === "intent") currentEl.textContent = `${record.agentLabel} · ${record.summary} · INTENT · NO EXECUTION`;
    else if (selectedType === "proposal") currentEl.textContent = `${record.summary} · ${text(record.status).toUpperCase()} · HUMAN DECISION REQUIRED`;
    else if (selectedType === "relationship") currentEl.textContent = `${record.fromLabel} → ${record.toLabel} · ${text(record.relationship).toUpperCase()} · ADVISORY LINK`;
    else currentEl.textContent = `${record.ancestorLabel} → ${record.descendantLabel} · ${record.basis} · DECLARED MAP`;
    statusEl.textContent = trace.length
      ? `READY · ${trace.length} LOCAL INSPECTION${trace.length === 1 ? "" : "S"} · NO EXECUTION`
      : "READY · CONTROL TOWER → ORACLE · INTENT → PROPOSAL · LOCAL ONLY";
    replayButton.disabled = !record;
    resetButton.disabled = trace.length === 0 && selectedId === (summary.records[0]?.id ?? null);
    if (boundaryEl) boundaryEl.textContent = summary.boundary;
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(createText(documentRoot, "div", "neural-mesh-empty", "No local inspection yet. Select Control Tower, Oracle, an intent, or its proposal."));
      return;
    }
    trace.forEach((entry, index) => traceEl.appendChild(createText(
      documentRoot,
      "div",
      "neural-mesh-trace-row",
      `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.recordId ?? "all records"} · LOCAL ONLY`,
    )));
  }

  function render() {
    renderSummary();
    renderStage(agentsEl, summary.agents, "agent", "No advisory agents are projected.");
    renderStage(intentsEl, summary.intents, "intent", "No advisory intents are projected.");
    renderStage(proposalsEl, summary.proposals, "proposal", "No advisory proposals are projected.");
    renderStage(relationshipsEl, summary.relationships, "relationship", "No agent relationships are projected.");
    renderStage(ancestryEl, summary.ancestry, "ancestry", "No declared ancestry links are projected.");
    renderCurrent();
    renderTrace();
  }

  function selectRecord(recordId, typeOrMethod = "button", maybeMethod = "button") {
    const type = RECORD_TYPES.includes(typeOrMethod) ? typeOrMethod : inferType(summary, recordId);
    const method = RECORD_TYPES.includes(typeOrMethod) ? maybeMethod : typeOrMethod;
    if (!type) return null;
    const record = listForType(summary, type).find((candidate) => candidate.id === recordId);
    if (!record) return null;
    selectedType = type;
    selectedId = record.id;
    const snapshot = deepFreeze({
      source: NEURAL_MESH_CONSOLE_SOURCE,
      action: "select",
      method,
      recordType: type,
      recordId: record.id,
      record,
      summary,
      localOnly: true,
      simulation: true,
      advisoryOnly: true,
      externalNetwork: false,
      providerAccess: false,
      toolAccess: false,
      executable: false,
    });
    pushTrace({ action: "select", recordId: record.id, recordType: type });
    render();
    onSelect?.(snapshot);
    const callbacks = { agent: onAgent, intent: onIntent, proposal: onProposal, relationship: onRelationship, ancestry: onAncestry };
    const callback = callbacks[type];
    if (callback && callback !== onSelect) callback(snapshot);
    return snapshot;
  }

  function replay(method = "button") {
    const record = selectedRecord();
    const linked = linkedReplay(summary, selectedType, record);
    const snapshot = deepFreeze({
      source: NEURAL_MESH_CONSOLE_SOURCE,
      action: "replay",
      method,
      recordType: selectedType,
      recordId: record?.id ?? null,
      record,
      sequence: linked.sequence,
      sequenceTypes: linked.sequenceTypes,
      replayedRecordCount: summary.recordCount,
      summary,
      localOnly: true,
      simulation: true,
      advisoryOnly: true,
      externalNetwork: false,
      providerAccess: false,
      toolAccess: false,
      executable: false,
    });
    pushTrace({ action: "replay", recordId: record?.id ?? null, recordType: selectedType });
    render();
    onReplay?.(snapshot);
    return snapshot;
  }

  function reset(method = "button") {
    selectedType = inferType(summary, summary.records[0]?.id) ?? "agent";
    selectedId = summary[selectedType]?.[0]?.id ?? null;
    trace = [];
    const snapshot = deepFreeze({
      source: NEURAL_MESH_CONSOLE_SOURCE,
      action: "reset",
      method,
      recordType: selectedType,
      recordId: selectedId,
      summary,
      localOnly: true,
      simulation: true,
      advisoryOnly: true,
      externalNetwork: false,
      providerAccess: false,
      toolAccess: false,
      executable: false,
    });
    render();
    onReset?.(snapshot);
    return snapshot;
  }

  function syncProjection(nextProjection) {
    summary = summarizeNeuralMesh(nextProjection);
    if (!listForType(summary, selectedType).some((record) => record.id === selectedId)) {
      selectedType = inferType(summary, summary.records[0]?.id) ?? "agent";
      selectedId = summary[selectedType]?.[0]?.id ?? null;
    }
    render();
    return getSnapshot();
  }

  function getSnapshot() {
    return deepFreeze({
      source: NEURAL_MESH_CONSOLE_SOURCE,
      summary,
      selectedType,
      selectedId,
      selectedRecord: selectedRecord(),
      opened,
      trace,
      localOnly: true,
      simulation: true,
      advisoryOnly: true,
      externalNetwork: false,
      providerAccess: false,
      toolAccess: false,
      executable: false,
      boundary: summary.boundary,
    });
  }

  closeButton.addEventListener("click", () => setOpen(false));
  replayButton.addEventListener("click", () => replay("button"));
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
    selectRecord,
    selectAgent: (id, method) => selectRecord(id, "agent", method),
    selectIntent: (id, method) => selectRecord(id, "intent", method),
    selectProposal: (id, method) => selectRecord(id, "proposal", method),
    selectRelationship: (id, method) => selectRecord(id, "relationship", method),
    selectAncestry: (id, method) => selectRecord(id, "ancestry", method),
    replay,
    reset,
    syncProjection,
    setProjection: syncProjection,
    getSnapshot,
    destroy: () => {},
  });
}

export const createNeuralMeshLayer = createNeuralMeshConsole;
export const createNeuralMeshRenderer = createNeuralMeshConsole;
export const createNeuralMeshAgentsConsole = createNeuralMeshConsole;
export default createNeuralMeshConsole;
