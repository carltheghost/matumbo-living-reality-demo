import {
  CONTRACT_ATELIER_BOUNDARY,
  CONTRACT_ATELIER_CONSOLE_SOURCE,
  CONTRACT_ATELIER_STAKE_UNIT,
  createContractAtelier,
  describeContractLogic,
} from "../domains/contract-atelier.js";

export { CONTRACT_ATELIER_CONSOLE_SOURCE };
export const CONTRACT_ATELIER_RENDER_SOURCE = CONTRACT_ATELIER_CONSOLE_SOURCE;

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

function kvRow(documentRoot, key, value) {
  const row = element(documentRoot, "div", "contract-atelier-kv");
  row.append(element(documentRoot, "span", "contract-atelier-kv-name", key));
  row.append(element(documentRoot, "span", "contract-atelier-kv-value", value));
  return row;
}

function parseOutcomes(raw) {
  return String(raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseFacts(raw) {
  const facts = {};
  String(raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .forEach((entry) => {
      const [name, rawValue] = entry.split("=").map((part) => part.trim());
      if (!name) return;
      const normalized = String(rawValue ?? "").toLowerCase();
      facts[name] = normalized === "true" || normalized === "1" || normalized === "yes";
    });
  return facts;
}

function buildLogic(kind, propA, propB, propC) {
  const a = String(propA ?? "").trim();
  const b = String(propB ?? "").trim();
  const c = String(propC ?? "").trim();
  if (kind === "and" || kind === "or") return { kind, conditions: [a, b] };
  if (kind === "if_else") return { kind, if: a, then: b, else: c };
  return a;
}

export function createContractAtelierConsole({
  documentRoot = globalThis.document,
  atelier = null,
  onSelect = null,
  onReplay = null,
  onReset = null,
} = {}) {
  const panel = documentRoot?.getElementById?.("contract-atelier-console");
  const closeButton = documentRoot?.getElementById?.("contract-atelier-close");
  const statusEl = documentRoot?.getElementById?.("contract-atelier-status");
  const listEl = documentRoot?.getElementById?.("contract-atelier-list");
  const detailEl = documentRoot?.getElementById?.("contract-atelier-detail");
  const typeInput = documentRoot?.getElementById?.("contract-atelier-type");
  const roleInput = documentRoot?.getElementById?.("contract-atelier-role");
  const topicInput = documentRoot?.getElementById?.("contract-atelier-topic");
  const titleInput = documentRoot?.getElementById?.("contract-atelier-title-input");
  const logicKindInput = documentRoot?.getElementById?.("contract-atelier-logic-kind");
  const propAInput = documentRoot?.getElementById?.("contract-atelier-prop-a");
  const propBInput = documentRoot?.getElementById?.("contract-atelier-prop-b");
  const propCInput = documentRoot?.getElementById?.("contract-atelier-prop-c");
  const outcomesInput = documentRoot?.getElementById?.("contract-atelier-outcomes");
  const createButton = documentRoot?.getElementById?.("contract-atelier-create");
  const resetButton = documentRoot?.getElementById?.("contract-atelier-reset");
  const traceEl = documentRoot?.getElementById?.("contract-atelier-trace");
  const boundaryEl = documentRoot?.getElementById?.("contract-atelier-boundary");
  if (!panel || !closeButton || !statusEl || !listEl || !detailEl || !typeInput
    || !roleInput || !topicInput || !titleInput || !logicKindInput || !propAInput
    || !propBInput || !propCInput || !outcomesInput || !createButton || !resetButton
    || !traceEl || !boundaryEl) {
    throw new Error("Contract Atelier console mount points are missing");
  }

  const studio = atelier ?? createContractAtelier();
  let opened = panel.hidden !== true;
  let selectedId = null;

  function snapshot(action = "read", method = "api") {
    return deepFreeze({
      source: CONTRACT_ATELIER_CONSOLE_SOURCE,
      action,
      method,
      opened,
      selectedId,
      atelier: studio.getSnapshot(),
      localOnly: true,
      simulation: true,
      persistence: false,
      wallet: false,
      chain: false,
      settlement: false,
      realMoney: false,
      wagering: false,
      externalNetwork: false,
      executable: false,
      boundary: CONTRACT_ATELIER_BOUNDARY,
    });
  }

  function publish(action, method) {
    const next = snapshot(action, method);
    // onSelect doubles as the "state changed" channel: create/stake/resolve
    // have no dedicated callbacks, so their snapshots ride along here too.
    if (action === "select" || action === "create" || action === "stake" || action === "resolve") onSelect?.(next);
    if (action === "replay") onReplay?.(next);
    if (action === "reset") onReset?.(next);
    return next;
  }

  function renderDetail() {
    detailEl.replaceChildren();
    const contract = selectedId ? studio.get(selectedId) : null;
    if (!contract) {
      detailEl.append(element(documentRoot, "div", "contract-atelier-empty", "Select a contract to stake on it or resolve it."));
      return;
    }
    const card = element(documentRoot, "div", "contract-atelier-card");
    card.append(element(documentRoot, "div", "contract-atelier-card-id", contract.id));
    card.append(element(documentRoot, "strong", "contract-atelier-card-name", contract.title));
    card.append(element(documentRoot, "div", "contract-atelier-card-meta",
      `${contract.type.toUpperCase()} · ${contract.role.toUpperCase()} · ${contract.topic.toUpperCase()} · ${contract.status.toUpperCase()}`));
    card.append(kvRow(documentRoot, "LOGIC", describeContractLogic(contract.logic)));
    card.append(kvRow(documentRoot, "OUTCOMES", contract.outcomes.join(" · ")));
    const total = contract.stakes.reduce((sum, stake) => sum + stake.amount, 0);
    card.append(kvRow(documentRoot, "STAKED", `${Math.round(total * 100) / 100} ${CONTRACT_ATELIER_STAKE_UNIT}`));

    if (contract.stakes.length) {
      const stakes = element(documentRoot, "div", "contract-atelier-stakes");
      stakes.append(element(documentRoot, "div", "contract-atelier-section-label", "REHEARSAL STAKES"));
      contract.stakes.forEach((stake) => {
        stakes.append(element(documentRoot, "div", "contract-atelier-stake-row",
          `${stake.side} · ${stake.amount} ${CONTRACT_ATELIER_STAKE_UNIT} · ${stake.at}`));
      });
      card.append(stakes);
    }

    if (contract.status === "open") {
      const stakeBox = element(documentRoot, "div", "contract-atelier-box");
      stakeBox.append(element(documentRoot, "div", "contract-atelier-section-label", "PLACE A REHEARSAL STAKE"));
      const sideSelect = element(documentRoot, "select", "contract-atelier-select-input");
      sideSelect.id = "contract-atelier-stake-side";
      contract.outcomes.forEach((outcome) => {
        const option = element(documentRoot, "option", null, outcome);
        option.value = outcome;
        sideSelect.append(option);
      });
      const amountInput = element(documentRoot, "input", "contract-atelier-text-input");
      amountInput.id = "contract-atelier-stake-amount";
      amountInput.type = "number";
      amountInput.min = "1";
      amountInput.placeholder = `Amount (${CONTRACT_ATELIER_STAKE_UNIT})`;
      const stakeButton = element(documentRoot, "button", "contract-atelier-action", "Stake (fictional)");
      stakeButton.type = "button";
      stakeButton.id = "contract-atelier-stake";
      stakeButton.addEventListener("click", () => {
        try {
          studio.placeStake({ contractId: contract.id, side: sideSelect.value, amount: amountInput.value });
          statusEl.textContent = `STAKED · ${sideSelect.value} · FICTIONAL ONLY`;
          amountInput.value = "";
        } catch (error) {
          statusEl.textContent = `STAKE BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
        }
        render();
        publish("stake", "button");
      });
      stakeBox.append(sideSelect, amountInput, stakeButton);
      card.append(stakeBox);

      const resolveBox = element(documentRoot, "div", "contract-atelier-box");
      resolveBox.append(element(documentRoot, "div", "contract-atelier-section-label", "RESOLVE (HOUSE / CREATOR REHEARSAL)"));
      resolveBox.append(element(documentRoot, "div", "contract-atelier-hint",
        "Resolution needs facts that satisfy this contract's logic conditions. Multi-outcome contracts also need a winning outcome named from the list above."));
      const factsInput = element(documentRoot, "input", "contract-atelier-text-input");
      factsInput.id = "contract-atelier-facts";
      factsInput.type = "text";
      factsInput.placeholder = "Facts: rain before 15:00=true, quorum met=false";
      resolveBox.append(factsInput);
      let winnerInput = null;
      if (contract.type === "multi") {
        winnerInput = element(documentRoot, "input", "contract-atelier-text-input");
        winnerInput.id = "contract-atelier-winner";
        winnerInput.type = "text";
        winnerInput.placeholder = `Winning outcome (${contract.outcomes.join(" / ")})`;
        resolveBox.append(winnerInput);
      }
      const resolveButton = element(documentRoot, "button", "contract-atelier-action", "Resolve contract");
      resolveButton.type = "button";
      resolveButton.id = "contract-atelier-resolve";
      resolveButton.addEventListener("click", () => {
        try {
          const resolved = studio.resolveContract({
            contractId: contract.id,
            facts: parseFacts(factsInput.value),
            winner: winnerInput ? winnerInput.value : null,
          });
          statusEl.textContent = `RESOLVED · WINNER: ${resolved.resolution.winningSide} · REHEARSAL ONLY`;
        } catch (error) {
          statusEl.textContent = `RESOLVE BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
        }
        render();
        publish("resolve", "button");
      });
      resolveBox.append(resolveButton);
      card.append(resolveBox);
    } else if (contract.resolution) {
      const resolution = element(documentRoot, "div", "contract-atelier-resolution");
      resolution.append(element(documentRoot, "div", "contract-atelier-section-label", "REHEARSAL RESOLUTION"));
      resolution.append(kvRow(documentRoot, "WINNER", contract.resolution.winningSide));
      resolution.append(kvRow(documentRoot, "TOTAL STAKED", `${contract.resolution.totalStaked} ${CONTRACT_ATELIER_STAKE_UNIT}`));
      contract.resolution.payouts.forEach((payout) => {
        resolution.append(element(documentRoot, "div", "contract-atelier-payout-row",
          `${payout.side} · ${payout.amount} ${payout.unit} · ${payout.stakeId}`));
      });
      resolution.append(element(documentRoot, "div", "contract-atelier-resolution-note", contract.resolution.note));
      card.append(resolution);
    }

    detailEl.append(card);
  }

  function render() {
    const state = studio.getSnapshot();
    statusEl.textContent = `${state.open} OPEN · ${state.resolved} RESOLVED · ${CONTRACT_ATELIER_STAKE_UNIT.toUpperCase()} ONLY`;
    listEl.replaceChildren();
    studio.list().forEach((contract) => {
      const button = element(documentRoot, "button", "contract-atelier-item");
      button.type = "button";
      button.setAttribute("aria-pressed", String(contract.id === selectedId));
      button.append(
        element(documentRoot, "strong", "contract-atelier-item-name", contract.title),
        element(documentRoot, "span", "contract-atelier-item-meta",
          `${contract.type.toUpperCase()} · ${contract.role.toUpperCase()} · ${contract.topic.toUpperCase()} · ${contract.status.toUpperCase()}`),
        element(documentRoot, "span", "contract-atelier-item-id", contract.id),
      );
      button.addEventListener("click", () => {
        selectedId = contract.id;
        render();
        publish("select", "button");
      });
      listEl.append(button);
    });
    renderDetail();
    traceEl.replaceChildren();
    if (!state.trace.length) traceEl.append(element(documentRoot, "div", "contract-atelier-empty", "No contract actions yet."));
    [...state.trace].reverse().forEach((entry) => {
      traceEl.append(element(documentRoot, "div", "contract-atelier-trace-row",
        `${entry.seq} · ${entry.action.toUpperCase()} · ${entry.detail || entry.contractId}`));
    });
    boundaryEl.textContent = CONTRACT_ATELIER_BOUNDARY;
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.setAttribute("aria-hidden", String(!opened));
    if (opened) render();
    return publish(opened ? "open" : "close", method);
  }

  createButton.addEventListener("click", () => {
    try {
      // A blank Outcomes field means "use the domain default" (binary → YES, NO);
      // parseOutcomes("") would yield [] and the domain rejects empty arrays.
      const parsedOutcomes = parseOutcomes(outcomesInput.value);
      const contract = studio.createContract({
        type: typeInput.value,
        role: roleInput.value,
        topic: topicInput.value,
        title: titleInput.value,
        logic: buildLogic(logicKindInput.value, propAInput.value, propBInput.value, propCInput.value),
        outcomes: parsedOutcomes.length ? parsedOutcomes : null,
      });
      selectedId = contract.id;
      titleInput.value = "";
      propAInput.value = "";
      propBInput.value = "";
      propCInput.value = "";
      outcomesInput.value = "";
      statusEl.textContent = `OPENED · ${contract.title.toUpperCase()} · FICTIONAL ONLY`;
    } catch (error) {
      statusEl.textContent = `CREATE BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
    }
    render();
    publish("create", "button");
  });

  closeButton.addEventListener("click", () => setOpen(false, "button"));
  resetButton.addEventListener("click", () => {
    studio.reset();
    selectedId = null;
    statusEl.textContent = "ATELIER RESET · STARTER SET RESTORED · LOCAL SESSION";
    render();
    publish("reset", "button");
  });
  render();

  return Object.freeze({
    open: (method = "api") => setOpen(true, method),
    close: (method = "api") => setOpen(false, method),
    reset: (method = "api") => { studio.reset(); selectedId = null; render(); return publish("reset", method); },
    select: (contractId, method = "api") => { selectedId = contractId; render(); return publish("select", method); },
    create: (input, method = "api") => {
      const contract = studio.createContract(input);
      selectedId = contract.id;
      render();
      return publish("create", method);
    },
    stake: (input, method = "api") => {
      const stake = studio.placeStake(input);
      render();
      return publish("stake", method);
    },
    resolve: (input, method = "api") => {
      const contract = studio.resolveContract(input);
      render();
      return publish("resolve", method);
    },
    replay: (method = "api") => publish("replay", method),
    getSnapshot: () => snapshot(),
    boundary: CONTRACT_ATELIER_BOUNDARY,
  });
}

export default createContractAtelierConsole;
