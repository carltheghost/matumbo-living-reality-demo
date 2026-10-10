/** Quiet, inspectable API connections. Never accepts a browser API key. */
import { normalizeGptConnectionStatus, NETWORK_LOCAL_PLUGINS, REFERENCE_CURRENCIES, convertReferenceAmount } from '../domains/network-tools.js';
export const API_BRIDGE_DEFAULT_URL = 'http://127.0.0.1:8082';
export const API_CONNECTIONS_TIMEOUT_MS = 9_000;
export const API_CONNECTIONS_FX_FALLBACK = Object.freeze({
  id: 'fx', provider: 'ExchangeRate-API', url: 'https://open.er-api.com/v6/latest/EUR',
  docs: 'https://www.exchangerate-api.com/docs/free', attributionUrl: 'https://www.exchangerate-api.com',
  attributionLabel: 'Rates By Exchange Rate API',
  observedAt(data) {
    if (!Number.isSafeInteger(data?.time_last_update_unix) || data.time_last_update_unix <= 0) throw new Error('Exchange-rate update time is missing.');
    const date = new Date(data.time_last_update_unix * 1000);
    if (!Number.isFinite(date.getTime())) throw new Error('Exchange-rate update time is invalid.');
    return date.toISOString();
  },
  summarize(data) {
    if (data?.result !== 'success' || data.base_code !== 'EUR' || data.provider !== 'https://www.exchangerate-api.com') throw new Error('ExchangeRate-API returned invalid rate metadata.');
    const rates = ['USD', 'GBP'].map(quote => {
      const rate = data.rates?.[quote];
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) throw new Error('ExchangeRate-API rate fields are missing.');
      return `1 EUR = ${rate} ${quote}`;
    });
    return `${rates.join(' / ')} · provider update ${API_CONNECTIONS_FX_FALLBACK.observedAt(data)}`;
  },
});
export const API_CONNECTIONS_PROBES = Object.freeze([
  Object.freeze({ id: 'weather', label: 'Weather', provider: 'Open-Meteo',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m,weather_code&forecast_days=1',
    docs: 'https://open-meteo.com/en/terms',
    note: 'New York example · model weather · free noncommercial API',
    summarize(data) {
      if (typeof data?.current?.temperature_2m !== 'number' || !Number.isFinite(data.current.temperature_2m) || typeof data.current.time !== 'string') throw new Error('Weather fields are missing.');
      return `${data.current.temperature_2m} ${data.current_units?.temperature_2m ?? '°C'} · New York example · ${data.current.time}`;
    } }),
  Object.freeze({ id: 'fx', label: 'Exchange rates', provider: 'Frankfurter · ECB',
    url: 'https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=USD,GBP',
    docs: 'https://frankfurter.dev/', note: 'Daily central-bank reference rates · no API key',
    fallback: API_CONNECTIONS_FX_FALLBACK,
    observedAt(data) {
      const date = Array.isArray(data) ? data.find(row => row?.base === 'EUR' && ['USD', 'GBP'].includes(row.quote))?.date : null;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Reference-rate update date is missing or invalid.');
      return date;
    },
    summarize(data) {
      if (!Array.isArray(data)) throw new Error('Reference-rate rows are missing.');
      const rows = data.filter(row => row?.base === 'EUR' && ['USD', 'GBP'].includes(row.quote) && typeof row.rate === 'number' && Number.isFinite(row.rate) && row.rate > 0 && typeof row.date === 'string');
      if (!rows.length) throw new Error('Reference-rate fields are missing.');
      return rows.slice(0, 2).map(row => `1 EUR = ${row.rate} ${row.quote} · ${row.date}`).join(' / ');
    } }),
  Object.freeze({ id: 'earthquakes', label: 'Earthquake observations', provider: 'USGS',
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    docs: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php', note: 'Past-day public observations · no API key', feature: 'world-events',
    summarize(data) {
      if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Earthquake records are missing.');
      return `${data.features.length} observations in the provider feed`;
    } }),
  Object.freeze({ id: 'tvl', label: 'Protocol TVL', provider: 'DeFiLlama',
    url: 'https://api.llama.fi/tvl/aave', docs: 'https://api-docs.defillama.com/',
    note: 'Aave research observation · no API key', feature: 'asset-market',
    summarize(data) {
      if (typeof data !== 'number' || !Number.isFinite(data) || data < 0) throw new Error('TVL value is missing.');
      return `Aave TVL · ${new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(data)}`;
    } }),
]);

