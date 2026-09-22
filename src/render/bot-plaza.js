import {
  BOT_ATELIER_TEMPLATES,
  BOT_AVATARS,
  BOT_CAPABILITIES,
  BOT_PLAZA_BOUNDARY,
  BOT_PLAZA_CONSOLE_SOURCE,
  BOT_WORLD_ACTIONS,
  BOT_WORLD_EVENT_TYPES,
  createBotRegistry,
  createBotRuntime,
  getAtelierTemplate,
  validateAtelierRule,
} from "../domains/bot-plaza.js?v=20260922-cache2";

export { BOT_PLAZA_BOUNDARY, BOT_PLAZA_CONSOLE_SOURCE };
export const BOT_PLAZA_RENDER_SOURCE = BOT_PLAZA_CONSOLE_SOURCE;

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

function avatarFor(documentRoot, avatarId) {
  const spec = BOT_AVATARS.find((entry) => entry.id === avatarId) ?? BOT_AVATARS[0];
  if (spec.kind === "image") {
    const img = documentRoot.createElement("img");
    img.className = "bot-plaza-avatar-img";
    img.src = spec.src;
    img.alt = spec.label;
    return img;
  }
  const orb = element(documentRoot, "span", "bot-plaza-avatar-orb");
  try {
    orb.style.background = `radial-gradient(circle at 35% 35%, ${spec.color}, rgba(2,6,10,.9))`;
    orb.style.boxShadow = `0 0 14px ${spec.color}`;
  } catch { /* presentation only */ }
  return orb;
}

