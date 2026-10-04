/** My GPT lives inside the existing Web + AI object. Provider credentials stay in the local bridge. */
import { GPT_LIMITS, createGptWorkspace, normalizeGptUrl, buildGptChatRequest } from '../domains/my-gpt.js?v=20261003-skin360';

const STYLE = `
.my-gpt{display:flex;flex-direction:column;gap:14px;min-width:0;color:#e0f2ff;font:14px/1.5 system-ui,sans-serif;padding:4px 0 12px;color-scheme:dark}
.my-gpt-top{order:0}.my-gpt-modes{order:1}.my-gpt-toolbar{order:2}.my-gpt>.my-gpt-notice{order:3}.my-gpt-messages{order:4}.my-gpt-composer{order:5}.my-gpt-setup-entry{order:6}.my-gpt-privacy{order:7}.my-gpt-details{order:8}
.my-gpt *{box-sizing:border-box}.my-gpt [hidden]{display:none!important}
.my-gpt p,.my-gpt h3{margin:0}.my-gpt-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.my-gpt h3{font-size:24px;letter-spacing:-.04em;font-weight:650;color:#f1f8ff}.my-gpt-kicker{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#79bcff}.my-gpt-consent{display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#b5d2ea}.my-gpt-consent input{width:16px;min-width:16px;height:16px;margin-top:3px}
.my-gpt button,.my-gpt select,.my-gpt input,.my-gpt textarea{font:inherit;min-width:0;max-width:100%;color:inherit}.my-gpt button{cursor:pointer;min-height:40px;padding:8px 12px;border:1px solid #6cacfa50;border-radius:10px;background:#15395c68;line-height:1.35}.my-gpt button:hover{background:#21598688;border-color:#8bc6ffb3}.my-gpt button:disabled{opacity:.45;cursor:default}.my-gpt :focus-visible{outline:2px solid #9bd3ff;outline-offset:3px}
.my-gpt .my-gpt-primary{background:linear-gradient(135deg,#176bd3,#14538e);border-color:#8bc5ff80;color:#fff;font-weight:650;box-shadow:0 4px 20px #0774ff20}.my-gpt .my-gpt-quiet{font-size:12px;background:transparent}.my-gpt-modes{display:grid;grid-template-columns:1fr 1fr;gap:6px;border:1px solid #78bfff25;border-radius:13px;padding:4px;background:#020d1c70}.my-gpt-modes button{border-color:transparent;background:transparent;color:#a8c4df}.my-gpt-modes button[aria-pressed=true]{border-color:#75bfff6b;background:#256eb04d;color:#e9f5ff;box-shadow:inset 0 1px #addfff20}
.my-gpt-toolbar{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.my-gpt-field{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#9fbfdb}.my-gpt select,.my-gpt input,.my-gpt textarea{width:100%;padding:10px;border:1px solid #77b7f53b;border-radius:9px;background:#05182dda;color:#e2f2ff}.my-gpt textarea{resize:vertical;line-height:1.5}.my-gpt select{height:43px}.my-gpt-small{font-size:12px;line-height:1.5;color:#a3bdd2;overflow-wrap:anywhere}.my-gpt-notice{font-size:12px;color:#b9d9f5;border-left:2px solid #63b6ff80;padding:7px 10px;background:#1879bd0d;overflow-wrap:anywhere}.my-gpt-notice[data-kind=error]{color:#ffd1d8;border-color:#f98092}.my-gpt-state{font-size:11px;color:#95caff;white-space:nowrap}.my-gpt-state[data-ready=true]{color:#91d9c1}
.my-gpt-messages{display:flex;flex-direction:column;gap:12px;min-height:165px;max-height:440px;overflow:auto;overscroll-behavior:contain;padding:10px 1px;scrollbar-width:thin}.my-gpt-empty{padding:25px 10px 22px;display:grid;gap:7px;text-align:center}.my-gpt-empty strong{font-size:20px;letter-spacing:-.03em;font-weight:550;color:#cee8ff}.my-gpt-message{max-width:100%;padding:12px 13px;border-left:2px solid #5baaff70;background:linear-gradient(115deg,#19477525,transparent);border-radius:0 12px 12px 0;overflow-wrap:anywhere}.my-gpt-message[data-role=user]{margin-left:18px;border:1px solid #6eaeef35;border-radius:13px;background:#16467535}.my-gpt-message b{display:block;margin-bottom:6px;color:#8bbff0;font-size:10px;letter-spacing:.13em;text-transform:uppercase}.my-gpt-message p{white-space:pre-wrap;line-height:1.65;font-size:14px;color:#e5f1fb}.my-gpt-composer{display:flex;flex-direction:column;gap:8px}.my-gpt-composer textarea{min-height:90px;border-color:#74baff66;background:linear-gradient(140deg,#0b2a468c,#061629c9);font-size:15px;padding:12px;border-radius:13px}.my-gpt-compose-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.my-gpt-compose-actions .my-gpt-small{font-size:11px}.my-gpt-actions{display:flex;flex-wrap:wrap;align-items:center;gap:7px}.my-gpt a{color:#99cdff;text-underline-offset:3px;overflow-wrap:anywhere}.my-gpt-details{border-top:1px solid #72b4f32b;padding-top:10px}.my-gpt-details summary{cursor:pointer;color:#c5e1fa;font-size:13px;padding:3px 0 6px;font-weight:600}.my-gpt-details-body{display:flex;flex-direction:column;gap:10px;padding-top:6px}.my-gpt-list{display:flex;flex-direction:column;gap:7px}.my-gpt-row{display:flex;align-items:center;gap:7px;min-width:0}.my-gpt-row>button:first-child{flex:1;min-width:0;text-align:left;overflow-wrap:anywhere}.my-gpt-row button[aria-current=true]{border-color:#8bc7ffbb;background:#215d8f50}.my-gpt-form{display:grid;gap:9px}.my-gpt-account{display:grid;gap:6px}.my-gpt-file{font-size:12px!important;padding:8px!important}.my-gpt-privacy{font-size:11px;line-height:1.5;color:#9cb7cb;padding-top:3px}
@media(max-width:430px){.my-gpt{gap:12px}.my-gpt-toolbar{grid-template-columns:1fr}.my-gpt h3{font-size:22px}.my-gpt input,.my-gpt textarea,.my-gpt select{font-size:16px}.my-gpt-messages{min-height:135px;max-height:340px}.my-gpt-compose-actions{flex-wrap:wrap}.my-gpt-message[data-role=user]{margin-left:8px}.my-gpt-modes button{padding:8px 5px;font-size:13px}}
`;
const CHATGPT_READY_STATES = new Set(['signed_in', 'verified']);
const OPENAI_READY_STATES = new Set(['configured', 'verified']);

