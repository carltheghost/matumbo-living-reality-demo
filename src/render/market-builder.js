import { createMarketBook } from '../domains/market-engine.js?v=20260922-cache2';

const STORAGE_KEY = 'matumbo.contract-workshop.v1';
const MAX_QUERY = 160;

const clone = (value) => typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value));

function text(value, fallback = '—') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function appendText(documentRoot, tag, value, className = '') {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

function safeDate(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'Not set';
}

function localDateInput(value) {
  const at = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(at)) return '';
  return new Date(at - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function recordId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `market:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
}

function hasFormSupport(documentRoot) {
  // Minimal DOM fixtures intentionally omit native form APIs.
  return Boolean(documentRoot.defaultView?.HTMLFormElement);
}

export function mountMarketBuilder({
  documentRoot,
  panel,
  getSource,
  getContracts = () => [],
  onOpenContract = null,
} = {}) {
  if (!hasFormSupport(documentRoot)) return null;

  const root = documentRoot.createElement('details');
  root.id = 'market-builder';
  root.className = 'marketplace-surface';
  root.open = true;
  const heading = documentRoot.createElement('summary');
  heading.textContent = 'Marketplace · local listings';
  root.append(heading);

  const note = appendText(documentRoot, 'p', 'Browse local contract-linked listings and inspect their terms. This workspace is simulation-only: no purchase, custody, payout, signing, trade or settlement is available.');
  note.className = 'marketplace-boundary';
  root.append(note);

  const sourceLink = documentRoot.createElement('a');
  sourceLink.href = '?feature=multi-sport-events';
  sourceLink.textContent = 'Open public sports evidence → select a record for provenance';
  sourceLink.className = 'marketplace-source-link';
  root.append(sourceLink);

  const status = appendText(documentRoot, 'p', '');
  status.className = 'marketplace-status';
  status.setAttribute('role', 'status');
  root.append(status);

  const workspace = documentRoot.createElement('div');
  workspace.className = 'marketplace-layout';
  root.append(workspace);

  const composer = documentRoot.createElement('form');
  composer.className = 'marketplace-composer';
  composer.noValidate = true;
  composer.append(
    appendText(documentRoot, 'h3', 'Create a local listing'),
    appendText(documentRoot, 'p', 'Create a reviewable listing from authored terms or a selected public observation. Creating a listing does not create a contract or authorize any transaction.', 'marketplace-hint'),
  );

  function field(labelText, tag = 'input', type = 'text') {
    const label = documentRoot.createElement('label');
    label.className = 'marketplace-field';
    label.append(appendText(documentRoot, 'span', labelText, 'marketplace-label'));
    const control = documentRoot.createElement(tag);
    control.setAttribute('aria-label', labelText);
    if (tag === 'input') control.type = type;
    label.append(control);
    composer.append(label);
    return control;
  }

  function addOption(select, value, label) {
    const option = documentRoot.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }

  const origin = field('Source mode', 'select');
  addOption(origin, 'authored', 'Personal · authored terms');
  addOption(origin, 'provider', 'Public observation · selected evidence');
  const author = field('Creator label');
  author.maxLength = 64;
  const parent = field('Parent listing (optional)', 'select');
  const governing = field('Governing contract (optional)', 'select');
  const kind = field('Listing type', 'select');
  addOption(kind, 'single', 'Single local entry');
  addOption(kind, 'pool', 'Pool · multiple local entries');
  const question = field('Listing question');
  question.maxLength = 160;
  const terms = field('Terms and completion criteria', 'textarea');
  terms.maxLength = 4000;
  terms.rows = 5;
  const outcomes = field('Outcomes · one per line', 'textarea');
  outcomes.maxLength = 1000;
  outcomes.rows = 3;
  const closes = field('Close entries at', 'input', 'datetime-local');
  closes.value = localDateInput(Date.now() + 86400000);
  const sourceReadout = appendText(documentRoot, 'p', 'Authored listing · no public observation selected', 'marketplace-source-readout');
  composer.append(sourceReadout);
  const create = documentRoot.createElement('button');
  create.type = 'submit';
  create.className = 'marketplace-button marketplace-primary';
  create.textContent = 'Create local listing';
  composer.append(create);
  workspace.append(composer);

  const browse = documentRoot.createElement('section');
  browse.className = 'marketplace-browse';
  browse.append(appendText(documentRoot, 'h3', 'Browse listings'));
  const filters = documentRoot.createElement('div');
  filters.className = 'marketplace-filters';
  const searchLabel = documentRoot.createElement('label');
  searchLabel.className = 'marketplace-field';
  searchLabel.append(appendText(documentRoot, 'span', 'Search', 'marketplace-label'));
  const search = documentRoot.createElement('input');
  search.type = 'search';
  search.name = 'marketplace-search';
  search.placeholder = 'Question, terms or contract ID';
  search.maxLength = MAX_QUERY;
  searchLabel.append(search);
  filters.append(searchLabel);
  const state = documentRoot.createElement('select');
  state.name = 'marketplace-state';
  state.setAttribute('aria-label', 'Listing state');
  addOption(state, 'all', 'All states');
  addOption(state, 'open', 'Open');
  addOption(state, 'closed', 'Closed');
  filters.append(state);
  const provenance = documentRoot.createElement('select');
  provenance.name = 'marketplace-provenance';
  provenance.setAttribute('aria-label', 'Listing provenance');
  addOption(provenance, 'all', 'All provenance');
  addOption(provenance, 'authored', 'Authored');
  addOption(provenance, 'provider', 'Public observation');
  filters.append(provenance);
  browse.append(filters);
  const summary = documentRoot.createElement('p');
  summary.className = 'marketplace-summary';
  browse.append(summary);
  const list = documentRoot.createElement('div');
  list.className = 'marketplace-list';
  list.setAttribute('aria-label', 'Local marketplace listings');
  browse.append(list);
  workspace.append(browse);

  const detail = documentRoot.createElement('section');
  detail.className = 'marketplace-detail';
  detail.setAttribute('aria-live', 'polite');
  detail.append(appendText(documentRoot, 'h3', 'Listing detail'));
  workspace.append(detail);

  const controls = documentRoot.createElement('div');
  controls.className = 'marketplace-controls';
  const normalButton = documentRoot.createElement('button');
  normalButton.type = 'button';
  normalButton.className = 'marketplace-button';
  normalButton.textContent = 'List view';
  controls.append(normalButton);
  const cubeButton = documentRoot.createElement('button');
  cubeButton.type = 'button';
  cubeButton.className = 'marketplace-button';
  cubeButton.textContent = 'Cube view';
  controls.append(cubeButton);
  const exportButton = documentRoot.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'marketplace-button';
  exportButton.textContent = 'Export workspace';
  controls.append(exportButton);
  root.append(controls);

  const viewport = documentRoot.createElement('div');
  viewport.className = 'marketplace-cube-viewport';
  viewport.hidden = true;
  root.append(viewport);

  let book;
  let markets = [];
  let contracts = [];
  let selected = null;
  let searchQuery = '';
  let stateFilter = 'all';
  let provenanceFilter = 'all';
  let view = null;
  let storageRaw = null;
  let storageState = 'ready';
  let storageMessage = '';
  let unsubscribe = null;

  function storage() {
    try { return documentRoot.defaultView?.localStorage ?? null; } catch { return null; }
  }

  function readStorage() {
    const store = storage();
    if (!store) {
      storageState = 'unavailable';
      storageMessage = 'Browser storage is unavailable; new work remains memory-only. Export before leaving.';
      return [];
    }
    try {
      storageRaw = store.getItem(STORAGE_KEY);
      if (!storageRaw) return [];
      const parsed = JSON.parse(storageRaw);
      return createMarketBook(parsed).snapshot();
    } catch (error) {
      storageState = 'invalid';
      storageMessage = `Saved workspace could not be read (${error.message}); existing storage was not overwritten. Export new work before leaving.`;
      return [];
    }
  }

  function assertStorageCurrent() {
    if (storageState === 'stale') throw new Error('Saved workspace changed in another tab; refresh before changing local listings.');
    if (storageState !== 'ready') return;
    const current = storage()?.getItem(STORAGE_KEY) ?? null;
    if (current !== storageRaw) {
      storageState = 'stale';
      storageMessage = 'Saved workspace changed in another tab; this view is read-only until refreshed. Export any unsaved memory before leaving.';
      throw new Error(storageMessage);
    }
  }

  function setStorage(records) {
    if (storageState !== 'ready') return;
    const serialized = JSON.stringify(records);
    try {
      storage()?.setItem(STORAGE_KEY, serialized);
      storageRaw = serialized;
    } catch (error) {
      storageState = 'unavailable';
      storageMessage = `Workspace is memory-only (${error.message}); export before leaving.`;
    }
  }

  function safeContracts() {
    try {
      const value = getContracts?.();
      return Array.isArray(value) ? value.filter((record) => /^contract:[a-z0-9:_-]{1,160}$/i.test(record?.id ?? '')) : [];
    } catch { return []; }
  }

  function linkedContract(id) {
    return contracts.find((record) => record.id === id) ?? null;
  }

  function renderContractOptions() {
    const old = governing.value;
    governing.replaceChildren();
    addOption(governing, '', 'None · inspection only');
    for (const contract of contracts) addOption(governing, contract.id, `${contract.title} · ${contract.status}`);
    governing.value = contracts.some((record) => record.id === old) ? old : '';
  }

  function renderParentOptions() {
    const old = parent.value;
    parent.replaceChildren();
    addOption(parent, '', 'None · root listing');
    for (const market of markets) addOption(parent, market.id, `${market.question} · ${market.state}`);
    parent.value = markets.some((market) => market.id === old) ? old : '';
  }

  function refreshContracts() {
    contracts = safeContracts();
    renderContractOptions();
    render();
  }

  function selectedMarket() {
    return markets.find((market) => market.id === selected) ?? markets[0] ?? null;
  }

  function filteredMarkets() {
    const query = searchQuery.trim().toLowerCase();
    return markets.filter((market) => {
      if (stateFilter !== 'all' && market.state !== stateFilter) return false;
      if (provenanceFilter !== 'all' && market.origin !== provenanceFilter) return false;
      if (!query) return true;
      const governingRecord = linkedContract(market.governingContractId);
      const haystack = [
        market.id,
        market.question,
        market.terms,
        market.author,
        market.source?.title,
        market.source?.provider,
        market.governingContractId,
        governingRecord?.title,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  function setStatus(message, error = false) {
    const notice = storageState !== 'ready' && storageMessage && !String(message).includes(storageMessage)
      ? ` ${storageMessage}`
      : '';
    status.textContent = `${message}${notice}`;
    status.dataset.tone = error || Boolean(notice) || storageState !== 'ready' ? 'error' : 'info';
  }

  function updateSourceReadout() {
    const source = getSource?.();
    if (origin.value === 'provider') {
      sourceReadout.textContent = source
        ? `Public observation · ${text(source.title, source.id)} · ${text(source.provider)} · ${text(source.retrievedAt)}`
        : 'No public sports record selected. Choose one before creating a provider listing.';
      author.disabled = true;
    } else {
      sourceReadout.textContent = 'Authored listing · source is the creator’s local statement, not a provider observation.';
      author.disabled = false;
    }
  }

  function exportJSON(filename, value) {
    const urlAPI = documentRoot.defaultView?.URL ?? globalThis.URL;
    if (!urlAPI?.createObjectURL || typeof Blob !== 'function') throw new Error('Downloads are unavailable in this environment.');
    const link = documentRoot.createElement('a');
    const url = urlAPI.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    link.href = url;
    link.download = filename;
    documentRoot.body?.append(link);
    link.click();
    link.remove();
    setTimeout(() => urlAPI.revokeObjectURL(url), 1000);
  }

  function actionButton(label, action, className = '') {
    const button = documentRoot.createElement('button');
    button.type = 'button';
    button.className = `marketplace-button ${className}`.trim();
    button.textContent = label;
    button.addEventListener('click', () => {
      try { action(); render(); }
      catch (error) { setStatus(error.message, true); }
    });
    return button;
  }

  function renderSummary(visible) {
    const closed = markets.filter((market) => market.state === 'closed').length;
    const linked = markets.filter((market) => market.governingContractId).length;
    summary.textContent = `${visible.length} shown · ${markets.length} saved · ${linked} linked to contracts · ${closed} closed · local simulation only`;
  }

  function renderList(visible) {
    list.replaceChildren();
    if (!visible.length) {
      list.append(appendText(documentRoot, 'p', markets.length ? 'No listings match these filters.' : 'No local listings yet. Create one to make the marketplace surface useful.', 'marketplace-empty'));
      return;
    }
    for (const market of visible) {
      const card = documentRoot.createElement('article');
      card.className = 'marketplace-card';
      card.dataset.marketId = market.id;
      card.dataset.selected = String(selected === market.id);
      const select = actionButton('Inspect listing', () => { selected = market.id; }, selected === market.id ? 'marketplace-selected' : '');
      select.setAttribute('aria-pressed', String(selected === market.id));
      card.append(select);
      card.append(appendText(documentRoot, 'h4', market.question));
      card.append(appendText(documentRoot, 'p', `${market.state.toUpperCase()} · ${market.origin === 'authored' ? 'AUTHORED' : 'PUBLIC OBSERVATION'} · ${market.kind}`, 'marketplace-meta'));
      card.append(appendText(documentRoot, 'p', market.governingContractId ? `Governing contract · ${linkedContract(market.governingContractId)?.title ?? market.governingContractId}` : 'No governing contract linked · inspection only', 'marketplace-meta'));
      if (market.parentId) card.append(appendText(documentRoot, 'p', `Parent listing · ${markets.find((candidate) => candidate.id === market.parentId)?.question ?? market.parentId}`, 'marketplace-meta'));
      card.append(appendText(documentRoot, 'p', market.terms || 'No additional terms supplied.', 'marketplace-terms'));
      list.append(card);
    }
  }

  function renderDetail() {
    const market = selectedMarket();
    detail.replaceChildren(appendText(documentRoot, 'h3', 'Listing detail'));
    if (!market) {
      detail.append(appendText(documentRoot, 'p', 'Select a listing to inspect its governing contract, provenance, terms and simulated entries.', 'marketplace-empty'));
      return;
    }
    selected = market.id;
    const head = documentRoot.createElement('div');
    head.className = 'marketplace-detail-head';
    head.append(appendText(documentRoot, 'h4', market.question));
    const badge = appendText(documentRoot, 'span', market.state, 'marketplace-badge');
    badge.dataset.state = market.state;
    head.append(badge);
    detail.append(head);
    detail.append(appendText(documentRoot, 'p', 'Inspection only · no buy, trade, payout, custody, signing or settlement action is available.', 'marketplace-boundary'));

    const termsSection = documentRoot.createElement('section');
    termsSection.className = 'marketplace-detail-section';
    termsSection.append(appendText(documentRoot, 'h5', 'Terms & outcomes'));
    termsSection.append(appendText(documentRoot, 'p', market.terms || 'No additional terms supplied.'));
    const outcomeList = documentRoot.createElement('div');
    outcomeList.className = 'marketplace-outcomes';
    for (const outcome of market.outcomes) outcomeList.append(appendText(documentRoot, 'span', outcome, 'marketplace-outcome'));
    termsSection.append(outcomeList);
    detail.append(termsSection);

    const provenanceSection = documentRoot.createElement('section');
    provenanceSection.className = 'marketplace-detail-section';
    provenanceSection.append(appendText(documentRoot, 'h5', 'Provenance & timing'));
    provenanceSection.append(appendText(documentRoot, 'p', `${market.origin === 'authored' ? 'Creator' : 'Provider'} · ${text(market.source?.title)} · ${text(market.source?.provider)}`));
    provenanceSection.append(appendText(documentRoot, 'p', `Created ${safeDate(market.createdAt)} · entries close ${safeDate(market.closesAt)}`));
    if (market.parentId) provenanceSection.append(appendText(documentRoot, 'p', `Parent listing · ${markets.find((candidate) => candidate.id === market.parentId)?.question ?? market.parentId}`));
    const children = markets.filter((candidate) => candidate.parentId === market.id);
    if (children.length) provenanceSection.append(appendText(documentRoot, 'p', `Child listings · ${children.map((child) => child.question).join(' · ')}`));
    if (market.source?.sourceUrl) {
      const source = documentRoot.createElement('a');
      source.href = market.source.sourceUrl;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      source.textContent = 'Open recorded public source';
      provenanceSection.append(source);
    }
    detail.append(provenanceSection);

    const contractSection = documentRoot.createElement('section');
    contractSection.className = 'marketplace-detail-section';
    contractSection.append(appendText(documentRoot, 'h5', 'Governing contract'));
    const contract = linkedContract(market.governingContractId);
    if (!market.governingContractId) {
      contractSection.append(appendText(documentRoot, 'p', 'No governing contract is linked. This listing remains a standalone inspection record.', 'marketplace-hint'));
    } else if (!contract) {
      contractSection.append(appendText(documentRoot, 'p', `Linked ID ${market.governingContractId} is not present in the current Contract Atelier workspace. No contract was fabricated.`, 'marketplace-hint'));
    } else {
      contractSection.append(appendText(documentRoot, 'p', `${contract.title} · ${contract.status} · ${contract.approvals?.length ?? 0}/${contract.parties?.length ?? 0} approvals`));
      contractSection.append(actionButton('Open governing contract', () => onOpenContract?.({ contractId: contract.id, market: clone(market) }), 'marketplace-primary'));
    }
    detail.append(contractSection);

    const entriesSection = documentRoot.createElement('section');
    entriesSection.className = 'marketplace-detail-section';
    entriesSection.append(appendText(documentRoot, 'h5', `Simulated entries · ${market.entries.length}`));
    if (!market.entries.length) entriesSection.append(appendText(documentRoot, 'p', 'No local entries. Any entry here is a fictional rehearsal record, not a position or purchase.', 'marketplace-hint'));
    for (const entry of market.entries) entriesSection.append(appendText(documentRoot, 'p', `${entry.participant} → ${entry.outcome} · ${safeDate(entry.enteredAt)}`, 'marketplace-entry'));
    if (market.state === 'open') {
      const entryForm = documentRoot.createElement('form');
      entryForm.className = 'marketplace-entry-form';
      entryForm.noValidate = true;
      const participant = documentRoot.createElement('input');
      participant.name = 'participant';
      participant.maxLength = 64;
      participant.placeholder = 'Local participant label';
      participant.setAttribute('aria-label', 'Local participant label');
      const choice = documentRoot.createElement('select');
      choice.name = 'outcome';
      choice.setAttribute('aria-label', 'Simulated outcome');
      for (const outcome of market.outcomes) addOption(choice, outcome, outcome);
      const enter = documentRoot.createElement('button');
      enter.type = 'submit';
      enter.className = 'marketplace-button';
      enter.textContent = 'Add simulated entry';
      entryForm.append(participant, choice, enter);
      entryForm.addEventListener('submit', (event) => {
        event.preventDefault();
        try {
          assertStorageCurrent();
          book.enter(market.id, { participant: participant.value, outcome: choice.value });
          setStatus('Simulated entry recorded locally. No balance or settlement changed.');
        } catch (error) { setStatus(error.message, true); }
      });
      entriesSection.append(entryForm);
      entriesSection.append(actionButton('Close listing entries', () => {
        assertStorageCurrent();
        book.close(market.id);
        setStatus('Listing closed for simulated entries. It remains inspectable and unsettled.');
      }, 'marketplace-warning'));
    }
    entriesSection.append(actionButton('Export listing JSON', () => exportJSON('matumbo-local-listing.json', market)));
    detail.append(entriesSection);
  }

  function render() {
    markets = book.snapshot();
    if (!markets.some((market) => market.id === selected)) selected = markets[0]?.id ?? null;
    renderParentOptions();
    const visible = filteredMarkets();
    renderSummary(visible);
    renderList(visible);
    renderDetail();
    updateSourceReadout();
    root.dataset.storageState = storageState;
    root.dataset.previewDirty = storageState === 'ready' ? 'false' : 'true';
    if (storageMessage) setStatus(storageMessage, true);
    view?.update(markets, selected);
  }

  markets = readStorage();
  book = createMarketBook(markets);
  unsubscribe = book.subscribe((records) => {
    markets = records;
    setStorage(records);
    render();
  });
  contracts = safeContracts();
  renderContractOptions();

  origin.addEventListener('change', updateSourceReadout);
  search.addEventListener('input', () => { searchQuery = search.value.slice(0, MAX_QUERY); render(); });
  state.addEventListener('change', () => { stateFilter = state.value; render(); });
  provenance.addEventListener('change', () => { provenanceFilter = provenance.value; render(); });

  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const previousSelection = selected;
    const id = recordId();
    try {
      assertStorageCurrent();
      const source = getSource?.();
      selected = id;
      const market = book.create({
        // Select before create() notifies synchronously. Otherwise the
        // subscriber renders once with the previous card selected and the
        // detail render can overwrite the new selection.
        id,
        origin: origin.value,
        author: author.value,
        terms: terms.value,
        parentId: parent.value || null,
        governingContractId: governing.value || null,
        source: origin.value === 'provider' ? source : null,
        kind: kind.value,
        question: question.value,
        outcomes: outcomes.value.split('\n').map((value) => value.trim()).filter(Boolean),
        closesAt: closes.value,
      });
      selected = market.id;
      setStatus('Local listing created. Review its terms and governing contract; no transaction was created.');
    } catch (error) {
      selected = previousSelection;
      setStatus(error.message, true);
    }
  });

  normalButton.addEventListener('click', () => {
    viewport.hidden = true;
    view?.setVisible(false);
    setStatus('List view · one saved market book feeds both views.');
  });
  cubeButton.addEventListener('click', () => {
    viewport.hidden = false;
    if (view) { view.setVisible(true); view.update(markets, selected); return; }
    setStatus('Loading local listing geometry…');
    import('./market-constellation.js?v=20260922-cache2').then(({ mountMarketConstellation }) => {
      if (!view) view = mountMarketConstellation({ host: viewport, onSelect: (id) => { selected = id; render(); } });
      view.update(markets, selected);
    }).catch((error) => { viewport.hidden = true; setStatus(`3D unavailable: ${error.message}`, true); });
  });
  exportButton.addEventListener('click', () => {
    try { exportJSON('matumbo-contract-workspace.json', markets); setStatus('Workspace export requested. The file contains local listing history only.'); }
    catch (error) { setStatus(error.message, true); }
  });

  const legacy = documentRoot.createElement('details');
  const legacyTitle = documentRoot.createElement('summary');
  legacyTitle.textContent = 'Earlier graph inspector and provider draft tools';
  legacy.append(legacyTitle);
  const header = documentRoot.getElementById('contracts-markets-head');
  for (const child of [...panel.children]) if (child !== header) legacy.append(child);
  panel.append(root, legacy);

  render();
  const api = {
    getSnapshot: () => clone(markets),
    getSelection: () => selected,
    getCubeSnapshot: () => view?.getSnapshot?.() ?? null,
    refreshContracts,
    refresh: render,
    destroy: () => { unsubscribe?.(); view?.destroy?.(); root.remove(); legacy.remove(); },
  };
  documentRoot.defaultView.__TUMBO_MARKET_WORKSHOP__ = api;
  return api;
}