export const API_CONNECTIONS_EXISTING = Object.freeze([
  Object.freeze({ feature: 'gateway', label: 'All existing public feeds', description: 'World Pulse, tennis, market, TVL, sports, social and image metadata' }),
  Object.freeze({ feature: 'sports-events', label: 'Tennis & sports evidence', description: 'Public ESPN feeds · coverage varies' }),
  Object.freeze({ feature: 'asset-market', label: 'Asset market evidence', description: 'CoinGecko public reads · provider limits apply' }),
  Object.freeze({ feature: 'social-explorer', label: 'Social & image sources', description: 'Bluesky author feed and Wikimedia metadata in their own spaces' }),
  Object.freeze({ feature: 'web-ai', label: 'My GPT / Web + AI', description: 'ChatGPT account, OpenAI API and saved local conversations' }),
  Object.freeze({ feature: 'bot-plaza', label: 'Bot Plaza / local plugins', description: 'Lens Guide, Plan Helper and your saved local bots' }),
]);

export function resolveApiBridgeUrl(location) {
  try {
    const url = new URL(location?.href ?? String(location));
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return url.origin;
  } catch {}
  return null;
}

/** Presence of a key is configuration; only a successful inference verifies it. */
export function normalizeNvidiaStatus(data) {
  if (data?.service !== 'matumbo-provider-bridge' || data.version !== 1 || data.credentialsInBrowser !== false) throw new Error('This endpoint is not a recognized Reality Lens bridge.');
  const provider = Array.isArray(data.providers) ? data.providers.find(item => item?.id === 'nvidia') : null;
  if (!provider || typeof provider.model !== 'string' || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(provider.model)) throw new Error('The bridge returned invalid NVIDIA status.');
  const configured = provider.configured === true;
  const verifiedAt = configured && typeof provider.verifiedAt === 'string' && Number.isFinite(Date.parse(provider.verifiedAt)) ? provider.verifiedAt : null;
  const error = provider.state === 'error' && typeof provider.error?.message === 'string' ? provider.error.message.slice(0, 240) : null;
  return Object.freeze({ configured, model: provider.model, verifiedAt, error,
    state: !configured ? 'key-needed' : error ? 'error' : verifiedAt ? 'verified' : 'configured' });
}