function node(doc, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(doc, text, action, className = '') {
  const element = node(doc, 'button', className, text);
  element.type = 'button';
  if (action) element.addEventListener('click', action);
  return element;
}
function field(doc, title, tag = 'input') {
  const label = node(doc, 'label', 'my-gpt-field', title);
  const control = node(doc, tag);
  control.setAttribute('aria-label', title);
  label.appendChild(control);
  return { label, control };
}
function details(doc, title) {
  const element = node(doc, 'details', 'my-gpt-details');
  element.appendChild(node(doc, 'summary', '', title));
  const body = node(doc, 'div', 'my-gpt-details-body');
  element.appendChild(body);
  return { element, body };
}
function link(doc, label, href) {
  const element = node(doc, 'a', '', label);
  element.href = href; element.target = '_blank'; element.rel = 'noopener noreferrer';
  return element;
}
function openTab(win, url) {
  try {
    const opened = win?.open?.(url, '_blank');
    if (opened) { try { opened.opener = null; } catch {} }
    return opened || null;
  } catch { return null; }
}
function localOrigin(win) {
  try {
    const url = new URL(win.location.href);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

/** Mount once in the owner's section. The same nodes survive Lens reparenting. */
export function mountMyGpt({ documentRoot = globalThis.document, windowRoot = globalThis.window, storage = null, host, fetchImpl } = {}) {
  const doc = documentRoot;
  if (!doc?.createElement || !host?.appendChild) throw new Error('My GPT needs a document and its owning object surface.');
  const fetcher = fetchImpl || windowRoot?.fetch?.bind(windowRoot);
  const workspace = createGptWorkspace({ storage });
  let provider = 'chatgpt';
  let bridge = null;
  let destroyed = false;
  let activated = false;
  let generation = 0;
  let statusGeneration = 0;
  let chatController = null;
  let statusController = null;
  let authController = null;
  let modelsController = null;
  let authBusy = false;
  let editingProfileId = null;
  let clearArmed = false;
  let hasMessages = false;

  const style = node(doc, 'style'); style.textContent = STYLE;
  (doc.head || host).appendChild(style);
  const root = node(doc, 'div', 'my-gpt'); root.dataset.myGpt = 'true';
  const top = node(doc, 'div', 'my-gpt-top');
  const heading = node(doc, 'div');
  const kicker = node(doc, 'p', 'my-gpt-kicker', 'Your space to think'); kicker.setAttribute('aria-hidden', 'true');
  const title = node(doc, 'h3', '', 'My GPT'); title.tabIndex = -1; title.setAttribute('data-autofocus', 'true');
  heading.append(kicker, title);
  const stateBadge = node(doc, 'span', 'my-gpt-state', 'Setup needed');
  stateBadge.setAttribute('aria-hidden', 'true'); // The live notice carries the same state accessibly.
  top.append(heading, stateBadge); root.appendChild(top);
  const modes = node(doc, 'div', 'my-gpt-modes'); modes.setAttribute('aria-label', 'Chat provider');
  const planMode = button(doc, 'ChatGPT plan', () => chooseProvider('chatgpt'));
  const apiMode = button(doc, 'OpenAI API', () => chooseProvider('openai'));
  modes.append(planMode, apiMode); root.appendChild(modes);
  const toolbar = node(doc, 'div', 'my-gpt-toolbar');
  const profileSelect = field(doc, 'Assistant', 'select');
  const modelSelect = field(doc, 'Model', 'select');
  toolbar.append(profileSelect.label, modelSelect.label); root.appendChild(toolbar);
  const notice = node(doc, 'p', 'my-gpt-notice', 'Connect your ChatGPT plan or configure the local API bridge to start chatting.');
  notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); root.appendChild(notice);
  const messages = node(doc, 'div', 'my-gpt-messages'); messages.setAttribute('role', 'log'); messages.setAttribute('aria-label', 'Conversation'); messages.setAttribute('aria-live', 'polite'); root.appendChild(messages);
  const composer = node(doc, 'form', 'my-gpt-composer');
  const prompt = node(doc, 'textarea'); prompt.rows = 3; prompt.maxLength = GPT_LIMITS.prompt; prompt.placeholder = 'What would you like to explore?'; prompt.setAttribute('aria-label', 'Message My GPT');
  const composeActions = node(doc, 'div', 'my-gpt-compose-actions');
  const newChat = button(doc, 'New chat', () => mutateWorkspace(() => workspace.newConversation()), 'my-gpt-quiet');
  const send = button(doc, 'Send message', null, 'my-gpt-primary'); send.type = 'submit';
  const stop = button(doc, 'Stop waiting', () => cancelChat('Stopped waiting here. The provider may continue processing this request. Your message remains in local history.')); stop.hidden = true;
  const submitActions = node(doc, 'div', 'my-gpt-actions'); submitActions.append(stop, send);
  composeActions.append(newChat, submitActions); composer.append(prompt, composeActions); root.appendChild(composer);
  root.appendChild(node(doc, 'p', 'my-gpt-privacy', 'History and assistant notes are saved in this browser. Send shares this chat’s recent messages and this assistant’s instructions/knowledge with the selected provider. Credentials stay on your PC.'));
  const storageNotice = node(doc, 'p', 'my-gpt-notice'); storageNotice.dataset.kind = 'error'; storageNotice.hidden = true; storageNotice.setAttribute('role', 'status'); root.appendChild(storageNotice);

  const setup = details(doc, 'Account & setup');
  const accountText = node(doc, 'p', 'my-gpt-small');
  const planUsage = node(doc, 'p', 'my-gpt-small');
  const bridgeWarning = node(doc, 'p', 'my-gpt-notice'); bridgeWarning.dataset.kind = 'error'; bridgeWarning.hidden = true;
  const accountSelect = field(doc, 'ChatGPT account', 'select');
  const planConsentLabel = node(doc, 'label', 'my-gpt-consent');
  const planConsent = node(doc, 'input'); planConsent.type = 'checkbox'; planConsent.setAttribute('aria-label', 'Allow this app to use my ChatGPT plan');
  planConsentLabel.append(planConsent, node(doc, 'span', '', 'Allow this app to use my ChatGPT plan for messages I send here.'));
  const setupActions = node(doc, 'div', 'my-gpt-actions');
  const signIn = button(doc, 'Continue with ChatGPT', startSignIn, 'my-gpt-primary');
  const refreshButton = button(doc, 'Refresh status', () => refresh());
  const modelsButton = button(doc, 'Load available models', loadModels);
  const setupEntry = button(doc, 'Connect ChatGPT', () => {
    setup.element.open = true;
    const target = provider === 'chatgpt' ? chatgptReady() && !selectedModelReady() ? modelsButton : planConsent : refreshButton;
    target.focus?.();
  }, 'my-gpt-setup-entry');
  const disconnect = button(doc, 'Disconnect ChatGPT', disconnectAccount, 'my-gpt-quiet');
  setupActions.append(signIn, refreshButton, modelsButton, disconnect);
  const authLink = link(doc, 'Open ChatGPT authorization →', 'https://auth.openai.com/'); authLink.hidden = true;
  const apiSetup = node(doc, 'div', 'my-gpt-account');
  apiSetup.append(node(doc, 'p', 'my-gpt-small', 'OpenAI API uses separate API billing. Configure the API credential in the local bridge environment on your PC, then refresh status. This surface never asks for a key.'), link(doc, 'Open the official API dashboard →', 'https://platform.openai.com/api-keys'));
  setup.body.append(accountText, planUsage, bridgeWarning, accountSelect.label, planConsentLabel, setupActions, authLink, apiSetup,
    node(doc, 'p', 'my-gpt-small', 'ChatGPT sign-in connects the local chat service. Website conversations and custom GPT internals are not synchronized automatically. You approve the final sign-in in the OpenAI browser page.'));
  root.appendChild(setup.element);

  const library = details(doc, 'My GPT collection');
  library.body.appendChild(node(doc, 'p', 'my-gpt-small', 'Save a ChatGPT GPT link, or give a local assistant your own instructions and knowledge. A local assistant version does not automatically import the original GPT.'));
  const profileList = node(doc, 'div', 'my-gpt-list'); library.body.appendChild(profileList);
  const profileForm = node(doc, 'form', 'my-gpt-form');
  const nameField = field(doc, 'Assistant name'); nameField.control.maxLength = 80; nameField.control.required = true;
  const urlField = field(doc, 'ChatGPT GPT link (optional)'); urlField.control.type = 'url'; urlField.control.placeholder = 'https://chatgpt.com/g/…';
  const instructionsField = field(doc, 'Local instructions (optional)', 'textarea'); instructionsField.control.rows = 3; instructionsField.control.maxLength = GPT_LIMITS.instructions;
  const knowledgeField = field(doc, 'Local knowledge notes (optional)', 'textarea'); knowledgeField.control.rows = 3; knowledgeField.control.maxLength = GPT_LIMITS.knowledge;
  const saveProfile = button(doc, 'Save assistant', null, 'my-gpt-primary'); saveProfile.type = 'submit';
  const cancelEdit = button(doc, 'Cancel edit', resetProfileForm, 'my-gpt-quiet'); cancelEdit.hidden = true;
  const profileActions = node(doc, 'div', 'my-gpt-actions'); profileActions.append(saveProfile, cancelEdit);
  profileForm.append(nameField.label, urlField.label, instructionsField.label, knowledgeField.label, profileActions); library.body.appendChild(profileForm); root.appendChild(library.element);

  const history = details(doc, 'Local history & import');
  history.body.append(node(doc, 'p', 'my-gpt-small', 'These are conversations saved here, plus conversations you explicitly import. Signing in does not expose or sync your ChatGPT website history.'), link(doc, 'Open ChatGPT account & history →', 'https://chatgpt.com/'));
  const conversationList = node(doc, 'div', 'my-gpt-list'); history.body.appendChild(conversationList);
  const historyActions = node(doc, 'div', 'my-gpt-actions');
  const exportButton = button(doc, 'Export local data', exportHistory);
  const clearButton = button(doc, 'Clear local history', () => {
    if (!clearArmed) { clearArmed = true; clearButton.textContent = 'Confirm clear local history'; return; }
    mutateWorkspace(() => workspace.clearHistory()); clearArmed = false; clearButton.textContent = 'Clear local history';
    say(workspace.snapshot().storageError ? 'History cleared from this session. The saved browser copy could not be updated; review the storage warning.' : 'Local conversation history cleared. Saved assistants remain.');
  }, 'my-gpt-quiet');
  historyActions.append(exportButton, clearButton); history.body.appendChild(historyActions);
  const importField = field(doc, 'Import conversations JSON', 'input'); importField.control.type = 'file'; importField.control.accept = '.json,application/json'; importField.control.className = 'my-gpt-file';
  history.body.append(importField.label, node(doc, 'p', 'my-gpt-small', 'Choose a ChatGPT conversations.json export or a My GPT export under 2 MB, with up to 60 selected chats and 100 text messages per chat. If the file picker is unavailable on the 3D object, switch the object to Text view. Import stays local until you send a message.'));
  root.appendChild(history.element);
  // The mesh reads source order, while Text view uses the flex order above.
  // Keep setup reachable on the phone's first chart. Once connected, this
  // shortcut hides and the actual composer becomes the first control.
  root.insertBefore(composer, modes);
  root.insertBefore(setupEntry, composer);
  root.insertBefore(messages, modes);
  root.insertBefore(notice, modes);
  host.appendChild(root);

  function say(text, error = false) { if (!destroyed) { notice.textContent = text; notice.dataset.kind = error ? 'error' : 'info'; } }
  function chatgptReady() { return CHATGPT_READY_STATES.has(bridge?.chatgpt?.state) && bridge.chatgpt.planUsage === true && Boolean(bridge.chatgpt.activeAccountId); }
  function ready() { return provider === 'chatgpt' ? chatgptReady() : OPENAI_READY_STATES.has(bridge?.openai?.state); }
  function selectedModelReady() {
    return Boolean(modelSelect.control.value) && (provider !== 'chatgpt' || bridge?.models?.some(item => item.provider === 'chatgpt' && item.id === modelSelect.control.value));
  }
  function controls() {
    planMode.setAttribute('aria-pressed', String(provider === 'chatgpt'));
    apiMode.setAttribute('aria-pressed', String(provider === 'openai'));
    send.disabled = !ready() || !selectedModelReady() || Boolean(chatController) || !prompt.value.trim();
    stop.hidden = !chatController; send.textContent = chatController ? 'Thinking…' : 'Send message';
    messages.setAttribute('aria-busy', String(Boolean(chatController)));
    messages.hidden = !hasMessages && !ready(); newChat.hidden = !hasMessages;
    setupEntry.hidden = ready() && selectedModelReady();
    setupEntry.textContent = provider === 'chatgpt' ? chatgptReady() ? 'Choose a ChatGPT model' : 'Connect ChatGPT' : 'Set up OpenAI API';
    modelSelect.control.disabled = Boolean(chatController) || !ready();
    signIn.hidden = provider !== 'chatgpt';
    signIn.disabled = authBusy || !localOrigin(windowRoot) || bridge?.chatgpt?.authAvailable === false;
    disconnect.hidden = provider !== 'chatgpt' || !bridge?.chatgpt?.activeAccountId;
    disconnect.disabled = authBusy;
    apiSetup.hidden = provider !== 'openai';
    accountSelect.label.hidden = provider !== 'chatgpt'; planConsentLabel.hidden = provider !== 'chatgpt';
    accountSelect.control.disabled = authBusy;
    modelsButton.hidden = provider !== 'chatgpt'; modelsButton.disabled = !chatgptReady() || Boolean(modelsController);
    stateBadge.dataset.ready = String(ready());
    stateBadge.textContent = bridge?.[provider]?.state === 'verified' && ready() ? 'Answer verified'
      : ready() ? provider === 'chatgpt' ? 'Signed in' : 'Configured · untested'
      : bridge ? 'Setup needed' : 'Bridge unavailable';
    const status = bridge?.[provider];
    const stateLabel = String(status?.state || 'unavailable').replaceAll('_', ' ');
    accountText.textContent = provider === 'chatgpt'
      ? `ChatGPT plan · ${stateLabel}${status?.accountLabel ? ` · ${status.accountLabel}` : ''}`
      : `OpenAI API · ${stateLabel}${status?.model ? ` · ${status.model}` : ''}`;
    planUsage.hidden = provider !== 'chatgpt';
    const usage = bridge?.chatgpt?.planUsage;
    planUsage.textContent = usage === true ? 'ChatGPT plan use is enabled for messages sent from this app. Plan limits still apply.' : 'ChatGPT plan use is not enabled. Check the plan permission and continue with ChatGPT to enable in-app messages.';
    const warnings = [bridge?.storageWarning, provider === 'chatgpt' && bridge?.chatgpt?.dependencyState === 'dependency_needed' ? 'ChatGPT sign-in needs PyJWT[crypto] installed in this PC’s bridge Python environment.' : null, bridge?.[provider]?.error?.message].filter(item => typeof item === 'string' && item);
    bridgeWarning.textContent = warnings.join(' '); bridgeWarning.hidden = warnings.length === 0;
  }
  function renderModels() {
    const previous = modelSelect.control.value;
    modelSelect.control.replaceChildren();
    const available = Array.isArray(bridge?.models) ? bridge.models.filter(item => !item.provider || item.provider === provider) : [];
    const rows = available.length ? available : [{ id: provider === 'openai' ? bridge?.openai?.model || '' : '', label: 'Provider default' }];
    for (const item of rows) { const option = node(doc, 'option', '', String(item.label || item.id || 'Provider default')); option.value = String(item.id || ''); modelSelect.control.appendChild(option); }
    modelSelect.control.value = rows.some(item => item.id === previous) ? previous : String(rows[0].id || '');
  }
  function renderWorkspace() {
    const snapshot = workspace.snapshot();
    storageNotice.hidden = !snapshot.storageError; storageNotice.textContent = snapshot.storageError || '';
    const selected = snapshot.profiles.find(item => item.id === snapshot.selectedProfileId);
    profileSelect.control.replaceChildren();
    if (!snapshot.profiles.length) { const option = node(doc, 'option', '', 'General assistant'); option.value = ''; profileSelect.control.appendChild(option); }
    for (const profile of snapshot.profiles) { const option = node(doc, 'option', '', profile.name); option.value = profile.id; profileSelect.control.appendChild(option); }
    profileSelect.control.value = snapshot.selectedProfileId || '';
    profileList.replaceChildren();
    if (!snapshot.profiles.length) profileList.appendChild(node(doc, 'p', 'my-gpt-small', 'Your collection starts with the assistants you save below.'));
    for (const profile of snapshot.profiles) {
      const row = node(doc, 'div', 'my-gpt-row');
      const select = button(doc, profile.name, () => mutateWorkspace(() => workspace.selectProfile(profile.id)));
      select.setAttribute('aria-current', String(snapshot.selectedProfileId === profile.id));
      row.append(select, button(doc, 'Edit', () => editProfile(profile), 'my-gpt-quiet'));
      if (profile.url) row.appendChild(button(doc, 'Open ↗', () => { try { const url = normalizeGptUrl(profile.url); if (url) openTab(windowRoot, url); } catch (error) { say(error.message, true); } }, 'my-gpt-quiet'));
      row.appendChild(button(doc, 'Remove', () => { mutateWorkspace(() => workspace.removeProfile(profile.id)); if (editingProfileId === profile.id) resetProfileForm(); }, 'my-gpt-quiet'));
      profileList.appendChild(row);
    }
    messages.replaceChildren();
    const active = snapshot.conversations.find(item => item.id === snapshot.activeConversationId);
    hasMessages = Boolean(active?.messages.length);
    if (!active?.messages.length) {
      const empty = node(doc, 'div', 'my-gpt-empty');
      empty.append(node(doc, 'strong', '', selected ? `Think with ${selected.name}` : 'A little space for a big idea.'), node(doc, 'p', 'my-gpt-small', 'Ask a question. Work through a plan. Keep the conversation in your world.'));
      messages.appendChild(empty);
    }
    for (const message of active?.messages || []) {
      const article = node(doc, 'article', 'my-gpt-message'); article.dataset.role = message.role;
      article.append(node(doc, 'b', '', message.role === 'user' ? 'You' : 'Assistant'), node(doc, 'p', '', message.content)); messages.appendChild(article);
    }
    messages.scrollTop = messages.scrollHeight;
    conversationList.replaceChildren();
    if (!snapshot.conversations.length) conversationList.appendChild(node(doc, 'p', 'my-gpt-small', 'No local conversations yet.'));
    for (const conversation of [...snapshot.conversations].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const item = button(doc, conversation.title || 'New conversation', () => mutateWorkspace(() => workspace.selectConversation(conversation.id)));
      item.setAttribute('aria-current', String(snapshot.activeConversationId === conversation.id)); conversationList.appendChild(item);
    }
    controls();
  }
  function cancelChat(message = '') {
    generation += 1; chatController?.abort(); chatController = null;
    controls(); if (message) say(message);
  }
  function mutateWorkspace(action) {
    cancelChat();
    try { action(); renderWorkspace(); } catch (error) { say(error?.message || 'Could not update local data.', true); }
  }
  function chooseProvider(next) {
    if (next === provider) return;
    cancelChat(); provider = next; authLink.hidden = true; renderModels(); controls();
    say(ready() ? selectedModelReady() ? `${provider === 'chatgpt' ? 'ChatGPT plan' : 'OpenAI API'} selected. Send when you are ready.` : 'Open Account & setup and load the available models before sending.' : 'Open Account & setup to connect this provider.');
  }
  async function request(path, { method = 'GET', body, signal } = {}) {
    if (!localOrigin(windowRoot)) throw new Error('Open this app on your PC at localhost to use the local GPT bridge.');
    if (!fetcher) throw new Error('The local GPT bridge is unavailable in this browser.');
    const response = await fetcher(path, { method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Matumbo-Gpt': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let data;
    try { data = await response.json(); } catch { throw new Error('The local GPT bridge returned an unreadable response. Start the GPT bridge server for this app.'); }
    if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : data?.error?.message || `Local GPT bridge request failed (${response.status}).`);
    return data;
  }
  async function refresh() {
    if (destroyed) return null;
    activated = true;
    const current = ++statusGeneration;
    statusController?.abort(); statusController = new AbortController();
    refreshButton.disabled = true;
    try {
      const data = await request('/api/gpt/status', { signal: statusController.signal });
      if (destroyed || current !== statusGeneration) return null;
      if (data?.service !== 'matumbo-gpt-bridge' || data.version !== 1 || data.credentialsInBrowser !== false) throw new Error('The local service does not match the GPT bridge contract.');
      bridge = data; renderAccounts(); renderModels(); controls();
      if (!chatController) say(ready() ? selectedModelReady() ? 'Ready to send. Provider response is verified only after a reply arrives.' : 'Signed in. Open Account & setup and choose Load available models before sending.' : 'Setup needed. Open Account & setup to connect your selected provider.');
      return data;
    } catch (error) {
      if (!destroyed && current === statusGeneration && error?.name !== 'AbortError') { bridge = null; renderModels(); controls(); say(error?.message || 'The local GPT bridge is unavailable.', true); }
      return null;
    } finally { if (!destroyed && current === statusGeneration) { statusController = null; refreshButton.disabled = false; } }
  }
  function renderAccounts() {
    const previous = accountSelect.control.value;
    accountSelect.control.replaceChildren();
    const accounts = Array.isArray(bridge?.chatgpt?.accounts) ? bridge.chatgpt.accounts : [];
    for (const account of accounts) { const option = node(doc, 'option', '', `${account.label || 'Saved account'}${account.active ? ' · active' : ''}`); option.value = account.id; accountSelect.control.appendChild(option); }
    const newAccount = node(doc, 'option', '', accounts.length ? 'Add another account…' : 'Connect a ChatGPT account'); newAccount.value = 'new'; accountSelect.control.appendChild(newAccount);
    accountSelect.control.value = accounts.some(item => item.id === previous) ? previous : bridge?.chatgpt?.activeAccountId || 'new';
  }
  async function loadModels() {
    if (destroyed || modelsController || !chatgptReady()) return;
    const accountId = bridge.chatgpt.activeAccountId;
    modelsController = new AbortController(); controls();
    try {
      const data = await request('/api/gpt/models', { signal: modelsController.signal });
      if (destroyed || accountId !== bridge?.chatgpt?.activeAccountId) return;
      if (!Array.isArray(data?.models)) throw new Error('The provider did not return a model list.');
      bridge = { ...bridge, models: [...(bridge.models || []).filter(item => item.provider !== 'chatgpt'), ...data.models] };
      renderModels(); say('Available ChatGPT models loaded for your connected account.');
    } catch (error) { if (!destroyed && error?.name !== 'AbortError') say(error?.message || 'Could not load models.', true); }
    finally { modelsController = null; if (!destroyed) controls(); }
  }
  async function sendMessage(event) {
    event?.preventDefault();
    if (destroyed || chatController || !ready() || !selectedModelReady() || !prompt.value.trim()) return;
    const text = prompt.value.trim();
    let payload;
    try {
      payload = buildGptChatRequest({ workspace: workspace.snapshot(), provider, model: modelSelect.control.value, prompt: text });
      if (provider === 'chatgpt') payload.accountId = bridge.chatgpt.activeAccountId;
    }
    catch (error) { say(error?.message || 'The message could not be prepared.', true); return; }
    const current = ++generation;
    chatController = new AbortController();
    try {
      workspace.appendMessage({ role: 'user', content: text }); prompt.value = ''; renderWorkspace(); say('Waiting for your selected provider…');
      const response = await request('/api/gpt/chat', { method: 'POST', body: payload, signal: chatController.signal });
      if (destroyed || current !== generation) return;
      if (typeof response?.content !== 'string' || !response.content.trim() || response.provider !== provider) throw new Error('The provider returned no usable assistant reply.');
      workspace.appendMessage({ role: 'assistant', content: response.content });
      bridge = { ...bridge, [provider]: { ...bridge[provider], state: 'verified' } };
      renderWorkspace(); say(`Reply received${response.model ? ` · ${response.model}` : ''}. ${workspace.snapshot().storageError ? 'Export to keep this conversation; browser storage is unavailable.' : 'Saved to this browser.'}`);
    } catch (error) {
      if (!destroyed && current === generation && error?.name !== 'AbortError') say(error?.message || 'Message failed. Your prompt remains in local history.', true);
    } finally { if (!destroyed && current === generation) { chatController = null; controls(); } }
  }
  async function startSignIn() {
    if (destroyed || authBusy || !localOrigin(windowRoot)) return;
    cancelChat();
    authBusy = true; controls();
    // Reserve a tab during the click gesture; asynchronous popups are often blocked.
    const authTab = openTab(windowRoot, 'about:blank');
    authController = new AbortController();
    try {
      const accountId = accountSelect.control.value;
      const body = { ...(accountId === 'new' ? { newAccount: true } : accountId ? { accountId } : {}), ...(planConsent.checked ? { enablePlan: true } : {}) };
      const data = await request('/api/gpt/sign-in', { method: 'POST', body, signal: authController.signal });
      if (destroyed) { authTab?.close?.(); return; }
      const url = new URL(data.authorizationUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.port || url.pathname !== '/api/accounts/authorize' || url.username || url.password) throw new Error('The bridge returned an unrecognized authorization address.');
      authLink.href = url.href; authLink.hidden = false;
      if (authTab) authTab.location.href = url.href;
      say(authTab ? 'Complete sign-in in the OpenAI tab, then return here. Status refreshes when this window regains focus.' : 'The sign-in tab was blocked. Use the authorization link in Account & setup, then refresh status.');
    } catch (error) {
      authTab?.close?.(); if (!destroyed && error?.name !== 'AbortError') say(error?.message || 'Sign-in could not start.', true);
    } finally { authController = null; authBusy = false; if (!destroyed) controls(); }
  }
  async function disconnectAccount() {
    if (destroyed || authBusy) return;
    cancelChat(); authBusy = true; controls(); authController = new AbortController();
    try {
      const result = await request('/api/gpt/disconnect', { method: 'POST', body: { accountId: bridge.chatgpt.activeAccountId }, signal: authController.signal });
      if (!destroyed) {
        authLink.hidden = true; await refresh();
        say(typeof result.message === 'string' ? result.message : result.remoteRevocationConfirmed === false ? 'Local credentials removed. Remote access revocation could not be confirmed; review connected apps in ChatGPT settings. Local conversations remain.' : 'ChatGPT disconnected from the local bridge. Local conversations remain.', result.remoteRevocationConfirmed === false);
      }
    }
    catch (error) { if (!destroyed && error?.name !== 'AbortError') say(error?.message || 'Disconnect failed.', true); }
    finally { authController = null; authBusy = false; if (!destroyed) controls(); }
  }
  function resetProfileForm() {
    editingProfileId = null;
    for (const entry of [nameField, urlField, instructionsField, knowledgeField]) entry.control.value = '';
    saveProfile.textContent = 'Save assistant'; cancelEdit.hidden = true;
  }
  function editProfile(profile) {
    editingProfileId = profile.id; nameField.control.value = profile.name; urlField.control.value = profile.url || '';
    instructionsField.control.value = profile.instructions || ''; knowledgeField.control.value = profile.knowledge || '';
    saveProfile.textContent = 'Update assistant'; cancelEdit.hidden = false; library.element.open = true; nameField.control.focus?.();
  }
  function exportHistory() {
    let objectUrl;
    try {
      const data = workspace.exportData();
      const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      const urlApi = windowRoot?.URL || globalThis.URL;
      const BlobType = windowRoot?.Blob || globalThis.Blob;
      objectUrl = urlApi.createObjectURL(new BlobType([content], { type: 'application/json' }));
      const anchor = node(doc, 'a'); anchor.href = objectUrl; anchor.download = 'my-gpt-local-data.json';
      host.appendChild(anchor); anchor.click(); anchor.remove();
      const timer = windowRoot?.setTimeout?.bind(windowRoot) || globalThis.setTimeout;
      timer(() => urlApi.revokeObjectURL(objectUrl), 1000);
      say('Export prepared: my-gpt-local-data.json. It contains your local conversation text and saved assistant notes.');
    } catch (error) { say(error?.message || 'Local export is unavailable in this browser.', true); }
  }
  composer.addEventListener('submit', sendMessage);
  prompt.addEventListener('input', controls);
  prompt.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) sendMessage(event); });
  profileSelect.control.addEventListener('change', () => mutateWorkspace(() => workspace.selectProfile(profileSelect.control.value)));
  modelSelect.control.addEventListener('change', () => cancelChat());
  accountSelect.control.addEventListener('change', () => { planConsent.checked = false; authLink.hidden = true; });
  profileForm.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const url = urlField.control.value.trim();
      if (url) normalizeGptUrl(url);
      cancelChat();
      workspace.saveProfile({ ...(editingProfileId ? { id: editingProfileId } : {}), name: nameField.control.value, url, instructions: instructionsField.control.value, knowledge: knowledgeField.control.value });
      resetProfileForm(); renderWorkspace(); say(workspace.snapshot().storageError ? 'Assistant updated for this session. Export your data to preserve it while browser storage is unavailable.' : 'Assistant saved locally. Its notes are included only when you send a message with that assistant selected.');
    } catch (error) { say(error?.message || 'Assistant could not be saved.', true); }
  });
  importField.control.addEventListener('change', async () => {
    const file = importField.control.files?.[0]; if (!file || destroyed) return;
    try {
      if (file.size > GPT_LIMITS.importBytes) throw new Error('This import is larger than 2 MB. Choose a smaller conversations JSON file.');
      const content = await file.text(); if (destroyed) return;
      const parsed = JSON.parse(content); cancelChat(); workspace.importConversations(parsed); renderWorkspace(); say('Conversations imported into this browser. Nothing was sent to a provider.');
    } catch (error) { say(error?.message || 'The selected JSON could not be imported.', true); }
    finally { importField.control.value = ''; }
  });
  const onFocus = () => { if (activated && !destroyed) refresh(); };
  windowRoot?.addEventListener?.('focus', onFocus);
  renderWorkspace(); renderAccounts(); renderModels(); controls();
  return Object.freeze({
    refresh,
    setActive(active) { if (active) title.setAttribute('data-autofocus', 'true'); else title.removeAttribute('data-autofocus'); },
    activate() { if (!activated) return refresh(); return Promise.resolve(bridge); },
    completeSignIn() { return refresh().then(() => { if (chatgptReady()) return loadModels(); return null; }); },
    // Readiness can be observed without copying any assistant notes or chat.
    readiness() { return { provider, connected: ready(), pending: Boolean(chatController), state: bridge?.[provider]?.state ?? 'unavailable', persistence: 'local-browser' }; },
    snapshot() { return { provider, connected: ready(), pending: Boolean(chatController), workspace: workspace.snapshot() }; },
    destroy() {
      if (destroyed) return;
      destroyed = true; generation += 1; statusGeneration += 1;
      chatController?.abort(); statusController?.abort(); authController?.abort(); modelsController?.abort();
      windowRoot?.removeEventListener?.('focus', onFocus); root.remove(); style.remove();
    },
  });
}