export function createBotPlazaConsole({
  documentRoot = globalThis.document,
  registry = null,
  runtime = null,
  onReplay = null,
} = {}) {
  const $ = (id) => documentRoot?.getElementById?.(id);
  const panel = $("bot-plaza-console");
  const closeButton = $("bot-plaza-close");
  const statusEl = $("bot-plaza-status");
  const rosterEl = $("bot-plaza-roster");
  const chatWithEl = $("bot-plaza-chat-with");
  const chatLogEl = $("bot-plaza-chat-log");
  const inputEl = $("bot-plaza-input");
  const sendButton = $("bot-plaza-send");
  const activityEl = $("bot-plaza-activity");
  const atelierName = $("bot-plaza-atelier-name");
  const atelierAvatar = $("bot-plaza-atelier-avatar");
  const atelierPersonality = $("bot-plaza-atelier-personality");
  const atelierRules = $("bot-plaza-atelier-rules");
  const ruleKind = $("bot-plaza-rule-kind");
  const ruleMatch = $("bot-plaza-rule-match");
  const ruleEvent = $("bot-plaza-rule-event");
  const ruleReply = $("bot-plaza-rule-reply");
  const ruleAction = $("bot-plaza-rule-action");
  const ruleParams = $("bot-plaza-rule-params");
  const ruleAdd = $("bot-plaza-rule-add");
  const atelierCaps = $("bot-plaza-atelier-caps");
  const atelierCreate = $("bot-plaza-atelier-create");
  const capsEl = $("bot-plaza-caps");
  const journalEl = $("bot-plaza-journal");
  const draftsEl = $("bot-plaza-drafts");
  const boundaryEl = $("bot-plaza-boundary");

  if (!panel || !closeButton || !statusEl || !rosterEl || !chatLogEl || !inputEl || !sendButton
    || !activityEl || !atelierName || !atelierAvatar || !atelierPersonality || !atelierRules
    || !ruleKind || !ruleMatch || !ruleEvent || !ruleReply || !ruleAction || !ruleParams
    || !ruleAdd || !atelierCaps || !atelierCreate || !capsEl || !journalEl || !draftsEl || !boundaryEl) {
    throw new Error("Bot Plaza console mount points are missing");
  }

  const botRegistry = registry ?? createBotRegistry();
  const botRuntime = runtime ?? createBotRuntime({ registry: botRegistry });
  const bus = botRuntime.getBus();
  const proposalQueue = typeof botRuntime.getProposalQueue === "function" ? botRuntime.getProposalQueue() : null;
  let opened = panel.hidden !== true;
  let selectedBotId = botRegistry.listEnabled()[0]?.id ?? null;
  let draftRules = [];

  boundaryEl.textContent = BOT_PLAZA_BOUNDARY;

  // Atelier template picker: one-click starting points. The picker pre-fills
  // the form below — capabilities are NOT auto-approved; the user reviews
  // and checks every power before plugging the bot in.
  function applyAtelierTemplate(templateId) {
    const template = getAtelierTemplate(templateId);
    if (!template) return;
    const prefill = template.prefill;
    atelierName.value = prefill.name ?? "";
    atelierAvatar.value = prefill.avatar ?? "orb-teal";
    atelierPersonality.value = prefill.personality ?? "";
    try {
      draftRules = (prefill.rules ?? []).map((rule) => validateAtelierRule(rule));
    } catch (error) {
      draftRules = [];
      setStatus(`Template rule rejected: ${error?.message ?? "invalid rule"}`);
      renderAtelierRules();
      return;
    }
    const wanted = new Set(prefill.capabilities ?? []);
    for (const box of atelierCaps.querySelectorAll("input[type=checkbox]")) {
      box.checked = wanted.has(box.value);
    }
    setStatus(`Template loaded: ${template.label}. Review it, tweak it, then plug it in.`);
    renderAtelierRules();
  }

  function mountAtelierTemplates() {
    if (!BOT_ATELIER_TEMPLATES.length) return;
    const host = $("bot-plaza-atelier-templates");
    const wrap = element(documentRoot, "label", "bot-plaza-field");
    wrap.append(element(documentRoot, "span", null, "Start from a template"));
    const select = documentRoot.createElement("select");
    select.setAttribute("aria-label", "Bot template");
    const blank = element(documentRoot, "option", null, "Start blank");
    blank.value = "";
    select.append(blank);
    for (const template of BOT_ATELIER_TEMPLATES) {
      const option = element(documentRoot, "option", null, template.label);
      option.value = template.id;
      option.title = template.description;
      select.append(option);
    }
    select.addEventListener("change", () => {
      if (select.value) applyAtelierTemplate(select.value);
      select.value = "";
    });
    wrap.append(select);
    if (host) {
      host.append(wrap);
      return;
    }
    // Fallback: insert above the atelier name field without touching index.html.
    const nameLabel = atelierName?.parentNode;
    const section = nameLabel?.parentNode;
    if (nameLabel && section && typeof section.insertBefore === "function") {
      section.insertBefore(wrap, nameLabel);
    }
  }
  mountAtelierTemplates();

  // Populate atelier selects.
  for (const avatar of BOT_AVATARS) {
    const option = element(documentRoot, "option", null, avatar.label);
    option.value = avatar.id;
    atelierAvatar.append(option);
  }
  for (const actionId of Object.keys(BOT_WORLD_ACTIONS)) {
    const option = element(documentRoot, "option", null, `${actionId} (${BOT_WORLD_ACTIONS[actionId].params.join(", ")})`);
    option.value = actionId;
    ruleAction.append(option);
  }
  const noneOption = element(documentRoot, "option", null, "no action — just reply");
  noneOption.value = "";
  ruleAction.prepend(noneOption);
  ruleAction.value = "";
  for (const eventType of BOT_WORLD_EVENT_TYPES) {
    const option = element(documentRoot, "option", null, eventType);
    option.value = eventType;
    ruleEvent.append(option);
  }
  for (const capability of BOT_CAPABILITIES) {
    const label = element(documentRoot, "label", "bot-plaza-cap-check");
    const box = documentRoot.createElement("input");
    box.type = "checkbox";
    box.value = capability.id;
    box.checked = ["world.announce", "world.message-bots"].includes(capability.id);
    label.append(box, element(documentRoot, "span", null, `${capability.label} — ${capability.description}`));
    atelierCaps.append(label);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function parseParams(text) {
    const params = {};
    for (const chunk of String(text ?? "").split(",")) {
      const index = chunk.indexOf("=");
      if (index < 0) continue;
      params[chunk.slice(0, index).trim()] = chunk.slice(index + 1).trim();
    }
    return params;
  }

  function renderRoster() {
    rosterEl.replaceChildren();
    for (const bot of botRegistry.listBots()) {
      const card = element(documentRoot, "button", `bot-plaza-bot${bot.id === selectedBotId ? " selected" : ""}${bot.enabled ? "" : " disabled"}`);
      card.type = "button";
      card.append(avatarFor(documentRoot, bot.avatar));
      const meta = element(documentRoot, "span", "bot-plaza-bot-meta");
      meta.append(element(documentRoot, "strong", null, bot.name));
      meta.append(element(documentRoot, "span", "bot-plaza-bot-sub",
        `${bot.kind === "builtin" ? "built-in" : bot.kind} · ${bot.enabled ? "in the plaza" : "resting"} · ${bot.approvedCapabilities.length} approved ${bot.approvedCapabilities.length === 1 ? "power" : "powers"}`));
      card.append(meta);
      card.addEventListener("click", () => {
        selectedBotId = bot.id;
        renderAll();
      });
      rosterEl.append(card);
    }
  }

  function renderChat() {
    const bot = botRegistry.getBot(selectedBotId);
    chatWithEl.replaceChildren();
    chatWithEl.append(element(documentRoot, "span", "bot-plaza-chat-with-label",
      bot ? `Talking to ${bot.name}${bot.enabled ? "" : " (resting — enable to chat)"}` : "Pick a bot above to chat"));
    chatLogEl.replaceChildren();
    for (const entry of bus.getLog()) {
      const relevant = entry.to === "user" || entry.from === "user"
        || entry.from === selectedBotId || entry.to === selectedBotId;
      if (!relevant || entry.kind === "system") continue;
      const row = element(documentRoot, "div", `bot-plaza-msg ${entry.from === "user" ? "from-user" : "from-bot"}`);
      const name = entry.from === "user" ? "You" : (botRegistry.getBot(entry.from)?.name ?? entry.from);
      row.append(element(documentRoot, "strong", null, `${name}: `));
      row.append(element(documentRoot, "span", null, entry.text));
      chatLogEl.append(row);
    }
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  function renderActivity() {
    activityEl.replaceChildren();
    const entries = bus.getLog().slice(-40).reverse();
    if (!entries.length) {
      activityEl.append(element(documentRoot, "div", "bot-plaza-empty", "Quiet in the plaza. Say hello to a bot."));
      return;
    }
    for (const entry of entries) {
      const from = entry.from === "user" ? "You" : entry.from === "world" ? "World" : (botRegistry.getBot(entry.from)?.name ?? entry.from);
      const to = entry.to === "user" ? "you" : entry.to === "plaza" ? "the plaza" : (botRegistry.getBot(entry.to)?.name ?? entry.to);
      activityEl.append(element(documentRoot, "div", `bot-plaza-activity-row kind-${entry.kind}`,
        `${from} → ${to}: ${entry.text}`));
    }
  }

  function renderAtelierRules() {
    atelierRules.replaceChildren();
    if (!draftRules.length) {
      atelierRules.append(element(documentRoot, "div", "bot-plaza-empty", "No rules yet — your bot will just introduce itself."));
      return;
    }
    draftRules.forEach((rule, index) => {
      const row = element(documentRoot, "div", "bot-plaza-rule-row");
      const trigger = rule.trigger.kind === "world-event"
        ? `when ${rule.trigger.eventType} happens`
        : `when someone says ${rule.trigger.kind === "message-matches" ? "matching" : "containing"} “${rule.trigger.text}”`;
      const action = rule.actions.length ? ` + does ${rule.actions.map((a) => a.action).join(", ")}` : "";
      row.append(element(documentRoot, "span", null, `${trigger} → replies “${rule.reply}”${action}`));
      const remove = element(documentRoot, "button", "bot-plaza-mini", "remove");
      remove.type = "button";
      remove.addEventListener("click", () => {
        draftRules = draftRules.filter((_, i) => i !== index);
        renderAtelierRules();
      });
      row.append(remove);
      atelierRules.append(row);
    });
  }

  function renderCaps() {
    capsEl.replaceChildren();
    for (const bot of botRegistry.listBots()) {
      const wrap = element(documentRoot, "div", "bot-plaza-cap-bot");
      wrap.append(element(documentRoot, "strong", null, bot.name));
      const row = element(documentRoot, "div", "bot-plaza-cap-row");
      for (const capability of BOT_CAPABILITIES) {
        const declared = bot.declaredCapabilities.includes(capability.id);
        const label = element(documentRoot, "label", `bot-plaza-cap-check${declared ? "" : " undeclared"}`);
        const box = documentRoot.createElement("input");
        box.type = "checkbox";
        box.checked = bot.approvedCapabilities.includes(capability.id);
        box.disabled = !declared;
        box.title = declared ? capability.description : `${bot.name} does not declare this capability`;
        box.addEventListener("change", () => {
          const next = botRegistry.getBot(bot.id).approvedCapabilities.filter((id) => id !== capability.id);
          if (box.checked) next.push(capability.id);
          botRegistry.approveCapabilities(bot.id, next);
          setStatus(`${capability.label} ${box.checked ? "approved" : "revoked"} for ${bot.name}.`);
          renderAll();
        });
        label.append(box, element(documentRoot, "span", null, capability.label));
        row.append(label);
      }
      wrap.append(row);
      const controls = element(documentRoot, "div", "bot-plaza-bot-controls");
      const toggle = element(documentRoot, "button", "bot-plaza-mini", bot.enabled ? "rest" : "wake");
      toggle.type = "button";
      toggle.addEventListener("click", () => {
        botRegistry.setEnabled(bot.id, !bot.enabled);
        botRuntime.publishWorldEvent(bot.enabled ? "bot.disabled" : "bot.enabled", { botId: bot.id });
        renderAll();
      });
      controls.append(toggle);
      if (bot.kind !== "builtin") {
        const remove = element(documentRoot, "button", "bot-plaza-mini danger", "remove bot");
        remove.type = "button";
        remove.addEventListener("click", () => {
          if (selectedBotId === bot.id) selectedBotId = botRegistry.listEnabled()[0]?.id ?? null;
          botRegistry.remove(bot.id);
          setStatus(`${bot.name} left the plaza.`);
          renderAll();
        });
        controls.append(remove);
      } else {
        controls.append(element(documentRoot, "span", "bot-plaza-bot-sub", "built-in · cannot be removed"));
      }
      wrap.append(controls);
      capsEl.append(wrap);
    }
  }

  function renderJournal() {
    journalEl.replaceChildren();
    const entries = botRuntime.getJournal().slice().reverse();
    if (!entries.length) {
      journalEl.append(element(documentRoot, "div", "bot-plaza-empty", "No journal entries yet. Bots with the journal power can write here."));
      return;
    }
    for (const entry of entries) {
      journalEl.append(element(documentRoot, "div", "bot-plaza-journal-row", `${entry.botName}: ${entry.text}`));
    }
  }

  function formatStakeRange(proposal) {
    if (proposal.minStake === undefined && proposal.maxStake === undefined) return "any stake";
    const points = (cents) => (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
    const min = proposal.minStake === undefined ? "…" : points(proposal.minStake);
    const max = proposal.maxStake === undefined ? "…" : points(proposal.maxStake);
    return `${min} – ${max} TUMBO pts (simulated)`;
  }

  function formatExpiry(proposal) {
    if (proposal.status !== "pending") return null;
    const ms = Date.parse(proposal.expiresAt) - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return "expiring now";
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours >= 48) return `expires in ${Math.floor(hours / 24)}d ${hours % 24}h`;
    if (hours >= 1) return `expires in ${hours}h ${minutes}m`;
    return `expires in ${Math.max(1, Math.floor(ms / 60000))}m`;
  }

  function renderDrafts() {
    draftsEl.replaceChildren();
    const drafts = botRuntime.getDrafts().slice().reverse();
    for (const draft of drafts) {
      const row = element(documentRoot, "div", "bot-plaza-draft-row");
      row.append(element(documentRoot, "strong", null, `DRAFT · ${draft.title} `));
      row.append(element(documentRoot, "span", "bot-plaza-bot-sub", `by ${draft.botName}${draft.fromEvent ? ` · from ${draft.fromEvent}` : ""}`));
      row.append(element(documentRoot, "div", null, draft.body));
      draftsEl.append(row);
    }
    const proposals = proposalQueue ? proposalQueue.getProposals().slice().reverse() : [];
    if (proposals.length) {
      draftsEl.append(element(documentRoot, "div", "bot-plaza-subtitle", "Contract proposals · brought to you by your bots"));
    }
    for (const proposal of proposals) {
      const row = element(documentRoot, "div", "bot-plaza-draft-row bot-plaza-proposal-row");
      const badge = proposal.status.toUpperCase();
      row.append(element(documentRoot, "strong", null, `PROPOSAL · ${badge} · ${proposal.title} `));
      row.append(element(documentRoot, "span", "bot-plaza-bot-sub",
        `by ${proposal.botName} · ${proposal.eventLabel}`));
      const expiry = formatExpiry(proposal);
      row.append(element(documentRoot, "div", null,
        `Outcomes: ${proposal.outcomes.join(" · ")}`));
      row.append(element(documentRoot, "div", null, `Stake: ${formatStakeRange(proposal)}`));
      if (proposal.sourceNotes) row.append(element(documentRoot, "div", null, `Why: ${proposal.sourceNotes}`));
      if (proposal.researchNotes) row.append(element(documentRoot, "div", null, `Notes: ${proposal.researchNotes}`));
      row.append(element(documentRoot, "span", "bot-plaza-bot-sub",
        `${expiry ? `${expiry} · ` : ""}submitted ${proposal.createdAt.slice(0, 10)}`));
      draftsEl.append(row);
    }
    if (!drafts.length && !proposals.length) {
      draftsEl.append(element(documentRoot, "div", "bot-plaza-empty", "No drafts yet. Bots with the drafting power turn world events into proposals here."));
    } else if (proposals.length) {
      draftsEl.append(element(documentRoot, "div", "bot-plaza-empty", "Review in Contract Atelier → Contracts for your review."));
    }
  }

  function renderAll() {
    renderRoster();
    renderChat();
    renderActivity();
    renderAtelierRules();
    renderCaps();
    renderJournal();
    renderDrafts();
    const enabled = botRegistry.listEnabled().length;
    setStatus(`PLAZA OPEN · ${enabled} ${enabled === 1 ? "bot" : "bots"} present · 100% local · no network`);
  }

  function send() {
    const bot = botRegistry.getBot(selectedBotId);
    const text = inputEl.value.trim();
    if (!text) return;
    if (!bot) {
      setStatus("Pick a bot first.");
      return;
    }
    inputEl.value = "";
    botRuntime.tellBot(bot.id, text, { from: "user" });
    renderAll();
  }

  sendButton.addEventListener("click", send);
  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  ruleKind.addEventListener("change", () => {
    const isEvent = ruleKind.value === "world-event";
    ruleMatch.hidden = isEvent;
    ruleEvent.hidden = !isEvent;
  });
  ruleMatch.hidden = false;
  ruleEvent.hidden = true;

  ruleAdd.addEventListener("click", () => {
    const kind = ruleKind.value;
    const trigger = kind === "world-event"
      ? { kind, eventType: ruleEvent.value }
      : { kind, text: ruleMatch.value };
    const actionId = ruleAction.value;
    const candidate = {
      trigger,
      reply: ruleReply.value,
      actions: actionId ? [{ action: actionId, params: parseParams(ruleParams.value) }] : [],
    };
    // Validate eagerly so bad rules never reach the bot.
    try {
      validateAtelierRule(candidate);
    } catch (error) {
      setStatus(`Rule rejected: ${error?.message ?? "invalid rule"}`);
      return;
    }
    draftRules = [...draftRules, candidate];
    ruleMatch.value = "";
    ruleReply.value = "";
    ruleParams.value = "";
    setStatus("Rule added. Add more, or plug in your bot.");
    renderAtelierRules();
  });

  atelierCreate.addEventListener("click", () => {
    const capabilities = [...atelierCaps.querySelectorAll("input[type=checkbox]:checked")].map((box) => box.value);
    try {
      const bot = botRegistry.installAtelierBot({
        name: atelierName.value,
        avatar: atelierAvatar.value,
        personality: atelierPersonality.value,
        rules: draftRules,
        capabilities,
      }, { approvedCapabilities: capabilities, enabled: true });
      botRuntime.publishWorldEvent("bot.joined", { botId: bot.id });
      selectedBotId = bot.id;
      atelierName.value = "";
      atelierPersonality.value = "";
      draftRules = [];
      for (const box of atelierCaps.querySelectorAll("input[type=checkbox]")) {
        box.checked = ["world.announce", "world.message-bots"].includes(box.value);
      }
      setStatus(`${bot.name} plugged in and in the plaza. Say hello.`);
      renderAll();
    } catch (error) {
      setStatus(`Could not plug in that bot: ${error?.message ?? "invalid bot"}`);
    }
  });

  bus.subscribe(() => {
    if (opened) {
      renderChat();
      renderActivity();
      renderJournal();
      renderDrafts();
    }
  });

  if (proposalQueue) {
    proposalQueue.subscribe(() => {
      if (opened) renderDrafts();
    });
  }

  function open() {
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    opened = true;
    renderAll();
  }

  function close() {
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");
    opened = false;
  }

  closeButton.addEventListener("click", close);

  function openWithBot(botId) {
    if (botRegistry.getBot(botId)) selectedBotId = botId;
    open();
  }

  function getSnapshot() {
    return deepFreeze({
      source: BOT_PLAZA_CONSOLE_SOURCE,
      opened,
      selectedBotId,
      bots: botRegistry.listBots().map((bot) => ({ id: bot.id, name: bot.name, enabled: bot.enabled })),
    });
  }

  function replay(method = "console") {
    onReplay?.(getSnapshot(), { method });
    return getSnapshot();
  }

  renderAll();
  return deepFreeze({ open, close, toggle: () => (opened ? close() : open()), openWithBot, getSnapshot, replay, source: BOT_PLAZA_CONSOLE_SOURCE });
}