async function readJson(fetchImpl, url, { signal, method = 'GET', body, timeoutMs = API_CONNECTIONS_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Browser fetch is unavailable.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new Error('Connection check cancelled.');
  signal?.addEventListener('abort', abort, { once: true });
  // Bound both fetch and JSON decoding, even if a transport ignores abort.
  let rejectAbort;
  const interrupted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new Error(signal?.aborted ? 'Connection check cancelled.' : 'Provider request timed out.'));
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  try {
    return await Promise.race([interrupted, (async () => {
    const response = await fetchImpl(url, { method, signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error',
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    let data;
    if (!response?.ok) {
      if (body) { try { data = await response.json(); } catch {} }
      const message = typeof data?.error?.message === 'string' ? data.error.message.slice(0, 240) : `Provider returned HTTP ${response?.status ?? 'error'}.`;
      const error = new Error(message); error.status = response?.status ?? null; throw error;
    }
    return await response.json();
    })()]);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(signal?.aborted ? 'Connection check cancelled.' : 'Provider request timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener('abort', onAbort);
    signal?.removeEventListener('abort', abort);
  }
}

export async function checkApiConnection(probe, { fetchImpl = globalThis.fetch, signal, timeoutMs = API_CONNECTIONS_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  const attempts = [];
  // Only FX has one reviewed alternate. Never retry a provider or follow a
  // response-supplied URL. Keep the primary failure in the returned envelope.
  const candidates = probe.id === 'fx' ? [probe, API_CONNECTIONS_FX_FALLBACK] : [probe];
  for (const [index, candidate] of candidates.entries()) {
    if (index && signal?.aborted) break;
    try {
      const data = await readJson(fetchImpl, candidate.url, { signal, timeoutMs });
      const summary = candidate.summarize(data);
      const observedAt = candidate.observedAt?.(data) ?? null;
      const checkedAt = new Date().toISOString();
      attempts.push(Object.freeze({ provider: candidate.provider, state: 'available', sourceUrl: candidate.url, checkedAt, observedAt, reason: null, httpStatus: 200 }));
      let observation = null;
      if (probe.id === 'fx') {
        const rates = { EUR: 1 };
        if (index) { rates.USD = data.rates.USD; rates.GBP = data.rates.GBP; }
        else for (const currency of ['USD', 'GBP']) {
          const matches = data.filter(row => row?.base === 'EUR' && row.quote === currency && row.date === observedAt);
          if (matches.length === 1 && typeof matches[0].rate === 'number' && Number.isFinite(matches[0].rate) && matches[0].rate > 0) rates[currency] = matches[0].rate;
        }
        observation = Object.freeze({ state: 'available', base: 'EUR', rates: Object.freeze(rates), observedAt, provider: candidate.provider, sourceUrl: candidate.url });
      }
      return Object.freeze({ id: probe.id, state: 'available', summary, provider: candidate.provider, observation,
        checkedAt, observedAt, latencyMs: Date.now() - startedAt, sourceUrl: candidate.url, documentationUrl: candidate.docs,
        fallbackUsed: index > 0, primarySourceUrl: probe.url, primaryState: attempts[0].state,
        attempts: Object.freeze(attempts), attributionUrl: candidate.attributionUrl ?? null, attributionLabel: candidate.attributionLabel ?? null });
    } catch (error) {
      attempts.push(Object.freeze({ provider: candidate.provider, state: 'unavailable', sourceUrl: candidate.url,
        checkedAt: new Date().toISOString(), observedAt: null, reason: String(error?.message ?? 'Provider unavailable.').slice(0, 240), httpStatus: Number.isInteger(error?.status) ? error.status : null }));
    }
  }
  const last = attempts.at(-1);
  return Object.freeze({ id: probe.id, state: 'unavailable', summary: attempts.map(attempt => `${attempt.provider}: ${attempt.reason}`).join(' / ').slice(0, 480),
    provider: last?.provider ?? probe.provider, checkedAt: new Date().toISOString(), observedAt: null,
    latencyMs: Date.now() - startedAt, sourceUrl: last?.sourceUrl ?? probe.url, documentationUrl: probe.docs,
    fallbackUsed: attempts.length > 1, primarySourceUrl: probe.url, primaryState: 'unavailable', attempts: Object.freeze(attempts), attributionUrl: null, attributionLabel: null });
}

function element(documentRoot, tag, className, text) {
  const node = documentRoot.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountApiConnections({ documentRoot = globalThis.document, windowRoot = globalThis.window, fetchImpl = globalThis.fetch, onOpenFeature = null, onOpen = null, autoCheck = false, getLocalTools = null } = {}) {
  if (!documentRoot?.body) return null;
  const previous = documentRoot.getElementById('api-connections-panel');
  if (previous) return null;
  const stylesheet = element(documentRoot, 'link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./api-connections.css?v=20261003-skin360', import.meta.url).href;
  documentRoot.head?.appendChild(stylesheet);
  const trigger = element(documentRoot, 'button', 'api-connections-trigger', 'Connections');
  trigger.id = 'api-connections-trigger'; trigger.type = 'button';
  trigger.setAttribute('aria-label', 'API connections');
  trigger.setAttribute('aria-controls', 'api-connections-panel'); trigger.setAttribute('aria-expanded', 'false');
  const panel = element(documentRoot, 'section', 'api-connections-panel');
  panel.id = 'api-connections-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'api-connections-title');
  const head = element(documentRoot, 'div', 'api-connections-head');
  const titleBlock = element(documentRoot, 'div');
  titleBlock.appendChild(element(documentRoot, 'span', 'api-connections-eyebrow', 'REALITY LENS'));
  const title = element(documentRoot, 'h2', '', 'Connections & tools'); title.id = 'api-connections-title';
  titleBlock.appendChild(title);
  titleBlock.appendChild(element(documentRoot, 'p', '', 'Your assistants, local helpers and public sources. Choose a tool; see what it needs.'));
  const closeButton = element(documentRoot, 'button', 'api-connections-close', '×'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Close connections');
  head.append(titleBlock, closeButton); panel.appendChild(head);
  const body = element(documentRoot, 'div', 'api-connections-body'); panel.appendChild(body);
  const checkBar = element(documentRoot, 'div', 'api-connections-checkbar');
  const checkButton = element(documentRoot, 'button', 'api-connections-button primary', 'Check connections'); checkButton.type = 'button';
  const checkStatus = element(documentRoot, 'span', 'api-connections-status', 'No public requests yet.'); checkStatus.setAttribute('role', 'status');
  const cancelButton = element(documentRoot, 'button', 'api-connections-button', 'Stop waiting'); cancelButton.type = 'button'; cancelButton.hidden = true;
  checkBar.append(checkButton, cancelButton, checkStatus); body.appendChild(checkBar);
  function openFeature(id, options = {}) {
    close();
    if (typeof onOpenFeature === 'function') onOpenFeature(id, options);
    else if (windowRoot?.location) { const target = new URL(windowRoot.location.href); target.searchParams.set('feature', id); if (options.provider) target.searchParams.set('gpt-provider', options.provider); windowRoot.location.href = target.href; }
  }
  const assistantSection = element(documentRoot, 'section', 'api-connections-section');
  assistantSection.appendChild(element(documentRoot, 'h3', '', 'My GPT'));
  const assistantRows = new Map();
  for (const [id, label, note] of [['chatgpt', 'Your ChatGPT account', 'Sign in and choose a model in My GPT.'], ['openai', 'OpenAI API', 'Separate API connection and billing.']]) {
    const row = element(documentRoot, 'article', 'api-connections-row'); row.dataset.provider = id;
    const top = element(documentRoot, 'div', 'api-connections-rowtop');
    const badge = element(documentRoot, 'span', 'api-connections-badge', 'Not checked');
    top.append(element(documentRoot, 'strong', '', label), badge);
    const detail = element(documentRoot, 'p', '', note);
    const action = element(documentRoot, 'button', 'api-connections-button', id === 'chatgpt' ? 'Open My GPT' : 'Open API setup'); action.type = 'button';
    action.addEventListener('click', () => openFeature('web-ai', { provider: id }));
    row.append(top, detail, action); assistantSection.appendChild(row); assistantRows.set(id, { row, badge, detail, action });
  }
  const bridgeNote = element(documentRoot, 'p', 'api-connections-note'); bridgeNote.setAttribute('role', 'status');
  const refreshTools = element(documentRoot, 'button', 'api-connections-button', 'Refresh assistant status'); refreshTools.type = 'button';
  assistantSection.append(bridgeNote, refreshTools); body.appendChild(assistantSection);
  const localSection = element(documentRoot, 'section', 'api-connections-section');
  localSection.appendChild(element(documentRoot, 'h3', '', 'Local helpers'));
  const localRows = new Map();
  for (const plugin of NETWORK_LOCAL_PLUGINS) {
    const row = element(documentRoot, 'article', 'api-connections-row'); row.dataset.plugin = plugin.id;
    const top = element(documentRoot, 'div', 'api-connections-rowtop'), badge = element(documentRoot, 'span', 'api-connections-badge');
    top.append(element(documentRoot, 'strong', '', plugin.name), badge);
    const detail = element(documentRoot, 'p', '', plugin.description);
    const action = element(documentRoot, 'button', 'api-connections-button', 'Open in Bot Plaza'); action.type = 'button';
    action.addEventListener('click', () => openFeature('bot-plaza', { botId: plugin.id }));
    row.append(top, detail, action); localSection.appendChild(row); localRows.set(plugin.id, { row, badge });
  }
  localSection.appendChild(element(documentRoot, 'p', 'api-connections-note', 'Scripted helpers run locally. Manage your other saved bots and approvals in Bot Plaza.'));
  body.appendChild(localSection);
  const rows = new Map();
  const noKey = element(documentRoot, 'details', 'api-connections-section api-connections-public');
  const publicSummary = element(documentRoot, 'summary', '', 'Public sources · no API key needed'); noKey.appendChild(publicSummary);
  const sourceList = element(documentRoot, 'div', 'api-connections-list'); noKey.appendChild(sourceList);
  for (const probe of API_CONNECTIONS_PROBES) {
    const row = element(documentRoot, 'article', 'api-connections-row'); row.dataset.state = 'unchecked';
    const top = element(documentRoot, 'div', 'api-connections-rowtop');
    const names = element(documentRoot, 'div');
    const providerName = element(documentRoot, 'span', 'api-connections-provider', probe.provider);
    names.append(element(documentRoot, 'strong', '', probe.label), providerName);
    const badge = element(documentRoot, 'span', 'api-connections-badge', 'Not checked'); top.append(names, badge);
    const detail = element(documentRoot, 'p', '', probe.note);
    const link = element(documentRoot, 'a', 'api-connections-source', 'Source & terms'); link.href = probe.docs; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const retry = element(documentRoot, 'button', 'api-connections-button', `Check ${probe.label}`); retry.type = 'button';
    retry.addEventListener('click', () => checkSource(probe.id));
    row.append(top, detail, link, retry); sourceList.appendChild(row); rows.set(probe.id, { row, badge, detail, providerName, link, retry, result: null });
  }
  const converter = element(documentRoot, 'fieldset', 'api-connections-converter');
  converter.appendChild(element(documentRoot, 'legend', '', 'Reference currency calculator'));
  const amountLabel = element(documentRoot, 'label', '', 'Amount'); amountLabel.htmlFor = 'network-fx-amount';
  const amount = element(documentRoot, 'input'); amount.id = 'network-fx-amount'; amount.type = 'number'; amount.min = '0'; amount.max = '1000000000000'; amount.step = 'any'; amount.value = '100';
  amountLabel.appendChild(amount); converter.appendChild(amountLabel);
  const selectCurrency = (id, text, value) => {
    const label = element(documentRoot, 'label', '', text); label.htmlFor = id;
    const select = element(documentRoot, 'select'); select.id = id;
    select.setAttribute('aria-label', text);
    for (const code of REFERENCE_CURRENCIES) { const option = element(documentRoot, 'option', '', code); option.value = code; select.appendChild(option); }
    select.value = value; label.appendChild(select); converter.appendChild(label); return select;
  };
  const from = selectCurrency('network-fx-from', 'From', 'EUR'), to = selectCurrency('network-fx-to', 'To', 'USD');
  const convert = element(documentRoot, 'button', 'api-connections-button', 'Convert reference amount'); convert.type = 'button'; convert.disabled = true;
  const conversion = element(documentRoot, 'p', 'api-connections-conversion', 'Check exchange rates to use this calculator.'); conversion.setAttribute('role', 'status');
  converter.append(convert, conversion, element(documentRoot, 'p', 'api-connections-note', 'Daily reference estimate; excludes fees and spreads. No trade or payment is made. Conversion stays on this device.'));
  rows.get('fx').row.appendChild(converter);
  convert.addEventListener('click', () => {
    try {
      const value = amount.value.trim();
      const quote = convertReferenceAmount({ amount: value ? Number(value) : NaN, from: from.value, to: to.value, observation: rows.get('fx').result?.observation });
      conversion.textContent = `${quote.amount.toLocaleString()} ${quote.from} ≈ ${quote.converted.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${quote.to} · ${quote.provider} · ${quote.observedAt}`;
    } catch (error) { conversion.textContent = error.message; }
  });
  noKey.appendChild(element(documentRoot, 'p', 'api-connections-note', `${autoCheck ? 'Public connections check once automatically when this page loads. Check connections runs them again. ' : 'One check reads four fixed public endpoints. '}If Frankfurter fails, exchange rates try one fixed alternate and identify its source. Weather uses a New York example; your device location is never requested. Values are observations, with provider terms and limits.`));
  body.appendChild(noKey);

  const nvidiaSection = element(documentRoot, 'section', 'api-connections-section');
  const nvidiaTop = element(documentRoot, 'div', 'api-connections-rowtop');
  nvidiaTop.appendChild(element(documentRoot, 'h3', '', 'NVIDIA assistant'));
  const nvidiaBadge = element(documentRoot, 'span', 'api-connections-badge', 'Bridge not checked'); nvidiaTop.appendChild(nvidiaBadge);
  const nvidiaStatus = element(documentRoot, 'p', 'api-connections-nvidia-status', 'Start the local provider bridge to connect. Your API key stays in the server environment.');
  const modelText = element(documentRoot, 'p', 'api-connections-model'); modelText.hidden = true;
  const setup = element(documentRoot, 'details', 'api-connections-setup');
  setup.appendChild(element(documentRoot, 'summary', '', 'Connect NVIDIA locally'));
  setup.appendChild(element(documentRoot, 'p', '', 'Create a developer key at NVIDIA Build. Set NVIDIA_API_KEY only in your local server environment, then run the bridge from this checkout:'));
  setup.appendChild(element(documentRoot, 'code', '', 'py -3 scripts/provider_bridge.py'));
  const localLink = element(documentRoot, 'a', 'api-connections-source', 'Open local Reality Lens'); localLink.href = API_BRIDGE_DEFAULT_URL; localLink.target = '_blank'; localLink.rel = 'noopener noreferrer';
  const keyLink = element(documentRoot, 'a', 'api-connections-source', 'NVIDIA Build · get a developer key'); keyLink.href = 'https://build.nvidia.com/'; keyLink.target = '_blank'; keyLink.rel = 'noopener noreferrer';
  setup.append(localLink, keyLink);
  setup.appendChild(element(documentRoot, 'p', '', 'Developer/prototyping access has provider limits; model availability changes. A configured key is verified only after Send returns an answer.'));
  const promptLabel = element(documentRoot, 'label', 'api-connections-prompt-label', 'Ask for advice'); promptLabel.htmlFor = 'api-connections-prompt';
  const prompt = element(documentRoot, 'textarea', 'api-connections-prompt'); prompt.id = 'api-connections-prompt'; prompt.rows = 3; prompt.maxLength = 4000; prompt.placeholder = 'What would you like to understand or improve?';
  const sendRow = element(documentRoot, 'div', 'api-connections-sendrow');
  const send = element(documentRoot, 'button', 'api-connections-button primary', 'Send to NVIDIA'); send.type = 'button'; send.disabled = true;
  sendRow.append(send, element(documentRoot, 'span', 'api-connections-note', 'Only this prompt is sent, when you press Send.'));
  const answer = element(documentRoot, 'div', 'api-connections-answer'); answer.hidden = true; answer.setAttribute('role', 'status'); answer.setAttribute('aria-live', 'polite');
  nvidiaSection.append(nvidiaTop, nvidiaStatus, modelText, setup, promptLabel, prompt, sendRow, answer); body.appendChild(nvidiaSection);
  const existing = element(documentRoot, 'details', 'api-connections-existing'); existing.appendChild(element(documentRoot, 'summary', '', 'Open existing source spaces'));
  for (const entry of API_CONNECTIONS_EXISTING) {
    const button = element(documentRoot, 'button', 'api-connections-feature'); button.type = 'button';
    button.append(element(documentRoot, 'strong', '', entry.label), element(documentRoot, 'span', '', entry.description));
    button.addEventListener('click', () => openFeature(entry.feature)); existing.appendChild(button);
  }
  body.appendChild(existing);
  panel.appendChild(element(documentRoot, 'p', 'api-connections-footer', 'Assistant replies are advisory text. Source checks and replies stay in this page session.'));
  documentRoot.body.append(trigger, panel);

  let destroyed = false, checking = false, sending = false, bridgeUrl = null, bridgeError = null, nvidia = null, gpt = null, gptError = null, localTools = [], lastCheckAt = null, automaticCheckStarted = false;
  let checkController = null, sendController = null, discoveryController = null;
  let focusBeforeOpen = null;
  function renderTools() {
    if (destroyed) return;
    const labels = { dependency_needed: 'Dependency needed', signed_out: 'Signed out', reauth_required: 'Sign in again', plan_disabled: 'Permission needed', signed_in: 'Signed in · untested', configured: 'Configured · untested', key_needed: 'Key needed', verified: 'Reply verified', error: 'Provider error' };
    for (const [id, nodes] of assistantRows) {
      const provider = gpt?.[id];
      nodes.row.dataset.state = provider?.state ?? 'unavailable'; nodes.badge.dataset.state = provider?.state ?? 'unavailable';
      nodes.badge.textContent = provider ? labels[provider.state] : 'Bridge unavailable';
      nodes.detail.textContent = !provider ? `My GPT status unavailable${gptError ? `: ${gptError}` : '. Check the local bridge.'}`
        : provider.error ? provider.error : provider.verifiedAt ? `Last successful reply: ${new Date(provider.verifiedAt).toLocaleString()}. Open My GPT to continue.`
        : id === 'openai' ? provider.ready ? 'API credential configured. An explicit successful reply verifies the connection.' : 'API credential needed in the local bridge. Open My GPT for connection details.'
        : provider.state === 'dependency_needed' ? 'The local bridge needs its ChatGPT sign-in dependency. Open My GPT for details.'
        : provider.state === 'plan_disabled' ? 'Authorize ChatGPT plan use in My GPT before sending.'
        : provider.ready ? 'Account connected. Choose a model and send explicitly in My GPT.' : 'Open My GPT to sign in on this PC and choose a model.';
    }
    bridgeNote.textContent = gpt ? `Credential storage: ${gpt.credentialStorage === 'windows_dpapi' ? 'Windows protected storage' : gpt.credentialStorage}.${gpt.storageWarning ? ` ${gpt.storageWarning}` : ''} Status checks never send prompts.` : 'Local status checks never sign in or send prompts.';
    try { localTools = typeof getLocalTools === 'function' ? getLocalTools() : []; } catch { localTools = []; }
    if (!Array.isArray(localTools)) localTools = [];
    localTools = NETWORK_LOCAL_PLUGINS.map(plugin => {
      const live = localTools.find(item => item?.id === plugin.id);
      const state = !live ? 'not-installed' : live.enabled === true ? 'enabled' : 'resting';
      const nodes = localRows.get(plugin.id); nodes.row.dataset.state = state; nodes.badge.dataset.state = state;
      nodes.badge.textContent = state === 'enabled' ? 'Enabled · local' : state === 'resting' ? 'Resting · local' : 'Not installed';
      return Object.freeze({ ...plugin, state });
    });
    refreshTools.disabled = checking || sending;
    cancelButton.hidden = !checking && !sending;
    for (const nodes of rows.values()) nodes.retry.disabled = checking || sending;
  }
  function renderNvidia() {
    if (destroyed) return;
    const labels = { 'key-needed': 'Key needed', configured: 'Configured · untested', verified: 'Answer verified', error: 'Provider error' };
    nvidiaBadge.textContent = nvidia ? labels[nvidia.state] : 'Bridge unavailable';
    nvidiaBadge.dataset.state = nvidia?.state ?? 'unavailable';
    if (!nvidia) nvidiaStatus.textContent = `Local bridge unavailable${bridgeError ? `: ${bridgeError}` : '.'} Start it, then open local Reality Lens or check again. Your browser may require local-network permission.`;
    else if (!nvidia.configured) nvidiaStatus.textContent = 'Local bridge detected. Set NVIDIA_API_KEY in its server environment and restart it.';
    else if (nvidia.error) nvidiaStatus.textContent = nvidia.error;
    else if (nvidia.verifiedAt) nvidiaStatus.textContent = `Last answer received ${new Date(nvidia.verifiedAt).toLocaleString()}.`;
    else nvidiaStatus.textContent = 'Local bridge detected and key configured. NVIDIA availability has not been tested; Send makes the first cloud request.';
    modelText.hidden = !nvidia; modelText.textContent = nvidia ? `Model · ${nvidia.model}` : '';
    send.disabled = checking || sending || !nvidia?.configured || !bridgeUrl;
    renderTools();
  }
  async function detectBridge({ allowLoopback = false, signal } = {}) {
    const local = resolveApiBridgeUrl(windowRoot?.location);
    const candidates = [...new Set([local, allowLoopback ? API_BRIDGE_DEFAULT_URL : null].filter(Boolean))];
    let lastError = null;
    for (const candidate of candidates) {
      if (signal?.aborted || destroyed) return false;
      try {
        // Booting the 3-D world can occupy the renderer for several seconds.
        // A local health reply must have the same budget as the public probes.
        const data = await readJson(fetchImpl, `${candidate}/api/providers`, { signal, timeoutMs: API_CONNECTIONS_TIMEOUT_MS });
        if (destroyed || signal?.aborted) return false;
        nvidia = normalizeNvidiaStatus(data); bridgeUrl = candidate; bridgeError = null;
        try {
          const status = await readJson(fetchImpl, `${candidate}/api/gpt/status`, { signal });
          if (destroyed || signal?.aborted) return false;
          gpt = normalizeGptConnectionStatus(status); gptError = null;
        } catch (error) {
          if (destroyed || signal?.aborted) return false;
          gpt = null; gptError = String(error?.message ?? 'My GPT status failed.').slice(0, 240);
        }
        renderNvidia(); return true;
      } catch (error) { lastError = String(error?.message ?? 'Status request failed.').slice(0, 240); }
    }
    if (candidates.length && !destroyed && !signal?.aborted) { bridgeUrl = null; bridgeError = lastError; nvidia = null; gpt = null; gptError = lastError; renderNvidia(); }
    return false;
  }
  function renderSource(probe, result) {
    const nodes = rows.get(probe.id);
    nodes.row.dataset.state = result?.state ?? 'unchecked'; nodes.badge.textContent = !result ? 'Not checked' : result.state === 'available' ? result.fallbackUsed ? 'Available · alternate' : 'Available' : 'Unavailable';
    nodes.providerName.textContent = result?.provider ?? probe.provider;
    nodes.detail.textContent = !result ? probe.note : result.fallbackUsed && result.state === 'available'
      ? `${result.summary} · ${result.attempts[0].provider} unavailable: ${result.attempts[0].reason}` : result.summary;
    nodes.link.href = result?.attributionUrl ?? result?.documentationUrl ?? probe.docs;
    nodes.link.textContent = result?.attributionLabel ?? 'Source & terms';
    if (probe.id === 'fx') {
      convert.disabled = !result?.observation;
      conversion.textContent = result?.observation ? 'Choose an amount and currencies. These rates are used locally.' : 'Check exchange rates to use this calculator.';
    }
  }
  async function checkConnections({ automatic = false, sourceId = null, bridgeOnly = false } = {}) {
    if (destroyed || checking || sending) return null;
    if (sourceId && !API_CONNECTIONS_PROBES.some(probe => probe.id === sourceId)) return null;
    checking = true; checkButton.disabled = true; checkButton.textContent = 'Checking…'; checkStatus.textContent = 'Checking public sources and the local bridge…';
    send.disabled = true;
    renderTools();
    discoveryController?.abort(); checkController = new AbortController();
    const signal = checkController.signal;
    const bridgePromise = sourceId ? Promise.resolve() : detectBridge({ allowLoopback: true, signal });
    const probes = bridgeOnly ? [] : API_CONNECTIONS_PROBES.filter(probe => !sourceId || probe.id === sourceId);
    const results = await Promise.all(probes.map(async probe => {
      const nodes = rows.get(probe.id); nodes.row.dataset.state = 'checking'; nodes.badge.textContent = 'Checking…';
      const result = await checkApiConnection(probe, { fetchImpl, signal });
      if (!destroyed && !signal.aborted) {
        nodes.result = result; renderSource(probe, result);
      }
      return result;
    }));
    await bridgePromise;
    if (destroyed) return null;
    checking = false; checkButton.disabled = false; checkButton.textContent = 'Check connections';
    renderNvidia();
    if (!signal.aborted) {
      lastCheckAt = new Date().toISOString();
      const available = results.filter(result => result.state === 'available').length;
      checkStatus.textContent = bridgeOnly ? 'Assistant status refreshed. No prompts sent.' : `${automatic ? 'Auto-checked once · ' : ''}${available}/${results.length} checked public sources available · ${new Date(lastCheckAt).toLocaleTimeString()}`;
      const total = [...rows.values()].filter(nodes => nodes.result?.state === 'available').length;
      publicSummary.textContent = `Public sources · ${total}/${rows.size} available`;
    } else {
      checkStatus.textContent = 'Connection check cancelled.';
      for (const probe of probes) renderSource(probe, rows.get(probe.id).result);
    }
    return results;
  }
  function checkSource(id) { return checkConnections({ sourceId: id }); }
  function cancel() { checkController?.abort(); sendController?.abort(); discoveryController?.abort(); }
  async function sendPrompt() {
    const text = prompt.value.trim();
    if (destroyed || sending || checking || !nvidia?.configured || !bridgeUrl) return;
    if (!text) { answer.hidden = false; answer.textContent = 'Enter a prompt first.'; prompt.focus(); return; }
    sending = true; send.disabled = true; checkButton.disabled = true; send.textContent = 'Waiting for NVIDIA…';
    renderTools();
    answer.hidden = false; answer.textContent = 'Sending this prompt to NVIDIA. This can take up to 45 seconds.';
    sendController = new AbortController();
    try {
      const data = await readJson(fetchImpl, `${bridgeUrl}/api/nvidia/chat`, { method: 'POST', body: { prompt: text.slice(0, 4000) }, signal: sendController.signal, timeoutMs: 50_000 });
      if (destroyed || sendController.signal.aborted) return;
      if (data?.provider !== 'nvidia' || typeof data.content !== 'string' || !data.content.trim() || data.advisory !== true || !Number.isFinite(Date.parse(data.verifiedAt))) throw new Error('The bridge returned an invalid answer.');
      answer.textContent = data.content.slice(0, 16_000);
      nvidia = { ...nvidia, state: 'verified', verifiedAt: data.verifiedAt, error: null };
    } catch (error) {
      if (destroyed) return;
      if (sendController.signal.aborted) { answer.textContent = 'Stopped waiting locally. The provider may still finish this request.'; return; }
      const message = String(error?.message ?? 'NVIDIA is unavailable.').slice(0, 240);
      answer.textContent = message;
      nvidia = { ...nvidia, state: 'error', error: message };
    } finally {
      if (!destroyed) { sending = false; send.textContent = 'Send to NVIDIA'; checkButton.disabled = false; renderNvidia(); }
    }
  }
  function open() {
    if (destroyed || !panel.hidden) return;
    focusBeforeOpen = documentRoot.activeElement;
    renderTools();
    onOpen?.(); panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); checkButton.focus();
  }
  function close() {
    if (destroyed || panel.hidden) return;
    panel.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    if (documentRoot.activeElement && panel.contains(documentRoot.activeElement)) (focusBeforeOpen?.isConnected ? focusBeforeOpen : trigger).focus();
  }
  function toggle() { panel.hidden ? open() : close(); }
  function onKey(event) {
    if (panel.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  }
  trigger.addEventListener('click', toggle); closeButton.addEventListener('click', close);
  checkButton.addEventListener('click', () => checkConnections()); send.addEventListener('click', sendPrompt);
  refreshTools.addEventListener('click', () => checkConnections({ bridgeOnly: true })); cancelButton.addEventListener('click', cancel);
  panel.addEventListener('keydown', onKey);
  // The site may opt into one bounded public batch at startup. There is no
  // polling or inference. Library users retain a network-free default on Pages.
  renderTools();
  if (autoCheck) {
    automaticCheckStarted = true;
    void checkConnections({ automatic: true });
  } else if (resolveApiBridgeUrl(windowRoot?.location)) {
    discoveryController = new AbortController();
    void detectBridge({ signal: discoveryController.signal });
  }
  return Object.freeze({ open, close, toggle, checkConnections, checkSource, cancel,
    getSnapshot() { return Object.freeze({ open: !panel.hidden, checking, sending, bridgeUrl, bridgeError, nvidia: nvidia ? { ...nvidia } : null, lastCheckAt,
      gpt, gptError, localTools: localTools.map(tool => ({ ...tool })), publicSources: [...rows.values()].map(row => row.result).filter(Boolean), credentialsInBrowser: false, automaticInference: false, automaticCheckStarted }); },
    destroy() {
      if (destroyed) return; destroyed = true;
      checkController?.abort(); sendController?.abort(); discoveryController?.abort();
      panel.remove(); trigger.remove(); stylesheet.remove();
    } });
}
