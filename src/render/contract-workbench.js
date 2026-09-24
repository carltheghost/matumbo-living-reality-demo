/**
 * Accessible control surface for the contract organism. The engine owns every
 * mutation; this surface renders snapshots and never treats a button as a
 * signature, an identity check, a payment, or a verified external observation.
 */
const clone = (value) => JSON.parse(JSON.stringify(value));
const readable = (value) => String(value ?? '').replaceAll('_', ' ');
const dateLabel = (value) => value == null ? 'Not set' : new Date(value).toLocaleString();
const dateInputValue = (value) => value == null ? '' : new Date(value - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function parseContractValue(value, type = 'string') {
  if (type === 'boolean') {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new TypeError('Choose true or false for boolean evidence.');
  }
  if (type === 'number') {
    if (String(value).trim() === '' || !Number.isFinite(Number(value))) throw new TypeError('Enter a finite number.');
    return Number(value);
  }
  return String(value);
}

// Provider outcome names are explicit data, never parsed from a title, score,
// home/away ordering, winner flag or the template's YES/NO positions.
export function publicEventOutcomeNames(event) {
  const values = Array.isArray(event?.outcomes) ? event.outcomes : Array.isArray(event?.participants) ? event.participants.map((entry) => entry?.name) : [];
  if (values.length !== 2 || values.some((value) => typeof value !== 'string' || !value.trim() || value.trim().length > 48)) return [];
  const names = values.map((value) => value.trim().toUpperCase());
  return new Set(names).size === 2 ? names : [];
}

export function buildWorkbenchContract({ templateId, title, creator, parties, terms }) {
  const names = Array.isArray(parties) ? parties : String(parties).split(',');
  const cleanParties = [...new Set(names.map((name) => String(name).trim()).filter(Boolean))];
  const cleanCreator = String(creator ?? '').trim();
  if (!String(title ?? '').trim()) throw new TypeError('Give your contract a title.');
  if (!cleanCreator || !cleanParties.includes(cleanCreator)) throw new TypeError('Include the creator in the required approvers.');
  if (!cleanParties.length) throw new TypeError('Add at least one required approver.');
  const resolvedTerms = clone(terms);
  // Template role placeholders follow the user's named participants. Explicit
  // names already present in the party list are never silently reassigned.
  const aliases = { owner: cleanCreator, reviewer: cleanParties.find((party) => party !== cleanCreator) ?? cleanCreator };
  const resolveRole = (role) => !cleanParties.includes(role) && Object.hasOwn(aliases, role) ? aliases[role] : role;
  for (const rule of resolvedTerms.rules ?? []) for (const effect of rule.actions ?? []) {
    for (const key of ['from', 'to', 'subject']) if (effect[key] !== undefined) effect[key] = resolveRole(effect[key]);
  }
  for (const position of resolvedTerms.prediction?.positions ?? []) position.actor = resolveRole(position.actor);
  return { templateId, title: String(title).trim(), creator: cleanCreator, parties: cleanParties, terms: resolvedTerms };
}

export function mountContractWorkbench({ root, engine, onSelect = null, onRefreshEvidence = null, getPublicEvents = null, documentRoot = root?.ownerDocument ?? globalThis.document } = {}) {
  if (!root || !documentRoot?.createElement || !engine?.listTemplates) throw new TypeError('Contract workbench requires a root and contract engine.');
  const templates = engine.listTemplates();
  if (!templates.length) throw new TypeError('Contract workbench requires at least one template.');
  let persistenceState = engine.snapshot?.().persistence;
  let destroyed = false;
  let selectedId = null;
  let activeTab = 'library';
  let currentTemplate = templates[0];
  let sourceRows = [];
  let ruleRows = [];
  let detailRevision = '';
  let listRevision = '';
  let evidenceSequence = 0;
  const actorChoices = new Map();
  const pendingEvidenceRefreshes = new Set();
  const evidenceRefreshButtons = new Map();
  const detailDrafts = new Map();
  let renderedRecordId = null;
  let localActionDepth = 0;

  function node(tag, className, text) {
    const el = documentRoot.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }
  function listen(el, type, handler) {
    el.addEventListener(type, handler);
  }
  function button(text, action, className = '') {
    const el = node('button', `cw-button ${className}`, text);
    el.type = 'button';
    if (action) listen(el, 'click', action);
    return el;
  }
  function input(name, value = '', type = 'text') {
    const el = node('input');
    el.name = name;
    el.type = type;
    el.value = String(value ?? '');
    if (type === 'text') el.maxLength = 500;
    return el;
  }
  function select(name, items, value) {
    const el = node('select');
    el.name = name;
    for (const item of items) {
      const option = node('option', '', item.label ?? item.value ?? item);
      option.value = item.value ?? item;
      el.append(option);
    }
    if (value != null) el.value = String(value);
    return el;
  }
  function field(label, control, hint = null) {
    const wrap = node('label', 'cw-field');
    wrap.append(node('span', 'cw-label', label), control);
    if (hint) wrap.append(node('small', 'cw-hint', hint));
    return wrap;
  }
  function group(title, subtitle = null) {
    const el = node('fieldset', 'cw-group');
    el.append(node('legend', '', title));
    if (subtitle) el.append(node('p', 'cw-hint', subtitle));
    return el;
  }
  function nextKey(rows, prefix) {
    let sequence = 1;
    while (rows.some((row) => row.id.value === `${prefix}_${sequence}`)) sequence += 1;
    return `${prefix}_${sequence}`;
  }
  function action(fn, message) {
    localActionDepth += 1;
    try {
      const result = fn();
      if (result?.then) return result.then(() => { announce(message); refresh(); }).catch((error) => announce(error.message, true));
      announce(message);
      refresh();
      return result;
    } catch (error) { announce(error.message, true); return null; }
    finally { localActionDepth -= 1; }
  }
  function announce(message, failed = false) {
    feedback.textContent = message;
    feedback.dataset.tone = failed ? 'error' : 'success';
    feedback.setAttribute('role', failed ? 'alert' : 'status');
  }
  const shell = node('section', 'contract-workbench');
  shell.setAttribute('aria-label', 'Living contract workbench');
  const head = node('header', 'cw-head');
  const titleWrap = node('div');
  titleWrap.append(node('span', 'cw-eyebrow', 'COVENANT / AUTOMATION'), node('h3', '', 'Living contracts'));
  const count = node('span', 'cw-count', '0 objects');
  head.append(titleWrap, count);
  const selectedSummary = node('header', 'cw-selected-summary');
  const selectedTitle = node('h4');
  const selectedStatus = node('span', 'cw-state');
  selectedSummary.append(selectedTitle, selectedStatus);
  selectedSummary.hidden = true;
  const boundary = node('details', 'cw-authority');
  boundary.append(node('summary', '', 'Simulation · no real funds/signatures'), node('p', 'cw-boundary', 'Approvals are local role selections, not verified signatures. No real payments or legal enforcement. Automation runs while this app is open and catches up on return; there is no background service.'));
  const tabs = node('div', 'cw-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Workbench views');
  const libraryButton = button('Your contracts', () => showTab('library'));
  const createButton = button('Create contract', () => showTab('create'));
  tabs.append(libraryButton, createButton);
  const feedback = node('p', 'cw-feedback');
  feedback.setAttribute('aria-live', 'polite');
  const deferredUpdate = node('p', 'cw-hint cw-deferred-update');
  deferredUpdate.setAttribute('role', 'status');
  deferredUpdate.hidden = true;
  const persistence = node('p', 'cw-persistence cw-hint');
  const storageAlert = node('p', 'cw-storage-alert');
  storageAlert.setAttribute('role', 'alert');
  storageAlert.hidden = true;
  const portability = node('details', 'cw-advanced cw-portability');
  portability.append(node('summary', '', 'Offline backup & restore'), persistence);
  portability.append(node('p', 'cw-hint', 'A backup contains local terms, role approvals, evidence and receipts. It is not a signed legal document. Import is allowed only into an empty workspace and cannot overwrite history.'));
  const download = button('Download backup JSON', () => action(() => {
    if (!engine.exportState) throw new Error('This engine does not support export.');
    const urlAPI = documentRoot.defaultView?.URL ?? globalThis.URL;
    if (!urlAPI?.createObjectURL || typeof Blob !== 'function') throw new Error('Downloads are unavailable in this environment.');
    const url = urlAPI.createObjectURL(new Blob([engine.exportState()], { type: 'application/json' }));
    const link = node('a');
    link.href = url; link.download = 'matumbo-contracts-backup.json';
    documentRoot.body?.append(link);
    link.click(); link.remove();
    setTimeout(() => urlAPI.revokeObjectURL(url), 1000);
  }, 'Backup download requested. Store it privately; it contains your local agreement history.'));
  const backupFile = input('backup-file', '', 'file');
  backupFile.accept = '.json,application/json';
  const backupText = node('textarea');
  backupText.name = 'backup-json'; backupText.rows = 4; backupText.maxLength = 4000000;
  const restore = button('Import into empty workspace', () => action(async () => {
    if (!engine.importState) throw new Error('This engine does not support import.');
    if (engine.list().length) throw new Error('Import requires an empty workspace. Existing contracts cannot be overwritten.');
    const file = backupFile.files?.[0];
    if (file && file.size > 4000000) throw new Error('Backup files must be smaller than 4 MB.');
    const serialized = file ? await file.text() : backupText.value;
    if (!serialized.trim()) throw new Error('Select a JSON backup or paste its contents first.');
    if (serialized.length > 4000000) throw new Error('Backup JSON exceeds the import size limit.');
    engine.importState(serialized);
    backupText.value = ''; backupFile.value = ''; detailRevision = ''; listRevision = '';
  }, 'Validated backup imported. Original local history is preserved.'));
  portability.append(download, field('Choose a backup file', backupFile), field('Or paste backup JSON', backupText), restore);
  const library = node('div', 'cw-library');
  const list = node('div', 'cw-list');
  list.setAttribute('aria-label', 'Saved contracts');
  const libraryPicker = node('details', 'cw-library-picker');
  const pickerSummary = node('summary', '', 'Switch contract');
  libraryPicker.append(pickerSummary, list);
  const detail = node('div', 'cw-detail');
  library.append(libraryPicker, detail);
  const form = node('form', 'cw-composer');
  form.hidden = true;
  form.noValidate = true;
  const templateSelect = select('templateId', templates.map((template) => ({ value: template.id, label: template.label })), currentTemplate.id);
  const description = node('p', 'cw-template-description');
  const titleInput = input('title');
  const creatorInput = input('creator', 'owner');
  const partiesInput = input('parties', 'owner, reviewer');
  const identity = group('01 / Choose the agreement');
  identity.append(field('Contract family', templateSelect), description, field('Title', titleInput), field('Creator / local role', creatorInput), field('Required approvers', partiesInput, 'Comma-separated local roles. Every listed role must approve the exact same terms.'));
  const sourcesGroup = group('02 / What counts as evidence?', 'Name the facts this agreement needs. Evidence is manually recorded here and is not provider-verified.');
  const sourcesList = node('div', 'cw-source-list');
  const addSourceButton = button('+ Add evidence source', () => addSource({ id: nextKey(sourceRows, 'fact'), label: 'New fact', type: 'boolean', maxAgeMs: 86400000 }));
  sourcesGroup.append(sourcesList, addSourceButton);
  const rulesGroup = group('03 / Conditions & milestones', 'Each segment is a rule. Approval arms the rules; matching fresh evidence or a due schedule creates a local receipt automatically.');
  const rulesList = node('div', 'cw-rule-list');
  const addRuleButton = button('+ Add milestone / rule', () => addRule({ id: nextKey(ruleRows, 'rule'), label: 'New milestone', when: { op: 'eq', source: sourceRows[0]?.id.value ?? 'fact', value: true }, actions: [{ type: 'record', label: 'Record milestone completion' }] }));
  rulesGroup.append(rulesList, addRuleButton);
  const timing = group('04 / Timing & advanced terms');
  const startsInput = input('startsAt', '', 'datetime-local');
  const expiresInput = input('expiresAt', '', 'datetime-local');
  const budgetInput = input('maxTotalPoints', 1000, 'number');
  const executionsInput = input('maxExecutions', 100, 'number');
  budgetInput.min = '0'; executionsInput.min = '1';
  timing.append(field('Not before (optional)', startsInput), field('Expires at (optional)', expiresInput), field('Maximum simulated points across all effects', budgetInput), field('Maximum automatic executions', executionsInput));
  const prediction = group('Prediction pool · simulated points only');
  const predictionOutcomes = input('prediction-outcomes');
  const predictionResult = input('prediction-result-source');
  const predictionPositions = node('textarea');
  predictionPositions.name = 'prediction-positions';
  predictionPositions.rows = 4;
  prediction.append(field('Outcome labels', predictionOutcomes, 'Comma-separated; stored in UPPERCASE. Public sports results require both exact participant names. YES/NO never means home/away automatically.'), field('Result evidence source key', predictionResult), field('Participant positions', predictionPositions, 'One position per line: local role, chosen outcome, simulated points. Choose each position yourself; changing event names never moves a participant to a different outcome automatically.'));
  timing.append(prediction);
  const advanced = node('details', 'cw-advanced');
  advanced.append(node('summary', '', 'Advanced JSON terms · nested logic & local effects'));
  const advancedEnabled = input('advancedEnabled', '', 'checkbox');
  const advancedText = node('textarea');
  advancedText.name = 'advancedTerms';
  advancedText.rows = 12;
  advancedText.spellcheck = false;
  advanced.append(field('Use JSON instead of the fields above', advancedEnabled), field('Terms JSON', advancedText, 'The engine validates these terms. Enabling this uses the JSON exactly, including dates and rules.'));
  advanced.append(button('Copy current fields into JSON', () => action(() => { advancedText.value = JSON.stringify(readTerms(false), null, 2); }, 'Current terms copied into the JSON editor.')));
  timing.append(advanced);
  const submit = node('button', 'cw-button cw-primary', 'Create & request approvals');
  submit.type = 'submit';
  form.append(identity, sourcesGroup, rulesGroup, timing, submit);
  shell.append(head, selectedSummary, boundary, tabs, storageAlert, feedback, deferredUpdate, library, form, portability);
  root.append(shell);

  function showTab(tab) {
    activeTab = tab;
    library.hidden = tab !== 'library';
    form.hidden = tab !== 'create';
    libraryButton.setAttribute('aria-pressed', String(tab === 'library'));
    createButton.setAttribute('aria-pressed', String(tab === 'create'));
    // Public-preview must not reload a user who is writing a draft.
    form.dataset.previewDirty = tab === 'create' ? 'true' : 'false';
    syncSelectedChrome(selectedId ? engine.get(selectedId) : null);
  }
  function syncSelectedChrome(record) {
    const showSelection = Boolean(record) && activeTab === 'library';
    head.hidden = showSelection;
    selectedSummary.hidden = !showSelection;
    if (record) {
      selectedTitle.textContent = record.title;
      selectedStatus.textContent = readable(record.status);
      selectedStatus.dataset.state = record.status;
    }
  }
  function findPublicEvent(id) {
    if (typeof getPublicEvents !== 'function') return null;
    try {
      const events = getPublicEvents();
      if (!Array.isArray(events)) return null;
      const matches = events.filter((event) => event?.id === id);
      return matches.length === 1 ? matches[0] : null;
    } catch { return null; }
  }
  function syncPredictionEditor() {
    prediction.hidden = !ruleRows.some((row) => row.effects.some((effect) => effect.type.value === 'settle_prediction'));
    for (const row of sourceRows) row.syncBinding?.();
  }
  function syncPredicateGuidance() { for (const row of ruleRows) row.syncPredicate?.(); }
  function addSource(source) {
    const wrap = node('div', 'cw-source-row');
    const row = {
      wrap, id: input('source-id', source.id), label: input('source-label', source.label ?? source.id),
      type: select('source-type', ['boolean', 'number', 'string'], source.type ?? 'boolean'),
      provider: select('source-provider', [{ value: 'manual', label: 'Manual test evidence' }, { value: 'local', label: 'Local event adapter' }, { value: 'public', label: 'Public observation adapter' }], source.provider ?? 'manual'),
      eventId: input('source-event-id', source.binding?.eventId ?? ''),
      age: input('source-max-age', Number(source.maxAgeMs ?? 86400000) / 60000, 'number'),
      original: clone(source),
    };
    row.age.min = '0.001';
    row.age.step = 'any';
    row.eventId.maxLength = 160;
    wrap.append(field('Source key', row.id), field('Description', row.label), field('Value type', row.type), field('Freshness · minutes', row.age), field('Evidence route', row.provider, 'The manual form only writes manual sources. Other routes need an actual connected adapter.'));
    const publicBinding = node('div', 'cw-public-binding');
    publicBinding.append(field('ESPN event ID (optional)', row.eventId, 'Binds this source to one read-only ESPN result observation, not independently verified. Requires a string value type. An empty ID leaves the source unconnected.'));
    const participantHelp = node('p', 'cw-hint');
    const copyOutcomeNames = button('Use loaded participant names as outcomes', () => action(() => {
      const names = publicEventOutcomeNames(findPublicEvent(row.eventId.value.trim()));
      if (names.length !== 2) throw new Error('Two distinct participant names are not available for this exact event. Enter verified outcome names explicitly; no names or result will be guessed.');
      predictionOutcomes.value = names.join(', ');
      predictionResult.value = row.id.value.trim();
      for (const rule of ruleRows) if (rule.simple && rule.source.value.trim() === row.id.value.trim() && rule.op.value === 'in') rule.value.value = JSON.stringify([...names, 'DRAW', 'VOID']);
      syncBinding();
    }, 'Participant names copied. Existing positions were not reassigned: review each local role’s chosen outcome before creating. No result or winner was inferred.'), 'cw-subtle');
    if (typeof getPublicEvents === 'function') {
      const available = select('source-public-event', [{ value: '', label: 'Choose an event already loaded in this app' }], '');
      const eventFeedback = node('p', 'cw-hint');
      function populateEvents() {
        try {
          const events = getPublicEvents();
          if (!Array.isArray(events)) throw new TypeError('The available-events adapter did not return an event list.');
          available.replaceChildren();
          const empty = node('option', '', events.length ? 'Choose an event already loaded in this app' : 'No events loaded yet');
          empty.value = ''; available.append(empty);
          for (const event of events) {
            if (!event || typeof event.id !== 'string' || !event.id || event.id.length > 160) continue;
            const option = node('option', '', `${event.label ?? event.id}${event.status ? ` · ${event.status}` : ''}`);
            option.value = event.id; available.append(option);
          }
          available.value = row.eventId.value;
          eventFeedback.textContent = 'Only events already loaded in this app are listed. Reloading this list does not fetch new results.';
          syncBinding();
        } catch (error) { eventFeedback.textContent = `Available events could not be read: ${error.message}`; }
      }
      listen(available, 'change', () => { if (available.value) row.eventId.value = available.value; syncBinding(); });
      publicBinding.append(field('Select from the loaded feed', available), button('Reload available event options', populateEvents, 'cw-subtle'), eventFeedback);
      // Run after the binding help has been constructed below.
      row.populateEvents = populateEvents;
    }
    const bindingWarning = node('p', 'cw-hint');
    function syncBinding() {
      publicBinding.hidden = row.provider.value !== 'public';
      bindingWarning.textContent = row.type.value === 'string' ? 'The event ID and adapter become frozen terms when you create this agreement.' : 'Choose the string value type before binding an ESPN result. Other public-source types remain unconnected.';
      const names = publicEventOutcomeNames(findPublicEvent(row.eventId.value.trim()));
      participantHelp.textContent = names.length === 2 ? `Loaded outcome names: ${names.join(' / ')}. These names identify participants, not a winner or a YES/NO mapping.` : 'No unique pair of loaded participant names is available for this exact event. A title or home/away ordering is not enough to infer outcome labels.';
      copyOutcomeNames.hidden = prediction.hidden;
      copyOutcomeNames.disabled = names.length !== 2;
    }
    row.syncBinding = syncBinding;
    listen(row.provider, 'change', syncBinding); listen(row.type, 'change', () => { syncBinding(); syncPredicateGuidance(); }); listen(row.eventId, 'input', syncBinding);
    listen(row.id, 'input', syncPredicateGuidance); listen(row.label, 'input', syncPredicateGuidance);
    publicBinding.append(bindingWarning, participantHelp, copyOutcomeNames);
    syncBinding();
    row.populateEvents?.();
    wrap.append(publicBinding);
    const remove = button('Remove source', () => { sourceRows = sourceRows.filter((item) => item !== row); wrap.remove(); syncPredicateGuidance(); });
    remove.className += ' cw-subtle';
    wrap.append(remove);
    sourceRows.push(row);
    sourcesList.append(wrap);
    syncPredicateGuidance();
  }
  function addRule(rule) {
    const wrap = node('div', 'cw-rule-row');
    const simple = rule.when && typeof rule.when.source === 'string' && !Array.isArray(rule.when.conditions);
    const row = {
      wrap, original: clone(rule), simple,
      id: input('rule-id', rule.id), label: input('rule-label', rule.label ?? rule.id),
      after: input('rule-after', (rule.after ?? []).join(', ')),
      source: input('rule-source', simple ? rule.when.source : ''),
      op: select('rule-op', [{ value: 'eq', label: 'Equals' }, { value: 'neq', label: 'Does not equal' }, { value: 'gt', label: 'Greater than' }, { value: 'gte', label: 'At least' }, { value: 'lt', label: 'Less than' }, { value: 'lte', label: 'At most' }, { value: 'in', label: 'One of (JSON list)' }, { value: 'exists', label: 'Fresh evidence exists' }], simple ? rule.when.op : 'eq'),
      value: input('rule-value', simple ? (rule.when.op === 'in' ? JSON.stringify(rule.when.value) : rule.when.value) : ''),
      every: input('rule-every', Number(rule.schedule?.everyMs ?? 0) / 60000, 'number'),
      runs: input('rule-runs', rule.schedule?.maxRuns ?? 1, 'number'),
      effects: [],
    };
    row.every.min = '0'; row.every.step = 'any'; row.runs.min = '1'; row.runs.max = '1000';
    wrap.append(node('span', 'cw-segment-index', `RULE ${ruleRows.length + 1}`), field('Milestone / rule name', row.label), field('Rule key', row.id), field('After these rule keys (optional)', row.after, 'Comma-separated keys of earlier rules; each must complete before this rule runs. Forward references and cycles are rejected.'));
    if (simple) {
      const predicate = node('div', 'cw-predicate');
      const expected = field('Expected value', row.value);
      const typedHelp = node('p', 'cw-hint');
      function syncPredicate() {
        const source = sourceRows.find((entry) => entry.id.value.trim() === row.source.value.trim());
        expected.hidden = row.op.value === 'exists';
        row.value.disabled = row.op.value === 'exists';
        if (!source) typedHelp.textContent = 'No declared source has this key. Add or select an evidence source before creating.';
        else if (row.op.value === 'exists') typedHelp.textContent = `${source.label.value || source.id.value}: any fresh ${source.type.value} observation satisfies this rule; there is no expected-value comparison.`;
        else if (row.op.value === 'in') typedHelp.textContent = `Use a JSON array of ${source.type.value} values, such as ${source.type.value === 'number' ? '[1,2,3]' : source.type.value === 'boolean' ? '[true,false]' : '["A","B"]'}.`;
        else if (['gt', 'gte', 'lt', 'lte'].includes(row.op.value) && source.type.value !== 'number') typedHelp.textContent = 'Ordered comparisons require a number source. Change the value type or choose Equals / Does not equal.';
        else typedHelp.textContent = source.type.value === 'boolean' ? 'Boolean source: enter true or false.' : source.type.value === 'number' ? 'Numeric source: enter a finite number.' : 'Text source: matches the exact text value, including case.';
      }
      row.syncPredicate = syncPredicate;
      listen(row.source, 'input', syncPredicate); listen(row.op, 'change', syncPredicate);
      syncPredicate();
      predicate.append(field('Evidence source key', row.source), field('Comparison', row.op), expected, typedHelp);
      wrap.append(predicate);
    } else {
      wrap.append(node('p', 'cw-hint', 'This template has compound or time-based logic. It is preserved unchanged; use Advanced JSON to edit it.'), node('pre', 'cw-logic-preview', JSON.stringify(rule.when, null, 2)));
    }
    const effectsHost = node('div', 'cw-effects');
    function addEffect(effect = { type: 'record', label: 'Record completion' }) {
      const effectWrap = node('div', 'cw-effect-row');
      const controls = {
        original: clone(effect), wrap: effectWrap,
        type: select('effect-type', ['record', 'simulated_transfer', 'release_escrow', 'grant_access', 'revoke_access', 'settle_prediction'].map((value) => ({ value, label: readable(value) })), effect.type),
        label: input('effect-label', effect.label ?? 'Local execution receipt'),
        from: input('effect-from', effect.from ?? 'owner'), to: input('effect-to', effect.to ?? 'reviewer'),
        amount: input('effect-amount', effect.amount ?? 100, 'number'),
        subject: input('effect-subject', effect.subject ?? 'reviewer'), resource: input('effect-resource', effect.resource ?? 'workspace'),
        duration: input('effect-duration', effect.durationMs ? effect.durationMs / 60000 : '', 'number'),
      };
      controls.amount.min = '0'; controls.duration.min = '0';
      const money = node('div', 'cw-effect-fields');
      money.append(field('From local role', controls.from), field('To local role', controls.to), field('Simulated points', controls.amount));
      const access = node('div', 'cw-effect-fields');
      const durationField = field('Duration · minutes (optional)', controls.duration);
      access.append(field('Subject local role', controls.subject), field('Resource identifier', controls.resource), durationField);
      const explanation = node('p', 'cw-hint');
      const effectLabel = field('Receipt label', controls.label);
      function syncEffect() {
        money.hidden = !['simulated_transfer', 'release_escrow'].includes(controls.type.value);
        access.hidden = !['grant_access', 'revoke_access'].includes(controls.type.value);
        durationField.hidden = controls.type.value !== 'grant_access';
        effectLabel.hidden = controls.type.value === 'settle_prediction';
        explanation.textContent = controls.type.value === 'settle_prediction' ? 'Allocates simulated pool points using the configured positions and result source. It does not pay or transfer money.' : 'This creates local simulation state and a traceable receipt only.';
        syncPredictionEditor();
      }
      effectWrap.append(field('Then · local effect', controls.type), effectLabel, money, access, explanation, button('Remove effect', () => { row.effects = row.effects.filter((entry) => entry !== controls); effectWrap.remove(); syncPredictionEditor(); }, 'cw-subtle'));
      listen(controls.type, 'change', syncEffect);
      syncEffect();
      row.effects.push(controls);
      effectsHost.append(effectWrap);
      syncPredictionEditor();
    }
    for (const effect of rule.actions ?? [{ type: 'record', label: 'Record completion' }]) addEffect(effect);
    const repeatHint = node('p', 'cw-hint');
    function syncRecurrence() {
      row.runs.disabled = !(Number(row.every.value) > 0);
      repeatHint.textContent = row.runs.disabled ? 'One execution only. Set an interval of at least 1/60 minute to enable bounded repetition.' : 'Repetition is finite and still requires fresh evidence. Automation catches up while the app is open or when it returns.';
    }
    listen(row.every, 'input', syncRecurrence); syncRecurrence();
    wrap.append(effectsHost, button('+ Add local effect', () => addEffect(), 'cw-subtle'), field('Repeat interval · minutes (0 = once)', row.every), field('Maximum runs', row.runs), repeatHint);
    wrap.append(button('Remove rule', () => { ruleRows = ruleRows.filter((item) => item !== row); wrap.remove(); syncPredictionEditor(); }, 'cw-subtle'));
    ruleRows.push(row);
    rulesList.append(wrap);
    syncPredictionEditor();
  }
  function loadTemplate(override = null) {
    currentTemplate = override?.defaults ? override : templates.find((template) => template.id === templateSelect.value) ?? templates[0];
    description.textContent = currentTemplate.description;
    sourceRows = []; ruleRows = [];
    sourcesList.replaceChildren(); rulesList.replaceChildren();
    for (const source of currentTemplate.defaults.sources ?? []) addSource(source);
    for (const rule of currentTemplate.defaults.rules ?? []) addRule(rule);
    startsInput.value = dateInputValue(currentTemplate.defaults.startsAt); expiresInput.value = dateInputValue(currentTemplate.defaults.expiresAt);
    budgetInput.value = String(currentTemplate.defaults.limits?.maxTotalPoints ?? 1000);
    executionsInput.value = String(currentTemplate.defaults.limits?.maxExecutions ?? 100);
    predictionOutcomes.value = (currentTemplate.defaults.prediction?.outcomes ?? ['YES', 'NO']).join(', ');
    predictionResult.value = currentTemplate.defaults.prediction?.resultSource ?? currentTemplate.defaults.sources.find((source) => source.type === 'string')?.id ?? '';
    predictionPositions.value = (currentTemplate.defaults.prediction?.positions ?? [{ actor: 'owner', outcome: 'YES', points: 10 }, { actor: 'reviewer', outcome: 'NO', points: 10 }]).map((position) => `${position.actor}, ${position.outcome}, ${position.points}`).join('\n');
    syncPredictionEditor();
    advancedEnabled.checked = false;
    advancedText.value = JSON.stringify(currentTemplate.defaults, null, 2);
  }
  function readTerms(honorAdvanced = true) {
    if (honorAdvanced && advancedEnabled.checked) return JSON.parse(advancedText.value);
    const terms = clone(currentTemplate.defaults);
    terms.sources = sourceRows.map((row) => {
      const source = { ...row.original, id: row.id.value.trim(), label: row.label.value.trim(), type: row.type.value, provider: row.provider.value, maxAgeMs: Number(row.age.value) * 60000 };
      delete source.binding;
      if (source.provider === 'public' && row.eventId.value.trim()) {
        if (source.type !== 'string') throw new TypeError('ESPN result bindings require a string evidence source.');
        source.binding = { adapter: 'espn-result', eventId: row.eventId.value.trim() };
      }
      return source;
    });
    terms.rules = ruleRows.map((row) => {
      const rule = { ...clone(row.original), id: row.id.value.trim(), label: row.label.value.trim() };
      const dependencies = [...new Set(row.after.value.split(',').map((value) => value.trim()).filter(Boolean))];
      if (dependencies.length) rule.after = dependencies; else delete rule.after;
      if (row.simple) {
        const source = terms.sources.find((item) => item.id === row.source.value.trim());
        if (!source) throw new TypeError(`Rule ${rule.label} refers to an unknown evidence source.`);
        rule.when = { op: row.op.value, source: source.id };
        if (row.op.value === 'in') {
          const values = JSON.parse(row.value.value);
          if (!Array.isArray(values)) throw new TypeError('The “in” comparison needs a JSON array of allowed values.');
          rule.when.value = values.map((value) => parseContractValue(value, source.type));
        } else if (row.op.value !== 'exists') rule.when.value = parseContractValue(row.value.value, source.type);
      }
      rule.actions = row.effects.map((effect) => {
        const value = { type: effect.type.value, label: effect.label.value.trim() };
        if (value.type === 'settle_prediction') delete value.label;
        if (['simulated_transfer', 'release_escrow'].includes(value.type)) Object.assign(value, { from: effect.from.value.trim(), to: effect.to.value.trim(), amount: parseContractValue(effect.amount.value, 'number') });
        if (['grant_access', 'revoke_access'].includes(value.type)) {
          Object.assign(value, { subject: effect.subject.value.trim(), resource: effect.resource.value.trim() });
          if (value.type === 'grant_access' && effect.duration.value.trim()) value.durationMs = parseContractValue(effect.duration.value, 'number') * 60000;
        }
        return value;
      });
      const everyMs = Number(row.every.value) * 60000;
      if (!Number.isFinite(everyMs) || everyMs < 0) throw new TypeError('Repeat intervals must be non-negative.');
      if (everyMs > 0) rule.schedule = { ...(rule.schedule ?? {}), everyMs, maxRuns: Number(row.runs.value) };
      else delete rule.schedule;
      return rule;
    });
    terms.startsAt = startsInput.value ? new Date(startsInput.value).getTime() : null;
    terms.expiresAt = expiresInput.value ? new Date(expiresInput.value).getTime() : null;
    terms.limits = { ...terms.limits, maxTotalPoints: parseContractValue(budgetInput.value, 'number'), maxExecutions: parseContractValue(executionsInput.value, 'number') };
    if (terms.rules.some((rule) => rule.actions.some((effect) => effect.type === 'settle_prediction'))) {
      terms.prediction = {
        ...terms.prediction,
        outcomes: predictionOutcomes.value.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean),
        resultSource: predictionResult.value.trim(),
        positions: predictionPositions.value.split('\n').filter((line) => line.trim()).map((line) => {
          const parts = line.split(',').map((value) => value.trim());
          if (parts.length !== 3 || !parts[0] || !parts[1]) throw new TypeError('Each prediction position needs role, outcome, simulated points.');
          return { actor: parts[0], outcome: parts[1].toUpperCase(), points: parseContractValue(parts[2], 'number') };
        }),
      };
      for (const rule of terms.rules) if (rule.actions.some((effect) => effect.type === 'settle_prediction') && rule.when.op === 'in' && rule.when.source === terms.prediction.resultSource) {
        rule.when.value = [...new Set([...terms.prediction.outcomes, 'DRAW', 'VOID'])];
      }
      const boundResult = terms.sources.find((source) => source.id === terms.prediction.resultSource && source.binding?.adapter === 'espn-result');
      const loadedNames = publicEventOutcomeNames(findPublicEvent(boundResult?.binding.eventId));
      if (loadedNames.length === 2 && (terms.prediction.outcomes.length !== 2 || !loadedNames.every((name) => terms.prediction.outcomes.includes(name)))) throw new TypeError(`Public result outcomes must be the loaded participant names: ${loadedNames.join(', ')}. YES/NO is not an inferred winner mapping.`);
    } else delete terms.prediction;
    return terms;
  }
  listen(templateSelect, 'change', loadTemplate);
  listen(form, 'submit', (event) => {
    event.preventDefault();
    action(() => {
      const record = engine.create(buildWorkbenchContract({ templateId: currentTemplate.id, title: titleInput.value, creator: creatorInput.value, parties: partiesInput.value, terms: readTerms() }));
      selectedId = record.id;
      detailRevision = '';
      showTab('library');
      onSelect?.(record);
    }, 'Contract created. Required approvals will arm its automatic rules.');
  });

  function selectRecord(id) {
    captureDetailDraft();
    selectedId = id;
    detailRevision = '';
    refresh({ force: true });
    onSelect?.(engine.get(id));
  }
  function appendFact(parent, label, value) {
    const row = node('div', 'cw-fact');
    row.append(node('span', 'cw-hint', label), node('strong', '', value));
    parent.append(row);
  }
  function elements(parent) { return [parent, ...Array.from(parent.children ?? []).flatMap(elements)]; }
  function currentDraft(id) {
    if (!detailDrafts.has(id)) detailDrafts.set(id, { evidence: {}, sections: {} });
    return detailDrafts.get(id);
  }
  function captureDetailDraft() {
    if (!renderedRecordId) return;
    const draft = currentDraft(renderedRecordId);
    const controls = elements(detail);
    const values = new Map(controls.filter((entry) => entry.name).map((entry) => [entry.name, entry.value]));
    if (values.has('actor')) actorChoices.set(renderedRecordId, values.get('actor'));
    if (values.has('dispute-reason')) draft.reason = values.get('dispute-reason');
    if (values.has('evidence-source')) {
      draft.source = values.get('evidence-source');
      draft.evidence[draft.source] = values.get('evidence-value');
    }
    for (const element of controls) if (element.dataset.cwSection) draft.sections[element.dataset.cwSection] = element.open;
  }
  function restoreSection(section, key, draft, defaultOpen = false) {
    section.dataset.cwSection = key;
    section.open = draft.sections[key] ?? defaultOpen;
  }
  function preserveScroll(callback) {
    const positions = [];
    for (let element = detail; element; element = element.parentNode) {
      if (typeof element.scrollTop === 'number') positions.push([element, element.scrollTop, element.scrollLeft]);
    }
    callback();
    for (const [element, top, left] of positions) { element.scrollTop = top; element.scrollLeft = left; }
  }
  function renderDetail(record) {
    captureDetailDraft();
    renderedRecordId = record?.id ?? null;
    detail.replaceChildren();
    if (!record) {
      detail.append(node('div', 'cw-empty', 'Create an agreement. Its conditions, approvals and automatic receipts stay connected to one saved object.'));
      return;
    }
    const draft = currentDraft(record.id);
    const reuseTerms = button('Reuse terms in a new contract', () => {
      templateSelect.value = record.templateId;
      loadTemplate({ ...templates.find((template) => template.id === record.templateId), defaults: clone(record.terms) });
      titleInput.value = `${record.title} / new agreement`;
      creatorInput.value = record.creator; partiesInput.value = record.parties.join(', ');
      showTab('create');
      announce('Terms copied into a new draft. Existing history is unchanged; new approval is required. Review the dates before creating.');
    }, 'cw-subtle');
    const segments = node('ol', 'cw-lifecycle');
    const stages = ['Created', 'Approved', 'Armed', 'Receipts'];
    stages.forEach((stage, index) => {
      const segment = node('li', '', stage);
      segment.dataset.complete = String(index === 0 || (index === 1 && record.approvals.length === record.parties.length) || (index === 2 && ['active', 'completed'].includes(record.status)) || (index === 3 && record.receipts.length > 0));
      segments.append(segment);
    });
    detail.append(segments, node('p', 'cw-evaluation', record.evaluation?.reason ?? 'Awaiting evaluation.'));
    const facts = node('div', 'cw-facts');
    appendFact(facts, 'Approvals', `${record.approvals.length} / ${record.parties.length}`);
    appendFact(facts, 'Local receipts', String(record.receipts.length));
    appendFact(facts, 'Expires', dateLabel(record.terms.expiresAt));
    detail.append(facts, reuseTerms);

    const actor = select('actor', record.parties, actorChoices.get(record.id) ?? record.parties[0]);
    listen(actor, 'change', () => actorChoices.set(record.id, actor.value));
    const operations = group('Approval & controls', 'Selecting a role simulates that participant locally. It is not authentication. Terms are fixed after creation.');
    operations.append(field('Act as local role', actor));
    const approvalList = node('div', 'cw-approval-list');
    for (const party of record.parties) {
      const approved = record.approvals.some((entry) => entry.actor === party);
      approvalList.append(node('span', approved ? 'cw-approved' : 'cw-pending', `${approved ? '✓' : '○'} ${party}`));
    }
    operations.append(approvalList);
    const actions = node('div', 'cw-actions');
    if (record.status === 'pending_approval') actions.append(button('Approve as selected role', () => action(() => engine.approve(record.id, { actor: actor.value }), 'Approval recorded. The engine activates automatically after the final approval.'), 'cw-primary'));
    if (record.status === 'active') actions.append(button('Pause automation', () => action(() => engine.pause(record.id, { actor: actor.value }), 'Automation paused.')));
    if (record.status === 'paused') actions.append(button('Resume automation', () => action(() => engine.resume(record.id, { actor: actor.value }), 'Automation resumed.')));
    const terminal = ['completed', 'cancelled', 'expired'].includes(record.status);
    if (!terminal && record.status !== 'disputed') actions.append(button('Cancel agreement', () => action(() => engine.cancel(record.id, { actor: actor.value }), 'Agreement cancelled. No future local effects will run.'), 'cw-danger'));
    operations.append(actions);
    if (!terminal) {
      const dispute = node('details', 'cw-advanced');
      restoreSection(dispute, 'dispute', draft);
      dispute.append(node('summary', '', record.status === 'disputed' ? 'Resolve dispute' : 'Raise a dispute'));
      const reason = input('dispute-reason', draft.reason ?? '');
      dispute.append(field('Reason (required)', reason));
      const requireReason = (fn) => {
        if (!reason.value.trim()) throw new TypeError('Add a reason so the history explains this decision.');
        return fn();
      };
      if (record.status === 'disputed') {
        dispute.append(node('p', 'cw-hint', 'Each required role must record the same resolution. A single vote cannot restart or cancel a disputed agreement.'));
        for (const vote of record.dispute?.resolutions ?? []) dispute.append(node('p', 'cw-hint', `${vote.actor}: ${vote.resolution}`));
        for (const resolution of ['resume', 'cancel']) dispute.append(button(`Agree to ${resolution}`, () => action(() => requireReason(() => engine.resolveDispute(record.id, { actor: actor.value, resolution, reason: reason.value.trim() })), `Resolution vote recorded: ${resolution}. All parties must agree before the state changes.`)));
      } else dispute.append(button('Dispute & stop automation', () => action(() => requireReason(() => engine.dispute(record.id, { actor: actor.value, reason: reason.value.trim() })), 'Dispute recorded. Automation is stopped.')));
      operations.append(dispute);
    }
    detail.append(operations);

    const rules = group('The agreement surface', 'Each rule is a meaningful segment: its condition, local effect and receipts belong together.');
    for (const rule of record.terms.rules) {
      const segment = node('article', 'cw-rule-summary');
      const receipts = record.receipts.filter((receipt) => receipt.ruleId === rule.id);
      segment.dataset.complete = String(receipts.length > 0);
      segment.append(node('h5', '', rule.label ?? rule.id), node('code', 'cw-condition', describePredicate(rule.when)), node('p', 'cw-hint', rule.actions.map((effect) => effect.label ?? effect.type).join(' · ')));
      segment.append(node('span', 'cw-rule-count', rule.schedule ? `${receipts.length} / ${rule.schedule.maxRuns} runs · every ${rule.schedule.everyMs / 60000} min` : receipts.length ? 'Receipt recorded' : 'Waiting for condition'));
      if (rule.after?.length) segment.append(node('span', 'cw-hint', `Requires completed rules: ${rule.after.join(', ')}`));
      rules.append(segment);
    }
    detail.append(rules);

    const manualSources = record.terms.sources.filter((source) => !source.provider || source.provider === 'manual');
    if (manualSources.length && !terminal) {
      const evidenceForm = node('form', 'cw-evidence');
      evidenceForm.noValidate = true;
      const evidenceGroup = group('Record local evidence', 'Manual test evidence only. No network observation, proof of delivery, identity or payment is verified by this form.');
      const sourceSelect = select('evidence-source', manualSources.map((source) => ({ value: source.id, label: `${source.label ?? source.id} · ${source.type}` })), manualSources.some((source) => source.id === draft.source) ? draft.source : manualSources[0].id);
      const valueHost = node('div');
      let valueControl;
      let previousSourceId;
      function updateValueControl() {
        if (valueControl && previousSourceId) draft.evidence[previousSourceId] = valueControl.value;
        const source = record.terms.sources.find((item) => item.id === sourceSelect.value);
        valueControl = source.type === 'boolean' ? select('evidence-value', ['false', 'true'], 'false') : input('evidence-value', '', source.type === 'number' ? 'number' : 'text');
        if (draft.evidence[source.id] !== undefined) valueControl.value = draft.evidence[source.id];
        if (source.type === 'number') valueControl.step = 'any';
        previousSourceId = source.id;
        valueHost.replaceChildren(field('Observed value', valueControl));
      }
      listen(sourceSelect, 'change', updateValueControl);
      updateValueControl();
      const saveEvidence = node('button', 'cw-button cw-primary', 'Record evidence & evaluate');
      saveEvidence.type = 'submit';
      evidenceGroup.append(field('Evidence source', sourceSelect), valueHost, saveEvidence);
      evidenceForm.append(evidenceGroup);
      listen(evidenceForm, 'submit', (event) => {
        event.preventDefault();
        action(() => {
          const source = record.terms.sources.find((item) => item.id === sourceSelect.value);
          engine.observe({ id: `manual:${record.id}:${Date.now()}:${++evidenceSequence}`, contractId: record.id, source: source.id, provider: 'manual', value: parseContractValue(valueControl.value, source.type), observedAt: Date.now() });
        }, 'Local evidence recorded. The engine evaluated approved rules automatically.');
      });
      detail.append(evidenceForm);
    }
    if (record.terms.sources.some((source) => source.provider && source.provider !== 'manual')) detail.append(node('p', 'cw-boundary', 'This agreement also requires adapter evidence. The manual form cannot impersonate a public or local adapter; without a connected adapter these conditions remain unknown.'));
    const boundSources = record.terms.sources.filter((source) => source.provider === 'public' && source.binding?.adapter === 'espn-result');
    if (boundSources.length) {
      const connections = group('Connected public evidence', 'Read-only ESPN observations, not independently verified. The provider result must match the frozen event ID; missing or incomplete results do not satisfy a condition.');
      for (const source of boundSources) {
        const latest = (record.evidence ?? []).filter((entry) => entry.source === source.id && entry.provider === 'public').sort((a, b) => b.observedAt - a.observedAt)[0];
        const connection = node('div', 'cw-connection');
        connection.append(node('strong', '', source.label ?? source.id), node('code', '', `ESPN event ${source.binding.eventId}`));
        if (latest) {
          connection.append(node('span', 'cw-hint', `Last recorded result: ${String(latest.value)} · ${dateLabel(latest.observedAt)}`));
          if (latest.provenance?.url) connection.append(node('span', 'cw-hint', `Observation source: ${latest.provenance.url}`));
        } else connection.append(node('span', 'cw-hint', 'No result observation recorded.'));
        connections.append(connection);
      }
      if (typeof onRefreshEvidence === 'function' && !terminal) {
        const refreshEvidence = button('Refresh connected evidence', async () => {
          if (pendingEvidenceRefreshes.has(record.id)) return;
          pendingEvidenceRefreshes.add(record.id);
          refreshEvidence.disabled = true;
          announce('Checking connected result observations…');
          try {
            const previousIds = new Set((engine.get(record.id)?.evidence ?? []).map((entry) => entry.id));
            const result = await onRefreshEvidence({ contractId: record.id, bindings: boundSources.map((source) => ({ sourceId: source.id, ...source.binding })) });
            if (destroyed) return;
            const reported = Number.isInteger(result?.observed) && result.observed >= 0 ? result.observed : null;
            const observed = (engine.get(record.id)?.evidence ?? []).filter((entry) => !previousIds.has(entry.id) && entry.provider === 'public' && boundSources.some((source) => source.id === entry.source)).length;
            const pending = Number.isInteger(result?.pending) && result.pending >= 0 ? result.pending : null;
            const errors = Array.isArray(result?.errors) ? result.errors.map((error) => typeof error === 'string' ? error : error?.message ?? String(error)).filter(Boolean) : [];
            if (reported > observed) errors.push(`The adapter reported ${reported} observations, but only ${observed} new public observations are saved on this contract.`);
            const message = observed === 0 && reported === null ? 'Refresh finished without an observation count. No new evidence is confirmed.' : observed === 0 ? 'No new result observations recorded.' : `${observed} read-only result ${observed === 1 ? 'observation' : 'observations'} recorded. Approved rules were evaluated.`;
            announce(`${message}${pending ? ` ${pending} ${pending === 1 ? 'result is' : 'results are'} still pending.` : ''}${errors.length ? ` ${errors.join(' · ')}` : ''}`, errors.length > 0);
            refresh();
          } catch (error) { if (!destroyed) announce(`Connected evidence could not be refreshed: ${error.message}`, true); }
          finally {
            pendingEvidenceRefreshes.delete(record.id);
            refreshEvidence.disabled = false;
            const currentButton = evidenceRefreshButtons.get(record.id);
            if (currentButton) currentButton.disabled = false;
          }
        });
        refreshEvidence.disabled = pendingEvidenceRefreshes.has(record.id);
        evidenceRefreshButtons.set(record.id, refreshEvidence);
        connections.append(refreshEvidence);
      } else if (!terminal) connections.append(node('p', 'cw-hint', 'No refresh adapter is connected to this workbench. This source will remain unknown until real observations are supplied.'));
      detail.append(connections);
    }
    const history = node('details', 'cw-history');
    restoreSection(history, 'history', draft, true);
    history.append(node('summary', '', `Receipts & history · ${record.history.length} events`));
    const receiptList = node('div', 'cw-receipts');
    if (!record.receipts.length) receiptList.append(node('p', 'cw-hint', 'No execution receipts yet. Approval alone is not evidence that a condition was met.'));
    for (const receipt of [...record.receipts].reverse().slice(0, 30)) {
      const item = node('article', 'cw-receipt');
      item.append(node('strong', '', `Local receipt / ${receipt.ruleId}`), node('small', '', dateLabel(receipt.at)), node('code', '', receipt.id), node('pre', '', JSON.stringify(receipt.effects ?? [], null, 2)));
      receiptList.append(item);
    }
    const log = node('ol', 'cw-event-log');
    for (const event of [...record.history].reverse().slice(0, 50)) {
      const item = node('li');
      item.append(node('strong', '', readable(event.type ?? event.action)), node('small', '', `${dateLabel(event.at)}${event.actor ? ` · ${event.actor}` : ''}`));
      if (event.reason ?? event.detail?.reason) item.append(node('span', '', event.reason ?? event.detail.reason));
      log.append(item);
    }
    const raw = node('details', 'cw-advanced');
    restoreSection(raw, 'raw', draft);
    raw.append(node('summary', '', 'Inspect complete saved object / provenance'), node('pre', 'cw-raw-record', JSON.stringify(record, null, 2)));
    history.append(receiptList, log, raw);
    detail.append(history);
  }

  function refresh({ force = false } = {}) {
    if (destroyed) return;
    const records = engine.list();
    count.textContent = `${records.length} ${records.length === 1 ? 'object' : 'objects'}`;
    const storage = persistenceState;
    persistence.textContent = storage?.status === 'error' ? `Storage error: ${storage.error}. Changes cannot be assumed saved.` : storage?.mode === 'durable' ? 'Saved on this device · export a backup to carry the history elsewhere.' : 'Memory-only workspace · export a backup before leaving.';
    persistence.dataset.tone = storage?.status === 'error' ? 'error' : 'info';
    storageAlert.hidden = storage?.status !== 'error';
    if (!storageAlert.hidden) storageAlert.textContent = persistence.textContent;
    restore.disabled = records.length > 0 || !engine.importState;
    download.disabled = !engine.exportState;
    if (!selectedId || !records.some((record) => record.id === selectedId)) selectedId = records[0]?.id ?? null;
    libraryPicker.hidden = records.length < 2;
    pickerSummary.textContent = `Switch contract · ${records.length} saved`;
    const nextListRevision = JSON.stringify(records.map((record) => [record.id, record.title, record.status, record.approvals.length, record.receipts.length, selectedId === record.id]));
    if (listRevision !== nextListRevision) {
      listRevision = nextListRevision;
      list.replaceChildren();
      for (const record of records) {
        const item = button('', () => selectRecord(record.id), 'cw-list-item');
        item.setAttribute('aria-pressed', String(record.id === selectedId));
        item.append(node('strong', '', record.title), node('span', 'cw-hint', `${readable(record.status)} · ${record.receipts.length} receipts`));
        list.append(item);
      }
      if (!records.length) list.append(node('p', 'cw-hint', 'No saved contracts yet.'));
    }
    const record = records.find((item) => item.id === selectedId);
    syncSelectedChrome(record);
    const nextDetailRevision = JSON.stringify(record ?? null);
    // Engine heartbeats do not rebuild native controls or disturb active input.
    // Actual lifecycle changes do refresh the selected object and its history.
    if (detailRevision !== nextDetailRevision) {
      const focused = documentRoot.activeElement;
      const editing = focused && ['INPUT', 'SELECT', 'TEXTAREA'].includes(focused.tagName) && elements(detail).includes(focused);
      if (!force && localActionDepth === 0 && renderedRecordId === record?.id && editing) {
        deferredUpdate.hidden = false;
        deferredUpdate.textContent = `Live state: ${readable(record.status)}. Your in-progress input is preserved; the surface will refresh when you leave the field.`;
        return;
      }
      detailRevision = nextDetailRevision;
      deferredUpdate.hidden = true;
      preserveScroll(() => renderDetail(record));
    }
  }
  listen(detail, 'focusout', () => { Promise.resolve().then(() => refresh()); });
  loadTemplate();
  showTab('library');
  const unsubscribe = engine.subscribe?.((snapshot) => { if (snapshot?.persistence) persistenceState = snapshot.persistence; refresh(); });
  refresh();
  return {
    refresh,
    select: selectRecord,
    getSnapshot: () => ({ selectedId, activeTab, count: engine.list().length, localOnly: true, simulation: true }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (typeof unsubscribe === 'function') unsubscribe();
      sourceRows = []; ruleRows = [];
      actorChoices.clear();
      detailDrafts.clear();
      pendingEvidenceRefreshes.clear(); evidenceRefreshButtons.clear();
      shell.replaceChildren();
      shell.remove();
    },
  };
}

export function describePredicate(predicate) {
  if (!predicate) return 'No condition';
  if (predicate.source) return `${predicate.source} ${predicate.op} ${predicate.value === undefined ? '' : JSON.stringify(predicate.value)}`.trim();
  if (['and', 'or', 'all', 'any'].includes(predicate.op)) return (predicate.conditions ?? predicate.args ?? []).map(describePredicate).join(` ${['all', 'and'].includes(predicate.op) ? 'AND' : 'OR'} `);
  if (predicate.op === 'not') return `NOT (${describePredicate(predicate.condition ?? predicate.arg)})`;
  if (predicate.op === 'time') return `Time condition: ${JSON.stringify(predicate)}`;
  return JSON.stringify(predicate);
}
