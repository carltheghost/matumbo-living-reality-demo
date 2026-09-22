import {
  CONTRACT_ATELIER_BOUNDARY,
  CONTRACT_ATELIER_CONSOLE_SOURCE,
  CONTRACT_ATELIER_STAKE_UNIT,
  createContractAtelier,
  describeContractLogic,
} from "../domains/contract-atelier.js?v=20260922-cache2";
import {
  OUTCOME_CONTRACTS_BOUNDARY,
  OUTCOME_CONTRACTS_NO_VALUE,
  OUTCOME_RESULT_DRAW,
  OUTCOME_RESULT_VOID,
  OUTCOME_STAKE_UNIT,
  createOutcomeContracts,
} from "../domains/outcome-contracts.js?v=20260922-cache2";
// Display order for "Contracts for your review": readiness-ranked by the
// TypeSafe judgment integration. Order only — approve/edit/dismiss behavior
// is untouched. Import is additive; bot-plaza.js has no renderer imports,
// so there is no cycle.
import { rankProposalsForReview } from "../domains/bot-plaza.js?v=20260922-cache2";

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
  relicVault = null,
  onSelect = null,
  onReplay = null,
  onReset = null,
  proposalQueue = null,
  outcomeDesk = null,
  // Integration seam (Reality Lens Ω contract flow): called with
  // { contract, proposal } right after a review approval opens the book.
  // Never allowed to break approval — failures are swallowed with a warning.
  onContractApproved = null,
  // Integration seam: async () => { proposals, drafts, errors } that scans
  // ESPN for upcoming games and queues auto-drafts for review. When wired,
  // a "scan upcoming games" control appears in the review section.
  onScanRequested = null,
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
  const reviewEl = documentRoot?.getElementById?.("contract-atelier-review");
  if (!panel || !closeButton || !statusEl || !listEl || !detailEl || !typeInput
    || !roleInput || !topicInput || !titleInput || !logicKindInput || !propAInput
    || !propBInput || !propCInput || !outcomesInput || !createButton || !resetButton
    || !traceEl || !boundaryEl || !reviewEl) {
    throw new Error("Contract Atelier console mount points are missing");
  }

  const studio = atelier ?? createContractAtelier();
  let opened = panel.hidden !== true;
  let selectedId = null;

  function snapshot(action = "read", method = "api") {
    const review = proposalQueue ? readReviewQueue() : null;
    return deepFreeze({
      source: CONTRACT_ATELIER_CONSOLE_SOURCE,
      action,
      method,
      opened,
      selectedId,
      atelier: studio.getSnapshot(),
      outcomes: deskSnapshot(),
      reviewQueue: review ? { wired: true, pending: review.pending.length, decided: review.decided.length } : null,
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
    if (action === "select" || action === "create" || action === "stake" || action === "resolve"
      || action === "outcome-select" || action === "outcome-create" || action === "outcome-join"
      || action === "outcome-grade" || action === "outcome-claim" || action === "outcome-transfer"
      || action === "review-approve" || action === "review-edit" || action === "review-dismiss") onSelect?.(next);
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
    renderReview();
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

  // ---- Outcome contracts · eternal escrow (the lifecycle after creation) ----
  // Place a contract on an event and walk away: grading is automatic and
  // deterministic, wins never expire and never decay, awards ride as local
  // simulated NFTs whose claim follows the holder.
  //
  // Part 3b: the desk may be injected as a shared instance (main.js wires
  // one). The injected desk is either the hardened lifecycle desk
  // (draft → open → locked → graded → settled → claimed, idempotent joins /
  // grades / claims, claim/transferNft) or the classic rehearsal desk
  // (claimAward/transferAward, get/listNfts). The adapters below call
  // whichever surface exists so the console works with either.
  const outcomesStudio = outcomeDesk ?? createOutcomeContracts({ seed: "local-outcomes", relicVault });
  const deskSnapshot = () => outcomesStudio.getSnapshot();
  const deskListContracts = () => outcomesStudio.list();
  const deskGetContract = (id) => (typeof outcomesStudio.getContract === "function"
    ? outcomesStudio.getContract(id) : outcomesStudio.get(id));
  const deskJoinContract = ({ contractId, participant, outcome, stakeAmount }) =>
    outcomesStudio.join({ contractId, participant, outcome, stakeAmount });
  const deskRecordResult = ({ contractId, result }) =>
    outcomesStudio.recordResult({ contractId, result });
  const deskListNfts = () => (typeof outcomesStudio.listNfts === "function" ? outcomesStudio.listNfts() : []);
  const deskGetNft = (nftId) => (typeof outcomesStudio.getNft === "function" ? outcomesStudio.getNft(nftId) : null);
  const deskClaimNft = (nftId) => (typeof outcomesStudio.claim === "function"
    ? outcomesStudio.claim({ nftId }) : outcomesStudio.claimAward({ nftId }));
  const deskTransferNft = (nftId, toHolder) => {
    if (typeof outcomesStudio.transferNft === "function") {
      const current = deskGetNft(nftId);
      return outcomesStudio.transferNft({ nftId, from: current?.holder ?? toHolder, to: toHolder });
    }
    return outcomesStudio.transferAward({ nftId, toHolder });
  };
  const deskReset = () => { if (typeof outcomesStudio.reset === "function") outcomesStudio.reset(); };
  let selectedOutcomeId = null;

  const outcomeSection = element(documentRoot, "div", "contract-atelier-box");
  outcomeSection.append(element(documentRoot, "div", "contract-atelier-section-label", "OUTCOME CONTRACTS · ETERNAL ESCROW"));
  outcomeSection.append(element(documentRoot, "div", "contract-atelier-hint",
    `Place a contract on an event and walk away. Grading is automatic — winners are paid, losers' stakes are taken, nobody needs to be online. Wins never expire and never decay. All stakes and awards are ${OUTCOME_STAKE_UNIT} with zero real value.`));

  const ocEventId = element(documentRoot, "input", "contract-atelier-text-input");
  ocEventId.placeholder = "Event id (e.g. evt:derby-3)";
  const ocEventLabel = element(documentRoot, "input", "contract-atelier-text-input");
  ocEventLabel.placeholder = "Event label (e.g. Derby rematch — who takes it?)";
  const ocOutcomes = element(documentRoot, "input", "contract-atelier-text-input");
  ocOutcomes.placeholder = "Outcomes, comma separated (e.g. HOME, AWAY)";
  const ocCreator = element(documentRoot, "input", "contract-atelier-text-input");
  ocCreator.placeholder = "Creator name";
  const ocCreate = element(documentRoot, "button", "contract-atelier-action", "Open outcome contract");
  ocCreate.type = "button";
  ocCreate.addEventListener("click", () => {
    try {
      const contract = outcomesStudio.createContract({
        eventId: ocEventId.value,
        eventLabel: ocEventLabel.value,
        outcomes: parseOutcomes(ocOutcomes.value),
        creator: ocCreator.value,
        status: "open",
      });
      selectedOutcomeId = contract.id;
      ocEventId.value = "";
      ocEventLabel.value = "";
      ocOutcomes.value = "";
      ocCreator.value = "";
      statusEl.textContent = `OUTCOME BOOK OPEN · ${contract.eventLabel.toUpperCase()} · SIMULATED ONLY`;
    } catch (error) {
      statusEl.textContent = `OUTCOME CREATE BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
    }
    renderOutcomes();
    publish("outcome-create", "button");
  });
  outcomeSection.append(ocEventId, ocEventLabel, ocOutcomes, ocCreator, ocCreate);

  const outcomeListEl = element(documentRoot, "div", "contract-atelier-list");
  const outcomeDetailEl = element(documentRoot, "div", null);
  const outcomeEscrowEl = element(documentRoot, "div", null);
  outcomeSection.append(
    element(documentRoot, "div", "contract-atelier-section-label", "BOOKS"),
    outcomeListEl,
    outcomeDetailEl,
    element(documentRoot, "div", "contract-atelier-section-label", "ETERNAL ESCROW · AWARD NFTS"),
    outcomeEscrowEl,
    element(documentRoot, "div", "contract-atelier-hint", OUTCOME_CONTRACTS_NO_VALUE),
  );

  function renderOutcomeDetail() {
    outcomeDetailEl.replaceChildren();
    const contract = selectedOutcomeId ? deskGetContract(selectedOutcomeId) : null;
    if (!contract) {
      outcomeDetailEl.append(element(documentRoot, "div", "contract-atelier-empty", "Select an outcome book to join it or record its result."));
      return;
    }
    const card = element(documentRoot, "div", "contract-atelier-card");
    card.append(element(documentRoot, "div", "contract-atelier-card-id", contract.id));
    card.append(element(documentRoot, "strong", "contract-atelier-card-name", contract.eventLabel));
    card.append(element(documentRoot, "div", "contract-atelier-card-meta",
      `EVENT ${contract.eventId} · ${contract.status.toUpperCase()}`));
    card.append(kvRow(documentRoot, "OUTCOMES", contract.outcomes.join(" · ")));
    const total = contract.stakes.reduce((sum, stake) => sum + stake.amount, 0);
    card.append(kvRow(documentRoot, "STAKED", `${Math.round(total * 100) / 100} ${OUTCOME_STAKE_UNIT}`));
    if (contract.stakes.length) {
      const stakes = element(documentRoot, "div", "contract-atelier-stakes");
      stakes.append(element(documentRoot, "div", "contract-atelier-section-label", "STAKES (SIMULATED)"));
      contract.stakes.forEach((stake) => {
        stakes.append(element(documentRoot, "div", "contract-atelier-stake-row",
          `${stake.participant} · ${stake.outcome} · ${stake.amount} ${OUTCOME_STAKE_UNIT}`));
      });
      card.append(stakes);
    }
    if (contract.status === "open") {
      const joinBox = element(documentRoot, "div", "contract-atelier-box");
      joinBox.append(element(documentRoot, "div", "contract-atelier-section-label", "JOIN WITH SIMULATED TUMBO POINTS"));
      const whoInput = element(documentRoot, "input", "contract-atelier-text-input");
      whoInput.placeholder = "Your name";
      const sideSelect = element(documentRoot, "select", "contract-atelier-select-input");
      contract.outcomes.forEach((outcome) => {
        const option = element(documentRoot, "option", null, outcome);
        option.value = outcome;
        sideSelect.append(option);
      });
      const amountInput = element(documentRoot, "input", "contract-atelier-text-input");
      amountInput.type = "number";
      amountInput.min = "1";
      amountInput.placeholder = `Amount (${OUTCOME_STAKE_UNIT})`;
      const joinButton = element(documentRoot, "button", "contract-atelier-action", "Join (simulated)");
      joinButton.type = "button";
      joinButton.addEventListener("click", () => {
        try {
          deskJoinContract({ contractId: contract.id, participant: whoInput.value, outcome: sideSelect.value, stakeAmount: amountInput.value });
          statusEl.textContent = `JOINED · ${sideSelect.value} · YOU CAN WALK AWAY · SIMULATED ONLY`;
          whoInput.value = "";
          amountInput.value = "";
        } catch (error) {
          statusEl.textContent = `JOIN BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
        }
        renderOutcomes();
        publish("outcome-join", "button");
      });
      joinBox.append(whoInput, sideSelect, amountInput, joinButton);
      card.append(joinBox);

      const resultBox = element(documentRoot, "div", "contract-atelier-box");
      resultBox.append(element(documentRoot, "div", "contract-atelier-section-label", "EVENT LANDED — RECORD RESULT & GRADE"));
      resultBox.append(element(documentRoot, "div", "contract-atelier-hint",
        "Grading is automatic and deterministic. Winners are paid, losers' stakes are taken — nobody needs to be online."));
      const resultSelect = element(documentRoot, "select", "contract-atelier-select-input");
      [...contract.outcomes, OUTCOME_RESULT_DRAW, OUTCOME_RESULT_VOID].forEach((outcome) => {
        const option = element(documentRoot, "option", null, outcome);
        option.value = outcome;
        resultSelect.append(option);
      });
      const gradeButton = element(documentRoot, "button", "contract-atelier-action", "Record result & grade");
      gradeButton.type = "button";
      gradeButton.addEventListener("click", () => {
        try {
          const graded = deskRecordResult({ contractId: contract.id, result: resultSelect.value });
          statusEl.textContent = `GRADED · ${graded.grading.result} · ${graded.grading.kind.toUpperCase()} · ${graded.grading.escrowIds.length} ESCROWED FOREVER`;
        } catch (error) {
          statusEl.textContent = `GRADE BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
        }
        renderOutcomes();
        publish("outcome-grade", "button");
      });
      resultBox.append(resultSelect, gradeButton);
      card.append(resultBox);
    } else if (contract.grading) {
      const grading = element(documentRoot, "div", "contract-atelier-resolution");
      grading.append(element(documentRoot, "div", "contract-atelier-section-label", "GRADING (AUTOMATIC)"));
      grading.append(kvRow(documentRoot, "RESULT", contract.grading.result));
      grading.append(kvRow(documentRoot, "KIND", contract.grading.kind.toUpperCase()));
      contract.grading.awards.forEach((award) => {
        grading.append(element(documentRoot, "div", "contract-atelier-payout-row",
          `${award.participant} · ${award.amount} ${OUTCOME_STAKE_UNIT} · eternal escrow`));
      });
      grading.append(element(documentRoot, "div", "contract-atelier-resolution-note", contract.grading.note));
      card.append(grading);
    }
    outcomeDetailEl.append(card);
  }

  function renderOutcomeEscrow() {
    outcomeEscrowEl.replaceChildren();
    const nfts = deskListNfts();
    if (!nfts.length) {
      outcomeEscrowEl.append(element(documentRoot, "div", "contract-atelier-empty", "No awards escrowed yet. Grade a book to escrow its awards forever."));
      return;
    }
    nfts.forEach((nft) => {
      const row = element(documentRoot, "div", "contract-atelier-card");
      row.append(kvRow(documentRoot, "AWARD NFT", nft.id));
      row.append(kvRow(documentRoot, "HOLDER", nft.holder));
      row.append(kvRow(documentRoot, "AMOUNT", `${nft.amount} ${OUTCOME_STAKE_UNIT} · ${nft.kind.toUpperCase()}`));
      row.append(kvRow(documentRoot, "STATUS", nft.claimed ? `CLAIMED · ${nft.claimedAt}` : "CLAIMABLE FOREVER · never expires"));
      if (!nft.claimed) {
        const claimButton = element(documentRoot, "button", "contract-atelier-action", "Claim my win");
        claimButton.type = "button";
        claimButton.addEventListener("click", () => {
          try {
            const receipt = deskClaimNft(nft.id);
            const receiptAmount = receipt?.amount ?? nft.amount;
            const receiptHolder = receipt?.holder ?? nft.holder;
            statusEl.textContent = `CLAIMED · ${receiptAmount} ${OUTCOME_STAKE_UNIT} → ${receiptHolder} · SIMULATED ONLY`;
          } catch (error) {
            statusEl.textContent = `CLAIM BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
          }
          renderOutcomes();
          publish("outcome-claim", "button");
        });
        const toInput = element(documentRoot, "input", "contract-atelier-text-input");
        toInput.placeholder = "Transfer award to (name)";
        const transferButton = element(documentRoot, "button", "contract-atelier-action", "Transfer award");
        transferButton.type = "button";
        transferButton.addEventListener("click", () => {
          try {
            const moved = deskTransferNft(nft.id, toInput.value);
            statusEl.textContent = `AWARD MOVED · now held by ${moved?.holder ?? toInput.value} · the claim follows the NFT`;
            toInput.value = "";
          } catch (error) {
            statusEl.textContent = `TRANSFER BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
          }
          renderOutcomes();
          publish("outcome-transfer", "button");
        });
        row.append(claimButton, toInput, transferButton);
      }
      outcomeEscrowEl.append(row);
    });
  }

  function renderOutcomes() {
    outcomeListEl.replaceChildren();
    deskListContracts().forEach((contract) => {
      const button = element(documentRoot, "button", "contract-atelier-item");
      button.type = "button";
      button.setAttribute("aria-pressed", String(contract.id === selectedOutcomeId));
      button.append(
        element(documentRoot, "strong", "contract-atelier-item-name", contract.eventLabel),
        element(documentRoot, "span", "contract-atelier-item-meta",
          `${contract.outcomes.join(" / ")} · ${contract.status.toUpperCase()}`),
        element(documentRoot, "span", "contract-atelier-item-id", contract.id),
      );
      button.addEventListener("click", () => {
        selectedOutcomeId = contract.id;
        renderOutcomes();
        publish("outcome-select", "button");
      });
      outcomeListEl.append(button);
    });
    renderOutcomeDetail();
    renderOutcomeEscrow();
  }

  panel.append(outcomeSection);

  // ---- Contracts for your review: bot proposals brought to Tumbo ----
  // Bots draft outcome contracts and bring them here; nothing executes until
  // Tumbo approves. APPROVE opens the book on the outcome desk (via the
  // injected shared desk when one is wired). EDIT changes the permitted
  // draft fields inline. DISMISS returns the draft to the bot.
  let editingProposalId = null;

  function isEffectivelyExpired(proposal, nowMs) {
    if (!proposal) return false;
    if (proposal.status === "expired") return true;
    if (!proposal.expiresAt) return false;
    const target = new Date(proposal.expiresAt).getTime();
    return Number.isFinite(target) && target <= nowMs;
  }

  function formatExpiry(expiresAt, nowMs) {
    if (!expiresAt) return "no expiry";
    const target = new Date(expiresAt).getTime();
    if (!Number.isFinite(target)) return "no expiry";
    const diff = target - nowMs;
    if (diff <= 0) return "EXPIRED";
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) {
      const rest = mins % 60;
      return `in ${hours}h${rest ? ` ${rest}m` : ""}`;
    }
    return `in ${Math.floor(hours / 24)}d`;
  }

  function formatStakeRange(proposal) {
    const min = proposal.minStake;
    const max = proposal.maxStake;
    if (min === null || min === undefined) {
      if (max === null || max === undefined) return "any stake";
      return `up to ${max} ${OUTCOME_STAKE_UNIT}`;
    }
    if (max === null || max === undefined) return `from ${min} ${OUTCOME_STAKE_UNIT}`;
    return `${min}–${max} ${OUTCOME_STAKE_UNIT}`;
  }

  function readReviewQueue() {
    if (!proposalQueue) return { pending: [], decided: [] };
    const nowMs = Date.now();
    const all = proposalQueue.getProposals();
    const pending = all.filter((proposal) => proposal.status === "pending" && !isEffectivelyExpired(proposal, nowMs));
    // Readiness-ranked display order only (deterministic heuristic; nothing
    // reordered in the queue itself). Falls back to submission order if the
    // ranking ever throws, so the review queue can never go blank.
    let ordered = pending;
    try {
      ordered = rankProposalsForReview(pending, { now: nowMs }).map((entry) => entry.proposal);
    } catch {
      // keep submission order
    }
    return {
      pending: ordered,
      decided: all.filter((proposal) => proposal.status !== "pending" || isEffectivelyExpired(proposal, nowMs)),
    };
  }

  function approveProposal(proposal) {
    try {
      const contract = outcomesStudio.createContract({
        eventId: proposal.eventId ?? proposal.id,
        eventLabel: proposal.eventLabel,
        outcomes: [...(proposal.outcomes ?? [])],
        creator: `bot:${proposal.botName}`,
        status: "open",
      });
      proposalQueue.setProposalStatus(proposal.id, "approved", { by: "user" });
      // Integration seam: freeze the odds quote (if any) at approval and
      // audit the lifecycle. A hook failure must never unwind the approval.
      if (typeof onContractApproved === "function") {
        try {
          onContractApproved({ contract, proposal });
        } catch (hookError) {
          console.warn("[contract-atelier] onContractApproved hook failed", hookError);
        }
      }
      statusEl.textContent = `APPROVED · BOOK OPENED · "${String(proposal.eventLabel).toUpperCase().slice(0, 44)}" · SIMULATED ONLY`;
    } catch (error) {
      // The draft stays pending so Tumbo can fix it and approve again.
      statusEl.textContent = `APPROVE BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
    }
    editingProposalId = null;
    renderReview();
    renderOutcomes();
    publish("review-approve", "button");
  }

  function dismissProposal(proposal) {
    try {
      proposalQueue.dismissProposal(proposal.id, { by: "user" });
      statusEl.textContent = `DISMISSED · "${String(proposal.title).toUpperCase().slice(0, 44)}" RETURNED TO THE BOT`;
    } catch (error) {
      statusEl.textContent = `DISMISS BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
    }
    editingProposalId = null;
    renderReview();
    publish("review-dismiss", "button");
  }

  function reviewEditField(label, placeholder, value) {
    const wrap = element(documentRoot, "label", "contract-atelier-field", label);
    const input = element(documentRoot, "input", "contract-atelier-text-input");
    input.type = "text";
    input.placeholder = placeholder;
    input.value = value ?? "";
    wrap.append(input);
    return input;
  }

  function renderProposalEdit(proposal) {
    const card = element(documentRoot, "div", "contract-atelier-card");
    card.append(element(documentRoot, "div", "contract-atelier-card-id", proposal.id));
    card.append(element(documentRoot, "strong", "contract-atelier-card-name", `Editing: ${proposal.title}`));
    const titleInput = reviewEditField("Title", "Title", proposal.title);
    const eventLabelInput = reviewEditField("Event label", "Event label", proposal.eventLabel);
    const outcomesInput = reviewEditField("Outcomes", "Outcomes (comma-separated)", (proposal.outcomes ?? []).join(", "));
    const minStakeInput = reviewEditField("Min stake", "Min stake (blank = none)", proposal.minStake ?? null);
    const maxStakeInput = reviewEditField("Max stake", "Max stake (blank = none)", proposal.maxStake ?? null);
    const sourceNotesInput = reviewEditField("Source notes", "Source notes", proposal.sourceNotes ?? "");
    const researchNotesInput = reviewEditField("Research notes", "Research notes", proposal.researchNotes ?? "");
    const expiresAtInput = reviewEditField("Expires at", "Expires at (ISO date, blank = none)", proposal.expiresAt ?? "");
    const errorEl = element(documentRoot, "div", "contract-atelier-review-error");
    errorEl.hidden = true;
    const actions = element(documentRoot, "div", "contract-atelier-review-actions");
    const saveButton = element(documentRoot, "button", "contract-atelier-action", "SAVE CHANGES");
    saveButton.type = "button";
    saveButton.addEventListener("click", () => {
      const parseStake = (raw, name) => {
        const text = String(raw ?? "").trim();
        if (!text) return null;
        const value = Number(text);
        if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a non-negative number`);
        return value;
      };
      try {
        proposalQueue.updateProposal(proposal.id, {
          title: titleInput.value,
          eventLabel: eventLabelInput.value,
          outcomes: parseOutcomes(outcomesInput.value),
          minStake: parseStake(minStakeInput.value, "Min stake"),
          maxStake: parseStake(maxStakeInput.value, "Max stake"),
          sourceNotes: sourceNotesInput.value,
          researchNotes: researchNotesInput.value,
          expiresAt: String(expiresAtInput.value ?? "").trim() || null,
        }, { by: "user" });
        editingProposalId = null;
        statusEl.textContent = "DRAFT EDITED · BACK TO PENDING REVIEW";
        renderReview();
        publish("review-edit", "button");
      } catch (error) {
        errorEl.hidden = false;
        errorEl.textContent = `EDIT BLOCKED · ${String(error?.message ?? error).slice(0, 160)}`;
      }
    });
    const cancelButton = element(documentRoot, "button", "contract-atelier-action", "CANCEL");
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => {
      editingProposalId = null;
      renderReview();
    });
    actions.append(saveButton, cancelButton);
    card.append(errorEl, actions);
    return card;
  }

  function renderProposalCard(proposal) {
    const card = element(documentRoot, "div", "contract-atelier-card");
    card.append(element(documentRoot, "div", "contract-atelier-card-id", proposal.id));
    card.append(element(documentRoot, "strong", "contract-atelier-card-name", proposal.title));
    card.append(element(documentRoot, "div", "contract-atelier-card-meta",
      `${proposal.eventLabel} · DRAFTED BY ${proposal.botName}`));
    card.append(kvRow(documentRoot, "OUTCOMES", (proposal.outcomes ?? []).join(" · ") || "—"));
    card.append(kvRow(documentRoot, "STAKE RANGE", formatStakeRange(proposal)));
    card.append(kvRow(documentRoot, "EXPIRES", formatExpiry(proposal.expiresAt, Date.now())));
    if (proposal.sourceNotes) card.append(kvRow(documentRoot, "SOURCES", proposal.sourceNotes));
    if (proposal.researchNotes) card.append(kvRow(documentRoot, "RESEARCH", proposal.researchNotes));
    const actions = element(documentRoot, "div", "contract-atelier-review-actions");
    const approveButton = element(documentRoot, "button", "contract-atelier-action", "APPROVE");
    approveButton.type = "button";
    approveButton.addEventListener("click", () => approveProposal(proposal));
    const editButton = element(documentRoot, "button", "contract-atelier-action", "EDIT");
    editButton.type = "button";
    editButton.addEventListener("click", () => {
      editingProposalId = proposal.id;
      renderReview();
    });
    const dismissButton = element(documentRoot, "button", "contract-atelier-action", "DISMISS");
    dismissButton.type = "button";
    dismissButton.addEventListener("click", () => dismissProposal(proposal));
    actions.append(approveButton, editButton, dismissButton);
    card.append(actions);
    return card;
  }

  function renderReview() {
    reviewEl.replaceChildren();
    reviewEl.append(element(documentRoot, "div", "contract-atelier-section-label", "CONTRACTS FOR YOUR REVIEW"));
    if (!proposalQueue) {
      reviewEl.append(element(documentRoot, "div", "contract-atelier-empty",
        "No proposal queue wired — bots have nowhere to bring contracts yet."));
      return;
    }
    reviewEl.append(element(documentRoot, "div", "contract-atelier-hint",
      `Bots bring outcome contracts here for your call. Nothing executes until you approve — all stakes are ${OUTCOME_STAKE_UNIT} with zero real value.`));
    if (typeof onScanRequested === "function") {
      const scanButton = element(documentRoot, "button", "contract-atelier-scan-button", "SCAN UPCOMING GAMES");
      scanButton.type = "button";
      scanButton.setAttribute("aria-label", "Scan ESPN for upcoming games and draft contracts for review");
      scanButton.addEventListener("click", async () => {
        scanButton.disabled = true;
        statusEl.textContent = "SCANNING ESPN FOR UPCOMING GAMES…";
        try {
          const result = await onScanRequested();
          const count = Array.isArray(result?.proposals) ? result.proposals.length : 0;
          const errors = Array.isArray(result?.errors) ? result.errors.filter(Boolean) : [];
          statusEl.textContent = errors.length
            ? `SCAN PARTIAL · ${count} DRAFT${count === 1 ? "" : "S"} QUEUED · ${errors.length} FEED ISSUE${errors.length === 1 ? "" : "S"} (QUEUE UNAFFECTED)`
            : `SCAN DONE · ${count} DRAFT${count === 1 ? "" : "S"} QUEUED FOR REVIEW`;
        } catch (error) {
          statusEl.textContent = `SCAN FAILED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)} · QUEUE UNAFFECTED`;
        } finally {
          scanButton.disabled = false;
        }
      });
      reviewEl.append(scanButton);
    }
    const { pending, decided } = readReviewQueue();
    if (!pending.length) {
      reviewEl.append(element(documentRoot, "div", "contract-atelier-empty",
        "Nothing waiting. When a bot drafts a contract it will appear here."));
    }
    pending.forEach((proposal) => {
      reviewEl.append(proposal.id === editingProposalId ? renderProposalEdit(proposal) : renderProposalCard(proposal));
    });
    if (decided.length) {
      const details = element(documentRoot, "details", "contract-atelier-review-decided");
      details.append(element(documentRoot, "summary", null, `DECIDED · ${decided.length}`));
      const nowMs = Date.now();
      decided.forEach((proposal) => {
        const label = proposal.status === "pending" && isEffectivelyExpired(proposal, nowMs)
          ? "EXPIRED" : String(proposal.status).toUpperCase();
        details.append(element(documentRoot, "div", "contract-atelier-review-row",
          `${proposal.title} · ${label} · by ${proposal.botName}`));
      });
      reviewEl.append(details);
    }
  }

  let unsubscribeReviewQueue = null;
  if (proposalQueue && typeof proposalQueue.subscribe === "function") {
    unsubscribeReviewQueue = proposalQueue.subscribe(() => {
      if (opened) renderReview();
    });
  }
  void unsubscribeReviewQueue;

  resetButton.addEventListener("click", () => {
    deskReset();
    selectedOutcomeId = null;
    renderOutcomes();
  });
  renderOutcomes();
  renderReview();
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
    reset: (method = "api") => { studio.reset(); selectedId = null; deskReset(); selectedOutcomeId = null; editingProposalId = null; render(); renderOutcomes(); renderReview(); return publish("reset", method); },
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
    getOutcomeSnapshot: () => deskSnapshot(),
    getReviewQueue: () => proposalQueue,
    outcomeBoundary: OUTCOME_CONTRACTS_BOUNDARY,
    boundary: CONTRACT_ATELIER_BOUNDARY,
  });
}

export default createContractAtelierConsole;
