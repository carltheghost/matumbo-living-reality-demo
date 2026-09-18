/**
 * White Paper console — the living document as a DOM surface.
 *
 * Academy pattern: open/close/replay/getSnapshot. DOM-only, zero WebGL.
 * Read-only: feature rows navigate via onSelect; nothing here mutates
 * system state. Sections re-compose from the live projection envelope every
 * time the paper opens or refreshes; missing contributions render as
 * "not yet live" instead of breaking.
 */
import {
  WHITE_PAPER_BOUNDARY,
  WHITE_PAPER_CONSOLE_SOURCE,
  createWhitePaperDocument,
} from "../domains/white-paper.js";

export { WHITE_PAPER_CONSOLE_SOURCE };

const deepFreeze = (value) => {
  if (Array.isArray(value)) value.forEach(deepFreeze);
  else if (value && typeof value === "object") Object.values(value).forEach(deepFreeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

function element(documentRoot, tag, className, value) {
  const node = documentRoot.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}

function sectionShell(documentRoot, section) {
  const wrap = element(documentRoot, "section", "white-paper-section");
  wrap.append(element(documentRoot, "h3", "white-paper-section-title", section.title));
  const badge = element(
    documentRoot,
    "span",
    `white-paper-badge white-paper-badge-${section.kind}`,
    section.kind === "frozen" ? "FROZEN TEXT" : section.status === "live" ? "LIVE" : "NOT YET LIVE",
  );
  wrap.append(badge);
  return wrap;
}

export function createWhitePaperConsole({
  documentRoot = globalThis.document,
  getEnvelope = () => null,
  getFeatures = () => [],
  onSelect = null,
  onReplay = null,
} = {}) {
  const panel = documentRoot?.getElementById?.("white-paper-console");
  const closeButton = documentRoot?.getElementById?.("white-paper-close");
  const statusEl = documentRoot?.getElementById?.("white-paper-status");
  const documentEl = documentRoot?.getElementById?.("white-paper-document");
  const refreshButton = documentRoot?.getElementById?.("white-paper-refresh");
  const boundaryEl = documentRoot?.getElementById?.("white-paper-boundary");
  if (!panel || !closeButton || !statusEl || !documentEl || !refreshButton || !boundaryEl) {
    throw new Error("White Paper console mount points are missing");
  }

  let opened = panel.hidden !== true;
  let lastDocument = null;

  function compose() {
    lastDocument = createWhitePaperDocument({
      envelope: getEnvelope(),
      features: getFeatures(),
    });
    return lastDocument;
  }

  function snapshot(action = "read", method = "api") {
    return deepFreeze({
      source: WHITE_PAPER_CONSOLE_SOURCE,
      action,
      method,
      opened,
      sectionCount: lastDocument?.sectionCount ?? 0,
      liveSectionCount: lastDocument?.liveSectionCount ?? 0,
      generatedFrom: lastDocument?.generatedFrom ?? null,
      localOnly: true,
      simulation: true,
      readOnly: true,
      persistence: false,
      wallet: false,
      chain: false,
      settlement: false,
      realMoney: false,
      wagering: false,
      externalNetwork: false,
      executable: false,
      boundary: WHITE_PAPER_BOUNDARY,
    });
  }

  function publish(action, method) {
    const next = snapshot(action, method);
    if (action === "replay") onReplay?.(next);
    return next;
  }

  function renderVision(wrap, section) {
    wrap.append(element(documentRoot, "p", "white-paper-body", section.body));
  }

  function renderFeatures(wrap, section) {
    wrap.append(element(
      documentRoot, "p", "white-paper-body",
      `${section.count} navigable systems · statuses are live from this session's projection.`,
    ));
    const list = element(documentRoot, "div", "white-paper-feature-list");
    list.setAttribute("role", "list");
    section.features.forEach((feature) => {
      const button = element(documentRoot, "button", "white-paper-feature");
      button.type = "button";
      button.setAttribute("role", "listitem");
      button.append(
        element(documentRoot, "strong", "white-paper-feature-label", feature.label),
        element(documentRoot, "span", "white-paper-feature-kicker", feature.kicker || feature.id),
      );
      button.setAttribute("title", feature.description || feature.label);
      button.addEventListener("click", () => {
        onSelect?.(feature.id, "white-paper");
      });
      list.append(button);
    });
    wrap.append(list);
  }

  function renderNeuralMesh(wrap, section) {
    const summary = `${section.agents.length} agents · ${section.intentCount} intents · ${section.proposalCount} proposals · ${section.relationshipCount} relationships · ${section.ancestryCount} ancestry links`;
    wrap.append(element(documentRoot, "p", "white-paper-body", summary));
    const list = element(documentRoot, "ul", "white-paper-list");
    section.agents.forEach((agent) => {
      list.append(element(documentRoot, "li", null, `${agent.label} — ${agent.role}`));
    });
    wrap.append(list);
    if (section.asOf) wrap.append(element(documentRoot, "p", "white-paper-asof", `Projection as of ${section.asOf}`));
  }

  function renderContractsLedger(wrap, section) {
    if (section.contracts) {
      const contracts = section.contracts;
      wrap.append(element(
        documentRoot, "p", "white-paper-body",
        `Contract Atelier: ${contracts.open} open · ${contracts.resolved} resolved (rehearsal credits, zero real value).`,
      ));
      const list = element(documentRoot, "ul", "white-paper-list");
      contracts.contracts.slice(0, 8).forEach((contract) => {
        list.append(element(
          documentRoot, "li", null,
          `${contract.title} — ${contract.type} · ${contract.role} · ${contract.status}`,
        ));
      });
      if (contracts.contracts.length > 8) {
        list.append(element(documentRoot, "li", null, `…and ${contracts.contracts.length - 8} more`));
      }
      wrap.append(list);
    }
    if (section.ledger) {
      const ledger = section.ledger;
      wrap.append(element(
        documentRoot, "p", "white-paper-body",
        `Prime Ledger + EchoProof: ${ledger.records.length} journal records · ${ledger.proofCount} proof links · summaries only, not an authoritative ledger.`,
      ));
      const list = element(documentRoot, "ul", "white-paper-list");
      ledger.records.forEach((record) => {
        list.append(element(documentRoot, "li", null, `${record.label} — ${record.status} · ${record.unit}`));
      });
      wrap.append(list);
    }
  }

  function renderRoomsPeople(wrap, section) {
    wrap.append(element(
      documentRoot, "p", "white-paper-body",
      `${section.rooms.length} rooms visible · ${section.membershipCount} memberships (simulated metadata).`,
    ));
    const list = element(documentRoot, "ul", "white-paper-list");
    section.rooms.forEach((room) => {
      list.append(element(documentRoot, "li", null, `${room.label} — ${room.context}`));
    });
    wrap.append(list);
    if (section.person) {
      wrap.append(element(
        documentRoot, "p", "white-paper-body",
        `Person profile projection present · ${section.person.entityCount} entities · local fixture only.`,
      ));
    }
  }

  function renderBoundaries(wrap, section) {
    const list = element(documentRoot, "ul", "white-paper-list white-paper-boundaries");
    section.items.forEach((item) => list.append(element(documentRoot, "li", null, item)));
    wrap.append(list);
  }

  function renderSection(section) {
    const wrap = sectionShell(documentRoot, section);
    if (section.status === "not yet live") {
      wrap.append(element(documentRoot, "p", "white-paper-body white-paper-dim", section.note ?? "Not yet live in this projection."));
      return wrap;
    }
    switch (section.id) {
      case "vision": renderVision(wrap, section); break;
      case "features": renderFeatures(wrap, section); break;
      case "neural-mesh": renderNeuralMesh(wrap, section); break;
      case "contracts-ledger": renderContractsLedger(wrap, section); break;
      case "rooms-people": renderRoomsPeople(wrap, section); break;
      case "boundaries": renderBoundaries(wrap, section); break;
      default: wrap.append(element(documentRoot, "p", "white-paper-body white-paper-dim", "Unknown section."));
    }
    return wrap;
  }

  function render() {
    const document = compose();
    statusEl.textContent = `${document.sectionCount} SECTIONS · ${document.liveSectionCount} LIVE · LOCAL PROJECTION ONLY`;
    documentEl.replaceChildren();
    document.sections.forEach((section) => documentEl.append(renderSection(section)));
    boundaryEl.textContent = WHITE_PAPER_BOUNDARY;
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.setAttribute("aria-hidden", String(!opened));
    if (opened) render();
    return publish(opened ? "open" : "close", method);
  }

  closeButton.addEventListener("click", () => setOpen(false, "button"));
  refreshButton.addEventListener("click", () => {
    render();
    publish("refresh", "button");
  });
  render();

  return Object.freeze({
    open: (method = "api") => setOpen(true, method),
    close: (method = "api") => setOpen(false, method),
    refresh: (method = "api") => { render(); return publish("refresh", method); },
    select: (featureId, method = "api") => { onSelect?.(featureId, method); return publish("select", method); },
    replay: (method = "api") => publish("replay", method),
    getSnapshot: () => snapshot(),
    getDocument: () => lastDocument,
    boundary: WHITE_PAPER_BOUNDARY,
  });
}

export default createWhitePaperConsole;
